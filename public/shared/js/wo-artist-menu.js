/**
 * WE OTZI - Menú del artista (tile Ö) + panel de notificaciones
 * -------------------------------------------------------------
 * Componente compartido de todas las páginas del artista (Figma final, oct
 * 2026: 801:559 "Menú de cuenta abierto" y 801:558 "Notificaciones
 * abiertas"). Se auto-inicializa en cualquier página que tenga el tile
 * `.wo-o-tile` en la topbar: con sesión de artista, el click abre el menú de
 * cuenta (identidad + actividad reciente + accesos) y desde ahí el panel de
 * notificaciones con un feed derivado de datos REALES:
 *   - mensajes sin leer   → vista chat_threads (unread_for_artist)
 *   - invitaciones        → studio_artist_memberships pending_acceptance
 *   - solicitudes/vencidas→ quotations_db del artista
 *   - reservas confirmadas→ quotation_sessions confirmadas en los últimos 7 días
 *   - recordatorios       → quotation_sessions próximas (48 h) + artist_reminders
 *                           que vencen hoy o mañana (reminders-repo.js)
 *   - postulaciones       → studio_spot_applications decididas (7 días) y
 *                           pendientes (job board + spots) para el contador
 *   - actualizaciones     → /shared/platform-updates.json (editable por deploy)
 * Estado de lectura: el chat usa su is_read real; el resto persiste recibos en
 * user_notification_reads y conserva localStorage como respaldo offline. Sin
 * sesión de artista el tile conserva su comportamiento original (link).
 * QA: ?menu=cuenta abre el menú · ?menu=notificaciones abre el panel.
 * Carga: DESPUÉS de config-manager y postgrest-client; el propio componente
 * completa sus repositorios de conteo.
 */
