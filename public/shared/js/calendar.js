// ============================================
// WE OTZI - Calendar View Logic
// Connected to Supabase quotations_db
// Uses shared-drawer.js for quote details
// ============================================

// Supabase Configuration - Uses config-manager.js (provides window.CONFIG)
const supabaseUrl = window.CONFIG?.supabase?.url || 'https://flbgmlvfiejfttlawnfu.supabase.co';
const supabaseKey = window.CONFIG?.supabase?.anonKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsYmdtbHZmaWVqZnR0bGF3bmZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU5MTI1ODksImV4cCI6MjA2MTQ4ODU4OX0.AQm4HM8Gjci08p1vfxu6-6MbT_PRceZm5qQbwxA3888';
const _supabase = supabase.createClient(supabaseUrl, supabaseKey);

// State - These are used by shared-drawer.js
let currentUser = null;
let artistData = null;
let quotations = [];
let allAttachments = [];
let allTattooStyles = [];
let allSessions = [];

// Calendar instance
let calendar = null;

// Filter state
let currentStatusFilter = 'all';

// Google API Config - Loaded DYNAMICALLY from ConfigManager (SuperAdmin panel)
// These are functions instead of constants to avoid race condition with async ConfigManager init
function getGoogleClientId() {
    return window.CONFIG?.googleCalendar?.clientId || window.ConfigManager?.getValue?.('googleCalendar.clientId') || '';
}
function getGoogleApiKey() {
    return window.CONFIG?.googleCalendar?.apiKey || window.ConfigManager?.getValue?.('googleCalendar.apiKey') || '';
}
function getGoogleCalendarEnabled() {
    return window.CONFIG?.googleCalendar?.enabled || window.ConfigManager?.getValue?.('googleCalendar.enabled') || false;
}
const DISCOVERY_DOCS = ['https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest'];
const SCOPES = 'https://www.googleapis.com/auth/calendar.events';

let tokenClient;
let gapiInited = false;
let gisInited = false;

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    initializeCalendar();
    restoreThemeAndZoom();
    
    // Initialize Google API if scripts are loaded
    if (typeof gapi !== 'undefined' && typeof google !== 'undefined') {
        gapiLoaded();
        gisLoaded();
    }
});

async function initializeCalendar() {
    try {
        // 1. Auth Check
        const { data: { session }, error: authError } = await _supabase.auth.getSession();
        
        if (authError || !session) {
            console.log('No authenticated session. Redirecting...');
            window.location.href = 'index.html';
            return;
        }

        currentUser = session.user;
        
        // 2. Load Artist Profile
        const { data: artist, error: artistError } = await _supabase
            .from('artists_db')
            .select('*')
            .eq('user_id', currentUser.id)
            .single();

        if (artistError || !artist) {
            console.error('Artist profile not found');
            window.location.href = 'dashboard.html';
            return;
        }

        artistData = artist;
        const displayName = artist.username ? artist.username.toUpperCase() : currentUser.email.split('@')[0].toUpperCase();
        document.getElementById('logged-as').textContent = `LOGGED_AS: ${displayName}`;

        // 3. Load Quotations & Initialize Calendar
        await loadQuotations();
        initFullCalendar();

    } catch (err) {
        console.error('Initialization error:', err);
        document.getElementById('status-indicator').textContent = 'STATUS: OFFLINE (ERROR)';
    }
}

// ============================================
// THEME & ZOOM CONTROLS
// ============================================

function toggleTheme() {
    const isDark = document.body.classList.toggle('dark-mode');
    localStorage.setItem('weotzi-theme', isDark ? 'dark' : 'light');
    
    const btn = document.querySelector('.theme-toggle');
    if (btn) {
        btn.style.backgroundColor = 'var(--bauhaus-yellow)';
        setTimeout(() => btn.style.backgroundColor = '', 300);
    }
    
    // Re-render calendar to apply dark mode styles
    if (calendar) {
        calendar.render();
    }
}

