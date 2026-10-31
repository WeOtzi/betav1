// ============================================
// Studio Dashboard
// Shell del panel: registro de módulos (window.WeOtziStudioAdmin), pestañas,
// badges, y las pestañas propias Perfil, Sedes, Roster, Spots y Cuenta.
// Operaciones y los módulos nuevos (Inicio, Solicitudes, Contratos, Agenda,
// Materiales, Finanzas, Reportes, Reposición, Tienda) viven en archivos propios
// que se registran en el shell.
// ============================================

(function () {
    'use strict';

    let studio = null;          // studios row
    let supabase = null;
    const sedePickers = [];     // { row, picker, address, locationId, isPrimary }

    // -------------------------------------------------------------
    // Registro de módulos: window.WeOtziStudioAdmin
    // Se crea de forma sincrónica (antes de DOMContentLoaded) para que los
    // módulos cargados después puedan registrarse apenas se evalúan.
    // -------------------------------------------------------------
    const TAB_PATTERN = /^[a-z]+$/;
    const DEFAULT_TAB = 'inicio';

    function normalizeParams(params) {
        if (!params || typeof params !== 'object' || Array.isArray(params)) return {};
        const out = {};
        Object.keys(params).forEach(key => { if (params[key] !== undefined) out[key] = params[key]; });
        return out;
    }

    function paramsKey(params) {
        return JSON.stringify(Object.keys(params).sort().map(key => [key, params[key]]));
    }

    // env abstrae el DOM (pestañas, paneles, hash, badges) para poder testear
    // el registro sin navegador. Ver domEnv más abajo.
    function createAdminRegistry(env) {
        const modules = new Map();      // tab -> { def, mounted, mounting }
        const rosterListeners = [];
        let lastRoster = null;
        let context = null;
        let resolveContext = null;
        const contextReady = new Promise(resolve => { resolveContext = resolve; });
        let current = { tab: null, key: null, params: {} };
        let seq = 0;

        function register(tab, def) {
            if (typeof tab !== 'string' || !TAB_PATTERN.test(tab) || !def || typeof def.mount !== 'function') {
                console.warn('[studio-admin] registro inválido para la pestaña', tab);
                return false;
            }
            if (modules.has(tab)) {
                console.warn('[studio-admin] la pestaña ya tiene un módulo registrado:', tab);
                return false;
            }
            modules.set(tab, { def, mounted: false, mounting: null });
            // Registro tardío: si la pestaña ya está activa y hay contexto, se monta ya.
            if (context && current.tab === tab) run(tab, current.params, ++seq);
            return true;
        }

        // Único punto de entrada: click, hashchange, navigate y el arranque.
        function activate(tab, params) {
            const want = String(tab == null ? '' : tab);
            if (!TAB_PATTERN.test(want) || !env.hasTab(want)) return false;
            const clean = normalizeParams(params);
            const key = paramsKey(clean);
            if (current.tab === want && current.key === key) return true;
            current = { tab: want, key, params: clean };
            env.showTab(want);
            if (context) run(want, clean, ++seq);
            return true;
        }

        async function run(tab, params, token) {
            const entry = modules.get(tab);
            const root = env.rootFor(tab);
            if (!entry) {
                if (root) env.markUnavailable(root);
                return;
            }
            if (!root) {
                console.warn('[studio-admin] falta [data-module-root] en el panel', tab);
                return;
            }
            if (!entry.mounted) {
                try {
                    if (!entry.mounting) entry.mounting = Promise.resolve().then(() => entry.def.mount(root, context));
                    await entry.mounting;
                    entry.mounted = true;
                    env.clearPlaceholder(root);
                } catch (err) {
                    entry.mounting = null;
                    if (current.tab === tab) current.key = null; // permite reintentar con otro click
                    console.error('[studio-admin] no se pudo montar', tab, err);
                    env.markFailed(root, err);
                    return;
                }
            }
            // Si mientras se montaba se activó otra cosa, el show lo hace esa activación.
            if (token !== seq || current.tab !== tab || typeof entry.def.show !== 'function') return;
            try {
                await entry.def.show(root, context, params);
            } catch (err) {
                if (current.tab === tab) current.key = null;
                console.error('[studio-admin] error al mostrar', tab, err);
                env.reportError(err);
            }
        }

        function navigate(tab, params) {
            const ok = activate(tab, params);
            if (ok) env.replaceHash(String(tab));
            return ok;
        }

        function setBadge(tab, n) {
            const want = String(tab == null ? '' : tab);
            if (TAB_PATTERN.test(want)) env.setBadge(want, n);
        }

        function getContext() { return contextReady; }

        async function notify(payload) {
            const ctx = await contextReady;
            return ctx.notify(payload);
        }

        async function refresh() {
            const ctx = await contextReady;
            return ctx.refresh();
        }

        function callRosterListener(cb, snapshot) {
            try {
                const out = cb(snapshot.tableEl, snapshot.members);
                if (out && typeof out.catch === 'function') {
                    out.catch(err => console.error('[studio-admin] onRosterRender', err));
                }
            } catch (err) {
                console.error('[studio-admin] onRosterRender', err);
            }
        }

        // cb(tableEl, members). Si el roster ya se pintó, se llama enseguida con
        // el último render. Devuelve una función para desuscribirse.
        function onRosterRender(cb) {
            if (typeof cb !== 'function') return () => {};
            rosterListeners.push(cb);
            if (lastRoster) callRosterListener(cb, lastRoster);
            return () => {
                const i = rosterListeners.indexOf(cb);
                if (i >= 0) rosterListeners.splice(i, 1);
            };
        }

        function _emitRosterRender(tableEl, members) {
            lastRoster = { tableEl: tableEl || null, members: Array.isArray(members) ? members : [] };
            rosterListeners.slice().forEach(cb => callRosterListener(cb, lastRoster));
        }

        // Lo llama el shell una sola vez, cuando el estudio quedó resuelto.
        function _setContext(ctx) {
            if (context || !ctx) return;
            context = ctx;
            resolveContext(ctx);
            if (current.tab) run(current.tab, current.params, ++seq);
        }

        return {
            register, getContext, activate, navigate, setBadge, notify, refresh,
            onRosterRender, _emitRosterRender, _setContext
        };
    }

    const domEnv = {
        hasTab(tab) {
            return !!document.querySelector('.studio-dash-tab[data-tab="' + tab + '"]');
        },
        showTab(tab) {
            document.querySelectorAll('.studio-dash-tab').forEach(el => {
                const on = el.dataset.tab === tab;
                el.classList.toggle('is-active', on);
                if (on) el.setAttribute('aria-current', 'page');
                else el.removeAttribute('aria-current');
            });
            document.querySelectorAll('.studio-dash-panel').forEach(panel =>
                panel.classList.toggle('is-active', panel.dataset.panel === tab));
        },
        // El root del módulo es el PRIMER [data-module-root] del panel.
        rootFor(tab) {
            const panel = document.querySelector('.studio-dash-panel[data-panel="' + tab + '"]');
            return panel ? panel.querySelector('[data-module-root]') : null;
        },
        replaceHash(tab) {
            try {
                window.history.replaceState(window.history.state, '', '#' + tab);
            } catch (err) {
                console.warn('[studio-admin] no se pudo actualizar el hash:', err);
            }
        },
        setBadge(tab, n) {
            const tabEl = document.querySelector('.studio-dash-tab[data-tab="' + tab + '"]');
            if (!tabEl) return;
            const count = Math.max(0, Math.floor(Number(n) || 0));
            let badge = tabEl.querySelector('.sk-tab-badge');
            if (!badge) {
                if (!count) return;
                badge = document.createElement('span');
                badge.className = 'sk-tab-badge';
                tabEl.appendChild(badge);
            }
            badge.textContent = count > 99 ? '99+' : String(count);
            badge.title = count === 1 ? '1 pendiente' : count + ' pendientes';
            badge.hidden = count === 0;
        },
        clearPlaceholder(root) {
            const placeholder = root.querySelector('[data-module-loading]');
            if (placeholder) placeholder.remove();
        },
        markUnavailable(root) {
            const placeholder = root.querySelector('[data-module-loading]');
            if (placeholder) placeholder.textContent = 'Esta sección todavía no está disponible.';
        },
        markFailed(root, err) {
            root.innerHTML = '<div class="studio-status studio-status-error" role="alert">'
                + escapeHtml(friendlyMessage(err, 'No pudimos cargar esta sección. Recargá la página e intentá nuevamente.'))
                + '</div>';
        },
        reportError(err) {
            toast(friendlyMessage(err, 'Algo salió mal. Intentá nuevamente.'), 'danger');
        }
    };

    const admin = createAdminRegistry(domEnv);
    window.WeOtziStudioAdmin = admin;

    document.addEventListener('DOMContentLoaded', async () => {
        const auth = window.WeOtziStudioAuth;
        if (!auth) return; // studio-auth.js handles redirect-on-no-session

        wireTabs();

        await auth.ready();
        supabase = auth.getSupabase();
        studio = auth.getCurrent() || await auth.check();
        if (!studio) {
            // The auth.check() may already be redirecting; just bail.
            return;
        }

        document.getElementById('studio-name-display').innerHTML =
            'Panel · <span class="accent">' + escapeHtml(studio.name || 'Mi estudio') + '</span>';
        document.getElementById('view-public-profile').href =
            auth.appUrl('/studio/profile/?studio=') + encodeURIComponent(studio.slug || studio.id);

        document.getElementById('logout-btn').addEventListener('click', () => auth.logout());

        admin._setContext(buildContext(await currentUserId()));

        wireAccount();
        await loadProfile();
        await loadSedes();
        await loadRoster();
        loadBadges(); // traga sus propios errores; no frena el resto del arranque
        await loadSpotsPanel();
    });

    function buildContext(userId) {
        return {
            studio,
            studioId: studio.id,
            userId,
            client: supabase,
            data: window.WeotziData,
            get kit() { return window.WeOtziStudioKit; },
            navigate: (tab, params) => admin.navigate(tab, params),
            setBadge: (tab, n) => admin.setBadge(tab, n),
            notify: payload => safeNotify(payload),
            refresh: () => refreshShell()
        };
    }

    async function currentUserId() {
        try {
            const { data } = await supabase.auth.getSession();
            return data?.session?.user?.id || studio.user_id || null;
        } catch (err) {
            return studio.user_id || null;
        }
    }

    // ctx.refresh(): vuelve a pintar lo que el shell muestra (roster, spots y
    // badges) después de que un módulo cambió algo que lo afecta.
    async function refreshShell() {
        if (!studio) return;
        await Promise.allSettled([renderRosterTable(), renderMySpots()]);
        await loadBadges();
    }

    function escapeHtml(v) {
        return String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function wireTabs() {
        document.querySelectorAll('.studio-dash-tab').forEach(tab => {
            tab.href = '#' + tab.dataset.tab;
            // El hash cambia después del click; el hashchange cae en activate()
            // con la misma pestaña y no hace nada (idempotente).
            tab.addEventListener('click', () => admin.activate(tab.dataset.tab));
        });
        window.addEventListener('hashchange', () => {
            const hash = window.location.hash.slice(1);
            if (!hash) admin.activate(DEFAULT_TAB);
            else if (TAB_PATTERN.test(hash)) admin.activate(hash);
        });
        const hash = window.location.hash.slice(1);
        if (!(TAB_PATTERN.test(hash) && admin.activate(hash))) admin.activate(DEFAULT_TAB);
    }

    function wireAccount() {
        document.getElementById('account-email').textContent = studio.email || '—';
        document.getElementById('account-password-form').addEventListener('submit', async event => {
            event.preventDefault();
            const form = event.currentTarget;
            const password = document.getElementById('account-password').value;
            if (password !== document.getElementById('account-password-confirm').value) {
                showStatus('account-status', 'error', 'Las contraseñas no coinciden.');
                return;
            }
            const button = form.querySelector('button');
            button.disabled = true;
            try {
                await window.WeOtziStudioAuth.changePassword(password);
                form.reset();
                showStatus('account-status', 'success', 'Contraseña actualizada.');
            } catch (err) { showStatus('account-status', 'error', err.message); }
            finally { button.disabled = false; }
        });
    }

    function showStatus(elId, kind, msg) {
        const el = document.getElementById(elId);
        if (!el) return;
        el.className = 'studio-status studio-status-' + kind;
        el.textContent = msg;
        el.hidden = false;
        el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    }

    // Toast del kit (si está cargado). El estado del panel sigue en showStatus.
    function toast(msg, tone) {
        const kit = window.WeOtziStudioKit;
        if (!kit || typeof kit.toast !== 'function') return;
        try { kit.toast(msg, tone); } catch (err) { console.warn('[studio-dashboard] toast:', err); }
    }

    // Códigos de "falta aplicar una migración" (Reglas transversales §5).
    const MISSING_SCHEMA_CODES = ['PGRST200', 'PGRST202', 'PGRST204', 'PGRST205', '42703', '42883', '42P01'];
    // Sin RPC o sin tabla de contratos: se cae al flujo de decisión anterior.
    const MISSING_CONTRACTS_CODES = ['42883', 'PGRST202', 'PGRST205', '42P01'];

    function errorCode(err) { return String((err && err.code) || ''); }
    function isMissingColumnError(err) {
        const code = errorCode(err);
        return code === 'PGRST204' || code === '42703';
    }
    function isMissingContractsBackend(err) { return MISSING_CONTRACTS_CODES.includes(errorCode(err)); }

    function friendlyMessage(err, fallback) {
        const kit = window.WeOtziStudioKit;
        if (kit && typeof kit.friendlyError === 'function') {
            try {
                const msg = kit.friendlyError(err, fallback);
                if (msg) return msg;
            } catch (e) { /* cae al mensaje local */ }
        }
        if (MISSING_SCHEMA_CODES.includes(errorCode(err))) {
            return 'Esta función todavía no está disponible (falta aplicar una migración).';
        }
        return (err && err.message) || fallback || 'Algo salió mal. Intentá nuevamente.';
    }

    async function confirmAction(opts) {
        const kit = window.WeOtziStudioKit;
        if (kit && typeof kit.confirmDialog === 'function') {
            try { return !!(await kit.confirmDialog(opts)); } catch (err) { console.warn('[studio-dashboard] confirm:', err); }
        }
        return window.confirm(opts.body || opts.title);
    }

    function safeUrl(u) {
        const kit = window.WeOtziStudioKit;
        if (kit && typeof kit.safeUrl === 'function') return kit.safeUrl(u);
        if (!u) return null;
        try {
            const url = new URL(String(u));
            return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
        } catch (err) { return null; }
    }

    // Etiqueta en español desde WeOtziStudioKit.LABELS[dict], con diccionario local de respaldo.
    function kitLabel(dictName, value, fallbackDict) {
        const kit = window.WeOtziStudioKit;
        const dict = kit && kit.LABELS && kit.LABELS[dictName];
        if (dict && dict[value]) return dict[value];
        return (fallbackDict && fallbackDict[value]) || (value == null || value === '' ? '—' : String(value));
    }

    async function getAccessToken() {
        const { data } = await supabase.auth.getSession();
        return data?.session?.access_token || null;
    }

    async function notifyStudio(payload) {
        const token = await getAccessToken();
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers.Authorization = 'Bearer ' + token;
        const response = await fetch(window.WeOtziStudioAuth.appUrl('/api/studio/notify'), {
            method: 'POST',
            headers,
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            const text = await response.text();
            throw new Error(text || ('Studio notify failed with ' + response.status));
        }
        const result = await response.json().catch(() => ({}));
        if (result.sent === false || result.email_sent === false || result.emailSent === false || result.success === false) {
            throw new Error('La operación se guardó, pero el correo no pudo enviarse.');
        }
        return result;
    }

    // ctx.notify(payload): reusa notifyStudio pero nunca lanza (la acción ya
    // quedó guardada). Devuelve { ok, data, error } como WeOtziStudioKit.postNotify.
    async function safeNotify(payload) {
        try {
            const data = await notifyStudio(payload);
            return { ok: true, data, error: null };
        } catch (error) {
            console.warn('[studio-dashboard] notify failed (non-fatal):', error);
            return { ok: false, data: null, error };
        }
    }

    // -------------------------------------------------------------
    // Badges de la sidebar (al iniciar y en ctx.refresh)
    // Solicitudes = altas pedidas + cambios pedidos + contraofertas del artista.
    // Contratos = enviados sin firmar (incluye los que están por vencer).
    // Cualquier error (migración pendiente, método ausente) cuenta como 0.
    // -------------------------------------------------------------
    async function settleRows(call) {
        try {
            const result = await call();
            if (!result || result.error) return [];
            return Array.isArray(result.data) ? result.data : [];
        } catch (err) {
            return [];
        }
    }

    function computeBadgeCounts({ requests = [], changes = [], counters = [], contracts = [] } = {}) {
        const open = (rows, status) => rows.filter(row => row && (!row.status || row.status === status)).length;
        return {
            solicitudes: open(requests, 'requested') + open(changes, 'pending') + open(counters, 'pending'),
            contratos: open(contracts, 'sent')
        };
    }

    async function collectBadgeCounts(D, studioId) {
        const memberships = (D && D.StudioMemberships) || {};
        const spots = (D && D.StudioSpots) || {};
        const contracts = (D && D.StudioContracts) || {};
        const [requests, changes, counters, sent] = await Promise.all([
            settleRows(() => memberships.listRequestsForStudio?.(studioId)),
            settleRows(() => memberships.listChangeRequestsForStudio?.(studioId)),
            settleRows(() => spots.listArtistCounterOffersForStudio?.(studioId)),
            settleRows(() => contracts.listForStudio?.(studioId, { status: 'sent' }))
        ]);
        return computeBadgeCounts({ requests, changes, counters, contracts: sent });
    }

    async function loadBadges() {
        if (!studio) return;
        try {
            const counts = await collectBadgeCounts(window.WeotziData, studio.id);
            Object.keys(counts).forEach(tab => admin.setBadge(tab, counts[tab]));
        } catch (err) {
            console.warn('[studio-dashboard] badges:', err);
        }
    }

    // -------------------------------------------------------------
    // Profile tab
    // -------------------------------------------------------------
    async function loadProfile() {
        document.getElementById('p-name').value     = studio.name || '';
        document.getElementById('p-tagline').value  = studio.tagline || '';
        document.getElementById('p-bio').value      = studio.bio || '';
        document.getElementById('p-founded').value  = studio.founded_year || '';
        document.getElementById('p-languages').value = (studio.languages || []).join(', ');
        document.getElementById('p-instagram').value = studio.instagram || '';
        document.getElementById('p-website').value   = studio.website || '';
        document.getElementById('p-whatsapp').value  = studio.whatsapp || '';
        document.getElementById('p-cover').value = studio.cover_image || '';
        document.getElementById('p-logo').value  = studio.logo_image || '';

        // Photos textarea is kept hidden — gallery widget is the source of truth.
        document.getElementById('p-photos').value =
            (studio.photo_feed_items || []).map(p => p.url).filter(Boolean).join('\n');

        // Wire the file uploaders if the module is available.
        if (window.WeOtziUploader) {
            const pathPrefix = studio.id;

            window.WeOtziUploader.attach(document.getElementById('p-cover'), {
                supabase, bucket: 'studio-photos',
                pathPrefix: pathPrefix + '/cover',
                placeholder: 'pegá una URL de portada',
                accept: 'image/*'
            });

            window.WeOtziUploader.attach(document.getElementById('p-logo'), {
                supabase, bucket: 'studio-photos',
                pathPrefix: pathPrefix + '/logo',
                placeholder: 'pegá una URL del logo',
                accept: 'image/*'
            });

            const galleryContainer = document.getElementById('p-gallery');
            if (galleryContainer) {
                const initialUrls = (studio.photo_feed_items || []).map(p => p.url).filter(Boolean);
                window.WeOtziUploader.attachGallery(galleryContainer, {
                    supabase,
                    bucket: 'studio-photos',
                    pathPrefix: pathPrefix + '/gallery',
                    initialUrls,
                    onChange(urls) {
                        // Keep the hidden textarea in sync so the existing serializer picks them up.
                        document.getElementById('p-photos').value = urls.join('\n');
                    }
                });
            }
        }

        document.getElementById('profile-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!e.currentTarget.reportValidity()) return;
            const photoUrls = (document.getElementById('p-photos').value || '')
                .split('\n').map(s => s.trim()).filter(s => /^https?:\/\//.test(s));
            const photoFeedItems = photoUrls.map((url, i) => ({
                url, kind: 'image', category: 'studio', sort: i,
                created_at: new Date().toISOString()
            }));

            const update = {
                name:             document.getElementById('p-name').value.trim(),
                normalized_name:  document.getElementById('p-name').value.trim().toUpperCase(),
                tagline:          document.getElementById('p-tagline').value.trim() || null,
                bio:              document.getElementById('p-bio').value.trim() || null,
                founded_year:     Number(document.getElementById('p-founded').value) || null,
                languages:        (document.getElementById('p-languages').value || '')
                                    .split(',').map(s => s.trim()).filter(Boolean),
                instagram:        document.getElementById('p-instagram').value.trim() || null,
                website:          document.getElementById('p-website').value.trim() || null,
                whatsapp:         document.getElementById('p-whatsapp').value.trim() || null,
                cover_image:      document.getElementById('p-cover').value.trim() || null,
                logo_image:       document.getElementById('p-logo').value.trim() || null,
                photo_feed_items: photoFeedItems
            };

            const button = e.currentTarget.querySelector('[type="submit"]');
            button.disabled = true;
            try {
                if (update.name.length < 2) throw new Error('El nombre debe tener al menos 2 caracteres.');
                if (update.founded_year && (update.founded_year < 1900 || update.founded_year > new Date().getFullYear())) {
                    throw new Error('Revisá el año de fundación.');
                }
                const { error } = await WeotziData.Studios.updateProfile(studio.id, update);
                if (error) throw error;
                Object.assign(studio, update);
                document.getElementById('studio-name-display').textContent = 'Panel · ' + studio.name;
                showStatus('profile-status', 'success', 'Perfil actualizado.');
            } catch (err) { showStatus('profile-status', 'error', err.message || 'No se pudo guardar.'); }
            finally { button.disabled = false; }
        });
    }

    // -------------------------------------------------------------
    // Sedes tab
    // -------------------------------------------------------------
    async function loadSedes() {
        const list = document.getElementById('sedes-list');
        list.innerHTML = '<em>Cargando sedes…</em>';

        const { data: locations, error } = await WeotziData.StudioLocations.listByStudio(studio.id);

        if (error) {
            list.innerHTML = '<em>Error: ' + escapeHtml(error.message) + '</em>';
            return;
        }

        sedePickers.length = 0;
        list.innerHTML = '';
        (locations || []).forEach(loc => addSedeRow(loc));
        if (!locations || locations.length === 0) addSedeRow(null);

        document.getElementById('add-sede-btn').onclick = () => addSedeRow(null);
    }

    function addSedeRow(existing) {
        const list = document.getElementById('sedes-list');
        const idx = sedePickers.length;
        const row = document.createElement('div');
        row.className = 'studio-location-row';
        const label = (existing && existing.label) || (idx === 0 ? 'Sede principal' : 'Sede #' + (idx + 1));

        row.innerHTML = `
            <div class="studio-location-row-head">
                <span class="studio-section-kicker">${escapeHtml(label)}</span>
                <div style="display:flex;gap:6px;">
                    <label style="font-family:var(--studio-mono);font-size:.65rem;letter-spacing:.12em;text-transform:uppercase;font-weight:700;display:inline-flex;align-items:center;gap:4px;">
                        <input type="checkbox" data-field="is_primary" ${existing && existing.is_primary ? 'checked' : ''}> Principal
                    </label>
                    <button type="button" class="studio-location-row-remove" data-action="remove">Quitar</button>
                    <button type="button" class="studio-locations-add" data-action="save" style="border-style:solid;padding:6px 10px;">Guardar</button>
                </div>
            </div>
            <div class="studio-field">
                <label class="studio-label">Etiqueta</label>
                <input type="text" class="studio-input" data-field="label" value="${escapeHtml(label)}">
            </div>
            <div class="studio-field">
                <label class="studio-label">Dirección</label>
                <input type="text" class="studio-input weotzi-address-picker-input" data-field="address" placeholder="Buscá la dirección…" autocomplete="off"
                       value="${existing ? escapeHtml(existing.formatted_address || '') : ''}">
                <div class="weotzi-address-fields" data-field="preview" hidden></div>
            </div>
            <details>
                <summary class="studio-help">Ingresar dirección manualmente</summary>
                <div class="studio-field"><label class="studio-label">Ciudad</label><input class="studio-input" data-field="manual-city" value="${escapeHtml(existing?.city || '')}"></div>
                <div class="studio-field"><label class="studio-label">País</label><input class="studio-input" data-field="manual-country" value="${escapeHtml(existing?.country || '')}"></div>
                <button type="button" class="studio-locations-add" data-action="manual">Usar la dirección escrita arriba</button>
                <p class="studio-help">Podés buscarla en el mapa después.</p>
            </details>
            <div class="studio-field"><label class="studio-label">Teléfono de la sede</label><input type="tel" class="studio-input" data-field="phone" value="${escapeHtml(existing?.phone || '')}"></div>
            <div class="studio-field"><label class="studio-label">Horarios de atención</label><textarea class="studio-textarea" data-field="hours" placeholder="Lunes a viernes de 10 a 19 h">${escapeHtml(existing?.hours_json?.description || '')}</textarea></div>
        `;
        list.appendChild(row);

        const addressInput = row.querySelector('input[data-field="address"]');
        const previewEl    = row.querySelector('div[data-field="preview"]');

        const entry = {
            row, locationId: existing ? existing.id : null,
            address: existing ? {
                country: existing.country, country_code: existing.country_code,
                state_province: existing.state_province, city: existing.city,
                locality: existing.locality, street: existing.street,
                street_number: existing.street_number, unit: existing.unit,
                postal_code: existing.postal_code,
                formatted_address: existing.formatted_address || '',
                latitude: existing.latitude, longitude: existing.longitude,
                google_place_id: existing.google_place_id || ''
            } : {},
            picker: null, hours: existing?.hours_json || {}
        };
        row.querySelector('[data-action="manual"]').addEventListener('click', () => {
            const city = row.querySelector('[data-field="manual-city"]').value.trim();
            const country = row.querySelector('[data-field="manual-country"]').value.trim();
            if (!addressInput.value.trim() || !city || !country) {
                showStatus('sedes-status', 'error', 'Completá dirección, ciudad y país.'); return;
            }
            entry.address = { formatted_address: addressInput.value.trim(), city, country, latitude: null, longitude: null };
            previewEl.textContent = [entry.address.formatted_address, city, country].join(' · ');
            previewEl.hidden = false;
        });

        if (window.WeOtziAddressPicker) {
            entry.picker = window.WeOtziAddressPicker.attach(addressInput, {
                placeholder: 'Buscá la dirección…',
                onChange(addr) {
                    entry.address = addr;
                    window.WeOtziAddressPicker.renderPreview(previewEl, addr);
                }
            });
            if (existing) {
                entry.picker.setValue(entry.address);
                window.WeOtziAddressPicker.renderPreview(previewEl, entry.address);
            }
        }
        sedePickers.push(entry);

        row.querySelector('button[data-action="remove"]').addEventListener('click', () => removeSede(entry));
        row.querySelector('button[data-action="save"]').addEventListener('click', () => saveSede(entry));
    }

    async function saveSede(entry) {
        const labelInput = entry.row.querySelector('input[data-field="label"]');
        const isPrimary  = entry.row.querySelector('input[data-field="is_primary"]').checked;
        const saveButton = entry.row.querySelector('[data-action="save"]');
        const a = entry.address || {};

        if (!a.formatted_address || entry.row.querySelector('[data-field="address"]').value.trim() !== a.formatted_address.trim()) {
            showStatus('sedes-status', 'error', 'Elegí una dirección de las sugerencias antes de guardar.');
            return;
        }

        const payload = {
            studio_id:         studio.id,
            label:             labelInput.value.trim() || null,
            is_primary:        isPrimary,
            is_active:         true,
            phone:             entry.row.querySelector('[data-field="phone"]').value.trim() || null,
            hours_json:        { ...entry.hours, description: entry.row.querySelector('[data-field="hours"]').value.trim() },
            country:           a.country || null,
            country_code:      a.country_code || null,
            state_province:    a.state_province || null,
            city:              a.city || null,
            locality:          a.locality || null,
            street:            a.street || null,
            street_number:     a.street_number || null,
            unit:              a.unit || null,
            postal_code:       a.postal_code || null,
            formatted_address: a.formatted_address,
            latitude:          Number.isFinite(a.latitude)  ? a.latitude  : null,
            longitude:         Number.isFinite(a.longitude) ? a.longitude : null,
            google_place_id:   a.google_place_id || null,
            geocoded_at:       new Date().toISOString()
        };

        try {
            saveButton.disabled = true;
            const { data, error } = await supabase.rpc('save_studio_location', {
                p_studio_id: studio.id, p_location_id: entry.locationId, p_location: payload
            });
            if (error) throw error;
            const saved = Array.isArray(data) ? data[0] : data;
            if (!saved?.id) throw new Error('No se pudo confirmar la sede guardada.');
            entry.locationId = saved.id;
            if (saved.is_primary) studio.primary_location_id = saved.id;
            await loadSedes();
            await loadRoster();

            showStatus('sedes-status', 'success', 'Sede guardada.');
        } catch (err) {
            showStatus('sedes-status', 'error', err.message || 'No se pudo guardar la sede.');
        } finally { saveButton.disabled = false; }
    }

    async function removeSede(entry) {
        if (!entry.locationId) {
            entry.row.remove();
            const i = sedePickers.indexOf(entry);
            if (i >= 0) sedePickers.splice(i, 1);
            return;
        }
        if (!confirm('¿Quitar esta sede? Los artistas asignados solo a esta sede pierden la referencia.')) return;
        const { error } = await supabase.rpc('remove_studio_location', { p_studio_id: studio.id, p_location_id: entry.locationId });
        if (error) { showStatus('sedes-status', 'error', error.message); return; }
        entry.row.remove();
        const i = sedePickers.indexOf(entry);
        if (i >= 0) sedePickers.splice(i, 1);
        const { data: updated } = await WeotziData.Studios.getById(studio.id);
        if (updated) Object.assign(studio, updated);
        await loadSedes();
        await loadRoster();
        showStatus('sedes-status', 'success', 'Sede eliminada.');
    }

    // -------------------------------------------------------------
    // Spots tab — Phase B
    // -------------------------------------------------------------
    const KIND_LABELS = { resident: 'Residencia', itinerant: 'Itinerante', guest_spot: 'Guest spot' };
    const SPOT_STATUS_LABELS = { draft: 'Borrador', open: 'Abierto', filled: 'Cubierto', closed: 'Cerrado', expired: 'Vencido' };
    const APPLICATION_STATUS_LABELS = {
        pending: 'Pendiente', viewed: 'Vista', shortlisted: 'Preseleccionada',
        accepted: 'Aceptada', rejected: 'Rechazada', withdrawn: 'Retirada'
    };
    const COMPENSATION_LABELS = { percentage: 'Porcentaje', fixed: 'Pago fijo', mixed: 'Mixto (porcentaje + fijo)' };
    const FIXED_PERIOD_LABELS = {
        per_session: 'Por sesión', daily: 'Por día', weekly: 'Por semana', monthly: 'Por mes', one_time: 'Pago único'
    };
    const FIXED_PAYER_LABELS = {
        artist_to_studio: 'Alquiler de puesto: el artista paga al estudio',
        studio_to_artist: 'Pago al artista: el estudio paga'
    };
    const STIPEND_FREQUENCY_LABELS = { weekly: 'Por semana', monthly: 'Por mes', one_time: 'Pago único' };
    const ISO_CURRENCIES = ['ARS', 'USD', 'EUR', 'BRL', 'CLP', 'MXN', 'COP', 'UYU', 'PEN'];
    const ACCEPT_COPY = 'Postulación aceptada: revisá y emití el contrato para sumarlo al roster.';

    // Listas del spot (columnas existentes) y sus límites de edición.
    const SPOT_LISTS = [
        { key: 'studio_includes', label: 'Qué incluye', placeholder: 'Ej.: Camilla y equipo', max: 20, maxLen: 200 },
        { key: 'benefit_tags', label: 'Beneficios (hasta 6)', placeholder: 'Ej.: Agenda garantizada', max: 6, maxLen: 80 },
        { key: 'artist_expectations', label: 'Qué esperamos', placeholder: 'Ej.: Portfolio actualizado', max: 20, maxLen: 200 },
        { key: 'minimum_requirements', label: 'Requisitos', placeholder: 'Ej.: 2 años de experiencia', max: 20, maxLen: 200 }
    ];
    // Columnas de la migración 20261030201000 (no aplicada): se mandan solo si existen.
    const SPOT_V2_COLUMNS = ['benefit_tags', 'compensation_model', 'fixed_amount', 'fixed_currency', 'fixed_period', 'fixed_payer'];
    // null = desconocido; Set con las columnas V2 que existen (deducido del último spot leído).
    let spotColumnSupport = null;

    function spotV2ColumnsFrom(row) {
        return new Set(SPOT_V2_COLUMNS.filter(col => row && Object.prototype.hasOwnProperty.call(row, col)));
    }

    function hasSpotV2Values(payload) {
        return SPOT_V2_COLUMNS.some(col => {
            const v = payload[col];
            // El porcentaje ya vive en revenue_split_pct (columna previa).
            if (col === 'compensation_model' && v === 'percentage') return false;
            return Array.isArray(v) ? v.length > 0 : (v !== null && v !== undefined && v !== '');
        });
    }

    function withoutSpotColumns(payload, keep) {
        const copy = Object.assign({}, payload);
        SPOT_V2_COLUMNS.forEach(col => { if (!keep || !keep.has(col)) delete copy[col]; });
        return copy;
    }

    // Decide qué columnas V2 viajan según lo que se sabe del esquema.
    function spotPayloadFor(payload, support) {
        if (support === null) return hasSpotV2Values(payload) ? Object.assign({}, payload) : withoutSpotColumns(payload, null);
        return withoutSpotColumns(payload, support);
    }

    function spotPayloadDropsValues(payload, sent) {
        return SPOT_V2_COLUMNS.some(col => !(col in sent) && hasSpotV2Values({ [col]: payload[col] }));
    }

    // Guarda el spot; ante PGRST204/42703 reintenta sin las columnas nuevas.
    // Devuelve { result, degraded } (degraded = hubo datos nuevos que no se guardaron).
    async function persistSpot(spotId, payload) {
        const write = body => spotId
            ? WeotziData.StudioSpots.updateSpot(spotId, body)
            : WeotziData.StudioSpots.createSpot(body);
        let body = spotPayloadFor(payload, spotColumnSupport);
        let result = await write(body);
        const sentV2 = SPOT_V2_COLUMNS.some(col => col in body);
        if (result.error && sentV2 && isMissingColumnError(result.error)) {
            console.warn('[studio-dashboard] spot sin columnas nuevas, reintento sin ellas:', result.error);
            spotColumnSupport = new Set();
            body = withoutSpotColumns(payload, null);
            result = await write(body);
        } else if (!result.error && sentV2 && spotColumnSupport === null) {
            spotColumnSupport = new Set(SPOT_V2_COLUMNS.filter(col => col in body));
        }
        return { result, degraded: !result.error && spotPayloadDropsValues(payload, body) };
    }

    function normalizeList(values) {
        const seen = new Set();
        const out = [];
        (values || []).forEach(raw => {
            const item = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
            const key = item.toLowerCase();
            if (!item || seen.has(key)) return;
            seen.add(key);
            out.push(item);
        });
        return out;
    }

    // Lista editable: WeOtziStudioKit.listEditor si está; si no, textarea (uno por línea).
    function makeListEditor(opts) {
        const kit = window.WeOtziStudioKit;
        if (kit && typeof kit.listEditor === 'function') {
            try {
                const editor = kit.listEditor({
                    items: opts.items, max: opts.max, maxLen: opts.maxLen, placeholder: opts.placeholder, label: opts.label
                });
                if (editor && editor.el && typeof editor.getItems === 'function') {
                    return { el: editor.el, getItems: () => normalizeList(editor.getItems()) };
                }
            } catch (err) {
                console.warn('[studio-dashboard] listEditor:', err);
            }
        }
        const textarea = document.createElement('textarea');
        textarea.className = 'studio-textarea';
        textarea.rows = 3;
        textarea.placeholder = opts.placeholder + ' (uno por línea)';
        textarea.value = (opts.items || []).join('\n');
        if (opts.labelId) textarea.setAttribute('aria-labelledby', opts.labelId);
        return { el: textarea, getItems: () => normalizeList(textarea.value.split('\n')) };
    }

    function validateSpotLists(lists) {
        for (const def of SPOT_LISTS) {
            const items = lists[def.key] || [];
            if (items.length > def.max) return def.label.replace(/\s*\(.*\)$/, '') + ': hasta ' + def.max + ' ítems.';
            if (items.some(item => item.length > def.maxLen)) {
                return def.label.replace(/\s*\(.*\)$/, '') + ': cada ítem puede tener hasta ' + def.maxLen + ' caracteres.';
            }
        }
        return null;
    }

    // Modalidad del spot: porcentaje (split para el artista), fijo o mixto.
    function validateSpotTerms(t) {
        const model = t.compensation_model;
        if (t.revenue_split_pct != null && (t.revenue_split_pct < 0 || t.revenue_split_pct > 100)) {
            return 'El porcentaje para el artista debe estar entre 0 y 100.';
        }
        if ((model === 'percentage' || model === 'mixed') && t.revenue_split_pct == null) {
            return 'Indicá el porcentaje que se queda el artista.';
        }
        if (model === 'fixed' || model === 'mixed') {
            if (t.fixed_amount == null || t.fixed_amount < 0) return 'Completá el monto fijo (0 o más).';
            if (!/^[A-Z]{3}$/.test(t.fixed_currency || '')) return 'Elegí la moneda del pago fijo.';
            if (!FIXED_PERIOD_LABELS[t.fixed_period]) return 'Elegí cada cuánto se paga el monto fijo.';
            if (!FIXED_PAYER_LABELS[t.fixed_payer]) return 'Elegí quién paga el monto fijo.';
        }
        if (t.stipend_amount != null && t.stipend_amount < 0) return 'El estipendio no puede ser negativo.';
        return null;
    }

    function currencyOptions(selected, emptyLabel) {
        const value = String(selected || '').toUpperCase();
        const codes = ISO_CURRENCIES.slice();
        if (value && !codes.includes(value)) codes.push(value);
        return `<option value="">${escapeHtml(emptyLabel)}</option>`
            + codes.map(code => `<option value="${escapeAttr(code)}" ${code === value ? 'selected' : ''}>${escapeHtml(code)}</option>`).join('');
    }

    function dictOptions(dict, selected, emptyLabel, kitDict) {
        return (emptyLabel != null ? `<option value="">${escapeHtml(emptyLabel)}</option>` : '')
            + Object.keys(dict).map(key =>
                `<option value="${escapeAttr(key)}" ${key === selected ? 'selected' : ''}>${escapeHtml(kitLabel(kitDict, key, dict))}</option>`
            ).join('');
    }

    async function loadSpotsPanel() {
        document.getElementById('spot-new-btn').addEventListener('click', () => openSpotEditor(null));
        await renderMySpots();
    }

    async function renderMySpots() {
        const container = document.getElementById('my-spots-list');
        if (!container || !studio) return;
        const { data: list, error } = await WeotziData.StudioSpots.listByStudio(studio.id);
        if (error) { container.innerHTML = '<em>' + escapeHtml(error.message) + '</em>'; return; }
        if (!list || list.length === 0) {
            container.innerHTML = '<p class="studio-help">Aún no publicaste spots. Tocá "Nuevo spot" para empezar.</p>';
            return;
        }
        container.innerHTML = list.map(s => `
            <div class="studio-location-row">
                <div class="studio-location-row-head">
                    <span class="studio-section-kicker">${escapeHtml(KIND_LABELS[s.kind] || s.kind)} · ${escapeHtml(SPOT_STATUS_LABELS[s.status] || s.status)}</span>
                    <div style="display:flex;gap:6px;flex-wrap:wrap;">
                        <button class="studio-locations-add" data-action="apps" data-id="${escapeAttr(s.id)}" style="border-style:solid;padding:6px 10px;">
                            Postulaciones (${Number(s.application_count) || 0})
                        </button>
                        <button class="studio-locations-add" data-action="edit" data-id="${escapeAttr(s.id)}" style="border-style:solid;padding:6px 10px;">Editar</button>
                        <button class="studio-locations-add" data-action="toggle" data-id="${escapeAttr(s.id)}" data-status="${escapeAttr(s.status)}" style="border-style:solid;padding:6px 10px;">
                            ${s.status === 'open' ? 'Cerrar' : (s.status === 'draft' ? 'Publicar' : 'Reabrir')}
                        </button>
                        <button class="studio-location-row-remove" data-action="delete" data-id="${escapeAttr(s.id)}">Borrar</button>
                    </div>
                </div>
                <div style="font-family:var(--studio-display);font-size:1.1rem;letter-spacing:-0.02em;text-transform:uppercase;">
                    ${escapeHtml(s.title)}
                </div>
                <div class="studio-help" style="display:flex;flex-wrap:wrap;gap:14px;">
                    <span>${s.start_date ? escapeHtml(formatDateRange(s.start_date, s.end_date)) : 'Fechas a definir'}</span>
                    <span>Para el artista: ${s.revenue_split_pct != null ? escapeHtml(Number(s.revenue_split_pct).toFixed(0)) + '%' : '—'}</span>
                    ${s.stipend_amount ? `<span>Stipend: ${escapeHtml(String(s.stipend_amount))} ${escapeHtml(s.stipend_currency || '')}</span>` : ''}
                </div>
            </div>
        `).join('');

        container.querySelectorAll('button[data-action]').forEach(btn => {
            btn.addEventListener('click', () => onSpotAction(btn.dataset.action, btn.dataset.id, btn.dataset.status));
        });
    }

    async function onSpotAction(action, id, status) {
        if (action === 'edit') {
            const { data: spot, error } = await WeotziData.StudioSpots.getById(id);
            if (error) { showStatus('spots-status', 'error', friendlyMessage(error, 'No pudimos abrir el spot.')); return; }
            if (spot) openSpotEditor(spot);
        } else if (action === 'apps') {
            openSpotApplications(id);
        } else if (action === 'toggle') {
            const next = status === 'open' ? 'closed' : 'open';
            const { error } = await WeotziData.StudioSpots.updateStatus(id, next);
            if (error) showStatus('spots-status', 'error', error.message);
            else { showStatus('spots-status', 'success', next === 'open' ? 'Spot publicado.' : 'Spot cerrado.'); await renderMySpots(); }
        } else if (action === 'delete') {
            if (!confirm('¿Eliminar este spot? Las postulaciones asociadas también se eliminarán.')) return;
            const { error } = await WeotziData.StudioSpots.deleteSpot(id);
            if (error) showStatus('spots-status', 'error', error.message);
            else { showStatus('spots-status', 'success', 'Spot eliminado.'); await renderMySpots(); }
        }
    }

    function openSpotEditor(existing) {
        const c = document.getElementById('spots-editor-container');
        const isEdit = !!existing;
        // Un spot leído con '*' dice qué columnas existen hoy.
        if (existing) spotColumnSupport = spotV2ColumnsFrom(existing);
        const v2Missing = spotColumnSupport !== null && !spotColumnSupport.has('compensation_model');
        const model = existing?.compensation_model || '';
        c.innerHTML = `
            <div class="studio-location-row" style="margin-bottom:18px;">
                <div class="studio-location-row-head">
                    <span class="studio-section-kicker">${isEdit ? 'Editar spot' : 'Nuevo spot'}</span>
                    <button type="button" class="studio-location-row-remove" id="spot-cancel">Cancelar</button>
                </div>
                <div class="studio-field">
                    <label class="studio-label" for="sp-title">Título</label>
                    <input id="sp-title" class="studio-input" value="${escapeAttr(existing?.title || '')}" required>
                </div>
                <div class="studio-field">
                    <label class="studio-label" for="sp-kind">Tipo</label>
                    <select id="sp-kind" class="studio-input">
                        <option value="guest_spot" ${existing?.kind === 'guest_spot' ? 'selected' : ''}>Guest spot</option>
                        <option value="resident" ${existing?.kind === 'resident' ? 'selected' : ''}>Residencia</option>
                        <option value="itinerant" ${existing?.kind === 'itinerant' ? 'selected' : ''}>Itinerante</option>
                    </select>
                </div>
                <div class="studio-field">
                    <label class="studio-label" for="sp-desc">Descripción</label>
                    <textarea id="sp-desc" class="studio-textarea" rows="4">${escapeHtml(existing?.description || '')}</textarea>
                </div>
                <div class="studio-field">
                    <label class="studio-label" for="sp-styles">Estilos buscados (coma)</label>
                    <input id="sp-styles" class="studio-input" value="${escapeAttr((existing?.styles_wanted || []).join(', '))}">
                </div>
                <div class="studio-field">
                    <label class="studio-label" for="sp-start">Fecha inicio / fin</label>
                    <div style="display:flex;gap:8px;">
                        <input id="sp-start" class="studio-input" type="date" value="${escapeAttr(existing?.start_date || '')}">
                        <input id="sp-end"   class="studio-input" type="date" value="${escapeAttr(existing?.end_date || '')}" aria-label="Fecha de fin">
                    </div>
                </div>
                <div class="studio-field">
                    <label class="studio-label" for="sp-model">Modalidad de pago</label>
                    <select id="sp-model" class="studio-input">
                        ${dictOptions(COMPENSATION_LABELS, model, 'Sin definir', 'compensationModel')}
                    </select>
                    ${v2Missing ? '<span class="studio-help">El pago fijo, el mixto y los beneficios se guardan cuando se aplique la migración pendiente.</span>' : ''}
                </div>
                <div class="studio-field" id="sp-pct-block">
                    <label class="studio-label" for="sp-split">Porcentaje para el artista (%)</label>
                    <input id="sp-split" class="studio-input" type="number" min="0" max="100" step="1" placeholder="60" value="${escapeAttr(existing?.revenue_split_pct ?? '')}">
                    <span class="studio-help">Lo que se queda el artista de cada tatuaje.</span>
                </div>
                <div class="studio-field" id="sp-fixed-block">
                    <label class="studio-label" for="sp-fixed-amount">Pago fijo</label>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;">
                        <input id="sp-fixed-amount" class="studio-input" type="number" min="0" step="1" placeholder="Monto" value="${escapeAttr(existing?.fixed_amount ?? '')}" style="flex:1;min-width:120px;">
                        <select id="sp-fixed-currency" class="studio-input" aria-label="Moneda del pago fijo" style="width:auto;">
                            ${currencyOptions(existing?.fixed_currency, 'Moneda')}
                        </select>
                        <select id="sp-fixed-period" class="studio-input" aria-label="Periodicidad del pago fijo" style="width:auto;">
                            ${dictOptions(FIXED_PERIOD_LABELS, existing?.fixed_period || '', 'Periodicidad', 'fixedPeriod')}
                        </select>
                    </div>
                    <select id="sp-fixed-payer" class="studio-input" aria-label="Quién paga el monto fijo" style="margin-top:8px;">
                        ${dictOptions(FIXED_PAYER_LABELS, existing?.fixed_payer || '', '¿Quién paga?', 'fixedPayer')}
                    </select>
                </div>
                <div class="studio-field">
                    <label class="studio-label" for="sp-stipend">Stipend opcional</label>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;">
                        <input id="sp-stipend"  class="studio-input" type="number" min="0" step="1" placeholder="Monto" value="${escapeAttr(existing?.stipend_amount ?? '')}" style="flex:1;min-width:120px;">
                        <select id="sp-currency" class="studio-input" aria-label="Moneda del stipend" style="width:auto;">
                            ${currencyOptions(existing?.stipend_currency, 'Moneda')}
                        </select>
                        <select id="sp-stipend-frequency" class="studio-input" aria-label="Frecuencia del stipend" style="width:auto;">
                            ${dictOptions(STIPEND_FREQUENCY_LABELS, existing?.stipend_frequency || '', 'Frecuencia', 'fixedPeriod')}
                        </select>
                    </div>
                </div>
                <div class="studio-field">
                    <label class="studio-label" style="display:inline-flex;gap:8px;align-items:center;">
                        <input id="sp-housing" type="checkbox" ${existing?.includes_housing ? 'checked' : ''}>
                        Incluye vivienda
                    </label>
                </div>
                ${SPOT_LISTS.map(def => `
                    <div class="studio-field" role="group" aria-labelledby="sp-list-label-${def.key}">
                        <p class="studio-label" id="sp-list-label-${def.key}">${escapeHtml(def.label)}</p>
                        <div data-spot-list="${def.key}"></div>
                    </div>`).join('')}
                <div class="studio-field">
                    <label class="studio-label" for="sp-cover">Imagen del spot (opcional)</label>
                    <input id="sp-cover" class="studio-input" type="url" value="${escapeAttr(existing?.cover_image || '')}">
                    <span class="studio-help">Si no subís nada, se usa la portada del estudio.</span>
                </div>
                <div style="display:flex;gap:10px;flex-wrap:wrap;">
                    <button id="sp-save"   class="studio-btn studio-btn-primary"><i class="fa-solid fa-floppy-disk"></i> Guardar como borrador</button>
                    <button id="sp-publish" class="studio-btn"><i class="fa-solid fa-rocket"></i> ${existing?.status === 'open' ? 'Republicar' : 'Publicar (abierto)'}</button>
                </div>
            </div>
        `;

        const listEditors = {};
        SPOT_LISTS.forEach(def => {
            const editor = makeListEditor({
                items: Array.isArray(existing?.[def.key]) ? existing[def.key] : [],
                max: def.max, maxLen: def.maxLen, placeholder: def.placeholder,
                label: def.label, labelId: 'sp-list-label-' + def.key
            });
            c.querySelector('[data-spot-list="' + def.key + '"]').appendChild(editor.el);
            listEditors[def.key] = editor;
        });

        const modelSelect = document.getElementById('sp-model');
        const syncModel = () => {
            const value = modelSelect.value;
            document.getElementById('sp-pct-block').hidden = value === 'fixed';
            document.getElementById('sp-fixed-block').hidden = !(value === 'fixed' || value === 'mixed');
        };
        modelSelect.addEventListener('change', syncModel);
        syncModel();

        document.getElementById('spot-cancel').addEventListener('click', () => { c.innerHTML = ''; });
        document.getElementById('sp-save').addEventListener('click', () => saveSpot(existing, 'draft', listEditors));
        document.getElementById('sp-publish').addEventListener('click', () => saveSpot(existing, 'open', listEditors));

        // Wire uploader on the spot cover.
        if (window.WeOtziUploader) {
            window.WeOtziUploader.attach(document.getElementById('sp-cover'), {
                supabase,
                bucket: 'studio-spot-attachments',
                pathPrefix: studio.id + '/' + (existing?.id || 'new'),
                accept: 'image/*',
                placeholder: 'pegá una URL'
            });
        }
    }

    function readSpotTerms() {
        const model = document.getElementById('sp-model').value || null;
        const fixedOn = model === 'fixed' || model === 'mixed';
        const stipendAmount = numOrNull(document.getElementById('sp-stipend').value);
        return {
            compensation_model: model,
            revenue_split_pct: model === 'fixed' ? null : numOrNull(document.getElementById('sp-split').value),
            fixed_amount:   fixedOn ? numOrNull(document.getElementById('sp-fixed-amount').value) : null,
            fixed_currency: fixedOn ? (document.getElementById('sp-fixed-currency').value || null) : null,
            fixed_period:   fixedOn ? (document.getElementById('sp-fixed-period').value || null) : null,
            fixed_payer:    fixedOn ? (document.getElementById('sp-fixed-payer').value || null) : null,
            stipend_amount: stipendAmount,
            stipend_currency: document.getElementById('sp-currency').value || null,
            stipend_frequency: stipendAmount != null ? (document.getElementById('sp-stipend-frequency').value || null) : null
        };
    }

    async function saveSpot(existing, targetStatus, listEditors) {
        const lists = {};
        SPOT_LISTS.forEach(def => { lists[def.key] = listEditors && listEditors[def.key] ? listEditors[def.key].getItems() : []; });
        const terms = readSpotTerms();
        const payload = Object.assign({
            studio_id: studio.id,
            location_id: studio.primary_location_id || null,
            title: document.getElementById('sp-title').value.trim(),
            kind: document.getElementById('sp-kind').value,
            description: document.getElementById('sp-desc').value.trim() || null,
            styles_wanted: (document.getElementById('sp-styles').value || '')
                .split(',').map(s => s.trim()).filter(Boolean),
            start_date: document.getElementById('sp-start').value || null,
            end_date: document.getElementById('sp-end').value || null,
            includes_housing:  document.getElementById('sp-housing').checked,
            cover_image:       (document.getElementById('sp-cover')?.value || '').trim() || null,
            status: targetStatus
        }, terms, lists);
        if (!payload.title) { showStatus('spots-status', 'error', 'El título es obligatorio.'); return; }
        if (payload.end_date && payload.start_date && payload.end_date < payload.start_date) {
            showStatus('spots-status', 'error', 'La fecha final debe ser igual o posterior al inicio.'); return;
        }
        const invalid = validateSpotTerms(payload) || validateSpotLists(lists);
        if (invalid) { showStatus('spots-status', 'error', invalid); return; }

        const buttons = ['sp-save', 'sp-publish'].map(id => document.getElementById(id)).filter(Boolean);
        buttons.forEach(b => { b.disabled = true; });
        let saved;
        try {
            saved = await persistSpot(existing ? existing.id : null, payload);
        } finally {
            buttons.forEach(b => { b.disabled = false; });
        }
        const { result, degraded } = saved;
        if (result.error) {
            showStatus('spots-status', 'error', friendlyMessage(result.error, 'No se pudo guardar el spot.'));
            return;
        }
        await syncSpotCoverAttachment(result.data, payload.cover_image);
        const done = existing ? 'Spot actualizado.' : 'Spot creado.';
        if (degraded) {
            showStatus('spots-status', 'info', done + ' La modalidad fija o mixta y los beneficios todavía no se pueden guardar (falta aplicar una migración).');
        } else {
            showStatus('spots-status', 'success', done);
        }
        document.getElementById('spots-editor-container').innerHTML = '';
        await renderMySpots();
    }

    async function syncSpotCoverAttachment(savedSpot, coverImage) {
        if (!savedSpot?.id) return;

        const del = await WeotziData.StudioSpots.deleteAttachmentsBySpot(savedSpot.id);
        if (del.error) {
            console.warn('[studio-dashboard] spot attachment cleanup failed:', del.error);
            showStatus('spots-status', 'error', 'Spot guardado, pero no pudimos actualizar sus adjuntos.');
            return;
        }

        if (!coverImage) return;

        const attachment = {
            spot_id: savedSpot.id,
            storage_path: storagePathFromUrl(coverImage, 'studio-spot-attachments') || (studio.id + '/' + savedSpot.id + '/cover'),
            file_url: coverImage,
            file_name: fileNameFromUrl(coverImage),
            mime_type: guessMimeFromUrl(coverImage),
            sort_order: 0
        };
        const ins = await WeotziData.StudioSpots.insertAttachment(attachment);
        if (ins.error) {
            console.warn('[studio-dashboard] spot attachment insert failed:', ins.error);
            showStatus('spots-status', 'error', 'Spot guardado, pero no pudimos registrar la imagen como adjunto.');
        }
    }

    function hasContractsModule() {
        return !!(window.WeOtziStudioContracts && typeof window.WeOtziStudioContracts.openFromApplication === 'function');
    }

    // Acciones de una postulación según su estado. shortlisted = aceptada con
    // contrato en preparación (se reabre el contrato).
    function applicationActionsHtml(app, artistUserId) {
        if (['accepted', 'rejected', 'withdrawn'].includes(app.status)) return '—';
        const acceptLabel = app.status === 'shortlisted' && hasContractsModule() ? 'Contrato' : 'Aceptar';
        return `
            <button class="studio-locations-add" data-app-action="accept" data-id="${escapeAttr(app.id)}" data-artist="${escapeAttr(artistUserId || '')}" style="border-style:solid;padding:4px 8px;">${acceptLabel}</button>
            <button class="studio-location-row-remove" data-app-action="reject" data-id="${escapeAttr(app.id)}">Rechazar</button>`;
    }

    async function openSpotApplications(spotId) {
        const c = document.getElementById('spots-editor-container');
        c.innerHTML = '<em class="studio-help">Cargando postulaciones…</em>';

        const [spotRes, appsRes] = await Promise.all([
            WeotziData.StudioSpots.getSummaryById(spotId),
            WeotziData.StudioSpots.listApplications(spotId)
        ]);

        if (spotRes.error) { c.innerHTML = '<em>' + escapeHtml(spotRes.error.message) + '</em>'; return; }
        if (appsRes.error) { c.innerHTML = '<em>' + escapeHtml(appsRes.error.message) + '</em>'; return; }

        const spot = spotRes.data;
        const apps = appsRes.data || [];

        c.innerHTML = `
            <div class="studio-location-row" style="margin-bottom:18px;">
                <div class="studio-location-row-head">
                    <span class="studio-section-kicker">Postulaciones · ${escapeHtml(spot.title)}</span>
                    <button type="button" class="studio-location-row-remove" id="apps-close">Cerrar</button>
                </div>
                ${apps.length === 0
                    ? '<p class="studio-help">Aún no hay postulaciones a este spot.</p>'
                    : `<table class="studio-roster-table"><thead><tr>
                            <th>Artista</th><th>Estilo</th><th>Ciudad</th><th>Mensaje</th><th>Estado</th><th>Acciones</th>
                       </tr></thead><tbody>
                       ${apps.map(a => {
                           const ar = a.artists_db || {};
                           const styles = (ar.styles_array || []).slice(0, 2).join(', ');
                           const msg = (a.message || '').slice(0, 80) + (a.message && a.message.length > 80 ? '…' : '');
                           const portfolio = safeUrl(a.portfolio_url);
                           return `<tr data-id="${escapeAttr(a.id)}">
                                <td><strong>${escapeHtml(ar.name || ar.username || '—')}</strong>
                                    ${portfolio ? `<br><a href="${escapeAttr(portfolio)}" target="_blank" rel="noopener noreferrer" style="color:var(--primary-red);font-size:.75rem;">Portfolio ↗</a>` : ''}
                                </td>
                                <td>${escapeHtml(styles)}</td>
                                <td>${escapeHtml([ar.city, ar.country].filter(Boolean).join(', '))}</td>
                                <td>${escapeHtml(msg)}</td>
                                <td><span class="studio-role-pill role-${a.status === 'accepted' ? 'resident' : (a.status === 'rejected' ? 'guest' : 'itinerant')}">${escapeHtml(APPLICATION_STATUS_LABELS[a.status] || a.status)}</span></td>
                                <td>${applicationActionsHtml(a, ar.user_id)}</td>
                           </tr>`;
                       }).join('')}
                       </tbody></table>`}
            </div>
        `;
        document.getElementById('apps-close').addEventListener('click', () => { c.innerHTML = ''; });
        c.querySelectorAll('button[data-app-action]').forEach(btn => {
            btn.addEventListener('click', () => onAppDecision(btn.dataset.appAction, btn.dataset.id, btn.dataset.artist, spot));
        });
    }

    async function afterApplicationDecision(spot) {
        await openSpotApplications(spot.id);
        await renderMySpots();
        await loadRoster();
        await loadBadges();
    }

    async function onAppDecision(action, applicationId, artistUserId, spot) {
        const buttons = document.querySelectorAll('#spots-editor-container button[data-app-action]');
        const release = () => buttons.forEach(button => { button.disabled = false; });
        buttons.forEach(button => { button.disabled = true; });

        if (action === 'reject') {
            const ok = await confirmAction({
                title: 'Rechazar postulación',
                body: '¿Rechazar esta postulación? El artista recibe un aviso.',
                confirmLabel: 'Rechazar',
                tone: 'danger'
            });
            if (!ok) { release(); return; }
        }

        // Aceptar = abrir el contrato. Sin módulo o sin RPC de contratos se usa
        // el flujo anterior (decide_studio_spot_application + spot_decision).
        if (action === 'accept' && hasContractsModule()) {
            try {
                const outcome = await window.WeOtziStudioContracts.openFromApplication(
                    { id: applicationId, artist_user_id: artistUserId || null },
                    { id: spot.id, title: spot.title, kind: spot.kind }
                );
                // Sin contrato preparado (el estudio cerró el editor antes): solo refrescar.
                if (!outcome || !outcome.contractId) {
                    await afterApplicationDecision(spot);
                    return;
                }
                const msg = outcome.issued
                    ? 'Contrato emitido: cuando el artista lo firme, se suma al roster.'
                    : ACCEPT_COPY;
                showStatus('spots-status', 'success', msg);
                toast(msg, 'success');
                await afterApplicationDecision(spot);
                return;
            } catch (err) {
                if (!isMissingContractsBackend(err)) {
                    release();
                    showStatus('spots-status', 'error', friendlyMessage(err, 'No pudimos preparar el contrato.'));
                    return;
                }
                console.warn('[studio-dashboard] contratos no disponibles, uso el flujo anterior:', err);
            }
        }

        await decideApplicationLegacy(action, applicationId, spot, release);
    }

    async function decideApplicationLegacy(action, applicationId, spot, release) {
        const newStatus = action === 'accept' ? 'accepted' : 'rejected';
        const spots = WeotziData.StudioSpots;
        if (!spots || typeof spots.decideApplicationRpc !== 'function') {
            release();
            showStatus('spots-status', 'error', 'No pudimos registrar la decisión. Recargá la página e intentá nuevamente.');
            return;
        }
        const { data, error: updErr } = await spots.decideApplicationRpc(applicationId, newStatus);
        if (updErr) {
            release();
            showStatus('spots-status', 'error', friendlyMessage(updErr, 'No pudimos registrar la decisión.'));
            return;
        }
        let emailSent = false;

        // Fire-and-forget email notification. Failure here doesn't roll back
        // the DB change — the operator already committed by clicking accept/reject.
        try {
            await notifyStudio({
                kind: 'spot_decision',
                application_id: applicationId,
                decision: newStatus
            });
            emailSent = true;
        } catch (err) {
            console.warn('[studio-dashboard] notify failed (non-fatal):', err);
        }

        // Con contratos aplicados la RPC deja la postulación en shortlisted y
        // prepara el borrador; sin la migración, la acepta directamente.
        const row = Array.isArray(data) ? data[0] : data;
        const outcome = action === 'accept'
            ? (row && row.status === 'accepted' ? 'Postulación aceptada.' : ACCEPT_COPY)
            : 'Postulación rechazada.';
        showStatus('spots-status', emailSent ? 'success' : 'info', outcome + (emailSent
            ? ' Email enviado al artista.' : ' La decisión está guardada; no se pudo enviar el correo al artista.'));
        await afterApplicationDecision(spot);
    }

    function numOrNull(v) {
        const n = Number(v);
        return Number.isFinite(n) && v !== '' && v != null ? n : null;
    }
    function storagePathFromUrl(url, bucket) {
        const raw = String(url || '');
        const markers = [
            '/storage/v1/object/public/' + bucket + '/',
            '/storage/v1/object/sign/' + bucket + '/'
        ];
        for (const marker of markers) {
            const idx = raw.indexOf(marker);
            if (idx !== -1) return decodeURIComponent(raw.slice(idx + marker.length).split('?')[0]);
        }
        return '';
    }
    function fileNameFromUrl(url) {
        const path = String(url || '').split('?')[0].split('/').pop();
        return path ? decodeURIComponent(path) : 'cover-image';
    }
    function guessMimeFromUrl(url) {
        const clean = String(url || '').split('?')[0].toLowerCase();
        if (clean.endsWith('.png')) return 'image/png';
        if (clean.endsWith('.webp')) return 'image/webp';
        if (clean.endsWith('.gif')) return 'image/gif';
        if (clean.endsWith('.svg')) return 'image/svg+xml';
        return 'image/jpeg';
    }
    function formatDateRange(start, end) {
        if (!start) return '';
        const opts = { day: '2-digit', month: 'short' };
        const s = new Date(start).toLocaleDateString('es-AR', opts);
        if (!end) return 'Desde ' + s;
        const e = new Date(end).toLocaleDateString('es-AR', { ...opts, year: 'numeric' });
        return s + ' – ' + e;
    }
    function escapeAttr(v) { return escapeHtml(v); }

    // -------------------------------------------------------------
    // Roster tab — Phase C (full CRUD + invitations)
    // -------------------------------------------------------------
    let _rosterLocations = []; // cached list of studio_locations for the role/sede selects
    let _inviteHits = [];

    const MEMBERSHIP_STATUS_LABELS = {
        requested: 'Solicitud', pending_invite: 'Invitación pendiente', pending_acceptance: 'Invitación pendiente',
        active: 'Activo', paused: 'En pausa', ended: 'Finalizado', rejected: 'Rechazado'
    };
    const ROSTER_EDITABLE = ['active', 'paused', 'pending_acceptance', 'pending_invite'];
    const ROSTER_LOCK_COPY = 'Se edita con una nueva versión del contrato';

    // Con contrato vigente, rol y split salen del contrato (el guard los vuelve inmutables).
    function rosterRowLocked(m) { return !!(m && m.current_contract_id); }

    // Acción principal por estado. Las filas ended/rejected no se reactivan:
    // volver a activo solo pasa por RPC (solicitud, invitación o contrato).
    function rosterActionFor(status) {
        if (status === 'active') return 'end';
        if (status === 'pending_acceptance' || status === 'pending_invite') return 'cancel';
        if (status === 'paused') return 'resume';
        if (status === 'requested') return 'review';
        return null;
    }

    function rosterActionButton(action, id) {
        const attr = escapeAttr(id);
        if (action === 'end') return `<button class="studio-location-row-remove" data-action="end" data-id="${attr}">Desvincular</button>`;
        if (action === 'cancel') return `<button class="studio-location-row-remove" data-action="cancel" data-id="${attr}">Cancelar</button>`;
        if (action === 'resume') return `<button class="studio-locations-add" data-action="resume" data-id="${attr}" style="border-style:solid;padding:4px 8px;">Reactivar</button>`;
        if (action === 'review') return `<button class="studio-locations-add" data-action="review" data-id="${attr}" style="border-style:solid;padding:4px 8px;">Ver solicitud</button>`;
        return '';
    }

    function rosterRowHtml(m, locations) {
        const a = m.artists_db || {};
        const display = a.name || a.username || '—';
        const locked = rosterRowLocked(m);
        const lockId = 'roster-lock-' + m.id;
        const lockAttrs = locked ? ` disabled aria-describedby="${escapeAttr(lockId)}"` : '';
        const sedeOpts = '<option value="">— Sin asignar —</option>'
            + (locations || []).map(l => `<option value="${escapeAttr(l.id)}" ${l.id === m.location_id ? 'selected' : ''}>${escapeHtml(l.label || '(sin etiqueta)')}</option>`).join('');
        const roleOpts = ['resident', 'itinerant', 'guest', 'manager'].map(r =>
            `<option value="${r}" ${r === m.role ? 'selected' : ''}>${escapeHtml(KIND_TO_LABEL[r] || r)}</option>`).join('');
        const pending = m.status === 'pending_acceptance' || m.status === 'pending_invite' || m.status === 'requested';
        const editable = ROSTER_EDITABLE.includes(m.status);

        return `
                <tr data-id="${escapeAttr(m.id)}" data-membership-id="${escapeAttr(m.id)}" data-status="${escapeAttr(m.status)}" data-role="${escapeAttr(m.role)}" data-artist-user-id="${escapeAttr(a.user_id || '')}" data-artist-name="${escapeAttr(display)}"${locked ? ' data-locked="true"' : ''}>
                    <td>
                        <strong>${escapeHtml(display)}</strong>
                        <br><small style="color:var(--text-secondary);font-family:var(--studio-mono);">@${escapeHtml(a.username || '')}</small>
                        <br><small style="color:var(--text-secondary);">${escapeHtml([a.city, a.country].filter(Boolean).join(', ') || '—')}</small>
                    </td>
                    <td>
                        <span class="studio-role-pill role-${escapeAttr(m.role)}" style="margin-bottom:4px;display:inline-block;">${escapeHtml(KIND_TO_LABEL[m.role] || m.role)}</span><br>
                        <select class="studio-input" data-field="role" aria-label="Rol"${lockAttrs} style="height:32px;font-size:.78rem;">${roleOpts}</select>
                        ${locked ? `<br><small class="studio-help" id="${escapeAttr(lockId)}">${ROSTER_LOCK_COPY}</small>` : ''}
                    </td>
                    <td>
                        <select class="studio-input" data-field="location_id" aria-label="Sede" style="height:32px;font-size:.78rem;">${sedeOpts}</select>
                    </td>
                    <td>
                        <input class="studio-input" data-field="revenue_split_pct" aria-label="Porcentaje para el artista" type="number" min="0" max="100" step="1"${lockAttrs} style="height:32px;font-size:.78rem;width:70px;" value="${escapeAttr(m.revenue_split_pct ?? '')}">
                    </td>
                    <td>
                        <span class="studio-role-pill" style="background:${m.status === 'active' ? 'var(--primary-yellow)' : 'var(--bg)'};border-style:${pending ? 'dashed' : 'solid'};">${escapeHtml(kitLabel('membershipStatus', m.status, MEMBERSHIP_STATUS_LABELS))}</span>
                    </td>
                    <td class="studio-roster-actions">
                        ${editable ? `<button class="studio-locations-add" data-action="save" data-id="${escapeAttr(m.id)}" style="border-style:solid;padding:4px 8px;">Guardar</button>` : ''}
                        ${rosterActionButton(rosterActionFor(m.status), m.id)}
                    </td>
                </tr>
            `;
    }

    async function loadRoster() {
        // Populate the sede select for invitations.
        const { data: locs } = await WeotziData.StudioLocations.listActiveByStudio(studio.id, 'id, label, is_primary');
        _rosterLocations = locs || [];

        const sel = document.getElementById('invite-location');
        if (sel) {
            sel.innerHTML = '<option value="">Sin asignar</option>'
                + _rosterLocations.map(l =>
                    `<option value="${escapeAttr(l.id)}" ${l.is_primary ? 'selected' : ''}>${escapeHtml(l.label || '(sin etiqueta)')}${l.is_primary ? ' (principal)' : ''}</option>`
                ).join('');
        }

        wireInviteSearch();

        // Vence contratos enviados y cierra los firmados fuera de vigencia antes de pintar.
        await expireOverdueContracts();
        await renderRosterTable();
    }

    async function expireOverdueContracts() {
        const repo = WeotziData.StudioContracts;
        if (!repo || typeof repo.expireOverdue !== 'function') return;
        try {
            const result = await repo.expireOverdue(studio.id);
            if (result && result.error) console.warn('[studio-dashboard] expireOverdue:', result.error);
        } catch (err) {
            console.warn('[studio-dashboard] expireOverdue:', err);
        }
    }

    function registerArtistUrl() {
        const auth = window.WeOtziStudioAuth;
        const path = auth && typeof auth.appUrl === 'function' ? auth.appUrl('/register-artist') : '/register-artist';
        return window.location.origin + path;
    }

    function inviteEmptyHtml() {
        return `<div class="studio-location-row">
                    <span class="studio-help">¿No está en We Ötzi? Compartile el link de registro.</span>
                    <button type="button" class="studio-locations-add" data-copy-register style="border-style:solid;padding:6px 10px;">
                        <i class="fa-solid fa-link"></i> Copiar link de registro
                    </button>
                </div>`;
    }

    async function copyRegisterLink() {
        const url = registerArtistUrl();
        try {
            if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') throw new Error('clipboard');
            await navigator.clipboard.writeText(url);
            showStatus('roster-status', 'success', 'Link de registro copiado: ' + url);
        } catch (err) {
            showStatus('roster-status', 'info', 'Copiá y compartí este link: ' + url);
        }
    }

    function wireInviteSearch() {
        const input = document.getElementById('invite-search');
        const suggEl = document.getElementById('invite-suggestions');
        const sendBtn = document.getElementById('invite-send');
        let chosen = null;

        if (!input || !suggEl || !sendBtn) return;
        if (input.dataset.inviteWired === 'true') return;
        input.dataset.inviteWired = 'true';

        let debounceTimer = null;
        input.addEventListener('input', () => {
            const q = input.value.trim();
            if (debounceTimer) clearTimeout(debounceTimer);
            chosen = null;
            if (q.length < 2) { suggEl.style.display = 'none'; suggEl.innerHTML = ''; return; }
            debounceTimer = setTimeout(async () => {
                const term = q.replace(/^@/, '');
                const { data, error } = await WeotziData.Artists.searchByUsernameOrName(term);
                if (q !== input.value.trim()) return;
                if (error) { showStatus('roster-status', 'error', 'No se pudieron buscar artistas. Intentá nuevamente.'); return; }
                _inviteHits = data || [];
                suggEl.innerHTML = _inviteHits.map(a => `
                    <div class="studio-location-row" data-id="${escapeAttr(a.user_id)}" style="cursor:pointer;">
                        <strong>${escapeHtml(a.name || a.username)}</strong>
                        <span class="studio-help">@${escapeHtml(a.username || '')} · ${escapeHtml([a.city, a.country].filter(Boolean).join(', ') || '—')}</span>
                    </div>
                `).join('') || inviteEmptyHtml();
                suggEl.style.display = 'block';
                suggEl.querySelectorAll('[data-id]').forEach(row => {
                    row.addEventListener('click', () => {
                        chosen = row.dataset.id;
                        input.value = row.querySelector('strong').textContent;
                        suggEl.style.display = 'none';
                    });
                });
                suggEl.querySelector('[data-copy-register]')?.addEventListener('click', copyRegisterLink);
            }, 200);
        });

        sendBtn.addEventListener('click', async () => {
            if (!chosen) {
                showStatus('roster-status', 'error', 'Elegí un artista de las sugerencias.');
                return;
            }
            const role     = document.getElementById('invite-role').value;
            const location = document.getElementById('invite-location').value || null;
            sendBtn.disabled = true;
            sendBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';

            const { data: insertedRows, error } = await WeotziData.StudioMemberships.inviteArtist({
                studio_id:       studio.id,
                artist_user_id:  chosen,
                location_id:     location,
                role,
                status:          'pending_acceptance',
                invited_at:      new Date().toISOString(),
                invited_by_user_id: studio.user_id || null
            });

            sendBtn.disabled = false;
            sendBtn.innerHTML = '<i class="fa-solid fa-user-plus"></i> Invitar';

            if (error) {
                if (error.code === '23505') {
                    showStatus('roster-status', 'error', 'Ese artista ya tiene una invitación o un vínculo abierto con ese rol en tu estudio.');
                } else {
                    showStatus('roster-status', 'error', friendlyMessage(error, 'No se pudo enviar la invitación.'));
                }
                return;
            }

            // Notify the artist by email (fire-and-forget).
            const newId = insertedRows && insertedRows.id;
            let emailSent = false;
            if (newId) {
                try {
                    await notifyStudio({ kind: 'roster_invite', membership_id: newId });
                    emailSent = true;
                } catch (err) {
                    console.warn('[studio-dashboard] roster invite notify failed (non-fatal):', err);
                }
            }

            input.value = '';
            chosen = null;
            showStatus('roster-status', emailSent ? 'success' : 'info', emailSent
                ? 'Invitación enviada. Le mandamos un email al artista.'
                : 'Invitación guardada y disponible en el panel del artista. No se pudo enviar el correo.');
            await renderRosterTable();
        });
    }

    // listRosterV2 suma initiated_by y current_contract_id (con su propio
    // fallback); si no existe o falla, se usa listRoster.
    async function loadRosterRows() {
        const repo = WeotziData.StudioMemberships;
        if (typeof repo.listRosterV2 === 'function') {
            try {
                const v2 = await repo.listRosterV2(studio.id);
                if (v2 && !v2.error) return v2;
                console.warn('[studio-dashboard] listRosterV2 falló, uso listRoster:', v2 && v2.error);
            } catch (err) {
                console.warn('[studio-dashboard] listRosterV2 falló, uso listRoster:', err);
            }
        }
        return repo.listRoster(studio.id);
    }

    async function renderRosterTable() {
        const container = document.getElementById('roster-content');
        if (!container || !studio) return;
        const { data: members, error } = await loadRosterRows();

        if (error) { container.innerHTML = '<em>' + escapeHtml(friendlyMessage(error, 'No pudimos cargar el roster.')) + '</em>'; return; }
        if (!members || members.length === 0) {
            container.innerHTML = '<p class="studio-help">Aún no hay miembros. Invitá artistas con el formulario de arriba.</p>';
            admin._emitRosterRender(null, []);
            return;
        }

        container.innerHTML = `
            <table class="studio-roster-table">
                <thead><tr>
                    <th>Artista</th><th>Rol</th><th>Sede</th><th>Para el artista %</th><th>Estado</th><th>Acciones</th>
                </tr></thead>
                <tbody>${members.map(m => rosterRowHtml(m, _rosterLocations)).join('')}</tbody>
            </table>
        `;
        container.querySelectorAll('button[data-action]').forEach(btn => {
            btn.addEventListener('click', () => onRosterAction(btn));
        });
        // Los módulos (p. ej. Contratos) agregan sus botones por fila acá.
        admin._emitRosterRender(container.querySelector('table'), members);
    }

    async function onRosterAction(btn) {
        const id     = btn.dataset.id;
        const action = btn.dataset.action;
        const tr = btn.closest('tr');
        const artistUserId = tr.dataset.artistUserId || '';
        const artistName = tr.dataset.artistName || 'Artista';

        if (action === 'save') {
            const location_id  = tr.querySelector('select[data-field="location_id"]').value || null;
            // Con contrato vigente solo se puede mover de sede.
            if (tr.dataset.locked === 'true') {
                const { error } = await WeotziData.StudioMemberships.updateMembership(id, { location_id });
                if (error) showStatus('roster-status', 'error', friendlyMessage(error, 'No se pudo guardar.'));
                else { showStatus('roster-status', 'success', 'Sede actualizada.'); await renderRosterTable(); }
                return;
            }
            const role         = tr.querySelector('select[data-field="role"]').value;
            const splitInput   = tr.querySelector('input[data-field="revenue_split_pct"]').value;
            const split        = splitInput === '' ? null : Number(splitInput);
            if (split !== null && (!Number.isFinite(split) || split < 0 || split > 100)) {
                showStatus('roster-status', 'error', 'El reparto debe estar entre 0 y 100.'); return;
            }
            const { error } = await WeotziData.StudioMemberships.updateMembership(id, { role, location_id, revenue_split_pct: split });
            if (error) showStatus('roster-status', 'error', friendlyMessage(error, 'No se pudo guardar.'));
            else { showStatus('roster-status', 'success', 'Cambios guardados.'); await renderRosterTable(); }
        } else if (action === 'end') {
            if (!confirm('¿Desvincular a este artista? Su perfil queda intacto.')) return;
            const { error } = await WeotziData.StudioMemberships.endMembership(id);
            if (error) showStatus('roster-status', 'error', friendlyMessage(error, 'No se pudo desvincular.'));
            else {
                showStatus('roster-status', 'success', 'Vínculo finalizado.');
                if (artistUserId && window.WeOtziReviews && confirm('¿Querés calificar al artista ahora?')) {
                    window.WeOtziReviews.openReviewModal({
                        title: 'Calificar artista',
                        reviewerType: 'studio',
                        contextType: 'studio_membership',
                        contextId: id,
                        revieweeType: 'artist',
                        revieweeUserId: artistUserId,
                        revieweeDisplayName: artistName
                    });
                }
                await renderRosterTable();
            }
        } else if (action === 'cancel') {
            const { error } = await WeotziData.StudioMemberships.deleteMembership(id);
            if (error) showStatus('roster-status', 'error', friendlyMessage(error, 'No se pudo cancelar la invitación.'));
            else { showStatus('roster-status', 'success', 'Invitación cancelada.'); await renderRosterTable(); }
        } else if (action === 'resume') {
            const { error } = await WeotziData.StudioMemberships.resumeMembership(id);
            if (error) showStatus('roster-status', 'error', friendlyMessage(error, 'No se pudo reactivar.'));
            else { showStatus('roster-status', 'success', 'Vínculo reactivado.'); await renderRosterTable(); }
        } else if (action === 'review') {
            admin.navigate('solicitudes');
        }
    }

    const KIND_TO_LABEL = {
        resident: 'Residente', itinerant: 'Itinerante', guest: 'Guest', manager: 'Manager'
    };
})();
