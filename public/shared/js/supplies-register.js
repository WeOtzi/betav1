// ============================================
// Registro de Supplies (tiendas de insumos)
// Wizard en 3 pasos: Cuenta → Negocio → Comercial.
// Al enviar llama a WeOtziSuppliesAuth.register(payload):
//   - sin sesión: signUp con el borrador en user_metadata (sin contraseña) y
//     pide confirmar el correo; la cuenta se crea al volver con sesión;
//   - con sesión: complete_supply_vendor_registration en una sola llamada.
// Los helpers puros (validación y armado del perfil) se exportan a Node para
// los tests (module.exports) y quedan en window.WeOtziSuppliesRegister.
// ============================================

(function (root, factory) {
    'use strict';
    const api = factory(root);
    if (typeof module === 'object' && module && module.exports) module.exports = api;
    if (typeof window !== 'undefined' && window) {
        window.WeOtziSuppliesRegister = api;
        if (window.document && typeof window.document.addEventListener === 'function') {
            window.document.addEventListener('DOMContentLoaded', () => api.boot());
        }
    }
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
    'use strict';

    const TOTAL_STEPS = 3;
    const ISO_FALLBACK = ['ARS', 'USD', 'EUR', 'BRL', 'CLP', 'MXN', 'COP', 'UYU', 'PEN'];
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    // -------------------------------------------------------------
    // Helpers puros
    // -------------------------------------------------------------
    function text(v) { return String(v == null ? '' : v).trim(); }

    // '1.234,5' / '1234.5' / '' → número o null. NaN → undefined (inválido).
    function toAmount(v) {
        const raw = text(v);
        if (!raw) return null;
        const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
        const n = Number(normalized);
        return Number.isFinite(n) ? n : undefined;
    }

    // "ar, uy  BR" → {items:['AR','UY','BR'], invalid:[]}. Sin duplicados.
    function parseCountries(value) {
        const items = [];
        const invalid = [];
        text(value).split(/[\s,;]+/).filter(Boolean).forEach(part => {
            const code = part.toUpperCase();
            if (!/^[A-Z]{2}$/.test(code)) invalid.push(part);
            else if (!items.includes(code)) items.push(code);
        });
        return { items, invalid };
    }

    function isHttpUrl(v) {
        const s = text(v);
        if (!s) return true;
        const kit = root && root.WeOtziStudioKit;
        if (kit && typeof kit.safeUrl === 'function') return !!kit.safeUrl(s);
        return /^https?:\/\/[^\s/?#]+[^\s]*$/i.test(s);
    }

    // Devuelve el mensaje de error del paso o null si está bien.
    // values: lo que leyó readValues(); opts.hasSession omite la contraseña.
    function validateStep(step, values, opts) {
        const v = values || {};
        const o = opts || {};
        if (step === 1) {
            if (!EMAIL_RE.test(text(v.email))) return 'El email no parece válido.';
            if (!o.hasSession) {
                if (String(v.password || '').length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
                if (v.password !== v.passwordConfirm) return 'Las contraseñas no coinciden.';
            }
            return null;
        }
        if (step === 2) {
            const name = text(v.name);
            if (name.length < 2 || name.length > 160) return 'El nombre de la tienda debe tener entre 2 y 160 caracteres.';
            if (text(v.description).length > 2000) return 'La descripción puede tener hasta 2000 caracteres.';
            if (text(v.contactEmail) && !EMAIL_RE.test(text(v.contactEmail))) return 'El email de contacto no parece válido.';
            if (text(v.billingEmail) && !EMAIL_RE.test(text(v.billingEmail))) return 'El email de facturación no parece válido.';
            if (!isHttpUrl(v.website)) return 'El sitio web tiene que empezar con http:// o https://.';
            return null;
        }
        if (step === 3) {
            if (!/^[A-Z]{3}$/.test(text(v.currency).toUpperCase())) return 'Elegí la moneda de tus precios.';
            const discount = toAmount(v.discount);
            if (discount === undefined || (discount != null && (discount < 0 || discount > 60))) {
                return 'El descuento We Ötzi tiene que estar entre 0 y 60%.';
            }
            for (const [key, label] of [['minOrder', 'La compra mínima'], ['freeShipping', 'El monto de envío gratis']]) {
                const amount = toAmount(v[key]);
                if (amount === undefined || (amount != null && amount < 0)) return label + ' tiene que ser un número mayor o igual a 0.';
            }
            const lead = toAmount(v.leadTime);
            if (lead === undefined || (lead != null && (!Number.isInteger(lead) || lead < 0 || lead > 365))) {
                return 'El plazo de entrega va en días enteros, de 0 a 365.';
            }
            const countries = parseCountries(v.shipsTo);
            if (countries.invalid.length) return 'Revisá los países de envío: usá códigos de 2 letras (por ejemplo AR, UY).';
            const benefits = Array.isArray(v.benefits) ? v.benefits : [];
            if (benefits.length > 10) return 'Podés cargar hasta 10 beneficios.';
            if (benefits.some(item => text(item).length > 160)) return 'Cada beneficio puede tener hasta 160 caracteres.';
            return null;
        }
        return null;
    }

    // Perfil para complete_supply_vendor_registration (claves de su lista
    // blanca). email y password van aparte: el borrador nunca los guarda.
    function buildPayload(values) {
        const v = values || {};
        const opt = s => (text(s) ? text(s) : null);
        const discount = toAmount(v.discount);
        const privateData = {
            legal_name: opt(v.legalName),
            tax_id: opt(v.taxId),
            fiscal_address: opt(v.fiscalAddress),
            billing_email: opt(v.billingEmail)
        };
        const profile = {
            name: text(v.name),
            description: opt(v.description),
            country: opt(v.country),
            city: opt(v.city),
            phone: opt(v.phone),
            whatsapp: opt(v.whatsapp),
            contact_email: opt(v.contactEmail),
            instagram: opt(v.instagram),
            website: opt(v.website),
            currency: text(v.currency).toUpperCase() || 'ARS',
            platform_discount_pct: discount == null ? 0 : discount,
            min_order_amount: toAmount(v.minOrder) == null ? null : toAmount(v.minOrder),
            free_shipping_threshold: toAmount(v.freeShipping) == null ? null : toAmount(v.freeShipping),
            lead_time_days: toAmount(v.leadTime) == null ? null : toAmount(v.leadTime),
            ships_to_countries: parseCountries(v.shipsTo).items,
            benefits: (Array.isArray(v.benefits) ? v.benefits : []).map(text).filter(Boolean).slice(0, 10)
        };
        Object.keys(profile).forEach(key => { if (profile[key] === null) delete profile[key]; });
        const cleanPrivate = {};
        Object.keys(privateData).forEach(key => { if (privateData[key] !== null) cleanPrivate[key] = privateData[key]; });
        if (Object.keys(cleanPrivate).length) profile.private = cleanPrivate;
        return {
            email: text(v.email),
            password: v.password || '',
            ...profile
        };
    }

    // Filas del resumen del paso 3: [clave, valor] ya en texto.
    function summaryRows(values, fmtMoney) {
        const v = values || {};
        const money = typeof fmtMoney === 'function' ? fmtMoney : (n, cur) => cur + ' ' + n;
        const cur = text(v.currency).toUpperCase() || 'ARS';
        const amount = key => {
            const n = toAmount(v[key]);
            return n == null || n === undefined ? null : money(n, cur);
        };
        const countries = parseCountries(v.shipsTo).items;
        const discount = toAmount(v.discount);
        return [
            ['Tienda', text(v.name) || '—'],
            ['Email de acceso', text(v.email) || '—'],
            ['Ubicación', [text(v.city), text(v.country)].filter(Boolean).join(', ') || '—'],
            ['Moneda', cur],
            ['Descuento We Ötzi', (discount == null || discount === undefined ? 0 : discount) + ' %'],
            ['Compra mínima', amount('minOrder') || 'Sin mínimo'],
            ['Envío gratis desde', amount('freeShipping') || 'Sin envío gratis'],
            ['Envíos a', countries.length ? countries.join(', ') : 'Todos los países'],
            ['Beneficios', String((Array.isArray(v.benefits) ? v.benefits : []).filter(b => text(b)).length)]
        ];
    }

    // -------------------------------------------------------------
    // DOM
    // -------------------------------------------------------------
    let currentStep = 1;
    let existingSession = null;
    let benefitsEditor = null;

    function doc() { return root && root.document; }
    function el(id) { return doc().getElementById(id); }
    function kit() { return root && root.WeOtziStudioKit; }
    function auth() { return root && root.WeOtziSuppliesAuth; }

    function escapeHtml(v) {
        const k = kit();
        if (k && typeof k.escapeHtml === 'function') return k.escapeHtml(v);
        return String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function readValues() {
        const val = id => (el(id) ? el(id).value : '');
        return {
            email: val('reg-email'),
            password: val('reg-password'),
            passwordConfirm: val('reg-password-confirm'),
            name: val('reg-name'),
            description: val('reg-description'),
            country: val('reg-country'),
            city: val('reg-city'),
            phone: val('reg-phone'),
            whatsapp: val('reg-whatsapp'),
            contactEmail: val('reg-contact-email'),
            instagram: val('reg-instagram'),
            website: val('reg-website'),
            legalName: val('reg-legal-name'),
            taxId: val('reg-tax-id'),
            fiscalAddress: val('reg-fiscal-address'),
            billingEmail: val('reg-billing-email'),
            currency: val('reg-currency'),
            discount: val('reg-discount'),
            minOrder: val('reg-min-order'),
            freeShipping: val('reg-free-shipping'),
            leadTime: val('reg-lead-time'),
            shipsTo: val('reg-ships-to'),
            benefits: benefitsEditor ? benefitsEditor.getItems() : []
        };
    }

    function showStatus(kind, message) {
        const node = el('wizard-status');
        if (!node) return;
        node.className = 'studio-status studio-status-' + kind;
        node.setAttribute('role', kind === 'error' ? 'alert' : 'status');
        node.textContent = message;
        node.hidden = false;
    }
    function clearStatus() {
        const node = el('wizard-status');
        if (node) node.hidden = true;
    }

    function renderStep() {
        doc().querySelectorAll('.studio-wizard-step').forEach(step => {
            step.classList.toggle('is-active', Number(step.dataset.step) === currentStep);
        });
        doc().querySelectorAll('#wizard-rail .studio-wizard-pill').forEach(pill => {
            const n = Number(pill.dataset.step);
            pill.classList.toggle('is-active', n === currentStep);
            pill.classList.toggle('is-done', n < currentStep);
            if (n === currentStep) pill.setAttribute('aria-current', 'step');
            else pill.removeAttribute('aria-current');
        });
        el('wizard-prev').disabled = currentStep === 1;
        el('wizard-next').innerHTML = currentStep === TOTAL_STEPS
            ? '<i class="fa-solid fa-store"></i> Crear cuenta'
            : 'Continuar <i class="fa-solid fa-arrow-right"></i>';
        if (currentStep === TOTAL_STEPS) renderSummary();
    }

    function renderSummary() {
        const grid = el('confirm-summary');
        if (!grid) return;
        const k = kit();
        const rows = summaryRows(readValues(), k && k.fmtMoney);
        grid.innerHTML = rows.map(([key, value]) => '<div class="studio-meta-row">'
            + '<span class="key">' + escapeHtml(key) + '</span>'
            + '<span class="val">' + escapeHtml(value) + '</span></div>').join('');
    }

    function validateCurrent(step) {
        clearStatus();
        const message = validateStep(step, readValues(), { hasSession: !!existingSession });
        if (message) { showStatus('error', message); return false; }
        return true;
    }

    function mountCurrencySelect() {
        const select = el('reg-currency');
        if (!select) return;
        const k = kit();
        if (k && typeof k.currencyOptionsHtml === 'function') select.innerHTML = k.currencyOptionsHtml('ARS');
        else select.innerHTML = ISO_FALLBACK.map(c => '<option value="' + c + '"' + (c === 'ARS' ? ' selected' : '') + '>' + c + '</option>').join('');
    }

    function mountBenefits() {
        const host = el('reg-benefits');
        const k = kit();
        if (!host || !k || typeof k.listEditor !== 'function') return;
        benefitsEditor = k.listEditor({
            items: [], max: 10, maxLen: 160,
            placeholder: 'Escribí un beneficio y presioná Enter',
            label: 'Agregar beneficio',
            onChange: () => { if (currentStep === TOTAL_STEPS) renderSummary(); }
        });
        if (benefitsEditor.el) host.appendChild(benefitsEditor.el);
    }

    function wireNav() {
        el('wizard-prev').addEventListener('click', () => {
            if (currentStep > 1) { currentStep--; renderStep(); clearStatus(); }
        });
        el('wizard-next').addEventListener('click', async () => {
            if (!validateCurrent(currentStep)) return;
            if (currentStep < TOTAL_STEPS) {
                currentStep++;
                renderStep();
                return;
            }
            await submit();
        });
        ['reg-currency', 'reg-discount', 'reg-min-order', 'reg-free-shipping', 'reg-ships-to'].forEach(id => {
            const node = el(id);
            if (node) node.addEventListener('input', () => { if (currentStep === TOTAL_STEPS) renderSummary(); });
        });
    }

    async function submit() {
        for (let step = 1; step <= TOTAL_STEPS; step++) {
            if (!validateCurrent(step)) { currentStep = step; renderStep(); return; }
        }
        const button = el('wizard-next');
        button.disabled = true;
        button.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Creando cuenta…';
        try {
            const result = await auth().register(buildPayload(readValues()));
            if (result && result.confirmationRequired) {
                showStatus('success', 'Revisá ' + result.email + ' y confirmá tu correo. Al abrir el enlace terminamos de crear tu cuenta con estos datos.');
                button.textContent = 'Esperando confirmación del correo';
                el('wizard-prev').disabled = true;
                return;
            }
            showStatus('success', '¡Cuenta creada! Te llevamos a tu panel…');
            setTimeout(() => { root.location.href = auth().appUrl('/supplies/dashboard'); }, 600);
        } catch (err) {
            console.error('[supplies-register] submit failed:', err);
            button.disabled = false;
            button.innerHTML = '<i class="fa-solid fa-store"></i> Crear cuenta';
            const msg = String((auth() && auth().friendlyError ? auth().friendlyError(err) : err && err.message) || err);
            if (/already registered|already exists|ya existe/i.test(msg)) {
                showStatus('error', 'Ya existe una cuenta con ese email. Probá iniciar sesión.');
            } else {
                showStatus('error', 'No pudimos crear la cuenta: ' + msg);
            }
        }
    }

    async function boot() {
        if (!doc() || !el('wizard-next') || !auth()) return;
        mountCurrencySelect();
        mountBenefits();
        wireNav();
        renderStep();
        try {
            const client = await auth().ready();
            const { data } = await client.auth.getSession();
            existingSession = (data && data.session) || null;
        } catch (err) {
            console.warn('[supplies-register] session check failed:', err);
        }
        if (existingSession) {
            el('reg-email').value = existingSession.user.email || '';
            el('reg-email').readOnly = true;
            ['reg-password', 'reg-password-confirm'].forEach(id => {
                const field = el(id).closest('.studio-field');
                if (field) field.hidden = true;
            });
            showStatus('info', 'Completá los datos de tu tienda para asociarla a tu cuenta actual.');
        }
        try {
            if (typeof auth().isAvailable === 'function' && !await auth().isAvailable()) {
                showStatus('info', 'El registro de Supplies todavía no está disponible (falta aplicar una migración). Volvé a intentarlo más tarde.');
                el('wizard-next').disabled = true;
            }
        } catch (err) {
            console.warn('[supplies-register] availability check failed:', err);
        }
    }

    return { boot, validateStep, buildPayload, parseCountries, toAmount, summaryRows, TOTAL_STEPS };
});
