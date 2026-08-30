// ============================================
// WE OTZI · Estadísticas del artista (/my-quotations/statistics)
// Fidelidad Figma: flujo-artistas--11-estadisticas
//   KPIs · Embudo · Evolución · Rendimiento · Actividad · Visitantes · Oportunidades
// Fuentes reales: quotations_db + artist_profile_visits estructurado +
// artist_artwork_view_counts. Los eventos distinguen perfil, portfolio y obra.
// ============================================

let quotations = [];
let profileVisits = [];
let artworkCounts = [];
let charts = {};
let _supabase = null;
let currentArtistId = null;

let evolutionRange = 'year';
let evolutionMetric = 'visits';
let visitorFilter = 'all';

const MONTH_NAMES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const MONTH_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const DAY_SHORT = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

const CONFIRMED_STATUSES = ['client_approved', 'in_progress', 'artist_completed', 'completed'];
const ANSWERED_STATUSES = ['responded', 'client_approved', 'in_progress', 'artist_completed', 'completed', 'client_rejected'];

const DAY_MS = 24 * 60 * 60 * 1000;
const VISITS_WINDOW_DAYS = 365;
const VISITS_MAX_ROWS = 5000;

// Lee un token del DS (Chart.js necesita valores concretos, no var()).
function woToken(name, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
}

function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function formatCount(value) {
    return Number(value || 0).toLocaleString('es-AR');
}

document.addEventListener('DOMContentLoaded', async () => {
    renderEyebrow();
    setupControls();
    await initializeSupabase();
    await loadStatisticsData();
});

function renderEyebrow() {
    const now = new Date();
    setText('stats-eyebrow', `Estadísticas · ${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`);
}

async function initializeSupabase() {
    if (window.ConfigManager && window.ConfigManager.getSupabaseClient) {
        _supabase = window.ConfigManager.getSupabaseClient();
    }

    if (!_supabase && window.supabase) {
        const supabaseUrl = window.CONFIG?.supabase?.url || 'https://flbgmlvfiejfttlawnfu.supabase.co';
        const supabaseKey = window.CONFIG?.supabase?.anonKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsYmdtbHZmaWVqZnR0bGF3bmZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU5MTI1ODksImV4cCI6MjA2MTQ4ODU4OX0.AQm4HM8Gjci08p1vfxu6-6MbT_PRceZm5qQbwxA3888';
        _supabase = window._supabase = window._supabase || window.supabase.createClient(supabaseUrl, supabaseKey);
    }

    if (!_supabase) {
        console.error('Supabase client could not be initialized');
    }
}

window.handleStatsLogout = async function () {
    try {
        if (_supabase) await _supabase.auth.signOut();
    } catch (err) {
        console.error('Logout error:', err);
    }
    window.location.href = '/registerclosedbeta';
};

async function loadStatisticsData() {
    try {
        if (!_supabase) return;

        const { data: { session }, error: authError } = await _supabase.auth.getSession();

        if (authError || !session) {
            console.log('No authenticated session. Redirecting...');
            window.location.href = '/artist/dashboard';
            return;
        }

        currentArtistId = session.user.id;

        const [allQuotes, visits, works] = await Promise.all([
            WeotziData.Quotations.listForArtist(currentArtistId, {
                excludeArchived: false,
                excludeInProgress: false
            }),
            loadProfileVisits(currentArtistId),
            loadArtworkCounts(currentArtistId)
        ]);

        quotations = allQuotes || [];
        profileVisits = visits;
        artworkCounts = works;

        renderKpis();
        renderFunnel();
        renderEvolution();
        renderStylesList();
        renderWorksList();
        renderCitiesList();
        renderHoursList();
        renderClientsSplit();
        renderActivity();
        renderVisitors();
        renderInsights();

    } catch (error) {
        console.error('Error loading statistics:', error);
    }
}

async function loadArtworkCounts(artistId) {
    try {
        const { data, error } = await WeotziData.ArtistVisits.listArtworkCounts(artistId, 20);
        if (error) throw error;
        return data || [];
    } catch (err) {
        console.warn('No se pudieron leer las vistas por trabajo:', err);
        return [];
    }
}