const ZOOM_MIN = 0.6;
const ZOOM_MAX = 1.2;
const ZOOM_STEP = 0.1;

function setZoom(factor) {
    const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, factor));
    document.documentElement.style.setProperty('--zoom-factor', clamped);
    localStorage.setItem('weotzi-zoom', clamped);
}

function zoomIn() {
    const current = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--zoom-factor')) || 0.8;
    setZoom(current + ZOOM_STEP);
}

function zoomOut() {
    const current = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--zoom-factor')) || 0.8;
    setZoom(current - ZOOM_STEP);
}

function restoreThemeAndZoom() {
    const savedTheme = localStorage.getItem('weotzi-theme');
    if (savedTheme === 'dark') {
        document.body.classList.add('dark-mode');
    }

    const savedZoom = localStorage.getItem('weotzi-zoom');
    if (savedZoom) {
        setZoom(parseFloat(savedZoom));
    }
}

// ============================================
// DATA LOADING
// ============================================

async function loadQuotations() {
    try {
        // Fetch quotations and tattoo styles in parallel (excluding drafts/in_progress)
        const [quotesResult, stylesResult] = await Promise.all([
            _supabase
                .from('quotations_db')
                .select('*')
                .eq('artist_id', currentUser.id)
                .eq('is_archived', false)
                .neq('quote_status', 'in_progress'),
            _supabase
                .from('tattoo_styles')
                .select('*')
                .order('sort_order', { ascending: true })
        ]);

        if (quotesResult.error) throw quotesResult.error;
        quotations = quotesResult.data || [];

        if (stylesResult.error) {
            console.warn('Could not load tattoo styles:', stylesResult.error);
            allTattooStyles = [];
        } else {
            allTattooStyles = stylesResult.data || [];
        }

        // Fetch attachments and sessions for all quotations
        if (quotations.length > 0) {
            const quoteIds = quotations.map(q => q.quote_id).filter(id => id);
            const quoteDbIds = quotations.map(q => q.id);
            
            // Fetch attachments
            if (quoteIds.length > 0) {
                const { data: attachments, error: attachError } = await _supabase
                    .from('quotations_attachments')
                    .select('*')
                    .in('quotation_id', quoteIds);
                
                if (attachError) throw attachError;
                allAttachments = attachments || [];
            }
            
            // Fetch sessions for calendar display
            if (quoteDbIds.length > 0) {
                const { data: sessions, error: sessionsError } = await _supabase
                    .from('quotation_sessions')
                    .select('*')
                    .in('quotation_id', quoteDbIds)
                    .order('session_date', { ascending: true });
                
                if (sessionsError) {
                    console.warn('Could not load sessions:', sessionsError);
                    allSessions = [];
                } else {
                    allSessions = sessions || [];
                }
            }
        }

        updateStats();

    } catch (err) {
        console.error('Error loading quotations:', err);
    }
}

function updateStats() {
    const pending = quotations.filter(q => q.quote_status === 'pending').length;
    const responded = quotations.filter(q => q.quote_status === 'responded').length;
    const completed = quotations.filter(q => q.quote_status === 'completed').length;
    
    document.getElementById('stat-pending').textContent = pending;
    document.getElementById('stat-responded').textContent = responded;
    document.getElementById('stat-completed').textContent = completed;
}

// ============================================
// DATE PARSING
// ============================================

/**
 * Parses the client_preferred_date field and extracts a valid date
 * The field can contain various formats:
 * - "15/01/2026"
 * - "Enero 2026"
 * - "15-20 Enero 2026" (range - use start date)
 * - "Flexible"
 * - "ASAP"
 * - "2026-01-15"
 * - null/undefined
 * 
 * @param {string} dateStr - The date string from client_preferred_date
 * @returns {Date|null} - Parsed Date object or null if unparseable
 */
