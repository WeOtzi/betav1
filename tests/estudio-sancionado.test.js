'use strict';
// 2.7.0 · Estudio sancionado (F2-estudio-cerrado): cuando soporte suspende o
// banea al dueño, lib/sanciones-service.js (paso profile) fija
// studios.sanction_state y apaga is_active. Ninguna superficie pública debe
// seguir mostrando el estudio ni el sello «Estudio verificado»: perfil
// público, marketplace, pines del mapa de /explore, tarjeta del estudio en el
// perfil del artista, tienda (RPC con dueño privilegiado) y spots (RLS).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

const Badge = require('../public/shared/js/verified-badge.js');
const Core = require('../public/shared/js/marketplace-core.js');
const StudioProfile = require('../public/shared/js/studio-profile.js');
const S = require('../lib/sanciones.js');

const verifiedStudio = (over = {}) => ({ id: 's1', is_verified: true, instagram_badge_ok: true, is_active: true, ...over });

function withBadge(value, fn) {
    const previous = global.WoVerifiedBadge;
    try {
        if (value === undefined) delete global.WoVerifiedBadge; else global.WoVerifiedBadge = value;
        return fn();
    } finally {
        if (previous === undefined) delete global.WoVerifiedBadge; else global.WoVerifiedBadge = previous;
    }
}

test('la sanción de estudio deja sanction_state distinto de none (y el servicio apaga is_active)', () => {
    assert.equal(S.profileState('ban'), 'banned');
    assert.equal(S.profileState('suspension'), 'suspended');
    const svc = read('lib/sanciones-service.js');
    assert.match(svc, /setStudiosSanctionState\(studios\.map\(\(s\) => s\.id\), \{ state, sanctionId: ctx\.sanction\.id, isActive: false \}\)/);
});

test('WoVerifiedBadge.isStudioPublic: activo y sin sanción; ausente cuenta como none', () => {
    assert.equal(Badge.isStudioPublic({ is_active: true }), true);
    assert.equal(Badge.isStudioPublic({ is_active: true, sanction_state: 'none' }), true);
    assert.equal(Badge.isStudioPublic({}), true, 'anon no lee sanction_state ni siempre pide is_active');
    assert.equal(Badge.isStudioPublic({ is_active: false }), false);
    assert.equal(Badge.isStudioPublic({ is_active: true, sanction_state: 'banned' }), false);
    assert.equal(Badge.isStudioPublic({ is_active: true, sanction_state: 'suspended' }), false);
    assert.equal(Badge.isStudioPublic(null), false);
});

test('sello de estudio: nunca con is_active = false ni con sanción', () => {
    assert.equal(Badge.isStudioBadgeVisible(verifiedStudio()), true);
    assert.equal(Badge.isStudioBadgeVisible(verifiedStudio({ is_active: false })), false);
    assert.equal(Badge.isStudioBadgeVisible(verifiedStudio({ sanction_state: 'banned' })), false);
    assert.equal(Badge.isStudioBadgeVisible(verifiedStudio({ sanction_state: 'suspended', is_active: false })), false);
    // Artista sancionado: tampoco (la RLS ya lo oculta; la regla no depende de eso).
    assert.equal(Badge.isBadgeVisible({ verification_state: 'Yes', instagram_badge_ok: true }), true);
    assert.equal(Badge.isBadgeVisible({ verification_state: 'Yes', instagram_badge_ok: true, sanction_state: 'banned' }), false);
});

test('marketplace-core: misma regla con y sin verified-badge.js', () => {
    assert.equal(Core.isStudioPublic({ is_active: false }), false);
    assert.equal(Core.isStudioPublic({ id: 'x' }), true);
    assert.equal(Core.isStudioBadgeVisible(verifiedStudio({ is_active: false })), false);
    assert.equal(Core.studioFlags(verifiedStudio({ sanction_state: 'banned' }), {}).verified, false);
    const src = read('public/shared/js/marketplace-core.js');
    // Respaldo sin el módulo: también exige estudio público.
    assert.match(src, /studio\.is_verified === true && studio\.instagram_badge_ok === true && isStudioPublic\(studio\)/);
    assert.match(src, /isStudioPublic: isStudioPublic/);
});

