# Propuesta del artista (ronda 2 · frente `cot-respuesta`)

Cómo responde, modifica y acompaña con condiciones el artista una cotización,
y qué lee el panel del cliente. Pedidos del dueño: P4, P5, P25 (artista) y P29.

## Archivos

| Capa | Archivo | Rol |
|---|---|---|
| Modelo puro (navegador + Node) | `public/shared/js/quote-respond-model.js` | Validación, variables, fechas ofrecidas, cruce con la agenda, patches |
| Diálogo | `public/shared/js/quote-respond-dialog.js` + `public/shared/css/quote-respond.css` | "Aceptar y enviar presupuesto" / "Modificar propuesta" / "Volver a cotizar" |
| Franja del expediente | `public/shared/js/quote-status-priority.js` | Estado, Prioridad y botón "Modificar propuesta" |
| Datos (front) | `public/shared/js/data/quote-respond-repo.js` (`WeotziData.QuoteRespond`) | API del servidor + respuestas rápidas (RLS) |
| Servidor | `lib/cot-respuesta.js`, `lib/repos/cot-respuesta.js`, `lib/routes/cot-respuesta.js` | Agenda real, validación, guardado, aviso |
| Email | `services/email-events/cot-respuesta.js` | `artist_updated_quotation_proposal` |
| Base | `supabase/migrations/20261116120000_cot_respuesta_propuesta.sql` | `offered_slots`, `proposal_message`, `artist_message_templates` |

`quotation-detail-figma.js` solo delega: `openRespondDialog()` abre el diálogo
nuevo si `window.WoQuoteRespond` está cargado y, si no, usa el diálogo anterior.
En modo demo / preview (`WoDemo.enabled`, `WEOTZI_PREVIEW`) también se usa el
anterior: las cotizaciones de ejemplo no existen en el servidor.

## Cuándo se puede (re)enviar una propuesta (P25)

`WoQuoteRespondModel.canPropose(quote)`. Se puede mientras la cotización **no
esté aprobada por ambas partes**: bloquean `client_approved`, `in_progress`
(salvo el borrador del cotizador), `artist_completed`, `completed`,
`cancelled`, `client_rejected` y una disputa abierta. Cualquier otro estado
admite propuesta (lista de bloqueo, así un estado nuevo de la negociación no
queda afuera).

- `pending` → primera respuesta (`responded`).
- `responded` → **propuesta actualizada**: el estado no cambia, se renueva
  `artist_responded_at` (y con él el vencimiento), queda una fila
  `responded → responded` en `quotation_status_history` y el cliente recibe
  `artist_updated_quotation_proposal`.
- `expired` → vuelve a `responded` ("Volver a cotizar").
- `client_rejected` → **no admite propuesta** (P23): el rechazo del cliente da
  por finalizada la cotización. `canPropose` devuelve `code: 'client_rejected'`,
  el servidor responde 409 sin guardar, la franja de estado no ofrece "Volver a
  cotizar" y el trigger `negociacion_quotation_guard` tampoco deja que el
  servidor (`service_role`) la saque de ese estado. Para retomarla, el cliente
  inicia una cotización nueva.

La edición **después** de aprobada por ambos es del frente "negociación".

### Contrato entre frentes: reabrir el diálogo precargado

```js
document.dispatchEvent(new CustomEvent('wo:quote-respond', {
  detail: {
    quoteId: 'QT-…',            // quote_id o id de la cotización abierta
    prefill: {                  // todo opcional
      amount, currency, sessions, minutes, deposit_pct,
      location, complexity, availability_note, message,
      offered: [{ kind: 'slot', start, end }, { kind: 'range', from, to }],
      extras: { items: [{ name, qty, price }], discount_pct, tax_pct, policy, client_notes, extra_terms },
      tab: 'propuesta' | 'disponibilidad' | 'condiciones' | 'mensaje'
    }
  }
}));
```

