/**
 * Fixtures de preview/demo · área "cotizaciones" (Figma final del flujo de artista, oct 2026).
 * Registra una extensión que wo-demo-fixtures.js aplica al final de build():
 *   ctx = { tables, relations, rpcs, views, clients, identity, TABLES, VIEWS, helpers }
 *
 * Agrega lo que necesitan /my-quotations (alcances "Archivadas" y "Borradores",
 * badge "Vencida", última nota privada del resumen lateral) y /my-quotations/new
 * (libreta de clientes, borradores y el RPC create_manual_quotation de la
 * migración 20261028120000_quotation_manual_quotes.sql).
 */
(function (root) {
    'use strict';
    root.WoDemoFixtureExtensions = root.WoDemoFixtureExtensions || {};
    root.WoDemoFixtureExtensions['cotizaciones'] = function (ctx) {
        var tables = ctx.tables;
        var DAY = (ctx.helpers && ctx.helpers.DAY) || 86400000;
        var artistId = (ctx.identity && ctx.identity.userId) || null;
        var now = Date.now();
        function daysAgo(n) { return new Date(now - n * DAY).toISOString(); }
        function dateOnly(n) { return new Date(now + n * DAY).toISOString().slice(0, 10); }

        ['artist_manual_quotes', 'artist_clients'].forEach(function (name) {
            if (ctx.TABLES.indexOf(name) === -1) ctx.TABLES.push(name);
        });

        /* -------- cotizaciones extra: vencida + archivada (alcance "Archivadas") -------- */
        var quotes = tables.quotations_db || (tables.quotations_db = []);
        var template = quotes[0] || {};
        var nextId = quotes.reduce(function (m, q) { return Math.max(m, Number(q.id) || 0); }, 990000) + 1;
        function extraQuote(seed) {
            return Object.assign({}, template, {
                id: nextId++, quote_status: seed.status, created_at: daysAgo(seed.age), updated_at: daysAgo(seed.upd),
                quote_id: seed.ref, tattoo_body_part: seed.part, tattoo_body_side: null,
                tattoo_idea_description: seed.idea, project_description: seed.project, tattoo_style: [seed.style],
                tattoo_size: seed.size, tattoo_estimated_sessions: seed.sessions, client_full_name: seed.client,
                client_city_residence: seed.city, client_budget_amount: seed.budget, client_budget_currency: 'USD',
                artist_budget_amount: seed.artistBudget, artist_budget_currency: seed.artistBudget != null ? 'USD' : null,
                final_budget_amount: seed.final, final_budget_currency: seed.final != null ? 'USD' : null,
                final_sessions: seed.sessions, priority: seed.priority, source: 'direct', is_archived: !!seed.archived,
                reference_images_count: 0, reference_images: [], notes: null, current_step: null,
                artist_responded_at: seed.status === 'pending' ? null : daysAgo(seed.upd),
                artist_completed_at: seed.status === 'completed' ? daysAgo(seed.upd) : null,
                client_completed_at: seed.status === 'completed' ? daysAgo(seed.upd) : null,
                rating: null
            });
        }
        var EXTRA = [
            extraQuote({ ref: 'DEMO-V01', status: 'expired', age: 34, upd: 20, client: 'Ezequiel Farías', city: 'Barcelona', part: 'Antebrazo', idea: 'Cobertura de tatuaje antiguo con blackwork.', project: 'Cover-up blackwork', style: 'Blackwork', size: 'Mediano (10 a 15 cm)', sessions: 2, budget: 260, artistBudget: 300, final: null, priority: 'medium' }),
            extraQuote({ ref: 'DEMO-A01', status: 'completed', age: 70, upd: 55, client: 'Renata Duarte', city: 'Ciudad de México', part: 'Pierna', idea: 'Flash old school de golondrina.', project: 'Golondrina old school', style: 'Old school', size: 'Chico (menos de 10 cm)', sessions: 1, budget: 70, artistBudget: 70, final: 70, priority: 'low', archived: true }),
            extraQuote({ ref: 'DEMO-A02', status: 'client_rejected', age: 80, upd: 74, client: 'Diego Palma', city: 'Lima', part: 'Hombro', idea: 'Cover-up geométrico en dotwork sobre el hombro.', project: 'Cover-up geométrico', style: 'Dotwork', size: 'Mediano (10 a 15 cm)', sessions: 2, budget: 150, artistBudget: 220, final: null, priority: 'medium', archived: true })
        ];
        // Idempotente: aplicar la extensión dos veces no duplica filas.
        EXTRA.forEach(function (row) {
            if (!quotes.some(function (q) { return q.quote_id === row.quote_id; })) quotes.push(row);
        });

        /* -------- última nota privada del resumen lateral -------- */
        var p01 = quotes.find(function (q) { return q.quote_id === 'DEMO-P01'; });
        if (p01 && Array.isArray(tables.quotation_notes) && !tables.quotation_notes.some(function (n) { return n.id === 999101; })) {
            tables.quotation_notes.push({
                id: 999101, quotation_id: p01.id, title: 'Referencias', label: 'seguimiento',
                content: { blocks: [{ type: 'paragraph', data: { text: 'Pidió referencias en negro puro, sin grises. Presupuesto ajustado.' } }] },
                note_date: daysAgo(0), created_at: daysAgo(0), updated_at: daysAgo(0)
            });
        }

        /* -------- libreta de clientes del artista -------- */
        tables.artist_clients = [
            { id: 'a1c1e000-0000-4000-8000-000000000001', artist_id: artistId, full_name: 'Marina Ibáñez', email: 'marina@ejemplo.weotzi.demo', whatsapp: '+54 9 11 5555-0101', instagram: 'marina.ibz', city: 'Buenos Aires', notes: null, created_at: daysAgo(40), updated_at: daysAgo(40) },
            { id: 'a1c1e000-0000-4000-8000-000000000002', artist_id: artistId, full_name: 'Tomás Reyes', email: 'tomas@ejemplo.weotzi.demo', whatsapp: '+54 9 351 555-0202', instagram: null, city: 'Córdoba', notes: null, created_at: daysAgo(22), updated_at: daysAgo(22) },
            { id: 'a1c1e000-0000-4000-8000-000000000003', artist_id: artistId, full_name: 'Julieta Sosa', email: 'julieta@ejemplo.weotzi.demo', whatsapp: '+34 600 555 303', instagram: 'juli.sosa', city: 'Madrid', notes: null, created_at: daysAgo(9), updated_at: daysAgo(9) }
        ];

        /* -------- borrador de cotización manual -------- */
        tables.artist_manual_quotes = [{
            id: 'a1d0e000-0000-4000-8000-000000000001', artist_id: artistId, quote_ref: 'COT-DEMO01', status: 'draft', origin: 'manual',
            artist_client_id: 'a1c1e000-0000-4000-8000-000000000002', quote_id: null,
            client: { name: 'Tomás Reyes', email: 'tomas@ejemplo.weotzi.demo', whatsapp: '+54 9 351 555-0202', instagram: null, city: 'Córdoba' },
            project: { title: 'Retrato realista de su madre', description: 'Retrato realista de su madre, blanco y negro.', style: { style_id: '3', style_slug: 'realismo', style_name: 'Realismo', substyle_name: null }, body_part: 'Brazo', size: 'Mediano · 8 a 15 cm', color: 'Blanco y negro', complexity: 'Alta', cover_up: false, sessions: 2, session_hours: 3, location: '', tentative_date: dateOnly(21), priority: 'high' },
            line_items: [
                { id: 'itdemo1', name: 'Diseño personalizado', description: 'Boceto a partir de la foto', qty: 1, price: 40000 },
                { id: 'itdemo2', name: 'Sesión de tatuaje', description: null, qty: 2, price: 100000 }
            ],
            currency: 'ARS', discount_pct: 0, tax_pct: 0, deposit_pct: 30, subtotal: 240000, total: 240000, deposit_amount: 72000,
            validity_days: 14, cancellation_policy: 'no-reembolsable-48', client_notes: null, extra_terms: null,
            created_at: daysAgo(2), updated_at: daysAgo(1), sent_at: null
        }];

        /* -------- RPC create_manual_quotation (espejo del SQL) -------- */
        ctx.rpcs.create_manual_quotation = function (args, store, rpcCtx) {
            var q = (args && args.p_quote) || {};
            var d = (args && args.p_details) || {};
            var uid = (rpcCtx && rpcCtx.userId) || artistId;
            var ref = String(q.quote_id || '').toUpperCase();
            if (!/^COT-[A-Z0-9]{4,12}$/.test(ref) || !String(q.client_full_name || '').trim() || !String(q.project_description || '').trim() || !(Number(d.total) > 0)) {
                return { error: 'Faltan datos obligatorios.' };
            }
            var artist = store.rows('artists_db').find(function (a) { return a.user_id === uid; }) || {};
            var nowIso = new Date().toISOString();
            var row = store.insert('quotations_db', [Object.assign({}, q, {
                quote_id: ref, quote_status: 'responded', source: 'manual', quotation_medium: 'manual',
                artist_id: uid, artist_name: artist.name || null, artist_username: artist.username || null, artist_email: artist.email || null,
                artist_budget_amount: Number(d.total), artist_budget_currency: q.artist_budget_currency || d.currency || 'ARS',
                artist_responded_at: nowIso, sent_to_artist_at: nowIso, updated_at: nowIso, is_archived: false,
                client_user_id: null, final_budget_amount: null, final_sessions: q.tattoo_estimated_sessions || null,
                reference_images_count: 0, reference_images: [], client_deleted_at: null, priority: q.priority || 'medium'
            })])[0];
            var record = {
                artist_id: uid, quote_ref: ref, status: 'sent', origin: d.origin || 'manual', artist_client_id: d.artist_client_id || null,
                quote_id: ref, client: d.client || {}, project: d.project || {}, line_items: d.line_items || [], currency: d.currency || 'ARS',
                discount_pct: d.discount_pct || 0, tax_pct: d.tax_pct || 0, deposit_pct: d.deposit_pct == null ? 30 : d.deposit_pct,
                subtotal: d.subtotal || 0, total: d.total || 0, deposit_amount: d.deposit_amount || 0, validity_days: d.validity_days || 14,
                cancellation_policy: d.cancellation_policy || 'no-reembolsable-48', client_notes: d.client_notes || null,
                extra_terms: d.extra_terms || null, sent_at: nowIso, updated_at: nowIso
            };
            var existing = store.rows('artist_manual_quotes').find(function (m) { return m.quote_ref === ref; });
            if (existing) Object.assign(existing, record); else store.insert('artist_manual_quotes', [record]);
            if (d.schedule_session && d.project && d.project.tentative_date) {
                store.insert('quotation_sessions', [{
                    quotation_id: row.id, session_number: 1, session_date: new Date(d.project.tentative_date + 'T11:00:00').toISOString(),
                    duration_hours: d.project.session_hours || null, status: 'scheduled', notes: 'Cita tentativa · cotización manual ' + ref,
                    google_event_id: null, updated_at: nowIso
                }]);
            }
            return { id: row.id, quote_id: row.quote_id, status: row.quote_status };
        };
    };
}(typeof self !== 'undefined' ? self : this));
