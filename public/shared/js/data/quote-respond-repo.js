/**
 * WE OTZI - Repositorio de la propuesta del artista (frontend)
 * ------------------------------------------------------------
 * Ronda 2 · frente cot-respuesta. Expone window.WeotziData.QuoteRespond.
 *
 * La propuesta pasa por el servidor (lib/routes/cot-respuesta.js): ahí se
 * cruzan las fechas ofrecidas con la agenda real y se guardan los campos de la
 * cotización manual (la RLS no deja escribirlos desde el navegador).
 *
 *   context(quoteId)                       → contexto del diálogo
 *   availability(quoteId, {from,to,minutes}) → agenda real por día
 *   save(quoteId, payload)                 → guarda (o valida con validate_only)
 *   syncAgreement(quoteId)                 → alinea el anticipo tras el acuerdo
 *
 * Las respuestas rápidas guardadas (artist_message_templates, kind 'quote')
 * van por la capa PostgREST con la RLS del dueño:
 *   listTemplates(userId) · saveTemplate(userId, {title, body, sort}) ·
 *   deleteTemplate(id)
 *
 * Carga: postgrest-client.js primero.
 */
(function () {
    'use strict';

    const D = window.WeotziData = window.WeotziData || {};
    const TEMPLATE_TABLE = 'artist_message_templates';
    const TEMPLATE_SELECT = 'id,user_id,kind,title,body,sort';
    const KIND = 'quote';

    function appPath(path) {
        if (window.WoDemo && typeof window.WoDemo.appPath === 'function') return window.WoDemo.appPath(path);
        const base = window.WEOTZI_BASE_PATH
            ? String(window.WEOTZI_BASE_PATH).replace(/\/$/, '')
            : (/^\/beta(?:\/|$)/.test(String(window.location.pathname || '')) ? '/beta' : '');
        return base && String(path).indexOf(base + '/') !== 0 ? base + path : path;
    }

    async function accessToken() {
        try {
            const client = typeof D.getClient === 'function' ? D.getClient()
                : (window.ConfigManager && window.ConfigManager.getSupabaseClient && window.ConfigManager.getSupabaseClient());
            const { data } = client ? await client.auth.getSession() : { data: null };
            return (data && data.session && data.session.access_token) || '';
        } catch (_error) {
            return '';
        }
    }

    function errorFrom(status, json, fallback) {
        const err = new Error((json && json.error) || fallback);
        err.userMessage = err.message;
        err.status = status;
        err.code = (json && json.code) || null;
        err.payload = json || {};
        return err;
    }

    async function api(path, { method = 'GET', body, fallback = 'No pudimos conectar con el servidor.' } = {}) {
        const headers = { Accept: 'application/json' };
        const token = await accessToken();
        if (token) headers.Authorization = `Bearer ${token}`;
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        let res;
        try {
            res = await fetch(appPath(path), {
                method, headers, credentials: 'same-origin', cache: 'no-store',
                body: body !== undefined ? JSON.stringify(body) : undefined,
            });
        } catch (_error) {
            throw errorFrom(0, null, 'No pudimos conectar con el servidor. Revisa tu conexión e intenta de nuevo.');
        }
        let json = null;
        try { json = await res.json(); } catch (_error) { json = null; }
        if (!res.ok || !json || json.success === false) throw errorFrom(res.status, json, fallback);
        return json;
    }

    function base(quoteId) {
        return `/api/cot-respuesta/quotations/${encodeURIComponent(String(quoteId))}`;
    }

    function qs(params) {
        const out = new URLSearchParams();
        Object.keys(params || {}).forEach((k) => { if (params[k] != null && params[k] !== '') out.set(k, params[k]); });
        const s = out.toString();
        return s ? `?${s}` : '';
    }

    // Tabla todavía sin crear (migración 20261116120000 sin aplicar) o preview.
    function isMissingSchema(error) {
        const code = String((error && (error.code || (error.cause && error.cause.code))) || '');
        if (['PGRST205', '42P01'].includes(code)) return true;
        const text = `${(error && error.message) || ''} ${(error && error.cause && error.cause.message) || ''}`;
        return /Could not find the table|does not exist|No simulado|PREVIEW_UNSUPPORTED/i.test(text);
    }

    const QuoteRespond = {
        isMissingSchema,

        context(quoteId) {
            return api(`${base(quoteId)}/proposal`, { fallback: 'No pudimos cargar la propuesta.' });
        },

        availability(quoteId, { from, to, minutes } = {}) {
            return api(`${base(quoteId)}/availability${qs({ from, to, minutes })}`, { fallback: 'No pudimos consultar tu agenda.' });
        },

        save(quoteId, payload) {
            return api(`${base(quoteId)}/proposal`, { method: 'POST', body: payload || {}, fallback: 'No pudimos guardar la propuesta. Intenta de nuevo.' });
        },

        syncAgreement(quoteId) {
            return api(`${base(quoteId)}/agreement-sync`, { method: 'POST', body: {}, fallback: 'No pudimos actualizar las condiciones del acuerdo.' });
        },

        // { available, rows }: available=false si la tabla todavía no existe.
        async listTemplates(userId) {
            try {
                const { data } = await D.run('quoteRespond.listTemplates', (c) =>
                    c.from(TEMPLATE_TABLE).select(TEMPLATE_SELECT)
                        .eq('user_id', userId).eq('kind', KIND)
                        .order('sort', { ascending: true }).limit(60)
                );
                return { available: true, rows: data || [] };
            } catch (error) {
                if (isMissingSchema(error)) return { available: false, rows: [] };
                throw error;
            }
        },

        async saveTemplate(userId, template) {
            const row = {
                user_id: userId, kind: KIND,
                title: String(template.title || '').trim(),
                body: String(template.body || '').trim(),
                sort: Number.isFinite(Number(template.sort)) ? Math.round(Number(template.sort)) : 0,
            };
            const { data } = await D.run('quoteRespond.saveTemplate', (c) =>
                c.from(TEMPLATE_TABLE).insert([row]).select(TEMPLATE_SELECT)
            );
            return Array.isArray(data) ? (data[0] || row) : (data || row);
        },

        async deleteTemplate(id) {
            await D.run('quoteRespond.deleteTemplate', (c) =>
                c.from(TEMPLATE_TABLE).delete().eq('id', id).eq('kind', KIND)
            );
        },
    };

    D.QuoteRespond = QuoteRespond;
}());
