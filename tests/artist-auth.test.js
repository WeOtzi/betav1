const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const modulePath = path.resolve(__dirname, '..', 'public', 'shared', 'js', 'artist-auth.js');

function loadArtistAuthModule() {
    delete require.cache[modulePath];
    return require(modulePath);
}

function createSupabaseStub({ session = null, artist = null, artistError = null } = {}) {
    return {
        auth: {
            async getSession() {
                return {
                    data: { session },
                    error: null
                };
            }
        },
        from(tableName) {
            assert.equal(tableName, 'artists_db');
            return {
                select() {
                    return {
                        eq(columnName, value) {
                            assert.equal(columnName, 'user_id');
                            assert.ok(value);
                            return {
                                async maybeSingle() {
                                    return {
                                        data: artist,
                                        error: artistError
                                    };
                                }
                            };
                        }
                    };
                }
            };
        }
    };
}

function createConfigManagerStub(supabaseStub) {
    return {
        isDemoMode() {
            return false;
        },
        getSupabaseClient() {
            return supabaseStub;
        },
        getRoutes() {
            return {
                registerClosedBeta: '/registerclosedbeta',
                registerArtist: '/register-artist',
                dashboard: '/artist/dashboard',
                jobBoard: '/job-board'
            };
        }
    };
}

test('normalizeReturnTo keeps internal routes and rejects unsafe targets', () => {
    const artistAuth = loadArtistAuthModule();

    assert.equal(artistAuth.normalizeReturnTo('/job-board'), '/job-board');
    assert.equal(artistAuth.normalizeReturnTo('/job-board?from=dashboard'), '/job-board?from=dashboard');
    assert.equal(artistAuth.normalizeReturnTo('//evil.example', '/artist/dashboard'), '/artist/dashboard');
    assert.equal(artistAuth.normalizeReturnTo('https://evil.example', '/artist/dashboard'), '/artist/dashboard');
    assert.equal(artistAuth.normalizeReturnTo('job-board', '/artist/dashboard'), '/artist/dashboard');
});

test('buildUrl appends encoded query params and skips empty values', () => {
    const artistAuth = loadArtistAuthModule();

    assert.equal(
        artistAuth.buildUrl('/registerclosedbeta', {
            returnTo: '/job-board',
            from: 'artist dashboard'
        }),
        '/registerclosedbeta?returnTo=%2Fjob-board&from=artist+dashboard'
    );

    assert.equal(
        artistAuth.buildUrl('/registerclosedbeta', { returnTo: '' }),
        '/registerclosedbeta'
    );
});

test('getRouteUrls applies returnTo only to login and registration routes', () => {
    const artistAuth = loadArtistAuthModule();
    const urls = artistAuth.getRouteUrls(createConfigManagerStub(createSupabaseStub()), '/job-board');

    assert.deepEqual(urls, {
        registerClosedBeta: '/registerclosedbeta',
        login: '/registerclosedbeta?returnTo=%2Fjob-board',
        registerArtist: '/register-artist?returnTo=%2Fjob-board',
        dashboard: '/artist/dashboard',
        jobBoard: '/job-board'
    });
});

test('resolveArtistAuthState returns anonymous state when no session exists', async () => {
    const artistAuth = loadArtistAuthModule();
    const result = await artistAuth.resolveArtistAuthState({
        configManager: createConfigManagerStub(createSupabaseStub()),
        returnTo: '/job-board'
    });

    assert.equal(result.status, 'anonymous');
    assert.equal(result.isArtist, false);
    assert.equal(result.currentUser, null);
    assert.equal(result.urls.login, '/registerclosedbeta?returnTo=%2Fjob-board');
});

test('resolveArtistAuthState returns authenticated artist details when row exists', async () => {
    const artistAuth = loadArtistAuthModule();
    const session = { user: { id: 'artist-user-1', email: 'artist@example.com' } };
    const artist = { user_id: 'artist-user-1', username: 'artist.wo', name: 'Artist Name' };

    const result = await artistAuth.resolveArtistAuthState({
        configManager: createConfigManagerStub(createSupabaseStub({ session, artist })),
        returnTo: '/job-board'
    });

    assert.equal(result.status, 'authenticated_artist');
    assert.equal(result.isArtist, true);
    assert.deepEqual(result.artist, artist);
    assert.equal(result.hasCompleteProfile, true);
});

test('resolveArtistAuthState flags incomplete artist profiles when name is missing', async () => {
    const artistAuth = loadArtistAuthModule();
    const session = { user: { id: 'artist-user-2', email: 'artist2@example.com' } };
    const artist = { user_id: 'artist-user-2', username: 'artist2.wo', name: '' };

    const result = await artistAuth.resolveArtistAuthState({
        configManager: createConfigManagerStub(createSupabaseStub({ session, artist })),
        returnTo: '/job-board',
        requireCompleteProfile: true
    });

    assert.equal(result.status, 'profile_incomplete');
    assert.equal(result.isArtist, true);
    assert.equal(result.hasCompleteProfile, false);
    assert.equal(result.urls.registerArtist, '/register-artist?returnTo=%2Fjob-board');
});

test('resolveArtistAuthState retries on transient error and resolves to authenticated_artist', async () => {
    const artistAuth = loadArtistAuthModule();
    const session = { user: { id: 'retry-user-1', email: 'retry@example.com' } };
    const artist = { user_id: 'retry-user-1', username: 'retry.wo', name: 'Retry Artist' };

    let callCount = 0;
    const supabaseStub = {
        auth: {
            async getSession() {
                return { data: { session }, error: null };
            }
        },
        from() {
            return {
                select() {
                    return {
                        eq() {
                            return {
                                async maybeSingle() {
                                    callCount++;
                                    if (callCount === 1) {
                                        return { data: null, error: { code: 'TIMEOUT', message: 'Request timed out' } };
                                    }
                                    return { data: artist, error: null };
                                }
                            };
                        }
                    };
                }
            };
        }
    };

    const result = await artistAuth.resolveArtistAuthState({
        configManager: createConfigManagerStub(supabaseStub),
        returnTo: '/job-board'
    });

    assert.equal(callCount, 2, 'Should retry once after transient failure');
    assert.equal(result.status, 'authenticated_artist');
    assert.equal(result.isArtist, true);
});

test('resolveArtistAuthState returns artist_lookup_failed when both attempts fail', async () => {
    const artistAuth = loadArtistAuthModule();
    const session = { user: { id: 'fail-user-1', email: 'fail@example.com' } };
    const persistentError = { code: 'RLS_DENIED', message: 'Row-level security violation' };

    const supabaseStub = {
        auth: {
            async getSession() {
                return { data: { session }, error: null };
            }
        },
        from() {
            return {
                select() {
                    return {
                        eq() {
                            return {
                                async maybeSingle() {
                                    return { data: null, error: persistentError };
                                }
                            };
                        }
                    };
                }
            };
        }
    };

    const result = await artistAuth.resolveArtistAuthState({
        configManager: createConfigManagerStub(supabaseStub),
        returnTo: '/job-board'
    });

    assert.equal(result.status, 'artist_lookup_failed');
    assert.equal(result.isArtist, false);
});
