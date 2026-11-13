/**
 * WE ÖTZI — Editor de etapa y fecha límite del diseño (ronda 3 · P12)
 * --------------------------------------------------------------------
 * El Figma (24:1425) muestra en cada tarjeta de "Diseños en proceso" la etapa
 * (BOCETO / ENTINTADO / FINAL) y la fecha LÍMITE, pero no tiene frame para
 * cargarlas. Diseño propio con el lenguaje del modal de recordatorios
 * (801:563 / 801:1109): cabecera ink con caption amarillo, selector
 * segmentado de 3 opciones, fecha con el control propio del DS y pie con
 * CANCELAR / GUARDAR ETAPA.
 *
 * Guarda con WeotziData.DesignStage.set → RPC set_quotation_design_stage
 * (security definer: solo el artista dueño o soporte).
 *
 * API: window.DesignStageEditor.open({ quote, title, trigger, onSaved })
 *      window.DesignStageEditor.close()
 * Requiere dashboard-live-model.js y data/dashboard-repo.js.
 */
(function () {
    'use strict';

    var st = { ov: null, opts: null, stage: null, busy: false };

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function model() { return window.DashboardLiveModel; }

    function placeBelowTopbar() {
        var bar = document.querySelector('weotzi-product-nav .wo-org-product-nav') || document.querySelector('weotzi-product-nav');
        var bottom = bar ? Math.max(0, bar.getBoundingClientRect().bottom) : 0;
        document.documentElement.style.setProperty('--wod-drawer-top', Math.round(bottom) + 'px');
    }

    function ensureOverlay() {
        if (st.ov) return st.ov;
        var ov = document.createElement('div');
        ov.className = 'wod-ov wod-stage-ov';
        ov.hidden = true;
        ov.addEventListener('mousedown', function (e) { if (e.target === ov) close(); });
        ov.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
            if (e.key === 'Tab') trapFocus(e);
        });
        document.body.appendChild(ov);
        st.ov = ov;
        return ov;
    }

    function trapFocus(e) {
        var nodes = Array.prototype.filter.call(
            st.ov.querySelectorAll('button, input, [tabindex]:not([tabindex="-1"])'),
            function (n) { return !n.disabled && n.offsetParent !== null; }
        );
        if (!nodes.length) return;
        var first = nodes[0], last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }

    function segHtml(current) {
        return '<div class="wod-seg wod-seg--3" role="radiogroup" aria-labelledby="wds-stage-l" data-seg="design-stage">' +
            model().DESIGN_STAGES.map(function (s) {
                var on = s.key === current;
                return '<button type="button" role="radio" aria-checked="' + on + '" tabindex="' + (on || (!current && s.key === 'boceto') ? '0' : '-1') +
                    '" class="wod-seg-btn' + (on ? ' is-on' : '') + '" data-value="' + s.key + '">' + esc(s.label) + '</button>';
            }).join('') + '</div>';
    }

    function open(opts) {
        var M = model();
        var D = window.WeotziData;
        if (!M || !D || !D.DesignStage || !opts || !opts.quote) return;
        st.opts = opts;
        st.stage = M.normalizeStage(opts.quote.design_stage);
        st.busy = false;
        var due = opts.quote.design_due_date ? String(opts.quote.design_due_date).slice(0, 10) : '';
        var html =
            '<div class="wod-modal wod-modal--stage" role="dialog" aria-modal="true" tabindex="-1" aria-labelledby="wds-cap">' +
                '<header class="wod-modal-head"><p class="wod-modal-cap" id="wds-cap">ETAPA DEL DISEÑO</p>' +
                    '<button type="button" class="wod-modal-x" data-close aria-label="Cerrar"><i data-wo-icon="x"></i></button></header>' +
                '<form class="wod-modal-body wod-form" novalidate>' +
                    '<p class="wod-stage-title">' + esc(opts.title || 'Diseño') + '</p>' +
                    '<p class="wod-stage-help">Marcá en qué punto está el diseño y hasta cuándo tenés para terminarlo. Solo lo ves vos.</p>' +
                    '<p class="wod-label" id="wds-stage-l">ETAPA</p>' +
                    segHtml(st.stage) +
                    '<label class="wod-label" for="wds-due">FECHA LÍMITE</label>' +
                    '<input class="wod-input" type="date" id="wds-due" name="due" value="' + esc(due) + '">' +
                    '<p class="wod-stage-hint">Sin fecha límite, la tarjeta muestra la próxima sesión agendada.</p>' +
                    '<p class="wod-form-error" role="alert" hidden></p>' +
                    '<footer class="wod-modal-foot">' +
                        (st.stage || due ? '<button type="button" class="wod-btn is-ghost wod-foot-left" data-clear>QUITAR ETAPA</button>' : '') +
                        '<button type="button" class="wod-btn is-ghost" data-close>CANCELAR</button>' +
                        '<button type="submit" class="wod-btn is-accent">GUARDAR ETAPA</button>' +
                    '</footer>' +
                '</form>' +
            '</div>';
        placeBelowTopbar();
        var ov = ensureOverlay();
        ov.innerHTML = html;
        ov.hidden = false;
        document.body.classList.add('wod-modal-open');
        if (window.WoIcons) window.WoIcons.hydrate(ov);
        if (window.WoControls && typeof window.WoControls.enhance === 'function') {
            try { window.WoControls.enhance(ov); } catch (e) { /* control nativo */ }
        }
        wire(ov);
        var first = ov.querySelector('.wod-seg-btn[tabindex="0"]') || ov.querySelector('.wod-modal');
        setTimeout(function () { try { first.focus(); } catch (e) { /* noop */ } }, 30);
    }

    function selectStage(group, btn) {
        st.stage = btn ? btn.getAttribute('data-value') : null;
        group.querySelectorAll('[data-value]').forEach(function (b) {
            var on = b === btn;
            b.classList.toggle('is-on', on);
            b.setAttribute('aria-checked', on ? 'true' : 'false');
            b.setAttribute('tabindex', on ? '0' : '-1');
        });
    }

    function wire(ov) {
        var form = ov.querySelector('form');
        var group = ov.querySelector('[data-seg="design-stage"]');
        ov.querySelectorAll('[data-close]').forEach(function (b) { b.addEventListener('click', close); });
        group.addEventListener('click', function (e) {
            var btn = e.target.closest('[data-value]');
            if (btn) selectStage(group, btn);
        });
        // Radiogroup con flechas (patrón ARIA).
        group.addEventListener('keydown', function (e) {
            if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].indexOf(e.key) === -1) return;
            e.preventDefault();
            var btns = Array.prototype.slice.call(group.querySelectorAll('[data-value]'));
            var i = btns.indexOf(document.activeElement);
            var step = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1 : -1;
            var next = btns[(i + step + btns.length) % btns.length];
            selectStage(group, next);
            next.focus();
        });
        var clear = ov.querySelector('[data-clear]');
        if (clear) clear.addEventListener('click', function () { save(form, { stage: null, due: null }); });
        form.addEventListener('submit', function (e) {
            e.preventDefault();
            save(form, { stage: st.stage, due: form.querySelector('[name="due"]').value });
        });
    }

    function showError(form, msg) {
        var box = form.querySelector('.wod-form-error');
        if (!box) return;
        box.textContent = msg;
        box.hidden = !msg;
    }

    function save(form, input) {
        if (st.busy) return;
        var M = model();
        var v = M.validateDesignStage(input);
        if (!v.ok) { showError(form, v.error); return; }
        st.busy = true;
        showError(form, '');
        var btns = form.querySelectorAll('button');
        btns.forEach(function (b) { b.disabled = true; });
        var quote = st.opts.quote;
        var onSaved = st.opts.onSaved;
        window.WeotziData.DesignStage.set(quote.id, { stage: v.stage, due: v.due })
            .then(function (row) {
                var saved = {
                    design_stage: row && 'design_stage' in row ? row.design_stage : v.stage,
                    design_due_date: row && 'design_due_date' in row ? row.design_due_date : v.due
                };
                close({ restoreFocus: false });
                if (typeof onSaved === 'function') onSaved(saved);
                toast(saved.design_stage ? 'Etapa guardada.' : 'Quitaste la etapa del diseño.');
            })
            .catch(function (err) {
                console.warn('[design-stage] save', err);
                st.busy = false;
                btns.forEach(function (b) { b.disabled = false; });
                var msg = String((err && err.message) || '');
                showError(form, /42501|permission|Solo el artista/i.test(msg)
                    ? 'No podés cambiar la etapa de esta cotización.'
                    : /function|does not exist|PGRST202/i.test(msg)
                        ? 'Esta función todavía no está disponible. Probá más tarde.'
                        : 'No pudimos guardar la etapa. Probá de nuevo.');
            });
    }

    function toast(msg) {
        // Mismo toast que los recordatorios del dashboard (dashboard-reminders.js).
        if (typeof window.WodToast === 'function') { try { window.WodToast(msg); return; } catch (e) { /* sigue */ } }
        var live = document.getElementById('wds-live');
        if (!live) {
            live = document.createElement('p');
            live.id = 'wds-live';
            live.className = 'wo-sr-only';
            live.setAttribute('aria-live', 'polite');
            document.body.appendChild(live);
        }
        live.textContent = msg;
    }

    function close(opts) {
        if (!st.ov || st.ov.hidden) return;
        st.ov.hidden = true;
        st.ov.innerHTML = '';
        document.body.classList.remove('wod-modal-open');
        var trigger = st.opts && st.opts.trigger;
        st.opts = null;
        st.busy = false;
        if ((!opts || opts.restoreFocus !== false) && trigger && document.contains(trigger)) {
            try { trigger.focus(); } catch (e) { /* noop */ }
        }
    }

    window.DesignStageEditor = { open: open, close: close };
}());