// Visitas reales al perfil público (artist_profile_visits, RLS: solo las propias).
// Si la tabla no responde, el módulo sigue con 0 visitas en lugar de romper.
async function loadProfileVisits(artistId) {
    try {
        const since = new Date(Date.now() - VISITS_WINDOW_DAYS * DAY_MS).toISOString();
        const { data, error } = await WeotziData.ArtistVisits.listVisitsByArtistSince(artistId, since, VISITS_MAX_ROWS);
        if (error) throw error;
        return data || [];
    } catch (err) {
        console.warn('No se pudieron leer las visitas al perfil:', err);
        return [];
    }
}

// ============================================
// HELPERS DE PERÍODO
// ============================================

function countInWindow(items, dateField, fromDate, toDate) {
    return items.filter((item) => {
        const value = new Date(item[dateField]);
        return !isNaN(value.getTime()) && value >= fromDate && value < toDate;
    }).length;
}

function deltaPercent(current, previous) {
    if (!previous) return current > 0 ? 100 : null;
    return Math.round(((current - previous) / previous) * 100);
}

function renderTrend(id, current, previous) {
    const el = document.getElementById(id);
    if (!el) return;
    const delta = deltaPercent(current, previous);
    if (delta === null) {
        el.textContent = '';
        el.className = 'kpi-trend';
        return;
    }
    const up = delta >= 0;
    el.textContent = `${up ? '+' : ''}${delta}%`;
    el.className = `kpi-trend ${up ? 'trend-up' : 'trend-down'}`;
}

// ============================================
// MONEDA
// ============================================

function displayCurrencyPreference() {
    if (window.WeOtziCurrency && typeof window.WeOtziCurrency.getDisplayPreference === 'function') {
        return window.WeOtziCurrency.getDisplayPreference();
    }
    return 'local';
}

// Convierte todos los importes a una sola moneda para poder sumarlos.
function aggregateAmount(entries) {
    const usable = entries.filter((e) => e && isFinite(parseFloat(e.amount)) && parseFloat(e.amount) > 0);
    if (!usable.length) return { total: 0, currency: resolveTargetCurrency(usable) };

    const target = resolveTargetCurrency(usable);
    const canConvert = window.WeOtziCurrency && typeof window.WeOtziCurrency.convert === 'function';
    let total = 0;
    usable.forEach((e) => {
        const amount = parseFloat(e.amount);
        const code = (e.currency || 'USD').toUpperCase();
        if (code === target) { total += amount; return; }
        if (!canConvert) return;
        const converted = window.WeOtziCurrency.convert(amount, code, target);
        if (converted != null) total += converted;
    });
    return { total, currency: target };
}

function resolveTargetCurrency(entries) {
    const pref = displayCurrencyPreference();
    if (pref !== 'local') return pref;
    const tally = {};
    entries.forEach((e) => {
        const code = ((e && e.currency) || 'USD').toUpperCase();
        tally[code] = (tally[code] || 0) + 1;
    });
    return Object.keys(tally).sort((a, b) => tally[b] - tally[a])[0] || 'USD';
}

function formatMoney(total, currency) {
    if (window.WeOtziCurrency && typeof window.WeOtziCurrency.format === 'function') {
        return window.WeOtziCurrency.format(total, currency, { decimals: 0 });
    }
    return `${currency} ${Math.round(total).toLocaleString('es-AR')}`;
}

function revenueEntries(quotes) {
    return quotes
        .filter(q => q.quote_status === 'completed')
        .map(q => ({ amount: q.final_budget_amount, currency: q.final_budget_currency || 'USD' }));
}

// ============================================
// 1 · KPIs
// ============================================

