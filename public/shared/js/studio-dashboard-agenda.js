// ============================================
// Studio Dashboard — Agenda (pestaña 'agenda')
// Citas de todos los artistas activos del estudio en tres vistas:
//   - Día: una columna por artista, de 08 a 24 en tramos de 30 minutos.
//   - Semana: una columna por día, con tarjetas del color de cada artista.
//   - Lista: todas las citas del período (también canceladas), con CSV.
// Los bloques "Ocupado" (agenda personal, sesiones de cotización y citas en
// otros estudios) llegan sin detalle desde list_studio_artist_busy_blocks.
// El modal de cita consulta la disponibilidad en vivo con
// check_studio_booking_availability (debounce de 400 ms) y vuelve a
// consultarla al guardar. Crear y cancelar notifican al artista
// (booking_created / booking_cancelled); completar dispara
// 'weotzi:studio-jobs-changed' para que Operaciones repinte los trabajos.
//
// Contrato: docs/plans/2026-10-30-estudios-plataforma.md → "Agenda".
// Datos solo vía WeotziData.StudioOps / StudioMemberships / StudioLocations.
// Sin la migración M3 (20261030202000) la agenda sigue funcionando: sin
// bloques "Ocupado" ni chequeo en vivo, sin "No asistió" y sin teléfono,
// servicio ni seña (se reintenta el guardado sin esas columnas).
//
// Parámetros de show (ctx.navigate('agenda', {...})): view ('day' | 'week' |
// 'list'), date ('YYYY-MM-DD'), artist, location, booking (abre esa cita del
// período cargado) y new (abre "Nueva cita").
// ============================================

