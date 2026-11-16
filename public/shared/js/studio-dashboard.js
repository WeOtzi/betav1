// ============================================
// Studio Dashboard
// Perfil, sedes, roster, spots y cuenta. Operaciones lives in the companion module.
// ============================================

(function () {
    'use strict';

    let studio = null;          // studios row
    let supabase = null;
    const summary = {
        locations: null, roster: null, spots: null,
        state: { profile: 'loading', locations: 'loading', roster: 'loading', spots: 'loading' },
        errors: {}
    };

    function publishSummary(area, state, data, error) {
        if (area) {
            summary.state[area] = state;
            if (area !== 'profile' && data !== undefined) summary[area] = data;
            if (error) summary.errors[area] = error.message || String(error);
            else delete summary.errors[area];
        }
        const detail = { studio, ...summary, state: { ...summary.state }, errors: { ...summary.errors } };
        window.WeOtziStudioDashboardSummary = detail;
        window.dispatchEvent(new CustomEvent('studio:dashboard-summary', { detail }));
    }

    document.addEventListener('DOMContentLoaded', async () => {
        const auth = window.WeOtziStudioAuth;
        if (!auth) return; // studio-auth.js handles redirect-on-no-session

        await auth.ready();
        supabase = auth.getSupabase();
        studio = auth.getCurrent() || await auth.check();
        if (!studio) {
            // The auth.check() may already be redirecting; just bail.
            return;
        }

        document.getElementById('studio-name-display').textContent = studio.name || 'Mi estudio';
        document.getElementById('view-public-profile').href =
            auth.appUrl('/studio/profile/?studio=') + encodeURIComponent(studio.slug || studio.id);

        document.getElementById('logout-btn').addEventListener('click', () => auth.logout());

        if (studio.access === 'manager') {
            // Manager del estudio: solo Mensajes y Equipo → solicitudes de cambio.
            // Perfil, sedes, roster, spots, operaciones, finanzas y cuenta quedan
            // fuera (además, la base solo autoriza al dueño en esas áreas).
            applyManagerMode(studio);
            wireTabs();
            return;
        }

        wireTabs();
        wireAccount();
        publishSummary();
        for (const [area, load, statusId] of [
            ['profile', loadProfile, 'profile-status'], ['locations', loadSedes, 'sedes-status'],
            ['roster', loadRoster, 'roster-status'], ['spots', loadSpotsPanel, 'spots-status']
        ]) {
            try { await load(); }
            catch (error) {
                publishSummary(area, 'error', undefined, error);
                showStatus(statusId, 'error', error.message || 'No se pudo cargar esta sección. Recarga la página para intentar nuevamente.');
            }
        }
    });

    function escapeHtml(v) {
        return String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    const MANAGER_TABS = ['mensajes', 'roster'];

    function applyManagerMode(current) {
        document.body.dataset.studioAccess = 'manager';
        document.querySelectorAll('.studio-dash-panel[data-panel]').forEach(panel => {
            if (!MANAGER_TABS.includes(panel.dataset.panel)) panel.remove();
        });
        document.querySelectorAll('.studio-dash-tab[data-tab]').forEach(tab => {
            if (!MANAGER_TABS.includes(tab.dataset.tab)) tab.hidden = true;
        });
        const roster = document.querySelector('.studio-dash-panel[data-panel="roster"]');
        if (roster) {
            roster.querySelectorAll('.studio-invite-form, #roster-content, .steam-toolbar, #team-email-invite, #team-requests, .steam-roster, #team-links').forEach(node => node.remove());
            const title = roster.querySelector('.studio-h1');
            if (title) title.innerHTML = 'Solicitudes <span class="accent">de cambio</span>';
            const help = roster.querySelector('.studio-panel-content > .studio-help');
            if (help) help.textContent = 'Responde los pedidos de cambio de las invitaciones del estudio. Como manager puedes ajustar sede, fechas, duración y mensaje; el rol manager y el reparto los define el dueño.';
            const aside = roster.querySelector('.studio-context');
            if (aside) aside.innerHTML = '<h3>Acceso de manager</h3><p>Entras como manager de ' + escapeHtml(current.name || 'este estudio') + '. Ves los mensajes del estudio y las solicitudes de cambio; el resto del panel lo administra el dueño.</p>';
        }
        const heading = document.querySelector('.studio-workspace-heading p');
        if (heading) heading.textContent = 'Acceso de manager: mensajes y solicitudes de cambio del equipo.';
        if (!MANAGER_TABS.includes(window.location.hash.slice(1))) {
            history.replaceState(null, '', window.location.pathname + window.location.search + '#mensajes');
        }
    }

    function wireTabs() {
        let current = null;
        function activate(want) {
            const panels = Array.from(document.querySelectorAll('.studio-dash-panel[data-panel]'));
            const fallback = panels.some(panel => panel.dataset.panel === 'resumen') ? 'resumen'
                : panels.some(panel => panel.dataset.panel === 'perfil') ? 'perfil' : (panels[0] && panels[0].dataset.panel);
            if (!panels.some(panel => panel.dataset.panel === want)) want = fallback;
            document.querySelectorAll('.studio-dash-tab').forEach(tab => {
                const active = tab.dataset.tab === want;
                tab.classList.toggle('is-active', active);
                if (active) tab.setAttribute('aria-current', 'page');
                else tab.removeAttribute('aria-current');
            });
            panels.forEach(panel => {
                const active = panel.dataset.panel === want;
                panel.classList.toggle('is-active', active);
                panel.hidden = !active;
            });
            if (current !== want) window.dispatchEvent(new CustomEvent('studio:tabchange', { detail: { tab: want } }));
            current = want;
        }
        document.addEventListener('click', event => {
            const tab = event.target.closest('.studio-dash-tab[data-tab]');
            if (!tab || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            const want = tab.dataset.tab;
            if (!Array.from(document.querySelectorAll('.studio-dash-panel[data-panel]')).some(panel => panel.dataset.panel === want)) return;
            event.preventDefault();
            activate(want);
            if (window.location.hash !== '#' + want) window.location.hash = want;
        });
        window.addEventListener('hashchange', () => activate(window.location.hash.slice(1)));
        activate(window.location.hash.slice(1));
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
        // Español neutro: los errores de la base todavía llegan en voseo (neutral-es.js).
        if (window.WoNeutralEs) msg = window.WoNeutralEs.neutralize(msg);
        el.className = 'studio-status studio-status-' + kind;
        el.textContent = msg;
        el.hidden = false;
        el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
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
                supabase, bucket: 'studio-photos', designSystem: true,
                pathPrefix: pathPrefix + '/cover',
                placeholder: 'pega una URL de portada',
                accept: 'image/*'
            });

            window.WeOtziUploader.attach(document.getElementById('p-logo'), {
                supabase, bucket: 'studio-photos', designSystem: true,
                pathPrefix: pathPrefix + '/logo',
                placeholder: 'pega una URL del logo',
                accept: 'image/*'
            });

            const galleryContainer = document.getElementById('p-gallery');
            if (galleryContainer) {
                const initialUrls = (studio.photo_feed_items || []).map(p => p.url).filter(Boolean);
                window.WeOtziUploader.attachGallery(galleryContainer, {
                    supabase,
                    bucket: 'studio-photos',
                    designSystem: true,
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
                    throw new Error('Revisa el año de fundación.');
                }
                const { error } = await WeotziData.Studios.updateProfile(studio.id, update);
                if (error) throw error;
                Object.assign(studio, update);
                document.getElementById('studio-name-display').textContent = studio.name;
                publishSummary('profile', 'ready');
                showStatus('profile-status', 'success', 'Perfil actualizado.');
            } catch (err) { showStatus('profile-status', 'error', err.message || 'No se pudo guardar.'); }
            finally { button.disabled = false; }
        });
        publishSummary('profile', 'ready');
    }

    // -------------------------------------------------------------
    // Sedes tab
    // -------------------------------------------------------------
    // Módulo studio-dashboard-sedes.js (E-LOC-01/02/03): lista con conteo de
    // artistas, editor con Places + pin, archivar, principal y quitar con diálogo.
    async function loadSedes() {
        if (!window.WeOtziStudioSedes) {
            publishSummary('locations', 'error', undefined, new Error('No se pudo cargar el módulo de sedes.'));
            showStatus('sedes-status', 'error', 'No pudimos cargar el panel de sedes. Recarga la página.');
            return;
        }
        await window.WeOtziStudioSedes.mount({
            studio, showStatus, publishSummary,
            onChanged: async () => {
                const { data: updated } = await WeotziData.Studios.getById(studio.id);
                if (updated) Object.assign(studio, updated);
                await loadRoster();
            }
        });
    }

    // -------------------------------------------------------------
    // Spots tab — Phase B
    // -------------------------------------------------------------
    const KIND_LABELS = { resident: 'Residencia', itinerant: 'Itinerante', guest_spot: 'Guest spot' };

    async function loadSpotsPanel() {
        document.getElementById('spot-new-btn').addEventListener('click', () => openSpotEditor(null));
        await renderMySpots();
    }

    async function renderMySpots() {
        const container = document.getElementById('my-spots-list');
        publishSummary('spots', 'loading');
        container.innerHTML = '<p class="wo-help" role="status">Cargando spots…</p>';
        const { data: list, error } = await WeotziData.StudioSpots.listByStudio(studio.id);
        if (error) {
            publishSummary('spots', 'error', undefined, error);
            container.innerHTML = '<p class="wo-error-msg" role="alert">No pudimos cargar los spots. ' + escapeHtml(error.message) + '</p>'; return;
        }
        publishSummary('spots', 'ready', list || []);
        if (!list || list.length === 0) {
            container.innerHTML = '<p class="wo-help">Aún no publicaste spots. Toca "Nuevo spot" para empezar.</p>';
            return;
        }
        container.innerHTML = list.map(s => `
            <div class="studio-location-row">
                <div class="studio-location-row-head">
                    <span class="wo-badge wo-badge--s wo-badge--outline">${escapeHtml(KIND_LABELS[s.kind] || s.kind)} · ${escapeHtml(s.status)}</span>
                    <div class="studio-actions">
                        <button class="wo-btn wo-btn--secondary wo-btn--s" data-action="apps" data-id="${escapeAttr(s.id)}" >
                            Postulaciones (${s.application_count || 0})
                        </button>
                        <button class="wo-btn wo-btn--secondary wo-btn--s" data-action="edit" data-id="${escapeAttr(s.id)}" >Editar</button>
                        <button class="wo-btn wo-btn--secondary wo-btn--s" data-action="toggle" data-id="${escapeAttr(s.id)}" data-status="${escapeAttr(s.status)}" >
                            ${s.status === 'open' ? 'Cerrar' : (s.status === 'draft' ? 'Publicar' : 'Reabrir')}
                        </button>
                        <button class="wo-btn wo-btn--danger wo-btn--s" data-action="delete" data-id="${escapeAttr(s.id)}">Borrar</button>
                    </div>
                </div>
                <h3 class="studio-item-title">
                    ${escapeHtml(s.title)}
                </h3>
                <div class="wo-help studio-meta-row">
                    <span>${s.start_date ? formatDateRange(s.start_date, s.end_date) : 'Fechas a definir'}</span>
                    <span>Split: ${s.revenue_split_pct != null ? Number(s.revenue_split_pct).toFixed(0) + '%' : '—'}</span>
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
            const { data: spot } = await WeotziData.StudioSpots.getById(id);
            if (spot) openSpotEditor(spot);
        } else if (action === 'apps') {
            openSpotApplications(id);
        } else if (action === 'toggle') {
            const next = status === 'open' ? 'closed' : 'open';
            const { error } = await WeotziData.StudioSpots.updateStatus(id, next);
            if (error) showStatus('spots-status', 'error', error.message);
            else { showStatus('spots-status', 'success', 'Estado actualizado a ' + next + '.'); await renderMySpots(); }
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
        c.innerHTML = `
            <div class="studio-location-row" >
                <div class="studio-location-row-head">
                    <h3 class="studio-item-title">${isEdit ? 'Editar spot' : 'Nuevo spot'}</h3>
                    <button type="button" class="wo-btn wo-btn--danger wo-btn--s" id="spot-cancel">Cancelar</button>
                </div>
                <div class="studio-form-grid">
                <div class="wo-field">
                    <label class="wo-label" for="sp-title">Título</label>
                    <input id="sp-title" class="wo-input" value="${escapeAttr(existing?.title || '')}" required>
                </div>
                <div class="wo-field">
                    <label class="wo-label" for="sp-kind">Tipo</label>
                    <select id="sp-kind" class="wo-select">
                        <option value="guest_spot" ${existing?.kind === 'guest_spot' ? 'selected' : ''}>Guest spot</option>
                        <option value="resident" ${existing?.kind === 'resident' ? 'selected' : ''}>Residencia</option>
                        <option value="itinerant" ${existing?.kind === 'itinerant' ? 'selected' : ''}>Itinerante</option>
                    </select>
                </div>
                <div class="wo-field studio-form-full">
                    <label class="wo-label" for="sp-desc">Descripción</label>
                    <textarea id="sp-desc" class="wo-textarea" rows="4">${escapeHtml(existing?.description || '')}</textarea>
                </div>
                <div class="wo-field">
                    <label class="wo-label" for="sp-styles">Estilos buscados (coma)</label>
                    <input id="sp-styles" class="wo-input" value="${escapeAttr((existing?.styles_wanted || []).join(', '))}">
                </div>
                <div class="wo-field">
                    <label class="wo-label">Fecha inicio / fin</label>
                    <div class="studio-control-row">
                        <input id="sp-start" class="wo-input" type="date" aria-label="Fecha de inicio del spot" value="${escapeAttr(existing?.start_date || '')}">
                        <input id="sp-end"   class="wo-input" type="date" aria-label="Fecha de fin del spot" value="${escapeAttr(existing?.end_date || '')}">
                    </div>
                </div>
                <div class="wo-field studio-form-full">
                    <label class="wo-label">Split (%) y stipend opcional</label>
                    <div class="studio-control-row">
                        <input id="sp-split"    class="wo-input" type="number" min="0" max="100" step="1" aria-label="Reparto porcentual del spot" placeholder="60" value="${escapeAttr(existing?.revenue_split_pct ?? '')}">
                        <input id="sp-stipend"  class="wo-input" type="number" min="0" step="1" aria-label="Estipendio del spot" placeholder="Stipend" value="${escapeAttr(existing?.stipend_amount ?? '')}">
                        <input id="sp-currency" class="wo-input" aria-label="Moneda del estipendio" placeholder="USD" value="${escapeAttr(existing?.stipend_currency || '')}">
                    </div>
                </div>
                <div class="wo-field">
                    <label class="wo-check">
                        <input id="sp-housing" type="checkbox" ${existing?.includes_housing ? 'checked' : ''}>
                        Incluye vivienda
                    </label>
                </div>
                <div class="wo-field studio-form-full">
                    <label class="wo-label" for="sp-cover">Imagen del spot (opcional)</label>
                    <input id="sp-cover" class="wo-input" type="url" value="${escapeAttr(existing?.cover_image || '')}">
                    <span class="wo-help">Si no subes nada, se usa la portada del estudio.</span>
                </div>
                </div>
                <div class="studio-actions">
                    <button id="sp-save"   class="wo-btn"><i data-wo-icon="save" aria-hidden="true"></i> Guardar como borrador</button>
                    <button id="sp-publish" class="wo-btn wo-btn--secondary"><i data-wo-icon="send" aria-hidden="true"></i> ${existing?.status === 'open' ? 'Republicar' : 'Publicar (abierto)'}</button>
                </div>
            </div>
        `;
        document.getElementById('spot-cancel').addEventListener('click', () => { c.innerHTML = ''; });
        document.getElementById('sp-save').addEventListener('click', () => saveSpot(existing, 'draft'));
        document.getElementById('sp-publish').addEventListener('click', () => saveSpot(existing, 'open'));

        // Wire uploader on the spot cover.
        if (window.WeOtziUploader) {
            window.WeOtziUploader.attach(document.getElementById('sp-cover'), {
                supabase,
                bucket: 'studio-spot-attachments', designSystem: true,
                pathPrefix: studio.id + '/' + (existing?.id || 'new'),
                accept: 'image/*',
                placeholder: 'pega una URL'
            });
        }
    }

    async function saveSpot(existing, targetStatus) {
        const payload = {
            studio_id: studio.id,
            location_id: studio.primary_location_id || null,
            title: document.getElementById('sp-title').value.trim(),
            kind: document.getElementById('sp-kind').value,
            description: document.getElementById('sp-desc').value.trim() || null,
            styles_wanted: (document.getElementById('sp-styles').value || '')
                .split(',').map(s => s.trim()).filter(Boolean),
            start_date: document.getElementById('sp-start').value || null,
            end_date: document.getElementById('sp-end').value || null,
            revenue_split_pct: numOrNull(document.getElementById('sp-split').value),
            stipend_amount:    numOrNull(document.getElementById('sp-stipend').value),
            stipend_currency:  (document.getElementById('sp-currency').value || '').trim() || null,
            includes_housing:  document.getElementById('sp-housing').checked,
            cover_image:       (document.getElementById('sp-cover')?.value || '').trim() || null,
            status: targetStatus
        };
        if (!payload.title) { showStatus('spots-status', 'error', 'El título es obligatorio.'); return; }
        if (payload.end_date && payload.start_date && payload.end_date < payload.start_date) {
            showStatus('spots-status', 'error', 'La fecha final debe ser igual o posterior al inicio.'); return;
        }
        if (payload.revenue_split_pct != null && (payload.revenue_split_pct < 0 || payload.revenue_split_pct > 100)) {
            showStatus('spots-status', 'error', 'El reparto debe estar entre 0 y 100.'); return;
        }
        if (payload.stipend_amount != null && payload.stipend_amount < 0) {
            showStatus('spots-status', 'error', 'El estipendio no puede ser negativo.'); return;
        }

        const result = existing
            ? await WeotziData.StudioSpots.updateSpot(existing.id, payload)
            : await WeotziData.StudioSpots.createSpot(payload);

        if (result.error) {
            showStatus('spots-status', 'error', result.error.message);
            return;
        }
        await syncSpotCoverAttachment(result.data, payload.cover_image);
        showStatus('spots-status', 'success', existing ? 'Spot actualizado.' : 'Spot creado.');
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

    async function openSpotApplications(spotId) {
        const c = document.getElementById('spots-editor-container');
        c.innerHTML = '<em class="wo-help">Cargando postulaciones…</em>';

        const [spotRes, appsRes] = await Promise.all([
            WeotziData.StudioSpots.getSummaryById(spotId),
            WeotziData.StudioSpots.listApplications(spotId)
        ]);

        if (spotRes.error) { c.innerHTML = '<em>' + escapeHtml(spotRes.error.message) + '</em>'; return; }
        if (appsRes.error) { c.innerHTML = '<em>' + escapeHtml(appsRes.error.message) + '</em>'; return; }

        const spot = spotRes.data;
        const apps = appsRes.data || [];

        // Abrir el panel = el estudio vio las postulaciones pendientes: pasan a
        // "viewed" y el artista ve "En revisión". No bloquea la vista.
        const pendingIds = apps.filter(a => a.status === 'pending').map(a => a.id);
        if (pendingIds.length && typeof WeotziData.StudioSpots.markViewed === 'function') {
            try {
                const { data: viewed, error: viewErr } = await WeotziData.StudioSpots.markViewed(pendingIds);
                if (viewErr) throw viewErr;
                const changed = new Set((viewed || []).map(v => v.id));
                apps.forEach(a => { if (changed.has(a.id)) a.status = 'viewed'; });
            } catch (viewErr) {
                console.warn('[studio-dashboard] marcar vistas:', viewErr && viewErr.message);
            }
        }

        c.innerHTML = `
            <div class="studio-location-row" >
                <div class="studio-location-row-head">
                    <h3 class="studio-item-title">Postulaciones · ${escapeHtml(spot.title)}</h3>
                    <button type="button" class="wo-btn wo-btn--danger wo-btn--s" id="apps-close">Cerrar</button>
                </div>
                ${apps.length === 0
                    ? '<p class="wo-help">Aún no hay postulaciones a este spot.</p>'
                    : `<div class="studio-table-scroll" role="region" aria-label="Postulaciones al spot" tabindex="0"><table class="wo-table studio-roster-table"><thead><tr>
                            <th>Artista</th><th>Estilo</th><th>Ciudad</th><th>Mensaje</th><th>Estado</th><th>Acciones</th>
                       </tr></thead><tbody>
                       ${apps.map(a => {
                           const ar = a.artists_db || {};
                           const styles = (ar.styles_array || []).slice(0, 2).join(', ');
                           const msg = (a.message || '').slice(0, 80) + (a.message && a.message.length > 80 ? '…' : '');
                           const decided = ['accepted', 'rejected', 'withdrawn', 'shortlisted'].includes(a.status);
                           return `<tr data-id="${escapeAttr(a.id)}">
                                <td><strong>${escapeHtml(ar.name || ar.username || '—')}</strong>
                                    ${a.portfolio_url ? `<br><a href="${escapeAttr(a.portfolio_url)}" target="_blank" rel="noopener">Ver portfolio <i data-wo-icon="external-link" aria-hidden="true"></i></a>` : ''}
                                </td>
                                <td>${escapeHtml(styles)}</td>
                                <td>${escapeHtml([ar.city, ar.country].filter(Boolean).join(', '))}</td>
                                <td>${escapeHtml(msg)}</td>
                                <td><span class="wo-badge wo-badge--s ${a.status === 'accepted' || a.status === 'shortlisted' ? 'wo-badge--success' : (a.status === 'rejected' ? 'wo-badge--error' : 'wo-badge--outline')}">${escapeHtml(APP_STATUS_LABELS[a.status] || a.status)}</span></td>
                                <td>${decided ? '—' : `
                                    <button class="wo-btn wo-btn--secondary wo-btn--s" data-app-action="accept" data-id="${escapeAttr(a.id)}" data-artist="${escapeAttr(ar.user_id)}" >Aceptar</button>
                                    <button class="wo-btn wo-btn--danger wo-btn--s" data-app-action="reject" data-id="${escapeAttr(a.id)}">Rechazar</button>
                                `}</td>
                           </tr>`;
                       }).join('')}
                       </tbody></table></div>`}
            </div>
        `;
        document.getElementById('apps-close').addEventListener('click', () => { c.innerHTML = ''; });
        c.querySelectorAll('button[data-app-action]').forEach(btn => {
            btn.addEventListener('click', () => onAppDecision(btn.dataset.appAction, btn.dataset.id, btn.dataset.artist, spot));
        });
    }

    async function onAppDecision(action, applicationId, artistUserId, spot) {
        const newStatus = action === 'accept' ? 'accepted' : 'rejected';
        const buttons = document.querySelectorAll('#spots-editor-container button[data-app-action]');
        buttons.forEach(button => { button.disabled = true; });
        const { error: updErr } = await supabase.rpc('decide_studio_spot_application', {
            p_application_id: applicationId, p_status: newStatus
        });
        if (updErr) {
            buttons.forEach(button => { button.disabled = false; });
            showStatus('spots-status', 'error', updErr.message);
            return;
        }
        let emailSent = false;
        // ── roster (ROSTER-13): aceptar deja la postulación preseleccionada y
        // prepara un contrato en borrador, pero NO suma al artista al equipo.
        // Se le envía una invitación (pending_acceptance) con el rol, la sede,
        // el reparto y las fechas del spot; queda en el equipo al aceptarla.
        let invitationNote = '';
        if (action === 'accept' && artistUserId) {
            invitationNote = await inviteFromSpot(spot.id, artistUserId);
        }

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

        const outcome = action === 'accept'
            ? 'Postulación aceptada. ' + (invitationNote || 'Le enviamos al artista la invitación para sumarse a tu equipo.')
            : 'Postulación rechazada.';
        showStatus('spots-status', emailSent ? 'success' : 'info', outcome + (emailSent
            ? ' Email enviado al artista.' : ' La decisión está guardada; no se pudo enviar el correo al artista.'));
        await openSpotApplications(spot.id);
        await renderMySpots();
        await loadRoster();
    }

    // ── roster (ROSTER-13): invitación al equipo desde un spot aceptado.
    // Devuelve el texto para el aviso; nunca lanza.
    async function inviteFromSpot(spotId, artistUserId) {
        const roleByKind = { guest_spot: 'guest', itinerant: 'itinerant', resident: 'resident' };
        try {
            const { data: full } = await WeotziData.StudioSpots.getById(spotId, 'id, title, kind, location_id, revenue_split_pct, start_date, end_date');
            const spotRow = full || {};
            const { data: inserted, error } = await WeotziData.StudioMemberships.inviteArtist({
                studio_id: studio.id,
                artist_user_id: artistUserId,
                location_id: spotRow.location_id || null,
                role: roleByKind[spotRow.kind] || 'resident',
                revenue_split_pct: spotRow.revenue_split_pct ?? null,
                status: 'pending_acceptance',
                invited_at: new Date().toISOString(),
                invited_by_user_id: studio.user_id || null
            });
            if (error) {
                if (error.code === '23505') return 'El artista ya tenía un vínculo abierto con tu estudio en ese rol.';
                console.warn('[studio-dashboard] invitación desde el spot:', error.message);
                return 'No pudimos crear la invitación al equipo: invítalo desde Equipo.';
            }
            if (inserted && inserted.id) {
                await WeotziData.StudioMemberships.saveInvitationDetails(inserted.id, {
                    message: 'Aceptamos tu postulación a «' + (spotRow.title || 'nuestro spot') + '». Confirma la invitación para sumarte al equipo.',
                    proposed_start_date: spotRow.start_date || null,
                    proposed_end_date: spotRow.end_date || null
                });
            }
            return 'Le enviamos al artista la invitación para sumarse a tu equipo.';
        } catch (inviteErr) {
            console.warn('[studio-dashboard] invitación desde el spot:', inviteErr);
            return 'No pudimos crear la invitación al equipo: invítalo desde Equipo.';
        }
    }

    function numOrNull(v) {
        const n = Number(v);
        return Number.isFinite(n) && v !== '' ? n : null;
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
    // Roster tab — ── roster: la pestaña Equipo (E-TEAM-01..04, solicitudes
    // de alta, enlace e invitación por email) vive en studio-dashboard-team.js.
    // -------------------------------------------------------------
    async function loadRoster() {
        const team = window.WeOtziStudioTeam;
        if (!team) throw new Error('No pudimos cargar el módulo de equipo. Recarga la página.');
        await team.init({
            studio,
            supabase,
            showStatus,
            publishSummary,
            notifyStudio,
            getAccessToken,
            appUrl: (path) => window.WeOtziStudioAuth.appUrl(path)
        });
    }

    // ── roster: estados de postulación en español.
    const APP_STATUS_LABELS = {
        pending: 'Nueva', viewed: 'Vista', shortlisted: 'Aceptada · invitación enviada', accepted: 'Aceptada', rejected: 'Rechazada', withdrawn: 'Retirada'
    };

    const KIND_TO_LABEL = {
        resident: 'Residente', itinerant: 'Itinerante', guest: 'Guest', manager: 'Manager'
    };
})();
