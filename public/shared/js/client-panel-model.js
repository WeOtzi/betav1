/**
 * WE OTZI - Modelo del panel del cliente (ronda 2 · frente cliente-panel)
 * ----------------------------------------------------------------------
 * Única fuente de las etiquetas y reglas que comparten /client/dashboard,
 * /client/requests y /client/chats:
 *   - estado de una cotización: reutiliza el modelo existente
 *     (client-quote-proposal.js · WoClientQuoteProposal.statusOf) y le suma los
 *     estados de esta ronda leyendo campos SI EXISTEN (nunca depende de ellos):
 *       · "Cambios propuestos por ti / por el artista"  (contrapropuesta pendiente)
 *       · "Cambios al acuerdo pendientes de aprobar"
 *       · "Sesión por confirmar"
 *   - código corto de la cotización (quotations_db.short_code del frente
 *     cot-form) con respaldo al quote_id, y buscador por ese código,
 *   - estado de una solicitud del Job Board (incluye la contraoferta pendiente
 *     de job_board_counter_offers),
 *   - estados vacíos con sus acciones y accesos directos del panel.
 *
 * Contrato de lectura tolerante (el primero que exista gana):
 *   Contrapropuesta  ctx.counterBy ('client'|'artist'|null)
 *                    · ctx.counterOffers | q.counter_offers | q.quotation_counter_offers
 *                      [{ status: 'pendiente'|'pending', author_role: 'client'|'artist' }]
 *                    · q.pending_counter_by | q.counter_offer_by | q.counter_by
 *                      (+ q.counter_offer_status | q.counter_status si existe)
 *                    · q.quote_status = client_counter | artist_counter
 *   Acuerdo          ctx.agreementChangePending (+ ctx.agreementChangeBy)
 *                    · q.agreement_change_status | q.pending_agreement_status
 *                    · q.pending_agreement | q.pending_agreement_change (objeto o true)
 *                    · q.agreement_change_requested_at sin ..._decided_at
 *   Sesión           ctx.sessionToConfirm · ctx.sessions | ctx.sessionsByQuotationId[q.id]
 *                      (status proposed/pending_confirmation…, confirmation_status,
 *                       needs_confirmation, client_confirmed === false)
 *                    · q.session_confirmation_status | q.pending_session_confirmation
 *
 * Sin DOM ni red: lo usan las páginas y lo prueban los tests.
 * Expone window.WoClientPanel (o module.exports en Node).
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        var base = null;
        try { base = require('./client-quote-proposal.js'); } catch (e) { base = null; }
        module.exports = factory(function () { return base; });
        module.exports.create = factory;
    } else {
        root.WoClientPanel = factory(function () { return root.WoClientQuoteProposal || null; });
    }
}(typeof self !== 'undefined' ? self : this, function (getBase) {
    'use strict';

    // ------------------------------------------------------------------
    // Estados de cotización
    // ------------------------------------------------------------------
    // key → { label, tone, tag }. tone = clase de .quotation-status (dashboard:
    // la del estado base o cpn-info/-warning/-success/-neutral de client-panel.css);
    // tag = variante de .wo-tag del DS (chats / solicitudes).
    var STATUS = {
        draft: { label: 'Borrador sin enviar', tone: 'draft', tag: 'wo-tag--soft' },
        pending: { label: 'Esperando al artista', tone: 'pending', tag: 'wo-tag--soft' },
        responded: { label: 'Propuesta recibida', tone: 'responded', tag: 'wo-tag--highlight' },
        client_approved: { label: 'Aceptada', tone: 'client_approved', tag: 'wo-tag--active' },
        client_rejected: { label: 'Rechazada', tone: 'client_rejected', tag: 'wo-tag--archived' },
        in_progress: { label: 'En curso', tone: 'in_progress', tag: 'wo-tag--info' },
        artist_completed: { label: 'Por confirmar', tone: 'artist_completed', tag: 'wo-tag--info' },
        completed: { label: 'Completada', tone: 'completed', tag: 'wo-tag--active' },
        cancelled: { label: 'Cancelada', tone: 'cancelled', tag: 'wo-tag--archived' },
        expired: { label: 'Vencida', tone: 'expired', tag: 'wo-tag--archived' },
        unknown: { label: 'En revisión', tone: 'pending', tag: 'wo-tag--soft' }
    };

    // Estados nuevos de la ronda 2: se superponen al estado base mientras la
    // cotización sigue abierta. waitingOn = a quién le toca.
    var OVERLAYS = {
        counter_by_artist: {
            label: 'Cambios propuestos por el artista', tone: 'cpn-warning', tag: 'wo-tag--highlight',
            hint: 'Revisa los cambios y responde.', waitingOn: 'client'
        },
        counter_by_client: {
            label: 'Cambios propuestos por ti', tone: 'cpn-info', tag: 'wo-tag--info',
            hint: 'Esperando la respuesta del artista.', waitingOn: 'artist'
        },
        agreement_change: {
            label: 'Cambios al acuerdo pendientes de aprobar', tone: 'cpn-warning', tag: 'wo-tag--highlight',
            hint: 'El artista cambió el acuerdo. Revísalo y apruébalo.', waitingOn: 'client'
        },
        session_to_confirm: {
            label: 'Sesión por confirmar', tone: 'cpn-warning', tag: 'wo-tag--highlight',
            hint: 'Hay una sesión esperando confirmación.', waitingOn: 'client'
        }
    };

    var ACTIVE_KEYS = ['pending', 'responded', 'client_approved', 'in_progress', 'artist_completed'];
    // Con la cotización cerrada no queda nada por negociar ni confirmar.
    var CLOSED_KEYS = ['draft', 'client_rejected', 'completed', 'cancelled', 'expired'];

    var COUNTER_QUOTE_STATUS = {
        client_counter: 'client', counter_client: 'client', client_countered: 'client', counter_by_client: 'client',
        artist_counter: 'artist', counter_artist: 'artist', artist_countered: 'artist', counter_by_artist: 'artist'
    };
    var AGREEMENT_QUOTE_STATUS = ['agreement_change_pending', 'agreement_pending', 'pending_agreement_change'];
    var PENDING_WORDS = ['pending', 'pendiente', 'open', 'awaiting', 'proposed', 'requested', 'waiting',
        'pending_confirmation', 'por_confirmar', 'awaiting_confirmation', 'awaiting_client', 'awaiting_artist',
        'pending_client', 'pending_artist', 'tentative', 'unconfirmed'];
    var SESSION_DONE = ['cancelled', 'canceled', 'cancelada', 'completed', 'completada', 'no_show'];
    var SESSION_PENDING = ['proposed', 'pending', 'pending_confirmation', 'por_confirmar', 'awaiting_confirmation',
        'awaiting_client', 'tentative', 'unconfirmed', 'requested'];

    var CODE_FIELDS = ['short_code', 'quote_short_code', 'short_id', 'public_code'];
    var DAY_MS = 24 * 60 * 60 * 1000;

    // ------------------------------------------------------------------
    // Utilidades
    // ------------------------------------------------------------------
    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function hasValue(v) { return v != null && String(v).trim() !== ''; }
    function isObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
    function lower(v) { return String(v == null ? '' : v).trim().toLowerCase(); }

    // Texto comparable: minúsculas, sin tildes, espacios colapsados.
    function norm(value) {
        var s = String(value == null ? '' : value).toLowerCase();
        if (typeof s.normalize === 'function') s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
        return s.replace(/\s+/g, ' ').trim();
    }

    // Código comparable: solo letras y números ("#k7p-2qx" → "K7P2QX").
    function codeNorm(value) {
        return norm(value).replace(/[^a-z0-9]/g, '').toUpperCase();
    }

    // Primer campo definido (no undefined) de la lista; undefined si ninguno existe.
    function pick(obj, fields) {
        if (!obj) return undefined;
        for (var i = 0; i < fields.length; i++) {
            if (obj[fields[i]] !== undefined) return obj[fields[i]];
        }
        return undefined;
    }

    function firstArray() {
        for (var i = 0; i < arguments.length; i++) {
            if (Array.isArray(arguments[i])) return arguments[i];
        }
        return null;
    }

    function roleOf(value) {
        var v = lower(value);
        if (v === 'client' || v === 'cliente' || v === 'customer') return 'client';
        if (v === 'artist' || v === 'artista' || v === 'tattoo_artist') return 'artist';
        return null;
    }

    function isPending(value) {
        if (value === true) return true;
        return PENDING_WORDS.indexOf(lower(value)) !== -1;
    }

    function styleText(value) {
        var list = Array.isArray(value) ? value : [value];
        return list.map(function (s) {
            if (typeof s === 'string') return s.trim();
            if (!isObject(s)) return '';
            return [s.style_name, s.substyle_name].filter(function (x) { return typeof x === 'string' && x.trim(); }).join(' ');
        }).filter(Boolean).join(' ');
    }

    // ------------------------------------------------------------------
    // Código corto
    // ------------------------------------------------------------------
    function shortCode(q) {
        if (!q) return '';
        for (var i = 0; i < CODE_FIELDS.length; i++) {
            var v = q[CODE_FIELDS[i]];
            if (v == null) continue;
            var s = String(v).trim();
            if (s && s.length <= 16) return s;
        }
        return '';
    }

    function hasShortCode(q) { return shortCode(q) !== ''; }

    // Lo que se muestra como identificador: código corto o, si todavía no
    // existe, el quote_id de siempre.
    function quoteCode(q) {
        return shortCode(q) || String((q && q.quote_id) == null ? '' : q.quote_id).trim();
    }

    // ------------------------------------------------------------------
    // Estado base (modelo existente del panel)
    // ------------------------------------------------------------------
    function fallbackKey(q, now) {
        if (!q) return 'unknown';
        var s = q.quote_status;
        if (s === 'in_progress' && !q.artist_responded_at && !hasValue(q.artist_budget_amount) && !hasValue(q.final_budget_amount)) return 'draft';
        if (s === 'expired') return 'expired';
        if (s === 'responded' && q.quote_expires_at) {
            var at = Date.parse(q.quote_expires_at);
            if (isFinite(at) && at <= (now == null ? Date.now() : now)) return 'expired';
        }
        if (s === 'en_progreso') return 'in_progress';
        return STATUS[s] ? s : 'unknown';
    }

    function baseStatus(q, now) {
        var base = getBase();
        if (base && typeof base.statusOf === 'function') {
            var s = base.statusOf(q, now);
            if (s && s.key && hasValue(s.label)) return { key: s.key, label: s.label, tone: s.tone || s.key };
        }
        var key = fallbackKey(q, now);
        return { key: key, label: STATUS[key].label, tone: STATUS[key].tone };
    }

    // ------------------------------------------------------------------
    // Estados de la ronda 2 (lectura tolerante)
    // ------------------------------------------------------------------
    function counterBy(q, ctx) {
        if (ctx.counterBy !== undefined) return roleOf(ctx.counterBy);
        var offers = firstArray(ctx.counterOffers, q.counter_offers, q.quotation_counter_offers, q.counter_proposals);
        if (offers) {
            var pending = offers.filter(function (o) { return o && isPending(o.status); })
                .sort(function (a, b) { return Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0); })[0];
            return pending ? roleOf(pick(pending, ['author_role', 'proposed_by', 'author', 'created_by_role', 'by'])) : null;
        }
        var by = roleOf(pick(q, ['pending_counter_by', 'counter_offer_by', 'counter_by', 'counterproposal_by', 'counter_proposal_by', 'changes_proposed_by']));
        if (by) {
            var status = pick(q, ['counter_offer_status', 'counter_status', 'counterproposal_status', 'counter_proposal_status']);
            return status === undefined || status === null || isPending(status) ? by : null;
        }
        return COUNTER_QUOTE_STATUS[lower(q.quote_status)] || null;
    }

    function agreementChange(q, ctx) {
        if (ctx.agreementChangePending !== undefined) {
            return ctx.agreementChangePending ? { by: roleOf(ctx.agreementChangeBy) } : null;
        }
        var status = pick(q, ['agreement_change_status', 'pending_agreement_status', 'agreement_update_status']);
        var obj = pick(q, ['pending_agreement', 'pending_agreement_change', 'agreement_pending', 'agreement_change']);
        var requestedAt = pick(q, ['agreement_change_requested_at', 'agreement_pending_at']);
        var decidedAt = pick(q, ['agreement_change_decided_at', 'agreement_change_resolved_at']);
        var pending = false;
        if (status !== undefined && status !== null) pending = isPending(status);
        else if (obj !== undefined && obj !== null && obj !== false) pending = obj === true || (isObject(obj) && (obj.status == null || isPending(obj.status)));
        else if (hasValue(requestedAt)) pending = !hasValue(decidedAt);
        else pending = AGREEMENT_QUOTE_STATUS.indexOf(lower(q.quote_status)) !== -1;
        if (!pending) return null;
        var by = pick(q, ['agreement_change_by', 'agreement_changed_by', 'pending_agreement_by']);
        if (by === undefined && isObject(obj)) by = pick(obj, ['requested_by', 'author_role', 'by']);
        return { by: roleOf(by) };
    }

    function sessionNeedsConfirmation(s, now) {
        if (!s) return false;
        var status = lower(s.status);
        if (SESSION_DONE.indexOf(status) !== -1) return false;
        if (s.session_date) {
            var when = Date.parse(s.session_date);
            if (isFinite(when) && when < (now == null ? Date.now() : now) - DAY_MS) return false;
        }
        var conf = pick(s, ['confirmation_status', 'client_confirmation_status', 'confirm_status']);
        if (conf !== undefined && conf !== null) return isPending(conf);
        if (s.needs_confirmation === true || s.needs_client_confirmation === true || s.requires_confirmation === true) return true;
        if (s.client_confirmed === false || s.confirmed === false || s.is_confirmed === false) return true;
        return SESSION_PENDING.indexOf(status) !== -1;
    }

    function sessionToConfirm(q, ctx) {
        if (ctx.sessionToConfirm !== undefined) return !!ctx.sessionToConfirm;
        var sessions = firstArray(ctx.sessions, ctx.sessionsByQuotationId && q.id != null ? ctx.sessionsByQuotationId[q.id] : null, q.sessions, q.quotation_sessions);
        if (sessions && sessions.some(function (s) { return sessionNeedsConfirmation(s, ctx.now); })) return true;
        var status = pick(q, ['session_confirmation_status', 'pending_session_status']);
        if (status !== undefined && status !== null) return isPending(status);
        return q.pending_session_confirmation === true || q.session_pending_confirmation === true || q.session_to_confirm === true;
    }

    function flagsOf(q, ctx) {
        q = q || {};
        ctx = ctx || {};
        return {
            counterBy: counterBy(q, ctx),
            agreementChange: agreementChange(q, ctx),
            sessionToConfirm: sessionToConfirm(q, ctx)
        };
    }

    // Prioridad: primero lo que espera una respuesta del cliente.
    function overlayOf(flags) {
        if (flags.counterBy === 'artist') return { key: 'counter_by_artist' };
        if (flags.agreementChange && flags.agreementChange.by !== 'client') return { key: 'agreement_change' };
        if (flags.sessionToConfirm) return { key: 'session_to_confirm' };
        if (flags.counterBy === 'client') return { key: 'counter_by_client' };
        if (flags.agreementChange) {
            return { key: 'agreement_change', hint: 'Esperando que el artista apruebe tus cambios.', waitingOn: 'artist' };
        }
        return null;
    }

    /**
     * Estado visible de una cotización para el cliente.
     * key = estado BASE (lo usan los filtros y el resto del panel);
     * label/tone/tag = lo que se muestra (incluye los estados de la ronda 2).
     */
    function statusOf(q, ctx) {
        ctx = ctx || {};
        var base = baseStatus(q, ctx.now);
        var known = STATUS[base.key];
        var out = {
            key: base.key, label: base.label, tone: base.tone, tag: known ? known.tag : 'wo-tag--soft',
            overlay: null, baseLabel: base.label, hint: '', waitingOn: null
        };
        if (!q || CLOSED_KEYS.indexOf(base.key) !== -1) return out;
        var found = overlayOf(flagsOf(q, ctx));
        if (!found) return out;
        var spec = OVERLAYS[found.key];
        out.overlay = found.key;
        out.label = spec.label;
        out.tone = spec.tone;
        out.tag = spec.tag;
        out.hint = found.hint || spec.hint;
        out.waitingOn = found.waitingOn || spec.waitingOn;
        return out;
    }

    function matchesFilter(q, filter, ctx) {
        var now = ctx && ctx.now;
        var base = getBase();
        if (base && typeof base.matchesFilter === 'function') return base.matchesFilter(q, filter, now);
        var key = fallbackKey(q, now);
        if (key === 'draft') return false;
        if (!filter || filter === 'all') return true;
        if (filter === 'active') return ACTIVE_KEYS.indexOf(key) !== -1;
        return key === filter;
    }

    // ------------------------------------------------------------------
    // Buscador
    // ------------------------------------------------------------------
    function tokensMatch(haystack, term) {
        var hay = norm(haystack);
        return norm(term).split(' ').filter(Boolean).every(function (t) { return hay.indexOf(t) !== -1; });
    }

    function codeMatches(codes, term) {
        var wanted = codeNorm(term);
        if (wanted.length < 2) return false;
        return codes.some(function (c) { return codeNorm(c).indexOf(wanted) !== -1; });
    }

    function matchesSearch(q, term, ctx) {
        if (!norm(term)) return true;
        if (!q) return false;
        if (codeMatches([shortCode(q), q.quote_id], term)) return true;
        return tokensMatch([
            q.artist_name, q.artist_username, q.artist_studio_name, q.artist_current_city,
            q.tattoo_body_part, styleText(q.tattoo_style), q.tattoo_idea_description, statusOf(q, ctx).label
        ].filter(hasValue).join(' '), term);
    }

    function searchQuotations(list, term, ctx) {
        return (list || []).filter(function (q) { return matchesSearch(q, term, ctx); });
    }

    // ------------------------------------------------------------------
    // Solicitudes del Job Board
    // ------------------------------------------------------------------
    var REQUEST_STATUS = {
        draft: { label: 'Borrador', cls: 'wo-tag--soft', tone: 'cpn-neutral' },
        receiving: { label: 'Recibiendo postulaciones', cls: 'wo-tag--info', tone: 'cpn-info' },
        proposals: { label: 'Propuestas recibidas', cls: 'wo-tag--highlight', tone: 'cpn-warning' },
        counter_by_artist: { label: OVERLAYS.counter_by_artist.label, cls: 'wo-tag--highlight', tone: 'cpn-warning' },
        counter_by_client: { label: OVERLAYS.counter_by_client.label, cls: 'wo-tag--info', tone: 'cpn-info' },
        accepted: { label: 'Artista seleccionado', cls: 'wo-tag--active', tone: 'cpn-success' },
        closed: { label: 'Cerrada', cls: 'wo-tag--archived', tone: 'cpn-neutral' },
        expired: { label: 'Vencida', cls: 'wo-tag--archived', tone: 'cpn-neutral' }
    };

    function requestCode(req) {
        if (!req) return '';
        return String(req.display_code || req.request_code || '').trim();
    }

    function visibleApplications(req) {
        return ((req && req.job_board_applications) || []).filter(function (a) { return a && a.status !== 'withdrawn'; });
    }

    // Contraoferta pendiente de la solicitud: mira las postulaciones que siguen
    // en juego (la elegida si ya se eligió; si no, las activas).
    function requestCounterBy(req, ctx) {
        var offers = firstArray(ctx && ctx.pendingOffers, req && req.pending_counter_offers);
        if (!offers || !offers.length) return null;
        var apps = visibleApplications(req);
        var live = apps.filter(function (a) {
            return req.status === 'accepted'
                ? (a.id === req.accepted_application_id || a.status === 'accepted')
                : (a.status === 'pending' || a.status === 'viewed');
        }).map(function (a) { return a.id; });
        var pending = offers.filter(function (o) {
            return o && isPending(o.status == null ? 'pendiente' : o.status) && live.indexOf(o.application_id) !== -1;
        });
        if (pending.some(function (o) { return roleOf(o.author_role) === 'artist'; })) return 'artist';
        if (pending.some(function (o) { return roleOf(o.author_role) === 'client'; })) return 'client';
        return null;
    }

    function requestStatusOf(req, ctx) {
        var key;
        var status = req && req.status;
        if (status === 'draft') key = 'draft';
        else if (status === 'closed') key = 'closed';
        else if (status === 'expired') key = 'expired';
        else {
            var by = requestCounterBy(req, ctx);
            if (by === 'artist') key = 'counter_by_artist';
            else if (by === 'client') key = 'counter_by_client';
            else if (status === 'accepted') key = 'accepted';
            else key = visibleApplications(req).length ? 'proposals' : 'receiving';
        }
        var spec = REQUEST_STATUS[key];
        return { key: key, label: spec.label, cls: spec.cls, tone: spec.tone, negotiating: key === 'counter_by_artist' || key === 'counter_by_client' };
    }

    function requestMatchesSearch(req, term, ctx) {
        if (!norm(term)) return true;
        if (!req) return false;
        if (codeMatches([req.display_code, req.request_code], term)) return true;
        return tokensMatch([
            req.display_title, req.tattoo_idea_description, styleText(req.tattoo_style), req.tattoo_body_part,
            req.client_city, requestStatusOf(req, ctx).label
        ].filter(hasValue).join(' '), term);
    }

    function searchRequests(list, term, ctxFor) {
        return (list || []).filter(function (req) {
            return requestMatchesSearch(req, term, typeof ctxFor === 'function' ? ctxFor(req) : ctxFor);
        });
    }

    // ------------------------------------------------------------------
    // Accesos directos y estados vacíos
    // ------------------------------------------------------------------
    var LINKS = {
        quote: { key: 'quote', label: 'Solicitar cotización', href: '/quotation', icon: 'edit-3' },
        idea: { key: 'idea', label: 'Publicar una idea', href: '/job-board/request', icon: 'radio' },
        explore: { key: 'explore', label: 'Explorar artistas', href: '/marketplace', icon: 'compass' },
        favorites: { key: 'favorites', label: 'Mis favoritos', href: '/client/favorites', icon: 'heart' },
        messages: { key: 'messages', label: 'Mensajes', href: '/client/chats/', icon: 'message-circle' }
    };

    var SHORTCUT_KEYS = ['quote', 'idea', 'explore', 'favorites', 'messages'];

    function shortcuts() {
        return SHORTCUT_KEYS.map(function (key) { return Object.assign({}, LINKS[key]); });
    }

    function action(key, primary) {
        return Object.assign({ primary: !!primary }, LINKS[key]);
    }

    /**
     * Estado vacío con su llamada a la acción.
     * kind: quotations | quotations-filter | quotations-search | requests | requests-search
     */
    function emptyState(kind, opts) {
        opts = opts || {};
        var term = String(opts.term || '').trim();
        if (kind === 'quotations-search') {
            return {
                icon: 'search', title: 'No encontramos cotizaciones para «' + term + '»',
                copy: 'Revisa el código o busca por el nombre del artista, el estilo o la zona.',
                actions: [{ key: 'clear-search', label: 'Limpiar búsqueda', action: 'clear-search', primary: true }]
            };
        }
        if (kind === 'quotations-filter') {
            return {
                icon: 'filter', title: 'No tienes cotizaciones en este estado',
                copy: 'Prueba con otro filtro o revisa todas tus cotizaciones.',
                actions: [{ key: 'show-all', label: 'Ver todas', action: 'show-all', primary: true }, action('quote')]
            };
        }
        if (kind === 'requests-search') {
            return {
                icon: 'search', title: 'No encontramos solicitudes para «' + term + '»',
                copy: 'Revisa el código o busca por la idea, el estilo o la zona.',
                actions: [{ key: 'clear-search', label: 'Limpiar búsqueda', action: 'clear-search', primary: true }]
            };
        }
        if (kind === 'requests') {
            return {
                icon: 'radio', title: 'Todavía no publicaste ninguna idea',
                copy: 'Cuenta qué tatuaje quieres hacerte y recibe propuestas de artistas interesados.',
                actions: [action('idea', true), action('explore'), action('quote')]
            };
        }
        return {
            icon: 'file-text', title: 'Todavía no tienes cotizaciones',
            copy: 'Cuéntale tu idea a un artista y recibe un presupuesto, o publícala para que los artistas te escriban.',
            actions: [action('quote', true), action('explore'), action('idea')]
        };
    }

    /**
     * HTML (siempre escapado) de un estado vacío.
     * opts.variant: 'dashboard' (.empty-state + h3) | 'ds' (.wo-empty + .wo-empty-title).
     */
    function emptyHtml(spec, opts) {
        opts = opts || {};
        var ds = opts.variant === 'ds';
        var parts = ['<div class="' + (ds ? 'wo-empty' : 'empty-state') + ' cpn-empty">',
            '<i data-wo-icon="' + esc(spec.icon) + '" aria-hidden="true"></i>',
            ds ? '<span class="wo-empty-title">' + esc(spec.title) + '</span>' : '<h3>' + esc(spec.title) + '</h3>',
            '<p>' + esc(spec.copy) + '</p>'];
        var actions = (spec.actions || []).map(function (a) {
            var cls = 'wo-btn wo-btn--hard ' + (a.primary ? 'wo-btn--accent' : 'wo-btn--ghost');
            if (a.action) return '<button type="button" class="' + cls + '" data-cpn-action="' + esc(a.action) + '">' + esc(a.label) + '</button>';
            return '<a class="' + cls + '" href="' + esc(a.href) + '">' + esc(a.label) + '</a>';
        });
        if (actions.length) parts.push('<div class="cpn-empty-actions">' + actions.join('') + '</div>');
        parts.push('</div>');
        return parts.join('');
    }

    return {
        STATUS: STATUS,
        OVERLAYS: OVERLAYS,
        ACTIVE_KEYS: ACTIVE_KEYS,
        CLOSED_KEYS: CLOSED_KEYS,
        REQUEST_STATUS: REQUEST_STATUS,
        LINKS: LINKS,
        esc: esc,
        norm: norm,
        codeNorm: codeNorm,
        shortCode: shortCode,
        hasShortCode: hasShortCode,
        quoteCode: quoteCode,
        flagsOf: flagsOf,
        statusOf: statusOf,
        matchesFilter: matchesFilter,
        matchesSearch: matchesSearch,
        searchQuotations: searchQuotations,
        requestCode: requestCode,
        requestStatusOf: requestStatusOf,
        requestMatchesSearch: requestMatchesSearch,
        searchRequests: searchRequests,
        shortcuts: shortcuts,
        emptyState: emptyState,
        emptyHtml: emptyHtml
    };
}));