function parsePreferredDate(dateStr) {
    if (!dateStr || dateStr.toLowerCase() === 'flexible' || dateStr.toLowerCase() === 'asap') {
        return null;
    }
    
    // Try ISO format first (YYYY-MM-DD)
    if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
        const date = new Date(dateStr);
        if (!isNaN(date.getTime())) return date;
    }
    
    // Try DD/MM/YYYY format
    const dmy = dateStr.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (dmy) {
        const date = new Date(parseInt(dmy[3]), parseInt(dmy[2]) - 1, parseInt(dmy[1]));
        if (!isNaN(date.getTime())) return date;
    }
    
    // Try DD-DD Month YYYY format (range - use start date)
    const rangeMatch = dateStr.match(/^(\d{1,2})[\-\s]+\d{1,2}\s+(\w+)\s+(\d{4})/i);
    if (rangeMatch) {
        const day = parseInt(rangeMatch[1]);
        const monthName = rangeMatch[2];
        const year = parseInt(rangeMatch[3]);
        const month = parseMonthName(monthName);
        if (month !== -1) {
            const date = new Date(year, month, day);
            if (!isNaN(date.getTime())) return date;
        }
    }
    
    // Try DD Month YYYY format
    const dmyText = dateStr.match(/^(\d{1,2})\s+(\w+)\s+(\d{4})/i);
    if (dmyText) {
        const day = parseInt(dmyText[1]);
        const monthName = dmyText[2];
        const year = parseInt(dmyText[3]);
        const month = parseMonthName(monthName);
        if (month !== -1) {
            const date = new Date(year, month, day);
            if (!isNaN(date.getTime())) return date;
        }
    }
    
    // Try Month YYYY format (first day of month)
    const myText = dateStr.match(/^(\w+)\s+(\d{4})/i);
    if (myText) {
        const monthName = myText[1];
        const year = parseInt(myText[2]);
        const month = parseMonthName(monthName);
        if (month !== -1) {
            const date = new Date(year, month, 1);
            if (!isNaN(date.getTime())) return date;
        }
    }
    
    // Fallback: try native Date parsing
    const fallback = new Date(dateStr);
    if (!isNaN(fallback.getTime())) return fallback;
    
    return null;
}

/**
 * Parse Spanish and English month names to month index (0-11)
 */
function parseMonthName(monthName) {
    const months = {
        'enero': 0, 'january': 0, 'jan': 0, 'ene': 0,
        'febrero': 1, 'february': 1, 'feb': 1,
        'marzo': 2, 'march': 2, 'mar': 2,
        'abril': 3, 'april': 3, 'apr': 3, 'abr': 3,
        'mayo': 4, 'may': 4,
        'junio': 5, 'june': 5, 'jun': 5,
        'julio': 6, 'july': 6, 'jul': 6,
        'agosto': 7, 'august': 7, 'aug': 7, 'ago': 7,
        'septiembre': 8, 'september': 8, 'sep': 8, 'sept': 8,
        'octubre': 9, 'october': 9, 'oct': 9,
        'noviembre': 10, 'november': 10, 'nov': 10,
        'diciembre': 11, 'december': 11, 'dec': 11, 'dic': 11
    };
    
    return months[monthName.toLowerCase()] ?? -1;
}

/**
 * Format date to YYYY-MM-DD for FullCalendar
 */
