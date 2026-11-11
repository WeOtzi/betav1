const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const migration = read('supabase', 'migrations', '20260829103500_artist_public_profile_preferences.sql');
const html = read('public', 'artist', 'profile', 'index.html');
const js = read('public', 'shared', 'js', 'artist-profile.js');
const css = read('public', 'shared', 'css', 'artist-profile.css');

test('public preference RPC exposes only profile-safe fields while the source row stays private', () => {
    assert.match(migration, /security definer/i);
  assert.match(migration, /set search_path = ''/i);
    assert.match(migration, /show_city/);
    assert.match(migration, /show_rating/);
    assert.match(migration, /show_socials/);
    assert.match(migration, /allow_search_indexing/);
    assert.match(migration, /banner_url/);
    assert.match(migration, /tiktok/);
    assert.match(migration, /'availability'/);
    assert.match(migration, /grant execute[^;]+to anon, authenticated/i);
    assert.doesNotMatch(migration, /notification_prefs/);
});

test('artist profile consumes privacy, public profile extras and weekly availability', () => {
    // La RPC vive en el repo del área (capa PostgREST) y la página la consume por nombre.
    const repo = read('public', 'shared', 'js', 'data', 'profile-public-repo.js');
    assert.match(repo, /rpc\('get_artist_public_profile_preferences'/);
    assert.match(js, /ProfilePublic\.getPreferences\(artistUserId\)/);
    assert.match(html, /\/shared\/js\/data\/profile-public-repo\.js/);
    assert.match(js, /privacy\.show_city === false/);
    assert.match(js, /allow_search_indexing === true/);
    assert.match(js, /publicProfilePreferences\.availability\?\.weekly/);
    assert.match(js, /profileExtras\.banner_url/);
    assert.match(html, /id="profile-robots"/);
});

test('Figma final 801:1108 retira la fila de redes del hero sin perder el banner responsive', () => {
    assert.doesNotMatch(html, /id="hero-socials"/);
    assert.doesNotMatch(js, /renderPublicSocials/);
    assert.doesNotMatch(css, /\.hero-socials\s*\{/);
    assert.match(css, /\.hero-band\.has-profile-banner::before/);
    assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.hero-grid/);
});
