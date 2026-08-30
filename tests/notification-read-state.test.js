const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const menu = fs.readFileSync(path.join(root, 'public/shared/js/wo-artist-menu.js'), 'utf8');
const migration = fs.readFileSync(
    path.join(root, 'supabase/migrations/20260829102000_notification_read_state.sql'),
    'utf8'
);

test('artist notification menu merges durable read receipts and keeps an offline fallback', () => {
    assert.match(menu, /from\('user_notification_reads'\)/);
    assert.match(menu, /upsert\(rows, \{ onConflict: 'user_id,notification_key' \}\)/);
    assert.match(menu, /localStorage\.setItem\(SEEN_KEY/);
    assert.match(menu, /window\.setInterval\(refresh, 60000\)/);
});

test('notification read receipts are owner-scoped and unavailable to anonymous users', () => {
    assert.match(migration, /primary key \(user_id, notification_key\)/i);
    assert.match(migration, /enable row level security/i);
    assert.match(migration, /auth\.uid\(\)\) = user_id/i);
    assert.match(migration, /revoke all on table public\.user_notification_reads from anon/i);
    assert.match(migration, /grant select, insert, update, delete[\s\S]*to authenticated/i);
});
