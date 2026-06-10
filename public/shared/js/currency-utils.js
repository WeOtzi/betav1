/**
 * WeOtziCurrency - Frontend currency utility.
 *
 * Loads the active currencies catalog from /api/currencies (cached in-memory
 * and in localStorage), exposes conversion + Intl-formatted display helpers,
 * and persists the user's preferred display currency.
 *
 * Display preference values:
 *   'local' (default) -> show amount in the original currency stored on the record
 *   'USD' / 'EUR' / any 3-letter code -> always convert to that currency for display
 *
 * Usage:
 *   await window.WeOtziCurrency.init();
 *   WeOtziCurrency.format(500, 'ARS')                    // "$ 500,00"
 *   WeOtziCurrency.convert(500, 'ARS', 'USD')            // 0.38 (number)
 *   WeOtziCurrency.formatForDisplay(500, 'ARS')          // respects preference
 *   WeOtziCurrency.setDisplayPreference('USD')           // emits weotzi:currency-changed
 *
 * Events:
 *   document.dispatchEvent(new CustomEvent('weotzi:currency-changed', { detail: { code } }))
 */
(function (window) {
    'use strict';

    var STORAGE_KEY = 'weotzi.displayCurrency';
    var CACHE_KEY   = 'weotzi.currencies.v1';
    var CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h client-side

    var FALLBACK_CATALOG = [
        { code: 'USD', name: 'US Dollar',     symbol: '$',  decimals: 2, units_per_usd: 1,    units_per_eur: 0.92, is_active: true },
        { code: 'EUR', name: 'Euro',          symbol: '€',  decimals: 2, units_per_usd: 1.09, units_per_eur: 1,    is_active: true },
        { code: 'ARS', name: 'Argentine Peso',symbol: '$',  decimals: 2, units_per_usd: 1300, units_per_eur: 1430, is_active: true },
        { code: 'MXN', name: 'Mexican Peso',  symbol: '$',  decimals: 2, units_per_usd: 17,   units_per_eur: 18.5, is_active: true },
        { code: 'BRL', name: 'Brazilian Real',symbol: 'R$', decimals: 2, units_per_usd: 5.0,  units_per_eur: 5.5,  is_active: true },
        { code: 'CLP', name: 'Chilean Peso',  symbol: '$',  decimals: 0, units_per_usd: 950,  units_per_eur: 1040, is_active: true },
        { code: 'COP', name: 'Colombian Peso',symbol: '$',  decimals: 2, units_per_usd: 4000, units_per_eur: 4400, is_active: true },
        { code: 'PEN', name: 'Peruvian Sol',  symbol: 'S/', decimals: 2, units_per_usd: 3.7,  units_per_eur: 4.05, is_active: true },
        { code: 'UYU', name: 'Uruguayan Peso',symbol: '$U', decimals: 2, units_per_usd: 39,   units_per_eur: 42.7, is_active: true },
        { code: 'GBP', name: 'Pound Sterling',symbol: '£',  decimals: 2, units_per_usd: 0.79, units_per_eur: 0.86, is_active: true }
    ];

    var state = {
        byCode: {},
        list: [],
        ready: false,
        initPromise: null,
        loadedAt: 0
    };

    function _seedCatalog(arr) {
        state.byCode = {};
        state.list = [];
        (arr || []).forEach(function (c) {
            if (!c || !c.code) return;
            var entry = {
                code: String(c.code).toUpperCase(),
                name: c.name || c.code,
                symbol: c.symbol || null,
                decimals: typeof c.decimals === 'number' ? c.decimals : 2,
                units_per_usd: Number(c.units_per_usd) || null,
                units_per_eur: Number(c.units_per_eur) || null,
                is_active: c.is_active !== false,
                last_updated_at: c.last_updated_at || null,
                source: c.source || null
            };
            state.byCode[entry.code] = entry;
            state.list.push(entry);
        });
        state.list.sort(function (a, b) { return a.code.localeCompare(b.code); });
        state.ready = state.list.length > 0;
    }

    function _readStorage() {
        try {
            var raw = window.localStorage.getItem(CACHE_KEY);
            if (!raw) return null;
            var obj = JSON.parse(raw);
            if (!obj || !obj.fetchedAt || !Array.isArray(obj.list)) return null;
            if (Date.now() - obj.fetchedAt > CACHE_TTL_MS) return null;
            return obj;
        } catch (e) { return null; }
    }

    function _writeStorage() {
        try {
            window.localStorage.setItem(CACHE_KEY, JSON.stringify({
                fetchedAt: state.loadedAt,
                list: state.list
            }));
        } catch (e) { /* quota or disabled */ }
    }

    function _fetchFromServer() {
        return fetch('/api/currencies', { credentials: 'same-origin' })
            .then(function (res) {
                if (!res.ok) throw new Error('GET /api/currencies failed: ' + res.status);
                return res.json();
            })
            .then(function (data) {
                if (!data || !Array.isArray(data.currencies) || data.currencies.length === 0) {
                    throw new Error('Empty currencies response');
                }
                _seedCatalog(data.currencies);
                state.loadedAt = Date.now();
                _writeStorage();
                return state.list;
            });
    }

    function init(opts) {
        opts = opts || {};
        if (state.initPromise && !opts.force) return state.initPromise;

        if (!opts.force) {
            var cached = _readStorage();
            if (cached) {
                _seedCatalog(cached.list);
                state.loadedAt = cached.fetchedAt;
                state.initPromise = Promise.resolve(state.list);
                // Refresh in background if older than 1h
                if (Date.now() - cached.fetchedAt > 60 * 60 * 1000) {
                    _fetchFromServer().catch(function () { /* keep cached */ });
                }
                return state.initPromise;
            }
        }

        // Seed fallback so callers never get a fully-empty catalog
        if (!state.ready) _seedCatalog(FALLBACK_CATALOG);

        state.initPromise = _fetchFromServer().catch(function (err) {
            console.warn('[WeOtziCurrency] Falling back to seed catalog:', err.message);
            return state.list;
        });
        return state.initPromise;
    }

    function list() {
        return state.list.slice();
    }

    function get(code) {
        if (!code) return null;
        return state.byCode[String(code).toUpperCase()] || null;
    }

    function isReady() {
        return state.ready;
    }

    /**
     * Convert an amount between currencies. Returns null if either code is unknown.
     */
    function convert(amount, fromCode, toCode) {
        if (amount === null || amount === undefined || amount === '') return null;
        var num = typeof amount === 'number' ? amount : parseFloat(String(amount).replace(/[^0-9.\-]/g, ''));
        if (!isFinite(num)) return null;
        var from = get(fromCode);
        var to = get(toCode);
        if (!from || !to || !from.units_per_usd || !to.units_per_usd) return null;
        if (from.code === to.code) return Math.round(num * 100) / 100;
        var amountUsd = num / from.units_per_usd;
        var converted = amountUsd * to.units_per_usd;
        return Math.round(converted * 100) / 100;
    }

    /**
     * Format an amount with Intl.NumberFormat. Falls back to a manual symbol
     * prefix when the locale does not know the code.
     */
    function format(amount, currencyCode, opts) {
        opts = opts || {};
        if (amount === null || amount === undefined || amount === '') return opts.empty || '—';
        var num = typeof amount === 'number' ? amount : parseFloat(String(amount).replace(/[^0-9.\-]/g, ''));
        if (!isFinite(num)) return opts.empty || '—';
        var code = (currencyCode || 'USD').toString().toUpperCase();
        var meta = get(code);
        var decimals = typeof opts.decimals === 'number'
            ? opts.decimals
            : (meta ? meta.decimals : 2);
        try {
            return new Intl.NumberFormat(opts.locale || (navigator.language || 'en-US'), {
                style: 'currency',
                currency: code,
                minimumFractionDigits: decimals,
                maximumFractionDigits: decimals
            }).format(num);
        } catch (e) {
            var symbol = (meta && meta.symbol) || code + ' ';
            return symbol + num.toFixed(decimals);
        }
    }

    function getDisplayPreference() {
        try {
            var v = window.localStorage.getItem(STORAGE_KEY);
            return v && /^[A-Z]{3}$|^local$/i.test(v) ? v : 'local';
        } catch (e) { return 'local'; }
    }

    function setDisplayPreference(code) {
        var value = code === 'local' ? 'local' : String(code || '').toUpperCase();
        if (!/^[A-Z]{3}$/.test(value) && value !== 'local') return false;
        try { window.localStorage.setItem(STORAGE_KEY, value); } catch (e) { /* ignore */ }
        try {
            document.dispatchEvent(new CustomEvent('weotzi:currency-changed', {
                detail: { code: value }
            }));
        } catch (e) { /* legacy browsers */ }
        return true;
    }

    /**
     * Resolve which currency to actually display, given the preference and
     * the original currency code stored on the record.
     */
    function resolveDisplayCurrency(originalCode) {
        var pref = getDisplayPreference();
        if (pref === 'local') return (originalCode || 'USD').toUpperCase();
        return pref;
    }

    /**
     * Format an amount for display, honouring the user preference.
     * Returns an object so callers can render rich UIs (primary + secondary).
     *
     *   { primary: "AR$ 500,00", secondary: "≈ US$ 0.38", currency: 'ARS', original: 'ARS' }
     *
     * If preference == 'local' or original currency matches preference, no
     * secondary is returned. Pass opts.showSecondary = false to suppress it.
     */
    function formatForDisplay(amount, originalCode, opts) {
        opts = opts || {};
        var original = (originalCode || 'USD').toString().toUpperCase();
        var target = resolveDisplayCurrency(original);
        var primaryAmount = amount;
        var primaryCode = target;

        if (target !== original) {
            var converted = convert(amount, original, target);
            if (converted === null) {
                primaryAmount = amount;
                primaryCode = original;
            } else {
                primaryAmount = converted;
            }
        }

        var result = {
            primary: format(primaryAmount, primaryCode, opts),
            currency: primaryCode,
            original: original,
            originalAmount: amount,
            convertedAmount: primaryAmount
        };

        if (opts.showSecondary !== false && target !== original && primaryCode === target) {
            result.secondary = '≈ ' + format(amount, original, { decimals: opts.secondaryDecimals });
        }

        return result;
    }

    /**
     * Helper for inline rendering: returns a single string with optional
     * conversion in parentheses.
     */
    function formatInline(amount, originalCode, opts) {
        var info = formatForDisplay(amount, originalCode, opts);
        if (info.secondary) return info.primary + ' (' + info.secondary + ')';
        return info.primary;
    }

    // ----------------------------------------------------------------------
    // Currency switcher widget
    // ----------------------------------------------------------------------
    // Renders a compact dropdown the user can use to choose how prices are
    // displayed across the app. Mount inside any container or call mount()
    // with no argument to auto-create a floating control bottom-right.

    var WIDGET_CSS_ID = 'weotzi-currency-widget-css';
    var WIDGET_CSS = ''
        + '.weotzi-currency-widget {'
        + '  --wo-currency-bg: color-mix(in srgb, var(--bg, #F2F0E9) 92%, white);'
        + '  --wo-currency-fg: var(--fg, #0A0A0A);'
        + '  --wo-currency-accent: var(--bauhaus-yellow, #F5C518);'
        + '  --wo-currency-muted: var(--text-secondary, #6b6b75);'
        + '  display: inline-flex; align-items: center; gap: 8px;'
        + '  font-family: "Space Mono", "JetBrains Mono", monospace;'
        + '  font-size: 11px; line-height: 1; color: var(--wo-currency-fg);'
        + '  isolation: isolate;'
        + '}'
        + '.weotzi-currency-widget::before {'
        + '  content: ""; width: 9px; height: 9px; border-radius: 50%;'
        + '  background: var(--wo-currency-accent); border: 1px solid var(--wo-currency-fg);'
        + '  box-shadow: 2px 2px 0 var(--wo-currency-fg); flex: 0 0 auto;'
        + '}'
        + '.weotzi-currency-widget label {'
        + '  text-transform: uppercase; letter-spacing: 0.08em; color: var(--wo-currency-muted);'
        + '  font-weight: 800; white-space: nowrap;'
        + '}'
        + '.weotzi-currency-widget select {'
        + '  font: inherit; font-weight: 900; min-width: 78px;'
        + '  padding: 7px 28px 7px 10px; border: 1.5px solid var(--wo-currency-fg);'
        + '  background-color: var(--wo-currency-bg); color: inherit; border-radius: 999px;'
        + '  cursor: pointer; appearance: none; -webkit-appearance: none;'
        + '  background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2210%22 height=%226%22 viewBox=%220 0 10 6%22%3E%3Cpath fill=%22%230A0A0A%22 d=%22M0 0l5 6 5-6z%22/%3E%3C/svg%3E");'
        + '  background-repeat: no-repeat; background-position: right 11px center;'
        + '  transition: transform 120ms ease, box-shadow 120ms ease, background-color 120ms ease;'
        + '}'
        + '.weotzi-currency-widget select:hover, .weotzi-currency-widget select:focus {'
        + '  outline: none; transform: translate(-1px, -1px); box-shadow: 3px 3px 0 var(--wo-currency-fg);'
        + '}'
        + '.weotzi-currency-widget select:focus-visible {'
        + '  outline: 2px solid var(--wo-currency-accent); outline-offset: 3px;'
        + '}'
        + '.weotzi-currency-widget--floating {'
        + '  position: fixed; bottom: 18px; left: 18px; z-index: 9000;'
        + '  background: var(--wo-currency-bg); padding: 9px 10px 9px 12px;'
        + '  border: 1.5px solid var(--wo-currency-fg); border-radius: 999px;'
        + '  box-shadow: 5px 5px 0 var(--wo-currency-fg); backdrop-filter: blur(8px);'
        + '}'
        + '.weotzi-currency-widget--floating:hover {'
        + '  box-shadow: 6px 6px 0 var(--wo-currency-fg);'
        + '}'
        + '@media (max-width: 640px) {'
        + '  .weotzi-currency-widget--floating { bottom: 12px; left: 12px; padding: 8px 9px 8px 10px; }'
        + '  .weotzi-currency-widget label { display: none; }'
        + '  .weotzi-currency-widget::before { width: 8px; height: 8px; }'
        + '}';

    function _ensureCss() {
        if (document.getElementById(WIDGET_CSS_ID)) return;
        var style = document.createElement('style');
        style.id = WIDGET_CSS_ID;
        style.textContent = WIDGET_CSS;
        document.head.appendChild(style);
    }

    function _buildWidget(opts) {
        opts = opts || {};
        _ensureCss();
        var wrap = document.createElement('div');
        wrap.className = 'weotzi-currency-widget' + (opts.floating ? ' weotzi-currency-widget--floating' : '');
        wrap.setAttribute('data-weotzi-currency-widget', '');

        var lbl = document.createElement('label');
        lbl.textContent = opts.label || 'Mostrar en';
        lbl.htmlFor = 'weotzi-currency-select';
        wrap.appendChild(lbl);

        var select = document.createElement('select');
        select.id = 'weotzi-currency-select';
        select.setAttribute('aria-label', 'Display currency preference');

        function rebuildOptions() {
            select.innerHTML = '';
            var optLocal = document.createElement('option');
            optLocal.value = 'local';
            optLocal.textContent = 'Local';
            select.appendChild(optLocal);
            var seen = { LOCAL: true };
            var preferred = ['USD', 'EUR'];
            preferred.forEach(function (code) {
                if (state.byCode[code]) {
                    var opt = document.createElement('option');
                    opt.value = code;
                    opt.textContent = code;
                    select.appendChild(opt);
                    seen[code] = true;
                }
            });
            state.list.forEach(function (c) {
                if (seen[c.code]) return;
                var opt = document.createElement('option');
                opt.value = c.code;
                opt.textContent = c.code;
                select.appendChild(opt);
            });
            select.value = getDisplayPreference();
        }

        rebuildOptions();
        wrap.appendChild(select);

        select.addEventListener('change', function () {
            setDisplayPreference(select.value);
            // Reload the current page so all renderers pick up the new preference.
            // This is the simplest correct option given how many places format prices.
            if (opts.reloadOnChange !== false) {
                setTimeout(function () { window.location.reload(); }, 50);
            }
        });

        // Refresh options when catalog (re)loads
        document.addEventListener('weotzi:currencies-loaded', rebuildOptions);

        return wrap;
    }

    function mount(target, opts) {
        opts = opts || {};
        var node = _buildWidget(opts);
        if (target && typeof target === 'string') target = document.querySelector(target);
        if (target && target.appendChild) {
            target.appendChild(node);
        } else {
            opts.floating = true;
            node = _buildWidget(opts);
            document.body.appendChild(node);
        }
        return node;
    }

    function _autoMount() {
        // Skip on auth/landing pages where prices are not shown.
        var skipPaths = [/\/quotation(\/|$)/, /\/registerclosedbeta/, /\/register-artist/,
                         /\/client\/(login|register)/, /\/artist\/login/, /\/support\/login/, /\/tutorial/];
        var path = window.location.pathname;
        if (skipPaths.some(function (re) { return re.test(path); })) return;

        // If the page declares its own mount target, use it; otherwise float bottom-right.
        var explicit = document.querySelector('[data-weotzi-currency-mount]');
        if (explicit) {
            mount(explicit, { floating: false });
        } else {
            mount(null, { floating: true });
        }
    }

    var api = {
        init: init,
        isReady: isReady,
        list: list,
        get: get,
        convert: convert,
        format: format,
        formatForDisplay: formatForDisplay,
        formatInline: formatInline,
        getDisplayPreference: getDisplayPreference,
        setDisplayPreference: setDisplayPreference,
        resolveDisplayCurrency: resolveDisplayCurrency,
        mount: mount,
        STORAGE_KEY: STORAGE_KEY
    };

    window.WeOtziCurrency = api;

    function _bootstrap() {
        init().then(function () {
            try {
                document.dispatchEvent(new CustomEvent('weotzi:currencies-loaded', {
                    detail: { count: state.list.length }
                }));
            } catch (e) { /* ignore */ }
            _autoMount();
        }).catch(function () { _autoMount(); });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _bootstrap);
    } else {
        _bootstrap();
    }
})(window);
