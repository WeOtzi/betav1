'use strict';
// Ronda 2 · frente "registro": 50 publicaciones de Instagram (N2), pie de foto
// (N3), confirmación de email en la pestaña que espera (N4), rebote al
// registro tras confirmar (N5 · T1-2), enlace mágico visible (N6), foco sin
// borde azul (N1), datos de contacto de Instagram (P3) y estilos con foto en
// el registro de cliente (P31).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

const igImport = require('../lib/instagram-import');
const contact = require('../lib/instagram-profile-contact');
const caption = require('../public/shared/js/gallery-caption.js');
const R2 = require('../public/shared/js/registro-r2.js');
const EC = require('../public/shared/js/email-confirmation.js');
const gallery = require('../public/shared/js/dashboard-gallery.js');
const clientStyles = require('../public/client/register/estilos-r2.js');
const catalogs = require('../lib/registration-catalogs');
const { createHandlers, register, isUuid, isConfirmedAuthUser } = require('../lib/routes/registro');
const progress = require('../public/shared/js/artist-registration-progress.js');

const I = igImport._internal;
const post = (code, extra = {}) => ({
    url: `https://www.instagram.com/p/${code}/`,
    displayUrl: `https://scontent.cdninstagram.com/${code}.jpg`,
    caption: `Trabajo ${code}`,
    timestamp: '2026-01-01T00:00:00.000Z',
    ...extra
});

// ---------------------------------------------------------------- N2 ----

test('N2: el preview pide 50 publicaciones a un actor de PUBLICACIONES (el de perfil solo trae ~12)', () => {
    assert.equal(igImport.IG_PREVIEW_LIMIT, 50);
    assert.equal(igImport.IG_MAX_COMMIT_MEDIA, 50);
    assert.equal(I.APIFY_POSTS_ACTOR, 'apify/instagram-scraper');
    assert.deepEqual(I.buildPostsActorInput('apify/instagram-scraper', 'ana.tattoo', 50), {
        directUrls: ['https://www.instagram.com/ana.tattoo/'], resultsType: 'posts', resultsLimit: 50, addParentData: false
    });
    assert.deepEqual(I.buildPostsActorInput('apify/instagram-post-scraper', 'ana.tattoo', 50), { username: ['ana.tattoo'], resultsLimit: 50 });
    const src = read('lib/instagram-import.js');
    assert.match(src, /Promise\.all\(\[\s*callApifyActor\(token, cleanHandle, cleanLimit\),\s*postsPromise\s*\]\)/);
    assert.match(src, /posts actor failed, using profile posts only/, 'si el actor de publicaciones falla, el import sigue');
});

test('N2: une perfil + publicaciones sin repetir, de la más nueva a la más vieja y con tope 50', () => {
    const profilePosts = Array.from({ length: 12 }, (_, i) => post('P' + i, { timestamp: `2026-03-${String(28 - i).padStart(2, '0')}T10:00:00Z` }));
    const extra = Array.from({ length: 60 }, (_, i) => ({
        // Misma publicación escrita distinto (sin barra final / como reel).
        url: i < 12 ? `https://www.instagram.com/p/P${i}` : `https://www.instagram.com/reel/X${i}/`,
        displayUrl: `https://scontent.cdninstagram.com/x${i}.jpg`,
        timestamp: new Date(Date.parse('2026-03-28T10:00:00Z') - i * 86400000).toISOString()
    }));
    const merged = I.mergePosts(profilePosts, extra, 50);
    assert.equal(merged.length, 50);
    assert.equal(new Set(merged.map(I.postKey)).size, 50, 'sin duplicados');
    const times = merged.map((p) => Date.parse(p.timestamp));
    assert.deepEqual(times, [...times].sort((a, b) => b - a));
    assert.equal(I.postKey({ url: 'https://www.instagram.com/p/ABC/' }), I.postKey({ url: 'https://instagram.com/usuario/reel/ABC?x=1' }));
    assert.equal(I.isPostRow({ error: 'no_items' }), false);
    assert.equal(I.isPostRow(post('A')), true);
});

test('N2: transformProfile entrega hasta 50 ítems con su pie y el resumen los lista para elegir', () => {
    const profile = { username: 'ana.tattoo', fullName: 'Ana Ruiz', biography: '📍 Madrid, España', latestPosts: [post('A'), post('B')] };
    const extraPosts = Array.from({ length: 70 }, (_, i) => post('E' + i, {
        timestamp: new Date(Date.parse('2026-02-01T00:00:00Z') + i * 3600000).toISOString(),
        ...(i % 10 === 0 ? { type: 'Video', videoUrl: `https://scontent.cdninstagram.com/E${i}.mp4`, videoDuration: 14.6 } : {})
    }));
    const payload = I.transformProfile([profile], 'ana.tattoo', { extraPosts, limit: 50 });
    assert.equal(payload.photos.length + payload.reels.length, 50);
    assert.ok(payload.reels.length > 0);
    assert.ok(payload.photos.every((p) => typeof p.caption === 'string' && p.caption.startsWith('Trabajo ')));
    const summary = I.summarizePayload(payload);
    assert.equal(summary.media.length, 50);
    assert.equal(summary.media[0].caption.length <= 140, true);
    assert.equal('cdn_url' in summary.media[0], false, 'el resumen no expone la URL del CDN');
});

