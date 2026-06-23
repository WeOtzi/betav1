'use strict';

// Repositorio Job Board (servidor) sobre la capa PostgREST unificada.
// Reemplaza los fetch('/rest/v1/job_board_*') inline del endpoint
// POST /api/job-board/accept-application. service-role (salta RLS); la
// autorizacion (ownership del request) la hace el endpoint antes de llamar.

const { pgrest } = require('../postgrest');

const JobBoardRepo = {
    getApplicationById(id) {
        return pgrest('job_board_applications').select('*').eq('id', id).limit(1).single().execute();
    },
    getRequestById(id) {
        return pgrest('job_board_requests').select('*').eq('id', id).limit(1).single().execute();
    },
    acceptApplication(id, decidedAt = new Date().toISOString()) {
        return pgrest('job_board_applications').eq('id', id).patch(
            { status: 'accepted', decided_at: decidedAt }, { returning: false }
        );
    },
    // Rechaza las demas postulaciones (pending|viewed) del mismo request.
    rejectOtherApplications(requestId, exceptApplicationId, decidedAt = new Date().toISOString()) {
        return pgrest('job_board_applications')
            .eq('request_id', requestId)
            .neq('id', exceptApplicationId)
            .in('status', ['pending', 'viewed'])
            .patch({ status: 'rejected', decided_at: decidedAt }, { returning: false });
    },
    // Cierra el request como aceptado y lo saca de lo publico.
    closeRequestAsAccepted(requestId, { artistId, applicationId, quoteId }, acceptedAt = new Date().toISOString()) {
        return pgrest('job_board_requests').eq('id', requestId).patch({
            status: 'accepted',
            accepted_at: acceptedAt,
            accepted_artist_id: artistId,
            accepted_application_id: applicationId,
            resulting_quote_id: quoteId,
            is_public: false,
        }, { returning: false });
    },
};

module.exports = { JobBoardRepo };
