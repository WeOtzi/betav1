/**
 * WE OTZI - Piezas de interfaz del panel del cliente (ronda 2 · frente cliente-panel)
 * -------------------------------------------------------------------------------
 * Pegamento entre el modelo puro (client-panel-model.js · WoClientPanel) y las
 * páginas del cliente. No pinta tarjetas: eso lo siguen haciendo
 * client-dashboard.js y client-requests.js.
 *
 *   - Buscador de cotizaciones del dashboard (#cpn-quote-search, en vivo) y
 *     atajo "buscar por código" de los accesos rápidos (#cpn-quick-search).
 *   - Datos extra para las etiquetas de estado, sin tocar "Tu actividad":
 *       · sesiones del cliente (RPC list_client_quotation_sessions, con
 *         client_confirmation y pending_change_by) → "Sesión por confirmar";
 *       · propuestas pendientes de negociación (quotation_proposals) →
 *         "Cambios propuestos por ti" y "Cambios al acuerdo pendientes de aprobar".
 *   - Acciones de los estados vacíos ([data-cpn-action]).
 *   - Carga, si existe, del módulo de favoritos para los botones que el panel
 *     deja preparados: [data-wo-favorite] → el cargador de config-manager.js
 *     (WoFavoritesLoader: modelo y módulo, en ese orden). Si el módulo no está,
 *     el botón no se ve. El panel del cliente no tiene botón de denuncia: las
 *     denuncias (wo-report.js) son de artistas y dueños de estudio.
 *
 * Carga: DESPUÉS de client-panel-model.js. En el dashboard, ANTES de
 * client-dashboard.js. Expone window.WoClientPanelUi.
 */
