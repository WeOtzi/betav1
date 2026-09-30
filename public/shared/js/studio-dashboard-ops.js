// ============================================
// Studio Dashboard — Operations / Inventory / Suppliers / Sponsors / Analytics
// (Phases D, E, F).
//
// Companion to studio-dashboard.js. Designed to be loaded AFTER it so that
// `window.studio` and `window._supabase` exist.
//
// Each panel follows the same shape:
//   1. wireXxxPanel()  — boots the buttons + initial list
//   2. renderXxxList() — fetches and paints the table
//   3. openXxxEditor() — inline drawer for create/edit
//   4. saveXxx()       — upserts via Supabase
// ============================================

(function () {
    'use strict';

    function whenReady(cb) {
        const start = async () => {
            const auth = window.WeOtziStudioAuth;
            if (!auth) return;
            try {
                const studio = auth.getCurrent() || await auth.check();
                if (studio) cb(auth.getSupabase(), studio);
            } catch (error) { status('ops-status', 'error', error.message || 'No pudimos cargar el estudio.'); }
        };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
        else start();
    }

    whenReady((supabase, studio) => {
        wireBookingPanel(supabase, studio);
        wireOpsSubnav();
        wireJobsPanel(supabase, studio);
        wireClientsPanel(supabase, studio);
        wireInvoicesPanel(supabase, studio);
        wireDocumentsPanel(supabase, studio);
        wireInventoryPanel(supabase, studio);
        wireSuppliersPanel(supabase, studio);
        wireSponsorsPanel(supabase, studio);
        wireAnalyticsPanel(supabase, studio);
        document.querySelector('[data-tab="analytics"]')?.addEventListener('click', () => wireAnalyticsPanel(supabase, studio));
        document.querySelector('[data-sub="clients"]')?.addEventListener('click', () => renderClientsList(supabase, studio));
    });

    // -------------------------------------------------------------
    // Common helpers
    // -------------------------------------------------------------
    function escapeHtml(v) {
        return String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function escapeAttr(v) { return escapeHtml(v); }
    function status(elId, kind, msg) {
        const el = document.getElementById(elId);
        if (!el) return;
        el.className = 'studio-status studio-status-' + kind;
        el.textContent = msg;
        el.hidden = false;
        setTimeout(() => { el.hidden = true; }, 5000);
    }
    function fmtMoney(amount, currency) {
        if (amount == null) return '—';
        try {
            return new Intl.NumberFormat('es-AR', { style: 'currency', currency: (currency || 'USD').toUpperCase() }).format(amount);
        } catch { return escapeHtml(`${currency || 'USD'} ${amount}`); }
    }
    function calendarDate(d) {
        // SQL date values are calendar dates, not UTC instants.
        return /^\d{4}-\d{2}-\d{2}$/.test(String(d)) ? new Date(String(d) + 'T12:00:00') : new Date(d);
    }
    function fmtDate(d) { return d ? calendarDate(d).toLocaleDateString('es-AR') : '—'; }
    function localDateTime(value) {
        const date = new Date(value || Date.now());
        return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    }
    function sumCurrencies(rows, amountField, currencyField = 'currency') {
        const totals = new Map();
        rows.forEach(row => {
            const currency = (row[currencyField] || 'USD').toUpperCase();
            totals.set(currency, (totals.get(currency) || 0) + Number(row[amountField] || 0));
        });
        return Array.from(totals, ([currency, amount]) => fmtMoney(amount, currency)).join(' · ') || '—';
    }
    function guardedAction(action) {
        return async function (event) {
            const button = event.currentTarget;
            const panel = button.closest('[data-panel]')?.dataset.panel;
            const statusId = ({ inventory: 'inventory-status', suppliers: 'suppliers-status', sponsors: 'sponsors-status' })[panel] || 'ops-status';
            if (button.disabled) return;
            button.disabled = true;
            try { await action(event); }
            catch (error) { status(statusId, 'error', error.message || 'No pudimos guardar el cambio. Intentá nuevamente.'); }
            finally { button.disabled = false; }
        };
    }
    function requireResult(result) {
        if (result?.error) throw result.error;
        return result?.data;
    }
    function validUrl(value) {
        if (!value) return null;
        try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; } catch { return null; }
    }

    function wireOpsSubnav() {
        const nav = document.getElementById('ops-subnav');
        if (!nav) return;
        nav.addEventListener('click', e => {
            const btn = e.target.closest('button[data-sub]');
            if (!btn) return;
            nav.querySelectorAll('button').forEach(b => b.classList.toggle('is-active', b === btn));
            const sub = btn.dataset.sub;
            ['bookings', 'jobs', 'clients', 'invoices', 'documents'].forEach(s => {
                document.getElementById('ops-sub-' + s).style.display = s === sub ? '' : 'none';
                document.getElementById('ops-sub-' + s).classList.toggle('is-active', s === sub);
            });
        });
    }

    function wireBookingPanel(supabase, studio) {
        const nav = document.getElementById('ops-subnav');
        const jobs = document.getElementById('ops-sub-jobs');
        if (!nav || !jobs) return;
        nav.insertAdjacentHTML('afterbegin', '<button type="button" data-sub="bookings">Agenda</button>');
        jobs.insertAdjacentHTML('beforebegin', `<div id="ops-sub-bookings" style="display:none;">
            <p class="studio-help">Reservá horarios de tu roster. Al completar una reserva se registra el trabajo y se actualizan clientes y estadísticas.</p>
            <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:16px;">
                <label for="booking-month">Mes</label><input id="booking-month" class="studio-input" type="month" value="${localDateTime().slice(0, 7)}" style="width:auto;">
                <button class="studio-btn studio-btn-primary" id="booking-new">Nueva reserva</button>
                <button class="studio-btn" id="booking-refresh">Actualizar</button>
            </div><div id="booking-editor"></div><div id="bookings-list"></div></div>`);
        document.getElementById('booking-new').addEventListener('click', guardedAction(() => openBookingEditor(supabase, studio)));
        document.getElementById('booking-refresh').addEventListener('click', guardedAction(() => renderBookings(supabase, studio)));
        document.getElementById('booking-month').addEventListener('change', () => renderBookings(supabase, studio));
        nav.querySelector('[data-sub="bookings"]').addEventListener('click', () => renderBookings(supabase, studio));
    }
    async function renderBookings(supabase, studio) {
        const host = document.getElementById('bookings-list');
        const month = document.getElementById('booking-month').value;
        if (!/^\d{4}-\d{2}$/.test(month)) return;
        const start = new Date(month + '-01T00:00:00');
        const end = new Date(start); end.setMonth(end.getMonth() + 1);
        const { data: rows, error } = await WeotziData.StudioOps.listBookings(studio.id, start.toISOString(), end.toISOString());
        if (error) { host.innerHTML = '<p class="studio-status studio-status-error">' + escapeHtml(error.message) + '</p>'; return; }
        if (!rows?.length) { host.innerHTML = '<p class="studio-help">No hay reservas en este mes.</p>'; return; }
        const labels = { confirmed: 'Confirmada', completed: 'Completada', cancelled: 'Cancelada' };
        host.innerHTML = `<table class="studio-roster-table"><thead><tr><th>Horario</th><th>Artista / sede</th><th>Cliente</th><th>Importe</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>${rows.map(row => `<tr>
            <td>${escapeHtml(new Date(row.starts_at).toLocaleString('es-AR'))}<br><small>Hasta ${escapeHtml(new Date(row.ends_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }))}</small></td>
            <td>${escapeHtml(row.artists_db?.name || row.artists_db?.username || 'Artista')}<br><small>${escapeHtml(row.studio_locations?.label || 'Sin sede')}</small></td>
            <td>${escapeHtml(row.client_name)}${row.client_email ? '<br><small>' + escapeHtml(row.client_email) + '</small>' : ''}</td>
            <td>${fmtMoney(row.amount, row.currency)}</td><td>${labels[row.status] || escapeHtml(row.status)}</td>
            <td>${row.status === 'confirmed' ? `<button class="studio-btn" data-booking-action="edit" data-id="${escapeAttr(row.id)}">Editar</button>
            <button class="studio-btn" data-booking-action="complete" data-id="${escapeAttr(row.id)}" ${new Date(row.starts_at) > new Date() ? 'disabled' : ''}>Completar</button>
            <button class="studio-location-row-remove" data-booking-action="cancel" data-id="${escapeAttr(row.id)}">Cancelar</button>` : ''}</td></tr>`).join('')}</tbody></table>`;
        host.querySelectorAll('[data-booking-action]').forEach(button => button.addEventListener('click', guardedAction(async () => {
            const row = rows.find(item => item.id === button.dataset.id);
            if (button.dataset.bookingAction === 'edit') return openBookingEditor(supabase, studio, row);
            if (button.dataset.bookingAction === 'cancel') {
                if (!confirm('¿Cancelar esta reserva? El horario volverá a quedar disponible.')) return;
                requireResult(await WeotziData.StudioOps.saveBooking(row.id, { status: 'cancelled' }));
            } else {
                if (!confirm('¿El trabajo ya se realizó? Se agregará al registro de trabajos del estudio.')) return;
                requireResult(await WeotziData.StudioOps.completeBooking(row.id));
                await renderJobsList(supabase, studio);
            }
            status('ops-status', 'success', 'Reserva actualizada.');
            await renderBookings(supabase, studio);
        })));
    }
    async function openBookingEditor(supabase, studio, existing) {
        const [membersResult, locationsResult] = await Promise.all([
            WeotziData.StudioMemberships.listActiveArtists(studio.id), WeotziData.StudioLocations.listActiveByStudio(studio.id)
        ]);
        const members = requireResult(membersResult) || [];
        const locations = requireResult(locationsResult) || [];
        const host = document.getElementById('booking-editor');
        const artistOptions = members.map(member => ({ id: member.artist_user_id, name: member.artists_db?.name || member.artists_db?.username || 'Artista' }));
        if (existing && !artistOptions.some(artist => artist.id === existing.artist_user_id)) artistOptions.push({ id: existing.artist_user_id, name: existing.artists_db?.name || 'Artista de esta reserva' });
        if (!artistOptions.length) { status('ops-status', 'error', 'Invitá a un artista y esperá su aceptación en Roster antes de crear una reserva.'); return; }
        const from = existing?.starts_at || new Date(Date.now() + 3600000).toISOString();
        const until = existing?.ends_at || new Date(new Date(from).getTime() + 3600000).toISOString();
        host.innerHTML = `<div class="studio-location-row" style="margin-bottom:20px;">
            <h3 class="studio-h2">${existing ? 'Editar reserva' : 'Nueva reserva'}</h3>
            <div class="studio-field"><label for="booking-artist" class="studio-label">Artista</label><select id="booking-artist" class="studio-input">${artistOptions.map(artist => `<option value="${escapeAttr(artist.id)}" ${artist.id === existing?.artist_user_id ? 'selected' : ''}>${escapeHtml(artist.name)}</option>`).join('')}</select></div>
            <div class="studio-field"><label for="booking-location" class="studio-label">Sede</label><select id="booking-location" class="studio-input"><option value="">Sin sede</option>${locations.map(location => `<option value="${escapeAttr(location.id)}" ${location.id === (existing?.location_id || studio.primary_location_id) ? 'selected' : ''}>${escapeHtml(location.label)}</option>`).join('')}</select></div>
            <div class="studio-field"><label for="booking-start" class="studio-label">Inicio</label><input id="booking-start" class="studio-input" type="datetime-local" value="${localDateTime(from)}"></div>
            <div class="studio-field"><label for="booking-end" class="studio-label">Fin</label><input id="booking-end" class="studio-input" type="datetime-local" value="${localDateTime(until)}"></div>
            <div class="studio-field"><label for="booking-client" class="studio-label">Cliente</label><input id="booking-client" class="studio-input" value="${escapeAttr(existing?.client_name || '')}" required></div>
            <div class="studio-field"><label for="booking-email" class="studio-label">Correo del cliente</label><input id="booking-email" class="studio-input" type="email" value="${escapeAttr(existing?.client_email || '')}"></div>
            <div class="studio-field"><label for="booking-amount" class="studio-label">Importe acordado</label><input id="booking-amount" class="studio-input" type="number" min="0" step="0.01" value="${existing?.amount || 0}"></div>
            <div class="studio-field"><label for="booking-currency" class="studio-label">Moneda</label><input id="booking-currency" class="studio-input" maxlength="3" value="${escapeAttr(existing?.currency || 'USD')}"></div>
            <div class="studio-field"><label for="booking-notes" class="studio-label">Notas</label><textarea id="booking-notes" class="studio-textarea">${escapeHtml(existing?.notes || '')}</textarea></div>
            <button class="studio-btn studio-btn-primary" id="booking-save">Guardar reserva</button> <button class="studio-btn" id="booking-close">Cerrar</button></div>`;
        document.getElementById('booking-close').addEventListener('click', () => { host.innerHTML = ''; });
        document.getElementById('booking-save').addEventListener('click', guardedAction(async () => {
            const get = id => document.getElementById('booking-' + id).value.trim();
            const start = new Date(get('start')), end = new Date(get('end'));
            const payload = { studio_id: studio.id, artist_user_id: get('artist'), location_id: get('location') || null, client_name: get('client'), client_email: get('email') || null, amount: Number(get('amount')), currency: get('currency').toUpperCase(), notes: get('notes') || null };
            if (!payload.client_name || !document.getElementById('booking-email').checkValidity() || !Number.isFinite(start.getTime()) || !(end > start) || !Number.isFinite(payload.amount) || payload.amount < 0 || !/^[A-Z]{3}$/.test(payload.currency)) throw new Error('Revisá cliente, correo, fechas, importe y moneda.');
            payload.starts_at = start.toISOString(); payload.ends_at = end.toISOString();
            requireResult(await WeotziData.StudioOps.saveBooking(existing?.id, payload));
            document.getElementById('booking-month').value = localDateTime(start).slice(0, 7);
            host.innerHTML = '';
            status('ops-status', 'success', 'Reserva guardada.');
            await renderBookings(supabase, studio);
        }));
    }

    // -------------------------------------------------------------
    // JOBS
    // -------------------------------------------------------------
    function wireJobsPanel(supabase, studio) {
        renderJobsList(supabase, studio);
        const newBtn = document.getElementById('job-new-btn');
        if (newBtn) newBtn.addEventListener('click', guardedAction(() => openJobEditor(supabase, studio, null)));
    }
    async function renderJobsList(supabase, studio) {
        const el = document.getElementById('jobs-list');
        const { data, error } = await WeotziData.StudioOps.listJobs(studio.id);
        if (error) { el.innerHTML = '<em>' + escapeHtml(error.message) + '</em>'; return; }
        if (!data || data.length === 0) { el.innerHTML = '<p class="studio-help">Sin trabajos registrados todavía.</p>'; return; }
        el.innerHTML = `<p class="studio-help">Últimos 100 trabajos registrados.</p>
            <table class="studio-roster-table">
                <thead><tr>
                    <th>Fecha</th><th>Artista</th><th>Horas</th><th>Bruto</th><th>Studio split</th><th>Acciones</th>
                </tr></thead>
                <tbody>${data.map(j => `
                    <tr data-id="${escapeAttr(j.id)}">
                        <td>${fmtDate(j.performed_at)}</td>
                        <td>${escapeHtml((j.artists_db && (j.artists_db.name || j.artists_db.username)) || '—')}</td>
                        <td>${j.duration_hours ?? '—'}</td>
                        <td>${fmtMoney(j.gross_amount, j.gross_currency)}</td>
                        <td>${fmtMoney(j.studio_split_amount, j.gross_currency)}</td>
                        <td>
                            <button class="studio-locations-add" data-action="edit"   data-id="${escapeAttr(j.id)}" style="border-style:solid;padding:4px 8px;">Editar</button>
                            <button class="studio-location-row-remove" data-action="delete" data-id="${escapeAttr(j.id)}">Borrar</button>
                        </td>
                    </tr>`).join('')}
                </tbody>
            </table>
        `;
        el.querySelectorAll('button[data-action]').forEach(btn => {
            btn.addEventListener('click', guardedAction(async () => {
                if (btn.dataset.action === 'edit') {
                    const row = requireResult(await WeotziData.StudioOps.getJobById(btn.dataset.id));
                    await openJobEditor(supabase, studio, row);
                } else if (btn.dataset.action === 'delete') {
                    if (!confirm('¿Eliminar este trabajo?')) return;
                    const { error } = await WeotziData.StudioOps.deleteJob(btn.dataset.id);
                    if (error) status('ops-status', 'error', error.message);
                    else { status('ops-status', 'success', 'Eliminado.'); renderJobsList(supabase, studio); }
                }
            }));
        });
    }
    async function openJobEditor(supabase, studio, existing) {
        const c = document.getElementById('job-editor');
        const members = requireResult(await WeotziData.StudioMemberships.listActiveArtists(studio.id));
        if (existing && !(members || []).some(member => member.artist_user_id === existing.artist_user_id)) {
            members.push({ artist_user_id: existing.artist_user_id, artists_db: { user_id: existing.artist_user_id, name: 'Artista de este trabajo' } });
        }
        const artistOptions = (members || []).map(m => {
            const a = m.artists_db || {};
            return `<option value="${escapeAttr(a.user_id || m.artist_user_id)}" ${existing && existing.artist_user_id === a.user_id ? 'selected' : ''}>${escapeHtml(a.name || a.username || a.user_id)}</option>`;
        }).join('');

        c.innerHTML = `
            <div class="studio-location-row" style="margin-bottom:18px;">
                <div class="studio-location-row-head">
                    <span class="studio-section-kicker">${existing ? 'Editar trabajo' : 'Nuevo trabajo'}</span>
                    <button class="studio-location-row-remove" id="job-cancel">Cancelar</button>
                </div>
                <div class="studio-field"><label class="studio-label">Fecha</label>
                    <input id="job-when" class="studio-input" type="datetime-local" value="${escapeAttr(localDateTime(existing?.performed_at))}"></div>
                <div class="studio-field"><label class="studio-label">Artista</label>
                    <select id="job-artist" class="studio-input">${artistOptions || '<option value="">— Sin artistas activos —</option>'}</select></div>
                <div class="studio-field"><label class="studio-label">Cliente (nombre)</label>
                    <input id="job-client" class="studio-input" value="${escapeAttr(existing?.client_display_name || '')}" placeholder="Cliente o anónimo"></div>
                <div class="studio-field"><label class="studio-label" for="job-email">Correo del cliente</label>
                    <input id="job-email" class="studio-input" type="email" value="${escapeAttr(existing?.client_email || '')}"></div>
                <div class="studio-field"><label class="studio-label">Duración (horas) y bruto</label>
                    <div style="display:flex;gap:8px;">
                        <input id="job-hours" class="studio-input" type="number" step="0.25" min="0" value="${escapeAttr(existing?.duration_hours ?? '')}">
                        <input id="job-gross" class="studio-input" type="number" step="0.01" min="0" value="${escapeAttr(existing?.gross_amount ?? '')}" placeholder="Bruto">
                        <input id="job-currency" class="studio-input" placeholder="USD" value="${escapeAttr(existing?.gross_currency || 'USD')}">
                    </div></div>
                <div class="studio-field"><label class="studio-label">Split artista / studio / supplies</label>
                    <div style="display:flex;gap:8px;">
                        <input id="job-art-split"   class="studio-input" type="number" step="0.01" placeholder="Artista" value="${escapeAttr(existing?.artist_split_amount ?? '')}">
                        <input id="job-stu-split"   class="studio-input" type="number" step="0.01" placeholder="Studio"  value="${escapeAttr(existing?.studio_split_amount ?? '')}">
                        <input id="job-supplies"    class="studio-input" type="number" step="0.01" placeholder="Supplies" value="${escapeAttr(existing?.supplies_cost ?? '')}">
                    </div></div>
                <div class="studio-field"><label class="studio-label">Notas</label>
                    <textarea id="job-notes" class="studio-textarea" rows="2">${escapeHtml(existing?.notes || '')}</textarea></div>
                <button class="studio-btn studio-btn-primary" id="job-save"><i class="fa-solid fa-floppy-disk"></i> Guardar</button>
            </div>
        `;
        document.getElementById('job-cancel').addEventListener('click', () => { c.innerHTML = ''; });
        document.getElementById('job-save').addEventListener('click', guardedAction(async () => {
            const payload = {
                studio_id: studio.id,
                location_id: existing?.location_id || studio.primary_location_id || null,
                artist_user_id: document.getElementById('job-artist').value || null,
                client_display_name: document.getElementById('job-client').value.trim() || null,
                client_email: document.getElementById('job-email').value.trim() || null,
                performed_at: new Date(document.getElementById('job-when').value).toISOString(),
                duration_hours:      numOrNull(document.getElementById('job-hours').value),
                gross_amount:        numOrNull(document.getElementById('job-gross').value) ?? 0,
                gross_currency:      document.getElementById('job-currency').value.trim() || 'USD',
                artist_split_amount: numOrNull(document.getElementById('job-art-split').value),
                studio_split_amount: numOrNull(document.getElementById('job-stu-split').value),
                supplies_cost:       numOrNull(document.getElementById('job-supplies').value),
                notes:               document.getElementById('job-notes').value.trim() || null
            };
            if (!payload.artist_user_id) { status('ops-status', 'error', 'Elegí un artista.'); return; }
            if (!document.getElementById('job-email').checkValidity() || payload.gross_amount < 0 || (payload.duration_hours != null && payload.duration_hours <= 0) || [payload.artist_split_amount, payload.studio_split_amount, payload.supplies_cost].some(value => value != null && value < 0)) {
                status('ops-status', 'error', 'Revisá el correo, duración e importes.'); return;
            }
            payload.gross_currency = payload.gross_currency.toUpperCase();
            if (!/^[A-Z]{3}$/.test(payload.gross_currency)) { status('ops-status', 'error', 'Usá una moneda de tres letras, como ARS o USD.'); return; }
            const result = existing
                ? await WeotziData.StudioOps.updateJob(existing.id, payload)
                : await WeotziData.StudioOps.createJob(payload);
            if (result.error) { status('ops-status', 'error', result.error.message); return; }
            status('ops-status', 'success', existing ? 'Actualizado.' : 'Trabajo registrado.');
            c.innerHTML = '';
            renderJobsList(supabase, studio);
        }));
    }
    function numOrNull(v) { const n = Number(v); return v === '' || !Number.isFinite(n) ? null : n; }

    // -------------------------------------------------------------
    // CLIENTS  (read-only aggregated from jobs + quotations)
    // -------------------------------------------------------------
    function wireClientsPanel(supabase, studio) {
        renderClientsList(supabase, studio);
    }
    async function renderClientsList(supabase, studio) {
        const el = document.getElementById('clients-list');
        // We aggregate from jobs (we already have them filtered to this studio).
        const { data: jobs, error } = await WeotziData.StudioOps.listJobsForClientAggregation(studio.id);
        if (error) { el.innerHTML = '<p class="studio-help">' + escapeHtml(error.message) + '</p>'; return; }
        if (!jobs || jobs.length === 0) {
            el.innerHTML = '<p class="studio-help">Aún no hay clientes asociados a tus trabajos.</p>';
            return;
        }
        const map = new Map();
        jobs.forEach(j => {
            const key = j.client_user_id || j.client_email?.trim().toLowerCase() || j.client_display_name?.trim().toLowerCase() || j.id;
            const cur = map.get(key) || { name: j.client_display_name || j.client_email || 'Anónimo', email: j.client_email, sessions: 0, jobs: [], last: null };
            cur.sessions += 1;
            cur.jobs.push(j);
            cur.last = !cur.last || new Date(j.performed_at) > new Date(cur.last) ? j.performed_at : cur.last;
            map.set(key, cur);
        });
        const rows = Array.from(map.values()).sort((a, b) => new Date(b.last) - new Date(a.last));
        el.innerHTML = `
            <table class="studio-roster-table">
                <thead><tr><th>Cliente</th><th>Sesiones</th><th>Bruto total</th><th>Última visita</th></tr></thead>
                <tbody>${rows.map(c => `
                    <tr>
                        <td><strong>${escapeHtml(c.name)}</strong>${c.email ? `<br><small style="color:var(--text-secondary);font-family:var(--studio-mono);">${escapeHtml(c.email)}</small>` : ''}</td>
                        <td>${c.sessions}</td>
                        <td>${sumCurrencies(c.jobs, 'gross_amount', 'gross_currency')}</td>
                        <td>${fmtDate(c.last)}</td>
                    </tr>`).join('')}
                </tbody>
            </table>
        `;
    }

    // -------------------------------------------------------------
    // INVOICES (internal ledger)
    // -------------------------------------------------------------
    function wireInvoicesPanel(supabase, studio) {
        renderInvoicesList(supabase, studio);
        document.getElementById('invoice-new-btn').addEventListener('click', guardedAction(() => openInvoiceEditor(supabase, studio, null)));
    }
    async function renderInvoicesList(supabase, studio) {
        const el = document.getElementById('invoices-list');
        const { data, error } = await WeotziData.StudioOps.listInvoices(studio.id);
        if (error) { el.innerHTML = '<em>' + escapeHtml(error.message) + '</em>'; return; }
        if (!data || data.length === 0) { el.innerHTML = '<p class="studio-help">Sin facturas todavía.</p>'; return; }
        el.innerHTML = `
            <table class="studio-roster-table">
                <thead><tr><th>Número</th><th>Fecha</th><th>Cliente</th><th>Total</th><th>Estado</th><th>Acciones</th></tr></thead>
                <tbody>${data.map(i => `
                    <tr>
                        <td><strong>${escapeHtml(i.invoice_number)}</strong></td>
                        <td>${fmtDate(i.issue_date)}</td>
                        <td>${escapeHtml(i.billed_to_name || '—')}</td>
                        <td>${fmtMoney(i.total_amount, i.currency)}</td>
                        <td><span class="studio-role-pill role-${i.status === 'paid' ? 'resident' : (i.status === 'overdue' ? 'manager' : 'guest')}">${escapeHtml(i.status)}</span></td>
                        <td>
                            ${!['paid', 'void'].includes(i.status) ? `<button class="studio-locations-add" data-action="edit" data-id="${escapeAttr(i.id)}" style="border-style:solid;padding:4px 8px;">Editar</button>
                            <button class="studio-locations-add" data-action="paid" data-id="${escapeAttr(i.id)}" style="border-style:solid;padding:4px 8px;">Registrar pago recibido</button>` : ''}
                            ${i.status === 'draft' ? `<button class="studio-location-row-remove" data-action="delete" data-id="${escapeAttr(i.id)}">Borrar borrador</button>` : ''}
                        </td>
                    </tr>`).join('')}
                </tbody>
            </table>
        `;
        el.querySelectorAll('button[data-action]').forEach(btn => {
            btn.addEventListener('click', guardedAction(async () => {
                if (btn.dataset.action === 'edit') {
                    const row = requireResult(await WeotziData.StudioOps.getInvoiceById(btn.dataset.id));
                    await openInvoiceEditor(supabase, studio, row);
                } else if (btn.dataset.action === 'paid') {
                    if (!confirm('¿Confirmás que ya recibiste este pago? Se registrará en tu contabilidad interna.')) return;
                    requireResult(await WeotziData.StudioOps.markInvoicePaid(btn.dataset.id));
                    renderInvoicesList(supabase, studio);
                } else if (btn.dataset.action === 'delete') {
                    if (!confirm('¿Borrar factura?')) return;
                    requireResult(await WeotziData.StudioOps.deleteInvoice(btn.dataset.id));
                    renderInvoicesList(supabase, studio);
                }
            }));
        });
    }
    async function openInvoiceEditor(supabase, studio, existing) {
        const c = document.getElementById('invoice-editor');
        const items = existing
            ? requireResult(await WeotziData.StudioOps.listInvoiceItems(existing.id)) || []
            : [{ description: '', quantity: 1, unit_price: 0 }];
        c.innerHTML = `
            <div class="studio-location-row" style="margin-bottom:18px;">
                <div class="studio-location-row-head">
                    <span class="studio-section-kicker">${existing ? 'Editar factura' : 'Nueva factura'}</span>
                    <button class="studio-location-row-remove" id="inv-cancel">Cancelar</button>
                </div>
                <div class="studio-field"><label class="studio-label">Número de factura</label>
                    <input id="inv-num" class="studio-input" value="${escapeAttr(existing?.invoice_number || ('INV-' + Date.now().toString().slice(-6)))}"></div>
                <div class="studio-field"><label class="studio-label">Cliente</label>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;">
                        <input id="inv-name"  class="studio-input" placeholder="Nombre" value="${escapeAttr(existing?.billed_to_name || '')}">
                        <input id="inv-email" class="studio-input" type="email" placeholder="Email" value="${escapeAttr(existing?.billed_to_email || '')}">
                        <input id="inv-tax"   class="studio-input" placeholder="CUIT/NIF" value="${escapeAttr(existing?.billed_to_tax_id || '')}">
                    </div></div>
                <div class="studio-field"><label class="studio-label">Fechas y moneda</label>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;">
                        <input id="inv-issue" class="studio-input" type="date" value="${escapeAttr(existing?.issue_date || new Date().toISOString().slice(0,10))}">
                        <input id="inv-due"   class="studio-input" type="date" value="${escapeAttr(existing?.due_date || '')}">
                        <input id="inv-curr"  class="studio-input" placeholder="USD" value="${escapeAttr(existing?.currency || 'USD')}">
                        <input id="inv-tax-amt" class="studio-input" type="number" step="0.01" placeholder="IVA / Tax" value="${escapeAttr(existing?.tax_amount ?? 0)}">
                    </div></div>
                <h3 class="studio-section-kicker" style="margin-top:8px;">Items</h3>
                <div id="inv-items">${items.map(it => itemRowHtml(it)).join('')}</div>
                <button class="studio-locations-add" id="inv-add-item" style="border-style:dashed;margin-top:6px;">+ Agregar línea</button>
                <div style="display:flex;gap:10px;margin-top:14px;">
                    <button class="studio-btn studio-btn-primary" id="inv-save"><i class="fa-solid fa-floppy-disk"></i> Guardar</button>
                </div>
            </div>
        `;
        function itemRowHtml(it) {
            return `
                <div class="studio-location-row" style="margin-top:8px;">
                    <div style="display:flex;gap:8px;flex-wrap:wrap;">
                        <input class="studio-input" data-field="description" placeholder="Descripción" value="${escapeAttr(it?.description || '')}" style="flex:2;min-width:160px;">
                        <input class="studio-input" data-field="quantity"   placeholder="Cant." type="number" step="0.01" value="${escapeAttr(it?.quantity ?? 1)}"   style="flex:1;max-width:80px;">
                        <input class="studio-input" data-field="unit_price" placeholder="P. unit." type="number" step="0.01" value="${escapeAttr(it?.unit_price ?? 0)}" style="flex:1;max-width:120px;">
                        <button class="studio-location-row-remove" data-action="remove-item">Quitar</button>
                    </div>
                </div>
            `;
        }
        document.getElementById('inv-cancel').addEventListener('click', () => { c.innerHTML = ''; });
        document.getElementById('inv-add-item').addEventListener('click', () => {
            document.getElementById('inv-items').insertAdjacentHTML('beforeend', itemRowHtml(null));
        });
        c.addEventListener('click', e => {
            if (e.target.matches('button[data-action="remove-item"]')) {
                e.target.closest('.studio-location-row').remove();
            }
        });
        document.getElementById('inv-save').addEventListener('click', guardedAction(async () => {
            const headerPayload = {
                studio_id: studio.id,
                invoice_number: document.getElementById('inv-num').value.trim(),
                billed_to_name: document.getElementById('inv-name').value.trim() || null,
                billed_to_email: document.getElementById('inv-email').value.trim() || null,
                billed_to_tax_id: document.getElementById('inv-tax').value.trim() || null,
                issue_date: document.getElementById('inv-issue').value,
                due_date:   document.getElementById('inv-due').value || null,
                currency:   (document.getElementById('inv-curr').value.trim() || 'USD').toUpperCase(),
                tax_amount: numOrNull(document.getElementById('inv-tax-amt').value) ?? 0,
                status:     existing?.status || 'draft'
            };
            const itemRows = Array.from(document.querySelectorAll('#inv-items .studio-location-row')).map((row, idx) => ({
                kind: 'custom',
                description: row.querySelector('input[data-field="description"]').value.trim(),
                quantity:    numOrNull(row.querySelector('input[data-field="quantity"]').value),
                unit_price:  numOrNull(row.querySelector('input[data-field="unit_price"]').value),
                sort_order:  idx
            }));
            if (!headerPayload.invoice_number || !headerPayload.issue_date || !document.getElementById('inv-email').checkValidity() || !itemRows.length || itemRows.some(item => !item.description || !(item.quantity > 0) || item.unit_price == null || item.unit_price < 0)) {
                status('ops-status', 'error', 'Completá número, fecha y al menos un concepto con cantidad y precio válidos.'); return;
            }
            requireResult(await WeotziData.StudioOps.saveInvoice(existing?.id, headerPayload, itemRows));
            status('ops-status', 'success', 'Factura guardada.');
            c.innerHTML = '';
            renderInvoicesList(supabase, studio);
        }));
    }

    // -------------------------------------------------------------
    // DOCUMENTS
    // -------------------------------------------------------------
    function wireDocumentsPanel(supabase, studio) {
        renderDocsList(supabase, studio);
        document.getElementById('doc-new-btn').addEventListener('click', guardedAction(() => openDocEditor(supabase, studio, null)));
    }
    async function renderDocsList(supabase, studio) {
        const el = document.getElementById('docs-list');
        const { data, error } = await WeotziData.StudioOps.listDocuments(studio.id);
        if (error) { el.innerHTML = '<em>' + escapeHtml(error.message) + '</em>'; return; }
        if (!data || data.length === 0) { el.innerHTML = '<p class="studio-help">Sin documentos cargados.</p>'; return; }
        el.innerHTML = `
            <table class="studio-roster-table">
                <thead><tr><th>Título</th><th>Tipo</th><th>Plantilla</th><th>Firma</th><th>Acciones</th></tr></thead>
                <tbody>${data.map(d => `
                    <tr>
                        <td><strong>${escapeHtml(d.title)}</strong>${d.description ? `<br><small style="color:var(--text-secondary);">${escapeHtml(d.description)}</small>` : ''}</td>
                        <td><span class="studio-role-pill">${escapeHtml(d.kind)}</span></td>
                        <td>${d.is_template ? 'Sí' : '—'}</td>
                        <td>${d.requires_signature ? 'Requerida' : '—'}</td>
                        <td>
                            ${d.file_url || d.storage_path ? `<button class="studio-locations-add" data-action="open" data-id="${escapeAttr(d.id)}" style="border-style:solid;padding:4px 8px;">Ver archivo</button>` : ''}
                            <button class="studio-locations-add" data-action="edit" data-id="${escapeAttr(d.id)}" style="border-style:solid;padding:4px 8px;">Editar</button>
                            <button class="studio-location-row-remove" data-action="delete" data-id="${escapeAttr(d.id)}">Borrar</button>
                        </td>
                    </tr>`).join('')}
                </tbody>
            </table>
        `;
        el.querySelectorAll('button[data-action]').forEach(btn => {
            btn.addEventListener('click', guardedAction(async () => {
                if (btn.dataset.action === 'open') {
                    const doc = data.find(row => row.id === btn.dataset.id);
                    const preview = window.open('about:blank', '_blank');
                    if (preview) preview.opener = null;
                    try {
                        const path = documentStoragePath(doc);
                        const url = path ? requireResult(await supabase.storage.from('studio-documents').createSignedUrl(path, 300)).signedUrl : validUrl(doc.file_url);
                        if (!url) throw new Error('El documento no tiene un archivo válido.');
                        if (preview) preview.location = url;
                        else { status('ops-status', 'error', 'Permití las ventanas emergentes para abrir el documento.'); }
                    } catch (error) { preview?.close(); throw error; }
                } else if (btn.dataset.action === 'edit') {
                    const row = requireResult(await WeotziData.StudioOps.getDocumentById(btn.dataset.id));
                    await openDocEditor(supabase, studio, row);
                } else if (btn.dataset.action === 'delete') {
                    if (!confirm('¿Borrar documento?')) return;
                    requireResult(await WeotziData.StudioOps.deleteDocument(btn.dataset.id));
                    renderDocsList(supabase, studio);
                }
            }));
        });
    }
    function documentStoragePath(doc) {
        if (doc?.storage_path) return doc.storage_path;
        const match = String(doc?.file_url || '').match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/studio-documents\/([^?]+)/);
        return match ? decodeURIComponent(match[1]) : null;
    }
    async function persistDocument(supabase, existing, payload, uploadedPath) {
        try {
            return requireResult(existing
                ? await WeotziData.StudioOps.updateDocument(existing.id, payload)
                : await WeotziData.StudioOps.createDocument(payload));
        } catch (error) {
            if (uploadedPath) {
                const cleanup = await supabase.storage.from('studio-documents').remove([uploadedPath]);
                if (cleanup.error) error.message += ' No pudimos limpiar el archivo subido; sigue siendo privado.';
            }
            throw error;
        }
    }
    function openDocEditor(supabase, studio, existing) {
        const c = document.getElementById('doc-editor');
        c.innerHTML = `
            <div class="studio-location-row" style="margin-bottom:18px;">
                <div class="studio-location-row-head">
                    <span class="studio-section-kicker">${existing ? 'Editar documento' : 'Nuevo documento'}</span>
                    <button class="studio-location-row-remove" id="doc-cancel">Cancelar</button>
                </div>
                <div class="studio-field"><label class="studio-label">Título</label>
                    <input id="doc-title" class="studio-input" value="${escapeAttr(existing?.title || '')}"></div>
                <div class="studio-field"><label class="studio-label">Tipo</label>
                    <select id="doc-kind" class="studio-input">
                        ${['consent','release','contract','nda','price_list','custom'].map(k =>
                            `<option value="${k}" ${existing?.kind === k ? 'selected' : ''}>${k}</option>`).join('')}
                    </select></div>
                <div class="studio-field"><label class="studio-label">Descripción</label>
                    <textarea id="doc-desc" class="studio-textarea" rows="2">${escapeHtml(existing?.description || '')}</textarea></div>
                <div class="studio-field"><label class="studio-label" for="doc-file">Archivo privado (PDF, Word o imagen; hasta 10 MB)</label>
                    <input id="doc-file" class="studio-input" type="file" accept="application/pdf,image/jpeg,image/png,image/webp,.doc,.docx">
                    ${documentStoragePath(existing) ? '<span class="studio-help">Ya tiene un archivo privado. Elegí otro para reemplazarlo.</span>' : ''}</div>
                <div class="studio-field"><label class="studio-label" for="doc-url">O enlace a un archivo</label>
                    <input id="doc-url" class="studio-input" type="url" value="${escapeAttr(existing?.file_url || '')}" placeholder="https://…">
                    <span class="studio-help">Los archivos subidos solo se abren mediante un enlace temporal.</span></div>
                <div class="studio-field" style="display:flex;gap:18px;align-items:center;flex-wrap:wrap;">
                    <label style="display:inline-flex;gap:6px;align-items:center;font-family:var(--studio-mono);font-size:.7rem;letter-spacing:.12em;text-transform:uppercase;font-weight:700;">
                        <input id="doc-template" type="checkbox" ${existing?.is_template ? 'checked' : ''}> Plantilla reutilizable
                    </label>
                    <label style="display:inline-flex;gap:6px;align-items:center;font-family:var(--studio-mono);font-size:.7rem;letter-spacing:.12em;text-transform:uppercase;font-weight:700;">
                        <input id="doc-sig" type="checkbox" ${existing?.requires_signature ? 'checked' : ''}> Requiere firma
                    </label>
                </div>
                <button class="studio-btn studio-btn-primary" id="doc-save"><i class="fa-solid fa-floppy-disk"></i> Guardar</button>
                ${existing ? '<div id="doc-links" style="margin-top:24px;"></div>' : '<p class="studio-help">Guardá el documento para vincularlo a un artista, trabajo o factura.</p>'}
            </div>
        `;
        document.getElementById('doc-cancel').addEventListener('click', () => { c.innerHTML = ''; });
        document.getElementById('doc-save').addEventListener('click', guardedAction(async () => {
            const payload = {
                studio_id: studio.id,
                title: document.getElementById('doc-title').value.trim(),
                kind:  document.getElementById('doc-kind').value,
                description: document.getElementById('doc-desc').value.trim() || null,
                file_url:    document.getElementById('doc-url').value.trim()  || null,
                is_template: document.getElementById('doc-template').checked,
                requires_signature: document.getElementById('doc-sig').checked
            };
            if (!payload.title) { status('ops-status', 'error', 'Título obligatorio.'); return; }
            if (payload.file_url && !validUrl(payload.file_url)) { status('ops-status', 'error', 'El enlace debe comenzar con https:// o http://.'); return; }
            payload.storage_path = payload.file_url === existing?.file_url ? documentStoragePath(existing) : null;
            const file = document.getElementById('doc-file').files[0];
            let uploadedPath = null;
            if (file) {
                const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
                if (!allowed.includes(file.type) || file.size > 10 * 1024 * 1024) { status('ops-status', 'error', 'Elegí un PDF, Word o imagen de hasta 10 MB.'); return; }
                uploadedPath = studio.id + '/' + crypto.randomUUID() + '/' + file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
                requireResult(await supabase.storage.from('studio-documents').upload(uploadedPath, file, { contentType: file.type, upsert: false }));
                payload.storage_path = uploadedPath;
                payload.file_url = null;
            }
            if (!payload.file_url && !payload.storage_path) { status('ops-status', 'error', 'Adjuntá un archivo o agregá un enlace.'); return; }
            await persistDocument(supabase, existing, payload, uploadedPath);
            status('ops-status', 'success', 'Documento guardado.');
            c.innerHTML = '';
            renderDocsList(supabase, studio);
        }));
        if (existing) renderDocumentLinks(studio, existing).catch(error => status('ops-status', 'error', error.message));
    }

    async function renderDocumentLinks(studio, doc) {
        const results = await Promise.all([
            WeotziData.StudioOps.listDocumentAttachments(doc.id), WeotziData.StudioMemberships.listRoster(studio.id),
            WeotziData.StudioOps.listInvoices(studio.id), WeotziData.StudioOps.listJobs(studio.id)
        ]);
        const [links, members, invoices, jobs] = results.map(requireResult);
        const targets = [
            ...(members || []).map(row => ({ id: row.id, kind: 'membership', label: 'Artista: ' + (row.artists_db?.name || row.artists_db?.username || 'Artista') })),
            ...(invoices || []).map(row => ({ id: row.id, kind: 'invoice', label: 'Factura: ' + row.invoice_number })),
            ...(jobs || []).map(row => ({ id: row.id, kind: 'job_log', label: 'Trabajo: ' + fmtDate(row.performed_at) + ' · ' + (row.artists_db?.name || 'Artista') }))
        ];
        const host = document.getElementById('doc-links');
        if (!host) return;
        host.innerHTML = `<h3 class="studio-section-kicker">Vínculos y firmas recibidas</h3>
            <p class="studio-help">Asociá este archivo a su registro. La firma recibida se registra manualmente; conservá el documento firmado como archivo.</p>
            ${(links || []).length ? '<ul>' + links.map(link => `<li>${escapeHtml(targets.find(target => target.id === link.attached_to_id)?.label || link.attached_to_kind)}${link.signed_at ? ' · Firma recibida de ' + escapeHtml(link.signer_name) + ' el ' + fmtDate(link.signed_at) : ' · Sin firma registrada'} <button type="button" class="studio-location-row-remove" data-doc-unlink="${escapeAttr(link.id)}">Desvincular</button></li>`).join('') + '</ul>' : '<p class="studio-help">Sin vínculos todavía.</p>'}
            <div class="studio-field"><label for="doc-target" class="studio-label">Vincular a</label><select id="doc-target" class="studio-input"><option value="">Seleccioná un registro</option>${targets.map((target, index) => `<option value="${index}">${escapeHtml(target.label)}</option>`).join('')}</select></div>
            <div class="studio-field"><label for="doc-signer" class="studio-label">Firmante (opcional)</label><input id="doc-signer" class="studio-input" placeholder="Nombre que figura en el documento firmado"></div>
            <div class="studio-field"><label for="doc-signed-date" class="studio-label">Fecha de firma recibida (opcional)</label><input id="doc-signed-date" class="studio-input" type="date" max="${localDateTime().slice(0, 10)}"></div>
            <button type="button" class="studio-btn" id="doc-link-save">Agregar vínculo</button>`;
        document.getElementById('doc-link-save').addEventListener('click', guardedAction(async () => {
            const value = document.getElementById('doc-target').value;
            if (value === '') throw new Error('Seleccioná un artista, factura o trabajo.');
            const target = targets[Number(value)];
            const signer = document.getElementById('doc-signer').value.trim();
            const date = document.getElementById('doc-signed-date').value;
            if (!!signer !== !!date) throw new Error('Para registrar una firma recibida, completá nombre y fecha.');
            if ((links || []).some(link => link.attached_to_id === target.id && link.attached_to_kind === target.kind)) throw new Error('El documento ya está vinculado a ese registro.');
            requireResult(await WeotziData.StudioOps.createDocumentAttachment({ document_id: doc.id, attached_to_kind: target.kind, attached_to_id: target.id, signer_name: signer || null, signed_at: date ? new Date(date + 'T00:00:00').toISOString() : null }));
            status('ops-status', 'success', 'Vínculo guardado.');
            await renderDocumentLinks(studio, doc);
        }));
        host.querySelectorAll('[data-doc-unlink]').forEach(button => button.addEventListener('click', guardedAction(async () => {
            if (!confirm('¿Desvincular el documento de este registro?')) return;
            requireResult(await WeotziData.StudioOps.deleteDocumentAttachment(button.dataset.docUnlink));
            await renderDocumentLinks(studio, doc);
        })));
    }

    // -------------------------------------------------------------
    // INVENTORY
    // -------------------------------------------------------------
    function wireInventoryPanel(supabase, studio) {
        renderInventoryList(supabase, studio);
        document.getElementById('item-new-btn').addEventListener('click', guardedAction(() => openItemEditor(supabase, studio, null)));
    }
    async function renderInventoryList(supabase, studio) {
        const el = document.getElementById('inventory-list');
        const { data, error } = await WeotziData.StudioOps.listInventoryItems(studio.id);
        if (error) {
            await renderInventoryHealth(null, null, []);
            el.innerHTML = '<em>' + escapeHtml(error.message) + '</em>';
            return;
        }
        await renderInventoryHealth(supabase, studio, data || []);
        if (!data || data.length === 0) { el.innerHTML = '<p class="studio-help">Sin items en inventario.</p>'; return; }
        el.innerHTML = `
            <table class="studio-roster-table">
                <thead><tr><th>Item</th><th>Stock</th><th>Reorder</th><th>Costo unit.</th><th>Proveedor</th><th>Acciones</th></tr></thead>
                <tbody>${data.map(it => {
                    const low = it.reorder_level != null && Number(it.quantity_on_hand) <= Number(it.reorder_level);
                    return `
                        <tr style="${low ? 'background:rgba(226,62,40,0.08);' : ''}">
                            <td><strong>${escapeHtml(it.name)}</strong>${it.sku ? `<br><small style="color:var(--text-secondary);font-family:var(--studio-mono);">${escapeHtml(it.sku)}</small>` : ''}</td>
                            <td>${it.quantity_on_hand} ${escapeHtml(it.unit)}${low ? ' ⚠' : ''}</td>
                            <td>${it.reorder_level ?? '—'}</td>
                            <td>${fmtMoney(it.cost_per_unit, it.currency)}</td>
                            <td>${escapeHtml((it.studio_suppliers && it.studio_suppliers.name) || '—')}</td>
                            <td>
                                <button class="studio-locations-add" data-action="move" data-id="${escapeAttr(it.id)}" style="border-style:solid;padding:4px 8px;">Movimiento</button>
                                <button class="studio-locations-add" data-action="edit" data-id="${escapeAttr(it.id)}" style="border-style:solid;padding:4px 8px;">Editar</button>
                                <button class="studio-location-row-remove" data-action="delete" data-id="${escapeAttr(it.id)}">Archivar</button>
                            </td>
                        </tr>`;
                }).join('')}
                </tbody>
            </table>
        `;
        el.querySelectorAll('button[data-action]').forEach(btn => {
            btn.addEventListener('click', guardedAction(async () => {
                if (btn.dataset.action === 'edit') {
                    const row = requireResult(await WeotziData.StudioOps.getInventoryItemById(btn.dataset.id));
                    await openItemEditor(supabase, studio, row);
                } else if (btn.dataset.action === 'move') {
                    await openMovementDialog(supabase, studio, btn.dataset.id);
                } else if (btn.dataset.action === 'delete') {
                    if (!confirm('¿Archivar este item? Se conservará el historial de movimientos.')) return;
                    requireResult(await WeotziData.StudioOps.deleteInventoryItem(btn.dataset.id));
                    renderInventoryList(supabase, studio);
                }
            }));
        });
    }

    async function renderInventoryHealth(supabase, studio, fallbackItems) {
        const el = document.getElementById('inventory-health');
        if (!el) return;

        let items = fallbackItems || [];
        try {
            if (!supabase || !studio) throw new Error('missing inventory context');
            const { data, error } = await WeotziData.StudioOps.listInventoryHealth(studio.id);
            if (!error && Array.isArray(data)) items = data;
        } catch (_) {
            items = fallbackItems || [];
        }

        const total = items.length;
        const low = items.filter(it => Boolean(it.needs_reorder)
            || (it.reorder_level != null && Number(it.quantity_on_hand) <= Number(it.reorder_level)));
        const stockValue = sumCurrencies(items.map(it => ({ ...it, stock_value: it.stock_value ?? Number(it.quantity_on_hand || 0) * Number(it.cost_per_unit || 0) })), 'stock_value');
        const lowPreview = low.slice(0, 4).map(it => escapeHtml(it.name)).join(', ');

        el.innerHTML = `
            <div class="studio-health-card">
                <span class="key">Items activos</span>
                <strong>${total}</strong>
            </div>
            <div class="studio-health-card ${low.length ? 'is-alert' : ''}">
                <span class="key">Reponer</span>
                <strong>${low.length}</strong>
                <small>${low.length ? lowPreview : 'Stock saludable'}</small>
            </div>
            <div class="studio-health-card">
                <span class="key">Valor stock</span>
                <strong>${stockValue}</strong>
            </div>
        `;
    }
    async function openItemEditor(supabase, studio, existing) {
        const c = document.getElementById('item-editor');
        const suppliers = requireResult(await WeotziData.StudioOps.listSupplierOptions(studio.id));
        const supplierOpts = '<option value="">— Sin proveedor —</option>'
            + (suppliers || []).map(s => `<option value="${escapeAttr(s.id)}" ${existing?.supplier_id === s.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('');
        c.innerHTML = `
            <div class="studio-location-row" style="margin-bottom:18px;">
                <div class="studio-location-row-head">
                    <span class="studio-section-kicker">${existing ? 'Editar item' : 'Nuevo item'}</span>
                    <button class="studio-location-row-remove" id="item-cancel">Cancelar</button>
                </div>
                <div class="studio-field"><label class="studio-label">Nombre</label><input id="it-name" class="studio-input" value="${escapeAttr(existing?.name || '')}"></div>
                <div class="studio-field"><label class="studio-label">SKU / Categoría / Unidad</label>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;">
                        <input id="it-sku"  class="studio-input" placeholder="SKU"        value="${escapeAttr(existing?.sku || '')}">
                        <input id="it-cat"  class="studio-input" placeholder="Categoría"  value="${escapeAttr(existing?.category || '')}">
                        <input id="it-unit" class="studio-input" placeholder="unit/ml/gr" value="${escapeAttr(existing?.unit || 'unit')}">
                    </div></div>
                <div class="studio-field"><label class="studio-label">Stock inicial / reorder / costo</label>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;">
                        <input id="it-qty"   class="studio-input" type="number" step="0.001" min="0" ${existing ? 'disabled title="Registrá un movimiento para cambiar el stock"' : ''} value="${escapeAttr(existing?.quantity_on_hand ?? 0)}" placeholder="Stock">
                        <input id="it-reord" class="studio-input" type="number" step="0.001" value="${escapeAttr(existing?.reorder_level ?? '')}" placeholder="Reorder">
                        <input id="it-cost"  class="studio-input" type="number" step="0.01"  value="${escapeAttr(existing?.cost_per_unit ?? '')}" placeholder="Costo unit.">
                        <input id="it-curr"  class="studio-input" placeholder="USD" value="${escapeAttr(existing?.currency || 'USD')}">
                    </div></div>
                <div class="studio-field"><label class="studio-label">Proveedor</label>
                    <select id="it-supp" class="studio-input">${supplierOpts}</select></div>
                <button class="studio-btn studio-btn-primary" id="it-save"><i class="fa-solid fa-floppy-disk"></i> Guardar</button>
            </div>
        `;
        document.getElementById('item-cancel').addEventListener('click', () => { c.innerHTML = ''; });
        // (no photo upload field for items in v1 — items are tracked by SKU/name; can be added later)

        document.getElementById('it-save').addEventListener('click', guardedAction(async () => {
            const payload = {
                studio_id: studio.id,
                supplier_id: document.getElementById('it-supp').value || null,
                name: document.getElementById('it-name').value.trim(),
                sku:      document.getElementById('it-sku').value.trim() || null,
                category: document.getElementById('it-cat').value.trim() || null,
                unit:     document.getElementById('it-unit').value.trim() || 'unit',
                quantity_on_hand: numOrNull(document.getElementById('it-qty').value) ?? 0,
                reorder_level:    numOrNull(document.getElementById('it-reord').value),
                cost_per_unit:    numOrNull(document.getElementById('it-cost').value),
                currency: document.getElementById('it-curr').value.trim() || 'USD'
            };
            if (!payload.name) { status('inventory-status', 'error', 'Nombre obligatorio.'); return; }
            payload.currency = payload.currency.toUpperCase();
            if (payload.quantity_on_hand < 0 || (payload.reorder_level != null && payload.reorder_level < 0) || (payload.cost_per_unit != null && payload.cost_per_unit < 0) || !/^[A-Z]{3}$/.test(payload.currency)) { status('inventory-status', 'error', 'Revisá cantidades, costo y moneda.'); return; }
            if (existing) delete payload.quantity_on_hand;
            const result = existing
                ? await WeotziData.StudioOps.updateInventoryItem(existing.id, payload)
                : await WeotziData.StudioOps.createInventoryItem(payload);
            if (result.error) { status('inventory-status', 'error', result.error.message); return; }
            status('inventory-status', 'success', 'Item guardado.');
            c.innerHTML = '';
            renderInventoryList(supabase, studio);
        }));
    }
    async function openMovementDialog(supabase, studio, itemId) {
        const c = document.getElementById('item-editor');
        const members = requireResult(await WeotziData.StudioMemberships.listActiveArtists(studio.id));
        const opts = '<option value="">— Sin asignar —</option>' + (members || []).map(m => {
            const a = m.artists_db || {};
            return `<option value="${escapeAttr(a.user_id || m.artist_user_id)}">${escapeHtml(a.name || a.username || a.user_id)}</option>`;
        }).join('');
        c.innerHTML = `
            <div class="studio-location-row" style="margin-bottom:18px;">
                <div class="studio-location-row-head">
                    <span class="studio-section-kicker">Movimiento de stock</span>
                    <button class="studio-location-row-remove" id="mv-cancel">Cancelar</button>
                </div>
                <div class="studio-field"><label class="studio-label">Tipo</label>
                    <select id="mv-kind" class="studio-input">
                        <option value="restock">Restock (entrada)</option>
                        <option value="consumption">Consumo</option>
                        <option value="loss">Pérdida</option>
                        <option value="adjustment">Ajuste</option>
                    </select></div>
                <div class="studio-field"><label class="studio-label">Cantidad</label>
                    <input id="mv-qty" class="studio-input" type="number" step="0.001" placeholder="Cantidad"></div>
                <div class="studio-field"><label class="studio-label">Artista (consumo)</label>
                    <select id="mv-artist" class="studio-input">${opts}</select></div>
                <div class="studio-field"><label class="studio-label">Notas</label>
                    <textarea id="mv-notes" class="studio-textarea" rows="2"></textarea></div>
                <button class="studio-btn studio-btn-primary" id="mv-save"><i class="fa-solid fa-floppy-disk"></i> Registrar</button>
                <div id="movement-history" style="margin-top:18px;"></div>
            </div>
        `;
        document.getElementById('mv-cancel').addEventListener('click', () => { c.innerHTML = ''; });
        document.getElementById('mv-save').addEventListener('click', guardedAction(async () => {
            const payload = {
                item_id: itemId,
                studio_id: studio.id,
                kind: document.getElementById('mv-kind').value,
                quantity: numOrNull(document.getElementById('mv-qty').value),
                related_artist_user_id: document.getElementById('mv-artist').value || null,
                notes: document.getElementById('mv-notes').value.trim() || null
            };
            if (!payload.quantity || (payload.kind !== 'adjustment' && payload.quantity < 0)) { status('inventory-status', 'error', 'Ingresá una cantidad positiva. Los ajustes permiten valores negativos.'); return; }
            const { error } = await WeotziData.StudioOps.createInventoryMovement(payload);
            if (error) { status('inventory-status', 'error', error.message); return; }
            status('inventory-status', 'success', 'Movimiento registrado.');
            c.innerHTML = '';
            renderInventoryList(supabase, studio);
        }));
        const history = await WeotziData.StudioOps.listInventoryMovements(itemId);
        const historyHost = document.getElementById('movement-history');
        if (historyHost) historyHost.innerHTML = history.error ? '<p class="studio-help">' + escapeHtml(history.error.message) + '</p>'
            : '<h3 class="studio-section-kicker">Últimos movimientos</h3>' + (history.data?.length ? '<table class="studio-roster-table"><thead><tr><th>Fecha</th><th>Tipo</th><th>Cantidad</th><th>Notas</th></tr></thead><tbody>' + history.data.map(row => '<tr><td>' + fmtDate(row.performed_at) + '</td><td>' + escapeHtml(row.kind) + '</td><td>' + row.quantity + '</td><td>' + escapeHtml(row.notes || '—') + '</td></tr>').join('') + '</tbody></table>' : '<p class="studio-help">Sin movimientos.</p>');
    }

    // -------------------------------------------------------------
    // SUPPLIERS
    // -------------------------------------------------------------
    function wireSuppliersPanel(supabase, studio) {
        renderSuppliersList(supabase, studio);
        document.getElementById('supplier-new-btn').addEventListener('click', guardedAction(() => openSupplierEditor(supabase, studio, null)));
    }
    async function renderSuppliersList(supabase, studio) {
        const el = document.getElementById('suppliers-list');
        const { data, error } = await WeotziData.StudioOps.listSuppliers(studio.id);
        if (error) { el.innerHTML = '<em>' + escapeHtml(error.message) + '</em>'; return; }
        if (!data || data.length === 0) { el.innerHTML = '<p class="studio-help">Sin proveedores cargados.</p>'; return; }
        el.innerHTML = `
            <table class="studio-roster-table">
                <thead><tr><th>Nombre</th><th>Categorías</th><th>Email</th><th>Tel.</th><th>Web</th><th>Acciones</th></tr></thead>
                <tbody>${data.map(s => `
                    <tr>
                        <td><strong>${escapeHtml(s.name)}</strong></td>
                        <td>${(s.categories || []).map(c => `<span class="studio-style-pill">${escapeHtml(c)}</span>`).join(' ') || '—'}</td>
                        <td>${escapeHtml(s.contact_email || '—')}</td>
                        <td>${escapeHtml(s.contact_phone || '—')}</td>
                        <td>${s.website ? `<a href="${escapeAttr(s.website)}" target="_blank" style="color:var(--primary-red);">${escapeHtml(s.website)}</a>` : '—'}</td>
                        <td>
                            <button class="studio-locations-add" data-action="edit" data-id="${escapeAttr(s.id)}" style="border-style:solid;padding:4px 8px;">Editar</button>
                            <button class="studio-location-row-remove" data-action="delete" data-id="${escapeAttr(s.id)}">Borrar</button>
                        </td>
                    </tr>`).join('')}
                </tbody>
            </table>
        `;
        el.querySelectorAll('button[data-action]').forEach(btn => {
            btn.addEventListener('click', guardedAction(async () => {
                if (btn.dataset.action === 'edit') {
                    const row = requireResult(await WeotziData.StudioOps.getSupplierById(btn.dataset.id));
                    await openSupplierEditor(supabase, studio, row);
                } else if (btn.dataset.action === 'delete') {
                    if (!confirm('¿Borrar proveedor?')) return;
                    requireResult(await WeotziData.StudioOps.deleteSupplier(btn.dataset.id));
                    renderSuppliersList(supabase, studio);
                }
            }));
        });
    }
    function openSupplierEditor(supabase, studio, existing) {
        const c = document.getElementById('supplier-editor');
        c.innerHTML = `
            <div class="studio-location-row" style="margin-bottom:18px;">
                <div class="studio-location-row-head">
                    <span class="studio-section-kicker">${existing ? 'Editar proveedor' : 'Nuevo proveedor'}</span>
                    <button class="studio-location-row-remove" id="sup-cancel">Cancelar</button>
                </div>
                <div class="studio-field"><label class="studio-label">Nombre</label><input id="sup-name" class="studio-input" value="${escapeAttr(existing?.name || '')}"></div>
                <div class="studio-field"><label class="studio-label">Categorías (coma)</label><input id="sup-cats" class="studio-input" value="${escapeAttr((existing?.categories || []).join(', '))}"></div>
                <div class="studio-field"><label class="studio-label">Email / Tel. / Web</label>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;">
                        <input id="sup-email" class="studio-input" type="email" placeholder="Email" value="${escapeAttr(existing?.contact_email || '')}">
                        <input id="sup-phone" class="studio-input" placeholder="Teléfono" value="${escapeAttr(existing?.contact_phone || '')}">
                        <input id="sup-web"   class="studio-input" type="url" placeholder="Sitio" value="${escapeAttr(existing?.website || '')}">
                    </div></div>
                <div class="studio-field"><label class="studio-label">Notas</label><textarea id="sup-notes" class="studio-textarea" rows="2">${escapeHtml(existing?.notes || '')}</textarea></div>
                <button class="studio-btn studio-btn-primary" id="sup-save"><i class="fa-solid fa-floppy-disk"></i> Guardar</button>
            </div>
        `;
        document.getElementById('sup-cancel').addEventListener('click', () => { c.innerHTML = ''; });
        document.getElementById('sup-save').addEventListener('click', guardedAction(async () => {
            const payload = {
                studio_id: studio.id,
                name: document.getElementById('sup-name').value.trim(),
                categories: (document.getElementById('sup-cats').value || '').split(',').map(s => s.trim()).filter(Boolean),
                contact_email: document.getElementById('sup-email').value.trim() || null,
                contact_phone: document.getElementById('sup-phone').value.trim() || null,
                website: document.getElementById('sup-web').value.trim() || null,
                notes: document.getElementById('sup-notes').value.trim() || null
            };
            if (!payload.name) { status('suppliers-status', 'error', 'Nombre obligatorio.'); return; }
            const result = existing
                ? await WeotziData.StudioOps.updateSupplier(existing.id, payload)
                : await WeotziData.StudioOps.createSupplier(payload);
            if (result.error) { status('suppliers-status', 'error', result.error.message); return; }
            status('suppliers-status', 'success', 'Proveedor guardado.');
            c.innerHTML = '';
            renderSuppliersList(supabase, studio);
        }));
    }

    // -------------------------------------------------------------
    // SPONSORS
    // -------------------------------------------------------------
    function wireSponsorsPanel(supabase, studio) {
        renderSponsorsList(supabase, studio);
        document.getElementById('sponsor-new-btn').addEventListener('click', guardedAction(() => openSponsorEditor(supabase, studio, null)));
    }
    async function renderSponsorsList(supabase, studio) {
        const el = document.getElementById('sponsors-list');
        const { data, error } = await WeotziData.StudioOps.listSponsors(studio.id);
        if (error) { el.innerHTML = '<em>' + escapeHtml(error.message) + '</em>'; return; }
        if (!data || data.length === 0) { el.innerHTML = '<p class="studio-help">Sin sponsors cargados.</p>'; return; }
        const { data: links } = await WeotziData.StudioOps.listSponsorArtistsBySponsorIds(data.map(sp => sp.id));
        const artistsBySponsor = new Map();
        (links || []).forEach(link => {
            const a = link.artists_db || {};
            const list = artistsBySponsor.get(link.sponsor_id) || [];
            list.push(a.name || a.username || link.artist_user_id);
            artistsBySponsor.set(link.sponsor_id, list);
        });
        el.innerHTML = `
            <table class="studio-roster-table">
                <thead><tr><th>Sponsor</th><th>Tier</th><th>Artistas</th><th>Vigencia</th><th>Valor mensual</th><th>Público</th><th>Acciones</th></tr></thead>
                <tbody>${data.map(sp => `
                    <tr>
                        <td>
                            ${sp.logo_url ? `<img src="${escapeAttr(sp.logo_url)}" alt="" style="height:28px;vertical-align:middle;margin-right:6px;">` : ''}
                            <strong>${escapeHtml(sp.name)}</strong>
                        </td>
                        <td><span class="studio-role-pill role-${sp.tier === 'gold' ? 'resident' : (sp.tier === 'platinum' ? 'manager' : 'guest')}">${escapeHtml(sp.tier)}</span></td>
                        <td>${(artistsBySponsor.get(sp.id) || []).map(name => `<span class="studio-style-pill">${escapeHtml(name)}</span>`).join(' ') || '—'}</td>
                        <td>${fmtDate(sp.starts_on)} – ${fmtDate(sp.ends_on)}</td>
                        <td>${fmtMoney(sp.monthly_value, sp.currency)}</td>
                        <td>${sp.is_public ? 'Sí' : 'No'}</td>
                        <td>
                            <button class="studio-locations-add" data-action="edit"   data-id="${escapeAttr(sp.id)}" style="border-style:solid;padding:4px 8px;">Editar</button>
                            <button class="studio-location-row-remove" data-action="delete" data-id="${escapeAttr(sp.id)}">Borrar</button>
                        </td>
                    </tr>`).join('')}
                </tbody>
            </table>
        `;
        el.querySelectorAll('button[data-action]').forEach(btn => {
            btn.addEventListener('click', guardedAction(async () => {
                if (btn.dataset.action === 'edit') {
                    const row = requireResult(await WeotziData.StudioOps.getSponsorById(btn.dataset.id));
                    await openSponsorEditor(supabase, studio, row);
                } else if (btn.dataset.action === 'delete') {
                    if (!confirm('¿Borrar sponsor?')) return;
                    requireResult(await WeotziData.StudioOps.deleteSponsor(btn.dataset.id));
                    renderSponsorsList(supabase, studio);
                }
            }));
        });
    }
    async function openSponsorEditor(supabase, studio, existing) {
        const c = document.getElementById('sponsor-editor');
        const [membersResult, linksResult] = await Promise.all([
            WeotziData.StudioMemberships.listActiveArtists(studio.id, { withRole: true }),
            existing?.id
                ? WeotziData.StudioOps.listSponsorArtistIds(existing.id)
                : Promise.resolve({ data: [] })
        ]);
        const members = requireResult(membersResult);
        const existingLinks = requireResult(linksResult);
        const selectedArtists = new Set((existingLinks || []).map(row => row.artist_user_id));
        const artistOptions = (members || []).map(m => {
            const a = m.artists_db || {};
            const id = a.user_id || m.artist_user_id;
            const label = a.name || a.username || id;
            return `
                <label class="studio-check-card">
                    <input type="checkbox" name="sp-artist" value="${escapeAttr(id)}" ${selectedArtists.has(id) ? 'checked' : ''}>
                    <span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(m.role || 'artist')}</small></span>
                </label>
            `;
        }).join('');
        c.innerHTML = `
            <div class="studio-location-row" style="margin-bottom:18px;">
                <div class="studio-location-row-head">
                    <span class="studio-section-kicker">${existing ? 'Editar sponsor' : 'Nuevo sponsor'}</span>
                    <button class="studio-location-row-remove" id="sp-cancel">Cancelar</button>
                </div>
                <div class="studio-field"><label class="studio-label">Nombre</label>
                    <input id="sp-name" class="studio-input" value="${escapeAttr(existing?.name || '')}"></div>
                <div class="studio-field"><label class="studio-label">Tier</label>
                    <select id="sp-tier" class="studio-input">
                        ${['bronze','silver','gold','platinum'].map(t => `<option value="${t}" ${existing?.tier === t ? 'selected' : ''}>${t}</option>`).join('')}
                    </select></div>
                <div class="studio-field"><label class="studio-label">Logo URL / Web</label>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;">
                        <input id="sp-logo" class="studio-input" type="url" placeholder="Logo" value="${escapeAttr(existing?.logo_url || '')}">
                        <input id="sp-web"  class="studio-input" type="url" placeholder="Sitio" value="${escapeAttr(existing?.website || '')}">
                    </div></div>
                <div class="studio-field"><label class="studio-label">Vigencia y monto</label>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;">
                        <input id="sp-from" class="studio-input" type="date" value="${escapeAttr(existing?.starts_on || '')}">
                        <input id="sp-to"   class="studio-input" type="date" value="${escapeAttr(existing?.ends_on || '')}">
                        <input id="sp-amt"  class="studio-input" type="number" step="0.01" placeholder="Mensual" value="${escapeAttr(existing?.monthly_value ?? '')}">
                        <input id="sp-curr" class="studio-input" placeholder="USD" value="${escapeAttr(existing?.currency || 'USD')}">
                    </div></div>
                <div class="studio-field" style="display:flex;gap:18px;align-items:center;">
                    <label style="display:inline-flex;gap:6px;align-items:center;font-family:var(--studio-mono);font-size:.7rem;letter-spacing:.12em;text-transform:uppercase;font-weight:700;">
                        <input id="sp-public" type="checkbox" ${existing?.is_public !== false ? 'checked' : ''}> Mostrar en perfil público
                    </label>
                </div>
                <div class="studio-field">
                    <label class="studio-label">Artistas sponsoreados</label>
                    <div class="studio-check-grid" id="sp-artists">
                        ${artistOptions || '<p class="studio-help">Todavía no hay artistas activos en el roster.</p>'}
                    </div>
                </div>
                <button class="studio-btn studio-btn-primary" id="sp-save"><i class="fa-solid fa-floppy-disk"></i> Guardar</button>
            </div>
        `;
        // Wire uploader on the sponsor logo field.
        if (window.WeOtziUploader) {
            window.WeOtziUploader.attach(document.getElementById('sp-logo'), {
                supabase,
                bucket: 'studio-photos',
                pathPrefix: studio.id + '/sponsors',
                accept: 'image/*',
                placeholder: 'pegá la URL del logo'
            });
        }

        document.getElementById('sp-cancel').addEventListener('click', () => { c.innerHTML = ''; });
        document.getElementById('sp-save').addEventListener('click', guardedAction(async () => {
            const payload = {
                studio_id: studio.id,
                name: document.getElementById('sp-name').value.trim(),
                tier: document.getElementById('sp-tier').value,
                logo_url: document.getElementById('sp-logo').value.trim() || null,
                website:  document.getElementById('sp-web').value.trim() || null,
                starts_on: document.getElementById('sp-from').value || null,
                ends_on:   document.getElementById('sp-to').value || null,
                monthly_value: numOrNull(document.getElementById('sp-amt').value),
                currency: document.getElementById('sp-curr').value.trim() || 'USD',
                is_public: document.getElementById('sp-public').checked
            };
            if (!payload.name) { status('sponsors-status', 'error', 'Nombre obligatorio.'); return; }
            if ((payload.ends_on && payload.starts_on && payload.ends_on < payload.starts_on) || (payload.monthly_value != null && payload.monthly_value < 0) || (payload.website && !validUrl(payload.website)) || (payload.logo_url && !validUrl(payload.logo_url))) { status('sponsors-status', 'error', 'Revisá fechas, importe y enlaces.'); return; }
            const result = existing
                ? await WeotziData.StudioOps.updateSponsor(existing.id, payload)
                : await WeotziData.StudioOps.createSponsor(payload);
            if (result.error) { status('sponsors-status', 'error', result.error.message); return; }
            existing = result.data;
            try {
                await saveSponsorArtists(supabase, result.data.id);
            } catch (err) {
                status('sponsors-status', 'error', err.message || 'Sponsor guardado, pero no pudimos asignar artistas.');
                return;
            }
            status('sponsors-status', 'success', 'Sponsor guardado.');
            c.innerHTML = '';
            renderSponsorsList(supabase, studio);
        }));
    }

    async function saveSponsorArtists(supabase, sponsorId) {
        const selected = Array.from(document.querySelectorAll('input[name="sp-artist"]:checked'))
            .map(input => input.value)
            .filter(Boolean);
        requireResult(await WeotziData.StudioOps.replaceSponsorArtists(sponsorId, selected));
    }

    // -------------------------------------------------------------
    // ANALYTICS  (read views, render aggregates)
    // -------------------------------------------------------------
    async function wireAnalyticsPanel(supabase, studio) {
        const sumEl = document.getElementById('analytics-summary');
        const monEl = document.getElementById('analytics-monthly');
        const artEl = document.getElementById('analytics-artist');

        const [monthsRes, artistsRes] = await Promise.all([
            WeotziData.StudioOps.getDashboardMetrics(studio.id),
            WeotziData.StudioOps.getArtistPerformance(studio.id)
        ]);
        if (monthsRes.error || artistsRes.error) {
            sumEl.innerHTML = '<p class="studio-status studio-status-error">' + escapeHtml(monthsRes.error?.message || artistsRes.error?.message) + '</p>';
            monEl.innerHTML = ''; artEl.innerHTML = ''; return;
        }

        // Summary card
        const months = monthsRes.data || [];
        const totalJobs   = months.reduce((s, m) => s + Number(m.jobs_count || 0), 0);
        const totalClients = months.reduce((s, m) => s + Number(m.unique_clients || 0), 0);
        sumEl.innerHTML = `
            <div class="studio-meta-grid">
                <div class="studio-meta-row"><span class="key">Bruto (12 meses)</span><span class="val">${sumCurrencies(months, 'gross_amount')}</span></div>
                <div class="studio-meta-row"><span class="key">Neto al estudio</span><span class="val">${sumCurrencies(months, 'studio_net')}</span></div>
                <div class="studio-meta-row"><span class="key">Trabajos</span>      <span class="val">${totalJobs}</span></div>
                <div class="studio-meta-row"><span class="key">Clientes por mes y moneda (suma)</span><span class="val">${totalClients}</span></div>
            </div>
        `;

        // Monthly table
        if (months.length === 0) {
            monEl.innerHTML = '<p class="studio-help">Sin datos suficientes. Registrá trabajos para ver métricas.</p>';
        } else {
            monEl.innerHTML = `
                <table class="studio-roster-table">
                    <thead><tr><th>Mes</th><th>Trabajos</th><th>Bruto</th><th>Neto</th><th>Pagado a artistas</th><th>Ticket promedio</th></tr></thead>
                    <tbody>${months.map(m => `
                        <tr>
                            <td>${calendarDate(m.month).toLocaleDateString('es-AR', { month: 'short', year: 'numeric' })}</td>
                            <td>${m.jobs_count}</td>
                            <td>${fmtMoney(m.gross_amount, m.currency)}</td>
                            <td>${fmtMoney(m.studio_net, m.currency)}</td>
                            <td>${fmtMoney(m.paid_to_artists, m.currency)}</td>
                            <td>${fmtMoney(m.avg_ticket, m.currency)}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            `;
        }

        // Per-artist
        const artists = artistsRes.data || [];
        if (artists.length === 0) {
            artEl.innerHTML = '<p class="studio-help">Aún no hay performance por artista.</p>';
        } else {
            artEl.innerHTML = `
                <table class="studio-roster-table">
                    <caption class="studio-help">20 principales resultados por artista y moneda · últimos 12 meses</caption>
                    <thead><tr><th>Artista</th><th>Trabajos</th><th>Bruto</th><th>Ticket prom.</th><th>Supplies</th><th>Último trabajo</th></tr></thead>
                    <tbody>${artists.map(a => `
                        <tr>
                            <td><strong>${escapeHtml(a.name || a.username || '—')}</strong></td>
                            <td>${a.jobs_count}</td>
                            <td>${fmtMoney(a.gross_billed, a.currency)}</td>
                            <td>${fmtMoney(a.avg_ticket, a.currency)}</td>
                            <td>${fmtMoney(a.supplies_consumed_cost, a.currency)}</td>
                            <td>${a.days_since_last_job != null ? `hace ${a.days_since_last_job} días` : '—'}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            `;
        }
    }
})();
