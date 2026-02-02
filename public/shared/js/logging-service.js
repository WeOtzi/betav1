/* ============================================
   WE OTZI - SESSION LOGGING SERVICE
   Captures user actions, errors, and session data
   Compresses and persists to Supabase
   ============================================ */

const LoggingService = (function() {
    'use strict';

    // Configuration
    const CONFIG = {
        MAX_LOGS: 1000,           // Maximum log entries per session
        PERSIST_INTERVAL: 30000,  // Persist every 30 seconds
        BATCH_SIZE: 100,          // Max logs to persist at once
        COMPRESSION_ENABLED: true,
        AUTO_ERROR_TICKET: true,  // Auto-create tickets for errors
        LOG_CONSOLE: false,       // Mirror logs to console (debug)
        ERROR_COOLDOWN: 5000,     // Min ms between auto-tickets for same error
    };

    // State
    let sessionId = null;
    let logs = [];
    let errorHashes = new Map(); // Track recent errors to avoid duplicates
    let persistInterval = null;
    let isInitialized = false;
    let isPersisting = false;
    let sessionLogId = null;     // UUID from Supabase after first persist

    // User identifiers
    let userIdentifiers = {
        userId: null,
        email: null,
        phone: null,
        ip: null,
        deviceFingerprint: null
    };

    // Session metadata
    let sessionMeta = {
        startedAt: null,
        pageUrl: null,
        userAgent: null,
        referrer: null,
        screenResolution: null,
        viewport: null,
        language: null
    };

    // Original console methods (for interception)
    const originalConsole = {
        log: console.log.bind(console),
        warn: console.warn.bind(console),
        error: console.error.bind(console),
        info: console.info.bind(console)
    };

    // ============================================
    // INITIALIZATION
    // ============================================

    async function init(options = {}) {
        if (isInitialized) {
            return;
        }

        // Merge options
        Object.assign(CONFIG, options);

        // Generate session ID
        sessionId = generateSessionId();

        // Capture session metadata
        sessionMeta = {
            startedAt: new Date().toISOString(),
            pageUrl: window.location.href,
            userAgent: navigator.userAgent,
            referrer: document.referrer || null,
            screenResolution: `${window.screen.width}x${window.screen.height}`,
            viewport: `${window.innerWidth}x${window.innerHeight}`,
            language: navigator.language
        };

        // Generate device fingerprint
        userIdentifiers.deviceFingerprint = generateFingerprint();

        // Try to get user info from Supabase
        await captureUserIdentifiers();

        // Fetch client IP
        await fetchClientIP();

        // Setup event listeners
        setupEventListeners();

        // Setup console interception
        if (CONFIG.LOG_CONSOLE) {
            interceptConsole();
        }

        // Setup error handlers
        setupErrorHandlers();

        // Start persistence interval
        startPersistInterval();

        // Log session start
        log('info', 'session', 'Session started', {
            sessionId,
            url: sessionMeta.pageUrl,
            userAgent: sessionMeta.userAgent
        });

        isInitialized = true;

        // Persist initial log
        await persist();

        return sessionId;
    }

    // ============================================
    // SESSION & USER IDENTIFICATION
    // ============================================

    function generateSessionId() {
        const timestamp = Date.now().toString(36);
        const random = Math.random().toString(36).substring(2, 15);
        return `${timestamp}-${random}`;
    }

    function generateFingerprint() {
        const components = [
            navigator.userAgent,
            navigator.language,
            window.screen.width,
            window.screen.height,
            window.screen.colorDepth,
            new Date().getTimezoneOffset(),
            navigator.hardwareConcurrency || 'unknown',
            navigator.deviceMemory || 'unknown'
        ];
        
        // Simple hash
        let hash = 0;
        const str = components.join('|');
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return Math.abs(hash).toString(36);
    }

    async function captureUserIdentifiers() {
        try {
            // Try to get Supabase client from ConfigManager
            const supabase = window.ConfigManager?.getSupabaseClient() || window._supabase;
            
            if (!supabase) {
                return;
            }

            const { data: { session } } = await supabase.auth.getSession();
            
            if (session?.user) {
                userIdentifiers.userId = session.user.id;
                userIdentifiers.email = session.user.email;
                
                // Try to get phone from user metadata or profile tables
                if (session.user.phone) {
                    userIdentifiers.phone = session.user.phone;
                }

                // Try to get more info from profile tables
                await fetchProfileData(supabase, session.user.id);
            }
        } catch (err) {
            // Silent fail - user identification is optional
        }
    }

    async function fetchProfileData(supabase, userId) {
        try {
            // Try artists_db first
            const { data: artist } = await supabase
                .from('artists_db')
                .select('email, phone')
                .eq('user_id', userId)
                .single();
            
            if (artist) {
                userIdentifiers.email = userIdentifiers.email || artist.email;
                userIdentifiers.phone = userIdentifiers.phone || artist.phone;
                return;
            }

            // Try clients_db
            const { data: client } = await supabase
                .from('clients_db')
                .select('email, phone')
                .eq('user_id', userId)
                .single();
            
            if (client) {
                userIdentifiers.email = userIdentifiers.email || client.email;
                userIdentifiers.phone = userIdentifiers.phone || client.phone;
            }
        } catch (err) {
            // Silent fail
        }
    }

    async function fetchClientIP() {
        try {
            const response = await fetch('/api/client-info');
            if (response.ok) {
                const data = await response.json();
                userIdentifiers.ip = data.ip;
            }
        } catch (err) {
            // IP fetch failed - continue without it
        }
    }

    // ============================================
    // LOGGING
    // ============================================

    function log(level, category, message, data = null) {
        if (!isInitialized && level !== 'info') {
            // Queue logs before init
            return;
        }

        const entry = {
            t: Date.now(),           // timestamp
            l: level,                // level: info, warn, error, action, network
            c: category,             // category
            m: message,              // message
        };

        if (data) {
            // Sanitize data - remove sensitive fields
            entry.d = sanitizeData(data);
        }

        logs.push(entry);

        // Trim if exceeded max
        if (logs.length > CONFIG.MAX_LOGS) {
            logs = logs.slice(-CONFIG.MAX_LOGS);
        }

        // Mirror to console in debug mode
        if (CONFIG.LOG_CONSOLE) {
            originalConsole.log(`[LOG] [${level}] [${category}]`, message, data || '');
        }

        return entry;
    }

    function sanitizeData(data) {
        if (!data) return null;
        
        const sensitiveKeys = ['password', 'token', 'secret', 'key', 'auth', 'credential', 'credit_card', 'cvv'];
        
        if (typeof data === 'string') {
            return data.substring(0, 500); // Limit string length
        }
        
        if (typeof data !== 'object') {
            return data;
        }

        const sanitized = Array.isArray(data) ? [] : {};
        
        for (const [key, value] of Object.entries(data)) {
            const lowerKey = key.toLowerCase();
            
            if (sensitiveKeys.some(sk => lowerKey.includes(sk))) {
                sanitized[key] = '[REDACTED]';
            } else if (typeof value === 'object' && value !== null) {
                sanitized[key] = sanitizeData(value);
            } else if (typeof value === 'string' && value.length > 200) {
                sanitized[key] = value.substring(0, 200) + '...';
            } else {
                sanitized[key] = value;
            }
        }
        
        return sanitized;
    }

    // Convenience methods
    function info(category, message, data) {
        return log('info', category, message, data);
    }

    function warn(category, message, data) {
        return log('warn', category, message, data);
    }

    function error(category, message, data) {
        return log('error', category, message, data);
    }

    function action(category, message, data) {
        return log('action', category, message, data);
    }

    function network(category, message, data) {
        return log('network', category, message, data);
    }

    // ============================================
    // EVENT LISTENERS
    // ============================================

    function setupEventListeners() {
        // Click events
        document.addEventListener('click', (e) => {
            const target = e.target.closest('button, a, [role="button"], input[type="submit"]');
            if (target) {
                action('click', `Clicked: ${getElementDescription(target)}`, {
                    tagName: target.tagName,
                    id: target.id || null,
                    className: target.className || null,
                    text: target.textContent?.substring(0, 50) || null,
                    href: target.href || null
                });
            }
        }, { passive: true });

        // Form submissions
        document.addEventListener('submit', (e) => {
            const form = e.target;
            action('form', `Form submitted: ${form.id || form.action || 'unknown'}`, {
                formId: form.id || null,
                action: form.action || null,
                method: form.method || 'GET'
            });
        }, { passive: true });

        // Page navigation
        window.addEventListener('popstate', () => {
            info('navigation', 'Browser navigation', {
                url: window.location.href
            });
        });

        // Hash changes
        window.addEventListener('hashchange', (e) => {
            info('navigation', 'Hash change', {
                oldURL: e.oldURL,
                newURL: e.newURL
            });
        });

        // Visibility changes
        document.addEventListener('visibilitychange', () => {
            info('visibility', `Page ${document.hidden ? 'hidden' : 'visible'}`);
        });

        // Page unload - persist logs
        window.addEventListener('beforeunload', () => {
            log('info', 'session', 'Session ending');
            persistSync(); // Synchronous persist on unload
        });

        // Viewport resize
        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                info('viewport', 'Viewport resized', {
                    width: window.innerWidth,
                    height: window.innerHeight
                });
            }, 500);
        }, { passive: true });

        // Focus/blur on inputs (without values for privacy)
        document.addEventListener('focusin', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
                action('input', `Focus: ${getElementDescription(e.target)}`, {
                    type: e.target.type || 'text',
                    name: e.target.name || null,
                    id: e.target.id || null
                });
            }
        }, { passive: true });

        // Intercept fetch for network logging
        interceptFetch();
    }

    function getElementDescription(element) {
        if (!element) return 'unknown';
        
        const parts = [element.tagName.toLowerCase()];
        
        if (element.id) {
            parts.push(`#${element.id}`);
        }
        if (element.className && typeof element.className === 'string') {
            parts.push(`.${element.className.split(' ')[0]}`);
        }
        
        const text = element.textContent?.trim().substring(0, 30);
        if (text) {
            parts.push(`"${text}"`);
        }
        
        return parts.join('');
    }

    // ============================================
    // CONSOLE INTERCEPTION
    // ============================================

    function interceptConsole() {
        console.log = function(...args) {
            log('info', 'console', args.map(stringifyArg).join(' '));
            originalConsole.log.apply(console, args);
        };

        console.warn = function(...args) {
            log('warn', 'console', args.map(stringifyArg).join(' '));
            originalConsole.warn.apply(console, args);
        };

        console.error = function(...args) {
            log('error', 'console', args.map(stringifyArg).join(' '));
            originalConsole.error.apply(console, args);
        };

        console.info = function(...args) {
            log('info', 'console', args.map(stringifyArg).join(' '));
            originalConsole.info.apply(console, args);
        };
    }

    function stringifyArg(arg) {
        if (typeof arg === 'string') return arg;
        if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
        try {
            return JSON.stringify(arg);
        } catch {
            return String(arg);
        }
    }

    // ============================================
    // NETWORK INTERCEPTION
    // ============================================

    function interceptFetch() {
        const originalFetch = window.fetch;
        
        window.fetch = async function(input, init = {}) {
            const url = typeof input === 'string' ? input : input.url;
            const method = init.method || 'GET';
            const startTime = Date.now();

            // Skip logging for our own logging endpoint
            if (url.includes('/api/client-info') || url.includes('session_logs')) {
                return originalFetch.apply(this, arguments);
            }

            network('fetch', `${method} ${url}`, { method, url });

            try {
                const response = await originalFetch.apply(this, arguments);
                const duration = Date.now() - startTime;

                network('fetch', `${method} ${url} - ${response.status}`, {
                    method,
                    url,
                    status: response.status,
                    duration
                });

                // Log errors
                if (!response.ok) {
                    error('network', `Request failed: ${method} ${url}`, {
                        status: response.status,
                        statusText: response.statusText
                    });
                }

                return response;
            } catch (err) {
                const duration = Date.now() - startTime;
                error('network', `Request error: ${method} ${url}`, {
                    error: err.message,
                    duration
                });
                throw err;
            }
        };
    }

    // ============================================
    // ERROR HANDLING
    // ============================================

    function setupErrorHandlers() {
        // Uncaught exceptions
        window.onerror = function(message, source, lineno, colno, errorObj) {
            const errorData = {
                message,
                source,
                line: lineno,
                column: colno,
                stack: errorObj?.stack || null
            };

            captureError(errorObj || new Error(message), 'uncaught', errorData);
            return false; // Let default handler run
        };

        // Unhandled promise rejections
        window.onunhandledrejection = function(event) {
            const reason = event.reason;
            const errorData = {
                message: reason?.message || String(reason),
                stack: reason?.stack || null,
                type: 'unhandled_promise_rejection'
            };

            captureError(reason instanceof Error ? reason : new Error(String(reason)), 'promise', errorData);
        };
    }

    async function captureError(errorObj, context, additionalData = {}) {
        const errorMessage = errorObj?.message || String(errorObj);
        const errorStack = errorObj?.stack || null;
        
        // Create hash to prevent duplicate tickets
        const errorHash = simpleHash(errorMessage + (errorStack?.split('\n')[1] || ''));
        
        // Log the error
        error(context, errorMessage, {
            ...additionalData,
            stack: errorStack
        });

        // Check cooldown for auto-ticket
        const lastTicketTime = errorHashes.get(errorHash) || 0;
        const now = Date.now();
        
        if (CONFIG.AUTO_ERROR_TICKET && (now - lastTicketTime) > CONFIG.ERROR_COOLDOWN) {
            errorHashes.set(errorHash, now);
            
            // Create automatic ticket
            await createErrorTicket(errorMessage, errorStack, context, additionalData, true);
        }
    }

    function simpleHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash).toString(36);
    }

    async function createErrorTicket(errorMessage, errorStack, context, additionalData, isAuto = false) {
        try {
            const supabase = window.ConfigManager?.getSupabaseClient() || window._supabase;
            if (!supabase) return null;

            // Persist current logs first to get session_log_id
            await persist();

            const ticketData = {
                reason: 'error',
                cause: context === 'network' ? 'interfaz' : 'otro',
                message: `[AUTO] ${errorMessage}`.substring(0, 500),
                metadata: {
                    url: window.location.href,
                    userAgent: navigator.userAgent,
                    resolution: sessionMeta.screenResolution,
                    viewport: sessionMeta.viewport,
                    timestamp: new Date().toISOString(),
                    language: navigator.language,
                    context,
                    ...additionalData
                },
                user_id: userIdentifiers.userId || null,
                user_email: userIdentifiers.email || null,
                user_ip: userIdentifiers.ip || null,
                session_log_id: sessionLogId || null,
                is_auto_generated: isAuto,
                error_stack: errorStack?.substring(0, 2000) || null,
                status: 'open'
            };

            const { data, error: insertError } = await supabase
                .from('feedback_tickets')
                .insert([ticketData])
                .select()
                .single();

            if (insertError) {
                originalConsole.error('[LoggingService] Failed to create ticket:', insertError);
                return null;
            }

            info('ticket', `Error ticket created: ${data.id}`, { ticketId: data.id, auto: isAuto });
            return data;
        } catch (err) {
            originalConsole.error('[LoggingService] Error creating ticket:', err);
            return null;
        }
    }

    // ============================================
    // COMPRESSION
    // ============================================

    function compress(data) {
        if (!CONFIG.COMPRESSION_ENABLED || typeof pako === 'undefined') {
            // Fallback: just JSON stringify
            return JSON.stringify(data);
        }

        try {
            const jsonStr = JSON.stringify(data);
            const compressed = pako.gzip(jsonStr);
            // Convert to base64
            const base64 = btoa(String.fromCharCode.apply(null, compressed));
            return base64;
        } catch (err) {
            originalConsole.error('[LoggingService] Compression error:', err);
            return JSON.stringify(data);
        }
    }

    function decompress(data) {
        if (!data) return [];
        
        // Check if it's base64 compressed
        try {
            if (data.startsWith('[') || data.startsWith('{')) {
                // Already JSON
                return JSON.parse(data);
            }

            if (typeof pako === 'undefined') {
                // Try plain JSON parse
                return JSON.parse(data);
            }

            // Base64 decode
            const binary = atob(data);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
            }
            
            // Decompress
            const decompressed = pako.ungzip(bytes, { to: 'string' });
            return JSON.parse(decompressed);
        } catch (err) {
            originalConsole.error('[LoggingService] Decompression error:', err);
            return [];
        }
    }

    // ============================================
    // PERSISTENCE
    // ============================================

    function startPersistInterval() {
        if (persistInterval) {
            clearInterval(persistInterval);
        }
        
        persistInterval = setInterval(() => {
            persist();
        }, CONFIG.PERSIST_INTERVAL);
    }

    async function persist() {
        if (isPersisting || logs.length === 0) {
            return;
        }

        isPersisting = true;

        try {
            const supabase = window.ConfigManager?.getSupabaseClient() || window._supabase;
            if (!supabase) {
                isPersisting = false;
                return;
            }

            const hasErrors = logs.some(l => l.l === 'error');
            const errorCount = logs.filter(l => l.l === 'error').length;
            const compressedLogs = compress(logs);

            const logData = {
                session_id: sessionId,
                user_id: userIdentifiers.userId || null,
                user_email: userIdentifiers.email || null,
                user_phone: userIdentifiers.phone || null,
                user_ip: userIdentifiers.ip || null,
                device_fingerprint: userIdentifiers.deviceFingerprint || null,
                log_data: compressedLogs,
                log_entries_count: logs.length,
                started_at: sessionMeta.startedAt,
                page_url: sessionMeta.pageUrl,
                user_agent: sessionMeta.userAgent,
                has_errors: hasErrors,
                error_count: errorCount
            };

            if (sessionLogId) {
                // Update existing record
                const { error: updateError } = await supabase
                    .from('session_logs')
                    .update({
                        log_data: compressedLogs,
                        log_entries_count: logs.length,
                        has_errors: hasErrors,
                        error_count: errorCount,
                        ended_at: new Date().toISOString()
                    })
                    .eq('id', sessionLogId);

                if (updateError) {
                    originalConsole.error('[LoggingService] Update error:', updateError);
                }
            } else {
                // Insert new record
                const { data, error: insertError } = await supabase
                    .from('session_logs')
                    .insert([logData])
                    .select()
                    .single();

                if (insertError) {
                    originalConsole.error('[LoggingService] Insert error:', insertError);
                } else {
                    sessionLogId = data.id;
                }
            }
        } catch (err) {
            originalConsole.error('[LoggingService] Persist error:', err);
        } finally {
            isPersisting = false;
        }
    }

    function persistSync() {
        // Synchronous persist for beforeunload
        try {
            const supabase = window.ConfigManager?.getSupabaseClient() || window._supabase;
            if (!supabase || logs.length === 0) return;

            const hasErrors = logs.some(l => l.l === 'error');
            const errorCount = logs.filter(l => l.l === 'error').length;
            const compressedLogs = compress(logs);

            // Use sendBeacon for reliable delivery
            const payload = JSON.stringify({
                session_id: sessionId,
                session_log_id: sessionLogId,
                log_data: compressedLogs,
                log_entries_count: logs.length,
                has_errors: hasErrors,
                error_count: errorCount,
                ended_at: new Date().toISOString()
            });

            // Try to use a beacon endpoint if available
            navigator.sendBeacon('/api/session-log', payload);
        } catch (err) {
            // Silent fail on unload
        }
    }

    // ============================================
    // PUBLIC API
    // ============================================

    async function getSessionLog() {
        return {
            sessionId,
            logs: [...logs],
            compressed: compress(logs),
            userIdentifiers: { ...userIdentifiers },
            sessionMeta: { ...sessionMeta },
            sessionLogId
        };
    }

    async function sendErrorReport(userMessage, includeLog = true) {
        try {
            const supabase = window.ConfigManager?.getSupabaseClient() || window._supabase;
            if (!supabase) {
                throw new Error('Supabase not available');
            }

            // Persist current logs first
            if (includeLog) {
                await persist();
            }

            const ticketData = {
                reason: 'error',
                cause: 'otro',
                message: userMessage.substring(0, 500),
                metadata: {
                    url: window.location.href,
                    userAgent: navigator.userAgent,
                    resolution: sessionMeta.screenResolution,
                    viewport: sessionMeta.viewport,
                    timestamp: new Date().toISOString(),
                    language: navigator.language,
                    sessionId
                },
                user_id: userIdentifiers.userId || null,
                user_email: userIdentifiers.email || null,
                user_ip: userIdentifiers.ip || null,
                session_log_id: includeLog ? sessionLogId : null,
                is_auto_generated: false,
                status: 'open'
            };

            const { data, error: insertError } = await supabase
                .from('feedback_tickets')
                .insert([ticketData])
                .select()
                .single();

            if (insertError) throw insertError;

            info('ticket', `Manual error report sent: ${data.id}`, { ticketId: data.id });
            return data;
        } catch (err) {
            originalConsole.error('[LoggingService] Error sending report:', err);
            throw err;
        }
    }

    function destroy() {
        if (persistInterval) {
            clearInterval(persistInterval);
        }
        
        // Restore original console
        console.log = originalConsole.log;
        console.warn = originalConsole.warn;
        console.error = originalConsole.error;
        console.info = originalConsole.info;
        
        isInitialized = false;
    }

    // ============================================
    // EXPORT
    // ============================================

    return {
        init,
        log,
        info,
        warn,
        error,
        action,
        network,
        captureError,
        createErrorTicket,
        getSessionLog,
        sendErrorReport,
        persist,
        decompress,
        destroy,
        
        // Getters
        get sessionId() { return sessionId; },
        get sessionLogId() { return sessionLogId; },
        get userIdentifiers() { return { ...userIdentifiers }; },
        get isInitialized() { return isInitialized; },
        get logsCount() { return logs.length; }
    };
})();

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        LoggingService.init();
    });
} else {
    // DOM already loaded
    LoggingService.init();
}

// Expose globally
window.LoggingService = LoggingService;
