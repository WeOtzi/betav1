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

    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
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
                        await targetRoot.ConfigManager.ready();
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

    function buildBaseState({
        status,
        urls,
        configManager = null,
        supabase = null,
        session = null,
        currentUser = null,
        artist = null,
        artistError = null
    }) {
        const hasArtistProfile = Boolean(artist);
        const hasCompleteProfile = Boolean(artist && String(artist.name || '').trim());

        return {
            status,
            urls,
            configManager,
            supabase,
            session,
            currentUser,
            artist,
            artistError,
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

        const { data: authData, error: authError } = await supabase.auth.getSession();
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
        const artistSelect = options.artistSelect || 'user_id, username, name';

        let artist = null;
        let artistError = null;

        try {
            const lookup = supabase
                .from('artists_db')
                .select(artistSelect)
                .eq('user_id', currentUser.id);

            if (typeof lookup.maybeSingle === 'function') {
                ({ data: artist, error: artistError } = await lookup.maybeSingle());
            } else {
                ({ data: artist, error: artistError } = await lookup.single());
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
                    ({ data: artist, error: artistError } = await retryLookup.maybeSingle());
                } else {
                    ({ data: artist, error: artistError } = await retryLookup.single());
                }
            } catch (retryErr) {
                artistError = retryErr;
            }

            if (artistError && artistError.code !== 'PGRST116') {
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

        const hasArtistProfile = Boolean(artist);
        const hasCompleteProfile = Boolean(artist && String(artist.name || '').trim());

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
                artist
            });
        }

        return buildBaseState({
            status: 'authenticated_artist',
            urls,
            configManager,
            supabase,
            session,
            currentUser,
            artist
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