function formatDateForCalendar(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// ============================================
// CALENDAR EVENTS
// ============================================

/**
 * Get session status display info
 */
function getSessionStatusInfo(status) {
    const info = {
        'scheduled': { label: 'Agendada', color: '#1A4B8E' },
        'completed': { label: 'Completada', color: '#27ae60' },
        'no_show': { label: 'No Asistio', color: '#C62828' },
        'rescheduled': { label: 'Reprogramada', color: '#F5C518' },
        'cancelled': { label: 'Cancelada', color: '#7f8c8d' }
    };
    return info[status] || { label: status, color: '#666' };
}

/**
 * Convert quotations and sessions to FullCalendar events
 * Applies status filter if set
 * For completed quotes: shows scheduled sessions
 * For non-completed quotes: shows preferred date (if available)
 */
function getCalendarEvents() {
    const events = [];
    
    quotations.forEach(quote => {
        // Apply status filter
        if (currentStatusFilter !== 'all' && quote.quote_status !== currentStatusFilter) {
            return;
        }
        
        // For completed quotes, show scheduled sessions instead of preferred date
        if (quote.quote_status === 'completed') {
            const quoteSessions = allSessions.filter(s => s.quotation_id === quote.id);
            
            quoteSessions.forEach(session => {
                const sessionDate = new Date(session.session_date);
                const statusInfo = getSessionStatusInfo(session.status);
                
                const event = {
                    id: `session-${session.id}`,
                    title: `#${session.session_number || '?'} ${quote.client_full_name || 'Cliente'}`,
                    start: sessionDate.toISOString(),
                    allDay: false,
                    backgroundColor: statusInfo.color,
                    borderColor: statusInfo.color,
                    extendedProps: {
                        quoteId: quote.id,
                        sessionId: session.id,
                        sessionNumber: session.session_number,
                        sessionStatus: session.status,
                        status: quote.quote_status,
                        priority: quote.priority || 'medium',
                        budget: quote.final_budget_amount || quote.client_budget_amount,
                        currency: quote.final_budget_currency || quote.client_budget_currency,
                        tattooIdea: quote.tattoo_idea_description,
                        sessionNotes: session.notes,
                        isSession: true
                    },
                    classNames: [
                        'session-event',
                        `session-status-${session.status}`,
                        `priority-${quote.priority || 'medium'}`
                    ]
                };
                
                events.push(event);
            });
            
            // If no sessions yet for a completed quote, still show the preferred date as placeholder
            if (quoteSessions.length === 0) {
                const preferredDate = parsePreferredDate(quote.client_preferred_date);
                if (preferredDate) {
                    const event = {
                        id: quote.id.toString(),
                        title: `(Sin sesiones) ${quote.client_full_name || 'Sin nombre'}`,
                        start: formatDateForCalendar(preferredDate),
                        allDay: true,
                        backgroundColor: '#F5C518',
                        borderColor: '#F5C518',
                        textColor: '#1A1A1A',
                        extendedProps: {
                            quoteId: quote.id,
                            status: quote.quote_status,
                            priority: quote.priority || 'medium',
                            budget: quote.final_budget_amount || quote.client_budget_amount,
                            currency: quote.final_budget_currency || quote.client_budget_currency,
                            tattooIdea: quote.tattoo_idea_description,
                            needsSession: true
                        },
                        classNames: [
                            'status-completed',
                            'needs-session',
                            `priority-${quote.priority || 'medium'}`
                        ]
                    };
                    events.push(event);
                }
            }
        } else {
            // For non-completed quotes, show preferred date
            const preferredDate = parsePreferredDate(quote.client_preferred_date);
            
            // Only add quotes with valid dates to the calendar
            if (preferredDate) {
                const event = {
                    id: quote.id.toString(),
                    title: quote.client_full_name || 'Sin nombre',
                    start: formatDateForCalendar(preferredDate),
                    allDay: true,
                    extendedProps: {
                        quoteId: quote.id,
                        status: quote.quote_status,
                        priority: quote.priority || 'medium',
                        budget: quote.client_budget_amount,
                        currency: quote.client_budget_currency,
                        tattooIdea: quote.tattoo_idea_description,
                        isSession: false
                    },
                    classNames: [
                        `status-${quote.quote_status}`,
                        `priority-${quote.priority || 'medium'}`
                    ]
                };
                
                events.push(event);
            }
        }
    });
    
    return events;
}

// ============================================
// STATUS FILTER
// ============================================

/**
 * Filter calendar events by status
 */
window.filterByStatus = function(status) {
    currentStatusFilter = status;
    
    // Update button states
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.status === status) {
            btn.classList.add('active');
        }
    });
    
    // Refresh calendar with filtered events
    refreshCalendar();
    
    // Update stats to reflect filtered view
    updateFilteredStats();
};

