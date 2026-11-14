'use strict';

// Beta cerrada · frente roster: correcciones de la revisión.
//   - borrar un uso del enlace (compensación del registro) devuelve el cupo,
//   - un error del canje en el registro cae a la solicitud (no rompe el alta),
//   - los avisos validan el id de la membresía antes de ir a la base,
//   - el panel Equipo no oculta rol / sede / reparto en tablet y móvil.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n');

const invite = require('../lib/studio-invite');
const roster = require('../lib/roster-service');
const routes = require('../lib/routes/roster');

const STUDIO = '11111111-1111-4111-8111-111111111111';
const ARTIST = '33333333-3333-4333-8333-333333333333';

function fakeApp() {
    const routesMap = {};
    const add = (method) => (route, ...handlers) => { routesMap[`${method} ${route}`] = handlers[handlers.length - 1]; };
    return { routes: routesMap, get: add('GET'), post: add('POST'), delete: add('DELETE') };
}

function fakeRes() {
    return {
        statusCode: 200, body: null, headers: {},
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
        set(k, v) { this.headers[k] = v; return this; }
    };
}

test('migración del enlace: borrar un uso devuelve el cupo (trigger) y el rollback lo quita', () => {
    const sql = read('supabase', 'migrations', '20261115230000_studio_invite_links.sql');
    assert.match(sql, /CREATE OR REPLACE FUNCTION private\.release_studio_invite_link_use\(\)/);
    assert.match(sql, /uses_count = greatest\(l\.uses_count - 1, 0\)/);
    assert.match(sql, /DROP TRIGGER IF EXISTS trg_release_studio_invite_link_use ON public\.studio_invite_link_uses;/);
    assert.match(sql, /AFTER DELETE ON public\.studio_invite_link_uses/);
    assert.match(sql, /REVOKE ALL ON FUNCTION private\.release_studio_invite_link_use\(\) FROM PUBLIC, anon, authenticated;/);
    const down = read('supabase', 'rollbacks', '20261115230000_studio_invite_links.down.sql');
    assert.match(down, /drop function if exists private\.release_studio_invite_link_use\(\);/);
    // La compensación del registro borra los usos del artista: el trigger es
    // lo que evita que un enlace con tope pierda un uso.
    const finalize = read('lib', 'registration-finalize.js');
    assert.match(finalize, /studio_invite_link_uses\?artist_user_id=eq\./);
});

test('registro: si el canje del enlace lanza un error, queda una solicitud y el registro sigue', async () => {
    const warnings = [];
    const repo = {
        redeemInviteLink: async () => { throw new Error('PostgREST POST rpc failed (404)'); },
        upsertRequestDetails: async () => {}
    };
    const svc = roster.createRosterService({ repo, log: { warn: (...args) => warnings.push(args.join(' ')) } });
    const upserts = [];
    const result = await svc.persistRegistrationMembership({
        upsertOpenStudioMembership: async (_rest, membership) => { upserts.push(membership); return { row: { id: 'm-req', status: 'requested' }, created: true }; },
        artistUserId: ARTIST,
        studioId: STUDIO,
        formData: {},
        invite: { ok: true, token: invite.generateInviteToken() }
    });
    assert.equal(result.status, 'requested');
    assert.equal(result.inviteFailed, true);
    assert.equal(upserts.length, 1);
    assert.equal(upserts[0].status, 'requested');
    assert.ok(warnings.some((w) => /canje/.test(w)));
});

test('avisos: membership_id inválido responde 400 sin ir a la base', async () => {
    const app = fakeApp();
    let lookups = 0;
    routes.register(app, {
        resolveBearerUser: async () => ({ id: ARTIST }),
        applicationBase: () => 'https://b.w',
        service: { notify: async () => ({ ok: true }), syncArtistStudio: async () => ({}) },
        repo: { getMembershipWithParties: async () => { lookups += 1; return null; }, isActiveSupportUser: async () => false }
    });
    for (const [route, kind] of [
        ['POST /api/studio/roster-notify', 'membership_request_decision'],
        ['POST /api/artist/studio-notify', 'membership_request_created']
    ]) {
        const res = fakeRes();
        await app.routes[route]({ body: { kind, membership_id: 'no-es-un-uuid' } }, res);
        assert.equal(res.statusCode, 400, route);
        assert.equal(res.body.success, false);
    }
    assert.equal(lookups, 0);
});

test('panel Equipo: en tablet y móvil rol, sede y reparto siguen visibles', () => {
    const css = read('public', 'shared', 'css', 'studio-team-ds.css');
    const tablet = css.slice(css.indexOf('@media (max-width:1100px)'));
    const block = tablet.slice(0, tablet.indexOf('\n}\n'));
    assert.doesNotMatch(block, /\.steam-row__cell\{display:none\}/);
    assert.match(block, /\.steam-row__cell\{grid-column:2 \/ -1;display:flex/);
    assert.match(block, /\.steam-row>\.steam-avatar\{grid-column:1;grid-row:1 \/ span 5/);
});
