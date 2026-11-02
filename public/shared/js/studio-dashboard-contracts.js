// ============================================
// We Ötzi — Contratos del estudio (pestaña "contratos", W-TEAM)
//
// window.WeOtziStudioContracts = {
//   openFromApplication(app, spot) → Promise<{contractId, issued}>
//   openForMembership(membership)  → Promise<{contractId, issued}>
//   openEditor(contractId)          → Promise<{contractId, issued}>
// }
// Las tres promesas se resuelven cuando el estudio cierra el editor (o el
// documento) y se rechazan con el error del repo, con su `.code` intacto, para
// que quien llama pueda caer al flujo anterior si falta la migración
// (studio-dashboard.js → onAppDecision).
//
// Contrato: docs/plans/2026-10-30-estudios-plataforma.md → "Contratos".
//   - Listado con filtros por estado; vence los atrasados al cargar.
//   - Editor (drawer) de borradores: partes, rol y sede, modalidad
//     (porcentaje / fijo / mixto), vigencia, listas, normas y cláusulas,
//     vista previa, "Guardar borrador" y "Emitir y firmar".
//   - Documento imprimible de lo emitido o firmado (snapshot congelado + hash)
//     con cancelar, rescindir y nueva versión.
//   - Roster: botón "Contrato" por fila vía WeOtziStudioAdmin.onRosterRender.
// Toda la data pasa por WeotziData.StudioContracts (RPCs; la tabla no admite
// escritura directa). Todo lo que se interpola en HTML pasa por el kit.
// ============================================

