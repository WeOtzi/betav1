// Studio onboarding: Figma five-step flow, existing Auth/RPC and shared address/media services.
//
// Revisión "Estudios v1" (nov 2026):
//   Paso 1  al continuar busca estudios iguales o parecidos (Studios.findMatches)
//           y muestra la advertencia con iniciar sesión, reclamar la ficha,
//           cambiar el nombre, registrar una sede o seguir como estudio distinto
//           (con verificación adicional y sin compartir dirección).
//   Paso 2  año de fundación con calendario de años e idiomas como selección
//           múltiple (studio-register-pickers.js); aviso si el Instagram ya está
//           vinculado a otro estudio; el import de Instagram avisa que las fotos
//           se publican cuando se verifica la cuenta.
//   Paso 3  pin de cada sede arrastrable en el mapa, con la dirección traída de
//           Google Maps (studio-location-map.js); las sedes no pueden coincidir
//           con la dirección de un estudio parecido.
//   Paso 5  vista previa del perfil editable en el lugar.
// El servidor repite los controles de nombre y dirección en
// complete_studio_registration (migración 20261102120000_studio_verification).
(function () {
    'use strict';
    const $ = id => document.getElementById(id);
    const titles = ['Cuenta', 'Identidad', 'Sedes', 'Fotos', 'Confirmá tu estudio'];
    const textFields = ['reg-name', 'reg-email', 'reg-tagline', 'reg-bio', 'reg-founded', 'reg-languages', 'reg-instagram', 'reg-website', 'reg-whatsapp', 'reg-cover', 'reg-logo', 'reg-photos'];
    const base = window.WEOTZI_BASE_PATH || (location.pathname.startsWith('/beta/') ? '/beta' : '');
    const draftKey = 'weotzi:studio-registration:' + base;
    const files = { cover: null, logo: null, gallery: [] };
    const locations = [];
    const ADDRESS_RADIUS_M = 40;
    const MATCH_LABELS = { exact: 'Mismo nombre', similar: 'Nombre parecido', instagram: 'Mismo Instagram' };
    let currentStep = 1, existingSession = null, busy = true, resultMode = false, locationId = 0;
    let completedStudio = null, mediaTouched = false, previewUrls = [];
    let confirmationEmail = '', mediaEmail = '', mediaSaving = Promise.resolve();
    // Coincidencias del paso 1 (nombre) y del paso 2 (Instagram).
    let matchState = { key: '', matches: [], decision: null };
    let igState = { key: '', matches: [], acknowledged: false };
    let claimTarget = null;
    let previewBuilt = false;
    const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const value = id => $(id).value.trim();
    const url = path => (window.WeOtziStudioAuth ? window.WeOtziStudioAuth.appUrl(path) : base + path);
    const studiosRepo = () => window.WeotziData?.Studios || null;

    // ------------------------------------------------------------------
    // Helpers puros (tests/studio-register-revision.test.js)
    // ------------------------------------------------------------------
    // Igual que private.studio_name_key: sin acentos, minúsculas, espacios simples.
    function normName(raw) {
        return String(raw == null ? '' : raw).normalize('NFD').replace(/[̀-ͯ]/g, '')
            .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    }
    const STOPWORDS = new Set(['estudio', 'studio', 'studios', 'estudios', 'tattoo', 'tattoos', 'tatuaje', 'tatuajes', 'the', 'de', 'del', 'la', 'el', 'los', 'las', 'and', 'co']);
    function nameTokens(raw) {
        return [...new Set(normName(raw).split(' ').filter(t => t.length > 1 && !STOPWORDS.has(t)))].sort();
    }
    // Igual que private.studio_name_match: 'exact' | 'similar' | null.
    function nameMatchKind(a, b) {
        const ka = normName(a), kb = normName(b);
        if (!ka || !kb) return null;
        if (ka === kb) return 'exact';
        const ta = nameTokens(a), tb = nameTokens(b);
        if (ta.length && tb.length) {
            const inter = ta.filter(t => tb.includes(t)).length;
            if (inter > 0 && inter / Math.min(ta.length, tb.length) >= 0.6) return 'similar';
        }
        const ca = ka.replace(/ /g, ''), cb = kb.replace(/ /g, '');
        if (Math.min(ca.length, cb.length) >= 5 && (ca.includes(cb) || cb.includes(ca))) return 'similar';
        return null;
    }
    function distanceMeters(lat1, lng1, lat2, lng2) {
        if (![lat1, lng1, lat2, lng2].every(n => typeof n === 'number' && Number.isFinite(n))) return null;
        const rad = d => d * Math.PI / 180;
        const x = rad(lng2 - lng1) * Math.cos(rad((lat1 + lat2) / 2));
        const y = rad(lat2 - lat1);
        return 6371000 * Math.sqrt(x * x + y * y);
    }
    // Igual que private.studio_street_key: "Gorriti 4800, Palermo" → "gorriti 4800" (sin número → null).
    function streetKey(address) {
        const k = normName(String(address == null ? '' : address).split(',')[0]);
        return /[0-9]/.test(k) && k.length >= 4 ? k : null;
    }
    // Igual que private.studio_address_conflict: a menos de 40 m, mismo texto, o
    // misma calle y número a menos de 1 km (o en la misma ciudad sin coordenadas).
    function addressConflict(addr, loc) {
        const num = v => (v === null || v === undefined || v === '' ? NaN : Number(v));
        const dist = distanceMeters(num(addr.latitude), num(addr.longitude), num(loc.latitude), num(loc.longitude));
        if (dist != null && dist < ADDRESS_RADIUS_M) return true;
        if (addr.formatted_address && loc.formatted_address && normName(addr.formatted_address) === normName(loc.formatted_address)) return true;
        const street = streetKey(addr.formatted_address);
        if (street && street === streetKey(loc.formatted_address)) {
            if (dist != null) return dist < 1000;
            return !!normName(addr.city) && normName(addr.city) === normName(loc.city);
        }
        return false;
    }
    // Primera sede que comparte dirección con un estudio coincidente (o null).
    function locationConflicts(entries, matches) {
        for (const entry of entries || []) {
            const addr = entry.address || {};
            for (const match of matches || []) {
                for (const loc of match.locations || []) {
                    if (addressConflict(addr, loc)) return { entry, match, location: loc };
                }
            }
        }
        return null;
    }
    function safeUrl(raw) {
        const s = String(raw == null ? '' : raw).trim();
        return /^https?:\/\/[^\s/?#]+[^\s]*$/i.test(s) ? s : null;
    }
    function placeOf(row) { return [row?.city, row?.country].filter(Boolean).join(' · '); }
    function matchCardHtml(match) {
        const logo = safeUrl(match.logo_image);
        const name = match.name || 'Estudio';
        const addresses = (match.locations || []).map(l => l.formatted_address).filter(Boolean).slice(0, 2);
        const badges = [MATCH_LABELS[match.match] || 'Coincidencia', match.verified ? 'Verificado' : '', match.owned ? 'Con cuenta en We Ötzi' : 'Ficha sin dueño'].filter(Boolean);
        const target = match.slug || match.id;
        const actions = (match.owned
            ? '<a class="wo-btn wo-btn--secondary" href="' + esc(url('/studio/login/')) + '">Iniciar sesión</a>'
            : '<button type="button" class="wo-btn wo-btn--secondary" data-match-action="claim" data-id="' + esc(match.id) + '">Reclamar este estudio</button>')
            + '<button type="button" class="wo-btn wo-btn--secondary" data-match-action="branch" data-id="' + esc(match.id) + '">Registrar una sede</button>'
            + (target ? '<a class="sr-link-btn" href="' + esc(url('/studio/profile/?studio=') + encodeURIComponent(target)) + '" target="_blank" rel="noopener">Ver perfil ↗</a>' : '');
        return '<li class="sr-match-card">'
            + '<span class="sr-match-logo" aria-hidden="true">' + (logo ? '<img src="' + esc(logo) + '" alt="" loading="lazy">' : esc(name.trim().charAt(0) || '·')) + '</span>'
            + '<div class="sr-match-body"><strong>' + esc(name) + '</strong>'
            + (placeOf(match) ? '<small>' + esc(placeOf(match)) + '</small>' : '')
            + '<span class="sr-match-badges">' + badges.map(b => '<span class="sr-badge">' + esc(b) + '</span>').join('') + '</span>'
            + (addresses.length ? '<small class="sr-match-addresses">' + addresses.map(esc).join('<br>') + '</small>' : '')
            + '<div class="sr-match-actions">' + actions + '</div></div></li>';
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
    window.WeOtziStudioRegister = { normName, nameTokens, nameMatchKind, distanceMeters, streetKey, addressConflict, locationConflicts, matchCardHtml, rejectedClaimNotice };

    document.addEventListener('DOMContentLoaded', init);
    async function init() {
        let initialized = false;
        wireEvents();
        bootPickers();
        bootMedia();
        restoreDraft();
        if (!locations.length) addLocation();
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
                restoreMetadataDraft(existingSession.user.user_metadata?.studio_registration);
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
            if (typeof window.WeOtziStudioAuth.whenChecked === 'function') applyAuthState(await window.WeOtziStudioAuth.whenChecked());
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
        // Un solo cargador: geocoder.js ya inyecta la API para el buscador de
        // direcciones. Un segundo <script> rompía el loader de Google
        // ("Loader.provide not called by module 'map'").
        if (window.WeOtziGeocoder && typeof window.WeOtziGeocoder.ensureGoogleMapsLoaded === 'function') {
            window.WeOtziGeocoder.ensureGoogleMapsLoaded({ libraries: ['places'] }).catch(() => {});
            return;
        }
        const key = window.CONFIG?.googleMaps?.apiKey;
        if (!key || window.google?.maps?.places || document.querySelector('[data-studio-maps], script[src*="maps.googleapis.com/maps/api/js"]')) return;
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
        $('wizard-next').textContent = claimTarget ? 'Enviar reclamo' : currentStep === 5 ? 'Crear estudio' : 'Continuar';
        $('wizard-prev').hidden = currentStep === 1 && !claimTarget;
        $('wizard-prev').textContent = claimTarget ? 'Volver al registro' : 'Atrás';
        $('login-link').hidden = currentStep !== 1 || !!claimTarget;
        $('import-instagram').hidden = currentStep !== 2;
        $('add-location-btn').hidden = currentStep !== 3;
        document.querySelectorAll('.sr-review-action').forEach(button => { button.hidden = currentStep !== 5; });
        $('mobile-help').hidden = currentStep !== 1;
        $('identity-title').textContent = value('reg-name') ? 'La identidad de ' + value('reg-name') : 'La identidad de tu estudio';
        if (currentStep === 3) renderLocationsNote();
        if (currentStep === 5) { renderPreview(); renderSummary(); }
        if (focus) { $('step-title').focus(); $('registration-main').scrollIntoView({ block: 'start' }); }
        saveDraft();
    }
    async function goStep(want) {
        if (busy || resultMode || want < 1 || want > 5) return;
        if (claimTarget) closeClaimPanel(false);
        if (want > currentStep) {
            for (let step = 1; step < want; step++) {
                if (!validateStep(step)) { currentStep = step; renderStep(); return; }
            }
            if (currentStep === 1 && !(await resolveMatches())) return;
        }
        clearStatus(); currentStep = want; renderStep();
    }
    function setBusyButton(text) {
        const next = $('wizard-next');
        if (text) { next.disabled = true; next.dataset.label = next.textContent; next.textContent = text; }
        else { next.disabled = false; if (next.dataset.label) next.textContent = next.dataset.label; delete next.dataset.label; }
    }
    function wireEvents() {
        $('studio-register-form').addEventListener('submit', async event => {
            event.preventDefault();
            if (busy) return;
            clearStatus();
            if (claimTarget) { await submitClaim(); return; }
            if (!validateStep(currentStep)) return;
            if (currentStep === 1 && !(await resolveMatches())) return;
            if (currentStep === 2 && !(await resolveInstagram())) return;
            if (currentStep < 5) { currentStep++; renderStep(); return; }
            await submit();
        });
        $('wizard-prev').addEventListener('click', () => {
            if (claimTarget) { closeClaimPanel(); return; }
            goStep(currentStep - 1);
        });
        document.addEventListener('click', event => { const button = event.target.closest('[data-go-step]'); if (button) goStep(Number(button.dataset.goStep)); });
        $('add-location-btn').addEventListener('click', () => { if (locations.length >= 30) return showStatus('error', 'Podés registrar hasta 30 sedes.'); const entry = addLocation(); entry.row.querySelector('[data-field="label"]').focus(); saveDraft(); });
        $('studio-register-form').addEventListener('input', event => {
            event.target.removeAttribute('aria-invalid'); event.target.removeAttribute('aria-describedby');
            if (event.target.id === 'reg-instagram' && igState.key !== igKey(event.target.value)) { igState = { key: '', matches: [], acknowledged: false }; $('instagram-warning').hidden = true; }
            saveDraft();
        });
        $('reg-name').addEventListener('input', () => {
            if (matchState.key && matchState.key !== normName($('reg-name').value)) hideMatchPanel();
        });
        $('import-instagram').addEventListener('click', () => {
            window.IGImport.open({
                target: 'studio', mode: 'signup', prefillHandle: value('reg-instagram'),
                notice: 'Importar no verifica la cuenta: las publicaciones de Instagram se muestran en el perfil cuando We Ötzi confirma que la cuenta es del estudio. Después del registro te mandamos un código para enviar por mensaje directo a @weotzi.',
                checkHandle: instagramWarningFor,
                onComplete(result) {
                    const pf = result?.prefill || {};
                    if (result.handle && !value('reg-instagram')) $('reg-instagram').value = '@' + result.handle;
                    if (pf.bio && !value('reg-bio')) $('reg-bio').value = pf.bio;
                    if (pf.bio_link && !value('reg-website')) $('reg-website').value = pf.bio_link;
                    saveDraft();
                }
            });
        });
        $('match-panel').addEventListener('click', onMatchAction);
        window.addEventListener('weotzi:studio-ready', event => { if (event.detail?.id) showComplete(event.detail); });
    }
    function bootPickers() {
        const pickers = window.WeOtziStudioPickers;
        if (!pickers) return;
        pickers.yearPicker($('reg-founded'), $('founded-picker'), { triggerId: 'reg-founded-trigger', labelledBy: 'reg-founded-label', max: new Date().getFullYear() });
        pickers.languagePicker($('reg-languages'), $('languages-picker'), { inputId: 'reg-languages-input' });
    }
    function refreshPickers() {
        const pickers = window.WeOtziStudioPickers;
        if (!pickers) return;
        pickers.refreshAll($('reg-founded'));
        pickers.refreshAll($('reg-languages'));
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
            if (value('reg-founded') && (!Number.isInteger(year) || year < 1900 || year > new Date().getFullYear())) return showStatus('error', 'Revisá el año de fundación.', $('reg-founded-trigger'));
            if (value('reg-website') && !validUrl(value('reg-website'))) return showStatus('error', 'El sitio web debe tener una URL http o https válida.', $('reg-website'));
            if (value('reg-instagram') && !/^@?[A-Za-z0-9._]{1,30}$/.test(value('reg-instagram').replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/\/.*$/, ''))) return showStatus('error', 'Revisá el usuario de Instagram: solo letras, números, puntos y guiones bajos.', $('reg-instagram'));
        }
        if (step === 3) {
            for (const entry of locations) {
                const input = entry.row.querySelector('[data-field="address"]');
                if (!entry.address.formatted_address || input.value.trim() !== entry.address.formatted_address.trim()) return showStatus('error', 'Completá la dirección de cada sede y seleccionala de los resultados, o usá el ingreso manual.', input);
            }
            if (!locations.some(entry => entry.primary && entry.active)) return showStatus('error', 'Elegí una sede principal activa.');
            const conflict = locationConflicts(locations, activeMatches());
            if (conflict) {
                const label = conflict.entry.row.querySelector('[data-field="label"]').value.trim() || 'tu sede';
                return showStatus('error', 'La dirección de ' + label + ' coincide con «' + conflict.match.name + '», que ya está en We Ötzi. Si es una sede de ese estudio, sumala desde su panel; si no, revisá la dirección y el pin.', conflict.entry.row.querySelector('[data-field="address"]'));
            }
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

    // ------------------------------------------------------------------
    // Paso 1 · coincidencias con estudios ya registrados
    // ------------------------------------------------------------------
    // Estudios con los que el registro tiene que convivir (nombre e Instagram).
    function activeMatches() {
        const list = [];
        if (matchState.decision === 'continue') list.push(...matchState.matches);
        if (igState.acknowledged) list.push(...igState.matches);
        return list;
    }
    async function lookupMatches(name, instagram) {
        const repo = studiosRepo();
        if (!repo || typeof repo.findMatches !== 'function') return { data: [], unavailable: true };
        const res = await repo.findMatches(name, instagram);
        if (res?.unavailable && name && typeof repo.listUnownedStudios === 'function') {
            // Sin la migración: al menos la ficha del catálogo con el mismo nombre.
            const fallback = await repo.listUnownedStudios(name);
            const rows = (fallback?.data || []).filter(row => nameMatchKind(row?.name, name) === 'exact')
                .map(row => ({ ...row, owned: false, verified: false, match: 'exact', locations: [] }));
            return { data: rows, unavailable: true };
        }
        return res || { data: [] };
    }
    // true = seguir al paso 2; false = se mostró la advertencia.
    async function resolveMatches({ force = false } = {}) {
        const name = value('reg-name');
        const key = normName(name);
        if (!force && matchState.key === key && (matchState.decision === 'continue' || matchState.decision === 'none')) return true;
        setBusyButton('Buscando estudios parecidos…');
        let res;
        try { res = await lookupMatches(name, null); }
        catch (_) { res = { data: [], error: true }; }
        finally { setBusyButton(null); }
        // Un error de red no bloquea el registro (el servidor vuelve a revisar),
        // pero tampoco se recuerda como "sin coincidencias".
        if (res?.error) { hideMatchPanel(false); return true; }
        const matches = (res?.data || []).filter(m => m && m.id && (m.match === 'exact' || m.match === 'similar'));
        if (!matches.length) {
            matchState = { key, matches: [], decision: 'none' };
            hideMatchPanel(false);
            saveDraft();
            return true;
        }
        matchState = { key, matches, decision: null };
        renderMatchPanel();
        saveDraft();
        return false;
    }
    function renderMatchPanel(message) {
        const panel = $('match-panel');
        const exact = matchState.matches.filter(m => m.match === 'exact');
        panel.innerHTML = '<h3 id="match-title" tabindex="-1">' + (exact.length ? 'Ese estudio ya está en We Ötzi' : 'Encontramos estudios parecidos') + '</h3>'
            + '<p class="sr-help">' + esc(message || (exact.length
                ? '«' + value('reg-name') + '» coincide con un estudio registrado. Revisá si es el tuyo antes de seguir.'
                : 'Revisá si alguno es tu estudio antes de crear uno nuevo.')) + '</p>'
            + '<ul class="sr-match-list">' + matchState.matches.map(matchCardHtml).join('') + '</ul>'
            + '<div id="match-branch" class="sr-warning" hidden></div>'
            + '<div class="sr-match-options"><p class="sr-kicker">¿No es tu estudio?</p><div class="sr-actions">'
            + '<button type="button" class="wo-btn wo-btn--secondary" data-match-action="rename">Cambiar el nombre</button>'
            + '<button type="button" class="wo-btn wo-btn--secondary" data-match-action="continue" aria-expanded="false" aria-controls="match-continue">Es otro estudio: continuar</button></div></div>'
            + '<div id="match-continue" class="sr-match-continue" hidden>'
            + (exact.length ? '<div class="studio-field"><label for="match-new-name">Nombre que lo distinga</label><input class="wo-input" id="match-new-name" maxlength="160" value="' + esc(value('reg-name') + ' ') + '">'
                + '<span class="sr-help">Ya existe «' + esc(exact[0].name) + '». Sumá el barrio, la ciudad o algo propio de tu estudio.</span></div>' : '')
            + '<label class="sr-check-row"><input type="checkbox" id="match-ack"><span>Confirmo que mi estudio es otro y que ninguna de sus sedes está en la dirección de estos estudios. Sé que We Ötzi va a pedir una verificación adicional antes de marcarlo como verificado.</span></label>'
            + '<button type="button" class="wo-btn" data-match-action="confirm-continue">Confirmar y continuar</button></div>';
        panel.hidden = false;
        $('match-title').focus();
        panel.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
    function hideMatchPanel(reset = true) {
        $('match-panel').hidden = true;
        $('match-panel').innerHTML = '';
        if (reset) matchState = { key: '', matches: [], decision: null };
    }
    function onMatchAction(event) {
        const button = event.target.closest('[data-match-action]');
        if (!button) return;
        const action = button.dataset.matchAction;
        const match = matchState.matches.find(m => String(m.id) === button.dataset.id);
        if (action === 'claim' && match) openClaimPanel(match);
        else if (action === 'branch' && match) showBranchHelp(match);
        else if (action === 'rename') { hideMatchPanel(); clearStatus(); $('reg-name').focus(); $('reg-name').select(); }
        else if (action === 'continue') {
            const box = $('match-continue');
            box.hidden = false;
            button.setAttribute('aria-expanded', 'true');
            ($('match-new-name') || $('match-ack')).focus();
        } else if (action === 'confirm-continue') confirmContinue();
    }
    function showBranchHelp(match) {
        const box = $('match-branch');
        box.innerHTML = match.owned
            ? '<p><strong>Las sedes se suman desde el panel del estudio.</strong> Iniciá sesión con la cuenta de «' + esc(match.name) + '» y agregá la sede en Sedes. Si no tenés acceso, pedíselo a quien administra el estudio.</p>'
                + '<div class="sr-actions"><a class="wo-btn" href="' + esc(url('/studio/login/?next=sedes')) + '">Iniciar sesión y agregar la sede</a></div>'
            : '<p><strong>«' + esc(match.name) + '» todavía no tiene dueño en We Ötzi.</strong> Primero reclamá el estudio; cuando soporte lo apruebe vas a poder sumar la sede desde el panel.</p>'
                + '<div class="sr-actions"><button type="button" class="wo-btn" data-match-action="claim" data-id="' + esc(match.id) + '">Reclamar este estudio</button></div>';
        box.hidden = false;
        box.querySelector('a, button')?.focus();
    }
    function confirmContinue() {
        const exact = matchState.matches.filter(m => m.match === 'exact');
        const input = $('match-new-name');
        if (exact.length) {
            const next = input.value.replace(/\s+/g, ' ').trim();
            if (next.length < 2 || next.length > 160) return showStatus('error', 'Escribí un nombre de entre 2 y 160 caracteres.', input);
            if (exact.some(m => normName(m.name) === normName(next))) return showStatus('error', 'Ese nombre sigue siendo igual al de «' + exact[0].name + '». Sumale algo que lo distinga.', input);
            $('reg-name').value = next;
        }
        if (!$('match-ack').checked) return showStatus('error', 'Confirmá que tu estudio es otro y que no comparte dirección para seguir.', $('match-ack'));
        matchState = { key: normName(value('reg-name')), matches: matchState.matches.map(m => ({ ...m, match: m.match === 'exact' ? 'similar' : m.match })), decision: 'continue' };
        hideMatchPanel(false);
        clearStatus();
        currentStep = 2;
        renderStep();
        showStatus('info', 'Seguimos con tu estudio. Como hay estudios parecidos, después del registro vas a enviar información para verificarlo.');
    }

    // Reclamo de una ficha sin dueño (WeOtziStudioAuth.claim).
    function openClaimPanel(studio) {
        claimTarget = studio;
        clearStatus();
        $('match-panel').hidden = true;
        $('claim-selected').innerHTML = '<ul class="sr-match-list">' + matchCardHtml({ ...studio, owned: false }).replace(/<div class="sr-match-actions">[\s\S]*?<\/div><\/div><\/li>$/, '</div></li>') + '</ul>';
        $('claim-account-note').textContent = existingSession
            ? 'Vas a reclamarlo con tu cuenta ' + (existingSession.user.email || 'actual') + '.'
            : 'Usamos el email y la contraseña de arriba para crear tu acceso. Te vamos a pedir confirmar el correo.';
        $('claim-panel').hidden = false;
        renderStep(false);
        $('claim-panel-title').focus();
    }
    function closeClaimPanel(render = true) {
        claimTarget = null;
        $('claim-panel').hidden = true;
        if (matchState.matches.length) $('match-panel').hidden = false;
        if (render) { clearStatus(); renderStep(false); }
    }
    async function submitClaim() {
        const studio = claimTarget;
        const evidence = value('claim-evidence');
        if (evidence.length < 10) return showStatus('error', 'Contanos con un poco más de detalle cómo verificamos que el estudio es tuyo (mínimo 10 caracteres).', $('claim-evidence'));
        if (evidence.length > 1000) return showStatus('error', 'La evidencia admite hasta 1000 caracteres.', $('claim-evidence'));
        if (!existingSession && !validateStep(1)) return;
        busy = true;
        setBusyButton('Enviando reclamo…');
        $('wizard-prev').disabled = true;
        try {
            const result = await window.WeOtziStudioAuth.claim({
                studioId: studio.id, studio, evidence,
                contactName: value('claim-contact-name'), contactPhone: value('claim-contact-phone'),
                email: existingSession ? null : value('reg-email'), password: existingSession ? null : $('reg-password').value
            });
            if (result?.confirmationRequired) {
                showStatus('success', 'Revisá ' + result.email + ' y confirmá tu correo. Al abrir el enlace enviamos tu reclamo de ' + (studio.name || 'tu estudio') + ' a revisión.');
                $('wizard-next').textContent = 'Esperando confirmación del correo';
                return;
            }
            window.WeOtziStudioAuth.presentState(result);
        } catch (err) {
            const msg = String(err?.message || err);
            setBusyButton(null);
            showStatus('error', /already|registered/i.test(msg) ? 'Ya existe una cuenta con ese email. Iniciá sesión y volvé a reclamar el estudio.' : 'No pudimos enviar el reclamo: ' + msg);
        } finally {
            busy = false;
            $('wizard-prev').disabled = false;
        }
    }
    function applyAuthState(state) {
        if (!state) return;
        if (state.kind === 'claimable') {
            if (!value('reg-name')) $('reg-name').value = state.name || '';
            currentStep = 1; renderStep();
            matchState = { key: '', matches: [], decision: null };
            resolveMatches({ force: true }).then(() => showStatus('error', '«' + (state.name || 'Ese estudio') + '» ya figura en We Ötzi, así que no pudimos crear el estudio. Si es tuyo, reclamalo; si no, cambiá el nombre.'));
        } else if (state.kind === 'registration_conflict') {
            if (state.code === '23P01') { currentStep = 3; renderStep(); showStatus('error', state.error); }
            else { currentStep = 1; renderStep(); resolveMatches({ force: true }).then(() => showStatus('error', state.error)); }
        } else if (state.kind === 'claim_rejected') {
            showStatus('info', rejectedClaimNotice(state.claim));
        } else if (state.kind === 'claim_failed') {
            showStatus('error', 'No pudimos enviar tu reclamo: ' + (state.error || 'el estudio ya no se puede reclamar.') + ' Podés registrar un estudio nuevo.');
        }
    }

    // ------------------------------------------------------------------
    // Paso 2 · Instagram ya vinculado a otro estudio
    // ------------------------------------------------------------------
    function igKey(raw) {
        return String(raw == null ? '' : raw).trim().toLowerCase().replace(/^(https?:\/\/)?(www\.)?instagram\.com\//, '').replace(/^@+/, '').replace(/[/?#].*$/, '');
    }
    async function instagramMatches(handle) {
        const res = await lookupMatches(null, '@' + igKey(handle));
        if (res?.error) throw res.error;
        return (res?.data || []).filter(m => m.match === 'instagram');
    }
    function instagramMessage(handle, matches) {
        const names = matches.map(m => '«' + m.name + '»' + (placeOf(m) ? ' (' + placeOf(m) + ')' : '')).join(', ');
        return '@' + igKey(handle) + ' ya figura como el Instagram de ' + names + ' en We Ötzi. Si la cuenta es de tu estudio podés seguir: vamos a pedir verificarla antes de publicar sus fotos.';
    }
    // checkHandle del import de Instagram.
    async function instagramWarningFor(handle) {
        const matches = await instagramMatches(handle).catch(() => []);
        return matches.length ? instagramMessage(handle, matches) : null;
    }
    async function resolveInstagram() {
        const handle = value('reg-instagram');
        const key = igKey(handle);
        if (!key) { igState = { key: '', matches: [], acknowledged: false }; return true; }
        if (igState.key === key && (igState.acknowledged || !igState.matches.length)) return true;
        if (igState.key === key && igState.matches.length) {
            if ($('instagram-ack')?.checked) { igState.acknowledged = true; $('instagram-warning').hidden = true; saveDraft(); return true; }
            // Borrador restaurado: la advertencia pendiente se vuelve a mostrar.
            if (!$('instagram-ack') || $('instagram-warning').hidden) { renderInstagramWarning(handle, igState.matches); return false; }
            return showStatus('error', 'Confirmá que la cuenta de Instagram es de tu estudio o corregí el usuario.', $('instagram-ack'));
        }
        setBusyButton('Revisando Instagram…');
        let matches = null;
        try { matches = await instagramMatches(handle); } catch (_) { matches = null; } finally { setBusyButton(null); }
        if (!matches) { igState = { key: '', matches: [], acknowledged: false }; return true; }
        igState = { key, matches, acknowledged: false };
        if (!matches.length) { $('instagram-warning').hidden = true; saveDraft(); return true; }
        renderInstagramWarning(handle, matches);
        saveDraft();
        return false;
    }
    function renderInstagramWarning(handle, matches) {
        const box = $('instagram-warning');
        box.innerHTML = '<p>' + esc(instagramMessage(handle, matches)) + '</p>'
            + '<label class="sr-check-row"><input type="checkbox" id="instagram-ack"><span>Es la cuenta de mi estudio. Entiendo que We Ötzi va a pedir verificarla.</span></label>';
        box.hidden = false;
        $('instagram-ack').focus();
    }

    // ------------------------------------------------------------------
    // Paso 3 · sedes con pin en el mapa
    // ------------------------------------------------------------------
    function renderLocationsNote() {
        const list = activeMatches();
        const box = $('locations-match-note');
        const rows = list.flatMap(m => (m.locations || []).filter(l => l.formatted_address).slice(0, 3).map(l => '<li><strong>' + esc(m.name) + '</strong> · ' + esc(l.formatted_address) + '</li>'));
        box.hidden = !rows.length;
        box.innerHTML = rows.length ? '<p>Tus sedes no pueden estar en la dirección de estos estudios:</p><ul>' + rows.join('') + '</ul>' : '';
    }
    function addLocation(saved = {}) {
        const id = ++locationId;
        const entry = { row: document.createElement('article'), address: saved.address || {}, primary: saved.primary ?? locations.length === 0, active: saved.active ?? true, picker: null, map: null };
        const label = (field, title, placeholder = '') => '<div class="studio-field"><label for="location-' + id + '-' + field + '">' + title + '</label><input class="wo-input" id="location-' + id + '-' + field + '" data-field="' + field + '" placeholder="' + placeholder + '" maxlength="200"></div>';
        entry.row.className = 'sr-location';
        entry.row.innerHTML = '<div class="sr-location-head"><strong>Sede</strong><button type="button" class="wo-btn wo-btn--secondary" data-remove>Quitar sede</button></div><div class="sr-grid">' +
            label('label', 'Etiqueta de la sede', 'Sede principal') + label('address', 'Dirección', 'Buscá la dirección…') +
            '<div class="studio-field"><label>País / provincia / ciudad / localidad</label><div class="sr-address-details" data-region>Seleccioná una dirección</div></div>' +
            '<div class="studio-field"><label>Calle / número / unidad / código postal</label><div class="sr-address-details" data-street>Seleccioná una dirección</div></div>' +
            '<div class="studio-field sr-full"><label id="location-' + id + '-pin-label">Pin en el mapa</label><div class="sr-map" data-map role="application" aria-labelledby="location-' + id + '-pin-label" aria-describedby="location-' + id + '-pin-help" hidden></div><div class="sr-address-details" data-pin id="location-' + id + '-pin-help">Comprobá la ubicación</div></div>' +
            '<label class="sr-switch"><input type="checkbox" data-primary role="switch">Sede principal</label><label class="sr-switch sr-full"><input type="checkbox" data-active role="switch">Sede activa</label></div>' +
            '<details class="sr-address-manual"><summary>Ingresar dirección manualmente</summary><p class="sr-help">Si el buscador no está disponible, completá la dirección de arriba, ciudad y país. Si el mapa está disponible, el pin se ubica solo y podés ajustarlo.</p><div class="sr-grid">' +
            label('country', 'País') + label('state_province', 'Provincia / estado') + label('city', 'Ciudad') + label('locality', 'Localidad / barrio') + label('street', 'Calle') + label('street_number', 'Número') + label('unit', 'Unidad / piso') + label('postal_code', 'Código postal') +
            '</div><button type="button" class="wo-btn wo-btn--secondary" data-manual>Usar esta dirección</button></details>';
        $('locations-list').appendChild(entry.row);
        locations.push(entry);
        const field = name => entry.row.querySelector('[data-field="' + name + '"]');
        field('label').value = saved.label || (entry.primary ? 'Sede principal' : '');
        field('address').value = entry.address.formatted_address || '';
        field('address').autocomplete = 'off';
        for (const name of ['country', 'state_province', 'city', 'locality', 'street', 'street_number', 'unit', 'postal_code']) field(name).value = entry.address[name] || '';
        entry.row.querySelector('[data-manual]').addEventListener('click', async () => {
            if (!field('address').value.trim()) return showStatus('error', 'Completá la dirección de la sede.', field('address'));
            for (const name of ['city', 'country']) if (!field(name).value.trim()) return showStatus('error', 'Para ingresar una sede manualmente completá dirección, ciudad y país.', field(name));
            entry.address = { formatted_address: field('address').value.trim(), latitude: null, longitude: null };
            for (const name of ['country', 'state_province', 'city', 'locality', 'street', 'street_number', 'unit', 'postal_code']) entry.address[name] = field(name).value.trim() || null;
            renderAddress(entry); clearStatus(); saveDraft();
            // Con mapa: ubicamos el pin en esa dirección (se puede ajustar arrastrándolo).
            const found = entry.map && await entry.map.locate([entry.address.formatted_address, entry.address.city, entry.address.country].filter(Boolean).join(', '));
            if (found && Number.isFinite(found.latitude)) {
                entry.address.latitude = found.latitude; entry.address.longitude = found.longitude;
                renderAddress(entry); saveDraft();
            }
        });
        entry.row.querySelector('[data-remove]').addEventListener('click', () => {
            if (locations.length === 1 || busy) return;
            entry.picker?.detach?.(); entry.map?.destroy?.(); entry.row.remove(); locations.splice(locations.indexOf(entry), 1);
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
            if (entry.map && Number.isFinite(entry.address.latitude)) entry.map.setPosition(entry.address.latitude, entry.address.longitude);
        } });
        if (window.WeOtziLocationMap) {
            entry.map = window.WeOtziLocationMap.attach(entry.row.querySelector('[data-map]'), {
                latitude: Number.isFinite(entry.address.latitude) ? entry.address.latitude : undefined,
                longitude: Number.isFinite(entry.address.longitude) ? entry.address.longitude : undefined,
                timeoutMs: 30000,
                pinTitle: 'Arrastrá el pin hasta la puerta del estudio',
                onPending() { entry.row.querySelector('[data-pin]').textContent = 'Buscando la dirección del pin en Google Maps…'; },
                onError() { showStatus('error', 'No pudimos traer la dirección de ese punto. Probá moverlo un poco o buscala arriba.'); },
                onPick(address) {
                    // El pin manda: coordenadas exactas; la dirección viene de Google Maps.
                    entry.address = { ...entry.address, ...address };
                    if (address.formatted_address) field('address').value = address.formatted_address;
                    else entry.address.formatted_address = field('address').value.trim() || entry.address.formatted_address;
                    field('address').removeAttribute('aria-invalid');
                    renderAddress(entry); clearStatus(); saveDraft();
                }
            });
            entry.map.ready.then(ok => renderAddress(entry, ok));
        }
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
    function renderAddress(entry, mapReady = entry.map?.isReady) {
        const addr = entry.address;
        entry.row.querySelector('[data-region]').textContent = [addr.country, addr.state_province, addr.city, addr.locality].filter((part, i, all) => part && all.indexOf(part) === i).join(' · ') || 'Seleccioná una dirección';
        entry.row.querySelector('[data-street]').textContent = [addr.street, addr.street_number, addr.unit, addr.postal_code].filter(Boolean).join(' · ') || addr.formatted_address || 'Seleccioná una dirección';
        const pin = entry.row.querySelector('[data-pin]');
        const located = Number.isFinite(addr.latitude) && Number.isFinite(addr.longitude);
        const link = located ? ' <a class="sr-map-link" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&amp;query=' + encodeURIComponent(addr.latitude + ',' + addr.longitude) + '">Abrir en Google Maps ↗</a>' : '';
        if (mapReady) pin.innerHTML = (located ? 'Pin ubicado. Arrastralo o tocá el mapa si la puerta del estudio está en otro punto.' : 'Tocá el mapa o buscá la dirección para ubicar el pin.') + link;
        else if (located) pin.innerHTML = '<a class="sr-map-link" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&amp;query=' + encodeURIComponent(addr.latitude + ',' + addr.longitude) + '">Comprobar ubicación en el mapa ↗</a>';
        else pin.textContent = addr.formatted_address ? 'Dirección manual · pin pendiente' : 'Comprobá la ubicación';
    }

    // ------------------------------------------------------------------
    // Paso 4 · imágenes
    // ------------------------------------------------------------------
    function bootMedia() {
        const names = { cover: 'Imagen de portada', logo: 'Logo', gallery: 'Galería del estudio' };
        $('media-fields').innerHTML = Object.entries(names).map(([key, title]) => '<div class="sr-media-field"><label class="sr-media-label" for="file-' + key + '">' + title + '</label><div class="sr-media-box"><strong id="media-name-' + key + '">Sin archivos seleccionados</strong><p>JPG, PNG o WebP · hasta 5 MB por imagen.' + (key === 'gallery' ? ' Hasta 8 fotos; podés cambiar el orden.' : ' Revisá la imagen antes de continuar.') + '</p><div class="sr-media-previews" id="media-preview-' + key + '"></div><input class="sr-file-input" type="file" id="file-' + key + '" accept="image/jpeg,image/png,image/webp"' + (key === 'gallery' ? ' multiple' : '') + '><button type="button" class="wo-btn wo-btn--secondary" data-pick="' + key + '">Elegir archivo</button></div></div>').join('');
        document.querySelectorAll('[data-pick]').forEach(button => button.addEventListener('click', () => $('file-' + button.dataset.pick).click()));
        Object.keys(names).forEach(key => $('file-' + key).addEventListener('change', event => {
            const selected = [...(event.target.files || [])];
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
                const src = objectUrl(file);
                const card = document.createElement('div'); card.className = 'sr-media-card';
                card.innerHTML = '<img src="' + src + '" alt="' + esc(file.name) + '"><button type="button" data-delete aria-label="Quitar ' + esc(file.name) + '">Quitar</button>' + (key === 'gallery' && index > 0 ? '<button type="button" data-up aria-label="Mover ' + esc(file.name) + ' antes">← Antes</button>' : '');
                card.querySelector('[data-delete]').addEventListener('click', () => { if (key === 'gallery') files.gallery.splice(index, 1); else files[key] = null; mediaTouched = true; renderMedia(); persistMedia(); });
                card.querySelector('[data-up]')?.addEventListener('click', () => { [files.gallery[index - 1], files.gallery[index]] = [files.gallery[index], files.gallery[index - 1]]; mediaTouched = true; renderMedia(); persistMedia(); });
                previews.appendChild(card);
            });
        }
        if (currentStep === 5 && !resultMode) renderPreview();
    }
    const fileUrls = new WeakMap();
    function objectUrl(file) {
        if (!fileUrls.has(file)) { const src = URL.createObjectURL(file); fileUrls.set(file, src); previewUrls.push(src); }
        return fileUrls.get(file);
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

    // ------------------------------------------------------------------
    // Paso 5 · vista previa editable
    // ------------------------------------------------------------------
    const EDITABLE = [
        { bind: 'reg-name', label: 'Nombre del estudio', max: 160, required: true },
        { bind: 'reg-tagline', label: 'Tagline', max: 120, placeholder: 'Sumá una frase corta' },
        { bind: 'reg-bio', label: 'Descripción del estudio', max: 2000, multiline: true, placeholder: 'Contá la historia del estudio, su estilo y cómo trabajan.' },
        { bind: 'reg-instagram', label: 'Instagram', max: 100, placeholder: '@tustudio' },
        { bind: 'reg-website', label: 'Sitio web', max: 2000, placeholder: 'https://tustudio.com', url: true },
        { bind: 'reg-whatsapp', label: 'WhatsApp', max: 40, placeholder: '+54 · Teléfono' }
    ];
    // Firefox viejo no soporta plaintext-only: cae a "true" (el pegado ya se limpia a texto).
    const CE_MODE = (() => {
        try { const probe = document.createElement('div'); probe.contentEditable = 'plaintext-only'; return probe.contentEditable === 'plaintext-only' ? 'plaintext-only' : 'true'; }
        catch (_) { return 'true'; }
    })();
    function editable(bind, tag, cls) {
        const def = EDITABLE.find(d => d.bind === bind);
        return '<' + tag + ' class="sr-editable ' + (cls || '') + '" contenteditable="' + CE_MODE + '" role="textbox" tabindex="0" spellcheck="true"'
            + ' aria-label="' + esc(def.label) + ' (editable)"' + (def.multiline ? ' aria-multiline="true"' : '')
            + ' data-bind="' + bind + '" data-placeholder="' + esc(def.placeholder || def.label) + '"></' + tag + '>';
    }
    function buildPreview() {
        const host = $('profile-preview');
        host.innerHTML = '<article class="sr-preview" aria-label="Vista previa del perfil del estudio">'
            + '<div class="sr-preview-cover" data-preview-cover><button type="button" class="sr-preview-media-btn" data-pick-media="cover">Cambiar portada</button></div>'
            + '<div class="sr-preview-identity"><div class="sr-preview-logo" data-preview-logo><button type="button" class="sr-preview-logo-btn" data-pick-media="logo" aria-label="Cambiar logo">✎</button></div>'
            + '<div class="sr-preview-heading">' + editable('reg-name', 'h3', 'sr-preview-name') + editable('reg-tagline', 'p', 'sr-preview-tagline')
            + '<p class="sr-preview-verification" data-preview-verification></p></div></div>'
            + '<dl class="sr-preview-facts">'
            + '<div><dt id="preview-founded-label">Fundado en</dt><dd><div data-preview-year></div></dd></div>'
            + '<div><dt id="preview-languages-label">Idiomas</dt><dd><div data-preview-languages></div></dd></div>'
            + '<div><dt>Instagram</dt><dd>' + editable('reg-instagram', 'span') + '</dd></div>'
            + '<div><dt>Sitio web</dt><dd>' + editable('reg-website', 'span') + '</dd></div>'
            + '<div><dt>WhatsApp</dt><dd>' + editable('reg-whatsapp', 'span') + '</dd></div></dl>'
            + '<section class="sr-preview-section"><h4>Sobre el estudio</h4>' + editable('reg-bio', 'p', 'sr-preview-bio') + '</section>'
            + '<section class="sr-preview-section"><h4>Sedes</h4><ul class="sr-preview-locations" data-preview-locations></ul></section>'
            + '<section class="sr-preview-section"><h4>Galería</h4><div class="sr-preview-gallery" data-preview-gallery></div></section>'
            + '</article>';
        const pickers = window.WeOtziStudioPickers;
        if (pickers) {
            pickers.yearPicker($('reg-founded'), host.querySelector('[data-preview-year]'), { triggerId: 'preview-founded-trigger', labelledBy: 'preview-founded-label', placeholder: 'Sin año', max: new Date().getFullYear() });
            pickers.languagePicker($('reg-languages'), host.querySelector('[data-preview-languages]'), { inputId: 'preview-languages-input', labelledBy: 'preview-languages-label', placeholder: 'Sumá un idioma' });
        }
        host.addEventListener('input', onPreviewInput);
        host.addEventListener('focusout', onPreviewBlur);
        host.addEventListener('keydown', event => {
            const el = event.target.closest('.sr-editable');
            if (el && event.key === 'Enter' && el.getAttribute('aria-multiline') !== 'true') { event.preventDefault(); el.blur(); }
        });
        host.addEventListener('paste', event => {
            const el = event.target.closest('.sr-editable');
            if (!el) return;
            event.preventDefault();
            const text = (event.clipboardData || window.clipboardData).getData('text/plain');
            document.execCommand('insertText', false, el.getAttribute('aria-multiline') === 'true' ? text : text.replace(/\s*\n\s*/g, ' '));
        });
        host.addEventListener('click', event => {
            const media = event.target.closest('[data-pick-media]');
            if (media) $('file-' + media.dataset.pickMedia).click();
        });
        previewBuilt = true;
    }
    function onPreviewInput(event) {
        const el = event.target.closest('[data-bind], [data-location-label]');
        if (!el) return;
        const text = el.textContent.replace(/ /g, ' ');
        if (el.dataset.locationLabel != null) {
            const entry = locations[Number(el.dataset.locationLabel)];
            if (entry) entry.row.querySelector('[data-field="label"]').value = text.trim().slice(0, 200);
        } else {
            const def = EDITABLE.find(d => d.bind === el.dataset.bind);
            $(el.dataset.bind).value = (def?.multiline ? text : text.replace(/\s+/g, ' ')).slice(0, def?.max || 200);
            if (el.dataset.bind === 'reg-name' && matchState.key !== normName($('reg-name').value)) matchState.decision = matchState.decision === 'none' ? null : matchState.decision;
        }
        el.removeAttribute('aria-invalid');
        renderSummary();
        saveDraft();
    }
    function onPreviewBlur(event) {
        const el = event.target.closest('[data-bind]');
        if (!el) return;
        const def = EDITABLE.find(d => d.bind === el.dataset.bind);
        const raw = value(el.dataset.bind);
        if (def?.required && (raw.length < 2 || raw.length > 160)) { el.setAttribute('aria-invalid', 'true'); showStatus('error', 'El nombre del estudio debe tener entre 2 y 160 caracteres.'); return; }
        if (def?.url && raw && !validUrl(raw)) { el.setAttribute('aria-invalid', 'true'); showStatus('error', 'El sitio web debe tener una URL http o https válida.'); return; }
        // Normaliza espacios y vuelve a pintar el texto limpio.
        if (el.textContent !== raw) el.textContent = raw;
    }
    function setEditableText(el, text) {
        if (document.activeElement === el) return; // no pisar lo que se está escribiendo
        el.textContent = text;
    }
    function renderPreview() {
        if (!previewBuilt) buildPreview();
        const host = $('profile-preview');
        host.querySelectorAll('[data-bind]').forEach(el => setEditableText(el, $(el.dataset.bind).value));
        const cover = host.querySelector('[data-preview-cover]');
        const coverSrc = files.cover ? objectUrl(files.cover) : safeUrl(value('reg-cover'));
        cover.style.backgroundImage = coverSrc ? 'url("' + coverSrc.replace(/"/g, '%22') + '")' : '';
        cover.classList.toggle('is-empty', !coverSrc);
        const logo = host.querySelector('[data-preview-logo]');
        const logoSrc = files.logo ? objectUrl(files.logo) : safeUrl(value('reg-logo'));
        logo.querySelector('img')?.remove();
        logo.querySelector('.sr-preview-initial')?.remove();
        logo.insertAdjacentHTML('afterbegin', logoSrc ? '<img src="' + esc(logoSrc) + '" alt="Logo">' : '<span class="sr-preview-initial" aria-hidden="true">' + esc((value('reg-name').charAt(0) || '·').toUpperCase()) + '</span>');
        host.querySelector('[data-preview-verification]').textContent = activeMatches().length
            ? 'Verificación adicional pendiente · encontramos estudios parecidos'
            : 'Sin verificar · podés pedir el sello desde el panel';
        host.querySelector('[data-preview-locations]').innerHTML = locations.map((entry, i) => {
            const labelText = entry.row.querySelector('[data-field="label"]').value.trim() || 'Sede';
            return '<li><strong class="sr-editable" contenteditable="' + CE_MODE + '" role="textbox" tabindex="0" aria-label="Nombre de la sede ' + (i + 1) + ' (editable)" data-placeholder="Sede" data-location-label="' + i + '">' + esc(labelText) + '</strong>'
                + '<span>' + esc(entry.address.formatted_address || 'Sin dirección') + '</span>'
                + '<span class="sr-preview-tags">' + (entry.primary ? '<span class="sr-badge">Principal</span>' : '') + (entry.active ? '' : '<span class="sr-badge">Inactiva</span>') + '</span></li>';
        }).join('') + '<li class="sr-preview-more"><button type="button" class="sr-link-btn" data-go-step="3">Editar sedes y pines</button></li>';
        const gallery = files.gallery.map(file => objectUrl(file)).concat(parsePhotos().map(safeUrl).filter(Boolean)).slice(0, 8);
        host.querySelector('[data-preview-gallery]').innerHTML = gallery.length
            ? gallery.map((src, i) => '<img src="' + esc(src) + '" alt="Foto ' + (i + 1) + ' de la galería" loading="lazy">').join('')
            : '<p class="sr-help">Todavía no sumaste fotos. <button type="button" class="sr-link-btn" data-go-step="4">Agregar fotos</button></p>';
        refreshPickers();
    }
    function renderSummary() {
        const verification = activeMatches().length
            ? ['Verificación adicional', 'Encontramos estudios parecidos. Después del registro vas a enviar información para que soporte verifique tu estudio. Mientras tanto el perfil se publica sin el sello de verificado.']
            : ['Verificación', 'Después del registro podés pedir el sello de estudio verificado desde el panel.'];
        $('confirm-summary').innerHTML = summaryRows([
            ['Cuenta de acceso', value('reg-email')],
            verification,
            ['Imágenes', [files.cover ? files.cover.name : value('reg-cover') ? 'Portada por enlace' : 'Sin portada', files.logo ? files.logo.name : value('reg-logo') ? 'Logo por enlace' : 'Sin logo', (files.gallery.length + parsePhotos().length) + ' fotos de galería'].join(' · ')]
        ]);
    }

    // ------------------------------------------------------------------
    // Borrador
    // ------------------------------------------------------------------
    function saveDraft() {
        if (resultMode) return;
        try {
            sessionStorage.setItem(draftKey, JSON.stringify({
                step: currentStep, confirmationEmail,
                fields: Object.fromEntries(textFields.map(id => [id, $(id).value])),
                locations: locations.map(entry => ({ address: entry.address, primary: entry.primary, active: entry.active, label: entry.row.querySelector('[data-field="label"]').value })),
                matchState, igState
            }));
        } catch (_) { /* Registration remains available when browser storage is blocked. */ }
    }
    function restoreDraft() {
        try {
            const draft = JSON.parse(sessionStorage.getItem(draftKey) || 'null');
            if (!draft) return;
            confirmationEmail = typeof draft.confirmationEmail === 'string' ? draft.confirmationEmail : '';
            for (const id of textFields) if (typeof draft.fields?.[id] === 'string') $(id).value = draft.fields[id];
            (draft.locations || []).slice(0, 30).forEach(addLocation);
            if (draft.matchState && Array.isArray(draft.matchState.matches)) matchState = { key: String(draft.matchState.key || ''), matches: draft.matchState.matches.slice(0, 8), decision: ['continue', 'none'].includes(draft.matchState.decision) ? draft.matchState.decision : null };
            if (draft.igState && Array.isArray(draft.igState.matches)) igState = { key: String(draft.igState.key || ''), matches: draft.igState.matches.slice(0, 8), acknowledged: !!draft.igState.acknowledged };
            refreshPickers();
            // Passwords are intentionally never persisted; account step is revalidated.
            currentStep = 1;
        } catch (_) { /* Ignore an obsolete or unavailable local draft. */ }
    }
    // Cuenta confirmada en otro dispositivo: el borrador vive en user_metadata.
    function restoreMetadataDraft(draft) {
        if (!draft?.profile || value('reg-name')) return;
        const p = draft.profile;
        const set = (id, v) => { if (v != null && v !== '') $(id).value = String(v); };
        set('reg-name', p.name); set('reg-tagline', p.tagline); set('reg-bio', p.bio); set('reg-founded', p.founded_year);
        set('reg-languages', Array.isArray(p.languages) ? p.languages.join(', ') : ''); set('reg-instagram', p.instagram);
        set('reg-website', p.website); set('reg-whatsapp', p.whatsapp); set('reg-cover', p.cover_image); set('reg-logo', p.logo_image);
        if (Array.isArray(p.photo_feed_items)) set('reg-photos', p.photo_feed_items.map(item => item?.url).filter(Boolean).join('\n'));
        if (Array.isArray(draft.locations) && draft.locations.length) {
            locations.splice(0).forEach(entry => { entry.picker?.detach?.(); entry.map?.destroy?.(); entry.row.remove(); });
            draft.locations.slice(0, 30).forEach(loc => {
                const { label, is_primary: primary, is_active: active, ...address } = loc || {};
                addLocation({ label, primary: !!primary, active: active !== false, address });
            });
            if (!locations.some(entry => entry.primary)) locations[0].primary = true;
            refreshLocations();
        }
        refreshPickers();
        saveDraft();
    }

    // ------------------------------------------------------------------
    // Envío
    // ------------------------------------------------------------------
    async function submit() {
        for (let step = 1; step < 5; step++) if (!validateStep(step)) { currentStep = step; renderStep(); return; }
        // El nombre pudo cambiar en la vista previa: se vuelve a revisar.
        if (!(await resolveMatches())) { currentStep = 1; renderStep(); renderMatchPanel(); return; }
        if (!(await resolveInstagram())) { currentStep = 2; renderStep(); $('instagram-warning').hidden = false; return; }
        busy = true; $('studio-register-form').setAttribute('aria-busy', 'true');
        $('wizard-next').disabled = true; $('wizard-next').textContent = 'Creando estudio…';
        document.querySelectorAll('#wizard-actions button,.wo-onboarding-nav button').forEach(button => { button.disabled = true; });
        try {
            await mediaSaving;
            if (mediaTouched || files.cover || files.logo || files.gallery.length) await window.WeOtziStudioMedia.stage(value('reg-email'), files);
            const profile = { name: value('reg-name'), email: value('reg-email'), password: $('reg-password').value, tagline: value('reg-tagline') || null, bio: value('reg-bio') || null, founded_year: Number(value('reg-founded')) || null, languages: (window.WeOtziStudioPickers ? window.WeOtziStudioPickers.parseLanguages(value('reg-languages')) : value('reg-languages').split(',').map(s => s.trim()).filter(Boolean)), instagram: value('reg-instagram') || null, website: value('reg-website') || null, whatsapp: value('reg-whatsapp') || null, cover_image: value('reg-cover') || null, logo_image: value('reg-logo') || null, photo_feed_items: parsePhotos().map((image, i) => ({ url: image, kind: 'image', category: 'studio', sort: i, created_at: new Date().toISOString() })), locations: [...locations].sort((a, b) => Number(b.primary) - Number(a.primary)).map(entry => ({ ...entry.address, label: entry.row.querySelector('[data-field="label"]').value.trim() || 'Sede', is_primary: entry.primary, is_active: entry.active })) };
            const studio = await window.WeOtziStudioAuth.register(profile);
            $('reg-password').value = ''; $('reg-password-confirm').value = '';
            if (studio.confirmationRequired) showConfirmation(studio.email);
            else { clearDraft(); showComplete(studio); }
        } catch (err) {
            const { data } = await window.WeOtziStudioAuth.getSupabase().auth.getSession().catch(() => ({ data: {} }));
            existingSession = data?.session || existingSession;
            const message = String(err?.message || 'Intentá nuevamente.');
            const code = String(err?.code || '');
            if (window.WeOtziStudioAuth.isClaimableError?.(err) || code === '23505') {
                currentStep = 1; renderStep();
                matchState = { key: '', matches: [], decision: null };
                await resolveMatches({ force: true });
                showStatus('error', code === '23505' ? message : '«' + value('reg-name') + '» ya figura en We Ötzi, así que no pudimos crear el estudio. Si es tuyo, reclamalo; si no, cambiá el nombre.');
            } else if (code === '23P01') {
                currentStep = 3; renderStep(); showStatus('error', message);
            } else {
                showStatus('error', /already|registered/i.test(message) ? 'Ya existe una cuenta con ese email. Iniciá sesión desde Ya tengo cuenta.' : 'No pudimos completar el registro: ' + message);
            }
        } finally {
            busy = false; $('studio-register-form').setAttribute('aria-busy', 'false');
            document.querySelectorAll('#wizard-actions button,.wo-onboarding-nav button').forEach(button => { button.disabled = false; });
            if (!resultMode) $('wizard-next').textContent = currentStep === 5 ? 'Crear estudio' : 'Continuar';
            refreshLocations();
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
        const extra = !!studio.verification_required;
        const verification = extra
            ? ['Verificación adicional', 'Encontramos estudios parecidos. Enviá la información de tu estudio para que soporte lo verifique.']
            : ['Verificación', 'Pedí el sello de estudio verificado desde el panel.'];
        result(pending ? 'Terminemos de configurar tu estudio' : 'Tu estudio ya tiene lugar en We Ötzi', '<h2>' + (pending ? 'Configuración pendiente' : 'Tus próximos pasos') + '</h2>' + summaryRows(pending ? [['Cuenta de acceso', 'Creada · ' + (studio.email || value('reg-email'))], ['Perfil del estudio', 'Nombre, identidad y sedes guardados'], ['Imágenes pendientes', studio.mediaError || 'No pudimos terminar de subir las imágenes. Tus archivos siguen guardados en este navegador.']] : [['Tu perfil', 'Nombre, identidad y sede guardados'], ['Tu equipo', 'Todavía no invitaste artistas'], verification]) + '<div class="sr-actions">' + (pending ? '<button type="button" class="wo-btn" id="retry-media">Continuar configuración</button>' : '') + '<a class="wo-btn' + (pending || extra ? ' wo-btn--secondary' : '') + '" href="' + esc(url('/studio/dashboard')) + '">Ir al panel</a>' + (!pending ? '<a class="wo-btn' + (extra ? '' : ' wo-btn--secondary') + '" href="' + esc(url('/studio/dashboard#verificacion')) + '">Verificar mi estudio</a><a class="wo-btn wo-btn--secondary" href="' + esc(url('/studio/dashboard#roster')) + '">Invitar</a>' : '<a class="wo-btn wo-btn--secondary" href="https://weotzi.com/faqs/" target="_blank" rel="noopener">Contactar soporte</a>') + '</div>');
        $('retry-media')?.addEventListener('click', async event => {
            const button = event.currentTarget; button.disabled = true; button.textContent = 'Subiendo imágenes…';
            try { const updated = await window.WeOtziStudioMedia.finish(completedStudio, existingSession?.user.email || studio.email || value('reg-email')); showComplete({ ...updated, mediaPending: false, mediaError: null }); }
            catch (err) { showStatus('error', err.message || 'No pudimos terminar de subir las imágenes. Podés reintentar.'); button.disabled = false; button.textContent = 'Continuar configuración'; }
        });
    }
    function clearDraft() { try { sessionStorage.removeItem(draftKey); } catch (_) { /* Optional browser draft. */ } }
})();
