// ============================================
// Studio Registration Wizard
// 5 steps: Account → Identity → Locations → Photos → Confirm.
// On submit:
//   1) Supabase Auth signUp
//   2) Insert studios row owned by the new user
//   3) Insert one studio_locations row per address picked
//   4) Stash photo URLs into studios.photo_feed_items as JSONB
// ============================================

(function () {
    'use strict';

    const TOTAL_STEPS = 5;
    let currentStep = 1;
    const locationPickers = []; // array of { row: HTMLElement, picker: AddressPicker, address: {} }

    document.addEventListener('DOMContentLoaded', () => {
        bootLocationsRepeater();
        wireWizardNav();
        renderStep();
        mountIGImport();
    });

    function mountIGImport() {
        if (typeof window.IGImport?.mount !== 'function') return;
        const container = document.getElementById('ig-import-mount-studio');
        if (!container) return;
        window.IGImport.mount(container, {
            target: 'studio',
            mode: 'signup',
            prefillHandle: document.getElementById('reg-instagram')?.value || '',
            onComplete: (result) => {
                const pf = result && result.prefill ? result.prefill : {};
                if (result.handle) {
                    const ig = document.getElementById('reg-instagram');
                    if (ig && !ig.value) ig.value = '@' + result.handle;
                }
                if (pf.bio) {
                    const bio = document.getElementById('reg-bio');
                    if (bio && !bio.value) bio.value = pf.bio;
                }
                if (pf.bio_link) {
                    const site = document.getElementById('reg-website');
                    if (site && !site.value) site.value = pf.bio_link;
                }
            }
        });
    }

    // -------------------------------------------------------------
    // Step navigation
    // -------------------------------------------------------------
    function renderStep() {
        document.querySelectorAll('.studio-wizard-step').forEach(step => {
            const n = Number(step.dataset.step);
            step.classList.toggle('is-active', n === currentStep);
        });
        document.querySelectorAll('#wizard-rail .studio-wizard-pill').forEach(pill => {
            const n = Number(pill.dataset.step);
            pill.classList.toggle('is-active', n === currentStep);
            pill.classList.toggle('is-done', n < currentStep);
        });

        const prev = document.getElementById('wizard-prev');
        const next = document.getElementById('wizard-next');
        prev.disabled = (currentStep === 1);
        next.innerHTML = (currentStep === TOTAL_STEPS)
            ? '<i class="fa-solid fa-rocket"></i> Crear estudio'
            : 'Continuar <i class="fa-solid fa-arrow-right"></i>';

        if (currentStep === TOTAL_STEPS) renderConfirmSummary();
    }

    function wireWizardNav() {
        document.getElementById('wizard-prev').addEventListener('click', () => {
            if (currentStep > 1) { currentStep--; renderStep(); }
        });
        document.getElementById('wizard-next').addEventListener('click', async () => {
            const ok = await validateStep(currentStep);
            if (!ok) return;
            if (currentStep < TOTAL_STEPS) {
                currentStep++;
                renderStep();
                return;
            }
            await submitRegistration();
        });
    }

    function showStatus(kind, message) {
        const el = document.getElementById('wizard-status');
        el.className = 'studio-status studio-status-' + kind;
        el.textContent = message;
        el.hidden = false;
    }
    function clearStatus() {
        document.getElementById('wizard-status').hidden = true;
    }

    // -------------------------------------------------------------
    // Validation
    // -------------------------------------------------------------
    async function validateStep(step) {
        clearStatus();
        if (step === 1) {
            const name = document.getElementById('reg-name').value.trim();
            const email = document.getElementById('reg-email').value.trim();
            const pw = document.getElementById('reg-password').value;
            const pw2 = document.getElementById('reg-password-confirm').value;
            if (!name || name.length < 2) return showStatus('error', 'El nombre del estudio es obligatorio.') && false;
            if (!/^\S+@\S+\.\S+$/.test(email)) return showStatus('error', 'El email no parece válido.') && false;
            if (pw.length < 8) return showStatus('error', 'La contraseña debe tener al menos 8 caracteres.') && false;
            if (pw !== pw2) return showStatus('error', 'Las contraseñas no coinciden.') && false;
            return true;
        }
        if (step === 3) {
            // Locations: at least one with a formatted_address required.
            const haveAny = locationPickers.some(lp => lp.address && lp.address.formatted_address);
            if (!haveAny) return showStatus('error', 'Agregá al menos una sede con dirección completa.') && false;
            return true;
        }
        return true;
    }

    // -------------------------------------------------------------
    // Locations repeater
    // -------------------------------------------------------------
    function bootLocationsRepeater() {
        addLocationRow(); // start with one
        document.getElementById('add-location-btn').addEventListener('click', () => addLocationRow());
    }

    function addLocationRow() {
        const list = document.getElementById('locations-list');
        const idx = locationPickers.length;
        const row = document.createElement('div');
        row.className = 'studio-location-row';
        row.innerHTML = `
            <div class="studio-location-row-head">
                <span class="studio-section-kicker">${idx === 0 ? 'Sede principal' : 'Sede #' + (idx + 1)}</span>
                ${idx > 0 ? '<button type="button" class="studio-location-row-remove" data-idx="' + idx + '">Quitar</button>' : ''}
            </div>
            <div class="studio-field">
                <label class="studio-label">Etiqueta de la sede</label>
                <input type="text" class="studio-input" data-field="label" placeholder="${idx === 0 ? 'Sede principal' : 'Sucursal Palermo, Pop-up Mar del Plata, …'}" value="${idx === 0 ? 'Sede principal' : ''}">
            </div>
            <div class="studio-field">
                <label class="studio-label">Dirección</label>
                <input type="text" class="studio-input weotzi-address-picker-input" data-field="address" placeholder="Buscá la dirección…" autocomplete="off">
                <div class="weotzi-address-fields" data-field="preview" hidden></div>
            </div>
        `;
        list.appendChild(row);

        const removeBtn = row.querySelector('.studio-location-row-remove');
        if (removeBtn) {
            removeBtn.addEventListener('click', () => {
                const i = Number(removeBtn.dataset.idx);
                row.remove();
                locationPickers.splice(i, 1);
                // Re-index labels for visual order.
                refreshLocationLabels();
            });
        }

        const addressInput = row.querySelector('input[data-field="address"]');
        const previewEl   = row.querySelector('div[data-field="preview"]');
        const entry = { row, picker: null, address: {}, labelInput: row.querySelector('input[data-field="label"]') };

        if (window.WeOtziAddressPicker) {
            entry.picker = window.WeOtziAddressPicker.attach(addressInput, {
                placeholder: 'Buscá la dirección…',
                onChange(addr) {
                    entry.address = addr;
                    window.WeOtziAddressPicker.renderPreview(previewEl, addr);
                }
            });
        }
        locationPickers.push(entry);
    }

    function refreshLocationLabels() {
        const list = document.getElementById('locations-list');
        list.querySelectorAll('.studio-location-row').forEach((row, idx) => {
            const kicker = row.querySelector('.studio-section-kicker');
            kicker.textContent = idx === 0 ? 'Sede principal' : 'Sede #' + (idx + 1);
            const labelInput = row.querySelector('input[data-field="label"]');
            if (labelInput && idx === 0 && !labelInput.value.trim()) labelInput.value = 'Sede principal';
            const removeBtn = row.querySelector('.studio-location-row-remove');
            if (removeBtn) removeBtn.dataset.idx = String(idx);
        });
    }

    // -------------------------------------------------------------
    // Confirm summary
    // -------------------------------------------------------------
    function renderConfirmSummary() {
        const grid = document.getElementById('confirm-summary');
        const name = document.getElementById('reg-name').value.trim();
        const email = document.getElementById('reg-email').value.trim();
        const tagline = document.getElementById('reg-tagline').value.trim();
        const bio = document.getElementById('reg-bio').value.trim();
        const founded = document.getElementById('reg-founded').value.trim();
        const ig = document.getElementById('reg-instagram').value.trim();
        const photos = parsePhotos();
        const locs = locationPickers.filter(lp => lp.address && lp.address.formatted_address).length;

        const rows = [
            ['Nombre', name],
            ['Email', email],
            ['Tagline', tagline || '(sin tagline)'],
            ['Bio', bio ? (bio.length > 80 ? bio.slice(0, 80) + '…' : bio) : '(sin bio)'],
            ['Año fundación', founded || '—'],
            ['Instagram', ig || '—'],
            ['Sedes con dirección', String(locs)],
            ['Fotos cargadas', String(photos.length)]
        ];
        grid.innerHTML = rows.map(([k, v]) => `
            <div class="studio-meta-row">
                <span class="key">${escapeHtml(k)}</span>
                <span class="val">${escapeHtml(v)}</span>
            </div>
        `).join('');
    }

    function parsePhotos() {
        const raw = document.getElementById('reg-photos').value || '';
        return raw.split('\n').map(s => s.trim()).filter(s => /^https?:\/\//.test(s));
    }

    function escapeHtml(v) {
        return String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // -------------------------------------------------------------
    // Submit: signUp → insert studios → insert studio_locations → patch primary_location_id
    // -------------------------------------------------------------
    async function submitRegistration() {
        clearStatus();
        const submitBtn = document.getElementById('wizard-next');
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Creando estudio…';

        try {
            const supabase = (window.WeOtziStudioAuth || {}).getSupabase
                ? window.WeOtziStudioAuth.getSupabase()
                : null;
            if (!supabase) throw new Error('Supabase no está disponible.');

            const languages = (document.getElementById('reg-languages').value || '')
                .split(',').map(s => s.trim()).filter(Boolean);
            const photos = parsePhotos();
            const photoFeedItems = photos.map((url, i) => ({
                url, kind: 'image', category: 'studio', sort: i,
                created_at: new Date().toISOString()
            }));

            const payload = {
                name:            document.getElementById('reg-name').value.trim(),
                email:           document.getElementById('reg-email').value.trim(),
                password:        document.getElementById('reg-password').value,
                tagline:         document.getElementById('reg-tagline').value.trim() || null,
                bio:             document.getElementById('reg-bio').value.trim() || null,
                founded_year:    Number(document.getElementById('reg-founded').value) || null,
                languages,
                instagram:       document.getElementById('reg-instagram').value.trim() || null,
                whatsapp:        document.getElementById('reg-whatsapp').value.trim() || null,
                cover_image:     document.getElementById('reg-cover').value.trim() || null,
                logo_image:      document.getElementById('reg-logo').value.trim() || null,
                photo_feed_items: photoFeedItems
            };
            const websiteValue = document.getElementById('reg-website').value.trim();

            // 1+2) auth signUp + studios row insert.
            const studio = await window.WeOtziStudioAuth.register(payload);

            // 2.5) website lives on studios.website (legacy column from prior migrations).
            if (websiteValue) {
                await WeotziData.Studios.update(studio.id, { website: websiteValue });
            }

            // 3) Insert each location.
            const validLocations = locationPickers
                .map((lp, idx) => ({ idx, lp }))
                .filter(({ lp }) => lp.address && lp.address.formatted_address);

            const locationRows = validLocations.map(({ idx, lp }) => ({
                studio_id:         studio.id,
                label:             lp.labelInput.value.trim() || (idx === 0 ? 'Sede principal' : 'Sede #' + (idx + 1)),
                is_primary:        idx === 0,
                is_active:         true,
                sort_order:        idx,
                country:           lp.address.country || null,
                country_code:      lp.address.country_code || null,
                state_province:    lp.address.state_province || null,
                city:              lp.address.city || null,
                locality:          lp.address.locality || null,
                street:            lp.address.street || null,
                street_number:     lp.address.street_number || null,
                unit:              lp.address.unit || null,
                postal_code:       lp.address.postal_code || null,
                formatted_address: lp.address.formatted_address || null,
                latitude:          Number.isFinite(lp.address.latitude)  ? lp.address.latitude  : null,
                longitude:         Number.isFinite(lp.address.longitude) ? lp.address.longitude : null,
                google_place_id:   lp.address.google_place_id || null,
                geocoded_at:       lp.address.formatted_address ? new Date().toISOString() : null
            }));

            if (locationRows.length) {
                const { data: insertedLocs, error: locErr } = await WeotziData.StudioLocations.createMany(locationRows);
                if (locErr) throw locErr;

                const primary = (insertedLocs || []).find(l => l.is_primary);
                if (primary) {
                    await WeotziData.Studios.update(studio.id, {
                        primary_location_id: primary.id,
                        profile_complete: true
                    });
                }
            }

            showStatus('success', '¡Estudio creado! Redirigiendo al panel…');
            setTimeout(() => { window.location.href = '/studio/dashboard'; }, 600);
        } catch (err) {
            console.error('[studio-register] submit failed:', err);
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fa-solid fa-rocket"></i> Crear estudio';
            const msg = String(err?.message || err);
            // Friendlier message for the most common conflict.
            if (msg.toLowerCase().includes('already') || msg.toLowerCase().includes('registered')) {
                showStatus('error', 'Ya existe una cuenta con ese email. Probá iniciar sesión.');
            } else {
                showStatus('error', 'No pudimos crear el estudio: ' + msg);
            }
        }
    }
})();
