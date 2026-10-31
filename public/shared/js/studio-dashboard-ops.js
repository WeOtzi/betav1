// ============================================
// Studio Dashboard — Operations / Inventory / Suppliers / Sponsors / Analytics
// (Phases D, E, F).
//
// Companion to studio-dashboard.js. Designed to be loaded AFTER it so that
// `window.studio` and `window._supabase` exist.
//
// La agenda de citas vive en studio-dashboard-agenda.js (pestaña Agenda) y los
// materiales por artista en studio-dashboard-materials.js (#inventory-materials).
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

    // Eventos entre módulos del panel (se despachan en `document`):
    //   - weotzi:studio-jobs-changed: la Agenda completó una cita y creó un
    //     trabajo → se vuelven a pintar Trabajos y Clientes.
    //   - weotzi:studio-inventory-changed ({detail: {source}}): cambió el stock
    //     o los materiales entregados (Movimiento acá, o Entregar/Devolver en
    //     studio-dashboard-materials.js) → cada lado refresca lo suyo.
    const JOBS_CHANGED_EVENT = 'weotzi:studio-jobs-changed';
    const INVENTORY_CHANGED_EVENT = 'weotzi:studio-inventory-changed';

    whenReady((supabase, studio) => {
        wireOpsSubnav();
        wireJobsPanel(supabase, studio);
        wireClientsPanel(supabase, studio);
        wireInvoicesPanel(supabase, studio);
        wireDocumentsPanel(supabase, studio);
        wireInventoryPanel(supabase, studio);
        wireSuppliersPanel(supabase, studio);
        wireSponsorsPanel(supabase, studio);
        wireAnalyticsPanel(supabase, studio);
        wireCrossModuleEvents(supabase, studio);
        document.querySelector('[data-tab="analytics"]')?.addEventListener('click', () => wireAnalyticsPanel(supabase, studio));
        document.querySelector('[data-sub="clients"]')?.addEventListener('click', () => renderClientsList(supabase, studio));
    });

    function wireCrossModuleEvents(supabase, studio) {
        document.addEventListener(JOBS_CHANGED_EVENT, () => onJobsChanged(supabase, studio));
        document.addEventListener(INVENTORY_CHANGED_EVENT, event => {
            // Lo que dispara este archivo ya repintó su lista.
            if (event?.detail?.source === 'ops') return;
            renderInventoryList(supabase, studio).catch(error => status('inventory-status', 'error', error.message || 'No pudimos actualizar el inventario.'));
        });
    }
    function onJobsChanged(supabase, studio) {
        return Promise.all([renderJobsList(supabase, studio), renderClientsList(supabase, studio)])
            .catch(error => status('ops-status', 'error', error.message || 'No pudimos actualizar los trabajos.'));
    }
    function emitInventoryChanged(detail) {
        if (typeof CustomEvent !== 'function' || typeof document.dispatchEvent !== 'function') return;
        document.dispatchEvent(new CustomEvent(INVENTORY_CHANGED_EVENT, { detail: { source: 'ops', ...detail } }));
    }

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
            ['jobs', 'clients', 'invoices', 'documents'].forEach(s => {
                document.getElementById('ops-sub-' + s).style.display = s === sub ? '' : 'none';
                document.getElementById('ops-sub-' + s).classList.toggle('is-active', s === sub);
            });
        });
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
                    await openMovementDialog(supabase, studio, btn.dataset.id, data.find(item => item.id === btn.dataset.id));
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
    // -------------------------------------------------------------
    // Movimientos de stock. 'assignment' (entrega a artista, resta stock) y
    // 'return' (devolución, suma stock) llegan con M3
    // (20261030202000_studio_agenda_inventory): exigen artista y el costo
    // unitario se precarga (el del ítem; en devoluciones, el promedio de lo
    // que el artista tiene entregado). Sin M3 esos dos tipos no se ofrecen.
    // -------------------------------------------------------------
    const MOVEMENT_KINDS = ['restock', 'consumption', 'loss', 'adjustment', 'assignment', 'return'];
    const ARTIST_MOVEMENTS = ['assignment', 'return'];
    const MOVEMENT_OPTION_LABELS = {
        restock: 'Reposición (entrada)', consumption: 'Consumo', loss: 'Pérdida', adjustment: 'Ajuste (±)',
        assignment: 'Entrega a artista (salida)', return: 'Devolución de artista (entrada)'
    };
    const MOVEMENT_LABELS = {
        restock: 'Reposición', consumption: 'Consumo', adjustment: 'Ajuste', loss: 'Pérdida',
        assignment: 'Entrega a artista', return: 'Devolución'
    };
    // Signo del movimiento sobre el stock (mismo criterio que apply_inventory_movement).
    const MOVEMENT_SIGN = { restock: 1, adjustment: 1, return: 1, consumption: -1, loss: -1, assignment: -1 };
    const MIGRATION_PENDING = 'Esta función todavía no está disponible (falta aplicar una migración).';

    function movementLabel(kind) {
        const labels = window.WeOtziStudioKit?.LABELS?.movementKind || MOVEMENT_LABELS;
        return labels[kind] || MOVEMENT_LABELS[kind] || 'Otro';
    }
    function fmtQty(value) {
        const n = Number(value);
        if (!Number.isFinite(n)) return '—';
        return n.toLocaleString('es-AR', { maximumFractionDigits: 3 });
    }
    // Costo unitario promedio de lo que el artista todavía tiene entregado
    // (assigned_cost / net_assigned_qty), redondeado a centavos. Sin saldo o sin
    // costo, el fallback (el cost_per_unit del ítem).
    function outstandingUnitCost(row, fallback) {
        const net = Number(row?.net_assigned_qty);
        const cost = Number(row?.assigned_cost);
        if (net > 0 && Number.isFinite(cost) && cost > 0) return Math.round((cost / net) * 100) / 100;
        return fallback ?? null;
    }
    // Nombres por user_id: roster activo y, para ex integrantes que todavía
    // tienen material, artists_db por id. Nunca lanza.
    async function artistNames(members, ids) {
        const names = new Map();
        (members || []).forEach(m => {
            const id = m.artists_db?.user_id || m.artist_user_id;
            if (id) names.set(id, m.artists_db?.name || m.artists_db?.username || 'Artista');
        });
        const missing = Array.from(new Set((ids || []).filter(id => id && !names.has(id))));
        if (missing.length && typeof WeotziData.Artists?.listByUserIds === 'function') {
            try {
                const { data } = await WeotziData.Artists.listByUserIds(missing, 'user_id, name, username');
                (data || []).forEach(a => names.set(a.user_id, a.name || a.username || 'Artista'));
            } catch (_) { /* quedan como "Artista" */ }
        }
        return names;
    }
    // <option>s del artista según el tipo: entrega → activos (obligatorio);
    // devolución → quienes tienen saldo de este ítem; resto → opcional.
    function movementArtistOptions(kind, members, balanceRows, names, selected) {
        const option = (id, text) => `<option value="${escapeAttr(id)}" ${id === selected ? 'selected' : ''}>${escapeHtml(text)}</option>`;
        const active = (members || []).map(m => m.artists_db?.user_id || m.artist_user_id).filter(Boolean);
        // Sin balance (falló la lectura): se ofrecen los activos y valida el trigger.
        if (kind === 'return' && !Array.isArray(balanceRows)) {
            return '<option value="">Elegí quién devuelve</option>' + active.map(id => option(id, names.get(id) || 'Artista')).join('');
        }
        if (kind === 'return') {
            const holders = (balanceRows || []).filter(row => Number(row.net_assigned_qty) > 0);
            if (!holders.length) return '<option value="">Nadie tiene este ítem por devolver</option>';
            return '<option value="">Elegí quién devuelve</option>' + holders.map(row =>
                option(row.artist_user_id, `${names.get(row.artist_user_id) || 'Artista'} · tiene ${fmtQty(row.net_assigned_qty)} ${row.unit || ''}`.trim())).join('');
        }
        const list = active.map(id => option(id, names.get(id) || 'Artista')).join('');
        if (kind === 'assignment') return '<option value="">Elegí a quién se lo entregás</option>' + list;
        return '<option value="">— Sin asignar —</option>' + list;
    }
    // Valida el formulario y arma la fila de studio_inventory_movements.
    // input: {kind, quantity, artist, cost, notes} (valores crudos del form);
    // ctx: {item, studioId, balanceRows, materialsReady}. Lanza Error con el
    // mensaje para el usuario.
    function buildMovementPayload(input, ctx) {
        const item = ctx.item || {};
        const kind = String(input.kind || '');
        if (!MOVEMENT_KINDS.includes(kind)) throw new Error('Elegí un tipo de movimiento.');
        if (ARTIST_MOVEMENTS.includes(kind) && ctx.materialsReady === false) throw new Error(MIGRATION_PENDING);
        const quantity = numOrNull(String(input.quantity ?? '').replace(',', '.'));
        if (!quantity || (kind !== 'adjustment' && quantity < 0)) throw new Error('Ingresá una cantidad positiva. Los ajustes permiten valores negativos.');
        const artist = String(input.artist || '').trim() || null;
        if (kind === 'assignment' && !artist) throw new Error('Elegí el artista que recibe el material.');
        if (kind === 'return' && !artist) throw new Error('Elegí el artista que devuelve el material.');
        const unitText = item.unit ? ' ' + item.unit : '';
        const stock = item.quantity_on_hand == null ? NaN : Number(item.quantity_on_hand);
        const delta = (MOVEMENT_SIGN[kind] || 0) * quantity;
        if (delta < 0 && Number.isFinite(stock) && stock + delta < 0) {
            throw new Error(`No hay stock suficiente de ${item.name || 'este ítem'}: quedan ${fmtQty(Math.max(stock, 0))}${unitText}.`);
        }
        if (kind === 'return' && Array.isArray(ctx.balanceRows)) {
            const held = Number(ctx.balanceRows.find(row => row.artist_user_id === artist)?.net_assigned_qty) || 0;
            if (quantity > held) throw new Error(`La devolución supera lo entregado: quedan ${fmtQty(Math.max(held, 0))}${unitText} por devolver.`);
        }
        const cost = numOrNull(String(input.cost ?? '').replace(',', '.'));
        if (cost != null && cost < 0) throw new Error('El costo unitario no puede ser negativo.');
        return {
            item_id: item.id,
            studio_id: ctx.studioId,
            kind,
            quantity,
            related_artist_user_id: artist,
            unit_cost: cost,
            notes: String(input.notes || '').trim() || null
        };
    }
    // Sin M3, el CHECK vivo de kind rechaza entrega/devolución: se traduce al
    // aviso de migración pendiente (Reglas transversales §5).
    function movementSaveError(error) {
        const text = String(error?.message || '') + ' ' + String(error?.details || '');
        if (/studio_inventory_movements_kind_check|studio_inventory_movements_artist_required/.test(text)) return new Error(MIGRATION_PENDING);
        const kit = window.WeOtziStudioKit;
        const message = kit?.friendlyError ? kit.friendlyError(error) : (error?.message || '');
        return new Error(message || 'No pudimos registrar el movimiento. Intentá nuevamente.');
    }
    function movementHistoryHtml(rows, names, item) {
        if (!rows?.length) return '<p class="studio-help">Sin movimientos.</p>';
        const currency = item?.currency;
        const unit = item?.unit ? ' ' + escapeHtml(item.unit) : '';
        return '<table class="studio-roster-table"><thead><tr><th>Fecha</th><th>Tipo</th><th>Cantidad</th><th>Artista</th><th>Costo unit.</th><th>Costo total</th><th>Notas</th></tr></thead><tbody>'
            + rows.map(row => {
                const sign = MOVEMENT_SIGN[row.kind] || 0;
                const qty = Number(row.quantity);
                const shown = sign < 0 ? '−' + fmtQty(Math.abs(qty)) : (sign > 0 && qty > 0 ? '+' : '') + fmtQty(qty);
                const total = row.unit_cost == null || !Number.isFinite(qty) ? null : Math.abs(qty) * Number(row.unit_cost);
                const artist = row.related_artist_user_id ? escapeHtml(names?.get(row.related_artist_user_id) || 'Artista') : '—';
                return '<tr><td>' + fmtDate(row.performed_at) + '</td><td>' + escapeHtml(movementLabel(row.kind)) + '</td><td>' + shown + unit + '</td><td>'
                    + artist + '</td><td>' + fmtMoney(row.unit_cost, currency) + '</td><td>' + fmtMoney(total, currency) + '</td><td>' + escapeHtml(row.notes || '—') + '</td></tr>';
            }).join('') + '</tbody></table>';
    }

    async function openMovementDialog(supabase, studio, itemId, knownItem) {
        const c = document.getElementById('item-editor');
        const [membersResult, balanceResult, item] = await Promise.all([
            WeotziData.StudioMemberships.listActiveArtists(studio.id),
            typeof WeotziData.StudioOps.listMaterialBalance === 'function'
                ? WeotziData.StudioOps.listMaterialBalance(studio.id) : Promise.resolve({ data: [], error: null, unavailable: true }),
            knownItem && knownItem.id === itemId ? knownItem : WeotziData.StudioOps.getInventoryItemById(itemId).then(requireResult)
        ]);
        const members = requireResult(membersResult) || [];
        // La vista de balance es de M3: si no está, tampoco lo están los tipos nuevos.
        const materialsReady = !balanceResult?.unavailable;
        const balanceRows = balanceResult?.error ? null : (balanceResult?.data || []).filter(row => row.item_id === itemId);
        const names = await artistNames(members, (balanceRows || []).map(row => row.artist_user_id));
        const kinds = MOVEMENT_KINDS.filter(kind => materialsReady || !ARTIST_MOVEMENTS.includes(kind));
        const unit = escapeHtml(item?.unit || 'unit');
        const currency = escapeHtml(String(item?.currency || 'USD').toUpperCase());
        c.innerHTML = `
            <div class="studio-location-row" style="margin-bottom:18px;">
                <div class="studio-location-row-head">
                    <span class="studio-section-kicker">Movimiento de stock · ${escapeHtml(item?.name || 'Ítem')}</span>
                    <button class="studio-location-row-remove" id="mv-cancel">Cancelar</button>
                </div>
                <div class="studio-field"><label class="studio-label" for="mv-kind">Tipo</label>
                    <select id="mv-kind" class="studio-input">${kinds.map(kind => `<option value="${kind}">${escapeHtml(MOVEMENT_OPTION_LABELS[kind])}</option>`).join('')}</select>
                    ${materialsReady ? '' : '<span class="studio-help">Las entregas y devoluciones a artistas se habilitan cuando se aplique la migración de inventario.</span>'}</div>
                <div class="studio-field"><label class="studio-label" for="mv-qty">Cantidad (${unit})</label>
                    <input id="mv-qty" class="studio-input" type="number" step="0.001" placeholder="Cantidad">
                    <span class="studio-help">Stock actual: ${escapeHtml(fmtQty(item?.quantity_on_hand))} ${unit}</span></div>
                <div class="studio-field"><label class="studio-label" for="mv-artist" id="mv-artist-label">Artista (opcional)</label>
                    <select id="mv-artist" class="studio-input">${movementArtistOptions('restock', members, balanceRows, names, null)}</select></div>
                <div class="studio-field"><label class="studio-label" for="mv-cost">Costo unitario (${currency})</label>
                    <input id="mv-cost" class="studio-input" type="number" step="0.01" min="0" value="${escapeAttr(item?.cost_per_unit ?? '')}" placeholder="Costo unit.">
                    <span class="studio-help" id="mv-cost-help">Se precarga con el costo del ítem; podés corregirlo.</span></div>
                <div class="studio-field"><label class="studio-label" for="mv-notes">Notas</label>
                    <textarea id="mv-notes" class="studio-textarea" rows="2"></textarea></div>
                <button class="studio-btn studio-btn-primary" id="mv-save"><i class="fa-solid fa-floppy-disk"></i> Registrar</button>
                <div id="movement-history" style="margin-top:18px;"></div>
            </div>
        `;
        const kindEl = document.getElementById('mv-kind');
        const artistEl = document.getElementById('mv-artist');
        const costEl = document.getElementById('mv-cost');
        let costTouched = false;
        costEl.addEventListener('input', () => { costTouched = true; });
        const prefillCost = () => {
            if (costTouched) return;
            const row = kindEl.value === 'return' ? (balanceRows || []).find(r => r.artist_user_id === artistEl.value) : null;
            const value = row ? outstandingUnitCost(row, item?.cost_per_unit) : item?.cost_per_unit;
            costEl.value = value == null ? '' : String(value);
        };
        kindEl.addEventListener('change', () => {
            const kind = kindEl.value;
            artistEl.innerHTML = movementArtistOptions(kind, members, balanceRows, names, null);
            if (ARTIST_MOVEMENTS.includes(kind)) artistEl.setAttribute('required', '');
            else artistEl.removeAttribute('required');
            const label = document.getElementById('mv-artist-label');
            if (label) label.textContent = kind === 'assignment' ? 'Artista que recibe (obligatorio)' : kind === 'return' ? 'Artista que devuelve (obligatorio)' : 'Artista (opcional)';
            const help = document.getElementById('mv-cost-help');
            if (help) help.textContent = kind === 'return' ? 'Se precarga con el costo promedio de lo entregado a ese artista.' : 'Se precarga con el costo del ítem; podés corregirlo.';
            prefillCost();
        });
        artistEl.addEventListener('change', prefillCost);
        document.getElementById('mv-cancel').addEventListener('click', () => { c.innerHTML = ''; });
        document.getElementById('mv-save').addEventListener('click', guardedAction(async () => {
            const payload = buildMovementPayload({
                kind: kindEl.value,
                quantity: document.getElementById('mv-qty').value,
                artist: artistEl.value,
                cost: costEl.value,
                notes: document.getElementById('mv-notes').value
            }, { item: { ...item, id: itemId }, studioId: studio.id, balanceRows, materialsReady });
            const { error } = await WeotziData.StudioOps.createInventoryMovement(payload);
            if (error) throw movementSaveError(error);
            status('inventory-status', 'success', payload.kind === 'assignment' ? 'Entrega registrada.' : payload.kind === 'return' ? 'Devolución registrada.' : 'Movimiento registrado.');
            c.innerHTML = '';
            await renderInventoryList(supabase, studio);
            emitInventoryChanged({ kind: payload.kind, item_id: itemId });
        }));
        const history = await WeotziData.StudioOps.listInventoryMovements(itemId);
        const historyHost = document.getElementById('movement-history');
        if (!historyHost) return;
        if (history.error) { historyHost.innerHTML = '<p class="studio-help">' + escapeHtml(history.error.message) + '</p>'; return; }
        const unknown = (history.data || []).map(row => row.related_artist_user_id).filter(id => id && !names.has(id));
        if (unknown.length) (await artistNames([], unknown)).forEach((value, key) => names.set(key, value));
        historyHost.innerHTML = '<h3 class="studio-section-kicker">Últimos movimientos</h3>' + movementHistoryHtml(history.data, names, item);
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
