// ============================================
// WE ÖTZI - "Eliminar mi cuenta" (ronda 3c · grupo "borrado")
// Bloque reutilizable para la cuenta del artista (/artist/account · Seguridad),
// el perfil del cliente (/client/profile · Seguridad) y el panel del estudio
// (/studio/dashboard · Cuenta). Sin frame en el Figma: sigue el lenguaje de
// Cuenta (bloque de peligro + diálogo con barra, eyebrows mono, botones DS).
//
// Flujo: explica el proceso y plazos → muestra los bloqueos actuales
// (account_deletion_blockers) → motivo opcional → escribir "ELIMINAR" →
// crea la solicitud (RPC request_account_deletion) → muestra el estado y
// permite cancelarla mientras no esté completada. Nada se borra al pedir:
// lo gestiona soporte (cola "Bajas de cuenta").
//
// Uso: WeotziAccountDeletion.mount(hostEl, { role: 'artist'|'client'|'studio', titleClass?, textClass? })
// Datos: WeotziData.AccountDeletion (data/account-deletion-repo.js).
// En Node (tests) exporta solo los helpers puros.
// ============================================

(function (root, factory) {
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root && root.document) root.WeotziAccountDeletion = api;
}(typeof window !== 'undefined' ? window : globalThis, function (root) {
    'use strict';

    const CONFIRM_WORD = 'ELIMINAR';
    const REVIEW_DAYS = 30;
    const REASON_MAX = 1000;
    const OPEN = ['pending', 'in_review', 'blocked', 'approved'];
    const STATUS_META = {
        pending: { label: 'Recibida', text: 'Soporte todavía no la abrió. Tu cuenta sigue activa.' },
        in_review: { label: 'En revisión', text: 'Soporte está verificando que no queden pendientes. Tu cuenta sigue activa.' },
        blocked: { label: 'En espera', text: 'Hay pendientes que resolver antes de la baja. Cuando estén resueltos, soporte la retoma.' },
        approved: { label: 'Aprobada', text: 'Soporte aprobó la baja: la ejecutamos en los próximos días y te avisamos por email.' },
        completed: { label: 'Completada', text: 'La cuenta fue eliminada.' },
        cancelled: { label: 'Cancelada', text: 'Cancelaste la solicitud. Tu cuenta sigue activa.' },
        rejected: { label: 'Rechazada', text: 'Soporte no pudo aprobar la baja. Revisá la nota y, cuando lo resuelvas, podés pedirla de nuevo.' }
    };
    const ROLE_COPY = {
        artist: 'Se eliminan tu perfil, portafolio, agenda y tu historial en We Ötzi.',
        client: 'Se eliminan tu perfil, tus cotizaciones y tu historial en We Ötzi.',
        studio: 'Se eliminan el estudio, sus sedes, el equipo y su historial en We Ötzi.'
    };
    const MSG = {
        unavailable: 'Todavía no podemos recibir solicitudes de baja desde acá. Escribinos por el soporte de la app.',
        loadError: 'No pudimos leer el estado de tu solicitud. Probá de nuevo en un rato.',
        blockersError: 'No pudimos revisar los pendientes de tu cuenta ahora. Soporte los revisa igual antes de aprobar.',
        confirm: 'Escribí ' + CONFIRM_WORD + ' para confirmar.',
        reasonLong: 'El motivo puede tener hasta ' + REASON_MAX + ' caracteres.',
        generic: 'No pudimos registrar la solicitud. Probá de nuevo.',
        sent: 'Recibimos tu solicitud. Te mandamos un email con los próximos pasos.',
        cancelled: 'Cancelaste la solicitud. Tu cuenta sigue activa.',
        cancelAsk: 'Tocá de nuevo para confirmar la cancelación.'
    };

    // ---------------- helpers puros ----------------

    function esc(value) {
        return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function isConfirmText(text) { return String(text == null ? '' : text).trim().toUpperCase() === CONFIRM_WORD; }
    function isOpen(status) { return OPEN.indexOf(status) >= 0; }
    function canCancel(request) { return !!request && isOpen(request.status); }
    function statusMeta(status) { return STATUS_META[status] || { label: status || '-', text: '' }; }

    // La solicitud "vigente": la abierta, o la última cerrada si no hay abierta.
    function currentRequest(rows) {
        const list = Array.isArray(rows) ? rows.slice() : [];
        list.sort((a, b) => String(b.requested_at || '').localeCompare(String(a.requested_at || '')));
        return list.find((r) => isOpen(r.status)) || list[0] || null;
    }

    function safeHref(href) {
        return typeof href === 'string' && href.charAt(0) === '/' && href.charAt(1) !== '/' ? href : null;
    }

    function splitBlockers(items) {
        const list = Array.isArray(items) ? items.filter((i) => i && i.code) : [];
        return {
            blocking: list.filter((i) => i.severity !== 'warn'),
            warnings: list.filter((i) => i.severity === 'warn')
        };
    }

    function validateRequest(reason, confirm) {
        const clean = String(reason == null ? '' : reason).trim();
        if (clean.length > REASON_MAX) return { error: MSG.reasonLong, field: 'reason' };
        if (!isConfirmText(confirm)) return { error: MSG.confirm, field: 'confirm' };
        return { reason: clean || null };
    }

    function fmtDate(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' });
    }

    function errorText(err) {
        const cause = (err && err.cause) || {};
        const msg = String(cause.message || (err && err.message) || '').replace(/^\[[^\]]+\]\s*/, '');
        if (/could not find the function|PGRST202/i.test(msg) || cause.code === 'PGRST202') return MSG.unavailable;
        if (/23505|ya tenés una solicitud/i.test(msg) || cause.code === '23505') return 'Ya tenés una solicitud de baja abierta.';
        if (msg && /[áéíóúñ]|Iniciá|No encontramos|Esta solicitud/i.test(msg)) return msg;
        return MSG.generic;
    }

    function blockerListHtml(items, emptyText) {
        const list = Array.isArray(items) ? items : [];
        if (!list.length) return '<p class="ad-empty">' + esc(emptyText) + '</p>';
        return '<ul class="ad-list">' + list.map((i) => {
            const sev = i.severity === 'warn' ? 'warn' : (i.severity === 'check' ? 'check' : 'block');
            const href = safeHref(i.href);
            const sr = sev === 'warn' ? 'Aviso' : (sev === 'check' ? 'Revisión manual' : 'Bloqueo');
            return '<li class="ad-item ad-item--' + sev + '"><span class="ad-item-mark" aria-hidden="true"></span>'
                + '<p class="ad-item-label"><span class="wo-sr-only">' + sr + ': </span>' + esc(i.label) + '</p>'
                + '<p class="ad-item-detail">' + esc(i.detail || '')
                + (href ? ' <a href="' + esc(href) + '">Ver →</a>' : '') + '</p></li>';
        }).join('') + '</ul>';
    }

    // ---------------- montaje (navegador) ----------------

    function ensureStyles(doc) {
        if (doc.getElementById('ad-style')) return;
        const link = doc.createElement('link');
        link.id = 'ad-style';
        link.rel = 'stylesheet';
        link.href = '/shared/css/account-deletion.css?v=20261113-borrado';
        (doc.head || doc.documentElement).appendChild(link);
    }

    function mount(host, options) {
        const doc = root.document;
        if (!host || !doc || host.__adMounted) return null;
        host.__adMounted = true;
        const role = ['artist', 'client', 'studio'].indexOf(options && options.role) >= 0 ? options.role : 'client';
        // Clases del título y del texto: las del bloque de peligro de cada Cuenta.
        const titleClass = (options && options.titleClass) || 'wo-eyebrow';
        const textClass = (options && options.textClass) || 'ad-status-text';
        const uid = 'ad' + Math.random().toString(36).slice(2, 8);
        const id = (s) => uid + '-' + s;
        const repo = () => root.WeotziData && root.WeotziData.AccountDeletion;
        const state = { request: null, blockers: null, blockersError: false, busy: false, cancelArmed: false };
        ensureStyles(doc);

        host.innerHTML = `
            <div class="ad-box">
                <p class="${esc(titleClass)}">Eliminar cuenta</p>
                <p class="${esc(textClass)}">${esc(ROLE_COPY[role])} Pedís la baja y la revisa soporte antes de borrar nada.</p>
                <div class="ad-status" id="${id('status')}" aria-live="polite" hidden></div>
                <div class="ad-actions">
                    <button type="button" class="wo-btn wo-btn--danger wo-btn--s" id="${id('open')}" aria-haspopup="dialog">Eliminar mi cuenta</button>
                </div>
                <p class="ad-feedback" id="${id('feedback')}" role="status" hidden></p>
            </div>
            <dialog class="ad-dialog" id="${id('dialog')}" aria-labelledby="${id('title')}">
                <form method="dialog" id="${id('form')}" novalidate>
                    <div class="ad-dialog-bar">
                        <h2 class="ad-dialog-title" id="${id('title')}" tabindex="-1">Eliminar mi cuenta</h2>
                        <button type="button" class="ad-dialog-x" data-ad-close aria-label="Cerrar">×</button>
                    </div>
                    <div class="ad-dialog-body">
                        <div>
                            <p class="ad-section-title">Cómo funciona</p>
                            <ol class="ad-steps">
                                <li><strong>Pedís la baja.</strong> Tu cuenta sigue activa mientras la revisamos.</li>
                                <li><strong>Soporte la revisa en hasta ${REVIEW_DAYS} días.</strong> Verifica que no queden disputas abiertas, saldo en el wallet, trabajos o sesiones en curso, pedidos de la Store ni membresías de estudio activas.</li>
                                <li><strong>Te avisamos por email</strong> cuando la aprobamos o si hay algo que resolver antes.</li>
                                <li><strong>Borramos tu cuenta.</strong> Es permanente: no se puede deshacer. Hasta ese momento podés cancelar la solicitud desde acá.</li>
                            </ol>
                        </div>
                        <div>
                            <p class="ad-section-title">Pendientes de tu cuenta hoy</p>
                            <div id="${id('blockers')}" aria-live="polite"><p class="ad-empty">Revisando…</p></div>
                        </div>
                        <div class="wo-field">
                            <label class="wo-label" for="${id('reason')}">Motivo (opcional)</label>
                            <textarea class="wo-input wo-textarea" id="${id('reason')}" rows="3" maxlength="${REASON_MAX}" aria-describedby="${id('reason-help')}"></textarea>
                            <p class="wo-help" id="${id('reason-help')}">Nos ayuda a mejorar. Lo lee solo el equipo de soporte.</p>
                        </div>
                        <div class="wo-field">
                            <label class="wo-label" for="${id('confirm')}">Escribí ${CONFIRM_WORD} para confirmar</label>
                            <input class="wo-input ad-confirm-input" id="${id('confirm')}" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-describedby="${id('confirm-help')}">
                            <p class="wo-help" id="${id('confirm-help')}">Confirmás que entendés que la baja aprobada es permanente.</p>
                        </div>
                        <p class="ad-feedback" id="${id('dialog-feedback')}" role="alert" hidden></p>
                    </div>
                    <div class="ad-dialog-actions">
                        <button type="button" class="wo-btn wo-btn--ghost wo-btn--s" data-ad-close>Volver</button>
                        <button type="submit" class="wo-btn wo-btn--danger wo-btn--s" id="${id('submit')}" disabled>Enviar solicitud</button>
                    </div>
                </form>
            </dialog>`;

        const $ = (s) => doc.getElementById(id(s));
        const dialog = $('dialog');

        function feedback(elId, kind, text) {
            const el = $(elId);
            if (!el) return;
            el.className = 'ad-feedback' + (kind === 'error' ? ' is-error' : '');
            el.textContent = text || '';
            el.hidden = !text;
        }

        function renderStatus() {
            const box = $('status');
            const req = state.request;
            const openBtn = $('open');
            if (!req || (!isOpen(req.status) && req.status !== 'rejected' && req.status !== 'completed')) {
                box.hidden = true;
                box.innerHTML = '';
                openBtn.hidden = false;
                return;
            }
            const meta = statusMeta(req.status);
            const open = isOpen(req.status);
            openBtn.hidden = open;
            const split = splitBlockers(state.blockers || []);
            const pend = open && state.blockers ? `<p class="ad-section-title">Pendientes a resolver</p>${blockerListHtml(split.blocking, 'No encontramos pendientes que impidan la baja.')}` : '';
            box.innerHTML = `
                <div class="ad-status-head">
                    <span class="ad-badge ad-badge--${esc(req.status)}">${esc(meta.label)}</span>
                    <span class="wo-meta wo-muted">Solicitud del ${esc(fmtDate(req.requested_at))}</span>
                </div>
                <p class="ad-status-text">${esc(meta.text)}</p>
                ${req.support_notes && req.status !== 'pending' ? `<p class="ad-note"><strong>Nota de soporte:</strong> ${esc(req.support_notes)}</p>` : ''}
                ${pend}
                ${canCancel(req) ? `<div class="ad-actions"><button type="button" class="wo-btn wo-btn--ghost wo-btn--s" data-ad-cancel>${state.cancelArmed ? 'Confirmar cancelación' : 'Cancelar solicitud'}</button></div>` : ''}`;
            box.hidden = false;
        }

        async function loadBlockers() {
            state.blockersError = false;
            try { state.blockers = await repo().blockers(); } catch (err) {
                console.warn('[account-deletion] bloqueos:', err && err.message);
                state.blockers = null;
                state.blockersError = true;
            }
        }

        function renderDialogBlockers() {
            const box = $('blockers');
            if (state.blockersError) { box.innerHTML = '<p class="ad-empty">' + esc(MSG.blockersError) + '</p>'; return; }
            if (!state.blockers) { box.innerHTML = '<p class="ad-empty">Revisando…</p>'; return; }
            const split = splitBlockers(state.blockers);
            let html = blockerListHtml(split.blocking.concat(split.warnings), 'No encontramos pendientes. Soporte lo vuelve a revisar antes de aprobar.');
            if (split.blocking.length) {
                html += '<p class="wo-alert wo-alert--warning">Podés enviar la solicitud igual: soporte la deja en espera hasta que estos pendientes estén resueltos.</p>';
            }
            box.innerHTML = html;
        }

        async function refresh() {
            const R = repo();
            if (!R || !(await R.isAvailable())) {
                $('open').disabled = true;
                feedback('feedback', '', MSG.unavailable);
                return;
            }
            try {
                state.request = currentRequest(await R.mine());
            } catch (err) {
                console.warn('[account-deletion] estado:', err && err.message);
                feedback('feedback', 'error', MSG.loadError);
            }
            if (state.request && isOpen(state.request.status)) await loadBlockers();
            renderStatus();
        }

        async function openDialog() {
            if (state.busy) return;
            $('reason').value = '';
            $('confirm').value = '';
            $('submit').disabled = true;
            feedback('dialog-feedback', '', '');
            state.blockers = null;
            renderDialogBlockers();
            if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
            try { $('title').focus({ preventScroll: true }); } catch (_) { $('title').focus(); }
            await loadBlockers();
            renderDialogBlockers();
        }

        function closeDialog() {
            if (typeof dialog.close === 'function') dialog.close(); else dialog.removeAttribute('open');
            try { $('open').focus(); } catch (_) { /* sin foco */ }
        }

        async function submit(e) {
            e.preventDefault();
            if (state.busy) return;
            const check = validateRequest($('reason').value, $('confirm').value);
            ['reason', 'confirm'].forEach((f) => $(f).removeAttribute('aria-invalid'));
            if (check.error) {
                const field = $(check.field);
                field.setAttribute('aria-invalid', 'true');
                field.focus();
                feedback('dialog-feedback', 'error', check.error);
                return;
            }
            state.busy = true;
            $('submit').disabled = true;
            feedback('dialog-feedback', '', 'Enviando…');
            try {
                const row = await repo().request(role, check.reason);
                state.request = row || state.request;
                state.cancelArmed = false;
                repo().notify(row && row.id).catch(() => null);
                closeDialog();
                await refresh();
                feedback('feedback', '', MSG.sent);
            } catch (err) {
                console.warn('[account-deletion] solicitud:', err && err.message);
                feedback('dialog-feedback', 'error', errorText(err));
                $('submit').disabled = !isConfirmText($('confirm').value);
            } finally {
                state.busy = false;
            }
        }

        async function cancelRequest(btn) {
            if (state.busy || !canCancel(state.request)) return;
            if (!state.cancelArmed) {
                state.cancelArmed = true;
                renderStatus();
                feedback('feedback', '', MSG.cancelAsk);
                const again = host.querySelector('[data-ad-cancel]');
                if (again) again.focus();
                return;
            }
            state.busy = true;
            if (btn) btn.disabled = true;
            try {
                state.request = await repo().cancel(state.request.id) || state.request;
                state.cancelArmed = false;
                await refresh();
                feedback('feedback', '', MSG.cancelled);
                $('open').focus();
            } catch (err) {
                feedback('feedback', 'error', errorText(err));
            } finally {
                state.busy = false;
            }
        }

        $('open').addEventListener('click', openDialog);
        $('form').addEventListener('submit', submit);
        $('confirm').addEventListener('input', (e) => { $('submit').disabled = !isConfirmText(e.target.value); });
        dialog.addEventListener('click', (e) => {
            if (e.target.closest('[data-ad-close]')) { e.preventDefault(); closeDialog(); }
        });
        host.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-ad-cancel]');
            if (btn) cancelRequest(btn);
        });

        refresh();
        return { refresh, open: openDialog, state };
    }

    // Montaje automático: <div data-account-deletion="client" data-title-class="…" data-text-class="…">.
    function autoMount() {
        const doc = root.document;
        if (!doc) return;
        doc.querySelectorAll('[data-account-deletion]').forEach((el) => {
            if (el.__adMounted || el.dataset.adManual === '1') return;
            mount(el, { role: el.dataset.accountDeletion, titleClass: el.dataset.titleClass, textClass: el.dataset.textClass });
        });
    }
    if (root && root.document) {
        if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', autoMount);
        else root.setTimeout(autoMount, 0);
    }

    return {
        mount,
        autoMount,
        _internal: { CONFIRM_WORD, REVIEW_DAYS, OPEN, STATUS_META, ROLE_COPY, MSG, esc, isConfirmText, isOpen, canCancel,
            statusMeta, currentRequest, safeHref, splitBlockers, validateRequest, errorText, blockerListHtml }
    };
}));
