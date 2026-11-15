/**
 * WE ÖTZI · Registro del tatuador · ronda 2 (frente "registro")
 * ------------------------------------------------------------------
 * Complementa register.js y acceso-register-final.js con lo que pidió el dueño
 * en la guía de pruebas:
 *   N3  Pie de foto por trabajo del portfolio (Instagram o subido a mano).
 *   P3  Nombre completo, email y ciudad/país traídos del perfil de Instagram:
 *       se precargan SOLO en campos vacíos, marcados "Traído de Instagram" y
 *       siempre editables.
 *   N5  Un perfil ya enviado nunca vuelve a ver el inicio del registro.
 *
 * La lógica pura se exporta para tests (tests/r2-registro.test.js); el DOM
 * solo se toca en el navegador. Si este archivo no carga, el registro sigue
 * funcionando como antes.
 */
(function (root, factory) {
    var api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root && typeof root === 'object' && root.document) root.WoRegistroR2 = api;
}(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function (root) {
    'use strict';

    var Caption = (root && root.WoGalleryCaption)
        || (typeof module === 'object' && module.exports && typeof require === 'function'
            ? require('./gallery-caption.js') : null);
    var CAPTION_MAX = Caption ? Caption.CAPTION_MAX : 2200;

    function text(value) {
        return String(value == null ? '' : value).trim();
    }
    function sanitizeCaption(value) {
        return Caption ? Caption.sanitizeCaption(value) : text(value).slice(0, CAPTION_MAX);
    }
    function isValidEmail(value) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(text(value));
    }

    // ------------------------------------------------------------------
    // P3 · datos del perfil de Instagram
    // ------------------------------------------------------------------
    // current: { full_name, email, location_city, location_country, city,
    //            hasAddress, emailEditable }
    // profile: prefill.profile del commit de registro (lib/instagram-import.js)
    // Devuelve { apply: { campo: valor }, marks: { campo: valor } }. Nunca
    // incluye un campo que la persona ya completó.
    function planInstagramPrefill(current, profile) {
        var c = current || {};
        var p = profile && typeof profile === 'object' ? profile : {};
        var apply = {};
        var marks = {};

        var fullName = text(p.full_name).slice(0, 80);
        if (fullName && !text(c.full_name)) {
            apply.full_name = fullName;
            marks.full_name = fullName;
        }

        var email = text(p.email).toLowerCase();
        if (email && isValidEmail(email) && c.emailEditable !== false && !text(c.email)) {
            apply.email = email;
            marks.email = email;
        }

        var city = text(p.city).slice(0, 60);
        var country = text(p.country).slice(0, 60);
        var locationEmpty = !c.hasAddress && !text(c.location_city) && !text(c.city) && !text(c.location_country);
        if ((city || country) && locationEmpty) {
            if (city) { apply.location_city = city; apply.city = city; }
            if (country) apply.location_country = country;
            marks.location = [city, country].filter(Boolean).join(', ');
        }
        return { apply: apply, marks: marks };
    }

    // Marcas que siguen vigentes: el campo conserva el valor que vino de IG.
    function activeInstagramMarks(marks, current) {
        var m = marks && typeof marks === 'object' ? marks : {};
        var c = current || {};
        var out = {};
        if (m.full_name && text(c.full_name) === text(m.full_name)) out.full_name = m.full_name;
        if (m.email && text(c.email).toLowerCase() === text(m.email).toLowerCase()) out.email = m.email;
        if (m.location && !c.hasAddress) {
            var now = [text(c.location_city || c.city), text(c.location_country)].filter(Boolean).join(', ');
            if (now === text(m.location)) out.location = m.location;
        }
        return out;
    }

    // ------------------------------------------------------------------
    // N3 · pies de foto del portfolio del registro
    // ------------------------------------------------------------------
    // Mapa { permalink: pie } de las publicaciones de Instagram del borrador
    // (el servidor lo aplica al descargarlas; '' quita el pie de Instagram).
    function buildCaptionMap(items) {
        var out = {};
        (Array.isArray(items) ? items : []).forEach(function (item) {
            if (!item || item.source !== 'ig' || !item.permalink) return;
            out[item.permalink] = sanitizeCaption(item.caption);
        });
        return out;
    }

    // Ítem del feed (gallery_feed_items) de un archivo subido en el registro.
    function localFeedItem(item, publicUrl, nowIso) {
        var out = {
            url: publicUrl,
            category: 'realizados',
            kind: item && item.kind === 'video' ? 'video' : 'image',
            created_at: nowIso || new Date().toISOString()
        };
        var caption = sanitizeCaption(item && item.caption);
        if (caption) out.caption = caption;
        return out;
    }

    // ------------------------------------------------------------------
    // N5 · perfil ya enviado
    // ------------------------------------------------------------------
    // El alta quedó enviada: paso final guardado o fecha de envío.
    function isSubmittedRegistration(artist) {
        if (!artist || typeof artist !== 'object' || !artist.user_id) return false;
        if (artist.registration_submitted_at) return true;
        var step = Number.parseInt(String(artist.registration_step == null ? '' : artist.registration_step), 10);
        return Number.isInteger(step) && step >= 12;
    }

    // Con sesión y perfil completo, /register-artist no tiene nada para pedir:
    // se muestra "Tu perfil ya está creado" en vez del paso 01. Los enlaces
    // explícitos (?resumeStep, ?startOver, ?step del preview) sí abren el wizard.
    function shouldSkipWizard(o) {
        var s = o || {};
        if (!s.hasSession || s.preAuth) return false;
        var params;
        try { params = new URLSearchParams(String(s.search || '')); } catch (_) { params = new URLSearchParams(''); }
        if (params.has('resumeStep') || params.get('startOver') === '1' || params.has('step')) return false;
        if (!s.artist) return false;
        // Enviado pero con datos por completar (p. ej. estilos "más adelante"):
        // el wizard sigue siendo el lugar para terminarlos.
        return Boolean(s.progress && s.progress.isComplete);
    }

    var core = {
        CAPTION_MAX: CAPTION_MAX,
        planInstagramPrefill: planInstagramPrefill,
        activeInstagramMarks: activeInstagramMarks,
        buildCaptionMap: buildCaptionMap,
        localFeedItem: localFeedItem,
        isSubmittedRegistration: isSubmittedRegistration,
        shouldSkipWizard: shouldSkipWizard,
        sanitizeCaption: sanitizeCaption
    };
    if (!root || !root.document) return core;

    // ==================================================================
    // DOM
    // ==================================================================
    var document = root.document;
    var IG_TAG_TEXT = 'Traído de Instagram';
    var MARK_FIELDS = {
        full_name: { input: 'full_name', hint: 'Lo tomamos de tu perfil de Instagram. Puedes cambiarlo.' },
        email: { input: 'email', hint: 'Es el email de tu perfil de Instagram. Puedes usar otro.' },
        location: { input: 'address_search', hint: 'Ubicación de tu perfil de Instagram. Elige una sugerencia para confirmar la dirección.' }
    };

    function readCurrent(data, preAuth) {
        var d = data || {};
        var emailInput = document.getElementById('email');
        var nameInput = document.getElementById('full_name');
        return {
            full_name: text(nameInput && nameInput.value) || text(d.full_name),
            email: text(emailInput && emailInput.value) || text(d.email),
            location_city: d.location_city,
            location_country: d.location_country,
            city: d.city,
            hasAddress: Boolean(d.address && typeof d.address === 'object' && Object.keys(d.address).length),
            emailEditable: preAuth === true && !(emailInput && emailInput.readOnly)
        };
    }

    function setInputValue(id, value) {
        var input = document.getElementById(id);
        if (!input) return;
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function renderInstagramMarks(data, preAuth) {
        var d = data || {};
        var active = activeInstagramMarks(d.ig_prefilled, readCurrent(d, preAuth));
        Object.keys(MARK_FIELDS).forEach(function (field) {
            var cfg = MARK_FIELDS[field];
            var input = document.getElementById(cfg.input);
            var label = input ? document.querySelector('label[for="' + cfg.input + '"]') : null;
            if (!label) return;
            var tag = label.querySelector('[data-ig-tag]');
            if (active[field]) {
                if (!tag) {
                    tag = document.createElement('span');
                    tag.className = 'ra-ig-tag';
                    tag.setAttribute('data-ig-tag', field);
                    tag.textContent = IG_TAG_TEXT;
                    tag.title = cfg.hint;
                    label.appendChild(tag);
                }
            } else if (tag) {
                tag.remove();
            }
            if (input && !input.dataset.igMarkWired) {
                input.dataset.igMarkWired = 'true';
                // Al escribir, la marca se va sola (el dato ya es de la persona).
                input.addEventListener('input', function () {
                    root.setTimeout(function () { renderInstagramMarks(d, preAuth); }, 0);
                });
            }
        });
    }

    // Aplica el perfil de Instagram al formulario. opts: { data, preAuth }.
    function applyInstagramProfile(profile, opts) {
        var o = opts || {};
        var data = o.data;
        if (!data || typeof data !== 'object') return { apply: {}, marks: {} };
        var plan = planInstagramPrefill(readCurrent(data, o.preAuth), profile);
        var apply = plan.apply;
        if (apply.full_name) { data.full_name = apply.full_name; setInputValue('full_name', apply.full_name); }
        if (apply.email) { data.email = apply.email; setInputValue('email', apply.email); }
        if (apply.location_city) { data.location_city = apply.location_city; data.city = apply.city; }
        if (apply.location_country) data.location_country = apply.location_country;
        if (Object.keys(plan.marks).length) {
            data.ig_prefilled = Object.assign({}, data.ig_prefilled || {}, plan.marks);
        }
        renderInstagramMarks(data, o.preAuth);
        return plan;
    }

    // ---- N3 · pie de foto en "Tus trabajos" ----
    // Cada trabajo de la grilla lleva un botón "Pie de foto"; al tocarlo se abre
    // UN editor debajo de la grilla (miniatura + texto + contador). Así la
    // grilla sigue compacta aunque haya 50 publicaciones.
    var editor = { item: null, el: null, onChange: null, timer: null };

    function captionButtonLabel(item) {
        return sanitizeCaption(item && item.caption) ? 'Editar pie' : 'Pie de foto';
    }

    function itemKey(item) {
        return String((item && item.id) || '');
    }

    function syncCaptionButtons() {
        var buttons = document.querySelectorAll('[data-caption-for]');
        Array.prototype.forEach.call(buttons, function (btn) {
            var open = Boolean(editor.item) && btn.getAttribute('data-caption-for') === itemKey(editor.item);
            btn.setAttribute('aria-expanded', String(open));
            btn.classList.toggle('is-open', open);
        });
    }

    function closeCaptionEditor(focusButton) {
        var item = editor.item;
        if (editor.el) editor.el.remove();
        editor.el = null;
        editor.item = null;
        syncCaptionButtons();
        if (focusButton && item) {
            var btn = document.querySelector('[data-caption-for="' + itemKey(item).replace(/["\\]/g, '\\$&') + '"]');
            if (btn) { try { btn.focus(); } catch (_) { /* foco opcional */ } }
        }
    }

    function notifyCaptionChange() {
        if (typeof editor.onChange !== 'function') return;
        var fn = editor.onChange;
        root.clearTimeout(editor.timer);
        editor.timer = root.setTimeout(fn, 400);
    }

    function openCaptionEditor(item, opts) {
        var o = opts || {};
        var host = document.getElementById('ra-works');
        if (!host || !item) return;
        if (editor.item === item && editor.el) { closeCaptionEditor(true); return; }
        if (editor.el) editor.el.remove();
        editor.item = item;
        editor.onChange = o.onChange || null;

        var panel = document.createElement('div');
        panel.className = 'ra-caption-editor';
        panel.setAttribute('role', 'group');
        var areaId = 'ra-caption-editor-input';
        panel.setAttribute('aria-labelledby', 'ra-caption-editor-title');

        var thumb = document.createElement('div');
        thumb.className = 'ra-caption-editor-thumb';
        if (o.thumbUrl) {
            var img = document.createElement('img');
            img.src = o.thumbUrl;
            img.alt = '';
            img.addEventListener('error', function () { img.remove(); });
            thumb.appendChild(img);
        }

        var body = document.createElement('div');
        body.className = 'ra-caption-editor-body';
        var label = document.createElement('label');
        label.className = 'ra-label';
        label.id = 'ra-caption-editor-title';
        label.setAttribute('for', areaId);
        label.textContent = 'Pie de foto' + (item.source === 'ig' ? ' · viene de Instagram, puedes cambiarlo' : '');
        var area = document.createElement('textarea');
        area.id = areaId;
        area.className = 'ra-caption-editor-input';
        area.rows = 3;
        area.maxLength = CAPTION_MAX;
        area.placeholder = 'Cuenta algo de este trabajo: estilo, zona, sesiones…';
        area.value = typeof item.caption === 'string' ? item.caption : '';
        var foot = document.createElement('div');
        foot.className = 'ra-caption-editor-foot';
        var count = document.createElement('span');
        count.className = 'ra-caption-editor-count';
        count.setAttribute('aria-live', 'polite');
        var done = document.createElement('button');
        done.type = 'button';
        done.className = 'ra-ghost ra-caption-editor-done';
        done.textContent = 'Listo';
        function paintCount() {
            count.textContent = Array.from(area.value).length + ' / ' + CAPTION_MAX;
        }
        area.addEventListener('input', function () {
            item.caption = area.value;
            paintCount();
            var btn = document.querySelector('[data-caption-for="' + itemKey(item).replace(/["\\]/g, '\\$&') + '"]');
            if (btn) btn.firstChild.textContent = captionButtonLabel(item);
            notifyCaptionChange();
        });
        area.addEventListener('blur', function () {
            var clean = sanitizeCaption(area.value);
            item.caption = clean;
            if (area.value !== clean) { area.value = clean; paintCount(); }
            notifyCaptionChange();
        });
        // Enter y Escape dentro del pie no manejan el grupo del registro.
        area.addEventListener('keydown', function (event) {
            event.stopPropagation();
            if (event.key === 'Escape') { event.preventDefault(); closeCaptionEditor(true); }
        });
        done.addEventListener('click', function () { closeCaptionEditor(true); });
        foot.appendChild(count);
        foot.appendChild(done);
        body.appendChild(label);
        body.appendChild(area);
        body.appendChild(foot);
        panel.appendChild(thumb);
        panel.appendChild(body);

        var grid = document.getElementById('ra-works-grid');
        if (grid && grid.parentNode === host) host.insertBefore(panel, grid.nextSibling);
        else host.appendChild(panel);
        editor.el = panel;
        paintCount();
        syncCaptionButtons();
        root.setTimeout(function () { try { area.focus(); } catch (_) { /* foco opcional */ } }, 30);
    }

    // Botón "Pie de foto" de un trabajo de la grilla (lo agrega renderPortfolio).
    function captionField(item, onChange) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ra-work-caption-btn';
        btn.setAttribute('data-caption-for', itemKey(item));
        btn.setAttribute('aria-expanded', String(editor.item === item && Boolean(editor.el)));
        var labelNode = document.createElement('span');
        labelNode.textContent = captionButtonLabel(item);
        btn.appendChild(labelNode);
        btn.addEventListener('click', function () {
            var cell = btn.closest('.ra-work');
            var img = cell ? cell.querySelector('.ra-work-media img') : null;
            openCaptionEditor(item, { onChange: onChange, thumbUrl: img ? img.currentSrc || img.src : '' });
        });
        // La grilla se redibuja seguido: si el trabajo del editor ya no está, se cierra.
        root.clearTimeout(captionField._gc);
        captionField._gc = root.setTimeout(function () {
            if (!editor.item) return;
            var still = document.querySelector('[data-caption-for="' + itemKey(editor.item).replace(/["\\]/g, '\\$&') + '"]');
            if (!still) closeCaptionEditor(false); else syncCaptionButtons();
        }, 0);
        return btn;
    }

    // N5 · pantalla "Tu perfil ya está creado" sobre la sección de éxito.
    function renderProfileReady(opts) {
        var o = opts || {};
        var section = document.getElementById('ra-success');
        if (!section) return false;
        var title = section.querySelector('.ra-success-title');
        if (title) title.textContent = 'Tu perfil ya está creado' + (o.name ? ', ' + o.name : '') + '.';
        var sub = section.querySelector('.ra-success-sub');
        if (sub) sub.textContent = 'No hace falta volver a registrarte: puedes editar tus datos desde tu panel.';
        var claim = document.getElementById('ra-studio-claim');
        if (claim) claim.hidden = true;
        var cta = document.getElementById('ra-success-cta');
        if (cta) {
            cta.hidden = false;
            cta.setAttribute('href', o.dashboardUrl || '/artist/dashboard');
        }
        return true;
    }

    core.applyInstagramProfile = applyInstagramProfile;
    core.renderInstagramMarks = renderInstagramMarks;
    core.captionField = captionField;
    core.renderProfileReady = renderProfileReady;
    return core;
}));