(function () {
    'use strict';

    const TAB = 'agenda';
    const VIEWS = ['day', 'week', 'list'];
    const VIEW_LABELS = { day: 'Día', week: 'Semana', list: 'Lista' };
    const GRID_START_HOUR = 8;
    const GRID_END_HOUR = 24;
    const SLOT_MINUTES = 30;
    const LIST_DAYS = 30;
    const TONE_COUNT = 8;
    const AVAILABILITY_DEBOUNCE_MS = 400;
    const DEFAULT_DURATION_MIN = 60;
    const DEFAULT_CURRENCY = 'USD';
    // Columnas de M3 en studio_bookings: sin la migración se guardan sin ellas.
    const EXTRA_COLUMNS = ['client_phone', 'service_description', 'deposit_amount'];
    const MISSING_COLUMN_CODES = ['PGRST204', '42703'];
    // Día y Semana no muestran las canceladas; la Lista sí.
    const GRID_STATUSES = ['confirmed', 'completed', 'no_show'];
    const LIST_FILTERS = ['all', 'confirmed', 'completed', 'cancelled', 'no_show'];
    const STORAGE_KEY = 'weotzi:studio-agenda:view';
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const WEEKDAYS_LONG = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const REASON_TEXT = {
        mismo_estudio: 'ya tiene otra cita en este estudio en ese horario',
        agenda_personal: 'tiene ocupada su agenda personal en ese horario',
        otro_estudio: 'tiene una cita en otro estudio en ese horario'
    };
    const FALLBACK_MISSING = 'Esta función todavía no está disponible (falta aplicar una migración).';

    // -------------------------------------------------------------
    // Kit y escapes (el kit se resuelve al usarse)
    // -------------------------------------------------------------
    function kit() { return window.WeOtziStudioKit || null; }

    function esc(v) {
        const K = kit();
        if (K && typeof K.escapeHtml === 'function') return K.escapeHtml(v);
        return String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function escA(v) {
        const K = kit();
        return K && typeof K.escapeAttr === 'function' ? K.escapeAttr(v) : esc(v).replace(/`/g, '&#96;');
    }
    function friendly(err) {
        const K = kit();
        if (K && typeof K.friendlyError === 'function') return K.friendlyError(err);
        return (err && err.message) || 'No pudimos completar la acción. Intentá de nuevo.';
    }
    function isMissingSchema(err) {
        const K = kit();
        return !!(K && typeof K.isMissingSchema === 'function' && K.isMissingSchema(err));
    }
    function missingMessage() {
        const K = kit();
        return (K && K.MISSING_SCHEMA_MESSAGE) || FALLBACK_MISSING;
    }
    function errorCode(err) {
        if (!err || typeof err !== 'object') return '';
        return String(err.code || (err.original && err.original.code) || (err.cause && err.cause.code) || '');
    }
    function isMissingColumn(err) { return MISSING_COLUMN_CODES.includes(errorCode(err)); }
    function statusLabel(value) {
        const K = kit();
        return K ? K.label('bookingStatus', value) : String(value || '—');
    }
    function statusBadge(value) {
        const K = kit();
        return K ? K.statusBadge('bookingStatus', value) : '<span class="sk-badge">' + esc(statusLabel(value)) + '</span>';
    }
    function money(amount, currency) {
        const K = kit();
        return K ? K.fmtMoney(amount, currency) : String(amount == null ? '—' : amount + ' ' + (currency || ''));
    }
    function totalsText(rows, amountKey) {
        const K = kit();
        if (!K) return '—';
        return K.fmtTotals(K.sumByCurrency(rows, amountKey, 'currency'));
    }

    // Resuelve un builder de supabase-js (o una promesa de {data, error}) sin lanzar.
    async function settle(build) {
        try {
            const result = await build();
            return result || { data: null, error: null };
        } catch (error) {
            return { data: null, error };
        }
    }

    // -------------------------------------------------------------
    // Fechas (locales)
    // -------------------------------------------------------------
    const pad2 = n => String(n).padStart(2, '0');
    function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
    function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
    function mondayOf(d) {
        const day = startOfDay(d);
        return addDays(day, -((day.getDay() + 6) % 7));
    }
    function ymd(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
    function parseYmd(value) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value == null ? '' : value).trim());
        if (!m) return null;
        const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
        return d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? d : null;
    }
    function parseHm(value) {
        const m = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(String(value == null ? '' : value).trim());
        if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
        return Number(m[1]) * 60 + Number(m[2]);
    }
    function hm(minutes) {
        const m = Math.max(0, Math.min(23 * 60 + 59, Math.round(minutes)));
        return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60);
    }
    function hhmmOf(ms) { const d = new Date(ms); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
    function toMs(value) {
        if (value == null || value === '') return null;
        const t = value instanceof Date ? value.getTime() : Date.parse(value);
        return Number.isFinite(t) ? t : null;
    }
    function sameDay(a, b) {
        return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    }
    function shortDate(d) { return pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1); }
    function fullDate(d) { return shortDate(d) + '/' + d.getFullYear(); }
    function weekdayShort(d) {
        const K = kit();
        return K ? K.fmtDate(d, { style: 'weekday' }) : WEEKDAYS_LONG[d.getDay()].slice(0, 3) + ' ' + shortDate(d);
    }
    function longDayLabel(d) {
        const K = kit();
        return WEEKDAYS_LONG[d.getDay()] + ' ' + (K ? K.fmtDate(d, { style: 'long' }) : fullDate(d));
    }
    // "10:00–12:00". Si el intervalo cruza el día visible, se recorta y "24:00"
    // marca el fin del día; cubrir el día entero es "Todo el día".
    function timeRange(startMs, endMs, dayStartMs, dayEndMs) {
        if (dayStartMs != null && dayEndMs != null) {
            if (startMs <= dayStartMs && endMs >= dayEndMs) return 'Todo el día';
            const s = Math.max(startMs, dayStartMs);
            return hhmmOf(s) + '–' + (endMs >= dayEndMs ? '24:00' : hhmmOf(endMs));
        }
        return hhmmOf(startMs) + '–' + hhmmOf(endMs);
    }

    // Rango que carga cada vista: [from, to) en horario local.
    function rangeFor(view, anchor) {
        const base = startOfDay(anchor instanceof Date && !Number.isNaN(anchor.getTime()) ? anchor : new Date());
        if (view === 'week') {
            const from = mondayOf(base);
            return { view: 'week', from, to: addDays(from, 7), days: [0, 1, 2, 3, 4, 5, 6].map(i => addDays(from, i)) };
        }
        if (view === 'list') return { view: 'list', from: base, to: addDays(base, LIST_DAYS), days: [] };
        return { view: 'day', from: base, to: addDays(base, 1), days: [base] };
    }
    function shiftAnchor(view, anchor, dir) {
        const step = view === 'week' ? 7 : view === 'list' ? LIST_DAYS : 1;
        return addDays(startOfDay(anchor), step * (dir < 0 ? -1 : 1));
    }
    function rangeLabel(range) {
        if (range.view === 'week') {
            const last = addDays(range.to, -1);
            return 'Semana del ' + shortDate(range.from) + ' al ' + fullDate(last);
        }
        if (range.view === 'list') return 'Del ' + fullDate(range.from) + ' al ' + fullDate(addDays(range.to, -1));
        return longDayLabel(range.from);
    }

    // -------------------------------------------------------------
    // Modelo: roster, colores, citas y bloques ocupados
    // -------------------------------------------------------------
    function artistLabel(artist) {
        if (!artist) return 'Artista';
        const name = String(artist.name || '').trim();
        if (name) return name;
        return artist.username ? '@' + artist.username : 'Artista';
    }

    // Filas de listActiveRosterWithArtists → un artista por persona (puede
    // tener más de una membresía activa), ordenado por nombre.
    function normalizeRoster(rows) {
        const byArtist = new Map();
        (Array.isArray(rows) ? rows : []).forEach(row => {
            if (!row || !row.artist_user_id || byArtist.has(row.artist_user_id)) return;
            byArtist.set(row.artist_user_id, {
                id: row.artist_user_id,
                name: artistLabel(row.artists_db),
                locationId: row.location_id || null,
                role: row.role || null
            });
        });
        // ignorePunctuation: "@bo.ink" (sin nombre) se ordena por "boink", no antes de la A.
        return Array.from(byArtist.values()).sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base', ignorePunctuation: true }));
    }

    function normalizeBooking(row) {
        if (!row || !row.id) return null;
        const startMs = toMs(row.starts_at);
        const endMs = toMs(row.ends_at);
        if (startMs == null || endMs == null || endMs <= startMs) return null;
        return Object.assign({}, row, {
            startMs,
            endMs,
            artistName: artistLabel(row.artists_db),
            locationLabel: (row.studio_locations && row.studio_locations.label) || ''
        });
    }

    // Color estable por artista: primero el roster (orden por nombre) y después
    // los artistas que ya no están activos pero tienen citas en el período.
    function toneMap(roster, bookings) {
        const map = new Map();
        (roster || []).forEach(artist => { if (!map.has(artist.id)) map.set(artist.id, map.size % TONE_COUNT); });
        (bookings || []).forEach(b => { if (b && b.artist_user_id && !map.has(b.artist_user_id)) map.set(b.artist_user_id, map.size % TONE_COUNT); });
        return map;
    }
    function toneClass(tones, artistId) {
        const n = tones && tones.has(artistId) ? tones.get(artistId) : 0;
        return 'sa-tone-' + n;
    }

    // Bloques ocupados: se unen los que se superponen por artista (vienen de
    // varias fuentes y no llevan detalle).
    function mergeBusy(rows) {
        const byArtist = new Map();
        (Array.isArray(rows) ? rows : []).forEach(row => {
            if (!row || !row.artist_user_id) return;
            const startMs = toMs(row.starts_at);
            const endMs = toMs(row.ends_at);
            if (startMs == null || endMs == null || endMs <= startMs) return;
            if (!byArtist.has(row.artist_user_id)) byArtist.set(row.artist_user_id, []);
            byArtist.get(row.artist_user_id).push({ startMs, endMs });
        });
        const out = [];
        byArtist.forEach((list, artistId) => {
            list.sort((a, b) => a.startMs - b.startMs);
            let current = null;
            list.forEach(iv => {
                if (current && iv.startMs <= current.endMs) current.endMs = Math.max(current.endMs, iv.endMs);
                else {
                    current = { artistId, startMs: iv.startMs, endMs: iv.endMs };
                    out.push(current);
                }
            });
        });
        return out.sort((a, b) => a.startMs - b.startMs || String(a.artistId).localeCompare(String(b.artistId)));
    }

    function clip(startMs, endMs, fromMs, toMsValue) {
        const s = Math.max(startMs, fromMs);
        const e = Math.min(endMs, toMsValue);
        return e > s ? { startMs: s, endMs: e } : null;
    }

    // Carriles para lo que se superpone dentro de una columna: cada grupo de
    // ítems encadenados reparte el ancho entre sus carriles.
    function assignLanes(items) {
        const sorted = (Array.isArray(items) ? items : []).slice()
            .sort((a, b) => a.startMs - b.startMs || b.endMs - a.endMs);
        const out = [];
        let cluster = [];
        let laneEnds = [];
        let clusterEnd = -Infinity;
        const flush = () => {
            cluster.forEach(item => { item.lanes = laneEnds.length; });
            cluster = [];
            laneEnds = [];
        };
        sorted.forEach(src => {
            const item = Object.assign({}, src);
            if (item.startMs >= clusterEnd) { flush(); clusterEnd = -Infinity; }
            let lane = laneEnds.findIndex(end => end <= item.startMs);
            if (lane === -1) { lane = laneEnds.length; laneEnds.push(item.endMs); } else laneEnds[lane] = item.endMs;
            item.lane = lane;
            clusterEnd = Math.max(clusterEnd, item.endMs);
            cluster.push(item);
            out.push(item);
        });
        flush();
        return out;
    }

    function filterBookings(bookings, filters) {
        const f = filters || {};
        return (bookings || []).filter(b => b
            && (!f.artistId || b.artist_user_id === f.artistId)
            && (!f.locationId || b.location_id === f.locationId)
            && (!Array.isArray(f.statuses) || f.statuses.includes(b.status)));
    }

    // Columnas de la vista Día (y artistas de la leyenda). Con sede elegida:
    // los de esa sede, los sin sede fija y los que tienen citas ahí.
    function visibleArtists(roster, bookings, filters) {
        const f = filters || {};
        const list = (roster || []).slice();
        const known = new Set(list.map(a => a.id));
        (bookings || []).forEach(b => {
            if (!b || known.has(b.artist_user_id) || b.status === 'cancelled') return;
            known.add(b.artist_user_id);
            list.push({ id: b.artist_user_id, name: b.artistName || 'Artista', locationId: null, role: null, inactive: true });
        });
        return list.filter(artist => {
            if (f.artistId && artist.id !== f.artistId) return false;
            if (!f.locationId) return true;
            const hasBookingHere = () => (bookings || []).some(b => b.artist_user_id === artist.id && b.location_id === f.locationId);
            // Quien ya no está activo no tiene sede fija: solo aparece si tiene citas en esa sede.
            if (artist.inactive) return hasBookingHere();
            if (!artist.locationId || artist.locationId === f.locationId) return true;
            return hasBookingHere();
        });
    }

    // Acciones posibles sobre una cita. Completar y "No asistió" solo cuando
    // ya empezó (lo exige la base); "No asistió" necesita M3.
    function bookingActions(booking, nowMs, opts) {
        if (!booking || booking.status !== 'confirmed') return [];
        const started = booking.startMs != null ? booking.startMs <= nowMs : (toMs(booking.starts_at) || Infinity) <= nowMs;
        const out = ['edit'];
        if (started) out.push('complete');
        if (started && !(opts && opts.m3 === false)) out.push('no_show');
        out.push('cancel');
        return out;
    }
    const ACTION_LABELS = { edit: 'Editar', complete: 'Completar', no_show: 'No asistió', cancel: 'Cancelar' };

    // -------------------------------------------------------------
    // Formulario de cita: validación y payload
    // -------------------------------------------------------------
    function cleanLine(v, max) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max); }
    function cleanText(v, max) { return String(v == null ? '' : v).replace(/\r\n/g, '\n').trim().slice(0, max); }
    function round2(n) { return Math.round(n * 100) / 100; }
    function toAmount(v) {
        if (v == null || v === '') return null;
        const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
        return Number.isFinite(n) ? n : NaN;
    }

    // Artista + fecha + horario → {artistId, starts, ends} o {error}.
    function slotFromValues(values) {
        const v = values || {};
        const artistId = v.artist_user_id ? String(v.artist_user_id) : '';
        if (!artistId) return { error: 'Elegí el artista de la cita.' };
        const date = parseYmd(v.date);
        if (!date) return { error: 'Elegí la fecha de la cita.' };
        const start = parseHm(v.start);
        const end = parseHm(v.end);
        if (start == null || end == null) return { error: 'Indicá la hora de inicio y la de fin.' };
        const starts = new Date(date.getFullYear(), date.getMonth(), date.getDate(), Math.floor(start / 60), start % 60);
        const ends = new Date(date.getFullYear(), date.getMonth(), date.getDate(), Math.floor(end / 60), end % 60);
        if (!(ends > starts)) return { error: 'La hora de fin tiene que ser posterior a la de inicio.' };
        return { artistId, starts, ends };
    }

    // values: lo que devuelve kit.readForm(form, {emptyAsNull: true}).
    // → {payload, starts, ends} o {error}. studio_id solo al crear.
    function bookingPayload(values, opts) {
        const v = values || {};
        const o = opts || {};
        const slot = slotFromValues(v);
        if (slot.error) return { error: slot.error };
        const clientName = cleanLine(v.client_name, 160);
        if (!clientName) return { error: 'Escribí el nombre del cliente.' };
        const email = cleanLine(v.client_email, 200);
        if (email && !EMAIL_RE.test(email)) return { error: 'Revisá el email del cliente.' };
        const amountRaw = toAmount(v.amount);
        const amount = amountRaw == null ? 0 : amountRaw;
        if (!Number.isFinite(amount) || amount < 0) return { error: 'El importe tiene que ser un número mayor o igual a 0.' };
        const deposit = toAmount(v.deposit_amount);
        if (deposit != null && (!Number.isFinite(deposit) || deposit < 0)) return { error: 'La seña tiene que ser un número mayor o igual a 0.' };
        if (deposit != null && amount > 0 && deposit > amount) return { error: 'La seña no puede superar el importe.' };
        const currency = String(v.currency == null ? '' : v.currency).trim().toUpperCase();
        if (!/^[A-Z]{3}$/.test(currency)) return { error: 'Elegí la moneda.' };
        const payload = {
            artist_user_id: slot.artistId,
            location_id: v.location_id ? String(v.location_id) : null,
            client_name: clientName,
            client_email: email || null,
            client_phone: cleanLine(v.client_phone, 40) || null,
            service_description: cleanLine(v.service_description, 500) || null,
            starts_at: slot.starts.toISOString(),
            ends_at: slot.ends.toISOString(),
            amount: round2(amount),
            deposit_amount: deposit == null ? null : round2(deposit),
            currency,
            notes: cleanText(v.notes, 2000) || null
        };
        if (!o.existing) payload.studio_id = o.studioId;
        return { payload, starts: slot.starts, ends: slot.ends };
    }
    function withoutExtras(payload) {
        const copy = Object.assign({}, payload);
        EXTRA_COLUMNS.forEach(key => { delete copy[key]; });
        return copy;
    }
    function hasExtras(payload) {
        return EXTRA_COLUMNS.some(key => payload && payload[key] != null && payload[key] !== '');
    }

    // Respuesta de check_studio_booking_availability → mensaje del modal.
    function interpretAvailability(res, artistName) {
        const who = artistName || 'El artista';
        if (!res) return { state: 'unknown', text: 'No pudimos verificar la disponibilidad.' };
        if (res.error) {
            if (isMissingSchema(res.error)) {
                return {
                    state: 'unknown',
                    text: 'Todavía no podemos consultar la agenda personal del artista (falta aplicar una migración). Al guardar se controla que no choque con otras citas del estudio.'
                };
            }
            return { state: 'unknown', text: 'No pudimos verificar la disponibilidad: ' + friendly(res.error) };
        }
        const data = res.data && typeof res.data === 'object' ? res.data : null;
        if (data && data.available === true) return { state: 'ok', reason: null, text: who + ' está disponible en ese horario.' };
        if (data && data.available === false) {
            const reason = data.reason || null;
            return { state: 'busy', reason, text: who + ' no está disponible: ' + (REASON_TEXT[reason] || 'el horario está ocupado') + '.' };
        }
        return { state: 'unknown', text: 'No pudimos verificar la disponibilidad.' };
    }

    // Defaults de una cita nueva. opts: {date, start, artist, location}.
    function newBookingDefaults(context, opts) {
        const c = context || {};
        const o = opts || {};
        const now = c.now instanceof Date ? c.now : new Date();
        const date = parseYmd(o.date) || (c.anchor instanceof Date ? startOfDay(c.anchor) : startOfDay(now));
        let start = parseHm(o.start);
        if (start == null) {
            if (sameDay(date, now)) start = Math.ceil((now.getHours() * 60 + now.getMinutes() + 1) / SLOT_MINUTES) * SLOT_MINUTES;
            else start = 10 * 60;
        }
        start = Math.min(start, 23 * 60);
        const end = Math.min(start + DEFAULT_DURATION_MIN, 23 * 60 + 59);
        const roster = Array.isArray(c.roster) ? c.roster : [];
        const artistId = o.artist || c.artistId || (roster.length === 1 ? roster[0].id : '');
        const artist = roster.find(a => a.id === artistId) || null;
        const locationId = o.location || c.locationId || (artist && artist.locationId) || c.primaryLocationId || '';
        return {
            artist_user_id: artistId,
            location_id: locationId,
            date: ymd(date),
            start: hm(start),
            end: hm(end),
            client_name: '',
            client_email: '',
            client_phone: '',
            service_description: '',
            amount: '',
            deposit_amount: '',
            currency: c.currency || DEFAULT_CURRENCY,
            notes: ''
        };
    }
    function valuesFromBooking(b) {
        return {
            artist_user_id: b.artist_user_id || '',
            location_id: b.location_id || '',
            date: ymd(new Date(b.startMs)),
            start: hhmmOf(b.startMs),
            end: hhmmOf(b.endMs),
            client_name: b.client_name || '',
            client_email: b.client_email || '',
            client_phone: b.client_phone || '',
            service_description: b.service_description || '',
            amount: b.amount == null ? '' : b.amount,
            deposit_amount: b.deposit_amount == null ? '' : b.deposit_amount,
            currency: b.currency || DEFAULT_CURRENCY,
            notes: b.notes || ''
        };
    }

    // -------------------------------------------------------------
    // Render (HTML puro, todo escapado)
    // -------------------------------------------------------------
    function pct(n) { return Math.round(n * 100000) / 1000; }

    function cardHtml(b, model, opts) {
        const o = opts || {};
        const status = String(b.status || 'confirmed').replace(/[^a-z_]/g, '');
        const time = timeRange(b.startMs, b.endMs, o.dayStartMs, o.dayEndMs);
        // o.artistName: el nombre del roster (el mismo que usan los bloques "Ocupado").
        const artistName = o.artistName || b.artistName;
        const meta = [o.showArtist ? artistName : null, b.service_description || null, o.showLocation && b.locationLabel ? b.locationLabel : null]
            .filter(Boolean).join(' · ');
        const aria = (b.client_name || 'Cliente') + ' con ' + artistName + ', ' + weekdayShort(new Date(b.startMs)) + ' ' + timeRange(b.startMs, b.endMs) + ', ' + statusLabel(b.status);
        return '<button type="button" class="sa-card ' + toneClass(model.tones, b.artist_user_id) + ' is-' + status + '"'
            + ' data-sa-booking="' + escA(b.id) + '" aria-label="' + escA(aria) + '"' + (o.style ? ' style="' + o.style + '"' : '') + '>'
            + '<span class="sa-card__time">' + esc(time) + '</span>'
            + '<strong class="sa-card__client">' + esc(b.client_name || 'Cliente') + '</strong>'
            + (meta ? '<span class="sa-card__meta">' + esc(meta) + '</span>' : '')
            + (status !== 'confirmed' ? statusBadge(b.status) : '')
            + '</button>';
    }

    function busyHtml(block, model, opts) {
        const o = opts || {};
        const time = timeRange(block.startMs, block.endMs, o.dayStartMs, o.dayEndMs);
        const who = o.artistName ? ' · ' + o.artistName : '';
        return '<div class="sa-busy' + (o.artistName ? ' ' + toneClass(model.tones, block.artistId) : '') + '" title="Ocupado"'
            + (o.style ? ' style="' + o.style + '"' : '') + '>'
            + '<span class="sa-busy__label">Ocupado' + esc(who) + '</span>'
            + '<span class="sa-busy__time">' + esc(time) + '</span>'
            + '</div>';
    }

    function noArtistsHtml() {
        const K = kit();
        const body = '<button type="button" class="studio-btn studio-btn-ghost" data-sa-action="roster">Ir al roster</button>';
        return K ? K.emptyState({
            title: 'Todavía no tenés artistas activos',
            body: 'Invitá artistas desde Roster: cuando acepten, vas a poder agendarles citas acá.',
            actionHtml: body
        }) : '<p class="studio-help">Todavía no tenés artistas activos.</p>';
    }

    // model: {range, artists, bookings, busy, tones, nowMs}
    function renderDayView(model) {
        const day = model.range.from;
        const dayStartMs = day.getTime();
        const dayEndMs = addDays(day, 1).getTime();
        const gridStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), GRID_START_HOUR).getTime();
        const gridEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate(), GRID_END_HOUR).getTime();
        const span = gridEnd - gridStart;
        const artists = model.artists || [];
        if (!artists.length) return noArtistsHtml();
        const outside = [];
        const nowMs = model.nowMs;
        const nowLine = nowMs >= gridStart && nowMs < gridEnd
            ? '<span class="sa-day__now" style="top:' + pct((nowMs - gridStart) / span) + '%" aria-hidden="true"></span>' : '';

        const columns = artists.map(artist => {
            const items = [];
            (model.bookings || []).forEach(b => {
                if (b.artist_user_id !== artist.id) return;
                const c = clip(b.startMs, b.endMs, gridStart, gridEnd);
                if (c) items.push({ kind: 'booking', b, startMs: c.startMs, endMs: c.endMs });
                else if (clip(b.startMs, b.endMs, dayStartMs, dayEndMs)) outside.push(b);
            });
            (model.busy || []).forEach(x => {
                if (x.artistId !== artist.id) return;
                const c = clip(x.startMs, x.endMs, gridStart, gridEnd);
                if (c) items.push({ kind: 'busy', x, startMs: c.startMs, endMs: c.endMs });
            });
            const html = assignLanes(items).map(item => {
                const width = 100 / item.lanes;
                const style = 'top:' + pct((item.startMs - gridStart) / span) + '%;height:' + pct((item.endMs - item.startMs) / span) + '%;'
                    + 'left:calc(' + pct(item.lane * width / 100) + '% + 2px);width:calc(' + pct(width / 100) + '% - 4px)';
                return item.kind === 'busy'
                    ? busyHtml(item.x, model, { style, dayStartMs, dayEndMs })
                    : cardHtml(item.b, model, { style, dayStartMs, dayEndMs, showLocation: true });
            }).join('');
            const count = (model.bookings || []).filter(b => b.artist_user_id === artist.id).length;
            return {
                head: '<div class="sa-day__head" role="columnheader">'
                    + '<span class="sa-dot ' + toneClass(model.tones, artist.id) + '" aria-hidden="true"></span>'
                    + '<span class="sa-day__name">' + esc(artist.name) + '</span>'
                    + '<small>' + (artist.inactive ? 'Ya no está activo' : (count === 1 ? '1 cita' : count + ' citas')) + '</small>'
                    + '</div>',
                body: '<div class="sa-day__col" data-sa-col data-sa-artist="' + escA(artist.id) + '" data-sa-date="' + ymd(day) + '"'
                    + ' title="Hacé click en un horario libre para agendar">' + html + nowLine + '</div>'
            };
        });

        const hours = [];
        for (let h = GRID_START_HOUR; h < GRID_END_HOUR; h++) {
            hours.push('<span class="sa-day__hour" style="top:' + pct((h - GRID_START_HOUR) / (GRID_END_HOUR - GRID_START_HOUR)) + '%">' + pad2(h) + ':00</span>');
        }
        const outsideHtml = outside.length
            ? '<p class="sa-day__outside">Fuera de la grilla (' + pad2(GRID_START_HOUR) + '–' + pad2(GRID_END_HOUR) + '): '
                + outside.sort((a, b) => a.startMs - b.startMs).map(b => '<button type="button" class="sa-link" data-sa-booking="' + escA(b.id) + '">'
                    + esc(hhmmOf(b.startMs) + ' · ' + (b.client_name || 'Cliente') + ' · ' + b.artistName) + '</button>').join(' ')
                + '</p>'
            : '';
        return outsideHtml
            + '<div class="sa-day" role="region" aria-label="' + escA('Agenda del ' + longDayLabel(day)) + '">'
            + '<div class="sa-day__scroll"><div class="sa-day__grid" style="--sa-cols:' + artists.length + '">'
            + '<div class="sa-day__corner" aria-hidden="true"></div>'
            + columns.map(c => c.head).join('')
            + '<div class="sa-day__hours" aria-hidden="true">' + hours.join('') + '</div>'
            + columns.map(c => c.body).join('')
            + '</div></div></div>';
    }

    function renderWeekView(model) {
        const nameOf = new Map((model.artists || []).map(a => [a.id, a.name]));
        const nowDate = new Date(model.nowMs);
        return '<div class="sa-week">' + model.range.days.map(day => {
            const ds = day.getTime();
            const de = addDays(day, 1).getTime();
            const entries = [];
            (model.bookings || []).forEach(b => { if (b.startMs < de && b.endMs > ds) entries.push({ kind: 'booking', b, sortMs: Math.max(b.startMs, ds) }); });
            (model.busy || []).forEach(x => { if (x.startMs < de && x.endMs > ds) entries.push({ kind: 'busy', x, sortMs: Math.max(x.startMs, ds) }); });
            entries.sort((a, b) => a.sortMs - b.sortMs || (a.kind === 'busy' ? 1 : 0) - (b.kind === 'busy' ? 1 : 0));
            const today = sameDay(day, nowDate);
            const label = weekdayShort(day);
            const list = entries.length
                ? '<ol class="sa-week__list">' + entries.map(e => '<li>' + (e.kind === 'busy'
                    ? busyHtml(e.x, model, { dayStartMs: ds, dayEndMs: de, artistName: nameOf.get(e.x.artistId) || 'Artista' })
                    : cardHtml(e.b, model, { dayStartMs: ds, dayEndMs: de, showArtist: true, artistName: nameOf.get(e.b.artist_user_id) })) + '</li>').join('') + '</ol>'
                : '<p class="sa-week__empty">Sin citas</p>';
            return '<section class="sa-week__day' + (today ? ' is-today' : '') + '" aria-label="' + escA(WEEKDAYS_LONG[day.getDay()] + ' ' + shortDate(day) + (today ? ' (hoy)' : '')) + '">'
                + '<header class="sa-week__head">'
                + '<button type="button" class="sa-week__goto" data-sa-goto-day="' + ymd(day) + '" aria-label="' + escA('Ver el día ' + label) + '">' + esc(label) + (today ? ' <small>Hoy</small>' : '') + '</button>'
                + '<button type="button" class="sa-week__add" data-sa-new-on="' + ymd(day) + '" aria-label="' + escA('Nueva cita el ' + label) + '"><i class="fa-solid fa-plus" aria-hidden="true"></i></button>'
                + '</header>' + list + '</section>';
        }).join('') + '</div>';
    }

    function listFilterLabel(value) { return value === 'all' ? 'Todas' : statusLabel(value); }

    function rowActionsHtml(b, model) {
        const acts = bookingActions(b, model.nowMs, { m3: model.m3 });
        if (!acts.length) return '<span class="sk-muted">—</span>';
        return '<div class="sk-row-actions">' + acts.map(act => '<button type="button" class="studio-btn'
            + (act === 'cancel' ? ' studio-btn-ghost' : act === 'edit' ? ' studio-btn-ghost' : '')
            + '" data-sa-row-action="' + act + '" data-sa-id="' + escA(b.id) + '">' + esc(ACTION_LABELS[act]) + '</button>').join('') + '</div>';
    }

    function renderListView(model) {
        const K = kit();
        const all = model.bookings || [];
        const filter = LIST_FILTERS.includes(model.listStatus) ? model.listStatus : 'all';
        const rows = filter === 'all' ? all : all.filter(b => b.status === filter);
        const chips = '<div class="sk-chips" role="group" aria-label="Filtrar por estado">' + LIST_FILTERS.map(value => {
            const count = value === 'all' ? all.length : all.filter(b => b.status === value).length;
            return '<button type="button" class="sk-chip" data-sa-status="' + value + '" aria-pressed="' + (filter === value) + '">'
                + esc(listFilterLabel(value)) + ' <span class="sk-chip-count">' + count + '</span></button>';
        }).join('') + '</div>';
        const tools = '<div class="sa-list-tools">' + chips
            + '<button type="button" class="studio-btn studio-btn-ghost sk-btn-sm" data-sa-action="csv"' + (rows.length ? '' : ' disabled') + '>'
            + '<i class="fa-solid fa-file-csv" aria-hidden="true"></i> Exportar CSV</button></div>';
        if (!K) return tools;
        const table = K.renderTable({
            className: 'sa-list-table',
            emptyText: 'No hay citas en este período.',
            rows,
            columns: [
                { label: 'Fecha', render: b => esc(weekdayShort(new Date(b.startMs))) + '<small>' + esc(timeRange(b.startMs, b.endMs)) + '</small>' },
                { label: 'Artista', render: b => '<span class="sa-dot ' + toneClass(model.tones, b.artist_user_id) + '" aria-hidden="true"></span> ' + esc(b.artistName) },
                { label: 'Sede', render: b => (b.locationLabel ? esc(b.locationLabel) : '<span class="sk-muted">Sin sede</span>') },
                {
                    label: 'Cliente',
                    render: b => '<button type="button" class="sa-link" data-sa-booking="' + escA(b.id) + '">' + esc(b.client_name || 'Cliente') + '</button>'
                        + ([b.client_email, b.client_phone].filter(Boolean).length ? '<small>' + esc([b.client_email, b.client_phone].filter(Boolean).join(' · ')) + '</small>' : '')
                },
                { label: 'Servicio', render: b => (b.service_description ? esc(b.service_description) : '<span class="sk-muted">—</span>') },
                {
                    label: 'Importe', align: 'right',
                    render: b => esc(money(b.amount, b.currency))
                        + (b.deposit_amount != null ? '<small>Seña ' + esc(money(b.deposit_amount, b.currency)) + '</small>' : '')
                },
                { label: 'Estado', render: b => statusBadge(b.status) },
                { label: 'Acciones', render: b => rowActionsHtml(b, model) }
            ]
        });
        return tools + table;
    }

    function renderSummary(bookings) {
        const active = (bookings || []).filter(b => b.status === 'confirmed' || b.status === 'completed');
        const confirmed = active.filter(b => b.status === 'confirmed').length;
        const completed = active.length - confirmed;
        if (!active.length) return '<p class="sa-summary">Sin citas confirmadas en este período.</p>';
        const deposits = active.filter(b => b.deposit_amount != null && Number(b.deposit_amount) > 0);
        return '<p class="sa-summary">'
            + '<strong>' + active.length + (active.length === 1 ? ' cita' : ' citas') + '</strong>'
            + ' <span>' + confirmed + (confirmed === 1 ? ' confirmada' : ' confirmadas') + ' · ' + completed + (completed === 1 ? ' completada' : ' completadas') + '</span>'
            + ' <span>Importe acordado: ' + esc(totalsText(active, 'amount')) + '</span>'
            + (deposits.length ? ' <span>Señas: ' + esc(totalsText(deposits, 'deposit_amount')) + '</span>' : '')
            + '</p>';
    }

    function legendHtml(artists, tones, showBusy) {
        if (!artists.length) return '';
        return '<ul class="sa-legend" aria-label="Colores por artista">'
            + artists.map(a => '<li class="sa-legend__item"><span class="sa-dot ' + toneClass(tones, a.id) + '" aria-hidden="true"></span>' + esc(a.name) + '</li>').join('')
            + (showBusy ? '<li class="sa-legend__item"><span class="sa-dot sa-dot--busy" aria-hidden="true"></span>Ocupado en otra agenda</li>' : '')
            + '</ul>';
    }

    function optionList(items, selected, opts) {
        const o = opts || {};
        return (o.empty != null ? '<option value="">' + esc(o.empty) + '</option>' : '')
            + items.map(it => '<option value="' + escA(it.value) + '"' + (String(it.value) === String(selected || '') ? ' selected' : '') + '>' + esc(it.label) + '</option>').join('');
    }

    // ctx: {values, roster, locations, m3, existing}
    function renderBookingForm(context) {
        const K = kit();
        const c = context || {};
        const v = c.values || {};
        const artists = (c.roster || []).map(a => ({ value: a.id, label: a.name }));
        if (c.existing && v.artist_user_id && !artists.some(a => a.value === v.artist_user_id)) {
            artists.push({ value: v.artist_user_id, label: (c.existing.artistName || 'Artista') + ' (ya no está activo)' });
        }
        const locations = (c.locations || []).map(l => ({ value: l.id, label: l.label || 'Sede' }));
        if (c.existing && v.location_id && !locations.some(l => l.value === v.location_id)) {
            locations.push({ value: v.location_id, label: c.existing.locationLabel || 'Sede actual' });
        }
        const extrasOff = c.m3 === false;
        const off = extrasOff ? ' disabled aria-describedby="sa-f-extras-hint"' : '';
        const field = (id, labelText, control, cls) => '<div class="sk-field' + (cls ? ' ' + cls : '') + '"><label for="' + id + '">' + esc(labelText) + '</label>' + control + '</div>';
        return '<div class="sk-grid-2">'
            + field('sa-f-artist', 'Artista', '<select id="sa-f-artist" name="artist_user_id" required>'
                + optionList(artists, v.artist_user_id, { empty: artists.length === 1 && v.artist_user_id ? null : 'Elegí un artista' }) + '</select>')
            + field('sa-f-location', 'Sede', '<select id="sa-f-location" name="location_id">' + optionList(locations, v.location_id, { empty: 'Sin sede' }) + '</select>')
            + field('sa-f-date', 'Fecha', '<input id="sa-f-date" name="date" type="date" required value="' + escA(v.date || '') + '">')
            + '<div class="sa-form__times">'
            + field('sa-f-start', 'Inicio', '<input id="sa-f-start" name="start" type="time" step="900" required value="' + escA(v.start || '') + '">')
            + field('sa-f-end', 'Fin', '<input id="sa-f-end" name="end" type="time" step="900" required value="' + escA(v.end || '') + '">')
            + '</div>'
            + '<p class="sa-availability sk-span-2" data-sa-availability data-state="idle" role="status" aria-live="polite"></p>'
            + '<fieldset class="sa-form__group sk-span-2"><legend>Cliente</legend><div class="sk-grid-2">'
            + field('sa-f-client', 'Nombre', '<input id="sa-f-client" name="client_name" type="text" required maxlength="160" autocomplete="off" value="' + escA(v.client_name || '') + '">', 'sk-span-2')
            + field('sa-f-email', 'Email', '<input id="sa-f-email" name="client_email" type="email" maxlength="200" autocomplete="off" value="' + escA(v.client_email || '') + '">')
            + field('sa-f-phone', 'Teléfono', '<input id="sa-f-phone" name="client_phone" type="tel" maxlength="40" autocomplete="off" value="' + escA(v.client_phone || '') + '"' + off + '>')
            + '</div></fieldset>'
            + field('sa-f-service', 'Servicio', '<input id="sa-f-service" name="service_description" type="text" maxlength="500" placeholder="Ej.: fine line en antebrazo, 1 sesión" value="' + escA(v.service_description || '') + '"' + off + '>', 'sk-span-2')
            + '<div class="sa-form__money sk-span-2">'
            + field('sa-f-amount', 'Importe acordado', '<input id="sa-f-amount" name="amount" type="number" min="0" step="0.01" inputmode="decimal" value="' + escA(v.amount == null ? '' : v.amount) + '">')
            + field('sa-f-deposit', 'Seña', '<input id="sa-f-deposit" name="deposit_amount" type="number" min="0" step="0.01" inputmode="decimal" value="' + escA(v.deposit_amount == null ? '' : v.deposit_amount) + '"' + off + '>')
            + field('sa-f-currency', 'Moneda', '<select id="sa-f-currency" name="currency" required>' + (K ? K.currencyOptionsHtml(v.currency || DEFAULT_CURRENCY) : '<option>' + esc(v.currency || DEFAULT_CURRENCY) + '</option>') + '</select>')
            + '</div>'
            + (extrasOff ? '<p class="studio-help sk-span-2" id="sa-f-extras-hint">Teléfono, servicio y seña se habilitan cuando se aplique la migración de agenda.</p>' : '')
            + field('sa-f-notes', 'Notas', '<textarea id="sa-f-notes" name="notes" maxlength="2000">' + esc(v.notes || '') + '</textarea>', 'sk-span-2')
            + '</div>';
    }

    function renderBookingDetail(b) {
        const start = new Date(b.startMs);
        const contact = [b.client_email, b.client_phone].filter(Boolean).join(' · ');
        const row = (term, valueHtml) => '<div><dt>' + esc(term) + '</dt><dd>' + valueHtml + '</dd></div>';
        let amountHtml = esc(money(b.amount, b.currency));
        if (b.deposit_amount != null) amountHtml += ' · Seña ' + esc(money(b.deposit_amount, b.currency));
        return '<dl class="sa-detail">'
            + row('Estado', statusBadge(b.status))
            + row('Fecha', esc(longDayLabel(start)) + '<br><small>' + esc(timeRange(b.startMs, b.endMs)) + '</small>')
            + row('Artista', esc(b.artistName))
            + row('Sede', b.locationLabel ? esc(b.locationLabel) : '<span class="sk-muted">Sin sede</span>')
            + row('Cliente', esc(b.client_name || 'Cliente') + (contact ? '<br><small>' + esc(contact) + '</small>' : ''))
            + (b.service_description ? row('Servicio', esc(b.service_description)) : '')
            + row('Importe', amountHtml)
            + (b.notes ? row('Notas', '<span class="sa-detail__notes">' + esc(b.notes) + '</span>') : '')
            + (b.created_by_role === 'support' ? row('Cargada por', 'Soporte') : '')
            + '</dl>'
            + (b.status === 'confirmed' && b.startMs > Date.now()
                ? '<p class="studio-help">Vas a poder completarla o marcar que el cliente no asistió cuando empiece.</p>' : '')
            + (b.status === 'completed' ? '<p class="studio-help">El trabajo quedó registrado en Operaciones.</p>' : '');
    }

    function csvColumns() {
        return [
            { label: 'Fecha', value: b => ymd(new Date(b.startMs)) },
            { label: 'Inicio', value: b => hhmmOf(b.startMs) },
            { label: 'Fin', value: b => hhmmOf(b.endMs) },
            { label: 'Artista', value: b => b.artistName },
            { label: 'Sede', value: b => b.locationLabel || '' },
            { label: 'Cliente', value: b => b.client_name || '' },
            { label: 'Email', value: b => b.client_email || '' },
            { label: 'Teléfono', value: b => b.client_phone || '' },
            { label: 'Servicio', value: b => b.service_description || '' },
            { label: 'Importe', value: b => (b.amount == null ? null : Number(b.amount)) },
            { label: 'Seña', value: b => (b.deposit_amount == null ? null : Number(b.deposit_amount)) },
            { label: 'Moneda', value: b => b.currency || '' },
            { label: 'Estado', value: b => statusLabel(b.status) },
            { label: 'Notas', value: b => b.notes || '' }
        ];
    }

    // -------------------------------------------------------------
    // Acciones (escriben vía StudioOps; nunca lanzan sin pasar por el kit)
    // -------------------------------------------------------------
    function emitJobsChanged(detail) {
        if (typeof document === 'undefined' || !document || typeof document.dispatchEvent !== 'function' || typeof CustomEvent !== 'function') return false;
        document.dispatchEvent(new CustomEvent('weotzi:studio-jobs-changed', { detail }));
        return true;
    }

    // "No asistió" sin M3 viola el CHECK de status: se avisa como migración pendiente.
    // Siempre devuelve un Error (con .code intacto) para que el modal y los
    // tests lean el mensaje; un {code, message} de PostgREST no lo es.
    function actionError(err) {
        if (errorCode(err) === '23514' && /studio_bookings_status_check/.test(String((err && err.message) || ''))) {
            return new Error(missingMessage());
        }
        if (err instanceof Error || (err && typeof err.message === 'string' && typeof err.stack === 'string')) return err;
        const src = err && typeof err === 'object' ? err : { message: String(err || '') };
        const error = new Error(src.message || src.details || 'No pudimos guardar la cita.');
        ['code', 'details', 'hint', 'status'].forEach(k => { if (src[k] != null) error[k] = src[k]; });
        error.original = src;
        return error;
    }

    // env: {ctx, data, kit}
    function createActions(env) {
        const ops = () => (env.data && env.data.StudioOps) || {};
        const K = () => env.kit || kit();
        const toast = (msg, tone) => { const k = K(); if (k && typeof k.toast === 'function') k.toast(msg, tone); };
        const notify = async payload => {
            try {
                const res = env.ctx && typeof env.ctx.notify === 'function' ? await env.ctx.notify(payload) : null;
                return !!(res && res.ok);
            } catch (_) {
                return false;
            }
        };
        const describe = b => (b.client_name || 'Cliente') + ' con ' + b.artistName + ' (' + weekdayShort(new Date(b.startMs)) + ' ' + timeRange(b.startMs, b.endMs) + ')';

        return {
            // Crea o edita. Sin M3 (o ante PGRST204/42703) reintenta sin
            // teléfono, servicio y seña. → {row, degraded, notified}
            async save(existing, payload, opts) {
                const o = opts || {};
                const repo = ops();
                if (typeof repo.saveBooking !== 'function') throw new Error('No pudimos conectar con la agenda del estudio.');
                const id = existing ? existing.id : null;
                let body = o.m3 === false ? withoutExtras(payload) : payload;
                let degraded = o.m3 === false && hasExtras(payload);
                let res = await settle(() => repo.saveBooking(id, body));
                if (res.error && isMissingColumn(res.error) && EXTRA_COLUMNS.some(key => key in body)) {
                    degraded = hasExtras(body);
                    body = withoutExtras(body);
                    res = await settle(() => repo.saveBooking(id, body));
                }
                if (res.error) throw actionError(res.error);
                const row = res.data || null;
                let notified = Promise.resolve(null);
                if (!existing && row && row.id) {
                    notified = notify({ kind: 'booking_created', booking_id: row.id }).then(ok => {
                        if (!ok) toast('La cita quedó agendada, pero no pudimos avisarle al artista por email.', 'warning');
                        return ok;
                    });
                }
                return { row, degraded, notified };
            },

            async cancel(b) {
                const k = K();
                const ok = await k.confirmDialog({
                    title: '¿Cancelar la cita?',
                    body: '<p class="sk-overlay__text">' + esc('Se cancela la cita de ' + describe(b) + ' y el horario vuelve a quedar libre. Le avisamos al artista por email.') + '</p>',
                    confirmLabel: 'Cancelar cita',
                    cancelLabel: 'Volver',
                    tone: 'danger'
                });
                if (!ok) return false;
                const res = await settle(() => ops().saveBooking(b.id, { status: 'cancelled' }));
                if (res.error) throw actionError(res.error);
                const sent = await notify({ kind: 'booking_cancelled', booking_id: b.id });
                toast(sent ? 'Cita cancelada. Le avisamos al artista.' : 'Cita cancelada. No pudimos avisarle al artista por email.', sent ? 'success' : 'warning');
                return true;
            },

            async noShow(b) {
                const k = K();
                const ok = await k.confirmDialog({
                    title: '¿Marcar que el cliente no asistió?',
                    body: '<p class="sk-overlay__text">' + esc('La cita de ' + describe(b) + ' queda como «No asistió» y no se registra trabajo.') + '</p>',
                    confirmLabel: 'Marcar no asistió'
                });
                if (!ok) return false;
                const res = await settle(() => ops().saveBooking(b.id, { status: 'no_show' }));
                if (res.error) throw actionError(res.error);
                toast('La cita quedó marcada como «No asistió».', 'success');
                return true;
            },

            async complete(b) {
                const k = K();
                const ok = await k.confirmDialog({
                    title: '¿Completar la cita?',
                    body: '<p class="sk-overlay__text">' + esc('¿El trabajo de ' + describe(b) + ' ya se realizó? Se agrega al registro de trabajos del estudio con el reparto del contrato vigente.') + '</p>',
                    confirmLabel: 'Completar'
                });
                if (!ok) return false;
                const repo = ops();
                if (typeof repo.completeBooking !== 'function') throw new Error('No pudimos conectar con la agenda del estudio.');
                const res = await settle(() => repo.completeBooking(b.id));
                if (res.error) throw actionError(res.error);
                emitJobsChanged({
                    studioId: env.ctx && env.ctx.studioId,
                    bookingId: b.id,
                    jobId: (res.data && res.data.job_log_id) || null
                });
                toast('Cita completada: el trabajo quedó registrado en Operaciones.', 'success');
                return true;
            }
        };
    }

    // -------------------------------------------------------------
    // Controlador de la pestaña
    // -------------------------------------------------------------
    function readStoredView() {
        try {
            const value = window.localStorage ? window.localStorage.getItem(STORAGE_KEY) : null;
            return VIEWS.includes(value) ? value : null;
        } catch (_) {
            return null;
        }
    }
    function storeView(view) {
        try { if (window.localStorage) window.localStorage.setItem(STORAGE_KEY, view); } catch (_) { /* preferencia opcional */ }
    }

    function skeletonHtml() {
        return '<div class="sa-agenda">'
            + '<div class="sk-toolbar sa-toolbar">'
            + '<div class="sk-subtabs sa-views" role="group" aria-label="Vista de la agenda">'
            + VIEWS.map(v => '<button type="button" data-sa-view="' + v + '" aria-pressed="false">' + VIEW_LABELS[v] + '</button>').join('')
            + '</div>'
            + '<div class="sa-nav" role="group" aria-label="Navegar fechas">'
            + '<button type="button" class="studio-btn studio-btn-ghost sa-nav__btn" data-sa-nav="prev" aria-label="Período anterior"><i class="fa-solid fa-chevron-left" aria-hidden="true"></i></button>'
            + '<button type="button" class="studio-btn studio-btn-ghost" data-sa-nav="today">Hoy</button>'
            + '<button type="button" class="studio-btn studio-btn-ghost sa-nav__btn" data-sa-nav="next" aria-label="Período siguiente"><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>'
            + '<input type="date" class="studio-input sa-nav__date" data-sa-date aria-label="Ir a la fecha">'
            + '</div>'
            + '<div class="sk-field sa-filter"><label for="sa-filter-artist">Artista</label><select id="sa-filter-artist" data-sa-filter="artist"></select></div>'
            + '<div class="sk-field sa-filter" data-sa-location-filter hidden><label for="sa-filter-location">Sede</label><select id="sa-filter-location" data-sa-filter="location"></select></div>'
            + '<span class="sk-toolbar-spacer"></span>'
            + '<button type="button" class="studio-btn studio-btn-primary" data-sa-action="new"><i class="fa-solid fa-plus" aria-hidden="true"></i> Nueva cita</button>'
            + '</div>'
            + '<p class="sa-range" data-sa-range aria-live="polite"></p>'
            + '<div data-sa-legend></div>'
            + '<p class="studio-help sa-note" data-sa-note hidden></p>'
            + '<div data-sa-summary></div>'
            + '<div class="sa-body" data-sa-body><p class="studio-help">Cargando agenda…</p></div>'
            + '</div>';
    }

    function createAgenda(root, ctx) {
        const D = ctx.data || window.WeotziData || {};
        const ops = () => D.StudioOps || {};
        const state = {
            view: readStoredView() || 'day',
            anchor: startOfDay(new Date()),
            artistId: '',
            locationId: '',
            listStatus: 'all',
            roster: [],
            locations: [],
            bookings: [],
            busy: [],
            busyUnavailable: false,
            busyError: null,
            bookingsError: null,
            metaError: null,
            m3: null,
            range: null,
            loaded: false,
            seq: 0
        };
        const actions = createActions({ ctx, data: D, get kit() { return kit(); } });

        root.innerHTML = skeletonHtml();
        const q = sel => root.querySelector(sel);
        const els = {
            body: q('[data-sa-body]'),
            range: q('[data-sa-range]'),
            legend: q('[data-sa-legend]'),
            note: q('[data-sa-note]'),
            summary: q('[data-sa-summary]'),
            date: q('[data-sa-date]'),
            artist: q('[data-sa-filter="artist"]'),
            location: q('[data-sa-filter="location"]'),
            locationWrap: q('[data-sa-location-filter]')
        };

        // ---------- datos ----------
        async function loadMeta() {
            const memberships = D.StudioMemberships || {};
            const places = D.StudioLocations || {};
            const [rosterRes, locRes] = await Promise.all([
                typeof memberships.listActiveRosterWithArtists === 'function'
                    ? settle(() => memberships.listActiveRosterWithArtists(ctx.studioId))
                    : typeof memberships.listActiveArtists === 'function'
                        ? settle(() => memberships.listActiveArtists(ctx.studioId, { withRole: true }))
                        : Promise.resolve({ data: [], error: null }),
                typeof places.listActiveByStudio === 'function'
                    ? settle(() => places.listActiveByStudio(ctx.studioId, 'id, label, is_primary'))
                    : Promise.resolve({ data: [], error: null })
            ]);
            state.metaError = rosterRes.error || null;
            if (!rosterRes.error) state.roster = normalizeRoster(rosterRes.data);
            if (!locRes.error) state.locations = (locRes.data || []).filter(l => l && l.id);
            if (state.locationId && !state.locations.some(l => l.id === state.locationId)) state.locationId = '';
        }

        async function loadRange() {
            const seq = ++state.seq;
            const range = rangeFor(state.view, state.anchor);
            state.range = range;
            renderChrome();
            // La primera carga muestra el aviso; las siguientes atenúan lo que
            // ya está en pantalla hasta que llegan los datos nuevos.
            if (state.loaded) els.body.classList.add('is-loading');
            else els.body.innerHTML = '<p class="studio-help sa-loading" role="status">Cargando agenda…</p>';
            els.body.setAttribute('aria-busy', 'true');
            const repo = ops();
            const fromIso = range.from.toISOString();
            const toIso = range.to.toISOString();
            const wantBusy = range.view !== 'list' && typeof repo.listArtistBusyBlocks === 'function';
            const [bookingsRes, busyRes] = await Promise.all([
                typeof repo.listBookingsRange === 'function'
                    ? settle(() => repo.listBookingsRange(ctx.studioId, fromIso, toIso))
                    : typeof repo.listBookings === 'function'
                        ? settle(() => repo.listBookings(ctx.studioId, fromIso, toIso))
                        : Promise.resolve({ data: null, error: new Error('No pudimos conectar con la agenda del estudio.') }),
                wantBusy ? settle(() => repo.listArtistBusyBlocks(ctx.studioId, fromIso, toIso)) : Promise.resolve(null)
            ]);
            if (seq !== state.seq) return false;
            state.bookingsError = bookingsRes.error || null;
            state.bookings = bookingsRes.error ? [] : (bookingsRes.data || []).map(normalizeBooking).filter(Boolean);
            if (busyRes) {
                state.busyUnavailable = !!busyRes.unavailable;
                state.busyError = busyRes.error && !isMissingSchema(busyRes.error) ? busyRes.error : null;
                state.busy = busyRes.error ? [] : mergeBusy(busyRes.data);
                if (busyRes.unavailable || (busyRes.error && isMissingSchema(busyRes.error))) state.m3 = false;
                else if (!busyRes.error) state.m3 = true;
            } else {
                state.busy = [];
                state.busyError = null;
            }
            // Sin bloques (Lista), las columnas de M3 delatan si la migración está.
            if (state.m3 == null && (bookingsRes.data || []).length) state.m3 = Object.prototype.hasOwnProperty.call(bookingsRes.data[0], 'created_by_role');
            return true;
        }

        async function refresh() {
            const [, fresh] = await Promise.all([loadMeta(), loadRange()]);
            if (fresh !== false) render();
            return fresh !== false;
        }
        async function refreshRange() {
            const fresh = await loadRange();
            if (fresh !== false) render();
            return fresh !== false;
        }

        // ---------- render ----------
        function model() {
            const filters = { artistId: state.artistId, locationId: state.locationId };
            const statuses = state.view === 'list' ? null : GRID_STATUSES;
            const bookings = filterBookings(state.bookings, Object.assign({ statuses }, filters));
            const tones = toneMap(state.roster, state.bookings);
            const artists = visibleArtists(state.roster, filterBookings(state.bookings, { statuses: GRID_STATUSES }), filters);
            const shown = new Set(artists.map(a => a.id));
            return {
                range: state.range || rangeFor(state.view, state.anchor),
                artists,
                bookings,
                busy: state.busy.filter(x => shown.has(x.artistId)),
                tones,
                nowMs: Date.now(),
                m3: state.m3,
                listStatus: state.listStatus
            };
        }

        function renderChrome() {
            root.querySelectorAll('[data-sa-view]').forEach(btn => btn.setAttribute('aria-pressed', String(btn.getAttribute('data-sa-view') === state.view)));
            const range = state.range || rangeFor(state.view, state.anchor);
            els.range.textContent = rangeLabel(range);
            els.date.value = ymd(state.anchor);
        }

        function renderFilters() {
            const artistItems = state.roster.map(a => ({ value: a.id, label: a.name }));
            if (state.artistId && !artistItems.some(a => a.value === state.artistId)) state.artistId = '';
            els.artist.innerHTML = optionList(artistItems, state.artistId, { empty: 'Todos los artistas' });
            const showLocations = state.locations.length > 1;
            els.locationWrap.hidden = !showLocations;
            if (!showLocations) state.locationId = '';
            els.location.innerHTML = optionList(state.locations.map(l => ({ value: l.id, label: l.label || 'Sede' })), state.locationId, { empty: 'Todas las sedes' });
        }

        function renderNote() {
            let text = '';
            if (state.view !== 'list' && state.busyUnavailable) {
                text = 'Todavía no vemos la agenda personal de los artistas: los bloques «Ocupado» y el chequeo de disponibilidad se activan cuando se aplique la migración de agenda.';
            } else if (state.view !== 'list' && state.busyError) {
                text = 'No pudimos cargar los horarios ocupados de los artistas: ' + friendly(state.busyError);
            } else if (state.metaError) {
                text = 'No pudimos cargar el roster: ' + friendly(state.metaError);
            }
            els.note.textContent = text;
            els.note.hidden = !text;
        }

        function render() {
            state.loaded = true;
            els.body.classList.remove('is-loading');
            els.body.removeAttribute('aria-busy');
            renderChrome();
            renderFilters();
            renderNote();
            if (state.bookingsError) {
                els.legend.innerHTML = '';
                els.summary.innerHTML = '';
                els.body.innerHTML = '<div class="studio-status studio-status-error sa-error" role="alert">'
                    + esc('No pudimos cargar la agenda: ' + friendly(state.bookingsError))
                    + ' <button type="button" class="studio-btn studio-btn-ghost sk-btn-sm" data-sa-action="retry">Reintentar</button></div>';
                return;
            }
            const m = model();
            els.legend.innerHTML = state.view === 'list' ? '' : legendHtml(m.artists, m.tones, m.busy.length > 0);
            els.summary.innerHTML = renderSummary(m.bookings);
            if (!state.roster.length && !state.bookings.length) {
                els.body.innerHTML = noArtistsHtml();
                return;
            }
            if (state.view === 'week') els.body.innerHTML = renderWeekView(m);
            else if (state.view === 'list') els.body.innerHTML = renderListView(m);
            else els.body.innerHTML = renderDayView(m);
        }

        // ---------- navegación ----------
        function setView(view) {
            if (!VIEWS.includes(view) || view === state.view) return;
            state.view = view;
            storeView(view);
            refreshRange();
        }
        function goTo(date) {
            const d = date instanceof Date ? date : parseYmd(date);
            if (!d) return;
            state.anchor = startOfDay(d);
            refreshRange();
        }

        function applyParams(params) {
            const p = params || {};
            if (VIEWS.includes(p.view)) { state.view = p.view; storeView(p.view); }
            const date = parseYmd(p.date || p.fecha);
            if (date) state.anchor = date;
            if (typeof p.artist === 'string') state.artistId = p.artist;
            const location = p.location || p.sede;
            if (typeof location === 'string') state.locationId = location;
        }

        function findBooking(id) { return state.bookings.find(b => String(b.id) === String(id)) || null; }

        // ---------- modal de cita ----------
        function openEditor(existing, opts) {
            const K = kit();
            if (!K) return;
            if (!existing && !state.roster.length) {
                K.toast('Primero sumá artistas activos al roster para agendarles citas.', 'warning');
                return;
            }
            const latest = state.bookings.slice().sort((a, b) => b.startMs - a.startMs)[0];
            const values = existing ? valuesFromBooking(existing) : newBookingDefaults({
                now: new Date(),
                anchor: state.anchor,
                roster: state.roster,
                artistId: state.artistId,
                locationId: state.locationId,
                primaryLocationId: ctx.studio && ctx.studio.primary_location_id,
                currency: latest && latest.currency
            }, opts);
            const form = document.createElement('form');
            form.className = 'sa-form';
            form.noValidate = true;
            form.innerHTML = renderBookingForm({ values, roster: state.roster, locations: state.locations, m3: state.m3, existing });
            const avEl = form.querySelector('[data-sa-availability]');
            const field = name => form.querySelector('[name="' + name + '"]');
            let locationTouched = !!existing || !!(opts && opts.location);
            let checkSeq = 0;

            const setAvailability = info => {
                const st = info && info.state ? info.state : 'idle';
                avEl.setAttribute('data-state', st);
                avEl.textContent = (info && info.text) || '';
            };
            const artistNameFor = id => {
                const a = state.roster.find(x => x.id === id);
                return a ? a.name : (existing && existing.artist_user_id === id ? existing.artistName : 'El artista');
            };
            const checkSlot = async slot => {
                const repo = ops();
                if (typeof repo.checkBookingAvailability !== 'function') return interpretAvailability({ error: { code: '42883' } });
                const res = await settle(() => repo.checkBookingAvailability(ctx.studioId, slot.artistId, slot.starts.toISOString(), slot.ends.toISOString(), existing ? existing.id : null));
                return interpretAvailability(res, artistNameFor(slot.artistId));
            };
            const runCheck = async () => {
                const slot = slotFromValues(K.readForm(form, { emptyAsNull: true }));
                const token = ++checkSeq;
                if (slot.error) { setAvailability(null); return null; }
                setAvailability({ state: 'checking', text: 'Verificando disponibilidad…' });
                const info = await checkSlot(slot);
                if (token !== checkSeq) return null;
                setAvailability(info);
                return info;
            };
            const check = K.debounce(runCheck, AVAILABILITY_DEBOUNCE_MS);

            form.addEventListener('change', event => {
                const name = event.target && event.target.name;
                if (name === 'location_id') locationTouched = true;
                if (name === 'artist_user_id' && !locationTouched) {
                    const a = state.roster.find(x => x.id === event.target.value);
                    const sel = field('location_id');
                    if (a && a.locationId && sel && Array.from(sel.options || []).some(o => o.value === a.locationId)) sel.value = a.locationId;
                }
                if (name === 'start') {
                    const s = parseHm(field('start').value);
                    const e = parseHm(field('end').value);
                    if (s != null && (e == null || e <= s)) field('end').value = hm(Math.min(s + DEFAULT_DURATION_MIN, 23 * 60 + 59));
                }
                if (['artist_user_id', 'date', 'start', 'end'].includes(name)) check();
            });
            form.addEventListener('input', event => {
                const name = event.target && event.target.name;
                if (['date', 'start', 'end'].includes(name)) check();
            });

            let modal = null;
            const submit = async m => {
                const parsed = bookingPayload(K.readForm(form, { emptyAsNull: true }), { studioId: ctx.studioId, existing });
                if (parsed.error) { m.setError(parsed.error); return false; }
                check.cancel();
                const token = ++checkSeq;
                setAvailability({ state: 'checking', text: 'Verificando disponibilidad…' });
                const info = await checkSlot({ artistId: parsed.payload.artist_user_id, starts: parsed.starts, ends: parsed.ends });
                if (token === checkSeq) setAvailability(info);
                if (info.state === 'busy') { m.setError(info.text); return false; }
                const result = await actions.save(existing, parsed.payload, { m3: state.m3 });
                if (result.degraded) K.toast('La cita se guardó sin teléfono, servicio ni seña: falta aplicar la migración de agenda.', 'warning');
                else K.toast(existing ? 'Cita actualizada.' : 'Cita agendada.', 'success');
                if (parsed.starts < state.range.from || parsed.starts >= state.range.to) state.anchor = startOfDay(parsed.starts);
                refreshRange();
                return true;
            };
            form.addEventListener('submit', event => {
                event.preventDefault();
                const btn = modal && modal.footer && modal.footer.lastChild;
                if (btn && typeof btn.click === 'function') btn.click();
            });

            modal = K.openModal({
                title: existing ? 'Editar cita' : 'Nueva cita',
                body: form,
                size: 'lg',
                className: 'sa-booking-modal',
                actions: [
                    { label: 'Cerrar', variant: 'ghost', value: null },
                    { label: existing ? 'Guardar cambios' : 'Agendar cita', variant: 'primary', onClick: submit }
                ],
                onClose: () => { check.cancel(); checkSeq++; }
            });
            if (values.artist_user_id) runCheck();
            return modal;
        }

        function openDetail(b) {
            const K = kit();
            if (!K || !b) return;
            const acts = bookingActions(b, Date.now(), { m3: state.m3 });
            const buttons = [{ label: 'Cerrar', variant: 'ghost', value: null }];
            if (b.status === 'completed') buttons.push({ label: 'Ver en Operaciones', value: 'ops' });
            if (acts.includes('cancel')) buttons.push({ label: 'Cancelar cita', variant: 'danger', value: 'cancel' });
            if (acts.includes('no_show')) buttons.push({ label: 'No asistió', value: 'no_show' });
            if (acts.includes('complete')) buttons.push({ label: 'Completar', value: 'complete' });
            if (acts.includes('edit')) buttons.push({ label: 'Editar', variant: 'primary', value: 'edit' });
            const m = K.openModal({
                title: 'Cita de ' + (b.client_name || 'Cliente'),
                body: renderBookingDetail(b),
                size: 'md',
                className: 'sa-detail-modal',
                closeOnBackdrop: true,
                actions: buttons
            });
            m.closed.then(choice => runAction(choice, b, null));
        }

        function runAction(choice, b, btn) {
            const K = kit();
            if (!choice || !b || !K) return null;
            if (choice === 'edit') return openEditor(b);
            if (choice === 'ops') return ctx.navigate ? ctx.navigate('ops') : null;
            const fn = { cancel: actions.cancel, no_show: actions.noShow, complete: actions.complete }[choice];
            if (!fn) return null;
            return K.guarded(btn, async () => {
                const done = await fn(b);
                if (done) await refreshRange();
                return done;
            });
        }

        // ---------- eventos (delegados) ----------
        root.addEventListener('click', event => {
            const t = event.target;
            if (!t || typeof t.closest !== 'function') return;
            const K = kit();
            const view = t.closest('[data-sa-view]');
            if (view) { setView(view.getAttribute('data-sa-view')); return; }
            const nav = t.closest('[data-sa-nav]');
            if (nav) {
                const dir = nav.getAttribute('data-sa-nav');
                if (dir === 'today') goTo(new Date());
                else goTo(shiftAnchor(state.view, state.anchor, dir === 'prev' ? -1 : 1));
                return;
            }
            const booking = t.closest('[data-sa-booking]');
            if (booking) { openDetail(findBooking(booking.getAttribute('data-sa-booking'))); return; }
            const rowAction = t.closest('[data-sa-row-action]');
            if (rowAction) { runAction(rowAction.getAttribute('data-sa-row-action'), findBooking(rowAction.getAttribute('data-sa-id')), rowAction); return; }
            const gotoDay = t.closest('[data-sa-goto-day]');
            if (gotoDay) {
                state.view = 'day';
                storeView('day');
                goTo(gotoDay.getAttribute('data-sa-goto-day'));
                return;
            }
            const newOn = t.closest('[data-sa-new-on]');
            if (newOn) { openEditor(null, { date: newOn.getAttribute('data-sa-new-on') }); return; }
            const status = t.closest('[data-sa-status]');
            if (status) { state.listStatus = status.getAttribute('data-sa-status'); render(); return; }
            const action = t.closest('[data-sa-action]');
            if (action) {
                const name = action.getAttribute('data-sa-action');
                if (name === 'new') openEditor(null, {});
                else if (name === 'retry') K.guarded(action, () => refresh());
                else if (name === 'roster' && ctx.navigate) ctx.navigate('roster');
                else if (name === 'csv' && K) {
                    const m = model();
                    const rows = m.listStatus === 'all' ? m.bookings : m.bookings.filter(b => b.status === m.listStatus);
                    K.downloadCsv('agenda-' + ymd(m.range.from) + '-' + ymd(addDays(m.range.to, -1)), csvColumns(), rows);
                }
                return;
            }
            // Click en un horario libre de la vista Día: nueva cita en ese tramo.
            const col = t.closest('[data-sa-col]');
            if (col && !t.closest('.sa-busy') && typeof col.getBoundingClientRect === 'function') {
                const rect = col.getBoundingClientRect();
                if (!rect || !rect.height) return;
                const ratio = Math.max(0, Math.min(0.9999, (event.clientY - rect.top) / rect.height));
                const minutes = GRID_START_HOUR * 60 + Math.floor(ratio * (GRID_END_HOUR - GRID_START_HOUR) * 60 / SLOT_MINUTES) * SLOT_MINUTES;
                openEditor(null, { artist: col.getAttribute('data-sa-artist'), date: col.getAttribute('data-sa-date'), start: hm(minutes) });
            }
        });
        root.addEventListener('change', event => {
            const t = event.target;
            if (!t) return;
            if (t.hasAttribute && t.hasAttribute('data-sa-date')) { goTo(t.value); return; }
            const filter = t.getAttribute && t.getAttribute('data-sa-filter');
            if (filter === 'artist') { state.artistId = t.value || ''; render(); }
            else if (filter === 'location') { state.locationId = t.value || ''; render(); }
        });

        renderChrome();

        return {
            async show(params) {
                const p = params || {};
                applyParams(p);
                await refresh();
                if (p.booking) {
                    const b = findBooking(p.booking);
                    if (b) openDetail(b);
                    else if (kit()) kit().toast('No encontramos esa cita en el período visible.', 'warning');
                } else if (p.new || p.nueva) {
                    openEditor(null, { date: p.date || p.fecha, artist: p.artist, start: p.start });
                }
            },
            refresh,
            state
        };
    }

    // -------------------------------------------------------------
    // Registro en el shell
    // -------------------------------------------------------------
    const admin = window.WeOtziStudioAdmin;
    if (!admin || typeof admin.register !== 'function') {
        console.warn('[studio-agenda] falta el registro del panel (WeOtziStudioAdmin).');
        return;
    }
    let agenda = null;
    admin.register(TAB, {
        mount(root, ctx) { agenda = createAgenda(root, ctx); },
        show(root, ctx, params) {
            if (!agenda) agenda = createAgenda(root, ctx);
            return agenda.show(params);
        }
    });
})();
