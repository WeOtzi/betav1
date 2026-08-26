// ============================================
// Centro de la cuenta del artista (/artist/account) — DS Bauhaus
// Refs Figma: 156:10014 Mi Perfil · 156:10807 Portafolio · 156:11993 Cobros
// · 156:12247 Disponibilidad · 158:13029 Notificaciones · 158:13480 Seguridad
// y Privacidad · 161:14150 Integraciones · 161:14507 Verificación ·
// 162:15088 Configuración.
// SPA por secciones con ruteo por hash (#perfil … #configuracion).
// Datos: SOLO via window.WeotziData.* (artists/quotations/account repos);
// auth y storage directo sobre el cliente supabase-js.
// ============================================

(function () {
    'use strict';

    const supabaseUrl = window.CONFIG?.supabase?.url || 'https://flbgmlvfiejfttlawnfu.supabase.co';
    const supabaseKey = window.CONFIG?.supabase?.anonKey
        || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsYmdtbHZmaWVqZnR0bGF3bmZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU5MTI1ODksImV4cCI6MjA2MTQ4ODU4OX0.AQm4HM8Gjci08p1vfxu6-6MbT_PRceZm5qQbwxA3888';
    if (!window._supabase) window._supabase = supabase.createClient(supabaseUrl, supabaseKey);
    const _supabase = window._supabase;
    const D = window.WeotziData;

    const SECTIONS = ['perfil', 'portafolio', 'cobros', 'disponibilidad', 'notificaciones',
        'seguridad', 'integraciones', 'verificacion', 'configuracion'];

    const LANGS = ['Español', 'Inglés', 'Portugués', 'Francés', 'Italiano', 'Alemán'];

    // Evento → default del canal email (ref 158:13029).
    const NOTIF_EVENTS = [
        ['mensajes', 'Mensajes', true],
        ['cotizaciones', 'Cotizaciones', true],
        ['invitaciones', 'Invitaciones', true],
        ['spots', 'Spots', true],
        ['job_board', 'Job board', false],
        ['calendario', 'Calendario', true],
        ['promociones', 'Promociones', false]
    ];

    const PRIVACY_ROWS = [
        ['show_city', 'Mostrar ciudad en mi perfil público', 'Los clientes ven tu ciudad aproximada al buscar artistas.', true],
        ['show_rating', 'Mostrar mi calificación', 'Tu puntaje promedio es visible en el Job board y Spots.', true],
        ['show_socials', 'Mostrar redes sociales', 'Instagram, TikTok y sitio web visibles en tu perfil.', true],
        ['allow_search_indexing', 'Aparecer en buscadores externos', 'Permitir que Google indexe tu perfil público.', false]
    ];

    const DAYS = [
        ['lunes', 'Lunes'], ['martes', 'Martes'], ['miercoles', 'Miércoles'],
        ['jueves', 'Jueves'], ['viernes', 'Viernes'], ['sabado', 'Sábado'], ['domingo', 'Domingo']
    ];
    const WORKDAYS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes'];

    const DOC_TYPES = [
        ['identidad', 'Documento de identidad'],
        ['bioseguridad', 'Certificado de bioseguridad'],
        ['domicilio', 'Comprobante de domicilio']
    ];

    const TIMEZONES = [
        'America/Argentina/Buenos_Aires', 'America/Montevideo', 'America/Santiago',
        'America/Sao_Paulo', 'America/Bogota', 'America/Lima', 'America/Mexico_City',
        'America/New_York', 'America/Los_Angeles', 'Europe/Madrid', 'Europe/Lisbon',
        'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Rome'
    ];

    const MIN_WORK_SLOTS = 8;

    let user = null;
    let artist = null;
    let prefs = null;          // fila de user_preferences (o null)
    let works = [];            // gallery_feed_items normalizados
    let weekly = [];           // [{day, enabled, start, end}]
    let notifMatrix = {};      // {evento: {email, push}}
    let verifAvailable = false;
    let verifDocs = [];
    let toastTimer = null;

    const $ = (id) => document.getElementById(id);

    document.addEventListener('DOMContentLoaded', init);

    async function init() {
        wireChrome();
        try {
            const { data } = await _supabase.auth.getSession();
            const session = data?.session || null;
            if (!session) { window.location.href = '/artist/login'; return; }
            user = session.user;
        } catch (err) {
            console.error('[account] sesión:', err);
            window.location.href = '/artist/login';
            return;
        }

        const { data: row, error } = await D.Artists.getAccountByUserId(user.id);
        if (error) console.error('[account] artista:', error);
        if (!row) { window.location.href = '/artist/login'; return; }
        artist = row;
        prefs = await D.Prefs.get(user.id).catch(() => null);

        fillProfile();
        setupProfile();
        works = normalizeWorks(artist.gallery_feed_items, artist.gallery_images);
        renderWorks();
        setupWorks();
        setupBilling();
        loadIncome();
        setupAvailability();
        renderNotifMatrix();
        setupSecurity();
        renderPrivacy();
        fillIntegrations();
        renderVerification();
        loadVerifDocs();
        setupSettings();

        applyHash();
        window.addEventListener('hashchange', applyHash);
    }

    // ============================================
    // Chrome: topbar + ruteo por hash + toast
    // ============================================

    function wireChrome() {
        $('aac-logout')?.addEventListener('click', async () => {
            try { await _supabase.auth.signOut(); } catch (err) { console.warn('[account] logout:', err); }
            window.location.href = '/artist/login';
        });
    }

    function applyHash() {
        const raw = (window.location.hash || '').replace('#', '');
        const active = SECTIONS.includes(raw) ? raw : 'perfil';
        SECTIONS.forEach((s) => {
            const sec = $('aac-' + s);
            if (sec) sec.hidden = s !== active;
        });
        document.querySelectorAll('[data-aac-nav]').forEach((item) => {
            item.classList.toggle('is-active', item.getAttribute('data-aac-nav') === active);
        });
        window.scrollTo({ top: 0 });
    }

    function toast(msg, ok = true) {
        const el = $('aac-toast');
        if (!el) return;
        $('aac-toast-text').textContent = msg;
        el.classList.toggle('wo-alert--success', ok);
        el.classList.toggle('wo-alert--error', !ok);
        el.classList.add('is-on');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => el.classList.remove('is-on'), 3200);
    }

    function esc(value) {
        return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[ch]));
    }

    function debounce(fn, ms) {
        let t = null;
        return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
    }

    function appSettings() {
        return (prefs && prefs.app_settings) || {};
    }

    // Guarda una sección de user_preferences y refresca la copia local.
    async function savePrefs(section, patch) {
        prefs = await D.Prefs.saveSection(user.id, section, patch) || prefs;
    }

    async function updateArtist(patch) {
        const { error } = await D.Artists.updateByUserId(user.id, patch);
        if (error) throw error;
        Object.assign(artist, patch);
    }

    async function uploadTo(bucket, path, file) {
        const { error } = await _supabase.storage.from(bucket)
            .upload(path, file, { cacheControl: '3600', upsert: true, contentType: file.type || undefined });
        if (error) throw error;
        const { data } = _supabase.storage.from(bucket).getPublicUrl(path);
        return data?.publicUrl || null;
    }

    function fileExt(file) {
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
        return ext.replace(/[^a-z0-9]/g, '') || 'jpg';
    }

    // ============================================
    // 1 · Mi perfil
    // ============================================

    function profilePrefs() {
        return appSettings().profile || {};
    }

    function fillProfile() {
        const p = profilePrefs();
        $('aac-name').value = artist.name || '';
        $('aac-fullname').value = p.full_name || '';
        $('aac-username').value = artist.username || '';
        $('aac-bio').value = artist.bio_description || '';
        $('aac-city').value = artist.city || '';
        $('aac-country').value = artist.country || '';
        $('aac-instagram').value = artist.instagram || '';
        $('aac-tiktok').value = p.tiktok || '';
        $('aac-website').value = artist.portafolio || '';

        // Idiomas como chips seleccionables (multiselección sobre languages[]).
        const current = Array.isArray(artist.languages) ? artist.languages : [];
        const all = [...LANGS];
        current.forEach((l) => { if (!all.includes(l)) all.push(l); });
        $('aac-langs').innerHTML = all.map((lang) => {
            const on = current.includes(lang);
            return `<button type="button" class="wo-chip${on ? ' is-active' : ''}" data-lang="${esc(lang)}" aria-pressed="${on}">${esc(lang)}</button>`;
        }).join('');
        $('aac-langs').querySelectorAll('[data-lang]').forEach((chip) => {
            chip.addEventListener('click', () => {
                const on = chip.classList.toggle('is-active');
                chip.setAttribute('aria-pressed', String(on));
            });
        });

        setDropMedia($('aac-photo-drop'), artist.profile_picture, 'Foto de perfil');
        setDropMedia($('aac-banner-drop'), p.banner_url, 'Banner de perfil');
    }

    function setDropMedia(drop, url, alt) {
        if (!drop) return;
        drop.querySelector('img')?.remove();
        if (url) {
            drop.classList.add('has-media');
            const img = document.createElement('img');
            img.src = url;
            img.alt = alt;
            drop.appendChild(img);
        } else {
            drop.classList.remove('has-media');
        }
    }

    function setupProfile() {
        wireDrop($('aac-banner-drop'), $('aac-banner-input'), async (file) => {
            const url = await uploadTo('profile-pictures', `${user.id}/banner-${Date.now()}.${fileExt(file)}`, file);
            const p = { ...profilePrefs(), banner_url: url };
            await savePrefs('app_settings', { profile: p });
            setDropMedia($('aac-banner-drop'), url, 'Banner de perfil');
            toast('Banner actualizado');
        });
        wireDrop($('aac-photo-drop'), $('aac-photo-input'), async (file) => {
            const url = await uploadTo('profile-pictures', `${user.id}/${Date.now()}.${fileExt(file)}`, file);
            await updateArtist({ profile_picture: url });
            setDropMedia($('aac-photo-drop'), url, 'Foto de perfil');
            toast('Foto de perfil actualizada');
        });

        $('aac-profile-save').addEventListener('click', saveProfile);
    }

    // Dropzone: click (label ya abre el input), drag & drop y subida.
    function wireDrop(drop, input, onFile) {
        if (!drop || !input) return;
        input.addEventListener('change', async () => {
            const file = input.files && input.files[0];
            input.value = '';
            if (!file) return;
            try { await onFile(file); }
            catch (err) { console.error('[account] upload:', err); toast('No pudimos subir la imagen', false); }
        });
        ['dragover', 'dragenter'].forEach((ev) => drop.addEventListener(ev, (e) => {
            e.preventDefault();
            drop.classList.add('dragover');
        }));
        ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => {
            e.preventDefault();
            drop.classList.remove('dragover');
        }));
        drop.addEventListener('drop', async (e) => {
            const file = e.dataTransfer?.files && e.dataTransfer.files[0];
            if (!file) return;
            try { await onFile(file); }
            catch (err) { console.error('[account] upload:', err); toast('No pudimos subir la imagen', false); }
        });
    }

    function normalizeHandle(value) {
        const v = String(value || '').trim();
        if (!v) return '';
        return v.startsWith('@') ? v : '@' + v;
    }

    async function saveProfile() {
        const btn = $('aac-profile-save');
        const errEl = $('aac-username-error');
        errEl.hidden = true;
        $('aac-username').classList.remove('wo-input--error');

        const username = $('aac-username').value.trim().toLowerCase();
        if (!username || !/^[a-z0-9._-]{3,40}$/.test(username)) {
            errEl.textContent = 'El nombre de usuario lleva entre 3 y 40 caracteres: letras, números, punto, guion o guion bajo.';
            errEl.hidden = false;
            $('aac-username').classList.add('wo-input--error');
            return;
        }

        btn.disabled = true;
        try {
            if (username !== (artist.username || '').toLowerCase()) {
                const { data: taken } = await D.Artists.isUsernameAvailable(username, user.id);
                if (taken && taken.length) {
                    errEl.textContent = 'Ese nombre de usuario ya está en uso.';
                    errEl.hidden = false;
                    $('aac-username').classList.add('wo-input--error');
                    return;
                }
            }

            const languages = Array.from($('aac-langs').querySelectorAll('[data-lang].is-active'))
                .map((chip) => chip.getAttribute('data-lang'));

            await updateArtist({
                name: $('aac-name').value.trim() || null,
                username,
                languages,
                bio_description: $('aac-bio').value.trim() || null,
                city: $('aac-city').value.trim() || null,
                country: $('aac-country').value.trim() || null,
                instagram: normalizeHandle($('aac-instagram').value) || null,
                portafolio: $('aac-website').value.trim() || null
            });

            const p = {
                ...profilePrefs(),
                full_name: $('aac-fullname').value.trim(),
                tiktok: normalizeHandle($('aac-tiktok').value)
            };
            await savePrefs('app_settings', { profile: p });

            fillIntegrations();
            toast('Cambios guardados');
        } catch (err) {
            console.error('[account] guardar perfil:', err);
            toast('No pudimos guardar los cambios', false);
        } finally {
            btn.disabled = false;
        }
    }

    // ============================================
    // 2 · Portafolio
    // ============================================

    function isVideoUrl(url) {
        const ext = (url || '').split('?')[0].split('.').pop().toLowerCase();
        return ext === 'mp4' || ext === 'mov';
    }

    function normalizeWorks(feedItems, legacyImages) {
        const out = [];
        const seen = new Set();
        const parse = (v) => {
            if (Array.isArray(v)) return v;
            if (typeof v !== 'string') return [];
            try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; }
        };
        for (const raw of parse(feedItems)) {
            const url = String(raw?.url || '').trim();
            if (!url || seen.has(url)) continue;
            out.push({
                url,
                category: raw?.category || 'realizados',
                kind: raw?.kind === 'video' || isVideoUrl(url) ? 'video' : 'image',
                created_at: raw?.created_at || new Date().toISOString()
            });
            seen.add(url);
        }
        if (!out.length) {
            for (const entry of parse(legacyImages)) {
                const url = typeof entry === 'string' ? entry.trim() : String(entry?.url || '').trim();
                if (!url || seen.has(url)) continue;
                out.push({ url, category: 'realizados', kind: isVideoUrl(url) ? 'video' : 'image', created_at: new Date().toISOString() });
                seen.add(url);
            }
        }
        return out;
    }

    function renderWorks() {
        const grid = $('aac-works');
        const total = Math.max(MIN_WORK_SLOTS, Math.ceil((works.length + 1) / 4) * 4);
        const cells = works.map((item, i) => `
            <div class="aac-work">
                ${item.kind === 'video'
                    ? `<video src="${esc(item.url)}" preload="metadata" muted playsinline></video>`
                    : `<img src="${esc(item.url)}" alt="Trabajo ${i + 1}" loading="lazy">`}
                <div class="aac-work-tools">
                    <button type="button" class="wo-iconbtn" data-work-up="${i}" aria-label="Subir en el orden" ${i === 0 ? 'disabled' : ''}><i data-wo-icon="arrow-up"></i></button>
                    <button type="button" class="wo-iconbtn" data-work-down="${i}" aria-label="Bajar en el orden" ${i === works.length - 1 ? 'disabled' : ''}><i data-wo-icon="arrow-down"></i></button>
                    <button type="button" class="wo-iconbtn" data-work-del="${i}" aria-label="Quitar trabajo"><i data-wo-icon="trash-2"></i></button>
                </div>
            </div>`);
        for (let i = works.length; i < total; i++) {
            cells.push(`
            <button type="button" class="wo-dropzone aac-drop aac-work-drop" data-work-add>
                <i data-wo-icon="image" aria-hidden="true"></i>
                <span class="aac-drop-title">Trabajo</span>
                <span class="aac-drop-hint">o buscá archivos</span>
            </button>`);
        }
        grid.innerHTML = cells.join('');

        grid.querySelectorAll('[data-work-add]').forEach((cell) => {
            cell.addEventListener('click', () => $('aac-works-input').click());
        });
        grid.querySelectorAll('[data-work-up]').forEach((btn) => btn.addEventListener('click', () => moveWork(Number(btn.dataset.workUp), -1)));
        grid.querySelectorAll('[data-work-down]').forEach((btn) => btn.addEventListener('click', () => moveWork(Number(btn.dataset.workDown), 1)));
        grid.querySelectorAll('[data-work-del]').forEach((btn) => btn.addEventListener('click', () => removeWork(Number(btn.dataset.workDel))));
    }

    function setupWorks() {
        $('aac-works-add').addEventListener('click', () => $('aac-works-input').click());
        $('aac-works-input').addEventListener('change', async (e) => {
            const files = Array.from(e.target.files || []).filter((f) => f.type.startsWith('image/'));
            e.target.value = '';
            if (!files.length) return;
            try {
                for (const file of files) {
                    const path = `${user.id}/${Date.now()}_${Math.random().toString(36).slice(2, 9)}.${fileExt(file)}`;
                    const url = await uploadTo('artist-gallery', path, file);
                    if (url) works.push({ url, category: 'realizados', kind: 'image', created_at: new Date().toISOString() });
                }
                await persistWorks();
                toast(files.length === 1 ? 'Trabajo agregado' : `${files.length} trabajos agregados`);
            } catch (err) {
                console.error('[account] portafolio:', err);
                toast('No pudimos subir los archivos', false);
            }
            renderWorks();
        });
    }

    async function persistWorks() {
        await updateArtist({
            gallery_feed_items: works,
            gallery_images: works.map((w) => w.url)
        });
    }

    async function moveWork(index, dir) {
        const target = index + dir;
        if (target < 0 || target >= works.length) return;
        const [item] = works.splice(index, 1);
        works.splice(target, 0, item);
        renderWorks();
        try { await persistWorks(); toast('Orden actualizado'); }
        catch (err) { console.error('[account] orden portafolio:', err); toast('No pudimos guardar el orden', false); }
    }

    async function removeWork(index) {
        const item = works[index];
        if (!item) return;
        if (!window.confirm('¿Querés quitar este trabajo del portafolio?')) return;
        works.splice(index, 1);
        renderWorks();
        try {
            const parts = item.url.split('/artist-gallery/');
            if (parts.length > 1) await _supabase.storage.from('artist-gallery').remove([parts[1]]);
            await persistWorks();
            toast('Trabajo quitado');
        } catch (err) {
            console.error('[account] quitar trabajo:', err);
            toast('No pudimos quitar el trabajo', false);
        }
    }

    // ============================================
    // 3 · Cobros y facturación
    // ============================================

    function fmtMoney(amount, code) {
        const cur = window.WeOtziCurrency;
        const info = cur && typeof cur.get === 'function' ? cur.get(code) : null;
        const symbol = (info && info.symbol) || '$';
        return symbol + Math.round(amount).toLocaleString('es-AR');
    }

    // Mismo criterio que el dashboard: final_budget_amount de cotizaciones
    // completadas, convertido a la moneda del artista (sin ledger de pagos).
    async function loadIncome() {
        try {
            const cur = window.WeOtziCurrency;
            if (cur && typeof cur.init === 'function') await cur.init().catch(() => null);

            const quotes = await D.Quotations.listForArtist(user.id, {
                select: 'quote_status, final_budget_amount, final_budget_currency, client_completed_at, artist_completed_at, updated_at, created_at'
            });

            const target = String(artist.preferred_display_currency || artist.session_price_currency || 'USD').toUpperCase();
            const monthStart = new Date();
            monthStart.setDate(1);
            monthStart.setHours(0, 0, 0, 0);

            let month = 0, total = 0, count = 0;
            (quotes || []).forEach((q) => {
                if (q.quote_status !== 'completed') return;
                count++;
                const raw = parseFloat(q.final_budget_amount);
                if (!isFinite(raw) || raw <= 0) return;
                const from = String(q.final_budget_currency || target).toUpperCase();
                let value = raw;
                if (from !== target) {
                    const conv = cur && typeof cur.convert === 'function' ? cur.convert(raw, from, target) : null;
                    if (conv === null || !isFinite(conv)) return; // sin tipo de cambio no inventamos
                    value = conv;
                }
                total += value;
                const when = new Date(q.client_completed_at || q.artist_completed_at || q.updated_at || q.created_at);
                if (!isNaN(when) && when >= monthStart) month += value;
            });

            $('aac-stat-month').textContent = fmtMoney(month, target);
            $('aac-stat-total').textContent = fmtMoney(total, target);
            $('aac-stat-count').textContent = String(count);
        } catch (err) {
            console.error('[account] ingresos:', err);
            $('aac-stat-month').textContent = '—';
            $('aac-stat-total').textContent = '—';
            $('aac-stat-count').textContent = '—';
        }
    }

    async function setupBilling() {
        try {
            const row = await D.Billing.get(user.id);
            if (row) {
                $('aac-legal-name').value = row.legal_name || '';
                $('aac-tax-id').value = row.tax_id || '';
            }
        } catch (err) {
            console.warn('[account] datos fiscales:', err);
        }
        $('aac-billing-save').addEventListener('click', async () => {
            const btn = $('aac-billing-save');
            btn.disabled = true;
            try {
                await D.Billing.upsert(user.id, {
                    legalName: $('aac-legal-name').value.trim() || null,
                    taxId: $('aac-tax-id').value.trim() || null
                });
                toast('Datos fiscales guardados');
            } catch (err) {
                console.error('[account] guardar fiscales:', err);
                toast('No pudimos guardar los datos fiscales', false);
            } finally {
                btn.disabled = false;
            }
        });
    }

    // ============================================
    // 4 · Disponibilidad
    // ============================================

    function defaultWeekly() {
        return DAYS.map(([day]) => ({
            day,
            enabled: WORKDAYS.includes(day),
            start: '10:00',
            end: '19:00'
        }));
    }

    const saveWeekly = debounce(async () => {
        try {
            await savePrefs('app_settings', { availability: { weekly } });
            toast('Disponibilidad guardada');
        } catch (err) {
            console.error('[account] disponibilidad:', err);
            toast('No pudimos guardar la disponibilidad', false);
        }
    }, 700);

    function setupAvailability() {
        const stored = appSettings().availability?.weekly;
        weekly = Array.isArray(stored) && stored.length === 7
            ? DAYS.map(([day], i) => ({
                day,
                enabled: !!stored[i]?.enabled,
                start: stored[i]?.start || '10:00',
                end: stored[i]?.end || '19:00'
            }))
            : defaultWeekly();

        const wrap = $('aac-days');
        wrap.innerHTML = DAYS.map(([day, label], i) => `
            <div class="aac-dayrow${weekly[i].enabled ? '' : ' is-off'}" data-day="${day}">
                <span class="aac-dayrow-name">${label}</span>
                <label class="wo-toggle">
                    <input type="checkbox" data-day-toggle="${i}" ${weekly[i].enabled ? 'checked' : ''} aria-label="Disponible los ${label.toLowerCase()}">
                    <span class="knob"></span>
                </label>
                <span class="aac-dayrow-hours">
                    <input class="wo-input aac-time" type="time" data-day-start="${i}" value="${esc(weekly[i].start)}" aria-label="Hora de inicio del ${label.toLowerCase()}">
                    <span class="wo-faint">–</span>
                    <input class="wo-input aac-time" type="time" data-day-end="${i}" value="${esc(weekly[i].end)}" aria-label="Hora de fin del ${label.toLowerCase()}">
                </span>
                <span class="aac-dayrow-off">No disponible</span>
            </div>`).join('');

        wrap.querySelectorAll('[data-day-toggle]').forEach((input) => {
            input.addEventListener('change', () => {
                const i = Number(input.dataset.dayToggle);
                weekly[i].enabled = input.checked;
                input.closest('.aac-dayrow').classList.toggle('is-off', !input.checked);
                saveWeekly();
            });
        });
        wrap.querySelectorAll('[data-day-start], [data-day-end]').forEach((input) => {
            input.addEventListener('change', () => {
                const isStart = input.dataset.dayStart !== undefined;
                const i = Number(isStart ? input.dataset.dayStart : input.dataset.dayEnd);
                if (isStart) weekly[i].start = input.value || '10:00';
                else weekly[i].end = input.value || '19:00';
                saveWeekly();
            });
        });

        // Vacaciones → columnas reales de artists_db.
        $('aac-vac-from').value = artist.vacation_start || '';
        $('aac-vac-to').value = artist.vacation_end || '';
        const saveVacations = async () => {
            try {
                await updateArtist({
                    vacation_start: $('aac-vac-from').value || null,
                    vacation_end: $('aac-vac-to').value || null
                });
                toast('Vacaciones guardadas');
            } catch (err) {
                console.error('[account] vacaciones:', err);
                toast('No pudimos guardar las vacaciones', false);
            }
        };
        $('aac-vac-from').addEventListener('change', saveVacations);
        $('aac-vac-to').addEventListener('change', saveVacations);
    }

    // ============================================
    // 5 · Notificaciones (Email funcional · Push próximamente · sin SMS)
    // ============================================

    function renderNotifMatrix() {
        const saved = (prefs && prefs.notification_prefs) || {};
        notifMatrix = {};
        NOTIF_EVENTS.forEach(([key, , emailDefault]) => {
            notifMatrix[key] = {
                email: typeof saved[key]?.email === 'boolean' ? saved[key].email : emailDefault,
                push: !!saved[key]?.push
            };
        });

        $('aac-notif-rows').innerHTML = NOTIF_EVENTS.map(([key, label]) => `
            <div class="aac-matrix-row">
                <span class="aac-matrix-label">${label}</span>
                <span class="aac-matrix-cell">
                    <label class="wo-toggle">
                        <input type="checkbox" data-notif="${key}" ${notifMatrix[key].email ? 'checked' : ''} aria-label="Avisos de ${label.toLowerCase()} por email">
                        <span class="knob"></span>
                    </label>
                </span>
                <span class="aac-matrix-cell is-soon">
                    <label class="wo-toggle">
                        <input type="checkbox" disabled aria-label="Avisos de ${label.toLowerCase()} por push · próximamente">
                        <span class="knob"></span>
                    </label>
                </span>
            </div>`).join('');

        $('aac-notif-rows').querySelectorAll('[data-notif]').forEach((input) => {
            input.addEventListener('change', async () => {
                notifMatrix[input.dataset.notif].email = input.checked;
                try {
                    await savePrefs('notification_prefs', notifMatrix);
                    toast('Preferencia guardada');
                } catch (err) {
                    console.error('[account] notificaciones:', err);
                    toast('No pudimos guardar la preferencia', false);
                }
            });
        });
    }

    // ============================================
    // 6 · Seguridad y privacidad
    // ============================================

    function describeDevice() {
        const ua = navigator.userAgent || '';
        const browser = /Edg\//.test(ua) ? 'Edge'
            : /Firefox\//.test(ua) ? 'Firefox'
            : /Chrome\//.test(ua) ? 'Chrome'
            : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
        const os = /Windows/.test(ua) ? 'Windows'
            : /Mac OS X/.test(ua) ? 'macOS'
            : /Android/.test(ua) ? 'Android'
            : /iPhone|iPad/.test(ua) ? 'iOS'
            : /Linux/.test(ua) ? 'Linux' : '';
        return os ? `${os} — ${browser}` : browser;
    }

    function setupSecurity() {
        $('aac-device-title').textContent = describeDevice();
        $('aac-device-sub').textContent = 'Sesión actual · Activa ahora';

        $('aac-pass-save').addEventListener('click', async () => {
            const errEl = $('aac-pass-error');
            errEl.hidden = true;
            const current = $('aac-pass-current').value;
            const next = $('aac-pass-new').value;
            if (!current || !next) {
                errEl.textContent = 'Completá la contraseña actual y la nueva.';
                errEl.hidden = false;
                return;
            }
            if (next.length < 8) {
                errEl.textContent = 'La nueva contraseña lleva al menos 8 caracteres.';
                errEl.hidden = false;
                return;
            }
            if (next === current) {
                errEl.textContent = 'La nueva contraseña tiene que ser distinta de la actual.';
                errEl.hidden = false;
                return;
            }
            const btn = $('aac-pass-save');
            btn.disabled = true;
            try {
                const { error: signErr } = await _supabase.auth.signInWithPassword({ email: user.email, password: current });
                if (signErr) {
                    errEl.textContent = 'La contraseña actual no es correcta.';
                    errEl.hidden = false;
                    return;
                }
                const { error: updErr } = await _supabase.auth.updateUser({ password: next });
                if (updErr) throw updErr;
                $('aac-pass-current').value = '';
                $('aac-pass-new').value = '';
                toast('Contraseña actualizada');
            } catch (err) {
                console.error('[account] contraseña:', err);
                errEl.textContent = 'No pudimos actualizar la contraseña. Probá de nuevo.';
                errEl.hidden = false;
            } finally {
                btn.disabled = false;
            }
        });

        $('aac-close-others').addEventListener('click', async () => {
            const btn = $('aac-close-others');
            btn.disabled = true;
            try {
                const { error } = await _supabase.auth.signOut({ scope: 'others' });
                if (error) throw error;
                toast('Cerramos la sesión en tus otros dispositivos');
            } catch (err) {
                console.error('[account] cerrar sesiones:', err);
                toast('No pudimos cerrar las otras sesiones', false);
            } finally {
                btn.disabled = false;
            }
        });
    }

    function renderPrivacy() {
        const saved = (prefs && prefs.privacy) || {};
        $('aac-privacy-rows').innerHTML = PRIVACY_ROWS.map(([key, title, help, def]) => {
            const on = typeof saved[key] === 'boolean' ? saved[key] : def;
            return `
            <div class="aac-togglerow">
                <div class="aac-togglerow-main">
                    <div class="aac-row-title">${title}</div>
                    <div class="aac-row-sub">${help}</div>
                </div>
                <label class="wo-toggle">
                    <input type="checkbox" data-privacy="${key}" ${on ? 'checked' : ''} aria-label="${title}">
                    <span class="knob"></span>
                </label>
            </div>`;
        }).join('');

        $('aac-privacy-rows').querySelectorAll('[data-privacy]').forEach((input) => {
            input.addEventListener('change', async () => {
                try {
                    await savePrefs('privacy', { [input.dataset.privacy]: input.checked });
                    toast('Preferencia guardada');
                } catch (err) {
                    console.error('[account] privacidad:', err);
                    toast('No pudimos guardar la preferencia', false);
                }
            });
        });
    }

    // ============================================
    // 7 · Integraciones
    // ============================================

    function fillIntegrations() {
        const handle = (artist.instagram || '').trim();
        const state = $('aac-ig-state');
        const sub = $('aac-ig-sub');
        if (handle) {
            state.textContent = 'Conectado';
            sub.innerHTML = `${esc(handle.startsWith('@') ? handle : '@' + handle)} · <a href="/artist/dashboard">Gestioná la importación desde tu dashboard →</a>`;
        } else {
            state.textContent = 'Sin conectar';
            sub.innerHTML = 'Importá publicaciones a tu portafolio. <a href="/artist/dashboard">Gestioná la importación desde tu dashboard →</a>';
        }
    }

    // ============================================
    // 8 · Verificación
    // ============================================

    function renderVerification() {
        const state = artist.verification_state || 'No';
        const box = $('aac-verif-alert');
        const canRequest = ['No', 'Denied', 'Canceled'].includes(state);
        let cls = 'wo-alert--warning';
        let icon = 'alert-circle';
        let title = 'Todavía no verificaste tu identidad';
        let detail = 'Solicitá la verificación para ganar confianza y prioridad en el Job board.';

        if (state === 'Yes') {
            cls = 'wo-alert--success';
            icon = 'check-circle';
            title = 'Identidad verificada';
            detail = 'Tu perfil muestra la insignia de verificado.';
        } else if (['Requested', 'In Progress', 'In Analysis'].includes(state)) {
            cls = 'wo-alert--info';
            icon = 'clock';
            title = 'Verificación en proceso';
            detail = 'Estamos revisando tu solicitud. Te avisamos por email cuando termine.';
        } else if (state === 'Denied') {
            cls = 'wo-alert--error';
            icon = 'alert-circle';
            title = 'Verificación denegada';
            detail = 'Podés volver a solicitarla cuando tengas la documentación al día.';
        }

        box.innerHTML = `
            <div class="wo-alert ${cls}">
                <i data-wo-icon="${icon}" aria-hidden="true"></i>
                <div>
                    <strong>${title}</strong><br>${detail}
                </div>
            </div>
            ${canRequest ? '<div class="aac-actions" style="margin-top:var(--space-4)"><button type="button" class="wo-btn wo-btn--ghost" id="aac-verif-request">Solicitar verificación</button></div>' : ''}`;

        $('aac-verif-request')?.addEventListener('click', async () => {
            try {
                await updateArtist({ verification_state: 'Requested' });
                renderVerification();
                toast('Solicitud de verificación enviada');
            } catch (err) {
                console.error('[account] solicitar verificación:', err);
                toast('No pudimos enviar la solicitud', false);
            }
        });
    }

    async function loadVerifDocs() {
        try {
            verifAvailable = await D.VerificationDocs.isAvailable();
            if (verifAvailable) verifDocs = await D.VerificationDocs.list(user.id);
        } catch (err) {
            console.warn('[account] documentos:', err);
            verifAvailable = false;
        }
        renderDocs();
    }

    function docBadge(doc) {
        if (!doc) return '<span class="aac-state aac-state--soon">Sin cargar</span>';
        const status = String(doc.status || 'pendiente').toLowerCase();
        if (status.includes('verific') || status.includes('aprob')) return '<span class="aac-badge aac-badge--success">Verificado</span>';
        if (status.includes('rechaz') || status.includes('deneg')) return '<span class="aac-badge aac-badge--error">Rechazado</span>';
        return '<span class="aac-badge aac-badge--warning">Pendiente</span>';
    }

    function renderDocs() {
        const wrap = $('aac-docs');
        $('aac-docs-note').hidden = verifAvailable;

        wrap.innerHTML = DOC_TYPES.map(([type, label]) => {
            const doc = verifDocs.find((d) => d.doc_type === type) || null;
            const status = doc ? String(doc.status || 'pendiente').toLowerCase() : '';
            const deletable = doc && !status.includes('verific') && !status.includes('aprob');
            return `
            <div class="aac-row${verifAvailable ? '' : ' is-soon'}">
                <span class="aac-row-tile"><i data-wo-icon="file-text" aria-hidden="true"></i></span>
                <div class="aac-row-main">
                    <div class="aac-row-title">${label}</div>
                    ${doc ? `<div class="aac-row-sub">${esc(doc.file_name || '')}</div>` : ''}
                </div>
                <div class="aac-row-side">
                    ${docBadge(doc)}
                    <button type="button" class="wo-btn wo-btn--ghost wo-btn--s" data-doc-upload="${type}" ${verifAvailable ? '' : 'disabled'}>${doc ? 'Reemplazar' : 'Subir'}</button>
                    ${deletable ? `<button type="button" class="wo-iconbtn wo-iconbtn--s" data-doc-del="${esc(doc.id)}" aria-label="Eliminar documento"><i data-wo-icon="trash-2"></i></button>` : ''}
                    <input type="file" data-doc-input="${type}" accept="image/*,.pdf" hidden>
                </div>
            </div>`;
        }).join('');

        wrap.querySelectorAll('[data-doc-upload]').forEach((btn) => {
            btn.addEventListener('click', () => {
                wrap.querySelector(`[data-doc-input="${btn.dataset.docUpload}"]`)?.click();
            });
        });
        wrap.querySelectorAll('[data-doc-input]').forEach((input) => {
            input.addEventListener('change', async () => {
                const file = input.files && input.files[0];
                const type = input.dataset.docInput;
                input.value = '';
                if (!file) return;
                try {
                    const path = `${user.id}/${type}-${Date.now()}.${fileExt(file)}`;
                    await uploadTo('artist-verification', path, file);
                    await D.VerificationDocs.add({
                        artistUserId: user.id,
                        docType: type,
                        fileName: file.name,
                        storagePath: path
                    });
                    verifDocs = await D.VerificationDocs.list(user.id);
                    renderDocs();
                    toast('Documento subido');
                } catch (err) {
                    console.error('[account] subir documento:', err);
                    toast('No pudimos subir el documento', false);
                }
            });
        });
        wrap.querySelectorAll('[data-doc-del]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                if (!window.confirm('¿Querés eliminar este documento?')) return;
                try {
                    await D.VerificationDocs.delete(btn.dataset.docDel);
                    verifDocs = await D.VerificationDocs.list(user.id);
                    renderDocs();
                    toast('Documento eliminado');
                } catch (err) {
                    console.error('[account] eliminar documento:', err);
                    toast('No pudimos eliminar el documento', false);
                }
            });
        });
    }

    // ============================================
    // 9 · Configuración
    // ============================================

    async function setupSettings() {
        const cur = window.WeOtziCurrency;
        if (cur && typeof cur.init === 'function') await cur.init().catch(() => null);
        const catalog = cur && typeof cur.list === 'function' && cur.list().length
            ? cur.list()
            : [{ code: 'USD', symbol: '$' }, { code: 'EUR', symbol: '€' }, { code: 'ARS', symbol: '$' }];

        const currencySel = $('aac-currency');
        currencySel.innerHTML = '<option value="">Seleccioná una moneda</option>' + catalog.map((c) =>
            `<option value="${esc(c.code)}">${esc(c.code)}${c.symbol ? ` (${esc(c.symbol)})` : ''}</option>`
        ).join('');
        currencySel.value = artist.preferred_display_currency || '';

        const detectedTz = (Intl.DateTimeFormat().resolvedOptions().timeZone) || 'America/Argentina/Buenos_Aires';
        const tzList = TIMEZONES.includes(detectedTz) ? TIMEZONES : [detectedTz, ...TIMEZONES];
        const tzSel = $('aac-timezone');
        tzSel.innerHTML = tzList.map((tz) => `<option value="${esc(tz)}">${esc(tz.replace(/_/g, ' '))}</option>`).join('');

        const s = appSettings();
        tzSel.value = s.timezone && tzList.includes(s.timezone) ? s.timezone : detectedTz;
        $('aac-dateformat').value = s.date_format || 'DD/MM/AAAA';
        $('aac-timeformat').value = s.time_format || '24h';
        $('aac-language').value = s.language || 'es';

        currencySel.addEventListener('change', async () => {
            try {
                await updateArtist({ preferred_display_currency: currencySel.value || null });
                toast('Moneda preferida guardada');
            } catch (err) {
                console.error('[account] moneda:', err);
                toast('No pudimos guardar la moneda', false);
            }
        });

        const saveSetting = (patch) => savePrefs('app_settings', patch)
            .then(() => toast('Preferencia guardada'))
            .catch((err) => {
                console.error('[account] configuración:', err);
                toast('No pudimos guardar la preferencia', false);
            });
        tzSel.addEventListener('change', () => saveSetting({ timezone: tzSel.value }));
        $('aac-dateformat').addEventListener('change', () => saveSetting({ date_format: $('aac-dateformat').value }));
        $('aac-timeformat').addEventListener('change', () => saveSetting({ time_format: $('aac-timeformat').value }));
        $('aac-language').addEventListener('change', () => saveSetting({ language: $('aac-language').value }));
    }
})();
