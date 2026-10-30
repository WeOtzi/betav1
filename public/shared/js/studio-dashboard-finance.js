// ============================================
// Studio Dashboard — Finanzas (pestaña 'finanzas', W-FIN)
//
// Libro de gastos e ingresos del estudio (M4, studio_finance_entries) sobre
// window.WeotziData.StudioFinance. Se registra en window.WeOtziStudioAdmin.
//   - Filtros: período (presets del kit), tipo, categoría, búsqueda y
//     anulados. Los totales van siempre por moneda; los anulados se ven pero
//     no suman.
//   - Alta y edición en un modal. El comprobante se sube al bucket privado
//     studio-documents bajo <studioId>/finance (WeOtziUploader.uploadFile) y
//     se guarda result.path. Si el guardado falla, se borra el objeto recién
//     subido. Se abre con un enlace temporal (createSignedUrl).
//   - Anular pide motivo (UPDATE a 'voided'; no hay DELETE).
//   - Los gastos de pedidos Supplies enlazan al pedido
//     (navigate('reposicion', {order})) y no dejan cambiar tipo, categoría,
//     importe, moneda ni proveedor.
// Sin la migración M4 la pestaña avisa y no deja cargar movimientos.
//
// Parámetros de show (navigate('finanzas', params)), todos opcionales:
//   tipo ('expense'|'income'), categoria, desde/hasta ('YYYY-MM-DD'),
//   nuevo ('expense'|'income'|<categoría>) abre el alta con eso elegido,
//   movimiento (<id>) abre la edición de ese movimiento si está en el libro.
//
// Contrato: docs/plans/2026-10-30-estudios-plataforma.md → "Finanzas".
// ============================================

