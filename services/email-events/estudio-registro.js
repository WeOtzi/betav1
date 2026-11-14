'use strict';

// ===========================================================================
// Emails del frente estudio-registro (beta cerrada, nov 2026).
// ---------------------------------------------------------------------------
// El frente "emails" carga automáticamente todos los archivos de
// services/email-events/ en el mapeo (services/email-event-mapping.js) y en el
// render. Los dos eventos los dispara solo el servidor (serverOnly) desde
// lib/routes/estudio-registro.js, con destinatario de auth.users y links
// armados con applicationBase (nunca con datos del navegador).
//
//   studio_registration_completed  Bienvenida al dueño cuando termina el alta.
//   studio_claim_decided           Soporte aprobó o rechazó el reclamo de una ficha.
// ===========================================================================

const text = (value, fallback = '') => {
    const s = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    return s || fallback;
};

module.exports = {
    studio_registration_completed: {
        name: 'Estudio: registro completado',
        description: 'Bienvenida al dueño del estudio cuando termina el alta (sedes, panel y próximos pasos).',
        templateHint: 'studio-welcome',
        serverOnly: true,
        recipient: p => p.email,
        attribs: p => ({
            email: p.email,
            studio_name: text(p.studio_name, 'Tu estudio'),
            locations_text: text(p.locations_text, 'Sin sedes cargadas'),
            locations_count: Number(p.locations_count) || 0,
            verification_required: p.verification_required ? 'si' : 'no',
            dashboard_url: p.dashboard_url,
            profile_url: p.profile_url,
            locations_url: p.locations_url,
            team_url: p.team_url,
            verification_url: p.verification_url,
        }),
        render: {
            audience: 'studio',
            category: 'account',
            subject: d => `Bienvenido a We Ötzi, ${text(d.studio_name, 'tu estudio')}`,
            preheader: () => 'Tu estudio ya tiene perfil en We Ötzi. Estos son los próximos pasos.',
            eyebrow: 'Estudios · Registro',
            headline: d => `${text(d.studio_name, 'Tu estudio')} ya está en We Ötzi`,
            intro: d => (d.verification_required === 'si'
                ? 'Registramos tu estudio y sus sedes. Encontramos estudios con un nombre parecido, así que antes de mostrar el sello de verificado te vamos a pedir información desde el panel.'
                : 'Registramos tu estudio y sus sedes. Desde el panel podés completar el perfil, sumar a tu equipo y pedir el sello de estudio verificado.'),
            rows: d => [
                ['Estudio', text(d.studio_name, 'Tu estudio')],
                ['Sedes', text(d.locations_text, 'Sin sedes cargadas')],
                ['Próximo paso', 'Invitá a los artistas de tu equipo'],
                ['Verificación', d.verification_required === 'si' ? 'Pendiente: enviá la información' : 'Podés pedirla desde el panel'],
            ],
            cta: d => (d.dashboard_url ? { label: 'Ir al panel del estudio', url: d.dashboard_url } : null),
        },
    },

    studio_claim_decided: {
        name: 'Estudio: reclamo de ficha resuelto',
        description: 'Aviso a quien reclamó una ficha del catálogo cuando soporte aprueba o rechaza el reclamo.',
        templateHint: 'studio-notification',
        serverOnly: true,
        recipient: p => p.email,
        attribs: p => ({
            email: p.email,
            contact_name: text(p.contact_name),
            studio_name: text(p.studio_name, 'tu estudio'),
            status: p.status === 'approved' ? 'approved' : 'rejected',
            decision_note: text(p.decision_note),
            cta_url: p.cta_url,
        }),
        render: {
            audience: 'studio',
            category: 'studios',
            subject: d => (d.status === 'approved'
                ? `Aprobamos tu reclamo de ${text(d.studio_name, 'tu estudio')}`
                : `Tu reclamo de ${text(d.studio_name, 'tu estudio')} no fue aprobado`),
            preheader: d => (d.status === 'approved'
                ? 'Ya administrás el estudio en We Ötzi.'
                : 'Revisamos tu reclamo y no pudimos aprobarlo.'),
            eyebrow: 'Estudios · Reclamo de ficha',
            headline: d => (d.status === 'approved' ? 'Ya sos el dueño del estudio' : 'No aprobamos tu reclamo'),
            intro: d => (d.status === 'approved'
                ? `Revisamos tu reclamo y ya administrás ${text(d.studio_name, 'el estudio')} en We Ötzi. Completá el perfil y las sedes desde el panel.`
                : `Revisamos tu reclamo de ${text(d.studio_name, 'el estudio')} y no pudimos aprobarlo. Si el estudio es tuyo, escribinos con más datos; también podés registrar un estudio nuevo.`),
            rows: d => [
                ['Estudio', text(d.studio_name, 'tu estudio')],
                ['Estado', d.status === 'approved' ? 'Aprobado' : 'Rechazado'],
                ...(d.decision_note ? [['Nota de soporte', text(d.decision_note)]] : []),
            ],
            cta: d => (d.cta_url
                ? { label: d.status === 'approved' ? 'Ir al panel del estudio' : 'Registrar un estudio', url: d.cta_url }
                : null),
        },
    },
};
