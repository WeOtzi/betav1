'use strict';

// ── verif-artista ── Eventos de email nuevos del frente de verificación de artistas.
// Los carga el mapeo de services/email-events/*.js (frente emails); mientras
// tanto lib/routes/verif-artista.js los registra si faltan (ensureEmailEvents).
//
// profile_verified y profile_verification_denied (al artista) ya existen en
// services/email-event-mapping.js con webhook n8n en vivo; aquí solo se suma el
// aviso a soporte cuando un artista pide la verificación.

module.exports = {
    artist_verification_requested: {
        name: 'Soporte: un artista pidió la verificación',
        description: 'Aviso al equipo de soporte cuando un artista solicita la verificación de su perfil desde Cuenta · Verificación (identidad y domicilio ya cargados).',
        templateHint: 'support-verification-request',
        serverOnly: true,
        // SUPPORT_EMAIL si está configurado; si no, los agentes activos de support_users_db.
        recipients: p => [].concat(p.support_email || [], Array.isArray(p.support_emails) ? p.support_emails : []).filter(Boolean),
        attribs: p => ({
            artist_name: p.artist_name || 'Artista',
            artist_username: p.artist_username || '-',
            documents_summary: p.documents_summary || '-',
            requested_at: p.requested_at || '',
            queue_url: p.queue_url || '',
            profile_url: p.profile_url || ''
        }),
        render: {
            audience: 'admin',
            category: 'account',
            subject: d => `Verificación pendiente: ${d.artist_name || 'artista'}`,
            preheader: d => `${d.artist_name || 'Un artista'} pidió verificar su perfil. Revísalo en la cola de soporte.`,
            eyebrow: 'Verificación de artistas',
            headline: d => `${d.artist_name || 'Un artista'} pidió la verificación`,
            intro: () => 'Ya cargó su documento de identidad y su comprobante de domicilio. Revisa los documentos y aprueba o deniega la verificación con un motivo: el artista recibe el resultado por email y en su panel.',
            rows: d => [
                ['Artista', d.artist_name || '-'],
                ['Usuario', d.artist_username || '-'],
                ['Documentos', d.documents_summary || '-'],
                ['Pedido', d.requested_at || '-']
            ],
            cta: d => (d.queue_url ? { label: 'Abrir la cola de verificación', url: d.queue_url } : null)
        }
    }
};
