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
            const response = await withTimeout(
                fetch(`${url}/rest/v1/artists_db?${searchParams.toString()}`, {
                    headers: {
                        apikey: anonKey,
                        Authorization: `Bearer ${session.access_token || anonKey}`
                    }
                }),
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

        let artist = null;
        let artistError = null;

        try {
            const lookup = supabase
                .from('artists_db')
                .select(artistSelect)
                .eq('user_id', currentUser.id);

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
                const retryLookup = supabase
                    .from('artists_db')
                    .select(artistSelect)
                    .eq('user_id', currentUser.id);

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
