/* Figma 801:559 / 801:558. Read-only presentation fixtures, never remote data.
 * The summary and drawer are distinct reference snapshots (6 vs 5 unread). */
(function () {
  'use strict';
  window.ArtistDashboardMenuModel = {
    create: function (flags) {
      if (!flags.dashboard || flags.preview !== true || flags.simulated !== true) return null;
      var rows = [
        ['message', 'message-circle', 'Nuevo mensaje', 'Tomás Reyes respondió tu cotización.', 'Hace 5 minutos', true, '/artist/inbox'],
        ['invitation', 'star', 'Nueva invitación', 'Black Ink Studio te invitó a un Guest Spot.', 'Hace 20 minutos', true, '/artist/invitations'],
        ['booking', 'calendar', 'Reserva confirmada', 'Julieta Sosa confirmó la sesión del 15 de agosto.', 'Hace 1 hora', true, '/calendar'],
        ['application', 'briefcase', 'Nueva postulación', 'Tu solicitud para Ink Society fue aceptada.', 'Hace 3 horas', true, '/artist/applications?tab=spots'],
        ['reminder', 'calendar', 'Recordatorio', 'Mañana tenés una sesión con Camila Ortiz a las 14:00.', 'Hace 5 horas', true, '/calendar'],
        ['expired', 'dollar-sign', 'Cotización vencida', 'Tu cotización a Bruno T. venció sin respuesta.', 'Ayer', false, '/my-quotations'],
        ['counteroffer', 'briefcase', 'Contraoferta recibida', 'Costa Ink Collective propuso nuevas fechas para tu spot.', 'Ayer', false, '/artist/applications?tab=spots'],
        ['studio-message', 'message-circle', 'Nuevo mensaje', 'Estudio Cactus te escribió sobre el guest spot.', 'Hace 2 días', false, '/artist/inbox'],
        ['update', 'zap', 'Actualización de la plataforma', 'Agregamos filtros nuevos al Job Board.', 'Hace 3 días', false, null]
      ];
      function key(row) { return 'figma12:' + row[0]; }
      return {
        identity: { name: 'Lauumarth.wo', initials: 'LM', email: 'laura.martinez@email.com' },
        feed: function (seen) {
          return rows.map(function (row) {
            return { key: key(row), icon: row[1], title: row[2], desc: row[3], timeLabel: row[4], unread: row[5] && !seen.has(key(row)), href: row[6] };
          });
        },
        counts: function (seen) {
          var unread = rows.filter(function (row) { return row[5] && !seen.has(key(row)); }).length;
          var update = seen.has('figma12:update') ? 0 : 1;
          return { notifications: unread + update, msgs: unread ? (seen.has('figma12:message') ? 2 : 3) : 0, inv: 1, apps: 2, updates: update };
        }
      };
    }
  };
}());
