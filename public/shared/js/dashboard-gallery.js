/* ============================================================================
   WE ÖTZI — Dashboard del artista · Galería de trabajos (Figma 2003:862,
   estados 2003:1191 / 2003:1902 / 2003:2583)
   ----------------------------------------------------------------------------
   Pinta la grilla de #gallery-admin-grid y maneja sus acciones:
     · mosaico con leyenda (nombre del trabajo) + papelera por celda
     · primer trabajo = destacado (bandera ★, ocupa 2×2) · ★ en hover destaca
     · insignias VIDEO · 0:24, NUEVO · IG (borde amarillo) y PENDIENTE · IG
       arriba a la derecha
     · dropzone punteada "SUBIR MÁS · N LIBRES" (click o soltar archivos)
     · reordenar arrastrando (o Alt + flechas con el teclado)
     · renombrar tocando el nombre (Enter guarda, Escape cancela)

   dashboard.js sigue siendo dueño de los datos: normaliza el feed
   (artists_db.gallery_feed_items, JSON sin migración), lo persiste por la
   capa PostgREST y sube/borra archivos. Este módulo recibe esas funciones
   por `bind()` y no toca la red.

   Campos del ítem que usa la galería (todos opcionales salvo url/kind):
     title        nombre visible del trabajo (lo edita el artista)
     caption      texto de la publicación de IG (el importador lo guarda)
     duration     segundos del video
     source       'instagram' cuando lo sumó el importador
     imported_at  ISO de la importación (marca NUEVO · IG durante 7 días)
     ig_handle    cuenta de IG de la que vino (la escribe el importador)
     ig_legacy    importado antes de la validación de IG: sigue público

   PENDIENTE · IG: foto de Instagram que el perfil público todavía oculta
   porque la cuenta no está validada. La regla vive en gallery-visibility.js
   (window.WoGalleryVisibility) y el estado lo deja dashboard.js en
   window.WoIgValidationState; sin alguno de los dos no se marca nada.

   Módulo UMD: las funciones puras se prueban en tests/figma-final-dashboard.
   ============================================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WodGallery = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var NEW_IMPORT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
  var TITLE_MAX = 60;
  // Ronda 2 (N3): pie de foto por trabajo. Misma limpieza que
  // public/shared/js/gallery-caption.js (si está cargado, se usa ese módulo).
  var CAPTION_MAX = 2200;
  function captionModule() {
    if (typeof window !== 'undefined' && window.WoGalleryCaption) return window.WoGalleryCaption;
    if (typeof module === 'object' && module.exports && typeof require === 'function') {
      try { return require('./gallery-caption.js'); } catch (_) { return null; }
    }
    return null;
  }
  function cleanCaption(value) {
    var mod = captionModule();
    if (mod) return mod.sanitizeCaption(value);
    if (typeof value !== 'string') return '';
    var text = value.replace(/\r\n?/g, '\n').replace(/\t/g, ' ')
      .replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F‪-‮⁦-⁩﻿]/g, '')
      .replace(/\n{3,}/g, '\n\n').trim();
    var points = Array.from(text);
    return points.length > CAPTION_MAX ? points.slice(0, CAPTION_MAX).join('').trim() : text;
  }
  var PENDING_HINT = 'Se muestra en tu perfil público cuando valides tu Instagram';

  /* ---------------------------------------------------------------- puras --- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Primera línea útil de un caption de IG: sin #hashtags ni @menciones,
  // cortada a 48 caracteres en un límite de palabra.
  function captionTitle(caption) {
    var lines = String(caption || '').split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].replace(/[#@][\w.À-ɏ]+/g, ' ').replace(/\s+/g, ' ')
        .replace(/^[\s·\-—–|:,.]+|[\s·\-—–|:,]+$/g, '').trim();
      if (!t) continue;
      if (t.length <= 48) return t;
      var cut = t.slice(0, 48);
      var sp = cut.lastIndexOf(' ');
      return (sp > 24 ? cut.slice(0, sp) : cut).replace(/[\s,.;:]+$/, '') + '…';
    }
    return '';
  }

  // Nombre que muestra la celda (sin el sufijo "— destacado").
  function itemTitle(item) {
    var own = String((item && item.title) || '').trim();
    if (own) return own.slice(0, TITLE_MAX);
    return captionTitle(item && item.caption);
  }

  // 24 → "0:24" · 75 → "1:15". Sin dato válido, "".
  function formatDuration(seconds) {
    var s = Math.round(Number(seconds));
    if (!isFinite(s) || s <= 0) return '';
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function isVideo(item) {
    return !!item && item.kind === 'video';
  }
  function isVideoUrl(url) {
    var raw = String(url || '');
    if (/^data:video\//i.test(raw)) return true;
    var ext = raw.split('?')[0].split('.').pop().toLowerCase();
    return ext === 'mp4' || ext === 'mov' || ext === 'webm';
  }
  // Se pinta como <video> si la URL reproduce: archivo de video, data:video/
  // o el blob: que deja la subida de la vista previa. Un reel de IG con
  // miniatura .jpg sigue siendo video (cuenta en N/2 VIDEOS) pero se ve como
  // imagen con la insignia VIDEO.
  function isPlayable(item) {
    if (!item) return false;
    return isVideoUrl(item.url) || (isVideo(item) && /^blob:/i.test(String(item.url || '')));
  }

  function isFromInstagram(item) {
    if (!item) return false;
    if (item.source === 'instagram') return true;
    if (/instagram\.com\//i.test(String(item.permalink || ''))) return true;
    return /\/instagram-import\//.test(String(item.url || ''));
  }

  // NUEVO · IG: lo sumó el importador hace menos de 7 días.
  function isNewImport(item, now) {
    if (!isFromInstagram(item) || !item.imported_at) return false;
    var at = new Date(item.imported_at).getTime();
    if (!isFinite(at)) return false;
    var ref = now instanceof Date ? now.getTime() : (Number(now) || Date.now());
    return ref - at >= 0 && ref - at < NEW_IMPORT_WINDOW_MS;
  }

  // PENDIENTE · IG: el artista la ve, los clientes todavía no.
  function isPendingImport(item) {
    var w = typeof window !== 'undefined' ? window : null;
    var visibility = w && w.WoGalleryVisibility;
    var state = w && w.WoIgValidationState;
    if (!visibility || !state || typeof visibility.isPendingValidation !== 'function') return false;
    return visibility.isPendingValidation(item, state);
  }

  function counts(feed, max, maxVideos) {
    var list = Array.isArray(feed) ? feed : [];
    var videos = list.filter(isVideo).length;
    return {
      files: list.length,
      max: max || 50,
      videos: videos,
      maxVideos: maxVideos || 2,
      free: Math.max(0, (max || 50) - list.length)
    };
  }
  // "8/50 ARCHIVOS · 1/2 VIDEOS" (2003:880)
  function quotaLabel(feed, max, maxVideos) {
    var c = counts(feed, max, maxVideos);
    return c.files + '/' + c.max + ' ARCHIVOS · ' + c.videos + '/' + c.maxVideos + ' VIDEOS';
  }
  // "4 LIBRES" / "1 LIBRE" (2003:891)
  function freeLabel(free) {
    var n = Math.max(0, Number(free) || 0);
    return n + (n === 1 ? ' LIBRE' : ' LIBRES');
  }

  // Devuelve una copia con el ítem `from` movido a la posición `to`.
  function moveItem(list, from, to) {
    var next = Array.isArray(list) ? list.slice() : [];
    if (from === to || from < 0 || to < 0 || from >= next.length || to >= next.length) return next;
    next.splice(to, 0, next.splice(from, 1)[0]);
    return next;
  }

  // Campos extra que la normalización del feed tiene que conservar.
  // ig_handle / ig_legacy deciden la visibilidad pública: si se pierden al
  // guardar, una foto ya publicada pasaría a quedar oculta.
  var EXTRA_FIELDS = ['id', 'title', 'caption', 'permalink', 'source', 'imported_at', 'ig_handle', 'ig_legacy', 'duration', 'is_featured'];
  function pickExtras(raw) {
    var out = {};
    if (!raw || typeof raw !== 'object') return out;
    EXTRA_FIELDS.forEach(function (k) {
      if (raw[k] === undefined || raw[k] === null || raw[k] === '') return;
      out[k] = raw[k];
    });
    if (out.title != null) out.title = String(out.title).trim().slice(0, TITLE_MAX);
    // Pie de foto: solo texto plano saneado (ronda 2 · N3).
    if (out.caption != null) {
      var cap = cleanCaption(out.caption);
      if (cap) out.caption = cap; else delete out.caption;
    }
    if (out.duration != null) {
      var d = Math.round(Number(out.duration));
      if (isFinite(d) && d > 0) out.duration = d; else delete out.duration;
    }
    if (out.duration == null && raw.video_duration != null) {
      var vd = Math.round(Number(raw.video_duration));
      if (isFinite(vd) && vd > 0) out.duration = vd;
    }
    return out;
  }

  /* ------------------------------------------------------------------ DOM --- */
  function icon(name) { return '<i data-wo-icon="' + name + '" aria-hidden="true"></i>'; }

  /* -------------------------------------------- pie de foto (ronda 2 · N3) --- */
  var CAPTION_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" aria-hidden="true">' +
    '<path d="M4 6h16M4 12h16M4 18h9"/></svg>';

  // Devuelve una copia del feed con el pie del ítem `index` cambiado.
  function setCaption(list, index, value) {
    var next = Array.isArray(list) ? list.slice() : [];
    if (index < 0 || index >= next.length || !next[index]) return next;
    var patched = Object.assign({}, next[index]);
    var clean = cleanCaption(value);
    if (clean) patched.caption = clean; else delete patched.caption;
    next[index] = patched;
    return next;
  }

  function ensureCaptionStyles() {
    if (typeof document === 'undefined' || document.getElementById('wod-gal-caption-styles')) return;
    var style = document.createElement('style');
    style.id = 'wod-gal-caption-styles';
    style.textContent = [
      '.wod-gal-cap{flex:none;display:grid;place-items:center;width:28px;height:28px;padding:0;border:var(--border-hairline,1px) solid transparent;background:none;color:var(--neutral-300,#b9ae98);cursor:pointer}',
      '.wod-gal-cap.has-caption{color:var(--yellow-300,#f2b519)}',
      '.wod-gal-cap:hover{color:var(--neutral-100,#faf8f3);border-color:currentColor}',
      '.wod-gal-cap:focus-visible{outline:none;box-shadow:0 0 0 2px var(--yellow-300,#f2b519)}',
      '.wod-gal-capdlg{position:fixed;inset:0;z-index:1200;display:flex;align-items:center;justify-content:center;padding:var(--space-4,16px);background:color-mix(in srgb,var(--neutral-500,#24211d) 72%,transparent);box-sizing:border-box}',
      '.wod-gal-capdlg-card{display:flex;flex-direction:column;gap:var(--space-3,12px);width:min(520px,100%);max-height:calc(100vh - 32px);overflow:auto;padding:var(--space-6,24px);background:var(--surface-card,#fff);border:var(--border-strong-width,2px) solid var(--border-strong,#24211d);box-shadow:var(--shadow-hard,6px 6px 0 #24211d);box-sizing:border-box}',
      '.wod-gal-capdlg-title{margin:0;font-family:var(--font-display,"Archivo Black",sans-serif);font-size:20px;line-height:1.2;color:var(--text-heading,#001125)}',
      '.wod-gal-capdlg-lead{margin:0;font-family:var(--font-body,sans-serif);font-size:14px;line-height:1.4;color:var(--text-muted,#5a5449)}',
      '.wod-gal-capdlg-label{font-family:var(--font-mono,monospace);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--text-body,#24211d)}',
      '.wod-gal-capdlg-input{width:100%;min-height:120px;padding:var(--space-3,12px);box-sizing:border-box;resize:vertical;background:var(--surface-input,#faf8f3);border:var(--border-hairline,1px) solid var(--neutral-500,#24211d);border-radius:0;font-family:var(--font-body,sans-serif);font-size:15px;line-height:1.4;color:var(--text-body,#24211d)}',
      '.wod-gal-capdlg-input:focus{outline:none;background:var(--white,#fff);border-width:var(--border-strong-width,2px);padding:calc(var(--space-3,12px) - 1px)}',
      '.wod-gal-capdlg-foot{display:flex;align-items:center;justify-content:space-between;gap:var(--space-3,12px);flex-wrap:wrap}',
      '.wod-gal-capdlg-count{font-family:var(--font-mono,monospace);font-size:11px;letter-spacing:.06em;color:var(--text-muted,#5a5449)}',
      '.wod-gal-capdlg-actions{display:flex;gap:var(--space-2,8px);margin-left:auto}',
      '.wod-gal-capdlg-btn{min-height:44px;padding:0 var(--space-5,20px);border:var(--border-strong-width,2px) solid var(--border-strong,#24211d);border-radius:0;background:transparent;font-family:var(--font-mono,monospace);font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--text-body,#24211d);cursor:pointer}',
      '.wod-gal-capdlg-btn.is-primary{background:var(--yellow-300,#f2b519);color:var(--ink,#001125)}',
      '.wod-gal-capdlg-btn:focus-visible{outline:none;box-shadow:0 0 0 2px var(--surface-card,#fff),0 0 0 4px var(--ink,#001125)}',
      '@media (max-width:480px){.wod-gal-capdlg-card{padding:var(--space-4,16px)}.wod-gal-capdlg-actions{width:100%}.wod-gal-capdlg-btn{flex:1}}'
    ].join('\n');
    document.head.appendChild(style);
  }

  // Diálogo "Pie de foto". onSave(texto saneado) se llama solo si cambió.
  function openCaptionDialog(item, label, onSave) {
    if (typeof document === 'undefined' || !item) return null;
    ensureCaptionStyles();
    var previous = document.querySelector('.wod-gal-capdlg');
    if (previous) previous.remove();
    var lastFocus = document.activeElement;
    var before = cleanCaption(item.caption);
    var overlay = document.createElement('div');
    overlay.className = 'wod-gal-capdlg';
    overlay.innerHTML =
      '<div class="wod-gal-capdlg-card" role="dialog" aria-modal="true" aria-labelledby="wod-gal-capdlg-title">' +
        '<h2 class="wod-gal-capdlg-title" id="wod-gal-capdlg-title">Pie de foto</h2>' +
        '<p class="wod-gal-capdlg-lead">' + esc(label || 'Este trabajo') + '. El pie se muestra junto a la foto en tu perfil público.' +
          (isFromInstagram(item) ? ' Lo trajimos de Instagram: puedes cambiarlo.' : '') + '</p>' +
        '<label class="wod-gal-capdlg-label" for="wod-gal-capdlg-input">Texto del pie</label>' +
        '<textarea class="wod-gal-capdlg-input" id="wod-gal-capdlg-input" maxlength="' + CAPTION_MAX + '" placeholder="Cuenta algo de este trabajo: estilo, zona, sesiones…"></textarea>' +
        '<div class="wod-gal-capdlg-foot">' +
          '<span class="wod-gal-capdlg-count" aria-live="polite"></span>' +
          '<div class="wod-gal-capdlg-actions">' +
            '<button type="button" class="wod-gal-capdlg-btn" data-cap-cancel>Cancelar</button>' +
            '<button type="button" class="wod-gal-capdlg-btn is-primary" data-cap-save>Guardar</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    var area = overlay.querySelector('textarea');
    var count = overlay.querySelector('.wod-gal-capdlg-count');
    area.value = before;
    function paint() { count.textContent = Array.from(area.value).length + ' / ' + CAPTION_MAX; }
    function close() {
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      if (lastFocus && document.contains(lastFocus)) { try { lastFocus.focus(); } catch (_) { /* foco opcional */ } }
    }
    function save() {
      var value = cleanCaption(area.value);
      close();
      if (value !== before && typeof onSave === 'function') onSave(value);
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); return; }
      if (e.key !== 'Tab') return;
      var focusables = overlay.querySelectorAll('textarea, button');
      var first = focusables[0];
      var last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    area.addEventListener('input', paint);
    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) close(); });
    overlay.querySelector('[data-cap-cancel]').addEventListener('click', close);
    overlay.querySelector('[data-cap-save]').addEventListener('click', save);
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);
    paint();
    setTimeout(function () { try { area.focus(); area.setSelectionRange(area.value.length, area.value.length); } catch (_) { /* foco opcional */ } }, 30);
    return overlay;
  }

  function cellMarkup(item, index, total, now) {
    var name = itemTitle(item);
    var featured = index === 0;
    var shown = featured ? (name ? name + ' — destacado' : 'Trabajo destacado') : (name || 'Sin título');
    var label = name || 'Trabajo ' + (index + 1);
    var video = isVideo(item);
    // Pendiente de validación le gana a NUEVO: es lo que el artista tiene que resolver.
    var pending = isPendingImport(item);
    var fresh = !pending && isNewImport(item, now);
    var dur = formatDuration(item.duration);
    var media = video && isPlayable(item)
      ? '<video src="' + esc(item.url) + '" preload="metadata" muted playsinline tabindex="-1" aria-hidden="true"></video>'
      : '<img src="' + esc(item.url) + '" alt="" loading="lazy">';
    var tags = '';
    if (pending) tags += '<span class="wod-gal-tag is-pending" title="' + PENDING_HINT + '">PENDIENTE · IG</span>';
    else if (fresh) tags += '<span class="wod-gal-tag is-new">NUEVO · IG</span>';
    if (video) tags += '<span class="wod-gal-tag is-video" data-gal-duration>' + (dur ? 'VIDEO · ' + esc(dur) : 'VIDEO') + '</span>';

    return '<div class="gallery-item wod-gal-cell' + (featured ? ' is-featured' : '') + (video ? ' is-video' : '') +
        (fresh ? ' is-new' : '') + (pending ? ' is-pending' : '') + (name ? '' : ' is-untitled') + '" data-index="' + index + '" draggable="true" role="listitem">' +
      media +
      // Botón transparente sobre la imagen: abre el visor (dashboard.js) y
      // es el punto de foco para reordenar con Alt + flechas.
      '<button type="button" class="wod-gal-open" aria-label="Ver ' + esc(label) + ' (' + (index + 1) + ' de ' + total +
        ').' + (pending ? ' Pendiente: ' + PENDING_HINT.charAt(0).toLowerCase() + PENDING_HINT.slice(1) + '.' : '') +
        ' Alt + flechas para reordenar.">' + (video ? '<span class="wod-gal-eye">' + icon('eye') + '</span>' : '') + '</button>' +
      (tags ? '<div class="wod-gal-tags">' + tags + '</div>' : '') +
      (featured
        ? '<span class="wod-gal-flag" aria-hidden="true"><b>★</b></span>'
        : '<button type="button" class="wod-gal-feature" data-gal-action="feature" aria-label="Destacar ' + esc(label) + '"><b aria-hidden="true">★</b></button>') +
      '<div class="wod-gal-bar">' +
        '<button type="button" class="wod-gal-name" data-gal-action="rename" title="Cambiar el nombre" aria-label="Cambiar el nombre de ' +
          esc(label) + '"><span>' + esc(shown) + '</span></button>' +
        // Ronda 2 (N3): pie de foto (el de Instagram llega precargado).
        '<button type="button" class="wod-gal-cap' + (cleanCaption(item.caption) ? ' has-caption' : '') + '" data-gal-action="caption" title="Pie de foto" aria-label="' +
          (cleanCaption(item.caption) ? 'Editar el pie de foto de ' : 'Agregar un pie de foto a ') + esc(label) + '">' + CAPTION_ICON + '</button>' +
        '<button type="button" class="gallery-item-delete wod-gal-del" data-gal-action="delete" aria-label="Eliminar ' + esc(label) + '">' + icon('trash-2') + '</button>' +
      '</div>' +
    '</div>';
  }

  function dropzoneMarkup(free) {
    return '<button type="button" class="gallery-item-slot wod-gal-add" data-gal-action="add" aria-label="Subir más archivos (' +
      esc(freeLabel(free).toLowerCase()) + ')">' + icon('plus') +
      '<span>SUBIR MÁS ·</span><span>' + esc(freeLabel(free)) + '</span></button>';
  }

  function render(grid, feed, opts) {
    if (!grid) return;
    opts = opts || {};
    var list = Array.isArray(feed) ? feed : [];
    var c = counts(list, opts.max, opts.maxVideos);
    var now = opts.now || new Date();
    grid.setAttribute('role', 'list');
    ensureCaptionStyles();
    grid.innerHTML = list.map(function (item, i) { return cellMarkup(item, i, list.length, now); }).join('') +
      (c.free > 0 ? dropzoneMarkup(c.free) : '');

    var quota = document.getElementById('wod-gallery-quota');
    if (quota) quota.textContent = quotaLabel(list, opts.max, opts.maxVideos);
    var count = document.getElementById('wod-gallery-count');
    if (count) count.textContent = '— ' + list.length;

    // Videos sin duración guardada: se completa con la metadata del archivo.
    Array.prototype.forEach.call(grid.querySelectorAll('.wod-gal-cell.is-video video'), function (v) {
      var tag = v.parentNode.querySelector('[data-gal-duration]');
      if (!tag || /·/.test(tag.textContent)) return;
      v.addEventListener('loadedmetadata', function () {
        var d = formatDuration(v.duration);
        if (d) tag.textContent = 'VIDEO · ' + d;
      }, { once: true });
    });
    if (typeof window !== 'undefined' && window.WoIcons) window.WoIcons.hydrate(grid);
  }

  /* ------------------------------------------------------------ acciones --- */
  function bind(grid, api) {
    if (!grid || grid.getAttribute('data-wod-gal-bound') === '1') return;
    grid.setAttribute('data-wod-gal-bound', '1');
    api = api || {};
    var dragFrom = -1;

    function indexOf(el) {
      var cell = el && el.closest ? el.closest('.wod-gal-cell') : null;
      return cell ? Number(cell.getAttribute('data-index')) : -1;
    }
    function feed() { return typeof api.getFeed === 'function' ? api.getFeed() || [] : []; }
    function save(next, message) {
      return Promise.resolve(typeof api.persist === 'function' ? api.persist(next) : null)
        .then(function () { if (message && api.notify) api.notify(message, 'success'); })
        .catch(function (e) {
          console.warn('[galería]', e);
          if (api.notify) api.notify('No se pudo guardar el cambio en la galería.', 'error');
          if (typeof api.rerender === 'function') api.rerender();
        });
    }
    function focusCell(i) {
      var btn = grid.querySelector('.wod-gal-cell[data-index="' + i + '"] .wod-gal-open');
      if (btn) btn.focus();
    }
    function move(from, to, keepFocus) {
      var list = feed();
      if (from < 0 || to < 0 || from >= list.length || to >= list.length || from === to) return;
      var p = save(moveItem(list, from, to), (to === 0 || from === 0) ? 'Trabajo destacado actualizado.' : null);
      if (keepFocus) p.then(function () { focusCell(to); });
    }

    function startRename(cell, i) {
      var list = feed();
      if (!list[i] || cell.querySelector('.wod-gal-input')) return;
      var bar = cell.querySelector('.wod-gal-bar');
      var nameBtn = cell.querySelector('.wod-gal-name');
      var input = document.createElement('input');
      input.type = 'text';
      input.className = 'wod-gal-input';
      input.maxLength = TITLE_MAX;
      input.value = itemTitle(list[i]);
      input.placeholder = 'Nombre del trabajo';
      input.setAttribute('aria-label', 'Nombre del trabajo');
      nameBtn.hidden = true;
      bar.insertBefore(input, nameBtn);
      cell.setAttribute('draggable', 'false');
      input.focus();
      input.select();
      var done = false;
      function finish(commit) {
        if (done) return;
        done = true;
        var value = input.value.trim().slice(0, TITLE_MAX);
        var current = feed();
        var before = current[i] ? itemTitle(current[i]) : '';
        if (!commit || !current[i] || value === before) {
          input.remove();
          nameBtn.hidden = false;
          cell.setAttribute('draggable', 'true');
          nameBtn.focus();
          return;
        }
        var next = current.slice();
        var patched = Object.assign({}, next[i]);
        if (value) patched.title = value; else delete patched.title;
        next[i] = patched;
        save(next, 'Nombre guardado.').then(function () {
          var again = grid.querySelector('.wod-gal-cell[data-index="' + i + '"] .wod-gal-name');
          if (again) again.focus();
        });
      }
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); finish(true); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
      });
      input.addEventListener('blur', function () { finish(true); });
      input.addEventListener('click', function (e) { e.stopPropagation(); });
    }

    grid.addEventListener('click', function (e) {
      var actionEl = e.target.closest('[data-gal-action]');
      if (!actionEl || !grid.contains(actionEl)) return;
      var action = actionEl.getAttribute('data-gal-action');
      e.preventDefault();
      e.stopPropagation();
      if (action === 'add') { if (api.pickFiles) api.pickFiles(); return; }
      var i = indexOf(actionEl);
      if (i < 0) return;
      if (action === 'delete') { if (api.deleteAt) api.deleteAt(i); }
      else if (action === 'caption') {
        // Ronda 2 (N3): pie de foto del trabajo (también el de Instagram).
        var current = feed();
        if (!current[i]) return;
        openCaptionDialog(current[i], itemTitle(current[i]) || 'Trabajo ' + (i + 1), function (value) {
          save(setCaption(feed(), i, value), value ? 'Pie de foto guardado.' : 'Pie de foto quitado.').then(function () {
            var again = grid.querySelector('.wod-gal-cell[data-index="' + i + '"] .wod-gal-cap');
            if (again) again.focus();
          });
        });
      }
      else if (action === 'feature') move(i, 0, false);
      else if (action === 'rename') startRename(actionEl.closest('.wod-gal-cell'), i);
    });

    // Teclado: Alt + flechas mueve el trabajo enfocado una posición.
    grid.addEventListener('keydown', function (e) {
      if (!e.altKey || !e.target.classList || !e.target.classList.contains('wod-gal-open')) return;
      var i = indexOf(e.target);
      if (i < 0) return;
      var delta = (e.key === 'ArrowLeft' || e.key === 'ArrowUp') ? -1 : (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1 : 0;
      if (!delta) return;
      e.preventDefault();
      move(i, i + delta, true);
    });

    // Arrastrar para reordenar (HTML5 DnD) y soltar archivos en la grilla.
    function clearDrop() {
      Array.prototype.forEach.call(grid.querySelectorAll('.is-drop-target'), function (el) { el.classList.remove('is-drop-target'); });
    }
    function hasFiles(e) {
      var types = e.dataTransfer && e.dataTransfer.types;
      return !!types && Array.prototype.indexOf.call(types, 'Files') !== -1;
    }
    grid.addEventListener('dragstart', function (e) {
      var cell = e.target.closest && e.target.closest('.wod-gal-cell');
      if (!cell) return;
      dragFrom = Number(cell.getAttribute('data-index'));
      cell.classList.add('is-dragging');
      try {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', 'wod-gal:' + dragFrom);
      } catch (_) { /* algunos navegadores restringen setData */ }
    });
    grid.addEventListener('dragend', function () {
      dragFrom = -1;
      clearDrop();
      Array.prototype.forEach.call(grid.querySelectorAll('.is-dragging'), function (el) { el.classList.remove('is-dragging'); });
    });
    grid.addEventListener('dragover', function (e) {
      var target = e.target.closest && e.target.closest('.wod-gal-cell, .wod-gal-add');
      if (!target) return;
      if (dragFrom >= 0 && target.classList.contains('wod-gal-cell')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      } else if (hasFiles(e) && target.classList.contains('wod-gal-add')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      } else return;
      if (!target.classList.contains('is-drop-target')) { clearDrop(); target.classList.add('is-drop-target'); }
    });
    grid.addEventListener('dragleave', function (e) {
      var target = e.target.closest && e.target.closest('.is-drop-target');
      if (target && !target.contains(e.relatedTarget)) target.classList.remove('is-drop-target');
    });
    grid.addEventListener('drop', function (e) {
      var target = e.target.closest && e.target.closest('.wod-gal-cell, .wod-gal-add');
      clearDrop();
      if (!target) return;
      if (dragFrom >= 0 && target.classList.contains('wod-gal-cell')) {
        e.preventDefault();
        var to = Number(target.getAttribute('data-index'));
        var from = dragFrom;
        dragFrom = -1;
        move(from, to, false);
      } else if (hasFiles(e) && target.classList.contains('wod-gal-add')) {
        e.preventDefault();
        if (api.uploadFiles) api.uploadFiles(e.dataTransfer.files);
      }
    });
  }

  return {
    NEW_IMPORT_WINDOW_MS: NEW_IMPORT_WINDOW_MS,
    TITLE_MAX: TITLE_MAX,
    captionTitle: captionTitle,
    itemTitle: itemTitle,
    formatDuration: formatDuration,
    isFromInstagram: isFromInstagram,
    isVideoUrl: isVideoUrl,
    isPlayable: isPlayable,
    isNewImport: isNewImport,
    isPendingImport: isPendingImport,
    PENDING_HINT: PENDING_HINT,
    counts: counts,
    quotaLabel: quotaLabel,
    freeLabel: freeLabel,
    moveItem: moveItem,
    // ronda 2 · N3
    CAPTION_MAX: CAPTION_MAX,
    cleanCaption: cleanCaption,
    setCaption: setCaption,
    openCaptionDialog: openCaptionDialog,
    pickExtras: pickExtras,
    cellMarkup: cellMarkup,
    render: render,
    bind: bind
  };
}));
