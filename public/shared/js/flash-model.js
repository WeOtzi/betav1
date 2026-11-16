/**
 * WE ÖTZI · Flash Tattoos · modelo puro (sin DOM ni red)
 * ------------------------------------------------------
 * Un flash es un ítem de artists_db.gallery_feed_items con category 'flash'.
 * Sus datos de venta viajan dentro del mismo ítem, en la clave `flash`:
 *
 *   { id: 'fl_k3x9…', url, kind: 'image', category: 'flash', title: 'Golondrina',
 *     created_at, flash: { price: 120, currency: 'USD', size_h_cm: 10, size_w_cm: 8,
 *       size_text: '', zones: ['Antebrazo'], available: true, mode: 'unique' } }
 *
 *   mode 'unique'  se tatúa una sola vez: al aprobarse una cotización el flash
 *                  pasa a "Reservado" (trigger de la migración 20261117130000)
 *   mode 'repeat'  se repite: siempre disponible mientras el artista lo deje así
 *
 * Lo usan el editor de la galería (dashboard y cuenta), el perfil público, la
 * página /flash, el detalle de la cotización y el servidor (lib/flash.js).
 * Navegador: window.WoFlash · Node: require().
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.WoFlash = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var MODES = ['unique', 'repeat'];
    var TITLE_MAX = 60;
    var SIZE_TEXT_MAX = 40;
    var ZONE_MAX = 40;
    var MAX_ZONES = 6;
    var MAX_PRICE = 100000000;
    var MAX_CM = 200;
    var ID_RE = /^[A-Za-z0-9_-]{3,64}$/;
    var CURRENCY_RE = /^[A-Z]{3}$/;
    var CURRENCIES = ['USD', 'ARS', 'MXN', 'CLP', 'COP', 'PEN', 'UYU', 'BRL', 'EUR'];
    var CURRENCY_SYMBOLS = { USD: 'US$', ARS: '$', MXN: 'MX$', CLP: 'CLP$', COP: 'COL$', PEN: 'S/', UYU: '$U', BRL: 'R$', EUR: '€' };

    function text(value, max) {
        var out = String(value == null ? '' : value)
            .replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩﻿]+/g, ' ')
            .replace(/\s+/g, ' ').trim();
        return max ? out.slice(0, max).trim() : out;
    }

    function toNumber(value) {
        if (value == null || value === '') return null;
        if (typeof value === 'number') return Number.isFinite(value) ? value : null;
        // "120.000", "120,50", "US$ 120"
        var raw = String(value).replace(/[^\d.,-]/g, '');
        if (!raw) return null;
        if (raw.indexOf(',') !== -1 && raw.indexOf('.') !== -1) raw = raw.replace(/\./g, '').replace(',', '.');
        else if (/,\d{1,2}$/.test(raw)) raw = raw.replace(',', '.');
        else raw = raw.replace(/[.,](?=\d{3}(\D|$))/g, '');
        var n = Number(raw);
        return Number.isFinite(n) ? n : null;
    }

    function round2(n) { return Math.round(n * 100) / 100; }

    function cm(value) {
        var n = toNumber(value);
        if (n == null || n <= 0 || n > MAX_CM) return null;
        return Math.round(n * 10) / 10;
    }

    function bool(value, fallback) {
        if (value === true || value === 'true' || value === '1' || value === 1 || value === 'si' || value === 'sí') return true;
        if (value === false || value === 'false' || value === '0' || value === 0 || value === 'no') return false;
        return fallback;
    }

    /**
     * Datos de venta saneados de un flash (lo que se guarda en item.flash).
     * Nunca lanza: lo que no es válido se descarta.
     */
    function sanitizeFlash(raw) {
        var src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
        var price = toNumber(src.price);
        var currency = text(src.currency, 3).toUpperCase();
        var zones = [];
        (Array.isArray(src.zones) ? src.zones : String(src.zones || '').split(',')).forEach(function (z) {
            var zone = text(z, ZONE_MAX);
            if (zone && zones.length < MAX_ZONES && !zones.some(function (x) { return x.toLowerCase() === zone.toLowerCase(); })) zones.push(zone);
        });
        var out = {
            price: price != null && price > 0 && price <= MAX_PRICE ? round2(price) : null,
            currency: CURRENCY_RE.test(currency) ? currency : 'USD',
            size_h_cm: cm(src.size_h_cm),
            size_w_cm: cm(src.size_w_cm),
            size_text: text(src.size_text, SIZE_TEXT_MAX),
            zones: zones,
            available: bool(src.available, true),
            mode: MODES.indexOf(src.mode) !== -1 ? src.mode : 'unique'
        };
        if (!out.size_text) delete out.size_text;
        if (out.size_h_cm == null) delete out.size_h_cm;
        if (out.size_w_cm == null) delete out.size_w_cm;
        if (out.price == null) delete out.price;
        return out;
    }

    function newId(rand) {
        var r = typeof rand === 'function' ? rand : Math.random;
        var s = '';
        while (s.length < 10) s += Math.floor(r() * 36).toString(36);
        return 'fl_' + Date.now().toString(36) + s.slice(0, 10);
    }

    function isFlashItem(item) {
        return !!item && typeof item === 'object' && String(item.category || '').toLowerCase() === 'flash';
    }

    function validId(id) { return ID_RE.test(String(id == null ? '' : id)); }

    /** Copia del ítem con un id estable (si no lo tenía). */
    function ensureId(item, rand) {
        if (!item || typeof item !== 'object') return item;
        if (validId(item.id)) return item;
        var next = Object.assign({}, item);
        next.id = newId(rand);
        return next;
    }

    function sizeLabel(flash) {
        var f = flash || {};
        var h = cm(f.size_h_cm);
        var w = cm(f.size_w_cm);
        var fmt = function (n) { return String(n).replace('.', ','); };
        if (h && w) return fmt(h) + ' × ' + fmt(w) + ' cm';
        if (h) return fmt(h) + ' cm de alto';
        if (w) return fmt(w) + ' cm de ancho';
        return text(f.size_text, SIZE_TEXT_MAX);
    }

    function groupThousands(n) {
        var fixed = Math.round(n * 100) / 100;
        var parts = String(fixed).split('.');
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        return parts[1] ? parts[0] + ',' + (parts[1].length === 1 ? parts[1] + '0' : parts[1]) : parts[0];
    }

    function priceLabel(price, currency) {
        var n = toNumber(price);
        if (n == null || n <= 0) return '';
        var code = CURRENCY_RE.test(String(currency || '')) ? String(currency) : 'USD';
        return (CURRENCY_SYMBOLS[code] || code) + ' ' + groupThousands(n) + (CURRENCY_SYMBOLS[code] && code !== 'EUR' ? ' ' + code : '');
    }

    /**
     * Vista de un ítem de galería como flash (o null si no es un flash).
     *   { id, title, image, kind, price, currency, priceLabel, size, zones,
     *     available, mode, unique, hasPrice, status, statusLabel }
     */
    function flashOf(item) {
        if (!isFlashItem(item)) return null;
        var f = sanitizeFlash(item.flash);
        var hasPrice = f.price != null;
        return {
            id: validId(item.id) ? String(item.id) : '',
            title: text(item.title || item.name, TITLE_MAX) || 'Flash',
            image: String(item.url || '').trim(),
            kind: item.kind === 'video' ? 'video' : 'image',
            price: hasPrice ? f.price : null,
            currency: f.currency,
            priceLabel: hasPrice ? priceLabel(f.price, f.currency) : '',
            size: sizeLabel(f),
            sizeHcm: f.size_h_cm || null,
            sizeWcm: f.size_w_cm || null,
            sizeText: f.size_text || '',
            zones: f.zones.slice(),
            available: f.available !== false,
            mode: f.mode,
            unique: f.mode === 'unique',
            hasPrice: hasPrice,
            status: f.available !== false ? 'available' : 'reserved',
            statusLabel: f.available !== false ? 'Disponible' : 'Reservado'
        };
    }

    /**
     * ¿Se muestra "Reservar este flash"? Solo si está disponible, tiene precio,
     * tiene id estable, es una imagen y quien mira no es el dueño del perfil.
     */
    function canBook(view, opts) {
        var o = opts || {};
        if (!view || o.owner) return false;
        return !!(view.id && view.available && view.hasPrice && view.kind === 'image' && view.image);
    }

    function bookingUrl(username, id, base) {
        var prefix = String(base || '').replace(/\/$/, '');
        return prefix + '/flash?artist=' + encodeURIComponent(String(username || '').replace(/^@+/, '')) + '&id=' + encodeURIComponent(String(id || ''));
    }

    /**
     * Aplica los datos del formulario del editor a un ítem de galería.
     * form: { is_flash, title, price, currency, size_h_cm, size_w_cm, size_text,
     *         zones, available, mode }
     * is_flash=false devuelve el ítem como trabajo realizado (sin item.flash).
     */
    function applyForm(item, form, rand) {
        var base = Object.assign({}, item || {});
        var f = form || {};
        if (f.is_flash === false) {
            delete base.flash;
            if (isFlashItem(base)) base.category = 'realizados';
            return base;
        }
        var next = ensureId(base, rand);
        next.category = 'flash';
        var title = text(f.title, TITLE_MAX);
        if (title) next.title = title;
        else if (f.title !== undefined) delete next.title;
        next.flash = sanitizeFlash(f);
        return next;
    }

    /** Errores del editor (solo lo que impide reservar; el resto es opcional). */
    function validateForm(form) {
        var f = form || {};
        var errors = {};
        if (f.is_flash === false) return errors;
        if (!text(f.title, TITLE_MAX)) errors.title = 'Ponle un nombre al flash.';
        var price = toNumber(f.price);
        if (price == null || price <= 0) errors.price = 'Indica el precio del flash.';
        else if (price > MAX_PRICE) errors.price = 'El precio es demasiado alto.';
        if (f.currency && !CURRENCY_RE.test(String(f.currency).toUpperCase())) errors.currency = 'Elige una moneda.';
        ['size_h_cm', 'size_w_cm'].forEach(function (key) {
            if (f[key] != null && f[key] !== '' && cm(f[key]) == null) errors[key] = 'Usa centímetros entre 1 y ' + MAX_CM + '.';
        });
        return errors;
    }

    /** Ítem del feed con ese id (o null). */
    function findItem(items, id) {
        if (!validId(id)) return null;
        var list = Array.isArray(items) ? items : [];
        for (var i = 0; i < list.length; i++) {
            if (list[i] && typeof list[i] === 'object' && String(list[i].id) === String(id)) return list[i];
        }
        return null;
    }

    /**
     * Instantánea que se guarda en quotations_db.flash_snapshot (la arma el
     * servidor con los datos de la galería, nunca con los del navegador).
     */
    function snapshotOf(item, extra) {
        var view = flashOf(item);
        if (!view) return null;
        var e = extra || {};
        var out = {
            id: view.id,
            title: view.title,
            price: view.price,
            currency: view.currency,
            size: view.size || null,
            size_h_cm: view.sizeHcm,
            size_w_cm: view.sizeWcm,
            zones: view.zones,
            mode: view.mode,
            image: view.image
        };
        if (e.slotMinutes) out.slot_minutes = e.slotMinutes;
        if (e.slotStart) out.slot_start = e.slotStart;
        if (e.referencePath) out.reference_path = e.referencePath;
        return out;
    }

    /** Vista de la instantánea guardada en la cotización (o null). */
    function snapshotView(quote) {
        var q = quote || {};
        var s = q.flash_snapshot;
        if (typeof s === 'string') { try { s = JSON.parse(s); } catch (_) { s = null; } }
        if (!s || typeof s !== 'object' || q.source && q.source !== 'flash') return null;
        var price = toNumber(s.price);
        return {
            id: String(s.id || ''),
            title: text(s.title, TITLE_MAX) || 'Flash',
            // URL absoluta (Storage) o ruta del mismo sitio; nunca javascript: ni //host.
            image: typeof s.image === 'string' && /^(https?:\/\/|\/(?!\/))/i.test(s.image) ? s.image : '',
            price: price != null && price > 0 ? price : null,
            currency: CURRENCY_RE.test(String(s.currency || '')) ? s.currency : 'USD',
            priceLabel: priceLabel(price, s.currency),
            size: text(s.size, SIZE_TEXT_MAX + 10),
            mode: s.mode === 'repeat' ? 'repeat' : 'unique',
            modeLabel: s.mode === 'repeat' ? 'Se repite' : 'Se tatúa una sola vez',
            slotMinutes: Number.isInteger(Number(s.slot_minutes)) && Number(s.slot_minutes) > 0 ? Number(s.slot_minutes) : null
        };
    }

    function isFlashQuote(quote) {
        return !!quote && (quote.source === 'flash' || !!snapshotView(quote));
    }

    /**
     * Precargado del diálogo "Aceptar y enviar presupuesto" para una cotización
     * de flash: el precio del flash y, si el cliente eligió turno, su duración.
     * No pisa lo que el artista ya cargó (artist_budget_amount, sesiones
     * estimadas, duración) ni un prefill.
     */
    function respondPrefill(quote) {
        var view = snapshotView(quote);
        if (!view) return null;
        var out = {};
        var savedSessions = quote && quote.tattoo_estimated_sessions;
        if (savedSessions == null || String(savedSessions).trim() === '') out.sessions = 1;
        var already = toNumber(quote && quote.artist_budget_amount);
        if (view.price != null && !(already != null && already > 0)) {
            out.amount = groupThousands(view.price);
            out.currency = view.currency;
        }
        if (view.slotMinutes && !(Number(quote && quote.artist_session_minutes) > 0)) out.minutes = view.slotMinutes;
        return out;
    }

    return {
        MODES: MODES, TITLE_MAX: TITLE_MAX, MAX_ZONES: MAX_ZONES, MAX_PRICE: MAX_PRICE, MAX_CM: MAX_CM,
        CURRENCIES: CURRENCIES, ID_RE: ID_RE,
        toNumber: toNumber, sanitizeFlash: sanitizeFlash, newId: newId, validId: validId, ensureId: ensureId,
        isFlashItem: isFlashItem, sizeLabel: sizeLabel, priceLabel: priceLabel, groupThousands: groupThousands,
        flashOf: flashOf, canBook: canBook, bookingUrl: bookingUrl, applyForm: applyForm, validateForm: validateForm,
        findItem: findItem, snapshotOf: snapshotOf, snapshotView: snapshotView, isFlashQuote: isFlashQuote,
        respondPrefill: respondPrefill
    };
}));
