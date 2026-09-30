/* Trusted preview bootstrap. Local fixtures only; never contacts the real backend.
 * Installed by the owner outside branch checkouts, injected before page scripts.
 * Preview behavior is deliberately labelled simulated, not production validation.
 */
(function (root, boot) {
    'use strict';
    if (typeof module === 'object' && module.exports) module.exports = boot;
    else boot(root);
}(typeof window !== 'undefined' ? window : this, function bootPreview(window) {
    'use strict';
    const document = window.document;
    const origin = window.location.origin;
    const base = String(window.WEOTZI_BASE_PATH || '').replace(/\/$/, '');
    const version = String(window.WEOTZI_PREVIEW_COMMIT || 'local-safe');
    const key = 'weotzi-preview:' + (base || 'local') + ':' + version;
    const nativeFetch = window.fetch.bind(window);
    const coverage = [];
    const listeners = new Set();
    const defaultId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const defaultEmail = 'valentina.preview@example.invalid';
    const defaultIdentity = { userId: defaultId, email: defaultEmail, username: 'valentina-preview.wo', name: 'Valentina · Preview' };
    // The legacy demo flag bypasses normal auth/controllers. Preview uses those
    // controllers with the trusted fake SDK, and is identified by WEOTZI_PREVIEW.
    // Discard stale app config on this isolated origin; never retain real keys.
    try { window.localStorage.setItem('weotzi_config', JSON.stringify({
        supabase: { url: 'https://preview.weotzi.invalid', anonKey: 'weotzi-preview-public', storageBucket: 'preview-fixtures' },
        features: { demoMode: false, emailNotifications: false, imageUpload: false },
        deployment: { environment: 'preview', isolated: true, dataMode: 'browser-demo', emailEnabled: false }
    })); } catch (_) { /* configuration fetch still supplies safe values */ }
    let store;
    let lastError = '';
    let session;
    let banner;
    window.WEOTZI_PREVIEW = true;

    function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
    function readStorage(name) { try { return window.localStorage.getItem(key + ':' + name); } catch (_) { return null; } }
    function writeStorage(name, value) { try { window.localStorage.setItem(key + ':' + name, value); } catch (_) { /* isolated storage can be disabled */ } }
    function scoped(path) {
        if (!path || !String(path).startsWith('/') || String(path).startsWith('//')) return path;
        if (base && (path === base || path.startsWith(base + '/'))) return path;
        return base + path;
    }
    function identityId(email) {
        if (email === defaultEmail) return defaultId;
        // Deterministic fictitious identity; this is not an authentication verifier.
        let hash = 2166136261;
        for (const c of email) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
        const part = (hash >>> 0).toString(16).padStart(8, '0');
        return part + '-aaaa-4aaa-8aaa-' + part + 'aaaa';
    }
    function makeUser(email, metadata) {
        return { id: identityId(email), email, aud: 'authenticated', role: 'authenticated',
            user_metadata: Object.assign({ name: defaultIdentity.name, full_name: defaultIdentity.name, user_type: 'artist', username: defaultIdentity.username }, metadata || {}),
            app_metadata: { provider: 'preview', providers: ['preview'], preview: true }, created_at: new Date().toISOString() };
    }
    function makeSession(user) {
        const encode = value => window.btoa(JSON.stringify(value)).replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
        return { user, access_token: encode({ alg: 'none', typ: 'JWT' }) + '.' + encode({ sub: user.id, email: user.email, role: 'authenticated', preview: true }) + '.preview-only',
            refresh_token: 'preview-only', token_type: 'bearer', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400 };
    }
    const savedSession = readStorage('session');
    try { session = savedSession !== null ? JSON.parse(savedSession) : makeSession(makeUser(defaultEmail)); }
    catch (_) { session = makeSession(makeUser(defaultEmail)); }
    function record(operation, status, detail) {
        if (!coverage.some(entry => entry.operation === operation && entry.status === status)) coverage.push({ operation, status, detail: detail || '', time: new Date().toISOString() });
        if (status === 'blocked' || status === 'unsupported') { lastError = detail || operation; renderBanner(); }
    }
    function error(message, operation) {
        record(operation || message, 'unsupported', message);
        return { message, code: 'PREVIEW_UNSUPPORTED', preview: true };
    }
    function json(body, status, headers) {
        return new window.Response(status === 204 ? null : JSON.stringify(body), { status: status || 200, headers: Object.assign({ 'content-type': 'application/json', 'x-weotzi-preview': 'simulated' }, headers || {}) });
    }
    function blocked(operation) { return json({ success: false, preview: true, error: error('No simulado en preview: ' + operation + '. Requiere una prueba autorizada en el entorno real.', operation).message }, 501); }
    function publishSession(next, event) {
        session = next;
        writeStorage('session', JSON.stringify(session));
        listeners.forEach(callback => { try { callback(event, clone(session)); } catch (_) { /* application listener errors cannot bypass isolation */ } });
        renderBanner();
    }
    function loadScript(path, exportName) {
        if (window[exportName]) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = scoped(path); script.async = false;
            script.onload = resolve;
            script.onerror = () => reject(new Error('No se pudo cargar el emulador local: ' + path));
            (document.head || document.documentElement).appendChild(script);
        });
    }
    function remapAssets(value) {
        if (typeof value === 'string' && value.startsWith('/shared/')) return scoped(value);
        if (Array.isArray(value)) return value.map(remapAssets);
        if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, remapAssets(v)]));
        return value;
    }
    function seedProfiles(tables) {
        const gallery = [1, 2, 3].map(n => scoped('/shared/assets/demo/ref-0' + n + '.svg'));
        const artist = { id: defaultId, user_id: defaultId, username: defaultIdentity.username, name: defaultIdentity.name, email: defaultEmail,
            bio: 'Perfil ficticio para revisar diseño y navegación. Los trabajos son ilustraciones de prueba.',
            bio_description: 'Perfil ficticio para revisar diseño y navegación. Los trabajos son ilustraciones de prueba.',
            ubicacion: 'Buenos Aires, Argentina', city: 'Buenos Aires', country: 'Argentina',
            address: 'Dirección ficticia', latitude: -34.6037, longitude: -58.3816, years_experience: 5,
            styles_array: ['Fine line', 'Blackwork'], estilo: 'Fine line', session_price: '180 USD', session_price_amount: 180, session_price_currency: 'USD', session_currency: 'USD',
            profile_picture: scoped('/shared/assets/demo/client-avatar.svg'), gallery_images: gallery,
            gallery_feed_items: gallery.map((url, i) => ({ id: 'preview-work-' + i, url, media_type: 'image', category: i === 0 ? 'Fine line' : 'Blackwork', is_featured: i === 0 })),
            instagram: 'valentina.preview', portafolio: '', work_type: 'independent', estudios: '', birth_date: '1995-06-01',
            subscribed_newsletter: false, ms_profile_complete: true, profile_completeness: 100, registration_status: 'aprobado', registration_step: 12,
            is_public: true, created_at: new Date().toISOString() };
        const client = { id: defaultId, user_id: defaultId, email: defaultEmail, name: defaultIdentity.name, full_name: defaultIdentity.name,
            username: 'valentina-preview.cliente', public_username: 'valentina-preview.cliente', city_residence: 'Buenos Aires', city: 'Buenos Aires', country: 'Argentina',
            profile_picture: artist.profile_picture, whatsapp: '', created_at: artist.created_at };
        tables.artists_db = [artist];
        tables.clients_db = [client];
        tables.client_public_profiles.push(Object.assign({}, client));
        tables.quotations_db.forEach(row => { row.client_user_id = defaultId; row.client_email = defaultEmail; row.client_full_name = defaultIdentity.name; });
        tables.job_board_requests.slice(0, 2).forEach(row => { row.client_user_id = defaultId; });
        tables.tattoo_styles = ['Fine line', 'Blackwork', 'Realismo', 'Japonés', 'Dotwork', 'Geométrico'].map((name, i) => ({ id: i + 1, name, display_name: name, sort_order: i, is_active: true }));
        tables.body_parts = ['Antebrazo', 'Brazo', 'Espalda', 'Pierna', 'Muñeca', 'Hombro', 'Pantorrilla', 'Muslo'].map((name, i) => ({ id: i + 1, name, display_name: name, sort_order: i, is_active: true, sides: ['Izquierdo', 'Derecho'], has_sides: true }));
        tables.quotation_flow_config = [];
        tables.app_settings = [];
        tables.currencies = [{ code: 'USD', name: 'Dólar estadounidense', symbol: '$', is_active: true, exchange_rate: 1 }, { code: 'ARS', name: 'Peso argentino', symbol: '$', is_active: true, exchange_rate: 1000 }];
        tables.artist_gallery_categories = [];
        tables.artist_tattoo_locations = [{ id: 'preview-location', artist_user_id: defaultId, period_type: 'current', sort_order: 0,
            city: 'Buenos Aires', country: 'Argentina', address: 'Dirección ficticia', latitude: -34.6037, longitude: -58.3816,
            start_date: null, end_date: null, studio_id: null, studio_name: null }];
        tables.session_logs = [];
        tables.user_notification_reads = [];
        tables.artists_with_location = clone(tables.artists_db);
        tables.artist_public_travel_presences = [];
        tables.studio_public_profiles = clone(tables.studios);
    }
    const ready = Promise.all([
        loadScript('/shared/js/wo-demo-postgrest.js', 'WoDemoPostgrest'),
        loadScript('/shared/js/wo-demo-fixtures.js', 'WoDemoFixtures')
    ]).then(() => {
        const fixtures = window.WoDemoFixtures.build(defaultIdentity);
        seedProfiles(fixtures.tables);
        fixtures.rpcs.get_artist_public_profile_preferences = () => ({ show_reviews: true, show_studio: true, show_availability: true, show_portfolio: true });
        fixtures.rpcs.check_email_registered = args => store.rows('clients_db').some(c => c.email === (args.email_to_check || args.p_email)) || store.rows('artists_db').some(a => a.email === (args.email_to_check || args.p_email));
        store = window.WoDemoPostgrest.createStore({ tables: remapAssets(fixtures.tables), relations: fixtures.relations, rpcs: fixtures.rpcs, views: fixtures.views });
        try { const saved = JSON.parse(readStorage('tables') || 'null'); if (saved && typeof saved === 'object') store.load(saved); } catch (_) { /* regenerate corrupt fixtures */ }
        store.onChange(() => writeStorage('tables', JSON.stringify(store.dump())));
        record('fixtures', 'simulated', 'Datos ficticios; cambios guardados solo en este navegador.');
        return store;
    }).catch(cause => { lastError = cause.message; record('fixtures', 'blocked', cause.message); throw cause; });
    // Avoid the legacy demo layer's pass-through behavior or a second emulation store.
    try { window.sessionStorage.setItem('wo_demo_mode', '0'); } catch (_) { /* storage can be blocked */ }

    async function ensureProfiles(user) {
        const st = await ready;
        if (!st.rows('clients_db').some(c => c.user_id === user.id)) st.insert('clients_db', [{ id: user.id, user_id: user.id, email: user.email, name: user.user_metadata.full_name, username: 'preview-' + user.id.slice(0, 8), city_residence: 'Buenos Aires', country: 'Argentina' }]);
        if (!st.rows('artists_db').some(a => a.user_id === user.id)) st.insert('artists_db', [Object.assign({}, st.rows('artists_db')[0], { id: user.id, user_id: user.id, email: user.email, name: user.user_metadata.full_name, username: 'preview-' + user.id.slice(0, 8) + '.wo' })]);
    }
    async function login(options, signup) {
        const email = String(options && options.email || '').trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || String(options && options.password || '').length < 8) return { data: { session: null, user: null }, error: { code: 'PREVIEW_INPUT', message: 'En preview usá un correo ficticio válido y una contraseña de 8 o más caracteres.' } };
        const user = makeUser(email, options.options && options.options.data);
        await ensureProfiles(user);
        publishSession(makeSession(user), 'SIGNED_IN');
        record(signup ? 'auth.signup' : 'auth.login', 'simulated', 'Sesión ficticia; no verifica contraseñas contra Supabase.');
        return { data: { user: clone(user), session: clone(session) }, error: null };
    }
    const auth = {
        getSession: async () => ({ data: { session: clone(session) }, error: null }),
        getUser: async () => ({ data: { user: session ? clone(session.user) : null }, error: null }),
        signInWithPassword: options => login(options, false),
        signUp: options => login(options, true),
        setSession: async () => ({ data: null, error: error('La preview no acepta tokens externos.', 'auth.setSession') }),
        refreshSession: async () => ({ data: { session: clone(session), user: session && clone(session.user) }, error: null }),
        signOut: async options => { if (options && options.scope === 'others') return { error: error('La preview no controla sesiones de otros dispositivos.', 'auth.signOutOthers') }; publishSession(null, 'SIGNED_OUT'); return { error: null }; },
        onAuthStateChange: callback => { listeners.add(callback); Promise.resolve().then(() => callback('INITIAL_SESSION', clone(session))); return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } }; },
        updateUser: async values => {
            if (!session) return { data: { user: null }, error: { message: 'Iniciá la sesión ficticia.' } };
            if (values.password || values.email) return { data: null, error: error('Cambio de contraseña/correo no simulado; requiere el entorno real.', 'auth.updateCredentials') };
            const next = clone(session); next.user.user_metadata = Object.assign(next.user.user_metadata, values.data || {}); publishSession(next, 'USER_UPDATED');
            return { data: { user: clone(next.user) }, error: null };
        },
        mfa: {
            listFactors: async () => ({ data: { all: [], totp: [], phone: [] }, error: null }),
            getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: 'aal1', nextLevel: 'aal1', currentAuthenticationMethods: [] }, error: null })
        }
    };
    ['signInWithOAuth', 'resetPasswordForEmail', 'signInWithOtp', 'verifyOtp', 'exchangeCodeForSession'].forEach(method => { auth[method] = async () => ({ data: null, error: error('Autenticación externa o envío de correo no simulado: ' + method, 'auth.' + method) }); });
    ['enroll', 'unenroll', 'challenge', 'verify', 'challengeAndVerify'].forEach(method => { auth.mfa[method] = async () => ({ data: null, error: error('MFA no simulado en preview.', 'mfa.' + method) }); });

    function query(path) {
        const params = new URLSearchParams();
        const headers = new window.Headers();
        let method = 'GET', body, maybe = false;
        const builder = {};
        const chain = name => (...args) => { builder._unsupported = name; error('Consulta no simulada: ' + name, 'query.' + name); return builder; };
        function filter(column, operator, value) { params.append(column, operator + '.' + String(value)); return builder; }
        ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'cs', 'cd', 'fts'].forEach(op => { builder[op] = (column, value) => filter(column, op, value); });
        builder.contains = (column, value) => filter(column, 'cs', JSON.stringify(value));
        builder.containedBy = (column, value) => filter(column, 'cd', JSON.stringify(value));
        builder.not = (column, op, value) => filter(column, 'not.' + op, value);
        builder.in = (column, values) => filter(column, 'in', '(' + values.map(v => '"' + String(v).replace(/"/g, '\\"') + '"').join(',') + ')');
        builder.or = value => { params.append('or', '(' + value + ')'); return builder; };
        builder.filter = filter;
        builder.match = values => { Object.entries(values).forEach(([k, v]) => filter(k, 'eq', v)); return builder; };
        builder.select = (columns, options) => { params.set('select', columns || '*'); if (method !== 'GET' && method !== 'HEAD') headers.set('Prefer', (headers.get('Prefer') || '') + ',return=representation'); if (options && options.count) headers.set('Prefer', (headers.get('Prefer') || '') + ',count=exact'); if (options && options.head) method = 'HEAD'; return builder; };
        builder.order = (column, options) => { const part = column + (options && options.ascending === false ? '.desc' : '.asc'); params.set('order', [params.get('order'), part].filter(Boolean).join(',')); return builder; };
        builder.limit = value => { params.set('limit', value); return builder; };
        builder.range = (first, last) => { params.set('offset', first); params.set('limit', last - first + 1); return builder; };
        builder.single = () => { headers.set('Accept', 'application/vnd.pgrst.object+json'); return builder; };
        builder.maybeSingle = () => { maybe = true; headers.set('Accept', 'application/vnd.pgrst.object+json'); return builder; };
        builder.insert = values => { method = 'POST'; body = values; return builder; };
        builder.upsert = (values, options) => { method = 'POST'; body = values; headers.set('Prefer', options && options.ignoreDuplicates ? 'resolution=ignore-duplicates' : 'resolution=merge-duplicates'); if (options && options.onConflict) params.set('on_conflict', options.onConflict); return builder; };
        builder.update = values => { method = 'PATCH'; body = values; return builder; };
        builder.delete = () => { method = 'DELETE'; return builder; };
        ['abortSignal', 'throwOnError'].forEach(name => { builder[name] = () => builder; });
        ['csv', 'textSearch', 'overlaps', 'explain'].forEach(name => { builder[name] = chain(name); });
        builder.then = (resolve, reject) => {
            const request = builder._unsupported ? Promise.resolve({ data: null, error: error('Consulta no soportada: ' + builder._unsupported, 'query.' + builder._unsupported) }) : window.fetch(scoped('/rest/v1/' + path) + '?' + params.toString(), { method, headers, body: body == null ? undefined : JSON.stringify(body) }).then(async response => {
                const text = await response.text(); let data = null; try { data = text ? JSON.parse(text) : null; } catch (_) { /* only structured emulator responses */ }
                if (maybe && response.status === 406 && data && data.code === 'PGRST116' && /0 rows/.test(data.details || '')) return { data: null, error: null, count: 0, status: 200 };
                const range = response.headers.get('content-range'); const total = range && range.split('/')[1];
                return { data: response.ok ? data : null, error: response.ok ? null : data, count: total && total !== '*' ? Number(total) : null, status: response.status, statusText: response.statusText };
            });
            return request.then(resolve, reject);
        };
        return builder;
    }
    function createClient(url, anonKey) {
        const channel = () => { const value = { on: () => value, subscribe: callback => { if (callback) Promise.resolve().then(() => callback('SUBSCRIBED')); return value; }, unsubscribe: async () => 'ok', send: async () => ({ error: error('Realtime remoto no simulado.', 'realtime.send') }) }; return value; };
        const client = { supabaseUrl: url, supabaseKey: anonKey, auth, from: table => query(table),
            rpc: (name, args, options) => { const q = query('rpc/' + name); q.insert(args || {}); if (options && options.head) q.select('*', { head: true, count: options.count }); return q; },
            channel, removeChannel: async () => 'ok', removeAllChannels: async () => [], getChannels: () => [],
            functions: { invoke: async name => ({ data: null, error: error('Edge Function no simulada: ' + name, 'function.' + name) }) },
            storage: { from: bucket => ({
                getPublicUrl: () => ({ data: { publicUrl: scoped('/shared/assets/demo/ref-01.svg') } }),
                upload: async () => ({ data: null, error: error('Subida de archivos no simulada.', 'storage.' + bucket + '.upload') }),
                remove: async () => ({ data: null, error: error('Eliminación de archivos no simulada.', 'storage.' + bucket + '.remove') }),
                download: async () => ({ data: null, error: error('Descarga privada no simulada.', 'storage.' + bucket + '.download') }),
                createSignedUrl: async () => ({ data: null, error: error('Enlace privado no simulado.', 'storage.' + bucket + '.signedUrl') })
            }) }
        };
        return client;
    }
    function hookLibrary(library) {
        const value = library && typeof library === 'object' ? library : {};
        try { Object.defineProperty(value, 'createClient', { configurable: true, enumerable: true, get: () => createClient, set: () => {} }); }
        catch (_) { value.createClient = createClient; }
        return value;
    }
    let library = hookLibrary(window.supabase);
    Object.defineProperty(window, 'supabase', { configurable: false, enumerable: true, get: () => library, set: value => { library = hookLibrary(value); } });

    async function bodyOf(input, init) {
        const raw = init && init.body != null ? init.body : input && typeof input.clone === 'function' ? await input.clone().text() : null;
        if (raw == null || raw === '') return {};
        if (typeof raw === 'string') { try { return JSON.parse(raw); } catch (_) { return null; } }
        return null;
    }
    async function api(path, method, input) {
        const st = await ready;
        if (path === '/api/account/testing' && method === 'GET') return json({ enabled: false, preview: true });
        if (path === '/api/account/mode' && method === 'POST') {
            if (!session) return json({ error: 'Iniciá la sesión ficticia.', preview: true }, 401);
            if (!input || !['artist', 'client'].includes(input.mode)) return json({ error: 'Modo no válido.', preview: true }, 400);
            await ensureProfiles(session.user); writeStorage('mode', input.mode);
            return json({ success: true, mode: input.mode, url: scoped('/' + input.mode + '/dashboard/'), redirect: scoped('/' + input.mode + '/dashboard/'), preview: true });
        }
        if (path === '/api/artist/public-profile-metrics' && method === 'GET') return json({ success: true, metrics: { tattooCount: 4, tattooCountLabel: '4+', responseRate: 91, responseRateLabel: '91%', avgResponseMinutes: 240, responseTimeLabel: 'Menos de 24 h' }, preview: true });
        if (path === '/api/currencies' && method === 'GET') return json({ success: true, currencies: clone(st.rows('currencies')), preview: true });
        if (path === '/api/quotations/intake' && method === 'POST') {
            if (!input || !['draft', 'submit'].includes(input.mode) || !/^[\da-f-]{36}$/i.test(input.submission_key || '')) return json({ error: 'Solicitud de prueba no válida.', preview: true }, 400);
            const q = input.quotation || {};
            if (input.mode === 'submit' && (!q.client_full_name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q.client_email || '') || !q.tattoo_idea_description || !q.tattoo_style || !q.tattoo_body_part || !q.tattoo_size)) return json({ error: 'Completá nombre, correo, idea, estilo, zona y tamaño.', preview: true }, 400);
            const quoteId = 'PREVIEW-' + input.submission_key;
            let row = st.rows('quotations_db').find(item => item.quote_id === quoteId);
            const artist = st.rows('artists_db').find(item => item.user_id === q.artist_id);
            const data = Object.assign({}, q, { quote_id: quoteId, quote_status: input.mode === 'submit' ? 'pending' : 'in_progress', client_user_id: session && session.user.id, artist_id: artist ? artist.user_id : null, artist_name: artist ? artist.name : null, artist_username: artist ? artist.username : null, preview: true });
            if (row) { Object.assign(row, data); writeStorage('tables', JSON.stringify(st.dump())); } else row = st.insert('quotations_db', [data])[0];
            record(path, 'simulated', 'Cotización guardada solamente en el navegador; no se enviaron notificaciones.');
            return json({ success: true, quote_id: quoteId, status: row.quote_status, preview: true });
        }
        return blocked(path);
    }
    window.fetch = async function previewFetch(input, init) {
        const url = new URL(typeof input === 'string' ? input : input.url, window.location.href);
        const method = String(init && init.method || input && input.method || 'GET').toUpperCase();
        const path = base && url.pathname.startsWith(base + '/') ? url.pathname.slice(base.length) : url.pathname;
        const rest = path.match(/^\/rest\/v1\/(.+)$/);
        if (rest) {
            try {
                const st = await ready; const table = decodeURIComponent(rest[1]);
                if (table.startsWith('rpc/') ? !st.rpcs[table.slice(4)] : !st.has(table)) return blocked('Supabase ' + table);
                const headers = new window.Headers(init && init.headers || input && input.headers || {});
                const body = await bodyOf(input, init);
                const result = st.handle({ method, path: table, search: url.search, headers, body: method === 'GET' || method === 'HEAD' ? null : JSON.stringify(body), ctx: { userId: session && session.user.id, identity: defaultIdentity } });
                // Some fixture RPCs mutate a row directly without emitting the
                // store change event. Persist every emulated mutation as well.
                if (!['GET', 'HEAD'].includes(method)) writeStorage('tables', JSON.stringify(st.dump()));
                record(method + ' ' + table, 'simulated');
                return new window.Response(method === 'HEAD' || result.status === 204 ? null : result.body, { status: result.status, headers: Object.assign({}, result.headers, { 'x-weotzi-preview': 'simulated' }) });
            } catch (cause) { return json({ message: cause.message, code: 'PREVIEW_FAILED', preview: true }, 503); }
        }
        if (/^\/api\//.test(path)) {
            if (path === '/api/release' && method === 'GET' && url.origin === origin) return nativeFetch(input, init);
            return api(path, method, await bodyOf(input, init));
        }
        if (/\/(auth|storage|functions)\/v1(?:\/|$)/.test(path)) return blocked(path);
        if (url.origin !== origin || !['GET', 'HEAD'].includes(method)) {
            record(method + ' ' + url.origin + path, 'blocked', 'Red externa o escritura no permitida en preview.');
            return json({ success: false, error: 'Operación real desactivada en preview.', preview: true }, 403);
        }
        return nativeFetch(url.href, init);
    };
    if (window.navigator && window.navigator.sendBeacon) window.navigator.sendBeacon = () => { record('sendBeacon', 'blocked', 'Telemetría externa desactivada en preview.'); return false; };
    function renderBanner() {
        if (!banner) return;
        const summary = banner.querySelector('[data-preview-summary]');
        const warning = banner.querySelector('[data-preview-error]');
        summary.textContent = 'PREVIEW · Datos ficticios · Sin emails ni backend real · ' + (session ? 'Sesión ficticia activa' : 'Sin sesión') + ' · ' + version.slice(0, 12);
        warning.textContent = lastError;
    }
    function mountBanner() {
        if (!document || !document.body || document.getElementById('weotzi-preview-bar')) return;
        banner = document.createElement('aside'); banner.id = 'weotzi-preview-bar'; banner.setAttribute('aria-label', 'Entorno de prueba');
        banner.style.cssText = 'position:relative;z-index:2147483647;background:#ffdd57;color:#181818;border-bottom:2px solid #181818;padding:8px 12px;font:12px/1.4 sans-serif;display:flex;flex-wrap:wrap;gap:8px;align-items:center';
        const summary = document.createElement('strong'); summary.dataset.previewSummary = ''; banner.appendChild(summary);
        const actions = [
            ['Artista de prueba', () => { publishSession(makeSession(makeUser(defaultEmail)), 'SIGNED_IN'); window.location.href = scoped('/artist/dashboard/'); }],
            ['Cliente de prueba', () => { publishSession(makeSession(makeUser(defaultEmail)), 'SIGNED_IN'); window.location.href = scoped('/client/dashboard/'); }],
            ['Salir de prueba', () => { publishSession(null, 'SIGNED_OUT'); window.location.href = scoped('/artist/login/'); }],
            ['Reiniciar datos', () => { try { window.localStorage.removeItem(key + ':tables'); window.localStorage.removeItem(key + ':session'); } catch (_) {} window.location.reload(); }]
        ];
        actions.forEach(([text, action]) => { const button = document.createElement('button'); button.type = 'button'; button.textContent = text; button.addEventListener('click', action); banner.appendChild(button); });
        const warning = document.createElement('span'); warning.dataset.previewError = ''; warning.setAttribute('role', 'status'); banner.appendChild(warning);
        document.body.insertBefore(banner, document.body.firstChild); renderBanner();
    }
    if (document) { if (document.body) mountBanner(); else document.addEventListener('DOMContentLoaded', mountBanner, { once: true }); }
    const runtime = { ready, auth, createClient, coverage, scoped, isSimulated: true, getStore: () => store, getSession: () => clone(session) };
    window.WeotziPreview = runtime;
    return runtime;
}));
