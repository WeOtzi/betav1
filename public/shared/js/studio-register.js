// Studio onboarding: Figma five-step flow, existing Auth/RPC and shared address/media services.
(function () {
    'use strict';
    const $ = id => document.getElementById(id);
    const titles = ['Cuenta', 'Identidad', 'Sedes', 'Fotos', 'Confirmá tu estudio'];
    const textFields = ['reg-name', 'reg-email', 'reg-tagline', 'reg-bio', 'reg-founded', 'reg-languages', 'reg-instagram', 'reg-website', 'reg-whatsapp', 'reg-cover', 'reg-logo', 'reg-photos'];
    const base = window.WEOTZI_BASE_PATH || (location.pathname.startsWith('/beta/') ? '/beta' : '');
    const draftKey = 'weotzi:studio-registration:' + base;
    const files = { cover: null, logo: null, gallery: [] };
    const locations = [];
    let currentStep = 1, existingSession = null, busy = true, resultMode = false, locationId = 0;
    let completedStudio = null, mediaTouched = false, previewUrls = [];
    let confirmationEmail = '', mediaEmail = '', mediaSaving = Promise.resolve();
    const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const value = id => $(id).value.trim();
    const url = path => window.WeOtziStudioAuth.appUrl(path);

    document.addEventListener('DOMContentLoaded', init);
    async function init() {
        let initialized = false;
        wireEvents();
        bootMedia();
        restoreDraft();
        if (!locations.length) addLocation();
        $('reg-founded').max = String(new Date().getFullYear());
        renderStep(false);
        try {
            const client = await window.WeOtziStudioAuth.ready();
            const { data, error } = await client.auth.getSession();
            if (error) throw error;
            existingSession = data?.session || null;
            initialized = true;
            if (existingSession) {
                $('reg-email').value = existingSession.user.email || '';
                $('reg-email').readOnly = true;
                ['reg-password', 'reg-password-confirm'].forEach(id => { $(id).required = false; $(id).closest('.studio-field').hidden = true; });
            }
            const studio = await window.WeOtziStudioAuth.check();
            if (studio && (new URLSearchParams(location.search).get('registered') === '1' || studio.mediaPending)) {
                showComplete(studio); return;
            }
            if (!existingSession && confirmationEmail) { showConfirmation(confirmationEmail); return; }
            if (existingSession) showStatus('info', 'Completá los datos del estudio para asociarlo a tu cuenta actual.');
            const storedFiles = /^\S+@\S+\.\S+$/.test(value('reg-email')) ? await window.WeOtziStudioMedia.load?.(value('reg-email')) : null;
            if (storedFiles) { Object.assign(files, storedFiles); mediaEmail = value('reg-email'); renderMedia(); }
            loadMaps();
            if (new URLSearchParams(location.search).get('complete') === '1' && !studio) {
                showStatus('info', 'Tu cuenta de acceso ya está creada. Completá el perfil y al menos una sede para continuar.');
            }
        } catch (err) {
            showStatus('error', 'No pudimos preparar el registro. Recargá la página para intentar de nuevo.');
            return;
        } finally {
            busy = !initialized;
            $('studio-register-form').setAttribute('aria-busy', 'false');
            $('wizard-next').disabled = !initialized;
        }
    }
    function loadMaps() {
        const key = window.CONFIG?.googleMaps?.apiKey;
        if (!key || window.google?.maps?.places || document.querySelector('[data-studio-maps]')) return;
        const script = document.createElement('script');
        script.dataset.studioMaps = 'true';
        script.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(key) + '&libraries=places&loading=async';
        script.async = true;
        document.head.appendChild(script);
    }
    function showStatus(kind, message, field) {
        const el = $('wizard-status');
        el.className = 'sr-status'; el.dataset.kind = kind; el.textContent = message; el.hidden = false;
        if (field) { field.setAttribute('aria-invalid', 'true'); field.setAttribute('aria-describedby', 'wizard-status'); field.focus(); }
        else if (kind === 'error') el.focus();
        return false;
    }
    function clearStatus() { $('wizard-status').hidden = true; }
    function renderStep(focus = true) {
        resultMode = false;
        $('studio-register-form').hidden = false;
        $('registration-result').hidden = true;
        document.querySelectorAll('.sr-step').forEach(section => { section.hidden = Number(section.dataset.step) !== currentStep; });
        document.querySelectorAll('.wo-onboarding-nav [data-go-step]').forEach(button => {
            button.toggleAttribute('aria-current', Number(button.dataset.goStep) === currentStep);
            if (Number(button.dataset.goStep) === currentStep) button.setAttribute('aria-current', 'step');
        });
        document.querySelectorAll('.sr-progress i').forEach((el, i) => el.classList.toggle('is-active', i < currentStep));
        $('step-title').textContent = titles[currentStep - 1] + ' · Paso ' + currentStep + ' de 5';
        $('wizard-next').textContent = currentStep === 5 ? 'Crear estudio' : 'Continuar';
        $('wizard-prev').hidden = currentStep === 1;
        $('login-link').hidden = currentStep !== 1;
        $('import-instagram').hidden = currentStep !== 2;
        $('add-location-btn').hidden = currentStep !== 3;
        document.querySelectorAll('.sr-review-action').forEach(button => { button.hidden = currentStep !== 5; });
        $('mobile-help').hidden = currentStep !== 1;
        $('identity-title').textContent = value('reg-name') ? 'La identidad de ' + value('reg-name') : 'La identidad de tu estudio';
        if (currentStep === 5) renderSummary();
        if (focus) { $('step-title').focus(); $('registration-main').scrollIntoView({ block: 'start' }); }
        saveDraft();
    }
    async function goStep(want) {
        if (busy || resultMode || want < 1 || want > 5) return;
        if (want > currentStep) {
            for (let step = 1; step < want; step++) {
                if (!validateStep(step)) { currentStep = step; renderStep(); return; }
            }
        }
        clearStatus(); currentStep = want; renderStep();
    }
    function wireEvents() {
        $('studio-register-form').addEventListener('submit', async event => {
            event.preventDefault();
            if (busy) return;
            clearStatus();
            if (!validateStep(currentStep)) return;
            if (currentStep < 5) { currentStep++; renderStep(); return; }
            await submit();
        });
        $('wizard-prev').addEventListener('click', () => goStep(currentStep - 1));
        document.addEventListener('click', event => { const button = event.target.closest('[data-go-step]'); if (button) goStep(Number(button.dataset.goStep)); });
        $('add-location-btn').addEventListener('click', () => { if (locations.length >= 30) return showStatus('error', 'Podés registrar hasta 30 sedes.'); const entry = addLocation(); entry.row.querySelector('[data-field="label"]').focus(); saveDraft(); });
        $('studio-register-form').addEventListener('input', event => { event.target.removeAttribute('aria-invalid'); event.target.removeAttribute('aria-describedby'); saveDraft(); });
        $('import-instagram').addEventListener('click', () => {
            window.IGImport.open({ target: 'studio', mode: 'signup', prefillHandle: value('reg-instagram'), onComplete(result) {
                const pf = result?.prefill || {};
                if (result.handle && !value('reg-instagram')) $('reg-instagram').value = '@' + result.handle;
                if (pf.bio && !value('reg-bio')) $('reg-bio').value = pf.bio;
                if (pf.bio_link && !value('reg-website')) $('reg-website').value = pf.bio_link;
                saveDraft();
            } });
        });
        window.addEventListener('weotzi:studio-ready', event => { if (event.detail?.id) showComplete(event.detail); });
    }
    function validateStep(step) {
        if (step === 1) {
            if (value('reg-name').length < 2 || value('reg-name').length > 160) return showStatus('error', 'Escribí un nombre de estudio de entre 2 y 160 caracteres.', $('reg-name'));
            if (!$('reg-email').validity.valid || !/^\S+@\S+\.\S+$/.test(value('reg-email'))) return showStatus('error', 'El email no parece válido.', $('reg-email'));
            if (!existingSession && $('reg-password').value.length < 8) return showStatus('error', 'La contraseña debe tener al menos 8 caracteres.', $('reg-password'));
            if (!existingSession && $('reg-password').value !== $('reg-password-confirm').value) return showStatus('error', 'Las contraseñas no coinciden.', $('reg-password-confirm'));
        }
        if (step === 2) {
            const year = Number(value('reg-founded'));
            if (value('reg-founded') && (!Number.isInteger(year) || year < 1900 || year > new Date().getFullYear())) return showStatus('error', 'Revisá el año de fundación.', $('reg-founded'));
            if (value('reg-website') && !validUrl(value('reg-website'))) return showStatus('error', 'El sitio web debe tener una URL http o https válida.', $('reg-website'));
        }
        if (step === 3) {
            for (const entry of locations) {
                const input = entry.row.querySelector('[data-field="address"]');
                if (!entry.address.formatted_address || input.value.trim() !== entry.address.formatted_address.trim()) return showStatus('error', 'Completá la dirección de cada sede y seleccionala de los resultados, o usá el ingreso manual.', input);
            }
            if (!locations.some(entry => entry.primary && entry.active)) return showStatus('error', 'Elegí una sede principal activa.');
        }
        if (step === 4) {
            for (const id of ['reg-cover', 'reg-logo', 'reg-photos']) {
                if ($(id).value.split('\n').map(s => s.trim()).filter(Boolean).some(s => !validUrl(s))) return showStatus('error', 'Las imágenes deben tener una URL http o https válida.', $(id));
            }
            try { window.WeOtziStudioMedia.validate(files); } catch (err) { return showStatus('error', err.message); }
            if (parsePhotos().length + files.gallery.length > 8) return showStatus('error', 'La galería admite hasta 8 imágenes en total.');
        }
        return true;
    }
    function validUrl(raw) { try { const parsed = new URL(raw); return ['https:', 'http:'].includes(parsed.protocol) && !!parsed.hostname && !parsed.username && !parsed.password; } catch (_) { return false; } }
    function parsePhotos() { return value('reg-photos').split('\n').map(s => s.trim()).filter(Boolean); }
    function addLocation(saved = {}) {
        const id = ++locationId;
        const entry = { row: document.createElement('article'), address: saved.address || {}, primary: saved.primary ?? locations.length === 0, active: saved.active ?? true, picker: null };
        const label = (field, title, placeholder = '') => '<div class="studio-field"><label for="location-' + id + '-' + field + '">' + title + '</label><input class="wo-input" id="location-' + id + '-' + field + '" data-field="' + field + '" placeholder="' + placeholder + '" maxlength="200"></div>';
        entry.row.className = 'sr-location';
        entry.row.innerHTML = '<div class="sr-location-head"><strong>Sede</strong><button type="button" class="wo-btn wo-btn--secondary" data-remove>Quitar sede</button></div><div class="sr-grid">' +
            label('label', 'Etiqueta de la sede', 'Sede principal') + label('address', 'Dirección', 'Buscá la dirección…') +
            '<div class="studio-field"><label>País / provincia / ciudad / localidad</label><div class="sr-address-details" data-region>Seleccioná una dirección</div></div>' +
            '<div class="studio-field"><label>Calle / número / unidad / código postal</label><div class="sr-address-details" data-street>Seleccioná una dirección</div></div>' +
            '<div class="studio-field"><label>Pin en el mapa</label><div class="sr-address-details" data-pin>Comprobá la ubicación</div></div>' +
            '<label class="sr-switch"><input type="checkbox" data-primary role="switch">Sede principal</label><label class="sr-switch sr-full"><input type="checkbox" data-active role="switch">Sede activa</label></div>' +
            '<details class="sr-address-manual"><summary>Ingresar dirección manualmente</summary><p class="sr-help">Si el buscador no está disponible, completá la dirección de arriba, ciudad y país. Podés ubicar el pin después desde Sedes.</p><div class="sr-grid">' +
            label('country', 'País') + label('state_province', 'Provincia / estado') + label('city', 'Ciudad') + label('locality', 'Localidad / barrio') + label('street', 'Calle') + label('street_number', 'Número') + label('unit', 'Unidad / piso') + label('postal_code', 'Código postal') +
            '</div><button type="button" class="wo-btn wo-btn--secondary" data-manual>Usar esta dirección</button></details>';
        $('locations-list').appendChild(entry.row);
        locations.push(entry);
        const field = name => entry.row.querySelector('[data-field="' + name + '"]');
        field('label').value = saved.label || (entry.primary ? 'Sede principal' : '');
        field('address').value = entry.address.formatted_address || '';
        field('address').autocomplete = 'off';
        for (const name of ['country', 'state_province', 'city', 'locality', 'street', 'street_number', 'unit', 'postal_code']) field(name).value = entry.address[name] || '';
        entry.row.querySelector('[data-manual]').addEventListener('click', () => {
            if (!field('address').value.trim()) return showStatus('error', 'Completá la dirección de la sede.', field('address'));
            for (const name of ['city', 'country']) if (!field(name).value.trim()) return showStatus('error', 'Para ingresar una sede manualmente completá dirección, ciudad y país.', field(name));
            entry.address = { formatted_address: field('address').value.trim(), latitude: null, longitude: null };
            for (const name of ['country', 'state_province', 'city', 'locality', 'street', 'street_number', 'unit', 'postal_code']) entry.address[name] = field(name).value.trim() || null;
            renderAddress(entry); clearStatus(); saveDraft();
        });
        entry.row.querySelector('[data-remove]').addEventListener('click', () => {
            if (locations.length === 1 || busy) return;
            entry.picker?.detach?.(); entry.row.remove(); locations.splice(locations.indexOf(entry), 1);
            if (entry.primary) { locations[0].primary = true; locations[0].active = true; }
            refreshLocations(); saveDraft();
        });
        entry.row.querySelector('[data-primary]').addEventListener('change', event => {
            if (!event.target.checked) { event.target.checked = true; return; }
            locations.forEach(item => { item.primary = item === entry; }); entry.active = true; refreshLocations(); saveDraft();
        });
        entry.row.querySelector('[data-active]').addEventListener('change', event => {
            if (entry.primary && !event.target.checked) { event.target.checked = true; showStatus('error', 'La sede principal debe estar activa. Elegí otra sede principal antes de desactivarla.'); return; }
            entry.active = event.target.checked; saveDraft();
        });
        if (window.WeOtziAddressPicker) entry.picker = window.WeOtziAddressPicker.attach(field('address'), { onChange(address) {
            entry.address = address || {}; renderAddress(entry); saveDraft();
        } });
        renderAddress(entry); refreshLocations();
        return entry;
    }
    function refreshLocations() {
        locations.forEach((entry, i) => {
            entry.row.querySelector('.sr-location-head strong').textContent = entry.primary ? 'Sede principal' : 'Sede ' + (i + 1);
            entry.row.querySelector('[data-remove]').hidden = locations.length === 1;
            entry.row.querySelector('[data-primary]').checked = entry.primary;
            entry.row.querySelector('[data-active]').checked = entry.active;
        });
        $('add-location-btn').disabled = locations.length >= 30;
    }
    function renderAddress(entry) {
        const addr = entry.address;
        entry.row.querySelector('[data-region]').textContent = [addr.country, addr.state_province, addr.city, addr.locality].filter(Boolean).join(' · ') || 'Seleccioná una dirección';
        entry.row.querySelector('[data-street]').textContent = [addr.street, addr.street_number, addr.unit, addr.postal_code].filter(Boolean).join(' · ') || addr.formatted_address || 'Seleccioná una dirección';
        const pin = entry.row.querySelector('[data-pin]');
        if (Number.isFinite(addr.latitude) && Number.isFinite(addr.longitude)) pin.innerHTML = '<a class="sr-map-link" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&amp;query=' + encodeURIComponent(addr.latitude + ',' + addr.longitude) + '">Comprobar ubicación en el mapa ↗</a>';
        else pin.textContent = addr.formatted_address ? 'Dirección manual · pin pendiente' : 'Comprobá la ubicación';
    }
    function bootMedia() {
        const names = { cover: 'Imagen de portada', logo: 'Logo', gallery: 'Galería del estudio' };
        $('media-fields').innerHTML = Object.entries(names).map(([key, title]) => '<div class="sr-media-field"><label class="sr-media-label" for="file-' + key + '">' + title + '</label><div class="sr-media-box"><strong id="media-name-' + key + '">Sin archivos seleccionados</strong><p>JPG, PNG o WebP · hasta 5 MB por imagen.' + (key === 'gallery' ? ' Hasta 8 fotos; podés cambiar el orden.' : ' Revisá la imagen antes de continuar.') + '</p><div class="sr-media-previews" id="media-preview-' + key + '"></div><input class="sr-file-input" type="file" id="file-' + key + '" accept="image/jpeg,image/png,image/webp"' + (key === 'gallery' ? ' multiple' : '') + '><button type="button" class="wo-btn wo-btn--secondary" data-pick="' + key + '">Elegir archivo</button></div></div>').join('');
        document.querySelectorAll('[data-pick]').forEach(button => button.addEventListener('click', () => $('file-' + button.dataset.pick).click()));
        Object.keys(names).forEach(key => $('file-' + key).addEventListener('change', event => {
            const selected = Array.from(event.target.files || []);
            if (!selected.length) return;
            const next = { ...files, [key]: key === 'gallery' ? selected : selected[0] };
            try { window.WeOtziStudioMedia.validate(next); }
            catch (err) { event.target.value = ''; showStatus('error', err.message); return; }
            Object.assign(files, next); event.target.value = ''; mediaTouched = true; clearStatus(); renderMedia(); persistMedia();
        }));
    }
    function renderMedia() {
        previewUrls.forEach(src => URL.revokeObjectURL(src)); previewUrls = [];
        for (const key of ['cover', 'logo', 'gallery']) {
            const list = key === 'gallery' ? files.gallery : files[key] ? [files[key]] : [];
            $('media-name-' + key).textContent = list.map(file => file.name).join(' · ') || 'Sin archivos seleccionados';
            document.querySelector('[data-pick="' + key + '"]').textContent = list.length ? 'Cambiar archivo' : 'Elegir archivo';
            const previews = $('media-preview-' + key); previews.replaceChildren();
            list.forEach((file, index) => {
                const src = URL.createObjectURL(file); previewUrls.push(src);
                const card = document.createElement('div'); card.className = 'sr-media-card';
                card.innerHTML = '<img src="' + src + '" alt="' + esc(file.name) + '"><button type="button" data-delete aria-label="Quitar ' + esc(file.name) + '">Quitar</button>' + (key === 'gallery' && index > 0 ? '<button type="button" data-up aria-label="Mover ' + esc(file.name) + ' antes">← Antes</button>' : '');
                card.querySelector('[data-delete]').addEventListener('click', () => { if (key === 'gallery') files.gallery.splice(index, 1); else files[key] = null; mediaTouched = true; renderMedia(); persistMedia(); });
                card.querySelector('[data-up]')?.addEventListener('click', () => { [files.gallery[index - 1], files.gallery[index]] = [files.gallery[index], files.gallery[index - 1]]; mediaTouched = true; renderMedia(); persistMedia(); });
                previews.appendChild(card);
            });
        }
    }
    function summaryRows(rows) { return rows.map(([title, detail]) => '<div class="sr-summary-row"><strong>' + esc(title) + '</strong><p>' + esc(detail) + '</p></div>').join(''); }
    function persistMedia() {
        const email = value('reg-email');
        if (!/^\S+@\S+\.\S+$/.test(email)) return;
        const snapshot = { ...files, gallery: files.gallery.slice() };
        mediaSaving = mediaSaving.catch(() => {}).then(async () => {
            await window.WeOtziStudioMedia.stage(email, snapshot);
            if (mediaEmail && mediaEmail !== email) await window.WeOtziStudioMedia.clear(mediaEmail);
            mediaEmail = email;
        });
        mediaSaving.catch(err => showStatus('error', err.message));
    }
    function renderSummary() {
        const identity = [value('reg-tagline'), value('reg-bio'), value('reg-founded') ? 'Fundado en ' + value('reg-founded') : '', value('reg-languages'), value('reg-instagram'), value('reg-website'), value('reg-whatsapp')].filter(Boolean).join(' · ');
        $('confirm-summary').innerHTML = summaryRows([
            [value('reg-name'), value('reg-email')], ['Identidad', identity || 'Podés completarla después'],
            ...locations.map(entry => [entry.row.querySelector('[data-field="label"]').value.trim() || 'Sede', [entry.primary ? 'Sede principal' : 'Sede adicional', entry.active ? 'Activa' : 'Inactiva', entry.address.formatted_address, entry.address.city, entry.address.country].filter(Boolean).join(' · ')]),
            ['Imágenes', [files.cover ? files.cover.name : value('reg-cover') ? 'Portada por enlace' : '', files.logo ? files.logo.name : value('reg-logo') ? 'Logo por enlace' : '', (files.gallery.length + parsePhotos().length) + ' fotos de galería'].filter(Boolean).join(' · ')]
        ]);
    }
    function saveDraft() {
        if (resultMode) return;
        try {
            sessionStorage.setItem(draftKey, JSON.stringify({ step: currentStep, confirmationEmail, fields: Object.fromEntries(textFields.map(id => [id, $(id).value])), locations: locations.map(entry => ({ address: entry.address, primary: entry.primary, active: entry.active, label: entry.row.querySelector('[data-field="label"]').value })) }));
        } catch (_) { /* Registration remains available when browser storage is blocked. */ }
    }
    function restoreDraft() {
        try {
            const draft = JSON.parse(sessionStorage.getItem(draftKey) || 'null');
            if (!draft) return;
            confirmationEmail = typeof draft.confirmationEmail === 'string' ? draft.confirmationEmail : '';
            for (const id of textFields) if (typeof draft.fields?.[id] === 'string') $(id).value = draft.fields[id];
            (draft.locations || []).slice(0, 30).forEach(addLocation);
            // Passwords are intentionally never persisted; account step is revalidated.
            currentStep = 1;
        } catch (_) { /* Ignore an obsolete or unavailable local draft. */ }
    }
    async function submit() {
        for (let step = 1; step < 5; step++) if (!validateStep(step)) { currentStep = step; renderStep(); return; }
        busy = true; $('studio-register-form').setAttribute('aria-busy', 'true');
        $('wizard-next').disabled = true; $('wizard-next').textContent = 'Creando estudio…';
        document.querySelectorAll('#wizard-actions button,.wo-onboarding-nav button').forEach(button => { button.disabled = true; });
        try {
            await mediaSaving;
            if (mediaTouched || files.cover || files.logo || files.gallery.length) await window.WeOtziStudioMedia.stage(value('reg-email'), files);
            const profile = { name: value('reg-name'), email: value('reg-email'), password: $('reg-password').value, tagline: value('reg-tagline') || null, bio: value('reg-bio') || null, founded_year: Number(value('reg-founded')) || null, languages: value('reg-languages').split(',').map(s => s.trim()).filter(Boolean), instagram: value('reg-instagram') || null, website: value('reg-website') || null, whatsapp: value('reg-whatsapp') || null, cover_image: value('reg-cover') || null, logo_image: value('reg-logo') || null, photo_feed_items: parsePhotos().map((image, i) => ({ url: image, kind: 'image', category: 'studio', sort: i, created_at: new Date().toISOString() })), locations: [...locations].sort((a, b) => Number(b.primary) - Number(a.primary)).map(entry => ({ ...entry.address, label: entry.row.querySelector('[data-field="label"]').value.trim() || 'Sede', is_primary: entry.primary, is_active: entry.active })) };
            const studio = await window.WeOtziStudioAuth.register(profile);
            $('reg-password').value = ''; $('reg-password-confirm').value = '';
            if (studio.confirmationRequired) showConfirmation(studio.email);
            else { clearDraft(); showComplete(studio); }
        } catch (err) {
            const { data } = await window.WeOtziStudioAuth.getSupabase().auth.getSession().catch(() => ({ data: {} }));
            existingSession = data?.session || existingSession;
            const message = String(err?.message || 'Intentá nuevamente.');
            showStatus('error', /already|registered/i.test(message) ? 'Ya existe una cuenta con ese email. Iniciá sesión desde Ya tengo cuenta.' : 'No pudimos completar el registro: ' + message);
        } finally {
            busy = false; $('studio-register-form').setAttribute('aria-busy', 'false');
            document.querySelectorAll('#wizard-actions button,.wo-onboarding-nav button').forEach(button => { button.disabled = false; });
            $('wizard-next').textContent = 'Crear estudio'; refreshLocations();
        }
    }
    function result(title, html) {
        resultMode = true; clearStatus();
        $('step-title').textContent = title;
        $('studio-register-form').hidden = true;
        $('registration-result').hidden = false; $('registration-result').innerHTML = html;
        $('mobile-help').hidden = true;
        $('step-title').focus(); $('registration-main').scrollIntoView({ block: 'start' });
    }
    function showConfirmation(email) {
        confirmationEmail = email; resultMode = false; saveDraft();
        result('Confirmá tu email', '<h2>Revisá tu correo</h2>' + summaryRows([[email, 'Abrí el enlace de confirmación para completar tu registro.']]) + '<p class="sr-help">Si elegiste archivos, volvé a este navegador después de confirmar el correo para completar la subida de imágenes.</p><div class="sr-actions"><button type="button" class="wo-btn" id="check-confirmation">Ya confirmé mi email</button><button type="button" class="wo-btn wo-btn--secondary" id="change-email">Cambiar email</button><button type="button" class="wo-btn wo-btn--secondary" id="resend-confirmation">Reenviar correo</button></div>');
        $('check-confirmation').addEventListener('click', () => { location.href = url('/studio/login?confirmed=1'); });
        $('change-email').addEventListener('click', () => { confirmationEmail = ''; currentStep = 1; renderStep(); showStatus('info', 'Podés registrar otro correo. La cuenta anterior seguirá pendiente de confirmación.'); $('reg-email').focus(); });
        $('resend-confirmation').addEventListener('click', async event => {
            const button = event.currentTarget; button.disabled = true;
            try {
                const auth = window.WeOtziStudioAuth.getSupabase().auth;
                if (typeof auth.resend !== 'function') throw new Error('El reenvío de correo no está disponible en este entorno de prueba.');
                const { error } = await auth.resend({ type: 'signup', email, options: { emailRedirectTo: location.origin + url('/studio/login?confirmed=1') } });
                if (error) throw error;
                showStatus('success', 'Solicitamos un nuevo correo de confirmación. Revisá también la carpeta de spam.');
            }
            catch (err) { showStatus('error', err.message || 'No pudimos reenviar el correo. Intentá nuevamente.'); }
            finally { button.disabled = false; }
        });
    }
    function showComplete(studio) {
        completedStudio = studio;
        clearDraft();
        const pending = !!studio.mediaPending;
        result(pending ? 'Terminemos de configurar tu estudio' : 'Tu estudio ya tiene lugar en We Ötzi', '<h2>' + (pending ? 'Configuración pendiente' : 'Tus próximos pasos') + '</h2>' + summaryRows(pending ? [['Cuenta de acceso', 'Creada · ' + (studio.email || value('reg-email'))], ['Perfil del estudio', 'Nombre, identidad y sedes guardados'], ['Imágenes pendientes', studio.mediaError || 'No pudimos terminar de subir las imágenes. Tus archivos siguen guardados en este navegador.']] : [['Tu perfil', 'Nombre, identidad y sede guardados'], ['Tu equipo', 'Todavía no invitaste artistas'], ['Verificación', 'Pendiente de enviar información']]) + '<div class="sr-actions">' + (pending ? '<button type="button" class="wo-btn" id="retry-media">Continuar configuración</button>' : '') + '<a class="wo-btn' + (pending ? ' wo-btn--secondary' : '') + '" href="' + esc(url('/studio/dashboard')) + '">Ir al panel</a>' + (!pending ? '<a class="wo-btn wo-btn--secondary" href="' + esc(url('/studio/dashboard#perfil')) + '">Verificar</a><a class="wo-btn wo-btn--secondary" href="' + esc(url('/studio/dashboard#roster')) + '">Invitar</a>' : '<a class="wo-btn wo-btn--secondary" href="' + esc(url('/help/')) + '">Contactar soporte</a>') + '</div>');
        const verification = $('registration-result').querySelector('a[href$="#perfil"]');
        if (verification) verification.addEventListener('click', event => { event.preventDefault(); showStatus('info', 'La solicitud de verificación de Estudios todavía no está disponible desde este panel. Tu estudio quedó registrado y podés completar su perfil.'); });
        const support = $('registration-result').querySelector('a[href$="/help/"]');
        if (support) { support.href = 'https://weotzi.com/faqs/'; support.target = '_blank'; support.rel = 'noopener'; }
        $('retry-media')?.addEventListener('click', async event => {
            const button = event.currentTarget; button.disabled = true; button.textContent = 'Subiendo imágenes…';
            try { const updated = await window.WeOtziStudioMedia.finish(completedStudio, existingSession?.user.email || studio.email || value('reg-email')); showComplete({ ...updated, mediaPending: false, mediaError: null }); }
            catch (err) { showStatus('error', err.message || 'No pudimos terminar de subir las imágenes. Podés reintentar.'); button.disabled = false; button.textContent = 'Continuar configuración'; }
        });
    }
    function clearDraft() { try { sessionStorage.removeItem(draftKey); } catch (_) { /* Optional browser draft. */ } }
})();