/**
 * Update stats based on current filter
 */
function updateFilteredStats() {
    let filteredQuotes = quotations;
    
    if (currentStatusFilter !== 'all') {
        filteredQuotes = quotations.filter(q => q.quote_status === currentStatusFilter);
    }
    
    const pending = filteredQuotes.filter(q => q.quote_status === 'pending').length;
    const responded = filteredQuotes.filter(q => q.quote_status === 'responded').length;
    const completed = filteredQuotes.filter(q => q.quote_status === 'completed').length;
    
    document.getElementById('stat-pending').textContent = pending;
    document.getElementById('stat-responded').textContent = responded;
    document.getElementById('stat-completed').textContent = completed;
}

// ============================================
// DATE NAVIGATION
// ============================================

/**
 * Populate year selector with dynamic range
 */
function populateDateSelectors() {
    const yearSelect = document.getElementById('year-select');
    const currentYear = new Date().getFullYear();
    
    // Clear existing options
    yearSelect.innerHTML = '';
    
    // Add years: 2 years back to 3 years forward
    for (let year = currentYear - 2; year <= currentYear + 3; year++) {
        const option = document.createElement('option');
        option.value = year;
        option.textContent = year;
        if (year === currentYear) {
            option.selected = true;
        }
        yearSelect.appendChild(option);
    }
    
    // Set month selector to current month
    const monthSelect = document.getElementById('month-select');
    const currentMonth = new Date().getMonth();
    monthSelect.value = currentMonth;
}

/**
 * Navigate calendar to selected month/year
 */
window.goToSelectedDate = function() {
    const monthSelect = document.getElementById('month-select');
    const yearSelect = document.getElementById('year-select');
    
    const month = parseInt(monthSelect.value);
    const year = parseInt(yearSelect.value);
    
    // Create date for first day of selected month
    const targetDate = new Date(year, month, 1);
    
    if (calendar) {
        calendar.gotoDate(targetDate);
    }
};

/**
 * Sync date selectors with calendar's current view
 */
function syncDateSelectors(date) {
    const monthSelect = document.getElementById('month-select');
    const yearSelect = document.getElementById('year-select');
    
    if (monthSelect && yearSelect) {
        monthSelect.value = date.getMonth();
        
        // Check if year exists in options, if not add it
        const yearValue = date.getFullYear().toString();
        let yearExists = false;
        for (const option of yearSelect.options) {
            if (option.value === yearValue) {
                yearExists = true;
                break;
            }
        }
        
        if (!yearExists) {
            const option = document.createElement('option');
            option.value = yearValue;
            option.textContent = yearValue;
            yearSelect.appendChild(option);
            // Sort options
            const options = Array.from(yearSelect.options);
            options.sort((a, b) => parseInt(a.value) - parseInt(b.value));
            yearSelect.innerHTML = '';
            options.forEach(opt => yearSelect.appendChild(opt));
        }
        
        yearSelect.value = yearValue;
    }
}

// ============================================
// FULLCALENDAR INITIALIZATION
// ============================================