test('N2: el commit descarga en paralelo conservando el orden', async () => {
    const started = [];
    let running = 0;
    let peak = 0;
    const out = await I.mapWithConcurrency([5, 1, 4, 2, 3, 6, 7], 3, async (n, i) => {
        started.push(i);
        running += 1; peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, n));
        running -= 1;
        return n * 10;
    });
    assert.deepEqual(out, [50, 10, 40, 20, 30, 60, 70]);
    assert.ok(peak <= 3 && peak > 1);
    assert.deepEqual(await I.mapWithConcurrency([], 4, async () => 1), []);
});

test('N2: el alta reutiliza el perfil recién traído (reuse) en vez de otra corrida de Apify', async () => {
    const src = read('lib/instagram-import.js');
    assert.match(src, /const recent = reuse \? recentProfiles\.get\(handleKey\) : null;/);
    assert.match(read('server.js'), /reuse: body\.reuse === true/);
    assert.match(read('public/shared/js/register.js'), /mode: 'dashboard', reuse: true/);
    // Con el perfil en caché y reuse:true no hace falta token ni red.
    I.recentProfiles.set('cache.test', { payload: I.transformProfile([{ username: 'cache.test', latestPosts: [post('C1')] }], 'cache.test'), at: Date.now() });
    const out = await igImport.preview({ handle: '@Cache.Test', reuse: true });
    assert.equal(out.posts_source, 'cache');
    assert.equal(out.summary.photos_count, 1);
    I.recentProfiles.set('vieja.test', { payload: {}, at: Date.now() - I.RECENT_PROFILE_TTL_MS - 1000 });
    I.pruneCaches();
    assert.equal(I.recentProfiles.has('vieja.test'), false);
    I.recentProfiles.delete('cache.test');
});

// ---------------------------------------------------------------- P3 ----

test('P3: email del perfil profesional o de la bio, nunca inventado', () => {
    assert.deepEqual(
        contact.extractProfileContact({ businessEmail: ' Hola@Estudio.COM ' }, {}),
        { email: 'hola@estudio.com', email_source: 'business', city: null, country: null, country_code: null, location_source: null }
    );
    const fromBio = contact.extractProfileContact({}, { bio: 'Tatuador · turnos: juan.perez+tattoo@mail.com.ar ✉️' });
    assert.equal(fromBio.email, 'juan.perez+tattoo@mail.com.ar');
    assert.equal(fromBio.email_source, 'bio');
    assert.equal(contact.extractProfileContact({}, { bio: 'escríbeme por DM' }).email, null);
    assert.equal(contact.normalizeEmail('no es un email'), '');
});

test('P3: ciudad y país desde la dirección profesional, la bio o la etiqueta de lugar', () => {
    const business = contact.extractProfileContact({ business_address_json: '{"city_name":"Madrid, Spain","zip_code":"28001"}' }, {});
    assert.deepEqual([business.city, business.country, business.country_code, business.location_source], ['Madrid', 'España', 'ES', 'business']);
    const bio = contact.extractProfileContact({}, { locationGuess: 'Montevideo, Uruguay', locationSource: 'bio' });
    assert.deepEqual([bio.city, bio.country, bio.country_code, bio.location_source], ['Montevideo', 'Uruguay', 'UY', 'bio']);
    // Sin país reconocible no se inventa uno; un dominio no es una ciudad.
    assert.deepEqual(contact.splitPlace('Brooklyn, New York'), { city: 'Brooklyn', country: null });
    assert.equal(contact.splitPlace('www.sitio.com').city, '');
    assert.equal(contact.splitPlace('Argentina').city, '');
    assert.equal(contact.matchCountry('USA').code, 'US');
    assert.equal(contact.matchCountry('CO'), null, 'un código de 2 letras suelto no alcanza');
    assert.equal(contact.cleanFullName('✨ Juan Pérez ✨ '), 'Juan Pérez');
    // Todos los alias apuntan a países del catálogo del registro.
    const codes = new Set(catalogs.REGISTRATION_COUNTRIES.map((c) => c.code));
    Object.keys(contact.COUNTRY_ALIASES).forEach((code) => assert.ok(codes.has(code), code));
});

test('P3: el commit de registro devuelve el perfil para precargar (solo en modo signup)', async () => {
    const payload = I.transformProfile([{
        username: 'ana.tattoo', fullName: 'Ana Ruiz', biography: '📍 Lima, Perú\nana@estudio.pe', latestPosts: [post('A')]
    }], 'ana.tattoo');
    I.previewCache.set('r2-test-payload', { payload, expiresAt: Date.now() + 60000 });
    const out = await igImport.commit({
        payload_id: 'r2-test-payload', selection: { photos: true, bio: true, location: true }, target: 'artist', mode: 'signup'
    });
    assert.deepEqual(out.prefill.profile, {
        full_name: 'Ana Ruiz', email: 'ana@estudio.pe', email_source: 'bio',
        city: 'Lima', country: 'Perú', country_code: 'PE', location_source: 'bio'
    });
    assert.equal(out.prefill.media[0].caption, 'Trabajo A');
    I.previewCache.delete('r2-test-payload');
});

