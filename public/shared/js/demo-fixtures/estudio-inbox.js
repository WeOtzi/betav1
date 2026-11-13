/**
 * Fixtures de preview/demo · área "estudio-inbox" (ronda 3, 12 nov 2026).
 *
 * Lado estudio del Inbox y de las solicitudes de cambio de invitaciones.
 * Le da cuenta al estudio "Costa Ink Collective": en el preview se entra por
 * /studio/login con el correo ficticio `estudio@preview.weotzi.invalid` y
 * cualquier contraseña de 8+ caracteres (sesión simulada, sin backend).
 *
 * Agrega hilos de artistas ficticios (consulta 2007:5795, postulación a spot,
 * invitación con cambios pedidos 801:1101, vínculo de viaje y uno archivado)
 * y las RPC del contrato real (20261112210000_estudio_inbox.sql):
 * list_studio_inbox_threads, open_studio_inbox_thread,
 * list_studio_invitation_change_requests y respond_studio_invitation_change_request.
 * Los hilos usan otros artistas, así que el inbox del artista de preview no cambia.
 */
(function (root) {
    'use strict';
    root.WoDemoFixtureExtensions = root.WoDemoFixtureExtensions || {};

    var STUDIO_EMAIL = 'estudio@preview.weotzi.invalid';

    // Misma identidad determinística que preview-bootstrap.js (identityId).
    function identityId(email) {
        var hash = 2166136261;
        for (var i = 0; i < email.length; i++) hash = Math.imul(hash ^ email.charCodeAt(i), 16777619);
        var part = (hash >>> 0).toString(16);
        while (part.length < 8) part = '0' + part;
        return part + '-aaaa-4aaa-8aaa-' + part + 'aaaa';
    }

    root.WoDemoFixtureExtensions['estudio-inbox'] = function (ctx) {
        var tables = ctx.tables || {};
        var rpcs = ctx.rpcs || {};
        var DAY = (ctx.helpers && ctx.helpers.DAY) || 86400000;
        var now = Date.now();
        function minutesAgo(n) { return new Date(now - n * 60000).toISOString(); }
        function dateOnly(offset) { return new Date(now + offset * DAY).toISOString().slice(0, 10); }
        function id(prefix, n) {
            var tail = String(n);
            while (tail.length < 10) tail = '0' + tail;
            return '0000c0de-0000-4000-8000-' + prefix + tail;
        }
        function nowIso() { return new Date().toISOString(); }

        var studios = tables.studios || [];
        var studio = studios.find(function (s) { return s.slug === 'costa-ink-collective'; });
        if (!studio) return;
        var ownerId = identityId(STUDIO_EMAIL);
        studio.user_id = ownerId;
        studio.email = STUDIO_EMAIL;

        var ARTISTS = {
            martina: { user_id: id('f1', 1), name: 'Martina Ríos', username: 'martina.rios.ink', city: 'Córdoba', country: 'Argentina' },
            tomas: { user_id: id('f1', 2), name: 'Tomás Herrera', username: 'tomas.herrera', city: 'Santiago', country: 'Chile' },
            lucia: { user_id: id('f1', 3), name: 'Lucía Paz', username: 'lucia.paz.tattoo', city: 'Montevideo', country: 'Uruguay' },
            diego: { user_id: id('f1', 4), name: 'Diego Sosa', username: 'diegososa', city: 'Lima', country: 'Perú' },
            nico: { user_id: id('f1', 5), name: 'Nico Vera', username: 'nico.vera', city: 'Rosario', country: 'Argentina' }
        };
        var membershipId = id('f2', 1);
        var requestId = id('f3', 1);

        var base = { studio_id: studio.id, studio_name: studio.name, studio_slug: studio.slug, city: studio.city };
        function ctxOf(extra) { return Object.assign({}, base, extra); }

        // artista, categoría, context_type, context_id, asunto, contexto, [mensajes], favorito, archivado, leídoHaceMin
        var THREADS = [
            ['martina', 'studios', 'studio_contact', studio.id, 'Guest spot · ' + studio.name,
                ctxOf({ reason: 'guest_spot', reason_label: 'Guest spot', start_date: dateOnly(45), end_date: dateOnly(59), include_portfolio: true, portfolio_url: '/artist/profile?artist=martina.rios.ink' }),
                [['artist', 'Hola. Me encantaría hacer un guest spot en ' + studio.name + ' en enero. Trabajo fine line y botánico, y tengo agenda propia en la zona.\n\nFechas tentativas: ' + dateOnly(45).split('-').reverse().join('/') + ' – ' + dateOnly(59).split('-').reverse().join('/') + '\nPortfolio: /artist/profile?artist=martina.rios.ink', 42]],
                false, false, null],
            ['lucia', 'invitations', 'studio_invitation', membershipId, 'Invitación al estudio',
                ctxOf({ membership_id: membershipId, role: 'guest', membership_status: 'pending_acceptance', initiated_by: 'studio', proposed_start_date: dateOnly(20), proposed_end_date: dateOnly(34), change_request_id: requestId, change_request_status: 'pending' }),
                [['system', 'El estudio te invitó a sumarte a su roster.', 60 * 30],
                 ['artist', 'Solicitud de cambios: ¿Podemos arrancar una semana después? Tengo una convención esa semana. El resto me encanta.', 95]],
                true, false, null],
            ['tomas', 'spots', 'studio_spot_application', id('f4', 1), 'Guest spot · Valparaíso',
                ctxOf({ application_id: id('f4', 1), start_date: dateOnly(12), end_date: dateOnly(26), application_status: 'pending' }),
                [['system', 'Postulación enviada al estudio.', 60 * 26],
                 ['artist', 'Les dejo mi disponibilidad completa para esas dos semanas. Llevo mis propios insumos.', 60 * 25]],
                false, false, null],
            ['diego', 'trips', 'trip_studio_link', id('f5', 1), 'Viaje a Valparaíso',
                ctxOf({ trip_id: id('f6', 1), city: 'Valparaíso', country: 'Chile', start_date: dateOnly(60), end_date: dateOnly(67), link_status: 'confirmada' }),
                [['system', 'Solicitud de vinculación enviada. El estudio debe confirmarla o rechazarla.', 60 * 24 * 3],
                 ['artist', '¿Me confirman la dirección para mandar los insumos antes de llegar?', 60 * 24 * 2],
                 ['studio', 'Sí, Cerro Alegre, Valparaíso. Te esperamos el lunes a las 11.', 60 * 24 * 2 - 40]],
                false, false, 60 * 24 * 2 - 40],
            ['nico', 'studios', 'studio_contact', studio.id, 'Otra consulta · ' + studio.name,
                ctxOf({ reason: 'other', reason_label: 'Otra consulta', include_portfolio: false }),
                [['artist', 'Hola, ¿alquilan la estación por día para retoques? Gracias.', 60 * 24 * 9],
                 ['studio', 'Por ahora no, pero te avisamos si se abre un cupo.', 60 * 24 * 8]],
                false, true, 60 * 24 * 8]
        ];

        var threads = tables.inbox_threads || (tables.inbox_threads = []);
        var messages = tables.inbox_messages || (tables.inbox_messages = []);
        THREADS.forEach(function (t, i) {
            var artist = ARTISTS[t[0]];
            var threadId = id('f7', i + 1);
            var msgs = t[6];
            var last = msgs[msgs.length - 1];
            var readMin = t[9];
            var unread = msgs.filter(function (m) { return m[0] !== 'studio' && (readMin == null || m[2] < readMin); }).length;
            threads.push({
                id: threadId, artist_user_id: artist.user_id, category: t[1], context_type: t[2], context_id: t[3],
                counterparty_user_id: ownerId, counterparty_name: studio.name, counterparty_initials: 'CI', subject: t[4], context: t[5],
                status: 'open', is_priority: false, last_message: last[1].slice(0, 240), last_message_at: minutesAgo(last[2]),
                last_sender_user_id: last[0] === 'artist' ? artist.user_id : last[0] === 'studio' ? ownerId : null,
                is_favorite: t[7], is_archived: t[8], unread_count: unread,
                created_at: minutesAgo(msgs[0][2] + 5), updated_at: minutesAgo(last[2]),
                _studio_owner: ownerId, _studio_id: studio.id, _studio_participant: readMin != null,
                _artist: artist
            });
            msgs.forEach(function (m, j) {
                messages.push({
                    id: id('f8', (i + 1) * 10 + j), thread_id: threadId,
                    sender_user_id: m[0] === 'artist' ? artist.user_id : m[0] === 'studio' ? ownerId : null,
                    sender_role: m[0], body: m[1], message_kind: m[0] === 'system' ? 'system' : 'text',
                    attachment_path: null, attachment_name: null, attachment_mime: null, attachment_size: null,
                    client_nonce: null, created_at: minutesAgo(m[2])
                });
            });
        });

        var requests = tables.studio_invitation_change_requests || (tables.studio_invitation_change_requests = []);
        requests.push({
            id: requestId, membership_id: membershipId, artist_user_id: ARTISTS.lucia.user_id,
            message: '¿Podemos arrancar una semana después? Tengo una convención esa semana. El resto me encanta.',
            status: 'pending', created_at: minutesAgo(95), resolved_at: null,
            _demo_studio_id: studio.id, _demo_thread_id: id('f7', 2), _demo_artist: ARTISTS.lucia,
            _demo_membership: { id: membershipId, role: 'guest', status: 'pending_acceptance', location_id: studio.primary_location_id || null, revenue_split_pct: 60, invited_at: minutesAgo(60 * 30), has_contract: false },
            _demo_details: { proposed_start_date: dateOnly(20), proposed_end_date: dateOnly(34), duration_label: '2 semanas', message: 'Te esperamos para dos semanas de guest con agenda compartida.', response_due_at: null }
        });
        requests.push({
            id: id('f3', 2), membership_id: id('f2', 2), artist_user_id: ARTISTS.nico.user_id,
            message: '¿Se puede subir el split al 65%?', status: 'declined', created_at: minutesAgo(60 * 24 * 20), resolved_at: minutesAgo(60 * 24 * 19),
            _demo_studio_id: studio.id, _demo_thread_id: null, _demo_artist: ARTISTS.nico,
            _demo_membership: { id: id('f2', 2), role: 'guest', status: 'rejected', location_id: null, revenue_split_pct: 60, invited_at: minutesAgo(60 * 24 * 22), has_contract: false },
            _demo_details: null
        });

        /* ------------------------------ RPC mocks ------------------------------ */
        function ownedStudio(store, studioId, userId) {
            var row = store.rows('studios').find(function (s) { return s.id === studioId; });
            if (!row || !userId || row.user_id !== userId) throw new Error('No tenés acceso al inbox de este estudio.');
            return row;
        }
        function studioThread(store, threadId) {
            return store.rows('inbox_threads').find(function (t) { return t.id === threadId && t._studio_id; }) || null;
        }
        function lastRole(store, threadId) {
            var rows = store.rows('inbox_messages').filter(function (m) { return m.thread_id === threadId; })
                .sort(function (a, b) { return a.created_at < b.created_at ? -1 : 1; });
            return rows.length ? rows[rows.length - 1].sender_role : null;
        }
        function pendingFor(store, thread) {
            if (thread.context_type !== 'studio_invitation') return null;
            var r = store.rows('studio_invitation_change_requests').find(function (x) { return x.membership_id === thread.context_id && x.status === 'pending'; });
            return r ? { id: r.id, message: r.message, created_at: r.created_at } : null;
        }

        rpcs.list_studio_inbox_threads = function (args, store, c) {
            ownedStudio(store, args.p_studio_id, c.userId);
            return store.rows('inbox_threads').filter(function (t) { return t._studio_id === args.p_studio_id; })
                .sort(function (a, b) { return a.last_message_at < b.last_message_at ? 1 : -1; })
                .map(function (t) {
                    var a = t._artist || {};
                    return {
                        id: t.id, category: t.category, context_type: t.context_type, context_id: t.context_id,
                        artist_user_id: t.artist_user_id, artist_name: a.name || 'Artista', artist_username: a.username || null, artist_avatar: null,
                        subject: t.subject, context: t.context, status: t.status, is_priority: !!t.is_priority,
                        last_message: t.last_message, last_message_at: t.last_message_at, last_sender_role: lastRole(store, t.id),
                        is_participant: !!t._studio_participant, is_favorite: !!t.is_favorite, is_archived: !!t.is_archived,
                        unread_count: t.unread_count || 0, pending_change_request: pendingFor(store, t), created_at: t.created_at
                    };
                });
        };

        rpcs.open_studio_inbox_thread = function (args, store, c) {
            ownedStudio(store, args.p_studio_id, c.userId);
            var thread = studioThread(store, args.p_thread_id);
            if (!thread || thread._studio_id !== args.p_studio_id) throw new Error('thread not found');
            thread._studio_participant = true;
            thread.unread_count = 0;
            return { thread_id: thread.id, participant_role: 'studio', read_at: nowIso() };
        };

        // El mock base de send_inbox_message firma siempre como artista.
        var baseSend = rpcs.send_inbox_message;
        rpcs.send_inbox_message = function (args, store, c) {
            var row = baseSend ? baseSend(args, store, c) : null;
            var thread = studioThread(store, args.p_thread_id);
            if (row && thread && thread._studio_owner === c.userId) {
                row.sender_role = 'studio';
                row.message_kind = args.p_attachment_path ? (/^image\//.test(args.p_attachment_mime || '') ? 'image' : 'file') : 'text';
            }
            return row;
        };

        rpcs.list_studio_invitation_change_requests = function (args, store, c) {
            ownedStudio(store, args.p_studio_id, c.userId);
            return store.rows('studio_invitation_change_requests')
                .filter(function (r) { return r._demo_studio_id === args.p_studio_id; })
                .sort(function (a, b) {
                    if ((a.status === 'pending') !== (b.status === 'pending')) return a.status === 'pending' ? -1 : 1;
                    return a.created_at < b.created_at ? 1 : -1;
                })
                .map(function (r) {
                    return {
                        id: r.id, membership_id: r.membership_id, message: r.message, status: r.status,
                        created_at: r.created_at, resolved_at: r.resolved_at,
                        membership: r._demo_membership, details: r._demo_details, artist: r._demo_artist,
                        thread_id: r._demo_thread_id
                    };
                });
        };

        rpcs.respond_studio_invitation_change_request = function (args, store, c) {
            var r = store.rows('studio_invitation_change_requests').find(function (x) { return x.id === args.p_request_id; });
            if (!r || !r._demo_studio_id) throw new Error('Solicitud no encontrada.');
            ownedStudio(store, r._demo_studio_id, c.userId);
            if (r.status !== 'pending') throw new Error('Esta solicitud ya fue respondida.');
            var decision = args.p_decision;
            var reply = String(args.p_reply || '').trim();
            if (decision !== 'accepted' && decision !== 'declined') throw new Error('Elegí si actualizás la invitación o mantenés las condiciones.');
            if (decision === 'declined' && reply.length < 10) throw new Error('Contale al artista por qué mantenés las condiciones (mínimo 10 caracteres).');
            var changes = args.p_changes || {};
            var summary = [];
            if (decision === 'accepted') {
                var m = r._demo_membership; var d = r._demo_details || (r._demo_details = {});
                Object.keys(changes).forEach(function (key) {
                    if (['role', 'location_id', 'revenue_split_pct'].indexOf(key) !== -1) m[key] = changes[key];
                    else d[key] = changes[key];
                    summary.push(key);
                });
                if (!summary.length) throw new Error('No hay cambios: si mantenés las condiciones, respondé sin actualizar.');
            }
            r.status = decision; r.resolved_at = nowIso();
            var thread = r._demo_thread_id ? studioThread(store, r._demo_thread_id) : null;
            if (thread) {
                store.insert('inbox_messages', [{
                    thread_id: thread.id, sender_user_id: null, sender_role: 'system', message_kind: 'system',
                    body: decision === 'accepted' ? studio.name + ' actualizó la invitación.' : studio.name + ' mantuvo las condiciones de la invitación.',
                    attachment_path: null, attachment_name: null, attachment_mime: null, attachment_size: null, client_nonce: null
                }]);
                if (reply) {
                    store.insert('inbox_messages', [{
                        thread_id: thread.id, sender_user_id: c.userId, sender_role: 'studio', message_kind: 'text', body: reply,
                        attachment_path: null, attachment_name: null, attachment_mime: null, attachment_size: null, client_nonce: null
                    }]);
                }
                thread.last_message = reply || (decision === 'accepted' ? studio.name + ' actualizó la invitación.' : studio.name + ' mantuvo las condiciones de la invitación.');
                thread.last_message_at = nowIso();
                thread.context = Object.assign({}, thread.context, { change_request_status: decision });
                thread._studio_participant = true;
            }
            return { request_id: r.id, membership_id: r.membership_id, status: decision, changes: summary, thread_id: thread ? thread.id : null, resolved_at: r.resolved_at };
        };
    };
})(typeof self !== 'undefined' ? self : this);
