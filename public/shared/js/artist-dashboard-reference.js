/* Presentation data for Figma 24:1425, loaded only by the artist dashboard.
 * Never persists fixtures or replaces a repository, identity, or shared preview data. */
(function () {
  'use strict';
  if (window.WEOTZI_PREVIEW !== true || !window.WeotziPreview?.isSimulated) return;
  window.ArtistDashboardReference = {
    date: 'LUNES, 30 JUN · 09:12',
    greeting: 'Buen día, Laura.',
    sessions: [
      { hour: '10:00', name: 'Sofía Martínez', detail: 'Primera sesión · Brazo completo', status: 'confirmed', duration: '3H' },
      { hour: '13:30', name: 'Mateo Ruiz', detail: 'Sesión 2/3 · Espalda · dragón', status: 'confirmed', duration: '2H' },
      { hour: '16:00', name: 'Julia Ferrer', detail: 'Retoque · Muñeca', status: 'pending_confirmation', duration: '1H' },
      { hour: '18:30', name: 'Tomás Vega', detail: 'Consulta · Boceto nuevo', status: 'confirmed', duration: '45M' }
    ],
    designs: [
      { title: 'Manga floral', client: 'Sofía M.', stage: 'ENTINTADO', progress: 75, deadline: '12 JUL' },
      { title: 'Dragón espalda', client: 'Mateo R.', stage: 'BOCETO', progress: 40, deadline: '20 JUL' },
      { title: 'Mandala geométrico', client: 'Lucía B.', stage: 'FINAL', progress: 90, deadline: '08 JUL' }
    ],
    stats: { pending: 3, approved: 8, rejected: 1 },
    income: { month: '$4.820', week: '$1.240', due: '$650' },
    activity: [
      { icon: 'check-circle', text: 'Sofía confirmó su turno', when: 'HACE 12 MIN' },
      { icon: 'dollar-sign', text: 'Pago recibido · Mateo · $180', when: 'HACE 1 H' },
      { icon: 'mail', text: 'Nueva cotización de Camila Soto', when: 'HACE 2 H' },
      { icon: 'star', text: 'Reseña 5★ de Julia Ferrer', when: 'AYER' }
    ],
    reminders: [
      { text: 'Reponer tinta negra', type: 'stock', date: '02 JUL', priority: 'ALTA' },
      { text: 'Enviar boceto a Camila', type: 'sketch', date: '01 JUL', priority: 'URGENTE' },
      { text: 'Responder WhatsApp de Nico', type: 'message', date: '30 JUN', priority: 'NORMAL' },
      { text: 'Cobrar saldo · Mateo', type: 'payment', date: '04 JUL', priority: 'ALTA' }
    ]
  };
}());
