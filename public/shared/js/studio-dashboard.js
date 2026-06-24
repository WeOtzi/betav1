// ============================================
// Studio Dashboard
// Tabs: Perfil (edit studio row), Sedes (CRUD studio_locations), Roster
// (read-only list of active memberships), Spots/Ops/Analytics (stubs).
// ============================================

(function () {
    'use strict';

    let studio = null;          // studios row
    let supabase = null;
    const sedePickers = [];     // { row, picker, address, locationId, isPrimary }

    document.addEventListener('DOMContentLoaded', async () => {
        const auth = window.WeOtziStudioAuth;
        if (!auth) return; // studio-auth.js handles redirect-on-no-session

        supabase = auth.getSupabase();
        // The auth check fires on DOMContentLoaded too — wait for it to settle.
        for (let i = 0; i < 20; i++) {
            studio = auth.getCurrent();
            if (studio) break;
            await wait(150);
        }
        if (!studio && typeof auth.check === 'function') {
            studio = await auth.check();
        }
        if (!studio) {
            // The auth.check() may already be redirecting; just bail.
            return;
        }

        document.getElementById('studio-name-display').innerHTML =
            'Panel · <span class="accent">' + escapeHtml(studio.name || 'Mi estudio') + '</span>';
        document.getElementById('view-public-profile').href =
            '/studio/profile/?studio=' + encodeURIComponent(studio.slug || studio.id);

        document.getElementById('logout-btn').addEventListener('click', () => auth.logout());

        wireTabs();
        await loadProfile();
        await loadSedes();
        await loadRoster();
        await loadSpotsPanel();
    });

    function wait(ms) { return new Promise(r => setTimeout(r, ms)); }
    function escapeHtml(v) {
        return String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function wireTabs() {
        document.querySelectorAll('.studio-dash-tab').forEach(tab => {
            tab.addEventListener('click', e => {
                e.preventDefault();
                const want = tab.dataset.tab;
                document.querySelectorAll('.studio-dash-tab').forEach(t =>
                    t.classList.toggle('is-active', t === tab));
                document.querySelectorAll('.studio-dash-panel').forEach(p =>
                    p.classList.toggle('is-active', p.dataset.panel === want));
            });
        });
    }

    function showStatus(elId, kind, msg) {
        const el = document.getElementById(elId);
        if (!el) return;
        el.className = 'studio-status studio-status-' + kind;
        el.textContent = msg;
        el.hidden = false;
        setTimeout(() => { el.hidden = true; }, 5000);
    }

    async function getAccessToken() {
        const { data } = await supabase.auth.getSession();
        return data?.session?.access_token || null;
    }

    async function notifyStudio(payload) {
        const token = await getAccessToken();
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers.Authorization = 'Bearer ' + token;
        const response = await fetch('/api/studio/notify', {
            method: 'POST',
            headers,
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            const text = await response.text();
            throw new Error(text || ('Studio notify failed with ' + response.status));
        }
        return response.json().catch(() => ({}));
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
            const photoUrls = (document.getElementById('p-photos').value || '')
                .split('\n').map(s => s.trim()).filter(s => /^https?:\/\//.test(s));
            const photoFeedItems = photoUrls.map((url, i) => ({
                url, kind: 'image', category: 'studio', sort: i,
                created_at: new Date().toISOString()
            }));

            const update = {
                name:             document.getElementById('p-name').value.trim(),
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

            const { error } = await WeotziData.Studios.updateProfile(studio.id, update);
            if (error) {
                showStatus('profile-status', 'error', error.message || 'No se pudo guardar.');
                return;
            }
            Object.assign(studio, update);
            showStatus('profile-status', 'success', 'Perfil actualizado.');
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
            picker: null
        };

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
        const a = entry.address || {};

        if (!a.formatted_address) {
            showStatus('sedes-status', 'error', 'Elegí una dirección de las sugerencias antes de guardar.');
            return;
        }

        const payload = {
            studio_id:         studio.id,
            label:             labelInput.value.trim() || null,
            is_primary:        isPrimary,
            is_active:         true,
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
            // If marking primary, demote any other primary first.
            if (isPrimary) {
                await WeotziData.StudioLocations.demotePrimary(studio.id);
            }

            let result;
            if (entry.locationId) {
                result = await WeotziData.StudioLocations.updateLocation(entry.locationId, payload);
            } else {
                result = await WeotziData.StudioLocations.createLocation(payload);
                entry.locationId = result.data && result.data.id;
            }
            if (result.error) throw result.error;

            // If primary, also patch studios.primary_location_id.
            if (isPrimary && entry.locationId) {
                await WeotziData.Studios.setPrimaryLocation(studio.id, entry.locationId);
            }

            showStatus('sedes-status', 'success', 'Sede guardada.');
        } catch (err) {
            showStatus('sedes-status', 'error', err.message || 'No se pudo guardar la sede.');
        }
    }

    async function removeSede(entry) {
        if (!entry.locationId) {
            entry.row.remove();
            const i = sedePickers.indexOf(entry);
            if (i >= 0) sedePickers.splice(i, 1);
            return;
        }
        if (!confirm('¿Quitar esta sede? Los artistas asignados solo a esta sede pierden la referencia.')) return;
        const { error } = await WeotziData.StudioLocations.deleteLocation(entry.locationId);
        if (error) { showStatus('sedes-status', 'error', error.message); return; }
        entry.row.remove();
        const i = sedePickers.indexOf(entry);
        if (i >= 0) sedePickers.splice(i, 1);
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
        const { data: list, error } = await WeotziData.StudioSpots.listByStudio(studio.id);
        if (error) { container.innerHTML = '<em>' + escapeHtml(error.message) + '</em>'; return; }
        if (!list || list.length === 0) {
            container.innerHTML = '<p class="studio-help">Aún no publicaste spots. Tocá "Nuevo spot" para empezar.</p>';
            return;
        }
        container.innerHTML = list.map(s => `
            <div class="studio-location-row">
                <div class="studio-location-row-head">
                    <span class="studio-section-kicker">${escapeHtml(KIND_LABELS[s.kind] || s.kind)} · ${escapeHtml(s.status)}</span>
                    <div style="display:flex;gap:6px;flex-wrap:wrap;">
                        <button class="studio-locations-add" data-action="apps" data-id="${escapeAttr(s.id)}" style="border-style:solid;padding:6px 10px;">
                            Postulaciones (${s.application_count || 0})
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
            <div class="studio-location-row" style="margin-bottom:18px;">
                <div class="studio-location-row-head">
                    <span class="studio-section-kicker">${isEdit ? 'Editar spot' : 'Nuevo spot'}</span>
                    <button type="button" class="studio-location-row-remove" id="spot-cancel">Cancelar</button>
                </div>
                <div class="studio-field">
                    <label class="studio-label">Título</label>
                    <input id="sp-title" class="studio-input" value="${escapeAttr(existing?.title || '')}" required>
                </div>
                <div class="studio-field">
                    <label class="studio-label">Tipo</label>
                    <select id="sp-kind" class="studio-input">
                        <option value="guest_spot" ${existing?.kind === 'guest_spot' ? 'selected' : ''}>Guest spot</option>
                        <option value="resident" ${existing?.kind === 'resident' ? 'selected' : ''}>Residencia</option>
                        <option value="itinerant" ${existing?.kind === 'itinerant' ? 'selected' : ''}>Itinerante</option>
                    </select>
                </div>
                <div class="studio-field">
                    <label class="studio-label">Descripción</label>
                    <textarea id="sp-desc" class="studio-textarea" rows="4">${escapeHtml(existing?.description || '')}</textarea>
                </div>
                <div class="studio-field">
                    <label class="studio-label">Estilos buscados (coma)</label>
                    <input id="sp-styles" class="studio-input" value="${escapeAttr((existing?.styles_wanted || []).join(', '))}">
                </div>
                <div class="studio-field">
                    <label class="studio-label">Fecha inicio / fin</label>
                    <div style="display:flex;gap:8px;">
                        <input id="sp-start" class="studio-input" type="date" value="${escapeAttr(existing?.start_date || '')}">
                        <input id="sp-end"   class="studio-input" type="date" value="${escapeAttr(existing?.end_date || '')}">
                    </div>
                </div>
                <div class="studio-field">
                    <label class="studio-label">Split (%) y stipend opcional</label>
                    <div style="display:flex;gap:8px;">
                        <input id="sp-split"    class="studio-input" type="number" min="0" max="100" step="1" placeholder="60" value="${escapeAttr(existing?.revenue_split_pct ?? '')}">
                        <input id="sp-stipend"  class="studio-input" type="number" min="0" step="1" placeholder="Stipend" value="${escapeAttr(existing?.stipend_amount ?? '')}">
                        <input id="sp-currency" class="studio-input" placeholder="USD" value="${escapeAttr(existing?.stipend_currency || '')}">
                    </div>
                </div>
                <div class="studio-field">
                    <label class="studio-label" style="display:inline-flex;gap:8px;align-items:center;">
                        <input id="sp-housing" type="checkbox" ${existing?.includes_housing ? 'checked' : ''}>
                        Incluye vivienda
                    </label>
                </div>
                <div class="studio-field">
                    <label class="studio-label">Imagen del spot (opcional)</label>
                    <input id="sp-cover" class="studio-input" type="url" value="${escapeAttr(existing?.cover_image || '')}">
                    <span class="studio-help">Si no subís nada, se usa la portada del estudio.</span>
                </div>
                <div style="display:flex;gap:10px;">
                    <button id="sp-save"   class="studio-btn studio-btn-primary"><i class="fa-solid fa-floppy-disk"></i> Guardar como borrador</button>
                    <button id="sp-publish" class="studio-btn"><i class="fa-solid fa-rocket"></i> ${existing?.status === 'open' ? 'Republicar' : 'Publicar (abierto)'}</button>
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
                bucket: 'studio-spot-attachments',
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
                           const decided = ['accepted', 'rejected', 'withdrawn'].includes(a.status);
                           return `<tr data-id="${escapeAttr(a.id)}">
                                <td><strong>${escapeHtml(ar.name || ar.username || '—')}</strong>
                                    ${a.portfolio_url ? `<br><a href="${escapeAttr(a.portfolio_url)}" target="_blank" style="color:var(--primary-red);font-size:.75rem;">Portfolio ↗</a>` : ''}
                                </td>
                                <td>${escapeHtml(styles)}</td>
                                <td>${escapeHtml([ar.city, ar.country].filter(Boolean).join(', '))}</td>
                                <td>${escapeHtml(msg)}</td>
                                <td><span class="studio-role-pill role-${a.status === 'accepted' ? 'resident' : (a.status === 'rejected' ? 'guest' : 'itinerant')}">${escapeHtml(a.status)}</span></td>
                                <td>${decided ? '—' : `
                                    <button class="studio-locations-add" data-app-action="accept" data-id="${escapeAttr(a.id)}" data-artist="${escapeAttr(ar.user_id)}" style="border-style:solid;padding:4px 8px;">Aceptar</button>
                                    <button class="studio-location-row-remove" data-app-action="reject" data-id="${escapeAttr(a.id)}">Rechazar</button>
                                `}</td>
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

    async function onAppDecision(action, applicationId, artistUserId, spot) {
        const newStatus = action === 'accept' ? 'accepted' : 'rejected';
        const { error: updErr } = await WeotziData.StudioSpots.decideApplication(applicationId, newStatus);
        if (updErr) { showStatus('spots-status', 'error', updErr.message); return; }

        if (action === 'accept' && artistUserId) {
            // Create the membership.
            const role = spot.kind === 'resident' ? 'resident'
                       : spot.kind === 'itinerant' ? 'itinerant' : 'guest';
            const { error: memErr } = await WeotziData.StudioMemberships.createMembership({
                studio_id: studio.id,
                artist_user_id: artistUserId,
                role,
                status: 'active',
                started_at: new Date().toISOString()
            });
            if (memErr && memErr.code !== '23505' /* unique violation = already exists */) {
                showStatus('spots-status', 'error', 'Aceptado, pero no pudimos crear la membership: ' + memErr.message);
                return;
            }
        }

        // Fire-and-forget email notification. Failure here doesn't roll back
        // the DB change — the operator already committed by clicking accept/reject.
        try {
            await notifyStudio({
                kind: 'spot_decision',
                application_id: applicationId,
                decision: newStatus
            });
        } catch (err) {
            console.warn('[studio-dashboard] notify failed (non-fatal):', err);
        }

        showStatus('spots-status', 'success', action === 'accept' ? '¡Aceptado y sumado al roster! (email enviado al artista)' : 'Postulación rechazada. (email enviado al artista)');
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
            if (q.length < 2) { suggEl.style.display = 'none'; suggEl.innerHTML = ''; return; }
            debounceTimer = setTimeout(async () => {
                const term = q.replace(/^@/, '');
                const { data, error } = await WeotziData.Artists.searchByUsernameOrName(term);
                if (error) return;
                _inviteHits = data || [];
                suggEl.innerHTML = _inviteHits.map(a => `
                    <div class="studio-location-row" data-id="${escapeAttr(a.user_id)}" style="cursor:pointer;">
                        <strong>${escapeHtml(a.name || a.username)}</strong>
                        <span class="studio-help">@${escapeHtml(a.username || '')} · ${escapeHtml([a.city, a.country].filter(Boolean).join(', ') || '—')}</span>
                    </div>
                `).join('') || '<em class="studio-help">Sin resultados.</em>';
                suggEl.style.display = 'block';
                suggEl.querySelectorAll('[data-id]').forEach(row => {
                    row.addEventListener('click', () => {
                        chosen = row.dataset.id;
                        input.value = row.querySelector('strong').textContent;
                        suggEl.style.display = 'none';
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
                    showStatus('roster-status', 'error', 'Ese artista ya tiene una membership de ese rol con tu estudio.');
                } else {
                    showStatus('roster-status', 'error', error.message);
                }
                return;
            }

            // Notify the artist by email (fire-and-forget).
            const newId = insertedRows && insertedRows.id;
            if (newId) {
                try {
                    await notifyStudio({ kind: 'roster_invite', membership_id: newId });
                } catch (err) {
                    console.warn('[studio-dashboard] roster invite notify failed (non-fatal):', err);
                }
            }

            input.value = '';
            chosen = null;
            showStatus('roster-status', 'success', 'Invitación enviada. Le mandamos un email al artista.');
            await renderRosterTable();
        });
    }

    async function renderRosterTable() {
        const container = document.getElementById('roster-content');
        const { data: members, error } = await WeotziData.StudioMemberships.listRoster(studio.id);

        if (error) { container.innerHTML = '<em>' + escapeHtml(error.message) + '</em>'; return; }
        if (!members || members.length === 0) {
            container.innerHTML = '<p class="studio-help">Aún no hay miembros. Invitá artistas con el formulario de arriba.</p>';
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
                        <br><small style="color:var(--text-secondary);font-family:var(--studio-mono);">@${escapeHtml(a.username || '')}</small>
                        <br><small style="color:var(--text-secondary);">${escapeHtml([a.city, a.country].filter(Boolean).join(', ') || '—')}</small>
                    </td>
                    <td>
                        <span class="studio-role-pill role-${escapeHtml(m.role)}" style="margin-bottom:4px;display:inline-block;">${escapeHtml(KIND_TO_LABEL[m.role] || m.role)}</span><br>
                        <select class="studio-input" data-field="role" style="height:32px;font-size:.78rem;">${roleOpts}</select>
                    </td>
                    <td>
                        <select class="studio-input" data-field="location_id" style="height:32px;font-size:.78rem;">${sedeOpts}</select>
                    </td>
                    <td>
                        <input class="studio-input" data-field="revenue_split_pct" type="number" min="0" max="100" step="1" style="height:32px;font-size:.78rem;width:70px;" value="${m.revenue_split_pct ?? ''}">
                    </td>
                    <td>
                        <span class="studio-role-pill" style="background:${
                            m.status === 'active' ? 'var(--primary-yellow)' :
                            m.status === 'pending_acceptance' ? 'var(--bg)' : 'var(--bg)'
                        };border-style:${m.status === 'pending_acceptance' ? 'dashed' : 'solid'};">${escapeHtml(m.status)}</span>
                    </td>
                    <td>
                        <button class="studio-locations-add" data-action="save"     data-id="${escapeAttr(m.id)}" style="border-style:solid;padding:4px 8px;">Guardar</button>
                        ${m.status === 'active'
                            ? `<button class="studio-location-row-remove" data-action="end" data-id="${escapeAttr(m.id)}">Desvincular</button>`
                            : (m.status === 'pending_acceptance'
                                ? `<button class="studio-location-row-remove" data-action="cancel" data-id="${escapeAttr(m.id)}">Cancelar</button>`
                                : `<button class="studio-locations-add" data-action="resume" data-id="${escapeAttr(m.id)}" style="border-style:solid;padding:4px 8px;">Reactivar</button>`)
                        }
                    </td>
                </tr>
            `;
        }).join('');

        container.innerHTML = `
            <table class="studio-roster-table">
                <thead><tr>
                    <th>Artista</th><th>Rol</th><th>Sede</th><th>Split %</th><th>Estado</th><th>Acciones</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>
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
