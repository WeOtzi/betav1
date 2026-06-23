'use strict';

// Pruebas de la capa PostgREST unificada (lib/postgrest.js).
// Mockean global.fetch para capturar la request generada sin tocar la red.

const { test } = require('node:test');
const assert = require('node:assert');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-key';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'anon-key';

const { pgrest, encodeFilterValue } = require('../lib/postgrest');

function mockFetch({ status = 200, body = '[]', contentRange = null } = {}) {
    const calls = [];
    global.fetch = async (url, opts) => {
        calls.push({ url, opts });
        return {
            ok: status >= 200 && status < 300,
            status,
            headers: { get: (h) => (h.toLowerCase() === 'content-range' ? contentRange : null) },
            text: async () => body,
        };
    };
    return calls;
}

test('select + eq genera querystring con select y filtro escapado', async () => {
    const calls = mockFetch({ body: '[{"id":1}]' });
    await pgrest('quotations_db').select('id,quote_id').eq('quote_id', 'QN-1').limit(1).execute();
    const { url, opts } = calls[0];
    assert.match(url, /\/rest\/v1\/quotations_db\?/);
    assert.match(url, /select=id%2Cquote_id/);
    assert.match(url, /quote_id=eq\.QN-1/);
    assert.match(url, /limit=1/);
    assert.strictEqual(opts.method, 'GET');
    assert.strictEqual(opts.headers.apikey, 'service-key');
});

test('eq escapa valores con caracteres especiales (no rompe el filtro)', async () => {
    const calls = mockFetch();
    await pgrest('quotations_db').select('id').ilike('client_email', 'a,b)@x.com').execute();
    assert.match(calls[0].url, /client_email=ilike\.a%2Cb%29%40x\.com/);
});

test('in() arma lista entre parentesis con valores entrecomillados', async () => {
    const calls = mockFetch();
    await pgrest('quotations_db').select('id').in('id', [1, 2, 3]).execute();
    // ("1","2","3") url-encoded
    assert.match(calls[0].url, /id=in\.%28%221%22%2C%222%22%2C%223%22%29/);
});

test('or() genera or=(cond,cond) con valores escapados', async () => {
    const calls = mockFetch();
    await pgrest('quotations_db')
        .select('id')
        .or([{ col: 'client_user_id', op: 'eq', val: 'u1' }, { col: 'artist_id', op: 'eq', val: 'u1' }])
        .execute();
    assert.match(calls[0].url, /or=\(client_user_id\.eq\.u1,artist_id\.eq\.u1\)/);
});

test('single() devuelve la primera fila o null', async () => {
    mockFetch({ body: '[{"id":7}]' });
    const row = await pgrest('quotations_db').select('*').eq('id', 7).single().execute();
    assert.deepStrictEqual(row, { id: 7 });

    mockFetch({ body: '[]' });
    const none = await pgrest('quotations_db').select('*').eq('id', 999).single().execute();
    assert.strictEqual(none, null);
});

test('count() devuelve { rows, count } leyendo Content-Range', async () => {
    mockFetch({ body: '[{"id":1}]', contentRange: '0-0/42' });
    const res = await pgrest('quotations_db').select('*').range(0, 0).count('exact').execute();
    assert.strictEqual(res.count, 42);
    assert.strictEqual(res.rows.length, 1);
});

test('patch envia PATCH con Prefer return=representation y body json', async () => {
    const calls = mockFetch({ body: '[{"id":1,"quote_status":"completed"}]' });
    const rows = await pgrest('quotations_db').eq('id', 1).patch({ quote_status: 'completed' });
    assert.strictEqual(calls[0].opts.method, 'PATCH');
    assert.match(calls[0].opts.headers.Prefer, /return=representation/);
    assert.deepStrictEqual(JSON.parse(calls[0].opts.body), { quote_status: 'completed' });
    assert.strictEqual(rows[0].quote_status, 'completed');
});

test('upsert usa resolution=merge-duplicates y on_conflict', async () => {
    const calls = mockFetch({ body: '[]' });
    await pgrest('quotations_db').upsert([{ quote_id: 'X' }], { onConflict: 'quote_id', returning: false });
    assert.match(calls[0].url, /on_conflict=quote_id/);
    assert.match(calls[0].opts.headers.Prefer, /resolution=merge-duplicates/);
    assert.match(calls[0].opts.headers.Prefer, /return=minimal/);
});

test('delete usa DELETE y return=minimal por defecto', async () => {
    const calls = mockFetch({ status: 204, body: '' });
    await pgrest('quotations_db').eq('id', 5).delete();
    assert.strictEqual(calls[0].opts.method, 'DELETE');
    assert.match(calls[0].opts.headers.Prefer, /return=minimal/);
});

test('respuesta no-ok lanza Error con .status y marca FK 23503', async () => {
    mockFetch({ status: 409, body: 'violates foreign key constraint ... (23503)' });
    await assert.rejects(
        () => pgrest('quotations_db').eq('id', 1).delete(),
        (err) => err.status === 409 && err.code === '23503'
    );
});

test('pgrest.raw ejecuta un path arbitrario y parsea 204 como null', async () => {
    const calls = mockFetch({ status: 204, body: '' });
    const out = await pgrest.raw('support_messages', { method: 'POST', body: { a: 1 }, prefer: 'return=minimal' });
    assert.strictEqual(out, null);
    assert.match(calls[0].url, /\/rest\/v1\/support_messages$/);
    assert.strictEqual(calls[0].opts.method, 'POST');
});

test('key:anon usa la anon key', async () => {
    const calls = mockFetch();
    await pgrest('quotations_db', { key: 'anon' }).select('*').execute();
    assert.strictEqual(calls[0].opts.headers.apikey, 'anon-key');
});

test('pgrest.raw acepta apiKey explicita (delegacion de supabaseQuery)', async () => {
    const calls = mockFetch({ body: '[{"x":1}]' });
    const out = await pgrest.raw('analytics_user_sessions?select=user_type', { apiKey: 'explicit-anon' });
    assert.strictEqual(calls[0].opts.headers.apikey, 'explicit-anon');
    assert.strictEqual(calls[0].opts.headers.Authorization, 'Bearer explicit-anon');
    assert.match(calls[0].url, /\/rest\/v1\/analytics_user_sessions\?select=user_type$/);
    assert.deepStrictEqual(out, [{ x: 1 }]);
});

test('encodeFilterValue: is no se encodea (null/true/false)', () => {
    assert.strictEqual(encodeFilterValue('is', null), 'null');
    assert.strictEqual(encodeFilterValue('eq', 'a b'), 'a%20b');
});
