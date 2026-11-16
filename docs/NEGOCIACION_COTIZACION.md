# Negociación de la cotización

Ronda 2 · frente "negociacion" (16 nov 2026). Cubre los pedidos del dueño P23
(contrapropuesta del cliente), P25 (cambios al acuerdo aprobado) y la parte de
base de P4-saldo ("aprobada por ambas partes").

## Qué puede hacer cada parte

| Momento | Cliente | Artista |
|---|---|---|
| Propuesta recibida (`responded`, vigente) | **Aceptar**, **Rechazar** o **Modificar**: propone otro presupuesto y/o cambia zona, tamaño, estilo, color o la descripción de la idea. Puede retirar sus cambios. | Ve "El cliente propone cambios" con el antes → después. **Aceptar cambios** (la cotización queda aprobada por ambas partes), **Hacer otra propuesta** o **Mantener mi propuesta**. |
| Acuerdo aprobado (`client_approved`, `in_progress`, `artist_completed`) | Propone un cambio de precio, sesiones, seña o condiciones; aprueba o rechaza el que proponga el artista. | Lo mismo, en espejo. |
| Rechazada (`client_rejected`) | La cotización queda finalizada: para retomar la idea hay que iniciar una nueva. | No puede reabrirla ni escribirle al cliente por el chat. |

Reglas:

- **Rechazar** muestra la advertencia "Esto dará por finalizada la cotización y
  tendrás que iniciar una nueva." y es definitivo.
- **Una sola propuesta pendiente por cotización.** Una nueva reemplaza a la
  anterior (queda `superseded`).
- **Aceptar cambios** de una contrapropuesta aplica los cambios del cliente y
  deja el acuerdo cargado (`final_*`) con `quote_status = client_approved`.
- **Hacer otra propuesta**: cuando el artista manda una respuesta nueva
  (cambia `artist_responded_at` o el presupuesto) con una contrapropuesta
  pendiente, la contrapropuesta queda `superseded` y el pedido se actualiza
  con los datos que pidió el cliente (zona, tamaño, estilo, color, idea): la
  propuesta nueva responde a ese pedido. El presupuesto es el del artista.
- **Cambios al acuerdo**: no rigen hasta que la otra parte los aprueba. Al
  aprobar se aplican en una sola transacción y `agreement_version` sube en 1;
  al rechazar o retirar no cambia nada. El historial es la tabla
  `quotation_proposals`.
- Un cambio al acuerdo no puede dejar el precio por debajo de lo ya registrado
  como pagado (misma moneda) ni las sesiones por debajo de las ya agendadas o
  realizadas. La moneda del acuerdo no se negocia.
- Si cambia el precio y hay seña pactada, el monto de la seña se recalcula
  sobre el total nuevo (también en la cotización manual enviada, que es la que
  usa el panel de pagos).
- Con el vencimiento opcional activo, contraproponer corre `quote_expires_at`
  para que el artista tenga el plazo completo para contestar.
- Con un reclamo abierto (`dispute_status = 'open'`) no se negocia.
- Los cambios al acuerdo necesitan a las dos partes con cuenta. Si el cliente
  todavía no tiene cuenta (cotización manual o de invitado sin vincular,
  `client_user_id` vacío), no hay quién apruebe: el artista sigue editando el
  acuerdo directo, como antes, y el bloqueo empieza cuando el cliente vincula
  la cotización a su cuenta.

## "Aprobada por ambas partes" (contrato para otros frentes)

```
quotations_db.agreement_approved_at IS NOT NULL
  AND quote_status IN ('client_approved','in_progress','en_progreso','artist_completed','completed')
```

- `agreement_approved_at timestamptz`: lo sella la base (trigger
  `trg_quotation_zy_negociacion_guard`) cuando la cotización pasa a
  `client_approved`, por cualquiera de los caminos: el cliente acepta la
  propuesta, el artista acepta la contrapropuesta o el artista registra el
  acuerdo. Vuelve a `NULL` si la cotización regresa a `pending`/`responded`.
  El usuario final no lo puede escribir.
- `agreement_version integer`: 0 sin acuerdo, 1 al aprobarse, +1 por cada
  cambio al acuerdo aprobado por ambas partes.
- La migración sella las cotizaciones que ya estaban aprobadas.
- En el front: `WoQuoteNegotiation.isAgreed(cotización)` y
  `WoQuoteNegotiation.agreementOf(cotización)`; el estado del servidor trae
  `agreement: { approved, approved_at, version }`.

Con el acuerdo aprobado y el cliente con cuenta (`client_user_id` cargado), el
artista ya no puede editar directo `final_budget_amount`, `final_budget_currency`, `final_sessions`,
`final_comment`, `artist_deposit_pct` ni `artist_deposit_amount`: la base
responde `42501` ("El acuerdo ya está aprobado por ambas partes…"). El enlace
"editá el acuerdo" del expediente abre el formulario de cambio propuesto.

## Chat cerrado tras el rechazo

Policy **restrictiva** `chat_closed_after_client_rejection` sobre
`public.chat_messages` (INSERT): el artista de una cotización
`client_rejected` no puede insertar mensajes, declare el `sender_type` que
declare. Se suma (AND) a `artists_insert_chat` / `clients_insert_chat` de
`20261115170000`. El cliente no queda bloqueado en la base; `service_role` no
pasa por RLS. El frente "inbox" muestra el estado cerrado a partir de
`quote_status` (ya viene en la vista `chat_threads`).