(function () {
    'use strict';

    var MAX_TERM = 80;
    var state = {
        term: '',
        sessionsByQuotationId: {},
        proposalByQuotationId: {},
        lastShown: [],
        modules: {}
    };

    function model() { return window.WoClientPanel || null; }
    function $(id) { return document.getElementById(id); }

    function call(name) {
        var fn = window[name];
        if (typeof fn !== 'function') return undefined;
        return fn.apply(null, Array.prototype.slice.call(arguments, 1));
    }

    function appPath(path) {
        var base = window.WEOTZI_BASE_PATH
            ? String(window.WEOTZI_BASE_PATH).replace(/\/$/, '')
            : (/^\/beta(?:\/|$)/.test(String((window.location && window.location.pathname) || '')) ? '/beta' : '');
        return base && String(path).indexOf(base + '/') !== 0 ? base + path : path;
    }

    // ------------------------------------------------------------------
    // Buscador de cotizaciones (dashboard)
    // ------------------------------------------------------------------
    function getSearch() { return state.term; }

    function syncInputs(source) {
        ['cpn-quote-search', 'cpn-quick-search-input'].forEach(function (id) {
            var input = $(id);
            if (input && input !== source && input.value !== state.term) input.value = state.term;
        });
        var clear = $('cpn-quote-search-clear');
        if (clear) clear.hidden = !state.term;
    }

    function setSearch(value, source) {
        state.term = String(value == null ? '' : value).trim().slice(0, MAX_TERM);
        syncInputs(source || null);
        // Con texto se busca en todas las cotizaciones (pestaña "Todas").
        if (state.term) call('filterQuotations', 'all');
        else call('renderQuotations');
        if (!state.term) afterRender({ shown: state.lastShown });
    }

    // Lo llama client-dashboard.js al terminar de pintar el listado.
    function afterRender(info) {
        state.lastShown = (info && info.shown) || [];
        var count = $('cpn-search-count');
        if (!count) return;
        var n = state.lastShown.length;
        count.textContent = state.term ? (n === 1 ? '1 resultado' : n + ' resultados') : '';
    }

    function exactCodeMatches(term) {
        var M = model();
        if (!M) return [];
        var wanted = M.codeNorm(term);
        if (!wanted) return [];
        return state.lastShown.filter(function (q) {
            return M.codeNorm(M.shortCode(q)) === wanted || M.codeNorm(q.quote_id) === wanted;
        });
    }

    function submitQuickSearch(event) {
        event.preventDefault();
        var input = $('cpn-quick-search-input');
        var term = input ? input.value : '';
        setSearch(term, null);
        call('revealQuotationsPanel');
        if (!state.term) return;
        // Un código exacto abre directamente esa cotización.
        var exact = exactCodeMatches(state.term);
        if (exact.length === 1) {
            call('viewQuotationDetail', exact[0].quote_id);
            return;
        }
        var panelInput = $('cpn-quote-search');
        if (panelInput && typeof panelInput.focus === 'function') panelInput.focus({ preventScroll: true });
    }

    function wireSearch() {
        var input = $('cpn-quote-search');
        if (input) {
            var timer = null;
            input.addEventListener('input', function () {
                if (timer) clearTimeout(timer);
                timer = setTimeout(function () { setSearch(input.value, input); }, 150);
            });
            input.addEventListener('keydown', function (e) {
                if (e.key === 'Escape' && input.value) {
                    e.stopPropagation();
                    setSearch('', null);
                }
            });
        }
        var clear = $('cpn-quote-search-clear');
        if (clear) {
            clear.addEventListener('click', function () {
                setSearch('', null);
                if (input) input.focus();
            });
        }
        var quick = $('cpn-quick-search');
        if (quick) quick.addEventListener('submit', submitQuickSearch);
    }

    // ------------------------------------------------------------------
    // Datos extra para las etiquetas (sesiones y negociación)
    // ------------------------------------------------------------------
    // Contexto que entiende WoClientPanel.statusOf:
    //   sessions                → "Sesión por confirmar"
    //   counterBy               → "Cambios propuestos por ti" (contrapropuesta pendiente)
    //   agreementChangePending  → "Cambios al acuerdo pendientes de aprobar" (+ agreementChangeBy)
    function extrasFor(q) {
        var out = {};
        if (!q || q.id == null) return out;
        var sessions = state.sessionsByQuotationId[q.id];
        if (sessions) out.sessions = sessions;
        var proposal = state.proposalByQuotationId[q.id];
        if (proposal) {
            if (proposal.kind === 'counter') out.counterBy = proposal.proposed_by;
            else if (proposal.kind === 'amendment') {
                out.agreementChangePending = true;
                out.agreementChangeBy = proposal.proposed_by;
            }
        }
        return out;
    }

    // Etiquetas de la ronda 2 que hoy le tocan a cada cotización (para saber si cambió algo).
    function overlaySignature(list) {
        var M = model();
        if (!M) return '';
        return list.map(function (q) { return M.statusOf(q, extrasFor(q)).overlay || ''; }).join('|');
    }

    // Una lectura que falla no tumba la otra: se conserva lo que ya había.
    function settle(label, promise) {
        return Promise.resolve(promise).then(
            function (rows) { return { ok: true, rows: rows || [] }; },
            function (err) {
                console.warn('[client-panel] no pudimos leer ' + label + ':', err && err.message);
                return { ok: false, rows: [] };
            }
        );
    }

    // Devuelve true si alguna etiqueta cambió (el dashboard repinta): apareció
    // una nueva o dejó de corresponder una que estaba pintada.
    function loadExtras(quotations) {
        var list = quotations || [];
        var ids = list.map(function (q) { return q.id; }).filter(function (id) { return id != null; });
        var D = window.WeotziData;
        var hasSessions = !!(D && D.Sessions && typeof D.Sessions.listForClient === 'function');
        var hasProposals = !!(D && D.Proposals && typeof D.Proposals.listPendingByQuotationIds === 'function');
        if (!ids.length || (!hasSessions && !hasProposals)) return Promise.resolve(false);
        var before = overlaySignature(list);
        var reads;
        try {
            reads = [
                hasSessions ? settle('las sesiones', D.Sessions.listForClient(ids)) : Promise.resolve({ ok: false, rows: [] }),
                // Sin la migración de negociación la tabla no existe: el repo devuelve [].
                hasProposals ? settle('las propuestas pendientes', D.Proposals.listPendingByQuotationIds(ids)) : Promise.resolve({ ok: false, rows: [] })
            ];
        } catch (err) {
            console.warn('[client-panel] no pudimos leer los datos extra:', err && err.message);
            return Promise.resolve(false);
        }
        return Promise.all(reads).then(function (results) {
            if (results[0].ok) {
                var sessions = {};
                results[0].rows.forEach(function (s) {
                    if (!s || s.quotation_id == null) return;
                    (sessions[s.quotation_id] = sessions[s.quotation_id] || []).push(s);
                });
                state.sessionsByQuotationId = sessions;
            }
            if (results[1].ok) {
                // Hay una sola propuesta pendiente por cotización; si llegaran dos, gana la más nueva.
                var proposals = {};
                results[1].rows.forEach(function (p) {
                    if (!p || p.quotation_id == null || (p.status && p.status !== 'pending')) return;
                    var prev = proposals[p.quotation_id];
                    if (!prev || Date.parse(p.created_at || 0) >= Date.parse(prev.created_at || 0)) proposals[p.quotation_id] = p;
                });
                state.proposalByQuotationId = proposals;
            }
            return overlaySignature(list) !== before;
        });
    }

    // ------------------------------------------------------------------
    // Estados vacíos: acciones locales
    // ------------------------------------------------------------------
    function onEmptyAction(event) {
        var target = event.target && event.target.closest ? event.target.closest('[data-cpn-action]') : null;
        if (!target || !$('quotations-list') || !$('quotations-list').contains(target)) return;
        var action = target.getAttribute('data-cpn-action');
        if (action === 'clear-search') {
            setSearch('', null);
            var input = $('cpn-quote-search');
            if (input) input.focus();
        } else if (action === 'show-all') {
            call('filterQuotations', 'all');
        }
    }

    // ------------------------------------------------------------------
    // Módulos de otros frentes (favoritos)
    // ------------------------------------------------------------------
    // Solo se pide el script si la página tiene un botón que lo necesita y
    // nadie lo cargó ya. Si el archivo no existe, no pasa nada.
    function ensureModule(file, onReady) {
        if (state.modules[file] === 'ready') { if (onReady) onReady(); return; }
        var present = document.querySelector('script[src*="/' + file + '"]');
        if (present && state.modules[file] !== 'loading') {
            state.modules[file] = 'ready';
            if (onReady) onReady();
            return;
        }
        if (state.modules[file]) return;
        state.modules[file] = 'loading';
        var script = document.createElement('script');
        script.src = appPath('/shared/js/' + file);
        script.async = false;
        script.onload = function () { state.modules[file] = 'ready'; if (onReady) onReady(); };
        script.onerror = function () { state.modules[file] = 'missing'; script.remove(); };
        document.head.appendChild(script);
    }

    // Favoritos: wo-favorites.js necesita wo-favorites-model.js cargado ANTES.
    // El panel pinta los corazones y llama a ensureModules() en la misma tarea,
    // antes de que el MutationObserver del cargador llegue a verlos: si acá se
    // insertara wo-favorites.js, el cargador lo daría por presente y pondría el
    // modelo detrás (el módulo arranca sin modelo y los corazones no aparecen).
    function ensureFavorites() {
        // Un solo cargador: config-manager.js pide CSS + modelo + módulo en orden.
        var loader = window.WoFavoritesLoader;
        if (loader && typeof loader.load === 'function') { loader.load(); return; }
        // Respaldo (página sin config-manager.js): primero el modelo, después el módulo.
        ensureModule('wo-favorites-model.js', function () { ensureModule('wo-favorites.js'); });
    }

    function ensureModules(root) {
        var scope = root && root.querySelector ? root : document;
        if (scope.querySelector('[data-wo-favorite]')) ensureFavorites();
    }

    // ------------------------------------------------------------------
    // Arranque
    // ------------------------------------------------------------------
    function start() {
        wireSearch();
        document.addEventListener('click', onEmptyAction);
        // Llegada desde otra página con /client/dashboard#mis-cotizaciones.
        if (window.location && window.location.hash === '#mis-cotizaciones') call('revealQuotationsPanel');
        ensureModules(document);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();

    window.WoClientPanelUi = {
        getSearch: getSearch,
        setSearch: setSearch,
        afterRender: afterRender,
        extrasFor: extrasFor,
        loadExtras: loadExtras,
        ensureModules: ensureModules,
        appPath: appPath
    };
})();
