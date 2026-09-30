const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const html = read('public', 'my-quotations', 'statistics', 'index.html');
const css = read('public', 'shared', 'css', 'statistics.css');
const js = read('public', 'shared', 'js', 'statistics.js');
const profile = read('public', 'shared', 'js', 'artist-profile.js');
const server = read('server.js');
const migration = read('supabase', 'migrations', '20260829103000_artist_profile_analytics_events.sql');

test('statistics implements the six Figma KPIs and complete lower sections', () => {
    for (const id of [
        'kpi-profile-views', 'kpi-portfolio', 'kpi-requests',
        'kpi-answered', 'kpi-bookings', 'kpi-revenue',
        'works-list', 'stats-activity', 'stats-visitors-body'
    ]) {
        assert.match(html, new RegExp(`id=["']${id}["']`));
    }
    assert.equal((html.match(/class="kpi-card/g) || []).length, 6);
    assert.match(css, /\.kpi-card\s*\{[\s\S]*?container-type:\s*inline-size[\s\S]*?min-width:\s*0/);
    assert.match(css, /\.kpi-card--money \.kpi-value\s*\{[\s\S]*?font-size:\s*clamp\(26px,\s*13\.5cqi,\s*40px\)/);
    assert.match(css, /@media\s*\(min-width:\s*1025px\)\s*and\s*\(max-width:\s*1439px\)[\s\S]*?\.kpi-row\s*\{\s*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
    assert.match(js, /event_kind === 'portfolio_view'/);
    assert.match(js, /function renderWorksList\(/);
    assert.match(js, /function renderVisitors\(/);
});

test('public profile records authenticated profile, portfolio and artwork events', () => {
    assert.match(profile, /trackProfileEvent\('profile_view'\)/);
    assert.match(profile, /trackProfileEvent\('portfolio_view'\)/);
    assert.match(profile, /trackProfileEvent\('artwork_view'/);
    assert.match(profile, /headers\.Authorization = `Bearer \$\{session\.access_token\}`/);
    assert.match(profile, /IntersectionObserver/);
    assert.match(server, /app\.post\('\/api\/artist\/profile-event', handleArtistProfileEvent\)/);
    assert.match(server, /resolveProfileVisitIdentity\(authUser\?\.id, artist\.user_id\)/);
});

test('analytics schema is owner-scoped and separates portfolio and artwork views', () => {
    assert.match(migration, /event_kind in \('profile_view', 'portfolio_view', 'artwork_view'\)/i);
    assert.match(migration, /artist_artwork_view_counts/i);
    assert.match(migration, /security_invoker\s*=\s*true/i);
    assert.match(migration, /revoke all on table public\.artist_profile_visits from anon/i);
    assert.match(migration, /grant select on table public\.artist_profile_visits to authenticated/i);
});

test('statistics visitor table becomes labeled cards on tablet and mobile', () => {
    assert.match(css, /@media \(max-width: 768px\)[\s\S]*\.stats-visitors-table td::before/);
    assert.match(css, /content: attr\(data-label\)/);
});

test('statistics desktop composition follows Figma 122:12196 section hierarchy', () => {
    assert.match(html, /class="perf-lower-grid"/);
    assert.match(html, /class="stats-dual"[\s\S]*id="activity-title"[\s\S]*id="insights-title"/);
    assert.match(html, /id="stats-visitors-count"/);
    assert.match(html, /data-visitor-filter="client"[^>]*>Clientes potenciales</);
    assert.doesNotMatch(html, /data-visitor-filter="requested"/);
    assert.doesNotMatch(html, /Solo mostramos identidad/);
    assert.doesNotMatch(html, /<thead>/);

    assert.match(css, /\.stats-dual\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1\.2fr\)\s+minmax\(0,\s*1fr\)/);
    assert.match(css, /\.stats-visitors-table tr\s*\{[\s\S]*grid-template-columns:\s*44px\s+minmax\(0,\s*1\.4fr\)\s+minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)\s+90px/);
    assert.match(css, /\.kpi-card\s*\{[\s\S]*border:\s*0/);
    assert.match(css, /\.evolution-body\s*\{[^}]*height:\s*206px/);
});

test('statistics interactions preserve the exact Figma labels and derived aggregates', () => {
    assert.match(html, />Ingresos \(miles\)</);
    assert.match(js, /let dailyVisits = \[\]/);
    assert.match(js, /listDailyVisitsByArtist/);
    assert.match(js, /function countDailyEvents\(/);
    assert.match(js, /visitorFilter === 'client'/);
    assert.match(js, /stats-visitors-count/);
    assert.match(js, /CLIENTES POTENCIALES/i);
    assert.match(js, /pointStyle:\s*'circle'/);
    assert.match(js, /display:\s*false[\s\S]*?beginAtZero:\s*true/);
});

test('statistics demo seed carries the complete named Figma visitor set and reversible marker', () => {
    const seed = read('supabase', 'seeds', '20260829_isainaz_statistics_demo.sql');
    for (const literal of [
        'Valentina Cruz', 'Estudio Tinta Madre', 'Rodrigo Farías', 'Sofía Lemos',
        'Estudio Cactus', 'Nicolás Duarte', 'Martina Ibáñez', 'Estudio Zorro Rojo',
        'Bruno Aquino', 'Camila Ortiz', 'Estudio Fierro Negro', 'Diego Palma'
    ]) {
        assert.match(seed, new RegExp(literal));
    }
    assert.match(seed, /\[PRUEBA\]\[STATS-ISAINAZ-20260829\]/);
    assert.match(seed, /delete from public\.artist_profile_visits/i);
});