(function () {
    'use strict';

    const TAB = 'contratos';
    const CONTRACT_ROLES = ['resident', 'guest', 'itinerant'];
    const MODELS = ['percentage', 'fixed', 'mixed'];
    const FIXED_PERIODS = ['per_session', 'daily', 'weekly', 'monthly', 'one_time'];
    const FIXED_PAYERS = ['artist_to_studio', 'studio_to_artist'];
    const CLOSED_STATUSES = ['declined', 'cancelled', 'terminated', 'expired'];
    // Desde qué estados se ofrece "Nueva versión". Con un 'sent' abierto la
    // emisión fallaría (un contrato enviado por par); un 'terminated' suele
    // dejar el vínculo cerrado.
    const NEW_VERSION_FROM = ['signed', 'declined', 'cancelled', 'expired'];
    // Filas del roster que llevan botón "Contrato" (abiertas, sin managers).
    const ROSTER_STATUSES = ['active', 'paused', 'pending_acceptance', 'pending_invite', 'requested'];
    const LIST_MAX = 20;
    const ITEM_MAX = 200;
    const HOUSE_RULES_MAX = 5000;
    const TERMS_MAX = 20000;
    const REASON_MAX = 1000;
    const SIGNER_MAX = 160;
    const DEFAULT_EXPIRY_DAYS = 14;
    const EXPIRING_SOON_DAYS = 3;
    const MISSING_MESSAGE = 'Esta función todavía no está disponible (falta aplicar una migración).';

    const FILTERS = [
        { id: 'all', label: 'Todos', statuses: null },
        { id: 'draft', label: 'Borradores', statuses: ['draft'] },
        { id: 'sent', label: 'Pendientes de firma', statuses: ['sent'] },
        { id: 'signed', label: 'Firmados', statuses: ['signed'] },
        { id: 'closed', label: 'Cerrados', statuses: CLOSED_STATUSES }
    ];
    const MODEL_HINTS = {
        percentage: 'El artista se queda un % de cada tatuaje.',
        fixed: 'Alquiler de puesto o pago al artista.',
        mixed: 'Porcentaje más un monto fijo.'
    };
    const PERIOD_PHRASE = {
        per_session: 'por sesión', daily: 'por día', weekly: 'por semana', monthly: 'por mes', one_time: 'en un único pago'
    };
    const PERIOD_SHORT = { per_session: '/sesión', daily: '/día', weekly: '/semana', monthly: '/mes', one_time: ' (único)' };
    const LISTS = [
        { key: 'includes', label: 'Qué incluye el spot', placeholder: 'Ej.: camilla, luz y esterilización' },
        { key: 'perks', label: 'Beneficios', placeholder: 'Ej.: difusión en redes del estudio' },
        { key: 'artist_obligations', label: 'Obligaciones del artista', placeholder: 'Ej.: cumplir los protocolos de higiene' }
    ];

    const state = {
        ctx: null,
        root: null,
        contracts: [],
        filter: 'all',
        query: '',
        unavailable: false,
        error: null,
        loaded: false,
        loadSeq: 0
    };
    let seq = 0;

    // -------------------------------------------------------------
    // Entorno
    // -------------------------------------------------------------
    const kit = () => window.WeOtziStudioKit;
    const data = () => window.WeotziData || {};
    const repo = () => data().StudioContracts || null;
    const esc = v => kit().escapeHtml(v);
    const escAttr = v => kit().escapeAttr(v);
    const label = (dict, value) => kit().label(dict, value);

    async function getCtx() {
        if (state.ctx) return state.ctx;
        const admin = window.WeOtziStudioAdmin;
        if (!admin || typeof admin.getContext !== 'function') throw new Error('El panel del estudio todavía no está listo. Recargá la página.');
        state.ctx = await admin.getContext();
        return state.ctx;
    }

    // -------------------------------------------------------------
    // Errores y resultados {data, error}
    // -------------------------------------------------------------
    function looksLikeError(e) {
        return !!e && typeof e === 'object' && typeof e.message === 'string' && typeof e.stack === 'string';
    }
    // Error real con el .code de PostgREST/Postgres (el shell decide el fallback por código).
    function toError(err) {
        if (looksLikeError(err)) return err;
        const src = err && typeof err === 'object' ? err : { message: String(err || '') };
        const error = new Error(src.message || 'No pudimos completar la acción. Intentá de nuevo.');
        ['code', 'details', 'hint', 'status'].forEach(k => { if (src[k] != null) error[k] = src[k]; });
        return error;
    }
    function missingBackendError() {
        const error = new Error(MISSING_MESSAGE);
        error.code = '42883';
        return error;
    }
    function must(res) {
        if (!res) return null;
        if (res.error) throw toError(res.error);
        return res.data === undefined ? null : res.data;
    }
    // Las RPC prepare_* / save_* devuelven un uuid.
    function idFrom(value) {
        if (typeof value === 'string') return value.trim() || null;
        if (Array.isArray(value)) return idFrom(value[0]);
        if (value && typeof value === 'object') return value.id || value.contract_id || null;
        return null;
    }
    async function notifySafe(ctx, payload) {
        try {
            const res = ctx && typeof ctx.notify === 'function' ? await ctx.notify(payload) : null;
            return res && typeof res === 'object' ? res : { ok: false };
        } catch (error) {
            return { ok: false, error };
        }
    }

    // -------------------------------------------------------------
    // Valores
    // -------------------------------------------------------------
    function hasValue(v) { return v != null && String(v).trim() !== ''; }
    function num(v) {
        if (!hasValue(v) || typeof v === 'boolean') return null;
        const n = Number(String(v).trim().replace(',', '.'));
        return Number.isFinite(n) ? n : null;
    }
    function int(v) {
        const n = num(v);
        return n == null ? null : Math.trunc(n);
    }
    function text(v) {
        const s = String(v == null ? '' : v).trim();
        return s || null;
    }
    function currencyCode(v) {
        return String(v == null ? '' : v).trim().toUpperCase();
    }
    function round2(n) { return Math.round(n * 100) / 100; }
    // Mismas reglas que la RPC: hasta 20 ítems de hasta 200 caracteres, sin vacíos.
    function cleanList(list) {
        const out = [];
        const seen = new Set();
        (Array.isArray(list) ? list : []).forEach(item => {
            if (out.length >= LIST_MAX) return;
            const value = String(item == null ? '' : item).replace(/\s+/g, ' ').trim().slice(0, ITEM_MAX).trim();
            const key = value.toLowerCase();
            if (!value || seen.has(key)) return;
            seen.add(key);
            out.push(value);
        });
        return out;
    }
    function asArray(v) { return Array.isArray(v) ? v.filter(x => hasValue(x)).map(String) : []; }
    function one(v) { return Array.isArray(v) ? (v[0] || null) : (v || null); }

    const pad2 = n => String(n).padStart(2, '0');
    function ymd(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
    function todayYmd(now) { return ymd(now ? new Date(now) : new Date()); }
    function addDaysYmd(days, now) {
        const base = now ? new Date(now) : new Date();
        return ymd(new Date(base.getFullYear(), base.getMonth(), base.getDate() + days));
    }
    // 'YYYY-MM-DD' → fin de ese día (hora local) en ISO; null si no es una fecha.
    function endOfDayIso(day) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || '').trim());
        if (!m) return null;
        return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59).toISOString();
    }

    function artistDisplay(artist) {
        const a = artist || {};
        return a.name || (a.username ? '@' + a.username : 'el artista');
    }

    // -------------------------------------------------------------
    // Términos: snapshot congelado (emitido/firmado) o columnas (borrador)
    // -------------------------------------------------------------
    function termsOf(contract, studio) {
        const c = contract || {};
        const snap = c.status && c.status !== 'draft' && c.terms_snapshot && typeof c.terms_snapshot === 'object' ? c.terms_snapshot : null;
        const has = (obj, key) => !!obj && Object.prototype.hasOwnProperty.call(obj, key);
        const val = key => (has(snap, key) ? snap[key] : c[key]);
        const comp = snap && snap.compensation && typeof snap.compensation === 'object' ? snap.compensation : null;
        const compVal = (key, column) => (has(comp, key) ? comp[key] : c[column]);
        const artistRow = one(c.artists_db) || {};
        const artistSnap = (snap && snap.artist) || {};
        const studioRow = one(c.studios) || studio || {};
        const studioSnap = (snap && snap.studio) || {};
        return {
            frozen: !!snap,
            contractNumber: val('contract_number'),
            version: val('version'),
            origin: val('origin'),
            role: val('role'),
            studio: { name: studioSnap.name || studioRow.name || '', slug: studioSnap.slug || studioRow.slug || '' },
            artist: {
                name: artistSnap.name || artistRow.name || '',
                username: artistSnap.username || artistRow.username || '',
                email: artistSnap.email || ''
            },
            location: has(snap, 'location') ? snap.location : one(c.studio_locations),
            spot: has(snap, 'spot') ? snap.spot : one(c.studio_spots),
            model: compVal('model', 'compensation_model'),
            artistPercentage: compVal('artist_percentage', 'artist_percentage'),
            fixedAmount: compVal('fixed_amount', 'fixed_amount'),
            fixedCurrency: compVal('fixed_currency', 'fixed_currency'),
            fixedPeriod: compVal('fixed_period', 'fixed_period'),
            fixedPayer: compVal('fixed_payer', 'fixed_payer'),
            startDate: val('start_date'),
            endDate: val('end_date'),
            noticeDays: val('cancellation_notice_days'),
            includes: asArray(val('includes')),
            perks: asArray(val('perks')),
            obligations: asArray(val('artist_obligations')),
            houseRules: val('house_rules'),
            terms: val('terms')
        };
    }

    function fixedMoney(t) {
        const k = kit();
        return t.fixedCurrency ? k.fmtMoney(t.fixedAmount, t.fixedCurrency) : k.fmtNumber(t.fixedAmount);
    }

    // Texto plano (quien lo inserta en HTML lo escapa).
    function compensationSummary(t) {
        const k = kit();
        const parts = [];
        const usesPct = t.model === 'percentage' || t.model === 'mixed';
        const usesFixed = t.model === 'fixed' || t.model === 'mixed';
        const pct = num(t.artistPercentage);
        if (usesPct && pct != null) {
            parts.push('El artista se queda con el ' + k.fmtPercent(pct) + ' de cada tatuaje y el estudio con el ' + k.fmtPercent(round2(100 - pct)) + '.');
        }
        if (usesFixed && num(t.fixedAmount) != null) {
            const period = PERIOD_PHRASE[t.fixedPeriod] ? ' ' + PERIOD_PHRASE[t.fixedPeriod] : '';
            if (t.fixedPayer === 'artist_to_studio') parts.push('Alquiler de puesto: el artista paga al estudio ' + fixedMoney(t) + period + '.');
            else if (t.fixedPayer === 'studio_to_artist') parts.push('Pago al artista: el estudio le paga ' + fixedMoney(t) + period + '.');
            else parts.push('Monto fijo de ' + fixedMoney(t) + period + '.');
        }
        if (parts.length) return parts.join(' ');
        return t.model ? label('compensationModel', t.model) + ': faltan datos.' : 'Modalidad de pago sin definir.';
    }

    // Versión corta para la tabla.
    function compensationShort(t) {
        const k = kit();
        const parts = [];
        const pct = num(t.artistPercentage);
        if ((t.model === 'percentage' || t.model === 'mixed') && pct != null) parts.push(k.fmtPercent(pct) + ' artista');
        if ((t.model === 'fixed' || t.model === 'mixed') && num(t.fixedAmount) != null) {
            const who = (k.LABELS.fixedPayerShort && k.LABELS.fixedPayerShort[t.fixedPayer]) || 'Fijo';
            parts.push(who + ' ' + fixedMoney(t) + (PERIOD_SHORT[t.fixedPeriod] || ''));
        }
        if (parts.length) return parts.join(' + ');
        return t.model ? label('compensationModel', t.model) : '—';
    }

    function validityText(t) {
        const k = kit();
        if (t.startDate && t.endDate) return 'Del ' + k.fmtDate(t.startDate) + ' al ' + k.fmtDate(t.endDate);
        if (t.startDate) return 'Desde el ' + k.fmtDate(t.startDate) + ', sin fecha de fin';
        if (t.endDate) return 'Hasta el ' + k.fmtDate(t.endDate);
        return 'Sin fechas';
    }

    function validityShort(t) {
        const k = kit();
        if (t.startDate && t.endDate) return k.fmtDate(t.startDate) + ' – ' + k.fmtDate(t.endDate);
        if (t.startDate) return 'Desde ' + k.fmtDate(t.startDate);
        return '—';
    }

    function locationText(loc) {
        if (!loc) return 'Sin sede asignada';
        const place = [loc.city, loc.country].filter(Boolean).join(', ');
        return [loc.label || 'Sede', loc.formatted_address || place].filter(Boolean).join(' · ');
    }

    // -------------------------------------------------------------
    // Documento imprimible
    // -------------------------------------------------------------
    function listSection(title, items, emptyText) {
        return '<h2>' + esc(title) + '</h2>'
            + (items.length
                ? '<ul>' + items.map(item => '<li>' + esc(item) + '</li>').join('') + '</ul>'
                : '<p class="stc-doc__empty">' + esc(emptyText) + '</p>');
    }

    function longText(title, value) {
        if (!hasValue(value)) return '';
        return '<h2>' + esc(title) + '</h2><div class="stc-doc__text">' + esc(String(value).trim()) + '</div>';
    }

    function closureHtml(c) {
        const k = kit();
        const reasonHtml = reason => (hasValue(reason) ? ' Motivo: ' + esc(reason) : '');
        if (c.status === 'declined') return '<p class="stc-doc__closure">El artista lo rechazó el ' + esc(k.fmtDate(c.declined_at)) + '.' + reasonHtml(c.decline_reason) + '</p>';
        if (c.status === 'cancelled') return '<p class="stc-doc__closure">Cancelado el ' + esc(k.fmtDate(c.cancelled_at)) + '.' + reasonHtml(c.cancel_reason) + '</p>';
        if (c.status === 'terminated') return '<p class="stc-doc__closure">Rescindido el ' + esc(k.fmtDate(c.terminated_at)) + '.' + reasonHtml(c.termination_reason) + '</p>';
        if (c.status === 'expired') return '<p class="stc-doc__closure">Venció el ' + esc(k.fmtDate(c.expires_at)) + ' sin la firma del artista.</p>';
        return '';
    }

    function signaturesHtml(c) {
        const k = kit();
        const snap = c.terms_snapshot && typeof c.terms_snapshot === 'object' ? c.terms_snapshot : {};
        const studioSigner = c.studio_signer_name || snap.studio_signer_name || '';
        const studioAt = c.studio_signed_at || snap.issued_at || null;
        const studioBlock = studioSigner
            ? '<strong>' + esc(studioSigner) + '</strong><br>Firmó el ' + esc(k.fmtDateTime(studioAt))
            : '<span class="stc-doc__pending">Pendiente: firma al emitir</span>';
        const artistBlock = c.artist_signer_name
            ? '<strong>' + esc(c.artist_signer_name) + '</strong><br>Firmó el ' + esc(k.fmtDateTime(c.artist_signed_at)) + ' y aceptó los términos'
            : '<span class="stc-doc__pending">' + esc(c.status === 'sent' ? 'Pendiente de firma' : 'Sin firma') + '</span>';
        return '<div class="sk-doc-signatures">'
            + '<div class="sk-doc-signature"><span class="stc-doc__sig-role">Por el estudio</span><br>' + studioBlock + '</div>'
            + '<div class="sk-doc-signature"><span class="stc-doc__sig-role">El artista</span><br>' + artistBlock + '</div>'
            + '</div>';
    }

    function contractDocumentHtml(contract, opts) {
        const o = opts || {};
        const k = kit();
        const c = contract || {};
        const t = termsOf(c, o.studio);
        const number = t.contractNumber || 'Sin número';
        const version = t.version || 1;
        const studioName = t.studio.name || 'El estudio';
        const spot = t.spot;
        const status = o.preview ? 'draft' : c.status;
        const notice = num(t.noticeDays);
        const statusLine = [
            k.statusBadge('contractStatus', status),
            status === 'sent' && c.expires_at ? '<span class="stc-doc__meta-item">Vence el ' + esc(k.fmtDate(c.expires_at)) + '</span>' : '',
            c.sent_at ? '<span class="stc-doc__meta-item">Emitido el ' + esc(k.fmtDate(c.sent_at)) + '</span>' : '',
            t.origin ? '<span class="stc-doc__meta-item">' + esc(label('contractOrigin', t.origin)) + '</span>' : ''
        ].filter(Boolean).join(' ');
        const artistLine = [
            t.artist.name ? '<strong>' + esc(t.artist.name) + '</strong>' : '<strong>Artista</strong>',
            t.artist.username ? '@' + esc(t.artist.username) : '',
            t.artist.email ? esc(t.artist.email) : ''
        ].filter(Boolean).join(' · ');
        const integrity = c.terms_hash
            ? '<p>Huella SHA-256 de los términos congelados al emitir:</p><p><code class="sk-doc-hash">' + esc(c.terms_hash) + '</code></p>'
              + '<p class="stc-doc__fine">Cualquier cambio en estos términos exige una nueva versión del contrato.</p>'
            : '<p class="stc-doc__fine">La huella se genera al emitir el contrato: desde ahí los términos quedan congelados.</p>';
        return '<article class="sk-print-doc stc-doc"' + (c.id ? ' data-contract-id="' + escAttr(c.id) + '"' : '') + '>'
            + (o.preview ? '<p class="stc-doc__watermark">Vista previa del borrador · todavía no tiene validez</p>' : '')
            + '<header class="stc-doc__head">'
            + '<p class="sk-doc-meta">Contrato registrado en We Ötzi · ' + esc(number) + ' · Versión ' + esc(version) + '</p>'
            + '<h1>Contrato de ' + esc(label('membershipRole', t.role).toLowerCase()) + ' · ' + esc(studioName) + '</h1>'
            + '<p class="stc-doc__status">' + statusLine + '</p>'
            + '</header>'
            + '<h2>Partes</h2>'
            + '<dl>'
            + '<dt>Estudio</dt><dd><strong>' + esc(studioName) + '</strong>' + (t.studio.slug ? ' · ' + esc(t.studio.slug) : '') + '</dd>'
            + '<dt>Artista</dt><dd>' + artistLine + '</dd>'
            + '</dl>'
            + '<h2>Puesto</h2>'
            + '<dl>'
            + '<dt>Rol</dt><dd>' + esc(label('membershipRole', t.role)) + '</dd>'
            + '<dt>Sede</dt><dd>' + esc(locationText(t.location)) + '</dd>'
            + (spot ? '<dt>Spot</dt><dd>' + esc(spot.title || 'Spot') + (spot.kind ? ' · ' + esc(label('spotKind', spot.kind)) : '') + '</dd>' : '')
            + '</dl>'
            + '<h2>Modalidad de pago</h2>'
            + '<p>' + esc(compensationSummary(t)) + '</p>'
            + '<h2>Vigencia</h2>'
            + '<dl>'
            + '<dt>Período</dt><dd>' + esc(validityText(t)) + '</dd>'
            + '<dt>Preaviso de baja</dt><dd>' + esc(notice == null ? 'Sin preaviso pactado' : notice + (notice === 1 ? ' día' : ' días')) + '</dd>'
            + '</dl>'
            + listSection('Qué incluye el spot', t.includes, 'Sin ítems.')
            + listSection('Beneficios', t.perks, 'Sin beneficios adicionales.')
            + listSection('Obligaciones del artista', t.obligations, 'Sin obligaciones adicionales.')
            + longText('Normas del estudio', t.houseRules)
            + longText('Cláusulas', t.terms)
            + '<h2>Firmas</h2>'
            + signaturesHtml(c)
            + closureHtml(c)
            + '<h2>Integridad</h2>'
            + integrity
            + '</article>';
    }

    // -------------------------------------------------------------
    // Borrador: lectura del editor, validación y payload
    // -------------------------------------------------------------
    // Devuelve el primer problema en español o null.
    function validateDraft(st, opts) {
        const o = opts || {};
        const s = st || {};
        const model = hasValue(s.compensation_model) ? String(s.compensation_model) : null;
        const usesPct = model === 'percentage' || model === 'mixed';
        const usesFixed = model === 'fixed' || model === 'mixed';
        const pct = num(s.artist_percentage);
        const amount = num(s.fixed_amount);
        const cur = currencyCode(s.fixed_currency);
        const notice = num(s.cancellation_notice_days);
        if ((hasValue(s.role) || o.forIssue) && !CONTRACT_ROLES.includes(s.role)) return 'Elegí un rol válido: residente, guest o itinerante.';
        if (model && !MODELS.includes(model)) return 'Modalidad de pago inválida.';
        if (usesPct && hasValue(s.artist_percentage) && (pct == null || pct < 0 || pct > 100)) return 'El porcentaje del artista va de 0 a 100.';
        if (usesFixed && hasValue(s.fixed_amount) && (amount == null || amount < 0 || amount >= 1e10)) return 'Revisá el monto fijo.';
        if (usesFixed && cur && !/^[A-Z]{3}$/.test(cur)) return 'La moneda tiene que ser un código ISO de 3 letras.';
        if (usesFixed && hasValue(s.fixed_period) && !FIXED_PERIODS.includes(s.fixed_period)) return 'Periodicidad del monto fijo inválida.';
        if (usesFixed && hasValue(s.fixed_payer) && !FIXED_PAYERS.includes(s.fixed_payer)) return 'Indicá quién paga el monto fijo.';
        if (hasValue(s.start_date) && hasValue(s.end_date) && String(s.end_date) < String(s.start_date)) return 'La fecha de fin no puede ser anterior al inicio.';
        if (hasValue(s.cancellation_notice_days) && (notice == null || !Number.isInteger(notice) || notice < 0 || notice > 365)) return 'El preaviso va de 0 a 365 días.';
        if (hasValue(s.house_rules) && String(s.house_rules).trim().length > HOUSE_RULES_MAX) return 'Las normas del estudio admiten hasta 5000 caracteres.';
        if (hasValue(s.terms) && String(s.terms).trim().length > TERMS_MAX) return 'Las cláusulas admiten hasta 20000 caracteres.';
        if (o.forIssue) {
            if (!model) return 'Completá la modalidad de pago.';
            if (usesPct && pct == null) return 'Completá la modalidad de pago: falta el porcentaje para el artista.';
            if (usesFixed && (amount == null || !cur || !hasValue(s.fixed_period) || !hasValue(s.fixed_payer))) {
                return 'Completá la modalidad de pago: monto, moneda, periodicidad y quién paga.';
            }
            if (!hasValue(s.start_date)) return 'Completá la fecha de inicio.';
            if (hasValue(s.expires_on) && String(s.expires_on) < todayYmd(o.now)) return 'El vencimiento tiene que ser una fecha futura.';
        }
        return null;
    }

    // Objeto para save_studio_contract_draft (lista blanca del contrato). Los
    // campos que la modalidad no usa se limpian para no congelar basura.
    function draftPayload(contract, st) {
        const s = st || {};
        const model = MODELS.includes(s.compensation_model) ? s.compensation_model : null;
        const usesPct = model === 'percentage' || model === 'mixed';
        const usesFixed = model === 'fixed' || model === 'mixed';
        const payload = {};
        if (contract && contract.id) payload.id = contract.id;
        if (CONTRACT_ROLES.includes(s.role)) payload.role = s.role;
        Object.assign(payload, {
            location_id: hasValue(s.location_id) ? String(s.location_id) : null,
            compensation_model: model,
            artist_percentage: usesPct ? num(s.artist_percentage) : null,
            fixed_amount: usesFixed ? num(s.fixed_amount) : null,
            fixed_currency: usesFixed ? (currencyCode(s.fixed_currency) || null) : null,
            fixed_period: usesFixed && hasValue(s.fixed_period) ? String(s.fixed_period) : null,
            fixed_payer: usesFixed && hasValue(s.fixed_payer) ? String(s.fixed_payer) : null,
            start_date: hasValue(s.start_date) ? String(s.start_date) : null,
            end_date: hasValue(s.end_date) ? String(s.end_date) : null,
            cancellation_notice_days: int(s.cancellation_notice_days),
            includes: cleanList(s.includes),
            perks: cleanList(s.perks),
            artist_obligations: cleanList(s.artist_obligations),
            house_rules: text(s.house_rules),
            terms: text(s.terms)
        });
        return payload;
    }

    // Nueva versión: mismo número, version+1 (lo resuelve la RPC con
    // supersedes_contract_id). Un firmado se reemplaza como 'manual' sobre la
    // misma membresía (igual que prepare_contract_for_membership); un rechazado,
    // cancelado o vencido conserva su origen y su postulación.
    function newVersionPayload(c) {
        const keepOrigin = c.status !== 'signed';
        return {
            studio_id: c.studio_id,
            artist_user_id: c.artist_user_id,
            supersedes_contract_id: c.id,
            origin: keepOrigin ? (c.origin || 'manual') : 'manual',
            membership_id: c.membership_id || null,
            spot_id: c.spot_id || null,
            application_id: keepOrigin ? (c.application_id || null) : null,
            role: c.role,
            location_id: c.location_id || null,
            compensation_model: c.compensation_model || null,
            artist_percentage: c.artist_percentage == null ? null : c.artist_percentage,
            fixed_amount: c.fixed_amount == null ? null : c.fixed_amount,
            fixed_currency: c.fixed_currency || null,
            fixed_period: c.fixed_period || null,
            fixed_payer: c.fixed_payer || null,
            start_date: c.start_date || null,
            end_date: c.end_date || null,
            cancellation_notice_days: c.cancellation_notice_days == null ? null : c.cancellation_notice_days,
            includes: cleanList(c.includes),
            perks: cleanList(c.perks),
            artist_obligations: cleanList(c.artist_obligations),
            house_rules: c.house_rules || null,
            terms: c.terms || null
        };
    }

    // Acciones del documento según el estado.
    function documentActionsFor(contract) {
        const status = contract && contract.status;
        const out = ['print'];
        if (status === 'sent') out.push('cancel');
        if (status === 'signed') out.push('terminate');
        if (NEW_VERSION_FROM.includes(status)) out.push('new_version');
        return out;
    }

    // -------------------------------------------------------------
    // Ciclo de vida
    // -------------------------------------------------------------
    async function issueContract(ctx, contract, st, opts) {
        const k = kit();
        const o = opts || {};
        const t = termsOf(contract, ctx && ctx.studio);
        const expiresOn = st && hasValue(st.expires_on) ? String(st.expires_on) : addDaysYmd(DEFAULT_EXPIRY_DAYS, o.now);
        const who = artistDisplay(t.artist);
        const studioName = (ctx && ctx.studio && ctx.studio.name) || t.studio.name || 'tu estudio';
        const signer = await k.promptDialog({
            title: 'Emitir y firmar',
            body: 'Firmás como dueño de ' + studioName + '. Le enviamos el contrato a ' + who + ', que tiene hasta el '
                + k.fmtDate(expiresOn) + ' para firmarlo. Desde ahí, cualquier cambio necesita una nueva versión.',
            label: 'Tu nombre completo',
            placeholder: 'Nombre y apellido',
            required: true,
            minLength: 3,
            maxLength: SIGNER_MAX,
            autocomplete: 'name',
            confirmLabel: 'Emitir y firmar'
        });
        if (signer == null) return null;
        const issued = must(await repo().issue(contract.id, signer, endOfDayIso(expiresOn))) || { id: contract.id, status: 'sent' };
        const notice = await notifySafe(ctx, { kind: 'contract_issued', contract_id: contract.id });
        k.toast(notice.ok
            ? 'Contrato emitido. Le avisamos a ' + who + ' para que lo firme.'
            : 'Contrato emitido. No pudimos enviarle el email: avisale que lo tiene para firmar en su panel.',
        notice.ok ? 'success' : 'warning');
        return issued;
    }

    function terminateDialog(contract) {
        const k = kit();
        const id = 'stc-term-' + (++seq);
        const who = artistDisplay(termsOf(contract).artist);
        const body = '<div class="sk-field"><label for="' + id + '-reason">Motivo de la rescisión</label>'
            + '<textarea id="' + id + '-reason" class="studio-textarea" rows="4" maxlength="' + REASON_MAX + '" required aria-required="true"></textarea></div>'
            + '<label class="sk-field sk-field--inline stc-check"><input type="checkbox" id="' + id + '-end" checked>'
            + '<span>Finalizar también el vínculo de ' + esc(who) + ' con el estudio</span></label>'
            + '<p class="studio-help">Le avisamos al artista. El contrato queda registrado como rescindido.</p>';
        const modal = k.openModal({
            title: 'Rescindir contrato',
            size: 'md',
            body,
            actions: [
                { label: 'Volver', variant: 'ghost', value: null },
                {
                    label: 'Rescindir',
                    variant: 'danger',
                    onClick(m) {
                        const field = m.body && m.body.querySelector('#' + id + '-reason');
                        const reason = text(field && field.value);
                        if (!reason) {
                            m.setError('Contanos el motivo de la rescisión.');
                            if (field) field.setAttribute('aria-invalid', 'true');
                            return false;
                        }
                        const end = m.body.querySelector('#' + id + '-end');
                        return { reason: reason.slice(0, REASON_MAX), endMembership: !end || !!end.checked };
                    }
                }
            ]
        });
        return modal.closed.then(v => (v && v.reason ? v : null));
    }

    async function terminateContract(ctx, contract) {
        const choice = await terminateDialog(contract);
        if (!choice) return null;
        must(await repo().terminate(contract.id, choice.reason, choice.endMembership));
        const notice = await notifySafe(ctx, { kind: 'contract_terminated', contract_id: contract.id });
        kit().toast(notice.ok
            ? 'Contrato rescindido. Le avisamos al artista.'
            : 'Contrato rescindido. No pudimos enviarle el email al artista.',
        notice.ok ? 'success' : 'warning');
        return choice;
    }

    async function cancelContract(contract) {
        const k = kit();
        const reason = await k.promptDialog({
            title: 'Cancelar contrato',
            body: 'El artista ya no va a poder firmarlo. Si querés cambiar condiciones, después podés emitir una nueva versión.',
            label: 'Motivo (opcional)',
            multiline: true,
            maxLength: REASON_MAX,
            confirmLabel: 'Cancelar contrato',
            cancelLabel: 'Volver',
            tone: 'danger'
        });
        if (reason == null) return null;
        must(await repo().cancel(contract.id, text(reason)));
        k.toast('Contrato cancelado.', 'success');
        return true;
    }

    // Reusa un borrador que ya reemplace a este contrato; si no, lo crea.
    async function createNewVersion(ctx, contract) {
        const r = repo();
        const drafts = await r.listForStudio(ctx.studioId, { status: 'draft' });
        const existing = (drafts && Array.isArray(drafts.data) ? drafts.data : [])
            .find(c => c && c.supersedes_contract_id === contract.id && c.status === 'draft');
        if (existing) return existing.id;
        const id = idFrom(must(await r.saveDraft(newVersionPayload(contract))));
        if (!id) throw new Error('No pudimos crear la nueva versión.');
        return id;
    }

    // -------------------------------------------------------------
    // Editor (drawer)
    // -------------------------------------------------------------
    async function loadLocations(ctx) {
        const locations = data().StudioLocations;
        if (!locations || typeof locations.listActiveByStudio !== 'function') return [];
        try {
            const res = await locations.listActiveByStudio(ctx.studioId, 'id, label, is_primary, city, country, formatted_address');
            return res && !res.error && Array.isArray(res.data) ? res.data : [];
        } catch (err) {
            console.warn('[studio-contracts] sedes:', err);
            return [];
        }
    }

    function radio(name, value, checked, inner) {
        return '<label class="stc-option"><input type="radio" name="' + escAttr(name) + '" value="' + escAttr(value) + '"'
            + (checked ? ' checked' : '') + '>' + inner + '</label>';
    }

    function editorHtml(contract, opts) {
        const o = opts || {};
        const k = kit();
        const c = contract || {};
        const t = termsOf(c, o.studio);
        const uid = 'stc-ed-' + (++seq);
        const field = (name, labelText, control, hint) => '<div class="sk-field"><label for="' + uid + '-' + name + '">' + esc(labelText) + '</label>'
            + control + (hint ? '<span class="studio-help">' + esc(hint) + '</span>' : '') + '</div>';
        const idFor = name => uid + '-' + name;
        const locations = (o.locations || []).slice();
        const currentLoc = one(c.studio_locations);
        if (c.location_id && !locations.some(l => l.id === c.location_id) && currentLoc) locations.push(currentLoc);
        const locationOptions = '<option value="">Sin sede asignada</option>' + locations.map(l => '<option value="' + escAttr(l.id) + '"'
            + (l.id === c.location_id ? ' selected' : '') + '>' + esc(l.label || 'Sede') + (l.is_primary ? ' (principal)' : '') + '</option>').join('');
        const spot = t.spot;
        const meta = [
            t.contractNumber ? esc(t.contractNumber) + ' · v' + esc(t.version || 1) : '',
            t.origin ? esc(label('contractOrigin', t.origin)) : '',
            spot ? 'Spot: ' + esc(spot.title || 'Spot') : ''
        ].filter(Boolean).join(' · ');
        const pct = num(c.artist_percentage);
        return '<form class="stc-editor" data-stc-editor novalidate>'
            + (meta ? '<p class="stc-editor__meta">' + meta + '</p>' : '')
            + '<section class="stc-block" aria-labelledby="' + uid + '-h-parties">'
            + '<h3 class="stc-block__title" id="' + uid + '-h-parties">Partes y puesto</h3>'
            + '<dl class="stc-parties">'
            + '<div><dt>Estudio</dt><dd>' + esc(t.studio.name || 'Tu estudio') + '</dd></div>'
            + '<div><dt>Artista</dt><dd>' + esc(t.artist.name || 'Artista') + (t.artist.username ? ' <span class="sk-muted">@' + esc(t.artist.username) + '</span>' : '') + '</dd></div>'
            + '</dl>'
            + '<div class="sk-grid-2">'
            + field('role', 'Rol', '<select id="' + idFor('role') + '" name="role" class="studio-input">' + k.optionsHtml('membershipRole', c.role, { only: CONTRACT_ROLES }) + '</select>')
            + field('location_id', 'Sede', '<select id="' + idFor('location_id') + '" name="location_id" class="studio-input">' + locationOptions + '</select>')
            + '</div>'
            + '</section>'
            + '<section class="stc-block" aria-labelledby="' + uid + '-h-model">'
            + '<h3 class="stc-block__title" id="' + uid + '-h-model">Modalidad de pago</h3>'
            + '<div class="stc-modes" role="radiogroup" aria-labelledby="' + uid + '-h-model">'
            + MODELS.map(m => radio('compensation_model', m, c.compensation_model === m,
                '<span class="stc-option__title">' + esc(label('compensationModel', m)) + '</span><span class="stc-option__hint">' + esc(MODEL_HINTS[m]) + '</span>')).join('')
            + '</div>'
            + '<div class="stc-mode-panel" data-mode-panel="percentage">'
            + '<div class="sk-grid-2">'
            + field('artist_percentage', '% para el artista', '<input id="' + idFor('artist_percentage') + '" name="artist_percentage" type="number" class="studio-input" min="0" max="100" step="0.5" inputmode="decimal" value="' + escAttr(pct == null ? '' : pct) + '">', 'Lo que se queda el artista de cada tatuaje.')
            + '<div class="sk-field"><span class="sk-field-label">% para el estudio</span><output class="stc-share" data-stc-share for="' + idFor('artist_percentage') + '">—</output><span class="studio-help">Se calcula solo.</span></div>'
            + '</div>'
            + '</div>'
            + '<div class="stc-mode-panel" data-mode-panel="fixed">'
            + '<div class="sk-grid-2">'
            + field('fixed_amount', 'Monto fijo', '<input id="' + idFor('fixed_amount') + '" name="fixed_amount" type="number" class="studio-input" min="0" step="0.01" inputmode="decimal" value="' + escAttr(c.fixed_amount == null ? '' : c.fixed_amount) + '">')
            + field('fixed_currency', 'Moneda', '<select id="' + idFor('fixed_currency') + '" name="fixed_currency" class="studio-input"><option value="">Elegí la moneda</option>' + k.currencyOptionsHtml(c.fixed_currency || '') + '</select>')
            + field('fixed_period', 'Periodicidad', '<select id="' + idFor('fixed_period') + '" name="fixed_period" class="studio-input">' + k.optionsHtml('fixedPeriod', c.fixed_period, { empty: 'Elegí la periodicidad' }) + '</select>')
            + '<fieldset class="sk-span-2 stc-payer"><legend class="sk-field-label">Quién paga</legend>'
            + FIXED_PAYERS.map(p => radio('fixed_payer', p, c.fixed_payer === p, '<span class="stc-option__title">' + esc(label('fixedPayer', p)) + '</span>')).join('')
            + '</fieldset>'
            + '</div>'
            + '</div>'
            + '<p class="studio-help" data-mode-empty>Elegí una modalidad para completar las condiciones.</p>'
            + '</section>'
            + '<section class="stc-block" aria-labelledby="' + uid + '-h-dates">'
            + '<h3 class="stc-block__title" id="' + uid + '-h-dates">Vigencia</h3>'
            + '<div class="sk-grid-2">'
            + field('start_date', 'Inicio', '<input id="' + idFor('start_date') + '" name="start_date" type="date" class="studio-input" value="' + escAttr(k.toDateInput(c.start_date)) + '">')
            + field('end_date', 'Fin (opcional)', '<input id="' + idFor('end_date') + '" name="end_date" type="date" class="studio-input" value="' + escAttr(k.toDateInput(c.end_date)) + '">', 'Sin fecha de fin, el contrato sigue hasta que una parte lo rescinda.')
            + field('cancellation_notice_days', 'Preaviso de baja (días)', '<input id="' + idFor('cancellation_notice_days') + '" name="cancellation_notice_days" type="number" class="studio-input" min="0" max="365" step="1" inputmode="numeric" value="' + escAttr(c.cancellation_notice_days == null ? '' : c.cancellation_notice_days) + '">')
            + '</div>'
            + '</section>'
            + '<section class="stc-block" aria-labelledby="' + uid + '-h-lists">'
            + '<h3 class="stc-block__title" id="' + uid + '-h-lists">Qué incluye, beneficios y obligaciones</h3>'
            + LISTS.map(l => '<div class="sk-field stc-listfield"><span class="sk-field-label">' + esc(l.label) + '</span><div data-list="' + escAttr(l.key) + '"></div></div>').join('')
            + '<p class="studio-help">Hasta 20 ítems de hasta 200 caracteres cada uno.</p>'
            + '</section>'
            + '<section class="stc-block" aria-labelledby="' + uid + '-h-terms">'
            + '<h3 class="stc-block__title" id="' + uid + '-h-terms">Normas y cláusulas</h3>'
            + field('house_rules', 'Normas del estudio', '<textarea id="' + idFor('house_rules') + '" name="house_rules" class="studio-textarea" rows="4" maxlength="' + HOUSE_RULES_MAX + '">' + esc(c.house_rules || '') + '</textarea>')
            + field('terms', 'Cláusulas', '<textarea id="' + idFor('terms') + '" name="terms" class="studio-textarea" rows="8" maxlength="' + TERMS_MAX + '">' + esc(c.terms || '') + '</textarea>', 'Exclusividad, uso de imagen, resolución de conflictos o lo que tengan acordado.')
            + '</section>'
            + '<section class="stc-block" aria-labelledby="' + uid + '-h-issue">'
            + '<h3 class="stc-block__title" id="' + uid + '-h-issue">Emisión</h3>'
            + field('expires_on', 'El artista puede firmar hasta', '<input id="' + idFor('expires_on') + '" name="expires_on" type="date" class="studio-input" min="' + escAttr(todayYmd()) + '" value="' + escAttr(addDaysYmd(DEFAULT_EXPIRY_DAYS)) + '">', 'Por defecto, 14 días. Al emitir firmás vos y se congelan los términos.')
            + '</section>'
            + '<section class="stc-preview" data-stc-preview hidden aria-label="Vista previa del contrato"></section>'
            + '</form>';
    }

    function syncModes(form) {
        const checked = form.querySelector('input[name="compensation_model"]:checked');
        const model = checked ? checked.value : '';
        form.querySelectorAll('[data-mode-panel]').forEach(panel => {
            const kind = panel.getAttribute('data-mode-panel');
            panel.hidden = !(model === kind || model === 'mixed');
        });
        const empty = form.querySelector('[data-mode-empty]');
        if (empty) empty.hidden = !!model;
    }

    function syncShare(form) {
        const input = form.querySelector('input[name="artist_percentage"]');
        const out = form.querySelector('[data-stc-share]');
        if (!out) return;
        const pct = num(input && input.value);
        out.textContent = pct == null || pct < 0 || pct > 100 ? '—' : kit().fmtPercent(round2(100 - pct));
    }

    function wireEditor(drawer, contract) {
        const form = drawer && drawer.body && typeof drawer.body.querySelector === 'function'
            ? drawer.body.querySelector('[data-stc-editor]') : null;
        if (!form) return null;
        const k = kit();
        const lists = {};
        LISTS.forEach(l => {
            const editor = k.listEditor({ items: contract[l.key] || [], max: LIST_MAX, maxLen: ITEM_MAX, placeholder: l.placeholder, label: l.label });
            lists[l.key] = editor;
            const host = form.querySelector('[data-list="' + l.key + '"]');
            if (host && editor.el) host.appendChild(editor.el);
        });
        form.addEventListener('submit', event => event.preventDefault());
        form.addEventListener('change', event => {
            if (event.target && event.target.name === 'compensation_model') syncModes(form);
        });
        form.addEventListener('input', event => {
            if (event.target && event.target.name === 'artist_percentage') syncShare(form);
        });
        syncModes(form);
        syncShare(form);
        return {
            form,
            read() {
                const raw = k.readForm(form, { emptyAsNull: true });
                const out = {};
                ['role', 'location_id', 'compensation_model', 'artist_percentage', 'fixed_amount', 'fixed_currency', 'fixed_period',
                    'fixed_payer', 'start_date', 'end_date', 'cancellation_notice_days', 'house_rules', 'terms', 'expires_on']
                    .forEach(key => { out[key] = raw[key] === undefined ? null : raw[key]; });
                LISTS.forEach(l => { out[l.key] = lists[l.key].getItems(); });
                return out;
            }
        };
    }

    async function runEditor(ctx, contract) {
        const k = kit();
        const locations = await loadLocations(ctx);
        const t = termsOf(contract, ctx.studio);
        let editor = null;
        let current = contract;
        let saved = false;
        let previewOpen = false;

        const readState = () => {
            if (!editor) throw new Error('No pudimos abrir el editor. Recargá la página e intentá de nuevo.');
            return editor.read();
        };
        const persist = async st => {
            const problem = validateDraft(st);
            if (problem) throw new Error(problem);
            const payload = draftPayload(current, st);
            const id = idFrom(must(await repo().saveDraft(payload))) || current.id;
            current = Object.assign({}, current, payload, { id });
            saved = true;
            return current;
        };
        const renderPreview = () => {
            const host = editor && editor.form.querySelector('[data-stc-preview]');
            if (!host) return;
            const st = editor.read();
            const payload = draftPayload(current, st);
            const loc = locations.find(l => l.id === payload.location_id) || null;
            host.innerHTML = '<h3 class="stc-block__title">Vista previa</h3>'
                + contractDocumentHtml(Object.assign({}, current, payload, { status: 'draft', studio_locations: loc }), { studio: ctx.studio, preview: true });
            host.hidden = false;
            if (typeof host.scrollIntoView === 'function') host.scrollIntoView({ behavior: 'smooth', block: 'start' });
        };

        const drawer = k.openDrawer({
            title: 'Borrador ' + (t.contractNumber || '') + (t.version ? ' · v' + t.version : ''),
            width: 'xl',
            className: 'stc-drawer',
            body: editorHtml(contract, { studio: ctx.studio, locations }),
            actions: [
                {
                    label: 'Descartar borrador',
                    variant: 'ghost',
                    className: 'stc-discard',
                    async onClick() {
                        const ok = await k.confirmDialog({
                            title: 'Descartar borrador',
                            body: '<p class="sk-overlay__text">El borrador queda cancelado y no se envía al artista.</p>',
                            confirmLabel: 'Descartar',
                            tone: 'danger'
                        });
                        if (!ok) return false;
                        must(await repo().cancel(current.id, 'Borrador descartado'));
                        k.toast('Borrador descartado.', 'success');
                        return { discarded: true };
                    }
                },
                {
                    label: 'Vista previa',
                    variant: 'ghost',
                    close: false,
                    onClick() {
                        readState();
                        const host = editor.form.querySelector('[data-stc-preview]');
                        previewOpen = !previewOpen;
                        if (previewOpen) renderPreview();
                        else if (host) { host.hidden = true; host.innerHTML = ''; }
                    }
                },
                {
                    label: 'Guardar borrador',
                    close: false,
                    async onClick() {
                        await persist(readState());
                        if (previewOpen) renderPreview();
                        k.toast('Borrador guardado.', 'success');
                    }
                },
                {
                    label: 'Emitir y firmar',
                    variant: 'primary',
                    async onClick() {
                        const st = readState();
                        const problem = validateDraft(st, { forIssue: true });
                        if (problem) throw new Error(problem);
                        await persist(st);
                        const issued = await issueContract(ctx, current, st);
                        if (!issued) return false;
                        return { issued: true };
                    }
                }
            ]
        });
        editor = wireEditor(drawer, contract);
        const value = await drawer.closed;
        const issued = !!(value && value.issued);
        if (issued || saved || (value && value.discarded)) {
            reloadList();
            if (issued || (value && value.discarded)) refreshShell(ctx);
        }
        return { contractId: current.id, issued };
    }

    // -------------------------------------------------------------
    // Documento (emitido, firmado o cerrado)
    // -------------------------------------------------------------
    function printContract(drawer, contract) {
        const k = kit();
        const t = termsOf(contract);
        const docEl = drawer && drawer.body && typeof drawer.body.querySelector === 'function' ? drawer.body.querySelector('.stc-doc') : null;
        const title = 'Contrato ' + (t.contractNumber || '') + ' v' + (t.version || 1);
        if (docEl && typeof k.printDocument === 'function' && k.printDocument(docEl, { title })) return;
        if (typeof window.print === 'function') window.print();
    }

    async function runDocument(ctx, contract) {
        const k = kit();
        const t = termsOf(contract, ctx.studio);
        const wanted = documentActionsFor(contract);
        let drawer = null;
        const actions = [];
        if (wanted.includes('cancel')) {
            actions.push({
                label: 'Cancelar contrato',
                variant: 'ghost',
                async onClick() { return (await cancelContract(contract)) ? { changed: true } : false; }
            });
        }
        if (wanted.includes('terminate')) {
            actions.push({
                label: 'Rescindir',
                variant: 'danger',
                async onClick() { return (await terminateContract(ctx, contract)) ? { changed: true } : false; }
            });
        }
        actions.push({ label: 'Imprimir', variant: 'ghost', close: false, onClick() { printContract(drawer, contract); } });
        if (wanted.includes('new_version')) {
            actions.push({
                label: 'Nueva versión',
                variant: 'primary',
                async onClick() { return { next: await createNewVersion(ctx, contract) }; }
            });
        }
        drawer = k.openDrawer({
            title: 'Contrato ' + (t.contractNumber || '') + ' · v' + (t.version || 1),
            width: 'lg',
            className: 'stc-drawer',
            body: contractDocumentHtml(contract, { studio: ctx.studio }),
            actions
        });
        const value = await drawer.closed;
        if (value && value.changed) {
            reloadList();
            refreshShell(ctx);
        }
        if (value && value.next) {
            reloadList();
            return openEditor(value.next);
        }
        return { contractId: contract.id, issued: false };
    }

    // -------------------------------------------------------------
    // API global
    // -------------------------------------------------------------
    async function openEditor(contractId) {
        const id = idFrom(contractId);
        if (!id) throw new Error('Falta el contrato.');
        const r = repo();
        if (!r) throw missingBackendError();
        const ctx = await getCtx();
        const contract = must(await r.get(id));
        if (!contract) throw new Error('No encontramos el contrato. Puede que se haya cancelado.');
        return contract.status === 'draft' ? runEditor(ctx, contract) : runDocument(ctx, contract);
    }

    // Aceptar una postulación: primero el borrador (si la RPC falta, el error
    // sube con su código y el shell usa el flujo viejo sin haber decidido
    // nada); después se preselecciona la postulación y se avisa al artista.
    async function openFromApplication(app, spot) {
        void spot; // el título y el tipo salen del contrato
        const appId = app && (app.id || app.application_id);
        if (!appId) throw new Error('Falta la postulación.');
        const r = repo();
        if (!r) throw missingBackendError();
        const ctx = await getCtx();
        const contractId = idFrom(must(await r.prepareFromApplication(appId)));
        if (!contractId) throw new Error('No pudimos preparar el contrato.');
        await shortlistApplication(ctx, appId);
        return openEditor(contractId);
    }

    // decide_studio_spot_application('accepted') con M2 deja la postulación en
    // shortlisted (sin membresía) y reusa el borrador. Su falla no frena el editor.
    async function shortlistApplication(ctx, appId) {
        const spots = data().StudioSpots;
        if (!spots || typeof spots.decideApplicationRpc !== 'function') return false;
        try {
            const res = await spots.decideApplicationRpc(appId, 'accepted');
            if (res && res.error) {
                console.warn('[studio-contracts] no se pudo preseleccionar la postulación:', res.error);
                return false;
            }
            await notifySafe(ctx, { kind: 'spot_decision', application_id: appId, decision: 'accepted' });
            return true;
        } catch (err) {
            console.warn('[studio-contracts] no se pudo preseleccionar la postulación:', err);
            return false;
        }
    }

    // Abre el contrato vigente (enviado o firmado) o prepara un borrador.
    async function openForMembership(membership) {
        const id = membership && (membership.id || membership.membership_id);
        if (!id) throw new Error('Falta el vínculo del artista.');
        const r = repo();
        if (!r) throw missingBackendError();
        await getCtx();
        const current = await r.getCurrentForMembership(id);
        if (current && current.error) throw toError(current.error);
        if (current && current.unavailable) throw missingBackendError();
        const existing = current && current.data;
        if (existing && existing.id) return openEditor(existing.id);
        const contractId = idFrom(must(await r.prepareForMembership(id)));
        if (!contractId) throw new Error('No pudimos preparar el contrato.');
        return openEditor(contractId);
    }

    // -------------------------------------------------------------
    // Pestaña: listado
    // -------------------------------------------------------------
    function filterIdFor(value) {
        const v = String(value || '');
        if (FILTERS.some(f => f.id === v)) return v;
        if (CLOSED_STATUSES.includes(v)) return 'closed';
        return 'all';
    }

    function matchesFilter(c, filterId) {
        const f = FILTERS.find(x => x.id === filterId) || FILTERS[0];
        return !f.statuses || f.statuses.includes(c.status);
    }

    function matchesQuery(c, query) {
        const q = String(query || '').trim().toLowerCase().replace(/^@/, '');
        if (!q) return true;
        const a = one(c.artists_db) || {};
        return [c.contract_number, a.name, a.username].some(v => String(v || '').toLowerCase().includes(q));
    }

    function visibleContracts(contracts, filterId, query) {
        return (contracts || []).filter(c => c && matchesFilter(c, filterId) && matchesQuery(c, query));
    }

    function statusCellHtml(c) {
        const k = kit();
        let extra = '';
        if (c.status === 'sent' && c.expires_at) {
            const days = k.daysUntil(c.expires_at);
            if (days != null && days <= EXPIRING_SOON_DAYS) {
                // Un 'sent' con el plazo pasado (expireOverdue todavía no corrió o falló).
                const when = days < 0 ? 'Plazo vencido' : days === 0 ? 'Vence hoy' : 'Vence ' + k.fmtRelative(c.expires_at);
                extra = '<br><small class="stc-expiring">' + esc(when) + '</small>';
            }
        }
        return k.statusBadge('contractStatus', c.status) + extra;
    }

    function contractsTableHtml(rows) {
        const k = kit();
        return k.renderTable({
            className: 'stc-table',
            rows,
            emptyText: 'No hay contratos con este filtro.',
            rowAttrs: c => ({ 'data-contract-id': c.id }),
            columns: [
                { label: 'Número', render: c => '<button type="button" class="stc-link" data-stc-open="' + escAttr(c.id) + '">' + esc(c.contract_number || 'Sin número') + '</button>' },
                { label: 'Versión', render: c => esc('v' + (c.version || 1)) },
                {
                    label: 'Artista',
                    render: c => {
                        const a = one(c.artists_db) || {};
                        return '<strong>' + esc(a.name || a.username || 'Artista') + '</strong>' + (a.username ? '<br><small>@' + esc(a.username) + '</small>' : '');
                    }
                },
                { label: 'Rol', render: c => esc(label('membershipRole', c.role)) },
                { label: 'Modalidad', render: c => esc(compensationShort(termsOf(c))) },
                { label: 'Vigencia', render: c => esc(validityShort(termsOf(c))) },
                { label: 'Estado', render: statusCellHtml },
                { label: 'Enviado', render: c => esc(k.fmtDate(c.sent_at)) },
                { label: 'Firmado', render: c => esc(k.fmtDate(c.artist_signed_at)) },
                {
                    label: 'Acciones',
                    render: c => '<button type="button" class="studio-btn studio-btn-ghost sk-btn-sm" data-stc-open="' + escAttr(c.id) + '">'
                        + esc(c.status === 'draft' ? 'Editar' : 'Ver') + '</button>'
                }
            ]
        });
    }

    function filtersHtml(contracts, active) {
        return FILTERS.map(f => {
            const count = (contracts || []).filter(c => c && matchesFilter(c, f.id)).length;
            return '<button type="button" class="sk-chip" data-stc-filter="' + escAttr(f.id) + '" aria-pressed="' + (f.id === active ? 'true' : 'false') + '">'
                + esc(f.label) + ' <span class="sk-chip-count">' + esc(count) + '</span></button>';
        }).join('');
    }

    function moduleShellHtml() {
        return '<div class="stc-module">'
            + '<div class="sk-toolbar stc-toolbar">'
            + '<div class="sk-field stc-search"><label for="stc-search">Buscar</label>'
            + '<input id="stc-search" type="search" class="studio-input" placeholder="Artista o número de contrato" autocomplete="off" data-stc-search></div>'
            + '<span class="sk-toolbar-spacer"></span>'
            + '<button type="button" class="studio-btn studio-btn-primary" data-stc-new><i class="fa-solid fa-file-signature" aria-hidden="true"></i> Nuevo contrato</button>'
            + '</div>'
            + '<div class="sk-chips stc-filters" role="group" aria-label="Filtrar por estado" data-stc-filters></div>'
            + '<div class="stc-list" data-stc-list><p class="studio-help">Cargando contratos…</p></div>'
            + '</div>';
    }

    function renderList() {
        const root = state.root;
        if (!root || typeof root.querySelector !== 'function') return;
        const k = kit();
        const list = root.querySelector('[data-stc-list]');
        const filters = root.querySelector('[data-stc-filters]');
        if (!list) return;
        if (state.unavailable) {
            if (filters) filters.innerHTML = '';
            list.innerHTML = k.emptyState({ title: 'Contratos en camino', body: MISSING_MESSAGE });
            return;
        }
        if (state.error) {
            if (filters) filters.innerHTML = '';
            list.innerHTML = '<div class="studio-status studio-status-error" role="alert">' + esc(k.friendlyError(state.error, 'No pudimos cargar los contratos.')) + '</div>';
            return;
        }
        if (filters) filters.innerHTML = filtersHtml(state.contracts, state.filter);
        if (!state.contracts.length) {
            list.innerHTML = k.emptyState({
                title: 'Todavía no hay contratos',
                body: 'Se crean al aceptar una postulación a un spot, al aprobar una solicitud con contrato o desde el botón "Contrato" del roster.'
            });
            return;
        }
        list.innerHTML = contractsTableHtml(visibleContracts(state.contracts, state.filter, state.query));
    }

    async function loadList(ctx) {
        const r = repo();
        const token = ++state.loadSeq;
        if (!r) {
            state.unavailable = true;
            renderList();
            return;
        }
        try {
            const expired = await r.expireOverdue(ctx.studioId);
            if (expired && expired.error) console.warn('[studio-contracts] expireOverdue:', expired.error);
        } catch (err) {
            console.warn('[studio-contracts] expireOverdue:', err);
        }
        let res;
        try {
            res = await r.listForStudio(ctx.studioId);
        } catch (err) {
            res = { data: null, error: err };
        }
        if (token !== state.loadSeq) return;
        state.loaded = true;
        state.unavailable = !!(res && res.unavailable);
        state.error = res && res.error && !state.unavailable ? res.error : null;
        state.contracts = !state.error && res && Array.isArray(res.data) ? res.data : [];
        renderList();
        if (!state.unavailable && !state.error && typeof ctx.setBadge === 'function') {
            ctx.setBadge(TAB, state.contracts.filter(c => c && c.status === 'sent').length);
        }
    }

    function reloadList() {
        if (state.root && state.ctx && state.loaded) loadList(state.ctx).catch(err => console.warn('[studio-contracts] recarga:', err));
    }

    function refreshShell(ctx) {
        if (!ctx || typeof ctx.refresh !== 'function') return;
        Promise.resolve().then(() => ctx.refresh()).catch(err => console.warn('[studio-contracts] refresh:', err));
    }

    // "Nuevo contrato": elegir un artista del roster (sin managers).
    async function openNewContract(ctx) {
        const k = kit();
        const memberships = data().StudioMemberships || {};
        const list = typeof memberships.listRosterV2 === 'function' ? memberships.listRosterV2 : memberships.listRoster;
        if (typeof list !== 'function') throw missingBackendError();
        const rows = must(await list.call(memberships, ctx.studioId)) || [];
        const eligible = rows.filter(rosterEligible);
        if (!eligible.length) {
            k.toast('Primero sumá artistas al roster: el contrato se arma sobre un vínculo.', 'info');
            return null;
        }
        const id = 'stc-new-' + (++seq);
        const options = eligible.map(m => {
            const a = one(m.artists_db) || {};
            return '<option value="' + escAttr(m.id) + '">' + esc((a.name || a.username || 'Artista') + ' · ' + label('membershipRole', m.role)
                + ' · ' + label('membershipStatus', m.status)) + '</option>';
        }).join('');
        const modal = k.openModal({
            title: 'Nuevo contrato',
            size: 'sm',
            body: '<div class="sk-field"><label for="' + id + '">Artista del roster</label><select id="' + id + '" class="studio-input">' + options + '</select></div>'
                + '<p class="studio-help">Si ya tiene un contrato enviado o firmado, lo abrimos; si no, preparamos el borrador.</p>',
            actions: [
                { label: 'Cancelar', variant: 'ghost', value: null },
                {
                    label: 'Continuar',
                    variant: 'primary',
                    onClick(m) {
                        const select = m.body && m.body.querySelector('#' + id);
                        return eligible.find(x => String(x.id) === String(select && select.value)) || false;
                    }
                }
            ]
        });
        const chosen = await modal.closed;
        if (!chosen) return null;
        return openForMembership(chosen);
    }

    function wireList(root, ctx) {
        const k = kit();
        root.addEventListener('click', event => {
            const target = event.target && typeof event.target.closest === 'function' ? event.target : null;
            if (!target) return;
            const open = target.closest('[data-stc-open]');
            if (open) {
                k.guarded(open, () => openEditor(open.getAttribute('data-stc-open')));
                return;
            }
            const filter = target.closest('[data-stc-filter]');
            if (filter) {
                state.filter = filterIdFor(filter.getAttribute('data-stc-filter'));
                renderList();
                return;
            }
            const create = target.closest('[data-stc-new]');
            if (create) k.guarded(create, () => openNewContract(ctx));
        });
        const search = root.querySelector('[data-stc-search]');
        if (search) {
            const apply = k.debounce(() => { state.query = search.value || ''; renderList(); }, 200);
            search.addEventListener('input', apply);
        }
    }

    const tabModule = {
        mount(root, ctx) {
            state.ctx = ctx;
            state.root = root;
            root.innerHTML = moduleShellHtml();
            wireList(root, ctx);
        },
        async show(root, ctx, params) {
            const p = params || {};
            if (p.status || p.filter) state.filter = filterIdFor(p.status || p.filter);
            await loadList(ctx);
            const target = p.contract || p.contrato || p.contract_id || p.id;
            if (target) kit().guarded(null, () => openEditor(String(target)));
        }
    };

    // -------------------------------------------------------------
    // Roster: botón "Contrato" por fila
    // -------------------------------------------------------------
    function rosterEligible(m) {
        return !!m && m.id != null && m.role !== 'manager' && ROSTER_STATUSES.includes(m.status);
    }

    function injectRosterButtons(tableEl, members) {
        if (!tableEl || typeof tableEl.querySelectorAll !== 'function') return 0;
        const doc = tableEl.ownerDocument || (typeof document !== 'undefined' ? document : null);
        if (!doc || typeof doc.createElement !== 'function') return 0;
        const byId = new Map((Array.isArray(members) ? members : []).filter(Boolean).map(m => [String(m.id), m]));
        let added = 0;
        tableEl.querySelectorAll('tr[data-membership-id]').forEach(tr => {
            const id = tr.getAttribute('data-membership-id');
            const m = byId.get(String(id)) || { id, status: tr.getAttribute('data-status'), role: tr.getAttribute('data-role') };
            if (!rosterEligible(m)) return;
            const cell = tr.querySelector('.studio-roster-actions') || tr.lastElementChild || null;
            if (!cell || cell.querySelector('button[data-contract-for]')) return;
            const name = artistDisplay(one(m.artists_db) || { name: tr.getAttribute('data-artist-name') });
            const btn = doc.createElement('button');
            btn.type = 'button';
            btn.className = 'studio-locations-add stc-roster-btn';
            btn.setAttribute('data-contract-for', String(id));
            btn.setAttribute('aria-label', (m.current_contract_id ? 'Ver el contrato de ' : 'Contrato de ') + name);
            btn.title = m.current_contract_id ? 'Ver el contrato vigente' : 'Abrir o preparar el contrato';
            btn.textContent = 'Contrato';
            btn.addEventListener('click', () => kit().guarded(btn, () => openForMembership(m)));
            cell.appendChild(btn);
            added++;
        });
        return added;
    }

    // -------------------------------------------------------------
    // Registro
    // -------------------------------------------------------------
    window.WeOtziStudioContracts = { openFromApplication, openForMembership, openEditor };

    const admin = window.WeOtziStudioAdmin;
    if (admin && typeof admin.register === 'function') {
        admin.register(TAB, tabModule);
        if (typeof admin.onRosterRender === 'function') admin.onRosterRender(injectRosterButtons);
    } else {
        console.warn('[studio-contracts] falta WeOtziStudioAdmin: la pestaña Contratos no se registra.');
    }
})();