(function () {
    'use strict';

    const root = typeof window !== 'undefined' ? window : globalThis;
    const TAB = 'finanzas';
    const BUCKET = 'studio-documents';
    const RECEIPT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    const RECEIPT_MAX_BYTES = 10 * 1024 * 1024;
    const MAX_AMOUNT = 9999999999.99; // numeric(12,2)
    const PAYMENT_METHODS = ['cash', 'card', 'transfer', 'other'];
    const DEFAULT_CURRENCY = 'ARS';
    // Un gasto creado al recibir un pedido Supplies conserva estos campos.
    const LOCKED_FIELDS = ['entry_type', 'category', 'amount', 'currency', 'supplier_id'];

    const COPY = {
        payoutHint: 'Usalo solo para pagos fijos al artista (sueldo o stipend). El porcentaje ya se descuenta en cada trabajo.',
        supplyLock: 'Este gasto se registró al recibir un pedido de reposición: el tipo, la categoría, el importe, la moneda y el proveedor quedan fijos.',
        receiptHelp: 'PDF o imagen (JPG, PNG o WEBP) de hasta 10 MB. Se guarda en privado y solo se abre con un enlace temporal.',
        receiptType: 'El comprobante tiene que ser un PDF o una imagen JPG, PNG o WEBP.',
        receiptSize: 'El comprobante puede pesar hasta 10 MB.',
        uploadFailed: 'No pudimos subir el comprobante. Probá de nuevo o guardá el movimiento sin comprobante.',
        uploadForbidden: 'Tu estudio todavía no puede subir archivos privados (falta aplicar una migración). Guardá el movimiento sin comprobante.',
        uploaderMissing: 'No pudimos cargar el módulo de archivos. Recargá la página e intentá de nuevo.',
        storageMissing: 'No pudimos conectarnos con el almacenamiento de archivos. Recargá la página e intentá de nuevo.',
        cleanupFailed: 'No pudimos borrar el comprobante que se alcanzó a subir; sigue siendo privado.',
        receiptUnavailable: 'No pudimos abrir el comprobante.',
        popupBlocked: 'Permití las ventanas emergentes para ver el comprobante.',
        alreadyVoided: 'Este movimiento ya estaba anulado.',
        unavailableTitle: 'Finanzas todavía no está disponible',
        emptyTitle: 'Sin movimientos en este período',
        emptyBody: 'Registrá gastos e ingresos para ver el resultado del estudio por moneda.',
        emptyFiltered: 'No hay movimientos que coincidan con los filtros.'
    };

    const states = new WeakMap(); // root del módulo -> estado

    // -------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------
    function K() { return root.WeOtziStudioKit; }
    function D() { return root.WeotziData || {}; }
    function esc(v) { return K().escapeHtml(v); }
    function attr(v) { return K().escapeAttr(v); }
    function cleanText(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }
    function idOrNull(v) {
        const s = String(v == null ? '' : v).trim();
        return s || null;
    }
    function rowsOf(res) { return res && !res.error && Array.isArray(res.data) ? res.data : []; }
    function fold(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

    // Resuelve un builder (o una promesa de {data, error}) sin lanzar.
    async function settle(build) {
        try {
            const result = await build();
            return result || { data: null, error: null };
        } catch (error) {
            return { data: null, error };
        }
    }

    // "1.234,56", "1234.56" o un Number → Number con 2 decimales (o null).
    function parseAmount(value) {
        if (value == null || value === '') return null;
        if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
        let s = String(value).trim().replace(/[\s$]/g, '');
        if (!s) return null;
        if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
        if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
        const n = Number(s);
        return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
    }

    function isValidDate(value) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value == null ? '' : value).trim());
        if (!m) return false;
        const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
        return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]);
    }

    function typeOfCategory(category) {
        const cats = K().FINANCE_CATEGORIES;
        if (cats.expense.includes(category)) return 'expense';
        if (cats.income.includes(category)) return 'income';
        return null;
    }
    function normalizeType(value) {
        const v = String(value == null ? '' : value).toLowerCase();
        if (v === 'expense' || v === 'gasto' || v === 'gastos') return 'expense';
        if (v === 'income' || v === 'ingreso' || v === 'ingresos') return 'income';
        return '';
    }

    // -------------------------------------------------------------
    // Filtros, totales y búsqueda (puros)
    // -------------------------------------------------------------
    function defaultFilters() {
        return { preset: 'this_month', from: '', to: '', type: '', category: '', search: '', includeVoided: false };
    }

    // filters → {range, options} para StudioFinance.listEntries.
    function filterQuery(filters, now) {
        const k = K();
        const f = filters || defaultFilters();
        const range = k.periodRange(f.preset, { from: f.from, to: f.to }, now);
        const type = normalizeType(f.type) || null;
        let category = f.category || null;
        if (category && type && typeOfCategory(category) !== type) category = null;
        return {
            range,
            options: { from: range.from, to: range.to, type, category, includeVoided: !!f.includeVoided }
        };
    }

    function matchesSearch(row, query) {
        const q = fold(cleanText(query));
        if (!q) return true;
        const k = K();
        const hay = [
            row && row.description, row && row.counterparty,
            row && row.studio_suppliers && row.studio_suppliers.name,
            row && row.studio_locations && row.studio_locations.label,
            row && k.label('financeCategory', row.category)
        ].map(fold).join(' ');
        return q.split(' ').every(word => hay.includes(word));
    }

    function visibleRows(state) {
        return (state.rows || []).filter(row => matchesSearch(row, state.filters.search));
    }

    // Totales por moneda de las filas registradas (las anuladas no suman).
    function summarize(rows) {
        const k = K();
        const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
        const recorded = list.filter(row => row.status !== 'voided');
        const income = k.sumByCurrency(recorded.filter(row => row.entry_type === 'income'), 'amount', 'currency');
        const expense = k.sumByCurrency(recorded.filter(row => row.entry_type === 'expense'), 'amount', 'currency');
        return {
            income,
            expense,
            result: k.mergeTotals(income, expense, -1),
            count: recorded.length,
            voided: list.length - recorded.length
        };
    }

    function totalsTone(totals) {
        const values = Object.keys(totals || {}).map(cur => Number(totals[cur]) || 0);
        if (values.some(v => v < 0)) return 'danger';
        if (values.some(v => v > 0)) return 'success';
        return null;
    }

    // La moneda más usada en el libro; si no hay, la del estudio o ARS.
    function defaultCurrency(rows, studio) {
        const counts = {};
        (rows || []).forEach(row => {
            const cur = row && /^[A-Z]{3}$/.test(String(row.currency || '')) ? row.currency : null;
            if (cur) counts[cur] = (counts[cur] || 0) + 1;
        });
        const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b))[0];
        if (top) return top;
        const own = studio && String(studio.currency || studio.default_currency || '').toUpperCase();
        return /^[A-Z]{3}$/.test(own || '') ? own : DEFAULT_CURRENCY;
    }

    // -------------------------------------------------------------
    // Formulario de movimiento (puro)
    // -------------------------------------------------------------
    // values (readForm) → {payload, errors, valid}. opts.locked omite los
    // campos fijos de un gasto de reposición; opts.members resuelve el
    // artista de la membresía elegida.
    function buildEntryPayload(values, opts) {
        const k = K();
        const o = opts || {};
        const v = values || {};
        const errors = {};
        const payload = {};

        if (!o.locked) {
            const type = normalizeType(v.entry_type);
            if (!type) errors.entry_type = 'Elegí si es un gasto o un ingreso.';
            const category = String(v.category || '');
            if (!type || !k.FINANCE_CATEGORIES[type].includes(category)) errors.category = 'Elegí una categoría.';
            const amount = parseAmount(v.amount);
            if (amount == null || amount <= 0) errors.amount = 'Ingresá un importe mayor a cero.';
            else if (amount > MAX_AMOUNT) errors.amount = 'El importe es demasiado alto.';
            const currency = String(v.currency || '').trim().toUpperCase();
            if (!/^[A-Z]{3}$/.test(currency)) errors.currency = 'Elegí la moneda.';
            const supplierId = idOrNull(v.supplier_id);
            Object.assign(payload, { entry_type: type, category, amount, currency, supplier_id: supplierId });
        }

        const description = cleanText(v.description);
        if (!description) errors.description = 'Escribí una descripción.';
        else if (description.length > 300) errors.description = 'La descripción admite hasta 300 caracteres.';
        payload.description = description;

        const date = String(v.occurred_on || '').trim();
        if (!isValidDate(date)) errors.occurred_on = 'Indicá la fecha del movimiento.';
        payload.occurred_on = date;

        payload.payment_method = PAYMENT_METHODS.includes(v.payment_method) ? v.payment_method : null;

        const counterparty = cleanText(v.counterparty);
        if (counterparty.length > 160) errors.counterparty = 'La contraparte admite hasta 160 caracteres.';
        payload.counterparty = counterparty || null;

        payload.location_id = idOrNull(v.location_id);
        const membershipId = idOrNull(v.membership_id);
        payload.membership_id = membershipId;
        const member = membershipId && Array.isArray(o.members) ? o.members.find(m => m && String(m.id) === membershipId) : null;
        const artistId = member && ((member.artists_db && member.artists_db.user_id) || member.artist_user_id);
        // Sin artista conocido se manda null y la base lo completa desde la membresía.
        payload.artist_user_id = membershipId ? (artistId || null) : null;

        return { payload, errors, valid: Object.keys(errors).length === 0 };
    }

    function validateReceiptFile(file) {
        if (!file) return null;
        const type = String(file.type || '').toLowerCase();
        if (!RECEIPT_TYPES.includes(type)) return COPY.receiptType;
        if (Number(file.size) > RECEIPT_MAX_BYTES) return COPY.receiptSize;
        return null;
    }

    function receiptPrefix(studioId) { return String(studioId) + '/finance'; }

    // -------------------------------------------------------------
    // Persistencia (comprobante + movimiento)
    // -------------------------------------------------------------
    async function removeReceiptObject(client, path) {
        if (!path || !client || !client.storage) return false;
        try {
            const res = await client.storage.from(BUCKET).remove([path]);
            return !(res && res.error);
        } catch (_) {
            return false;
        }
    }

    async function uploadReceipt(ctx, file) {
        const uploader = root.WeOtziUploader;
        if (!uploader || typeof uploader.uploadFile !== 'function') throw new Error(COPY.uploaderMissing);
        if (!ctx || !ctx.client || !ctx.client.storage) throw new Error(COPY.storageMissing);
        const prefix = receiptPrefix(ctx.studioId);
        let result;
        try {
            result = await uploader.uploadFile({ supabase: ctx.client, bucket: BUCKET, pathPrefix: prefix, file });
        } catch (error) {
            const raw = String((error && (error.message || error.error)) || '');
            const status = String((error && (error.statusCode || error.status)) || '');
            throw new Error(/row-level security|unauthori[sz]ed|forbidden|policy/i.test(raw) || status === '403' ? COPY.uploadForbidden : COPY.uploadFailed);
        }
        const path = result && result.path ? String(result.path) : '';
        if (!path || path.indexOf(prefix + '/') !== 0) {
            if (path) await removeReceiptObject(ctx.client, path);
            throw new Error(COPY.uploadFailed);
        }
        return path;
    }

    // Sube el comprobante (si hay), guarda el movimiento y, si el guardado
    // falla, borra el objeto recién subido. Al reemplazar o quitar un
    // comprobante, el anterior se borra después de guardar (mejor esfuerzo).
    async function persistEntry(ctx, existing, payload, opts) {
        const k = K();
        const repo = D().StudioFinance;
        const o = opts || {};
        if (!repo || typeof repo.saveEntry !== 'function') throw new Error(k.MISSING_SCHEMA_MESSAGE);
        const body = Object.assign({}, payload);
        if (existing && existing.supply_order_id) LOCKED_FIELDS.forEach(key => { delete body[key]; });
        let uploadedPath = null;
        if (o.file) {
            uploadedPath = await uploadReceipt(ctx, o.file);
            body.receipt_storage_path = uploadedPath;
        } else if (o.removeReceipt) {
            body.receipt_storage_path = null;
        }
        if (existing && existing.id) body.id = existing.id;
        else body.studio_id = ctx.studioId;

        let saved;
        try {
            saved = k.unwrap(await repo.saveEntry(body));
        } catch (error) {
            if (uploadedPath && !(await removeReceiptObject(ctx.client, uploadedPath))) {
                error.message = (String(error.message || '').trim() + ' ' + COPY.cleanupFailed).trim();
            }
            throw error;
        }
        const previous = existing && existing.receipt_storage_path;
        const current = saved && Object.prototype.hasOwnProperty.call(saved, 'receipt_storage_path')
            ? saved.receipt_storage_path
            : body.receipt_storage_path;
        if (previous && (uploadedPath || o.removeReceipt) && previous !== current) {
            await removeReceiptObject(ctx.client, previous);
        }
        return saved || body;
    }

    async function voidEntry(id, reason) {
        const k = K();
        const repo = D().StudioFinance;
        if (!repo || typeof repo.voidEntry !== 'function') throw new Error(k.MISSING_SCHEMA_MESSAGE);
        const text = cleanText(reason);
        if (!text) throw new Error('Indicá el motivo de la anulación.');
        const res = await repo.voidEntry(id, text.slice(0, 500));
        // .single() sin filas: ya estaba anulado (o no existe).
        if (res && res.error && String(res.error.code || '') === 'PGRST116') throw new Error(COPY.alreadyVoided);
        return k.unwrap(res);
    }

    // Abre el comprobante privado con un enlace temporal (5 minutos). La
    // ventana se abre antes del await para que el navegador no la bloquee.
    async function openReceipt(ctx, path) {
        const k = K();
        const win = typeof root.open === 'function' ? root.open('about:blank', '_blank') : null;
        if (win) { try { win.opener = null; } catch (_) { /* nada */ } }
        try {
            if (!path) throw new Error(COPY.receiptUnavailable);
            if (!ctx || !ctx.client || !ctx.client.storage) throw new Error(COPY.storageMissing);
            const res = await ctx.client.storage.from(BUCKET).createSignedUrl(path, 300);
            if (res && res.error) throw res.error;
            const url = k.safeUrl(res && res.data && res.data.signedUrl);
            if (!url) throw new Error(COPY.receiptUnavailable);
            if (win) win.location = url;
            else k.toast(COPY.popupBlocked, 'warning');
            return url;
        } catch (error) {
            if (win && typeof win.close === 'function') win.close();
            throw error;
        }
    }

    function announceChange(detail) {
        try {
            const doc = root.document;
            const Evt = root.CustomEvent;
            if (doc && typeof doc.dispatchEvent === 'function' && typeof Evt === 'function') {
                doc.dispatchEvent(new Evt('weotzi:studio-finance-changed', { detail: detail || null }));
            }
        } catch (_) { /* el aviso es opcional */ }
    }

    // -------------------------------------------------------------
    // HTML
    // -------------------------------------------------------------
    function categoryOptionsHtml(type, selected, emptyLabel) {
        const k = K();
        const empty = emptyLabel != null ? '<option value="">' + esc(emptyLabel) + '</option>' : '';
        const t = normalizeType(type);
        if (t) return empty + k.optionsHtml('financeCategory', selected, { only: k.FINANCE_CATEGORIES[t] });
        return empty + [['expense', 'Gastos'], ['income', 'Ingresos']].map(([key, text]) =>
            '<optgroup label="' + attr(text) + '">' + k.optionsHtml('financeCategory', selected, { only: k.FINANCE_CATEGORIES[key] }) + '</optgroup>'
        ).join('');
    }

    function presetOptionsHtml(selected) {
        const k = K();
        return k.optionsHtml('periodPreset', selected, { only: k.PERIOD_PRESETS });
    }

    function shellHtml() {
        return '<div class="sfin">'
            + '<div class="sk-toolbar sfin-toolbar" data-region="filters" role="search" aria-label="Filtrar movimientos">'
            + '<div class="sk-field"><label for="sfin-preset">Período</label><select id="sfin-preset" name="preset">' + presetOptionsHtml('this_month') + '</select></div>'
            + '<div class="sk-field" data-custom hidden><label for="sfin-from">Desde</label><input id="sfin-from" name="from" type="date"></div>'
            + '<div class="sk-field" data-custom hidden><label for="sfin-to">Hasta</label><input id="sfin-to" name="to" type="date"></div>'
            + '<div class="sk-field"><label for="sfin-type">Tipo</label><select id="sfin-type" name="type"><option value="">Todos</option>'
            + K().optionsHtml('financeEntryType', '', { only: ['income', 'expense'] }) + '</select></div>'
            + '<div class="sk-field"><label for="sfin-category">Categoría</label><select id="sfin-category" name="category">' + categoryOptionsHtml('', '', 'Todas') + '</select></div>'
            + '<div class="sk-field sfin-search"><label for="sfin-search">Buscar</label><input id="sfin-search" name="search" type="search" autocomplete="off" placeholder="Descripción, proveedor o contraparte"></div>'
            + '<label class="sk-field sk-field--inline sfin-voided" for="sfin-voided"><input id="sfin-voided" name="includeVoided" type="checkbox"> Mostrar anulados</label>'
            + '</div>'
            + '<div class="sfin-actions">'
            + '<p class="sfin-period-label" data-region="period" aria-live="polite"></p>'
            + '<span class="sk-toolbar-spacer"></span>'
            + '<button type="button" class="studio-btn studio-btn-ghost" data-action="csv"><i class="fa-solid fa-file-csv" aria-hidden="true"></i> Exportar CSV</button>'
            + '<button type="button" class="studio-btn studio-btn-primary" data-action="new"><i class="fa-solid fa-plus" aria-hidden="true"></i> Nuevo movimiento</button>'
            + '</div>'
            + '<div data-region="summary" aria-live="polite"></div>'
            + '<div data-region="ledger" aria-live="polite"><p class="studio-help">Cargando movimientos…</p></div>'
            + '</div>';
    }

    function summaryHtml(summary) {
        const k = K();
        const voided = summary.voided === 1 ? '1 anulado, no suma' : (summary.voided > 1 ? summary.voided + ' anulados, no suman' : null);
        return k.kpis([
            { label: 'Ingresos', valueHtml: k.fmtTotalsHtml(summary.income) },
            { label: 'Gastos', valueHtml: k.fmtTotalsHtml(summary.expense) },
            { label: 'Resultado', valueHtml: k.fmtTotalsHtml(summary.result), tone: totalsTone(summary.result), hint: 'Ingresos menos gastos, por moneda' },
            { label: 'Movimientos', value: String(summary.count), hint: voided }
        ]);
    }

    function orderLabel(state, orderId) {
        const number = state && state.orders && state.orders.get(orderId);
        return number ? 'Pedido ' + number : 'Ver pedido';
    }

    function actionButton(action, row, text, ariaLabel) {
        return '<button type="button" class="studio-btn studio-btn-ghost sk-btn-sm" data-action="' + attr(action) + '" data-id="' + attr(row.id) + '"'
            + (ariaLabel ? ' aria-label="' + attr(ariaLabel) + '"' : '') + '>' + esc(text) + '</button>';
    }

    function rowActionsHtml(row, state) {
        const what = cleanText(row.description) || 'movimiento';
        const out = [];
        if (row.receipt_storage_path) out.push(actionButton('receipt', row, 'Comprobante', 'Ver el comprobante de «' + what + '»'));
        if (row.supply_order_id) out.push(actionButton('order', row, orderLabel(state, row.supply_order_id), 'Ver el pedido de reposición de «' + what + '»'));
        if (row.status !== 'voided') {
            out.push(actionButton('edit', row, 'Editar', 'Editar «' + what + '»'));
            out.push(actionButton('void', row, 'Anular', 'Anular «' + what + '»'));
        }
        return out.length ? '<div class="sk-row-actions">' + out.join('') + '</div>' : '<span class="sk-muted">—</span>';
    }

    function detailHtml(row, state) {
        const k = K();
        const parts = [];
        if (row.counterparty) parts.push(esc(row.counterparty));
        const supplier = row.studio_suppliers && row.studio_suppliers.name;
        if (supplier && cleanText(supplier).toLowerCase() !== cleanText(row.counterparty).toLowerCase()) parts.push('Proveedor: ' + esc(supplier));
        if (row.studio_locations && row.studio_locations.label) parts.push('Sede: ' + esc(row.studio_locations.label));
        const artist = row.artist_user_id && state && state.artistNames ? state.artistNames.get(row.artist_user_id) : null;
        if (artist) parts.push('Artista: ' + esc(artist));
        let html = '<strong class="sfin-desc">' + esc(row.description || '—') + '</strong>';
        if (parts.length) html += '<small>' + parts.join(' · ') + '</small>';
        if (row.status === 'voided') {
            html += '<small class="sfin-void-reason">Anulado'
                + (row.voided_at ? ' el ' + esc(k.fmtDate(row.voided_at)) : '')
                + (row.void_reason ? ': ' + esc(row.void_reason) : '') + '</small>';
        }
        return html;
    }

    function amountHtml(row) {
        const k = K();
        const n = Math.abs(Number(row.amount) || 0);
        const expense = row.entry_type === 'expense';
        const text = expense ? k.fmtMoney(-n, row.currency) : '+' + k.fmtMoney(n, row.currency);
        return '<span class="sfin-amount sfin-amount--' + (expense ? 'expense' : 'income') + '">' + esc(text) + '</span>';
    }

    function ledgerTableHtml(rows, state) {
        const k = K();
        return k.renderTable({
            className: 'sfin-ledger',
            caption: 'Libro de movimientos',
            rows,
            rowClass: row => (row.status === 'voided' ? 'sfin-row--voided' : ''),
            rowAttrs: row => ({ 'data-entry': row.id }),
            columns: [
                { key: 'occurred_on', label: 'Fecha', format: 'date' },
                { key: 'entry_type', label: 'Tipo', badge: 'financeEntryType' },
                { key: 'category', label: 'Categoría', dict: 'financeCategory' },
                { key: 'description', label: 'Detalle', className: 'sfin-col-detail', render: row => detailHtml(row, state) },
                { key: 'payment_method', label: 'Medio', dict: 'paymentMethod' },
                { key: 'amount', label: 'Importe', align: 'right', render: amountHtml },
                { key: 'status', label: 'Estado', badge: 'financeEntryStatus' },
                { key: 'id', label: 'Acciones', render: row => rowActionsHtml(row, state) }
            ]
        });
    }

    function optionList(items, selected, opts) {
        const o = opts || {};
        const list = (items || []).slice();
        const sel = selected == null ? '' : String(selected);
        // Conserva un valor guardado que ya no figura (p. ej. una membresía finalizada).
        if (sel && !list.some(it => String(it.value) === sel)) list.push({ value: sel, label: o.missingLabel || 'Registro anterior' });
        return '<option value="">' + esc(o.empty || 'Ninguno') + '</option>'
            + list.map(it => '<option value="' + attr(it.value) + '"' + (String(it.value) === sel ? ' selected' : '') + '>' + esc(it.label) + '</option>').join('');
    }

    function memberLabel(member) {
        const k = K();
        const a = member && member.artists_db ? member.artists_db : {};
        const name = cleanText(a.name) || (a.username ? '@' + a.username : 'Artista');
        const role = member && member.role ? ' · ' + k.label('membershipRole', member.role) : '';
        const status = member && member.status && member.status !== 'active' ? ' (' + k.label('membershipStatus', member.status) + ')' : '';
        return name + role + status;
    }

    function field(id, labelText, controlHtml, opts) {
        const o = opts || {};
        return '<div class="sk-field' + (o.span ? ' sk-span-2' : '') + '"' + (o.attrs || '') + '>'
            + '<label for="' + attr(id) + '">' + esc(labelText) + '</label>'
            + controlHtml
            + (o.hintHtml || '')
            + '</div>';
    }

    function entryFormHtml(state, entry, preset, options) {
        const k = K();
        const e = entry || {};
        const p = preset || {};
        const opts = options || { suppliers: [], locations: [], members: [] };
        const locked = !!e.supply_order_id;
        const dis = locked ? ' disabled' : '';
        const type = normalizeType(e.entry_type) || normalizeType(p.type) || 'expense';
        const category = e.category || (p.category && typeOfCategory(p.category) === type ? p.category : '');
        const currency = e.currency || defaultCurrency(state && state.rows, state && state.ctx && state.ctx.studio);
        const date = e.occurred_on || k.toDateInput(new Date());
        const amount = e.amount != null && e.amount !== '' ? String(Number(e.amount)) : '';
        const suppliers = (opts.suppliers || []).map(s => ({ value: s.id, label: s.name || 'Proveedor' }));
        const locations = (opts.locations || []).map(l => ({ value: l.id, label: (l.label || 'Sede') + (l.is_active === false ? ' (inactiva)' : '') }));
        const members = (opts.members || []).map(m => ({ value: m.id, label: memberLabel(m) }));
        const payoutHidden = category === 'artist_payout' ? '' : ' hidden';

        const receiptCurrent = e.receipt_storage_path
            ? '<div class="sfin-receipt-current">'
                + '<button type="button" class="studio-btn studio-btn-ghost sk-btn-sm" data-form-action="receipt">Ver comprobante actual</button>'
                + '<label class="sk-field--inline sfin-inline" for="sfin-f-remove"><input id="sfin-f-remove" name="remove_receipt" type="checkbox"> Quitar el comprobante</label>'
                + '</div>'
            : '';

        return '<form class="sfin-form" novalidate>'
            + (locked ? '<p class="sfin-note" role="note">' + esc(COPY.supplyLock) + '</p>' : '')
            + '<div class="sk-grid-2">'
            + field('sfin-f-type', 'Tipo', '<select id="sfin-f-type" name="entry_type" required' + dis + '>'
                + k.optionsHtml('financeEntryType', type, { only: ['expense', 'income'] }) + '</select>')
            + field('sfin-f-category', 'Categoría', '<select id="sfin-f-category" name="category" required' + dis + '>'
                + categoryOptionsHtml(type, category, 'Elegí una categoría') + '</select>',
                { hintHtml: '<span class="studio-help" data-hint="payout"' + payoutHidden + '>' + esc(COPY.payoutHint) + '</span>' })
            + field('sfin-f-description', 'Descripción', '<input id="sfin-f-description" name="description" type="text" maxlength="300" required value="' + attr(e.description || '') + '">', { span: true })
            + field('sfin-f-amount', 'Importe', '<input id="sfin-f-amount" name="amount" type="number" inputmode="decimal" min="0.01" step="0.01" required value="' + attr(amount) + '"' + dis + '>')
            + field('sfin-f-currency', 'Moneda', '<select id="sfin-f-currency" name="currency"' + dis + '>' + k.currencyOptionsHtml(currency) + '</select>')
            + field('sfin-f-date', 'Fecha', '<input id="sfin-f-date" name="occurred_on" type="date" required value="' + attr(date) + '">')
            + field('sfin-f-method', 'Medio de pago', '<select id="sfin-f-method" name="payment_method">'
                + k.optionsHtml('paymentMethod', e.payment_method || '', { empty: 'Sin especificar', only: PAYMENT_METHODS }) + '</select>')
            + field('sfin-f-counterparty', 'Contraparte', '<input id="sfin-f-counterparty" name="counterparty" type="text" maxlength="160" placeholder="A quién le pagaste o quién te pagó" value="' + attr(e.counterparty || '') + '">')
            + field('sfin-f-supplier', 'Proveedor', '<select id="sfin-f-supplier" name="supplier_id"' + dis + '>'
                + optionList(suppliers, e.supplier_id, { empty: 'Sin proveedor', missingLabel: 'Proveedor anterior' }) + '</select>')
            + field('sfin-f-location', 'Sede', '<select id="sfin-f-location" name="location_id">'
                + optionList(locations, e.location_id, { empty: 'Sin sede', missingLabel: 'Sede anterior' }) + '</select>')
            + field('sfin-f-member', 'Artista', '<select id="sfin-f-member" name="membership_id">'
                + optionList(members, e.membership_id, { empty: 'Sin artista', missingLabel: 'Artista anterior' }) + '</select>',
                { hintHtml: '<span class="studio-help">Opcional. Para pagos fijos a artistas o alquileres de puesto.</span>' })
            + field('sfin-f-receipt', 'Comprobante', receiptCurrent
                + '<input id="sfin-f-receipt" name="receipt" type="file" accept="' + attr(RECEIPT_TYPES.join(',')) + '">',
                { span: true, hintHtml: '<span class="studio-help">' + esc(e.receipt_storage_path ? 'Elegí otro archivo para reemplazarlo. ' + COPY.receiptHelp : COPY.receiptHelp) + '</span>' })
            + '</div></form>';
    }

    // -------------------------------------------------------------
    // CSV
    // -------------------------------------------------------------
    function csvColumns(state) {
        const k = K();
        return [
            { label: 'Fecha', key: 'occurred_on' },
            { label: 'Tipo', value: row => k.label('financeEntryType', row.entry_type) },
            { label: 'Categoría', value: row => k.label('financeCategory', row.category) },
            { label: 'Descripción', key: 'description' },
            { label: 'Contraparte', key: 'counterparty' },
            { label: 'Proveedor', value: row => (row.studio_suppliers && row.studio_suppliers.name) || '' },
            { label: 'Sede', value: row => (row.studio_locations && row.studio_locations.label) || '' },
            { label: 'Medio de pago', value: row => (row.payment_method ? k.label('paymentMethod', row.payment_method) : '') },
            { label: 'Moneda', key: 'currency' },
            { label: 'Importe', value: row => { const n = Math.abs(Number(row.amount) || 0); return row.entry_type === 'expense' ? -n : n; } },
            { label: 'Estado', value: row => k.label('financeEntryStatus', row.status || 'recorded') },
            { label: 'Motivo de anulación', key: 'void_reason' },
            { label: 'Pedido de reposición', value: row => (row.supply_order_id ? ((state && state.orders && state.orders.get(row.supply_order_id)) || row.supply_order_id) : '') },
            { label: 'Comprobante', value: row => !!row.receipt_storage_path }
        ];
    }

    function exportCsv(state) {
        const k = K();
        const rows = visibleRows(state);
        if (!rows.length) { k.toast('No hay movimientos para exportar.', 'info'); return null; }
        const range = state.range || filterQuery(state.filters).range;
        return k.downloadCsv('finanzas-' + range.from + '_' + range.to, csvColumns(state), rows);
    }

    // -------------------------------------------------------------
    // Estado y render
    // -------------------------------------------------------------
    function createState(rootEl, ctx) {
        return {
            root: rootEl,
            ctx,
            filters: defaultFilters(),
            range: null,
            rows: [],
            unavailable: false,
            error: null,
            loaded: false,
            seq: 0,
            options: null,
            orders: new Map(),
            ordersLoading: false,
            optionsLoading: null,
            artistNames: new Map(),
            searchTimer: null
        };
    }

    function region(state, name) {
        return state.root && typeof state.root.querySelector === 'function'
            ? state.root.querySelector('[data-region="' + name + '"]')
            : null;
    }

    function control(state, name) {
        return state.root && typeof state.root.querySelector === 'function'
            ? state.root.querySelector('[data-region="filters"] [name="' + name + '"]')
            : null;
    }

    function syncToolbar(state) {
        const f = state.filters;
        const preset = control(state, 'preset');
        if (preset) preset.value = f.preset;
        const isCustom = f.preset === 'custom';
        if (state.root && typeof state.root.querySelectorAll === 'function') {
            Array.from(state.root.querySelectorAll('[data-custom]')).forEach(el => { el.hidden = !isCustom; });
        }
        const from = control(state, 'from');
        if (from) from.value = f.from || '';
        const to = control(state, 'to');
        if (to) to.value = f.to || '';
        const type = control(state, 'type');
        if (type) type.value = f.type || '';
        const category = control(state, 'category');
        if (category) {
            category.innerHTML = categoryOptionsHtml(f.type, f.category, 'Todas');
            category.value = f.category || '';
        }
        const search = control(state, 'search');
        if (search && search.value !== f.search) search.value = f.search || '';
        const voided = control(state, 'includeVoided');
        if (voided) voided.checked = !!f.includeVoided;
    }

    function renderLedger(state) {
        const k = K();
        const el = region(state, 'ledger');
        if (!el) return;
        if (state.unavailable) {
            el.innerHTML = k.emptyState({ title: COPY.unavailableTitle, body: k.MISSING_SCHEMA_MESSAGE });
            return;
        }
        if (state.error) {
            el.innerHTML = '<div class="studio-status studio-status-error sfin-error" role="alert">' + esc(k.friendlyError(state.error))
                + ' <button type="button" class="studio-btn studio-btn-ghost sk-btn-sm" data-action="retry">Reintentar</button></div>';
            return;
        }
        const rows = visibleRows(state);
        if (!rows.length) {
            el.innerHTML = state.rows.length
                ? k.emptyState({ body: COPY.emptyFiltered, compact: true })
                : k.emptyState({
                    title: COPY.emptyTitle,
                    body: COPY.emptyBody,
                    actionHtml: '<button type="button" class="studio-btn studio-btn-primary" data-action="new">Registrar un movimiento</button>'
                });
            return;
        }
        el.innerHTML = ledgerTableHtml(rows, state);
    }

    function render(state) {
        const k = K();
        const period = region(state, 'period');
        if (period && state.range) {
            period.textContent = state.range.label + (state.range.preset === 'custom' ? '' : ' · del ' + k.fmtDate(state.range.from) + ' al ' + k.fmtDate(state.range.to));
        }
        const summary = region(state, 'summary');
        if (summary) summary.innerHTML = state.unavailable || state.error ? '' : summaryHtml(summarize(visibleRows(state)));
        if (state.root && typeof state.root.querySelectorAll === 'function') {
            Array.from(state.root.querySelectorAll('[data-action="new"], [data-action="csv"]')).forEach(btn => {
                btn.disabled = !!state.unavailable;
            });
        }
        renderLedger(state);
    }

    async function reload(state) {
        const k = K();
        const repo = D().StudioFinance;
        const token = ++state.seq;
        const query = filterQuery(state.filters);
        state.range = query.range;
        const ledger = region(state, 'ledger');
        if (ledger && typeof ledger.setAttribute === 'function') ledger.setAttribute('aria-busy', 'true');
        let res;
        if (!repo || typeof repo.listEntries !== 'function') res = { data: [], error: null, unavailable: true };
        else res = await settle(() => repo.listEntries(state.ctx.studioId, query.options));
        if (token !== state.seq) return false; // llegó una búsqueda más nueva
        state.unavailable = !!res.unavailable || !!(res.error && k.isMissingSchema(res.error));
        state.error = state.unavailable ? null : (res.error || null);
        state.rows = !state.unavailable && !state.error && Array.isArray(res.data) ? res.data : [];
        state.loaded = true;
        if (ledger && typeof ledger.removeAttribute === 'function') ledger.removeAttribute('aria-busy');
        render(state);
        loadOrderNumbers(state);
        loadArtistNames(state);
        return true;
    }

    // Número de pedido para los gastos de reposición (mejor esfuerzo).
    // Cada id se busca una sola vez: los que no aparecen quedan en null.
    async function loadOrderNumbers(state) {
        const pending = Array.from(new Set(state.rows
            .map(row => row.supply_order_id)
            .filter(id => id && !state.orders.has(id))));
        const repo = D().Supplies;
        if (!pending.length || state.ordersLoading || !repo || typeof repo.listOrdersForStudio !== 'function') return;
        state.ordersLoading = true;
        const res = await settle(() => repo.listOrdersForStudio(state.ctx.studioId));
        state.ordersLoading = false;
        if (res.error) return; // se reintenta en la próxima carga
        rowsOf(res).forEach(order => { if (order && order.id) state.orders.set(order.id, order.order_number || null); });
        pending.forEach(id => { if (!state.orders.has(id)) state.orders.set(id, null); });
        if (pending.some(id => state.orders.get(id))) renderLedger(state);
    }

    // Nombres de artistas del roster para el detalle (mejor esfuerzo).
    async function loadArtistNames(state) {
        if (!state.rows.some(row => row.artist_user_id && !state.artistNames.has(row.artist_user_id))) return;
        const options = await loadOptions(state);
        let changed = false;
        (options.members || []).forEach(m => {
            const a = m && m.artists_db;
            const id = a && a.user_id;
            if (id && !state.artistNames.has(id)) {
                state.artistNames.set(id, cleanText(a.name) || (a.username ? '@' + a.username : 'Artista'));
                changed = true;
            }
        });
        if (changed) renderLedger(state);
    }

    // Proveedores, sedes y roster para el formulario (se cachean si cargan bien).
    async function loadOptions(state) {
        if (state.options) return state.options;
        if (state.optionsLoading) return state.optionsLoading;
        const d = D();
        const id = state.ctx.studioId;
        const call = (repo, method, ...args) => (repo && typeof repo[method] === 'function'
            ? settle(() => repo[method](...args))
            : Promise.resolve({ data: [], error: null }));
        state.optionsLoading = Promise.all([
            call(d.StudioOps, 'listSupplierOptions', id),
            call(d.StudioLocations, 'listByStudio', id, 'id, label, is_active'),
            call(d.StudioMemberships, 'listRoster', id)
        ]).then(([suppliers, locations, members]) => {
            const out = { suppliers: rowsOf(suppliers), locations: rowsOf(locations), members: rowsOf(members) };
            if (!suppliers.error && !locations.error && !members.error) state.options = out;
            state.optionsLoading = null;
            return out;
        });
        return state.optionsLoading;
    }

    // -------------------------------------------------------------
    // Modal de alta / edición y anulación
    // -------------------------------------------------------------
    function clearInvalid(form) {
        if (!form || typeof form.querySelectorAll !== 'function') return;
        Array.from(form.querySelectorAll('[aria-invalid]')).forEach(el => el.removeAttribute('aria-invalid'));
    }
    function markInvalid(form, errors) {
        if (!form || typeof form.querySelector !== 'function') return;
        let first = null;
        Object.keys(errors || {}).forEach(name => {
            const el = form.querySelector('[name="' + name + '"]');
            if (el) {
                el.setAttribute('aria-invalid', 'true');
                if (!first) first = el;
            }
        });
        if (first && typeof first.focus === 'function') first.focus();
    }
    function firstError(errors) {
        const keys = Object.keys(errors || {});
        return keys.length ? errors[keys[0]] : '';
    }

    function presetFromParam(value) {
        const type = normalizeType(value);
        if (type) return { type };
        const catType = typeOfCategory(String(value || ''));
        return catType ? { type: catType, category: String(value) } : {};
    }

    async function openEntryModal(state, entry, preset) {
        const k = K();
        if (state.unavailable) {
            k.toast(k.MISSING_SCHEMA_MESSAGE, 'warning');
            return null;
        }
        if (entry && entry.status === 'voided') {
            k.toast('Un movimiento anulado no se puede editar.', 'warning');
            return null;
        }
        const options = await loadOptions(state);
        const modal = k.openModal({
            title: entry ? 'Editar movimiento' : 'Nuevo movimiento',
            size: 'lg',
            className: 'sfin-modal',
            body: entryFormHtml(state, entry, preset, options),
            actions: [
                { label: 'Cancelar', variant: 'ghost', value: null },
                { label: entry ? 'Guardar cambios' : 'Guardar movimiento', variant: 'primary', onClick: m => submitEntry(state, entry, m) }
            ]
        });
        wireEntryForm(state, modal, entry);
        return modal;
    }

    function wireEntryForm(state, modal, entry) {
        const k = K();
        const body = modal && modal.body;
        if (!body || typeof body.querySelector !== 'function') return;
        const form = body.querySelector('form');
        if (form && typeof form.addEventListener === 'function') {
            form.addEventListener('submit', e => { e.preventDefault(); });
        }
        const typeEl = body.querySelector('[name="entry_type"]');
        const catEl = body.querySelector('[name="category"]');
        const hint = body.querySelector('[data-hint="payout"]');
        const syncHint = () => { if (hint && catEl) hint.hidden = catEl.value !== 'artist_payout'; };
        if (typeEl && catEl) {
            typeEl.addEventListener('change', () => {
                const keep = typeOfCategory(catEl.value) === normalizeType(typeEl.value) ? catEl.value : '';
                catEl.innerHTML = categoryOptionsHtml(typeEl.value, keep, 'Elegí una categoría');
                catEl.value = keep;
                syncHint();
            });
            catEl.addEventListener('change', syncHint);
        }
        const receiptBtn = body.querySelector('[data-form-action="receipt"]');
        if (receiptBtn && entry) {
            receiptBtn.addEventListener('click', () => k.guarded(receiptBtn, () => openReceipt(state.ctx, entry.receipt_storage_path)));
        }
        const removeEl = body.querySelector('[name="remove_receipt"]');
        const fileEl = body.querySelector('[name="receipt"]');
        if (removeEl && fileEl) {
            removeEl.addEventListener('change', () => { fileEl.disabled = !!removeEl.checked; if (removeEl.checked) fileEl.value = ''; });
        }
    }

    async function submitEntry(state, entry, modal) {
        const k = K();
        const form = modal.body && typeof modal.body.querySelector === 'function' ? modal.body.querySelector('form') : null;
        const values = k.readForm(form);
        const locked = !!(entry && entry.supply_order_id);
        const built = buildEntryPayload(values, { locked, members: (state.options || {}).members });
        clearInvalid(form);
        if (!built.valid) {
            markInvalid(form, built.errors);
            modal.setError(firstError(built.errors));
            return false;
        }
        const file = values.receipt || null;
        const fileError = validateReceiptFile(file);
        if (fileError) {
            markInvalid(form, { receipt: fileError });
            modal.setError(fileError);
            return false;
        }
        const saved = await persistEntry(state.ctx, entry, built.payload, { file, removeReceipt: values.remove_receipt === true });
        k.toast(entry ? 'Movimiento actualizado.' : 'Movimiento guardado.', 'success');
        announceChange({ id: saved && saved.id, action: entry ? 'updated' : 'created' });
        reload(state);
        return saved || true;
    }

    async function voidFlow(state, row) {
        const k = K();
        const reason = await k.promptDialog({
            title: 'Anular movimiento',
            body: '«' + cleanText(row.description) + '» deja de sumar en los totales. No se puede deshacer.',
            label: 'Motivo de la anulación',
            placeholder: 'Por ejemplo: cargado dos veces',
            required: true,
            multiline: true,
            maxLength: 500,
            confirmLabel: 'Anular movimiento',
            tone: 'danger'
        });
        if (reason == null) return false;
        await voidEntry(row.id, reason);
        k.toast('Movimiento anulado.', 'success');
        announceChange({ id: row.id, action: 'voided' });
        await reload(state);
        return true;
    }

    // -------------------------------------------------------------
    // Eventos del módulo
    // -------------------------------------------------------------
    function onFilterChange(state, event) {
        const t = event && event.target;
        if (!t || !t.name || typeof t.closest !== 'function' || !t.closest('[data-region="filters"]')) return;
        const f = state.filters;
        switch (t.name) {
            case 'preset':
                f.preset = K().PERIOD_PRESETS.includes(t.value) ? t.value : 'this_month';
                if (f.preset === 'custom' && !f.from && !f.to && state.range) {
                    f.from = state.range.from;
                    f.to = state.range.to;
                }
                break;
            case 'from': f.from = t.value || ''; break;
            case 'to': f.to = t.value || ''; break;
            case 'type':
                f.type = normalizeType(t.value);
                if (f.category && f.type && typeOfCategory(f.category) !== f.type) f.category = '';
                break;
            case 'category': f.category = t.value || ''; break;
            case 'includeVoided': f.includeVoided = !!t.checked; break;
            case 'search':
                f.search = t.value || '';
                render(state);
                return;
            default: return;
        }
        syncToolbar(state);
        reload(state);
    }

    function onSearchInput(state, event) {
        const t = event && event.target;
        if (!t || t.name !== 'search') return;
        if (state.searchTimer != null && typeof root.clearTimeout === 'function') root.clearTimeout(state.searchTimer);
        const apply = () => { state.searchTimer = null; state.filters.search = t.value || ''; render(state); };
        state.searchTimer = typeof root.setTimeout === 'function' ? root.setTimeout(apply, 250) : (apply(), null);
    }

    function onClick(state, event) {
        const k = K();
        const target = event && event.target;
        const btn = target && typeof target.closest === 'function' ? target.closest('[data-action]') : null;
        if (!btn || (state.root && typeof state.root.contains === 'function' && !state.root.contains(btn))) return;
        const action = btn.getAttribute('data-action');
        const id = btn.getAttribute('data-id');
        const row = id ? state.rows.find(r => String(r.id) === id) : null;
        switch (action) {
            case 'new': k.guarded(btn, () => openEntryModal(state, null, {})); break;
            case 'csv': exportCsv(state); break;
            case 'retry': k.guarded(btn, () => reload(state)); break;
            case 'edit': if (row) k.guarded(btn, () => openEntryModal(state, row)); break;
            case 'void': if (row) k.guarded(btn, () => voidFlow(state, row)); break;
            case 'receipt': if (row) k.guarded(btn, () => openReceipt(state.ctx, row.receipt_storage_path)); break;
            case 'order':
                if (row && row.supply_order_id && state.ctx && typeof state.ctx.navigate === 'function') {
                    state.ctx.navigate('reposicion', { order: row.supply_order_id });
                }
                break;
            default: break;
        }
    }

    // Aplica los parámetros de navigate(). Devuelve true si cambió algún filtro.
    function applyParams(state, params) {
        const p = params || {};
        const f = state.filters;
        const before = JSON.stringify(f);
        const type = normalizeType(p.tipo);
        if (p.tipo != null) f.type = type;
        if (p.categoria != null) {
            const catType = typeOfCategory(String(p.categoria));
            if (catType) {
                f.category = String(p.categoria);
                if (!f.type || f.type !== catType) f.type = catType;
            } else f.category = '';
        }
        if (isValidDate(p.desde) || isValidDate(p.hasta)) {
            f.preset = 'custom';
            f.from = isValidDate(p.desde) ? String(p.desde) : '';
            f.to = isValidDate(p.hasta) ? String(p.hasta) : '';
        }
        return JSON.stringify(f) !== before;
    }

    function mount(rootEl, ctx) {
        const state = createState(rootEl, ctx);
        states.set(rootEl, state);
        rootEl.innerHTML = shellHtml();
        if (typeof rootEl.addEventListener === 'function') {
            rootEl.addEventListener('change', e => onFilterChange(state, e));
            rootEl.addEventListener('input', e => onSearchInput(state, e));
            rootEl.addEventListener('click', e => onClick(state, e));
        }
        syncToolbar(state);
        return state;
    }

    async function show(rootEl, ctx, params) {
        const state = states.get(rootEl) || mount(rootEl, ctx);
        const p = params || {};
        if (applyParams(state, p)) syncToolbar(state);
        await reload(state);
        if (p.nuevo) {
            await openEntryModal(state, null, presetFromParam(p.nuevo));
        } else if (p.movimiento) {
            const row = state.rows.find(r => String(r.id) === String(p.movimiento));
            if (row) await openEntryModal(state, row);
        }
    }

    const api = {
        TAB, BUCKET, COPY, RECEIPT_TYPES, RECEIPT_MAX_BYTES, LOCKED_FIELDS,
        parseAmount, isValidDate, typeOfCategory, normalizeType, defaultFilters, filterQuery,
        matchesSearch, summarize, totalsTone, defaultCurrency, buildEntryPayload, validateReceiptFile,
        receiptPrefix, uploadReceipt, removeReceiptObject, persistEntry, voidEntry, openReceipt,
        categoryOptionsHtml, shellHtml, summaryHtml, ledgerTableHtml, rowActionsHtml, detailHtml, amountHtml,
        entryFormHtml, csvColumns, exportCsv, applyParams, presetFromParam, createState, reload, render,
        openEntryModal, submitEntry, voidFlow, onClick, onFilterChange, mount, show
    };
    if (typeof module === 'object' && module && module.exports) module.exports = api;

    const admin = root.WeOtziStudioAdmin;
    if (admin && typeof admin.register === 'function') admin.register(TAB, { mount, show });
})();