function initFullCalendar() {
    const calendarEl = document.getElementById('calendar');
    
    // Populate date selectors first
    populateDateSelectors();
    
    calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: 'dayGridMonth',
        locale: 'es',
        firstDay: 1, // Monday
        headerToolbar: {
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,dayGridWeek'
        },
        buttonText: {
            today: 'Hoy',
            month: 'Mes',
            week: 'Semana'
        },
        events: getCalendarEvents(),
        eventClick: function(info) {
            const quoteId = info.event.extendedProps.quoteId;
            if (quoteId) {
                inspectQuote(quoteId);
            }
        },
        eventDidMount: function(info) {
            // Add tooltip with more info
            const props = info.event.extendedProps;
            let tooltipContent = info.event.title;
            if (props.budget) {
                tooltipContent += ` | ${props.budget} ${props.currency || ''}`;
            }
            if (props.tattooIdea) {
                const shortIdea = props.tattooIdea.length > 50 
                    ? props.tattooIdea.substring(0, 50) + '...' 
                    : props.tattooIdea;
                tooltipContent += ` | ${shortIdea}`;
            }
            info.el.setAttribute('title', tooltipContent);
        },
        datesSet: function(dateInfo) {
            // Sync date selectors when calendar view changes
            // Use the start of the visible range to determine current month
            const viewStart = dateInfo.view.currentStart;
            syncDateSelectors(viewStart);
        },
        dayCellDidMount: function(info) {
            // Add Bauhaus style touch to cells
            info.el.style.transition = 'background 0.2s ease';
        },
        height: 'auto',
        fixedWeekCount: false,
        showNonCurrentDates: true,
        dayMaxEvents: 3, // Show "more" link when there are too many events
        moreLinkClick: 'popover'
    });
    
    calendar.render();
}

/**
 * Refresh calendar events (call after data changes)
 */
function refreshCalendar() {
    if (calendar) {
        calendar.removeAllEvents();
        calendar.addEventSource(getCalendarEvents());
    }
}

// ============================================
// ARCHIVE ACTIONS (Used by shared-drawer.js)
// ============================================

window.bulkArchiveSingle = async function(id) {
    try {
        const { error } = await _supabase.from('quotations_db').update({ is_archived: true }).eq('id', id);
        if (error) throw error;
        document.getElementById('drawer-toggle').checked = false;
        await loadQuotations();
        refreshCalendar();
    } catch (err) { 
        alert('Error archiving: ' + err.message); 
    }
};

// Override to refresh calendar after status changes
const originalUpdateQuoteStatus = window.updateQuoteStatus;
window.updateQuoteStatus = async function(quoteId, newStatus) {
    try {
        const { error } = await _supabase.from('quotations_db').update({ quote_status: newStatus }).eq('id', quoteId);
        if (error) throw error;
        const quote = quotations.find(q => q.id.toString() === quoteId.toString());
        if (quote) quote.quote_status = newStatus;
        updateStats();
        refreshCalendar();
        inspectQuote(quoteId);
    } catch (err) { 
        console.error('Error updating status:', err); 
    }
};

// ============================================
// CALENDAR EXPORT & SYNC (NEW)
// ============================================

/**
 * Export scheduled sessions to .ICS format
 * Uses quotation_sessions data for actual scheduled appointments
 */