function renderKpis() {
    const now = new Date();
    const windowStart = new Date(now.getTime() - 30 * DAY_MS);
    const previousStart = new Date(now.getTime() - 60 * DAY_MS);

    const inWindow = (items, field) => items.filter((i) => {
        const d = new Date(i[field]);
        return !isNaN(d.getTime()) && d >= windowStart;
    });
    const inPrevious = (items, field) => items.filter((i) => {
        const d = new Date(i[field]);
        return !isNaN(d.getTime()) && d >= previousStart && d < windowStart;
    });

    const profileEvents = profileVisits.filter(v => (v.event_kind || 'profile_view') === 'profile_view');
    const portfolioEvents = profileVisits.filter(v => v.event_kind === 'portfolio_view');
    const viewsNow = inWindow(profileEvents, 'created_at').length;
    const viewsPrev = inPrevious(profileEvents, 'created_at').length;
    const portfolioNow = inWindow(portfolioEvents, 'created_at').length;
    const portfolioPrev = inPrevious(portfolioEvents, 'created_at').length;
    setText('kpi-profile-views', formatCount(viewsNow));
    renderTrend('kpi-profile-views-trend', viewsNow, viewsPrev);
    setText('kpi-portfolio', formatCount(portfolioNow));
    renderTrend('kpi-portfolio-trend', portfolioNow, portfolioPrev);

    // Solicitudes recibidas
    const requestsNow = inWindow(quotations, 'created_at').length;
    const requestsPrev = inPrevious(quotations, 'created_at').length;
    setText('kpi-requests', formatCount(requestsNow));
    renderTrend('kpi-requests-trend', requestsNow, requestsPrev);

    // Cotizaciones enviadas (respondidas por vos)
    const answered = quotations.filter(q => ANSWERED_STATUSES.includes(q.quote_status));
    const answeredNow = inWindow(answered, 'created_at').length;
    const answeredPrev = inPrevious(answered, 'created_at').length;
    setText('kpi-answered', formatCount(answeredNow));
    renderTrend('kpi-answered-trend', answeredNow, answeredPrev);

    // Reservas confirmadas
    const bookings = quotations.filter(q => CONFIRMED_STATUSES.includes(q.quote_status));
    const bookingsNow = inWindow(bookings, 'created_at').length;
    const bookingsPrev = inPrevious(bookings, 'created_at').length;
    setText('kpi-bookings', formatCount(bookingsNow));
    renderTrend('kpi-bookings-trend', bookingsNow, bookingsPrev);

    // Ingresos generados (histórico completo, como el resto del producto)
    const revenue = aggregateAmount(revenueEntries(quotations));
    const revenueNow = aggregateAmount(revenueEntries(inWindow(quotations, 'created_at')));
    const revenuePrev = aggregateAmount(revenueEntries(inPrevious(quotations, 'created_at')));
    setText('kpi-revenue', formatMoney(revenue.total, revenue.currency));
    renderTrend('kpi-revenue-trend', revenueNow.total, revenuePrev.total);
}

// ============================================
// 2 · Embudo de conversión
// ============================================

function renderFunnel() {
    const container = document.getElementById('funnel');
    if (!container) return;

    const steps = [
        { label: 'Visualización', value: profileVisits.filter(v => (v.event_kind || 'profile_view') === 'profile_view').length, tone: 'ink' },
        { label: 'Portfolio', value: profileVisits.filter(v => v.event_kind === 'portfolio_view').length, tone: 'paper' },
        { label: 'Solicitud', value: quotations.length, tone: 'paper' },
        { label: 'Cotización', value: quotations.filter(q => ANSWERED_STATUSES.includes(q.quote_status)).length, tone: 'paper' },
        { label: 'Reserva', value: quotations.filter(q => CONFIRMED_STATUSES.includes(q.quote_status)).length, tone: 'paper' },
        { label: 'Trabajo realizado', value: quotations.filter(q => q.quote_status === 'completed').length, tone: 'done' }
    ];

    container.innerHTML = steps.map((step, index) => {
        const next = steps[index + 1];
        const rate = next && step.value > 0 ? Math.round((next.value / step.value) * 100) : null;
        return `
            <div class="funnel-step">
                <div class="funnel-tile funnel-tile--${step.tone}">
                    <span class="funnel-label">${escapeHtml(step.label)}</span>
                    <span class="funnel-value">${formatCount(step.value)}</span>
                </div>
                ${next ? `<div class="funnel-gap"><i data-wo-icon="chevron-right" aria-hidden="true"></i><span class="funnel-rate">${rate === null ? '—' : rate + '%'}</span></div>` : ''}
            </div>`;
    }).join('');
}

// ============================================
// 3 · Evolución
// ============================================

