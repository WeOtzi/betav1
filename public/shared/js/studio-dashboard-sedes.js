// ============================================
// Panel del estudio · Sedes (beta cerrada, frente estudio-registro)
// Figma 91wY: E-LOC-01 (lista), E-LOC-02 (agregar o editar), E-LOC-03 (detalle),
// E-CODE-DELETE-LOC (quitar), E-CODE-EMPTY/ERROR-SEDES; con el lenguaje visual
// del rediseño (DS Bauhaus).
//
//   Lista     buscador, filtro activas/archivadas, principal/adicional, estado y
//             cantidad de artistas activos por sede.
//   Editor    buscador de Google Places, desglose de la dirección, pin
//             arrastrable con dirección inversa (studio-location-map.js),
//             ingreso manual geocodificado (o "pin pendiente"), teléfono y
//             horario, interruptores de principal y activa. En la principal los
//             dos quedan bloqueados (la RPC exige que la principal esté activa).
//   Archivar  is_active=false: la sede deja de mostrarse en el perfil y en los
//             selectores, pero conserva artistas, spots y reservas.
//   Quitar    diálogo con el impacto (las FK quedan en NULL) y Archivar como
//             opción recomendada.
// Datos: WeotziData.StudioLocations.save/remove (RPC del dueño) y
// StudioMemberships.listRoster (conteo de artistas).
// También exportable a Node (helpers puros para tests).
// ============================================
(function (root, factory) {
    'use strict';
    const api = factory(root);
    if (typeof module === 'object' && module && module.exports) module.exports = api;
    if (root && root.document) root.WeOtziStudioSedes = api;
})(typeof window !== 'undefined' ? window : null, function (root) {
    'use strict';

    const ADDRESS_FIELDS = ['country', 'country_code', 'state_province', 'city', 'locality', 'street', 'street_number', 'unit', 'postal_code', 'formatted_address', 'latitude', 'longitude', 'google_place_id'];
    const MANUAL_FIELDS = [['country', 'País'], ['state_province', 'Provincia / estado'], ['city', 'Ciudad'], ['locality', 'Localidad / barrio'], ['street', 'Calle'], ['street_number', 'Número'], ['unit', 'Unidad / piso'], ['postal_code', 'Código postal']];

    // ---------------- helpers puros (tests) ----------------
    function esc(v) {
        return String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function fold(v) {
        return String(v == null ? '' : v).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    }
    function finiteOrNull(v) {
        if (v === null || v === undefined || v === '') return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    }
    function hasPin(loc) {
        return finiteOrNull(loc && loc.latitude) != null && finiteOrNull(loc && loc.longitude) != null;
    }
    // Artistas activos por sede: { location_id: n }.
    function artistCounts(roster) {
        const counts = {};
        (Array.isArray(roster) ? roster : []).forEach(m => {
            if (!m || m.status !== 'active' || !m.location_id) return;
            counts[m.location_id] = (counts[m.location_id] || 0) + 1;
        });
        return counts;
    }
    // Lista ordenada (principal, activas, nombre) y filtrada por texto y estado.
    function filterLocations(list, { query = '', status = 'active' } = {}) {
        const q = fold(query);
        return (Array.isArray(list) ? list : [])
            .filter(loc => status === 'all' || (status === 'archived' ? loc.is_active === false : loc.is_active !== false))
            .filter(loc => !q || fold([loc.label, loc.formatted_address, loc.city, loc.country].filter(Boolean).join(' ')).includes(q))
            .sort((a, b) => Number(!!b.is_primary) - Number(!!a.is_primary)
                || Number(b.is_active !== false) - Number(a.is_active !== false)
                || String(a.label || '').localeCompare(String(b.label || ''), 'es'));
    }
    function artistsText(n) {
        return n === 1 ? '1 artista' : (n || 0) + ' artistas';
    }
    // "Principal · Activa · 2 artistas · Pin pendiente" (E-LOC-01).
    function locationMeta(loc, count) {
        return [loc.is_primary ? 'Principal' : 'Adicional', loc.is_active === false ? 'Archivada' : 'Activa', artistsText(count),
            hasPin(loc) ? '' : 'Pin pendiente'].filter(Boolean).join(' · ');
    }
    // Payload de save_studio_location a partir del borrador del editor.
    function buildPayload(draft) {
        const d = draft || {};
        const a = d.address || {};
        const payload = {
            label: String(d.label || '').trim() || null,
            is_primary: !!d.isPrimary,
            is_active: d.isPrimary ? true : d.isActive !== false,
            phone: String(d.phone || '').trim() || null,
            hours_json: { ...(d.hours || {}), description: String(d.hoursText || '').trim() }
        };
        ADDRESS_FIELDS.forEach(key => {
            if (key === 'latitude' || key === 'longitude') payload[key] = finiteOrNull(a[key]);
            else payload[key] = a[key] == null || a[key] === '' ? null : String(a[key]).trim();
        });
        if (payload.latitude == null || payload.longitude == null) { payload.latitude = null; payload.longitude = null; }
        return payload;
    }
    // Errores de validación del editor (null si está todo bien).
    function validateDraft(draft, typedAddress) {
        const a = (draft && draft.address) || {};
        if (!String(a.formatted_address || '').trim()) return { field: 'address', message: 'Buscá la dirección y elegila de las sugerencias, o completá el ingreso manual.' };
        if (typedAddress != null && String(typedAddress).trim() !== String(a.formatted_address).trim()) {
            return { field: 'address', message: 'Elegí la dirección de las sugerencias o tocá "Usar esta dirección" en el ingreso manual.' };
        }
        if (draft.isPrimary && draft.isActive === false) return { field: 'active', message: 'La sede principal debe estar activa.' };
        return null;
    }
    // Lo que pasa al quitar una sede (E-CODE-DELETE-LOC).
    function removalImpact(loc, list, count) {
        const activeOthers = (Array.isArray(list) ? list : []).filter(l => l.id !== loc.id && l.is_active !== false);
        return {
            blocked: activeOthers.length === 0,
            blockedReason: activeOthers.length === 0 ? 'Es tu única sede activa. Agregá otra antes de quitar esta.' : null,
            artists: count || 0,
            nextPrimary: loc.is_primary && activeOthers.length ? activeOthers[0] : null
        };
    }

    // ---------------- montaje ----------------
    function mount(ctx) {
        const doc = root.document;
        const D = root.WeotziData;
        const studio = ctx.studio;
        const statusId = ctx.statusId || 'sedes-status';
        const listEl = doc.getElementById(ctx.listId || 'sedes-list');
        const addBtn = doc.getElementById(ctx.addButtonId || 'add-sede-btn');
        const say = (kind, msg) => ctx.showStatus && ctx.showStatus(statusId, kind, msg);
        const clearSay = () => { const el = doc.getElementById(statusId); if (el) el.hidden = true; };
        const state = { locations: [], counts: {}, query: '', status: 'active', editor: null, seq: 0 };
        let fieldSeq = 0;

        async function load() {
            ctx.publishSummary && ctx.publishSummary('locations', 'loading');
            listEl.setAttribute('aria-busy', 'true');
            listEl.innerHTML = '<p class="wo-help" role="status">Cargando sedes…</p>';
            const [locRes, rosterRes] = await Promise.all([
                D.StudioLocations.listByStudio(studio.id),
                D.StudioMemberships && typeof D.StudioMemberships.listRoster === 'function'
                    ? D.StudioMemberships.listRoster(studio.id) : Promise.resolve({ data: [] })
            ]);
            listEl.setAttribute('aria-busy', 'false');
            if (locRes.error) {
                ctx.publishSummary && ctx.publishSummary('locations', 'error', undefined, locRes.error);
                renderError(locRes.error);
                return;
            }
            state.locations = locRes.data || [];
            state.counts = artistCounts(rosterRes && !rosterRes.error ? rosterRes.data : []);
            ctx.publishSummary && ctx.publishSummary('locations', 'ready', state.locations);
            if (state.editor) return;
            renderList();
        }

        function renderError(error) {
            listEl.innerHTML = '<div class="studio-sedes-state" role="alert"><h3 class="studio-sedes-state-title">No pudimos cargar tus sedes</h3>'
                + '<p class="studio-help">' + esc(error && error.message ? error.message : 'Revisá tu conexión.') + '</p>'
                + '<button type="button" class="wo-btn wo-btn--secondary" data-sede-action="reload">Reintentar</button></div>';
        }

        function renderList() {
            state.editor = null;
            if (addBtn) addBtn.hidden = !state.locations.length;
            if (!state.locations.length) {
                listEl.innerHTML = '<div class="studio-sedes-state"><h3 class="studio-sedes-state-title">Todavía no cargaste sedes</h3>'
                    + '<p class="studio-help">Cada sede organiza artistas, sesiones y visitas, y aparece como un pin en tu perfil público.</p>'
                    + '<button type="button" class="wo-btn" data-sede-action="new">Agregar la primera sede</button></div>';
                return;
            }
            const archived = state.locations.filter(l => l.is_active === false).length;
            const rows = filterLocations(state.locations, state);
            listEl.innerHTML = '<h3 class="studio-sedes-heading">' + (state.status === 'archived' ? 'Sedes archivadas' : state.status === 'all' ? 'Todas las sedes' : 'Sedes activas') + '</h3>'
                + '<div class="studio-sedes-toolbar">'
                + '<div class="studio-field"><label class="wo-label" for="sedes-search">Buscar sede</label><input type="search" id="sedes-search" class="wo-input" placeholder="Nombre, dirección o ciudad" value="' + esc(state.query) + '" autocomplete="off"></div>'
                + '<div class="studio-field"><label class="wo-label" for="sedes-filter">Activas / archivadas</label><select id="sedes-filter" class="wo-select">'
                + [['active', 'Activas'], ['archived', 'Archivadas (' + archived + ')'], ['all', 'Todas']].map(([v, l]) => '<option value="' + v + '"' + (state.status === v ? ' selected' : '') + '>' + esc(l) + '</option>').join('')
                + '</select></div></div>'
                + (rows.length
                    ? '<ul class="studio-sedes-list">' + rows.map(rowHtml).join('') + '</ul>'
                    : '<p class="studio-help studio-sedes-empty" role="status">' + (state.query ? 'Ninguna sede coincide con la búsqueda.' : state.status === 'archived' ? 'No tenés sedes archivadas.' : 'No hay sedes en este filtro.') + '</p>');
            doc.getElementById('sedes-search').addEventListener('input', event => {
                state.query = event.target.value;
                const pos = event.target.selectionStart;
                renderList();
                const input = doc.getElementById('sedes-search');
                input.focus();
                try { input.setSelectionRange(pos, pos); } catch (_) { /* type=search */ }
            });
            doc.getElementById('sedes-filter').addEventListener('change', event => { state.status = event.target.value; renderList(); doc.getElementById('sedes-filter').focus(); });
        }

        function rowHtml(loc) {
            const count = state.counts[loc.id] || 0;
            const id = esc(loc.id);
            const name = esc(loc.label || 'Sede sin nombre');
            const actions = ['<button type="button" class="wo-btn wo-btn--secondary wo-btn--s" data-sede-action="edit" data-id="' + id + '" aria-label="Editar ' + name + '">Editar</button>'];
            if (!loc.is_primary && loc.is_active !== false) actions.push('<button type="button" class="wo-btn wo-btn--secondary wo-btn--s" data-sede-action="primary" data-id="' + id + '" aria-label="Hacer principal ' + name + '">Hacer principal</button>');
            if (!loc.is_primary) actions.push('<button type="button" class="wo-btn wo-btn--secondary wo-btn--s" data-sede-action="' + (loc.is_active === false ? 'restore' : 'archive') + '" data-id="' + id + '" aria-label="' + (loc.is_active === false ? 'Reactivar ' : 'Archivar ') + name + '">' + (loc.is_active === false ? 'Reactivar' : 'Archivar') + '</button>');
            actions.push('<button type="button" class="wo-btn wo-btn--secondary wo-btn--s studio-sedes-remove" data-sede-action="remove" data-id="' + id + '" aria-label="Quitar ' + name + '">Quitar</button>');
            return '<li class="studio-sedes-row' + (loc.is_primary ? ' is-primary' : '') + (loc.is_active === false ? ' is-archived' : '') + '" data-sede-row="' + id + '">'
                + '<div class="studio-sedes-row-main"><strong>' + name + '</strong>'
                + '<span class="studio-sedes-meta">' + esc(locationMeta(loc, count)) + '</span>'
                + '<span class="studio-sedes-address">' + esc(loc.formatted_address || 'Sin dirección') + '</span></div>'
                + '<div class="studio-actions studio-sedes-actions">' + actions.join('') + '</div></li>';
        }

        // ---------- editor (E-LOC-02) ----------
        function openEditor(loc) {
            clearSay();
            if (addBtn) addBtn.hidden = true;
            const isNew = !loc;
            const fid = 'sede-' + (++fieldSeq);
            const onlyLocation = !state.locations.length;
            const draft = {
                id: loc ? loc.id : null,
                label: loc ? loc.label || '' : (onlyLocation ? 'Sede principal' : ''),
                isPrimary: loc ? !!loc.is_primary : onlyLocation,
                isActive: loc ? loc.is_active !== false : true,
                phone: loc ? loc.phone || '' : '',
                hours: (loc && loc.hours_json) || {},
                hoursText: (loc && loc.hours_json && loc.hours_json.description) || '',
                address: {}
            };
            if (loc) ADDRESS_FIELDS.forEach(key => { if (loc[key] != null) draft.address[key] = loc[key]; });
            const lockPrimary = !!(loc && loc.is_primary);
            listEl.innerHTML = '<section class="studio-sede-editor" aria-labelledby="' + fid + '-title">'
                + '<h3 class="studio-sedes-heading" id="' + fid + '-title" tabindex="-1">' + (isNew ? 'Agregar sede' : 'Editar ' + esc(loc.label || 'sede')) + '</h3>'
                + '<div class="studio-form-grid">'
                + field(fid, 'label', 'Etiqueta de la sede', '<input type="text" id="' + fid + '-label" class="wo-input" maxlength="120" value="' + esc(draft.label) + '" placeholder="Madrid Centro">')
                + field(fid, 'address', 'Dirección', '<input type="text" id="' + fid + '-address" class="wo-input" placeholder="Buscá la dirección…" autocomplete="off" value="' + esc(draft.address.formatted_address || '') + '">')
                + '<div class="studio-field"><span class="wo-label">País / provincia / ciudad / localidad</span><p class="studio-sede-detail" data-region></p></div>'
                + '<div class="studio-field"><span class="wo-label">Calle / número / unidad / código postal</span><p class="studio-sede-detail" data-street></p></div>'
                + '<div class="studio-field studio-form-full"><span class="wo-label" id="' + fid + '-pin-label">Pin en el mapa</span>'
                + '<div class="studio-sede-map" data-map role="application" aria-labelledby="' + fid + '-pin-label" aria-describedby="' + fid + '-pin-help" hidden></div>'
                + '<p class="studio-sede-detail" data-pin id="' + fid + '-pin-help" aria-live="polite"></p></div>'
                + '<details class="studio-manual-address studio-form-full"><summary>Ingresar dirección manualmente</summary>'
                + '<p class="studio-help">Si el buscador no encuentra la dirección, escribila arriba y completá al menos ciudad y país. Si el mapa está disponible, el pin se ubica solo y podés ajustarlo.</p>'
                + '<div class="studio-form-grid">' + MANUAL_FIELDS.map(([key, title]) => field(fid, 'm-' + key, title, '<input type="text" id="' + fid + '-m-' + key + '" class="wo-input" data-manual-field="' + key + '" maxlength="120" value="' + esc(draft.address[key] || '') + '">')).join('') + '</div>'
                + '<button type="button" class="wo-btn wo-btn--secondary wo-btn--s" data-sede-action="manual">Usar esta dirección</button></details>'
                + field(fid, 'phone', 'Teléfono de la sede', '<input type="tel" id="' + fid + '-phone" class="wo-input" maxlength="40" value="' + esc(draft.phone) + '" autocomplete="tel">')
                + field(fid, 'hours', 'Horarios de atención', '<textarea id="' + fid + '-hours" class="wo-textarea" maxlength="500" placeholder="Lunes a viernes de 10 a 19 h">' + esc(draft.hoursText) + '</textarea>')
                + '<div class="studio-field"><label class="studio-sede-switch"><span class="wo-toggle"><input type="checkbox" id="' + fid + '-primary" role="switch"' + (draft.isPrimary ? ' checked' : '') + (lockPrimary || onlyLocation ? ' disabled' : '') + ' aria-describedby="' + fid + '-primary-help"><span class="knob"></span></span>Sede principal</label>'
                + '<span class="studio-help studio-sede-switch-help" id="' + fid + '-primary-help">' + (lockPrimary ? 'Para cambiarla, elegí otra sede como principal.' : onlyLocation ? 'Tu primera sede es la principal.' : 'La principal define la ciudad y el pin del perfil.') + '</span></div>'
                + '<div class="studio-field"><label class="studio-sede-switch"><span class="wo-toggle"><input type="checkbox" id="' + fid + '-active" role="switch"' + (draft.isActive ? ' checked' : '') + (lockPrimary || draft.isPrimary ? ' disabled' : '') + ' aria-describedby="' + fid + '-active-help"><span class="knob"></span></span>Sede activa</label>'
                + '<span class="studio-help studio-sede-switch-help" id="' + fid + '-active-help">' + (lockPrimary || draft.isPrimary ? 'La sede principal siempre está activa.' : 'Una sede archivada no se muestra en tu perfil ni en las invitaciones.') + '</span></div>'
                + '</div>'
                + '<div class="studio-actions studio-sede-editor-actions"><button type="button" class="wo-btn" data-sede-action="save">Guardar sede</button>'
                + '<button type="button" class="wo-btn wo-btn--secondary" data-sede-action="cancel">Atrás</button></div></section>';
            const section = listEl.querySelector('.studio-sede-editor');
            const q = sel => section.querySelector(sel);
            const addressInput = doc.getElementById(fid + '-address');
            const editor = { draft, fid, section, addressInput, picker: null, map: null, saving: false };
            state.editor = editor;

            const renderDetails = (mapReady = editor.map && editor.map.isReady) => {
                const a = draft.address;
                q('[data-region]').textContent = [a.country, a.state_province, a.city, a.locality].filter((p, i, all) => p && all.indexOf(p) === i).join(' · ') || 'Seleccioná una dirección';
                q('[data-street]').textContent = [a.street, a.street_number, a.unit, a.postal_code].filter(Boolean).join(' · ') || a.formatted_address || 'Seleccioná una dirección';
                const located = hasPin(a);
                const pin = q('[data-pin]');
                if (mapReady) pin.textContent = located ? 'Pin ubicado. Arrastralo o tocá el mapa si la puerta del estudio está en otro punto.' : 'Tocá el mapa o buscá la dirección para ubicar el pin.';
                else pin.textContent = located ? 'Pin ubicado (' + Number(a.latitude).toFixed(5) + ', ' + Number(a.longitude).toFixed(5) + ').' : a.formatted_address ? 'Dirección manual · pin pendiente.' : 'Comprobá la ubicación.';
            };
            renderDetails(false);

            if (root.WeOtziAddressPicker) {
                editor.picker = root.WeOtziAddressPicker.attach(addressInput, {
                    placeholder: 'Buscá la dirección…',
                    onChange(addr) {
                        draft.address = { ...(addr || {}) };
                        renderDetails();
                        if (editor.map && hasPin(draft.address)) editor.map.setPosition(Number(draft.address.latitude), Number(draft.address.longitude));
                    }
                });
                if (draft.address.formatted_address && editor.picker && editor.picker.setValue) editor.picker.setValue(draft.address);
            }
            if (root.WeOtziLocationMap) {
                editor.map = root.WeOtziLocationMap.attach(q('[data-map]'), {
                    latitude: finiteOrNull(draft.address.latitude) ?? undefined,
                    longitude: finiteOrNull(draft.address.longitude) ?? undefined,
                    timeoutMs: 20000,
                    pinTitle: 'Arrastrá el pin hasta la puerta del estudio',
                    onPending() { q('[data-pin]').textContent = 'Buscando la dirección del pin en Google Maps…'; },
                    onError() { say('error', 'No pudimos traer la dirección de ese punto. Probá moverlo un poco o buscala arriba.'); },
                    onPick(address) {
                        draft.address = { ...draft.address, ...address };
                        if (address.formatted_address) addressInput.value = address.formatted_address;
                        else draft.address.formatted_address = addressInput.value.trim() || draft.address.formatted_address;
                        renderDetails(); clearSay();
                    }
                });
                editor.map.ready.then(ok => renderDetails(ok));
            }
            const primaryInput = doc.getElementById(fid + '-primary');
            const activeInput = doc.getElementById(fid + '-active');
            primaryInput.addEventListener('change', () => {
                draft.isPrimary = primaryInput.checked;
                if (draft.isPrimary) { draft.isActive = true; activeInput.checked = true; }
                activeInput.disabled = draft.isPrimary;
            });
            activeInput.addEventListener('change', () => { draft.isActive = activeInput.checked; });
            q('#' + fid + '-title').focus();
        }

        function field(fid, key, title, control) {
            return '<div class="studio-field' + (key === 'hours' ? ' studio-form-full' : '') + '"><label class="wo-label" for="' + fid + '-' + key + '">' + esc(title) + '</label>' + control + '</div>';
        }

        function closeEditor() {
            const editor = state.editor;
            if (editor) {
                try { editor.picker && editor.picker.detach && editor.picker.detach(); } catch (_) { /* noop */ }
                try { editor.map && editor.map.destroy && editor.map.destroy(); } catch (_) { /* noop */ }
            }
            state.editor = null;
            renderList();
        }

        async function useManualAddress() {
            const editor = state.editor;
            if (!editor) return;
            const { draft, section, addressInput } = editor;
            const manual = {};
            section.querySelectorAll('[data-manual-field]').forEach(input => { manual[input.dataset.manualField] = input.value.trim() || null; });
            if (!addressInput.value.trim()) { say('error', 'Escribí la dirección de la sede en el campo Dirección.'); addressInput.focus(); return; }
            if (!manual.city || !manual.country) { say('error', 'Para ingresar la dirección a mano completá al menos ciudad y país.'); return; }
            draft.address = { ...manual, formatted_address: addressInput.value.trim(), latitude: null, longitude: null, google_place_id: null };
            const query = [draft.address.formatted_address, manual.city, manual.country].filter(Boolean).join(', ');
            let found = editor.map && editor.map.isReady ? await editor.map.locate(query) : null;
            if (!found && root.WeOtziGeocoder && typeof root.WeOtziGeocoder.geocodeQuery === 'function') {
                const hit = await root.WeOtziGeocoder.geocodeQuery(query).catch(() => null);
                if (hit && Number.isFinite(Number(hit.lat)) && Number.isFinite(Number(hit.lng))) found = { latitude: Number(hit.lat), longitude: Number(hit.lng) };
            }
            if (found && hasPin(found)) {
                draft.address.latitude = Number(found.latitude);
                draft.address.longitude = Number(found.longitude);
                say('success', 'Ubicamos la dirección en el mapa. Revisá el pin antes de guardar.');
            } else {
                say('info', 'Guardamos la dirección sin pin: queda como "pin pendiente" hasta que la ubiques en el mapa.');
            }
            const pin = section.querySelector('[data-pin]');
            section.querySelector('[data-region]').textContent = [manual.country, manual.state_province, manual.city, manual.locality].filter(Boolean).join(' · ');
            section.querySelector('[data-street]').textContent = [manual.street, manual.street_number, manual.unit, manual.postal_code].filter(Boolean).join(' · ') || draft.address.formatted_address;
            pin.textContent = hasPin(draft.address) ? 'Pin ubicado. Podés ajustarlo en el mapa.' : 'Dirección manual · pin pendiente.';
        }

        async function saveEditor(button) {
            const editor = state.editor;
            if (!editor || editor.saving) return;
            const { draft, fid, addressInput } = editor;
            draft.label = doc.getElementById(fid + '-label').value;
            draft.phone = doc.getElementById(fid + '-phone').value;
            draft.hoursText = doc.getElementById(fid + '-hours').value;
            const problem = validateDraft(draft, addressInput.value);
            if (problem) {
                say('error', problem.message);
                if (problem.field === 'address') { addressInput.setAttribute('aria-invalid', 'true'); addressInput.focus(); }
                return;
            }
            editor.saving = true; button.disabled = true; button.textContent = 'Guardando…';
            try {
                const { data, error } = await D.StudioLocations.save(studio.id, draft.id, buildPayload(draft));
                if (error) throw error;
                const saved = Array.isArray(data) ? data[0] : data;
                if (!saved || !saved.id) throw new Error('No pudimos confirmar la sede guardada.');
                if (saved.is_primary) studio.primary_location_id = saved.id;
                closeEditor();
                await load();
                ctx.onChanged && await ctx.onChanged();
                say('success', hasPin(saved) ? 'Sede guardada.' : 'Sede guardada sin pin: ubicala en el mapa cuando puedas.');
            } catch (err) {
                say('error', (err && err.message) || 'No se pudo guardar la sede.');
            } finally {
                editor.saving = false;
                if (button.isConnected) { button.disabled = false; button.textContent = 'Guardar sede'; }
            }
        }

        // Archivar / reactivar / hacer principal: misma RPC con la sede completa.
        async function patchLocation(loc, patch, okMessage) {
            const draft = {
                id: loc.id, label: loc.label, phone: loc.phone, hours: loc.hours_json || {},
                hoursText: (loc.hours_json && loc.hours_json.description) || '',
                isPrimary: patch.isPrimary != null ? patch.isPrimary : !!loc.is_primary,
                isActive: patch.isActive != null ? patch.isActive : loc.is_active !== false,
                address: {}
            };
            ADDRESS_FIELDS.forEach(key => { draft.address[key] = loc[key]; });
            const { error } = await D.StudioLocations.save(studio.id, loc.id, buildPayload(draft));
            if (error) { say('error', error.message || 'No se pudo actualizar la sede.'); return false; }
            await load();
            ctx.onChanged && await ctx.onChanged();
            say('success', okMessage);
            return true;
        }

        // ---------- quitar (E-CODE-DELETE-LOC) ----------
        function openRemoveDialog(loc) {
            const impact = removalImpact(loc, state.locations, state.counts[loc.id]);
            const dialog = doc.createElement('dialog');
            dialog.className = 'wo-modal studio-sede-dialog';
            dialog.setAttribute('aria-labelledby', 'sede-dialog-title');
            dialog.setAttribute('aria-describedby', 'sede-dialog-body');
            const name = esc(loc.label || 'esta sede');
            dialog.innerHTML = '<p class="studio-sede-dialog-kicker">Gestión de sedes</p>'
                + '<h2 class="wo-modal-title" id="sede-dialog-title">¿Quitar la sede ' + name + '?</h2>'
                + '<p class="studio-help">' + esc(studio.name || 'Tu estudio') + ' · ' + esc(loc.formatted_address || 'Sin dirección') + '</p>'
                + '<div class="studio-sede-dialog-notice" id="sede-dialog-body"><strong>Antes de continuar</strong>'
                + (impact.blocked
                    ? '<p>' + esc(impact.blockedReason) + '</p>'
                    : '<p>Quitar la sede es definitivo. ' + (impact.artists ? esc(artistsText(impact.artists)) + ' de tu equipo, ' : 'Los artistas, ') + 'los spots, las reservas y los trabajos asignados a esta sede quedan sin sede.'
                        + (impact.nextPrimary ? ' «' + esc(impact.nextPrimary.label || 'Otra sede') + '» pasa a ser la principal.' : '') + '</p>'
                        + (loc.is_primary ? '' : '<p>Si solo querés dejar de mostrarla, archivala: conserva todo y la podés reactivar.</p>'))
                + '</div>'
                + '<div class="wo-modal-actions">'
                + (!impact.blocked && !loc.is_primary && loc.is_active !== false ? '<button type="button" class="wo-btn" data-dialog="archive">Archivar sede</button>' : '')
                + (!impact.blocked ? '<button type="button" class="wo-btn wo-btn--danger" data-dialog="delete">Eliminar</button>' : '')
                + '<button type="button" class="wo-btn wo-btn--secondary" data-dialog="cancel">Cancelar</button></div>';
            doc.body.appendChild(dialog);
            const opener = doc.activeElement;
            const close = () => { try { dialog.close(); } catch (_) { /* noop */ } dialog.remove(); if (opener && opener.isConnected) opener.focus(); };
            dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
            dialog.addEventListener('click', async event => {
                if (event.target === dialog) { close(); return; }
                const btn = event.target.closest('[data-dialog]');
                if (!btn) return;
                const action = btn.dataset.dialog;
                if (action === 'cancel') { close(); return; }
                dialog.querySelectorAll('button').forEach(b => { b.disabled = true; });
                if (action === 'archive') {
                    await patchLocation(loc, { isActive: false }, 'Sede archivada. La podés reactivar desde el filtro Archivadas.');
                    close();
                    return;
                }
                const { error } = await D.StudioLocations.remove(studio.id, loc.id);
                close();
                if (error) { say('error', error.message || 'No se pudo quitar la sede.'); return; }
                if (D.Studios && typeof D.Studios.getById === 'function') {
                    const { data: updated } = await D.Studios.getById(studio.id);
                    if (updated) Object.assign(studio, updated);
                }
                await load();
                ctx.onChanged && await ctx.onChanged();
                say('success', 'Sede eliminada.');
            });
            if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
            (dialog.querySelector('[data-dialog="archive"]') || dialog.querySelector('[data-dialog="cancel"]')).focus();
        }

        // ---------- eventos ----------
        listEl.addEventListener('click', async event => {
            const btn = event.target.closest('[data-sede-action]');
            if (!btn || btn.disabled) return;
            const action = btn.dataset.sedeAction;
            const loc = state.locations.find(l => String(l.id) === btn.dataset.id) || null;
            if (action === 'reload') { load(); return; }
            if (action === 'new') { openEditor(null); return; }
            if (action === 'edit' && loc) { openEditor(loc); return; }
            if (action === 'cancel') { closeEditor(); clearSay(); return; }
            if (action === 'save') { saveEditor(btn); return; }
            if (action === 'manual') { useManualAddress(); return; }
            if (action === 'remove' && loc) { openRemoveDialog(loc); return; }
            if (!loc) return;
            btn.disabled = true;
            if (action === 'archive') await patchLocation(loc, { isActive: false }, 'Sede archivada. La podés reactivar desde el filtro Archivadas.');
            else if (action === 'restore') await patchLocation(loc, { isActive: true }, 'Sede reactivada.');
            else if (action === 'primary') await patchLocation(loc, { isPrimary: true, isActive: true }, '«' + (loc.label || 'La sede') + '» ahora es la principal.');
            if (btn.isConnected) btn.disabled = false;
        });
        if (addBtn) addBtn.onclick = () => openEditor(null);

        return load().then(() => ({ reload: load, state }));
    }

    return { mount, artistCounts, filterLocations, locationMeta, buildPayload, validateDraft, removalImpact, hasPin, esc };
});