window.exportCalendarToICS = function() {
    // Get all scheduled sessions (not cancelled)
    const scheduledSessions = allSessions.filter(s => s.status !== 'cancelled');
    
    if (scheduledSessions.length === 0) {
        alert('No tienes sesiones programadas para exportar.');
        return;
    }
    
    let icsContent = 
`BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//WeOtzi//Calendar Export//ES
CALSCALE:GREGORIAN
METHOD:PUBLISH
`;

    scheduledSessions.forEach(session => {
        const quote = quotations.find(q => q.id === session.quotation_id);
        if (!quote) return;
        
        const sessionDate = new Date(session.session_date);
        
        // Format datetime as YYYYMMDDTHHMMSS
        const dateStr = sessionDate.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
        const uid = `weotzi-session-${session.id}@weotzi.com`;
        const created = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
        
        let description = `Cliente: ${quote.client_full_name || 'N/A'}\\n`;
        description += `Sesion: #${session.session_number || '1'}\\n`;
        description += `Budget: ${quote.final_budget_amount || quote.client_budget_amount} ${quote.final_budget_currency || quote.client_budget_currency || ''}\\n`;
        description += `Idea: ${quote.tattoo_idea_description || 'N/A'}`;
        if (session.notes) {
            description += `\\nNotas: ${session.notes}`;
        }
        
        // Clean description for ICS (escape newlines, commas, semicolons)
        description = description.replace(/(\r\n|\n|\r)/gm, '\\n');
        description = description.replace(/,/g, '\\,');
        description = description.replace(/;/g, '\\;');
        
        // Calculate end time (add duration if available, otherwise default 2 hours)
        const durationHours = session.duration_hours || 2;
        const endDate = new Date(sessionDate.getTime() + (durationHours * 60 * 60 * 1000));
        const endStr = endDate.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
        
        const statusMap = {
            'scheduled': 'CONFIRMED',
            'completed': 'CONFIRMED',
            'no_show': 'CANCELLED',
            'rescheduled': 'TENTATIVE',
            'cancelled': 'CANCELLED'
        };
        
        icsContent += 
`BEGIN:VEVENT
UID:${uid}
DTSTAMP:${created}
DTSTART:${dateStr}
DTEND:${endStr}
SUMMARY:Sesion #${session.session_number || '1'} - ${quote.client_full_name || 'Cliente'}
DESCRIPTION:${description}
STATUS:${statusMap[session.status] || 'CONFIRMED'}
END:VEVENT
`;
    });

    icsContent += 'END:VCALENDAR';
    
    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    saveAs(blob, 'weotzi-tattoo-sessions.ics');
};

/**
 * Google API Loading Helpers
 */
function gapiLoaded() {
    gapi.load('client', initializeGapiClient);
}

async function initializeGapiClient() {
    const apiKey = getGoogleApiKey();
    // If not configured, don't try to init
    if (!apiKey || apiKey.length === 0) {
        console.log('Google API Key not configured. Sync disabled.');
        return;
    }

    try {
        await gapi.client.init({
            apiKey: apiKey,
            discoveryDocs: DISCOVERY_DOCS,
        });
        gapiInited = true;
    } catch (err) {
        console.error('Error initializing GAPI client:', err);
    }
}

function gisLoaded() {
    const clientId = getGoogleClientId();
    // If not configured, don't try to init
    if (!clientId || clientId.length === 0) {
        console.log('Google Client ID not configured. Sync disabled.');
        return;
    }

    try {
        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: clientId,
            scope: SCOPES,
            callback: '', // defined later
        });
        gisInited = true;
    } catch (err) {
        console.error('Error initializing GIS client:', err);
    }
}

/**
 * Check if Google Calendar is properly configured
 */
function isGoogleCalendarConfigured() {
    const clientId = getGoogleClientId();
    const apiKey = getGoogleApiKey();
    return clientId && clientId.length > 0 && 
           apiKey && apiKey.length > 0 &&
           !clientId.includes('YOUR_');
}

/**
 * Trigger Google Sync
 */
window.syncWithGoogleCalendar = function() {
    // Lazy init check in case scripts loaded after DOMContentLoaded
    if (!gapiInited && typeof gapi !== 'undefined') { gapiLoaded(); }
    if (!gisInited && typeof google !== 'undefined') { gisLoaded(); }

    if (!isGoogleCalendarConfigured()) {
        alert('Google Sync no esta configurado.\n\nPara habilitarlo, el administrador debe configurar las credenciales de Google Calendar en el panel de SuperAdmin (seccion APIs).\n\nPor ahora, utiliza la opcion "Exportar .ICS".');
        return;
    }

    if (!gapiInited || !gisInited) {
        alert('Error: Los servicios de Google no se han inicializado correctamente. Verifica tu conexion o la configuracion en el panel de SuperAdmin.');
        return;
    }

    tokenClient.callback = async (resp) => {
        if (resp.error) {
            throw resp;
        }
        await listUpcomingEvents();
    };

    if (gapi.client.getToken() === null) {
        // Prompt the user to select a Google Account and ask for consent to share their data
        // when establishing a new session.
        tokenClient.requestAccessToken({prompt: 'consent'});
    } else {
        // Skip display of account chooser and consent dialog for an existing session.
        tokenClient.requestAccessToken({prompt: ''});
    }
};

