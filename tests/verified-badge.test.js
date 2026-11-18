'use strict';
// Insignia de verificado (plan KYC 1.5): verificado + Instagram validado.
// public/shared/js/verified-badge.js es la regla única (navegador y Node) y
// espeja la columna generada instagram_badge_ok (migración 20261118100000).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

const Badge = require('../public/shared/js/verified-badge.js');
const igService = require('../services/instagram-verification.js');
const matching = require('../lib/artist-matching.js');
const CotDetalle = require('../lib/cot-detalle.js');
const Core = require('../public/shared/js/marketplace-core.js');

const AT = '2026-11-18T10:00:00Z';
const artist = (over = {}) => ({
    verification_state: 'Yes', instagram: '@Laura.Tattoo', instagram_verified_at: AT, instagram_verified_handle: 'laura.tattoo', ...over
});
const studio = (over = {}) => ({
    is_verified: true, instagram: 'horizonte.ink', instagram_verified_at: AT, instagram_verified_handle: 'horizonte.ink', ...over
});

test('UMD: window.WoVerifiedBadge en el navegador y require en Node, sin DOM', () => {
    const src = read('public/shared/js/verified-badge.js');
    assert.match(src, /root\.WoVerifiedBadge = factory\(\)/);
    assert.match(src, /module\.exports = factory\(\)/);
    assert.doesNotMatch(src, /document\.|window\.fetch|fetch\(/);
    for (const fn of ['normalizeHandle', 'instagramMatches', 'isBadgeVisible', 'isStudioBadgeVisible', 'isStudioPublic', 'badgeState']) {
        assert.equal(typeof Badge[fn], 'function', fn);
    }
});

test('normalizeHandle: igual que el servidor (@, URL, mayúsculas, inválidos)', () => {
    const cases = ['laura', '@Laura.Tattoo', 'https://www.instagram.com/Laura.Tattoo/?hl=es', 'instagram.com/laura_t',
        'm.instagram.com/laura', '  @@laura  ', '', null, 'no válido', 'a'.repeat(31), 'http://instagram.com/x.y/'];
    for (const value of cases) {
        assert.equal(Badge.normalizeHandle(value), igService.normalizeHandle(value), JSON.stringify(value));
    }
    assert.equal(Badge.normalizeHandle('https://www.instagram.com/Laura.Tattoo/?hl=es'), 'laura.tattoo');
});

test('artista: insignia con el Instagram del perfil validado', () => {
    assert.equal(Badge.instagramMatches(artist()), true);
    assert.equal(Badge.isBadgeVisible(artist()), true);
    assert.equal(Badge.badgeState(artist()), 'visible');
});

test('artista: cambió el Instagram después de validar → insignia oculta', () => {
    const changed = artist({ instagram: '@otra.cuenta' });
    assert.equal(Badge.instagramMatches(changed), false);
    assert.equal(Badge.isBadgeVisible(changed), false);
    assert.equal(Badge.badgeState(changed), 'hidden_ig_changed');
});

test('variantes del mismo handle: @, URL y mayúsculas cuentan como el mismo', () => {
    for (const instagram of ['laura.tattoo', '@LAURA.TATTOO', 'https://instagram.com/Laura.Tattoo', 'www.instagram.com/laura.tattoo/']) {
        assert.equal(Badge.isBadgeVisible(artist({ instagram })), true, instagram);
    }
    assert.equal(Badge.isBadgeVisible(artist({ instagram_verified_handle: '@Laura.Tattoo' })), true);
});

test('sin Instagram en el perfil, sin fecha o sin handle validado → sin insignia', () => {
    assert.equal(Badge.isBadgeVisible(artist({ instagram: '' })), false);
    assert.equal(Badge.isBadgeVisible(artist({ instagram: null })), false);
    assert.equal(Badge.isBadgeVisible(artist({ instagram_verified_at: null })), false);
    assert.equal(Badge.isBadgeVisible(artist({ instagram_verified_handle: null })), false);
    assert.equal(Badge.isBadgeVisible(artist({ instagram: 'no válido', instagram_verified_handle: 'no válido' })), false);
    assert.equal(Badge.instagramMatches(null), false);
    assert.equal(Badge.isBadgeVisible(null), false);
});

test('la columna generada instagram_badge_ok manda sobre el cálculo por handle', () => {
    // El navegador no puede leer instagram_verified_handle: la columna decide.
    assert.equal(Badge.isBadgeVisible({ verification_state: 'Yes', instagram_badge_ok: true }), true);
    assert.equal(Badge.isBadgeVisible(artist({ instagram_badge_ok: false })), false);
    assert.equal(Badge.isBadgeVisible({ verification_state: 'Yes', instagram: 'x', instagram_badge_ok: true }), true);
    assert.equal(Badge.isBadgeVisible({ verification_state: 'No', instagram_badge_ok: true }), false);
    assert.equal(Badge.badgeState({ verification_state: 'Yes', instagram_badge_ok: false }), 'hidden_ig_changed');
});

test('estados de verificación: solo Yes muestra la insignia', () => {
    for (const state of ['No', 'Requested', 'In Progress', 'Denied', null, undefined]) {
        assert.equal(Badge.isBadgeVisible(artist({ verification_state: state })), false, String(state));
        assert.equal(Badge.badgeState(artist({ verification_state: state })), 'not_verified');
    }
});

test('estudios: is_verified y el Instagram validado', () => {
    assert.equal(Badge.isStudioBadgeVisible(studio()), true);
    assert.equal(Badge.badgeState(studio()), 'visible');
    assert.equal(Badge.isStudioBadgeVisible(studio({ instagram: 'nuevo.ink' })), false);
    assert.equal(Badge.badgeState(studio({ instagram: 'nuevo.ink' })), 'hidden_ig_changed');
    assert.equal(Badge.isStudioBadgeVisible(studio({ is_verified: false })), false);
    assert.equal(Badge.isStudioBadgeVisible(studio({ is_verified: 'true' })), false, 'solo el booleano true');
    // Sin abuelos: verificado sin Instagram validado no muestra sello.
    assert.equal(Badge.isStudioBadgeVisible({ is_verified: true, instagram: 'hz', instagram_verified_at: null }), false);
    assert.equal(Badge.isStudioBadgeVisible({ is_verified: true, instagram_badge_ok: true }), true);
    // Un estudio no usa verification_state ni un artista is_verified.
    assert.equal(Badge.isBadgeVisible(studio()), false);
    assert.equal(Badge.isStudioBadgeVisible(artist()), false);
});

test('sanciones (2.7.0): estudio inactivo o sancionado y artista sancionado, sin insignia', () => {
    assert.equal(Badge.isStudioBadgeVisible(studio({ is_active: true })), true);
    assert.equal(Badge.isStudioBadgeVisible(studio({ is_active: false })), false, 'la sanción apaga is_active');
    assert.equal(Badge.isStudioBadgeVisible(studio({ sanction_state: 'banned' })), false);
    assert.equal(Badge.isStudioBadgeVisible(studio({ sanction_state: 'suspended' })), false);
    assert.equal(Badge.isStudioBadgeVisible(studio({ sanction_state: 'none' })), true);
    assert.equal(Badge.isStudioPublic(studio()), true, 'sin sanction_state (anon no la lee) cuenta como none');
    assert.equal(Badge.isBadgeVisible(artist({ sanction_state: 'banned' })), false);
    assert.equal(Badge.isBadgeVisible(artist({ sanction_state: 'none' })), true);
    // badgeState es para la cuenta y soporte: no cambia con la sanción.
    assert.equal(Badge.badgeState(studio({ is_active: false })), 'visible');
});

test('marketplace-core delega en verified-badge.js', () => {
    assert.equal(Core.isArtistBadgeVisible(artist()), true);
    assert.equal(Core.isArtistBadgeVisible(artist({ instagram: 'otra' })), false);
    assert.equal(Core.isArtistBadgeVisible({ verification_state: 'Yes', instagram_badge_ok: true }), true);
    assert.equal(Core.isStudioBadgeVisible(studio()), true);
    assert.equal(Core.studioFlags(studio({ instagram: 'otra' }), {}).verified, false);
});

test('matching: el verificado sin Instagram validado no suma ni muestra insignia; sancionados fuera', () => {
    const base = { username: 'x', styles_array: ['Realismo'], city: 'Lima', registration_status: 'completo' };
    const now = Date.parse('2026-11-18T12:00:00Z');
    const rows = [
        { ...base, user_id: 'a', name: 'A', ...artist({ instagram: 'otra.cuenta' }) },
        { ...base, user_id: 'b', name: 'B', ...artist() },
        { ...base, user_id: 'c', name: 'C', ...artist(), sanction_state: 'suspended' },
        { ...base, user_id: 'd', name: 'D', ...artist(), sanction_state: 'banned' }
    ];
    const ranked = matching.rankArtists(rows, { styles: 'realismo', city: 'Lima' }, { now });
    assert.deepEqual(ranked.map((r) => r.user_id), ['b', 'a']);
    assert.equal(ranked[0].verified, true);
    assert.equal(ranked[1].verified, false);
    assert.ok(matching.MATCHING_COLUMNS.split(',').includes('instagram'));
    assert.doesNotMatch(JSON.stringify(ranked), /instagram_verified_handle|otra\.cuenta/, 'la respuesta no expone el Instagram');
});

test('enlace compartido: insignia con el helper; el contacto sigue mirando solo Yes', () => {
    const quote = { quote_id: 'COT-1', quote_status: 'responded', created_at: AT };
    const sheet = (a, q = {}) => CotDetalle.buildSheet({ quote: { ...quote, ...q }, artist: a, sessions: [], base: 'https://beta.weotzi.com', now: Date.parse(AT) });
    assert.equal(sheet({ name: 'L', username: 'laura.wo', ...artist() }).artist.verified, true);
    assert.equal(sheet({ name: 'L', username: 'laura.wo', ...artist({ instagram: 'otra' }) }).artist.verified, false);
    // Regla de contacto (plan 1.5): solo verification_state.
    assert.equal(CotDetalle.contactAccess({ quote: { quote_status: 'pending' }, artist: { verification_state: 'Yes' } }).visible, true);
    // Cerrada por soporte: la etiqueta manda sobre el estado.
    const closed = sheet({ name: 'L', ...artist() }, { quote_status: 'cancelled', support_closed_reason: 'El perfil fue dado de baja por soporte.' });
    assert.equal(closed.status_label, 'Cancelada por soporte');
    assert.equal(closed.support_closed, true);
    assert.doesNotMatch(JSON.stringify(closed), /dado de baja/, 'el motivo interno no viaja en la hoja');
    assert.equal(sheet({ name: 'L', ...artist() }, { quote_status: 'cancelled' }).status_label, 'Cancelada por el artista');
});

test('selects: columnas de la insignia en los repos y páginas con el script', () => {
    assert.match(read('public/shared/js/data/marketplace-repo.js'), /'verification_state', 'instagram_badge_ok'/);
    assert.match(read('public/shared/js/data/marketplace-repo.js'), /'is_verified', 'instagram_badge_ok'/);
    assert.match(read('public/shared/js/data/marketplace-repo.js'), /listArtistBadges\(\)/);
    assert.match(read('lib/repos/cot-detalle.js'), /verification_state,instagram,instagram_verified_handle,instagram_verified_at/);
    assert.match(read('lib/repos/cot-detalle.js'), /'support_closed_reason'/);
    assert.match(read('lib/repos/artists-public.js'), /'instagram_badge_ok'/);
    // Sin eq(sanction_state): anon no tiene grant sobre esa columna (la RLS
    // ya oculta a los sancionados) y la consulta fallaría entera.
    assert.doesNotMatch(read('lib/repos/artists-public.js'), /\.eq\('sanction_state'/);
    assert.match(read('lib/repos/artist-verification.js'), /verification_state,instagram,instagram_verified_at,instagram_verified_handle/);
    for (const page of ['public/explore/index.html', 'public/marketplace/index.html', 'public/artist/account/index.html', 'public/studio-spots/index.html', 'public/backoffice/index.html']) {
        const html = read(page);
        const at = html.indexOf('/shared/js/verified-badge.js?v=20261118-kyc');
        assert.ok(at > 0, page + ' carga verified-badge.js');
    }
    // Antes del módulo que lo usa.
    const explore = read('public/explore/index.html');
    assert.ok(explore.indexOf('verified-badge.js') < explore.indexOf('marketplace-core.js'));
    const mk = read('public/marketplace/index.html');
    assert.ok(mk.indexOf('verified-badge.js') < mk.indexOf('marketplace-core.js'));
});
