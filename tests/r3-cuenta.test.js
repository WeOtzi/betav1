'use strict';

// Ronda 3 · grupo "cuenta": preferencias con efecto (801:572/574/575),
// vacaciones y TikTok en el perfil público, postulaciones "vistas", adjunto de
// portfolio, validación de "Solicitar cambios", Tattoo Passport, KPI de Travel
// y límite de la foto de perfil.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const prefs = require('../lib/notification-prefs');
const Settings = require('../public/shared/js/app-settings-loader.js');
const Vacation = require('../public/shared/js/artist-vacation.js');
const Portfolio = require('../public/shared/js/proposal-portfolio.js');
const Presentation = require('../public/shared/js/artist-profile-presentation.js');
const Invitations = require('../public/shared/js/invitations-model.js');
const TravelModel = require('../public/shared/js/travel-dashboard-model.js');

// ---------------------------------------------------------------- helpers
function fakeQuery(tables, calls = []) {
    return (table) => {
        const q = { table, filters: [] };
        const api = {
            select() { return api; },
            limit() { return api; },
            single() { return api; },
            eq(col, val) { q.filters.push(['eq', col, val]); return api; },
            ilike(col, val) { q.filters.push(['ilike', col, val]); return api; },
            async execute() {
                calls.push(q);
                const rows = tables[table];
                if (rows instanceof Error) throw rows;
                return (rows || []).find((row) => q.filters.every(([op, col, val]) => (op === 'eq'
                    ? row[col] === val
                    : String(row[col]).toLowerCase() === String(val).replace(/\\/g, '').toLowerCase()))) || null;
            }
        };
        return api;
    };
}

// ------------------------------------------------- notificaciones (801:572)
test('resolvePreference usa lo guardado, el default del Figma y la newsletter', () => {
    assert.equal(prefs.resolvePreference(null, 'invitaciones', 'email'), true);
    assert.equal(prefs.resolvePreference(null, 'job_board', 'email'), false);
    assert.equal(prefs.resolvePreference({ invitaciones: { email: false } }, 'invitaciones', 'email'), false);
    assert.equal(prefs.resolvePreference({ invitaciones: { email: 'no' } }, 'invitaciones', 'email'), true);
    assert.equal(prefs.resolvePreference(null, 'promociones', 'email', { subscribedNewsletter: true }), true);
    assert.equal(prefs.resolvePreference({ promociones: { email: false } }, 'promociones', 'email', { subscribedNewsletter: true }), false);
    // Kinds/canales desconocidos no se bloquean.
    assert.equal(prefs.resolvePreference({}, 'otro', 'email'), true);
    assert.equal(prefs.resolvePreference({}, 'mensajes', 'fax'), true);
});

test('shouldNotify busca por user_id o por email y falla abierto', async () => {
    const tables = {
        artists_db: [{ user_id: 'u1', email: 'Ana_X@example.com', subscribed_newsletter: false }],
        user_preferences: [{ user_id: 'u1', notification_prefs: { spots: { email: false }, mensajes: { email: true } } }]
    };
    const calls = [];
    const query = fakeQuery(tables, calls);
    assert.equal(await prefs.shouldNotify({ id: 'u1' }, 'spots', 'email', { query }), false);
    assert.equal(await prefs.shouldNotify('ana_x@example.com', 'spots', 'email', { query }), false);
    assert.equal(await prefs.shouldNotify('ana_x@example.com', 'mensajes', 'email', { query }), true);
    // El "_" del email se escapa para que ilike no lo use de comodín.
    assert.ok(calls.some((c) => c.filters.some(([op, , val]) => op === 'ilike' && val === 'ana\\_x@example.com')));
    // Sin artista → default.
    assert.equal(await prefs.shouldNotify('nadie@example.com', 'job_board', 'email', { query }), false);
    const broken = fakeQuery({ artists_db: new Error('red caída') });
    let logged = null;
    assert.equal(await prefs.shouldNotify({ id: 'u1' }, 'spots', 'email', { query: broken, onError: (e) => { logged = e; } }), true);
    assert.match(logged.message, /red caída/);
});

