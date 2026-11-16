/**
 * WE ÖTZI — Hoja de cotización compartible (lógica pura, sin DOM)
 * ----------------------------------------------------------------
 * Ronda 2 · frente cot-detalle · [P30]. Convierte la "hoja" que arma el
 * servidor (lib/cot-detalle.js → buildSheet: propuesta, desglose, términos y
 * artista; nunca salud ni contacto) en textos listos para pintar. La usan:
 *   · la página pública /cotizacion/<token>      (quote-share-page.js)
 *   · el PDF (vista imprimible) y la imagen PNG   (quote-share-sheet.js)
 *   · el panel "Compartir y exportar" del detalle (quote-share-actions.js)
 *
 * UMD: `window.WoQuoteShareModel` en el navegador y `require` en Node
 * (tests/r2-cot-detalle-front.test.js).
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.WoQuoteShareModel = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    var TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
    var SHARE_PATH = '/cotizacion';

    // Políticas de la cotización manual (artist_manual_quotes.cancellation_policy).
    var POLICY_TEXT = {
        'no-reembolsable-48': 'El anticipo no es reembolsable. Reprogramaciones con 48 h de aviso.',
        'no-reembolsable-24': 'El anticipo no es reembolsable. Reprogramaciones con 24 h de aviso.',
        'reembolsable-72': 'El anticipo se devuelve si cancelas con 72 h de aviso.',
        'sin-sena': 'No se pide anticipo. Puedes cancelar sin costo.'
    };
    // Estado → tono visual de la etiqueta.
    var STATUS_TONE = {
        pending: 'open', responded: 'open', client_approved: 'ok', in_progress: 'ok', en_progreso: 'ok',
        artist_completed: 'ok', completed: 'ok', client_rejected: 'closed', cancelled: 'closed', expired: 'closed'
    };

    function clean(value) {
        return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    }
    function multiline(value) {
        return String(value == null ? '' : value).replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    }
    function toDate(value) {
        if (!value) return null;
        var d = value instanceof Date ? value : new Date(value);
        return Number.isNaN(d.getTime()) ? null : d;
    }
    // "15 de noviembre de 2026"
    function dateLong(value) {
        var d = toDate(value);
        return d ? d.getDate() + ' de ' + MONTHS[d.getMonth()] + ' de ' + d.getFullYear() : '';
    }
    // "15 de noviembre de 2026, 14:30 h"
    function dateTimeLong(value) {
        var d = toDate(value);
        if (!d) return '';
        var pad = function (n) { return String(n).padStart(2, '0'); };
        return dateLong(d) + ', ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ' h';
    }
    function groupThousands(amount) {
        var negative = amount < 0;
        var fixed = Math.abs(amount).toFixed(2);
        var parts = fixed.split('.');
        var whole = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        return (negative ? '-' : '') + whole + (parts[1] === '00' ? '' : ',' + parts[1]);
    }
    // "410.000 ARS" · "1.240,50 EUR" · "A definir"
    function money(amount, currency) {
        var n = typeof amount === 'number' ? amount : Number(amount);
        if (amount == null || amount === '' || !Number.isFinite(n)) return 'A definir';
        var code = clean(currency).toUpperCase();
        return groupThousands(n) + (code ? ' ' + code : '');
    }
    function percent(value) {
        var n = Number(value);
        if (!Number.isFinite(n)) return '';
        return String(Math.round(n * 100) / 100).replace('.', ',') + ' %';
    }
    // "2 h 30 min" · "45 min"
    function durationText(minutes) {
        var total = Math.round(Number(minutes) || 0);
        if (total <= 0) return '';
        var h = Math.floor(total / 60), m = total % 60;
        if (!h) return m + ' min';
        return h + ' h' + (m ? ' ' + m + ' min' : '');
    }
    function sessionsText(count) {
        var n = Math.round(Number(count) || 0);
        if (n <= 0) return '';
        return n + (n === 1 ? ' sesión' : ' sesiones');
    }
    function qtyText(qty) {
        var n = Number(qty);
        if (!Number.isFinite(n)) return '1';
        return String(Math.round(n * 100) / 100).replace('.', ',');
    }
    function policyText(policy) {
        return POLICY_TEXT[policy] || '';
    }

    function isValidToken(value) {
        return typeof value === 'string' && TOKEN_RE.test(value);
    }
    // Token de /cotizacion/<token> (con o sin base path /beta). '' si no hay.
    function tokenFromPath(pathname) {
        var parts = String(pathname == null ? '' : pathname).split('/').filter(Boolean);
        var at = parts.indexOf(SHARE_PATH.slice(1));
        var token = at === -1 ? '' : (parts[at + 1] || '');
        return isValidToken(token) ? token : '';
    }
    function sharePath(token) {
        return SHARE_PATH + '/' + token;
    }
    // "beta.weotzi.com/cotizacion/AbC…" → texto corto para la hoja impresa.
    function displayUrl(url) {
        return String(url == null ? '' : url).replace(/^https?:\/\//i, '');
    }
    function fileName(sheet, ext) {
        var ref = clean(sheet && sheet.quote_id).replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'weotzi';
        return 'cotizacion-' + ref + '.' + String(ext || 'png').replace(/[^a-z0-9]/gi, '');
    }

    /**
     * Vista de la hoja: todo en texto plano (quien la pinta escapa).
     * `opts.url` = enlace público a incluir (o '' si no hay).
     */
    function view(sheet, opts) {
        var s = sheet || {};
        var o = opts || {};
        var p = s.proposal || {};
        var f = s.facts || {};
        var a = s.artist || {};
        var b = s.breakdown || null;
        var t = s.terms || null;
        var currency = p.currency || (b && b.currency) || '';

        var chips = [f.style, f.body_part, f.size, f.color].map(clean).filter(Boolean);
        if (f.cover_up === true) chips.push('Cover up');

        var proposalRows = [];
        if (p.sessions) proposalRows.push(['Sesiones', sessionsText(p.sessions)]);
        if (p.session_minutes) proposalRows.push(['Duración por sesión', durationText(p.session_minutes)]);
        if (p.deposit_amount != null || p.deposit_pct != null) {
            var depositParts = [];
            if (p.deposit_amount != null) depositParts.push(money(p.deposit_amount, currency));
            if (p.deposit_pct != null) depositParts.push(percent(p.deposit_pct));
            proposalRows.push(['Anticipo para reservar', depositParts.join(' · ')]);
            if (p.balance != null) proposalRows.push(['Saldo', money(p.balance, currency)]);
        } else if (p.has_proposal) {
            proposalRows.push(['Anticipo para reservar', 'Sin anticipo']);
        }
        if (clean(p.availability)) proposalRows.push(['Disponibilidad', clean(p.availability)]);
        if (clean(p.location)) proposalRows.push(['Lugar', clean(p.location)]);

        var items = (b && Array.isArray(b.items) ? b.items : []).map(function (it) {
            return {
                name: clean(it.name) || 'Concepto',
                description: clean(it.description),
                qtyLine: qtyText(it.qty) + ' × ' + money(it.price, b.currency || currency),
                total: money(it.total, b.currency || currency)
            };
        });
        var totals = [];
        if (b) {
            totals.push(['Subtotal', money(b.subtotal, b.currency || currency)]);
            if (b.discount_pct > 0) totals.push(['Descuento ' + percent(b.discount_pct), '- ' + money(b.discount_amount, b.currency || currency)]);
            if (b.tax_pct > 0) totals.push(['Impuestos ' + percent(b.tax_pct), money(b.tax_amount, b.currency || currency)]);
            totals.push(['Total', money(b.total, b.currency || currency)]);
        }

        var terms = [];
        var validUntil = dateLong(s.valid_until);
        if (validUntil) terms.push('Propuesta válida hasta el ' + validUntil + '.');
        if (t && policyText(t.policy)) terms.push(policyText(t.policy));
        var extraTerms = t ? multiline(t.extra_terms) : '';
        var clientNotes = t ? multiline(t.client_notes) : '';

        var sessions = (Array.isArray(s.sessions) ? s.sessions : []).map(function (row) {
            return { label: 'Sesión ' + row.number, value: dateTimeLong(row.date) + (row.done ? ' · realizada' : '') };
        }).filter(function (row) { return row.value; });

        var artistLine = [clean(a.studio), clean(a.city)].filter(Boolean).join(' · ');
        var url = clean(o.url);
        return {
            // Código corto visible (el mismo de la pantalla de éxito y del panel); sin él, el quote_id.
            ref: clean(s.short_code) || clean(s.quote_id),
            statusLabel: clean(s.status_label) || 'Cotización',
            statusTone: STATUS_TONE[s.status] || 'open',
            byline: 'Cotización de ' + (clean(a.name) || 'tu artista') + ' · We Ötzi',
            title: clean(s.title) || 'Cotización de tatuaje',
            clientLine: clean(s.client_name) ? 'Para ' + clean(s.client_name) : '',
            dateLine: dateLong(s.responded_at || s.created_at) ? 'Emitida el ' + dateLong(s.responded_at || s.created_at) : '',
            idea: multiline(s.idea),
            chips: chips,
            hasProposal: !!p.has_proposal,
            totalLabel: p.agreed ? 'Total acordado' : 'Presupuesto',
            total: p.has_proposal ? money(p.amount, currency) : 'A definir',
            pendingCopy: p.has_proposal ? '' : 'El artista todavía no envió su propuesta.',
            proposalRows: proposalRows,
            items: items,
            totals: totals,
            terms: terms,
            extraTerms: extraTerms,
            clientNotes: clientNotes,
            sessions: sessions,
            artist: {
                name: clean(a.name) || 'Tu artista',
                line: artistLine,
                verified: !!a.verified,
                profileUrl: clean(a.profile_url),
                photoUrl: clean(a.photo_url),
                handle: clean(a.username) ? '@' + clean(a.username).replace(/^@+/, '') : ''
            },
            url: url,
            urlText: displayUrl(url),
            linkExpiry: s.link && dateLong(s.link.expires_at) ? 'Enlace disponible hasta el ' + dateLong(s.link.expires_at) + '.' : '',
            footer: 'Generada en We Ötzi · beta.weotzi.com'
        };
    }

    /**
     * Parte un texto en líneas que entren en `maxWidth` según `measure(text)`
     * (canvas). Respeta saltos de línea, corta palabras larguísimas y limita a
     * `maxLines` agregando "…" si sobra.
     */
    function wrapText(measure, text, maxWidth, maxLines) {
        var out = [];
        var limit = maxLines > 0 ? maxLines : Infinity;
        var truncated = false;
        String(text == null ? '' : text).split('\n').forEach(function (paragraph) {
            var words = paragraph.split(/\s+/).filter(Boolean);
            if (!words.length) { if (out.length && out.length < limit) out.push(''); return; }
            var line = '';
            words.forEach(function (word) {
                var piece = word;
                // Palabra más ancha que la línea: se corta por caracteres.
                while (measure(piece) > maxWidth && piece.length > 1) {
                    var cut = piece.length - 1;
                    while (cut > 1 && measure(piece.slice(0, cut)) > maxWidth) cut -= 1;
                    if (line) { out.push(line); line = ''; }
                    out.push(piece.slice(0, cut));
                    piece = piece.slice(cut);
                }
                var candidate = line ? line + ' ' + piece : piece;
                if (measure(candidate) <= maxWidth) line = candidate;
                else { if (line) out.push(line); line = piece; }
            });
            if (line) out.push(line);
        });
        while (out.length && out[out.length - 1] === '') out.pop();
        if (out.length > limit) { out = out.slice(0, limit); truncated = true; }
        if (truncated && out.length) {
            var last = out[out.length - 1];
            while (last.length > 1 && measure(last + '…') > maxWidth) last = last.slice(0, -1);
            out[out.length - 1] = last.replace(/[\s.,;:]+$/, '') + '…';
        }
        return out;
    }

    return {
        SHARE_PATH: SHARE_PATH, POLICY_TEXT: POLICY_TEXT,
        dateLong: dateLong, dateTimeLong: dateTimeLong, money: money, percent: percent,
        durationText: durationText, sessionsText: sessionsText, policyText: policyText,
        isValidToken: isValidToken, tokenFromPath: tokenFromPath, sharePath: sharePath,
        displayUrl: displayUrl, fileName: fileName, view: view, wrapText: wrapText
    };
}));