function setupControls() {
    document.querySelectorAll('#evolution-range .stats-tab').forEach((tab) => {
        tab.addEventListener('click', () => {
            evolutionRange = tab.dataset.range;
            document.querySelectorAll('#evolution-range .stats-tab').forEach((t) => {
                const active = t === tab;
                t.classList.toggle('is-active', active);
                t.setAttribute('aria-selected', String(active));
            });
            renderEvolution();
        });
    });

    document.querySelectorAll('#evolution-metrics .q-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
            evolutionMetric = chip.dataset.metric;
            document.querySelectorAll('#evolution-metrics .q-chip').forEach((c) => {
                const active = c === chip;
                c.classList.toggle('is-active', active);
                c.setAttribute('aria-pressed', String(active));
            });
            renderEvolution();
        });
    });

    const exportBtn = document.getElementById('export-report-btn');
    if (exportBtn) exportBtn.addEventListener('click', exportReportCsv);

    document.querySelectorAll('[data-visitor-filter]').forEach((button) => {
        button.addEventListener('click', () => {
            visitorFilter = button.dataset.visitorFilter || 'all';
            document.querySelectorAll('[data-visitor-filter]').forEach((item) => {
                const active = item === button;
                item.classList.toggle('is-active', active);
                item.setAttribute('aria-pressed', String(active));
            });
            renderVisitors();
        });
    });
}

// Devuelve [{ start, end, label }] según el rango elegido.
function evolutionBuckets() {
    const buckets = [];
    const now = new Date();

    if (evolutionRange === 'week') {
        const start = new Date(now);
        start.setHours(0, 0, 0, 0);
        start.setDate(start.getDate() - 6);
        for (let i = 0; i < 7; i++) {
            const from = new Date(start.getTime() + i * DAY_MS);
            const to = new Date(from.getTime() + DAY_MS);
            buckets.push({ start: from, end: to, label: DAY_SHORT[(from.getDay() + 6) % 7] });
        }
        return buckets;
    }

    if (evolutionRange === 'month') {
        const start = new Date(now);
        start.setHours(0, 0, 0, 0);
        start.setDate(start.getDate() - 27);
        for (let i = 0; i < 4; i++) {
            const from = new Date(start.getTime() + i * 7 * DAY_MS);
            const to = new Date(from.getTime() + 7 * DAY_MS);
            buckets.push({
                start: from,
                end: to,
                label: `${String(from.getDate()).padStart(2, '0')} ${MONTH_SHORT[from.getMonth()]}`
            });
        }
        return buckets;
    }

    // year: los últimos 6 meses (como el eje FEB…JUL del Figma)
    for (let i = 5; i >= 0; i--) {
        const from = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const to = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
        buckets.push({ start: from, end: to, label: MONTH_SHORT[from.getMonth()] });
    }
    return buckets;
}

const EVOLUTION_METRICS = {
    visits: {
        label: 'Visualizaciones',
        value: (from, to) => countInWindow(
            profileVisits.filter(v => (v.event_kind || 'profile_view') === 'profile_view'),
            'created_at', from, to
        ),
        format: formatCount
    },
    requests: {
        label: 'Solicitudes recibidas',
        value: (from, to) => countInWindow(quotations, 'created_at', from, to),
        format: formatCount
    },
    bookings: {
        label: 'Reservas confirmadas',
        value: (from, to) => countInWindow(
            quotations.filter(q => CONFIRMED_STATUSES.includes(q.quote_status)), 'created_at', from, to
        ),
        format: formatCount
    },
    revenue: {
        label: 'Ingresos',
        value: (from, to) => {
            const inRange = quotations.filter((q) => {
                const d = new Date(q.created_at);
                return !isNaN(d.getTime()) && d >= from && d < to;
            });
            return Math.round(aggregateAmount(revenueEntries(inRange)).total);
        },
        format: (value) => formatMoney(value, resolveTargetCurrency(revenueEntries(quotations)))
    }
};

