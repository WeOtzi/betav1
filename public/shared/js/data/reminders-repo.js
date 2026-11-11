/**
 * WE OTZI - Repositorio de Recordatorios del artista (frontend)
 * --------------------------------------------------------------
 * Figma final del flujo de artista (oct 2026) · frames 801:563 / 801:560 /
 * 801:1109. Tabla public.artist_reminders + bucket privado
 * artist-reminder-files (migración 20261028110000_artist_reminders.sql).
 *
 * Respaldo: mientras la migración no esté aplicada, los recordatorios se
 * guardan en user_preferences.app_settings.reminders con el mismo formato
 * (la migración los copia a la tabla). Los adjuntos solo funcionan con la
 * tabla + bucket; sin ellos se informa con un mensaje claro.
 *
 * Carga: DESPUÉS de postgrest-client.js y account-repo.js (usa WeotziData.Prefs
 * en modo respaldo). Expone window.WeotziData.Reminders. En Node exporta el
 * modelo puro (tests/figma-final-dashboard.test.js).
 */
(function (root) {
    'use strict';

    var TABLE = 'artist_reminders';
    var BUCKET = 'artist-reminder-files';
    var MAX_FILE_BYTES = 10 * 1024 * 1024;
    var MAX_ATTACHMENTS = 10;
    var ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];

    // Orden del selector de íconos del Figma (801:1109): 3 filas × 6.
    var ICONS = [
        'droplet', 'edit', 'message-circle', 'dollar-sign', 'calendar', 'clock',
        'star', 'alert-triangle', 'bell', 'check-circle', 'image', 'pen-tool',
        'users', 'briefcase', 'map-pin', 'send', 'zap', 'heart'
    ];
    var PRIORITIES = ['urgente', 'alta', 'normal', 'baja'];
    var PRIORITY_RANK = { urgente: 0, alta: 1, normal: 2, baja: 3 };
    // Formato legacy { text, type, done } → ícono Feather equivalente.
    var LEGACY_TYPE_ICON = {
        stock: 'droplet', sketch: 'edit', message: 'message-circle',
        payment: 'dollar-sign', session: 'calendar', travel: 'map-pin'
    };
    var MONTHS_SHORT = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
    var MONTHS_LONG = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
        'septiembre', 'octubre', 'noviembre', 'diciembre'];

    /* ============================== modelo puro ============================== */
    function pad2(n) { return String(n).padStart(2, '0'); }

    function isoDateLocal(date) {
        var d = date instanceof Date ? date : new Date(date);
        if (isNaN(d.getTime())) return null;
        return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    }

    function cleanDate(value) {
        if (value == null || value === '') return null;
        var text = String(value).trim();
        var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
        if (!m) return null;
        var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
        if (d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) return null;
        return m[1] + '-' + m[2] + '-' + m[3];
    }

    function parseDate(iso) {
        var clean = cleanDate(iso);
        if (!clean) return null;
        var p = clean.split('-');
        return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    }

    // "02 JUL" · fila del rail (Figma 516:5924).
    function formatShortDate(iso) {
        var d = parseDate(iso);
        return d ? pad2(d.getDate()) + ' ' + MONTHS_SHORT[d.getMonth()] : '';
    }

    // "2 de julio de 2026" · detalle (Figma 512:2035).
    function formatLongDate(iso) {
        var d = parseDate(iso);
        return d ? d.getDate() + ' de ' + MONTHS_LONG[d.getMonth()] + ' de ' + d.getFullYear() : 'Sin fecha';
    }

    function cleanAttachments(list) {
        if (!Array.isArray(list)) return [];
        return list.filter(function (a) { return a && typeof a === 'object' && a.path; }).slice(0, MAX_ATTACHMENTS).map(function (a) {
            return {
                name: String(a.name || String(a.path).split('/').pop()).slice(0, 180),
                path: String(a.path),
                size: Number(a.size) || 0,
                mime: a.mime ? String(a.mime) : null
            };
        });
    }

    // Normaliza una fila de la tabla o un item legacy de app_settings.
    function normalize(row, index) {
        var r = row && typeof row === 'object' ? row : {};
        var title = String(r.title || r.text || '').trim();
        var icon = ICONS.indexOf(r.icon) !== -1 ? r.icon : (LEGACY_TYPE_ICON[r.type] || 'bell');
        var priority = PRIORITIES.indexOf(r.priority) !== -1 ? r.priority : 'normal';
        var completed = r.completed_at || (r.done ? (r.updated_at || r.created_at || new Date(0).toISOString()) : null);
        return {
            id: r.id ? String(r.id) : 'legacy-' + (index || 0),
            title: title,
            detail: r.detail ? String(r.detail) : '',
            icon: icon,
            due_date: cleanDate(r.due_date),
            priority: priority,
            is_important: r.is_important === undefined || r.is_important === null ? true : Boolean(r.is_important),
            attachments: cleanAttachments(r.attachments),
            completed_at: completed || null,
            created_at: r.created_at || null,
            updated_at: r.updated_at || null
        };
    }

    // Abiertos primero; luego por fecha (sin fecha al final), prioridad y alta.
    function sort(list) {
        return (list || []).slice().sort(function (a, b) {
            var doneA = a.completed_at ? 1 : 0;
            var doneB = b.completed_at ? 1 : 0;
            if (doneA !== doneB) return doneA - doneB;
            if (doneA && doneB) return String(b.completed_at).localeCompare(String(a.completed_at));
            var da = a.due_date || '9999-12-31';
            var db = b.due_date || '9999-12-31';
            if (da !== db) return da < db ? -1 : 1;
            var pa = PRIORITY_RANK[a.priority] == null ? 2 : PRIORITY_RANK[a.priority];
            var pb = PRIORITY_RANK[b.priority] == null ? 2 : PRIORITY_RANK[b.priority];
            if (pa !== pb) return pa - pb;
            return String(a.created_at || '').localeCompare(String(b.created_at || ''));
        });
    }

    function validationError(message) {
        var e = new Error(message);
        e.code = 'VALIDATION';
        return e;
    }

    // Valida y convierte la entrada del formulario en columnas de la tabla.
    // `partial` permite patches (solo valida lo que viene).
    function toRow(input, partial) {
        var src = input || {};
        var out = {};
        if (!partial || 'title' in src) {
            var title = String(src.title == null ? '' : src.title).replace(/\s+/g, ' ').trim();
            if (!title) throw validationError('Escribí un título para el recordatorio.');
            if (title.length > 140) throw validationError('El título puede tener hasta 140 caracteres.');
            out.title = title;
        }
        if (!partial || 'detail' in src) {
            var detail = String(src.detail == null ? '' : src.detail).trim();
            if (detail.length > 2000) throw validationError('El detalle puede tener hasta 2000 caracteres.');
            out.detail = detail || null;
        }
        if (!partial || 'icon' in src) out.icon = ICONS.indexOf(src.icon) !== -1 ? src.icon : 'bell';
        if (!partial || 'due_date' in src) {
            if (src.due_date && !cleanDate(src.due_date)) throw validationError('Elegí una fecha válida.');
            out.due_date = cleanDate(src.due_date);
        }
        if (!partial || 'priority' in src) out.priority = PRIORITIES.indexOf(src.priority) !== -1 ? src.priority : 'normal';
        if (!partial || 'is_important' in src) out.is_important = src.is_important === undefined ? true : Boolean(src.is_important);
        if (!partial || 'attachments' in src) out.attachments = cleanAttachments(src.attachments);
        if ('completed_at' in src) out.completed_at = src.completed_at || null;
        return out;
    }

    // Recordatorios abiertos que vencen entre hoy y `days` días (notificaciones).
    function dueSoon(list, now, days) {
        var base = now instanceof Date ? now : new Date();
        var today = isoDateLocal(base);
        var limitDate = new Date(base.getFullYear(), base.getMonth(), base.getDate() + (days == null ? 1 : days));
        var limit = isoDateLocal(limitDate);
        return (list || []).filter(function (r) {
            return !r.completed_at && r.due_date && r.due_date <= limit && r.due_date >= today;
        });
    }

    function overdue(list, now) {
        var today = isoDateLocal(now instanceof Date ? now : new Date());
        return (list || []).filter(function (r) { return !r.completed_at && r.due_date && r.due_date < today; });
    }

    function validateFile(file) {
        if (!file) throw validationError('Elegí un archivo.');
        if (file.size > MAX_FILE_BYTES) throw validationError('Cada archivo puede pesar hasta 10 MB.');
        var mime = String(file.type || '').toLowerCase();
        var name = String(file.name || '').toLowerCase();
        var okMime = ALLOWED_MIME.indexOf(mime) !== -1 || /\.(jpe?g|png|webp|heic|heif|pdf)$/.test(name);
        if (!okMime) throw validationError('Solo se aceptan imágenes (JPG, PNG, WEBP, HEIC) o PDF.');
        return true;
    }

    function safeFileName(name) {
        var base = String(name || 'archivo').normalize('NFD').replace(/[̀-ͯ]/g, '');
        base = base.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
        return (base || 'archivo').slice(-80);
    }

    function newId() {
        try {
            if (root && root.crypto && typeof root.crypto.randomUUID === 'function') return root.crypto.randomUUID();
        } catch (e) { /* sigue */ }
        return 'rem-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    }

    var Model = {
        TABLE: TABLE, BUCKET: BUCKET, ICONS: ICONS, PRIORITIES: PRIORITIES, PRIORITY_RANK: PRIORITY_RANK,
        LEGACY_TYPE_ICON: LEGACY_TYPE_ICON, MAX_FILE_BYTES: MAX_FILE_BYTES, MAX_ATTACHMENTS: MAX_ATTACHMENTS,
        normalize: normalize, sort: sort, toRow: toRow, cleanDate: cleanDate, isoDateLocal: isoDateLocal,
        formatShortDate: formatShortDate, formatLongDate: formatLongDate, dueSoon: dueSoon, overdue: overdue,
        validateFile: validateFile, safeFileName: safeFileName
    };

    if (typeof module === 'object' && module.exports) {
        module.exports = Model;
        return;
    }

    /* ============================== repositorio ============================== */
    var D = root.WeotziData;
    if (!D || typeof D.run !== 'function') {
        console.error('[reminders-repo] postgrest-client.js debe cargarse antes.');
        return;
    }
    var run = D.run;
    var backendPromise = null;

    function isMissingTable(err) {
        var cause = (err && err.cause) || err || {};
        var code = String(cause.code || (err && err.code) || '');
        var msg = String(cause.message || (err && err.message) || '');
        return code === '42P01' || code === 'PGRST205' || code === 'PGRST202' || code === 'PREVIEW_UNSUPPORTED'
            || /does not exist|schema cache|could not find the table|no simulad/i.test(msg);
    }

    // 'table' si la migración está aplicada; 'prefs' como respaldo.
    function backend() {
        if (!backendPromise) {
            backendPromise = run('reminders.probe', function (c) {
                return c.from(TABLE).select('id', { count: 'exact', head: true });
            }).then(function () { return 'table'; }).catch(function (err) {
                if (!isMissingTable(err)) console.warn('[reminders-repo] probe:', err && err.message);
                return 'prefs';
            });
        }
        return backendPromise;
    }

    function requirePrefs() {
        if (!D.Prefs || typeof D.Prefs.get !== 'function') {
            throw new Error('No pudimos guardar el recordatorio: falta account-repo.js en la página.');
        }
        return D.Prefs;
    }

    async function readPrefsList(userId) {
        var row = await requirePrefs().get(userId);
        var app = (row && row.app_settings) || {};
        var raw = Array.isArray(app.reminders) ? app.reminders : [];
        return raw.map(normalize).filter(function (r) { return r.title; });
    }

    async function writePrefsList(userId, list) {
        var plain = list.map(function (r) {
            return {
                id: r.id, title: r.title, text: r.title, detail: r.detail || null, icon: r.icon,
                due_date: r.due_date, priority: r.priority, is_important: r.is_important,
                attachments: [], completed_at: r.completed_at, done: Boolean(r.completed_at),
                created_at: r.created_at, updated_at: r.updated_at
            };
        });
        await requirePrefs().saveSection(userId, 'app_settings', { reminders: plain });
    }

    var Reminders = {
        model: Model,
        backend: backend,

        async list(userId) {
            if (!userId) return [];
            if ((await backend()) === 'prefs') return sort(await readPrefsList(userId));
            var res = await run('reminders.list', function (c) {
                return c.from(TABLE).select('*').eq('artist_user_id', userId)
                    .order('created_at', { ascending: true }).limit(200);
            });
            return sort((res.data || []).map(normalize));
        },

        async create(userId, input) {
            var row = toRow(input, false);
            row.artist_user_id = userId;
            if ((await backend()) === 'prefs') {
                if (row.attachments.length) throw validationError('Los adjuntos se habilitan cuando se aplique la migración de recordatorios.');
                var now = new Date().toISOString();
                var list = await readPrefsList(userId);
                var item = normalize(Object.assign({}, row, { id: newId(), created_at: now, updated_at: now }));
                list.push(item);
                await writePrefsList(userId, list);
                return item;
            }
            var res = await run('reminders.create', function (c) {
                return c.from(TABLE).insert([row]).select('*').single();
            });
            return normalize(res.data);
        },

        async update(userId, id, patch) {
            var row = toRow(patch, true);
            if ((await backend()) === 'prefs') {
                if (row.attachments && row.attachments.length) throw validationError('Los adjuntos se habilitan cuando se aplique la migración de recordatorios.');
                var list = await readPrefsList(userId);
                var idx = list.findIndex(function (r) { return r.id === String(id); });
                if (idx === -1) throw new Error('No encontramos ese recordatorio.');
                list[idx] = normalize(Object.assign({}, list[idx], row, { id: list[idx].id, updated_at: new Date().toISOString() }));
                await writePrefsList(userId, list);
                return list[idx];
            }
            var res = await run('reminders.update', function (c) {
                return c.from(TABLE).update(row).eq('id', id).eq('artist_user_id', userId).select('*').single();
            });
            return normalize(res.data);
        },

        setCompleted(userId, id, done) {
            return this.update(userId, id, { completed_at: done ? new Date().toISOString() : null });
        },

        async remove(userId, id, attachments) {
            if ((await backend()) === 'prefs') {
                var list = await readPrefsList(userId);
                await writePrefsList(userId, list.filter(function (r) { return r.id !== String(id); }));
                return true;
            }
            await run('reminders.remove', function (c) {
                return c.from(TABLE).delete().eq('id', id).eq('artist_user_id', userId);
            });
            var paths = cleanAttachments(attachments).map(function (a) { return a.path; });
            if (paths.length) await this.removeFiles(paths).catch(function () { /* limpieza best-effort */ });
            return true;
        },

        // Sube un archivo al bucket privado y devuelve su descriptor.
        async uploadAttachment(userId, file) {
            validateFile(file);
            if ((await backend()) === 'prefs') {
                throw validationError('Los adjuntos se habilitan cuando se aplique la migración de recordatorios.');
            }
            var client = D.getClient();
            if (!client || !client.storage) throw new Error('No pudimos conectar con el almacenamiento.');
            var path = userId + '/' + newId() + '-' + safeFileName(file.name);
            var result = await client.storage.from(BUCKET).upload(path, file, {
                upsert: false, contentType: file.type || undefined, cacheControl: '3600'
            });
            if (result && result.error) {
                var msg = String(result.error.message || '');
                throw new Error(/no simulad/i.test(msg)
                    ? 'La subida de archivos no está disponible en esta vista previa.'
                    : 'No pudimos subir ' + (file.name || 'el archivo') + '. Probá de nuevo.');
            }
            return { name: String(file.name || 'archivo').slice(0, 180), path: path, size: file.size || 0, mime: file.type || null };
        },

        async signedUrl(path) {
            var client = D.getClient();
            if (!client || !client.storage) throw new Error('No pudimos conectar con el almacenamiento.');
            var result = await client.storage.from(BUCKET).createSignedUrl(path, 600);
            if (result.error || !result.data) throw new Error('No pudimos abrir el archivo.');
            return result.data.signedUrl;
        },

        async removeFiles(paths) {
            var client = D.getClient();
            if (!client || !client.storage || !paths || !paths.length) return;
            await client.storage.from(BUCKET).remove(paths);
        }
    };

    D.Reminders = Reminders;
}(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this)));
