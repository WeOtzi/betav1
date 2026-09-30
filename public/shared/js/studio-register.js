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

    let existingSession = null;
    document.addEventListener('DOMContentLoaded', async () => {
        bootLocationsRepeater();
        wireWizardNav();
        renderStep();
        mountIGImport();
        const authClient = await window.WeOtziStudioAuth.ready();
        const { data } = await authClient.auth.getSession();
        existingSession = data?.session || null;
        if (existingSession) {
            document.getElementById('reg-email').value = existingSession.user.email || '';
            document.getElementById('reg-email').readOnly = true;
            ['reg-password', 'reg-password-confirm'].forEach(id => {
                document.getElementById(id).closest('.studio-field').hidden = true;
            });
            showStatus('info', 'Completá los datos del estudio para asociarlo a tu cuenta actual.');
        }
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
            if (!existingSession && pw.length < 8) return showStatus('error', 'La contraseña debe tener al menos 8 caracteres.') && false;
            if (!existingSession && pw !== pw2) return showStatus('error', 'Las contraseñas no coinciden.') && false;
            return true;
        }
        if (step === 3) {
            // Locations: at least one with a formatted_address required.
            const complete = locationPickers.length && locationPickers.every(lp => lp.address?.formatted_address
                && lp.row.querySelector('[data-field="address"]').value.trim() === lp.address.formatted_address.trim());
            if (!complete) return showStatus('error', 'Completá la dirección de cada sede o quitá las sedes vacías.') && false;
            return true;
        }
        if (step === 2) {
            const year = Number(document.getElementById('reg-founded').value);
            if (year && (year < 1900 || year > new Date().getFullYear())) return showStatus('error', 'Revisá el año de fundación.') && false;
        }
        if (step === 4) {
            const urls = ['reg-cover', 'reg-logo'].map(id => document.getElementById(id).value.trim())
                .concat(document.getElementById('reg-photos').value.split('\n').map(s => s.trim())).filter(Boolean);
            if (urls.some(url => !/^https?:\/\/[^\s]+$/i.test(url))) return showStatus('error', 'Las imágenes deben tener una URL http o https válida.') && false;
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
            <details>
                <summary class="studio-help">Ingresar dirección manualmente</summary>
                <div class="studio-field"><label class="studio-label">Ciudad</label><input class="studio-input" data-field="manual-city"></div>
                <div class="studio-field"><label class="studio-label">País</label><input class="studio-input" data-field="manual-country"></div>
                <button type="button" class="studio-locations-add" data-action="manual">Usar la dirección escrita arriba</button>
                <p class="studio-help">Podés buscarla en el mapa después desde Sedes.</p>
            </details>
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
        row.querySelector('[data-action="manual"]').addEventListener('click', () => {
            const city = row.querySelector('[data-field="manual-city"]').value.trim();
            const country = row.querySelector('[data-field="manual-country"]').value.trim();
            if (!addressInput.value.trim() || !city || !country) {
                showStatus('error', 'Para ingresar una sede manualmente completá dirección, ciudad y país.'); return;
            }
            entry.address = { formatted_address: addressInput.value.trim(), city, country, latitude: null, longitude: null };
            previewEl.textContent = [entry.address.formatted_address, city, country].join(' · ');
            previewEl.hidden = false;
            clearStatus();
        });

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
        for (let step = 1; step < TOTAL_STEPS; step++) {
            if (!await validateStep(step)) { currentStep = step; renderStep(); return; }
        }
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
            payload.website = document.getElementById('reg-website').value.trim() || null;
            payload.locations = locationPickers.map((lp, index) => ({
                ...lp.address,
                label: lp.labelInput.value.trim() || (index === 0 ? 'Sede principal' : 'Sede #' + (index + 1)),
                is_primary: index === 0,
                is_active: true
            }));
            const studio = await window.WeOtziStudioAuth.register(payload);
            if (studio.confirmationRequired) {
                showStatus('success', 'Revisá ' + studio.email + ' y confirmá tu correo. Al abrir el enlace completaremos tu estudio con estos datos.');
                submitBtn.textContent = 'Esperando confirmación del correo';
                document.getElementById('wizard-prev').disabled = true;
                return;
            }

            showStatus('success', '¡Estudio creado! Redirigiendo al panel…');
            setTimeout(() => { window.location.href = window.WeOtziStudioAuth.appUrl('/studio/dashboard'); }, 600);
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
