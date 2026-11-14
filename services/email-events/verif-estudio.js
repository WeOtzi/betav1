'use strict';

// ===========================================================================
// Eventos de email del frente verif-estudio (verificación de estudios).
// El frente "emails" carga todos los archivos de services/email-events/ en el
// mapeo y en el render. serverOnly: solo los dispara el servidor
// (lib/routes/verif-estudio.js), nunca POST /api/email/:eventId.
//
// Plantilla BillionMail/n8n: studio-notification (recipient_name,
// studio_name, subject, body_text, dashboard_url). El destinatario es SIEMPRE
// el email de auth.users del dueño del estudio, nunca studios.email.
// ===========================================================================

const dash = (value) => {
    const text = value == null ? '' : String(value).trim();
    return text || '-';
};

const DECISION_LABELS = {
    approved: 'Verificado',
    rejected: 'Necesita una corrección',
    revoked: 'Sello retirado'
};

function decisionLabel(status) {
    return DECISION_LABELS[status] || dash(status);
}

module.exports = {
    // Soporte o el backoffice resolvieron la verificación del estudio:
    // aprobada (sello visible), con corrección pedida (rechazo con motivo) o
    // sello retirado (revocación desde el backoffice).
    studio_verification_decision: {
        name: 'Estudio: resultado de la verificación',
        description: 'Aviso al dueño del estudio cuando soporte aprueba la verificación, pide una corrección o retira el sello.',
        templateHint: 'studio-notification',
        serverOnly: true,
        recipient: (p) => p.recipient_email || p.to,
        attribs: (p) => ({
            recipient_name: dash(p.recipient_name),
            studio_name: dash(p.studio_name),
            subject: dash(p.subject),
            body_text: dash(p.body_text),
            dashboard_url: p.dashboard_url || '',
            decision: p.decision || '',
            decision_note: p.decision_note || '',
            location_label: p.location_label || '',
            public_profile_url: p.public_profile_url || ''
        }),
        render: {
            audience: 'studio',
            category: 'studios',
            subject: (d) => dash(d.subject),
            preheader: (d) => (d.decision === 'approved'
                ? `${dash(d.studio_name)} ya muestra el sello de estudio verificado.`
                : `Revisamos la verificación de ${dash(d.studio_name)}.`),
            eyebrow: 'Verificación del estudio',
            headline: (d) => {
                if (d.decision === 'approved') return 'Tu estudio está verificado';
                if (d.decision === 'revoked') return 'Retiramos el sello de verificación';
                return 'Necesitamos una corrección';
            },
            intro: (d) => dash(d.body_text),
            rows: (d) => [
                ['Estudio', dash(d.studio_name)],
                ['Sede revisada', dash(d.location_label)],
                ['Estado', decisionLabel(d.decision)],
                ...(d.decision_note ? [['Nota de soporte', dash(d.decision_note)]] : [])
            ],
            cta: (d) => (d.dashboard_url
                ? { label: d.decision === 'approved' ? 'Ver la verificación' : 'Revisar y reenviar', url: d.dashboard_url }
                : null)
        }
    }
};
