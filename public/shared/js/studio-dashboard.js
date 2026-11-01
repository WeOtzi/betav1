// ============================================
// Studio Dashboard
// Perfil, sedes, roster, spots y cuenta. Operaciones lives in the companion module.
// ============================================

(function () {
    'use strict';

    let studio = null;          // studios row
    let supabase = null;
    const sedePickers = [];     // { row, picker, address, locationId, isPrimary }
    let sedeFieldId = 0;
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
                showStatus(statusId, 'error', error.message || 'No se pudo cargar esta sección. Recargá la página para intentar nuevamente.');
            }
        }
    });

    function escapeHtml(v) {
        return String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function wireTabs() {
        let current = null;
        function activate(want) {
            const panels = Array.from(document.querySelectorAll('.studio-dash-panel[data-panel]'));
            const fallback = panels.some(panel => panel.dataset.panel === 'resumen') ? 'resumen' : 'perfil';
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
                placeholder: 'pegá una URL de portada',
                accept: 'image/*'
            });

            window.WeOtziUploader.attach(document.getElementById('p-logo'), {
                supabase, bucket: 'studio-photos', designSystem: true,
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
                    throw new Error('Revisá el año de fundación.');
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
    async function loadSedes() {
        const list = document.getElementById('sedes-list');
        publishSummary('locations', 'loading');
        list.innerHTML = '<p class="wo-help" role="status">Cargando sedes…</p>';

        const { data: locations, error } = await WeotziData.StudioLocations.listByStudio(studio.id);

        if (error) {
            publishSummary('locations', 'error', undefined, error);
            list.innerHTML = '<p class="wo-error-msg" role="alert">No pudimos cargar las sedes. ' + escapeHtml(error.message) + '</p>';
            return;
        }
        publishSummary('locations', 'ready', locations || []);

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
        const fieldId = 'studio-location-' + (++sedeFieldId);
        const label = (existing && existing.label) || (idx === 0 ? 'Sede principal' : 'Sede #' + (idx + 1));

        row.innerHTML = `
            <div class="studio-location-row-head">
                <h3 class="studio-item-title">${escapeHtml(label)}</h3>
                <div class="studio-actions">
                    <label class="wo-check studio-inline-control">
                        <input type="checkbox" data-field="is_primary" ${existing && existing.is_primary ? 'checked' : ''}> Principal
                    </label>
                    <button type="button" class="wo-btn wo-btn--danger wo-btn--s" data-action="remove">Quitar</button>
                    <button type="button" class="wo-btn wo-btn--secondary wo-btn--s" data-action="save" >Guardar</button>
                </div>
            </div>
            <div class="studio-form-grid">
            <div class="wo-field">
                <label class="wo-label" for="${fieldId}-label">Etiqueta</label>
                <input type="text" id="${fieldId}-label" class="wo-input" data-field="label" value="${escapeHtml(label)}">
            </div>
            <div class="wo-field">
                <label class="wo-label" for="${fieldId}-address">Dirección</label>
                <input type="text" id="${fieldId}-address" class="wo-input weotzi-address-picker-input" data-field="address" placeholder="Buscá la dirección…" autocomplete="off"
                       value="${existing ? escapeHtml(existing.formatted_address || '') : ''}">
                <div class="weotzi-address-fields" data-field="preview" hidden></div>
            </div>
            <details class="studio-manual-address studio-form-full">
                <summary class="wo-help">Ingresar dirección manualmente</summary>
                <div class="studio-form-grid">
                <div class="wo-field"><label class="wo-label" for="${fieldId}-city">Ciudad</label><input id="${fieldId}-city" class="wo-input" data-field="manual-city" value="${escapeHtml(existing?.city || '')}"></div>
                <div class="wo-field"><label class="wo-label" for="${fieldId}-country">País</label><input id="${fieldId}-country" class="wo-input" data-field="manual-country" value="${escapeHtml(existing?.country || '')}"></div>
                </div>
                <button type="button" class="wo-btn wo-btn--secondary wo-btn--s" data-action="manual">Usar la dirección escrita arriba</button>
                <p class="wo-help">Podés buscarla en el mapa después.</p>
            </details>
            <div class="wo-field"><label class="wo-label" for="${fieldId}-phone">Teléfono de la sede</label><input type="tel" id="${fieldId}-phone" class="wo-input" data-field="phone" value="${escapeHtml(existing?.phone || '')}"></div>
            <div class="wo-field"><label class="wo-label" for="${fieldId}-hours">Horarios de atención</label><textarea id="${fieldId}-hours" class="wo-textarea" data-field="hours" placeholder="Lunes a viernes de 10 a 19 h">${escapeHtml(existing?.hours_json?.description || '')}</textarea></div>
            </div>
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
            container.innerHTML = '<p class="wo-help">Aún no publicaste spots. Tocá "Nuevo spot" para empezar.</p>';
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
                    <span class="wo-help">Si no subís nada, se usa la portada del estudio.</span>
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
                placeholder: 'pegá una URL'
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
                           const decided = ['accepted', 'rejected', 'withdrawn'].includes(a.status);
                           return `<tr data-id="${escapeAttr(a.id)}">
                                <td><strong>${escapeHtml(ar.name || ar.username || '—')}</strong>
                                    ${a.portfolio_url ? `<br><a href="${escapeAttr(a.portfolio_url)}" target="_blank" rel="noopener">Ver portfolio <i data-wo-icon="external-link" aria-hidden="true"></i></a>` : ''}
                                </td>
                                <td>${escapeHtml(styles)}</td>
                                <td>${escapeHtml([ar.city, ar.country].filter(Boolean).join(', '))}</td>
                                <td>${escapeHtml(msg)}</td>
                                <td><span class="wo-badge wo-badge--s ${a.status === 'accepted' ? 'wo-badge--success' : (a.status === 'rejected' ? 'wo-badge--error' : 'wo-badge--outline')}">${escapeHtml(a.status)}</span></td>
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

        const outcome = action === 'accept' ? '¡Aceptado y sumado al roster!' : 'Postulación rechazada.';
        showStatus('spots-status', emailSent ? 'success' : 'info', outcome + (emailSent
            ? ' Email enviado al artista.' : ' La decisión está guardada; no se pudo enviar el correo al artista.'));
        await openSpotApplications(spot.id);
        await renderMySpots();
        await loadRoster();
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
    // Roster tab — Phase C (full CRUD + invitations)
    // -------------------------------------------------------------
    let _rosterLocations = []; // cached list of studio_locations for the role/sede selects
    let _inviteHits = [];

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

        await renderRosterTable();
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
            if (q.length < 2) { suggEl.hidden = true; suggEl.innerHTML = ''; return; }
            debounceTimer = setTimeout(async () => {
                const term = q.replace(/^@/, '');
                const { data, error } = await WeotziData.Artists.searchByUsernameOrName(term);
                if (q !== input.value.trim()) return;
                if (error) { showStatus('roster-status', 'error', 'No se pudieron buscar artistas. Intentá nuevamente.'); return; }
                _inviteHits = data || [];
                suggEl.innerHTML = _inviteHits.map(a => `
                    <button type="button" class="studio-search-result" data-id="${escapeAttr(a.user_id)}">
                        <strong>${escapeHtml(a.name || a.username)}</strong>
                        <span class="wo-help">@${escapeHtml(a.username || '')} · ${escapeHtml([a.city, a.country].filter(Boolean).join(', ') || '—')}</span>
                    </button>
                `).join('') || '<em class="wo-help">Sin resultados.</em>';
                suggEl.hidden = false;
                suggEl.querySelectorAll('[data-id]').forEach(row => {
                    row.addEventListener('click', () => {
                        chosen = row.dataset.id;
                        input.value = row.querySelector('strong').textContent;
                        suggEl.hidden = true;
                    });
                });
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
            sendBtn.innerHTML = 'Enviando…';

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
            sendBtn.innerHTML = '<i data-wo-icon="user-plus" aria-hidden="true"></i> Invitar';

            if (error) {
                if (error.code === '23505') {
                    showStatus('roster-status', 'error', 'Ese artista ya tiene una membership de ese rol con tu estudio.');
                } else {
                    showStatus('roster-status', 'error', error.message);
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

    async function renderRosterTable() {
        const container = document.getElementById('roster-content');
        publishSummary('roster', 'loading');
        container.innerHTML = '<p class="wo-help" role="status">Cargando equipo…</p>';
        const { data: members, error } = await WeotziData.StudioMemberships.listRoster(studio.id);

        if (error) {
            publishSummary('roster', 'error', undefined, error);
            container.innerHTML = '<p class="wo-error-msg" role="alert">No pudimos cargar el equipo. ' + escapeHtml(error.message) + '</p>'; return;
        }
        publishSummary('roster', 'ready', members || []);
        if (!members || members.length === 0) {
            container.innerHTML = '<p class="wo-help">Aún no hay miembros. Invitá artistas con el formulario de arriba.</p>';
            return;
        }

        const rows = members.map(m => {
            const a = m.artists_db || {};
            const display = a.name || a.username || '—';
            const sedeName = (_rosterLocations.find(l => l.id === m.location_id) || {}).label || '—';
            const sedeOpts = '<option value="">— Sin asignar —</option>'
                + _rosterLocations.map(l => `<option value="${escapeAttr(l.id)}" ${l.id === m.location_id ? 'selected' : ''}>${escapeHtml(l.label || '(sin etiqueta)')}</option>`).join('');
            const roleOpts = ['resident','itinerant','guest','manager'].map(r =>
                `<option value="${r}" ${r === m.role ? 'selected' : ''}>${KIND_TO_LABEL[r] || r}</option>`).join('');

            return `
                <tr data-id="${escapeAttr(m.id)}" data-artist-user-id="${escapeAttr(a.user_id || '')}" data-artist-name="${escapeAttr(display)}">
                    <td>
                        <strong>${escapeHtml(display)}</strong>
                        <br><small class="studio-member-meta">@${escapeHtml(a.username || '')}</small>
                        <br><small class="studio-member-meta">${escapeHtml([a.city, a.country].filter(Boolean).join(', ') || '—')}</small>
                    </td>
                    <td>
                        <span class="wo-badge wo-badge--s wo-badge--outline">${escapeHtml(KIND_TO_LABEL[m.role] || m.role)}</span><br>
                        <select class="wo-select" data-field="role" aria-label="Rol de ${escapeAttr(display)}">${roleOpts}</select>
                    </td>
                    <td>
                        <select class="wo-select" data-field="location_id" aria-label="Sede de ${escapeAttr(display)}">${sedeOpts}</select>
                    </td>
                    <td>
                        <input class="wo-input" data-field="revenue_split_pct" type="number" min="0" max="100" step="1" aria-label="Reparto porcentual de ${escapeAttr(display)}" value="${m.revenue_split_pct ?? ''}">
                    </td>
                    <td>
                        <span class="wo-badge wo-badge--s ${m.status === 'active' ? 'wo-badge--success' : 'wo-badge--outline'}">${escapeHtml(m.status)}</span>
                    </td>
                    <td>
                        <button class="wo-btn wo-btn--secondary wo-btn--s" data-action="save"     data-id="${escapeAttr(m.id)}" >Guardar</button>
                        ${m.status === 'active'
                            ? `<button class="wo-btn wo-btn--danger wo-btn--s" data-action="end" data-id="${escapeAttr(m.id)}">Desvincular</button>`
                            : (m.status === 'pending_acceptance'
                                ? `<button class="wo-btn wo-btn--danger wo-btn--s" data-action="cancel" data-id="${escapeAttr(m.id)}">Cancelar</button>`
                                : `<button class="wo-btn wo-btn--secondary wo-btn--s" data-action="resume" data-id="${escapeAttr(m.id)}" >Reactivar</button>`)
                        }
                    </td>
                </tr>
            `;
        }).join('');

        container.innerHTML = `
            <div class="studio-table-scroll" role="region" aria-label="Equipo del estudio" tabindex="0"><table class="wo-table studio-roster-table">
                <thead><tr>
                    <th>Artista</th><th>Rol</th><th>Sede</th><th>Split %</th><th>Estado</th><th>Acciones</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table></div>
        `;
        container.querySelectorAll('button[data-action]').forEach(btn => {
            btn.addEventListener('click', () => onRosterAction(btn));
        });
    }

    async function onRosterAction(btn) {
        const id     = btn.dataset.id;
        const action = btn.dataset.action;
        const tr = btn.closest('tr');
        const artistUserId = tr.dataset.artistUserId || '';
        const artistName = tr.dataset.artistName || 'Artista';

        if (action === 'save') {
            const role         = tr.querySelector('select[data-field="role"]').value;
            const location_id  = tr.querySelector('select[data-field="location_id"]').value || null;
            const splitInput   = tr.querySelector('input[data-field="revenue_split_pct"]').value;
            const split        = splitInput === '' ? null : Number(splitInput);
            if (split !== null && (!Number.isFinite(split) || split < 0 || split > 100)) {
                showStatus('roster-status', 'error', 'El reparto debe estar entre 0 y 100.'); return;
            }
            const { error } = await WeotziData.StudioMemberships.updateMembership(id, { role, location_id, revenue_split_pct: split });
            if (error) showStatus('roster-status', 'error', error.message);
            else { showStatus('roster-status', 'success', 'Cambios guardados.'); await renderRosterTable(); }
        } else if (action === 'end') {
            if (!confirm('¿Desvincular a este artista? Su perfil queda intacto.')) return;
            const { error } = await WeotziData.StudioMemberships.endMembership(id);
            if (error) showStatus('roster-status', 'error', error.message);
            else {
                showStatus('roster-status', 'success', 'Membership finalizada.');
                if (artistUserId && window.WeOtziReviews && confirm('Quieres calificar al artista ahora?')) {
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
            if (error) showStatus('roster-status', 'error', error.message);
            else { showStatus('roster-status', 'success', 'Invitación cancelada.'); await renderRosterTable(); }
        } else if (action === 'resume') {
            const { error } = await WeotziData.StudioMemberships.resumeMembership(id);
            if (error) showStatus('roster-status', 'error', error.message);
            else { showStatus('roster-status', 'success', 'Membership reactivada.'); await renderRosterTable(); }
        }
    }

    const KIND_TO_LABEL = {
        resident: 'Residente', itinerant: 'Itinerante', guest: 'Guest', manager: 'Manager'
    };
})();
