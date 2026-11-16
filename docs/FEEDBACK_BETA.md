# Feedback de la beta cerrada

Cómo recogemos la opinión de tatuadores, clientes y estudios durante la beta cerrada: un **botón en toda la app** y **encuestas cortas** en los momentos clave.

## Qué ve cada persona

- **Botón "Comentarios"** abajo a la izquierda (el chat de soporte queda a la derecha). En celular es un cuadrado con el ícono. Sube solo por encima de barras fijas, como la barra ATRÁS · CONTINUAR del cotizador o el banner de cookies.
  - Aparece en las páginas donde hay sesión de una cuenta de tatuador, cliente o estudio. No aparece sin sesión, ni en `/support` ni en `/backoffice`.
  - Para quitarlo de una página: `<html data-wo-feedback="off">` (las encuestas siguen funcionando).
  - El modal pide el tipo (Error / Idea / Comentario), "¿Qué tan fácil te resultó?" del 1 al 5 (opcional), el mensaje (de 10 a 2000 caracteres) y hasta 2 capturas (imágenes de 10 MB como máximo). Al enviar muestra un mensaje de gracias.
  - Además del mensaje se guarda solo: la ruta de la página (sin query ni hash), el título, el tipo de cuenta (lo decide el servidor), el idioma, el ancho y alto de la pantalla y el navegador.
  - Las capturas van al bucket privado `support-attachments`, en `<uid>/feedback/<ts>-<rand>-<nombre>`. Solo las ve soporte, con URL firmada.
- **Encuestas cortas**: una tarjeta pequeña que no bloquea la página: "¿Cómo fue …?" del 1 al 5, un comentario opcional y "Ahora no". Sale una sola vez por persona y encuesta. Si la persona responde, toca "Ahora no" o la cierra, no se vuelve a preguntar (queda en el servidor y, de respaldo, en el navegador). Sale entre 1,5 y 2 segundos después del éxito, para no tapar el mensaje propio de la página. Si la página navega antes (el registro lleva al panel), la encuesta queda pendiente y aparece en la siguiente página con sesión (hasta 3 días).

## Claves de encuesta

| Clave | Cuándo se pide | Dónde está el gancho |
| --- | --- | --- |
| `registro_tatuador` | Registro de tatuador terminado | `public/shared/js/register.js` |
| `registro_cliente` | Registro de cliente terminado | `public/client/register/index.html` (`showSuccess`) |
| `registro_estudio` | Registro de estudio terminado (con las imágenes subidas) | `public/shared/js/studio-register.js` (`showComplete`) |
| `cotizacion_enviada` | Pantalla "Solicitud enviada" del cotizador, con cuenta | `public/shared/js/script.js` |
| `propuesta_enviada` | Artista: "Aceptar y enviar presupuesto" enviado | `public/shared/js/quote-respond-dialog.js` y `quotation-detail-figma.js` |
| `primera_sesion_agendada` | Artista: primera sesión agendada (acuerdo, sesión nueva o calendario) | `quotation-detail-figma.js` y `calendar.js` |
| `primer_tatuador_equipo` | Estudio: aprueba una solicitud o el equipo pasa de 0 a 1+ tatuadores activos (invitación aceptada) | `public/shared/js/studio-dashboard-team.js` |

Para sumar una encuesta: agrega la clave y la pregunta en `SURVEYS` de `lib/feedback.js` y de `public/shared/js/wo-feedback.js` (un test compara ambos), la etiqueta en `support-dashboard-feedback.js` y la llamada en el punto de éxito:

```js
if (window.WoFeedback && typeof window.WoFeedback.survey === 'function') window.WoFeedback.survey('mi_clave', { delay: 1500 });
```

## Endpoints

Persona con sesión (Bearer) y cuenta de tatuador, cliente o estudio:

- `POST /api/feedback` `{ kind: bug|idea|comment|survey, message, rating?, attachments[], survey_key?, mode?, page_path, page_title, context }`. El servidor detecta el rol (`artists_db`, `clients_db`, dueño o manager activo de un estudio). Si la persona tiene varios, usa el `mode` que manda el front solo si es uno de los suyos. Comprueba que las capturas estén en su carpeta (`403` si no), aplica un tope de 20 envíos cada 24 h (`429 FEEDBACK_DAILY_LIMIT`) y, para la misma encuesta, responde idempotente (`duplicate: true`).
- `GET /api/feedback/surveys` devuelve los tipos de cuenta y las claves ya respondidas o descartadas.
- `POST /api/feedback/surveys/:key/dismiss` registra "Ahora no".

Soporte (agente activo de `support_users_db` o superadmin, el mismo control que `/api/support/reports`):

- `GET /api/support/feedback?role&kind&status&survey_key&q&from&to&page&page_size` devuelve la lista paginada, sin correos.
- `GET /api/support/feedback/summary` devuelve los conteos por tipo de cuenta, tipo y estado, la facilidad promedio y, por encuesta, las respuestas, el promedio y los "Ahora no".
- `GET /api/support/feedback/export.csv` exporta con los mismos filtros (hasta 5000 filas). No incluye correos.
- `GET /api/support/feedback/:id` devuelve el detalle: capturas con URL firmada (10 min), contexto y el correo de la persona (solo para soporte).
- `POST /api/support/feedback/:id` `{ status: new|seen|in_progress|done|wontfix, support_note }`.

Código: lógica pura en `lib/feedback.js`, rutas en `lib/routes/feedback.js`, datos en `lib/repos/feedback.js`. Pruebas en `tests/beta-feedback.test.js`.

## Datos

Tabla `public.beta_feedback` (migración `supabase/migrations/20261117120000_beta_feedback.sql`, reversa en `supabase/rollbacks/`). Una fila por envío o por encuesta respondida o descartada (`dismissed = true`, sin calificación ni mensaje). Hay un índice único parcial `(user_id, survey_key)` para las encuestas. RLS está activo: la persona inserta y lee solo lo suyo (sin el estado, la nota ni el responsable), no puede editar ni borrar, y anon no tiene acceso. El servidor escribe con service-role.

## Cómo leerlo en soporte

`/support/dashboard#feedback` (pestaña **FEEDBACK**, con un contador de los nuevos).

1. Arriba está el **resumen**: el total y la facilidad promedio; los conteos por tipo de cuenta, por tipo y por estado; y una tabla de encuestas con respuestas, promedio (1–5) y "Ahora no".
2. Debajo está la **lista**, con filtros por tipo de cuenta, tipo, estado, encuesta y fechas, y búsqueda en el mensaje, la página o la nota. Las encuestas descartadas no aparecen en la lista; solo cuentan en el resumen.
3. Al abrir un envío, el **detalle** muestra el mensaje, las capturas, quién lo envió (nombre, tipo de cuenta y correo) y dónde (página, idioma, pantalla y navegador). Ahí se cambia el estado (Nuevo → Visto → En curso → Resuelto / No se hará) y se deja una nota interna.
4. **Exportar CSV** descarga lo que muestran los filtros, para analizarlo en una hoja de cálculo.
