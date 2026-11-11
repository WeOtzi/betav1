// ============================================
// Estado unificado de una postulación (Job Board y Spots).
// Fuente única para /artist/applications, el aside "Ya te postulaste" de
// /job-board y /studio-spots, y las confirmaciones con deep link: una
// contraoferta pendiente o una oportunidad cerrada cambian el estado que ve el
// artista aunque `application.status` siga en pending/viewed/shortlisted.
// Lógica pura: se carga en el navegador (window.WoApplicationState) y en
// node:test (module.exports).
// ============================================

(function (root) {
    'use strict';

    const LABELS = {
        esperando_respuesta: 'Esperando respuesta',
        en_revision: 'En revisión',
        contraoferta_recibida: 'Contraoferta recibida',
        confirmada: 'Confirmada',
        rechazada: 'Rechazada',
        expirada: 'Expirada',
        retirada: 'Retirada'
    };

    function list(value) {
        if (Array.isArray(value)) return value;
        if (value && typeof value === 'object' && Array.isArray(value.data)) return value.data;
        return [];
    }

    // Job Board: la contraoferta pendiente es del cliente (status 'pendiente').
    function pendingClientOffer(offers) {
        return list(offers).find((o) => o && o.author_role === 'client' && o.status === 'pendiente') || null;
    }

    // Spots: la contraoferta pendiente es del estudio (status 'pending').
    function pendingStudioOffer(offers) {
        return list(offers).find((o) => o && o.author_role === 'studio' && o.status === 'pending') || null;
    }

    function deriveJb(app, request, offersOrFlag) {
        const status = app && app.status;
        const hasOffer = typeof offersOrFlag === 'boolean' ? offersOrFlag : !!pendingClientOffer(offersOrFlag);
        if (status === 'withdrawn') return 'retirada';
        if (status === 'rejected') return 'rechazada';
        if (status === 'accepted') return 'confirmada';
        if (hasOffer) return 'contraoferta_recibida';
        if (request && request.status && request.status !== 'open') return 'expirada';
        if (status === 'viewed') return 'en_revision';
        return 'esperando_respuesta';
    }

    function deriveSpot(app, spot, offersOrFlag) {
        const status = app && app.status;
        const hasOffer = typeof offersOrFlag === 'boolean' ? offersOrFlag : !!pendingStudioOffer(offersOrFlag);
        if (status === 'withdrawn') return 'retirada';
        if (status === 'rejected') return 'rechazada';
        if (status === 'accepted') return 'confirmada';
        if (hasOffer) return 'contraoferta_recibida';
        if (status === 'shortlisted') return 'en_revision';
        if (spot && spot.status && spot.status !== 'open') return 'expirada';
        return 'esperando_respuesta';
    }

    function label(state) {
        return LABELS[state] || LABELS.esperando_respuesta;
    }

    // Estado crudo de la base (pending, shortlisted…) → etiqueta en castellano.
    function rawSpotLabel(status) {
        return label(deriveSpot({ status }, null, false));
    }

    function rawJbLabel(status) {
        return label(deriveJb({ status }, null, false));
    }

    const api = {
        LABELS,
        pendingClientOffer,
        pendingStudioOffer,
        deriveJb,
        deriveSpot,
        label,
        rawSpotLabel,
        rawJbLabel
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.WoApplicationState = api;
})(typeof window !== 'undefined' ? window : null);
