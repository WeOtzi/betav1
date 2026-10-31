/**
 * WE OTZI - Modelo de la cotización manual (/my-quotations/new)
 * ------------------------------------------------------------
 * Lógica pura del formulario "Nueva cotización manual" (Figma 801:556) y de
 * su "Vista previa para el cliente" (801:557): estado inicial, totales,
 * validación, payloads para la capa de datos y texto de la vista previa.
 *
 * Navegador: window.WoQuotationNewModel (requiere quotations-view-model.js).
 * Node (tests): require('./quotation-new-model.js').
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./quotations-view-model.js'));
    else root.WoQuotationNewModel = factory(root.WoQuotationsViewModel);
}(typeof self !== 'undefined' ? self : this, function (VM) {
    'use strict';

    var QUICK_CONCEPTS = [
        { key: 'diseno', label: 'Diseño personalizado' },
        { key: 'sesion', label: 'Sesión de tatuaje' },
        { key: 'materiales', label: 'Materiales' },
        { key: 'coverup', label: 'Cover-up' },
        { key: 'traslado', label: 'Traslado' },
        { key: 'adicional', label: 'Adicional' }
    ];

    var SIZE_OPTIONS = ['Chico · hasta 8 cm', 'Mediano · 8 a 15 cm', 'Grande · 15 a 30 cm', 'Extra grande · más de 30 cm'];
    var COLOR_OPTIONS = ['Blanco y negro', 'Negro y gris', 'Color', 'A definir'];
    var COMPLEXITY_OPTIONS = ['Baja', 'Media', 'Alta'];
    var DURATION_OPTIONS = [1, 2, 3, 4, 5, 6, 8];
    var VALIDITY_OPTIONS = [7, 14, 30];
    var PRIORITIES = [
        { value: 'high', label: 'Alta' },
        { value: 'medium', label: 'Media' },
        { value: 'low', label: 'Baja' }
    ];
    var POLICIES = [
        { value: 'no-reembolsable-48', label: 'Seña no reembolsable · 48 h de aviso', sentence: 'La seña no es reembolsable. Reprogramaciones con 48 h de aviso.' },
        { value: 'no-reembolsable-24', label: 'Seña no reembolsable · 24 h de aviso', sentence: 'La seña no es reembolsable. Reprogramaciones con 24 h de aviso.' },
        { value: 'reembolsable-72', label: 'Seña reembolsable · 72 h de aviso', sentence: 'La seña se devuelve si cancelás con 72 h de aviso.' },
        { value: 'sin-sena', label: 'Sin seña · cancelación sin costo', sentence: 'No se pide seña. Podés cancelar sin costo.' }
    ];
    var ORIGINS = ['manual', 'cliente', 'cita'];

    var REF_RE = /^COT-[A-Z0-9]{4,12}$/;

    function num(value) {
        if (value === null || value === undefined || value === '') return 0;
        var n = typeof value === 'number' ? value : parseFloat(String(value).replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
        return isFinite(n) ? n : 0;
    }

    function pct(value) { return Math.min(100, Math.max(0, num(value))); }
    function round2(n) { return Math.round(n * 100) / 100; }
    function clean(value) { return String(value == null ? '' : value).trim(); }

    function generateRef(random, now) {
        var rnd = typeof random === 'function' ? random : Math.random;
        var t = (typeof now === 'number' ? now : Date.now()).toString(36).toUpperCase().slice(-3);
        var r = '';
        while (r.length < 3) r += Math.floor(rnd() * 36).toString(36).toUpperCase();
        return 'COT-' + t + r;
    }

    function isValidRef(ref) { return REF_RE.test(String(ref || '')); }

    // ?fecha=AAAA-MM-DD (calendario / dashboard): solo fechas reales del calendario.
    function normalizeDateParam(value) {
        var v = clean(value);
        var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
        if (!m) return '';
        var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
        return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? v : '';
    }

    // ?volver=<ruta>: solo rutas internas ("/calendar/?view=week"), nunca otro dominio.
    function safeReturnPath(value) {
        var v = clean(value);
        if (!v || v.charAt(0) !== '/' || v.charAt(1) === '/' || v.charAt(1) === '\\') return null;
        if (/[\u0000-\u001f\\]/.test(v)) return null;
        return v;
    }

    function parseOrigin(value) {
        var v = String(value || '').toLowerCase();
        return ORIGINS.indexOf(v) !== -1 ? v : 'manual';
    }

    function newItem(seed) {
        seed = seed || {};
        return {
            id: seed.id || ('it' + Math.random().toString(36).slice(2, 9)),
            name: clean(seed.name),
            description: clean(seed.description),
            qty: seed.qty == null || seed.qty === '' ? 1 : seed.qty,
            price: seed.price == null ? '' : seed.price
        };
    }

    function createInitialState(opts) {
        opts = opts || {};
        return {
            ref: opts.ref && isValidRef(opts.ref) ? opts.ref : generateRef(opts.random, opts.now),
            origin: parseOrigin(opts.origin),
            client: null,
            title: '',
            description: '',
            style: null,
            bodyPart: '',
            size: 'Mediano · 8 a 15 cm',
            color: 'Blanco y negro',
            complexity: 'Media',
            coverUp: false,
            sessions: 1,
            sessionHours: 3,
            location: opts.location || '',
            date: normalizeDateParam(opts.date),
            priority: 'medium',
            items: [newItem()],
            currency: String(opts.currency || 'ARS').toUpperCase(),
            discountPct: 0,
            taxPct: 0,
            depositPct: 30,
            validityDays: 14,
            policy: POLICIES[0].value,
            clientNotes: '',
            extraTerms: ''
        };
    }

    function lineTotal(item) {
        return round2(Math.max(0, num(item && item.qty)) * Math.max(0, num(item && item.price)));
    }

    function computeTotals(state) {
        var items = (state && state.items) || [];
        var subtotal = round2(items.reduce(function (sum, it) { return sum + lineTotal(it); }, 0));
        var discount = round2(subtotal * pct(state.discountPct) / 100);
        var taxable = round2(subtotal - discount);
        var tax = round2(taxable * pct(state.taxPct) / 100);
        var total = round2(taxable + tax);
        var deposit = round2(total * pct(state.depositPct) / 100);
        var balance = round2(total - deposit);
        return { subtotal: subtotal, discount: discount, tax: tax, total: total, deposit: deposit, balance: balance };
    }

    function hasPricedItem(state) {
        return ((state && state.items) || []).some(function (it) { return clean(it.name) && lineTotal(it) > 0; });
    }

    // Orden fijo del Figma: "Falta cliente, título y un concepto con precio".
    function missingRequirements(state) {
        var missing = [];
        if (!state || !state.client || !clean(state.client.name)) missing.push('cliente');
        if (!state || !clean(state.title)) missing.push('título');
        if (!hasPricedItem(state)) missing.push('un concepto con precio');
        return missing;
    }

    function missingMessage(missing) {
        if (!missing || !missing.length) return '';
        if (missing.length === 1) return 'Falta ' + missing[0];
        return 'Falta ' + missing.slice(0, -1).join(', ') + ' y ' + missing[missing.length - 1];
    }

    function isReady(state) { return missingRequirements(state).length === 0; }

    function policyFor(value) {
        return POLICIES.find(function (p) { return p.value === value; }) || POLICIES[0];
    }

    function conditionsSentence(validityDays, policyValue) {
        var days = Math.max(1, Math.round(num(validityDays)) || 14);
        return 'Vigencia: ' + days + ' días. ' + policyFor(policyValue).sentence;
    }

    function styleRecord(style) {
        if (!style) return null;
        if (typeof style === 'string') return { style_id: style, style_slug: style, style_name: style, substyle_name: null };
        return {
            style_id: style.id != null ? String(style.id) : (style.style_id || null),
            style_slug: style.slug || style.style_slug || null,
            style_name: style.name || style.style_name || '',
            substyle_name: null
        };
    }

    function styleLabel(style) {
        var rec = styleRecord(style);
        return rec ? rec.style_name : '';
    }

    // Fila de quotations_db (p_quote del RPC create_manual_quotation). El RPC
    // fuerza artist_id/source/estado del lado del servidor.
    function buildQuotePayload(state, ctx) {
        ctx = ctx || {};
        var totals = computeTotals(state);
        var client = state.client || {};
        var sessions = Math.max(1, Math.round(num(state.sessions)) || 1);
        return {
            quote_id: state.ref,
            client_full_name: clean(client.name),
            client_email: clean(client.email).toLowerCase() || null,
            client_whatsapp: clean(client.whatsapp) || null,
            client_instagram: clean(client.instagram) || null,
            client_city_residence: clean(client.city) || null,
            project_description: clean(state.title),
            tattoo_idea_description: clean(state.description) || clean(state.title),
            tattoo_style: styleRecord(state.style),
            tattoo_body_part: clean(state.bodyPart) || null,
            tattoo_size: clean(state.size) || null,
            tattoo_color_type: clean(state.color) || null,
            tattoo_is_cover_up: !!state.coverUp,
            tattoo_estimated_sessions: sessions,
            client_preferred_date: clean(state.date) || null,
            priority: ['high', 'medium', 'low'].indexOf(state.priority) !== -1 ? state.priority : 'medium',
            artist_budget_amount: totals.total,
            artist_budget_currency: state.currency,
            artist_studio_name: clean(state.location) || null
        };
    }

    // Detalle de la cotización manual (p_details y fila de artist_manual_quotes).
    function buildDetailsPayload(state, ctx) {
        ctx = ctx || {};
        var totals = computeTotals(state);
        var client = state.client || {};
        return {
            origin: parseOrigin(state.origin),
            artist_client_id: client.id || null,
            client: {
                name: clean(client.name), email: clean(client.email).toLowerCase() || null,
                whatsapp: clean(client.whatsapp) || null, instagram: clean(client.instagram) || null,
                city: clean(client.city) || null
            },
            project: {
                title: clean(state.title), description: clean(state.description),
                style: styleRecord(state.style), body_part: clean(state.bodyPart) || null,
                size: clean(state.size) || null, color: clean(state.color) || null,
                complexity: clean(state.complexity) || null, cover_up: !!state.coverUp,
                sessions: Math.max(1, Math.round(num(state.sessions)) || 1),
                session_hours: Math.max(0, num(state.sessionHours)) || null,
                location: clean(state.location) || null, tentative_date: clean(state.date) || null,
                priority: state.priority || 'medium'
            },
            line_items: (state.items || []).filter(function (it) { return clean(it.name) || num(it.price) > 0; }).map(function (it) {
                return { name: clean(it.name), description: clean(it.description) || null, qty: Math.max(0, num(it.qty)), price: Math.max(0, num(it.price)), total: lineTotal(it) };
            }),
            currency: state.currency,
            discount_pct: pct(state.discountPct),
            tax_pct: pct(state.taxPct),
            deposit_pct: pct(state.depositPct),
            subtotal: totals.subtotal,
            total: totals.total,
            deposit_amount: totals.deposit,
            validity_days: Math.max(1, Math.round(num(state.validityDays)) || 14),
            cancellation_policy: policyFor(state.policy).value,
            client_notes: clean(state.clientNotes) || null,
            extra_terms: clean(state.extraTerms) || null,
            // "Nueva cita" del dashboard: con fecha tentativa se agenda la primera sesión.
            schedule_session: parseOrigin(state.origin) === 'cita' && !!clean(state.date)
        };
    }

    // Borrador (artist_manual_quotes con status draft).
    function buildDraftRecord(state, ctx) {
        ctx = ctx || {};
        var d = buildDetailsPayload(state, ctx);
        return {
            artist_id: ctx.artistId || null,
            quote_ref: state.ref,
            status: 'draft',
            origin: d.origin,
            artist_client_id: d.artist_client_id,
            client: d.client,
            project: d.project,
            line_items: (state.items || []).map(function (it) {
                return { id: it.id, name: clean(it.name), description: clean(it.description) || null, qty: it.qty, price: it.price };
            }),
            currency: d.currency,
            discount_pct: d.discount_pct,
            tax_pct: d.tax_pct,
            deposit_pct: d.deposit_pct,
            subtotal: d.subtotal,
            total: d.total,
            deposit_amount: d.deposit_amount,
            validity_days: d.validity_days,
            cancellation_policy: d.cancellation_policy,
            client_notes: d.client_notes,
            extra_terms: d.extra_terms
        };
    }

    function stateFromDraft(record, opts) {
        var base = createInitialState(Object.assign({}, opts || {}, { ref: record && record.quote_ref, origin: record && record.origin, currency: record && record.currency }));
        if (!record) return base;
        var c = record.client || {};
        var p = record.project || {};
        base.client = clean(c.name) ? { id: record.artist_client_id || null, name: c.name, email: c.email || '', whatsapp: c.whatsapp || '', instagram: c.instagram || '', city: c.city || '' } : null;
        base.title = p.title || '';
        base.description = p.description || '';
        base.style = p.style && p.style.style_name ? { id: p.style.style_id, slug: p.style.style_slug, name: p.style.style_name } : null;
        base.bodyPart = p.body_part || '';
        base.size = p.size || base.size;
        base.color = p.color || base.color;
        base.complexity = p.complexity || base.complexity;
        base.coverUp = !!p.cover_up;
        base.sessions = p.sessions || 1;
        base.sessionHours = p.session_hours || base.sessionHours;
        base.location = p.location || '';
        base.date = p.tentative_date || '';
        base.priority = p.priority || 'medium';
        var items = Array.isArray(record.line_items) ? record.line_items : [];
        base.items = items.length ? items.map(newItem) : [newItem()];
        base.discountPct = num(record.discount_pct);
        base.taxPct = num(record.tax_pct);
        base.depositPct = record.deposit_pct == null ? 30 : num(record.deposit_pct);
        base.validityDays = record.validity_days || 14;
        base.policy = policyFor(record.cancellation_policy).value;
        base.clientNotes = record.client_notes || '';
        base.extraTerms = record.extra_terms || '';
        return base;
    }

    // Vista previa para el cliente (Figma 801:557).
    function previewModel(state, ctx) {
        ctx = ctx || {};
        var totals = computeTotals(state);
        var money = function (n) { return VM.formatMoney(n, state.currency); };
        var client = state.client && clean(state.client.name) ? clean(state.client.name) : '';
        var sessions = Math.max(1, Math.round(num(state.sessions)) || 1);
        var hours = num(state.sessionHours);
        var items = (state.items || []).map(function (it) {
            return {
                name: clean(it.name),
                description: clean(it.description),
                qtyLine: (num(it.qty) || 0) + ' × ' + money(num(it.price)),
                total: money(lineTotal(it))
            };
        });
        return {
            header: 'Vista del cliente · ' + state.ref,
            byline: 'Cotización de ' + (clean(ctx.artistName) || 'tu artista') + ' · We Ötzi',
            title: clean(state.title) || 'Cotización sin título',
            clientLine: client ? 'Para ' + client : 'Para cliente sin asignar',
            description: clean(state.description) || 'Sin descripción de la idea todavía.',
            chips: [
                styleLabel(state.style) || 'Estilo a definir',
                clean(state.bodyPart) || 'Zona a definir',
                sessions + ' sesión(es)' + (hours > 0 ? ' · ' + (Math.round(hours * 10) / 10) + ' h' : '')
            ],
            items: items,
            total: money(totals.total),
            depositLine: 'Seña ' + money(totals.deposit) + ' · Saldo ' + money(totals.balance),
            conditions: conditionsSentence(state.validityDays, state.policy),
            notes: clean(state.clientNotes),
            terms: clean(state.extraTerms),
            missing: missingMessage(missingRequirements(state))
        };
    }

    // Clientes conocidos: los de la libreta (artist_clients) + los de cotizaciones anteriores.
    function clientsFromQuotes(quotes) {
        var seen = {};
        var out = [];
        (quotes || []).forEach(function (q) {
            var name = clean(q.client_full_name);
            if (!name) return;
            var key = (clean(q.client_email).toLowerCase() || name.toLowerCase());
            if (seen[key]) return;
            seen[key] = true;
            out.push({ id: null, name: name, email: clean(q.client_email), whatsapp: clean(q.client_whatsapp), instagram: clean(q.client_instagram), city: clean(q.client_city_residence), source: 'quote' });
        });
        return out;
    }

    function mergeClients(bookClients, quoteClients) {
        var seen = {};
        var out = [];
        (bookClients || []).concat(quoteClients || []).forEach(function (c) {
            var name = clean(c.full_name || c.name);
            if (!name) return;
            var key = clean(c.email).toLowerCase() || name.toLowerCase();
            if (seen[key]) return;
            seen[key] = true;
            out.push({ id: c.id || null, name: name, email: clean(c.email), whatsapp: clean(c.whatsapp), instagram: clean(c.instagram), city: clean(c.city || c.city_residence), source: c.source || 'book' });
        });
        return out;
    }

    function normalizeText(s) {
        return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    }

    function searchClients(list, query, limit) {
        var q = normalizeText(query).trim();
        var max = limit || 6;
        if (!q) return (list || []).slice(0, max);
        var digits = q.replace(/\D/g, '');
        return (list || []).filter(function (c) {
            if (normalizeText(c.name).indexOf(q) !== -1) return true;
            if (normalizeText(c.email).indexOf(q) !== -1) return true;
            return digits.length >= 3 && String(c.whatsapp || '').replace(/\D/g, '').indexOf(digits) !== -1;
        }).slice(0, max);
    }

    function validateNewClient(input) {
        var name = clean(input && input.name);
        var email = clean(input && input.email);
        if (name.length < 2) return 'Ingresá el nombre del cliente.';
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'El correo no parece válido.';
        return '';
    }

    return {
        QUICK_CONCEPTS: QUICK_CONCEPTS,
        SIZE_OPTIONS: SIZE_OPTIONS,
        COLOR_OPTIONS: COLOR_OPTIONS,
        COMPLEXITY_OPTIONS: COMPLEXITY_OPTIONS,
        DURATION_OPTIONS: DURATION_OPTIONS,
        VALIDITY_OPTIONS: VALIDITY_OPTIONS,
        PRIORITIES: PRIORITIES,
        POLICIES: POLICIES,
        ORIGINS: ORIGINS,
        num: num,
        generateRef: generateRef,
        isValidRef: isValidRef,
        parseOrigin: parseOrigin,
        normalizeDateParam: normalizeDateParam,
        safeReturnPath: safeReturnPath,
        newItem: newItem,
        createInitialState: createInitialState,
        lineTotal: lineTotal,
        computeTotals: computeTotals,
        missingRequirements: missingRequirements,
        missingMessage: missingMessage,
        isReady: isReady,
        policyFor: policyFor,
        conditionsSentence: conditionsSentence,
        styleRecord: styleRecord,
        styleLabel: styleLabel,
        buildQuotePayload: buildQuotePayload,
        buildDetailsPayload: buildDetailsPayload,
        buildDraftRecord: buildDraftRecord,
        stateFromDraft: stateFromDraft,
        previewModel: previewModel,
        clientsFromQuotes: clientsFromQuotes,
        mergeClients: mergeClients,
        searchClients: searchClients,
        validateNewClient: validateNewClient
    };
}));
