'use strict';

// Payloads de ejemplo (ficticios) para previsualizar y testear cada correo.
// Los usan scripts/email-preview.js y tests/email-render.test.js.

const BASE = 'https://beta.weotzi.com';

const quote = {
    app_base_url: BASE,
    quote_id: 'WO-2026-0142',
    quote_status: 'responded',
    client_name: 'Lucía Fernández',
    client_full_name: 'Lucía Fernández',
    client_email: 'lucia.cliente@example.com',
    client_user_id: '11111111-1111-4111-8111-111111111111',
    artist_name: 'Mateo Rivas',
    artist_email: 'mateo.artista@example.com',
    artist_id: '22222222-2222-4222-8222-222222222222',
    artist_user_id: '22222222-2222-4222-8222-222222222222',
    tattoo_description: 'Una golondrina tradicional con una rosa, línea gruesa y colores planos en el antebrazo.',
    tattoo_body_part: 'Antebrazo',
    tattoo_location: 'Antebrazo',
    tattoo_size: 'Mediano (10-15 cm)',
    tattoo_style: ['Tradicional', 'Neotradicional'],
    client_budget_amount: '250',
    client_budget_currency: 'USD',
    artist_budget_amount: '280',
    artist_budget_currency: 'USD',
    estimated_sessions: '2',
    reference_images: ['https://flbgmlvfiejfttlawnfu.supabase.co/storage/v1/object/public/quotation-references/demo/ref-1.jpg'],
    client_completed_at: '2026-11-20T18:30:00Z',
    message_preview: '¡Hola Lucía! Te mandé la propuesta con dos sesiones. Si querés ajustamos el tamaño.'
};

const session = { ...quote, session_id: 'sess-1', session_number: 1, session_date: '2026-11-21T14:00:00Z', duration_hours: '3', location: 'Estudio Norte, Palermo' };