test('P3: el registro solo completa campos vacíos y los marca "Traído de Instagram"', () => {
    const profile = { full_name: 'Ana Ruiz', email: 'Ana@Estudio.pe', city: 'Lima', country: 'Perú' };
    const empty = R2.planInstagramPrefill({ emailEditable: true }, profile);
    assert.deepEqual(empty.apply, { full_name: 'Ana Ruiz', email: 'ana@estudio.pe', location_city: 'Lima', city: 'Lima', location_country: 'Perú' });
    assert.deepEqual(empty.marks, { full_name: 'Ana Ruiz', email: 'ana@estudio.pe', location: 'Lima, Perú' });
    // Nunca pisa lo que la persona ya escribió.
    const typed = R2.planInstagramPrefill({ full_name: 'Ana R.', email: 'otra@mail.com', location_city: 'Cusco', emailEditable: true }, profile);
    assert.deepEqual(typed.apply, {});
    assert.deepEqual(typed.marks, {});
    // Email bloqueado (sesión) o inválido: no se toca. Con dirección elegida, tampoco la ciudad.
    assert.equal('email' in R2.planInstagramPrefill({ emailEditable: false }, profile).apply, false);
    assert.equal('email' in R2.planInstagramPrefill({ emailEditable: true }, { email: 'nope' }).apply, false);
    assert.equal('location_city' in R2.planInstagramPrefill({ hasAddress: true, emailEditable: true }, profile).apply, false);
    // La marca se cae cuando la persona cambia el valor.
    assert.deepEqual(R2.activeInstagramMarks(empty.marks, { full_name: 'Ana Ruiz', email: 'x@y.com', location_city: 'Lima', location_country: 'Perú' }),
        { full_name: 'Ana Ruiz', location: 'Lima, Perú' });
    const reg = read('public/shared/js/register.js');
    assert.match(reg, /WoRegistroR2\.applyInstagramProfile\(\s*pf\.profile \|\| \{ full_name: summary\.full_name \}/);
    assert.match(read('public/shared/js/registro-r2.js'), /IG_TAG_TEXT = 'Traído de Instagram'/);
});

// ---------------------------------------------------------------- N3 ----

test('N3: el pie de foto es texto plano saneado con tope 2200', () => {
    assert.equal(caption.CAPTION_MAX, 2200);
    assert.equal(caption.sanitizeCaption('  hola\r\nmundo\t fin  '), 'hola\nmundo  fin');
    assert.equal(caption.sanitizeCaption('a\u0007b‮c﻿'), 'abc');
    assert.equal(caption.sanitizeCaption('uno   \n\n\n\n\ndos'), 'uno\n\ndos');
    assert.equal(caption.sanitizeCaption('<b>hola</b> & "chau"'), '<b>hola</b> & "chau"', 'no interpreta HTML: quien lo muestra lo escapa');
    assert.equal(caption.sanitizeCaption(42), '');
    assert.equal(caption.sanitizeCaption(' \n '), '');
    assert.equal(Array.from(caption.sanitizeCaption('x'.repeat(3000))).length, 2200);
    // No parte un emoji compuesto al cortar.
    const family = '👨‍🎨';
    assert.ok(caption.sanitizeCaption(family).includes('‍'));
    assert.equal(Array.from(caption.sanitizeCaption('🔥'.repeat(2300))).length, 2200);
    assert.deepEqual(caption.withCaption({ url: 'a', caption: 'viejo' }, '  '), { url: 'a' });
    assert.deepEqual(caption.normalizeFeedCaptions([{ url: 'a', caption: ' ok ' }, { url: 'b', caption: 5 }, { url: 'c' }]),
        [{ url: 'a', caption: 'ok' }, { url: 'b' }, { url: 'c' }]);
    assert.deepEqual(caption.sanitizeCaptionMap({ 'https://ig/p/A/': ' uno ', 'https://ig/p/B/': '', x: 7 }, 50),
        { 'https://ig/p/A/': 'uno', 'https://ig/p/B/': '' });
    assert.equal(Object.keys(caption.sanitizeCaptionMap(Object.fromEntries(Array.from({ length: 80 }, (_, i) => ['k' + i, 'v'])), 50)).length, 50);
});

test('N3: el importador guarda el pie de Instagram y respeta el que se editó en el registro', () => {
    const item = I.buildFeedItem({ kind: 'image', category: 'instagram', caption: '  pie de IG\u0007  ', permalink: 'https://www.instagram.com/p/A/' },
        'https://x/y.jpg', { igHandle: '@Ana', importedAt: '2026-11-16T00:00:00.000Z' });
    assert.equal(item.caption, 'pie de IG');
    assert.equal(I.buildFeedItem({ kind: 'image', category: 'instagram', caption: '' }, 'https://x/y.jpg').caption, null);
    const src = read('lib/instagram-import.js');
    assert.match(src, /const captionOverrides = galleryCaption\.sanitizeCaptionMap\(captions, IG_MAX_COMMIT_MEDIA\);/);
    assert.match(read('server.js'), /captions: body\.captions && typeof body\.captions === 'object' \? body\.captions : null/);
    assert.deepEqual(R2.buildCaptionMap([
        { source: 'ig', permalink: 'https://www.instagram.com/p/A/', caption: ' editado ' },
        { source: 'ig', permalink: 'https://www.instagram.com/p/B/', caption: '' },
        { source: 'local', caption: 'no va' }, { source: 'ig', caption: 'sin permalink' }
    ]), { 'https://www.instagram.com/p/A/': 'editado', 'https://www.instagram.com/p/B/': '' });
    assert.deepEqual(R2.localFeedItem({ kind: 'image', caption: ' mi pie ' }, 'https://x/a.jpg', '2026-11-16T00:00:00.000Z'),
        { url: 'https://x/a.jpg', category: 'realizados', kind: 'image', created_at: '2026-11-16T00:00:00.000Z', caption: 'mi pie' });
    assert.equal('caption' in R2.localFeedItem({ kind: 'video' }, 'https://x/a.mp4', 'now'), false);
});

test('N3: el registro deja escribir el pie en "Tus trabajos" y lo manda al guardar', () => {
    const acceso = read('public/shared/js/acceso-register-final.js');
    assert.match(acceso, /root\.WoRegistroR2\.captionField\(item, persist\)/);
    const reg = read('public/shared/js/register.js');
    assert.match(reg, /body\.captions = window\.WoRegistroR2\.buildCaptionMap\(igItems\);/);
    assert.match(reg, /\.\.\.\(localCaption \? \{ caption: localCaption \} : \{\}\)/);
    assert.match(reg, /localCaptions: media\.filter\(/, 'los pies de los archivos locales sobreviven a la confirmación de email');
    const html = read('public/register-artist/index.html');
    assert.ok(html.indexOf('/shared/js/gallery-caption.js') < html.indexOf('/shared/js/registro-r2.js'));
    assert.ok(html.indexOf('/shared/js/registro-r2.js') < html.indexOf('/shared/js/register.js"'));
    assert.match(html, /\/shared\/css\/registro-r2\.css/);
});

test('N3: la galería del panel edita el pie de cualquier trabajo', () => {
    const feed = [{ url: 'a', kind: 'image', caption: 'viejo' }, { url: 'b', kind: 'image' }];
    const next = gallery.setCaption(feed, 1, '  nuevo pie\u0007 ');
    assert.equal(next[1].caption, 'nuevo pie');
    assert.equal(feed[1].caption, undefined, 'no muta el feed original');
    assert.equal('caption' in gallery.setCaption(feed, 0, '   ')[0], false);
    assert.deepEqual(gallery.setCaption(feed, 9, 'x'), feed);
    assert.equal(gallery.pickExtras({ caption: '  con espacios  ', title: 't' }).caption, 'con espacios');
    assert.equal('caption' in gallery.pickExtras({ caption: 12 }), false);
    const cell = gallery.cellMarkup({ url: 'https://x/a.jpg', kind: 'image', title: 'Rosa <b>', caption: 'pie' }, 1, 2, new Date());
    assert.match(cell, /data-gal-action="caption"/);
    assert.match(cell, /class="wod-gal-cap has-caption"/);
    assert.match(cell, /aria-label="Editar el pie de foto de Rosa &lt;b&gt;"/);
    assert.match(gallery.cellMarkup({ url: 'https://x/a.jpg', kind: 'image' }, 1, 2, new Date()), /aria-label="Agregar un pie de foto a Trabajo 2"/);
    assert.match(read('public/shared/js/dashboard-gallery.js'), /action === 'caption'/);
});

test('N3: la migración limpia el pie en la base (artistas y estudios) y tiene reversa', () => {
    const sql = read('supabase/migrations/20261116200000_gallery_caption_guard.sql');
    assert.doesNotMatch(sql, /^\s*(begin|commit);/mi);
    assert.match(sql, /create or replace function public\.wo_clean_gallery_caption\(p_text text\)/);
    assert.match(sql, /2200\)/);
    assert.match(sql, /before insert or update of gallery_feed_items on public\.artists_db/);
    assert.match(sql, /before insert or update of photo_feed_items on public\.studios/);
    assert.match(sql, /drop trigger if exists artists_db_gallery_caption_guard on public\.artists_db;/, 'idempotente');
    assert.match(sql, /set search_path = ''/);
    const down = read('supabase/rollbacks/20261116200000_gallery_caption_guard.down.sql');
    ['artists_db_gallery_caption_guard', 'studios_photo_caption_guard'].forEach((name) => {
        assert.match(down, new RegExp(`drop trigger if exists ${name} on`));
        assert.match(down, new RegExp(`drop function if exists public\\.${name}\\(\\);`));
    });
    assert.match(down, /drop function if exists public\.wo_clean_gallery_caption\(text\);/);
});

// ---------------------------------------------------------- N4 / N5 ----

test('N4: la pestaña del link decide entre avisar, terminar o ir al login', () => {
    const base = { confirmed: true, hasPending: true, hasSession: true, sameAccount: true };
    assert.equal(EC.linkTabAction({ ...base, waitingTab: true }), 'handoff');
    assert.equal(EC.linkTabAction({ ...base, waitingTab: false, claimedElsewhere: true }), 'handoff', 'segundo clic en el correo: no se procesa dos veces');
    assert.equal(EC.linkTabAction({ ...base, waitingTab: false }), 'complete');
    assert.equal(EC.linkTabAction({ ...base, hasSession: false }), 'login');
    assert.equal(EC.linkTabAction({ ...base, sameAccount: false }), 'dashboard');
    assert.equal(EC.linkTabAction({ confirmed: false, hasPending: false }), 'ignore');
    assert.equal(EC.linkTabAction({ confirmed: false, hasPending: true, hasSession: false }), 'ignore');
    assert.equal(EC.sessionMatches({ user: { id: 'u1', email: 'A@b.co' } }, { userId: 'u1' }), true);
    assert.equal(EC.sessionMatches({ user: { id: 'u2', email: 'A@b.co' } }, { userId: 'u1', email: 'a@B.co' }), true);
    assert.equal(EC.sessionMatches({ user: { id: 'u2', email: 'otra@b.co' } }, { userId: 'u1', email: 'a@b.co' }), false);
    assert.equal(EC.sessionMatches(null, { userId: 'u1' }), false);
});

test('N4: un alta pendiente la termina una sola pestaña (reclamo con vencimiento)', () => {
    const mem = new Map();
    const store = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
    assert.equal(EC.claimPending('artist-register', store), false, 'sin registro pendiente no hay nada que reclamar');
    EC.savePending('artist-register', { userId: 'u1', email: 'a@b.co' }, store);
    assert.equal(EC.claimPending('artist-register', store, 1000), true);
    const mine = EC.readPending('artist-register', store);
    assert.equal(mine.claimedBy, EC.TAB_ID);
    assert.equal(EC.isClaimedElsewhere(mine, 2000), false);
    // Otra pestaña la reclamó hace instantes: esta no la toca.
    EC.savePending('artist-register', { ...mine, claimedBy: 'otra-pestana', claimedAt: Date.now() }, store);
    assert.equal(EC.claimPending('artist-register', store), false);
    assert.equal(EC.isClaimedElsewhere(EC.readPending('artist-register', store)), true);
    // Reclamo viejo (pestaña cerrada a mitad): se puede retomar.
    EC.savePending('artist-register', { ...mine, claimedBy: 'otra-pestana', claimedAt: Date.now() - 10 * 60 * 1000 }, store);
    assert.equal(EC.claimPending('artist-register', store), true);
});

test('N4: la pestaña que espera detecta la sesión y avisa una sola vez', async () => {
    let calls = 0;
    let session = null;
    const client = { auth: { getSession: async () => ({ data: { session } }) } };
    const confirmed = [];
    const watcher = EC.watchConfirmation({
        key: 'r2-test', client, userId: 'u1', email: 'a@b.co',
        onConfirmed: (info) => { calls += 1; confirmed.push(info.via); }
    });
    await watcher.check();
    assert.equal(calls, 0);
    session = { user: { id: 'otro', email: 'x@y.z' } };
    await watcher.check();
    assert.equal(calls, 0, 'una sesión de otra cuenta no cuenta');
    session = { user: { id: 'u1', email: 'a@b.co' } };
    await watcher.check();
    await watcher.check();
    assert.equal(calls, 1);
    assert.deepEqual(confirmed, ['session']);
    watcher.stop();
});

test('N4: el registro del tatuador sigue en la pestaña original y la del link se despide', () => {
    const reg = read('public/shared/js/register.js');
    assert.match(reg, /key: ARTIST_CONFIRM_KEY,\s*userId: pendingUserId,\s*statusUrl: pendingUserId \? apiUrl\('\/api\/register\/confirmation-status\?uid='/);
    assert.match(reg, /onConfirmed: \(info\) => \{ continueArtistAfterConfirmationHere\(email, info\); \}/);
    assert.match(reg, /await EC\.announceConfirmed\(ARTIST_CONFIRM_KEY, \{ userId: session\.user\.id \}\)/);
    assert.match(reg, /function showArtistConfirmHandoff\(\)/);
    assert.match(reg, /signInWithPassword\(\{ email, password \}\)/, 'link abierto en otro dispositivo: entra con la contraseña en memoria');
    assert.match(reg, /if \(!pending\.membershipPending\) await persistSelectedStudioLocation\(pending\.studioId\);/);
    const ec = read('public/shared/js/email-confirmation.js');
    assert.match(ec, /Listo, ya puedes cerrar esta pestaña/);
    assert.match(ec, /'Email confirmado'/);
    assert.match(ec, /function tryCloseTab\(\)/);
    // El registro de cliente comparte el mecanismo.
    const client = read('public/client/register/index.html');
    assert.match(client, /key: CLIENT_REGISTER_WATCH_KEY,/);
    assert.match(client, /EC\.announceConfirmed\(CLIENT_REGISTER_WATCH_KEY/);
});

test('N4: GET /api/register/confirmation-status solo dice si la cuenta está confirmada', async () => {
    const uid = '4f6f2b1e-8a0c-4d6e-9f3a-2b7c1d5e9a10';
    const mkRes = () => {
        const res = { statusCode: 200, headers: {}, body: null };
        res.set = (k, v) => { res.headers[k] = v; return res; };
        res.status = (code) => { res.statusCode = code; return res; };
        res.json = (body) => { res.body = body; return res; };
        return res;
    };
    const requested = [];
    const handlers = (user, status = 200) => createHandlers({
        config: () => ({ supabaseUrl: 'https://proj.supabase.co/', serviceRoleKey: 'srv' }),
        fetchImpl: async (url, init) => { requested.push({ url, init }); return { ok: status === 200, status, json: async () => user }; },
        log: () => {}
    });
    let res = mkRes();
    await handlers({ id: uid, email: 'privado@example.invalid', email_confirmed_at: '2026-11-16T10:00:00Z' }).confirmationStatus({ query: { uid } }, res);
    assert.deepEqual(res.body, { success: true, confirmed: true });
    assert.equal(res.headers['Cache-Control'], 'no-store');
    assert.equal(requested[0].url, `https://proj.supabase.co/auth/v1/admin/users/${uid}`);
    assert.equal(JSON.stringify(res.body).includes('privado'), false, 'no expone el email');
    res = mkRes();
    await handlers({ id: uid, email_confirmed_at: null }).confirmationStatus({ query: { uid } }, res);
    assert.deepEqual(res.body, { success: true, confirmed: false });
    res = mkRes();
    await handlers(null, 404).confirmationStatus({ query: { uid } }, res);
    assert.deepEqual(res.body, { success: true, confirmed: false }, 'un uid inexistente responde igual que sin confirmar');
    res = mkRes();
    await handlers({}).confirmationStatus({ query: { uid: "1' or '1'='1" } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(isUuid(uid), true);
    assert.equal(isUuid('nope'), false);
    assert.equal(isConfirmedAuthUser({ confirmed_at: 'x' }), true);
    const routes = [];
    register({ get: (p, ...h) => routes.push([p, h.length]) }, { limiter: (req, r, next) => next() });
    assert.deepEqual(routes, [['/api/register/confirmation-status', 2]]);
    assert.match(read('server.js'), /require\('\.\/lib\/routes\/registro'\)\.register\(app\);/);
});

test('N5 (T1-2): el demo automático de una cuenta nueva no tapa el perfil real', () => {
    // Causa del bug: la primera entrada al panel de una cuenta nueva prende el
    // demo, que respondía get_my_artist_profile con su tabla vacía → el panel
    // creía que no había perfil y volvía al inicio del registro.
    global.self = global;
    const P = require('../public/shared/js/wo-demo-postgrest.js');
    const F = require('../public/shared/js/wo-demo-fixtures.js');
    F.EXTENSIONS.forEach((name) => require(`../public/shared/js/demo-fixtures/${name}.js`));
    const identity = { userId: '11111111-1111-4111-8111-111111111111', email: 'nueva@example.invalid', username: 'nueva.wo', name: 'Nueva', createdAt: new Date().toISOString() };
    const fx = F.build(identity);
    const store = P.createStore({ tables: fx.tables, relations: fx.relations, rpcs: fx.rpcs, views: fx.views });
    const rpc = store.rpcs.get_my_artist_profile;
    assert.equal(typeof rpc.demoApplies, 'function');
    const hadTable = store.has('artists_db');
    assert.equal(rpc.demoApplies(store, { userId: identity.userId }), false, 'sin la fila propia, la lectura va al backend real');
    assert.equal(store.has('artists_db'), hadTable, 'consultar no crea la tabla en el store');
    assert.equal(store.rpcs.upsert_my_artist_profile.demoApplies(store, { userId: identity.userId }), false);
    // Preview local con el artista ficticio sembrado: ahí sí se emula.
    store.load({ artists_db: [{ user_id: identity.userId, name: 'Nueva', username: 'nueva.wo' }] });
    assert.equal(rpc.demoApplies(store, { userId: identity.userId }), true);
    assert.equal(rpc({}, store, { userId: identity.userId })[0].name, 'Nueva');
    assert.equal(rpc.demoApplies(store, { userId: 'otro' }), false);
    const demo = read('public/shared/js/wo-demo.js');
    assert.match(demo, /typeof rpc\.demoApplies !== 'function'\s*\|\| rpc\.demoApplies\(st, \{ userId: identity\.userId, identity: identity \}\) !== false/);
    assert.match(demo, /if \(!rpcApplies\) \{\s*if \(isRead \|\| READ_ONLY_RPC\.test\(fn\)\) return passThrough\(input, init, null\);/);
});

test('N5: con el perfil completo, /register-artist no vuelve a mostrar el paso 01', () => {
    const complete = {
        user_id: 'u1', username: 'ana.wo', name: 'Ana Ruiz', email: 'a@b.co', ubicacion: 'Lima', styles_array: ['Realismo'],
        years_experience: '3-5', session_price: '100 USD', instagram: '@ana', work_type: 'independent', birth_date: '1990-01-01',
        subscribed_newsletter: false, registration_step: 12, registration_submitted_at: '2026-11-15T03:36:35Z'
    };
    const done = progress.analyzeArtistProfile(complete);
    assert.equal(done.isComplete, true);
    const base = { hasSession: true, preAuth: false, artist: complete, progress: done };
    assert.equal(R2.shouldSkipWizard({ ...base, search: '?returnTo=%2Fartist%2Fdashboard' }), true, 'el rebote desde el panel');
    assert.equal(R2.shouldSkipWizard({ ...base, search: '' }), true);
    assert.equal(R2.shouldSkipWizard({ ...base, search: '?resumeStep=5' }), false);
    assert.equal(R2.shouldSkipWizard({ ...base, search: '?startOver=1' }), false);
    assert.equal(R2.shouldSkipWizard({ ...base, preAuth: true, search: '' }), false, 'el alta nueva nunca se saltea');
    assert.equal(R2.shouldSkipWizard({ ...base, hasSession: false, search: '' }), false);
    assert.equal(R2.shouldSkipWizard({ ...base, artist: null, search: '' }), false);
    const pending = { ...complete, styles_array: [], estilo: '' };
    assert.equal(R2.shouldSkipWizard({ ...base, artist: pending, progress: progress.analyzeArtistProfile(pending), search: '' }), false,
        'si faltan datos, el wizard sigue siendo el lugar para completarlos');
    assert.equal(R2.isSubmittedRegistration(complete), true);
    assert.equal(R2.isSubmittedRegistration({ user_id: 'u1', registration_step: 4 }), false);
    assert.equal(R2.isSubmittedRegistration({ registration_step: 12 }), false, 'un borrador sin cuenta no es un perfil enviado');
    assert.match(read('public/shared/js/register.js'), /if \(session && !treatAsPreAuth && showProfileAlreadyCreated\(\)\) return;/);
});

test('N5: recargar "Falta confirmar email" vuelve a mostrar la espera, no el paso 01 vacío', () => {
    const reg = read('public/shared/js/register.js');
    assert.match(reg, /if \(!confirmed\) \{[\s\S]{0,400}return showArtistPendingConfirmationAgain\(pending\);/);
    const fn = reg.slice(reg.indexOf('function showArtistPendingConfirmationAgain(pending)'), reg.indexOf('function showArtistConfirmHandoff()'));
    assert.match(fn, /if \(!pending \|\| !pending\.userId \|\| !pending\.email\) return false;/);
    assert.match(fn, /params\.get\('startOver'\) === '1' \|\| params\.get\('source'\) === 'instagram'/, 'no secuestra un registro nuevo');
    assert.match(fn, /draftParam && pending\.draftId && draftParam !== pending\.draftId/);
    assert.match(fn, /renderArtistEmailConfirmation\(pending\.email\);\s*goToStep\('success'\);/);
    assert.match(reg, /draftId: registrationDraftId \|\| finalizeData\.draft_id \|\| null,/);
    assert.match(reg, /if \(pending && !getPortfolioMediaDraft\(\)\.length\) await restoreArtistPendingDraft\(pending\);/);
});

// ---------------------------------------------------------------- N6 ----

test('N6: los tres logins tienen un botón de texto visible para el enlace mágico', () => {
    const artist = read('public/artist/login/index.html');
    assert.match(artist, /id="btn-magic-link" onclick="handleArtistMagicLink\(this\)"[^>]*>\s*<span class="btn-text">Entrar con un enlace por email<\/span>/);
    assert.ok(artist.indexOf('id="btn-login"') < artist.indexOf('id="btn-magic-link"'), 'debajo del botón de ingresar');
    assert.ok(artist.indexOf('id="btn-magic-link"') < artist.indexOf('wo-auth-social-row'), 'antes de la fila de redes');
    const js = read('public/shared/js/artist-login.js');
    assert.match(js, /async function handleArtistMagicLink\(button\)[\s\S]{0,400}await handleArtistSocialLogin\('email'\);/);
    assert.match(js, /shouldCreateUser: false/, 'mismo flujo: no crea cuentas y responde neutro');
    assert.match(read('public/client/login/index.html'), /id="btn-client-magic-link-text" onclick="handleClientMagicLink\(\)">Entrar con un enlace por email<\/button>/);
    assert.match(read('public/shared/js/client-auth.js'), /\['btn-client-magic-link', 'btn-client-magic-link-text'\]/);
    assert.match(read('public/studio/login/index.html'), /id="studio-magic-link" class="wo-auth-back">Entrar con un enlace por email<\/button>/);
});

// ---------------------------------------------------------------- N1 ----

test('N1: en el registro el foco no usa el azul del DS y sigue siendo visible con teclado', () => {
    const css = read('public/shared/css/registro-r2.css');
    assert.match(css, /body\.register-page,\s*body\.cw-page,\s*body\.registerclosedbeta-page\{\s*--border-focus:var\(--ink\);\s*--shadow-focus:0 0 0 2px var\(--surface-page\),0 0 0 4px var\(--ink\);/);
    const focusBlock = css.slice(css.indexOf('N1 · foco'), css.indexOf('N3 · pie de foto'));
    assert.doesNotMatch(focusBlock, /blue/);
    assert.doesNotMatch(css, /rgba\(0,\s*85,\s*255/);
    ['public/register-artist/index.html', 'public/registerclosedbeta/index.html', 'public/client/register/index.html'].forEach((file) => {
        const html = read(file);
        const own = html.indexOf('/shared/css/registro-r2.css');
        assert.ok(own > html.indexOf('/shared/css/ds/components.css'), `${file}: se carga después del DS`);
    });
});

// --------------------------------------------------------------- P31 ----

test('P31: el registro de cliente ofrece los 30 estilos principales del catálogo, cada uno con su foto', () => {
    const principales = catalogs.STYLE_GROUPS.find((g) => g.id === 'principales').styles.map((s) => s.label);
    assert.deepEqual(clientStyles.STYLES, principales, 'mismos nombres que eligen los tatuadores');
    assert.equal(clientStyles.names().length, 31);
    assert.equal(clientStyles.names()[30], 'Otro');
    const paths = clientStyles.STYLES.map(clientStyles.photoPath);
    assert.equal(new Set(paths).size, 30);
    paths.forEach((p) => assert.match(p, /^\/shared\/assets\/ronda2\/registro\/estilos\/[a-z0-9-]+\.webp$/));
    assert.equal(clientStyles.photoPath('Tradicional Japonés (Irezumi)'), '/shared/assets/ronda2/registro/estilos/tradicional-japones.webp');
    assert.equal(clientStyles.photoPath('Otro'), '');
    assert.equal(clientStyles.photoPath('../../etc" onerror="x'), '', 'un nombre fuera del catálogo no arma rutas');
    const html = read('public/client/register/index.html');
    assert.match(html, /stylesCatalog = WoClientStyles\.names\(\);/);
    assert.match(html, /WoClientStyles\.decorate\(btn, name, i\);/);
    const js = read('public/client/register/estilos-r2.js');
    assert.match(js, /holder\.classList\.add\('is-fallback'\);/, 'respaldo visual si la foto todavía no existe');
});

test('P31: el manifiesto de assets lista una foto por estilo, en la carpeta del frente', () => {
    const manifest = JSON.parse(read('docs/plans/ronda2-assets/registro.json'));
    assert.equal(manifest.length, 30);
    const expected = new Set(clientStyles.STYLES.map((name) => 'public' + clientStyles.photoPath(name)));
    manifest.forEach((entry) => {
        assert.ok(expected.has(entry.path), entry.path);
        assert.match(entry.aspect, /^(1:1|4:3|3:4|16:9)$/);
        assert.ok(entry.prompt.length > 80 && /no text/i.test(entry.prompt) && /no nudity/i.test(entry.prompt));
        assert.ok(entry.uso);
        // Las fotos las genera el orquestador (ya entraron al repo con los assets de la
        // ronda 2): el frente solo fija dónde van. Si el archivo está, no viene vacío; si
        // falta, la página muestra el respaldo (is-fallback).
        assert.match(entry.path, /^public\/shared\/assets\/ronda2\/registro\/estilos\/[a-z0-9-]+\.webp$/);
        const file = path.join(root, entry.path);
        if (fs.existsSync(file)) assert.ok(fs.statSync(file).size > 1024, `${entry.path} vacío`);
    });
});

// ------------------------------------------------------------ idioma ----

test('textos nuevos en español neutro (sin voseo)', () => {
    // Formas voseantes (acento en la última sílaba): "revisá", "podés", "elegí"…
    // Las formas de tuteo ("revisa", "puedes", "elige") no coinciden.
    const voseo = /(^|[^a-záéíóúñ])(querés|podés|tenés|sabés|necesitás|elegí|escribí|revisá|ingresá|probá|contanos|escribinos|hacé|mirá|abrí|copiá|cerrá|esperá|tocá|usá|subí|agregá|completá|confirmá|volvé|seguí|iniciá|pedí)(?![a-záéíóúñ])/i;
    const newFiles = [
        'public/shared/js/registro-r2.js', 'public/shared/js/gallery-caption.js', 'public/client/register/estilos-r2.js',
        'lib/routes/registro.js', 'lib/instagram-profile-contact.js', 'public/shared/css/registro-r2.css'
    ];
    newFiles.forEach((file) => {
        const strings = read(file).match(/'[^'\n]{12,}'|"[^"\n]{12,}"/g) || [];
        strings.forEach((s) => assert.doesNotMatch(s, voseo, `${file}: ${s}`));
    });
    const ec = read('public/shared/js/email-confirmation.js');
    const r2Block = ec.slice(ec.indexOf('registro (ronda 2 · N4) ── continuar'), ec.indexOf('RESEND_COOLDOWN_SECONDS: RESEND_COOLDOWN_SECONDS'));
    (r2Block.match(/'[^'\n]{12,}'/g) || []).forEach((s) => assert.doesNotMatch(s, voseo, s));
});

// RS-04: el alta de artista pide hasta 50 miniaturas y sondea la confirmación cada 12 s. Con el
// limitador global de 300 por IP, dos o tres altas desde la misma red dejaban todo /api/ en 429.
test('RS-04: las miniaturas de Instagram y el sondeo de confirmación no gastan el limitador global', () => {
    const server = read('server.js');
    const reSource = /const OWN_LIMITED_GET_RE = (\/.+\/i);\n/.exec(server);
    const fnSource = /const hasOwnGetLimiter = (\(req\) => .+);\n/.exec(server);
    assert.ok(reSource && fnSource, 'server.js define la excepción');
    const hasOwnGetLimiter = new Function(`const OWN_LIMITED_GET_RE = ${reSource[1]}; return ${fnSource[1]};`)();
    // req con forma de Express montado en app.use('/api/'): baseUrl '/api', path sin query.
    const req = (method, p, extra = {}) => Object.assign({ method, baseUrl: '/api', path: p }, extra);
    for (const p of ['/instagram/proxy-thumb', '/register/confirmation-status', '/register/confirmation-status/', '/Instagram/Proxy-Thumb']) {
        assert.equal(hasOwnGetLimiter(req('GET', p)), true, p);
    }
    for (const p of ['/instagram/preview', '/instagram/commit', '/register/artist-finalize', '/register/artist-draft', '/instagram/proxy-thumb/extra']) {
        assert.equal(hasOwnGetLimiter(req('GET', p)), false, p);
    }
    assert.equal(hasOwnGetLimiter(req('POST', '/instagram/proxy-thumb')), false, 'solo GET');
    assert.equal(hasOwnGetLimiter(req('POST', '/register/confirmation-status')), false);
    // Un query string con la ruta exceptuada no saltea el límite global.
    assert.equal(hasOwnGetLimiter(req('GET', '/gemini/generate-image', { originalUrl: '/api/gemini/generate-image?x=/api/instagram/proxy-thumb' })), false);
    assert.equal(hasOwnGetLimiter({ method: 'GET', originalUrl: '/api/instagram/proxy-thumb' }), false);

    assert.match(server, /skip: \(req\) => storeOrders\.isStoreWebhookRequest\(req\) \|\| require\('\.\/lib\/routes\/cot-form'\)\.isOwnLimitedPath\(req\) \|\| hasOwnGetLimiter\(req\),/);
    // Las dos rutas exceptuadas tienen su propio limitador.
    assert.match(server, /const igThumbLimiter = rateLimit\(\{\s+windowMs: 15 \* 60 \* 1000,\s+max: 600,/);
    assert.match(server, /app\.get\('\/api\/instagram\/proxy-thumb', igThumbLimiter, async \(req, res\) => \{/);
    assert.match(read('lib/routes/registro.js'), /app\.get\('\/api\/register\/confirmation-status', limiter, handlers\.confirmationStatus\);/);
    assert.match(server, /'Demasiadas imágenes seguidas\. Prueba de nuevo en unos minutos\.'/);
});
