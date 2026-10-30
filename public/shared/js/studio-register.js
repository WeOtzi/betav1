// ============================================
// Studio Registration Wizard
// 5 steps: Account → Identity → Locations → Photos → Confirm.
// On submit WeOtziStudioAuth.register() signs up (the draft waits in
// user_metadata.studio_registration until the email is confirmed) and
// complete_studio_registration creates the studio and its locations in one call.
//
// Catalog claim (step 1): "¿Tu estudio ya figura en We Ötzi?" searches the
// unowned catalog studios (Studios.listUnownedStudios). "Es mi estudio" opens
// the claim panel; WeOtziStudioAuth.claim() signs up with the draft in
// user_metadata.studio_claim and files request_studio_claim after the email
// confirmation. When complete_studio_registration refuses a catalog name
// ("reclamalo desde el registro") the wizard offers that claim instead.
// Without the M1 migration the catalog search stays hidden.
// ============================================

(function () {
    'use strict';

    const TOTAL_STEPS = 5;
    let currentStep = 1;
    const locationPickers = []; // array of { row: HTMLElement, picker: AddressPicker, address: {} }
    // Catalog search + claim panel state.
    const catalog = { available: false, seq: 0, results: [], selected: null };
    let claimMode = false;

    let existingSession = null;
    document.addEventListener('DOMContentLoaded', async () => {
        bootLocationsRepeater();
        wireWizardNav();
        wireCatalog();
        renderStep();
        mountIGImport();
        const auth = window.WeOtziStudioAuth;
        const authClient = await auth.ready();
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
        catalogAvailable(studiosRepo()).then(ok => { if (ok) revealCatalog(); });
        if (typeof auth.whenChecked === 'function') applyAuthState(await auth.whenChecked());
    });

    // -------------------------------------------------------------
    // Catalog helpers (pure; exported for tests)
    // -------------------------------------------------------------
    function studiosRepo() {
        return window.WeotziData?.Studios || null;
    }
    function safeUrl(u) {
        const kit = window.WeOtziStudioKit;
        if (typeof kit?.safeUrl === 'function') return kit.safeUrl(u);
        const s = String(u == null ? '' : u).trim();
        return /^https?:\/\/[^\s/?#]+[^\s]*$/i.test(s) ? s : null;
    }
    // Accent- and case-insensitive name key (the server compares upper(name)).
    function normName(value) {
        return String(value == null ? '' : value).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/\s+/g, ' ').trim().toUpperCase();
    }
    function findExactMatch(rows, name) {
        const key = normName(name);
        return key ? (rows || []).find(row => normName(row?.name) === key) || null : null;
    }
    // Exact name matches first; the RPC order is kept otherwise.
    function sortCatalogMatches(rows, name) {
        const key = normName(name);
        const list = Array.isArray(rows) ? rows.slice() : [];
        if (!key) return list;
        return list.filter(row => normName(row?.name) === key).concat(list.filter(row => normName(row?.name) !== key));
    }
    // The search is shown only when the RPC answers (M1 applied).
    async function catalogAvailable(repo) {
        if (typeof repo?.listUnownedStudios !== 'function') return false;
        try {
            const res = await repo.listUnownedStudios('we');
            return !!res && !res.unavailable && !res.error;
        } catch (_) {
            return false;
        }
    }
    function studioCardHtml(row, { action = '', note = '' } = {}) {
        const logo = safeUrl(row?.logo_image);
        const name = row?.name || 'Estudio';
        const place = [row?.city, row?.country].filter(Boolean).join(' · ');
        return '<span class="studio-claim-logo" aria-hidden="true">'
            + (logo ? `<img src="${escapeHtml(logo)}" alt="" loading="lazy">` : escapeHtml(name.trim().charAt(0) || '·'))
            + '</span>'
            + `<span class="studio-sponsor-body"><strong>${escapeHtml(name)}</strong>`
            + (place ? `<small>${escapeHtml(place)}</small>` : '')
            + (note ? `<small>${escapeHtml(note)}</small>` : '')
            + '</span>' + action;
    }
    function renderCatalogResults(rows, { query = '', matchName = '' } = {}) {
        const list = Array.isArray(rows) ? rows : [];
        const text = String(query || '').trim();
        if (!list.length) {
            return text.length >= 2
                ? `<p class="studio-help">No encontramos «${escapeHtml(text)}» en el catálogo. Seguí con el registro para crear tu estudio.</p>`
                : '';
        }
        const key = normName(matchName);
        return list.map(row => {
            const isMatch = !!key && normName(row?.name) === key;
            const action = `<button type="button" class="studio-btn studio-btn-ghost" data-claim-studio="${escapeHtml(row?.id)}"`
                + ` aria-label="${escapeHtml('Es mi estudio: reclamar ' + (row?.name || 'este estudio'))}">Es mi estudio</button>`;
            return `<div class="studio-claim-result${isMatch ? ' is-match' : ''}" role="listitem">`
                + studioCardHtml(row, { action, note: isMatch ? 'Mismo nombre que tu registro' : '' })
                + '</div>';
        }).join('');
    }
    function rejectedClaimNotice(claim) {
        const name = claim?.studios?.name || 'tu estudio';
        const note = String(claim?.decision_note || '').trim();
        return [
            `Soporte no aprobó tu reclamo de ${name}.`,
            note ? 'Motivo: ' + (/[.!?…]$/.test(note) ? note : note + '.') : '',
            'Podés reclamar otro estudio o registrar uno nuevo.'
        ].filter(Boolean).join(' ');
    }

    // -------------------------------------------------------------
    // Catalog search + claim panel
    // -------------------------------------------------------------
    function revealCatalog() {
        catalog.available = true;
        const box = document.getElementById('claim-search');
        if (box) box.hidden = false;
    }
    function hideCatalog() {
        catalog.available = false;
        const box = document.getElementById('claim-search');
        if (box) box.hidden = true;
    }
    function wireCatalog() {
        const input = document.getElementById('claim-query');
        const results = document.getElementById('claim-results');
        if (!input || !results) return;
        let timer = null;
        input.addEventListener('input', () => {
            clearTimeout(timer);
            timer = setTimeout(() => { runCatalogSearch(input.value); }, 300);
        });
        results.addEventListener('click', (event) => {
            const button = event.target.closest('[data-claim-studio]');
            if (!button) return;
            const studio = catalog.results.find(row => String(row.id) === button.dataset.claimStudio);
            if (studio) openClaimPanel(studio);
        });
    }
    // Renders the results for `query` and resolves with the rows (stale
    // responses are dropped).
    async function runCatalogSearch(query, { matchName = '' } = {}) {
        const repo = studiosRepo();
        const results = document.getElementById('claim-results');
        const text = String(query || '').trim();
        const seq = ++catalog.seq;
        if (!repo || !results) return [];
        if (text.length < 2) {
            catalog.results = [];
            results.innerHTML = '';
            return [];
        }
        results.innerHTML = '<p class="studio-help">Buscando en el catálogo…</p>';
        const res = await repo.listUnownedStudios(text);
        if (seq !== catalog.seq) return catalog.results;
        if (res?.unavailable) { hideCatalog(); return []; }
        if (res?.error) {
            catalog.results = [];
            results.innerHTML = '<p class="studio-help">No pudimos buscar en el catálogo. Intentá de nuevo en unos segundos.</p>';
            return [];
        }
        catalog.results = sortCatalogMatches(res?.data || [], matchName);
        results.innerHTML = renderCatalogResults(catalog.results, { query: text, matchName });
        return catalog.results;
    }
    function setCatalogQuery(value) {
        const input = document.getElementById('claim-query');
        if (input) input.value = value || '';
    }
    function openClaimPanel(studio) {
        catalog.selected = studio;
        claimMode = true;
        clearStatus();
        document.getElementById('wizard-body').hidden = true;
        document.getElementById('claim-panel').hidden = false;
        document.getElementById('claim-selected').innerHTML =
            '<div class="studio-claim-result">' + studioCardHtml(studio) + '</div>';
        const account = document.getElementById('claim-account');
        const note = document.getElementById('claim-session-note');
        account.hidden = !!existingSession;
        note.hidden = !existingSession;
        if (existingSession) {
            note.textContent = 'Vas a reclamarlo con tu cuenta ' + (existingSession.user.email || 'actual') + '.';
        } else {
            [['claim-email', 'reg-email'], ['claim-password', 'reg-password'], ['claim-password-confirm', 'reg-password-confirm']]
                .forEach(([target, source]) => {
                    const el = document.getElementById(target);
                    if (el && !el.value) el.value = document.getElementById(source).value;
                });
        }
        renderStep();
        document.getElementById('claim-panel-title').focus();
    }
    function closeClaimPanel() {
        claimMode = false;
        catalog.selected = null;
        clearStatus();
        document.getElementById('claim-panel').hidden = true;
        document.getElementById('wizard-body').hidden = false;
        renderStep();
    }
    // Registration refused because the name is already an unowned catalog studio.
    async function offerClaim(name, message) {
        if (claimMode) closeClaimPanel();
        currentStep = 1;
        renderStep();
        revealCatalog(); // the refusal itself proves the catalog RPCs exist
        setCatalogQuery(name);
        showStatus('error', message);
        await runCatalogSearch(name, { matchName: name });
        document.getElementById('claim-search')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    }
    function applyAuthState(state) {
        if (!state) return;
        if (state.kind === 'claimable') {
            const nameInput = document.getElementById('reg-name');
            if (nameInput && !nameInput.value.trim()) nameInput.value = state.name || '';
            offerClaim(state.name, '«' + (state.name || 'Ese estudio') + '» ya figura en We Ötzi, así que no pudimos crear el estudio. '
                + 'Si es tuyo, reclamalo desde la lista; si no, cambiá el nombre (por ejemplo, sumá la ciudad) y volvé a enviar el registro.');
        } else if (state.kind === 'claim_rejected') {
            showStatus('info', rejectedClaimNotice(state.claim));
        } else if (state.kind === 'claim_failed') {
            showStatus('error', 'No pudimos enviar tu reclamo: ' + (state.error || 'el estudio ya no se puede reclamar.')
                + ' Podés buscar otro estudio o registrar uno nuevo.');
        }
    }
    async function submitClaim() {
        clearStatus();
        const studio = catalog.selected;
        if (!studio) { closeClaimPanel(); return; }
        const value = id => document.getElementById(id).value.trim();
        const evidence = value('claim-evidence');
        const email = value('claim-email');
        const password = document.getElementById('claim-password').value;
        if (evidence.length < 10) return showStatus('error', 'Contanos con un poco más de detalle cómo verificamos que el estudio es tuyo (mínimo 10 caracteres).');
        if (evidence.length > 1000) return showStatus('error', 'La evidencia admite hasta 1000 caracteres.');
        if (!existingSession) {
            if (!/^\S+@\S+\.\S+$/.test(email)) return showStatus('error', 'El email no parece válido.');
            if (password.length < 8) return showStatus('error', 'La contraseña debe tener al menos 8 caracteres.');
            if (password !== document.getElementById('claim-password-confirm').value) return showStatus('error', 'Las contraseñas no coinciden.');
        }
        const next = document.getElementById('wizard-next');
        const prev = document.getElementById('wizard-prev');
        next.disabled = true;
        prev.disabled = true;
        next.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Enviando reclamo…';
        try {
            const result = await window.WeOtziStudioAuth.claim({
                studioId: studio.id, studio,
                evidence,
                contactName: value('claim-contact-name'),
                contactPhone: value('claim-contact-phone'),
                email: existingSession ? null : email,
                password: existingSession ? null : password
            });
            if (result?.confirmationRequired) {
                showStatus('success', 'Revisá ' + result.email + ' y confirmá tu correo. Al abrir el enlace enviamos tu reclamo de '
                    + (studio.name || 'tu estudio') + ' a revisión.');
                next.textContent = 'Esperando confirmación del correo';
                return;
            }
            window.WeOtziStudioAuth.presentState(result);
        } catch (err) {
            console.error('[studio-register] claim failed:', err);
            next.disabled = false;
            prev.disabled = false;
            renderStep();
            const msg = String(err?.message || err);
            showStatus('error', /already|registered/i.test(msg)
                ? 'Ya existe una cuenta con ese email. Iniciá sesión y volvé a reclamar el estudio.'
                : 'No pudimos enviar el reclamo: ' + msg);
        }
    }

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
        if (claimMode) {
            prev.disabled = false;
            prev.innerHTML = '<i class="fa-solid fa-arrow-left"></i> Volver al registro';
            next.innerHTML = '<i class="fa-solid fa-flag"></i> Reclamar estudio';
            return;
        }
        prev.innerHTML = '<i class="fa-solid fa-arrow-left"></i> Atrás';
        prev.disabled = (currentStep === 1);
        next.innerHTML = (currentStep === TOTAL_STEPS)
            ? '<i class="fa-solid fa-rocket"></i> Crear estudio'
            : 'Continuar <i class="fa-solid fa-arrow-right"></i>';

        if (currentStep === TOTAL_STEPS) renderConfirmSummary();
    }

    function wireWizardNav() {
        document.getElementById('wizard-prev').addEventListener('click', () => {
            if (claimMode) { closeClaimPanel(); return; }
            if (currentStep > 1) { currentStep--; renderStep(); }
        });
        document.getElementById('wizard-next').addEventListener('click', async () => {
            if (claimMode) { await submitClaim(); return; }
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
            // complete_studio_registration refuses an unowned catalog name:
            // offer the claim now instead of after the five steps.
            if (catalog.available) {
                setCatalogQuery(name);
                const rows = await runCatalogSearch(name, { matchName: name });
                if (findExactMatch(rows, name)) {
                    return showStatus('error', '«' + name + '» ya figura en We Ötzi. Si es tu estudio, reclamalo desde la lista; '
                        + 'si no, usá otro nombre (por ejemplo, sumá la ciudad).') && false;
                }
            }
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
            if (window.WeOtziStudioAuth.isClaimableError?.(err)) {
                const name = document.getElementById('reg-name').value.trim();
                await offerClaim(name, '«' + name + '» ya figura en We Ötzi, así que no pudimos crear el estudio. '
                    + 'Si es tuyo, reclamalo desde la lista; si no, cambiá el nombre (por ejemplo, sumá la ciudad) y volvé a enviar el registro.');
                return;
            }
            const msg = String(err?.message || err);
            // Friendlier message for the most common conflict.
            if (msg.toLowerCase().includes('already') || msg.toLowerCase().includes('registered')) {
                showStatus('error', 'Ya existe una cuenta con ese email. Probá iniciar sesión.');
            } else {
                showStatus('error', 'No pudimos crear el estudio: ' + msg);
            }
        }
    }

    // Pure catalog helpers, exposed for tests (tests/studio-claim-onboarding.test.js).
    window.WeOtziStudioRegister = {
        normName, findExactMatch, sortCatalogMatches, catalogAvailable,
        renderCatalogResults, studioCardHtml, rejectedClaimNotice
    };
})();