test('perfil público del estudio: «No encontramos este estudio» y sin sello', () => {
    withBadge(undefined, () => {
        assert.equal(StudioProfile.isStudioPublic({ is_active: false }), false);
        assert.equal(StudioProfile.isStudioPublic({ is_active: true, sanction_state: 'banned' }), false);
        assert.equal(StudioProfile.isStudioPublic({ is_active: true }), true);
        assert.equal(StudioProfile.isStudioPublic(null), false);
        assert.equal(StudioProfile.studioSealVisible({ is_verified: true, is_active: false }), false, 'sin el módulo tampoco');
        assert.equal(StudioProfile.studioSealVisible({ is_verified: true }), true);
    });
    withBadge(Badge, () => {
        assert.equal(StudioProfile.studioSealVisible(verifiedStudio({ is_active: false })), false);
        assert.equal(StudioProfile.studioSealVisible(verifiedStudio({ sanction_state: 'banned' })), false);
        assert.equal(StudioProfile.studioSealVisible(verifiedStudio()), true);
    });
    const src = read('public/shared/js/studio-profile.js');
    assert.match(src, /if \(!isStudioPublic\(studio\)\) \{ renderNotFound\(\); return; \}/);
    assert.match(StudioProfile.STUDIO_PUBLIC_COLUMNS, /(^|,)is_active(,|$)/, 'el perfil pide is_active');
    assert.doesNotMatch(StudioProfile.STUDIO_PUBLIC_COLUMNS, /sanction_state/, 'anon no tiene grant sobre sanction_state');
});

function loadStudiosRepo(rows) {
    const calls = [];
    function builder(target) {
        const b = {
            select(cols) { calls.push({ target, select: cols }); return b; },
            eq() { return b; }, in() { return b; }, not() { return b; }, order() { return b; },
            then(resolve, reject) { return Promise.resolve({ data: rows, error: null }).then(resolve, reject); }
        };
        return b;
    }
    const D = { from: (table) => builder(table), getClient: () => ({ rpc: (name) => builder(`rpc:${name}`) }) };
    const context = vm.createContext({ window: { WeotziData: D }, console });
    vm.runInContext(read('public/shared/js/data/studios-repo.js'), context);
    return { repo: context.window.WeotziData.StudioLocations, calls };
}

test('mapa de /explore: la sede activa de un estudio inactivo o sancionado no da pin', async () => {
    const rows = [
        { id: 'l1', studios: { id: 'a', is_verified: true, instagram_badge_ok: true, is_active: true } },
        { id: 'l2', studios: { id: 'b', is_verified: true, instagram_badge_ok: true, is_active: false } },
        { id: 'l3', studios: { id: 'c', is_active: true, sanction_state: 'banned' } },
        { id: 'l4', studios: null }
    ];
    const { repo, calls } = loadStudiosRepo(rows);
    const res = await repo.listPrimaryWithStudioForMap();
    assert.equal(res.error, null);
    assert.deepEqual(res.data.map((l) => l.id), ['l1']);
    assert.match(calls[0].select, /studios:studio_id\([^)]*\bis_active\)/, 'el embed trae is_active');
});

test('mapa de /explore: un error de la consulta llega tal cual', async () => {
    const context = vm.createContext({
        window: {
            WeotziData: {
                from: () => {
                    const b = { select: () => b, eq: () => b, not: () => b,
                        then: (ok) => Promise.resolve({ data: null, error: { message: 'boom' } }).then(ok) };
                    return b;
                },
                getClient: () => ({})
            }
        },
        console
    });
    vm.runInContext(read('public/shared/js/data/studios-repo.js'), context);
    const res = await context.window.WeotziData.StudioLocations.listPrimaryWithStudioForMap();
    assert.equal(res.error.message, 'boom');
});

test('marketplace: estudios y afiliación de artistas sin estudios ocultos', () => {
    const mk = read('public/shared/js/marketplace.js');
    assert.match(mk, /const studios = \(data \|\| \[\]\)\.filter\(Core\.isStudioPublic\);/);
    assert.match(mk, /if \(!Core\.isStudioPublic\(row\)\) \{ hidden\.add\(row\.id\); return; \}/);
    assert.match(mk, /if \(artist\._studioHidden\) return INDEPENDENT_KEY;/);
    const repo = read('public/shared/js/data/marketplace-repo.js');
    assert.match(repo, /listStudios\(columns = STUDIO_GRID_COLUMNS\) \{\s*return from\('studios'\)\s*\.select\(columns\)\s*\.eq\('is_active', true\)/);
    assert.match(repo, /\.select\('id, name, slug, is_active'\)/);
});

test('perfil del artista: la tarjeta del estudio base ignora un estudio oculto', () => {
    const src = read('public/shared/js/artist-profile.js');
    assert.match(src, /window\.WoVerifiedBadge\?\.isStudioPublic/);
    assert.match(src, /return !error && data && isPublic\(data\) \? data : null;/);
});

test('la tienda y los spots públicos ya filtran por estudio activo en la base', () => {
    const sql = read('supabase/migrations/20261118130000_account_sanctions.sql');
    assert.match(sql, /'public\.get_public_storefront\(text,text\)',\s*'public\.store_public_seller_bundle\(text,uuid\)'/);
    assert.match(sql, /private\.studio_is_listed\(v_product\.seller_id\)/);
    assert.match(sql, /using \(\(status = 'open'::text\) and private\.studio_is_listed\(studio_id\)\);/);
});
