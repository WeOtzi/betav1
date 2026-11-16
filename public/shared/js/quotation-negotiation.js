/**
 * WE OTZI - Negociación de la cotización (ronda 2 · frente "negociacion")
 * ----------------------------------------------------------------------
 * P23 · Contrapropuesta: sobre una propuesta recibida el cliente puede
 *       Aceptar, Rechazar o MODIFICAR (presupuesto, zona, tamaño, estilo,
 *       color, idea). El artista ve el antes → después y acepta los cambios
 *       (la cotización queda aprobada por ambas partes) o hace otra propuesta.
 * P25 · Enmiendas del acuerdo: con el acuerdo aprobado, cliente o artista
 *       proponen cambios de precio, sesiones, anticipo o condiciones. Rigen solo
 *       cuando la otra parte los aprueba.
 *
 * Un solo archivo, tres partes:
 *   1. Modelo puro (sin DOM). También lo usa el servidor (lib/negociacion.js)
 *      y los tests: campos, validación, antes → después, permisos y textos.
 *   2. HTML del panel y de los formularios (todo dato se escapa).
 *   3. Controlador del navegador: se monta solo.
 *        · Cliente: client-quote-proposal.js deja <div data-wqn-mount
 *          data-quote-id data-role="client"> dentro del bloque de la propuesta.
 *        · Artista: escucha 'wo:quotation-detail-rendered' del expediente e
 *          inserta su panel debajo de la identidad.
 *      "Hacer otra propuesta" dispara en document el CustomEvent
 *      'wo:quote-respond' con detail { quoteId, prefill } (lo escucha el
 *      diálogo de respuesta del artista); si nadie lo atiende, abre el
 *      expediente con ?modal=responder.
 *      Tras cada cambio emite 'wo:negotiation-changed' { quoteId, role,
 *      action, proposal, quote_status }.
 *
 * Datos: WeotziData.Negotiation → /api/negociacion/quotations/:quoteId
 * (lib/routes/negociacion.js). El servidor valida dueño y estado; la base
 * aplica los cambios de forma atómica (negociacion_propose / _resolve).
 *
 * Expone window.WoQuoteNegotiation (o module.exports en Node).
 */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else {
        root.WoQuoteNegotiation = api;
        if (root.document) api.boot(root);
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /* ====================================================================
       1. MODELO PURO
       ==================================================================== */
    var COUNTER_FIELDS = ['artist_budget_amount', 'tattoo_body_part', 'tattoo_size', 'tattoo_style', 'tattoo_color_type', 'tattoo_idea_description'];
    var AMENDMENT_FIELDS = ['final_budget_amount', 'final_sessions', 'artist_deposit_pct', 'final_comment'];
    var FIELD_ORDER = COUNTER_FIELDS.concat(AMENDMENT_FIELDS);
    var LABELS = {
        artist_budget_amount: 'Presupuesto',
        tattoo_body_part: 'Zona del cuerpo',
        tattoo_size: 'Tamaño',
        tattoo_style: 'Estilo',
        tattoo_color_type: 'Color',
        tattoo_idea_description: 'Descripción de la idea',
        final_budget_amount: 'Precio total',
        final_sessions: 'Sesiones',
        artist_deposit_pct: 'Anticipo',
        final_comment: 'Condiciones'
    };
    // Mismos límites que negociacion_propose (migración 20261116140000). La
    // zona admite lo que guarda el cotizador (quotation-body-model.js: 255).
    // Los límites valen para lo que CAMBIA: un dato que queda igual no se
    // valida (el cotizador guarda más estilos y textos más largos).
    var LIMITS = {
        note: 600,
        amountMax: 9999999999,
        sessionsMin: 1, sessionsMax: 30,
        final_comment: 600,
        tattoo_body_part: [2, 255],
        tattoo_size: [1, 80],
        tattoo_color_type: [1, 50],
        tattoo_idea_description: [10, 2000],
        styleMax: 60, stylesMax: 3
    };
    // "Aprobada por ambas partes": agreement_approved_at + uno de estos estados.
    var AGREED_STATUSES = ['client_approved', 'in_progress', 'en_progreso', 'artist_completed', 'completed'];
    var AMENDABLE_STATUSES = ['client_approved', 'in_progress', 'en_progreso', 'artist_completed'];
    var PROPOSAL_STATUS = {
        pending: 'Pendiente', accepted: 'Aprobada', rejected: 'Rechazada',
        superseded: 'Reemplazada', withdrawn: 'Retirada'
    };
    // Tamaños: los mismos valores que guarda el cotizador (FIGMA_SIZE_OPTIONS de
    // script.js → toTitleCase(value); los entiende lib/prequote-estimator.js).
    // Sin rangos en cm propios: el rango lo muestra el cotizador.
    var SIZE_OPTIONS = [
        { value: 'Micro', label: 'Micro' },
        { value: 'Pequeño', label: 'Pequeño' },
        { value: 'Mediano', label: 'Mediano' },
        { value: 'Grande', label: 'Grande' },
        { value: 'Muy_grande', label: 'XL' },
        { value: 'Media Manga', label: 'Media manga' },
        { value: 'Manga Completa', label: 'Manga' }
    ];
    var COLOR_OPTIONS = ['Blanco y negro', 'Negro y gris', 'Color', 'Solo líneas', 'A definir'];
    var BODY_OPTIONS = ['Antebrazo', 'Brazo', 'Hombro', 'Muñeca', 'Mano', 'Pecho', 'Costillas', 'Abdomen', 'Espalda', 'Cuello', 'Muslo', 'Pantorrilla', 'Tobillo', 'Pie'];
    var STYLE_OPTIONS = ['Blackwork', 'Fine line', 'Realismo', 'Tradicional', 'Neotradicional', 'Japonés', 'Minimalista', 'Dotwork', 'Acuarela', 'Lettering', 'Geométrico', 'Anime'];

    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function hasValue(v) { return v != null && String(v).trim() !== ''; }

    // Lo que escribe una persona: "1.800", "1,800.50", "1800,5" → número o null.
    function toNumber(v) {
        if (v == null || v === '') return null;
        if (typeof v === 'number') return isFinite(v) ? v : null;
        var s = String(v).trim().replace(/[^\d.,-]/g, '');
        if (!s) return null;
        if (s.indexOf(',') !== -1 && s.indexOf('.') !== -1) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
        else if (s.indexOf(',') !== -1) s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
        else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
        var n = Number(s);
        return isFinite(n) ? n : null;
    }
    // Lo que está guardado (formato canónico "1850" / "1850.5"); si no, se interpreta.
    function storedNumber(v) {
        if (v == null || v === '') return null;
        if (typeof v === 'number') return isFinite(v) ? v : null;
        var s = String(v).trim();
        return /^\d+(\.\d+)?$/.test(s) ? Number(s) : toNumber(s);
    }
    // Número → texto canónico para guardar: hasta 2 decimales, sin ceros de más.
    function amountString(n) {
        if (n == null || !isFinite(n)) return '';
        return (Math.round(n * 100) / 100).toFixed(2).replace(/\.?0+$/, '');
    }
    function money(amount, currency) {
        var n = storedNumber(amount);
        var cur = String(currency || '').trim().toUpperCase();
        if (n == null) return hasValue(amount) ? (String(amount).trim() + (cur ? ' ' + cur : '')) : '';
        var txt;
        try { txt = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(n); } catch (e) { txt = String(n); }
        return txt + (cur ? ' ' + cur : '');
    }
    function dateLabel(iso) {
        if (!iso) return '';
        var d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        try { return new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'long', year: 'numeric' }).format(d); } catch (e) { return d.toISOString().slice(0, 10); }
    }
    function firstName(name, fallback) {
        var s = String(name == null ? '' : name).replace(/\s+/g, ' ').trim();
        return s ? s.split(' ')[0] : fallback;
    }

    // tattoo_style es jsonb con varias formas históricas: "Realismo",
    // ["Blackwork"], { style_name }, { styles: [...] } o su JSON en texto.
    function styleNames(value) {
        if (value == null || value === '') return [];
        if (typeof value === 'string') {
            var raw = value.trim();
            if (!raw) return [];
            if (/^[\[{"]/.test(raw)) {
                try { return styleNames(JSON.parse(raw)); } catch (e) { /* texto plano */ }
            }
            return [raw];
        }
        if (Array.isArray(value)) {
            var out = [];
            value.forEach(function (item) {
                styleNames(item).forEach(function (name) { if (out.indexOf(name) === -1) out.push(name); });
            });
            return out;
        }
        if (typeof value === 'object') {
            if (Array.isArray(value.styles)) return styleNames(value.styles);
            var parts = [value.style_name || value.name || value.label, value.substyle_name]
                .filter(function (s) { return typeof s === 'string' && s.trim(); })
                .map(function (s) { return s.trim(); });
            return parts.length ? [parts.join(' - ')] : [];
        }
        return [String(value)];
    }
    function styleText(value) { return styleNames(value).join(', '); }

    function isWizardDraft(q) {
        return !!q && q.quote_status === 'in_progress' && !q.artist_responded_at
            && !hasValue(q.artist_budget_amount) && !hasValue(q.final_budget_amount) && !hasValue(q.final_sessions);
    }
    function isExpired(q, now) {
        if (!q) return false;
        if (q.quote_status === 'expired') return true;
        if (q.quote_status !== 'responded' || !q.quote_expires_at) return false;
        var at = Date.parse(q.quote_expires_at);
        return isFinite(at) && at <= (now == null ? Date.now() : now);
    }
    /**
     * ¿La cotización está aprobada por ambas partes? Fuente de verdad:
     * quotations_db.agreement_approved_at (la sella la base). Si la fila no
     * trae la columna (lectura vieja), se deduce del estado.
     */
    function isAgreed(q) {
        if (!q || AGREED_STATUSES.indexOf(q.quote_status) === -1) return false;
        if (Object.prototype.hasOwnProperty.call(q, 'agreement_approved_at')) return !!q.agreement_approved_at;
        return !isWizardDraft(q);
    }
    function agreementOf(q) {
        var agreed = isAgreed(q);
        return {
            approved: agreed,
            approved_at: agreed ? (q.agreement_approved_at || null) : null,
            version: agreed ? Math.max(1, parseInt(q.agreement_version, 10) || 1) : 0
        };
    }
    // Rol del usuario en la cotización. hint desempata la autocotización de QA.
    function roleOf(q, userId, hint) {
        if (!q || !userId) return null;
        var isClient = !!q.client_user_id && q.client_user_id === userId;
        var isArtist = !!q.artist_id && q.artist_id === userId;
        if (isClient && isArtist) return hint === 'artist' ? 'artist' : 'client';
        return isClient ? 'client' : isArtist ? 'artist' : null;
    }
    function otherRole(role) { return role === 'client' ? 'artist' : 'client'; }
    function agreementCurrency(q) {
        q = q || {};
        return String((hasValue(q.final_budget_currency) ? q.final_budget_currency : q.artist_budget_currency) || '').trim().toUpperCase();
    }
    function counterCurrency(q) { return String((q && q.artist_budget_currency) || '').trim().toUpperCase(); }

    /** Permisos de negociación: { counter, amend, reason }. */
    function can(q, role, now) {
        var out = { counter: false, amend: false, reason: '' };
        if (!q || !role) return out;
        if ((q.dispute_status || 'none') === 'open') {
            out.reason = 'Esta cotización tiene un reclamo abierto. Soporte lo está revisando.';
            return out;
        }
        if (q.quote_status === 'responded') {
            if (isExpired(q, now)) out.reason = 'La propuesta venció.';
            else if (role === 'client') out.counter = true;
            return out;
        }
        if (isAgreed(q) && AMENDABLE_STATUSES.indexOf(q.quote_status) !== -1) {
            // Un cambio necesita a la otra parte para aprobarlo: si el cliente
            // todavía no tiene cuenta, el artista edita el acuerdo como siempre.
            if (q.client_user_id && q.artist_id) out.amend = true;
            else out.reason = 'El cliente todavía no tiene cuenta en We Ötzi para aprobar cambios.';
        }
        return out;
    }

    /**
     * Valores vigentes de los campos negociables.
     * extras = { manualDepositPct } (anticipo de la cotización manual enviada).
     */
    function currentValues(kind, q, extras) {
        q = q || {};
        extras = extras || {};
        if (kind === 'counter') {
            return {
                artist_budget_amount: amountString(storedNumber(q.artist_budget_amount)),
                tattoo_body_part: String(q.tattoo_body_part || '').trim(),
                tattoo_size: String(q.tattoo_size || '').trim(),
                tattoo_style: styleNames(q.tattoo_style),
                tattoo_color_type: String(q.tattoo_color_type || '').trim(),
                tattoo_idea_description: String(q.tattoo_idea_description || '').trim()
            };
        }
        var sessions = parseInt(hasValue(q.final_sessions) ? q.final_sessions : q.tattoo_estimated_sessions, 10);
        var pct = q.artist_deposit_pct == null || q.artist_deposit_pct === '' ? Number(extras.manualDepositPct) : Number(q.artist_deposit_pct);
        return {
            final_budget_amount: amountString(storedNumber(hasValue(q.final_budget_amount) ? q.final_budget_amount : q.artist_budget_amount)),
            final_sessions: isFinite(sessions) && sessions > 0 ? String(sessions) : '',
            artist_deposit_pct: isFinite(pct) && pct > 0 ? pct : null,
            final_comment: String(q.final_comment || '').trim()
        };
    }

    function fail(error, field, code) { return { ok: false, status: 400, code: code || 'invalid', error: error, field: field || null }; }
    function cleanLine(value) { return String(value == null ? '' : value).replace(/\s+/g, ' ').trim(); }
    function cleanMultiline(value) {
        return String(value == null ? '' : value)
            .replace(/\r\n?/g, '\n')
            .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ')
            .replace(/[ \t]*\n[ \t]*/g, '\n').replace(/\n{3,}/g, '\n\n')
            .trim();
    }
    function sameText(a, b) { return cleanLine(a).toLowerCase() === cleanLine(b).toLowerCase(); }
    function normalizeNote(value) { return cleanMultiline(value).slice(0, LIMITS.note); }

    function normalizeField(key, raw, current, extras) {
        if (key === 'artist_budget_amount' || key === 'final_budget_amount') {
            var n = typeof raw === 'number' ? raw : toNumber(raw);
            if (n == null || !(n > 0)) return fail('Ingresa un monto mayor a cero.', key);
            if (n > LIMITS.amountMax) return fail('El monto es demasiado alto.', key);
            n = Math.round(n * 100) / 100;
            if (key === 'final_budget_amount' && extras.paid != null && n + 0.004 < Number(extras.paid)) {
                return fail('El precio no puede ser menor a lo que ya está registrado como pagado (' + money(extras.paid, extras.currency) + ').', key, 'below_paid');
            }
            var prev = storedNumber(current[key]);
            return { ok: true, value: amountString(n), changed: prev == null || Math.abs(prev - n) > 0.004 };
        }
        if (key === 'final_sessions') {
            var s = String(raw == null ? '' : raw).trim();
            var count = /^\d{1,2}$/.test(s) ? parseInt(s, 10) : NaN;
            if (!(count >= LIMITS.sessionsMin && count <= LIMITS.sessionsMax)) return fail('Indica cuántas sesiones, de 1 a 30.', key);
            if (extras.sessionsUsed != null && count < Number(extras.sessionsUsed)) {
                return fail('Ya hay ' + extras.sessionsUsed + (Number(extras.sessionsUsed) === 1 ? ' sesión agendada o realizada' : ' sesiones agendadas o realizadas') + ': no se pueden acordar menos.', key, 'below_sessions');
            }
            return { ok: true, value: String(count), changed: String(parseInt(current[key], 10)) !== String(count) };
        }
        if (key === 'artist_deposit_pct') {
            var p = raw == null ? '' : String(raw).trim().replace(/\s*%$/, '').replace(',', '.');
            var pct = null;
            if (p !== '') {
                if (!/^\d{1,3}(\.\d{1,2})?$/.test(p) || Number(p) > 100) return fail('El anticipo es un porcentaje entre 0 y 100.', key);
                pct = Number(p) === 0 ? null : Number(p);
            }
            var before = current[key] == null ? null : Number(current[key]);
            var changed = (before == null) !== (pct == null) || (before != null && Math.abs(before - pct) > 0.004);
            return { ok: true, value: pct, changed: changed };
        }
        if (key === 'final_comment') {
            if (raw != null && typeof raw !== 'string') return fail('Las condiciones no son válidas.', key);
            var text = cleanMultiline(raw);
            if (text.length > LIMITS.final_comment) return fail('Las condiciones pueden tener hasta ' + LIMITS.final_comment + ' caracteres.', key);
            return { ok: true, value: text || null, changed: text !== String(current[key] || '').trim() };
        }
        if (key === 'tattoo_style') {
            var list = (Array.isArray(raw) ? raw : String(raw == null ? '' : raw).split(','))
                .map(function (item) { return typeof item === 'string' ? cleanLine(item) : ''; })
                .filter(Boolean)
                .filter(function (item, i, all) { return all.findIndex(function (o) { return sameText(o, item); }) === i; });
            if (!list.length) return fail('Indica al menos un estilo.', key);
            // Lo que no cambia no se valida: el cotizador no limita la cantidad de estilos.
            if (sameText(list.join(', '), (current[key] || []).join(', '))) return { ok: true, value: list, changed: false };
            if (list.length > LIMITS.stylesMax) return fail('Elige hasta ' + LIMITS.stylesMax + ' estilos, separados por coma.', key);
            if (list.some(function (item) { return item.length > LIMITS.styleMax; })) return fail('Cada estilo puede tener hasta ' + LIMITS.styleMax + ' caracteres.', key);
            return { ok: true, value: list, changed: true };
        }
        // Texto del pedido: zona, tamaño, color e idea.
        if (typeof raw !== 'string') return fail('El dato no es válido.', key);
        var value = key === 'tattoo_idea_description' ? cleanMultiline(raw) : cleanLine(raw);
        // Lo que no cambia no se valida (una zona guardada por el cotizador puede
        // pasar el límite). En una línea no cuentan mayúsculas ni espacios de más.
        var before = String(current[key] == null ? '' : current[key]);
        var unchanged = key === 'tattoo_idea_description' ? value === cleanMultiline(before) : sameText(value, before);
        if (value && unchanged) return { ok: true, value: value, changed: false };
        var range = LIMITS[key];
        if (value.length < range[0] || value.length > range[1]) {
            var messages = {
                tattoo_body_part: 'Indica la zona del cuerpo (hasta ' + range[1] + ' caracteres).',
                tattoo_size: 'Indica el tamaño (hasta ' + range[1] + ' caracteres).',
                tattoo_color_type: 'Indica el color (hasta ' + range[1] + ' caracteres).',
                tattoo_idea_description: 'Describe la idea con al menos ' + range[0] + ' caracteres (hasta ' + range[1] + ').'
            };
            return fail(messages[key], key);
        }
        return { ok: true, value: value, changed: true };
    }

    /**
     * Valida lo que se quiere cambiar y deja solo lo que cambia de verdad.
     *   kind    'counter' | 'amendment'
     *   input   { <campo>: valor nuevo } (los ausentes no se tocan)
     *   current currentValues(kind, cotización)
     *   extras  { paid, currency, sessionsUsed } (límites de una enmienda)
     * → { ok: true, changes: { <campo>: valor normalizado } }
     *   { ok: false, status: 400, code, error, field }
     */
    function normalizeChanges(kind, input, current, extras) {
        var fields = kind === 'counter' ? COUNTER_FIELDS : kind === 'amendment' ? AMENDMENT_FIELDS : null;
        if (!fields) return fail('Indica qué quieres proponer.', 'kind');
        if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('No recibimos los cambios.', 'changes');
        var unknown = Object.keys(input).filter(function (key) { return fields.indexOf(key) === -1; });
        if (unknown.length) return fail('Hay un dato que no se puede cambiar desde aquí.', unknown[0], 'field');
        current = current || {};
        extras = extras || {};
        var changes = {};
        for (var i = 0; i < fields.length; i += 1) {
            var key = fields[i];
            if (!Object.prototype.hasOwnProperty.call(input, key) || input[key] === undefined) continue;
            var result = normalizeField(key, input[key], current, extras);
            if (!result.ok) return result;
            if (result.changed) changes[key] = result.value;
        }
        if (!Object.keys(changes).length) {
            return fail(kind === 'counter'
                ? 'Cambia al menos un dato para enviar tu propuesta.'
                : 'Cambia al menos un dato del acuerdo para proponerlo.', null, 'no_changes');
        }
        return { ok: true, changes: changes };
    }

    /**
     * Valores de un formulario → input de normalizeChanges. Un dato que estaba
     * vacío y sigue vacío no es un cambio (ni un error); vaciar el anticipo o las
     * condiciones sí es un cambio válido.
     */
    function formInput(values, kind, current) {
        var input = {};
        values = values || {};
        current = current || {};
        (kind === 'counter' ? COUNTER_FIELDS : AMENDMENT_FIELDS).forEach(function (name) {
            if (!Object.prototype.hasOwnProperty.call(values, name) || values[name] == null) return;
            var before = current[name];
            var hadValue = Array.isArray(before) ? before.length > 0 : hasValue(before);
            var emptyAllowed = name === 'artist_deposit_pct' || name === 'final_comment';
            if (!emptyAllowed && !hasValue(values[name]) && !hadValue) return;
            input[name] = values[name];
        });
        return input;
    }

    // Clave de comparación de una opción de catálogo: sin mayúsculas, tildes ni "_".
    function optionKey(value) {
        var s = cleanLine(value).toLowerCase().replace(/_/g, ' ');
        try { s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) { /* sin normalize */ }
        return s.replace(/\s+/g, ' ').trim();
    }
    /** Tamaño guardado → texto para mostrar: "Muy_grande" → "XL", "mediano" → "Mediano". */
    function sizeLabel(value) {
        if (!hasValue(value)) return '';
        var key = optionKey(value);
        for (var i = 0; i < SIZE_OPTIONS.length; i += 1) {
            if (optionKey(SIZE_OPTIONS[i].value) === key || optionKey(SIZE_OPTIONS[i].label) === key) return SIZE_OPTIONS[i].label;
        }
        return String(value).replace(/_/g, ' ').trim();
    }

    function displayValue(key, value, currency) {
        if (key === 'artist_budget_amount' || key === 'final_budget_amount') return hasValue(value) ? money(value, currency) : 'Sin definir';
        if (key === 'final_sessions') {
            var n = parseInt(value, 10);
            return isFinite(n) && n > 0 ? n + (n === 1 ? ' sesión' : ' sesiones') : 'Sin definir';
        }
        if (key === 'artist_deposit_pct') {
            var pct = value == null || value === '' ? NaN : Number(value);
            return isFinite(pct) && pct > 0 ? String(Math.round(pct * 100) / 100).replace('.', ',') + ' %' : 'Sin anticipo';
        }
        if (key === 'tattoo_style') return styleText(value) || 'Sin definir';
        if (key === 'final_comment') return hasValue(value) ? String(value).trim() : 'Sin condiciones';
        if (key === 'tattoo_size') return sizeLabel(value) || 'Sin definir';
        return hasValue(value) ? String(value).trim() : 'Sin definir';
    }

    /** Filas antes → después de una propuesta, en orden fijo. */
    function diffRows(proposal) {
        var changes = (proposal && proposal.changes && typeof proposal.changes === 'object') ? proposal.changes : {};
        var currency = proposal && proposal.currency;
        return FIELD_ORDER.filter(function (key) { return Object.prototype.hasOwnProperty.call(changes, key); }).map(function (key) {
            var c = changes[key] || {};
            return { key: key, label: LABELS[key], from: displayValue(key, c.from, currency), to: displayValue(key, c.to, currency) };
        });
    }
    function truncate(text, max) {
        var s = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
        return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
    }
    /** "Presupuesto: 2.000 USD → 1.800 USD · Tamaño: Mediano → Grande" */
    function summaryLine(proposal, max) {
        return truncate(diffRows(proposal).map(function (row) {
            return row.label + ': ' + truncate(row.from, 60) + ' → ' + truncate(row.to, 60);
        }).join(' · '), max || 400);
    }
    function partyLabel(role, viewerRole) {
        if (role === viewerRole) return 'Tú';
        return role === 'client' ? 'El cliente' : 'El artista';
    }

    /** Qué puede hacer quien mira con una propuesta. */
    function proposalActions(proposal, viewerRole) {
        var pending = !!proposal && proposal.status === 'pending';
        var mine = !!proposal && proposal.proposed_by === viewerRole;
        return {
            mine: mine,
            accept: pending && !mine,
            reject: pending && !mine,
            requote: pending && !mine && proposal.kind === 'counter' && viewerRole === 'artist',
            withdraw: pending && mine
        };
    }

    /**
     * Valida una resolución antes de ir a la base.
     * → { ok: true } | { ok: true, already: true } | { ok: false, status, code, error }
     */
    function evaluateResolve(opts) {
        var proposal = opts.proposal;
        var q = opts.quotation;
        var role = opts.role;
        var action = opts.action;
        if (['accept', 'reject', 'withdraw'].indexOf(action) === -1) return { ok: false, status: 400, code: 'action', error: 'Indica qué quieres hacer con la propuesta.' };
        if (!proposal || !q || String(proposal.quotation_id) !== String(q.id)) return { ok: false, status: 404, code: 'not_found', error: 'No encontramos esa propuesta.' };
        if (!role) return { ok: false, status: 403, code: 'not_party', error: 'Esta cotización no corresponde a tu cuenta.' };
        var mine = proposal.proposed_by === role;
        if (action === 'withdraw' && !mine) return { ok: false, status: 403, code: 'not_proposer', error: 'Solo quien hizo la propuesta puede retirarla.' };
        if (action !== 'withdraw' && mine) return { ok: false, status: 403, code: 'own_proposal', error: 'La otra parte tiene que responder tu propuesta.' };
        var done = { accept: 'accepted', reject: 'rejected', withdraw: 'withdrawn' }[action];
        if (proposal.status === done) return { ok: true, already: true };
        if (proposal.status !== 'pending') return { ok: false, status: 409, code: 'not_pending', error: 'Esta propuesta ya no está pendiente. Actualiza la página.' };
        if (action === 'accept') {
            if ((q.dispute_status || 'none') === 'open') return { ok: false, status: 409, code: 'dispute', error: 'Esta cotización tiene un reclamo abierto. Soporte lo está revisando.' };
            if (proposal.kind === 'counter' && q.quote_status !== 'responded') return { ok: false, status: 409, code: 'status', error: 'La cotización cambió de estado. Actualiza la página.' };
            if (proposal.kind === 'amendment' && !(isAgreed(q) && AMENDABLE_STATUSES.indexOf(q.quote_status) !== -1 && q.client_user_id && q.artist_id)) {
                return { ok: false, status: 409, code: 'status', error: 'El acuerdo ya no se puede modificar en este estado.' };
            }
        }
        return { ok: true };
    }

    /* ====================================================================
       2. HTML (todo dato se escapa)
       ==================================================================== */
    function idSafe(value) { return String(value == null ? '' : value).replace(/[^A-Za-z0-9_-]/g, ''); }

    function diffTableHtml(proposal) {
        var rows = diffRows(proposal);
        if (!rows.length) return '';
        return '<table class="wqn-diff"><caption class="wqn-sr">Cambios propuestos</caption>'
            + '<thead><tr><th scope="col">Dato</th><th scope="col">Antes</th><th scope="col">Después</th></tr></thead><tbody>'
            + rows.map(function (row) {
                return '<tr><th scope="row">' + esc(row.label) + '</th>'
                    + '<td class="wqn-from" data-label="Antes">' + esc(row.from) + '</td>'
                    + '<td class="wqn-to" data-label="Después">' + esc(row.to) + '</td></tr>';
            }).join('')
            + '</tbody></table>';
    }

    function pendingCopy(proposal, state) {
        var role = state.role;
        var mine = proposal.proposed_by === role;
        var names = state.names || {};
        var client = firstName(names.client, 'El cliente');
        var artist = firstName(names.artist, 'El artista');
        var when = dateLabel(proposal.created_at);
        if (proposal.kind === 'counter') {
            if (!mine) {
                return {
                    kicker: 'Contrapropuesta del cliente',
                    title: 'El cliente propone cambios',
                    copy: client + ' revisó tu propuesta y sugiere estos cambios.',
                    fine: 'Si aceptas, la cotización queda aprobada por ambas partes con estos cambios. Si haces otra propuesta, el pedido queda actualizado con lo que pidió el cliente y tu nuevo presupuesto reemplaza al anterior.'
                };
            }
            return {
                kicker: 'Tus cambios',
                title: 'Esperando la respuesta del artista',
                copy: 'Enviaste estos cambios' + (when ? ' el ' + when : '') + '. Te avisamos por email cuando ' + artist + ' responda.',
                fine: 'Mientras tanto, la propuesta del artista sigue disponible: todavía puedes aceptarla o rechazarla.'
            };
        }
        if (!mine) {
            return {
                kicker: 'Cambio al acuerdo',
                title: role === 'client' ? 'Tu artista propone cambiar el acuerdo' : 'Tu cliente propone cambiar el acuerdo',
                copy: (role === 'client' ? artist : client) + ' propone estos cambios. El acuerdo actual sigue vigente hasta que los apruebes.',
                fine: ''
            };
        }
        return {
            kicker: 'Cambio al acuerdo',
            title: role === 'client' ? 'Esperando la aprobación de tu artista' : 'Esperando la aprobación de tu cliente',
            copy: 'Propusiste estos cambios' + (when ? ' el ' + when : '') + '. El acuerdo actual sigue vigente hasta que ' + (role === 'client' ? artist : client) + ' los apruebe.',
            fine: ''
        };
    }

    function confirmHtml(proposal, state, ui) {
        var uid = idSafe(proposal.id);
        var back = '<button type="button" class="wo-btn wo-btn--ghost wo-btn--s" data-wqn-act="cancel-confirm">Volver</button>';
        if (ui.confirm === 'accept') {
            var text;
            if (proposal.kind === 'counter') {
                var budget = proposal.changes && proposal.changes.artist_budget_amount ? proposal.changes.artist_budget_amount.to : (state.current && state.current.counter ? state.current.counter.artist_budget_amount : '');
                text = 'Vas a aceptar los cambios. La cotización queda aprobada por ambas partes' + (hasValue(budget) ? ' por ' + money(budget, proposal.currency) : '') + '.';
            } else {
                text = 'Vas a aprobar los cambios. El acuerdo se actualiza de inmediato y el cambio queda en el historial.';
            }
            return '<p class="wqn-confirm-copy">' + esc(text) + '</p><div class="wqn-actions">'
                + '<button type="button" class="wo-btn wo-btn--accent wo-btn--s" data-wqn-act="confirm-accept">' + (proposal.kind === 'counter' ? 'Sí, aceptar cambios' : 'Sí, aprobar cambios') + '</button>'
                + back + '</div>';
        }
        if (ui.confirm === 'reject') {
            var counter = proposal.kind === 'counter';
            return '<p class="wqn-confirm-copy">' + esc(counter
                ? 'Tu propuesta original sigue en pie y le avisamos al cliente: podrá aceptarla, rechazarla o proponer otros cambios.'
                : 'El acuerdo queda como está y le avisamos a la otra parte.') + '</p>'
                + '<div class="wo-field"><label class="wo-label" for="wqn-reason-' + uid + '">' + (counter ? 'Mensaje para el cliente (opcional)' : 'Motivo (opcional)') + '</label>'
                + '<textarea class="wo-textarea wqn-textarea" id="wqn-reason-' + uid + '" data-wqn-reason maxlength="' + LIMITS.note + '" rows="2"></textarea></div>'
                + '<div class="wqn-actions">'
                + '<button type="button" class="wo-btn wo-btn--danger wo-btn--s" data-wqn-act="confirm-reject">' + (counter ? 'Mantener mi propuesta' : 'Rechazar cambios') + '</button>'
                + back + '</div>';
        }
        if (ui.confirm === 'withdraw') {
            return '<p class="wqn-confirm-copy">' + esc(proposal.kind === 'counter'
                ? 'Vas a retirar tus cambios. La propuesta del artista sigue disponible para aceptarla o rechazarla.'
                : 'Vas a retirar tu propuesta. El acuerdo queda como está.') + '</p><div class="wqn-actions">'
                + '<button type="button" class="wo-btn wo-btn--danger wo-btn--s" data-wqn-act="confirm-withdraw">Sí, retirar</button>'
                + back + '</div>';
        }
        return '';
    }

    function pendingHtml(proposal, state, ui) {
        var actions = proposalActions(proposal, state.role);
        var text = pendingCopy(proposal, state);
        var uid = idSafe(proposal.id);
        var noteLabel = proposal.proposed_by === state.role ? 'Tu mensaje'
            : proposal.proposed_by === 'client' ? 'Mensaje del cliente' : 'Mensaje del artista';
        var buttons = '';
        if (!ui.confirm) {
            if (actions.accept) buttons += '<button type="button" class="wo-btn wo-btn--accent wo-btn--s" data-wqn-act="accept">' + (proposal.kind === 'counter' ? 'Aceptar cambios' : 'Aprobar cambios') + '</button>';
            if (actions.requote) buttons += '<button type="button" class="wo-btn wo-btn--secondary wo-btn--s" data-wqn-act="requote">Hacer otra propuesta</button>';
            if (actions.reject) buttons += '<button type="button" class="wo-btn wo-btn--ghost wo-btn--s" data-wqn-act="reject">' + (proposal.kind === 'counter' ? 'Mantener mi propuesta' : 'Rechazar') + '</button>';
            if (actions.withdraw) buttons += '<button type="button" class="wo-btn wo-btn--ghost wo-btn--s" data-wqn-act="withdraw">' + (proposal.kind === 'counter' ? 'Retirar mis cambios' : 'Retirar propuesta') + '</button>';
        }
        return '<div class="wqn-card' + (actions.mine ? ' wqn-card--waiting' : ' wqn-card--action') + '" data-wqn-proposal="' + esc(proposal.id) + '" data-wqn-kind="' + esc(proposal.kind) + '">'
            + '<p class="wqn-kicker">' + esc(text.kicker) + '</p>'
            + '<h3 class="wqn-title" id="wqn-title-' + uid + '" tabindex="-1">' + esc(text.title) + '</h3>'
            + '<p class="wqn-copy">' + esc(text.copy) + '</p>'
            + diffTableHtml(proposal)
            + (hasValue(proposal.note) ? '<blockquote class="wqn-note"><span class="wqn-note-label">' + esc(noteLabel) + '</span>' + esc(proposal.note) + '</blockquote>' : '')
            + (text.fine && !ui.confirm ? '<p class="wqn-fine">' + esc(text.fine) + '</p>' : '')
            + (buttons ? '<div class="wqn-actions">' + buttons + '</div>' : '')
            + (ui.confirm ? '<div class="wqn-confirm">' + confirmHtml(proposal, state, ui) + '</div>' : '')
            + '<p class="wqn-feedback" role="status" aria-live="polite" data-wqn-feedback></p>'
            + '</div>';
    }

    // list: textos o { value, label }. La opción que coincide con lo guardado
    // conserva el valor guardado tal cual ("mediano", "Manga_completa"): dejarla
    // como está no es un cambio. Un valor fuera del catálogo queda como opción propia.
    function optionsHtml(list, selected) {
        var has = hasValue(selected);
        var matched = false;
        var html = list.map(function (o) {
            var value = typeof o === 'string' ? o : o.value;
            var label = typeof o === 'string' ? o : o.label;
            var isSelected = has && !matched && optionKey(value) === optionKey(selected);
            if (isSelected) matched = true;
            return '<option value="' + esc(isSelected ? String(selected) : value) + '"' + (isSelected ? ' selected' : '') + '>' + esc(label) + '</option>';
        }).join('');
        if (has && !matched) {
            html = '<option value="' + esc(selected) + '" selected>' + esc(String(selected).replace(/_/g, ' ')) + '</option>' + html;
        }
        return html;
    }
    function datalistHtml(id, list) {
        return '<datalist id="' + esc(id) + '">' + list.map(function (o) { return '<option value="' + esc(o) + '"></option>'; }).join('') + '</datalist>';
    }
    function fieldHtml(id, label, control, help, wide) {
        return '<div class="wo-field' + (wide ? ' wqn-wide' : '') + '"><label class="wo-label" for="' + esc(id) + '">' + esc(label) + '</label>' + control
            + (help ? '<small class="wqn-help" id="' + esc(id) + '-help">' + esc(help) + '</small>' : '') + '</div>';
    }

    function counterFormHtml(state) {
        var cur = (state.current && state.current.counter) || {};
        var currency = (state.currency && state.currency.counter) || '';
        var uid = idSafe(state.quote_id);
        var id = function (name) { return 'wqn-' + name + '-' + uid; };
        var budgetHelp = hasValue(cur.artist_budget_amount) ? 'Propuesta del artista: ' + money(cur.artist_budget_amount, currency) : '';
        return '<form class="wqn-form" data-wqn-form="counter" novalidate aria-labelledby="' + id('form-title') + '">'
            + '<p class="wqn-kicker">Modificar</p>'
            + '<h3 class="wqn-title" id="' + id('form-title') + '" tabindex="-1">Proponer cambios</h3>'
            + '<p class="wqn-copy">Cambia lo que necesites. El artista verá el antes y el después, y podrá aceptar tus cambios o enviarte otra propuesta.</p>'
            + '<div class="wqn-grid">'
            + fieldHtml(id('budget'), 'Presupuesto' + (currency ? ' (' + currency + ')' : ''),
                '<input class="wo-input" id="' + id('budget') + '" name="artist_budget_amount" inputmode="decimal" autocomplete="off" value="' + esc(cur.artist_budget_amount || '') + '"' + (budgetHelp ? ' aria-describedby="' + id('budget') + '-help"' : '') + '>', budgetHelp)
            + fieldHtml(id('zone'), 'Zona del cuerpo',
                '<input class="wo-input" id="' + id('zone') + '" name="tattoo_body_part" maxlength="' + LIMITS.tattoo_body_part[1] + '" list="' + id('zones') + '" value="' + esc(cur.tattoo_body_part || '') + '" aria-describedby="' + id('zone') + '-help">' + datalistHtml(id('zones'), BODY_OPTIONS),
                'Si cambias la zona, escribe también el lado (izquierdo, derecho o ambos).')
            + fieldHtml(id('size'), 'Tamaño',
                '<select class="wo-select" id="' + id('size') + '" name="tattoo_size">' + (hasValue(cur.tattoo_size) ? '' : '<option value="">Elige un tamaño</option>') + optionsHtml(SIZE_OPTIONS, cur.tattoo_size) + '</select>')
            + fieldHtml(id('style'), 'Estilo',
                '<input class="wo-input" id="' + id('style') + '" name="tattoo_style" list="' + id('styles') + '" value="' + esc((cur.tattoo_style || []).join(', ')) + '" aria-describedby="' + id('style') + '-help">' + datalistHtml(id('styles'), STYLE_OPTIONS),
                'Si los cambias, elige hasta ' + LIMITS.stylesMax + ' estilos separados por coma.')
            + fieldHtml(id('color'), 'Color',
                '<select class="wo-select" id="' + id('color') + '" name="tattoo_color_type">' + (hasValue(cur.tattoo_color_type) ? '' : '<option value="">Elige una opción</option>') + optionsHtml(COLOR_OPTIONS, cur.tattoo_color_type) + '</select>')
            + fieldHtml(id('idea'), 'Descripción de la idea',
                '<textarea class="wo-textarea wqn-textarea" id="' + id('idea') + '" name="tattoo_idea_description" rows="3" maxlength="' + LIMITS.tattoo_idea_description[1] + '">' + esc(cur.tattoo_idea_description || '') + '</textarea>', '', true)
            + fieldHtml(id('note'), 'Mensaje para el artista (opcional)',
                '<textarea class="wo-textarea wqn-textarea" id="' + id('note') + '" name="note" rows="2" maxlength="' + LIMITS.note + '" placeholder="Cuéntale por qué propones estos cambios."></textarea>', '', true)
            + '</div>'
            + '<p class="wqn-fine">Si el artista acepta tus cambios, la cotización queda aprobada con estas condiciones.</p>'
            + '<div class="wqn-actions">'
            + '<button type="submit" class="wo-btn wo-btn--accent wo-btn--s">Enviar cambios</button>'
            + '<button type="button" class="wo-btn wo-btn--ghost wo-btn--s" data-wqn-act="cancel-form">Volver</button>'
            + '</div>'
            + '<p class="wqn-feedback" role="alert" data-wqn-feedback></p>'
            + '</form>';
    }

    function amendFormHtml(state) {
        var cur = (state.current && state.current.amendment) || {};
        var currency = (state.currency && state.currency.amendment) || '';
        var limits = state.limits || {};
        var uid = idSafe(state.quote_id);
        var id = function (name) { return 'wqn-' + name + '-' + uid; };
        var other = state.role === 'client' ? 'tu artista' : 'tu cliente';
        var paidHelp = Number(limits.paid) > 0 ? 'Ya hay ' + money(limits.paid, currency) + ' registrados como pagados: el precio no puede ser menor.' : '';
        var sessionsHelp = Number(limits.sessions_used) > 0
            ? 'Ya hay ' + limits.sessions_used + (Number(limits.sessions_used) === 1 ? ' sesión agendada o realizada.' : ' sesiones agendadas o realizadas.') : '';
        return '<form class="wqn-form" data-wqn-form="amendment" novalidate aria-labelledby="' + id('form-title') + '">'
            + '<p class="wqn-kicker">Cambio al acuerdo</p>'
            + '<h3 class="wqn-title" id="' + id('form-title') + '" tabindex="-1">Proponer un cambio al acuerdo</h3>'
            + '<p class="wqn-copy">El cambio rige solo cuando ' + esc(other) + ' lo apruebe. Mientras tanto, el acuerdo actual sigue vigente.</p>'
            + '<div class="wqn-grid">'
            + fieldHtml(id('price'), 'Precio total' + (currency ? ' (' + currency + ')' : ''),
                '<input class="wo-input" id="' + id('price') + '" name="final_budget_amount" inputmode="decimal" autocomplete="off" value="' + esc(cur.final_budget_amount || '') + '"' + (paidHelp ? ' aria-describedby="' + id('price') + '-help"' : '') + '>', paidHelp)
            + fieldHtml(id('sessions'), 'Sesiones',
                '<input class="wo-input" id="' + id('sessions') + '" name="final_sessions" type="number" inputmode="numeric" min="' + Math.max(LIMITS.sessionsMin, Number(limits.sessions_used) || 0) + '" max="' + LIMITS.sessionsMax + '" step="1" value="' + esc(cur.final_sessions || '') + '"' + (sessionsHelp ? ' aria-describedby="' + id('sessions') + '-help"' : '') + '>', sessionsHelp)
            + fieldHtml(id('deposit'), 'Anticipo (%)',
                '<input class="wo-input" id="' + id('deposit') + '" name="artist_deposit_pct" inputmode="decimal" autocomplete="off" value="' + esc(cur.artist_deposit_pct == null ? '' : String(cur.artist_deposit_pct).replace('.', ',')) + '" placeholder="Sin anticipo" aria-describedby="' + id('deposit') + '-help">',
                'Porcentaje del precio total. Déjalo vacío si no hay anticipo.')
            + fieldHtml(id('terms'), 'Condiciones',
                '<textarea class="wo-textarea wqn-textarea" id="' + id('terms') + '" name="final_comment" rows="2" maxlength="' + LIMITS.final_comment + '">' + esc(cur.final_comment || '') + '</textarea>', '', true)
            + fieldHtml(id('note'), 'Motivo del cambio (opcional)',
                '<textarea class="wo-textarea wqn-textarea" id="' + id('note') + '" name="note" rows="2" maxlength="' + LIMITS.note + '" placeholder="Por ejemplo: sumamos una sesión para terminar el sombreado."></textarea>', '', true)
            + '</div>'
            + '<div class="wqn-actions">'
            + '<button type="submit" class="wo-btn wo-btn--accent wo-btn--s">Proponer cambio</button>'
            + '<button type="button" class="wo-btn wo-btn--ghost wo-btn--s" data-wqn-act="cancel-form">Volver</button>'
            + '</div>'
            + '<p class="wqn-feedback" role="alert" data-wqn-feedback></p>'
            + '</form>';
    }

    function historyHtml(state) {
        var list = (state.proposals || []).filter(function (p) { return p.status !== 'pending'; }).slice(0, 10);
        if (!list.length) return '';
        return '<details class="wqn-history"><summary>Historial de cambios (' + list.length + ')</summary><ol class="wqn-history-list">'
            + list.map(function (p) {
                var who = partyLabel(p.proposed_by, state.role);
                var verb = p.kind === 'counter' ? (who === 'Tú' ? 'propusiste cambios' : 'propuso cambios') : (who === 'Tú' ? 'propusiste cambiar el acuerdo' : 'propuso cambiar el acuerdo');
                return '<li class="wqn-history-item">'
                    + '<p class="wqn-history-head"><span class="wqn-chip wqn-chip--' + esc(p.status) + '">' + esc(PROPOSAL_STATUS[p.status] || p.status) + '</span>'
                    + '<span>' + esc([dateLabel(p.created_at), who + ' ' + verb].filter(Boolean).join(' · ')) + '</span></p>'
                    + '<p class="wqn-history-summary">' + esc(summaryLine(p, 320)) + '</p>'
                    + (hasValue(p.response_note) && (p.status === 'rejected' || p.status === 'accepted')
                        ? '<p class="wqn-history-note">' + esc('Respuesta: ' + truncate(p.response_note, 240)) + '</p>' : '')
                    + '</li>';
            }).join('')
            + '</ol></details>';
    }

    /**
     * Panel completo. state = respuesta de GET /api/negociacion/quotations/:id;
     * ui = { form: null|'counter'|'amendment', confirm: null|'accept'|'reject'|'withdraw',
     *        flash, flashTone: 'ok'|'warn' }.
     * Devuelve '' si no hay nada que mostrar.
     */
    function panelHtml(state, ui) {
        ui = ui || {};
        if (!state || state.available === false || !state.role) return '';
        var pending = state.pending || null;
        var agreement = state.agreement || {};
        var permissions = state.can || {};
        var parts = [];
        if (ui.flash) {
            parts.push(ui.flashTone === 'warn'
                ? '<p class="wqn-flash wqn-flash--warn" role="alert" tabindex="-1">' + esc(ui.flash) + '</p>'
                : '<p class="wqn-flash" role="status" tabindex="-1">' + esc(ui.flash) + '</p>');
        }
        if (ui.form === 'counter' && permissions.counter) {
            parts.push(counterFormHtml(state));
        } else if (ui.form === 'amendment' && permissions.amend) {
            parts.push(amendFormHtml(state));
        } else {
            if (pending) parts.push(pendingHtml(pending, state, ui));
            if (agreement.approved) {
                var line = 'Acuerdo aprobado por ambas partes' + (agreement.approved_at && dateLabel(agreement.approved_at) ? ' · ' + dateLabel(agreement.approved_at) : '')
                    + (agreement.version > 1 ? ' · versión ' + agreement.version : '');
                parts.push('<div class="wqn-agreement"><p class="wqn-agreement-line">' + esc(line) + '</p>'
                    + (permissions.amend
                        ? '<button type="button" class="wo-btn wo-btn--ghost wo-btn--s" data-wqn-act="open-amend">' + (pending ? 'Proponer otro cambio' : 'Proponer un cambio al acuerdo') + '</button>'
                        : '')
                    + '</div>');
                if (permissions.amend && !pending) {
                    parts.push('<p class="wqn-fine">¿Hay que sumar una sesión o ajustar el precio? Cualquiera de los dos puede proponerlo: el cambio rige cuando la otra parte lo aprueba.</p>');
                } else if (!permissions.amend && state.reason && AMENDABLE_STATUSES.indexOf(state.quote_status) !== -1) {
                    parts.push('<p class="wqn-fine">' + esc(state.reason) + '</p>');
                }
            }
        }
        var history = historyHtml(state);
        if (history) parts.push(history);
        if (!parts.length) return '';
        return '<section class="wqn" data-wqn-panel aria-label="Negociación de la cotización">' + parts.join('') + '</section>';
    }

    /* ====================================================================
       3. CONTROLADOR (solo navegador)
       ==================================================================== */
    var CSS_HREF = '/shared/css/quotation-negotiation.css?v=20261116-r2';
    var CHAT_CLOSED_NOTE = 'El cliente rechazó esta cotización: quedó finalizada y ya no puedes enviarle mensajes.';
    var API_PREFIX = '/api/negociacion/quotations/';
    var env = { root: null, doc: null };
    var instances = [];   // { el, quoteId, role, state, ui }
    var cache = {};       // quoteId|role → state
    var flashes = {};     // quoteId|role → { text, tone } que se muestra una vez
    var scanQueued = false;

    function keyOf(quoteId, role) { return String(quoteId) + '|' + String(role); }
    function basePath() {
        var w = env.root;
        if (w.WEOTZI_BASE_PATH) return String(w.WEOTZI_BASE_PATH).replace(/\/$/, '');
        var path = (w.location && w.location.pathname) || '';
        return path === '/beta' || path.indexOf('/beta/') === 0 ? '/beta' : '';
    }
    function isDemo() {
        var w = env.root;
        try {
            if (w.WoDemo && w.WoDemo.enabled) return true;
            if (w.WEOTZI_PREVIEW === true) return true;
            return !!(w.ConfigManager && w.ConfigManager.isDemoMode && w.ConfigManager.isDemoMode());
        } catch (e) { return false; }
    }
    async function accessToken() {
        var w = env.root;
        var client = (w.ConfigManager && typeof w.ConfigManager.getSupabaseClient === 'function' && w.ConfigManager.getSupabaseClient()) || w._supabase;
        if (!client || !client.auth) return null;
        var res = await client.auth.getSession();
        return res && res.data && res.data.session ? res.data.session.access_token : null;
    }
    async function request(method, path, payload) {
        var token = await accessToken();
        if (!token) {
            var noSession = new Error('Inicia sesión para continuar.');
            noSession.status = 401;
            throw noSession;
        }
        var headers = { Authorization: 'Bearer ' + token };
        if (payload !== undefined) headers['Content-Type'] = 'application/json';
        var res = await env.root.fetch(basePath() + path, { method: method, headers: headers, body: payload !== undefined ? JSON.stringify(payload) : undefined });
        var body = await res.json().catch(function () { return {}; });
        if (!res.ok || body.success === false) {
            var error = new Error(body.error || 'No pudimos completar la acción. Inténtalo de nuevo.');
            error.status = res.status;
            error.code = body.code || null;
            error.field = body.field || null;
            throw error;
        }
        return body;
    }
    // Capa de datos del dominio (WeotziData.Negotiation).
    var Repo = {
        state: function (quoteId, role) {
            return request('GET', API_PREFIX + encodeURIComponent(quoteId) + '?as=' + encodeURIComponent(role || ''));
        },
        propose: function (quoteId, role, kind, changes, note) {
            return request('POST', API_PREFIX + encodeURIComponent(quoteId) + '/proposals', { as: role, kind: kind, changes: changes, note: note || '' });
        },
        resolve: function (quoteId, role, proposalId, action, note) {
            return request('POST', API_PREFIX + encodeURIComponent(quoteId) + '/proposals/' + encodeURIComponent(proposalId) + '/' + encodeURIComponent(action), { as: role, note: note || '' });
        }
    };

    function injectCss() {
        var doc = env.doc;
        if (!doc.head || doc.querySelector('link[data-wqn-css]')) return;
        var link = doc.createElement('link');
        link.rel = 'stylesheet';
        link.href = basePath() + CSS_HREF;
        link.setAttribute('data-wqn-css', '');
        doc.head.appendChild(link);
    }

    function instanceOf(el) {
        for (var i = 0; i < instances.length; i += 1) if (instances[i].el === el) return instances[i];
        return null;
    }
    function pruneInstances() {
        instances = instances.filter(function (ctx) { return env.doc.contains(ctx.el); });
    }
    function findInstance(quoteId, role) {
        pruneInstances();
        for (var i = 0; i < instances.length; i += 1) {
            if (instances[i].quoteId === quoteId && (!role || instances[i].role === role)) return instances[i];
        }
        return null;
    }

    // Botón "Modificar" del bloque del cliente (client-quote-proposal.js): se
    // muestra solo cuando el servidor confirma que se puede contraproponer.
    function syncExternal(ctx) {
        var state = ctx.state;
        var allow = !!(state && state.available !== false && state.can && state.can.counter) && ctx.ui.form !== 'counter';
        var buttons = env.doc.querySelectorAll('[data-wqn-open="counter"]');
        for (var i = 0; i < buttons.length; i += 1) {
            if (buttons[i].getAttribute('data-quote-id') === ctx.quoteId) buttons[i].hidden = !allow;
        }
        // Con el formulario abierto, la fila Aceptar / Rechazar se oculta.
        var scope = ctx.el.closest ? ctx.el.closest('.cqp') : null;
        var decision = scope ? scope.querySelector('.cqp-decision') : null;
        if (decision) decision.hidden = ctx.ui.form === 'counter';
    }

    function render(ctx, focus) {
        var k = keyOf(ctx.quoteId, ctx.role);
        if (flashes[k]) { ctx.ui.flash = flashes[k].text; ctx.ui.flashTone = flashes[k].tone; delete flashes[k]; }
        var html = panelHtml(ctx.state, ctx.ui);
        ctx.el.innerHTML = html;
        ctx.el.hidden = !html;
        syncExternal(ctx);
        if (focus) {
            var target = ctx.el.querySelector(focus);
            if (target) { try { target.focus({ preventScroll: false }); } catch (e) { target.focus(); } }
        }
    }

    async function refresh(ctx) {
        var previous = ctx.state;
        try {
            var state = await Repo.state(ctx.quoteId, ctx.role);
            ctx.state = state;
            cache[keyOf(ctx.quoteId, ctx.role)] = state;
        } catch (error) {
            if (!previous) ctx.state = { available: false };
            if (error && error.status !== 401 && env.root.console) env.root.console.warn('[negociacion] estado:', error.message);
        }
        if (!env.doc.contains(ctx.el)) return;
        // No se pisa un formulario o una confirmación a medio completar.
        if (ctx.ui.form || ctx.ui.confirm) { syncExternal(ctx); return; }
        // Sin aviso local: cuando aparece una propuesta de la otra parte el panel
        // ya quedó repintado, y el toast, el sonido y el push los manda el servidor
        // (negotiation_counter_proposed / negotiation_amendment_proposed) según la
        // matriz de avisos. Un ping propio aquí los duplicaba.
        render(ctx);
    }

    function mountEl(el) {
        if (!el || el.getAttribute('data-wqn-ready') === '1') return;
        var quoteId = el.getAttribute('data-quote-id') || '';
        var role = el.getAttribute('data-role') === 'artist' ? 'artist' : 'client';
        if (!quoteId || isDemo()) { el.hidden = true; return; }
        el.setAttribute('data-wqn-ready', '1');
        pruneInstances();
        instances = instances.filter(function (other) { return other.el !== el; });
        var cached = cache[keyOf(quoteId, role)] || null;
        var status = el.getAttribute('data-status');
        if (cached && status && cached.quote_status !== status) cached = null;
        var ctx = { el: el, quoteId: quoteId, role: role, state: cached, ui: { form: null, confirm: null, flash: '' } };
        instances.push(ctx);
        if (ctx.state) render(ctx); else el.hidden = true;
        refresh(ctx);
    }
    function scan() {
        scanQueued = false;
        var nodes = env.doc.querySelectorAll('[data-wqn-mount]');
        for (var i = 0; i < nodes.length; i += 1) mountEl(nodes[i]);
    }
    function queueScan() {
        if (scanQueued) return;
        scanQueued = true;
        if (typeof env.root.requestAnimationFrame === 'function') env.root.requestAnimationFrame(scan);
        else env.root.setTimeout(scan, 16);
    }

    // Cotización rechazada por el cliente: la base ya no deja que el artista
    // escriba (policy chat_closed_after_client_rejection). Si el expediente
    // todavía muestra el redactor, se desactiva y se explica por qué.
    function closeRejectedChat(quote) {
        if (!quote || quote.quote_status !== 'client_rejected') return;
        var form = env.doc.getElementById('qd-compose');
        if (!form || form.getAttribute('data-wqn-closed') === '1') return;
        form.setAttribute('data-wqn-closed', '1');
        var controls = form.querySelectorAll('input, textarea, button');
        for (var i = 0; i < controls.length; i += 1) controls[i].disabled = true;
        var note = env.doc.createElement('p');
        note.className = 'wqn-fine wqn-chat-closed';
        note.textContent = CHAT_CLOSED_NOTE;
        if (form.parentNode) form.parentNode.insertBefore(note, form);
    }

    // Expediente del artista: el panel va debajo de la identidad del cliente.
    function onArtistDetailRendered(event) {
        var detail = (event && event.detail) || {};
        var quote = detail.quote;
        var host = env.doc.getElementById('quotation-detail-root');
        if (!host || !quote || !quote.quote_id || detail.readOnly) return;
        closeRejectedChat(quote);
        if (detail.stage === 'draft' || detail.stage === 'pending') return;
        var slot = env.doc.getElementById('qd-negotiation-slot');
        if (!slot) {
            slot = env.doc.createElement('div');
            slot.id = 'qd-negotiation-slot';
            slot.className = 'wqn-slot wqn-slot--artist';
            var anchor = env.doc.getElementById('qd-slot-hold-slot');
            if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(slot, anchor.nextSibling);
            else host.insertBefore(slot, host.children[1] || null);
        }
        slot.setAttribute('data-wqn-mount', '');
        slot.setAttribute('data-quote-id', String(quote.quote_id));
        slot.setAttribute('data-role', 'artist');
        slot.setAttribute('data-status', String(quote.quote_status || ''));
        slot.removeAttribute('data-wqn-ready');
        mountEl(slot);
    }

    function setFeedback(ctx, message, isError) {
        var el = ctx.el.querySelector('[data-wqn-feedback]');
        if (!el) return;
        el.textContent = message || '';
        el.classList.toggle('is-error', !!isError);
    }
    function setBusy(ctx, busy) {
        var controls = ctx.el.querySelectorAll('button, input, select, textarea');
        for (var i = 0; i < controls.length; i += 1) controls[i].disabled = !!busy;
        ctx.el.setAttribute('aria-busy', busy ? 'true' : 'false');
    }

    // Después de un cambio: estado fresco, aviso a los otros módulos y la
    // pantalla anfitriona vuelve a leer la cotización.
    async function afterChange(ctx, action, result, message) {
        ctx.ui = { form: null, confirm: null, flash: '' };
        flashes[keyOf(ctx.quoteId, ctx.role)] = { text: message, tone: 'ok' };
        try {
            ctx.state = await Repo.state(ctx.quoteId, ctx.role);
            cache[keyOf(ctx.quoteId, ctx.role)] = ctx.state;
        } catch (e) { /* se muestra lo que haya */ }
        try {
            env.doc.dispatchEvent(new env.root.CustomEvent('wo:negotiation-changed', {
                detail: { quoteId: ctx.quoteId, role: ctx.role, action: action, proposal: (result && result.proposal) || null, quote_status: (result && result.quote_status) || null }
            }));
        } catch (e) { /* módulos satélite opcionales */ }
        var w = env.root;
        try {
            if (ctx.role === 'artist' && typeof w.WoQuotationDetailReload === 'function') {
                await w.WoQuotationDetailReload();
                return;
            }
            if (ctx.role === 'client' && typeof w.loadQuotations === 'function') {
                await w.loadQuotations();
                if (typeof w.refreshOpenDetail === 'function') w.refreshOpenDetail(ctx.quoteId);
                if (!env.doc.contains(ctx.el)) return;
            }
        } catch (e) {
            if (w.console) w.console.warn('[negociacion] recarga:', e && e.message);
        }
        if (env.doc.contains(ctx.el)) render(ctx, '.wqn-flash');
    }

    function handleError(ctx, error) {
        setBusy(ctx, false);
        var message = (error && error.message) || 'No pudimos completar la acción. Inténtalo de nuevo.';
        if (error && (error.status === 409 || error.status === 404 || error.status === 410)) {
            // El estado cambió del otro lado: se muestra el real y el motivo.
            ctx.ui = { form: null, confirm: null, flash: '' };
            flashes[keyOf(ctx.quoteId, ctx.role)] = { text: message, tone: 'warn' };
            refresh(ctx);
            return;
        }
        setFeedback(ctx, message, true);
        if (error && error.field) {
            var input = ctx.el.querySelector('[name="' + String(error.field).replace(/[^a-z_]/g, '') + '"]');
            if (input) { try { input.focus(); } catch (e) { /* sin foco */ } }
        }
    }

    async function submitForm(ctx, form) {
        var kind = form.getAttribute('data-wqn-form') === 'amendment' ? 'amendment' : 'counter';
        var state = ctx.state || {};
        var current = (state.current && state.current[kind]) || {};
        var values = {};
        (kind === 'counter' ? COUNTER_FIELDS : AMENDMENT_FIELDS).forEach(function (name) {
            var control = form.elements[name];
            if (control) values[name] = control.value;
        });
        var input = formInput(values, kind, current);
        var limits = state.limits || {};
        var checked = normalizeChanges(kind, input, current, {
            paid: limits.paid, currency: state.currency && state.currency.amendment, sessionsUsed: limits.sessions_used
        });
        if (!checked.ok) {
            setFeedback(ctx, checked.error, true);
            var bad = checked.field && form.elements[checked.field];
            if (bad) { try { bad.focus(); } catch (e) { /* sin foco */ } }
            return;
        }
        var note = normalizeNote(form.elements.note ? form.elements.note.value : '');
        setBusy(ctx, true);
        setFeedback(ctx, 'Enviando…', false);
        try {
            var result = await Repo.propose(ctx.quoteId, ctx.role, kind, checked.changes, note);
            await afterChange(ctx, 'propose', result, kind === 'counter'
                ? 'Listo: enviamos tus cambios al artista. Te avisamos por email cuando responda.'
                : 'Listo: enviamos tu propuesta. El acuerdo cambia solo cuando la otra parte la apruebe.');
        } catch (error) {
            handleError(ctx, error);
        }
    }

    async function resolve(ctx, action) {
        var pending = ctx.state && ctx.state.pending;
        if (!pending) return;
        var reasonEl = ctx.el.querySelector('[data-wqn-reason]');
        var note = normalizeNote(reasonEl ? reasonEl.value : '');
        setBusy(ctx, true);
        setFeedback(ctx, 'Guardando…', false);
        try {
            var result = await Repo.resolve(ctx.quoteId, ctx.role, pending.id, action, note);
            var counter = pending.kind === 'counter';
            var message = action === 'accept'
                ? (counter ? 'Aceptaste los cambios: la cotización quedó aprobada por ambas partes.' : 'Aprobaste los cambios: el acuerdo quedó actualizado.')
                : action === 'reject'
                    ? (counter ? 'Mantuviste tu propuesta. Le avisamos al cliente.' : 'Rechazaste los cambios: el acuerdo sigue igual.')
                    : (counter ? 'Retiraste tus cambios. La propuesta del artista sigue disponible.' : 'Retiraste tu propuesta. El acuerdo sigue igual.');
            await afterChange(ctx, action, result, message);
        } catch (error) {
            handleError(ctx, error);
        }
    }

    function dialogCount() {
        return env.doc.querySelectorAll('dialog[open], [role="dialog"], [aria-modal="true"], #qd-dialog-root > *').length;
    }
    function detailUrl(quoteId) {
        return basePath() + '/my-quotations/detail?id=' + encodeURIComponent(quoteId);
    }
    /** Datos para precargar el diálogo de respuesta del artista. */
    function respondPrefill(state, proposal) {
        var changes = {};
        var raw = (proposal && proposal.changes) || {};
        Object.keys(raw).forEach(function (key) { changes[key] = raw[key] ? raw[key].to : null; });
        var current = (state && state.current && state.current.counter) || {};
        return {
            source: 'client_counter',
            proposalId: proposal ? proposal.id : null,
            amount: hasValue(changes.artist_budget_amount) ? changes.artist_budget_amount : (current.artist_budget_amount || ''),
            currency: (proposal && proposal.currency) || (state && state.currency && state.currency.counter) || '',
            note: (proposal && proposal.note) || '',
            changes: changes,
            summary: proposal ? summaryLine(proposal, 400) : ''
        };
    }
    // "Hacer otra propuesta": lo atiende el diálogo de respuesta del artista
    // (frente cot-respuesta). Si nadie escucha, se abre el expediente con el
    // diálogo de respuesta de siempre.
    function requote(ctx) {
        var pending = ctx.state && ctx.state.pending;
        var detail = { quoteId: ctx.quoteId, prefill: respondPrefill(ctx.state, pending), handled: false };
        var before = dialogCount();
        var proceed = true;
        try {
            proceed = env.doc.dispatchEvent(new env.root.CustomEvent('wo:quote-respond', { detail: detail, cancelable: true }));
        } catch (e) { proceed = true; }
        env.root.setTimeout(function () {
            if (!proceed || detail.handled || dialogCount() > before) return;
            env.root.location.assign(detailUrl(ctx.quoteId) + '&modal=responder');
        }, 450);
    }

    function openForm(ctx, kind) {
        ctx.ui = { form: kind, confirm: null, flash: '' };
        render(ctx, '.wqn-form .wqn-title');
        var form = ctx.el.querySelector('.wqn-form');
        if (form && form.scrollIntoView) { try { form.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) { form.scrollIntoView(); } }
    }

    function mountFor(target) {
        var inside = target.closest('[data-wqn-mount]');
        if (inside) return instanceOf(inside);
        var quoteId = target.getAttribute('data-quote-id');
        return quoteId ? findInstance(quoteId, target.getAttribute('data-role') || null) : null;
    }

    function onClick(event) {
        var target = event.target && event.target.closest ? event.target.closest('[data-wqn-act], [data-wqn-open]') : null;
        if (!target) return;
        var ctx = mountFor(target);
        if (!ctx) return;
        var act = target.getAttribute('data-wqn-act') || ('open-' + target.getAttribute('data-wqn-open'));
        if (act === 'open-counter') { if (ctx.state && ctx.state.can && ctx.state.can.counter) openForm(ctx, 'counter'); return; }
        if (act === 'open-amend' || act === 'open-amendment') { if (ctx.state && ctx.state.can && ctx.state.can.amend) openForm(ctx, 'amendment'); return; }
        if (act === 'cancel-form') { ctx.ui = { form: null, confirm: null, flash: '' }; render(ctx); focusOpener(ctx); return; }
        if (act === 'accept' || act === 'reject' || act === 'withdraw') {
            ctx.ui = { form: null, confirm: act, flash: '' };
            render(ctx, act === 'reject' ? '[data-wqn-reason]' : '.wqn-confirm button');
            return;
        }
        if (act === 'cancel-confirm') { ctx.ui = { form: null, confirm: null, flash: '' }; render(ctx, '.wqn-actions button'); return; }
        if (act === 'confirm-accept') { resolve(ctx, 'accept'); return; }
        if (act === 'confirm-reject') { resolve(ctx, 'reject'); return; }
        if (act === 'confirm-withdraw') { resolve(ctx, 'withdraw'); return; }
        if (act === 'requote') requote(ctx);
    }
    function focusOpener(ctx) {
        var opener = null;
        var buttons = env.doc.querySelectorAll('[data-wqn-open="counter"]');
        for (var i = 0; i < buttons.length; i += 1) if (buttons[i].getAttribute('data-quote-id') === ctx.quoteId && !buttons[i].hidden) opener = buttons[i];
        opener = opener || ctx.el.querySelector('[data-wqn-act="open-amend"]');
        if (opener) { try { opener.focus(); } catch (e) { /* sin foco */ } }
    }

    function onSubmit(event) {
        var form = event.target && event.target.closest ? event.target.closest('form[data-wqn-form]') : null;
        if (!form) return;
        event.preventDefault();
        var mount = form.closest('[data-wqn-mount]');
        var ctx = mount ? instanceOf(mount) : null;
        if (ctx) submitForm(ctx, form);
    }

    // "Edita el acuerdo" del expediente del artista: con el acuerdo aprobado
    // ya no se edita directo (la base lo bloquea); se propone el cambio.
    function onEditAgreementCapture(event) {
        var target = event.target && event.target.closest ? event.target.closest('[data-action="edit-agreement"]') : null;
        if (!target) return;
        var slot = env.doc.getElementById('qd-negotiation-slot');
        var ctx = slot ? instanceOf(slot) : null;
        if (!ctx || !ctx.state || ctx.state.available === false || !ctx.state.can || !ctx.state.can.amend) return;
        event.preventDefault();
        event.stopPropagation();
        openForm(ctx, 'amendment');
    }

    var lastVisibleRefresh = 0;
    function onVisible() {
        if (env.doc.visibilityState && env.doc.visibilityState !== 'visible') return;
        var now = Date.now();
        if (now - lastVisibleRefresh < 30000) return;
        lastVisibleRefresh = now;
        pruneInstances();
        instances.forEach(function (ctx) { refresh(ctx); });
    }

    function boot(root) {
        if (!root || !root.document || env.root) return;
        env.root = root;
        env.doc = root.document;
        root.WeotziData = root.WeotziData || {};
        root.WeotziData.Negotiation = Repo;
        var start = function () {
            injectCss();
            scan();
            if (root.MutationObserver && env.doc.body) {
                new root.MutationObserver(queueScan).observe(env.doc.body, { childList: true, subtree: true });
            }
        };
        env.doc.addEventListener('wo:quotation-detail-rendered', onArtistDetailRendered);
        env.doc.addEventListener('click', onEditAgreementCapture, true);
        env.doc.addEventListener('click', onClick);
        env.doc.addEventListener('submit', onSubmit);
        env.doc.addEventListener('visibilitychange', onVisible);
        if (root.addEventListener) root.addEventListener('focus', onVisible);
        if (env.doc.readyState === 'loading') env.doc.addEventListener('DOMContentLoaded', start);
        else start();
    }

    return {
        // modelo
        COUNTER_FIELDS: COUNTER_FIELDS,
        AMENDMENT_FIELDS: AMENDMENT_FIELDS,
        LABELS: LABELS,
        LIMITS: LIMITS,
        AGREED_STATUSES: AGREED_STATUSES,
        AMENDABLE_STATUSES: AMENDABLE_STATUSES,
        PROPOSAL_STATUS: PROPOSAL_STATUS,
        SIZE_OPTIONS: SIZE_OPTIONS,
        COLOR_OPTIONS: COLOR_OPTIONS,
        esc: esc,
        toNumber: toNumber,
        amountString: amountString,
        money: money,
        dateLabel: dateLabel,
        styleNames: styleNames,
        styleText: styleText,
        isWizardDraft: isWizardDraft,
        isExpired: isExpired,
        isAgreed: isAgreed,
        agreementOf: agreementOf,
        roleOf: roleOf,
        otherRole: otherRole,
        agreementCurrency: agreementCurrency,
        counterCurrency: counterCurrency,
        can: can,
        currentValues: currentValues,
        normalizeChanges: normalizeChanges,
        normalizeNote: normalizeNote,
        formInput: formInput,
        partyLabel: partyLabel,
        displayValue: displayValue,
        sizeLabel: sizeLabel,
        diffRows: diffRows,
        summaryLine: summaryLine,
        proposalActions: proposalActions,
        evaluateResolve: evaluateResolve,
        // html
        panelHtml: panelHtml,
        counterFormHtml: counterFormHtml,
        amendFormHtml: amendFormHtml,
        diffTableHtml: diffTableHtml,
        respondPrefill: respondPrefill,
        // navegador
        boot: boot
    };
}));
