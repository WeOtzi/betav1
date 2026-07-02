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
        const i = setInterval(() => {
            if (window.WeOtziStudioAuth && window.WeOtziStudioAuth.getSupabase) {
                const studio = window.WeOtziStudioAuth.getCurrent();
                if (studio) { clearInterval(i); cb(window.WeOtziStudioAuth.getSupabase(), studio); }
            }
        }, 100);
        setTimeout(() => clearInterval(i), 12000);
    }

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
        } catch { return `${currency || 'USD'} ${amount}`; }
    }
    function fmtDate(d) { return d ? new Date(d).toLocaleDateString('es-AR') : '—'; }

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
        if (newBtn) newBtn.addEventListener('click', () => openJobEditor(supabase, studio, null));
    }
    async function renderJobsList(supabase, studio) {
        const el = document.getElementById('jobs-list');
        const { data, error } = await WeotziData.StudioOps.listJobs(studio.id);
        if (error) { el.innerHTML = '<em>' + escapeHtml(error.message) + '</em>'; return; }
        if (!data || data.length === 0) { el.innerHTML = '<p class="studio-help">Sin trabajos registrados todavía.</p>'; return; }
        el.innerHTML = `
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
            btn.addEventListener('click', async () => {
                if (btn.dataset.action === 'edit') {
                    const { data: row } = await WeotziData.StudioOps.getJobById(btn.dataset.id);
                    openJobEditor(supabase, studio, row);
                } else if (btn.dataset.action === 'delete') {
                    if (!confirm('¿Eliminar este trabajo?')) return;
                    const { error } = await WeotziData.StudioOps.deleteJob(btn.dataset.id);
                    if (error) status('ops-status', 'error', error.message);
                    else { status('ops-status', 'success', 'Eliminado.'); renderJobsList(supabase, studio); }
                }
            });
        });
    }
    async function openJobEditor(supabase, studio, existing) {
        const c = document.getElementById('job-editor');
        const { data: members } = await WeotziData.StudioMemberships.listActiveArtists(studio.id);
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
                    <input id="job-when" class="studio-input" type="datetime-local" value="${escapeAttr((existing?.performed_at || new Date().toISOString()).slice(0,16))}"></div>
                <div class="studio-field"><label class="studio-label">Artista</label>
                    <select id="job-artist" class="studio-input">${artistOptions || '<option value="">— Sin artistas activos —</option>'}</select></div>
                <div class="studio-field"><label class="studio-label">Cliente (nombre)</label>
                    <input id="job-client" class="studio-input" value="${escapeAttr(existing?.client_display_name || '')}" placeholder="Cliente o anónimo"></div>
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
        document.getElementById('job-save').addEventListener('click', async () => {
            const payload = {
                studio_id: studio.id,
                location_id: studio.primary_location_id || null,
                artist_user_id: document.getElementById('job-artist').value || null,
                client_display_name: document.getElementById('job-client').value.trim() || null,
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
            const result = existing
                ? await WeotziData.StudioOps.updateJob(existing.id, payload)
                : await WeotziData.StudioOps.createJob(payload);
            if (result.error) { status('ops-status', 'error', result.error.message); return; }
            status('ops-status', 'success', existing ? 'Actualizado.' : 'Trabajo registrado.');
            c.innerHTML = '';
            renderJobsList(supabase, studio);
        });
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
        const { data: jobs } = await WeotziData.StudioOps.listJobsForClientAggregation(studio.id);
        if (!jobs || jobs.length === 0) {
            el.innerHTML = '<p class="studio-help">Aún no hay clientes asociados a tus trabajos.</p>';
            return;
        }
        const map = new Map();
        jobs.forEach(j => {
            const key = j.client_user_id || j.client_email || j.client_display_name || 'anonymous';
            const cur = map.get(key) || { name: j.client_display_name || j.client_email || 'Anónimo', email: j.client_email, sessions: 0, gross: 0, last: null };
            cur.sessions += 1;
            cur.gross += Number(j.gross_amount || 0);
            cur.last = !cur.last || new Date(j.performed_at) > new Date(cur.last) ? j.performed_at : cur.last;
            map.set(key, cur);
        });
        const rows = Array.from(map.values()).sort((a, b) => b.gross - a.gross);
        el.innerHTML = `
            <table class="studio-roster-table">
                <thead><tr><th>Cliente</th><th>Sesiones</th><th>Bruto total</th><th>Última visita</th></tr></thead>
                <tbody>${rows.map(c => `
                    <tr>
                        <td><strong>${escapeHtml(c.name)}</strong>${c.email ? `<br><small style="color:var(--text-secondary);font-family:var(--studio-mono);">${escapeHtml(c.email)}</small>` : ''}</td>
                        <td>${c.sessions}</td>
                        <td>${fmtMoney(c.gross, 'USD')}</td>
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
        document.getElementById('invoice-new-btn').addEventListener('click', () => openInvoiceEditor(supabase, studio, null));
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
                            <button class="studio-locations-add" data-action="edit" data-id="${escapeAttr(i.id)}" style="border-style:solid;padding:4px 8px;">Editar</button>
                            ${i.status !== 'paid' ? `<button class="studio-locations-add" data-action="paid" data-id="${escapeAttr(i.id)}" style="border-style:solid;padding:4px 8px;">Marcar pagada</button>` : ''}
                            <button class="studio-location-row-remove" data-action="delete" data-id="${escapeAttr(i.id)}">Borrar</button>
                        </td>
                    </tr>`).join('')}
                </tbody>
            </table>
        `;
        el.querySelectorAll('button[data-action]').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (btn.dataset.action === 'edit') {
                    const { data: row } = await WeotziData.StudioOps.getInvoiceById(btn.dataset.id);
                    openInvoiceEditor(supabase, studio, row);
                } else if (btn.dataset.action === 'paid') {
                    await WeotziData.StudioOps.markInvoicePaid(btn.dataset.id);
                    renderInvoicesList(supabase, studio);
                } else if (btn.dataset.action === 'delete') {
                    if (!confirm('¿Borrar factura?')) return;
                    await WeotziData.StudioOps.deleteInvoice(btn.dataset.id);
                    renderInvoicesList(supabase, studio);
                }
            });
        });
    }
    async function openInvoiceEditor(supabase, studio, existing) {
        const c = document.getElementById('invoice-editor');
        const items = existing
            ? (await WeotziData.StudioOps.listInvoiceItems(existing.id)).data || []
            : [];
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
        document.getElementById('inv-save').addEventListener('click', async () => {
            const headerPayload = {
                studio_id: studio.id,
                invoice_number: document.getElementById('inv-num').value.trim(),
                billed_to_name: document.getElementById('inv-name').value.trim() || null,
                billed_to_email: document.getElementById('inv-email').value.trim() || null,
                billed_to_tax_id: document.getElementById('inv-tax').value.trim() || null,
                issue_date: document.getElementById('inv-issue').value,
                due_date:   document.getElementById('inv-due').value || null,
                currency:   document.getElementById('inv-curr').value.trim() || 'USD',
                tax_amount: numOrNull(document.getElementById('inv-tax-amt').value) ?? 0,
                status:     existing?.status || 'draft'
            };
            const result = existing
                ? await WeotziData.StudioOps.updateInvoice(existing.id, headerPayload)
                : await WeotziData.StudioOps.createInvoice(headerPayload);
            if (result.error) { status('ops-status', 'error', result.error.message); return; }
            const invoiceId = result.data.id;

            // Wipe + re-insert items (simpler than diffing).
            await WeotziData.StudioOps.deleteInvoiceItems(invoiceId);
            const itemRows = Array.from(document.querySelectorAll('#inv-items .studio-location-row')).map((row, idx) => ({
                invoice_id: invoiceId,
                kind: 'custom',
                description: row.querySelector('input[data-field="description"]').value.trim() || 'Item',
                quantity:    numOrNull(row.querySelector('input[data-field="quantity"]').value) ?? 1,
                unit_price:  numOrNull(row.querySelector('input[data-field="unit_price"]').value) ?? 0,
                sort_order:  idx
            }));
            if (itemRows.length) {
                const insertRes = await WeotziData.StudioOps.insertInvoiceItems(itemRows);
                if (insertRes.error) { status('ops-status', 'error', insertRes.error.message); return; }
            }
            status('ops-status', 'success', 'Factura guardada.');
            c.innerHTML = '';
            renderInvoicesList(supabase, studio);
        });
    }

    // -------------------------------------------------------------
    // DOCUMENTS
    // -------------------------------------------------------------
    function wireDocumentsPanel(supabase, studio) {
        renderDocsList(supabase, studio);
        document.getElementById('doc-new-btn').addEventListener('click', () => openDocEditor(supabase, studio, null));
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
                            ${d.file_url ? `<a class="studio-locations-add" href="${escapeAttr(d.file_url)}" target="_blank" style="border-style:solid;padding:4px 8px;text-decoration:none;color:var(--fg);">Ver</a>` : ''}
                            <button class="studio-locations-add" data-action="edit" data-id="${escapeAttr(d.id)}" style="border-style:solid;padding:4px 8px;">Editar</button>
                            <button class="studio-location-row-remove" data-action="delete" data-id="${escapeAttr(d.id)}">Borrar</button>
                        </td>
                    </tr>`).join('')}
                </tbody>
            </table>
        `;
        el.querySelectorAll('button[data-action]').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (btn.dataset.action === 'edit') {
                    const { data: row } = await WeotziData.StudioOps.getDocumentById(btn.dataset.id);
                    openDocEditor(supabase, studio, row);
                } else if (btn.dataset.action === 'delete') {
                    if (!confirm('¿Borrar documento?')) return;
                    await WeotziData.StudioOps.deleteDocument(btn.dataset.id);
                    renderDocsList(supabase, studio);
                }
            });
        });
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
                <div class="studio-field"><label class="studio-label">Archivo (PDF, doc o imagen)</label>
                    <input id="doc-url" class="studio-input" type="url" value="${escapeAttr(existing?.file_url || '')}" placeholder="https://…">
                    <span class="studio-help">Subí un archivo o pegá una URL pública.</span></div>
                <div class="studio-field" style="display:flex;gap:18px;align-items:center;flex-wrap:wrap;">
                    <label style="display:inline-flex;gap:6px;align-items:center;font-family:var(--studio-mono);font-size:.7rem;letter-spacing:.12em;text-transform:uppercase;font-weight:700;">
                        <input id="doc-template" type="checkbox" ${existing?.is_template ? 'checked' : ''}> Plantilla reutilizable
                    </label>
                    <label style="display:inline-flex;gap:6px;align-items:center;font-family:var(--studio-mono);font-size:.7rem;letter-spacing:.12em;text-transform:uppercase;font-weight:700;">
                        <input id="doc-sig" type="checkbox" ${existing?.requires_signature ? 'checked' : ''}> Requiere firma
                    </label>
                </div>
                <button class="studio-btn studio-btn-primary" id="doc-save"><i class="fa-solid fa-floppy-disk"></i> Guardar</button>
            </div>
        `;
        // Wire file uploader on the doc URL field.
        if (window.WeOtziUploader) {
            window.WeOtziUploader.attach(document.getElementById('doc-url'), {
                supabase,
                bucket: 'studio-documents',
                pathPrefix: studio.id + '/' + (existing?.id || 'new'),
                accept: 'application/pdf,image/*,.doc,.docx',
                placeholder: 'pegá una URL pública'
            });
        }

        document.getElementById('doc-cancel').addEventListener('click', () => { c.innerHTML = ''; });
        document.getElementById('doc-save').addEventListener('click', async () => {
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
            const result = existing
                ? await WeotziData.StudioOps.updateDocument(existing.id, payload)
                : await WeotziData.StudioOps.createDocument(payload);
            if (result.error) { status('ops-status', 'error', result.error.message); return; }
            status('ops-status', 'success', 'Documento guardado.');
            c.innerHTML = '';
            renderDocsList(supabase, studio);
        });
    }

    // -------------------------------------------------------------
    // INVENTORY
    // -------------------------------------------------------------
    function wireInventoryPanel(supabase, studio) {
        renderInventoryList(supabase, studio);
        document.getElementById('item-new-btn').addEventListener('click', () => openItemEditor(supabase, studio, null));
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
                                <button class="studio-location-row-remove" data-action="delete" data-id="${escapeAttr(it.id)}">Borrar</button>
                            </td>
                        </tr>`;
                }).join('')}
                </tbody>
            </table>
        `;
        el.querySelectorAll('button[data-action]').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (btn.dataset.action === 'edit') {
                    const { data: row } = await WeotziData.StudioOps.getInventoryItemById(btn.dataset.id);
                    openItemEditor(supabase, studio, row);
                } else if (btn.dataset.action === 'move') {
                    openMovementDialog(supabase, studio, btn.dataset.id);
                } else if (btn.dataset.action === 'delete') {
                    if (!confirm('¿Borrar item? Sus movimientos también se borran.')) return;
                    await WeotziData.StudioOps.deleteInventoryItem(btn.dataset.id);
                    renderInventoryList(supabase, studio);
                }
            });
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
        const stockValue = items.reduce((sum, it) => {
            if (it.stock_value != null) return sum + Number(it.stock_value || 0);
            return sum + (Number(it.quantity_on_hand || 0) * Number(it.cost_per_unit || 0));
        }, 0);
        const currency = (items.find(it => it.currency)?.currency || 'USD').toUpperCase();
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
                <strong>${fmtMoney(stockValue, currency)}</strong>
            </div>
        `;
    }
    async function openItemEditor(supabase, studio, existing) {
        const c = document.getElementById('item-editor');
        const { data: suppliers } = await WeotziData.StudioOps.listSupplierOptions(studio.id);
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
                        <input id="it-qty"   class="studio-input" type="number" step="0.001" value="${escapeAttr(existing?.quantity_on_hand ?? 0)}" placeholder="Stock">
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

        document.getElementById('it-save').addEventListener('click', async () => {
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
            const result = existing
                ? await WeotziData.StudioOps.updateInventoryItem(existing.id, payload)
                : await WeotziData.StudioOps.createInventoryItem(payload);
            if (result.error) { status('inventory-status', 'error', result.error.message); return; }
            status('inventory-status', 'success', 'Item guardado.');
            c.innerHTML = '';
            renderInventoryList(supabase, studio);
        });
    }
    async function openMovementDialog(supabase, studio, itemId) {
        const c = document.getElementById('item-editor');
        const { data: members } = await WeotziData.StudioMemberships.listActiveArtists(studio.id);
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
            </div>
        `;
        document.getElementById('mv-cancel').addEventListener('click', () => { c.innerHTML = ''; });
        document.getElementById('mv-save').addEventListener('click', async () => {
            const payload = {
                item_id: itemId,
                studio_id: studio.id,
                kind: document.getElementById('mv-kind').value,
                quantity: numOrNull(document.getElementById('mv-qty').value),
                related_artist_user_id: document.getElementById('mv-artist').value || null,
                notes: document.getElementById('mv-notes').value.trim() || null
            };
            if (!payload.quantity || payload.quantity <= 0) { status('inventory-status', 'error', 'Cantidad obligatoria > 0.'); return; }
            const { error } = await WeotziData.StudioOps.createInventoryMovement(payload);
            if (error) { status('inventory-status', 'error', error.message); return; }
            status('inventory-status', 'success', 'Movimiento registrado.');
            c.innerHTML = '';
            renderInventoryList(supabase, studio);
        });
    }

    // -------------------------------------------------------------
    // SUPPLIERS
    // -------------------------------------------------------------
    function wireSuppliersPanel(supabase, studio) {
        renderSuppliersList(supabase, studio);
        document.getElementById('supplier-new-btn').addEventListener('click', () => openSupplierEditor(supabase, studio, null));
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
            btn.addEventListener('click', async () => {
                if (btn.dataset.action === 'edit') {
                    const { data: row } = await WeotziData.StudioOps.getSupplierById(btn.dataset.id);
                    openSupplierEditor(supabase, studio, row);
                } else if (btn.dataset.action === 'delete') {
                    if (!confirm('¿Borrar proveedor?')) return;
                    await WeotziData.StudioOps.deleteSupplier(btn.dataset.id);
                    renderSuppliersList(supabase, studio);
                }
            });
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
        document.getElementById('sup-save').addEventListener('click', async () => {
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
        });
    }

    // -------------------------------------------------------------
    // SPONSORS
    // -------------------------------------------------------------
    function wireSponsorsPanel(supabase, studio) {
        renderSponsorsList(supabase, studio);
        document.getElementById('sponsor-new-btn').addEventListener('click', () => openSponsorEditor(supabase, studio, null));
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
            btn.addEventListener('click', async () => {
                if (btn.dataset.action === 'edit') {
                    const { data: row } = await WeotziData.StudioOps.getSponsorById(btn.dataset.id);
                    openSponsorEditor(supabase, studio, row);
                } else if (btn.dataset.action === 'delete') {
                    if (!confirm('¿Borrar sponsor?')) return;
                    await WeotziData.StudioOps.deleteSponsor(btn.dataset.id);
                    renderSponsorsList(supabase, studio);
                }
            });
        });
    }
    async function openSponsorEditor(supabase, studio, existing) {
        const c = document.getElementById('sponsor-editor');
        const [{ data: members }, { data: existingLinks }] = await Promise.all([
            WeotziData.StudioMemberships.listActiveArtists(studio.id, { withRole: true }),
            existing?.id
                ? WeotziData.StudioOps.listSponsorArtistIds(existing.id)
                : Promise.resolve({ data: [] })
        ]);
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
        document.getElementById('sp-save').addEventListener('click', async () => {
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
            const result = existing
                ? await WeotziData.StudioOps.updateSponsor(existing.id, payload)
                : await WeotziData.StudioOps.createSponsor(payload);
            if (result.error) { status('sponsors-status', 'error', result.error.message); return; }
            try {
                await saveSponsorArtists(supabase, result.data.id);
            } catch (err) {
                status('sponsors-status', 'error', err.message || 'Sponsor guardado, pero no pudimos asignar artistas.');
                return;
            }
            status('sponsors-status', 'success', 'Sponsor guardado.');
            c.innerHTML = '';
            renderSponsorsList(supabase, studio);
        });
    }

    async function saveSponsorArtists(supabase, sponsorId) {
        const selected = Array.from(document.querySelectorAll('input[name="sp-artist"]:checked'))
            .map(input => input.value)
            .filter(Boolean);
        const del = await WeotziData.StudioOps.deleteSponsorArtists(sponsorId);
        if (del.error) throw del.error;
        if (selected.length === 0) return;
        const rows = selected.map(artist_user_id => ({ sponsor_id: sponsorId, artist_user_id }));
        const ins = await WeotziData.StudioOps.insertSponsorArtists(rows);
        if (ins.error) throw ins.error;
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

        // Summary card
        const months = monthsRes.data || [];
        const totalGross  = months.reduce((s, m) => s + Number(m.gross_amount || 0), 0);
        const totalNet    = months.reduce((s, m) => s + Number(m.studio_net || 0), 0);
        const totalJobs   = months.reduce((s, m) => s + Number(m.jobs_count || 0), 0);
        const totalClients = months.reduce((s, m) => s + Number(m.unique_clients || 0), 0);
        sumEl.innerHTML = `
            <div class="studio-meta-grid">
                <div class="studio-meta-row"><span class="key">Bruto (12 meses)</span><span class="val">${fmtMoney(totalGross, 'USD')}</span></div>
                <div class="studio-meta-row"><span class="key">Neto al estudio</span><span class="val">${fmtMoney(totalNet, 'USD')}</span></div>
                <div class="studio-meta-row"><span class="key">Trabajos</span>      <span class="val">${totalJobs}</span></div>
                <div class="studio-meta-row"><span class="key">Clientes únicos (suma mensual)</span><span class="val">${totalClients}</span></div>
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
                            <td>${new Date(m.month).toLocaleDateString('es-AR', { month: 'short', year: 'numeric' })}</td>
                            <td>${m.jobs_count}</td>
                            <td>${fmtMoney(m.gross_amount, 'USD')}</td>
                            <td>${fmtMoney(m.studio_net, 'USD')}</td>
                            <td>${fmtMoney(m.paid_to_artists, 'USD')}</td>
                            <td>${fmtMoney(m.avg_ticket, 'USD')}</td>
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
                    <thead><tr><th>Artista</th><th>Rol</th><th>Trabajos</th><th>Bruto</th><th>Ticket prom.</th><th>Supplies</th><th>Último trabajo</th></tr></thead>
                    <tbody>${artists.map(a => `
                        <tr>
                            <td><strong>${escapeHtml(a.name || a.username || '—')}</strong></td>
                            <td>${a.role ? `<span class="studio-role-pill role-${a.role}">${escapeHtml(a.role)}</span>` : '—'}</td>
                            <td>${a.jobs_count}</td>
                            <td>${fmtMoney(a.gross_billed, 'USD')}</td>
                            <td>${fmtMoney(a.avg_ticket, 'USD')}</td>
                            <td>${fmtMoney(a.supplies_consumed_cost, 'USD')}</td>
                            <td>${a.days_since_last_job != null ? `hace ${a.days_since_last_job} días` : '—'}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            `;
        }
    }
})();
