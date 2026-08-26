/**
 * WE OTZI - Mis solicitudes del cliente (/client/requests)
 * --------------------------------------------------------
 * Vista dedicada del job board del lado cliente (Figma 286:14417, 299:16500,
 * 307:18253, 307:18543, 307:17015). SPA por query params:
 *   /client/requests                      -> indice "Mis solicitudes"
 *   ?id=<request>                         -> detalle (vista segun estado)
 *   ?id=<request>&view=preview            -> "Asi ven tu publicacion"
 *   ?id=<request>&view=postulaciones      -> listado de artistas interesados
 *   ?id=<request>&view=postulacion&app=X  -> detalle de una postulacion
 *   ?id=<request>&view=elegido            -> confirmacion de seleccion
 *   ?id=<request>&view=seguimiento[&app=X]-> seguimiento + negociacion
 *
 * Datos SOLO via window.WeotziData.* (jobboard-repo, artists-repo,
 * clients-repo). El accept de una postulacion va por POST
 * /api/job-board/accept-application con Bearer del access_token.
 */
(function () {
    'use strict';

    // ===================== Estado =====================
    let userId = null;
    let requests = null;          // cache de Requests.listForClient
    let artistsMap = {};          // artist_user_id -> fila de artists_db
    let rtChannel = null;         // canal realtime de la solicitud abierta
    let rtRequestId = null;
    const compareSel = new Set(); // ids de postulaciones a comparar
    let compareRequestId = null;
    let pendingAction = null;     // callback armado por los modales de confirmacion
    let coApplicationId = null;   // postulacion destino de "Solicitar cambios"

    const root = document.getElementById('crq-root');

    const STEPS = ['Borrador', 'Publicada', 'Postulaciones', 'Selección', 'Reserva confirmada'];

    // ===================== Helpers =====================
    function esc(v) {
        return String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function money(v, currency) {
        if (v == null || v === '') return null;
        const n = parseFloat(v);
        if (isNaN(n)) return esc(v);
        const s = '$' + new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(n);
        return currency && currency !== 'USD' ? s + ' ' + esc(currency) : s;
    }

    function budgetRange(req) {
        const min = money(req.client_budget_min);
        const max = money(req.client_budget_max, req.client_budget_currency);
        if (min && max) return min + ' – ' + max;
        return max || min || 'Sin definir';
    }

    function fmtShort(iso) {
        if (!iso) return '—';
        const d = new Date(iso);
        if (isNaN(d)) return '—';
        return new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
    }

    function fmtLong(iso) {
        if (!iso) return '—';
        const d = new Date(iso);
        if (isNaN(d)) return '—';
        return new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'long', year: 'numeric' }).format(d);
    }

    function daysActive(req) {
        const from = new Date(req.created_at);
        if (isNaN(from)) return 0;
        return Math.max(1, Math.ceil((Date.now() - from.getTime()) / 86400000));
    }

    function parseList(v) {
        if (!v) return [];
        if (Array.isArray(v)) return v.filter(Boolean).map(String);
        if (typeof v === 'string') {
            const s = v.trim();
            if (s.startsWith('[')) {
                try {
                    const p = JSON.parse(s);
                    return Array.isArray(p) ? p.filter(Boolean).map(String) : [s];
                } catch (e) { return [s]; }
            }
            return s ? [s] : [];
        }
        return [String(v)];
    }

    function styleLabel(req) {
        return parseList(req.tattoo_style).join(' · ');
    }

    function colorLabel(v) {
        if (!v) return null;
        const map = {
            color: 'Color', full_color: 'Color',
            black_and_grey: 'Blanco y negro', 'black-and-grey': 'Blanco y negro',
            blackandgrey: 'Blanco y negro', bw: 'Blanco y negro', bn: 'Blanco y negro',
        };
        return map[String(v).toLowerCase()] || String(v);
    }

    // Titulo derivado en render (descripcion + estilo + zona), sin columna nueva.
    function deriveTitle(req) {
        const desc = (req.tattoo_idea_description || '').trim();
        if (desc) {
            let first = desc.split(/[.\n]/)[0].trim();
            if (first.length > 64) first = first.slice(0, 64).trim() + '…';
            if (first) return first;
        }
        const bits = ['Tatuaje', parseList(req.tattoo_style)[0], req.tattoo_body_part ? 'en ' + String(req.tattoo_body_part).toLowerCase() : ''].filter(Boolean);
        return bits.length > 1 ? bits.join(' ') : 'Idea de tatuaje';
    }

    function truncate(s, n) {
        const t = String(s || '').trim();
        return t.length > n ? esc(t.slice(0, n).trim()) + '…' : esc(t);
    }

    function viewCount(req) {
        const s = req.job_board_request_stats;
        if (!s) return 0;
        if (Array.isArray(s)) return (s[0] && s[0].view_count) || 0;
        return s.view_count || 0;
    }

    // Postulaciones visibles para el cliente (las retiradas no se muestran).
    // Orden: elegida primero, luego activas por llegada, rechazadas al final.
    function visibleApps(req) {
        const rank = { accepted: 0, pending: 1, viewed: 1, rejected: 2 };
        return (req.job_board_applications || [])
            .filter((a) => a.status !== 'withdrawn')
            .slice()
            .sort((a, b) => {
                const r = (rank[a.status] ?? 1) - (rank[b.status] ?? 1);
                if (r !== 0) return r;
                return new Date(a.created_at || 0) - new Date(b.created_at || 0);
            });
    }
    function activeApps(req) {
        return (req.job_board_applications || []).filter((a) => a.status === 'pending' || a.status === 'viewed');
    }
    function isOpen(req) {
        return req.status === 'open' || req.status === 'in_review';
    }

    function stateTag(req) {
        if (req.status === 'closed') return { label: 'Cerrada', cls: 'wo-tag--archived' };
        if (req.status === 'accepted') return { label: 'Artista seleccionado', cls: 'wo-tag--active' };
        if (visibleApps(req).length > 0) return { label: 'Propuestas recibidas', cls: 'wo-tag--highlight' };
        return { label: 'Recibiendo postulaciones', cls: 'wo-tag--info' };
    }

    function artistOf(app) {
        return artistsMap[app.artist_id] || {};
    }

    function artistName(app) {
        const a = artistOf(app);
        return a.name || a.username || 'Artista';
    }

    function initials(name) {
        return String(name || 'A').trim().split(/\s+/).slice(0, 2).map((w) => w.charAt(0)).join('') || 'A';
    }

    function avatarHtml(app, extraCls) {
        const a = artistOf(app);
        const name = artistName(app);
        const inner = a.profile_picture
            ? '<img src="' + esc(a.profile_picture) + '" alt="">'
            : esc(initials(name));
        return '<span class="crq-avatar ' + (extraCls || '') + (a.profile_picture ? '' : ' crq-avatar--accent') + '" aria-hidden="true">' + inner + '</span>';
    }

    function artistMetaLine(app) {
        const a = artistOf(app);
        const bits = [];
        if (a.city || a.ubicacion) bits.push(a.city || a.ubicacion);
        const styles = Array.isArray(a.styles_array) ? a.styles_array.slice(0, 2).join(' · ') : '';
        if (styles) bits.push(styles);
        if (app.availability_note) bits.push(app.availability_note);
        return bits.map(esc).join(' · ');
    }

    function sessionsLabel(v) {
        if (v == null || v === '') return '—';
        const n = parseInt(v, 10);
        if (!isNaN(n) && String(n) === String(v).trim()) return n === 1 ? '1 sesión' : n + ' sesiones';
        return esc(v);
    }

    function pendingCO(offers, role) {
        return (offers || []).find((o) => o.status === 'pendiente' && (!role || o.author_role === role)) || null;
    }
    function acceptedCO(offers) {
        return (offers || []).find((o) => o.status === 'aceptada') || null;
    }

    // Precio/fecha vigentes de una postulacion (contraoferta aceptada > original).
    function agreedTerms(app, offers) {
        const acc = acceptedCO(offers);
        return {
            price: acc && acc.price != null ? money(acc.price, acc.currency) : money(app.estimated_price, null),
            date: (acc && acc.proposed_date) || app.availability_note || '—',
        };
    }

    // ===================== Notices =====================
    function notice(kind, text) {
        const box = document.getElementById('crq-notices');
        if (!box) return;
        const el = document.createElement('div');
        el.className = 'wo-alert wo-alert--' + kind;
        el.textContent = text;
        box.appendChild(el);
        setTimeout(() => { el.remove(); }, 7000);
    }

    // ===================== Modales =====================
    function openModal(id) {
        const m = document.getElementById(id);
        if (m) m.classList.remove('wo-hidden');
    }
    function closeModal(id) {
        const m = document.getElementById(id);
        if (m) m.classList.add('wo-hidden');
    }
    document.addEventListener('click', (e) => {
        const closer = e.target.closest('[data-close-modal]');
        if (closer) { closeModal(closer.getAttribute('data-close-modal')); return; }
        if (e.target.classList && e.target.classList.contains('wo-overlay')) {
            e.target.classList.add('wo-hidden');
        }
    });

    // ===================== Navegación SPA =====================
    function go(qs) {
        history.pushState(null, '', qs || location.pathname);
        route();
    }

    document.addEventListener('click', (e) => {
        const a = e.target.closest('[data-go]');
        if (!a) return;
        e.preventDefault();
        go(a.getAttribute('data-go'));
    });

    window.addEventListener('popstate', route);

    function goLink(qs, cls, inner, attrs) {
        return '<a class="' + cls + '" href="' + esc(qs || location.pathname) + '" data-go="' + esc(qs || '') + '"' + (attrs || '') + '>' + inner + '</a>';
    }

    // ===================== Init =====================
    document.addEventListener('DOMContentLoaded', init);

    // ConfigManager carga app-config.json async: al DOMContentLoaded el cliente
    // puede no existir todavia. Reintento corto antes de rendirme.
    async function resolveClient() {
        for (let i = 0; i < 20; i++) {
            const c = (window.WeotziData && window.WeotziData.getClient())
                || (window.ConfigManager && typeof window.ConfigManager.getSupabaseClient === 'function'
                    && window.ConfigManager.getSupabaseClient());
            if (c) return c;
            await new Promise((r) => setTimeout(r, 150));
        }
        return null;
    }

    async function init() {
        const client = await resolveClient();
        if (!client) {
            root.innerHTML = emptyBlock('alert-triangle', 'No pudimos cargar tus solicitudes', 'Recargá la página en unos segundos.');
            return;
        }

        try {
            const { data: { session } } = await client.auth.getSession();
            if (!session) { window.location.href = '/client/login'; return; }
            userId = session.user.id;

            // Un artista logueado no tiene vista de cliente: lo mandamos a su panel.
            const { data: clientRow } = await WeotziData.Clients.getByUserId(userId, 'user_id');
            if (!clientRow) {
                const { data: artistRow } = await WeotziData.Artists.getByUserId(userId, 'user_id');
                if (artistRow) { window.location.href = '/artist/dashboard'; return; }
            }
        } catch (err) {
            console.error('[client-requests] auth:', err);
            window.location.href = '/client/login';
            return;
        }

        document.getElementById('crq-logout').addEventListener('click', async () => {
            try { await window.WeotziData.getClient().auth.signOut(); } catch (e) { /* noop */ }
            window.location.href = '/client/login';
        });

        wireCompareBar();
        wireModals();

        await loadRequests();
        route();
    }

    async function loadRequests() {
        try {
            requests = await WeotziData.JobBoard.Requests.listForClient(userId);
        } catch (err) {
            console.error('[client-requests] listForClient:', err);
            requests = [];
            notice('error', 'No pudimos cargar tus solicitudes. Probá recargar la página.');
        }
        await enrichArtists();
    }

    async function enrichArtists() {
        const ids = new Set();
        (requests || []).forEach((r) => {
            (r.job_board_applications || []).forEach((a) => { if (a.artist_id) ids.add(a.artist_id); });
            if (r.accepted_artist_id) ids.add(r.accepted_artist_id);
        });
        const missing = Array.from(ids).filter((id) => !artistsMap[id]);
        if (!missing.length) return;
        try {
            const { data } = await WeotziData.Artists.listByUserIds(
                missing,
                'user_id, username, name, profile_picture, city, country, ubicacion, styles_array, estudios, gallery_images'
            );
            (data || []).forEach((a) => { artistsMap[a.user_id] = a; });
        } catch (err) {
            console.warn('[client-requests] enrichArtists:', err && err.message);
        }
    }

    async function reloadRequest(id) {
        try {
            const fresh = await WeotziData.JobBoard.Requests.getById(id);
            if (fresh) {
                const i = (requests || []).findIndex((r) => r.id === id);
                if (i >= 0) requests[i] = fresh; else (requests = requests || []).unshift(fresh);
            }
            await enrichArtists();
            return fresh;
        } catch (err) {
            console.error('[client-requests] reloadRequest:', err);
            return null;
        }
    }

    // ===================== Realtime =====================
    function ensureRealtime(req) {
        if (!req || !isOpen(req)) { teardownRealtime(); return; }
        if (rtRequestId === req.id && rtChannel) return;
        teardownRealtime();
        try {
            rtChannel = WeotziData.JobBoard.Realtime.subscribeApplicationsForRequest(
                'crq-apps-' + req.id,
                req.id,
                async () => {
                    await reloadRequest(req.id);
                    notice('info', 'Recibiste una postulación nueva.');
                    route();
                }
            );
            rtRequestId = req.id;
        } catch (err) {
            console.warn('[client-requests] realtime:', err && err.message);
        }
    }

    function teardownRealtime() {
        if (rtChannel) {
            try { WeotziData.removeChannel(rtChannel); } catch (e) { /* noop */ }
        }
        rtChannel = null;
        rtRequestId = null;
    }

    // ===================== Router =====================
    function currentParams() {
        const p = new URLSearchParams(location.search);
        return { id: p.get('id'), view: p.get('view'), app: p.get('app') };
    }

    function defaultView(req) {
        if (req.status === 'accepted') return 'seguimiento';
        return 'detalle';
    }

    async function route() {
        if (!requests) return; // aun cargando
        const { id, view, app } = currentParams();

        if (!id) {
            teardownRealtime();
            renderIndex();
            updateCompareBar(null);
            window.scrollTo(0, 0);
            return;
        }

        let req = requests.find((r) => r.id === id);
        if (!req) req = await reloadRequest(id);
        if (!req) {
            teardownRealtime();
            root.innerHTML = emptyBlock('search', 'No encontramos esa solicitud', 'Puede que ya no exista o que pertenezca a otra cuenta.')
                + '<div class="crq-card-actions">' + goLink(location.pathname, 'wo-btn wo-btn--secondary', 'Volver a mis solicitudes') + '</div>';
            return;
        }

        if (compareRequestId !== req.id) {
            compareSel.clear();
            compareRequestId = req.id;
            updateCompareBar(req);
        }

        ensureRealtime(req);

        const v = view || defaultView(req);
        if (v === 'preview') renderPreview(req);
        else if (v === 'postulaciones') renderApplications(req);
        else if (v === 'postulacion') renderApplicationDetail(req, app);
        else if (v === 'elegido') await renderChosen(req);
        else if (v === 'seguimiento') await renderFollowUp(req, app);
        else renderPublished(req);
        if (v !== 'postulaciones') updateCompareBar(req);
        window.scrollTo(0, 0);
    }

    // ===================== Piezas compartidas =====================
    function emptyBlock(icon, title, copy, ctaHtml) {
        return '<div class="wo-empty">'
            + '<i data-wo-icon="' + icon + '" aria-hidden="true"></i>'
            + '<span class="wo-empty-title">' + esc(title) + '</span>'
            + '<p>' + esc(copy) + '</p>'
            + (ctaHtml || '')
            + '</div>';
    }

    function stepperHtml(current, closed) {
        let html = '<div class="wo-stepper crq-stepper" aria-label="Progreso de la solicitud">';
        STEPS.forEach((label, i) => {
            const n = i + 1;
            if (i > 0) {
                html += '<span class="wo-step-line' + (n <= current ? ' is-done' : '') + '" aria-hidden="true"></span>';
            }
            const state = n < current ? ' is-done' : n === current && !closed ? ' is-active' : '';
            const dot = n < current ? '<i data-wo-icon="check" aria-hidden="true"></i>' : String(n);
            html += '<span class="wo-step' + state + '"><span class="dot">' + dot + '</span>' + esc(label) + '</span>';
        });
        html += '</div>';
        return html;
    }

    function shellHtml(req, opts) {
        const tag = stateTag(req);
        const back = opts.back || { qs: location.pathname, label: 'Volver a mis solicitudes' };
        return '<div class="crq-util">'
            + goLink(back.qs, 'wo-meta crq-back', '← ' + esc(back.label))
            + '<span class="wo-tag ' + tag.cls + '">' + esc(tag.label) + '</span>'
            + '</div>'
            + (opts.step ? stepperHtml(opts.step, req.status === 'closed') : '');
    }

    function refsHtml(req, large) {
        const atts = (req.job_board_attachments || []).slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)).slice(0, 3);
        if (!atts.length) return '';
        let html = '<div class="crq-refs' + (large ? ' crq-refs--l' : '') + '">';
        atts.forEach((a) => {
            html += '<figure class="wo-media crq-ref">'
                + (a.file_url ? '<img src="' + esc(a.file_url) + '" alt="' + esc(a.file_name || 'Imagen de referencia') + '" loading="lazy">'
                    : '<i data-wo-icon="image" aria-hidden="true"></i>')
                + '</figure>';
        });
        html += '</div>';
        return html;
    }

    function datumHtml(label, value, cls) {
        return '<div class="crq-datum"><dt class="wo-eyebrow">' + esc(label) + '</dt><dd' + (cls ? ' class="' + cls + '"' : '') + '>' + value + '</dd></div>';
    }

    function approxDate(req) {
        const bits = [];
        if (req.client_preferred_date) bits.push(esc(req.client_preferred_date));
        const flex = String(req.client_flexible_dates || '').toLowerCase();
        if (flex && flex !== 'no' && flex !== 'false') bits.push('fechas flexibles');
        return bits.join(' · ') || 'A coordinar';
    }

    // ===================== Vista · Índice =====================
    function renderIndex() {
        const list = requests || [];
        let html = '<header class="crq-index-head">'
            + '<h1 class="wo-h1">Mis solicitudes</h1>'
            + (list.length ? '<a class="wo-btn wo-btn--accent wo-btn--hard" href="/job-board/request">Publicar una idea <i data-wo-icon="arrow-right" class="wo-icon-18" aria-hidden="true"></i></a>' : '')
            + '</header>';

        if (!list.length) {
            html += emptyBlock(
                'radio',
                'Todavía no publicaste ninguna idea',
                'Contá qué tatuaje querés hacerte y recibí propuestas de tatuadores interesados.',
                '<a class="wo-btn wo-btn--accent wo-btn--hard" href="/job-board/request">Publicar una idea <i data-wo-icon="arrow-right" class="wo-icon-18" aria-hidden="true"></i></a>'
            );
            root.innerHTML = html;
            return;
        }

        html += '<p class="crq-index-sub">' + list.length + (list.length === 1 ? ' publicación' : ' publicaciones') + ' · seguí las postulaciones y elegí a tu artista.</p>';
        html += '<div class="crq-cards">';
        list.forEach((req) => {
            const tag = stateTag(req);
            const apps = visibleApps(req).length;
            const qs = '?id=' + encodeURIComponent(req.id);
            const counters = [
                apps + (apps === 1 ? ' postulación' : ' postulaciones'),
                viewCount(req) + ' visualizaciones',
            ].join(' · ');
            html += '<article class="wo-card crq-reqcard">'
                + '<div class="crq-reqcard-top">'
                + '<span class="wo-eyebrow">' + esc(req.request_code || '') + (req.request_code ? ' · ' : '') + 'publicada el ' + esc(fmtShort(req.created_at)) + '</span>'
                + '<span class="wo-tag ' + tag.cls + '">' + esc(tag.label) + '</span>'
                + '</div>'
                + '<h3 class="wo-h3">' + esc(deriveTitle(req)) + '</h3>'
                + '<p class="crq-reqcard-desc">' + truncate(req.tattoo_idea_description, 160) + '</p>'
                + '<p class="wo-meta crq-reqcard-meta">' + [styleLabel(req), req.tattoo_body_part, budgetRange(req)].filter(Boolean).map(esc).join(' · ') + '</p>'
                + '<div class="crq-reqcard-foot">'
                + '<span class="wo-meta-s wo-muted">' + esc(counters) + '</span>'
                + goLink(qs, 'wo-btn wo-btn--secondary wo-btn--s', 'Ver solicitud <i data-wo-icon="arrow-right" class="wo-icon-18" aria-hidden="true"></i>')
                + '</div>'
                + '</article>';
        });
        html += '</div>';
        root.innerHTML = html;
    }

    // ===================== Vista · Publicada (paso 2) =====================
    function renderPublished(req) {
        const apps = visibleApps(req);
        const closed = req.status === 'closed';
        const qsBase = '?id=' + encodeURIComponent(req.id);

        let html = shellHtml(req, { step: 2, back: { qs: location.pathname, label: 'Volver a mis solicitudes' } });

        html += '<div class="crq-titlerow">'
            + '<h1 class="wo-h1">' + (closed ? 'Publicación cerrada' : 'Tu idea está publicada') + '</h1>'
            + (closed ? '' : '<button class="wo-meta crq-close-link" type="button" data-action="close-request"><i data-wo-icon="x" class="wo-icon-18" aria-hidden="true"></i> Cerrar publicación</button>')
            + '</div>';

        const tag = stateTag(req);
        html += '<div class="crq-state-inline"><span class="wo-tag ' + tag.cls + '">' + (closed ? 'Cerrada' : 'Publicada · recibiendo postulaciones') + '</span></div>';

        html += '<p class="crq-lede">' + (closed
            ? 'Cerraste esta publicación: los tatuadores ya no la ven y no vas a recibir postulaciones nuevas. Las propuestas recibidas quedan acá como referencia.'
            : 'Tu publicación ya está visible para los tatuadores. Cuando recibas propuestas vas a poder compararlas y elegir al artista indicado.') + '</p>';

        // Asi ven tu publicacion
        html += '<section class="crq-section">'
            + '<p class="wo-eyebrow">Así ven tu publicación</p>'
            + '<hr class="wo-divider wo-divider--strong">'
            + '<article class="wo-card wo-card--flat">'
            + '<p class="wo-eyebrow crq-pubcard-title">' + esc(deriveTitle(req)) + '</p>'
            + '<p class="crq-pubcard-desc">' + esc(req.tattoo_idea_description || 'Sin descripción') + '</p>'
            + refsHtml(req)
            + '<hr class="wo-divider">'
            + '<dl class="crq-datagrid">'
            + datumHtml('Estilo', esc(styleLabel(req) || '—'))
            + datumHtml('Zona del cuerpo', esc(req.tattoo_body_part || '—'))
            + datumHtml('Tamaño', esc(req.tattoo_size || '—'))
            + datumHtml('Ciudad', esc(req.client_city || '—'))
            + datumHtml('Presupuesto', budgetRange(req))
            + datumHtml('Fecha', approxDate(req))
            + '</dl>'
            + '<div class="crq-card-actions">'
            + goLink(qsBase + '&view=preview', 'wo-btn wo-btn--direct', 'Ver publicación completa <i data-wo-icon="arrow-right" class="wo-icon-18" aria-hidden="true"></i>')
            + '</div>'
            + '</article>'
            + '</section>';

        // Rendimiento (datos reales: view_count embebido + counts derivados)
        html += '<section class="crq-section">'
            + '<p class="wo-eyebrow">Rendimiento</p>'
            + '<hr class="wo-divider wo-divider--strong">'
            + '<div class="crq-stats">'
            + '<div class="crq-stat crq-stat--green"><span class="crq-stat-value">' + viewCount(req) + '</span><span class="wo-meta wo-muted">Visualizaciones</span></div>'
            + '<div class="crq-stat crq-stat--blue"><span class="crq-stat-value">' + apps.length + '</span><span class="wo-meta wo-muted">Postulaciones recibidas</span></div>'
            + '<div class="crq-stat crq-stat--yellow"><span class="crq-stat-value">' + daysActive(req) + '</span><span class="wo-meta wo-muted">Días activa</span></div>'
            + '</div>'
            + '</section>';

        // Banner hacia postulaciones / estado vacio
        if (apps.length > 0) {
            html += '<div class="wo-card wo-card--inverse crq-banner">'
                + '<div>'
                + '<h2 class="crq-banner-title">Ya recibiste ' + apps.length + (apps.length === 1 ? ' postulación' : ' postulaciones') + '</h2>'
                + '<p>Los artistas están respondiendo a tu idea. Revisalos y comparalos.</p>'
                + '</div>'
                + goLink(qsBase + '&view=postulaciones', 'wo-btn wo-btn--accent wo-btn--hard', 'Ver postulaciones <i data-wo-icon="arrow-right" class="wo-icon-18" aria-hidden="true"></i>')
                + '</div>';
        } else if (!closed) {
            html += '<section class="crq-section">' + emptyBlock(
                'inbox',
                'Todavía no hay postulaciones',
                'Los tatuadores están viendo tu idea. Te avisamos acá cuando alguien responda.'
            ) + '</section>';
        }

        root.innerHTML = html;
        bindRequestActions(req);
    }

    // ===================== Vista · Preview completa =====================
    function renderPreview(req) {
        const qsBase = '?id=' + encodeURIComponent(req.id);
        let html = shellHtml(req, { step: 2, back: { qs: qsBase, label: 'Volver a la solicitud' } });

        html += '<p class="wo-eyebrow">Así la ven los tatuadores en el job board</p>';
        if (req.client_city) {
            html += '<p class="wo-meta crq-kicker"><i data-wo-icon="map-pin" aria-hidden="true"></i>' + esc([req.client_city, req.client_country].filter(Boolean).join(', ')) + '</p>';
        }
        html += '<h1 class="wo-h1">' + esc(deriveTitle(req)) + '</h1>';

        const tags = [];
        parseList(req.tattoo_style).forEach((s) => tags.push(s));
        const col = colorLabel(req.tattoo_color_type);
        if (col) tags.push(col);
        if (tags.length) {
            html += '<div class="crq-tags">' + tags.map((t) => '<span class="wo-tag">' + esc(t) + '</span>').join('') + '</div>';
        }

        html += '<p class="crq-lede">' + esc(req.tattoo_idea_description || 'Sin descripción') + '</p>';
        html += '<section class="crq-section">' + refsHtml(req, true) + '</section>';

        html += '<section class="crq-section">'
            + '<p class="wo-eyebrow">Detalles</p>'
            + '<hr class="wo-divider wo-divider--strong">'
            + '<dl class="crq-datagrid">'
            + datumHtml('Estilo', esc(styleLabel(req) || '—'))
            + datumHtml('Zona del cuerpo', esc(req.tattoo_body_part || '—') + (req.tattoo_body_side ? ' · ' + esc(req.tattoo_body_side) : ''))
            + datumHtml('Tamaño', esc(req.tattoo_size || '—'))
            + datumHtml('Color', esc(col || '—'))
            + datumHtml('Presupuesto', budgetRange(req))
            + datumHtml('Fecha aproximada', approxDate(req))
            + datumHtml('Ciudad', esc(req.client_city || '—'))
            + datumHtml('Interpretación', '<span class="is-open">Abierta al artista</span>')
            + datumHtml('Publicada', esc(fmtLong(req.created_at)))
            + '</dl>'
            + '</section>';

        root.innerHTML = html;
    }

    // ===================== Vista · Postulaciones (paso 3) =====================
    function renderApplications(req) {
        const qsBase = '?id=' + encodeURIComponent(req.id);
        const apps = visibleApps(req);

        let html = shellHtml(req, { step: 3, back: { qs: qsBase, label: 'Volver a la solicitud' } });
        html += '<h1 class="wo-h1">Artistas interesados</h1>';

        if (!apps.length) {
            html += '<p class="crq-lede">Todavía nadie respondió a tu idea.</p>';
            html += emptyBlock('inbox', 'Todavía no hay postulaciones', 'Los tatuadores están viendo tu idea. Te avisamos acá cuando alguien responda.');
            root.innerHTML = html;
            updateCompareBar(req);
            return;
        }

        const selectable = apps.filter((a) => a.status === 'pending' || a.status === 'viewed');
        html += '<p class="crq-lede">' + apps.length + (apps.length === 1 ? ' tatuador respondió' : ' tatuadores respondieron') + ' a tu idea.'
            + (selectable.length > 1 ? ' Seleccioná hasta 3 para comparar.' : '') + '</p>';

        html += '<div class="crq-apps">';
        apps.forEach((app) => {
            const price = money(app.estimated_price);
            const isDecided = app.status === 'rejected';
            const isChosen = app.status === 'accepted';
            const qsApp = qsBase + '&view=postulacion&app=' + encodeURIComponent(app.id);
            html += '<div class="crq-app-row' + (isDecided ? ' is-dim' : '') + '">'
                + '<div class="crq-app-left">'
                + (selectable.length > 1 && !isDecided && !isChosen
                    ? '<label class="wo-check crq-app-check" title="Seleccionar para comparar"><input type="checkbox" data-compare="' + esc(app.id) + '"' + (compareSel.has(app.id) ? ' checked' : '') + '><span class="wo-sr-only">Comparar esta postulación</span></label>'
                    : '')
                + avatarHtml(app)
                + '</div>'
                + '<div>'
                + '<div class="crq-app-namerow"><h3 class="wo-h3">' + esc(artistName(app)) + '</h3>'
                + (isChosen ? '<span class="wo-tag wo-tag--active">Elegido</span>' : '')
                + (isDecided ? '<span class="wo-tag wo-tag--archived">Rechazada</span>' : '')
                + '</div>'
                + '<p class="wo-meta crq-app-meta">' + artistMetaLine(app) + '</p>'
                + '<p class="crq-app-pitch">' + truncate(app.message, 220) + '</p>'
                + '</div>'
                + '<div class="crq-app-side">'
                + (price ? '<span class="wo-mono-num crq-app-price">' + price + '</span>' : '<span class="wo-meta-s wo-muted">Sin precio estimado</span>')
                + '<div class="crq-app-btns">'
                + goLink(qsApp, 'wo-btn wo-btn--secondary wo-btn--s', 'Ver propuesta')
                + (artistOf(app).username ? '<a class="wo-btn wo-btn--secondary wo-btn--s" href="/artist/profile?u=' + encodeURIComponent(artistOf(app).username) + '" target="_blank" rel="noopener">Ver perfil</a>' : '')
                + '</div>'
                + '</div>'
                + '</div>';
        });
        html += '</div>';

        root.innerHTML = html;
        updateCompareBar(req);

        root.querySelectorAll('[data-compare]').forEach((cb) => {
            cb.addEventListener('change', () => {
                const id = cb.getAttribute('data-compare');
                if (cb.checked) {
                    if (compareSel.size >= 3) { cb.checked = false; notice('warning', 'Podés comparar hasta 3 propuestas a la vez.'); return; }
                    compareSel.add(id);
                } else {
                    compareSel.delete(id);
                }
                updateCompareBar(req);
            });
        });
    }

    // ===================== Vista · Detalle de postulación =====================
    function renderApplicationDetail(req, appId) {
        const qsBase = '?id=' + encodeURIComponent(req.id);
        const app = (req.job_board_applications || []).find((a) => a.id === appId);
        if (!app) {
            root.innerHTML = shellHtml(req, { step: 3, back: { qs: qsBase + '&view=postulaciones', label: 'Volver a las postulaciones' } })
                + emptyBlock('search', 'No encontramos esa postulación', 'Puede que el artista la haya retirado.');
            return;
        }

        const a = artistOf(app);
        const canDecide = isOpen(req) && (app.status === 'pending' || app.status === 'viewed');

        let html = shellHtml(req, { step: 3, back: { qs: qsBase + '&view=postulaciones', label: 'Volver a las postulaciones' } });

        // Header del artista
        html += '<header class="crq-artist-head">'
            + avatarHtml(app, 'crq-avatar--l')
            + '<div>'
            + '<h1 class="wo-h2">' + esc(artistName(app)) + '</h1>'
            + '<p class="wo-meta crq-app-meta">' + [a.city || a.ubicacion, Array.isArray(a.styles_array) ? a.styles_array.slice(0, 2).join(' · ') : '', a.estudios].filter(Boolean).map(esc).join(' · ') + '</p>'
            + '</div>'
            + '</header>';

        // Trabajos relacionados (portfolio_links de la postulacion o galeria del artista)
        const works = parseList(app.portfolio_links).slice(0, 3);
        const gallery = works.length ? works : parseList(a.gallery_images).slice(0, 3);
        if (gallery.length) {
            html += '<section class="crq-section">'
                + '<p class="wo-eyebrow">Trabajos relacionados</p>'
                + '<hr class="wo-divider wo-divider--strong">'
                + '<div class="crq-portfolio">'
                + gallery.map((u) => '<figure class="wo-media"><img src="' + esc(u) + '" alt="Trabajo del artista" loading="lazy"></figure>').join('')
                + '</div>'
                + '</section>';
        }

        // Como interpreta tu idea (mensaje de la postulacion)
        html += '<section class="crq-section">'
            + '<p class="wo-eyebrow">Cómo interpreta tu idea</p>'
            + '<hr class="wo-divider wo-divider--strong">'
            + '<blockquote class="crq-quote"><p>' + esc(app.message || 'El artista no dejó un mensaje.') + '</p></blockquote>'
            + '</section>';

        // Datos clave
        html += '<div class="crq-keyfacts">'
            + '<div class="crq-keyfact"><span class="wo-eyebrow">Precio estimado</span><span class="crq-keyfact-value wo-mono-num">' + (money(app.estimated_price) || '—') + '</span></div>'
            + '<div class="crq-keyfact"><span class="wo-eyebrow">Duración</span><span class="crq-keyfact-value">' + sessionsLabel(app.estimated_sessions) + '</span></div>'
            + '<div class="crq-keyfact"><span class="wo-eyebrow">Disponibilidad</span><span class="crq-keyfact-value crq-keyfact-value--body">' + esc(app.availability_note || '—') + '</span></div>'
            + '</div>';

        // Estudio del artista
        if (a.estudios) {
            html += '<article class="wo-card crq-studio-card">'
                + '<span class="crq-avatar crq-avatar--s" aria-hidden="true">' + esc(initials(a.estudios)) + '</span>'
                + '<div><h3 class="wo-h3">' + esc(a.estudios) + '</h3>'
                + ((a.city || a.ubicacion) ? '<p class="wo-meta crq-app-meta">' + esc(a.city || a.ubicacion) + '</p>' : '')
                + '</div>'
                + '</article>';
        }

        // Acciones
        html += '<div class="crq-actions-row">';
        if (canDecide) {
            html += '<button class="wo-btn wo-btn--ghost" type="button" data-action="reject-app" data-app="' + esc(app.id) + '">'
                + '<i data-wo-icon="x" class="wo-icon-18" aria-hidden="true"></i> Rechazar</button>';
            html += '<button class="wo-btn wo-btn--secondary" type="button" disabled title="El chat se habilita al elegir al artista">'
                + '<i data-wo-icon="message-circle" class="wo-icon-18" aria-hidden="true"></i> Hablar con el artista</button>';
            html += '<button class="wo-btn" type="button" data-action="choose-app" data-app="' + esc(app.id) + '">'
                + 'Elegir este artista <i data-wo-icon="check" class="wo-icon-18" aria-hidden="true"></i></button>';
        } else if (app.status === 'accepted') {
            html += goLink('?id=' + encodeURIComponent(req.id) + '&view=elegido', 'wo-btn wo-btn--direct', 'Ver selección <i data-wo-icon="arrow-right" class="wo-icon-18" aria-hidden="true"></i>');
        } else if (app.status === 'rejected') {
            html += '<span class="wo-tag wo-tag--archived">Postulación rechazada</span>';
        }
        html += '</div>';

        root.innerHTML = html;
        bindRequestActions(req);
    }

    // ===================== Vista · Elegido (paso 4) =====================
    async function renderChosen(req) {
        const qsBase = '?id=' + encodeURIComponent(req.id);
        if (req.status !== 'accepted') { go(qsBase); return; }

        const app = (req.job_board_applications || []).find((a) => a.id === req.accepted_application_id)
            || (req.job_board_applications || []).find((a) => a.status === 'accepted');
        const name = app ? artistName(app) : 'tu artista';
        const a = app ? artistOf(app) : {};

        // Terminos vigentes: contraoferta aceptada > propuesta original.
        let terms = app ? agreedTerms(app, []) : { price: null, date: '—' };
        if (app) {
            try {
                terms = agreedTerms(app, await WeotziData.JobBoard.CounterOffers.listByApplication(app.id));
            } catch (err) {
                console.warn('[client-requests] chosen offers:', err && err.message);
            }
        }

        let html = shellHtml(req, { step: 4, back: { qs: location.pathname, label: 'Volver a mis solicitudes' } });

        html += '<div class="crq-chosen">'
            + '<div class="crq-chosen-tile"><i data-wo-icon="check" aria-hidden="true"></i></div>'
            + '<h1 class="wo-h1">Elegiste a ' + esc(name) + '</h1>'
            + '<p class="crq-chosen-sub">Ya podés coordinar los detalles finales y reservar tu sesión.</p>';

        if (app) {
            html += '<article class="wo-card wo-card--flat crq-chosen-card">'
                + '<div class="crq-chosen-artist">'
                + avatarHtml(app, 'crq-avatar--s')
                + '<div><h3 class="wo-h3">' + esc(name) + '</h3>'
                + '<p class="wo-meta crq-app-meta">' + [a.estudios, a.city || a.ubicacion].filter(Boolean).map(esc).join(' · ') + '</p></div>'
                + '</div>'
                + '<hr class="wo-divider">'
                + '<div class="crq-kv"><span class="wo-meta wo-muted">Precio acordado</span><span class="wo-mono-num">' + (terms.price || 'A definir') + '</span></div>'
                + '<div class="crq-kv"><span class="wo-meta wo-muted">Disponibilidad</span><span class="wo-mono-num">' + (terms.date === '—' ? 'A coordinar' : esc(terms.date)) + '</span></div>'
                + '</article>';
        }

        html += '<a class="wo-btn wo-btn--block crq-chosen-cta" href="/client/dashboard">Continuar con la reserva <i data-wo-icon="arrow-right" class="wo-icon-18" aria-hidden="true"></i></a>'
            + '<p class="wo-meta-s crq-fineprint">Vas a poder chatear, confirmar la cotización final y dejar una seña para reservar tu turno.</p>'
            + '<p class="wo-body-s">' + goLink(qsBase + '&view=seguimiento', 'wo-meta', 'Ver el seguimiento de esta solicitud →') + '</p>'
            + '</div>';

        root.innerHTML = html;
    }

    // ===================== Vista · Seguimiento (negociación) =====================
    async function renderFollowUp(req, appId) {
        const qsBase = '?id=' + encodeURIComponent(req.id);
        const apps = visibleApps(req);
        const app = (appId && apps.find((a) => a.id === appId))
            || apps.find((a) => a.id === req.accepted_application_id)
            || apps.find((a) => a.status === 'accepted')
            || apps[0];

        if (!app) {
            root.innerHTML = shellHtml(req, { step: 3, back: { qs: location.pathname, label: 'Volver a mis solicitudes' } })
                + emptyBlock('inbox', 'Todavía no hay nada para seguir', 'Cuando recibas postulaciones vas a poder negociarlas desde acá.');
            return;
        }

        let offers = [];
        try {
            offers = await WeotziData.JobBoard.CounterOffers.listByApplication(app.id);
        } catch (err) {
            console.warn('[client-requests] counterOffers:', err && err.message);
        }

        const a = artistOf(app);
        const name = artistName(app);
        const accepted = req.status === 'accepted';
        const artistCO = pendingCO(offers, 'artist');
        const clientCO = pendingCO(offers, 'client');
        const agreed = acceptedCO(offers);
        const negotiating = !!(artistCO || clientCO);

        let html = shellHtml(req, { step: accepted ? 4 : 3, back: { qs: location.pathname, label: 'Volver a mis solicitudes' } });

        if (req.client_city) {
            html += '<p class="wo-meta crq-kicker"><i data-wo-icon="map-pin" aria-hidden="true"></i>' + esc([req.client_city, req.client_country].filter(Boolean).join(', ')) + '</p>';
        }
        html += '<div class="crq-titlerow">'
            + '<h1 class="wo-h1">' + esc(deriveTitle(req)) + '</h1>'
            + (req.status !== 'closed' ? '<button class="wo-meta crq-close-link" type="button" data-action="close-request"><i data-wo-icon="x" class="wo-icon-18" aria-hidden="true"></i> Cerrar publicación</button>' : '')
            + '</div>';

        html += '<div class="crq-follow">';

        // ---- Columna principal ----
        html += '<div class="crq-follow-main">';

        // Mi publicacion
        const tags = [];
        parseList(req.tattoo_style).forEach((s) => tags.push(s));
        const col = colorLabel(req.tattoo_color_type);
        if (col) tags.push(col);
        html += '<section class="crq-section">'
            + '<div class="crq-section-head"><h2 class="wo-h2">Mi publicación</h2></div>'
            + '<hr class="wo-divider wo-divider--strong">'
            + refsHtml(req)
            + '<p class="crq-pubcard-desc">' + esc(req.tattoo_idea_description || 'Sin descripción') + '</p>'
            + (tags.length ? '<div class="crq-tags">' + tags.map((t) => '<span class="wo-tag">' + esc(t) + '</span>').join('') + '</div>' : '')
            + '<hr class="wo-divider">'
            + '<dl class="crq-datagrid crq-datagrid--2">'
            + datumHtml('Zona del cuerpo', esc(req.tattoo_body_part || '—') + (req.tattoo_body_side ? ' · ' + esc(req.tattoo_body_side) : ''))
            + datumHtml('Tamaño estimado', esc(req.tattoo_size || '—'))
            + datumHtml('Presupuesto publicado', budgetRange(req))
            + datumHtml('Fecha de publicación', esc(fmtLong(req.created_at)))
            + '</dl>'
            + '</section>';

        // Artista seleccionado / postulado
        html += '<section class="crq-section">'
            + '<div class="crq-section-head"><h2 class="wo-h2">' + (accepted ? 'Artista seleccionado' : 'Artista postulado') + '</h2></div>'
            + '<hr class="wo-divider wo-divider--strong">'
            + '<article class="wo-card crq-selected-card">'
            + '<div class="crq-selected-left">'
            + avatarHtml(app)
            + '<div><h3 class="wo-h3">' + esc(name) + '</h3>'
            + '<p class="wo-meta crq-app-meta">' + artistMetaLine(app) + '</p>'
            + (a.username ? '<a class="wo-meta" href="/artist/profile?u=' + encodeURIComponent(a.username) + '" target="_blank" rel="noopener">Ver perfil del artista →</a>' : '')
            + '</div>'
            + '</div>'
            + (money(app.estimated_price) ? '<span class="wo-mono-num crq-app-price">' + money(app.estimated_price) + '</span>' : '')
            + '</article>'
            + '</section>';

        // Propuesta del artista + negociacion
        html += '<section class="crq-section">'
            + '<div class="crq-section-head"><h2 class="wo-h2">Propuesta de ' + esc(name) + '</h2></div>'
            + '<hr class="wo-divider wo-divider--strong">'
            + '<div class="crq-keyfacts">'
            + '<div class="crq-keyfact"><span class="wo-eyebrow">Precio propuesto</span><span class="crq-keyfact-value wo-mono-num">' + (money(app.estimated_price) || '—') + '</span></div>'
            + '<div class="crq-keyfact"><span class="wo-eyebrow">Tiempo estimado</span><span class="crq-keyfact-value">' + sessionsLabel(app.estimated_sessions) + '</span></div>'
            + '<div class="crq-keyfact"><span class="wo-eyebrow">Disponibilidad</span><span class="crq-keyfact-value crq-keyfact-value--body">' + esc(app.availability_note || '—') + '</span></div>'
            + '</div>'
            + (app.message
                ? '<blockquote class="crq-quote crq-co"><span class="wo-eyebrow">Mensaje del artista</span><p>' + esc(app.message) + '</p></blockquote>'
                : '');

        if (artistCO) {
            html += '<div class="wo-alert wo-alert--warning crq-co"><div>'
                + '<span class="wo-eyebrow">El artista propuso cambios</span>'
                + '<dl class="crq-co-grid">'
                + (artistCO.price != null ? datumHtml('Precio', money(artistCO.price, artistCO.currency)) : '')
                + (artistCO.proposed_date ? datumHtml('Nueva fecha', esc(artistCO.proposed_date)) : '')
                + '</dl>'
                + (artistCO.note ? '<p class="crq-co-note"><span class="wo-eyebrow">Nota</span><br>' + esc(artistCO.note) + '</p>' : '')
                + '<div class="crq-co-actions">'
                + '<button class="wo-btn wo-btn--ghost wo-btn--s" type="button" data-action="reject-co" data-co="' + esc(artistCO.id) + '">Rechazar cambios</button>'
                + '</div>'
                + '</div></div>';
        }
        if (clientCO) {
            html += '<div class="wo-alert wo-alert--info crq-co"><div>'
                + '<span class="wo-eyebrow">Le propusiste cambios al artista</span>'
                + '<dl class="crq-co-grid">'
                + (clientCO.price != null ? datumHtml('Precio', money(clientCO.price, clientCO.currency)) : '')
                + (clientCO.proposed_date ? datumHtml('Nueva fecha', esc(clientCO.proposed_date)) : '')
                + '</dl>'
                + (clientCO.note ? '<p class="crq-co-note"><span class="wo-eyebrow">Nota</span><br>' + esc(clientCO.note) + '</p>' : '')
                + '<p class="crq-co-note wo-meta-s wo-muted">Esperando la respuesta del artista.</p>'
                + '</div></div>';
        }
        if (agreed && !artistCO && !clientCO) {
            html += '<div class="wo-alert wo-alert--success crq-co"><div>'
                + '<span class="wo-eyebrow">Cambios acordados</span>'
                + '<dl class="crq-co-grid">'
                + (agreed.price != null ? datumHtml('Precio', money(agreed.price, agreed.currency)) : '')
                + (agreed.proposed_date ? datumHtml('Fecha', esc(agreed.proposed_date)) : '')
                + '</dl>'
                + (agreed.note ? '<p class="crq-co-note">' + esc(agreed.note) + '</p>' : '')
                + '</div></div>';
        }
        html += '</section>';

        html += '</div>'; // /crq-follow-main

        // ---- Sidebar de seguimiento ----
        const stateRow = req.status === 'closed'
            ? '<span class="wo-tag wo-tag--archived">Cerrada</span>'
            : negotiating
                ? '<span class="wo-tag wo-tag--info">En negociación</span>'
                : accepted
                    ? '<span class="wo-tag wo-tag--active">Artista seleccionado</span>'
                    : '<span class="wo-tag wo-tag--highlight">Propuestas recibidas</span>';

        const moves = [req.created_at, req.accepted_at, app.created_at, app.decided_at]
            .concat((offers || []).map((o) => o.decided_at || o.created_at))
            .filter(Boolean).map((d) => new Date(d).getTime()).filter((n) => !isNaN(n));
        const lastMove = moves.length ? fmtShort(new Date(Math.max.apply(null, moves)).toISOString()) : '—';

        const tl = [
            { label: 'Publicación creada', done: true },
            { label: 'Publicación publicada', done: true },
            { label: 'Propuesta recibida', done: apps.length > 0 },
            { label: 'Artista seleccionado', done: accepted },
            { label: 'Cliente y artista negociando', done: negotiating || (accepted && !!agreed) },
            { label: 'Reserva confirmada', done: false },
        ];
        let lastDone = -1;
        tl.forEach((s, i) => { if (s.done) lastDone = i; });

        html += '<aside class="wo-card crq-follow-aside">'
            + '<h2 class="wo-h3">Seguimiento</h2>'
            + '<hr class="wo-divider">'
            + '<div class="crq-aside-kv"><span class="wo-eyebrow">Estado actual</span>' + stateRow + '</div>'
            + '<div class="crq-aside-kv"><span class="wo-eyebrow">Último movimiento</span><span class="crq-aside-val wo-mono-num">' + esc(lastMove) + '</span></div>'
            + '<div class="crq-aside-kv"><span class="wo-eyebrow">Artista</span><span class="crq-aside-val">' + esc(name) + '</span></div>'
            + '<hr class="wo-divider">'
            + '<ol class="crq-timeline">'
            + tl.map((s, i) => {
                const cls = i === lastDone ? 'is-active' : s.done ? 'is-done' : 'is-pending';
                return '<li class="' + cls + '"><span class="tl-dot" aria-hidden="true"></span>' + esc(s.label) + '</li>';
            }).join('')
            + '</ol>'
            + '<hr class="wo-divider">'
            + '<div class="crq-aside-actions">';

        if (req.resulting_quote_id) {
            html += '<a class="wo-btn wo-btn--secondary wo-btn--block" href="/client/dashboard">'
                + '<i data-wo-icon="message-circle" class="wo-icon-18" aria-hidden="true"></i> Ver conversación</a>';
        }
        const canDecide = isOpen(req) && (app.status === 'pending' || app.status === 'viewed');
        if (artistCO || canDecide) {
            html += '<button class="wo-btn wo-btn--direct wo-btn--block" type="button" data-action="accept-proposal" data-app="' + esc(app.id) + '"' + (artistCO ? ' data-co="' + esc(artistCO.id) + '"' : '') + '>'
                + '<i data-wo-icon="check" class="wo-icon-18" aria-hidden="true"></i> Aceptar propuesta</button>';
        }
        if (req.status !== 'closed') {
            html += '<button class="wo-btn wo-btn--ghost wo-btn--block" type="button" data-action="request-changes" data-app="' + esc(app.id) + '">'
                + '<i data-wo-icon="edit" class="wo-icon-18" aria-hidden="true"></i> Solicitar cambios</button>';
        }
        html += '</div></aside>';

        html += '</div>'; // /crq-follow

        root.innerHTML = html;
        bindRequestActions(req, { app, artistCO });
    }

    // ===================== Acciones =====================
    function bindRequestActions(req, ctx) {
        root.querySelectorAll('[data-action]').forEach((btn) => {
            const action = btn.getAttribute('data-action');
            btn.addEventListener('click', () => {
                if (action === 'close-request') return openCloseModal(req);
                if (action === 'choose-app') return openAcceptModal(req, btn.getAttribute('data-app'), null);
                if (action === 'accept-proposal') return openAcceptModal(req, btn.getAttribute('data-app'), btn.getAttribute('data-co'));
                if (action === 'reject-app') return openRejectModal(req, btn.getAttribute('data-app'));
                if (action === 'reject-co') return rejectCounterOffer(req, btn.getAttribute('data-co'));
                if (action === 'request-changes') return openCoModal(btn.getAttribute('data-app'));
            });
        });
    }

    function openCloseModal(req) {
        pendingAction = async () => {
            try {
                await WeotziData.JobBoard.Requests.close(req.id);
                await reloadRequest(req.id);
                closeModal('crq-modal-close');
                notice('success', 'Cerraste la publicación. Los artistas ya no la ven.');
                route();
            } catch (err) {
                console.error('[client-requests] close:', err);
                notice('error', 'No pudimos cerrar la publicación. Probá de nuevo.');
            }
        };
        openModal('crq-modal-close');
    }

    function openRejectModal(req, appId) {
        const app = (req.job_board_applications || []).find((x) => x.id === appId);
        const body = document.getElementById('crq-reject-body');
        if (body && app) body.textContent = 'Rechazás la propuesta de ' + artistName(app) + '. El artista va a ver su postulación como rechazada.';
        pendingAction = async () => {
            try {
                await WeotziData.JobBoard.Applications.reject(appId);
                await reloadRequest(req.id);
                closeModal('crq-modal-reject');
                notice('success', 'Rechazaste la postulación.');
                go('?id=' + encodeURIComponent(req.id) + '&view=postulaciones');
            } catch (err) {
                console.error('[client-requests] reject:', err);
                notice('error', 'No pudimos rechazar la postulación. Probá de nuevo.');
            }
        };
        openModal('crq-modal-reject');
    }

    function openAcceptModal(req, appId, coId) {
        const app = (req.job_board_applications || []).find((x) => x.id === appId);
        if (!app) return;
        const body = document.getElementById('crq-accept-body');
        const name = artistName(app);
        const price = money(app.estimated_price);
        let inner = '<p>Elegís a <strong>' + esc(name) + '</strong> para tu tatuaje'
            + (price ? ' por un precio estimado de <strong class="wo-mono-num">' + price + '</strong>' : '') + '.</p>';
        if (coId) {
            inner = '<p>Aceptás la propuesta de cambios de <strong>' + esc(name) + '</strong> y lo elegís para tu tatuaje.</p>';
        }
        inner += '<p class="wo-body-s wo-muted">Se crea una cotización con el artista para coordinar la reserva y las demás postulaciones se rechazan.</p>';
        if (body) body.innerHTML = inner;

        pendingAction = async () => {
            const btn = document.getElementById('crq-accept-confirm');
            btn.disabled = true;
            try {
                if (coId) {
                    await WeotziData.JobBoard.CounterOffers.decide(coId, 'aceptada');
                }
                if (isOpen(req)) {
                    await acceptApplicationViaApi(app.id, req.id);
                }
                await reloadRequest(req.id);
                closeModal('crq-modal-accept');
                notice('success', 'Elegiste a ' + name + '. Se creó una cotización para coordinar la reserva.');
                go('?id=' + encodeURIComponent(req.id) + '&view=elegido');
            } catch (err) {
                console.error('[client-requests] accept:', err);
                notice('error', 'No pudimos completar la selección: ' + (err && err.message ? err.message : 'error desconocido'));
            } finally {
                btn.disabled = false;
            }
        };
        openModal('crq-modal-accept');
    }

    // Mismo patron que client-dashboard.js: POST con Bearer del access_token.
    async function acceptApplicationViaApi(applicationId, requestId) {
        const client = window.WeotziData.getClient();
        const { data: { session } } = await client.auth.getSession();
        if (!session || !session.access_token) {
            throw new Error('Tu sesión expiró. Recargá la página e ingresá de nuevo.');
        }

        const response = await fetch('/api/job-board/accept-application', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + session.access_token,
            },
            body: JSON.stringify({ applicationId, requestId }),
        });

        const result = await response.json();
        if (!result.success) throw new Error(result.error || 'No se pudo aceptar la postulación');
        return result;
    }

    async function rejectCounterOffer(req, coId) {
        try {
            await WeotziData.JobBoard.CounterOffers.decide(coId, 'rechazada');
            notice('success', 'Rechazaste los cambios propuestos.');
            route();
        } catch (err) {
            console.error('[client-requests] reject-co:', err);
            notice('error', 'No pudimos rechazar los cambios. Probá de nuevo.');
        }
    }

    function openCoModal(appId) {
        coApplicationId = appId;
        const form = document.getElementById('crq-co-form');
        if (form) form.reset();
        openModal('crq-modal-co');
    }

    function wireModals() {
        document.getElementById('crq-close-confirm').addEventListener('click', () => { if (pendingAction) pendingAction(); });
        document.getElementById('crq-reject-confirm').addEventListener('click', () => { if (pendingAction) pendingAction(); });
        document.getElementById('crq-accept-confirm').addEventListener('click', () => { if (pendingAction) pendingAction(); });

        document.getElementById('crq-co-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!coApplicationId) return;
            const price = document.getElementById('crq-co-price').value;
            const date = document.getElementById('crq-co-date').value.trim();
            const note = document.getElementById('crq-co-note').value.trim();
            if (!price && !date && !note) {
                notice('warning', 'Completá al menos un cambio para enviarle al artista.');
                return;
            }
            const btn = document.getElementById('crq-co-submit');
            btn.disabled = true;
            try {
                const { id } = currentParams();
                const req = (requests || []).find((r) => r.id === id);
                await WeotziData.JobBoard.CounterOffers.create({
                    applicationId: coApplicationId,
                    authorRole: 'client',
                    price: price ? parseFloat(price) : null,
                    currency: (req && req.client_budget_currency) || 'USD',
                    proposedDate: date || null,
                    note: note || null,
                });
                closeModal('crq-modal-co');
                notice('success', 'Le enviaste tu propuesta de cambios al artista.');
                route();
            } catch (err) {
                console.error('[client-requests] counter-offer:', err);
                notice('error', 'No pudimos enviar la propuesta. Probá de nuevo.');
            } finally {
                btn.disabled = false;
            }
        });
    }

    // ===================== Comparación =====================
    function wireCompareBar() {
        document.getElementById('crq-compare-clear').addEventListener('click', () => {
            compareSel.clear();
            const { id } = currentParams();
            const req = (requests || []).find((r) => r.id === id);
            route();
            updateCompareBar(req);
        });
        document.getElementById('crq-compare-open').addEventListener('click', () => {
            const { id } = currentParams();
            const req = (requests || []).find((r) => r.id === id);
            if (req) renderCompareModal(req);
        });
    }

    function updateCompareBar(req) {
        const bar = document.getElementById('crq-compare-bar');
        const count = document.getElementById('crq-compare-count');
        const openBtn = document.getElementById('crq-compare-open');
        const { view } = currentParams();
        const visible = compareSel.size > 0 && (view === 'postulaciones');
        bar.classList.toggle('wo-hidden', !visible);
        document.body.classList.toggle('crq-comparing', visible);
        count.textContent = compareSel.size + ' de 3 seleccionadas';
        openBtn.disabled = compareSel.size < 2;
    }

    function renderCompareModal(req) {
        const apps = visibleApps(req).filter((a) => compareSel.has(a.id));
        if (apps.length < 2) return;
        const content = document.getElementById('crq-compare-content');
        content.innerHTML = '<div class="crq-compare-grid">'
            + apps.map((app) => {
                const qsApp = '?id=' + encodeURIComponent(req.id) + '&view=postulacion&app=' + encodeURIComponent(app.id);
                return '<div class="crq-compare-col">'
                    + '<div class="crq-app-left">' + avatarHtml(app, 'crq-avatar--s') + '<div><h3 class="wo-h3">' + esc(artistName(app)) + '</h3></div></div>'
                    + '<span class="wo-mono-num crq-app-price">' + (money(app.estimated_price) || '—') + '</span>'
                    + '<dl class="crq-compare-row"><dt class="wo-eyebrow">Ciudad</dt><dd>' + esc(artistOf(app).city || artistOf(app).ubicacion || '—') + '</dd></dl>'
                    + '<dl class="crq-compare-row"><dt class="wo-eyebrow">Estilo</dt><dd>' + esc(Array.isArray(artistOf(app).styles_array) ? artistOf(app).styles_array.slice(0, 2).join(' · ') : '—') + '</dd></dl>'
                    + '<dl class="crq-compare-row"><dt class="wo-eyebrow">Disponibilidad</dt><dd>' + esc(app.availability_note || '—') + '</dd></dl>'
                    + '<dl class="crq-compare-row"><dt class="wo-eyebrow">Duración</dt><dd>' + sessionsLabel(app.estimated_sessions) + '</dd></dl>'
                    + '<p class="crq-compare-msg">' + truncate(app.message, 180) + '</p>'
                    + goLink(qsApp, 'wo-btn wo-btn--secondary wo-btn--s', 'Ver propuesta', ' data-close-modal="crq-modal-compare"')
                    + '</div>';
            }).join('')
            + '</div>';
        openModal('crq-modal-compare');
    }
})();
