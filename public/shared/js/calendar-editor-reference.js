/* Modelo de presentación del editor de Calendario. No escribe datos ni crea
   relaciones: la vinculación nueva de Figma tiene un límite explícito acordado. */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.WeotziCalendarEditorReference = api;
})(typeof window === 'object' ? window : globalThis, function () {
    'use strict';
    const supported = new Set(['confirmed_session', 'reservation', 'availability', 'guest_spot', 'convention', 'reminder', 'personal']);
    function referenceState(type, editing) {
        return editing ? null : !type ? 'choose-type' : supported.has(type) ? type : null;
    }
    function normalize(text) {
        return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es');
    }
    function quotationOptions(rows, artistId, query) {
        if (!artistId) return [];
        const search = normalize(query);
        return (rows || []).filter(q => q.artist_id === artistId && !q.is_archived && q.quote_status !== 'in_progress')
            .map(q => {
                const status = q.quote_status;
                const closed = ['client_rejected', 'artist_rejected', 'rejected', 'expired', 'cancelled', 'completed'].includes(status);
                const approved = ['client_approved', 'artist_completed'].includes(status);
                return {
                    id: q.id,
                    number: String(q.quote_id || q.id),
                    client: q.client_full_name || 'Cliente',
                    project: q.tattoo_idea_description || q.tattoo_body_part || '',
                    group: approved ? 'approved' : 'pending',
                    disabled: closed,
                    statusLabel: status === 'artist_completed' ? 'Lista para cliente' : status === 'responded' ? 'Respondida' : approved ? 'Confirmada' : closed ? (status === 'expired' ? 'Vencida' : status === 'completed' ? 'Finalizada' : 'Rechazada') : 'Pendiente',
                    tone: status === 'artist_completed' ? 'progress' : status === 'responded' ? 'responded' : approved ? 'confirmed' : closed ? (status === 'expired' ? 'expired' : 'rejected') : 'pending',
                };
            }).filter(q => normalize([q.client, q.project, q.number].join(' ')).includes(search));
    }
    function assertManualSaveAllowed(selectedQuote) {
        if (selectedQuote) throw new Error('La vinculación con cotizaciones no está disponible en esta entrega. No se guardó el turno vinculado. Podés quitar la selección para crear un evento manual o administrarlo desde Cotizaciones.');
    }
    function monthDayCount(date) {
        const first = new Date(date.getFullYear(), date.getMonth(), 1);
        const days = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
        return Math.ceil((((first.getDay() + 6) % 7) + days) / 7) * 7;
    }
    return { referenceState, quotationOptions, assertManualSaveAllowed, monthDayCount };
});
