// Revision del registro de tatuadores (12 nov 2026) · grupo backend.
// Finalize idempotente (pag. 10), link de alta de estudios (pag. 9),
// Instagram 50 (pag. 8), catalogos (pags. 2 y 5) y bio enriquecida (pag. 7).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const catalogs = require('../lib/registration-catalogs');
const bio = require('../lib/bio-sanitizer');
const finalize = require('../lib/registration-finalize');
const claim = require('../lib/studio-claim');
const registration = require('../lib/artist-registration');
const igImport = require('../lib/instagram-import');

// Fake de la capa PostgREST: registra llamadas y responde con un handler.
function fakeRest(handler) {
    const calls = [];
    const fn = async (p, opts = {}) => {
        const call = { path: p, method: opts.method || 'GET', body: opts.body, prefer: opts.prefer };
        calls.push(call);
        return handler(call, calls);
    };
    fn.calls = calls;
    return fn;
}

// ------------------------------------------------------------ pag. 10 · finalize

test('server.js ya no usa on_conflict contra el indice parcial de membresias', () => {
    const src = read('server.js');
    assert.doesNotMatch(src, /studio_artist_memberships\?on_conflict=/);
    assert.match(src, /registrationFinalize\.upsertOpenStudioMembership\(/);
    assert.match(src, /registrationFinalize\.compensateFailedFinalize\(/);
});

test('upsert de membresia: inserta cuando no hay membresia abierta', async () => {
    const rest = fakeRest((call) => {
        if (call.method === 'GET') return [];
        if (call.method === 'POST') return [{ id: 'm1', ...call.body }];
        throw new Error('inesperado');
    });
    const membership = { artist_user_id: 'u1', studio_id: 's1', location_id: 'l1', role: 'resident', status: 'active', started_at: 'x' };
    const out = await finalize.upsertOpenStudioMembership(rest, membership);
    assert.equal(out.created, true);
    assert.equal(rest.calls[0].method, 'GET');
    assert.match(rest.calls[0].path, /status=in\.\(requested,pending_invite,pending_acceptance,active,paused\)/);
    assert.equal(rest.calls[1].path, 'studio_artist_memberships');
    assert.ok(rest.calls.every((c) => !/on_conflict/.test(c.path)));
});

test('upsert de membresia: reintento actualiza la abierta en vez de duplicar', async () => {
    const rest = fakeRest((call) => {
        if (call.method === 'GET') return [{ id: 'm1', status: 'active', location_id: null, started_at: 't0' }];
        if (call.method === 'PATCH') return [{ id: 'm1', status: 'active', location_id: call.body.location_id }];
        throw new Error('no deberia insertar');
    });
    const out = await finalize.upsertOpenStudioMembership(rest, {
        artist_user_id: 'u1', studio_id: 's1', location_id: 'l2', role: 'resident', status: 'active'
    });
    assert.equal(out.created, false);
    assert.equal(rest.calls[1].method, 'PATCH');
    assert.deepEqual(rest.calls[1].body, { location_id: 'l2' });
});

test('upsert de membresia: si otra request gana la carrera (23505) se actualiza la ganadora', async () => {
    let gets = 0;
    const rest = fakeRest((call) => {
        if (call.method === 'GET') { gets += 1; return gets === 1 ? [] : [{ id: 'm9', status: 'active', location_id: 'l1', started_at: 't' }]; }
        if (call.method === 'POST') throw new Error('PostgREST POST failed (409): {"code":"23505","message":"duplicate key value violates unique constraint \\"studio_memberships_one_open_per_role\\""}');
        return [];
    });
    const out = await finalize.upsertOpenStudioMembership(rest, {
        artist_user_id: 'u1', studio_id: 's1', location_id: 'l1', role: 'resident', status: 'active'
    });
    assert.equal(out.created, false);
    assert.equal(out.row.id, 'm9');
});

test('upsert de membresia: otros errores se propagan', async () => {
    const rest = fakeRest((call) => {
        if (call.method === 'GET') return [];
        throw new Error('PostgREST POST failed (400): 42P10');
    });
    await assert.rejects(() => finalize.upsertOpenStudioMembership(rest, {
        artist_user_id: 'u1', studio_id: 's1', role: 'resident', status: 'active'
    }), /42P10/);
});

test('compensacion: la fila vuelve a borrador ANTES de borrar el usuario de Auth', async () => {
    const order = [];
    const rest = fakeRest((call) => { order.push(`${call.method} ${call.path.split('?')[0]}`); return null; });
    const deleted = [];
    const result = await finalize.compensateFailedFinalize(rest, {
        draftId: 'd1',
        artistUserId: 'u1',
        restoreStudioId: 'sOld',
        createdStudioId: 'sNew',
        deleteAuthUser: async (id) => { order.push('AUTH DELETE'); deleted.push(id); }
    });
    assert.deepEqual(result.failed, []);
    assert.deepEqual(order, [
        'DELETE studio_artist_memberships',
        'DELETE artist_tattoo_locations',
        'PATCH artists_db',
        'AUTH DELETE',
        'DELETE studios'
    ]);
    const revert = rest.calls.find((c) => c.method === 'PATCH');
    assert.match(revert.path, /registration_draft_id=eq\.d1&user_id=eq\.u1/);
    assert.deepEqual(revert.body, {
        user_id: null,
        registration_status: 'incompleto',
        registration_submitted_at: null,
        studio_id: 'sOld'
    });
    assert.match(rest.calls.at(-1).path, /studios\?id=eq\.sNew&user_id=is\.null/);
    assert.deepEqual(deleted, ['u1']);
});

test('compensacion: no restaura un studio_id que apunta al estudio que se borra y sigue ante fallos', async () => {
    const rest = fakeRest((call) => {
        if (call.path.startsWith('artist_tattoo_locations')) throw new Error('boom');
        return null;
    });
    const logs = [];
    const result = await finalize.compensateFailedFinalize(rest, {
        draftId: 'd1', artistUserId: 'u1', restoreStudioId: 'sNew', createdStudioId: 'sNew',
        deleteAuthUser: async () => {}, log: (m) => logs.push(m)
    });
    assert.deepEqual(result.failed, ['tattoo_locations']);
    assert.equal(rest.calls.find((c) => c.method === 'PATCH').body.studio_id, null);
    assert.equal(logs.length, 1);
});

test('fila huerfana: pendiente sin cuenta ni usuario de Auth se puede reparar', () => {
    const pendingOrphan = { user_id: null, registration_status: 'pendiente de validacion' };
    assert.equal(finalize.isRepairableFinalizedDraft(pendingOrphan, []), true);
    assert.equal(finalize.isRepairableFinalizedDraft(pendingOrphan, [{ id: 'a' }]), false);
    assert.equal(finalize.isRepairableFinalizedDraft({ user_id: 'u', registration_status: 'pendiente de validacion' }, []), false);
    assert.equal(finalize.isRepairableFinalizedDraft({ user_id: null, registration_status: 'incompleto' }, []), false);
});

test('fila a finalizar: draft pedido o, si se perdio el draft-id, la fila sin cuenta del email', async () => {
    assert.deepEqual(finalize.pickFinalizeDraft({ byDraftId: { id: 1 }, byEmail: { id: 2 } }), { id: 1 });
    assert.deepEqual(finalize.pickFinalizeDraft({ byDraftId: null, byEmail: { id: 2, user_id: null } }), { id: 2, user_id: null });
    assert.equal(finalize.pickFinalizeDraft({ byDraftId: null, byEmail: { id: 2, user_id: 'u' } }), null);

    const rest = fakeRest(() => [{ id: 'row', registration_draft_id: 'd' }]);
    const row = await finalize.findReusableDraftByEmail(rest, ' Isai@Example.com ');
    assert.equal(row.id, 'row');
    assert.match(rest.calls[0].path, /email=eq\.isai%40example\.com&user_id=is\.null/);
});

test('finalize compensa con el usuario creado y responde studio_claim_url', () => {
    const src = read('server.js');
    const start = src.indexOf("app.post('/api/register/artist-finalize'");
    const handler = src.slice(start, src.indexOf('Registration uniqueness check', start));
    assert.match(handler, /studio_claim_url: claim \? claim\.url : null/);
    assert.match(handler, /deleteAuthUser: deleteArtistAuthUser/);
    // El estudio se crea DESPUES del usuario de Auth (queda dentro de la compensacion).
    assert.ok(handler.indexOf('createArtistAuthUser(') < handler.indexOf('resolveRegistrationStudio('));
    // Dos requests en paralelo no pisan una fila que ya tiene otra cuenta.
    assert.match(handler, /or=\(user_id\.is\.null,user_id\.eq\./);
});

// ------------------------------------------------------------ pag. 9 · alta de estudio

test('link de alta: token de 256 bits, hash sha256 igual al de Postgres', () => {
    const token = claim.generateClaimToken();
    assert.ok(claim.isWellFormedClaimToken(token));
    assert.equal(token.length, 43);
    // Mismo valor que encode(sha256(convert_to(token,'UTF8')),'hex').
    assert.equal(
        claim.hashClaimToken('AAAAAAAAAAAAAAAAAAAAclaimTokenPrueba_0123456789'),
        '8bcdcb096fba329d2f87a1f2b08ca95f54e4248919ead639dd9d8f1286372552'
    );
    assert.equal(claim.hashClaimToken(token), crypto.createHash('sha256').update(token).digest('hex'));
    assert.equal(claim.buildStudioClaimPath('abc'), '/studio/register?alta=abc');
    assert.equal(claim.isWellFormedClaimToken('../../etc'), false);
});

test('link de alta: se emite por RPC con el hash, nunca con el token en claro', async () => {
    const rest = fakeRest(() => [{ link_id: 'l1', expires_at: '2026-12-12T00:00:00Z' }]);
    const link = await claim.issueStudioClaimLink(rest, { studioId: 's1', createdBy: 'u1' });
    assert.equal(rest.calls[0].path, 'rpc/issue_studio_claim_link');
    assert.equal(rest.calls[0].body.p_token_hash, claim.hashClaimToken(link.token));
    assert.equal(JSON.stringify(rest.calls[0].body).includes(link.token), false);
    assert.equal(link.expires_at, '2026-12-12T00:00:00Z');
    assert.match(link.path, /^\/studio\/register\?alta=/);
});

test('link de alta: estados del preview', async () => {
    const token = claim.generateClaimToken();
    const future = new Date(Date.now() + 86400000).toISOString();
    const make = (link, studio) => fakeRest((call) => {
        if (call.path.startsWith('studio_claim_links')) return link ? [link] : [];
        if (call.path.startsWith('studios')) return studio ? [studio] : [];
        if (call.path.startsWith('studio_locations')) return [{ id: 'loc', formatted_address: 'Calle 1', city: 'Rosario' }];
        return [];
    });
    assert.equal((await claim.loadClaimPreview(make(null, null), token)).status, 'invalid');
    assert.equal((await claim.loadClaimPreview(make(null, null), 'x')).status, 'invalid');
    assert.equal((await claim.loadClaimPreview(make({ studio_id: 's', used_at: 'x', expires_at: future }, { id: 's' }), token)).status, 'used');
    assert.equal((await claim.loadClaimPreview(make({ studio_id: 's', expires_at: '2000-01-01T00:00:00Z' }, { id: 's' }), token)).status, 'expired');
    assert.equal((await claim.loadClaimPreview(make({ studio_id: 's', expires_at: future }, { id: 's', user_id: 'owner' }), token)).status, 'claimed');
    const ok = await claim.loadClaimPreview(make(
        { studio_id: 's', expires_at: future },
        { id: 's', name: 'Claroscuro', user_id: null, primary_location_id: 'loc', location_verified: false }
    ), token);
    assert.equal(ok.status, 'valid');
    assert.equal(ok.studio.name, 'Claroscuro');
    assert.equal(ok.studio.location_verified, false);
    assert.equal(ok.location.city, 'Rosario');
    assert.equal(JSON.stringify(ok).includes('token_hash'), false);
});

test('migracion del link de alta: aditiva, hasheada, un solo uso y con reversa', () => {
    const up = read('supabase/migrations/20261112120000_studio_claim_links.sql');
    const down = read('supabase/rollbacks/20261112120000_studio_claim_links.down.sql');
    assert.match(up, /ADD COLUMN IF NOT EXISTS location_verified boolean NOT NULL DEFAULT true/);
    assert.match(up, /token_hash text NOT NULL/);
    assert.match(up, /studio_claim_links_one_open_per_studio[\s\S]*WHERE used_at IS NULL AND revoked_at IS NULL/);
    assert.match(up, /REVOKE ALL ON TABLE public\.studio_claim_links FROM PUBLIC, anon, authenticated/);
    assert.match(up, /GRANT EXECUTE ON FUNCTION public\.issue_studio_claim_link\(uuid, text, uuid, integer\) TO service_role/);
    assert.match(up, /location_verified = true/);
    assert.match(up, /UPDATE public\.artist_tattoo_locations t[\s\S]*SET studio_name = v_normalized/);
    assert.match(up, /p_profile - 'claim_token'/);
    assert.doesNotMatch(up, /DROP TABLE|DROP COLUMN/);
    assert.match(down, /DROP TABLE IF EXISTS public\.studio_claim_links/);
    assert.match(down, /SELECT private\.complete_studio_registration\(p_profile, p_locations\)/);
});

test('registro de estudios manda el token de alta en el perfil', () => {
    const js = read('public/shared/js/studio-register.js');
    assert.match(js, /params\.get\('alta'\)/);
    assert.match(js, /profile\.claim_token = claimToken/);
    assert.match(js, /\/api\/studio-claim\//);
    const html = read('public/studio/register/index.html');
    assert.match(html, /id="claim-notice"/);
});

// ------------------------------------------------------------ pag. 8 · Instagram

test('Instagram: preview fijo en 50 y commit con tope de 50', async () => {
    assert.equal(igImport.IG_PREVIEW_LIMIT, 50);
    assert.equal(igImport.IG_MAX_COMMIT_MEDIA, 50);
    assert.match(read('server.js'), /limit: igImport\.IG_PREVIEW_LIMIT/);

    const photos = Array.from({ length: 60 }, (_, i) => ({
        permalink: `https://instagram.com/p/${i}/`, kind: 'image', cdn_url: `https://cdn.example.com/${i}.jpg`
    }));
    const cache = igImport._internal.previewCache;
    cache.set('p-50', { payload: { username: 'ink', bio: '', photos, reels: [] }, expiresAt: Date.now() + 60000 });

    await assert.rejects(() => igImport.commit({
        payload_id: 'p-50', selection: { photos: true }, target: 'artist', mode: 'signup',
        allowed_permalinks: photos.slice(0, 51).map((p) => p.permalink)
    }), (e) => e.code === 'TOO_MANY_MEDIA' && e.status === 400);

    const out = await igImport.commit({
        payload_id: 'p-50', selection: { photos: true }, target: 'artist', mode: 'signup'
    });
    assert.equal(out.prefill.media.length, 50);
    assert.equal(out.max_media, 50);
    assert.equal(out.hidden_until_instagram_verified, true);

    const subset = await igImport.commit({
        payload_id: 'p-50', selection: { photos: true }, target: 'artist', mode: 'signup',
        allowed_permalinks: photos.slice(0, 3).map((p) => p.permalink)
    });
    assert.equal(subset.prefill.media.length, 3);
    cache.delete('p-50');
});

// ------------------------------------------------------------ pags. 2 y 5 · catalogos

test('lista rapida: los 10 estilos de la revision en orden alfabetico', () => {
    const labels = catalogs.QUICK_STYLES.map((s) => s.label);
    assert.deepEqual(labels, [
        'Blackwork', 'Fine Line', 'Geométrico', 'Japonés', 'Lettering / Caligrafía',
        'Microrealismo', 'Minimalista', 'Neotradicional', 'Realismo', 'Tradicional americano'
    ]);
    assert.deepEqual(labels, [...labels].sort((a, b) => a.localeCompare(b, 'es')));
    const all = new Set(catalogs.ALL_CATALOG_STYLES.map((s) => s.label));
    catalogs.QUICK_STYLES.forEach((q) => q.catalog.forEach((label) => assert.ok(all.has(label), label)));
});

test('catalogo completo: 3 grupos con los nombres exactos de la revision', () => {
    const groups = catalogs.STYLE_GROUPS;
    assert.deepEqual(groups.map((g) => g.label), [
        'Estilos principales', 'Subestilos y especialidades', 'Estilos y tendencias contemporáneas en auge'
    ]);
    assert.equal(groups[0].styles.length, 30);
    assert.equal(groups[1].styles.length, 52);
    assert.equal(groups[2].styles.length, 27);
    const labels = catalogs.ALL_CATALOG_STYLES.map((s) => s.label);
    assert.equal(new Set(labels).size, labels.length);
    ['Tradicional Americano (Old School)', 'Tradicional Japonés (Irezumi)', 'Acuarela (Watercolor)', 'Ignorant Style',
        'Bordado (Embroidery Tattoo)', 'Ilusión Óptica (3D)', 'Cibersigilismo (Cybersigilism)', 'Neotribal (Neo Tribal)',
        'Freehand Abstract'].forEach((label) => assert.ok(labels.includes(label), label));
    const values = catalogs.ALL_CATALOG_STYLES.map((s) => s.value);
    assert.equal(new Set(values).size, values.length);
});

test('compatibilidad: los estilos ya guardados siguen matcheando el catalogo nuevo', () => {
    assert.equal(catalogs.canonicalStyleLabel('Japones'), 'Tradicional Japonés (Irezumi)');
    assert.equal(catalogs.canonicalStyleLabel('Neo-Tradicional'), 'Neotradicional');
    assert.equal(catalogs.canonicalStyleLabel('Tradicional'), 'Tradicional Americano (Old School)');
    assert.equal(catalogs.canonicalStyleLabel('Black & Grey'), 'Black and Grey');
    assert.equal(catalogs.canonicalStyleLabel('Surrealista'), 'Surrealismo');
    assert.equal(catalogs.canonicalStyleLabel('CYBERSIGILISMO'), 'Cibersigilismo (Cybersigilism)');
    assert.equal(catalogs.canonicalStyleLabel('Mi estilo propio'), null);
    assert.ok(catalogs.stylesMatch('Japones', 'Japonés'));
    assert.ok(catalogs.stylesMatch('Tradicional', 'Tradicional americano'));
    assert.ok(catalogs.stylesMatch('Caligrafia', 'Lettering / Caligrafía'));
    assert.ok(!catalogs.stylesMatch('Realismo', 'Blackwork'));
    // Todo valor historico vivo resuelve a una entrada del catalogo.
    ['Realismo', 'Blackwork', 'Fine Line', 'Neo-Tradicional', 'Dotwork', 'Surrealista', 'Anime', 'New School',
        'Tradicional', 'Minimalista', 'Japones', 'Acuarela', 'Chicano', 'Geometrico', 'Trash Polka', 'FREEHAND',
        'Microrealismo', 'CYBERSIGILISMO', 'Japonés', 'Micro-realismo', 'FINELINE', 'Nordico / Viking', 'JAPONES',
        'NEOTRADICIONAL', 'Art Nouveau', 'BLACKWORK', 'Caligrafia'].forEach((stored) => {
        assert.ok(catalogs.canonicalStyleLabel(stored), stored);
    });
});

test('saneo de estilos: recorta, deduplica y acepta vacio', () => {
    assert.deepEqual(catalogs.sanitizeStyleList(['  Realismo ', 'realismo', 'Japonés', 'Japones', '<b>x</b>', 42, '']),
        ['Realismo', 'Japonés', 'bx/b']);
    assert.deepEqual(catalogs.sanitizeStyleList(undefined), []);
    const payload = registration.buildArtistRegistrationPayload({ styles: ['Fine Line', 'fine line', 'Otro mío'] }, {});
    assert.deepEqual(payload.styles_array, ['Fine Line', 'Otro mío']);
    assert.equal(payload.estilo, 'Fine Line, Otro mío');
});

test('paises: 32, EE.UU./Argentina/España primero y el resto alfabetico, con ISO-2 y moneda', () => {
    const countries = catalogs.REGISTRATION_COUNTRIES;
    assert.equal(countries.length, 32);
    assert.deepEqual(countries.slice(0, 3).map((c) => c.code), ['US', 'AR', 'ES']);
    const rest = countries.slice(3).map((c) => c.name);
    assert.deepEqual(rest, [...rest].sort((a, b) => a.localeCompare(b, 'es')));
    const codes = countries.map((c) => c.code);
    assert.equal(new Set(codes).size, 32);
    countries.forEach((c) => {
        assert.match(c.code, /^[A-Z]{2}$/);
        assert.match(c.currency, /^[A-Z]{3}$/);
    });
    assert.equal(catalogs.countryByCode('ar').currency, 'ARS');
});

test('monedas: solo las de los paises del registro y sin duplicados', () => {
    const currencies = catalogs.REGISTRATION_CURRENCIES.map((c) => c.code);
    assert.equal(new Set(currencies).size, currencies.length);
    assert.deepEqual(currencies.slice(0, 3), ['USD', 'ARS', 'EUR']);
    assert.deepEqual([...new Set(catalogs.REGISTRATION_COUNTRIES.map((c) => c.currency))].sort(), [...currencies].sort());
    assert.ok(catalogs.isRegistrationCurrency('eur'));
    assert.ok(!catalogs.isRegistrationCurrency('CNY'));
});

test('GET /api/registration/catalogs expone estilos, paises y monedas', () => {
    assert.match(read('server.js'), /app\.get\('\/api\/registration\/catalogs'/);
    const body = catalogs.getRegistrationCatalogs();
    assert.equal(body.styles.quick.length, 10);
    assert.equal(body.styles.groups.length, 3);
    assert.equal(body.countries.length, 32);
    assert.ok(body.currencies.length > 0);
});

// ------------------------------------------------------------ pag. 7 · bio

test('bio: allowlist de formato enriquecido', () => {
    const html = bio.sanitizeBioHtml(
        '<p><b>Negrita</b> <strong>fuerte</strong> <i>it</i> <em>em</em> <u>sub</u> <mark>resaltado</mark></p>' +
        '<ul><li>uno</li><li>dos</li></ul><ol><li>a</li></ol>' +
        '<span style="color: #c62828; background-color: #fff59d; font-size: 18px">color</span><br>' +
        '<a href="mailto:hola@weotzi.com">mail</a>'
    );
    assert.match(html, /<b>Negrita<\/b> <strong>fuerte<\/strong> <i>it<\/i> <em>em<\/em> <u>sub<\/u> <mark>resaltado<\/mark>/);
    assert.match(html, /<ul><li>uno<\/li><li>dos<\/li><\/ul><ol><li>a<\/li><\/ol>/);
    assert.match(html, /<span style="color: #c62828; background-color: #fff59d; font-size: 18px">color<\/span><br>/);
    assert.match(html, /<a href="mailto:hola@weotzi\.com" target="_blank" rel="noopener noreferrer">mail<\/a>/);
});

test('bio: sin XSS', () => {
    const attacks = [
        '<script>alert(1)</script>',
        '<img src=x onerror=alert(1)>',
        '<a href="javascript:alert(1)">x</a>',
        '<a href="&#106;avascript:alert(1)">x</a>',
        '<a href=" JaVaScRiPt:alert(1)">x</a>',
        '<a href="data:text/html,<script>alert(1)</script>">x</a>',
        '<p onclick="alert(1)" style="background:url(javascript:alert(1))">x</p>',
        '<span style="font-size: expression(alert(1))">x</span>',
        '<svg onload=alert(1)><circle/></svg>',
        '<iframe src="https://evil.example"></iframe>',
        '<b onmouseover=alert(1)>x</b>',
        '<a href="https://ok.example" style="position:fixed">x</a>',
        '<<script>script>alert(1)<</script>/script>'
    ];
    for (const attack of attacks) {
        const out = bio.sanitizeBioHtml(attack);
        assert.doesNotMatch(out, /<script|<img|<svg|<iframe|on\w+=|javascript:|data:|expression\(|position:/i, `${attack} -> ${out}`);
    }
});

test('bio: font-size acotado, enlaces relativos fuera y HTML balanceado', () => {
    assert.equal(bio.sanitizeBioHtml('<span style="font-size: 400px">x</span>'), '<span>x</span>');
    assert.equal(bio.sanitizeBioHtml('<span style="font-size: 1.25em">x</span>'), '<span style="font-size: 1.25em">x</span>');
    assert.equal(bio.sanitizeBioHtml('<a href="/admin">x</a>'), '<a>x</a>');
    assert.equal(bio.sanitizeBioHtml('<b><i>x</b> y'), '<b><i>x</i></b> y');
    assert.equal(bio.sanitizeBioHtml('</b>suelto<b>abierto'), 'suelto<b>abierto</b>');
    assert.equal(bio.sanitizeBioHtml('<div>legado</div><font color="#123456">c</font>'), '<p>legado</p><span style="color: #123456">c</span>');
    assert.equal(bio.sanitizeBioHtml('linea 1\nlinea 2 <3'), 'linea 1<br>linea 2 &lt;3');
});

test('bio: maximo 2000 caracteres de texto visible (el markup no cuenta)', () => {
    const long = '<p><b>' + 'a'.repeat(1500) + '</b> <mark>' + 'b'.repeat(1500) + '</mark></p>';
    const out = bio.sanitizeBioHtml(long);
    assert.equal(bio.bioVisibleLength(out), 2000);
    assert.match(out, /<\/mark><\/p>$/);
    const exact = '<b>' + 'x'.repeat(2000) + '</b>';
    assert.equal(bio.sanitizeBioHtml(exact), exact);
    const emojis = '🎨'.repeat(2000);
    assert.equal(bio.bioVisibleLength(bio.sanitizeBioHtml(emojis)), 2000);
    assert.equal(bio.bioVisibleLength(bio.sanitizeBioHtml('<b>a &amp; b</b>')), 5);
    assert.equal(bio.MAX_BIO_TEXT_LENGTH, 2000);
});

test('bio: se sanea al guardar en finalize/borrador y en el endpoint del perfil', () => {
    const payload = registration.buildArtistRegistrationPayload({
        bio: '<p onclick="x">Hola <script>alert(1)</script><mark>tattoo</mark></p>'
    }, {});
    assert.equal(payload.bio_description, '<p>Hola <mark>tattoo</mark></p>');
    const src = read('server.js');
    assert.match(src, /app\.post\('\/api\/artist\/profile\/bio'/);
    assert.match(src, /sanitizeBio\(raw, MAX_BIO_TEXT_LENGTH\)/);
});
