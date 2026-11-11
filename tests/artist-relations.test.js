'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { ARTIST_RELATIONS, countArtistRelations, clearBlockingRelations } = require('../lib/artist-relations');

function fakePgrest(counts, calls) {
    return (table) => {
        const q = { table, filters: [] };
        const b = {
            select: () => b, limit: () => b, count: () => b,
            eq: (c, v) => { q.filters.push([c, v]); return b; },
            execute: async () => ({ rows: [], count: counts[table] || 0 }),
            patch: async (p) => { calls.push(['patch', table, p, q.filters]); return []; },
            delete: async () => { calls.push(['delete', table, q.filters]); return []; }
        };
        return b;
    };
}

test('cuenta solo relaciones con filas y marca las bloqueantes', async () => {
    const rels = await countArtistRelations(
        fakePgrest({ job_board_requests: 2, quotations_db: 5 }, []),
        { id: 'a', user_id: 'u' }
    );
    assert.deepStrictEqual(rels.map((r) => [r.table, r.count, r.blocking]), [
        ['quotations_db', 5, false],
        ['job_board_requests', 2, true]
    ]);
});

test('libera bloqueos: desvincula nullable y borra NOT NULL', async () => {
    const calls = [];
    await clearBlockingRelations(fakePgrest({}, calls), { id: 'a', user_id: 'u' });
    assert.deepStrictEqual(calls.map((c) => [c[0], c[1]]), [
        ['patch', 'job_board_requests'],
        ['delete', 'studio_bookings'],
        ['delete', 'studio_jobs_log']
    ]);
    assert.deepStrictEqual(calls[0][2], { accepted_artist_id: null });
});

test('artista sin user_id solo consulta relaciones por id', async () => {
    const rels = await countArtistRelations(fakePgrest({ verification_history: 1, quotations_db: 9 }, []), { id: 'a', user_id: null });
    assert.deepStrictEqual(rels.map((r) => r.table), ['verification_history']);
    assert.ok(ARTIST_RELATIONS.length >= 16);
});
