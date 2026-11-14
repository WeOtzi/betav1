// ============================================
// WE ÖTZI - BACKOFFICE: Cookies y privacidad (grupo "privacidad")
// Edita app_settings.cookie_consent_config vía /api/admin/privacy/cookie-config
// (solo superadmin). El banner (wo-consent.js) lee la versión pública.
// ============================================
(function () {
    'use strict';

    var TEXT_KEYS = ['title', 'body', 'accept_all', 'reject', 'configure', 'save', 'gpc_notice'];
    var current = null;

    function $(id) { return document.getElementById(id); }

    function toast(msg, kind) {
        if (typeof window.showToast === 'function') window.showToast(msg, kind || 'info');
    }

    function setStatus(msg, isError) {
        var box = $('privacy-status');
        if (!box) return;
        box.textContent = msg;
        box.style.borderColor = isError ? '#c0392b' : '';
    }

    async function authHeaders() {
        var client = (window.ConfigManager && window.ConfigManager.getSupabaseClient && window.ConfigManager.getSupabaseClient()) || window.supabaseClient || null;
        if (!client || !client.auth) return null;
        try {
            var res = await client.auth.getSession();
            var token = res && res.data && res.data.session && res.data.session.access_token;
            return token ? { Authorization: 'Bearer ' + token } : null;
        } catch (_) { return null; }
    }

    function apiUrl(path) {
        var base = window.WEOTZI_BASE_PATH ? String(window.WEOTZI_BASE_PATH).replace(/\/$/, '') : '';
        return base + path;
    }

    function field(labelText, input, help) {
        var wrap = document.createElement('div');
        wrap.className = 'form-group';
        var label = document.createElement('label');
        label.setAttribute('for', input.id);
        label.textContent = labelText;
        wrap.appendChild(label);
        wrap.appendChild(input);
        if (help) {
            var small = document.createElement('small');
            small.textContent = help;
            wrap.appendChild(small);
        }
        return wrap;
    }

    function input(type, id, value, attrs) {
        var el = document.createElement(type === 'textarea' ? 'textarea' : 'input');
        if (type !== 'textarea') el.type = type;
        el.id = id;
        if (type === 'checkbox') el.checked = !!value; else el.value = value == null ? '' : value;
        Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, attrs[k]); });
        return el;
    }

    function checkboxRow(id, checked, text, disabled) {
        var wrap = document.createElement('div');
        wrap.className = 'form-group';
        var label = document.createElement('label');
        var cb = input('checkbox', id, checked);
        if (disabled) cb.disabled = true;
        label.appendChild(cb);
        label.appendChild(document.createTextNode(' ' + text));
        wrap.appendChild(label);
        return wrap;
    }

    function renderCategories(categories) {
        var host = $('privacy-categories');
        host.textContent = '';
        categories.forEach(function (c) {
            var box = document.createElement('fieldset');
            box.style.cssText = 'border:1px solid #ddd;padding:12px;margin:0 0 12px;';
            var legend = document.createElement('legend');
            legend.textContent = c.id === 'necessary' ? 'Necesarias (siempre activas)' : (c.id === 'analytics' ? 'Analítica' : 'Marketing');
            box.appendChild(legend);
            box.appendChild(checkboxRow('privacy-cat-' + c.id + '-enabled', c.enabled, c.required ? 'Siempre activa' : 'Mostrar esta categoría en el banner', c.required));
            box.appendChild(field('Nombre', input('text', 'privacy-cat-' + c.id + '-label', c.label, { maxlength: '40' })));
            box.appendChild(field('Descripción', input('textarea', 'privacy-cat-' + c.id + '-description', c.description, { maxlength: '300', rows: '3' })));
            host.appendChild(box);
        });
    }

    function renderScripts(scripts, envClarity) {
        var host = $('privacy-scripts');
        host.textContent = '';
        var note = document.createElement('p');
        note.textContent = 'Solo se cargan con el consentimiento de su categoría. Tipos soportados: Microsoft Clarity. ' +
            (envClarity ? 'El servidor tiene CLARITY_PROJECT_ID configurado: se usa si dejás el ID vacío.' : 'Sin ID no se carga nada.');
        host.appendChild(note);
        scripts.forEach(function (s, i) {
            var box = document.createElement('fieldset');
            box.style.cssText = 'border:1px solid #ddd;padding:12px;margin:0 0 12px;';
            box.setAttribute('data-privacy-script', String(i));
            var legend = document.createElement('legend');
            legend.textContent = s.provider + ' · categoría ' + s.category;
            box.appendChild(legend);
            box.appendChild(checkboxRow('privacy-script-' + i + '-enabled', s.enabled, 'Activo'));
            box.appendChild(field('ID de proyecto de Clarity', input('text', 'privacy-script-' + i + '-project_id', s.project_id, { maxlength: '20', pattern: '[A-Za-z0-9]{6,20}', placeholder: 'ej. abcd1234ef' }), 'Lo encontrás en clarity.microsoft.com → Settings → Overview.'));
            box.appendChild(field('Rutas excluidas (una por línea)', input('textarea', 'privacy-script-' + i + '-exclude', (s.exclude_paths || []).join('\n'), { rows: '2' })));
            host.appendChild(box);
        });
    }

    function render(data) {
        var cfg = data.config;
        current = cfg;
        $('privacy-enabled').checked = !!cfg.enabled;
        $('privacy-version').value = cfg.version;
        $('privacy-renew').value = cfg.renew_days;
        $('privacy-policy-url').value = cfg.policy_url;
        TEXT_KEYS.forEach(function (k) { var el = $('privacy-text-' + k); if (el) el.value = cfg.texts[k] || ''; });
        renderCategories(cfg.categories);
        renderScripts(cfg.scripts, data.env_clarity_configured);
        setStatus((data.stored ? 'Configuración guardada' : 'Usando valores por defecto (todavía no se guardó)') +
            (data.updated_at ? ' · última edición ' + new Date(data.updated_at).toLocaleString('es-AR') : '') +
            ' · versión vigente ' + cfg.version + '.');
    }

    function collect() {
        var cfg = {
            enabled: $('privacy-enabled').checked,
            version: $('privacy-version').value.trim(),
            renew_days: Number($('privacy-renew').value),
            policy_url: $('privacy-policy-url').value.trim() || '/legal/privacy#cookies',
            texts: {},
            categories: [],
            scripts: []
        };
        TEXT_KEYS.forEach(function (k) { cfg.texts[k] = $('privacy-text-' + k).value; });
        (current ? current.categories : []).forEach(function (c) {
            cfg.categories.push({
                id: c.id,
                label: $('privacy-cat-' + c.id + '-label').value,
                description: $('privacy-cat-' + c.id + '-description').value,
                enabled: c.required ? true : $('privacy-cat-' + c.id + '-enabled').checked
            });
        });
        (current ? current.scripts : []).forEach(function (s, i) {
            cfg.scripts.push({
                id: s.id,
                type: s.type,
                provider: s.provider,
                category: s.category,
                enabled: $('privacy-script-' + i + '-enabled').checked,
                project_id: $('privacy-script-' + i + '-project_id').value.trim(),
                exclude_paths: $('privacy-script-' + i + '-exclude').value.split(/\r?\n/).map(function (p) { return p.trim(); }).filter(Boolean)
            });
        });
        return cfg;
    }

    async function loadPrivacyAdmin() {
        setStatus('Cargando configuración…');
        var headers = await authHeaders();
        if (!headers) { setStatus('Iniciá sesión como superadmin para editar esta sección.', true); return; }
        try {
            var res = await fetch(apiUrl('/api/admin/privacy/cookie-config'), { headers: headers });
            var data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || ('HTTP ' + res.status));
            render(data);
        } catch (err) {
            setStatus('No se pudo leer la configuración: ' + err.message, true);
        }
    }

    async function savePrivacyAdmin() {
        if (!current) return;
        var cfg = collect();
        var versionChanged = cfg.version !== current.version;
        if (versionChanged && !window.confirm('Cambiaste la versión del consentimiento (' + current.version + ' → ' + cfg.version + '). Se le va a volver a pedir el consentimiento a todas las personas. ¿Guardar?')) return;
        var headers = await authHeaders();
        if (!headers) { setStatus('Iniciá sesión como superadmin para guardar.', true); return; }
        var btn = $('privacy-save-btn');
        btn.disabled = true;
        try {
            var res = await fetch(apiUrl('/api/admin/privacy/cookie-config'), {
                method: 'PUT',
                headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
                body: JSON.stringify({ config: cfg })
            });
            var data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || ('HTTP ' + res.status));
            render({ config: data.config, stored: true, updated_at: new Date().toISOString() });
            toast('Configuración de cookies guardada' + (versionChanged ? ' · se volverá a pedir el consentimiento' : ''), 'success');
        } catch (err) {
            setStatus('No se pudo guardar: ' + err.message, true);
            toast('No se pudo guardar: ' + err.message, 'error');
        } finally {
            btn.disabled = false;
        }
    }

    document.addEventListener('DOMContentLoaded', function () {
        var save = $('privacy-save-btn');
        if (!save) return;
        save.addEventListener('click', savePrivacyAdmin);
        $('privacy-reload-btn').addEventListener('click', loadPrivacyAdmin);
        $('privacy-version-today').addEventListener('click', function () {
            $('privacy-version').value = new Date().toISOString().slice(0, 10);
        });
        $('privacy-config-form').addEventListener('submit', function (e) { e.preventDefault(); savePrivacyAdmin(); });
    });

    window.loadPrivacyAdmin = loadPrivacyAdmin;
})();