Lo escucha `quotation-detail-figma.js` (expediente del artista). Si `quoteId`
no es la cotización abierta, se ignora. También existe
`window.WoQuotationDetailActions = { respond(prefill), agreement(), changeStatus(estado), changePriority(valor) }`.

## API (`lib/routes/cot-respuesta.js`)

Todas piden `Authorization: Bearer <sesión del artista dueño>`. `:quoteId` es
el `quote_id` (texto) o el `id` numérico.

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/api/cot-respuesta/quotations/:quoteId/proposal` | Contexto: `editable`, `mode`, `timezone`, `has_schedule`, `extras` (campos de la manual guardados) |
| GET | `/api/cot-respuesta/quotations/:quoteId/availability?from&to&minutes` | Agenda real por día (máx. 62 días): `status`, `open`, `slots`, `busy` |
| POST | `/api/cot-respuesta/quotations/:quoteId/proposal` | Valida y guarda. `validate_only: true` solo valida |
| POST | `/api/cot-respuesta/quotations/:quoteId/agreement-sync` | Tras el acuerdo, alinea la seña de la fila manual |

Errores del POST: `400 invalid` (`errors` por campo), `400 invalid_offer`,
`409 slot_conflict` (`conflicts: [{ index, label, reason }]`), `409 approved`,
`409 race`, `503 agenda_unavailable`.

## Disponibilidad conectada a la agenda (P4)

La agenda sale del motor de turnos existente (`lib/booking-slots.js` →
`booking-slots-model.js`) y de la RPC `list_artist_blocking_intervals`, con el
largo de sesión de la propuesta.

- **Bloquea (confirmado)**: eventos que ocupan agenda (`event`), sesiones
  (`session`), citas de estudio (`studio_booking`), viajes confirmados (`trip`)
  y vacaciones (`vacation`).
- **No bloquea**: los apartados pendientes de otras solicitudes (`hold`) y lo
  que ya ocupa **esta misma** cotización (sus sesiones y eventos).
- Estado por día: `free`, `partial`, `busy`, `closed` (sin horario ese día) y
  `past`. Sin horario semanal guardado se usa una jornada de 09:00 a 21:00 y el
  diálogo lo avisa.

Se ofrecen dos tipos de fecha (hasta 12 por propuesta):

- `slot` — turno con horario. Se rechaza si se superpone con algo confirmado.
- `range` — rango de días (hasta 31, horario a coordinar). Se rechaza si
  incluye un día `busy` o pasado; el diálogo parte el rango alrededor de los
  días ocupados antes de enviarlo.

El servidor vuelve a calcular la agenda al guardar: lo que el navegador mande
no se confía.

### Datos guardados

```jsonc
// quotations_db.offered_slots (jsonb, arreglo, máx. 12)
[
  { "kind": "slot",  "start": "2026-12-05T17:00:00.000Z", "end": "2026-12-05T20:00:00.000Z",
    "label": "sáb 5 dic 2026 · 14:00–17:00", "tz": "America/Argentina/Buenos_Aires" },
  { "kind": "range", "start": "2026-12-10T03:00:00.000Z", "end": "2026-12-16T03:00:00.000Z",
    "from": "2026-12-10", "to": "2026-12-15", "label": "10 al 15 dic 2026", "tz": "America/Argentina/Buenos_Aires" }
]
```

- `start` / `end`: instantes UTC. `label`: texto listo en la zona del artista.
- `quotations_db.artist_availability` (texto) sigue existiendo: nota libre +
  etiquetas separadas por `; `. Es lo que ya muestran los correos y cualquier
  pantalla anterior.
- `quotations_db.proposal_message`: mensaje ya resuelto.

## Respuestas rápidas y variables (P4)

- Variables: `{{cliente}}`, `{{presupuesto}}`, `{{moneda}}`, `{{sesiones}}`,
  `{{duracion}}`, `{{seña}}` (también `{{sena}}`), `{{fechas}}`, `{{estudio}}`,
  `{{artista}}`. El diálogo las inserta con chips y muestra la vista previa.
- El mensaje se **guarda ya resuelto** (chat de la cotización, correo y
  `proposal_message`). Si queda una variable desconocida (`{{…}}`), ni el
  diálogo ni el servidor dejan enviar: al cliente nunca le llega una variable
  cruda.
- Set por defecto en el código (`DEFAULT_TEMPLATES`). Las propias del artista
  van en `artist_message_templates` (`user_id`, `kind`, `title`, `body`,
  `sort`) con `kind = 'quote'`; el frente "inbox" usa `kind = 'chat'` en la
  misma tabla. RLS: cada usuario ve y edita solo las suyas.

## Campos de la cotización manual en una solicitud de cliente (P29)

El diálogo suma: desglose económico, política de reserva y cancelación, notas
para el cliente, términos adicionales, estudio o ubicación y complejidad. Los
totales usan `WoQuotationNewModel.computeTotals` (misma cuenta que
`/my-quotations/new`).

Dónde se guardan y **qué lee el panel del cliente**:

| Campo | Dónde | Cómo lo ve el cliente |
|---|---|---|
| Desglose, descuento, impuestos | `artist_manual_quotes.line_items`, `discount_pct`, `tax_pct`, `subtotal`, `total` | Bloque "Desglose" (`client-quote-proposal.js`) |
| Política | `artist_manual_quotes.cancellation_policy` (`''` = sin política) | "Condiciones del artista" |
| Notas / términos | `artist_manual_quotes.client_notes`, `extra_terms` | "Condiciones del artista" |
| Complejidad | `artist_manual_quotes.project.complexity` | Fila "Complejidad" |
| Estudio o ubicación | `quotations_db.artist_studio_name` | Campo "Estudio" del detalle |
| Seña | `quotations_db.artist_deposit_*` y `artist_manual_quotes.deposit_*` | "Seña y pagos" |
| Fechas ofrecidas | `quotations_db.offered_slots` | "Fechas que te ofrece el artista" |
| Mensaje | `quotations_db.proposal_message` | Texto bajo el resumen |

Para una solicitud de cliente la fila de `artist_manual_quotes` se crea con
`status = 'sent'`, `origin = 'cliente'`, `quote_id` de la cotización y
`quote_ref = COT-RSP<id en base 36>`. La RLS no deja al artista escribir filas
`sent`: por eso la escribe el servidor (service-role) después de comprobar que
la cotización es suya. La policy `artist_manual_quotes_client_select` ya le
permite al cliente leerla. Si el artista no usa ninguno de estos campos, no se
crea fila.

## Estado y prioridad en el expediente (P5)

`quote-status-priority.js` monta una franja debajo de la identidad:

- **Estado**: el actual más las transiciones del artista
  (`WoQuotationsViewModel.statusOptions`, subconjunto del trigger vivo
  `fn_quotation_status_change`). `responded` abre el diálogo de la propuesta,
  `client_approved` el del acuerdo, `artist_completed` y `cancelled` pasan por
  sus acciones (avisan al cliente).
- **Prioridad**: `quotations_db.priority` (`high` / `medium` / `low`), la misma
  columna que ya muestra y filtra el listado `/my-quotations`.

## Saldo acordado (P4)

El saldo/importe acordado figura como activo **solo** con la cotización
aprobada por ambas partes (`WoPaymentsModel.agreementActive`, mismos estados
que `approvedByBoth`). `summarize()` devuelve `active`:

- `active: false` → el panel de pagos del expediente y el diálogo "Registrar
  pago" muestran "Propuesto" y el saldo acordado sin activar; el panel del
  cliente no muestra "Saldo".
- El dashboard ("Saldo pend.") y el Wallet ya contaban solo cotizaciones
  aprobadas.

## Email

`artist_updated_quotation_proposal` (server-only, al cliente): presupuesto,
seña, sesiones, duración, fechas ofrecidas, estudio, vigencia y el mensaje. La
primera respuesta sigue saliendo por `artist_responded_quotation`.