test('applyEmailPreferences omite el aviso del artista o lo saca del envío doble', async () => {
    const tables = {
        artists_db: [{ user_id: 'u1', email: 'artist@example.com' }],
        user_preferences: [{ user_id: 'u1', notification_prefs: { invitaciones: { email: false }, calendario: { email: false } } }]
    };
    const { resolveRecipients } = require('../services/email-event-mapping');
    const deps = { query: fakeQuery(tables), resolveRecipients };

    const single = await prefs.applyEmailPreferences('studio_roster_invite', { to: 'artist@example.com', artist_email: 'artist@example.com' }, deps);
    assert.equal(single.skip, true);
    assert.equal(single.kind, 'invitaciones');

    const both = await prefs.applyEmailPreferences('session_scheduled', { artist_email: 'artist@example.com', client_email: 'client@example.com' }, deps);
    assert.equal(both.skip, false);
    assert.equal(both.payload.artist_email, '');
    assert.equal(both.payload.notify_artist, false);
    assert.deepEqual(resolveRecipients('session_scheduled', both.payload), ['client@example.com']);

    // Transaccionales: nunca se filtran.
    const reset = await prefs.applyEmailPreferences('password_reset_temp', { email: 'artist@example.com' }, deps);
    assert.equal(reset.skip, false);
    assert.equal(reset.kind, null);
});

