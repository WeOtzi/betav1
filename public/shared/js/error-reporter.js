/* ============================================
   WE OTZI - ERROR REPORTER UI
   Modal component for manual error reporting
   Shows when errors occur with option to send report
   ============================================ */

const ErrorReporter = (function() {
    'use strict';

    // State
    let isInitialized = false;
    let modal = null;
    let currentError = null;
    let autoShowOnError = true;
    let errorQueue = [];
    let isShowing = false;

    // Configuration
    const CONFIG = {
        AUTO_SHOW_DELAY: 500,      // Delay before showing modal after error
        DISMISS_TIMEOUT: 10000,    // Auto-dismiss notification after 10s
        MAX_QUEUED_ERRORS: 5,      // Max errors to queue
        COOLDOWN: 30000            // Min ms between showing for same error
    };

    // Track shown errors to avoid spam
    const shownErrors = new Map();

    // ============================================
    // INITIALIZATION
    // ============================================

    function init(options = {}) {
        if (isInitialized) return;

        Object.assign(CONFIG, options);
        autoShowOnError = options.autoShow !== false;

        createModal();
        createStyles();
        setupErrorListener();

        isInitialized = true;
    }

    function createStyles() {
        if (document.getElementById('error-reporter-styles')) return;

        const styles = document.createElement('style');
        styles.id = 'error-reporter-styles';
        styles.textContent = `
            .error-reporter-overlay {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.6);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 99999;
                opacity: 0;
                visibility: hidden;
                transition: opacity 0.3s ease, visibility 0.3s ease;
            }

            .error-reporter-overlay.active {
                opacity: 1;
                visibility: visible;
            }

            .error-reporter-modal {
                background: var(--bg-primary, #1a1a1a);
                border: 2px solid var(--bauhaus-red, #e63946);
                border-radius: 0;
                max-width: 500px;
                width: 90%;
                max-height: 90vh;
                overflow: hidden;
                transform: scale(0.9);
                transition: transform 0.3s ease;
            }

            .error-reporter-overlay.active .error-reporter-modal {
                transform: scale(1);
            }

            .error-reporter-header {
                background: var(--bauhaus-red, #e63946);
                color: white;
                padding: 1rem 1.5rem;
                display: flex;
                align-items: center;
                gap: 0.75rem;
            }

            .error-reporter-header svg {
                width: 24px;
                height: 24px;
                flex-shrink: 0;
            }

            .error-reporter-title {
                font-family: var(--font-mono, monospace);
                font-size: 0.875rem;
                font-weight: 700;
                text-transform: uppercase;
                letter-spacing: 0.05em;
                margin: 0;
            }

            .error-reporter-close {
                margin-left: auto;
                background: none;
                border: none;
                color: white;
                cursor: pointer;
                padding: 0.25rem;
                opacity: 0.8;
                transition: opacity 0.2s;
            }

            .error-reporter-close:hover {
                opacity: 1;
            }

            .error-reporter-body {
                padding: 1.5rem;
                max-height: 50vh;
                overflow-y: auto;
            }

            .error-reporter-message {
                font-family: var(--font-mono, monospace);
                font-size: 0.75rem;
                background: var(--bg-secondary, #2a2a2a);
                padding: 1rem;
                border-left: 3px solid var(--bauhaus-red, #e63946);
                margin-bottom: 1.5rem;
                white-space: pre-wrap;
                word-break: break-word;
                color: var(--text-secondary, #888);
                max-height: 150px;
                overflow-y: auto;
            }

            .error-reporter-description {
                color: var(--text-primary, #fff);
                font-size: 0.9rem;
                line-height: 1.5;
                margin-bottom: 1rem;
            }

            .error-reporter-textarea {
                width: 100%;
                min-height: 100px;
                padding: 0.75rem;
                background: var(--bg-secondary, #2a2a2a);
                border: 1px solid var(--border-color, #444);
                color: var(--text-primary, #fff);
                font-family: inherit;
                font-size: 0.875rem;
                resize: vertical;
                margin-bottom: 1rem;
            }

            .error-reporter-textarea:focus {
                outline: none;
                border-color: var(--bauhaus-red, #e63946);
            }

            .error-reporter-checkbox {
                display: flex;
                align-items: center;
                gap: 0.5rem;
                margin-bottom: 1rem;
                cursor: pointer;
                font-size: 0.8rem;
                color: var(--text-secondary, #888);
            }

            .error-reporter-checkbox input {
                width: 16px;
                height: 16px;
                accent-color: var(--bauhaus-red, #e63946);
            }

            .error-reporter-footer {
                padding: 1rem 1.5rem;
                background: var(--bg-secondary, #2a2a2a);
                display: flex;
                gap: 0.75rem;
                justify-content: flex-end;
            }

            .error-reporter-btn {
                padding: 0.75rem 1.5rem;
                font-family: var(--font-mono, monospace);
                font-size: 0.75rem;
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 0.05em;
                border: none;
                cursor: pointer;
                transition: all 0.2s ease;
            }

            .error-reporter-btn-primary {
                background: var(--bauhaus-red, #e63946);
                color: white;
            }

            .error-reporter-btn-primary:hover {
                background: #d62839;
            }

            .error-reporter-btn-primary:disabled {
                background: #666;
                cursor: not-allowed;
            }

            .error-reporter-btn-secondary {
                background: transparent;
                color: var(--text-secondary, #888);
                border: 1px solid var(--border-color, #444);
            }

            .error-reporter-btn-secondary:hover {
                border-color: var(--text-primary, #fff);
                color: var(--text-primary, #fff);
            }

            .error-reporter-status {
                padding: 0.5rem 1rem;
                font-size: 0.8rem;
                text-align: center;
                display: none;
            }

            .error-reporter-status.success {
                display: block;
                background: rgba(39, 174, 96, 0.2);
                color: #27ae60;
            }

            .error-reporter-status.error {
                display: block;
                background: rgba(230, 57, 70, 0.2);
                color: var(--bauhaus-red, #e63946);
            }

            /* Toast notification for non-blocking errors */
            .error-reporter-toast {
                position: fixed;
                bottom: 80px;
                right: 20px;
                background: var(--bg-primary, #1a1a1a);
                border: 2px solid var(--bauhaus-red, #e63946);
                padding: 1rem 1.5rem;
                display: flex;
                align-items: center;
                gap: 1rem;
                z-index: 99998;
                transform: translateX(120%);
                transition: transform 0.3s ease;
                max-width: 400px;
            }

            .error-reporter-toast.active {
                transform: translateX(0);
            }

            .error-reporter-toast-message {
                flex: 1;
                font-size: 0.875rem;
                color: var(--text-primary, #fff);
            }

            .error-reporter-toast-btn {
                background: var(--bauhaus-red, #e63946);
                color: white;
                border: none;
                padding: 0.5rem 1rem;
                font-size: 0.75rem;
                cursor: pointer;
                white-space: nowrap;
            }

            .error-reporter-toast-close {
                background: none;
                border: none;
                color: var(--text-secondary, #888);
                cursor: pointer;
                padding: 0.25rem;
            }
        `;
        document.head.appendChild(styles);
    }

    function createModal() {
        // Create modal HTML
        modal = document.createElement('div');
        modal.className = 'error-reporter-overlay';
        modal.innerHTML = `
            <div class="error-reporter-modal">
                <div class="error-reporter-header">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"/>
                        <line x1="12" y1="8" x2="12" y2="12"/>
                        <line x1="12" y1="16" x2="12.01" y2="16"/>
                    </svg>
                    <h3 class="error-reporter-title">Se ha detectado un error</h3>
                    <button class="error-reporter-close" aria-label="Cerrar">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"/>
                            <line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                    </button>
                </div>
                <div class="error-reporter-body">
                    <div class="error-reporter-message" id="error-reporter-error-text"></div>
                    <p class="error-reporter-description">
                        Ha ocurrido un error inesperado. Puedes enviarnos un reporte para ayudarnos a solucionarlo.
                    </p>
                    <textarea 
                        class="error-reporter-textarea" 
                        id="error-reporter-user-message"
                        placeholder="Describe lo que estabas haciendo cuando ocurrio el error (opcional)..."
                    ></textarea>
                    <label class="error-reporter-checkbox">
                        <input type="checkbox" id="error-reporter-include-log" checked>
                        Incluir registro de actividad para diagnostico
                    </label>
                </div>
                <div class="error-reporter-status" id="error-reporter-status"></div>
                <div class="error-reporter-footer">
                    <button class="error-reporter-btn error-reporter-btn-secondary" id="error-reporter-dismiss">
                        Ignorar
                    </button>
                    <button class="error-reporter-btn error-reporter-btn-primary" id="error-reporter-send">
                        Enviar Reporte
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Setup event listeners
        modal.querySelector('.error-reporter-close').addEventListener('click', hide);
        modal.querySelector('#error-reporter-dismiss').addEventListener('click', hide);
        modal.querySelector('#error-reporter-send').addEventListener('click', sendReport);
        
        // Close on overlay click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) hide();
        });

        // Close on Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal.classList.contains('active')) {
                hide();
            }
        });
    }

    // ============================================
    // ERROR HANDLING
    // ============================================

    function setupErrorListener() {
        // Listen for unhandled errors to show the reporter
        const originalOnError = window.onerror;
        window.onerror = function(message, source, lineno, colno, error) {
            if (autoShowOnError) {
                queueError({
                    message,
                    source,
                    line: lineno,
                    column: colno,
                    stack: error?.stack
                });
            }
            if (originalOnError) {
                return originalOnError.apply(this, arguments);
            }
            return false;
        };

        const originalOnUnhandledRejection = window.onunhandledrejection;
        window.onunhandledrejection = function(event) {
            if (autoShowOnError) {
                const reason = event.reason;
                queueError({
                    message: reason?.message || String(reason),
                    stack: reason?.stack,
                    type: 'Promise Rejection'
                });
            }
            if (originalOnUnhandledRejection) {
                originalOnUnhandledRejection.call(window, event);
            }
        };
    }

    function queueError(errorData) {
        // Create hash to check cooldown
        const errorHash = simpleHash(errorData.message + (errorData.stack?.split('\n')[1] || ''));
        const lastShown = shownErrors.get(errorHash) || 0;
        const now = Date.now();

        if ((now - lastShown) < CONFIG.COOLDOWN) {
            return; // Skip - shown recently
        }

        shownErrors.set(errorHash, now);

        if (errorQueue.length >= CONFIG.MAX_QUEUED_ERRORS) {
            errorQueue.shift(); // Remove oldest
        }

        errorQueue.push(errorData);

        // Show after delay
        setTimeout(() => {
            if (!isShowing && errorQueue.length > 0) {
                showNextError();
            }
        }, CONFIG.AUTO_SHOW_DELAY);
    }

    function showNextError() {
        if (errorQueue.length === 0) return;
        
        const errorData = errorQueue.shift();
        show(errorData);
    }

    function simpleHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash = hash & hash;
        }
        return Math.abs(hash).toString(36);
    }

    // ============================================
    // MODAL CONTROL
    // ============================================

    function show(errorData) {
        if (!modal) init();
        
        currentError = errorData;
        isShowing = true;

        // Format error message
        let errorText = errorData.message || 'Error desconocido';
        if (errorData.source) {
            errorText += `\n\nArchivo: ${errorData.source}`;
        }
        if (errorData.line) {
            errorText += `:${errorData.line}`;
        }
        if (errorData.stack) {
            errorText += `\n\n${errorData.stack.split('\n').slice(0, 5).join('\n')}`;
        }

        modal.querySelector('#error-reporter-error-text').textContent = errorText;
        modal.querySelector('#error-reporter-user-message').value = '';
        modal.querySelector('#error-reporter-include-log').checked = true;
        
        // Reset status
        const status = modal.querySelector('#error-reporter-status');
        status.className = 'error-reporter-status';
        status.textContent = '';

        // Enable buttons
        modal.querySelector('#error-reporter-send').disabled = false;

        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function hide() {
        if (!modal) return;
        
        modal.classList.remove('active');
        document.body.style.overflow = '';
        currentError = null;
        isShowing = false;

        // Show next error if queued
        setTimeout(() => {
            if (errorQueue.length > 0) {
                showNextError();
            }
        }, 500);
    }

    // ============================================
    // REPORT SUBMISSION
    // ============================================

    async function sendReport() {
        if (!currentError) return;

        const sendBtn = modal.querySelector('#error-reporter-send');
        const status = modal.querySelector('#error-reporter-status');
        const userMessage = modal.querySelector('#error-reporter-user-message').value;
        const includeLog = modal.querySelector('#error-reporter-include-log').checked;

        sendBtn.disabled = true;
        sendBtn.textContent = 'Enviando...';

        try {
            // Build report message
            let reportMessage = currentError.message || 'Error desconocido';
            if (userMessage.trim()) {
                reportMessage = `${userMessage.trim()}\n\n--- Error Original ---\n${reportMessage}`;
            }

            // Use LoggingService if available
            if (window.LoggingService?.sendErrorReport) {
                await window.LoggingService.sendErrorReport(reportMessage, includeLog);
            } else {
                // Fallback: direct Supabase insert
                const supabase = window.ConfigManager?.getSupabaseClient() || window._supabase;
                if (!supabase) throw new Error('No se pudo conectar');

                await supabase.from('feedback_tickets').insert([{
                    reason: 'error',
                    cause: 'otro',
                    message: reportMessage.substring(0, 500),
                    metadata: {
                        url: window.location.href,
                        userAgent: navigator.userAgent,
                        timestamp: new Date().toISOString(),
                        errorStack: currentError.stack?.substring(0, 1000)
                    },
                    status: 'open'
                }]);
            }

            status.className = 'error-reporter-status success';
            status.textContent = 'Reporte enviado correctamente. Gracias por tu ayuda.';

            setTimeout(hide, 2000);

        } catch (err) {
            console.error('[ErrorReporter] Send error:', err);
            status.className = 'error-reporter-status error';
            status.textContent = 'Error al enviar. Por favor intenta de nuevo.';
            sendBtn.disabled = false;
            sendBtn.textContent = 'Enviar Reporte';
        }
    }

    // ============================================
    // TOAST NOTIFICATIONS
    // ============================================

    function showToast(message, showReportOption = true) {
        // Remove existing toast
        const existingToast = document.querySelector('.error-reporter-toast');
        if (existingToast) existingToast.remove();

        const toast = document.createElement('div');
        toast.className = 'error-reporter-toast';
        toast.innerHTML = `
            <span class="error-reporter-toast-message">${message}</span>
            ${showReportOption ? '<button class="error-reporter-toast-btn">Reportar</button>' : ''}
            <button class="error-reporter-toast-close">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
            </button>
        `;

        document.body.appendChild(toast);

        // Trigger animation
        requestAnimationFrame(() => {
            toast.classList.add('active');
        });

        // Event listeners
        toast.querySelector('.error-reporter-toast-close').addEventListener('click', () => {
            toast.classList.remove('active');
            setTimeout(() => toast.remove(), 300);
        });

        if (showReportOption) {
            toast.querySelector('.error-reporter-toast-btn').addEventListener('click', () => {
                toast.classList.remove('active');
                setTimeout(() => toast.remove(), 300);
                show({ message });
            });
        }

        // Auto dismiss
        setTimeout(() => {
            if (document.body.contains(toast)) {
                toast.classList.remove('active');
                setTimeout(() => toast.remove(), 300);
            }
        }, CONFIG.DISMISS_TIMEOUT);
    }

    // ============================================
    // PUBLIC API
    // ============================================

    function setAutoShow(enabled) {
        autoShowOnError = enabled;
    }

    function reportError(error, context = '') {
        const errorData = {
            message: error?.message || String(error),
            stack: error?.stack,
            context
        };
        show(errorData);
    }

    // ============================================
    // EXPORT
    // ============================================

    return {
        init,
        show,
        hide,
        showToast,
        reportError,
        setAutoShow,
        get isShowing() { return isShowing; }
    };
})();

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        ErrorReporter.init();
    });
} else {
    ErrorReporter.init();
}

// Expose globally
window.ErrorReporter = ErrorReporter;