/**
 * Actual Sync Logic - Syncs scheduled sessions to Google Calendar
 * Uses quotation_sessions data for actual appointments
 */
async function listUpcomingEvents() {
    try {
        // Get sessions that should be synced (scheduled, not already synced)
        const sessionsToSync = allSessions.filter(s => 
            s.status === 'scheduled' && !s.google_event_id
        );
        
        if (sessionsToSync.length === 0) {
            alert('No hay sesiones nuevas para sincronizar.\nTodas las sesiones ya estan sincronizadas o no tienes sesiones agendadas.');
            return;
        }

        // Show loading indicator
        const btn = document.querySelector('button[onclick="syncWithGoogleCalendar()"]');
        const originalText = btn ? btn.textContent : '';
        if (btn) {
            btn.textContent = 'SYNCING...';
            btn.disabled = true;
        }

        let syncedCount = 0;
        let errorCount = 0;

        for (const session of sessionsToSync) {
            const quote = quotations.find(q => q.id === session.quotation_id);
            if (!quote) continue;

            const sessionDate = new Date(session.session_date);
            const durationHours = session.duration_hours || 2;
            const endDate = new Date(sessionDate.getTime() + (durationHours * 60 * 60 * 1000));
            
            let description = `Cliente: ${quote.client_full_name || 'N/A'}\n`;
            description += `Sesion: #${session.session_number || '1'}\n`;
            description += `Budget: ${quote.final_budget_amount || quote.client_budget_amount} ${quote.final_budget_currency || quote.client_budget_currency || ''}\n`;
            description += `Idea: ${quote.tattoo_idea_description || 'N/A'}`;
            if (session.notes) {
                description += `\nNotas: ${session.notes}`;
            }
            
            const event = {
                'summary': `Sesion #${session.session_number || '1'} - ${quote.client_full_name || 'Cliente'}`,
                'description': description,
                'start': {
                    'dateTime': sessionDate.toISOString(),
                    'timeZone': Intl.DateTimeFormat().resolvedOptions().timeZone
                },
                'end': {
                    'dateTime': endDate.toISOString(),
                    'timeZone': Intl.DateTimeFormat().resolvedOptions().timeZone
                },
                'colorId': '9' // Bold blue color for tattoo sessions
            };

            try {
                const response = await gapi.client.calendar.events.insert({
                    'calendarId': 'primary',
                    'resource': event
                });
                
                // Save Google event ID back to our database for future updates
                if (response.result && response.result.id) {
                    await _supabase
                        .from('quotation_sessions')
                        .update({ google_event_id: response.result.id })
                        .eq('id', session.id);
                    
                    // Update local state
                    session.google_event_id = response.result.id;
                }
                
                syncedCount++;
            } catch (err) {
                console.error('Error syncing session:', session.id, err);
                errorCount++;
            }
        }

        let message = `Sincronizacion completada!\n`;
        message += `Sesiones sincronizadas: ${syncedCount}`;
        if (errorCount > 0) {
            message += `\nErrores: ${errorCount}`;
        }
        alert(message);
        
        if (btn) {
            btn.textContent = originalText;
            btn.disabled = false;
        }

    } catch (err) {
        console.error('Error during sync:', err);
        alert('Error durante la sincronizacion: ' + err.message);
        
        const btn = document.querySelector('button[onclick="syncWithGoogleCalendar()"]');
        if (btn) {
            btn.textContent = 'SYNC';
            btn.disabled = false;
        }
    }
}
