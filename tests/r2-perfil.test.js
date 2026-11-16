'use strict';

// Ronda 2 · frente "perfil": perfil público del artista y compartir.
//   N7  sin la banda de entrada "Portafolio"
//   N8  compartir: historia de Instagram, sin Mail / Telegram / LinkedIn
//   N9  el modo dueño sale solo de la sesión real (bug T2-5)
//   P21 insignias Embajador y Most Wanted
//   +   orden para el visitante, pie de foto, favoritos / denuncia y tarjeta OG

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const express = require('express');

const root = path.resolve(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8').replace(/\r\n/g, '\n');
// Código sin comentarios (los comentarios explican el bug y nombran lo que se quitó).
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const MostWanted = require('../lib/most-wanted');
const ProfileMeta = require('../lib/profile-meta');
const Presentation = require('../public/shared/js/artist-profile-presentation.js');
const ShareCards = require('../public/shared/js/wo-share-cards.js');
const ShareSheet = require('../public/shared/js/wo-share-sheet.js');
const { register, createProfileRoutes, hashIp, mostWantedIntervalMs } = require('../lib/routes/perfil');
const { createArtistsPublicRepo } = require('../lib/repos/artists-public');
const { createPerfilTrendingRepo, normalizeChannel } = require('../lib/repos/perfil-trending');

const HTML = read('public', 'artist', 'profile', 'index.html');
const PROFILE_JS = read('public', 'shared', 'js', 'artist-profile.js');
const SHEET_JS = read('public', 'shared', 'js', 'wo-share-sheet.js');
const DASH_SHARE_JS = read('public', 'shared', 'js', 'dashboard-share.js');
const CARDS_JS = read('public', 'shared', 'js', 'wo-share-cards.js');
const SQL = read('supabase', 'migrations', '20261116180000_perfil_insignias_most_wanted.sql');
const DOWN = read('supabase', 'rollbacks', '20261116180000_perfil_insignias_most_wanted.down.sql');

const UID = '3f2b8c1e-1a2b-4c3d-8e9f-0a1b2c3d4e5f';
const OTHER = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const ARTIST = {
    user_id: UID,
    username: 'lauumarth.wo',
    name: 'Lau Marth',
    profile_picture: 'https://flbgmlvfiejfttlawnfu.supabase.co/storage/v1/object/public/profile-pictures/x/lau.jpg',
    gallery_images: [],
    city: 'Buenos Aires',
    country: 'Argentina',
    styles_array: ['Fine line', 'Botánico', 'Blackwork', 'Realismo'],
    bio_description: ''
};

// ---------------------------------------------------------------------------
// N9 · quién mira el perfil
// ---------------------------------------------------------------------------

test('N9: el modo dueño sale solo de la sesión del artista de ese perfil', () => {
    const kind = Presentation.resolveViewerKind;
    assert.equal(kind({ artistUserId: UID, sessionUserId: UID }), 'owner');
    assert.equal(kind({ artistUserId: UID, sessionUserId: UID.toUpperCase() }), 'owner');
    assert.equal(kind({ artistUserId: UID, sessionUserId: '' }), 'guest');
    assert.equal(kind({ artistUserId: UID }), 'guest');
    assert.equal(kind({ artistUserId: UID, sessionUserId: OTHER }), 'client');
    assert.equal(kind({ artistUserId: UID, sessionUserId: OTHER, isArtistAccount: true }), 'artist');
    // Ningún flag convierte a un visitante en dueño (ni demo ni configuración).
    assert.equal(kind({ artistUserId: UID, sessionUserId: '', demoEnabled: true, demoUserId: UID, demo: true }), 'guest');
    assert.equal(kind({ artistUserId: '', sessionUserId: '' }), 'guest');
    assert.equal(kind(), 'guest');
});

test('N9: artist-profile.js ya no usa isDemoMode y repinta al volver con Atrás', () => {
    const code = stripComments(PROFILE_JS);
    assert.doesNotMatch(code, /isDemoMode/, 'el flag features.demoMode (true por defecto hasta cargar la config) no decide quién mira');
    const fn = code.slice(code.indexOf('async function resolveViewer'), code.indexOf('async function refreshViewer'));
    assert.match(fn, /_supabase\?\.auth\?\.getSession/);
    assert.match(fn, /decide\(\{ artistUserId, sessionUserId \}\)/);
    assert.doesNotMatch(fn, /return \{ kind: 'owner', session: null/, 'no hay dueño sin sesión');
    // Mismo estado al cargar y al volver: bfcache y cambios de sesión.
    assert.match(code, /window\.addEventListener\('pageshow', \(event\) => \{\s*if \(event\.persisted\) void refreshViewer\(\);/);
    assert.match(code, /onAuthStateChange/);
    assert.match(code, /if \(sessionUserId === \(viewer\.session\?\.user\?\.id \|\| ''\)\) return;/);
    // Al cerrar sesión vuelve la barra pública del HTML.
    assert.match(code, /if \(!document\.getElementById\('profile-topbar-cta'\)\) slot\.innerHTML = publicTopbarHtml;/);
    // La franja del dueño sigue atada a isOwnerView().
    assert.match(code, /if \(ownerBar\) ownerBar\.hidden = !owner;/);
});

// ---------------------------------------------------------------------------
// N7 + mejora general · HTML del perfil
// ---------------------------------------------------------------------------

test('N7: no queda la banda de entrada "Portafolio" y la galería principal sigue', () => {
    assert.doesNotMatch(HTML, /portfolio-intro-band|portfolio-intro-chips|portfolio-intro-title/);
    assert.equal(HTML.split('>Portafolio</h2>').length - 1, 1, 'un solo título Portafolio');
    assert.match(HTML, /<section class="profile-band gallery-band reveal-block" id="block-gallery" aria-labelledby="gallery-title">/);
    assert.match(HTML, /id="gallery-grid" aria-live="polite"/);
    assert.match(HTML, /id="gallery-chips" role="group" aria-label="Filtrar el portafolio" hidden/);
});

test('jerarquía del visitante: identidad → portafolio → cotizar y turnos → sobre → reseñas → ubicación', () => {
    const order = [
        'class="profile-band hero-band', 'id="stats-band"', 'id="block-gallery"', 'cta-band reveal-block', 'id="turnos"',
        'sobre-band reveal-block', 'id="specialties-band"', 'id="store-band"', 'id="artist-reviews-panel"',
        'id="studio-band"', 'id="presence-band"', 'id="cities-band"', 'id="profile-report-band"', '</main>'
    ].map((needle) => [needle, HTML.indexOf(needle)]);
    for (const [needle, index] of order) assert.ok(index > -1, `falta ${needle}`);
    for (let i = 1; i < order.length; i += 1) {
        assert.ok(order[i][1] > order[i - 1][1], `${order[i][0]} va después de ${order[i - 1][0]}`);
    }
    // Cotizar siempre a mano: en el hero y en la banda de disponibilidad.
    assert.match(HTML, /id="quote-cta-top-btn" href="\/quotation">Solicitar cotización<\/a>/);
    assert.match(HTML, /id="quote-cta-band-btn" href="\/quotation">Solicitar cotización →<\/a>/);
    assert.match(PROFILE_JS, /\['quote-cta-top-btn', 'quote-cta-bar-btn', 'quote-cta-band-btn', 'gallery-empty-cta'\]/);
    assert.match(HTML, /\/shared\/css\/artist-profile-r2\.css/);
});

test('estado vacío del portafolio: tarjeta con salida para el visitante, sin huecos', () => {
    assert.match(HTML, /<div class="gallery-empty-card" id="gallery-empty-card" hidden>/);
    assert.match(HTML, /id="gallery-empty-cta" href="\/quotation">Solicitar cotización/);
    assert.match(PROFILE_JS, /const emptyForVisitor = !owner && !galleryItems\.length;/);
    assert.match(PROFILE_JS, /if \(emptyCard\) emptyCard\.hidden = !emptyForVisitor;/);
    assert.match(PROFILE_JS, /if \(head\) head\.hidden = emptyForVisitor;/);
    // Sin trabajos el visitante no ve celdas punteadas.
    const fnSrc = PROFILE_JS.slice(PROFILE_JS.indexOf('function gallerySlotCount'), PROFILE_JS.indexOf('function renderGalleryGrid'));
    const gallerySlotCount = new Function('MIN_GALLERY_SLOTS', `${fnSrc}; return gallerySlotCount;`)(9);
    assert.equal(gallerySlotCount(0, false), 0);
    assert.equal(gallerySlotCount(5, false), 5);
    assert.equal(gallerySlotCount(5, true), 9);
    // Un solo chip "Todos" no se muestra.
    assert.match(PROFILE_JS, /chips\.hidden = options\.length < 2 \|\| \(!galleryItems\.length && !isOwnerView\(\)\);/);
});

test('pie de foto: se muestra saneado en la grilla y en el visor si el ítem trae caption', () => {
    const c = Presentation.workCaption;
    assert.equal(c('  Lobo en   blackwork\ncon sombras  '), 'Lobo en blackwork con sombras');
    assert.equal(c({ caption: 'Rosa fine line' }), 'Rosa fine line');
    assert.equal(c('Peonía en el antebrazo #tattoo #fineline @estudio.norte'), 'Peonía en el antebrazo');
    assert.equal(c('#tattoo #ink'), '');
    assert.equal(c(''), '');
    assert.equal(c(null), '');
    assert.equal(c('<b>hola</b>'), '<b>hola</b>', 'es texto: el HTML lo escapa quien lo pinta');
    const long = c('palabra '.repeat(60), 80);
    assert.ok(long.length <= 80 && long.endsWith('…'), long);
    assert.equal(c('a\u0000b\u200bc'), 'a b c');

    assert.match(PROFILE_JS, /const caption = galleryCaptionOf\(raw\);/);
    assert.match(PROFILE_JS, /\$\{caption \? `<figcaption class="gallery-caption">\$\{escapeHtml\(caption\)\}<\/figcaption>` : ''\}/);
    assert.match(PROFILE_JS, /caption\.textContent = item\.caption \|\| '';/);
    assert.match(HTML, /<p class="lightbox-caption" id="lightbox-caption" hidden><\/p>/);
});

test('contratos entre frentes: favoritos en la cabecera y en cada trabajo, y denuncia del perfil', () => {
    // Cabecera: botón vacío con el contrato; artist-profile.js completa los datos.
    assert.match(HTML, /<button type="button" class="profile-fav hero-cta-fav" id="profile-fav-btn" data-wo-favorite data-kind="artist" data-id="" data-label="" data-image="" aria-label="Guardar este perfil en favoritos" hidden><\/button>/);
    assert.match(PROFILE_JS, /favBtn\.dataset\.id = userId;/);
    assert.match(PROFILE_JS, /favBtn\.hidden = !userId \|\| isOwnerView\(\);/);
    // Cada trabajo: kind="design" con id estable, etiqueta e imagen escapadas.
    assert.match(PROFILE_JS, /data-wo-favorite data-kind="design" data-id="\$\{escapeHtml\(favId\)\}" data-label="\$\{escapeHtml\(favLabel\)\}" data-image="\$\{escapeHtml\(/);
    assert.equal(Presentation.favoriteWorkId(UID, 'trabajo 1.jpg'), `${UID}:trabajo-1.jpg`);
    assert.equal(Presentation.favoriteWorkId('', 'x'), '');
    assert.equal(Presentation.favoriteWorkId(UID, ''), '');
    // El favorito no abre el visor: es hermano del botón de la imagen, no hijo.
    const cell = PROFILE_JS.slice(PROFILE_JS.indexOf('<figure class="gallery-cell'), PROFILE_JS.indexOf('</figure>'));
    assert.ok(cell.indexOf('</button>') < cell.indexOf('${favButton}'), 'botones hermanos');
    // Denuncia: solo artistas con sesión que no son el dueño.
    assert.match(HTML, /<button type="button" class="profile-report-btn" id="profile-report-btn" data-wo-report data-kind="artist" data-id="" data-label="">Denunciar perfil<\/button>/);
    assert.match(HTML, /id="profile-report-band" hidden/);
    assert.match(PROFILE_JS, /const canReport = Boolean\(userId\) && viewer\.kind === 'artist';/);
    assert.match(PROFILE_JS, /reportBtn\.dataset\.id = userId;/);
    // Sin el módulo del otro frente, los botones no se ven (nunca un botón muerto).
    const css = read('public', 'shared', 'css', 'artist-profile-r2.css');
    assert.match(css, /\.profile-fav \{\s*display: none;/);
    assert.match(css, /html\.wo-has-favorites \.profile-fav:not\(\[hidden\]\) \{\s*display: inline-flex;/);
    assert.match(css, /\.profile-report-band \{\s*display: none;/);
    assert.match(css, /html\.wo-has-report \.profile-report-band:not\(\[hidden\]\) \{\s*display: block;/);
    assert.match(PROFILE_JS, /favorites: \{ src: '\/shared\/js\/wo-favorites\.js', flag: 'wo-has-favorites'/);
    assert.match(PROFILE_JS, /report: \{ src: '\/shared\/js\/wo-report\.js', flag: 'wo-has-report'/);
    assert.match(PROFILE_JS, /script\.onerror = \(\) => \{ script\.remove\(\); resolve\(false\); \};/);
});

// ---------------------------------------------------------------------------
// P21 · insignias
// ---------------------------------------------------------------------------

test('P21: insignias de la cabecera (Verificado, Embajador, Most Wanted) sin conteos', () => {
    const build = Presentation.buildProfileBadges;
    assert.deepEqual(build({}), []);
    assert.deepEqual(build({ embajador: 'si' }).map((b) => b.id), ['ambassador']);
    assert.deepEqual(build({ embajador: 'pendiente' }), []);
    assert.deepEqual(build({ embajador: 'No' }), []);
    // La RPC manda sobre la columna.
    assert.deepEqual(build({ embajador: 'si', badges: { ambassador: false } }), []);
    const all = build({ verified: true, badges: { ambassador: true, most_wanted: true, most_wanted_rank: 2, most_wanted_zone: 'Buenos Aires' } });
    assert.deepEqual(all.map((b) => b.id), ['verified', 'ambassador', 'most-wanted']);
    assert.equal(all[2].label, 'Most Wanted · Buenos Aires');
    assert.equal(all[2].rank, 2);
    assert.match(all[2].title, /más buscados de Buenos Aires en los últimos 30 días/);
    assert.equal(build({ badges: { most_wanted: true } })[0].label, 'Most Wanted');
    assert.ok(Presentation.isAmbassador('Sí') && Presentation.isAmbassador(true) && !Presentation.isAmbassador(null));

    assert.match(HTML, /id="artist-ambassador-badge" hidden>[\s\S]*?Embajador We Ötzi/);
    assert.match(HTML, /id="artist-most-wanted-badge" hidden>[\s\S]*?id="artist-most-wanted-text">Most Wanted</);
    assert.match(PROFILE_JS, /vacation_start,vacation_end,embajador`/);
    assert.match(PROFILE_JS, /build\(\{ badges: publicBadges, embajador: artistData\?\.embajador \}\)/);
    const repo = read('public', 'shared', 'js', 'data', 'profile-public-repo.js');
    assert.match(repo, /client\.rpc\('get_artist_public_badges', \{ p_artist_user_id: artistUserId \}\)/);
    assert.match(repo, /D\.from\('artist_most_wanted'\)\s*\.select\('artist_user_id, rank'\)/);
    assert.doesNotMatch(repo, /\/rest\/v1\//, 'siempre por la capa de datos');
});

test('Most Wanted: puntaje, topes, mínimo de actividad y cupos por zona', () => {
    assert.deepEqual(MostWanted.WEIGHTS, { visits: 1, quotes: 6, favorites: 4, shares: 3, completed: 8 });
    assert.equal(MostWanted.WINDOW_DAYS, 30);
    assert.equal(MostWanted.trendScore({ visits: 10, quotes: 2, favorites: 1, shares: 3, completed: 1 }), 10 + 12 + 4 + 9 + 8);
    // Topes: 300 visitas y 40 compartidos.
    assert.equal(MostWanted.trendScore({ visits: 5000 }), 300);
    assert.equal(MostWanted.trendScore({ shares: 500 }), 120);
    // Valores raros no rompen ni suman.
    assert.equal(MostWanted.trendScore({ visits: -4, quotes: 'x', favorites: null, shares: 2.9 }), 6);
    assert.equal(MostWanted.trendScore(), 0);
    assert.equal(MostWanted.signalCount({ visits: 3, quotes: 1 }), 2);
    // Mínimo: 12 puntos, dos señales distintas Y una que no dependa solo del artista.
    assert.equal(MostWanted.isEligible({ quotes: 3, quotesAccount: 3 }), false, 'una sola señal no alcanza');
    assert.equal(MostWanted.isEligible({ visits: 5, quotes: 1, quotesAccount: 1 }), false, '11 puntos');
    assert.equal(MostWanted.isEligible({ visits: 6, quotes: 1, quotesAccount: 1 }), true);
    assert.equal(MostWanted.isEligible({ quotes: 1, completed: 1 }), true);
    assert.equal(MostWanted.isEligible({}), false, 'un perfil vacío nunca gana');
    // SEG-06: lo que el artista puede generar solo no alcanza para la insignia.
    assert.deepEqual(MostWanted.INDEPENDENT_SIGNALS, ['quotesAccount', 'favorites', 'completed']);
    assert.equal(MostWanted.trendScore({ visits: 3, shares: 3 }), 12);
    assert.equal(MostWanted.isEligible({ visits: 3, shares: 3 }), false, 'compartir su perfil y abrirlo sin sesión');
    assert.equal(MostWanted.isEligible({ visits: 300, shares: 40 }), false, 'ni con los topes: 420 puntos sin nadie más');
    assert.equal(MostWanted.trendScore({ quotes: 5, visits: 1 }), 31);
    assert.equal(MostWanted.isEligible({ quotes: 5, visits: 1 }), false, 'solo solicitudes de invitado');
    assert.equal(MostWanted.isEligible({ quotes: 5, quotesAccount: 1, visits: 1 }), true, 'al menos un cliente con cuenta');
    assert.equal(MostWanted.isEligible({ visits: 8, favorites: 1 }), true, 'un favorito es de otra cuenta');
    assert.equal(MostWanted.isEligible({ visits: 20, quotesAccount: 4 }), false, 'quotesAccount nunca supera a quotes');
    assert.equal(MostWanted.hasIndependentSignal({ shares: 9, visits: 9, quotes: 2 }), false);
    // Cotizaciones: clientes con cuenta sin tope, invitados hasta 3.
    assert.equal(MostWanted.CAPS.guestQuotes, 3);
    assert.deepEqual(MostWanted.quoteCount({ account: 2, guest: 9 }), { quotes: 5, quotesAccount: 2 });
    assert.deepEqual(MostWanted.quoteCount({ guest: 2 }), { quotes: 2, quotesAccount: 0 });
    assert.deepEqual(MostWanted.quoteCount(), { quotes: 0, quotesAccount: 0 });
    // Cupos: 1 hasta 4 perfiles, 2 hasta 8, 3 desde 9.
    assert.deepEqual([1, 4, 5, 8, 9, 40].map((n) => MostWanted.topNForZone(n)), [1, 1, 2, 2, 3, 3]);
    assert.equal(MostWanted.topNForZone(40, 1), 1);
    assert.equal(MostWanted.zoneNorm('  Ciudad   de MÉXICO '), 'ciudad de mexico');
    assert.equal(MostWanted.zoneNorm(''), null);
});

test('Most Wanted: zonas por ciudad (3 o más perfiles) o país, y ranking determinista', () => {
    const artists = [
        { userId: 'a1', city: 'Buenos Aires', country: 'Argentina', visits: 40, quotes: 3, quotesAccount: 2 },
        { userId: 'a2', city: 'buenos aires', country: 'argentina', visits: 10, quotes: 1, completed: 1 },
        { userId: 'a3', city: 'BUENOS  AIRES', country: 'Argentina', quotes: 4 },
        { userId: 'a4', city: 'Buenos Aires', country: 'Argentina' },
        { userId: 'a5', city: 'Buenos Aires', country: 'Argentina', visits: 200 },
        { userId: 'p1', city: 'Pilar', country: 'Argentina', visits: 8, favorites: 2 },
        { userId: 'p2', city: 'Acassuso', country: 'Argentina', visits: 7, shares: 2 },
        { userId: 'n1', city: '', country: '', visits: 90, quotes: 9, quotesAccount: 9 },
        { userId: 's1', city: 'Sin ciudad', country: 'Chile', quotes: 2, quotesAccount: 1, visits: 3 },
        // SEG-06: mucho puntaje propio (visitas sin sesión, compartidos, invitados) y nadie más.
        { userId: 'x1', city: 'Lima', country: 'Perú', visits: 300, shares: 40, quotes: 3 }
    ];
    const zones = Object.fromEntries(MostWanted.assignZones(artists).map((z) => [z.userId, z]));
    assert.equal(zones.a1.zoneKey, 'city:buenos aires|argentina');
    assert.equal(zones.a3.zoneKey, zones.a1.zoneKey, 'mayúsculas y espacios no parten la zona');
    assert.equal(zones.p1.zoneKey, 'country:argentina', 'ciudad chica → resto del país');
    assert.equal(zones.p1.zoneLevel, 'country');
    assert.equal(zones.n1.zoneKey, null, 'sin ciudad ni país no participa');
    assert.equal(zones.s1.zoneKey, 'country:chile', '"Sin ciudad" es ciudad vacía');

    const { scores, winners } = MostWanted.rankMostWanted(artists);
    const byId = Object.fromEntries(scores.map((s) => [s.userId, s]));
    assert.equal(byId.a4, undefined, 'sin actividad no se guarda puntaje');
    assert.equal(byId.a1.score, 58);
    assert.equal(byId.a5.eligible, false, 'solo visitas: una señal');
    assert.equal(byId.a3.eligible, false, 'solo cotizaciones: una señal');
    // Buenos Aires (5 perfiles) premia a 2; el resto de Argentina (2 perfiles) a 1; Chile (1) a 1.
    assert.deepEqual(winners.map((w) => `${w.userId}#${w.zoneRank}`), ['a1#1', 'a2#2', 'p1#1', 's1#1']);
    assert.equal(byId.p2.eligible, false, 'visitas y compartidos: nada que dependa de otra cuenta');
    assert.equal(byId.p2.zoneRank, null);
    assert.equal(byId.p2.mostWanted, false);
    assert.equal(byId.x1.score, 438);
    assert.equal(byId.x1.eligible, false, 'solo en su zona y con 438 puntos, igual no gana');
    assert.equal(byId.x1.mostWanted, false);
    assert.equal(byId.n1.mostWanted, false, 'sin zona no hay insignia aunque tenga actividad');
    // Empate: gana el de más trabajos completados y después el id.
    const tie = MostWanted.rankMostWanted([
        { userId: 'b', city: 'X', country: 'Y', quotes: 2, completed: 1 },
        { userId: 'a', city: 'X', country: 'Y', quotes: 2, completed: 1 },
        { userId: 'c', city: 'X', country: 'Y', visits: 4, quotes: 4, quotesAccount: 4 }
    ]).scores.sort((x, y) => x.zoneRank - y.zoneRank).map((s) => s.userId);
    assert.deepEqual(tie, ['c', 'a', 'b']);
});

test('Most Wanted: lo público es booleano y puesto; la ciudad privada no se revela', () => {
    const award = { rank: 1, zoneLabel: 'Buenos Aires', zoneLevel: 'city', zoneCountry: 'Argentina', awardedAt: '2026-11-15T00:00:00Z' };
    const open = MostWanted.publicBadges({ embajador: 'si', award, showCity: true });
    assert.deepEqual(Object.keys(open).sort(), ['ambassador', 'most_wanted', 'most_wanted_rank', 'most_wanted_since', 'most_wanted_zone', 'most_wanted_zone_level']);
    assert.equal(open.most_wanted_zone, 'Buenos Aires');
    const hidden = MostWanted.publicBadges({ award, showCity: false });
    assert.equal(hidden.most_wanted_zone, 'Argentina');
    assert.equal(hidden.most_wanted_zone_level, 'country');
    assert.deepEqual(MostWanted.publicBadges({}), {
        ambassador: false, most_wanted: false, most_wanted_rank: null, most_wanted_zone: null, most_wanted_zone_level: null, most_wanted_since: null
    });
    for (const key of Object.keys(open)) assert.doesNotMatch(key, /visits|quotes|favorites|shares|completed|score/);
});

test('migración 20261116180000: misma fórmula que lib/most-wanted.js, privilegios y reversa', () => {
    const W = MostWanted.WEIGHTS;
    const formula = new RegExp(
        `least\\(g\\.visits, ${MostWanted.CAPS.visits}\\) \\* ${W.visits} \\+ g\\.quotes \\* ${W.quotes} \\+ g\\.favorites \\* ${W.favorites}\\s+\\+ least\\(g\\.shares, ${MostWanted.CAPS.shares}\\) \\* ${W.shares} \\+ g\\.completed \\* ${W.completed}`
    );
    assert.match(SQL, formula);
    assert.match(SQL, new RegExp(`sc\\.score >= ${MostWanted.MIN_SCORE} and sc\\.signals >= ${MostWanted.MIN_SIGNALS}`));
    // SEG-06: además, una señal que el artista no puede generar solo (en la condición y en la partición del ranking).
    assert.equal((SQL.match(/sc\.signals >= 2\s+and \(sc\.quotes_account > 0 or sc\.favorites > 0 or sc\.completed > 0\)/g) || []).length, 2);
    assert.doesNotMatch(SQL, /sc\.signals >= \d+\)/, 'ninguna condición de elegibilidad queda sin la señal independiente');
    assert.match(SQL, new RegExp(`cs\\.n >= ${MostWanted.MIN_CITY_ZONE_SIZE} or b\\.country_key is null`));
    assert.match(SQL, /least\(v_top, greatest\(1, ceil\(r\.zone_size \* 0\.25\)::integer\)\)/);
    assert.match(SQL, /p_window_days integer default 30,\s+p_top_n integer default 3/);
    assert.match(SQL, /order by sc\.score desc, sc\.completed desc, sc\.quotes desc, sc\.user_id/);
    // Fuentes: visitas, cotizaciones sin borradores, favoritos (+ puente opcional), compartidos y completados.
    assert.match(SQL, /from public\.artist_profile_visits pv[\s\S]*?pv\.event_kind = 'profile_view'/);
    assert.match(SQL, /coalesce\(qd\.quote_status, ''\) not in \('in_progress', 'en_progreso'\)/);
    assert.match(SQL, /from public\.client_favorites cf/);
    assert.match(SQL, /to_regprocedure\('public\.wo_favorites_artist_counts\(timestamp with time zone\)'\) is not null/);
    assert.match(SQL, /from public\.artist_profile_shares sh/);
    // SEG-06 · compartidos: los del propio artista no suman.
    assert.match(SQL, /from public\.artist_profile_shares sh\s+where sh\.created_at >= v_since\s+and not sh\.is_owner\s+and \(sh\.sharer_user_id is null or sh\.sharer_user_id <> sh\.artist_id\)/);
    // SEG-06 · cotizaciones: con cuenta sin tope; de invitado hasta 3 y nunca las manuales.
    assert.match(SQL, /count\(distinct qd\.client_user_id\)\s+filter \(where qd\.client_user_id is not null\)\)::integer as n_account/);
    assert.match(SQL, new RegExp(`least\\(count\\(distinct nullif\\(lower\\(btrim\\(qd\\.client_email\\)\\), ''\\)\\)\\s+filter \\(where qd\\.client_user_id is null\\s+and coalesce\\(qd\\.source, ''\\) <> 'manual'\\s+and coalesce\\(qd\\.quotation_medium, ''\\) <> 'manual'\\), ${MostWanted.CAPS.guestQuotes}\\)::integer as n_guest`));
    assert.match(SQL, /coalesce\(q\.n_account, 0\) \+ coalesce\(q\.n_guest, 0\) as quotes,\s+coalesce\(q\.n_account, 0\) as quotes_account,/);
    assert.doesNotMatch(SQL, /qd\.id::text/, 'una cotización sin cliente identificable no suma');
    assert.match(SQL, /quotes_account integer not null default 0,/);
    // SEG-06 · completados: solo los que cerró el cliente con su cuenta.
    assert.match(SQL, /qd\.quote_status = 'completed'\s+and qd\.client_completed_at >= v_since\s+and qd\.client_user_id is not null\s+and qd\.client_user_id <> qd\.artist_id/);
    assert.doesNotMatch(SQL, /quote_status in \('completed', 'artist_completed'\)|qd\.artist_completed_at/, 'lo que el artista marca solo no suma');
    // Nadie se suma a sí mismo.
    assert.match(SQL, /pv\.visitor_user_id <> pv\.artist_id/);
    assert.match(SQL, /qd\.client_user_id <> qd\.artist_id/);

    // Seguridad: definer con search_path vacío, solo service-role; RPC pública sin conteos.
    assert.match(SQL, /create or replace function public\.recalculate_most_wanted\([\s\S]*?language plpgsql\s+security definer\s+set search_path = ''/);
    assert.match(SQL, /revoke execute on function public\.recalculate_most_wanted\(integer, integer\) from public, anon, authenticated;/);
    assert.match(SQL, /grant execute on function public\.recalculate_most_wanted\(integer, integer\) to service_role;/);
    assert.match(SQL, /create or replace function public\.get_artist_public_badges\(p_artist_user_id uuid\)\s+returns jsonb\s+language sql\s+stable\s+security definer\s+set search_path = ''/);
    assert.match(SQL, /grant execute on function public\.get_artist_public_badges\(uuid\) to anon, authenticated, service_role;/);
    const badges = SQL.slice(SQL.indexOf('create or replace function public.get_artist_public_badges'), SQL.indexOf('comment on function public.get_artist_public_badges'));
    assert.doesNotMatch(badges, /visits|quotes|favorites|shares|completed|score/, 'la RPC pública no expone conteos');
    assert.match(badges, /lower\(coalesce\(p\.privacy ->> 'show_city', 'true'\)\) = 'false'/, 'respeta la ciudad privada');
    assert.match(badges, /a\.registration_status is distinct from 'incompleto'/);
    // Tablas: RLS, conteos privados y columnas públicas acotadas.
    for (const table of ['artist_profile_shares', 'artist_trend_scores', 'artist_most_wanted', 'artist_share_cards']) {
        assert.match(SQL, new RegExp(`create table if not exists public\\.${table} \\(`));
        assert.match(SQL, new RegExp(`alter table public\\.${table} enable row level security;`));
        assert.match(SQL, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated;`));
        assert.match(DOWN, new RegExp(`drop table if exists public\\.${table};`));
    }
    assert.match(SQL, /grant select \(artist_user_id, rank, zone_level, awarded_at, computed_at\)\s+on table public\.artist_most_wanted to anon, authenticated;/);
    assert.doesNotMatch(SQL, /grant select[^;]*artist_trend_scores to anon/);
    assert.doesNotMatch(SQL, /grant (insert|all)[^;]*artist_profile_shares to (anon|authenticated)/);
    // Embajador: el artista no se lo puede escribir.
    assert.match(SQL, /create trigger trg_guard_artist_embajador\s+before insert or update of embajador on public\.artists_db/);
    assert.match(SQL, /if public\.wo_is_privileged_writer\(\) then\s+return new;/);
    assert.match(SQL, /revoke execute on function public\.guard_artist_embajador\(\) from public, anon, authenticated;/);
    // Tarjeta OG: solo su carpeta dentro del bucket público existente.
    assert.match(SQL, /split_part\(og_path, '\/', 1\) = artist_user_id::text/);
    assert.match(SQL, /with check \(artist_user_id = \(select auth\.uid\(\)\)\)/);
    // Cron diario idempotente y sin transacción propia.
    assert.match(SQL, /perform cron\.schedule\('recalculate-most-wanted', '40 3 \* \* \*', 'select public\.recalculate_most_wanted\(\);'\);/);
    assert.doesNotMatch(SQL, /^\s*(begin|commit);/im, 'la migración no abre su propia transacción');
    assert.match(DOWN, /cron\.unschedule\('recalculate-most-wanted'\)/);
    assert.match(DOWN, /drop trigger if exists trg_guard_artist_embajador on public\.artists_db;/);
    assert.match(DOWN, /drop function if exists public\.recalculate_most_wanted\(integer, integer\);/);
    assert.match(DOWN, /drop function if exists public\.get_artist_public_badges\(uuid\);/);
    // Rango de timestamps del frente.
    const mine = fs.readdirSync(path.join(root, 'supabase', 'migrations')).filter((f) => /^202611161800\d\d_/.test(f));
    assert.deepEqual(mine, ['20261116180000_perfil_insignias_most_wanted.sql']);
});

// ---------------------------------------------------------------------------
// N8 · compartir
// ---------------------------------------------------------------------------

test('N8: ninguna hoja de compartir ofrece Mail, Telegram ni LinkedIn', () => {
    const gone = /t\.me\/share|linkedin\.com|mailto:|\['(telegram|linkedin|mail)'|data-net="(mail|telegram|linkedin)"|netLink\('(telegram|linkedin)'/i;
    assert.doesNotMatch(stripComments(SHEET_JS), gone);
    assert.doesNotMatch(stripComments(DASH_SHARE_JS), gone);
    assert.doesNotMatch(stripComments(SHEET_JS), /Telegram|LinkedIn|'Mail'/);
    assert.doesNotMatch(stripComments(DASH_SHARE_JS), /TELEGRAM|LINKEDIN|>MAIL</);
    assert.deepEqual(Object.keys(ShareSheet.networkLinks('https://beta.weotzi.com/lau', 'Hola')).sort(), ['facebook', 'whatsapp', 'x']);
    // El dashboard deja WhatsApp, Instagram, Facebook, X y Código QR.
    for (const net of ['whatsapp', 'instagram', 'facebook', 'x', 'qr']) assert.match(DASH_SHARE_JS, new RegExp(`data-net="${net}"|netLink\\('${net}'`));
});

test('N8: Instagram comparte una historia (archivo) en el teléfono y la descarga en escritorio', () => {
    const fn = SHEET_JS.slice(SHEET_JS.indexOf('function shareInstagram()'), SHEET_JS.indexOf('/* ------------------------------ acciones'));
    // El enlace se copia en el mismo gesto, antes de cualquier promesa.
    assert.ok(fn.indexOf('var copied = copy(o.url);') > -1 && fn.indexOf('var copied = copy(o.url);') < fn.indexOf('.then('), 'copia sincrónica');
    assert.match(fn, /if \(isTouch\(\) && canShareStoryFile\(\)\) \{\s*shareStoryFile\(\);/);
    assert.match(fn, /if \(!touch && s && !s\.downloaded\)/, 'escritorio: descarga');
    assert.match(SHEET_JS, /nav\.canShare\(\{ files: \[s\.file\] \}\) === true/);
    assert.match(SHEET_JS, /root\.navigator\.share\(\{ files: \[s\.file\], title:/);
    // La imagen se prepara al abrir la hoja (el share necesita el gesto del click).
    const open = SHEET_JS.slice(SHEET_JS.indexOf('function open(opts)'), SHEET_JS.indexOf('function close()'));
    assert.ok(open.indexOf('render();') < open.indexOf('prepareStory();') && open.indexOf('prepareStory();') < open.indexOf('showModal'));
    assert.match(SHEET_JS, /C\.renderStory\(input\)/);
    assert.match(SHEET_JS, /data-share-act="story-download" disabled/);
    assert.match(SHEET_JS, /aria-controls="wss-story"/);
    // Instrucciones breves en español neutro.
    assert.match(SHEET_JS, /Sube la imagen a tu historia y pega el enlace con el sticker de enlace\./);
    assert.match(SHEET_JS, /'Copiamos el enlace\. '/);
    assert.doesNotMatch(SHEET_JS, /subila|pegá |pegalo en tu bio|Copiá el enlace de arriba/i);
    // El perfil le pasa los datos de la historia y carga el compositor antes de la hoja.
    assert.match(PROFILE_JS, /story: window\.WoShareCards \? \{ artist: artistData, prefs: publicProfilePreferences, name \} : null,/);
    const order = ['wo-share-cards.js', 'wo-share-sheet.js', 'artist-profile.js'].map((n) => HTML.indexOf(`<script src="/shared/js/${n}"`));
    assert.ok(order.every((i) => i > -1) && order[0] < order[1] && order[1] < order[2], 'orden de scripts');
    // Dashboard: misma historia, con el compositor cargado a demanda.
    assert.match(DASH_SHARE_JS, /s\.src = appPath\('\/shared\/js\/wo-share-cards\.js'\);/);
    assert.match(DASH_SHARE_JS, /navigator\.share\(\{ files: \[story\.file\], title:/);
    assert.match(DASH_SHARE_JS, /sube la imagen a tu historia y pega el enlace\./);
    // La pestaña TURNOS comparte /turnos (antes devolvía la URL del perfil).
    const urlFn = DASH_SHARE_JS.slice(DASH_SHARE_JS.indexOf('function shareUrl(dest)'), DASH_SHARE_JS.indexOf('/* ------------------- onboarding'));
    assert.ok(urlFn.indexOf("if (dest === 'turnos')") < urlFn.indexOf('window.WoArtistPublicUrl.publicProfileUrl'), 'turnos antes de la URL corta');
});

test('historia 1080×1920 y tarjeta 1200×630: datos saneados y layout puro', () => {
    assert.deepEqual({ ...ShareCards.STORY }, { width: 1080, height: 1920 });
    assert.deepEqual({ ...ShareCards.OG }, { width: 1200, height: 630 });
    const data = ShareCards.cardData({ artist: ARTIST, prefs: { privacy: { show_city: true } }, url: 'https://beta.weotzi.com/lauumarth' });
    assert.equal(data.name, 'Lau Marth');
    assert.equal(data.handle, 'lauumarth');
    assert.deepEqual(data.styles, ['Fine line', 'Botánico', 'Blackwork'], 'hasta tres estilos');
    assert.equal(data.city, 'Buenos Aires');
    assert.equal(data.link, 'beta.weotzi.com/lauumarth');
    assert.equal(data.photo, ARTIST.profile_picture);
    assert.equal(data.initials, 'LM');
    assert.equal(ShareCards.eyebrowText(data), 'TATUADOR · BUENOS AIRES');
    // Privacidad: la ciudad oculta no se dibuja.
    const hidden = ShareCards.cardData({ artist: ARTIST, prefs: { privacy: { show_city: false } }, url: 'https://beta.weotzi.com/lauumarth' });
    assert.equal(hidden.city, '');
    assert.equal(ShareCards.eyebrowText(hidden), 'TATUADOR');
    // Sin foto de perfil: portada y después el primer trabajo público que sea imagen
    // (gallery_images, ya filtrada por la validación de Instagram; nunca el feed crudo).
    const noPhoto = {
        ...ARTIST, profile_picture: '',
        gallery_images: [{ url: 'https://x.co/a.mp4', kind: 'video' }, 'https://x.co/clip.webm', { url: 'https://x.co/b.jpg' }],
        gallery_feed_items: [{ url: 'https://x.co/oculta-de-instagram.jpg', source: 'instagram' }]
    };
    assert.equal(ShareCards.cardData({ artist: noPhoto, prefs: { profile: { banner_url: 'https://x.co/banner.jpg' } } }).photo, 'https://x.co/banner.jpg');
    assert.equal(ShareCards.cardData({ artist: noPhoto }).photo, 'https://x.co/b.jpg');
    assert.equal(ShareCards.cardData({ artist: { ...noPhoto, gallery_images: [] } }).photo, '', 'el feed crudo no se usa');
    // El alias largo conserva su query en el enlace que se dibuja.
    assert.equal(ShareCards.prettyUrl('https://beta.weotzi.com/artist/profile?artist=explore.wo#x'), 'beta.weotzi.com/artist/profile?artist=explore.wo');
    assert.equal(ShareCards.cardData({ artist: { ...ARTIST, profile_picture: 'javascript:alert(1)' } }).photo, '');
    assert.equal(ShareCards.cardData({ artist: { username: '@neo.wo' } }).name, 'neo');
    assert.equal(ShareCards.cardData({ artist: ARTIST, url: 'javascript:alert(1)' }).url, '');

    // object-fit: cover.
    assert.deepEqual(ShareCards.coverRect(2000, 1000, 1000, 1000, 0.5), { sx: 500, sy: 0, sw: 1000, sh: 1000 });
    const tall = ShareCards.coverRect(1000, 3000, 1000, 1000);
    assert.equal(tall.sw, 1000);
    assert.equal(tall.sh, 1000);
    assert.equal(tall.sy, 700, 'foco arriba (35 %)');
    assert.deepEqual(ShareCards.coverRect(0, 0, 10, 10), { sx: 0, sy: 0, sw: 0, sh: 0 });

    // Texto: 10 px por carácter.
    const measure = (t) => t.length * 10;
    assert.deepEqual(ShareCards.wrapLines(measure, 'uno dos tres cuatro', 80, 3), ['uno dos', 'tres', 'cuatro']);
    assert.deepEqual(ShareCards.wrapLines(measure, 'uno dos tres cuatro cinco seis', 80, 2), ['uno dos', 'tres cu…']);
    assert.equal(ShareCards.ellipsize(measure, 'beta.weotzi.com/lauumarth', 120), 'beta.weotzi…');
    const fit = ShareCards.fitText((size, t) => t.length * size * 0.6, 'LAU MARTH', { max: 120, min: 60, step: 4, maxWidth: 500, maxLines: 2 });
    assert.equal(fit.size, 120);
    assert.deepEqual(fit.lines, ['LAU', 'MARTH']);
    const small = ShareCards.fitText((size, t) => t.length * size * 0.6, 'SUPERCALIFRAGILISTICO', { max: 120, min: 40, step: 4, maxWidth: 500, maxLines: 2 });
    assert.ok(small.size < 120 && small.size >= 40, String(small.size));
    assert.equal(small.lines.length, 1);

    // Firma: cambia con lo que se dibuja, no con lo que no.
    const sig = ShareCards.signature(data);
    assert.match(sig, new RegExp(`^${ShareCards.LAYOUT_VERSION}-[0-9a-f]{8}$`));
    assert.equal(ShareCards.signature(ShareCards.cardData({ artist: { ...ARTIST, bio_description: 'otra' }, url: data.url })), sig);
    assert.notEqual(ShareCards.signature(ShareCards.cardData({ artist: { ...ARTIST, name: 'Otro' }, url: data.url })), sig);
    assert.notEqual(ShareCards.signature(hidden), sig);

    assert.equal(ShareCards.storyFileName('@Lau Úmarth.wo'), 'historia-lau-umarth.jpg');
    assert.equal(ShareCards.ogObjectPath(UID.toUpperCase(), 1763240000000), `${UID}/og-card-1763240000000.jpg`);
    assert.equal(ShareCards.ogObjectPath('no-uuid', 1763240000000), '');
    assert.equal(ShareCards.ogObjectPath(UID, 12), '');
    // La ruta que genera el navegador es la que aceptan el servidor y la base.
    assert.match(ShareCards.ogObjectPath(UID, 1763240000000), ProfileMeta.SHARE_CARD_PATH_RE);
    assert.equal(ShareCards.BUCKET, ProfileMeta.SHARE_CARD_BUCKET);
    const constraint = SQL.match(/check \(og_path ~ '([^']+)'\)/)[1];
    assert.match(ShareCards.ogObjectPath(UID, 1763240000000), new RegExp(constraint));
});

test('tarjeta OG: se genera sola para el dueño (perfil, dashboard, guardar y compartir) y nunca en demo', () => {
    assert.match(CARDS_JS, /if \(root\.WoDemo && root\.WoDemo\.enabled\) return Promise\.resolve\(\{ uploaded: false, reason: 'demo' \}\);/);
    assert.match(CARDS_JS, /if \(!sessionId \|\| String\(sessionId\)\.toLowerCase\(\) !== userId\) return \{ uploaded: false, reason: 'sin-sesion' \};/);
    assert.match(CARDS_JS, /if \(!o\.force && row && row\.signature === sig\)/, 'sin cambios no se vuelve a subir');
    assert.match(CARDS_JS, /root\.document\.addEventListener\('wo:assist-refresh'/, 'al guardar el perfil en el centro de la cuenta');
    assert.match(CARDS_JS, /img\.crossOrigin = 'anonymous';/);
    assert.match(CARDS_JS, /getImageData\(0, 0, 1, 1\)/, 'canvas contaminado → se repinta sin foto');
    assert.match(PROFILE_JS, /function syncOwnShareCard\(auto = false\) \{\s*if \(!isOwnerView\(\) \|\| viewer\.demo \|\| !viewer\.session \|\| !window\.WoShareCards\?\.syncOgCard\) return;/);
    assert.match(PROFILE_JS, /syncOwnShareCard\(true\);/, 'al ver su propio perfil');
    assert.match(PROFILE_JS, /syncOwnShareCard\(\);\s*window\.WoShareSheet\.open\(/, 'al compartir');
    assert.match(DASH_SHARE_JS, /setTimeout\(function \(\) \{ syncOgCard\(true\); \}, 4000\);/, 'al abrir el dashboard');
    assert.match(DASH_SHARE_JS, /syncOgCard\(false\);\s*els\.scrim\.hidden = false;/, 'al abrir el panel de compartir');
    // Los chequeos automáticos se espacian; guardar y compartir no esperan.
    assert.match(CARDS_JS, /if \(o\.auto && !o\.force && row && Date\.now\(\) - Number\(remember\(stampKey\) \|\| 0\) < RESYNC_MIN_MS\)/);
    assert.match(CARDS_JS, /if \(!P \|\| !PublicUrl\) return \{ uploaded: false, reason: 'sin-repo' \};/, 'misma URL corta en todas las páginas');
    const account = read('public', 'artist', 'account', 'index.html');
    assert.match(account, /<script src="\/shared\/js\/wo-share-cards\.js" defer><\/script>/);
    const repo = read('public', 'shared', 'js', 'data', 'profile-public-repo.js');
    assert.match(repo, /client\.storage\.from\(bucket\)\s*\.upload\(path, blob, \{ cacheControl: '31536000', upsert: true, contentType: 'image\/jpeg' \}\)/);
    assert.match(repo, /D\.from\('artist_share_cards'\)\.upsert\(row, \{ onConflict: 'artist_user_id' \}\)/);
    assert.match(repo, /path\.split\('\/'\)\[0\] !== String\(artistUserId\)\.toLowerCase\(\)/, 'solo su carpeta');
});

// ---------------------------------------------------------------------------
// Open Graph del lado servidor
// ---------------------------------------------------------------------------

const CARD = { og_path: `${UID}/og-card-1763240000000.jpg`, width: 1200, height: 630, updated_at: '2026-11-15T10:00:00Z' };
const SUPA = 'https://flbgmlvfiejfttlawnfu.supabase.co';

test('og:image usa la tarjeta 1200×630 con sus medidas; si no sirve, la foto de perfil', () => {
    const image = ProfileMeta.shareCardImage(CARD, { supabaseUrl: `${SUPA}/`, userId: UID });
    assert.equal(image.url, `${SUPA}/storage/v1/object/public/profile-pictures/${UID}/og-card-1763240000000.jpg?v=1794736800`);
    assert.deepEqual([image.width, image.height, image.type], [1200, 630, 'image/jpeg']);
    // Rutas que no son de su carpeta o no tienen la forma esperada: se descartan.
    for (const bad of [
        { ...CARD, og_path: `${OTHER}/og-card.jpg` },
        { ...CARD, og_path: `${UID}/../x/og-card.jpg` },
        { ...CARD, og_path: `${UID}/avatar.jpg` },
        { ...CARD, og_path: `https://evil.example/${UID}/og-card.jpg` },
        { ...CARD, og_path: `${UID}/og-card.svg` },
        null, {}
    ]) assert.equal(ProfileMeta.shareCardImage(bad, { supabaseUrl: SUPA, userId: UID }), null);
    assert.equal(ProfileMeta.shareCardImage(CARD, { supabaseUrl: 'http://x.co', userId: UID }), null, 'solo https');
    assert.equal(ProfileMeta.shareCardImage(CARD, { supabaseUrl: `${SUPA}/x"><script>`, userId: UID }), null);
    assert.equal(ProfileMeta.shareCardImage(CARD, { supabaseUrl: SUPA }), null, 'sin dueño no hay tarjeta');
    assert.deepEqual(
        [ProfileMeta.shareCardImage({ ...CARD, width: 99999, height: -1 }, { supabaseUrl: SUPA, userId: UID })].map((i) => [i.width, i.height]),
        [[1200, 630]]
    );

    const template = HTML;
    const withCard = ProfileMeta.buildArtistMeta({ artist: ARTIST, prefs: {}, canonicalUrl: 'https://beta.weotzi.com/lauumarth', defaultImage: 'https://beta.weotzi.com/shared/img/og-default.jpg', shareCard: CARD, supabaseUrl: SUPA });
    const html = ProfileMeta.injectMeta(template, withCard);
    assert.match(html, new RegExp(`<meta property="og:image" id="og-image" content="${SUPA.replace(/\./g, '\\.')}/storage/v1/object/public/profile-pictures/${UID}/og-card-1763240000000\\.jpg\\?v=1794736800">`));
    assert.match(html, /<meta property="og:image:width" id="og-image-width" content="1200">/);
    assert.match(html, /<meta property="og:image:height" id="og-image-height" content="630">/);
    assert.match(html, /<meta property="og:image:type" id="og-image-type" content="image\/jpeg">/);
    assert.match(html, /<meta name="twitter:image" id="twitter-image" content="[^"]+og-card-1763240000000\.jpg\?v=1794736800">/);
    assert.match(html, /<meta property="og:image:alt" id="og-image-alt" content="Tarjeta de Lau Marth en We Ötzi">/);
    assert.match(html, /<meta name="twitter:card" id="twitter-card" content="summary_large_image">/);

    // Sin tarjeta: la foto de perfil y ninguna medida inventada.
    const plain = ProfileMeta.injectMeta(template, ProfileMeta.buildArtistMeta({ artist: ARTIST, prefs: {}, canonicalUrl: 'https://beta.weotzi.com/lauumarth', defaultImage: 'https://beta.weotzi.com/shared/img/og-default.jpg' }));
    assert.match(plain, /og:image" id="og-image" content="https:\/\/flbgmlvfiejfttlawnfu\.supabase\.co\/storage\/v1\/object\/public\/profile-pictures\/x\/lau\.jpg"/);
    assert.doesNotMatch(plain, /og-image-width|og-image-height|og-image-type/);
    // Pasar de tarjeta a foto no deja medidas viejas.
    const back = ProfileMeta.injectMeta(html, ProfileMeta.buildArtistMeta({ artist: ARTIST, prefs: {}, canonicalUrl: 'https://beta.weotzi.com/lauumarth', defaultImage: 'x' }));
    assert.doesNotMatch(back, /og-image-width|og-image-type/);
});

function fakeRepo(artists, card) {
    return {
        async findPublicByUsername(u) { return artists.find((a) => a.username === String(u).toLowerCase().replace(/^@/, '').replace(/(\.wo)?$/, '.wo')) || null; },
        async findPublicByUserId(id) { return artists.find((a) => a.user_id === id) || null; },
        async getPublicPrefs() { return { privacy: {} }; },
        async getShareCard() { if (card instanceof Error) throw card; return card || null; }
    };
}

function fakeTrending(overrides = {}) {
    const calls = { shares: [], recalc: 0, claimed: [], released: [] };
    const repo = {
        calls,
        async hasRecentShare(q) { return calls.shares.some((s) => s.artistId === q.artistId && s.ipHash === q.ipHash && s.channel === q.channel); },
        async insertShare(row) { calls.shares.push(row); return row; },
        async recalculate() { calls.recalc += 1; return { scored: 4, zones: 1, winners: 1 }; },
        async listPendingAwards() { return [{ artist_user_id: UID, zone_label: 'Buenos Aires', zone_level: 'city', rank: 1, awarded_at: '2026-11-15T03:40:00Z' }]; },
        async claimAward(id) { if (calls.claimed.includes(id)) return false; calls.claimed.push(id); return true; },
        async releaseAward(id) { calls.released.push(id); calls.claimed = calls.claimed.filter((x) => x !== id); },
        async getArtistContact() { return { user_id: UID, email: 'lau@example.com', name: 'Lau Marth', username: 'lauumarth.wo' }; },
        ...overrides
    };
    return repo;
}

async function withServer(deps, fn) {
    const app = express();
    app.set('trust proxy', 1);
    const routes = register(app, deps);
    app.use((req, res) => res.status(404).send('fallthrough'));
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
        await fn(`http://127.0.0.1:${server.address().port}`, routes);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

const publicDir = path.join(root, 'public');
const ENV = { PUBLIC_APP_URL: 'https://beta.weotzi.com', SUPABASE_URL: SUPA, CRON_API_TOKEN: 'cron-secreto-de-prueba', SUPABASE_SERVICE_ROLE_KEY: 'k'.repeat(40) };
const quiet = { warn() {}, log() {}, error() {} };

test('GET /<handle> sirve la tarjeta OG del artista y sigue funcionando si esa consulta falla', async () => {
    await withServer({ publicDir, env: ENV, repo: fakeRepo([ARTIST], CARD), trending: fakeTrending(), log: quiet }, async (base) => {
        const html = await (await fetch(`${base}/lauumarth`)).text();
        assert.match(html, /og:image" id="og-image" content="[^"]+\/profile-pictures\/3f2b8c1e-1a2b-4c3d-8e9f-0a1b2c3d4e5f\/og-card-1763240000000\.jpg\?v=1794736800"/);
        assert.match(html, /og:image:width" id="og-image-width" content="1200"/);
        assert.match(html, /og:image:height" id="og-image-height" content="630"/);
    });
    await withServer({ publicDir, env: ENV, repo: fakeRepo([ARTIST], new Error('tabla sin crear')), trending: fakeTrending(), log: quiet }, async (base) => {
        const res = await fetch(`${base}/artist/profile?artist=lauumarth`);
        assert.equal(res.status, 200);
        const html = await res.text();
        assert.match(html, /og:image" id="og-image" content="https:\/\/flbgmlvfiejfttlawnfu\.supabase\.co\/storage\/v1\/object\/public\/profile-pictures\/x\/lau\.jpg"/);
        assert.match(html, /<link rel="canonical" id="profile-canonical" href="https:\/\/beta\.weotzi\.com\/lauumarth">/);
    });
    // Un repo viejo sin getShareCard tampoco rompe.
    const legacy = fakeRepo([ARTIST]);
    delete legacy.getShareCard;
    await withServer({ publicDir, env: ENV, repo: legacy, trending: fakeTrending(), log: quiet }, async (base) => {
        assert.equal((await fetch(`${base}/lauumarth`)).status, 200);
    });
});

test('artists-public (servidor): tarjeta e insignias con la anon key y sin romper si faltan', async () => {
    const seen = [];
    const query = (table, opts) => ({
        table, opts, filters: [],
        select(c) { this.cols = c; return this; }, or() { return this; },
        eq(c, v) { this.filters.push([c, v]); return this; }, limit() { return this; },
        async execute() { seen.push(this); return [CARD]; }
    });
    query.raw = async (p, opts) => { seen.push({ raw: p, opts }); return { ambassador: true, most_wanted: false }; };
    const repo = createArtistsPublicRepo({ query });
    assert.deepEqual(await repo.getShareCard(UID.toUpperCase()), CARD);
    assert.equal(seen[0].table, 'artist_share_cards');
    assert.deepEqual(seen[0].opts, { key: 'anon' });
    assert.deepEqual(seen[0].filters, [['artist_user_id', UID]]);
    assert.equal(seen[0].cols, 'og_path,width,height,updated_at');
    assert.deepEqual(await repo.getPublicBadges(UID), { ambassador: true, most_wanted: false });
    assert.equal(seen[1].raw, 'rpc/get_artist_public_badges');
    assert.equal(seen[1].opts.key, 'anon');
    assert.equal(await repo.getShareCard('no-uuid'), null);
    const broken = createArtistsPublicRepo({ query: Object.assign(() => { throw new Error('caído'); }, { raw: async () => { throw new Error('caído'); } }) });
    assert.equal(await broken.getShareCard(UID), null);
    assert.equal(await broken.getPublicBadges(UID), null);
});

// ---------------------------------------------------------------------------
// Compartidos y recálculo
// ---------------------------------------------------------------------------

test('POST /api/artist/profile-share: registra una vez por persona, canal y hora', async () => {
    const trending = fakeTrending();
    await withServer({ publicDir, env: ENV, repo: fakeRepo([ARTIST]), trending, resolveUser: async () => null, log: quiet }, async (base) => {
        const post = (body, headers = {}) => fetch(`${base}/api/artist/profile-share`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body)
        });
        const first = await post({ artist_username: '@LauUmarth', channel: 'whatsapp' });
        assert.equal(first.status, 201);
        assert.deepEqual(await first.json(), { success: true, recorded: true });
        assert.equal(first.headers.get('cache-control'), 'no-store');
        const again = await post({ artist_username: 'lauumarth.wo', channel: 'whatsapp' });
        assert.deepEqual(await again.json(), { success: true, recorded: false, reason: 'deduplicated' });
        // Otro canal sí cuenta; un canal desconocido cae en "other".
        assert.equal((await post({ artist_id: UID, channel: 'story' })).status, 201);
        assert.equal((await post({ artist_username: 'lauumarth', channel: '<script>' })).status, 201);
        assert.deepEqual(trending.calls.shares.map((s) => s.channel), ['whatsapp', 'story', 'other']);
        // Nunca se guarda la IP: solo su huella.
        for (const share of trending.calls.shares) {
            assert.match(share.ipHash, /^[0-9a-f]{64}$/);
            assert.equal(share.artistId, UID);
            assert.equal(share.isOwner, false);
            assert.equal(share.sharerUserId, null);
        }
        assert.equal((await post({ artist_username: 'nadie', channel: 'copy' })).status, 404);
        assert.equal((await post({ channel: 'copy' })).status, 400);
        assert.equal((await post({ artist_id: 'no-uuid' })).status, 400);
    });
    // El dueño con sesión queda marcado como tal.
    const owned = fakeTrending();
    await withServer({ publicDir, env: ENV, repo: fakeRepo([ARTIST]), trending: owned, resolveUser: async () => ({ id: UID }), log: quiet }, async (base) => {
        await fetch(`${base}/api/artist/profile-share`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ artist_username: 'lauumarth', channel: 'copy' }) });
        assert.equal(owned.calls.shares[0].isOwner, true);
        assert.equal(owned.calls.shares[0].sharerUserId, UID);
    });
    // Si la base falla, responde 502 sin tirar el servidor.
    const broken = fakeTrending({ async insertShare() { throw new Error('sin tabla'); } });
    await withServer({ publicDir, env: ENV, repo: fakeRepo([ARTIST]), trending: broken, resolveUser: async () => null, log: quiet }, async (base) => {
        const res = await fetch(`${base}/api/artist/profile-share`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ artist_username: 'lauumarth' }) });
        assert.equal(res.status, 502);
    });
    assert.equal(normalizeChannel('WhatsApp'), 'whatsapp');
    assert.equal(normalizeChannel('telegram'), 'other');
    assert.equal(hashIp('', ENV), null);
    assert.equal(hashIp('1.2.3.4', {}), null, 'sin sal no se guarda nada derivado de la IP');
    assert.notEqual(hashIp('1.2.3.4', ENV), hashIp('1.2.3.5', ENV));
});

test('POST /api/perfil/most-wanted/recalculate: token de cron, recálculo y aviso una sola vez', async () => {
    const trending = fakeTrending();
    const sent = [];
    const sendEmail = async (eventId, payload, options) => { sent.push({ eventId, payload, options }); return { ok: true }; };
    await withServer({ publicDir, env: ENV, repo: fakeRepo([ARTIST]), trending, sendEmail, log: quiet }, async (base, routes) => {
        const url = `${base}/api/perfil/most-wanted/recalculate`;
        assert.equal((await fetch(url, { method: 'POST' })).status, 401);
        assert.equal((await fetch(url, { method: 'POST', headers: { 'X-Cron-Token': 'otro' } })).status, 401);
        assert.equal(trending.calls.recalc, 0);
        const ok = await fetch(url, { method: 'POST', headers: { 'X-Cron-Token': ENV.CRON_API_TOKEN } });
        assert.equal(ok.status, 200);
        assert.deepEqual(await ok.json(), { success: true, scored: 4, zones: 1, winners: 1, notified: 1 });
        assert.equal(sent.length, 1);
        assert.equal(sent[0].eventId, 'artist_most_wanted_awarded');
        assert.equal(sent[0].payload.artist_email, 'lau@example.com');
        assert.equal(sent[0].payload.zone_label, 'Buenos Aires');
        assert.equal(sent[0].payload.profile_url, 'https://beta.weotzi.com/lauumarth');
        assert.equal(sent[0].payload.recipient_user_id, UID);
        assert.equal(sent[0].options.idempotencyKey, `most-wanted:${UID}:2026-11-15T03:40:00Z`);
        for (const key of Object.keys(sent[0].payload)) assert.doesNotMatch(key, /visits|quotes|score/);
        // Segundo ciclo: el aviso ya está tomado, no se repite.
        assert.equal(await routes.notifyPendingAwards(), 0);
        assert.equal(sent.length, 1);
    });
    // Sin token configurado, 503.
    await withServer({ publicDir, env: { ...ENV, CRON_API_TOKEN: '' }, repo: fakeRepo([ARTIST]), trending: fakeTrending(), log: quiet }, async (base) => {
        assert.equal((await fetch(`${base}/api/perfil/most-wanted/recalculate`, { method: 'POST', headers: { 'X-Cron-Token': '' } })).status, 503);
    });
    // Si el correo falla, el aviso vuelve a pendiente; si lo frena la preferencia, queda tomado.
    const failing = fakeTrending();
    const failed = createProfileRoutes({ publicDir, env: ENV, repo: fakeRepo([ARTIST]), trending: failing, sendEmail: async () => ({ ok: false, error: 'relé caído' }), log: quiet });
    assert.equal(await failed.notifyPendingAwards(), 0);
    assert.deepEqual(failing.calls.released, [UID]);
    const skipping = fakeTrending();
    const skipped = createProfileRoutes({ publicDir, env: ENV, repo: fakeRepo([ARTIST]), trending: skipping, sendEmail: async () => ({ ok: false, skipped: true }), log: quiet });
    assert.equal(await skipped.notifyPendingAwards(), 0);
    assert.deepEqual(skipping.calls.released, []);
    assert.deepEqual(skipping.calls.claimed, [UID]);
    const throwing = fakeTrending();
    const thrown = createProfileRoutes({ publicDir, env: ENV, repo: fakeRepo([ARTIST]), trending: throwing, sendEmail: async () => { throw new Error('boom'); }, log: quiet });
    assert.equal(await thrown.notifyPendingAwards(), 0);
    assert.deepEqual(throwing.calls.released, [UID]);
    // MOST_WANTED_EMAILS=off: se recalcula pero no se avisa ni se toma el aviso.
    const muted = fakeTrending();
    const off = createProfileRoutes({ publicDir, env: { ...ENV, MOST_WANTED_EMAILS: 'off' }, repo: fakeRepo([ARTIST]), trending: muted, sendEmail: async () => { throw new Error('no debería enviarse'); }, log: quiet });
    assert.deepEqual(await off.runMostWantedCycle(), { scored: 4, zones: 1, winners: 1, notified: 0 });
    assert.deepEqual(muted.calls.claimed, []);
    // El job no arranca solo: lo pide server.js (proceso principal).
    assert.equal(mostWantedIntervalMs({}), 12 * 60 * 60 * 1000);
    assert.equal(mostWantedIntervalMs({ MOST_WANTED_INTERVAL_HOURS: '0' }), 0);
    assert.equal(mostWantedIntervalMs({ MOST_WANTED_INTERVAL_HOURS: '6' }), 6 * 60 * 60 * 1000);
    assert.equal(mostWantedIntervalMs({ MOST_WANTED_INTERVAL_HOURS: 'abc' }), 0);
    const server = read('server.js');
    assert.match(server, /require\('\.\/lib\/routes\/perfil'\)\.register\(app, \{ publicDir: path\.join\(__dirname, 'public'\), startJob: require\.main === module \}\);/);
    const stop = off.startMostWantedJob();
    assert.equal(typeof stop, 'function');
    stop();
});

test('perfil-trending (servidor): service-role, canales acotados y reclamo atómico del aviso', async () => {
    const seen = [];
    const query = (table, opts) => {
        const q = {
            table, opts, filters: [],
            select(c) { this.cols = c; return this; },
            eq(c, v) { this.filters.push(['eq', c, v]); return this; },
            gte(c, v) { this.filters.push(['gte', c, v]); return this; },
            is(c, v) { this.filters.push(['is', c, v]); return this; },
            order() { return this; }, limit() { return this; },
            async execute() { seen.push({ op: 'get', ...this }); return []; },
            async insert(values) { seen.push({ op: 'insert', table, values }); return [values]; },
            async patch(values) { seen.push({ op: 'patch', table, values, filters: this.filters }); return [{ artist_user_id: UID }]; }
        };
        return q;
    };
    query.raw = async (p, opts) => { seen.push({ op: 'raw', path: p, opts }); return [{ scored_count: 3, zone_count: 2, winner_count: 2 }]; };
    const repo = createPerfilTrendingRepo({ query });
    await repo.insertShare({ artistId: UID, channel: 'Telegram', sharerUserId: 'x', isOwner: 'si', ipHash: 'h' });
    assert.deepEqual(seen[0].values, { artist_id: UID, channel: 'other', sharer_user_id: null, is_owner: false, ip_hash: 'h' });
    assert.equal(seen[0].table, 'artist_profile_shares');
    await assert.rejects(() => repo.insertShare({ artistId: 'no-uuid' }), /inválido/);
    assert.deepEqual(await repo.recalculate(), { scored: 3, zones: 2, winners: 2 });
    assert.equal(seen[1].path, 'rpc/recalculate_most_wanted');
    assert.equal(seen[1].opts.key, undefined, 'service-role por defecto');
    assert.deepEqual(seen[1].opts.body, { p_window_days: 30, p_top_n: 3 });
    assert.equal(await repo.claimAward(UID, '2026-11-15T00:00:00Z'), true);
    assert.deepEqual(seen[2].filters, [['eq', 'artist_user_id', UID], ['is', 'notified_at', 'null']], 'solo si nadie lo tomó');
    assert.equal(await repo.claimAward('no-uuid'), false);
    assert.equal(await repo.hasRecentShare({ artistId: UID, ipHash: '', channel: 'copy', sinceIso: 'x' }), false);
});

// ---------------------------------------------------------------------------
// Correo y textos
// ---------------------------------------------------------------------------

test('correo artist_most_wanted_awarded: solo servidor, CTA absoluto y sin datos de otros', () => {
    const { EVENTS, EXTENSION_SOURCES, resolveRecipients } = require('../services/email-event-mapping');
    const { renderEmail } = require('../lib/email-render');
    const { SERVER_ONLY_EVENTS } = require('../services/email-request-context');
    assert.ok(EVENTS.artist_most_wanted_awarded, 'evento cargado desde services/email-events/perfil.js');
    assert.equal(EXTENSION_SOURCES.artist_most_wanted_awarded, 'perfil.js');
    assert.ok(SERVER_ONLY_EVENTS.has('artist_most_wanted_awarded'));
    const payload = { app_base_url: 'https://beta.weotzi.com', artist_email: 'lau@example.com', artist_name: 'Lau Marth', zone_label: 'Buenos Aires', rank: 1, profile_url: 'https://beta.weotzi.com/lauumarth' };
    assert.deepEqual(resolveRecipients('artist_most_wanted_awarded', payload), ['lau@example.com']);
    const out = renderEmail('artist_most_wanted_awarded', payload, { role: 'artist' });
    assert.equal(out.subject, 'Tu perfil es Most Wanted en Buenos Aires');
    assert.equal(out.cta.url, 'https://beta.weotzi.com/lauumarth');
    assert.ok(out.preheader.length >= 40 && out.preheader.length <= 110, String(out.preheader.length));
    assert.match(out.text, /Buenos Aires/);
    assert.match(out.text, /N\.º 1/);
    // Sin zona ni enlace válido igual sale bien armado.
    const bare = renderEmail('artist_most_wanted_awarded', { artist_email: 'lau@example.com', profile_url: 'javascript:alert(1)' }, { role: 'artist' });
    assert.equal(bare.subject, 'Tu perfil es Most Wanted');
    assert.equal(bare.cta.url, 'https://beta.weotzi.com/artist/dashboard');
    assert.doesNotMatch(bare.html + bare.text, /\b(undefined|null)\b|javascript:/);
});

test('textos nuevos en español neutro (tuteo, sin voseo)', () => {
    // Formas del voseo (con su tilde: "copia", "pega" o "sube" son tuteo válido).
    const voseo = /(?<![\p{L}])(?:querés|podés|tenés|sabés|contanos|contame|elegí|subí|subila|subilo|mirá|pedile|pedinos|copiá|copialo|pegá|pegalo|hacé|revisá|revisalo|completá|ingresá|probá|tocá|guardá|compartí|compartila|descargá|descargala|agregá|seleccioná|escribí|vos)(?![\p{L}])/iu;
    // Archivos nuevos completos.
    for (const file of [
        ['public', 'shared', 'js', 'wo-share-cards.js'],
        ['public', 'shared', 'css', 'artist-profile-r2.css'],
        ['services', 'email-events', 'perfil.js'],
        ['lib', 'most-wanted.js'],
        ['lib', 'repos', 'perfil-trending.js']
    ]) {
        assert.doesNotMatch(read(...file), voseo, file.join('/'));
    }
    // Textos nuevos dentro de archivos que ya existían.
    const fresh = [
        'Este artista todavía no publicó trabajos. Cuéntale tu idea y pide una cotización.',
        '¿Ves algo en este perfil que no corresponde?',
        'Guardar este perfil en favoritos',
        'Portafolio en preparación'
    ];
    for (const text of fresh) {
        assert.ok(HTML.includes(text), text);
        assert.doesNotMatch(text, voseo, text);
    }
    const story = SHEET_JS.slice(SHEET_JS.indexOf('/* ---------------------- historia de Instagram'), SHEET_JS.indexOf('/* ------------------------------ acciones'));
    assert.doesNotMatch(story, voseo);
    const dashStory = DASH_SHARE_JS.slice(DASH_SHARE_JS.indexOf('/* ------------- ronda 2'), DASH_SHARE_JS.indexOf('function prettyUrl'));
    assert.doesNotMatch(dashStory, voseo);
    const routes = read('lib', 'routes', 'perfil.js');
    for (const msg of routes.match(/error: '[^']+'/g) || []) assert.doesNotMatch(msg, voseo, msg);
});