const FIXTURES = {
    artist_registration_completed: { app_base_url: BASE, email: 'mateo.artista@example.com', artistic_name: 'Mateo Rivas', name: 'Mateo Rivas', username: 'mateo.ink', styles_text: 'Tradicional, Blackwork', city: 'Buenos Aires', country: 'Argentina', studio: 'Estudio Norte', profile_url: `${BASE}/artist/profile?artist=mateo.ink` },
    client_registration_completed: { app_base_url: BASE, email: 'lucia.cliente@example.com', full_name: 'Lucía Fernández', quote_id: 'WO-2026-0142' },
    password_reset_temp: { app_base_url: BASE, email: 'lucia.cliente@example.com', temp_password: 'Tq7-ab9X', user_type: 'client', login_url: `${BASE}/client/login` },
    client_quotation_submitted: { ...quote, quote_status: 'pending' },
    artist_responded_quotation: quote,
    client_approved_quotation: { ...quote, quote_status: 'client_approved' },
    client_rejected_quotation: { ...quote, quote_status: 'client_rejected' },
    artist_rejected_quotation: { ...quote, quote_status: 'cancelled' },
    quotation_ready_for_client: { ...quote, quote_status: 'artist_completed' },
    dispute_artist_response: { ...quote, dispute_title: 'El color no coincide con la referencia', artist_response: 'Hola Lucía, podemos hacer un retoque sin costo la semana próxima.', support_email: 'soporte@weotzi.com' },
    quotation_expired: { ...quote, quote_status: 'expired', expired_at: '2026-11-18T03:00:00Z' },
    quotation_completed_summary: { ...quote, quote_status: 'completed', final_budget_amount: '280', final_budget_currency: 'USD', final_sessions: '2' },
    client_left_rating: { ...quote, rating: '5', rating_comment: 'Excelente trabajo y muy buena onda.' },
    request_rating: { ...quote, quote_status: 'completed' },
    job_board_request_created: { app_base_url: BASE, client_email: 'lucia.cliente@example.com', client_name: 'Lucía Fernández', request_code: 'JB-0042', tattoo_idea_description: 'Un dragón japonés en la espalda.', tattoo_body_part: 'Espalda', budget_min: '400', budget_max: '700', budget_currency: 'USD' },
    job_board_application_received: { app_base_url: BASE, client_email: 'lucia.cliente@example.com', client_name: 'Lucía Fernández', artist_name: 'Mateo Rivas', request_code: 'JB-0042', estimated_price: '550', budget_currency: 'USD', estimated_sessions: '3', message_preview: 'Me encantaría hacerlo, tengo experiencia en japonés.' },
    job_board_application_accepted: { app_base_url: BASE, artist_email: 'mateo.artista@example.com', artist_name: 'Mateo Rivas', client_name: 'Lucía Fernández', request_code: 'JB-0042', quote_id: 'WO-2026-0150' },
    job_board_application_rejected: { app_base_url: BASE, artist_email: 'mateo.artista@example.com', artist_name: 'Mateo Rivas', request_code: 'JB-0042' },
    chat_message_to_artist: { ...quote, message_preview: 'Hola, ¿podemos pasar la sesión al sábado?', chat_url: `${BASE}/artist/inbox?quote=WO-2026-0142` },
    chat_message_to_client: { ...quote, chat_url: `${BASE}/client/chats?quote=WO-2026-0142` },
    session_scheduled: { ...session, status: 'scheduled' },
    session_rescheduled: { ...session, status: 'rescheduled' },
    session_cancelled: { ...session, status: 'cancelled' },
    session_completed: { ...session, status: 'completed' },
    session_reminder_24h: { ...session, status: 'scheduled' },
    artist_calendar_reminder: { app_base_url: BASE, artist_email: 'mateo.artista@example.com', artist_name: 'Mateo Rivas', reminder_title: 'Comprar tintas', reminder_when: 'Jueves 20 de noviembre, 10:00 h', reminder_detail: 'Negro y rojo', dashboard_url: `${BASE}/calendar` },
    profile_verified: { app_base_url: BASE, artist_email: 'mateo.artista@example.com', artist_name: 'Mateo Rivas' },
    profile_verification_denied: { app_base_url: BASE, artist_email: 'mateo.artista@example.com', artist_name: 'Mateo Rivas', reason: 'La foto del documento está borrosa. Subila de nuevo con buena luz.' },
    instagram_verification_code: { app_base_url: BASE, artist_email: 'mateo.artista@example.com', artist_name: 'Mateo Rivas', verification_code: 'WO-4F7K2Q', instagram_handle: '@mateo.ink', expires_label: '72 horas', weotzi_instagram: '@weotzi', dm_url: 'https://ig.me/m/weotzi' },
    artist_support_decision: { app_base_url: BASE, artist_email: 'mateo.artista@example.com', artist_name: 'Mateo Rivas', decision_title: 'Aprobamos tu destino de retiro', decision_detail: 'Ya podés pedir retiros a esa cuenta.', support_note: '-', support_reference: 'SUP-1042', dashboard_url: `${BASE}/artist/account` },
    ambassador_status_updated: { app_base_url: BASE, artist_email: 'mateo.artista@example.com', artist_name: 'Mateo Rivas', ambassador_status: 'Embajador' },
    studio_roster_invite: { app_base_url: BASE, artist_email: 'mateo.artista@example.com', to: 'mateo.artista@example.com', recipient_name: 'Mateo Rivas', studio_name: 'Estudio Norte', subject: 'Estudio Norte te invitó a su roster', body_text: 'Hola Mateo,\n\nEstudio Norte te invitó como residente a su roster en We Ötzi.', links: { invitations: `${BASE}/artist/invitations` } },
    studio_spot_decision: { app_base_url: BASE, artist_email: 'mateo.artista@example.com', to: 'mateo.artista@example.com', recipient_name: 'Mateo Rivas', studio_name: 'Estudio Norte', decision: 'accepted', subject: '¡Te aceptaron en Estudio Norte!', body_text: 'Estudio Norte aceptó tu postulación al spot "Guest diciembre".', links: { invitations: `${BASE}/artist/invitations` } },
    platform_update: { app_base_url: BASE, email: 'mateo.artista@example.com', recipient_name: 'Mateo Rivas', feature_1_title: 'Calendario', feature_1_description: 'Sincronizá tus sesiones con Google Calendar.' },
    account_deletion_received: { app_base_url: BASE, email: 'lucia.cliente@example.com', user_name: 'Lucía', status_title: 'recibimos tu solicitud de baja', status_detail: 'Soporte la revisa en hasta 30 días.', support_note: '-', request_reference: 'BAJA-7F2A', account_url: `${BASE}/client/profile#seguridad` },
    inbox_message_received: { app_base_url: BASE, recipient_email: 'mateo.artista@example.com', recipient_name: 'Mateo Rivas', recipient_role: 'artist', sender_name: 'Estudio Norte', thread_subject: 'Guest spot de diciembre', message_preview: '¿Te sirve llegar el 3 de diciembre?', chat_url: `${BASE}/artist/inbox?thread=abc` }
};
for (const status of ['approved', 'rejected', 'completed']) {
    FIXTURES[`account_deletion_${status}`] = { ...FIXTURES.account_deletion_received, status_title: `soporte ${status === 'completed' ? 'completó' : status === 'approved' ? 'aprobó' : 'rechazó'} tu solicitud de baja` };
}

/** Payload de ejemplo (o uno genérico con datos de cotización). */
function fixtureFor(eventId) {
    return FIXTURES[eventId] || { ...quote, email: 'demo@example.com', recipient_email: 'demo@example.com' };
}

module.exports = { FIXTURES, fixtureFor, BASE };