function renderEvolution() {
    const metric = EVOLUTION_METRICS[evolutionMetric] || EVOLUTION_METRICS.visits;
    const buckets = evolutionBuckets();
    const series = buckets.map(b => metric.value(b.start, b.end));
    const total = series.reduce((sum, n) => sum + n, 0);

    setText('evolution-value', metric.format(total));
    setText('evolution-label', metric.label);

    const deltaEl = document.getElementById('evolution-delta');
    if (deltaEl) {
        const first = series[0];
        const last = series[series.length - 1];
        const delta = deltaPercent(last, first);
        if (delta === null || series.length < 2) {
            deltaEl.textContent = '';
            deltaEl.className = 'evolution-delta';
        } else {
            deltaEl.textContent = `${delta >= 0 ? '▲' : '▼'} ${delta >= 0 ? '+' : ''}${delta}% vs. inicio del período`;
            deltaEl.className = `evolution-delta ${delta >= 0 ? 'is-up' : 'is-down'}`;
        }
    }

    const canvas = document.getElementById('evolutionChart');
    if (!canvas || typeof Chart === 'undefined') return;

    if (charts.evolution) charts.evolution.destroy();
    charts.evolution = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels: buckets.map(b => b.label),
            datasets: [{
                label: metric.label,
                data: series,
                borderColor: woToken('--surface-ink', '#001125'),
                backgroundColor: 'transparent',
                borderWidth: 2,
                tension: 0,
                fill: false,
                pointBackgroundColor: woToken('--white', '#FCFCFC'),
                pointBorderColor: woToken('--surface-ink', '#001125'),
                pointBorderWidth: 2,
                pointRadius: 5,
                pointStyle: 'rect'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: { label: (ctx) => metric.format(ctx.raw) }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    border: { display: false },
                    grid: { color: woToken('--border-subtle', '#E8E3D7') },
                    ticks: {
                        color: woToken('--text-faint', '#B9AE98'),
                        font: { family: "'JetBrains Mono', monospace", size: 11 }
                    }
                },
                x: {
                    grid: { display: false },
                    ticks: {
                        color: woToken('--text-faint', '#B9AE98'),
                        font: { family: "'JetBrains Mono', monospace", size: 11 }
                    }
                }
            }
        }
    });
}

// ============================================
// 4 · Rendimiento del perfil
// ============================================

function styleNameOf(quote) {
    const raw = quote.tattoo_style;
    if (!raw) return null;
    if (Array.isArray(raw)) return raw[0] || null;
    if (typeof raw === 'object') return raw.style_name || raw.name || null;
    if (typeof raw === 'string') {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) return parsed[0] || null;
            return parsed.style_name || parsed.name || raw;
        } catch (e) {
            return raw;
        }
    }
    return null;
}

