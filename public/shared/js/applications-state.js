// ============================================
// Estado unificado de una postulación (Job Board y Spots).
// Fuente única para /artist/applications, el aside "Ya te postulaste" de
// /job-board y /studio-spots, y las confirmaciones con deep link: una
// contraoferta pendiente o una oportunidad cerrada cambian el estado que ve el
// artista aunque `application.status` siga en pending/viewed/shortlisted.
// Plataforma de Estudios (docs/plans/2026-10-30-estudios-plataforma.md): al
// aceptar una postulación el estudio emite un contrato; con un contrato `sent`
// la postulación queda en `contrato_pendiente` (se firma en
// /artist/invitations?contrato=<id>) y "Spot confirmado" solo aparece con el
// contrato `signed` o la postulación `accepted`.
// Lógica pura: se carga en el navegador (window.WoApplicationState) y en
// node:test (module.exports).
// ============================================

(function (root) {
    'use strict';

    const LABELS = {
        esperando_respuesta: 'Esperando respuesta',
        en_revision: 'En revisión',
        contraoferta_recibida: 'Contraoferta recibida',
        contrato_pendiente: 'Contrato pendiente de firma',
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

    // Un contrato `sent` cuyo expires_at ya pasó cuenta como vencido aunque la
    // base todavía no lo haya marcado.
    function contractIsOpen(contract, now) {
        if (!contract || contract.status !== 'sent') return false;
        if (!contract.expires_at) return true;
        const expires = new Date(contract.expires_at).getTime();
        return !Number.isFinite(expires) || expires >= (now || new Date()).getTime();
    }

    // Contrato que define el estado de una postulación: el firmado manda; si
    // no, el enviado sin vencer más reciente. Los cerrados no cuentan.
    function contractForApplication(contracts, applicationId, now) {
        if (!applicationId) return null;
        const own = list(contracts).filter((c) => c && String(c.application_id) === String(applicationId));
        const newest = (a, b) => (Number(b.version) || 1) - (Number(a.version) || 1)
            || new Date(b.sent_at || b.created_at || 0) - new Date(a.sent_at || a.created_at || 0);
        return own.filter((c) => c.status === 'signed').sort(newest)[0]
            || own.filter((c) => contractIsOpen(c, now)).sort(newest)[0]
            || null;
    }

    // Enlace a la vista de firma del contrato.
    function contractHref(contract) {
        return contract && contract.id ? '/artist/invitations?contrato=' + encodeURIComponent(contract.id) : '/artist/invitations';
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

    // `contract` (opcional) es el de contractForApplication.
    function deriveSpot(app, spot, offersOrFlag, contract, now) {
        const status = app && app.status;
        const hasOffer = typeof offersOrFlag === 'boolean' ? offersOrFlag : !!pendingStudioOffer(offersOrFlag);
        if (status === 'withdrawn') return 'retirada';
        if (status === 'rejected') return 'rechazada';
        if (status === 'accepted') return 'confirmada';
        if (contract && contract.status === 'signed') return 'confirmada';
        if (contractIsOpen(contract, now)) return 'contrato_pendiente';
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
        contractIsOpen,
        contractForApplication,
        contractHref,
        deriveJb,
        deriveSpot,
        label,
        rawSpotLabel,
        rawJbLabel
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.WoApplicationState = api;
})(typeof window !== 'undefined' ? window : null);