(function () {
    'use strict';

    var SEEN_KEY = 'wo_notif_seen_v1';
    var FEED_CAP = 20;
    var state = {
        user: null,
        artist: null,
        threads: [],
        feed: [],
        seen: null,
        counts: { msgs: 0, inv: 0, solic: 0, apps: 0, updates: 0 },
        open: false,
        panelOpen: false,
        suggestError: false,
    };
    var els = {};
    var SUGGEST_ERROR = 'No pudimos guardar el cambio. Probá de nuevo.';
    var SUGGEST_ERROR_MS = 6000;
    var suggestErrorTimer = 0;

    /* ------------------------------ utils ------------------------------ */
    // Rutas absolutas del producto respetando el base path (/beta, preview).
    function appPath(p) {
        var detected = /^\/beta(\/|$)/.test((window.location && window.location.pathname) || '') ? '/beta' : '';
        var base = String(window.WEOTZI_BASE_PATH || detected).replace(/\/$/, '');
        var s = String(p || '');
        if (!base || s.charAt(0) !== '/' || s.charAt(1) === '/' || s.indexOf(base + '/') === 0) return s;
        return base + s;
    }
    function esc(v) {
        return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function loadSeen() {
        if (state.seen) return state.seen;
        try { state.seen = new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); }
        catch (e) { state.seen = new Set(); }
        return state.seen;
    }
    function saveSeen(set) {
        state.seen = set;
        try { localStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(set).slice(-300))); }
        catch (e) { /* almacenamiento bloqueado */ }
    }
    async function loadRemoteSeen(D, uid) {
        var client = D && typeof D.getClient === 'function' ? D.getClient() : null;
        if (!client) return loadSeen();
        try {
            var result = await client.from('user_notification_reads')
                .select('notification_key')
                .eq('user_id', uid)
                .order('read_at', { ascending: false })
                .limit(500);
            if (result.error) throw result.error;
            var seen = loadSeen();
            (result.data || []).forEach(function (row) { if (row.notification_key) seen.add(row.notification_key); });
            saveSeen(seen);
            return seen;
        } catch (e) {
            // The local fallback keeps the menu usable during deploys/offline.
            console.warn('[wo-menu] lecturas remotas:', e && e.message);
            return loadSeen();
        }
    }
    function persistSeen(keys) {
        var clean = Array.from(new Set((keys || []).filter(Boolean))).slice(0, 300);
        if (!clean.length || !state.user) return Promise.resolve();
        var D = window.WeotziData;
        var client = D && typeof D.getClient === 'function' ? D.getClient() : null;
        if (!client) return Promise.resolve();
        var now = new Date().toISOString();
        var rows = clean.map(function (key) {
            return { user_id: state.user.id, notification_key: String(key).slice(0, 240), read_at: now };
        });
        return client.from('user_notification_reads')
            .upsert(rows, { onConflict: 'user_id,notification_key' })
            .then(function (result) { if (result.error) throw result.error; })
            .catch(function (e) { console.warn('[wo-menu] guardar lecturas:', e && e.message); });
    }
    function relTime(iso) {
        var t = new Date(iso).getTime();
        if (!t || isNaN(t)) return '';
        var diff = Date.now() - t;
        var min = Math.round(diff / 60000);
        if (min < 1) return 'Recién';
        if (min < 60) return 'Hace ' + min + (min === 1 ? ' minuto' : ' minutos');
        var h = Math.round(min / 60);
        if (h < 24) return 'Hace ' + h + (h === 1 ? ' hora' : ' horas');
        var d = Math.round(h / 24);
        if (d === 1) return 'Ayer';
        return 'Hace ' + d + ' días';
    }
    var MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    function futureLabel(iso) {
        var dt = new Date(iso);
        if (isNaN(dt.getTime())) return { when: '', time: '' };
        var today = new Date(); today.setHours(0, 0, 0, 0);
        var that = new Date(dt); that.setHours(0, 0, 0, 0);
        var days = Math.round((that - today) / 86400000);
        var hasTime = /T\d{2}:\d{2}/.test(String(iso)) && !/T00:00(:00)?/.test(String(iso));
        var hhmm = hasTime ? dt.toTimeString().slice(0, 5) : '';
        var when = days <= 0 ? 'Hoy' : (days === 1 ? 'Mañana' : 'El ' + dt.getDate() + '/' + (dt.getMonth() + 1));
        return { when: when, time: hhmm };
    }
    // Un recordatorio "aparece" cuando entra en su ventana (48 h antes de la
    // sesión / el día anterior al vencimiento), nunca antes de crearse ni en el futuro.
    function reminderStamp(windowStart, createdIso) {
        var created = new Date(createdIso || 0).getTime() || 0;
        var t = Math.min(Date.now(), Math.max(windowStart || 0, created));
        return new Date(t).toISOString();
    }
    function longDate(iso) {
        var dt = new Date(iso);
        return isNaN(dt.getTime()) ? '' : dt.getDate() + ' de ' + MONTHS[dt.getMonth()];
    }

    /* ------------------------------ estilos ------------------------------ */
    function ensureStyles() {
        if (document.getElementById('wo-artist-menu-styles')) return;
        var s = document.createElement('style');
        s.id = 'wo-artist-menu-styles';
        s.textContent = [
            /* El atributo hidden es del user-agent: cualquier `display` de autor
               (p.ej. el flex del panel) le gana y el elemento queda visible con
               hidden=true. Esta regla lo cierra para los 3 overlays. */
            '.wo-oam-drop[hidden],.wo-oam-panel[hidden],.wo-oam-scrim[hidden]{display:none !important}',
            /* badge del tile (Figma 164:18202) */
            '.wo-oam-host{position:relative;display:inline-flex}',
            '.wo-oam-badge{position:absolute;top:-9px;right:-12px;min-width:18px;height:18px;padding:0 5px;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--neutral-100);background:var(--system-error);color:var(--white);font-family:var(--font-mono);font-size:10px;line-height:1;font-weight:700}',
            /* Capas: los overlays que abre el artista quedan sobre el dock del
               modo asistido (marco 1370, panel 1380) y debajo de la bienvenida
               (1390) y del recorrido (1400). */
            /* menú de cuenta (Figma 164:16683) */
            '.wo-oam-drop{position:fixed;z-index:1384;width:min(340px,calc(100vw - 24px));box-sizing:border-box;background:var(--figma-white,#fff);border:1px solid var(--neutral-500);box-shadow:5px 5px 0 var(--neutral-500)}',
            '.wo-oam-head{display:flex;align-items:center;gap:14px;padding:16px 18px 16px 22px;border-bottom:.8px solid var(--neutral-200)}',
            '.wo-oam-avatar{width:40px;height:40px;flex:none;display:flex;align-items:center;justify-content:center;background:var(--yellow-300);color:var(--neutral-500);font-family:var(--font-display);font-size:14.5px;overflow:hidden}',
            '.wo-oam-avatar img{width:100%;height:100%;object-fit:cover}',
            '.wo-oam-who{min-width:0;display:flex;flex-direction:column;gap:2px}',
            '.wo-oam-user{font-family:var(--font-body);font-weight:700;font-size:14.5px;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
            '.wo-oam-mail{font-family:var(--font-mono);font-size:11.5px;color:var(--neutral-300);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
            '.wo-oam-acts{padding:8px 0}',
            '.wo-oam-cap{margin:0;padding:6px 18px 4px;font-family:var(--font-mono);font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--neutral-300)}',
            '.wo-oam-row{display:flex;align-items:center;gap:12px;width:100%;box-sizing:border-box;min-height:37px;padding:9px 18px;background:none;border:0;font:inherit;text-align:left;cursor:pointer;text-decoration:none;color:var(--ink)}',
            '.wo-oam-row:hover,.wo-oam-row:focus-visible{background:var(--neutral-100);text-decoration:none;outline:none}',
            '.wo-oam-row:focus-visible{box-shadow:inset 0 0 0 2px var(--border-focus)}',
            '.wo-oam-ic{position:relative;flex:none;width:16px;height:16px;display:flex;align-items:center;justify-content:center;color:var(--neutral-500)}',
            '.wo-oam-ic svg{width:16px;height:16px}',
            '.wo-oam-dot{position:absolute;top:-3px;right:-3px;width:5px;height:5px;border-radius:999px;background:var(--system-error);display:none}',
            '.wo-oam-row.has-unread .wo-oam-dot{display:block}',
            '.wo-oam-label{flex:1;min-width:0;font-family:var(--font-body);font-weight:700;font-size:14px;line-height:1.2;color:var(--ink)}',
            '.wo-oam-n{flex:none;min-width:12px;padding:2px 7px;background:var(--yellow-300);color:var(--ink);font-family:var(--font-mono);font-size:11px;font-weight:700;text-align:center;display:none}',
            '.wo-oam-row.has-count .wo-oam-n{display:inline-block}',
            '.wo-oam-unread{flex:none;min-width:46px;white-space:nowrap;font-family:var(--font-mono);font-size:9px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--yellow-500);visibility:hidden}',
            '.wo-oam-row.has-unread .wo-oam-unread{visibility:visible}',
            '.wo-oam-row.no-unread-col .wo-oam-unread{display:none}',
            '.wo-oam-sep{border:0;border-top:.8px solid var(--neutral-200);margin:0}',
            '.wo-oam-links{padding:8px 0 10px}',
            '.wo-oam-link{display:flex;align-items:center;gap:12px;padding:9px 18px;color:var(--neutral-500);text-decoration:none;font-family:var(--font-body);font-size:14px}',
            '.wo-oam-link .wo-oam-ic{color:var(--neutral-500)}',
            '.wo-oam-link:hover,.wo-oam-link:focus-visible{background:var(--neutral-100);color:var(--neutral-500);text-decoration:none;outline:none}',
            '.wo-app a.wo-oam-link,.wo-app a.wo-oam-link:hover{color:var(--neutral-500);text-decoration:none}',
            '.wo-app a.wo-oam-row,.wo-app a.wo-oam-row:hover{color:var(--ink);text-decoration:none}',
            /* accesos del demo / modo asistido que no navegan: <button> con la piel del link */
            'button.wo-oam-link{width:100%;box-sizing:border-box;margin:0;background:none;border:0;border-radius:0;text-align:left;cursor:pointer;line-height:inherit}',
            /* switch "Sugerir el modo demo" (role=switch): pista cuadrada, radius 0 */
            '.wo-oam-switchl{flex:1;min-width:0}',
            '.wo-oam-switch{position:relative;flex:none;width:30px;height:16px;box-sizing:border-box;border:1.5px solid var(--neutral-500);background:var(--white)}',
            '.wo-oam-switch::after{content:"";position:absolute;top:2px;left:2px;width:9px;height:9px;background:var(--neutral-300);transition:transform var(--duration-press,.08s) var(--ease-standard,ease)}',
            '.wo-oam-switchrow[aria-checked="true"] .wo-oam-switch{background:var(--ink);border-color:var(--ink)}',
            '.wo-oam-switchrow[aria-checked="true"] .wo-oam-switch::after{background:var(--white);transform:translateX(14px)}',
            '@media (prefers-reduced-motion:reduce){.wo-oam-switch::after{transition:none}}',
            /* aviso breve cuando el servidor no guardó el switch (alineado con el texto de la fila) */
            '.wo-oam-err{margin:0;padding:2px 18px 8px 46px;font-family:var(--font-body);font-size:12.5px;line-height:1.35;color:var(--status-error-fg)}',
            /* panel de notificaciones (Figma 167:19997): nace debajo de la topbar */
            '.wo-oam-scrim{position:fixed;left:0;right:0;bottom:0;top:var(--wo-oam-top,76px);z-index:1385;background:color-mix(in srgb,var(--neutral-500) 42%,transparent)}',
            '.wo-oam-panel{position:fixed;top:var(--wo-oam-top,76px);right:0;z-index:1386;box-sizing:border-box;width:min(440px,100vw);min-height:min(944px,calc(100vh - var(--wo-oam-top,76px)));max-height:calc(100vh - var(--wo-oam-top,76px));background:var(--figma-white,#fff);border-left:1.6px solid var(--neutral-500);box-shadow:8px 8px 0 var(--neutral-500);display:flex;flex-direction:column}',
            '.wo-oam-ph{display:flex;flex-direction:column;gap:7px;padding:22px 24px 23.6px;border-bottom:1.6px solid var(--neutral-500)}',
            '.wo-oam-ph-row{display:flex;align-items:center;justify-content:space-between;gap:10px}',
            '.wo-oam-ph-title{display:flex;align-items:center;gap:10px}',
            '.wo-oam-ptitle{margin:0;font-family:var(--font-display);font-weight:400;font-size:22px;color:var(--ink)}',
            '.wo-oam-pcount{min-width:22px;height:22px;box-sizing:border-box;padding:0 7px;display:inline-flex;align-items:center;justify-content:center;background:var(--system-error);color:var(--white);font-family:var(--font-mono);font-size:11px;font-weight:700}',
            '.wo-oam-x{background:none;border:0;cursor:pointer;color:var(--neutral-500);width:28px;height:28px;padding:4px;display:flex;align-items:center;justify-content:center}',
            '.wo-oam-x svg{width:20px;height:20px}',
            '.wo-oam-x:focus-visible,.wo-oam-mark:focus-visible,.wo-oam-item:focus-visible{outline:none;box-shadow:var(--shadow-focus)}',
            '.wo-oam-mark{align-self:flex-start;background:none;border:0;padding:0;cursor:pointer;font-family:var(--font-mono);font-weight:700;font-size:11.5px;letter-spacing:.05em;text-transform:uppercase;color:var(--black,#000)}',
            '.wo-oam-mark:hover{text-decoration:underline}',
            '.wo-oam-mark:disabled{color:var(--neutral-300);cursor:default;text-decoration:none}',
            '.wo-oam-list{flex:1;overflow-y:auto}',
            '.wo-oam-item{display:flex;gap:14px;width:100%;box-sizing:border-box;text-align:left;background:none;border:0;border-bottom:.8px solid var(--neutral-200);padding:16px 24px 16.8px;cursor:pointer;font:inherit}',
            '.wo-oam-item:hover{background:var(--neutral-100)}',
            '.wo-oam-item.is-unread{background:color-mix(in srgb,var(--blue-100) 30%,var(--white))}',
            '.wo-oam-item.is-unread:hover{background:color-mix(in srgb,var(--blue-100) 55%,var(--white))}',
            '.wo-oam-iic{flex:none;width:34px;height:34px;margin-top:2px;display:flex;align-items:center;justify-content:center;background:var(--figma-sand);color:var(--neutral-500)}',
            '.wo-oam-iic svg{width:16px;height:16px}',
            '.wo-oam-ibody{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}',
            '.wo-oam-ititle{margin:0;font-family:var(--font-body);font-size:14px;font-weight:700;color:var(--ink);display:flex;align-items:center;gap:7px}',
            '.wo-oam-imark{width:6px;height:6px;background:var(--blue-400);flex:none;display:none}',
            '.wo-oam-item.is-unread .wo-oam-imark{display:inline-block}',
            '.wo-oam-idesc{margin:0;font-family:var(--font-body);font-size:13px;line-height:17.55px;color:var(--neutral-500)}',
            '.wo-oam-imeta{margin:0;padding-top:3px;display:flex;align-items:center;gap:8px;font-family:var(--font-mono);font-size:10.5px;color:var(--neutral-300)}',
            '.wo-oam-imeta b{font-weight:400;font-size:10px;letter-spacing:.04em;text-transform:uppercase;color:var(--black,#000)}',
            '.wo-oam-empty{padding:32px 24px;font-size:var(--body-s-size);color:var(--text-muted)}',
            'body.wo-oam-lock{overflow:hidden}',
            '.wo-oam-panel:focus{outline:none}',
            '@media (max-width:480px){.wo-oam-drop{left:12px !important;right:12px;width:auto}.wo-oam-panel{box-shadow:none}}',
        ].join('\n');
        document.head.appendChild(s);
    }

    /* ------------------------------ datos ------------------------------ */
    function pushFeed(items) { state.feed = state.feed.concat(items); }

    function sessionsWithStamps(D, nowIso) {
        var cols = 'id, session_date, session_number, status, notes, quotation_id, created_at, updated_at, quotations_db(client_full_name, tattoo_style, tattoo_body_part)';
        return D.Sessions.listUpcomingForArtist(nowIso, { limit: 20, select: cols })
            .catch(function () { return D.Sessions.listUpcomingForArtist(nowIso, { limit: 20 }); });
    }

    async function loadAll() {
        var D = window.WeotziData;
        var uid = state.user.id;
        state.feed = [];
        state.threads = [];
        state.counts = { msgs: 0, inv: 0, solic: 0, apps: 0, updates: 0 };
        var seen = await loadRemoteSeen(D, uid);
        var jobs = [];
        var weekAgo = Date.now() - 7 * 86400000;

        if (D && D.Chat && typeof D.Chat.listThreadsForArtist === 'function') {
            jobs.push(D.Chat.listThreadsForArtist(uid).then(function (threads) {
                state.threads = threads || [];
                var unread = state.threads.filter(function (t) { return (t.unread_for_artist || 0) > 0; });
                state.counts.msgs = unread.reduce(function (n, t) { return n + (t.unread_for_artist || 0); }, 0);
                pushFeed(unread.map(function (t) {
                    return {
                        key: 'msg:' + t.quote_id + ':' + t.last_message_at,
                        type: 'mensaje', icon: 'message-circle',
                        title: 'Nuevo mensaje',
                        desc: (t.client_full_name || 'Un cliente') + ' te escribió sobre su cotización.',
                        ts: t.last_message_at, unread: true, href: '/artist/inbox',
                    };
                }));
            }).catch(function (e) { console.warn('[wo-menu] mensajes:', e && e.message); }));
        }

        if (D && D.StudioMemberships && typeof D.StudioMemberships.listPendingForArtist === 'function') {
            jobs.push(Promise.resolve(D.StudioMemberships.listPendingForArtist(uid)).then(function (res) {
                if (res && res.error) throw res.error;
                var rows = (res && res.data) || [];
                state.counts.inv = rows.length;
                pushFeed(rows.map(function (r) {
                    var studio = (r.studios && r.studios.name) || 'Un estudio';
                    return {
                        key: 'inv:' + r.id, type: 'invitacion', icon: 'star',
                        title: 'Nueva invitación',
                        desc: studio + ' te invitó a sumarte a su equipo.',
                        ts: r.invited_at, unread: !seen.has('inv:' + r.id), href: '/artist/invitations',
                    };
                }));
            }).catch(function (e) { console.warn('[wo-menu] invitaciones:', e && e.message); }));
        }

        if (D && D.Quotations && typeof D.Quotations.listForArtist === 'function') {
            jobs.push(D.Quotations.listForArtist(uid, {
                select: 'quote_id, quote_status, created_at, updated_at, client_full_name',
                limit: 120,
            }).then(function (quotes) {
                var pending = (quotes || []).filter(function (q) { return q.quote_status === 'pending'; });
                state.counts.solic = pending.length;
                pushFeed(pending.filter(function (q) { return new Date(q.created_at).getTime() >= weekAgo; }).map(function (q) {
                    return {
                        key: 'quo:' + q.quote_id, type: 'solicitud', icon: 'inbox',
                        title: 'Nueva solicitud',
                        desc: (q.client_full_name || 'Un cliente') + ' pidió una cotización.',
                        ts: q.created_at, unread: !seen.has('quo:' + q.quote_id), href: '/my-quotations',
                    };
                }));
                pushFeed((quotes || []).filter(function (q) {
                    return q.quote_status === 'expired' && new Date(q.updated_at || q.created_at).getTime() >= weekAgo;
                }).map(function (q) {
                    return {
                        key: 'exp:' + q.quote_id, type: 'vencida', icon: 'dollar-sign',
                        title: 'Cotización vencida',
                        desc: 'Tu cotización a ' + (q.client_full_name || 'un cliente') + ' venció sin respuesta.',
                        ts: q.updated_at || q.created_at, unread: !seen.has('exp:' + q.quote_id), href: '/my-quotations',
                    };
                }));
            }).catch(function (e) { console.warn('[wo-menu] solicitudes:', e && e.message); }));
        }

        if (D && D.Sessions && typeof D.Sessions.listUpcomingForArtist === 'function') {
            jobs.push(sessionsWithStamps(D, new Date().toISOString()).then(function (rows) {
                var horizon = Date.now() + 48 * 3600000;
                rows = rows || [];
                pushFeed(rows.filter(function (s) {
                    var t = new Date(s.session_date).getTime();
                    return t && t <= horizon && String(s.status || '').toLowerCase() !== 'cancelled';
                }).map(function (s) {
                    var f = futureLabel(s.session_date);
                    var who = (s.quotations_db && s.quotations_db.client_full_name) || 'un cliente';
                    return {
                        key: 'ses:' + s.id, type: 'recordatorio', icon: 'calendar',
                        title: 'Recordatorio',
                        desc: f.when + ' tenés una sesión con ' + who + (f.time ? ' a las ' + f.time + '.' : '.'),
                        ts: reminderStamp(new Date(s.session_date).getTime() - 48 * 3600000, s.created_at),
                        unread: !seen.has('ses:' + s.id), href: '/calendar',
                    };
                }));
                // Reservas confirmadas recién (Figma: "Reserva confirmada").
                pushFeed(rows.filter(function (s) {
                    var stamp = new Date(s.updated_at || s.created_at || 0).getTime();
                    return String(s.status || '').toLowerCase() === 'confirmed' && stamp >= weekAgo;
                }).map(function (s) {
                    var who = (s.quotations_db && s.quotations_db.client_full_name) || 'Tu cliente';
                    return {
                        key: 'conf:' + s.id, type: 'reserva', icon: 'calendar',
                        title: 'Reserva confirmada',
                        desc: who + ' confirmó la sesión del ' + longDate(s.session_date) + '.',
                        ts: s.updated_at || s.created_at, unread: !seen.has('conf:' + s.id), href: '/calendar',
                    };
                }));
            }).catch(function (e) { console.warn('[wo-menu] sesiones:', e && e.message); }));
        }

        if (D && D.Reminders && typeof D.Reminders.list === 'function') {
            jobs.push(D.Reminders.list(uid).then(function (list) {
                var M = D.Reminders.model;
                pushFeed(M.dueSoon(list, new Date(), 1).map(function (r) {
                    var today = M.isoDateLocal(new Date()) === r.due_date;
                    return {
                        // Figma 801:558: Recordatorio lleva el ícono de calendario.
                        key: 'rem:' + r.id + ':' + r.due_date, type: 'recordatorio', icon: 'calendar',
                        title: 'Recordatorio',
                        desc: (today ? 'Hoy: ' : 'Mañana: ') + r.title + '.',
                        ts: reminderStamp(new Date(r.due_date + 'T09:00:00').getTime() - 24 * 3600000, r.created_at),
                        unread: !seen.has('rem:' + r.id + ':' + r.due_date),
                        href: '/artist/dashboard?modal=recordatorio&id=' + encodeURIComponent(r.id),
                    };
                }));
            }).catch(function (e) { console.warn('[wo-menu] recordatorios:', e && e.message); }));
        }

        if (D && D.StudioSpots && typeof D.StudioSpots.listApplicationsByArtist === 'function') {
            jobs.push(Promise.resolve(D.StudioSpots.listApplicationsByArtist(uid)).then(function (res) {
                if (res && res.error) throw res.error;
                var apps = (res && res.data) || [];
                state.counts.apps += apps.filter(function (a) { return a.status === 'pending'; }).length;
                pushFeed(apps.filter(function (a) {
                    return (a.status === 'accepted' || a.status === 'rejected' || a.status === 'declined')
                        && a.decided_at && new Date(a.decided_at).getTime() >= weekAgo;
                }).map(function (a) {
                    var spot = (a.studio_spots && a.studio_spots.title) || 'un spot';
                    var ok = a.status === 'accepted';
                    return {
                        key: 'spa:' + a.id, type: 'postulacion', icon: 'briefcase',
                        title: ok ? 'Nueva postulación' : 'Postulación rechazada',
                        desc: 'Tu solicitud para ' + spot + (ok ? ' fue aceptada.' : ' no quedó esta vez.'),
                        ts: a.decided_at, unread: !seen.has('spa:' + a.id), href: '/artist/applications?tab=spots',
                    };
                }));
            }).catch(function (e) { console.warn('[wo-menu] spots:', e && e.message); }));
        }

        if (D && D.JobBoard && D.JobBoard.Applications && typeof D.JobBoard.Applications.listForArtist === 'function') {
            jobs.push(D.JobBoard.Applications.listForArtist(uid).then(function (apps) {
                state.counts.apps += (apps || []).filter(function (a) {
                    return ['pending', 'pendiente', 'submitted', 'enviada'].indexOf(String(a.status || '').toLowerCase()) !== -1;
                }).length;
            }).catch(function (e) { console.warn('[wo-menu] postulaciones:', e && e.message); }));
        }

        jobs.push(fetch(appPath('/shared/platform-updates.json'), { cache: 'no-cache' }).then(function (r) {
            return r.ok ? r.json() : [];
        }).then(function (updates) {
            var items = (Array.isArray(updates) ? updates : []).slice(0, 5);
            var unseen = items.filter(function (u) { return !seen.has('upd:' + u.id); });
            state.counts.updates = unseen.length;
            pushFeed(items.map(function (u) {
                return {
                    key: 'upd:' + u.id, type: 'update', icon: 'zap',
                    title: u.title || 'Actualización de la plataforma',
                    desc: u.body || '', ts: u.date, unread: !seen.has('upd:' + u.id), href: null,
                };
            }));
        }).catch(function () { /* sin archivo de updates */ }));

        await Promise.all(jobs);
        state.feed.sort(function (a, b) {
            if (a.unread !== b.unread) return a.unread ? -1 : 1;
            return new Date(b.ts) - new Date(a.ts);
        });
        state.feed = state.feed.slice(0, FEED_CAP);
    }

    function unreadTotal() {
        return state.feed.filter(function (i) { return i.unread; }).length;
    }

    /* ------------------------------ render ------------------------------ */
    function iconEl(name) { return '<i data-wo-icon="' + name + '" aria-hidden="true"></i>'; }

    function activityRow(id, icon, label, count, unreadish, href) {
        var cls = 'wo-oam-row' + (count > 0 ? ' has-count' : '') + (unreadish && count > 0 ? ' has-unread' : '') + (unreadish ? '' : ' no-unread-col');
        var n = count > 99 ? '99+' : count;
        return '<a class="' + cls + '" id="' + id + '" role="menuitem" href="' + esc(appPath(href)) + '"' +
            (count > 0 ? ' aria-label="' + esc(label) + ': ' + n + (unreadish ? ' sin leer' : '') + '"' : '') + '>'
            + '<span class="wo-oam-ic">' + iconEl(icon) + '<span class="wo-oam-dot"></span></span>'
            + '<span class="wo-oam-label">' + esc(label) + '</span>'
            + '<span class="wo-oam-n">' + n + '</span>'
            + '<span class="wo-oam-unread">Sin leer</span>'
            + '</a>';
    }

    function profileHref() {
        var a = state.artist || {};
        return a.username ? '/artist/profile?artist=' + encodeURIComponent(String(a.username).replace(/^@/, '')) : '/artist/account#perfil';
    }

    /* ------------------- accesos del demo y del modo asistido ------------------- */
    // WoDemo (wo-demo.js) no existe en la preview local: ahí el modo asistido es
    // un link plano y el switch de la sugerencia no se muestra.
    function assistActive() {
        var A = window.WoAssist;
        try { return !!(A && typeof A.isActive === 'function' && A.isActive()); } catch (e) { return false; }
    }
    function suggestionsOn(W) {
        try { return !!(W && typeof W.suggestionsEnabled === 'function' && W.suggestionsEnabled()); } catch (e) { return true; }
    }
    function onboardingLinks(demo) {
        var W = window.WoDemo;
        var assistOn = !demo && assistActive();
        var hasSwitch = !!(W && typeof W.setSuggestions === 'function');
        var suggestOn = suggestionsOn(W);
        return '<a class="wo-oam-link" id="wo-oam-assist" href="' + esc(appPath('/artist/account?asistido=1#perfil')) + '"><span class="wo-oam-ic">' + iconEl('check-square') + '</span>'
            + (assistOn ? 'Modo asistido · ver mis pasos' : 'Modo asistido · configurá tu perfil') + '</a>'
            // Siempre visible (el final del recorrido remite acá); con el demo
            // prendido arranca el recorrido sin navegar.
            + '<a class="wo-oam-link" id="wo-oam-tour" href="' + esc(appPath('/artist/dashboard')) + '?demo=1&amp;tour=1"><span class="wo-oam-ic">' + iconEl('compass') + '</span>Recorrido guiado · modo demo</a>'
            + (demo ? '<button type="button" class="wo-oam-link" id="wo-oam-demo-exit"><span class="wo-oam-ic">' + iconEl('log-out') + '</span>Salir del modo demo</button>' : '')
            + (hasSwitch ? '<button type="button" class="wo-oam-link wo-oam-switchrow" id="wo-oam-suggest" role="switch" aria-checked="' + (suggestOn ? 'true' : 'false') + '"'
                + (state.suggestError ? ' aria-describedby="wo-oam-suggest-err"' : '') + '>'
                + '<span class="wo-oam-ic">' + iconEl('eye') + '</span><span class="wo-oam-switchl">Sugerir el modo demo</span>'
                + '<span class="wo-oam-switch" aria-hidden="true"></span></button>'
                + (state.suggestError ? '<p class="wo-oam-err" id="wo-oam-suggest-err" role="alert">' + esc(SUGGEST_ERROR) + '</p>' : '') : '');
    }
    // El servidor no guardó el switch: WoDemo ya lo volvió al valor anterior
    // (el re-render lo lee de suggestionsEnabled()); acá solo se avisa un rato.
    function setSuggestError(on) {
        if (suggestErrorTimer) { clearTimeout(suggestErrorTimer); suggestErrorTimer = 0; }
        if (!on && !state.suggestError) return;
        state.suggestError = !!on;
        if (on) suggestErrorTimer = setTimeout(function () { suggestErrorTimer = 0; setSuggestError(false); }, SUGGEST_ERROR_MS);
        safeRenderDrop();
    }
    function bindOnboardingLinks(demo) {
        var W = window.WoDemo;
        if (!W) return;
        var assist = els.drop.querySelector('#wo-oam-assist');
        if (assist && typeof W.startAssist === 'function') {
            assist.addEventListener('click', function (e) {
                e.preventDefault();
                setDrop(false);
                var A = window.WoAssist;
                if (assistActive() && typeof A.open === 'function') { A.open(); return; }
                W.startAssist();
            });
        }
        var tour = els.drop.querySelector('#wo-oam-tour');
        if (tour && demo && typeof W.startTour === 'function') {
            tour.addEventListener('click', function (e) { e.preventDefault(); setDrop(false); W.startTour(); });
        }
        var exit = els.drop.querySelector('#wo-oam-demo-exit');
        if (exit && typeof W.disable === 'function') {
            exit.addEventListener('click', function () { setDrop(false); W.disable(); });
        }
        var sw = els.drop.querySelector('#wo-oam-suggest');
        if (sw && typeof W.setSuggestions === 'function') {
            sw.addEventListener('click', function (e) {
                // Un switch no navega: el menú queda abierto. El re-render del
                // evento reemplaza el botón, así que el click no sigue al document
                // (lo tomaría como un click afuera del menú).
                e.preventDefault();
                e.stopPropagation();
                var next = sw.getAttribute('aria-checked') !== 'true';
                if (state.suggestError) setSuggestError(false);
                sw.setAttribute('aria-checked', next ? 'true' : 'false');
                var failed = function (err) {
                    console.warn('[wo-menu] sugerencia del demo:', err && err.message);
                    setSuggestError(true);
                };
                try {
                    var p = W.setSuggestions(next);
                    if (p && typeof p.then === 'function') p.then(null, failed);
                } catch (err) { failed(err); }
            });
        }
    }

    function renderDrop() {
        var a = state.artist || {};
        var mail = (state.user && state.user.email) || '';
        var raw = String(a.username || a.name || (mail ? mail.split('@')[0] : 'Tu cuenta')).replace(/^@/, '');
        var display = raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : 'Tu cuenta';
        var initials = raw.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase() || 'Ö';
        var pic = a.profile_picture || '';
        var total = unreadTotal();
        var demo = !!(window.WoDemo && window.WoDemo.enabled);
        // El re-render reemplaza los nodos: el foco vuelve al control con el mismo id.
        var focused = document.activeElement;
        var keepFocus = focused && focused.id && typeof els.drop.contains === 'function' && els.drop.contains(focused) ? focused.id : '';

        els.drop.innerHTML =
            '<div class="wo-oam-head">'
            + '<span class="wo-oam-avatar">' + (pic ? '<img src="' + esc(pic) + '" alt="">' : esc(initials)) + '</span>'
            + '<span class="wo-oam-who"><span class="wo-oam-user">' + esc(display) + '</span>'
            + '<span class="wo-oam-mail">' + esc(mail) + '</span></span>'
            + '</div>'
            + '<div class="wo-oam-acts">'
            + '<p class="wo-oam-cap">Actividad reciente</p>'
            + '<div role="menu" aria-label="Actividad reciente">'
            + activityRow('wo-oam-notifs', 'bell', 'Notificaciones', total, true, '#notificaciones')
            + activityRow('wo-oam-msgs', 'message-circle', 'Mensajes sin leer', state.counts.msgs, true, '/artist/inbox')
            + activityRow('wo-oam-inv', 'star', 'Invitaciones pendientes', state.counts.inv, false, '/artist/invitations')
            + activityRow('wo-oam-apps', 'inbox', 'Postulaciones', state.counts.apps, false, '/artist/applications')
            + activityRow('wo-oam-upd', 'zap', 'Actualizaciones de la plataforma', state.counts.updates, true, '#notificaciones')
            + '</div></div>'
            + '<hr class="wo-oam-sep">'
            + '<div class="wo-oam-links">'
            + '<a class="wo-oam-link" href="' + esc(appPath('/artist/account')) + '"><span class="wo-oam-ic">' + iconEl('user') + '</span>Ir al Centro de Cuenta</a>'
            + '<a class="wo-oam-link" href="' + esc(appPath(profileHref())) + '"><span class="wo-oam-ic">' + iconEl('external-link') + '</span>Ver perfil público</a>'
            + onboardingLinks(demo)
            + '<a class="wo-oam-link" href="' + esc(appPath('/artist/inbox')) + '"><span class="wo-oam-ic">' + iconEl('help-circle') + '</span>Ayuda</a>'
            + '</div>';

        var openPanel = function (e) { e.preventDefault(); setDrop(false); setPanel(true); };
        els.drop.querySelector('#wo-oam-notifs').addEventListener('click', openPanel);
        els.drop.querySelector('#wo-oam-upd').addEventListener('click', openPanel);
        bindOnboardingLinks(demo);
        if (keepFocus) {
            var again = els.drop.querySelector('#' + keepFocus);
            if (again && typeof again.focus === 'function') { try { again.focus(); } catch (e) { /* noop */ } }
        }
        hydrateIcons(els.drop);
    }

    function safeRenderDrop() {
        try { renderDrop(); } catch (e) { console.warn('[wo-menu] render:', e && e.message); }
    }

    function renderPanel() {
        var total = unreadTotal();
        var items = state.feed.map(function (it, i) {
            var meta = '<span>' + esc(relTime(it.ts)) + '</span><b>' + (it.unread ? 'Sin leer' : 'Leída') + '</b>';
            return '<button type="button" class="wo-oam-item' + (it.unread ? ' is-unread' : '') + '" data-i="' + i + '">'
                + '<span class="wo-oam-iic">' + iconEl(it.icon) + '</span>'
                + '<span class="wo-oam-ibody">'
                + '<span class="wo-oam-ititle">' + esc(it.title) + '<span class="wo-oam-imark" aria-hidden="true"></span></span>'
                + '<span class="wo-oam-idesc">' + esc(it.desc) + '</span>'
                + '<span class="wo-oam-imeta">' + meta + '</span>'
                + '</span></button>';
        }).join('');

        els.panel.innerHTML =
            '<div class="wo-oam-ph">'
            + '<div class="wo-oam-ph-row"><div class="wo-oam-ph-title"><h2 class="wo-oam-ptitle">Notificaciones</h2>'
            + (total > 0 ? '<span class="wo-oam-pcount" aria-label="' + total + ' sin leer">' + (total > 99 ? '99+' : total) + '</span>' : '')
            + '</div><button type="button" class="wo-oam-x" aria-label="Cerrar notificaciones">' + iconEl('x') + '</button></div>'
            + '<button type="button" class="wo-oam-mark"' + (total ? '' : ' disabled') + '>Marcar todas como leídas</button>'
            + '</div>'
            + '<div class="wo-oam-list">'
            + (items || '<p class="wo-oam-empty">Sin novedades por ahora. Cuando pase algo, lo vas a ver acá.</p>')
            + '</div>';

        els.panel.querySelector('.wo-oam-x').addEventListener('click', function () { setPanel(false); });
        els.panel.querySelector('.wo-oam-mark').addEventListener('click', markAllRead);
        els.panel.querySelectorAll('.wo-oam-item').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var it = state.feed[Number(btn.dataset.i)];
                if (!it) return;
                var seen = loadSeen(); seen.add(it.key); saveSeen(seen);
                persistSeen([it.key]);
                it.unread = false;
                if (it.href) { window.location.href = appPath(it.href); return; }
                renderAll();
            });
        });
        hydrateIcons(els.panel);
    }

    function renderBadge() {
        var total = unreadTotal();
        var counts = {
            quotations: Math.max(0, Number(state.counts.solic) || 0),
            notifications: Math.max(0, Number(total) || 0),
        };
        window.WeotziArtistMenuCounts = counts;
        if (els.badge) {
            els.badge.textContent = counts.notifications > 99 ? '99+' : String(counts.notifications);
            els.badge.hidden = counts.notifications <= 0;
        }
        document.dispatchEvent(new CustomEvent('weotzi:artist-counts', { detail: counts }));
    }

    function renderAll() { renderDrop(); renderPanel(); renderBadge(); }

    function hydrateIcons(root) {
        if (window.WoIcons && typeof window.WoIcons.hydrate === 'function') {
            try { window.WoIcons.hydrate(root); } catch (e) { /* iconos luego */ }
        }
    }

    function markAllRead() {
        var seen = loadSeen();
        state.feed.forEach(function (it) { seen.add(it.key); it.unread = false; });
        saveSeen(seen);
        persistSeen(state.feed.map(function (it) { return it.key; }));
        // El chat tiene lectura real: marcarlo también en la base.
        var D = window.WeotziData;
        if (D && D.Chat && typeof D.Chat.markRead === 'function') {
            state.threads.filter(function (t) { return (t.unread_for_artist || 0) > 0; }).forEach(function (t) {
                D.Chat.markRead(t.quote_id, 'client').catch(function () { /* mejor esfuerzo */ });
            });
        }
        state.counts.msgs = 0;
        state.counts.updates = 0;
        renderAll();
    }

    /* --------------------------- apertura/cierre --------------------------- */
    function topbarBottom() {
        var bar = els.trigger && (els.trigger.closest('header') || els.trigger.closest('.wo-topbar'));
        var r = (bar || els.trigger).getBoundingClientRect();
        return Math.max(0, Math.round(r.bottom));
    }
    function positionDrop() {
        var r = els.trigger.getBoundingClientRect();
        var width = Math.min(340, window.innerWidth - 24);
        var left = Math.max(12, Math.min(r.right - width, window.innerWidth - width - 12));
        els.drop.style.top = (r.bottom + 18) + 'px';
        els.drop.style.left = left + 'px';
    }
    function setDrop(open) {
        state.open = open;
        els.drop.hidden = !open;
        els.trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open) positionDrop();
        else if (state.suggestError) setSuggestError(false);
    }
    function setPanel(open) {
        state.panelOpen = open;
        if (open) document.documentElement.style.setProperty('--wo-oam-top', topbarBottom() + 'px');
        els.panel.hidden = !open;
        els.scrim.hidden = !open;
        document.body.classList.toggle('wo-oam-lock', open);
        if (open) {
            setTimeout(function () { try { els.panel.focus(); } catch (e) { /* noop */ } }, 30);
        }
    }

    /* ------------------------------ init ------------------------------ */
    async function resolveClient() {
        if (window.ConfigManager && typeof window.ConfigManager.ready === 'function') {
            try { await window.ConfigManager.ready(); } catch (e) { /* sigue con reintentos */ }
        }
        for (var i = 0; i < 20; i++) {
            var c = (window.WeotziData && window.WeotziData.getClient && window.WeotziData.getClient())
                || (window.ConfigManager && typeof window.ConfigManager.getSupabaseClient === 'function'
                    && window.ConfigManager.getSupabaseClient());
            if (c) return c;
            await new Promise(function (r) { setTimeout(r, 150); });
        }
        return null;
    }

    function loadCounterRepository(src, isReady) {
        if (isReady()) return Promise.resolve();
        return new Promise(function (resolve, reject) {
            var script = document.createElement('script');
            script.src = appPath(src);
            script.dataset.woCounterRepo = src;
            script.onload = function () {
                if (isReady()) { resolve(); return; }
                reject(new Error('El repositorio no registró su API: ' + src));
            };
            script.onerror = function () { reject(new Error('No se pudo cargar ' + src)); };
            document.head.appendChild(script);
        });
    }

    async function ensureCounterRepositories() {
        await Promise.all([
            loadCounterRepository('/shared/js/data/quotations-repo.js', function () {
                var D = window.WeotziData;
                return Boolean(D && D.Quotations && D.Chat && D.Sessions);
            }),
            loadCounterRepository('/shared/js/data/studios-repo.js', function () {
                var D = window.WeotziData;
                return Boolean(D && D.StudioMemberships && D.StudioSpots);
            }),
        ]);
        // Opcionales: si fallan, el menú sigue con el resto de los contadores.
        await Promise.all([
            loadCounterRepository('/shared/js/data/jobboard-repo.js', function () {
                var D = window.WeotziData;
                return Boolean(D && D.JobBoard && D.JobBoard.Applications);
            }).catch(function (e) { console.warn('[wo-menu] job board:', e && e.message); }),
            loadCounterRepository('/shared/js/data/reminders-repo.js', function () {
                var D = window.WeotziData;
                return Boolean(D && D.Reminders);
            }).catch(function (e) { console.warn('[wo-menu] recordatorios:', e && e.message); }),
        ]);
    }

    // Monta la UI y los listeners SIN esperar a la red: el click en el tile
    // abre el menú desde el primer momento.
    function mountUi(tile) {
        ensureStyles();

        // El trigger es el tile o su ancestro clickeable (en algunas topbars el
        // tile es un span dentro de un <a> manejado por el JS de auth).
        els.trigger = tile.closest('a, button') || tile;
        var host = document.createElement('span');
        host.className = 'wo-oam-host';
        els.trigger.parentNode.insertBefore(host, els.trigger);
        host.appendChild(els.trigger);
        els.badge = els.trigger.querySelector('[data-artist-notification-count]');
        if (!els.badge) {
            els.badge = document.createElement('span');
            els.badge.className = 'wo-oam-badge';
            els.badge.hidden = true;
            host.appendChild(els.badge);
        }

        els.drop = document.createElement('div');
        els.drop.className = 'wo-oam-drop';
        els.drop.setAttribute('aria-label', 'Menú de cuenta');
        els.drop.hidden = true;
        document.body.appendChild(els.drop);

        els.scrim = document.createElement('div');
        els.scrim.className = 'wo-oam-scrim';
        els.scrim.hidden = true;
        document.body.appendChild(els.scrim);

        els.panel = document.createElement('aside');
        els.panel.className = 'wo-oam-panel';
        els.panel.setAttribute('role', 'dialog');
        els.panel.setAttribute('tabindex', '-1');
        els.panel.setAttribute('aria-label', 'Notificaciones');
        els.panel.hidden = true;
        document.body.appendChild(els.panel);

        els.trigger.setAttribute('aria-haspopup', 'true');
        els.trigger.setAttribute('aria-expanded', 'false');
        // El listener va en captura para ganarle a cualquier handler de la
        // página montado sobre el mismo tile.
        els.trigger.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            if (state.panelOpen) { setPanel(false); return; }
            setDrop(!state.open);
        }, true);
        document.addEventListener('click', function (e) {
            if (state.open && !els.drop.contains(e.target) && !els.trigger.contains(e.target)) setDrop(false);
        });
        document.addEventListener('keydown', function (e) {
            if (e.key !== 'Escape') return;
            if (state.panelOpen) { setPanel(false); try { els.trigger.focus(); } catch (err) { } return; }
            if (state.open) { setDrop(false); try { els.trigger.focus(); } catch (err) { } }
        });
        els.scrim.addEventListener('click', function () { setPanel(false); });
        // El demo (switch de la sugerencia) y el modo asistido cambian los accesos.
        document.addEventListener('wo:demo-suggestions-changed', safeRenderDrop);
        document.addEventListener('wo:assist-changed', safeRenderDrop);
        window.addEventListener('resize', function () {
            if (state.open) positionDrop();
            if (state.panelOpen) document.documentElement.style.setProperty('--wo-oam-top', topbarBottom() + 'px');
        });
    }

    function unmountUi() {
        try {
            var host = els.trigger && els.trigger.closest('.wo-oam-host');
            if (host && host.parentNode) {
                host.parentNode.insertBefore(els.trigger, host);
                host.parentNode.removeChild(host);
            }
            [els.drop, els.panel, els.scrim].forEach(function (n) {
                if (n && n.parentNode) n.parentNode.removeChild(n);
            });
        } catch (e) { /* nada que limpiar */ }
    }

    function safeRender() {
        try { renderAll(); } catch (e) { console.warn('[wo-menu] render:', e && e.message); }
    }

    function applyUrlState() {
        var wanted = new URLSearchParams(window.location.search).get('menu');
        if (wanted === 'cuenta') setDrop(true);
        else if (wanted === 'notificaciones') setPanel(true);
    }

    async function init() {
        var tile = document.querySelector('.wo-o-tile');
        if (!tile) return;

        mountUi(tile);
        safeRender();

        var client = await resolveClient();
        if (!client) { console.warn('[wo-menu] sin cliente Supabase'); unmountUi(); return; }

        var session = null;
        try { session = (await client.auth.getSession()).data.session; }
        catch (e) { console.warn('[wo-menu] sesión:', e && e.message); }
        if (!session) { unmountUi(); return; } // sin sesión el tile vuelve a ser link
        state.user = session.user;
        safeRender();

        try { await ensureCounterRepositories(); }
        catch (e) { console.warn('[wo-menu] repositorios de conteo:', e && e.message); }

        // La identidad es "mejor esfuerzo": si el perfil no resuelve, el menú
        // igual funciona con el email de la sesión.
        var A = window.WeotziData && window.WeotziData.Artists;
        try {
            if (A && typeof A.getByUserIdSingle === 'function') {
                var r1 = await A.getByUserIdSingle(state.user.id, 'user_id, username, name, profile_picture');
                state.artist = (r1 && r1.data) || null;
            } else if (A && typeof A.getByUserId === 'function') {
                var r2 = await A.getByUserId(state.user.id, 'user_id, username, name, profile_picture');
                state.artist = (r2 && r2.data) || null;
            }
        } catch (e) { console.warn('[wo-menu] perfil:', e && e.message); }
        safeRender();

        try { await loadAll(); } catch (e) { console.warn('[wo-menu] datos:', e && e.message); }
        safeRender();
        applyUrlState();

        // Keep counters and decisions fresh without requiring a page reload.
        var refreshing = false;
        async function refresh() {
            if (refreshing || document.hidden) return;
            refreshing = true;
            try { await loadAll(); safeRender(); }
            catch (e) { console.warn('[wo-menu] refrescar:', e && e.message); }
            finally { refreshing = false; }
        }
        window.setInterval(refresh, 60000);
        document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });
        document.addEventListener('weotzi:reminders-changed', function () { refresh(); });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { init(); });
    } else {
        init();
    }
})();
