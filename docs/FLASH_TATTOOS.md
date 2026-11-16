# Flash Tattoos: flashes con precio fijo y reserva

Un **flash** es un diseño listo que el artista publica en su galería con precio fijo. El cliente lo reserva desde el perfil público y la solicitud entra al artista como una cotización más, marcada como flash.

## Datos

- El flash es un ítem de `artists_db.gallery_feed_items` con `category: 'flash'` y un `id` estable. Sus datos de venta van en la clave `flash` del mismo ítem:
  `{ price, currency, size_h_cm, size_w_cm, size_text, zones[], available, mode: 'unique' | 'repeat' }`.
  El CHECK `artists_db_gallery_feed_items_shape_check` no valida claves extra y ningún trigger las quita. Modelo puro: `public/shared/js/flash-model.js` (lo usan el navegador y el servidor).
- La solicitud es una fila de `quotations_db` con `source = 'flash'` y `flash_snapshot` (id, título, precio, moneda, tamaño, modo, imagen y, si hubo turno, `slot_minutes`), más `quotation_intake_extras.personalization_level = 'tal_cual'`. La imagen del flash se copia al bucket `quotation-references` como referencia con la nota «Flash del artista».
- Migración `supabase/migrations/20261117130000_flash_tattoos.sql` (reversa en `supabase/rollbacks/`): agrega `flash` a `quotations_db_source_check`, la columna `flash_snapshot` con su CHECK e índice, la guarda `trg_quotations_flash_guard` (anon/authenticated no crean cotizaciones de flash ni cambian la instantánea; el artista dueño tampoco) y el trigger de disponibilidad `trg_quotations_flash_availability`.

## Flujo

1. **El artista publica**: en el dashboard (galería → botón de etiqueta en cada foto) o en la cuenta (categoría «Flash» → botón de etiqueta) abre «Datos del flash» (`public/shared/js/flash-editor.js`): título, precio y moneda, alto × ancho en cm o un texto, zonas sugeridas, «Disponible» y «Se tatúa una sola vez» / «Se repite».
2. **Perfil público** (`artist-profile.js`): la tarjeta del flash muestra título, precio, tamaño y «Disponible» / «Reservado», también en el visor. «Reservar este flash» aparece solo si está disponible, tiene precio y quien mira no es el dueño. Favoritos sigue igual.
3. **Cliente** en `/flash?artist=<usuario>&id=<id>` (`public/flash/index.html`, `flash-booking.js`, `flash-booking.css`): datos de contacto (precargados con sesión de cliente) → zona (primero las sugeridas), salud y fecha de nacimiento (mínimo 14 años, aviso 14–17) → turno libre real si el artista tiene reservas online (apartado de 72 h) o rango tentativo → revisión («Enviar la solicitud no genera un cobro» + Términos y Privacidad) → «Solicitud enviada» con el código corto.
4. **Servidor** `POST /api/flash/request` (`lib/routes/flash.js`, lógica en `lib/flash.js`, datos en `lib/repos/flash.js`): valida el flash contra la galería de ese artista (existe, disponible, con precio, no es del propio cliente), toma precio, título y tamaño de la galería (nunca del navegador), rechaza si ya hay otra solicitud aprobada del mismo flash único y crea la cotización con `services/quotation-intake.submitIntake` (mismas validaciones, vínculo de cuenta solo con correo verificado, apartado de turno, aviso «Nueva solicitud» al artista con `is_flash` y `flash_title`, confirmación al cliente).
5. **Artista**: `/my-quotations` y el detalle muestran la insignia «Flash» y el bloque del flash (imagen, título, precio, tamaño). «Aceptar y enviar presupuesto» llega con el precio del flash, 1 sesión y la duración del turno elegido (`quote-respond-model.initialValues`).
6. **Disponibilidad del flash único** (trigger en la base): al pasar a `client_approved` el flash queda «Reservado» (`flash.available = false`, solo ese ítem del jsonb). Cancelar o rechazar antes de aprobar no cambia nada; si se cancela después de aprobada, vuelve a «Disponible» salvo que otra solicitud del mismo flash siga aprobada.

## Demo

`node scripts/release/local-preview.cjs` → `/preview/preview-local-safe/artist/profile?artist=mara-flash.wo` (flashes con «Reservar este flash»), `/preview/preview-local-safe/flash?artist=mara-flash.wo&id=fl_demo_golondrina` y la solicitud `DEMO-F01` en `/my-quotations`. Fixtures en `public/shared/js/demo-fixtures/flash.js`. Si el navegador ya tenía datos del preview guardados, usa «Reiniciar datos» en el ojo del preview para ver los flashes. En el preview el envío no llega al servidor: la pantalla final lo dice.

## Pruebas

`tests/flash-tattoos.test.js`.
