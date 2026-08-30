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
    assert.match(js, /rpc\('get_artist_public_profile_preferences'/);
    assert.match(js, /privacy\.show_city === false/);
    assert.match(js, /privacy\.show_socials === false/);
    assert.match(js, /allow_search_indexing === true/);
    assert.match(js, /publicProfilePreferences\.availability\?\.weekly/);
    assert.match(js, /profileExtras\.banner_url/);
    assert.match(js, /profileExtras\?\.tiktok/);
    assert.match(html, /id="profile-robots"/);
    assert.match(html, /id="hero-socials"/);
});

test('banner and social links preserve the existing responsive hero structure', () => {
    assert.match(css, /\.hero-band\.has-profile-banner::before/);
    assert.match(css, /\.hero-socials\s*\{/);
    assert.match(css, /\.hero-socials\[hidden\]/);
    assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.hero-grid/);
});