test('email-service aplica las preferencias antes de despachar y la prueba del backoffice las ignora', () => {
    const svc = read('services/email-service.js');
    assert.match(svc, /notificationPrefs\.applyEmailPreferences\(eventId, payload/);
    assert.match(svc, /skipped_by_preference/);
    assert.match(svc, /ignorePreferences: true/);
    assert.match(read('server.js'), /ignorePreferences: true \/\/ prueba del backoffice/);
    for (const eventId of Object.keys(prefs.EMAIL_EVENT_KINDS)) {
        assert.ok(require('../services/email-event-mapping').getEvent(eventId), `evento inexistente: ${eventId}`);
    }
});

// --------------------------------------- configuración global (801:574)
test('normalize descarta valores inválidos y startPagePath resuelve la página de inicio', () => {
    const s = Settings.normalize({ theme: 'neon', date_format: 'X', start_page: 'inbox', timezone: 'Mars/Base', confirm_logout: false });
    assert.equal(s.theme, 'light');
    assert.equal(s.date_format, 'DD/MM/AAAA');
    assert.equal(s.timezone, 'America/Argentina/Buenos_Aires');
    assert.equal(s.confirm_logout, false);
    assert.equal(Settings.startPagePath(s), '/artist/inbox');
    assert.equal(Settings.startPagePath({ start_page: 'calendar' }), '/calendar');
    assert.equal(Settings.startPagePath({ start_page: 'quotations' }), '/my-quotations');
    assert.equal(Settings.startPagePath({ start_page: '//evil.com' }), '/artist/dashboard');
});

test('formatos de fecha y hora respetan zona horaria y formato elegidos', () => {
    const iso = '2026-11-12T21:05:00Z';
    const ba = { timezone: 'America/Argentina/Buenos_Aires' };
    assert.equal(Settings.formatDate(iso, ba), '12/11/2026');
    assert.equal(Settings.formatDate(iso, { ...ba, date_format: 'MM/DD/AAAA' }), '11/12/2026');
    assert.equal(Settings.formatDate(iso, { ...ba, date_format: 'AAAA-MM-DD' }), '2026-11-12');
    assert.equal(Settings.formatTime(iso, ba), '18:05');
    assert.equal(Settings.formatTime(iso, { ...ba, time_format: '12h' }), '6:05 p. m.');
    assert.equal(Settings.formatDate(iso, { timezone: 'Europe/Madrid' }), '12/11/2026');
    assert.equal(Settings.formatTime(iso, { timezone: 'Europe/Madrid' }), '22:05');
    // Fechas de calendario sin hora no se corren de día.
    assert.equal(Settings.formatDate('2026-11-12', { timezone: 'America/Los_Angeles' }), '12/11/2026');
    assert.equal(Settings.formatDate('', ba), '');
});

test('appearance calcula tema, movimiento y escala como Cuenta', () => {
    assert.deepEqual(Settings.appearance({ theme: 'system', reduce_motion: true, interface_scale: '200' }, true), {
        theme: 'dark', density: 'comfortable', textSize: 'medium', noAnimations: true, highContrast: false, fontSize: '125%'
    });
    assert.equal(Settings.appearance({ animations: false }, false).noAnimations, true);
});

test('el loader se carga en todas las páginas del artista y aplica el CSS global', () => {
    assert.match(read('public/shared/js/wo-artist-menu.js'), /\/shared\/js\/app-settings-loader\.js/);
    const css = read('public/shared/css/ds/app-settings.css');
    for (const rule of ['body[data-aac-theme="dark"]', 'body.aac-no-animations', 'body.aac-high-contrast', 'body[data-aac-density="compact"]']) {
        assert.ok(css.includes(rule), rule);
    }
    const loader = read('public/shared/js/app-settings-loader.js');
    assert.match(loader, /wo-org-product-nav__logout/); // confirmación antes de cerrar sesión
    assert.match(read('public/shared/js/artist-account.js'), /WoAppSettings\.remember\(settings/);
});

// --------------------------------------------------------- 2FA (801:575)
test('needsMfa exige el código solo si hay factor verificado sin validar', () => {
    assert.equal(Settings.needsMfa({ currentLevel: 'aal1', nextLevel: 'aal2' }), true);
    assert.equal(Settings.needsMfa({ currentLevel: 'aal2', nextLevel: 'aal2' }), false);
    assert.equal(Settings.needsMfa({ currentLevel: 'aal1', nextLevel: 'aal1' }), false);
    assert.equal(Settings.needsMfa(null), false);
});

test('el login del artista pide el segundo factor y respeta la página de inicio', () => {
    const html = read('public/artist/login/index.html');
    assert.match(html, /id="login-mfa-view"[^>]*hidden/);
    assert.match(html, /id="mfa-code"[^>]*autocomplete="one-time-code"/);
    assert.match(html, /app-settings-loader\.js/);
    const js = read('public/shared/js/artist-login.js');
    assert.match(js, /getAuthenticatorAssuranceLevel/);
    assert.match(js, /mfa\.challengeAndVerify\(\{ factorId: factor\.id, code \}\)/);
    // Login con contraseña, OAuth y sesión existente pasan por el paso 2FA.
    assert.equal((js.match(/if \(await needsSecondFactor\(\)\)/g) || []).length, 3);
    assert.match(js, /returnTo \|\| await resolveArtistHome\(user\.id\)/);
    // Las páginas del artista vuelven al login si la sesión quedó en aal1.
    assert.match(read('public/shared/js/app-settings-loader.js'), /\/artist\/login\?mfa=1&returnTo=/);
});

// -------------------------------------------------- vacaciones (801:571)
test('vacaciones: rango, días bloqueados y aviso público', () => {
    const v = Vacation.range('2026-12-20', '2027-01-05');
    assert.deepEqual(v, { start: '2026-12-20', end: '2027-01-05' });
    assert.deepEqual(Vacation.range('2027-01-05', '2026-12-20'), v);
    assert.equal(Vacation.range(null, null), null);
    assert.equal(Vacation.isDateBlocked('2026-12-31', v), true);
    assert.equal(Vacation.isDateBlocked('2027-01-06', v), false);
    assert.equal(Vacation.status(v, '2026-12-25'), 'active');
    assert.equal(Vacation.status(v, '2026-12-01'), 'upcoming');
    assert.equal(Vacation.status(v, '2026-10-01'), 'later');
    assert.equal(Vacation.status(v, '2027-02-01'), 'past');
    assert.equal(Vacation.notice(v, '2026-12-25'), 'De vacaciones hasta el 5 de enero');
    assert.equal(Vacation.notice(v, '2026-12-01'), 'De vacaciones del 20 de diciembre al 5 de enero');
    assert.equal(Vacation.notice(v, '2027-02-01'), '');
    assert.equal(Vacation.returnDay(v), '2027-01-06');
});

test('el perfil público, el cotizador y el Job Board usan las vacaciones', () => {
    const profile = read('public/shared/js/artist-profile.js');
    assert.match(profile, /gallery_feed_items,vacation_start,vacation_end/);
    assert.match(profile, /function renderVacation\(\)/);
    assert.match(profile, /if \(isOnVacation\(\)\) return false;/); // no "Agenda abierta"
    assert.match(read('public/artist/profile/index.html'), /id="hero-vacation"/);
    const wizard = read('public/shared/js/script.js');
    assert.match(wizard, /WoArtistVacation\.isDateBlocked\(iso, vacation\)/);
    assert.match(read('public/quotation/index.html'), /artist-vacation\.js/);
    const jb = read('public/shared/js/job-board-feed.js');
    assert.match(jb, /vacation_start, vacation_end/);
    assert.match(jb, /vacationAvailabilityHint\(\)/);
});

// ------------------------------------------------------ TikTok (801:565)
test('redes del perfil público: Instagram, TikTok y sitio, solo http(s)', () => {
    const links = Presentation.buildSocialLinks(
        { instagram: 'https://instagram.com/ana.ink/', portafolio: 'ana.ink' },
        { tiktok: '@ana_tattoo' }
    );
    assert.deepEqual(links.map((l) => [l.key, l.href]), [
        ['instagram', 'https://www.instagram.com/ana.ink/'],
        ['tiktok', 'https://www.tiktok.com/@ana_tattoo'],
        ['web', 'https://ana.ink/']
    ]);
    assert.deepEqual(Presentation.buildSocialLinks({ portafolio: 'javascript:alert(1)' }, { tiktok: '<script>' }), []);
    assert.match(read('public/shared/js/artist-profile.js'), /privacy && privacy\.show_socials === false \? \[\]/);
    // El Figma retiró la fila de redes del hero: van como dato de la ficha "Sobre".
    assert.match(read('public/artist/profile/index.html'), /id="fact-socials" hidden>\s*<dt>Redes<\/dt>/);
});

// ------------------------------------------- postulaciones vistas (P2)
test('markViewed solo pasa pending → viewed (Job Board y spots)', () => {
    const jb = read('public/shared/js/data/jobboard-repo.js');
    assert.match(jb, /async markViewed\(applicationId\)[\s\S]*?update\(\{ status: 'viewed' \}\)[\s\S]*?\.eq\('status', 'pending'\)/);
    const spots = read('public/shared/js/data/studios-repo.js');
    assert.match(spots, /markViewed\(applicationIds\)[\s\S]*?update\(\{ status: 'viewed' \}\)[\s\S]*?\.eq\('status', 'pending'\)/);
    assert.match(read('public/shared/js/client-requests.js'), /Apps\.markViewed\(app\.id\)/);
    assert.match(read('public/shared/js/studio-dashboard.js'), /StudioSpots\.markViewed\(pendingIds\)/);
});

test('portfolio_links de la propuesta: perfil público y sitio web', () => {
    assert.deepEqual(Portfolio.buildLinks({ username: 'ana.wo', portafolio: 'ana.ink' }, 'https://beta.weotzi.com', '/beta'),
        ['https://beta.weotzi.com/beta/artist/profile?artist=ana.wo', 'https://ana.ink/']);
    assert.deepEqual(Portfolio.buildLinks({ username: 'ana.wo', portafolio: 'ftp://x' }, 'https://weotzi.com', ''),
        ['https://weotzi.com/artist/profile?artist=ana.wo']);
    assert.deepEqual(Portfolio.buildLinks({}, 'https://weotzi.com'), []);
    assert.match(read('public/shared/js/job-board-feed.js'), /portfolio_links: window\.WoProposalPortfolio/);
    // El cliente solo muestra como "Trabajos relacionados" las URLs de imagen.
    assert.match(read('public/shared/js/client-requests.js'), /\.filter\(\(u\) => \/\\\.\(jpe\?g\|png/);
});

// --------------------------------------- solicitar cambios (801:1101)
test('Solicitar cambios: 10–1000 caracteres y errores de la RPC en español', () => {
    assert.equal(Invitations.validateChangeRequest('   ').ok, false);
    assert.match(Invitations.validateChangeRequest('corto').error, /mínimo 10/);
    assert.equal(Invitations.validateChangeRequest('Mover fechas dos semanas').ok, true);
    assert.match(Invitations.validateChangeRequest('x'.repeat(1001)).error, /1000/);
    assert.match(Invitations.changeRequestError({ message: 'message must contain 10 to 1000 characters' }), /entre 10 y 1000/);
    assert.match(Invitations.changeRequestError({ message: 'pending invitation not found' }), /ya no está pendiente/);
    assert.match(Invitations.changeRequestError({ message: 'authentication required' }), /sesión/);
    assert.doesNotMatch(Invitations.changeRequestError({ message: 'weird' }), /weird/);
    const js = read('public/shared/js/artist-invitations.js');
    assert.match(js, /minlength="10" maxlength="1000"/);
    assert.match(js, /M\.changeRequestError\(result\.error\)/);
});

// ----------------------------------------------- Travel (801:1076)
test('Tattoo Passport cae a los viajes finalizados si no hay sellos persistidos', () => {
    assert.equal(TravelModel.usePersistedPassport([]), false);
    assert.equal(TravelModel.usePersistedPassport(null), false);
    assert.equal(TravelModel.usePersistedPassport([{ city: 'Lima' }]), true);
    assert.match(read('public/shared/js/artist-travel.js'), /TravelDashboardModel\.usePersistedPassport\(passportStamps\)/);
});

test('KPI de Travel: "Personas interesadas" por RPC y "Clima" oculto sin dato', () => {
    const travel = read('public/shared/js/artist-travel.js');
    assert.match(travel, /climateStat\.hidden = metrics\.climateCelsius == null/);
    assert.match(travel, /repo\.countInterestedPeople\(trip\.id\)/);
    assert.match(read('public/shared/css/artist-travel-ds.css'), /\.tvl-hero-stat\[hidden\]\{display:none\}/);
    const sql = read('supabase/migrations/20261112200000_cuenta_travel_interest.sql');
    assert.match(sql, /security definer/);
    assert.match(sql, /set search_path = ''/);
    assert.match(sql, /v_artist <> auth\.uid\(\)/);
    assert.match(sql, /revoke all on function public\.count_trip_interested_people\(uuid\) from public, anon/);
    assert.match(read('supabase/rollbacks/20261112200000_cuenta_travel_interest.down.sql'),
        /drop function if exists public\.count_trip_interested_people\(uuid\)/);
});

// ------------------------------------------ foto de perfil (801:565)
test('foto y banner de perfil: límite de 5 MB como el bucket profile-pictures', () => {
    const js = read('public/shared/js/artist-account.js');
    assert.match(js, /const MAX_PROFILE_IMAGE_BYTES = 5 \* 1024 \* 1024;/);
    assert.match(js, /file\.size > MAX_PROFILE_IMAGE_BYTES\) throw new Error\('La imagen supera los 5 MB/);
    assert.match(js, /toast\(\/5 MB\|Formato\//);
});
