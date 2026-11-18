(function (root, factory) {
    const exported = factory(root);

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = exported;
    }

    if (root) {
        root.ArtistAuth = exported;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
    'use strict';

    const DEFAULT_MAX_WAIT = 3000;
    const AUTH_SESSION_TIMEOUT_MS = 8000;
    const ARTIST_LOOKUP_TIMEOUT_MS = 8000;
    const ARTIST_PROGRESS_FIELDS = [
        'user_id',
        'username',
        'name',
        'email',
        'ubicacion',
        'styles_array',
        'estilo',
        'years_experience',
        'session_price',
        'portafolio',
        'instagram',
        'work_type',
        'estudios',
        'birth_date',
        'subscribed_newsletter',
        'ms_profile_complete',
        'profile_completeness'
    ];

    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async function withTimeout(promise, timeoutMs, code, message) {
        let timeoutId = null;
        const timeout = new Promise((resolve) => {
            timeoutId = setTimeout(() => {
                resolve({
                    timedOut: true,
                    error: { code, message }
                });
            }, timeoutMs);
        });

        return Promise.race([promise, timeout]).finally(() => {
            if (timeoutId) clearTimeout(timeoutId);
        });
    }

    // ── términos (2.7.0): cuenta dada de baja. Supabase Auth responde
    // user_banned («User is banned») al iniciar sesión; se muestra el mensaje de
    // la baja en vez del error técnico. Compartido (idempotente) entre
    // artist-auth.js, client-auth.js y studio-auth.js; artist-login.js puede
    // usar window.WoAccountBan.isBannedError(error) / .MESSAGE.
    if (root) root.WoAccountBan = root.WoAccountBan || {
        MESSAGE: 'Tu cuenta fue dada de baja por incumplir los Términos. Revisa el correo que te enviamos para conocer el motivo y cómo apelar.',
        isBannedError: function (error) {
            if (!error) return false;
            if (error.code === 'user_banned' || error.error_code === 'user_banned') return true;
            return /\bbanned\b/i.test(String(error.message || error.msg || ''));
        }
    };

    // ── términos (2.7.0): gate de re-aceptación y cuentas sancionadas
    // (public/shared/js/wo-terms-gate.js). No bloquea la resolución de la
    // sesión: el modal del gate tapa la página si hace falta. Si el gate
    // todavía no cargó, se encola y se inyecta el script (respeta /beta).
    function requestTermsGate(targetRoot, session, supabase) {
        try {
            const win = targetRoot;
            if (!win || !win.document || !session || !session.access_token) return;
            if (win.WoTermsGate && typeof win.WoTermsGate.ensure === 'function') {
                win.WoTermsGate.ensure(session, { surface: 'artist', supabase });
                return;
            }
            win.__woTermsGateQueue = win.__woTermsGateQueue || [];
            win.__woTermsGateQueue.push({ session, surface: 'artist', supabase });
            const doc = win.document;
            if (doc.querySelector('script[data-wo-terms-gate]')) return;
            const pathname = (win.location && win.location.pathname) || '';
            const base = win.WEOTZI_BASE_PATH
                ? String(win.WEOTZI_BASE_PATH).replace(/\/$/, '')
                : (/^\/beta(?:\/|$)/.test(pathname) ? '/beta' : '');
            const script = doc.createElement('script');
            script.src = base + '/shared/js/wo-terms-gate.js?v=20261118';
            script.async = true;
            script.setAttribute('data-wo-terms-gate', '');
            (doc.head || doc.documentElement).appendChild(script);
        } catch (_) {
            // Sin DOM (tests) o sin permisos: el gate también lo carga wo-consent.js.
        }
    }

    function getRoutes(configManager) {
        if (!configManager) return {};
        if (typeof configManager.getRoutes === 'function') {
            return configManager.getRoutes() || {};
        }
        if (typeof configManager.getValue === 'function') {
            return configManager.getValue('routes') || {};
        }
        return {};
    }

    function getRoute(configManager, key, fallback) {
        const routes = getRoutes(configManager);
        return routes[key] || fallback;
    }

    function normalizeReturnTo(returnTo, fallback = '') {
        if (!returnTo || typeof returnTo !== 'string') {
            return fallback;
        }

        const trimmedValue = returnTo.trim();
        if (!trimmedValue.startsWith('/') || trimmedValue.startsWith('//')) {
            return fallback;
        }

        if (/^[a-zA-Z][a-zA-Z0-9+\-.]*:/.test(trimmedValue)) {
            return fallback;
        }

        return trimmedValue;
    }

    function buildUrl(path, params = {}) {
        const searchParams = new URLSearchParams();

        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                searchParams.set(key, String(value));
            }
        });

        const query = searchParams.toString();
        return query ? `${path}?${query}` : path;
    }

    function getLocationSearch(targetRoot = root) {
        return targetRoot && targetRoot.location ? targetRoot.location.search || '' : '';
    }

    function getLocationPathname(targetRoot = root) {
        return targetRoot && targetRoot.location ? targetRoot.location.pathname || '' : '';
    }

    function getReturnTo(search = '', fallback = '') {
        const rawValue = new URLSearchParams(search || '').get('returnTo');
        return normalizeReturnTo(rawValue, fallback);
    }

    function getRouteUrls(configManager, returnTo = '') {
        const registerClosedBeta = getRoute(configManager, 'registerClosedBeta', '/registerclosedbeta');
        const registerArtist = getRoute(configManager, 'registerArtist', '/register-artist');
        const dashboard = getRoute(configManager, 'dashboard', '/artist/dashboard');
        const jobBoard = getRoute(configManager, 'jobBoard', '/job-board');
        const normalizedReturnTo = normalizeReturnTo(returnTo, '');

        return {
            registerClosedBeta,
            login: buildUrl(registerClosedBeta, { returnTo: normalizedReturnTo }),
            registerArtist: buildUrl(registerArtist, { returnTo: normalizedReturnTo }),
            dashboard,
            jobBoard
        };
    }

    async function waitForConfigManager(options = {}) {
        const targetRoot = options.root || root;
        if (options.configManager) {
            return options.configManager;
        }

        if (!targetRoot) {
            return null;
        }

        const maxWait = typeof options.maxWait === 'number' ? options.maxWait : DEFAULT_MAX_WAIT;
        const startTime = Date.now();

        while ((Date.now() - startTime) < maxWait) {
            if (targetRoot.ConfigManager) {
                if (typeof targetRoot.ConfigManager.ready === 'function') {
                    try {
                        const remaining = Math.max(0, maxWait - (Date.now() - startTime));
                        await Promise.race([
                            targetRoot.ConfigManager.ready(),
                            delay(remaining)
                        ]);
                    } catch (error) {
                        console.warn('ArtistAuth: ConfigManager.ready failed', error);
                    }
                }
                return targetRoot.ConfigManager;
            }

            await delay(50);
        }

        return targetRoot.ConfigManager || null;
    }

    function getSupabaseClient(configManager) {
        if (!configManager || typeof configManager.getSupabaseClient !== 'function') {
            return null;
        }

        if (typeof configManager.isDemoMode === 'function' && configManager.isDemoMode()) {
            return null;
        }

        return configManager.getSupabaseClient();
    }

    function getSupabaseConfig(configManager) {
        const fromGetter = (key) => (
            typeof configManager?.getValue === 'function'
                ? configManager.getValue(`supabase.${key}`)
                : null
        );
        const config = typeof configManager?.get === 'function' ? configManager.get() : null;
        return {
            url: fromGetter('url') || config?.supabase?.url || root?.CONFIG?.supabase?.url || '',
            anonKey: fromGetter('anonKey') || config?.supabase?.anonKey || root?.CONFIG?.supabase?.anonKey || ''
        };
    }

    function getSupabaseProjectRef(supabaseUrl) {
        try {
            return new URL(supabaseUrl).hostname.split('.')[0] || '';
        } catch (_) {
            return '';
        }
    }

    function readStoredSupabaseSession(configManager) {
        try {
            if (!root?.localStorage) return null;
            const { url } = getSupabaseConfig(configManager);
            const projectRef = getSupabaseProjectRef(url);
            if (!projectRef) return null;
            const raw = root.localStorage.getItem(`sb-${projectRef}-auth-token`);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            const session = parsed?.currentSession || parsed?.session || parsed;
            if (!session?.user || !session.access_token) return null;
            const expiresAt = Number(session.expires_at || 0);
            if (expiresAt && expiresAt < Math.floor(Date.now() / 1000)) return null;
            return session;
        } catch (error) {
            console.warn('ArtistAuth: stored session recovery failed', error);
            return null;
        }
    }

    async function fetchArtistViaRest(configManager, session, artistSelect) {
        try {
            if (typeof fetch !== 'function' || !session?.user?.id) return null;
            const { url, anonKey } = getSupabaseConfig(configManager);
            if (!url || !anonKey) return null;
            const searchParams = new URLSearchParams();
            searchParams.set('select', artistSelect);
            searchParams.set('user_id', `eq.${session.user.id}`);
            // pii-artistas: la fila propia completa (email, fecha de nacimiento...)
            // sale de la RPC; artists_db tiene privilegios por columna.
            const path = `rpc/get_my_artist_profile?${searchParams.toString()}`;
            const accessToken = session.access_token || anonKey;
            // Centraliza el GET crudo en la capa (WeotziData.restGet) cuando esta
            // disponible; en el entorno de tests (sin window.WeotziData) degrada
            // al fetch inline. Config explicita -> respeta la inyeccion de
            // dependencias (url/anonKey vienen del configManager inyectado).
            const restGet = (typeof window !== 'undefined' && window.WeotziData && window.WeotziData.restGet) || null;
            const request = restGet
                ? restGet({ url, anonKey, accessToken, path })
                : fetch(`${url}/rest/v1/${path}`, {
                    headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}` }
                });
            const response = await withTimeout(
                request,
                ARTIST_LOOKUP_TIMEOUT_MS,
                'ARTIST_REST_TIMEOUT',
                `Artist REST lookup timed out after ${ARTIST_LOOKUP_TIMEOUT_MS}ms`
            );
            if (response?.timedOut || !response?.ok) return null;
            const rows = await response.json();
            return Array.isArray(rows) ? (rows[0] || null) : null;
        } catch (error) {
            console.warn('ArtistAuth: REST artist lookup failed', error);
            return null;
        }
    }

    // pii-artistas (20261113106000): ARTIST_PROGRESS_FIELDS incluye columnas
    // privadas (email, birth_date, subscribed_newsletter...) que anon y
    // authenticated ya no pueden leer de artists_db. La fila propia completa sale
    // de la RPC get_my_artist_profile() (admite select/eq/maybeSingle). Clientes
    // sin .rpc (stubs de tests) siguen por la tabla.
    function ownArtistLookup(supabase, artistSelect, userId) {
        if (supabase && typeof supabase.rpc === 'function') {
            return supabase.rpc('get_my_artist_profile').select(artistSelect).eq('user_id', userId);
        }
        return supabase.from('artists_db').select(artistSelect).eq('user_id', userId);
    }

    function mergeArtistSelect(artistSelect) {
        const columns = new Set();

        ARTIST_PROGRESS_FIELDS.forEach((field) => {
            columns.add(field);
        });

        if (typeof artistSelect === 'string' && artistSelect.trim()) {
            artistSelect.split(',').forEach((field) => {
                const normalized = field.trim();
                if (normalized) {
                    columns.add(normalized);
                }
            });
        }

        return Array.from(columns).join(', ');
    }

    function getArtistProgress(artist, targetRoot = root) {
        if (!artist) return null;

        if (targetRoot?.ArtistRegistrationProgress?.analyzeArtistProfile) {
            return targetRoot.ArtistRegistrationProgress.analyzeArtistProfile(artist);
        }

        const hasName = Boolean(String(artist.name || '').trim());
        return {
            isComplete: hasName,
            nextStep: hasName ? null : 2
        };
    }

    function buildBaseState({
        status,
        urls,
        configManager = null,
        supabase = null,
        session = null,
        currentUser = null,
        artist = null,
        artistError = null,
        artistProgress = null
    }) {
        const hasArtistProfile = Boolean(artist);
        const resolvedArtistProgress = artistProgress || getArtistProgress(artist);
        const hasCompleteProfile = Boolean(artist && resolvedArtistProgress?.isComplete);

        return {
            status,
            urls,
            configManager,
            supabase,
            session,
            currentUser,
            artist,
            artistError,
            artistProgress: resolvedArtistProgress,
            isArtist: hasArtistProfile,
            hasArtistProfile,
            hasCompleteProfile
        };
    }

    async function resolveArtistAuthState(options = {}) {
        const targetRoot = options.root || root;
        const defaultReturnTo = normalizeReturnTo(
            options.fallbackReturnTo || getLocationPathname(targetRoot),
            '/artist/dashboard'
        );
        const returnTo = normalizeReturnTo(
            options.returnTo || getReturnTo(options.search || getLocationSearch(targetRoot), defaultReturnTo),
            defaultReturnTo
        );
        const configManager = await waitForConfigManager({
            root: targetRoot,
            configManager: options.configManager,
            maxWait: options.maxWait
        });
        const urls = getRouteUrls(configManager, returnTo);

        if (!configManager) {
            return buildBaseState({
                status: 'config_unavailable',
                urls
            });
        }

        const supabase = getSupabaseClient(configManager);
        if (!supabase) {
            return buildBaseState({
                status: typeof configManager.isDemoMode === 'function' && configManager.isDemoMode()
                    ? 'demo_mode'
                    : 'client_unavailable',
                urls,
                configManager
            });
        }

        let {
            data: authData,
            error: authError,
            timedOut: authTimedOut
        } = await withTimeout(
            supabase.auth.getSession(),
            AUTH_SESSION_TIMEOUT_MS,
            'AUTH_SESSION_TIMEOUT',
            `Supabase session lookup timed out after ${AUTH_SESSION_TIMEOUT_MS}ms`
        );
        if (authTimedOut) {
            const storedSession = readStoredSupabaseSession(configManager);
            if (storedSession?.user) {
                authData = { session: storedSession };
                authError = null;
            } else {
                return buildBaseState({
                    status: 'auth_error',
                    urls,
                    configManager,
                    supabase,
                    artistError: authError
                });
            }
        }
        if (authError) {
            return buildBaseState({
                status: 'auth_error',
                urls,
                configManager,
                supabase,
                artistError: authError
            });
        }

        const session = authData ? authData.session : null;
        if (!session || !session.user) {
            return buildBaseState({
                status: 'anonymous',
                urls,
                configManager,
                supabase
            });
        }

        const currentUser = session.user;
        const artistSelect = mergeArtistSelect(options.artistSelect);
        requestTermsGate(targetRoot, session, supabase);

        let artist = null;
        let artistError = null;

        try {
            const lookup = ownArtistLookup(supabase, artistSelect, currentUser.id);

            if (typeof lookup.maybeSingle === 'function') {
                ({ data: artist, error: artistError } = await withTimeout(
                    lookup.maybeSingle(),
                    ARTIST_LOOKUP_TIMEOUT_MS,
                    'ARTIST_LOOKUP_TIMEOUT',
                    `Artist lookup timed out after ${ARTIST_LOOKUP_TIMEOUT_MS}ms`
                ));
            } else {
                ({ data: artist, error: artistError } = await withTimeout(
                    lookup.single(),
                    ARTIST_LOOKUP_TIMEOUT_MS,
                    'ARTIST_LOOKUP_TIMEOUT',
                    `Artist lookup timed out after ${ARTIST_LOOKUP_TIMEOUT_MS}ms`
                ));
            }
        } catch (error) {
            artistError = error;
        }

        if (artistError && artistError.code !== 'PGRST116') {
            artist = null;
            artistError = null;
            await delay(200);
            try {
                const retryLookup = ownArtistLookup(supabase, artistSelect, currentUser.id);

                if (typeof retryLookup.maybeSingle === 'function') {
                    ({ data: artist, error: artistError } = await withTimeout(
                        retryLookup.maybeSingle(),
                        ARTIST_LOOKUP_TIMEOUT_MS,
                        'ARTIST_LOOKUP_TIMEOUT',
                        `Artist lookup timed out after ${ARTIST_LOOKUP_TIMEOUT_MS}ms`
                    ));
                } else {
                    ({ data: artist, error: artistError } = await withTimeout(
                        retryLookup.single(),
                        ARTIST_LOOKUP_TIMEOUT_MS,
                        'ARTIST_LOOKUP_TIMEOUT',
                        `Artist lookup timed out after ${ARTIST_LOOKUP_TIMEOUT_MS}ms`
                    ));
                }
            } catch (retryErr) {
                artistError = retryErr;
            }

            if (artistError && artistError.code !== 'PGRST116') {
                const restArtist = await fetchArtistViaRest(configManager, session, artistSelect);
                if (restArtist) {
                    artist = restArtist;
                    artistError = null;
                } else {
                    return buildBaseState({
                        status: 'artist_lookup_failed',
                        urls,
                        configManager,
                        supabase,
                        session,
                        currentUser,
                        artistError
                    });
                }
            }
        }

        const hasArtistProfile = Boolean(artist);
        const artistProgress = getArtistProgress(artist, targetRoot);
        const hasCompleteProfile = Boolean(artistProgress?.isComplete);

        if (!hasArtistProfile) {
            return buildBaseState({
                status: 'authenticated_non_artist',
                urls,
                configManager,
                supabase,
                session,
                currentUser
            });
        }

        if (options.requireCompleteProfile && !hasCompleteProfile) {
            return buildBaseState({
                status: 'profile_incomplete',
                urls,
                configManager,
                supabase,
                session,
                currentUser,
                artist,
                artistProgress
            });
        }

        return buildBaseState({
            status: 'authenticated_artist',
            urls,
            configManager,
            supabase,
            session,
            currentUser,
            artist,
            artistProgress
        });
    }

    return {
        normalizeReturnTo,
        buildUrl,
        getReturnTo,
        getRouteUrls,
        waitForConfigManager,
        resolveArtistAuthState
    };
});