En el expediente del artista, `quotation-negotiation.js` desactiva el redactor
(`#qd-compose`) de una cotización rechazada y explica el motivo, por si el
expediente todavía lo muestra.

Además, `client_rejected` es terminal: el trigger rechaza cualquier cambio de
estado desde ahí, también cuando escribe el servidor con `service_role` (la
propuesta del artista se guarda con service-role y no debe reabrirla en su
nombre). Soporte y `postgres` sí pueden. El selector de estado del listado del
artista no ofrece "volver a cotizar" una rechazada (`quotations-view-model.js`
· `STATUS_TRANSITIONS`) y el diálogo de la propuesta tampoco se abre
(`WoQuoteRespondModel.canPropose` → `client_rejected`). La visibilidad de los
datos de contacto la aplica el frente "cot-detalle".

El acuerdo aprobado tampoco se "desarma" por REST: con el sello puesto y cliente
con cuenta, el usuario final no puede devolver la cotización a `pending` /
`responded` (antes ese paso borraba el sello y dejaba reescribir el precio), y
no puede cambiar `client_user_id`, `source` ni `quotation_medium` de la
cotización (`fn_quotations_client_column_guard`, migración `20261116220000`):
las guardas del acuerdo y de las sesiones dependen de ese vínculo.

## Base de datos (`20261116140000_negociacion_propuestas.sql`)

- `quotation_proposals`: `kind` (`counter` | `amendment`), `proposed_by`
  (`client` | `artist`), `status` (`pending` | `accepted` | `rejected` |
  `superseded` | `withdrawn`), `changes` = `{ "<columna>": { "from", "to" } }`,
  `currency`, `note`, `response_note`, `base_agreement_version`.
  RLS: solo lectura para las dos partes y soporte.
- `negociacion_propose(...)` y `negociacion_resolve(...)`: alta y resolución
  atómicas, `security definer`, ejecutables solo por `service_role`. Bloquean
  la cotización, revalidan estado/pagos/sesiones y levantan códigos `NEG_*`
  que el servidor traduce (`lib/negociacion.js` · `dbError`).
- Triggers propios en `quotations_db` (corren después de
  `trg_quotation_status_change`): `trg_quotation_zy_negociacion_guard` y
  `trg_quotation_zz_negociacion_sync` (cierra las propuestas pendientes cuando
  la cotización cambia de estado).
- No modifica `fn_quotation_status_change`, `fn_quotations_client_column_guard`
  ni `chat_messages_before_insert`.

## Servidor

`lib/routes/negociacion.js` (lógica en `lib/negociacion.js`, datos en
`lib/repos/negotiation.js`). Todas exigen sesión y ser parte de la cotización.

| Ruta | Qué hace |
|---|---|
| `GET /api/negociacion/quotations/:quoteId?as=client\|artist` | Estado: permisos (`can`), valores vigentes, pendiente, historial, `agreement`. Responde `{ available: false }` si la migración no está aplicada. |
| `POST /api/negociacion/quotations/:quoteId/proposals` | `{ kind, changes, note?, as? }`. `counter` solo el cliente; `amendment` cualquiera de las dos partes. |
| `POST /api/negociacion/quotations/:quoteId/proposals/:proposalId/:action` | `accept` / `reject` (la contraparte) · `withdraw` (quien propuso). `{ note?, as? }`. |

Cuando el artista acepta una contrapropuesta se dispara el mismo hook que la
aceptación del cliente (`lib/cot-cliente.js` · `onClientDecision`), con
`via: 'counter_accepted'`.

Emails (`services/email-events/negociacion.js`, solo servidor, a la
contraparte en cada paso): `negotiation_counter_proposed`,
`negotiation_counter_accepted`, `negotiation_counter_declined`,
`negotiation_amendment_proposed`, `negotiation_amendment_accepted`,
`negotiation_amendment_rejected`, `negotiation_proposal_withdrawn`.

## Front

Un solo archivo: `public/shared/js/quotation-negotiation.js` (modelo + HTML +
controlador) y su hoja `public/shared/css/quotation-negotiation.css`, que el
módulo carga solo. Expone `window.WoQuoteNegotiation` y
`WeotziData.Negotiation`.

- **Cliente** (`/client/dashboard`): `client-quote-proposal.js` deja el botón
  "Modificar" (`data-wqn-open="counter"`, oculto hasta que el servidor lo
  habilita) y el punto de montaje `<div data-wqn-mount data-quote-id
  data-role="client">`. El módulo lo llena con la contrapropuesta pendiente,
  los cambios al acuerdo y el historial.
- **Artista** (`/my-quotations/detail`): escucha
  `wo:quotation-detail-rendered` e inserta `#qd-negotiation-slot` debajo de la
  identidad del cliente. No edita `quotation-detail-figma.js`.

Eventos de `document`:

- `wo:quote-respond` · `detail = { quoteId, prefill, handled }` con
  `prefill = { source: 'client_counter', proposalId, amount, currency, note,
  changes, summary }`. Lo dispara "Hacer otra propuesta". Quien lo atienda
  puede marcar `detail.handled = true`, llamar `preventDefault()` o
  simplemente abrir su diálogo; si nadie lo atiende, a los 450 ms se abre
  `/my-quotations/detail?id=<quote_id>&modal=responder`.
- `wo:negotiation-changed` · `detail = { quoteId, role, action, proposal,
  quote_status }` después de cada propuesta o resolución.

Si existe `window.WoNotify.ping` (frente "push"), el panel avisa cuando
aparece una propuesta nueva de la otra parte mientras la página está abierta.
