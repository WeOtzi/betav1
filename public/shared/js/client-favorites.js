/**
 * WE OTZI - Mis favoritos del cliente (/client/favorites) · ronda 2, P22
 * ----------------------------------------------------------------------
 * Listas de favoritos: crear, renombrar y borrar listas; ver lo guardado por
 * tipo (artistas, diseños, merch, estudios) con enlace a cada destino; mover
 * un guardado a otra lista y quitarlo.
 *
 *   /client/favorites/                      lista por defecto
 *   ?lista=<id>[&tipo=artist|design|merch|studio]
 *
 * Estado y datos: window.WoFavorites (wo-favorites.js), que lee y escribe
 * SOLO por WeotziData.FavoriteLists. Reglas y textos: WoFavoritesModel.
 * Todo dato guardado entra al HTML escapado; las URL ya llegan validadas por
 * el modelo (rutas del mismo sitio / imágenes https).
 */
(function () {
    'use strict';

    var Model = window.WoFavoritesModel;
    var Fav = null;
    var mount = null;
    var view = { listId: '', kind: '' };
    var pendingFocus = null;      // selector a enfocar después de repintar
    var renderQueued = false;
    var hydrated = false;
    var noticeTimer = null;
    var KIND_ICONS = { artist: 'user', design: 'pen-tool', merch: 'shopping-bag', studio: 'home' };
    var KIND_ORDER = ['artist', 'design', 'merch', 'studio'];

    /* ------------------------------ helpers ------------------------------ */

    function esc(v) {
        return String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function byId(id) { return document.getElementById(id); }
    function appPath(path) { return Fav ? Fav.appPath(path) : path; }
    function icon(name) { return '<i data-wo-icon="' + esc(name) + '" aria-hidden="true"></i>'; }
    function hydrateIcons(node) {
        try { if (window.WoIcons && typeof window.WoIcons.hydrate === 'function') window.WoIcons.hydrate(node || document); } catch (e) { /* íconos opcionales */ }
    }
    function selectorValue(value) {
        return window.CSS && typeof window.CSS.escape === 'function' ? window.CSS.escape(value) : String(value).replace(/["\\]/g, '\\$&');
    }
    function itemTitle(item) { return item.label || Model.kindLabel(item.kind) || 'Guardado'; }
    function findList(id) {
        return Fav.lists().filter(function (l) { return l.id === id; })[0] || null;
    }
    function findItem(itemId) {
        return Fav.items().filter(function (it) { return it.itemId === itemId; })[0] || null;
    }

    function readParams() {
        try {
            var params = new URLSearchParams(window.location.search);
            view.listId = params.get('lista') || '';
            view.kind = Model.normalizeKind(params.get('tipo'));
        } catch (e) { /* sin parámetros */ }
    }
    function writeParams() {
        try {
            var params = new URLSearchParams(window.location.search);
            var list = findList(view.listId);
            if (list && !list.isDefault) params.set('lista', list.id); else params.delete('lista');
            if (view.kind) params.set('tipo', view.kind); else params.delete('tipo');
            var qs = params.toString();
            window.history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : '') + window.location.hash);
        } catch (e) { /* history no disponible */ }
    }

    /* ------------------------------- avisos ------------------------------ */

    // kind: success | error | info. action: { label, run } (opcional).
    function notice(kind, text, action) {
        var box = byId('cfv-notices');
        if (!box) return;
        if (noticeTimer) { clearTimeout(noticeTimer); noticeTimer = null; }
        box.textContent = '';
        var alert = document.createElement('div');
        alert.className = 'wo-alert wo-alert--' + (kind === 'error' ? 'error' : (kind === 'info' ? 'info' : 'success')) + ' cfv-notice';
        var span = document.createElement('span');
        span.className = 'cfv-notice-text';
        span.textContent = text;
        alert.appendChild(span);
        var dismiss = function () { if (alert.parentNode) alert.parentNode.removeChild(alert); };
        if (action && action.label) {
            var act = document.createElement('button');
            act.type = 'button';
            act.className = 'cfv-notice-act';
            act.textContent = action.label;
            act.addEventListener('click', function () { dismiss(); action.run(); });
            alert.appendChild(act);
        }
        var close = document.createElement('button');
        close.type = 'button';
        close.className = 'cfv-notice-x';
        close.setAttribute('aria-label', 'Cerrar aviso');
        close.innerHTML = icon('x');
        close.addEventListener('click', dismiss);
        alert.appendChild(close);
        box.appendChild(alert);
        hydrateIcons(alert);
        noticeTimer = setTimeout(dismiss, kind === 'error' ? 12000 : 8000);
    }
    function fail(err, context) {
        console.warn('[client-favorites]', err && err.message);
        notice('error', Fav.messageFor(err, context));
    }

    /* ------------------------------- HTML -------------------------------- */

    function emptyHtml(opts) {
        var o = opts || {};
        return '<div class="cfv-empty' + (o.full ? ' cfv-message' : '') + '">'
            + '<div class="cfv-empty-marks" aria-hidden="true"><i class="sq"></i><i class="ci"></i><i class="tr"></i></div>'
            + '<' + (o.heading || 'h3') + ' class="cfv-empty-title">' + esc(o.title) + '</' + (o.heading || 'h3') + '>'
            + (o.text ? '<p class="cfv-empty-text">' + esc(o.text) + '</p>' : '')
            + (o.actions && o.actions.length
                ? '<div class="cfv-empty-actions">' + o.actions.map(function (a, i) {
                    return '<a class="wo-btn ' + (i === 0 ? 'wo-btn--accent' : 'wo-btn--ghost') + ' wo-btn--s" href="' + esc(appPath(a.href)) + '">' + esc(a.label) + '</a>';
                }).join('') + '</div>'
                : '')
            + '</div>';
    }

    function listsHtml(lists, current) {
        return '<nav class="cfv-lists" aria-label="Tus listas"><ul class="cfv-lists-ul">'
            + lists.map(function (list) {
                var active = list.id === current.id;
                return '<li><button type="button" class="cfv-list-tab' + (active ? ' is-active' : '') + '" data-cfv-list="' + esc(list.id) + '"'
                    + (active ? ' aria-current="true"' : '') + '>'
                    + '<span class="cfv-list-name">' + esc(list.name) + '</span>'
                    + '<span class="cfv-list-count" aria-hidden="true">' + list.count + '</span>'
                    + '<span class="wo-sr-only">, ' + esc(Model.countLabel(list.count).toLowerCase()) + '</span>'
                    + '</button></li>';
            }).join('')
            + '</ul></nav>';
    }

    function kindsHtml(counts) {
        var kinds = KIND_ORDER.filter(function (k) { return counts[k] > 0; });
        if (kinds.length < 2) return '';
        var chip = function (value, label, n) {
            return '<button type="button" class="wo-chip" data-cfv-kind="' + esc(value) + '" aria-pressed="' + (view.kind === value ? 'true' : 'false') + '">'
                + esc(label) + ' <span class="cfv-kind-count">' + n + '</span></button>';
        };
        return '<div class="cfv-kinds" role="group" aria-label="Filtrar por tipo">'
            + chip('', 'Todo', counts.all)
            + kinds.map(function (k) { return chip(k, Model.kindLabel(k, true), counts[k]); }).join('')
            + '</div>';
    }

    function cardHtml(item, canMove) {
        var title = itemTitle(item);
        var href = item.url ? appPath(item.url) : '';
        var media = '<span class="cfv-card-ph" aria-hidden="true">' + icon(KIND_ICONS[item.kind] || 'heart') + '</span>'
            + (item.image ? '<img src="' + esc(item.image.charAt(0) === '/' ? appPath(item.image) : item.image) + '" alt="" loading="lazy" decoding="async">' : '');
        return '<li class="cfv-card" data-cfv-item="' + esc(item.itemId) + '">'
            + (href
                ? '<a class="cfv-card-media" href="' + esc(href) + '" tabindex="-1" aria-hidden="true">' + media + '</a>'
                : '<div class="cfv-card-media">' + media + '</div>')
            + '<div class="cfv-card-body">'
            + '<p class="cfv-card-kind">' + esc(Model.kindLabel(item.kind)) + '</p>'
            + '<h3 class="cfv-card-title">' + (href ? '<a href="' + esc(href) + '">' + esc(title) + '</a>' : esc(title)) + '</h3>'
            + '<div class="cfv-card-actions">'
            + (canMove
                ? '<button type="button" class="cfv-card-act" data-cfv-move aria-label="' + esc('Mover «' + title + '» a otra lista') + '">Mover</button>'
                : '')
            + '<button type="button" class="cfv-card-act cfv-card-act--danger" data-cfv-remove aria-label="' + esc('Quitar «' + title + '» de esta lista') + '">Quitar</button>'
            + '</div></div></li>';
    }

    function panelHtml(current, all, shown, counts) {
        var meta = [Model.countLabel(current.count)];
        if (current.isDefault) meta.push('Lista principal');
        var head = '<header class="cfv-panel-head">'
            + '<div class="cfv-panel-titles">'
            + '<h2 class="cfv-panel-title" id="cfv-panel-title" tabindex="-1">' + esc(current.name) + '</h2>'
            + '<p class="cfv-panel-meta">' + esc(meta.join(' · ')) + '</p>'
            + '</div>'
            + '<div class="cfv-panel-actions">'
            + '<button type="button" class="wo-btn wo-btn--ghost wo-btn--s" data-cfv-rename>' + icon('edit-2') + 'Renombrar</button>'
            + (current.isDefault ? '' : '<button type="button" class="wo-btn wo-btn--ghost wo-btn--s" data-cfv-delete>' + icon('trash-2') + 'Borrar lista</button>')
            + '</div></header>';
        var body;
        if (!all.length) {
            body = emptyHtml({
                title: 'Esta lista está vacía',
                text: 'Toca el corazón de un artista, un diseño, un producto o un estudio para guardarlo aquí.',
                actions: [
                    { label: 'Explorar artistas', href: '/marketplace' },
                    { label: 'Ver estudios', href: '/marketplace?modo=estudios' }
                ]
            });
        } else {
            body = kindsHtml(counts)
                + '<ul class="cfv-grid" aria-label="' + esc('Guardados en ' + current.name) + '">'
                + shown.map(function (item) { return cardHtml(item, true); }).join('')
                + '</ul>';
        }
        return '<section class="cfv-panel" aria-labelledby="cfv-panel-title">' + head + body + '</section>';
    }

    /* ------------------------------ render ------------------------------- */

    function render() {
        renderQueued = false;
        if (!mount || !Fav) return;
        var lists = Fav.lists();
        mount.removeAttribute('aria-busy');
        if (!lists.length) {
            mount.innerHTML = emptyHtml({
                full: true,
                heading: 'h2',
                title: 'Todavía no tienes favoritos',
                text: 'Toca el corazón de un artista, un diseño, un producto o un estudio y lo vas a encontrar aquí.',
                actions: [{ label: 'Explorar artistas', href: '/marketplace' }]
            });
            return;
        }
        var current = findList(view.listId) || lists[0];
        view.listId = current.id;
        var all = Fav.items({ listId: current.id });
        var counts = Model.kindCounts(all);
        if (view.kind && !counts[view.kind]) view.kind = '';
        var shown = view.kind ? all.filter(function (it) { return it.kind === view.kind; }) : all;
        mount.innerHTML = listsHtml(lists, current) + panelHtml(current, all, shown, counts);
        hydrateIcons(mount);
        writeParams();
        var newButton = byId('cfv-new-list');
        if (newButton) newButton.disabled = !Model.canCreateList(lists);
        if (pendingFocus) {
            var target = mount.querySelector(pendingFocus) || mount.querySelector('#cfv-panel-title');
            pendingFocus = null;
            if (target) { try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); } }
        }
        var activeTab = mount.querySelector('.cfv-list-tab.is-active');
        if (activeTab && typeof activeTab.scrollIntoView === 'function' && window.matchMedia && window.matchMedia('(max-width: 899px)').matches) {
            try { activeTab.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { /* noop */ }
        }
    }
    function queueRender() {
        if (renderQueued) return;
        renderQueued = true;
        if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(render); else setTimeout(render, 16);
    }

    function message(opts) {
        if (!mount) return;
        mount.removeAttribute('aria-busy');
        mount.innerHTML = emptyHtml(Object.assign({ full: true, heading: 'h2' }, opts));
    }

    /* ------------------------------ diálogos ----------------------------- */

    var dialogOpener = null;
    function openDialog(dialog, opener) {
        dialogOpener = opener || document.activeElement;
        if (typeof dialog.showModal === 'function') {
            if (!dialog.open) dialog.showModal();
        } else {
            dialog.setAttribute('open', '');
        }
    }
    function closeDialog(dialog) {
        if (typeof dialog.close === 'function') { if (dialog.open) dialog.close(); }
        else dialog.removeAttribute('open');
    }
    function restoreFocus() {
        var opener = dialogOpener;
        dialogOpener = null;
        if (pendingFocus) return;   // el repintado decide el foco
        if (opener && document.contains(opener) && typeof opener.focus === 'function') opener.focus();
        else { var title = byId('cfv-panel-title'); if (title) title.focus(); }
    }
    function setError(node, text) {
        if (!node) return;
        node.textContent = text || '';
        node.hidden = !text;
    }

    // Crear / renombrar
    var nameMode = { type: 'create', listId: '' };
    function openNameDialog(type, list, opener) {
        nameMode = { type: type, listId: list ? list.id : '' };
        var input = byId('cfv-name-input');
        byId('cfv-name-title').textContent = type === 'rename' ? 'Renombrar lista' : 'Nueva lista';
        byId('cfv-name-submit').textContent = type === 'rename' ? 'Guardar nombre' : 'Crear lista';
        input.value = type === 'rename' && list ? list.name : '';
        input.removeAttribute('aria-invalid');
        setError(byId('cfv-name-error'), '');
        openDialog(byId('cfv-dialog-name'), opener);
        input.focus();
        if (type === 'rename') input.select();
    }
    function submitName(e) {
        e.preventDefault();
        var input = byId('cfv-name-input');
        var submit = byId('cfv-name-submit');
        var error = byId('cfv-name-error');
        if (submit.disabled) return;
        var check = Model.validateListName(input.value, Fav.lists(), nameMode.type === 'rename' ? nameMode.listId : undefined);
        if (!check.ok) {
            setError(error, check.error);
            input.setAttribute('aria-invalid', 'true');
            input.focus();
            return;
        }
        setError(error, '');
        input.removeAttribute('aria-invalid');
        submit.disabled = true;
        var job = nameMode.type === 'rename' ? Fav.renameList(nameMode.listId, check.value) : Fav.createList(check.value);
        job.then(function (list) {
            view.listId = list.id;
            view.kind = '';
            pendingFocus = '[data-cfv-list="' + selectorValue(list.id) + '"]';
            closeDialog(byId('cfv-dialog-name'));
            notice('success', nameMode.type === 'rename' ? 'La lista ahora se llama «' + list.name + '».' : 'Creaste la lista «' + list.name + '».');
            queueRender();
        }).catch(function (err) {
            setError(error, Fav.messageFor(err, 'list'));
            input.setAttribute('aria-invalid', 'true');
            input.focus();
        }).then(function () { submit.disabled = false; });
    }

    // Borrar
    var deleteListId = '';
    function openDeleteDialog(list, opener) {
        deleteListId = list.id;
        var inside = list.count === 1 ? ' y el guardado que contiene' : (list.count > 1 ? ' y los ' + list.count + ' guardados que contiene' : '');
        byId('cfv-delete-text').textContent = 'Vas a borrar «' + list.name + '»' + inside + '. Esta acción no se puede deshacer.';
        setError(byId('cfv-delete-error'), '');
        openDialog(byId('cfv-dialog-delete'), opener);
        byId('cfv-delete-confirm').focus();
    }
    function confirmDelete() {
        var confirm = byId('cfv-delete-confirm');
        if (confirm.disabled || !deleteListId) return;
        var list = findList(deleteListId);
        confirm.disabled = true;
        Fav.deleteList(deleteListId).then(function () {
            view.listId = '';
            view.kind = '';
            pendingFocus = '#cfv-panel-title';
            closeDialog(byId('cfv-dialog-delete'));
            notice('success', 'Borraste la lista' + (list ? ' «' + list.name + '»' : '') + '.');
            queueRender();
        }).catch(function (err) {
            setError(byId('cfv-delete-error'), Fav.messageFor(err, 'list'));
        }).then(function () { confirm.disabled = false; });
    }

    // Mover
    var moveItemId = '';
    function openMoveDialog(item, opener) {
        moveItemId = item.itemId;
        var title = itemTitle(item);
        var others = Fav.lists().filter(function (l) { return l.id !== item.listId; });
        byId('cfv-move-text').textContent = others.length
            ? 'Elige a qué lista quieres mover «' + title + '».'
            : 'Todavía no tienes otra lista. Crea una para mover «' + title + '».';
        var box = byId('cfv-move-lists');
        box.textContent = '';
        others.forEach(function (list) {
            var li = document.createElement('li');
            var button = document.createElement('button');
            button.type = 'button';
            button.className = 'cfv-move-list';
            button.setAttribute('data-cfv-move-to', list.id);
            var name = document.createElement('span');
            name.className = 'cfv-list-name';
            name.textContent = list.name;
            var count = document.createElement('span');
            count.className = 'cfv-list-count';
            count.textContent = String(list.count);
            button.appendChild(name);
            button.appendChild(count);
            li.appendChild(button);
            box.appendChild(li);
        });
        byId('cfv-move-input').value = '';
        setError(byId('cfv-move-error'), '');
        byId('cfv-move-form').hidden = !Model.canCreateList(Fav.lists());
        openDialog(byId('cfv-dialog-move'), opener);
        var first = box.querySelector('button') || byId('cfv-move-input');
        if (first) first.focus();
    }
    function setMoveBusy(isBusy) {
        var dialog = byId('cfv-dialog-move');
        Array.prototype.forEach.call(dialog.querySelectorAll('[data-cfv-move-to], #cfv-move-submit'), function (node) { node.disabled = isBusy; });
    }
    function moveTo(listId) {
        var item = findItem(moveItemId);
        var dest = findList(listId);
        if (!item || !dest) { closeDialog(byId('cfv-dialog-move')); return Promise.resolve(); }
        setMoveBusy(true);
        return Fav.moveItem(item.itemId, listId).then(function (res) {
            pendingFocus = '#cfv-panel-title';
            closeDialog(byId('cfv-dialog-move'));
            var title = itemTitle(item);
            notice('success', res && res.merged
                ? '«' + title + '» ya estaba en «' + dest.name + '»: lo quitamos de esta lista.'
                : 'Moviste «' + title + '» a «' + dest.name + '».',
                { label: 'Ver lista', run: function () { view.listId = dest.id; view.kind = ''; pendingFocus = '#cfv-panel-title'; queueRender(); } });
            queueRender();
        }).catch(function (err) {
            setError(byId('cfv-move-error'), Fav.messageFor(err));
            byId('cfv-move-form').hidden = false;
        }).then(function () { setMoveBusy(false); });
    }
    function submitMoveNew(e) {
        e.preventDefault();
        var input = byId('cfv-move-input');
        var error = byId('cfv-move-error');
        if (byId('cfv-move-submit').disabled) return;
        var check = Model.validateListName(input.value, Fav.lists());
        if (!check.ok) { setError(error, check.error); input.focus(); return; }
        setError(error, '');
        setMoveBusy(true);
        Fav.createList(check.value).then(function (list) {
            return moveTo(list.id);
        }).catch(function (err) {
            setError(error, Fav.messageFor(err, 'list'));
            setMoveBusy(false);
            input.focus();
        });
    }

    /* ------------------------------ acciones ----------------------------- */

    function removeItem(item, button) {
        if (button) button.disabled = true;
        var card = mount.querySelector('[data-cfv-item="' + selectorValue(item.itemId) + '"]');
        var next = card && (card.nextElementSibling || card.previousElementSibling);
        pendingFocus = next ? '[data-cfv-item="' + selectorValue(next.getAttribute('data-cfv-item')) + '"] [data-cfv-remove]' : '#cfv-panel-title';
        var list = findList(item.listId);
        Fav.removeItem(item.itemId).then(function () {
            notice('success', 'Quitaste «' + itemTitle(item) + '»' + (list ? ' de «' + list.name + '»' : '') + '.', {
                label: 'Deshacer',
                run: function () {
                    Fav.save(item, item.listId).then(function () { notice('success', '«' + itemTitle(item) + '» volvió a la lista.'); }).catch(fail);
                }
            });
        }).catch(function (err) {
            pendingFocus = null;
            if (button) button.disabled = false;
            fail(err);
        });
    }

    function onMountClick(e) {
        var target = e.target;
        if (!target || typeof target.closest !== 'function') return;
        var tab = target.closest('[data-cfv-list]');
        if (tab) {
            view.listId = tab.getAttribute('data-cfv-list');
            view.kind = '';
            pendingFocus = '[data-cfv-list="' + selectorValue(view.listId) + '"]';
            render();
            return;
        }
        var chip = target.closest('[data-cfv-kind]');
        if (chip) {
            view.kind = Model.normalizeKind(chip.getAttribute('data-cfv-kind'));
            pendingFocus = '[data-cfv-kind="' + selectorValue(view.kind) + '"]';
            render();
            return;
        }
        var current = findList(view.listId);
        var rename = target.closest('[data-cfv-rename]');
        if (rename && current) { openNameDialog('rename', current, rename); return; }
        var del = target.closest('[data-cfv-delete]');
        if (del && current && !current.isDefault) { openDeleteDialog(current, del); return; }
        var card = target.closest('[data-cfv-item]');
        if (!card) return;
        var item = findItem(card.getAttribute('data-cfv-item'));
        if (!item) return;
        var move = target.closest('[data-cfv-move]');
        if (move) { openMoveDialog(item, move); return; }
        var remove = target.closest('[data-cfv-remove]');
        if (remove) removeItem(item, remove);
    }

    // Los guardados que vinieron del marketplace anterior no traen nombre ni
    // foto: se completan una vez con los datos públicos del artista.
    function hydrateArtists() {
        if (hydrated) return;
        hydrated = true;
        var D = window.WeotziData;
        if (!D || !D.Artists || typeof D.Artists.listByUserIds !== 'function') return;
        var missing = Fav.items({ kind: 'artist' }).filter(function (it) { return !it.label && Model.isUuid(it.id); }).slice(0, 60);
        if (!missing.length) return;
        var ids = missing.map(function (it) { return it.id; }).filter(function (id, i, arr) { return arr.indexOf(id) === i; });
        Promise.resolve(D.Artists.listByUserIds(ids, 'user_id, name, username, profile_picture')).then(function (res) {
            var rows = (res && res.data) || [];
            var byUser = {};
            rows.forEach(function (row) { if (row && row.user_id) byUser[String(row.user_id).toLowerCase()] = row; });
            return Promise.all(missing.map(function (it) {
                var artist = byUser[it.id];
                var label = artist && (artist.name || artist.username);
                if (!label) return null;
                return Fav.save({
                    kind: 'artist',
                    id: it.id,
                    label: label,
                    image: artist.profile_picture,
                    url: artist.username ? '/artist/profile?artist=' + encodeURIComponent(artist.username) : it.url
                }, it.listId).catch(function () { return null; });
            }));
        }).catch(function (err) { console.warn('[client-favorites] no se pudieron completar los artistas:', err && err.message); });
    }

    /* ------------------------------ arranque ----------------------------- */

    function wire() {
        mount.addEventListener('click', onMountClick);
        // Imagen caída: queda el ícono del tipo (el <img> se quita).
        mount.addEventListener('error', function (e) {
            var node = e.target;
            if (node && node.tagName === 'IMG' && node.parentNode) node.parentNode.removeChild(node);
        }, true);
        byId('cfv-new-list').addEventListener('click', function (e) { openNameDialog('create', null, e.currentTarget); });
        byId('cfv-name-form').addEventListener('submit', submitName);
        byId('cfv-delete-confirm').addEventListener('click', confirmDelete);
        byId('cfv-move-form').addEventListener('submit', submitMoveNew);
        byId('cfv-move-lists').addEventListener('click', function (e) {
            var button = e.target && e.target.closest ? e.target.closest('[data-cfv-move-to]') : null;
            if (button && !button.disabled) moveTo(button.getAttribute('data-cfv-move-to'));
        });
        Array.prototype.forEach.call(document.querySelectorAll('.cfv-dialog'), function (dialog) {
            dialog.addEventListener('close', restoreFocus);
            dialog.addEventListener('click', function (e) {
                var close = e.target && e.target.closest ? e.target.closest('[data-cfv-close]') : null;
                if (close) { closeDialog(dialog); return; }
                // Clic en el fondo: el destino es el propio <dialog> y el punto
                // queda fuera de su caja (adentro sería el relleno del diálogo).
                if (e.target !== dialog) return;
                var box = dialog.getBoundingClientRect();
                var inside = e.clientX >= box.left && e.clientX <= box.right && e.clientY >= box.top && e.clientY <= box.bottom;
                if (!inside) closeDialog(dialog);
            });
        });
        document.addEventListener('wo:favorites-change', queueRender);
    }

    function wireLogout() {
        var logout = byId('cfv-logout');
        if (!logout) return;
        logout.addEventListener('click', function () {
            var client = window.WeotziData && typeof window.WeotziData.getClient === 'function' ? window.WeotziData.getClient() : null;
            var done = function () { window.location.href = appPath('/client/login'); };
            if (!client || !client.auth) { done(); return; }
            Promise.resolve(client.auth.signOut()).then(done, done);
        });
    }

    function init() {
        mount = byId('cfv-root');
        Fav = window.WoFavorites || null;
        if (!mount) return;
        if (!Model || !Fav || !Fav.__real) {
            mount.removeAttribute('aria-busy');
            mount.textContent = 'No pudimos cargar tus favoritos. Recarga la página en unos segundos.';
            return;
        }
        readParams();
        wireLogout();
        Fav.ready().then(function () {
            if (!Fav.available) {
                message({ title: 'Los favoritos todavía no están disponibles', text: 'Estamos terminando de prepararlos. Vuelve a intentarlo más tarde.', actions: [{ label: 'Explorar artistas', href: '/marketplace' }] });
                return null;
            }
            if (!Fav.userId) {
                window.location.href = appPath('/client/login');
                return null;
            }
            wire();
            // Garantiza la lista "Favoritos" antes de crear otras.
            return Fav.ensureDefaultList().then(function () {
                render();
                hydrateArtists();
            });
        }).catch(function (err) {
            console.error('[client-favorites] carga:', err);
            message({ title: 'No pudimos cargar tus favoritos', text: (Fav.messageFor(err) || '') + ' Recarga la página para intentarlo de nuevo.' });
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
