// ============================================
// WE ÖTZI - BACKOFFICE: Email Routing UI
// Renders the per-event channel toggle (n8n / billionmail / dual / off) and exposes
// inline test buttons. Backed by /api/email/events endpoints.
// ============================================

(function () {
    'use strict';

    const VALID_CHANNELS = ['n8n', 'billionmail', 'dual', 'off'];

    function _toast(msg, kind) {
        if (typeof window.showToast === 'function') {
            window.showToast(msg, kind || 'info');
        } else {
            console.log(`[toast:${kind || 'info'}] ${msg}`);
        }
    }

    function _channelLabel(channel) {
        switch (channel) {
            case 'n8n':         return '<span style="color:#888">n8n (legacy)</span>';
            case 'billionmail': return '<span style="color:#27ae60;font-weight:600">BillionMail</span>';
            case 'dual':        return '<span style="color:#f39c12">dual (ambos)</span>';
            case 'off':         return '<span style="color:#c0392b">off (no enviar)</span>';
            default:            return channel || '?';
        }
    }

    async function loadEmailRouting() {
        const tbody = document.getElementById('email-routing-tbody');
        if (!tbody) return;

        if (!window.EmailClient) {
            tbody.innerHTML = `<tr><td colspan="4" style="padding:20px;color:#c00">EmailClient no está cargado. Recarga la página.</td></tr>`;
            return;
        }

        tbody.innerHTML = `<tr><td colspan="4" style="padding:0">
            <div class="section-loader"><div class="spinner"></div><span class="loader-text">Cargando eventos...</span></div>
        </td></tr>`;

        const result = await window.EmailClient.listEvents();
        if (!result || !result.success) {
            tbody.innerHTML = `<tr><td colspan="4" style="padding:20px;color:#c00">Error: ${(result && result.error) || 'desconocido'}</td></tr>`;
            return;
        }

        const events = Array.isArray(result.events) ? result.events : [];
        if (events.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" style="padding:20px">Sin eventos configurados.</td></tr>`;
            return;
        }

        const rows = events.map(ev => {
            const channelOptions = VALID_CHANNELS
                .map(c => `<option value="${c}" ${ev.channel === c ? 'selected' : ''}>${c}</option>`)
                .join('');
            return `
                <tr data-event-id="${ev.id}">
                    <td>
                        <strong>${ev.name || ev.id}</strong>
                        <div style="color:#888;font-size:0.8rem">${ev.id}</div>
                        ${ev.description ? `<div style="color:#aaa;font-size:0.8rem;margin-top:4px">${ev.description}</div>` : ''}
                    </td>
                    <td><code>${ev.templateHint || '-'}</code></td>
                    <td>
                        <div style="display:flex;align-items:center;gap:8px">
                            <select class="form-select" data-action="set-channel" data-event-id="${ev.id}" style="min-width:140px">
                                ${channelOptions}
                            </select>
                            <span class="channel-current">${_channelLabel(ev.channel)}</span>
                        </div>
                    </td>
                    <td>
                        <button class="btn btn-sm btn-secondary" data-action="test-event" data-event-id="${ev.id}">
                            <i class="fa-solid fa-paper-plane"></i> Probar
                        </button>
                    </td>
                </tr>`;
        }).join('');

        tbody.innerHTML = rows;

        tbody.querySelectorAll('select[data-action="set-channel"]').forEach(sel => {
            sel.addEventListener('change', e => {
                const id = e.target.dataset.eventId;
                const channel = e.target.value;
                setEventChannel(id, channel);
            });
        });
        tbody.querySelectorAll('button[data-action="test-event"]').forEach(btn => {
            btn.addEventListener('click', e => {
                const id = e.target.closest('button').dataset.eventId;
                testEvent(id);
            });
        });
    }

    async function setEventChannel(eventId, channel) {
        if (!VALID_CHANNELS.includes(channel)) {
            _toast(`Canal inválido: ${channel}`, 'error');
            return;
        }
        const res = await window.EmailClient.updateEvent(eventId, { channel });
        if (res && res.success) {
            _toast(`Canal de "${eventId}" actualizado a ${channel}`, 'success');
            const row = document.querySelector(`tr[data-event-id="${eventId}"] .channel-current`);
            if (row) row.innerHTML = _channelLabel(channel);
        } else {
            _toast(`Error al actualizar: ${(res && res.error) || 'desconocido'}`, 'error');
        }
    }

    async function testEvent(eventId) {
        const recipient = window.prompt(
            `Enviar email de prueba para "${eventId}"\n\nEmail destino:`,
            ''
        );
        if (!recipient || !recipient.includes('@')) {
            if (recipient !== null) _toast('Email inválido', 'error');
            return;
        }
        _toast(`Enviando test...`, 'info');
        const res = await window.EmailClient.sendTest(eventId, recipient);
        if (res && res.success) {
            _toast(`Test enviado por canal "${res.channel}"`, 'success');
        } else {
            _toast(`Test falló: ${(res && res.error) || 'desconocido'}`, 'error');
        }
    }

    async function bulkSetEmailRouting(channel) {
        if (!VALID_CHANNELS.includes(channel)) return;
        const ok = window.confirm(
            `Cambiar TODOS los eventos al canal "${channel}"?\nEsto puede tardar unos segundos.`
        );
        if (!ok) return;

        const list = await window.EmailClient.listEvents();
        if (!list || !list.success) {
            _toast('No se pudieron listar los eventos', 'error');
            return;
        }
        const events = Array.isArray(list.events) ? list.events : [];
        let okCount = 0;
        let errCount = 0;
        for (const ev of events) {
            const res = await window.EmailClient.updateEvent(ev.id, { channel });
            if (res && res.success) okCount++; else errCount++;
        }
        _toast(`Bulk: ${okCount} OK, ${errCount} errores`, errCount === 0 ? 'success' : 'warn');
        await loadEmailRouting();
    }

    window.loadEmailRouting = loadEmailRouting;
    window.bulkSetEmailRouting = bulkSetEmailRouting;
    window.setEventChannel = setEventChannel;
    window.testEmailRoutingEvent = testEvent;
})();
