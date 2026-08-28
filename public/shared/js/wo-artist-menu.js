/**
 * WE OTZI - Menú del artista (tile Ö) + panel de notificaciones
 * -------------------------------------------------------------
 * Componente compartido del rediseño Bauhaus (Figma 167:24120 dropdown /
 * 167:23251 slide-over). Se auto-inicializa en cualquier página de artista
 * que tenga el tile `.wo-o-tile` en la topbar: con sesión de artista, el
 * click abre el dropdown (identidad + actividad reciente + accesos) y desde
 * ahí el panel de notificaciones con un feed derivado de datos REALES:
 *   - mensajes sin leer  → vista chat_threads (unread_for_artist)
 *   - invitaciones       → studio_artist_memberships pending_acceptance
 *   - solicitudes/vencidas → quotations_db del artista
 *   - recordatorios      → quotation_sessions próximas (48 h)
 *   - postulaciones spots→ studio_spot_applications decididas (7 días)
 *   - actualizaciones    → /shared/platform-updates.json (editable por deploy)
 * Estado de lectura: el chat usa su is_read real; el resto marca visto en
 * localStorage (wo_notif_seen_v1). Sin sesión de artista el tile conserva su
 * comportamiento original (link). Carga: DESPUÉS de config-manager,
 * postgrest-client y los data/*-repo.js de la página (defer).
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
        counts: { msgs: 0, inv: 0, solic: 0, updates: 0 },
        open: false,
        panelOpen: false,
    };
    var els = {};

    /* ------------------------------ utils ------------------------------ */
    function esc(v) {
        return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function loadSeen() {
        try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); }
        catch (e) { return new Set(); }
    }
    function saveSeen(set) {
        try { localStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(set).slice(-300))); }
        catch (e) { /* almacenamiento bloqueado */ }
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
    function futureLabel(iso) {
        var dt = new Date(iso);
        if (isNaN(dt.getTime())) return '';
        var today = new Date(); today.setHours(0, 0, 0, 0);
        var that = new Date(dt); that.setHours(0, 0, 0, 0);
        var days = Math.round((that - today) / 86400000);
        var hasTime = /T\d{2}:\d{2}/.test(String(iso)) && !/T00:00(:00)?/.test(String(iso));
        var hhmm = hasTime ? dt.toTimeString().slice(0, 5) : '';
        var when = days <= 0 ? 'Hoy' : (days === 1 ? 'Mañana' : 'El ' + dt.getDate() + '/' + (dt.getMonth() + 1));
        return { when: when, time: hhmm };
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
            /* badge del tile */
            '.wo-oam-host{position:relative;display:inline-flex}',
            '.wo-oam-badge{position:absolute;top:-8px;right:-10px;min-width:18px;padding:2px 5px;background:var(--red-300);color:var(--white);font-family:var(--font-mono);font-size:10px;line-height:1.3;text-align:center;font-weight:700}',
            /* dropdown (Figma 167:24120) */
            '.wo-oam-drop{position:fixed;z-index:1200;width:min(460px,calc(100vw - 24px));background:var(--surface-card,#fff);border:2px solid var(--border-strong);box-shadow:6px 6px 0 var(--neutral-500);}',
            '.wo-oam-head{display:flex;align-items:center;gap:var(--space-4);padding:var(--space-5) var(--space-6);border-bottom:var(--border-hairline) solid var(--border-subtle)}',
            '.wo-oam-avatar{width:52px;height:52px;flex:none;display:flex;align-items:center;justify-content:center;background:var(--yellow-300);color:var(--neutral-500);font-family:var(--font-display);font-size:18px;overflow:hidden}',
            '.wo-oam-avatar img{width:100%;height:100%;object-fit:cover}',
            '.wo-oam-user{font-family:var(--font-display);font-size:17px;color:var(--text-heading);display:block}',
            '.wo-oam-mail{font-family:var(--font-mono);font-size:12px;color:var(--text-faint);display:block;margin-top:2px}',
            '.wo-oam-cap{margin:0;padding:var(--space-4) var(--space-6) var(--space-2);font-family:var(--font-mono);font-size:var(--meta-s-size);letter-spacing:var(--meta-s-track);text-transform:uppercase;color:var(--text-faint)}',
            '.wo-oam-row{display:flex;align-items:center;gap:var(--space-4);width:100%;box-sizing:border-box;padding:var(--space-3) var(--space-6);background:none;border:0;font:inherit;text-align:left;cursor:pointer;text-decoration:none}',
            '.wo-oam-row:hover{background:var(--neutral-100);text-decoration:none}',
            '.wo-oam-ic{position:relative;flex:none;width:24px;height:24px;display:flex;align-items:center;justify-content:center;color:var(--neutral-500)}',
            '.wo-oam-ic svg{width:20px;height:20px}',
            '.wo-oam-dot{position:absolute;top:-2px;right:-2px;width:8px;height:8px;border-radius:999px;background:var(--red-300);display:none}',
            '.wo-oam-row.has-unread .wo-oam-dot{display:block}',
            '.wo-oam-label{flex:1;font-size:var(--body-m-size);color:var(--text-heading)}',
            '.wo-oam-row.has-unread .wo-oam-label{font-weight:var(--weight-bold)}',
            '.wo-oam-n{flex:none;min-width:22px;padding:2px 6px;background:var(--yellow-300);color:var(--neutral-500);font-family:var(--font-mono);font-size:12px;font-weight:700;text-align:center;display:none}',
            '.wo-oam-row.has-count .wo-oam-n{display:inline-block}',
            '.wo-oam-unread{flex:none;font-family:var(--font-mono);font-size:var(--meta-s-size);letter-spacing:var(--meta-s-track);text-transform:uppercase;color:var(--yellow-500,#8a6d00);display:none}',
            '.wo-oam-row.has-unread .wo-oam-unread{display:inline}',
            '.wo-oam-sep{border:0;border-top:var(--border-hairline) solid var(--border-subtle);margin:var(--space-2) 0}',
            '.wo-oam-links{padding-bottom:var(--space-3)}',
            '.wo-oam-link{display:flex;align-items:center;gap:var(--space-4);padding:var(--space-3) var(--space-6);color:var(--neutral-500);text-decoration:none;font-size:var(--body-m-size)}',
            '.wo-oam-link:hover{background:var(--neutral-100);color:var(--neutral-500);text-decoration:none}',
            /* slide-over (Figma 167:23251) */
            '.wo-oam-scrim{position:fixed;inset:0;z-index:1290;background:rgba(20,20,20,0.35)}',
            '.wo-oam-panel{position:fixed;top:0;right:0;bottom:0;z-index:1300;width:min(420px,100vw);background:var(--surface-card,#fff);border-left:2px solid var(--border-strong);box-shadow:-6px 0 0 rgba(20,20,20,0.12);display:flex;flex-direction:column}',
            '.wo-oam-ph{display:flex;align-items:center;gap:var(--space-3);padding:var(--space-6) var(--space-6) var(--space-2)}',
            '.wo-oam-ptitle{margin:0;font-family:var(--font-display);font-size:24px;color:var(--text-heading)}',
            '.wo-oam-pcount{min-width:20px;padding:2px 6px;background:var(--red-300);color:var(--white);font-family:var(--font-mono);font-size:12px;font-weight:700;text-align:center}',
            '.wo-oam-x{margin-left:auto;background:none;border:0;cursor:pointer;color:var(--neutral-500);width:32px;height:32px;display:flex;align-items:center;justify-content:center}',
            '.wo-oam-mark{align-self:flex-start;margin:0 var(--space-6) var(--space-4);background:none;border:0;padding:0;cursor:pointer;font-family:var(--font-mono);font-size:var(--meta-s-size);letter-spacing:var(--meta-s-track);text-transform:uppercase;color:var(--neutral-400)}',
            '.wo-oam-mark:hover{color:var(--neutral-500);text-decoration:underline}',
            '.wo-oam-list{flex:1;overflow-y:auto;border-top:2px solid var(--border-strong)}',
            '.wo-oam-item{display:flex;gap:var(--space-4);width:100%;box-sizing:border-box;text-align:left;background:none;border:0;border-bottom:var(--border-hairline) solid var(--border-subtle);padding:var(--space-4) var(--space-6);cursor:pointer;font:inherit}',
            '.wo-oam-item:hover{background:var(--neutral-100)}',
            '.wo-oam-item.is-unread{background:var(--info-bg,#eef3fd)}',
            '.wo-oam-item.is-unread:hover{background:var(--blue-100,#e2ebfc)}',
            '.wo-oam-iic{flex:none;width:34px;height:34px;display:flex;align-items:center;justify-content:center;border:var(--border-hairline) solid var(--border-strong);background:var(--surface-card,#fff);color:var(--neutral-500)}',
            '.wo-oam-iic svg{width:16px;height:16px}',
            '.wo-oam-ibody{flex:1;min-width:0}',
            '.wo-oam-ititle{margin:0;font-size:var(--body-m-size);font-weight:var(--weight-bold);color:var(--text-heading);display:flex;align-items:center;gap:var(--space-2)}',
            '.wo-oam-imark{width:7px;height:7px;background:var(--blue-400);flex:none;display:none}',
            '.wo-oam-item.is-unread .wo-oam-imark{display:inline-block}',
            '.wo-oam-idesc{margin:2px 0 0;font-size:var(--body-s-size);line-height:var(--body-s-lh);color:var(--text-body)}',
            '.wo-oam-imeta{margin:var(--space-2) 0 0;font-family:var(--font-mono);font-size:10px;letter-spacing:var(--meta-s-track);text-transform:uppercase;color:var(--text-faint)}',
            '.wo-oam-imeta b{color:var(--yellow-500,#8a6d00);font-weight:700;margin-left:var(--space-3)}',
            '.wo-oam-empty{padding:var(--space-8) var(--space-6);font-size:var(--body-s-size);color:var(--text-muted)}',
            '@media (max-width:480px){.wo-oam-drop{left:12px !important;right:12px;width:auto}}',
        ].join('\n');
        document.head.appendChild(s);
    }

    /* ------------------------------ datos ------------------------------ */
    function seenKeyFor(item) { return item.key; }

    function pushFeed(items) { state.feed = state.feed.concat(items); }

    async function loadAll() {
        var D = window.WeotziData;
        var uid = state.user.id;
        var seen = loadSeen();
        var jobs = [];

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
                var weekAgo = Date.now() - 7 * 86400000;
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
            jobs.push(D.Sessions.listUpcomingForArtist(new Date().toISOString(), { limit: 10 }).then(function (rows) {
                var horizon = Date.now() + 48 * 3600000;
                pushFeed((rows || []).filter(function (s) {
                    var t = new Date(s.session_date).getTime();
                    return t && t <= horizon;
                }).map(function (s) {
                    var f = futureLabel(s.session_date);
                    var who = (s.quotations_db && s.quotations_db.client_full_name) || 'un cliente';
                    return {
                        key: 'ses:' + s.id, type: 'recordatorio', icon: 'calendar',
                        title: 'Recordatorio',
                        desc: f.when + ' tenés una sesión con ' + who + (f.time ? ' a las ' + f.time + '.' : '.'),
                        ts: new Date().toISOString(), unread: !seen.has('ses:' + s.id), href: '/calendar',
                    };
                }));
            }).catch(function (e) { console.warn('[wo-menu] sesiones:', e && e.message); }));
        }

        if (D && D.StudioSpots && typeof D.StudioSpots.listApplicationsByArtist === 'function') {
            jobs.push(Promise.resolve(D.StudioSpots.listApplicationsByArtist(uid)).then(function (res) {
                if (res && res.error) throw res.error;
                var weekAgo = Date.now() - 7 * 86400000;
                pushFeed(((res && res.data) || []).filter(function (a) {
                    return (a.status === 'accepted' || a.status === 'rejected')
                        && a.decided_at && new Date(a.decided_at).getTime() >= weekAgo;
                }).map(function (a) {
                    var spot = (a.studio_spots && a.studio_spots.title) || 'un spot';
                    var ok = a.status === 'accepted';
                    return {
                        key: 'spa:' + a.id, type: 'postulacion', icon: 'briefcase',
                        title: ok ? 'Postulación aceptada' : 'Postulación rechazada',
                        desc: 'Tu solicitud para ' + spot + (ok ? ' fue aceptada.' : ' no quedó esta vez.'),
                        ts: a.decided_at, unread: !seen.has('spa:' + a.id), href: '/artist/applications?tab=spots',
                    };
                }));
            }).catch(function (e) { console.warn('[wo-menu] spots:', e && e.message); }));
        }

        jobs.push(fetch('/shared/platform-updates.json', { cache: 'no-cache' }).then(function (r) {
            return r.ok ? r.json() : [];
        }).then(function (updates) {
            var items = (Array.isArray(updates) ? updates : []).slice(0, 5);
            var unseen = items.filter(function (u) { return !loadSeen().has('upd:' + u.id); });
            state.counts.updates = unseen.length;
            pushFeed(items.map(function (u) {
                return {
                    key: 'upd:' + u.id, type: 'update', icon: 'zap',
                    title: u.title || 'Actualización de la plataforma',
                    desc: u.body || '', ts: u.date, unread: !loadSeen().has('upd:' + u.id), href: null,
                };
            }));
        }).catch(function () { /* sin archivo de updates */ }));

        await Promise.all(jobs);
        state.feed.sort(function (a, b) { return new Date(b.ts) - new Date(a.ts); });
        state.feed = state.feed.slice(0, FEED_CAP);
    }

    function unreadTotal() {
        return state.feed.filter(function (i) { return i.unread; }).length;
    }

    /* ------------------------------ render ------------------------------ */
    function iconEl(name) { return '<i data-wo-icon="' + name + '" aria-hidden="true"></i>'; }

    function activityRow(id, icon, label, count, unreadish, href) {
        var cls = 'wo-oam-row' + (count > 0 ? ' has-count' : '') + (unreadish && count > 0 ? ' has-unread' : '');
        return '<a class="' + cls + '" id="' + id + '" role="menuitem" href="' + esc(href) + '">'
            + '<span class="wo-oam-ic">' + iconEl(icon) + '<span class="wo-oam-dot"></span></span>'
            + '<span class="wo-oam-label">' + esc(label) + '</span>'
            + '<span class="wo-oam-n">' + (count > 99 ? '99+' : count) + '</span>'
            + '<span class="wo-oam-unread">Sin leer</span>'
            + '</a>';
    }

    function renderDrop() {
        var a = state.artist || {};
        var mail = (state.user && state.user.email) || '';
        var display = String(a.username || a.name || (mail ? mail.split('@')[0] : 'Tu cuenta')).replace(/^@/, '');
        var initials = display.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase() || 'Ö';
        var pic = a.profile_picture || '';
        var total = unreadTotal();
        var profileHref = a.username ? '/artist/profile?artist=' + encodeURIComponent(a.username) : '/artist/profile';

        els.drop.innerHTML =
            '<div class="wo-oam-head">'
            + '<span class="wo-oam-avatar">' + (pic ? '<img src="' + esc(pic) + '" alt="">' : esc(initials)) + '</span>'
            + '<span><span class="wo-oam-user">' + esc(display) + '</span>'
            + '<span class="wo-oam-mail">' + esc(mail) + '</span></span>'
            + '</div>'
            + '<p class="wo-oam-cap">Actividad reciente</p>'
            + '<div role="menu" aria-label="Actividad reciente">'
            + activityRow('wo-oam-notifs', 'bell', 'Notificaciones', total, true, '#')
            + activityRow('wo-oam-msgs', 'message-circle', 'Mensajes sin leer', state.counts.msgs, true, '/artist/inbox')
            + activityRow('wo-oam-inv', 'star', 'Invitaciones pendientes', state.counts.inv, false, '/artist/invitations')
            + activityRow('wo-oam-solic', 'inbox', 'Solicitudes pendientes', state.counts.solic, false, '/my-quotations')
            + activityRow('wo-oam-upd', 'zap', 'Actualizaciones de la plataforma', state.counts.updates, true, '#')
            + '</div>'
            + '<hr class="wo-oam-sep">'
            + '<div class="wo-oam-links">'
            + '<a class="wo-oam-link" href="/artist/account"><span class="wo-oam-ic">' + iconEl('user') + '</span>Ir al centro de la cuenta</a>'
            + '<a class="wo-oam-link" href="' + esc(profileHref) + '"><span class="wo-oam-ic">' + iconEl('external-link') + '</span>Ver perfil público</a>'
            + '<a class="wo-oam-link" href="mailto:artistas@weotzi.com"><span class="wo-oam-ic">' + iconEl('help-circle') + '</span>Ayuda</a>'
            + '</div>';

        var openPanel = function (e) { e.preventDefault(); setDrop(false); setPanel(true); };
        els.drop.querySelector('#wo-oam-notifs').addEventListener('click', openPanel);
        els.drop.querySelector('#wo-oam-upd').addEventListener('click', openPanel);
        hydrateIcons(els.drop);
    }

    function renderPanel() {
        var total = unreadTotal();
        var items = state.feed.map(function (it, i) {
            var meta = relTime(it.ts) + (it.unread ? '<b>Sin leer</b>' : '<b style="color:var(--text-faint)">Leída</b>');
            return '<button type="button" class="wo-oam-item' + (it.unread ? ' is-unread' : '') + '" data-i="' + i + '">'
                + '<span class="wo-oam-iic">' + iconEl(it.icon) + '</span>'
                + '<span class="wo-oam-ibody">'
                + '<p class="wo-oam-ititle">' + esc(it.title) + '<span class="wo-oam-imark"></span></p>'
                + '<p class="wo-oam-idesc">' + esc(it.desc) + '</p>'
                + '<p class="wo-oam-imeta">' + meta + '</p>'
                + '</span></button>';
        }).join('');

        els.panel.innerHTML =
            '<div class="wo-oam-ph">'
            + '<h2 class="wo-oam-ptitle">Notificaciones</h2>'
            + (total > 0 ? '<span class="wo-oam-pcount">' + (total > 99 ? '99+' : total) + '</span>' : '')
            + '<button type="button" class="wo-oam-x" aria-label="Cerrar">' + iconEl('x') + '</button>'
            + '</div>'
            + '<button type="button" class="wo-oam-mark">Marcar todas como leídas</button>'
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
                it.unread = false;
                if (it.href) { window.location.href = it.href; return; }
                renderAll();
            });
        });
        hydrateIcons(els.panel);
    }

    function renderBadge() {
        var total = unreadTotal();
        if (!els.badge) return;
        els.badge.textContent = total > 99 ? '99+' : String(total);
        els.badge.hidden = total <= 0;
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
    function positionDrop() {
        var r = els.trigger.getBoundingClientRect();
        var width = Math.min(460, window.innerWidth - 24);
        var left = Math.max(12, Math.min(r.right - width, window.innerWidth - width - 12));
        els.drop.style.top = (r.bottom + 10) + 'px';
        els.drop.style.left = left + 'px';
    }
    function setDrop(open) {
        state.open = open;
        els.drop.hidden = !open;
        els.trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open) positionDrop();
    }
    function setPanel(open) {
        state.panelOpen = open;
        els.panel.hidden = !open;
        els.scrim.hidden = !open;
    }

    /* ------------------------------ init ------------------------------ */
    async function resolveClient() {
        for (var i = 0; i < 20; i++) {
            var c = (window.WeotziData && window.WeotziData.getClient && window.WeotziData.getClient())
                || (window.ConfigManager && typeof window.ConfigManager.getSupabaseClient === 'function'
                    && window.ConfigManager.getSupabaseClient());
            if (c) return c;
            await new Promise(function (r) { setTimeout(r, 150); });
        }
        return null;
    }

    // Monta la UI y los listeners SIN esperar a la red: el click en el tile
    // abre el dropdown desde el primer momento (antes esperaba sesión+perfil y,
    // si eso tardaba o fallaba, el tile seguía navegando a /artist/account).
    function mountUi(tile) {
        ensureStyles();

        // El trigger es el tile o su ancestro clickeable (en algunas topbars el
        // tile es un span dentro de un <a> manejado por el JS de auth).
        els.trigger = tile.closest('a, button') || tile;
        var host = document.createElement('span');
        host.className = 'wo-oam-host';
        els.trigger.parentNode.insertBefore(host, els.trigger);
        host.appendChild(els.trigger);
        els.badge = document.createElement('span');
        els.badge.className = 'wo-oam-badge';
        els.badge.hidden = true;
        host.appendChild(els.badge);

        els.drop = document.createElement('div');
        els.drop.className = 'wo-oam-drop';
        els.drop.hidden = true;
        document.body.appendChild(els.drop);

        els.scrim = document.createElement('div');
        els.scrim.className = 'wo-oam-scrim';
        els.scrim.hidden = true;
        document.body.appendChild(els.scrim);

        els.panel = document.createElement('aside');
        els.panel.className = 'wo-oam-panel';
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
            if (state.panelOpen) { setPanel(false); return; }
            if (state.open) { setDrop(false); try { els.trigger.focus(); } catch (err) { } }
        });
        els.scrim.addEventListener('click', function () { setPanel(false); });
        window.addEventListener('resize', function () { if (state.open) positionDrop(); });
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
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { init(); });
    } else {
        init();
    }
})();
