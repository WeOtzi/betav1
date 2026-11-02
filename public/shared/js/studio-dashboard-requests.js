// ============================================
// We Ötzi — Solicitudes del estudio (pestaña "solicitudes", W-TEAM)
//
// Tres sub-pestañas:
//   - Altas: artistas que pidieron sumarse (membresía 'requested').
//     Aprobar (rol + sede) · Aprobar con contrato · Rechazar.
//   - Cambios pedidos: pedidos de cambios sobre invitaciones del estudio.
//     Responder con contrato · Cerrar.
//   - Contraofertas: propuestas de artistas sobre postulaciones a spots.
//     Aceptar (y preparar el contrato) · Rechazar.
//
// Contrato: docs/plans/2026-10-30-estudios-plataforma.md → "Solicitudes".
// Datos vía WeotziData.StudioMemberships / StudioSpots / StudioContracts; los
// contratos se editan con window.WeOtziStudioContracts. Los listados tragan la
// "migración pendiente" (la sub-pestaña queda vacía con el aviso). Las
// decisiones avisan al artista con ctx.notify, que nunca lanza.
// ============================================

(function () {
    'use strict';

    const TAB = 'solicitudes';
    const SUBTABS = [
        {
            id: 'altas',
            label: 'Altas',
            emptyTitle: 'No hay solicitudes de alta',
            emptyBody: 'Cuando un artista pida sumarse a tu estudio, la vas a ver acá.'
        },
        {
            id: 'cambios',
            label: 'Cambios pedidos',
            emptyTitle: 'No hay cambios pedidos',
            emptyBody: 'Cuando un artista pida cambios en una invitación, aparece acá.'
        },
        {
            id: 'contraofertas',
            label: 'Contraofertas',
            emptyTitle: 'No hay contraofertas',
            emptyBody: 'Cuando un artista proponga otras condiciones para un spot, aparece acá.'
        }
    ];
    const SUB_ALIASES = {
        altas: 'altas', alta: 'altas', requests: 'altas', solicitudes: 'altas',
        cambios: 'cambios', changes: 'cambios', change_requests: 'cambios',
        contraofertas: 'contraofertas', counters: 'contraofertas', counteroffers: 'contraofertas', counter_offers: 'contraofertas'
    };
    const APPROVE_ROLES = ['resident', 'guest', 'itinerant'];
    const MISSING_MESSAGE = 'Esta función todavía no está disponible (falta aplicar una migración).';

    const emptyList = () => ({ rows: [], unavailable: false, error: null });
    const state = {
        ctx: null,
        root: null,
        sub: 'altas',
        lists: { altas: emptyList(), cambios: emptyList(), contraofertas: emptyList() },
        loaded: false,
        loadSeq: 0
    };
    let seq = 0;

    // -------------------------------------------------------------
    // Entorno
    // -------------------------------------------------------------
    const kit = () => window.WeOtziStudioKit;
    const data = () => window.WeotziData || {};
    const memberships = () => data().StudioMemberships || {};
    const spots = () => data().StudioSpots || {};
    const contractsRepo = () => data().StudioContracts || null;
    const contractsApi = () => window.WeOtziStudioContracts || null;
    const esc = v => kit().escapeHtml(v);
    const escAttr = v => kit().escapeAttr(v);
    const label = (dict, value) => kit().label(dict, value);

    function looksLikeError(e) {
        return !!e && typeof e === 'object' && typeof e.message === 'string' && typeof e.stack === 'string';
    }
    function toError(err) {
        if (looksLikeError(err)) return err;
        const src = err && typeof err === 'object' ? err : { message: String(err || '') };
        const error = new Error(src.message || 'No pudimos completar la acción. Intentá de nuevo.');
        ['code', 'details', 'hint', 'status'].forEach(k => { if (src[k] != null) error[k] = src[k]; });
        return error;
    }
    function must(res) {
        if (!res) return null;
        if (res.error) throw toError(res.error);
        return res.data === undefined ? null : res.data;
    }
    function call(obj, method, args) {
        if (!obj || typeof obj[method] !== 'function') {
            const error = new Error(MISSING_MESSAGE);
            error.code = '42883';
            return Promise.resolve({ data: null, error });
        }
        try {
            return Promise.resolve(obj[method].apply(obj, args || []));
        } catch (error) {
            return Promise.resolve({ data: null, error });
        }
    }
    function idFrom(value) {
        if (typeof value === 'string') return value.trim() || null;
        if (Array.isArray(value)) return idFrom(value[0]);
        if (value && typeof value === 'object') return value.id || value.contract_id || null;
        return null;
    }
    async function notifySafe(ctx, payload) {
        try {
            const res = ctx && typeof ctx.notify === 'function' ? await ctx.notify(payload) : null;
            return res && typeof res === 'object' ? res : { ok: false };
        } catch (error) {
            return { ok: false, error };
        }
    }
    function one(v) { return Array.isArray(v) ? (v[0] || null) : (v || null); }
    function hasValue(v) { return v != null && String(v).trim() !== ''; }
    function artistName(a) {
        const artist = a || {};
        return artist.name || (artist.username ? '@' + artist.username : 'El artista');
    }
    function initials(name) {
        const parts = String(name || '').replace(/^@/, '').trim().split(/\s+/).filter(Boolean);
        const out = parts.slice(0, 2).map(p => p.charAt(0).toUpperCase()).join('');
        return out || '?';
    }

    // -------------------------------------------------------------
    // Normalización de filas
    // -------------------------------------------------------------
    function requestDetails(row) { return one(row && row.studio_membership_request_details) || {}; }
    function changeMembership(row) { return one(row && row.studio_artist_memberships) || {}; }
    function counterApplication(row) { return one(row && row.studio_spot_applications) || {}; }
    function counterArtist(row) { return one(counterApplication(row).artists_db) || {}; }
    function counterSpot(row) { return one(counterApplication(row).studio_spots) || {}; }

    function membershipFromRequest(row) {
        return {
            id: row.id,
            studio_id: row.studio_id,
            artist_user_id: row.artist_user_id,
            role: row.role,
            status: row.status || 'requested',
            location_id: row.location_id || null,
            initiated_by: row.initiated_by || 'artist',
            artists_db: one(row.artists_db)
        };
    }

    function membershipFromChange(row) {
        const m = changeMembership(row);
        return Object.assign({}, m, {
            id: row.membership_id || m.id,
            artist_user_id: row.artist_user_id || m.artist_user_id,
            artists_db: one(row.artists_db)
        });
    }

    // Mismo criterio que el badge del shell (computeBadgeCounts).
    function pendingCount(lists) {
        const open = (list, status) => ((list && list.rows) || []).filter(r => r && (!r.status || r.status === status)).length;
        return open(lists.altas, 'requested') + open(lists.cambios, 'pending') + open(lists.contraofertas, 'pending');
    }

    function normalizeSub(value) {
        return SUB_ALIASES[String(value || '').toLowerCase()] || null;
    }

    // -------------------------------------------------------------
    // HTML
    // -------------------------------------------------------------
    function avatarHtml(artist) {
        const k = kit();
        const a = artist || {};
        const src = k.safeUrl(a.profile_picture);
        if (src) return '<img class="sreq-avatar" src="' + escAttr(src) + '" alt="" width="48" height="48" loading="lazy" decoding="async">';
        return '<span class="sreq-avatar sreq-avatar--initials" aria-hidden="true">' + esc(initials(a.name || a.username)) + '</span>';
    }

    function headHtml(artist, when) {
        const k = kit();
        const a = artist || {};
        return '<header class="sreq-card__head">'
            + avatarHtml(a)
            + '<div class="sreq-card__who">'
            + '<p class="sreq-card__name">' + esc(a.name || a.username || 'Artista') + '</p>'
            + (a.username ? '<p class="sreq-card__handle">@' + esc(a.username) + '</p>' : '')
            + '</div>'
            + (when ? '<p class="sreq-card__age"><time datetime="' + escAttr(when) + '" title="' + escAttr(k.fmtDateTime(when)) + '">' + esc(capitalize(k.fmtRelative(when))) + '</time></p>' : '')
            + '</header>';
    }

    function capitalize(s) { const v = String(s || ''); return v ? v.charAt(0).toUpperCase() + v.slice(1) : v; }

    function fact(term, valueHtml) {
        return '<div><dt>' + esc(term) + '</dt><dd>' + valueHtml + '</dd></div>';
    }

    function tagsHtml(list, ariaLabel) {
        const items = (Array.isArray(list) ? list : []).filter(hasValue).slice(0, 8);
        if (!items.length) return '';
        return '<ul class="sreq-tags" aria-label="' + escAttr(ariaLabel) + '">' + items.map(s => '<li>' + esc(s) + '</li>').join('') + '</ul>';
    }

    function messageHtml(message, emptyText) {
        return hasValue(message)
            ? '<blockquote class="sreq-card__msg">' + esc(String(message).trim()) + '</blockquote>'
            : '<p class="sreq-card__msg sreq-card__msg--empty">' + esc(emptyText) + '</p>';
    }

    function button(action, id, text, variant) {
        const cls = variant === 'primary' ? 'studio-btn studio-btn-primary' : variant === 'ghost' ? 'studio-btn studio-btn-ghost' : 'studio-btn';
        return '<button type="button" class="' + cls + ' sk-btn-sm" data-sreq-action="' + escAttr(action) + '" data-id="' + escAttr(id) + '">' + esc(text) + '</button>';
    }

    function requestCardHtml(row) {
        const k = kit();
        const a = one(row.artists_db) || {};
        const d = requestDetails(row);
        const styles = (Array.isArray(d.styles) && d.styles.length ? d.styles : (a.styles || a.styles_array)) || [];
        const portfolio = k.safeUrl(d.portfolio_url);
        const sentAt = row.invited_at || d.created_at || null;
        return '<article class="sreq-card" data-sreq-kind="alta" data-sreq-id="' + escAttr(row.id) + '">'
            + headHtml(a, sentAt)
            + '<dl class="sreq-facts">'
            + fact('Rol pedido', esc(label('membershipRole', row.role)))
            + fact('Inicio propuesto', esc(d.proposed_start_date ? k.fmtDate(d.proposed_start_date) : 'A convenir'))
            + '</dl>'
            + tagsHtml(styles, 'Estilos')
            + messageHtml(d.message, 'No dejó mensaje.')
            + (portfolio ? '<p class="sreq-card__link"><a href="' + escAttr(portfolio) + '" target="_blank" rel="noopener noreferrer">Ver portfolio <span aria-hidden="true">↗</span></a></p>' : '')
            + '<div class="sreq-card__actions">'
            + button('approve', row.id, 'Aprobar', 'primary')
            + button('approve-contract', row.id, 'Aprobar con contrato')
            + button('reject', row.id, 'Rechazar', 'ghost')
            + '</div>'
            + '</article>';
    }

    function changeCardHtml(row) {
        const k = kit();
        const a = one(row.artists_db) || {};
        const m = changeMembership(row);
        const split = m.revenue_split_pct == null || m.revenue_split_pct === '' ? 'Sin definir' : k.fmtPercent(m.revenue_split_pct) + ' para el artista';
        return '<article class="sreq-card" data-sreq-kind="cambio" data-sreq-id="' + escAttr(row.id) + '">'
            + headHtml(a, row.created_at)
            + '<dl class="sreq-facts">'
            + fact('Invitación', esc(label('membershipRole', m.role)) + ' · ' + esc(label('membershipStatus', m.status)))
            + fact('Reparto actual', esc(split))
            + '</dl>'
            + messageHtml(row.message, 'No detalló los cambios.')
            + '<div class="sreq-card__actions">'
            + button('change-contract', row.id, 'Responder con contrato', 'primary')
            + button('change-close', row.id, 'Cerrar', 'ghost')
            + '</div>'
            + '</article>';
    }

    function counterCardHtml(row) {
        const k = kit();
        const a = counterArtist(row);
        const spot = counterSpot(row);
        const dates = row.proposed_start_date && row.proposed_end_date
            ? 'Del ' + k.fmtDate(row.proposed_start_date) + ' al ' + k.fmtDate(row.proposed_end_date)
            : row.proposed_start_date ? 'Desde el ' + k.fmtDate(row.proposed_start_date)
                : row.proposed_end_date ? 'Hasta el ' + k.fmtDate(row.proposed_end_date) : 'Sin cambios';
        const split = row.split_pct == null || row.split_pct === '' ? 'Sin cambios' : k.fmtPercent(row.split_pct) + ' para el artista';
        return '<article class="sreq-card" data-sreq-kind="contraoferta" data-sreq-id="' + escAttr(row.id) + '">'
            + headHtml(a, row.created_at)
            + '<dl class="sreq-facts">'
            + fact('Spot', esc(spot.title || 'Spot') + (spot.kind ? ' · ' + esc(label('spotKind', spot.kind)) : ''))
            + fact('Propone', esc(split))
            + fact('Fechas', esc(dates))
            + '</dl>'
            + messageHtml(row.note, 'Sin comentarios.')
            + '<div class="sreq-card__actions">'
            + button('counter-accept', row.id, 'Aceptar', 'primary')
            + button('counter-reject', row.id, 'Rechazar', 'ghost')
            + '</div>'
            + '</article>';
    }

    const CARD_RENDERERS = { altas: requestCardHtml, cambios: changeCardHtml, contraofertas: counterCardHtml };

    function subtabsHtml(lists, active) {
        return '<div class="sk-subtabs sreq-subtabs" role="tablist" aria-label="Tipos de solicitud">'
            + SUBTABS.map(s => {
                const list = lists[s.id] || emptyList();
                const count = (list.rows || []).length;
                const on = s.id === active;
                return '<button type="button" role="tab" id="sreq-tab-' + escAttr(s.id) + '" aria-controls="sreq-panel" aria-selected="' + (on ? 'true' : 'false') + '"'
                    + ' tabindex="' + (on ? '0' : '-1') + '" data-sreq-sub="' + escAttr(s.id) + '">'
                    + esc(s.label) + (count ? ' <span class="sreq-count">' + esc(count) + '</span>' : '')
                    + '</button>';
            }).join('')
            + '</div>';
    }

    function panelHtml(sub, list) {
        const k = kit();
        const meta = SUBTABS.find(s => s.id === sub) || SUBTABS[0];
        const l = list || emptyList();
        if (l.unavailable) return k.emptyState({ title: meta.label + ': todavía no disponible', body: MISSING_MESSAGE });
        if (l.error) return '<div class="studio-status studio-status-error" role="alert">' + esc(k.friendlyError(l.error, 'No pudimos cargar esta lista.')) + '</div>';
        if (!l.rows.length) return k.emptyState({ title: meta.emptyTitle, body: meta.emptyBody });
        return '<div class="sreq-list">' + l.rows.map(CARD_RENDERERS[meta.id]).join('') + '</div>';
    }

    function render() {
        const root = state.root;
        if (!root || typeof root.querySelector !== 'function') return;
        const host = root.querySelector('[data-sreq-body]');
        if (!host) return;
        host.innerHTML = subtabsHtml(state.lists, state.sub)
            + '<div id="sreq-panel" class="sreq-panel" role="tabpanel" aria-labelledby="sreq-tab-' + escAttr(state.sub) + '">'
            + panelHtml(state.sub, state.lists[state.sub])
            + '</div>';
    }

    // -------------------------------------------------------------
    // Carga
    // -------------------------------------------------------------
    async function settleList(promise) {
        try {
            const res = await promise;
            if (!res) return { rows: [], unavailable: true, error: null };
            if (res.unavailable) return { rows: [], unavailable: true, error: null };
            if (res.error) {
                const k = kit();
                return k && k.isMissingSchema(res.error) ? { rows: [], unavailable: true, error: null } : { rows: [], unavailable: false, error: res.error };
            }
            return { rows: Array.isArray(res.data) ? res.data.filter(Boolean) : [], unavailable: false, error: null };
        } catch (error) {
            return { rows: [], unavailable: false, error };
        }
    }

    async function loadAll(ctx) {
        const token = ++state.loadSeq;
        const [altas, cambios, contraofertas] = await Promise.all([
            settleList(call(memberships(), 'listRequestsForStudio', [ctx.studioId])),
            settleList(call(memberships(), 'listChangeRequestsForStudio', [ctx.studioId])),
            settleList(call(spots(), 'listArtistCounterOffersForStudio', [ctx.studioId]))
        ]);
        if (token !== state.loadSeq) return false;
        state.lists = { altas, cambios, contraofertas };
        state.loaded = true;
        render();
        if (typeof ctx.setBadge === 'function') ctx.setBadge(TAB, pendingCount(state.lists));
        return true;
    }

    async function afterChange(ctx) {
        await loadAll(ctx);
        if (ctx && typeof ctx.refresh === 'function') {
            Promise.resolve().then(() => ctx.refresh()).catch(err => console.warn('[studio-requests] refresh:', err));
        }
    }

    async function loadLocations(ctx) {
        const repo = data().StudioLocations;
        if (!repo || typeof repo.listActiveByStudio !== 'function') return [];
        try {
            const res = await repo.listActiveByStudio(ctx.studioId, 'id, label, is_primary');
            return res && !res.error && Array.isArray(res.data) ? res.data : [];
        } catch (err) {
            console.warn('[studio-requests] sedes:', err);
            return [];
        }
    }

    // -------------------------------------------------------------
    // Altas
    // -------------------------------------------------------------
    async function approveRequest(ctx, row, choice) {
        const c = choice || {};
        const res = await call(memberships(), 'decideRequest', [row.id, 'accept', { role: c.role || null, locationId: c.locationId || null }]);
        const decided = must(res);
        const notice = await notifySafe(ctx, { kind: 'membership_request_decision', membership_id: row.id });
        return { decided, notified: !!notice.ok };
    }

    async function rejectRequest(ctx, row) {
        const name = artistName(one(row.artists_db));
        const ok = await kit().confirmDialog({
            title: 'Rechazar solicitud',
            body: '<p class="sk-overlay__text">¿Rechazás la solicitud de <strong>' + esc(name) + '</strong>? Le avisamos por email.</p>',
            confirmLabel: 'Rechazar',
            tone: 'danger'
        });
        if (!ok) return null;
        must(await call(memberships(), 'decideRequest', [row.id, 'reject']));
        const notice = await notifySafe(ctx, { kind: 'membership_request_decision', membership_id: row.id });
        return { notified: !!notice.ok };
    }

    function approveFormHtml(row, locations, uid) {
        const k = kit();
        const name = artistName(one(row.artists_db));
        const role = APPROVE_ROLES.includes(row.role) ? row.role : 'resident';
        const primary = locations.find(l => l.is_primary);
        const selectedLoc = row.location_id || (primary && primary.id) || '';
        return '<p class="sk-overlay__text"><strong>' + esc(name) + '</strong> pasa al roster del estudio.</p>'
            + '<div class="sk-field"><label for="' + uid + '-role">Rol</label>'
            + '<select id="' + uid + '-role" class="studio-input" data-sreq-role>' + k.optionsHtml('membershipRole', role, { only: APPROVE_ROLES }) + '</select></div>'
            + '<div class="sk-field"><label for="' + uid + '-location">Sede</label>'
            + '<select id="' + uid + '-location" class="studio-input" data-sreq-location><option value="">Sin sede asignada</option>'
            + locations.map(l => '<option value="' + escAttr(l.id) + '"' + (String(l.id) === String(selectedLoc) ? ' selected' : '') + '>'
                + esc(l.label || 'Sede') + (l.is_primary ? ' (principal)' : '') + '</option>').join('')
            + '</select></div>'
            + '<p class="studio-help">Si preferís dejar las condiciones por escrito, usá "Aprobar con contrato".</p>';
    }

    async function openApproveModal(ctx, row) {
        const k = kit();
        const locations = await loadLocations(ctx);
        const uid = 'sreq-approve-' + (++seq);
        const modal = k.openModal({
            title: 'Aprobar solicitud',
            size: 'sm',
            body: approveFormHtml(row, locations, uid),
            actions: [
                { label: 'Cancelar', variant: 'ghost', value: null },
                {
                    label: 'Aprobar',
                    variant: 'primary',
                    async onClick(m) {
                        const roleEl = m.body && m.body.querySelector('[data-sreq-role]');
                        const locEl = m.body && m.body.querySelector('[data-sreq-location]');
                        return approveRequest(ctx, row, {
                            role: roleEl ? roleEl.value : null,
                            locationId: locEl && locEl.value ? locEl.value : null
                        });
                    }
                }
            ]
        });
        return modal.closed;
    }

    async function approveWithContract(ctx, row) {
        const api = contractsApi();
        if (!api || typeof api.openForMembership !== 'function') throw new Error(MISSING_MESSAGE);
        const outcome = await api.openForMembership(membershipFromRequest(row));
        return outcome || null;
    }

    // -------------------------------------------------------------
    // Cambios pedidos
    // -------------------------------------------------------------
    async function closeChange(row, opts) {
        const o = opts || {};
        if (!o.skipConfirm) {
            const ok = await kit().confirmDialog({
                title: 'Cerrar pedido de cambios',
                body: '<p class="sk-overlay__text">El pedido de <strong>' + esc(artistName(one(row.artists_db))) + '</strong> queda cerrado sin cambios en la invitación.</p>',
                confirmLabel: 'Cerrar pedido'
            });
            if (!ok) return null;
        }
        const rows = must(await call(memberships(), 'closeChangeRequest', [row.id]));
        return { closed: Array.isArray(rows) ? rows.length > 0 : !!rows };
    }

    // El contrato emitido es la respuesta: el pedido se cierra solo.
    async function respondChangeWithContract(ctx, row) {
        void ctx;
        const api = contractsApi();
        if (!api || typeof api.openForMembership !== 'function') throw new Error(MISSING_MESSAGE);
        const outcome = await api.openForMembership(membershipFromChange(row));
        if (outcome && outcome.issued) {
            try {
                await closeChange(row, { skipConfirm: true });
            } catch (err) {
                console.warn('[studio-requests] no se pudo cerrar el pedido de cambios:', err);
            }
        }
        return outcome || null;
    }

    // -------------------------------------------------------------
    // Contraofertas
    // -------------------------------------------------------------
    async function acceptCounterOffer(ctx, row) {
        void ctx;
        const k = kit();
        const a = counterArtist(row);
        const spot = counterSpot(row);
        const ok = await k.confirmDialog({
            title: 'Aceptar contraoferta',
            body: '<p class="sk-overlay__text">Aceptás la propuesta de <strong>' + esc(artistName(a)) + '</strong> para <strong>'
                + esc(spot.title || 'el spot') + '</strong>. Después revisás y emitís el contrato.</p>',
            confirmLabel: 'Aceptar'
        });
        if (!ok) return null;
        must(await call(spots(), 'respondCounterOffer', [row.id, 'accept']));
        // Desde acá la contraoferta ya quedó aceptada: lo que falle después se
        // avisa (warning) sin perder ese resultado ni el refresco de la lista.
        const done = { accepted: true, contractId: null, issued: false };
        const appId = row.application_id || counterApplication(row).id;
        const repo = contractsRepo();
        if (!appId || !repo || typeof repo.prepareFromApplication !== 'function') return done;
        const prep = await call(repo, 'prepareFromApplication', [appId]);
        if (prep && prep.error) {
            if (!k.isMissingSchema(prep.error)) {
                done.warning = 'Contraoferta aceptada, pero no pudimos preparar el contrato: ' + k.friendlyError(prep.error);
            }
            return done;
        }
        done.contractId = idFrom(prep && prep.data);
        const api = contractsApi();
        if (done.contractId && api && typeof api.openEditor === 'function') {
            try {
                const outcome = await api.openEditor(done.contractId);
                done.issued = !!(outcome && outcome.issued);
            } catch (err) {
                console.warn('[studio-requests] no se pudo abrir el contrato:', err);
                done.warning = 'Contraoferta aceptada, pero no pudimos abrir el contrato (' + k.friendlyError(err) + '). Lo encontrás en Contratos.';
            }
        }
        return done;
    }

    async function rejectCounterOffer(ctx, row) {
        void ctx;
        const ok = await kit().confirmDialog({
            title: 'Rechazar contraoferta',
            body: '<p class="sk-overlay__text">La postulación de <strong>' + esc(artistName(counterArtist(row))) + '</strong> sigue abierta con las condiciones del spot.</p>',
            confirmLabel: 'Rechazar',
            tone: 'danger'
        });
        if (!ok) return null;
        must(await call(spots(), 'respondCounterOffer', [row.id, 'reject']));
        return { rejected: true };
    }

    // -------------------------------------------------------------
    // Acciones (delegadas desde la raíz)
    // -------------------------------------------------------------
    function findRow(sub, id) {
        const list = state.lists[sub];
        return ((list && list.rows) || []).find(r => String(r.id) === String(id)) || null;
    }

    async function runAction(ctx, action, id) {
        const k = kit();
        if (action === 'approve') {
            const row = findRow('altas', id);
            if (!row) return;
            const result = await openApproveModal(ctx, row);
            if (!result) return;
            const name = artistName(one(row.artists_db));
            k.toast('Solicitud aprobada: ' + name + ' ya está en tu roster.' + (result.notified ? '' : ' No pudimos enviarle el email.'), result.notified ? 'success' : 'warning');
            await afterChange(ctx);
        } else if (action === 'approve-contract') {
            const row = findRow('altas', id);
            if (!row) return;
            const outcome = await approveWithContract(ctx, row);
            if (outcome && outcome.issued) k.toast('Contrato emitido: la solicitud queda aprobada cuando ' + artistName(one(row.artists_db)) + ' lo firme.', 'success');
            await afterChange(ctx);
        } else if (action === 'reject') {
            const row = findRow('altas', id);
            if (!row) return;
            const result = await rejectRequest(ctx, row);
            if (!result) return;
            k.toast('Solicitud rechazada.' + (result.notified ? ' Le avisamos al artista.' : ' No pudimos enviarle el email.'), result.notified ? 'success' : 'warning');
            await afterChange(ctx);
        } else if (action === 'change-contract') {
            const row = findRow('cambios', id);
            if (!row) return;
            const outcome = await respondChangeWithContract(ctx, row);
            if (outcome && outcome.issued) k.toast('Contrato enviado: respondiste el pedido de cambios.', 'success');
            await afterChange(ctx);
        } else if (action === 'change-close') {
            const row = findRow('cambios', id);
            if (!row) return;
            const result = await closeChange(row);
            if (!result) return;
            k.toast(result.closed ? 'Pedido de cambios cerrado.' : 'Ese pedido ya estaba cerrado.', 'success');
            await afterChange(ctx);
        } else if (action === 'counter-accept') {
            const row = findRow('contraofertas', id);
            if (!row) return;
            const result = await acceptCounterOffer(ctx, row);
            if (!result) return;
            if (result.warning) k.toast(result.warning, 'warning');
            else {
                k.toast(result.issued
                    ? 'Contrato emitido: cuando el artista lo firme, se suma al roster.'
                    : result.contractId
                        ? 'Contraoferta aceptada. El contrato quedó en borrador en Contratos.'
                        : 'Contraoferta aceptada.', 'success');
            }
            await afterChange(ctx);
        } else if (action === 'counter-reject') {
            const row = findRow('contraofertas', id);
            if (!row) return;
            const result = await rejectCounterOffer(ctx, row);
            if (!result) return;
            k.toast('Contraoferta rechazada.', 'success');
            await afterChange(ctx);
        }
    }

    function selectSub(sub, focus) {
        state.sub = normalizeSub(sub) || state.sub;
        render();
        if (focus && state.root) {
            const tab = state.root.querySelector('#sreq-tab-' + state.sub);
            if (tab && typeof tab.focus === 'function') tab.focus();
        }
    }

    function wire(root, ctx) {
        root.addEventListener('click', event => {
            const target = event.target && typeof event.target.closest === 'function' ? event.target : null;
            if (!target) return;
            const sub = target.closest('[data-sreq-sub]');
            if (sub) {
                selectSub(sub.getAttribute('data-sreq-sub'));
                return;
            }
            const btn = target.closest('[data-sreq-action]');
            if (btn) kit().guarded(btn, () => runAction(ctx, btn.getAttribute('data-sreq-action'), btn.getAttribute('data-id')));
        });
        // Flechas entre sub-pestañas (patrón tablist).
        root.addEventListener('keydown', event => {
            const target = event.target;
            if (!target || typeof target.getAttribute !== 'function' || !target.getAttribute('data-sreq-sub')) return;
            if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
            event.preventDefault();
            const ids = SUBTABS.map(s => s.id);
            const i = ids.indexOf(target.getAttribute('data-sreq-sub'));
            const next = ids[(i + (event.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length];
            selectSub(next, true);
        });
    }

    const tabModule = {
        mount(root, ctx) {
            state.ctx = ctx;
            state.root = root;
            root.innerHTML = '<div class="sreq-module" data-sreq-body><p class="studio-help">Cargando solicitudes…</p></div>';
            wire(root, ctx);
        },
        async show(root, ctx, params) {
            const p = params || {};
            const wanted = normalizeSub(p.sub || p.view || p.section || p.tab);
            if (wanted) state.sub = wanted;
            await loadAll(ctx);
            // Sin sub-pestaña pedida, se abre la primera con pendientes.
            if (!wanted && !(state.lists[state.sub].rows || []).length) {
                const firstWithRows = SUBTABS.find(s => (state.lists[s.id].rows || []).length);
                if (firstWithRows) selectSub(firstWithRows.id);
            }
        }
    };

    const admin = window.WeOtziStudioAdmin;
    if (admin && typeof admin.register === 'function') {
        admin.register(TAB, tabModule);
    } else {
        console.warn('[studio-requests] falta WeOtziStudioAdmin: la pestaña Solicitudes no se registra.');
    }
})();