function tally(items, keyFn) {
    const counts = {};
    items.forEach((item) => {
        const key = keyFn(item);
        if (!key) return;
        counts[key] = (counts[key] || 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

function renderBarList(containerId, rows, tone) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!rows.length) {
        container.innerHTML = '<p class="stats-empty">Todavía no hay datos suficientes.</p>';
        return;
    }

    const max = rows[0][1] || 1;
    container.innerHTML = rows.map(([label, count]) => `
        <div class="bar-row">
            <span class="bar-label">${escapeHtml(label)}</span>
            <span class="bar-track"><span class="bar-fill bar-fill--${tone}" style="width:${Math.max(4, Math.round((count / max) * 100))}%"></span></span>
            <span class="bar-count">${formatCount(count)}</span>
        </div>`).join('');
}

function renderStylesList() {
    renderBarList('styles-list', tally(quotations, styleNameOf).slice(0, 5), 'accent');
}

function renderWorksList() {
    const container = document.getElementById('works-list');
    if (!container) return;
    let rows = artworkCounts.map((row) => ({
        key: row.artwork_key,
        title: row.artwork_title || row.artwork_key || 'Trabajo sin título',
        count: Number(row.views_count) || 0
    }));
    if (!rows.length) {
        rows = tally(profileVisits.filter(v => v.event_kind === 'artwork_view'), v => v.artwork_key)
            .map(([key, count]) => {
                const hit = profileVisits.find(v => v.artwork_key === key);
                return { key, title: hit?.artwork_title || key, count };
            });
    }
    rows = rows.filter(row => row.count > 0).sort((a, b) => b.count - a.count).slice(0, 3);
    if (!rows.length) {
        container.innerHTML = '<p class="stats-empty">Las vistas aparecen cuando alguien abre un trabajo del portfolio.</p>';
        return;
    }
    const max = rows[0].count || 1;
    container.innerHTML = rows.map((row, index) => `
        <div class="ranked-work-row">
            <span class="ranked-work-index">${String(index + 1).padStart(2, '0')}</span>
            <span class="ranked-work-main">
                <span class="ranked-work-meta"><strong>${escapeHtml(row.title)}</strong><b>${formatCount(row.count)}</b></span>
                <span class="bar-track"><span class="bar-fill bar-fill--direct" style="width:${Math.max(4, Math.round((row.count / max) * 100))}%"></span></span>
            </span>
        </div>`).join('');
}

function renderCitiesList() {
    renderBarList('cities-list', tally(profileVisits, v => v.visitor_city || v.city).slice(0, 5), 'direct');
}

function renderHoursList() {
    const container = document.getElementById('hours-list');
    if (!container) return;

    if (!profileVisits.length) {
        container.innerHTML = '<p class="stats-empty">Todavía no hay visitas registradas.</p>';
        return;
    }

    // Franjas de 3 h, como el Figma (18–21 h, 12–15 h, 21–24 h)
    const bands = {};
    profileVisits.forEach((visit) => {
        const date = new Date(visit.created_at);
        if (isNaN(date.getTime())) return;
        const band = Math.floor(date.getHours() / 3) * 3;
        bands[band] = (bands[band] || 0) + 1;
    });

    const total = Object.values(bands).reduce((sum, n) => sum + n, 0);
    if (!total) {
        container.innerHTML = '<p class="stats-empty">Todavía no hay visitas registradas.</p>';
        return;
    }

    const top = Object.entries(bands)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);

    container.innerHTML = top.map(([band, count]) => {
        const from = Number(band);
        const percent = Math.round((count / total) * 100);
        return `
            <div class="rank-row">
                <span class="rank-label">${String(from).padStart(2, '0')} – ${String(from + 3).padStart(2, '0')} h</span>
                <span class="rank-value">${percent}%</span>
            </div>`;
    }).join('');
}

function clientKeyOf(quote) {
    return quote.client_user_id
        || (quote.client_email && quote.client_email.toLowerCase())
        || (quote.client_full_name && quote.client_full_name.toLowerCase())
        || null;
}

function renderClientsSplit() {
    const container = document.getElementById('clients-split');
    if (!container) return;

    const counts = {};
    quotations.forEach((quote) => {
        const key = clientKeyOf(quote);
        if (!key) return;
        counts[key] = (counts[key] || 0) + 1;
    });

    const keys = Object.keys(counts);
    if (!keys.length) {
        container.innerHTML = '<p class="stats-empty">Todavía no hay clientes registrados.</p>';
        return;
    }

    const recurring = keys.filter(k => counts[k] > 1).length;
    const fresh = keys.length - recurring;
    const pct = (n) => Math.round((n / keys.length) * 100);

    container.innerHTML = `
        <div class="split-row">
            <span class="split-mark split-mark--direct" aria-hidden="true"></span>
            <span class="split-label">Nuevos</span>
            <span class="split-value">${pct(fresh)}%</span>
        </div>
        <div class="split-row">
            <span class="split-mark split-mark--accent" aria-hidden="true"></span>
            <span class="split-label">Recurrentes</span>
            <span class="split-value">${pct(recurring)}%</span>
        </div>`;
}

function relativeStatsTime(value) {
    const date = new Date(value);
    if (isNaN(date.getTime())) return '—';
    const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
    if (minutes < 1) return 'Ahora';
    if (minutes < 60) return `Hace ${minutes} min`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `Hace ${hours} h`;
    const days = Math.round(hours / 24);
    return days === 1 ? 'Ayer' : `Hace ${days} días`;
}

function renderActivity() {
    const container = document.getElementById('stats-activity');
    if (!container) return;
    const visitItems = profileVisits.slice(0, 25).map((visit) => {
        const who = visit.visitor_display_name || 'Una persona';
        const kind = visit.event_kind || 'profile_view';
        const action = kind === 'artwork_view'
            ? `vio ${visit.artwork_title || 'un trabajo'}`
            : (kind === 'portfolio_view' ? 'visitó tu portfolio' : 'visitó tu perfil');
        return { ts: visit.created_at, icon: kind === 'artwork_view' ? 'image' : 'eye', text: `${who} ${action}` };
    });
    const quoteItems = quotations.slice(0, 25).map((quote) => ({
        ts: quote.updated_at || quote.created_at,
        icon: quote.quote_status === 'completed' ? 'check-circle' : 'inbox',
        text: quote.quote_status === 'completed'
            ? `Trabajo completado · ${quote.client_full_name || quote.quote_id}`
            : `Cotización ${quote.quote_id || ''} · ${quote.client_full_name || 'Cliente'}`
    }));
    const items = visitItems.concat(quoteItems)
        .filter(item => !isNaN(new Date(item.ts).getTime()))
        .sort((a, b) => new Date(b.ts) - new Date(a.ts))
        .slice(0, 8);
    container.innerHTML = items.length ? items.map(item => `
        <div class="stats-activity-row">
            <i data-wo-icon="${escapeHtml(item.icon)}" aria-hidden="true"></i>
            <span>${escapeHtml(item.text)}</span>
            <time datetime="${escapeHtml(item.ts)}">${escapeHtml(relativeStatsTime(item.ts))}</time>
        </div>`).join('') : '<p class="stats-empty">Todavía no hay actividad reciente.</p>';
}

function aggregateVisitors() {
    const map = new Map();
    profileVisits.forEach((visit) => {
        if (!visit.visitor_display_name || !visit.visitor_type) return;
        const key = visit.visitor_user_id || `${visit.visitor_type}:${visit.visitor_display_name}`;
        const current = map.get(key) || {
            key,
            name: visit.visitor_display_name,
            type: visit.visitor_type,
            city: visit.visitor_city || visit.city || '—',
            interests: [],
            last: visit.created_at,
            count: 0,
            requested: false
        };
        current.count += 1;
        current.requested = current.requested || Boolean(visit.requested_quote);
        if (new Date(visit.created_at) > new Date(current.last)) current.last = visit.created_at;
        (Array.isArray(visit.visitor_interests) ? visit.visitor_interests : []).forEach((interest) => {
            if (interest && !current.interests.includes(interest)) current.interests.push(interest);
        });
        map.set(key, current);
    });
    return Array.from(map.values()).sort((a, b) => new Date(b.last) - new Date(a.last));
}

function renderVisitors() {
    const body = document.getElementById('stats-visitors-body');
    if (!body) return;
    let rows = aggregateVisitors();
    if (visitorFilter === 'client' || visitorFilter === 'studio') rows = rows.filter(row => row.type === visitorFilter);
    if (visitorFilter === 'requested') rows = rows.filter(row => row.requested);
    if (!rows.length) {
        body.innerHTML = '<tr><td colspan="7" class="stats-empty">No hay visitantes identificados para este filtro.</td></tr>';
        return;
    }
    const typeLabel = { client: 'Cliente', studio: 'Estudio', artist: 'Artista' };
    body.innerHTML = rows.slice(0, 30).map((row) => `
        <tr>
            <td data-label="Visitante"><strong>${escapeHtml(row.name)}</strong></td>
            <td data-label="Tipo"><span class="stats-visitor-type">${escapeHtml(typeLabel[row.type] || row.type)}</span></td>
            <td data-label="Ciudad">${escapeHtml(row.city)}</td>
            <td data-label="Intereses">${row.interests.length ? row.interests.slice(0, 3).map(i => `<span class="stats-interest">${escapeHtml(i)}</span>`).join('') : '—'}</td>
            <td data-label="Última visita">${escapeHtml(relativeStatsTime(row.last))}</td>
            <td data-label="Visitas">${formatCount(row.count)}</td>
            <td data-label="Solicitud">${row.requested ? '<span class="stats-requested">Sí</span>' : 'No'}</td>
        </tr>`).join('');
}

// ============================================
// 5 · Oportunidades (solo insights calculables)
// ============================================

function renderInsights() {
    const container = document.getElementById('insights');
    if (!container) return;

    const insights = [];
    const now = new Date();
    const windowStart = new Date(now.getTime() - 30 * DAY_MS);
    const previousStart = new Date(now.getTime() - 60 * DAY_MS);

    const profileEvents = profileVisits.filter(v => (v.event_kind || 'profile_view') === 'profile_view');
    const visitsNow = countInWindow(profileEvents, 'created_at', windowStart, now);
    const visitsPrev = countInWindow(profileEvents, 'created_at', previousStart, windowStart);
    const visitsDelta = deltaPercent(visitsNow, visitsPrev);
    if (visitsDelta !== null && visitsPrev > 0) {
        insights.push({
            icon: visitsDelta >= 0 ? 'trending-up' : 'trending-down',
            text: visitsDelta >= 0
                ? `Tu perfil recibió un ${visitsDelta}% más de visitas este mes.`
                : `Tu perfil recibió un ${Math.abs(visitsDelta)}% menos de visitas este mes.`
        });
    }

    const topStyle = tally(quotations, styleNameOf)[0];
    if (topStyle) {
        insights.push({
            icon: 'award',
            text: `${topStyle[0]} es el estilo más pedido en tus solicitudes (${topStyle[1]} de ${quotations.length}).`
        });
    }

    if (quotations.length) {
        const answered = quotations.filter(q => ANSWERED_STATUSES.includes(q.quote_status)).length;
        const rate = Math.round((answered / quotations.length) * 100);
        insights.push({
            icon: 'target',
            text: `Tus cotizaciones tienen una tasa de respuesta del ${rate}%.`
        });
    }

    const topCity = tally(profileVisits, v => v.visitor_city || v.city)[0];
    if (topCity) {
        insights.push({
            icon: 'map-pin',
            text: `${topCity[0]} es la ciudad desde donde más te visitan (${topCity[1]} visitas).`
        });
    }

    const confirmed = quotations.filter(q => CONFIRMED_STATUSES.includes(q.quote_status)).length;
    if (quotations.length) {
        const conversion = Math.round((confirmed / quotations.length) * 100);
        insights.push({
            icon: 'zap',
            text: `${conversion}% de las solicitudes que recibís terminan en una reserva confirmada.`
        });
    }

    if (!insights.length) {
        container.innerHTML = '<p class="stats-empty">Cuando empieces a recibir visitas y solicitudes vas a ver acá tus oportunidades.</p>';
        return;
    }

    container.innerHTML = insights.map(item => `
        <div class="insight-row">
            <i data-wo-icon="${escapeHtml(item.icon)}" aria-hidden="true"></i>
            <span>${escapeHtml(item.text)}</span>
        </div>`).join('');
}

// ============================================
// EXPORTAR INFORME
// ============================================

function csvCell(value) {
    return `"${String(value == null ? '' : value).replace(/"/g, '""')}"`;
}

function exportReportCsv() {
    const answered = quotations.filter(q => ANSWERED_STATUSES.includes(q.quote_status)).length;
    const bookings = quotations.filter(q => CONFIRMED_STATUSES.includes(q.quote_status)).length;
    const done = quotations.filter(q => q.quote_status === 'completed').length;
    const revenue = aggregateAmount(revenueEntries(quotations));

    const rows = [
        ['Métrica', 'Valor'],
        ['Visualizaciones del perfil (último año)', profileVisits.filter(v => (v.event_kind || 'profile_view') === 'profile_view').length],
        ['Visitas al portfolio (último año)', profileVisits.filter(v => v.event_kind === 'portfolio_view').length],
        ['Solicitudes recibidas', quotations.length],
        ['Cotizaciones enviadas', answered],
        ['Reservas confirmadas', bookings],
        ['Trabajos realizados', done],
        ['Ingresos generados', formatMoney(revenue.total, revenue.currency)]
    ];

    tally(quotations, styleNameOf).slice(0, 5).forEach(([style, count]) => {
        rows.push([`Estilo · ${style}`, count]);
    });
    tally(profileVisits, v => v.visitor_city || v.city).slice(0, 5).forEach(([city, count]) => {
        rows.push([`Ciudad · ${city}`, count]);
    });
    artworkCounts.slice(0, 5).forEach((work) => {
        rows.push([`Trabajo · ${work.artwork_title || work.artwork_key}`, work.views_count]);
    });

    const csv = '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `informe-weotzi-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
