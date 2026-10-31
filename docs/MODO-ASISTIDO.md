# Modo asistido del artista

Fecha: 2026-10-30
Alcance: las 14 páginas del artista que cargan `wo-demo.js`, con datos **reales** (nunca corre con el demo prendido).

Relacionados: [MODO-DEMO-TOUR.md](MODO-DEMO-TOUR.md) (demo y recorrido) y
[VALIDACION-INSTAGRAM.md](VALIDACION-INSTAGRAM.md) (paso 2).

## Qué es

Un panel fijo (abajo a la derecha; en celular una hoja inferior que se reduce a
una píldora "Modo asistido · 3/8") que guía al tatuador por los pasos que le
faltan para dejar su perfil listo y aprender las herramientas. Detecta solo
qué está hecho leyendo los datos reales, enfoca con un marco el campo que falta
completar sin bloquear la página y, al terminar, muestra una pantalla de
bienvenida.

## Cómo se entra y cómo se sale

| Entrada | Qué hace |
| --- | --- |
| Último paso del recorrido → **Salir del demo y configurar mi perfil →** | Sale del demo y abre `/artist/account?asistido=1#perfil`. |
| Menú Ö → **Modo asistido · configurá tu perfil** (o "ver mis pasos" si ya está activo) | Lo activa en el servidor y abre el panel. |
| `?asistido=1` / `?asistido=0` en cualquier página del artista | Lo activa (apagando el demo si estaba prendido) o lo apaga. El parámetro se borra de la URL después de leerlo, así una recarga no lo reactiva. |
| × del panel → "¿Salir del modo asistido? Podés retomarlo desde el menú Ö." | Lo apaga en el servidor. Si el servidor no confirma, el panel vuelve. |
| Cerrar la pantalla de bienvenida | Termina el modo asistido. |

El estado vive en `user_preferences.app_settings.onboarding.assisted`
(`active`, `started_at`, `completed_at`, `welcome_seen_at`, `acknowledged`,
`skipped`) y lo escribe **solo el servidor**. El navegador guarda un espejo en
`localStorage.wo_onb_<userId>` para decidir en `<head>` si cargar el panel.

## Los pasos

| # | Paso (`id`) | Checks (`id` · obligatorio) | Dónde se hace |
| --- | --- | --- | --- |
| 1 | Completá tu perfil (`perfil`) | `banner` · `foto` · `redes` (Instagram, TikTok o web) · `whatsapp` · `email` · `bio` (opcional) | Centro de la cuenta → Mi perfil |
| 2 | Validá tu Instagram y tu portafolio (`portafolio`) | `trabajos` (≥ 1) · `instagram_validado` · `portafolio_validado` (0 fotos de Instagram pendientes). Mientras la validación no esté habilitada en la base, las dos últimas son opcionales y dicen "(se habilita pronto)". | Centro de la cuenta → Portafolio |
| 3 | Compartí tu perfil en Instagram (`compartir`) | `enlace_copiado` (opc.) · `bio_copiada` (opc.) · `pegado` | Dentro del panel |
| 4 | Configurá un medio de retiro (`retiro`) | `destino` (≥ 1 destino de retiro activo). Si el Wallet no está habilitado en la base, el paso queda "no disponible" y se continúa. | Centro de la cuenta → Cobros (We Ötzi Wallet) |
| 5 | Configurá tu disponibilidad (`disponibilidad`) | `modalidad` (Estudio / Independiente / Ambos) · `estudio` (automático si es independiente) · `horarios` (≥ 1 día con horario guardado) | Centro de la cuenta → Disponibilidad |
| 6 | Configurá tus notificaciones (`notificaciones`) | `preferencias` (alguna guardada o "Ya lo revisé") | Centro de la cuenta → Notificaciones |
| 7 | Completá la verificación (`verificacion`) | `identidad` · `domicilio` · `bioseguridad` (opcional) · `solicitud` (verificación pedida). Una cuenta ya verificada lo tiene hecho. | Centro de la cuenta → Verificación |
| 8 | Completá la configuración (`configuracion`) | `region` (país y zona horaria) · `moneda` · `revisada` (opcional; "Ya lo revisé" completa el paso) | Centro de la cuenta → Configuración |

Estados de un paso: `done`, `pending`, `skipped` ("LO HAGO DESPUÉS"; se puede
retomar desde la lista) y `unavailable` (falta una pieza del backend). El paso
actual es el primero `pending`. Cuando no queda ninguno se registra
`completed_at` y aparece la bienvenida.

### Paso 3: compartir el enlace en Instagram

El panel muestra:

- **El enlace al perfil público** (`profile_url`, con el usuario sin `.wo`), con
  "COPIAR ENLACE" y la instrucción "En Instagram: Editar perfil → Enlaces →
  Agregar enlace externo. Pegá este enlace en el campo URL."
- **Un mensaje corto para la bio**, elegido al azar entre 20 frases de hasta
  40 caracteres ("Agendá conmigo en el enlace", "Cotizá fácil desde el enlace",
  "Pedí tu cotización en el enlace"…). **GENERAR OTRO** cambia el mensaje y
  nunca repite el actual; el enlace no cambia. "COPIAR MENSAJE" y la
  instrucción "Pegalo al final de tu presentación sin borrar lo que ya tenés."
- "ABRIR INSTAGRAM →" y **YA LO PEGUÉ EN MI INSTAGRAM**, que completa el paso y
  marca `artists_db.ms_profile_shared`.

### Pantalla final

"Felicitaciones, <nombre>: tu perfil está listo", con la bienvenida, todo lo que
se puede hacer en We Ötzi (cotizaciones, calendario, job board, spots e
invitaciones, travel, inbox, estadísticas, wallet), por qué conviene que los
clientes coticen con We Ötzi (solicitudes completas con referencias, todo
ordenado con historial, el enlace como cotizador las 24 horas, agenda conectada,
cobros y señas en el Wallet, reseñas verificadas y soporte del equipo ante
cancelaciones o disputas) y cómo contactar a soporte. Se puede escuchar con la
misma voz y velocidad del recorrido.

## Comportamiento del panel

- **IR AL PASO →** navega a la sección del centro de la cuenta y enfoca el
  primer check pendiente con un marco que no bloquea los clics. En celular el
  panel se reduce solo para dejar ver el campo.
- Se refresca solo: después de cada guardado de la página (evento
  `wo:assist-refresh`), al volver a la pestaña, al cambiar de sección y cada
  30 s. Cuando un paso se completa muestra "Listo · <paso>" y pasa al siguiente.
- **ESCUCHAR** lee el paso con `WoTour.narrator`; un toque explícito vuelve a
  prender la voz si se había silenciado en el recorrido, y si el navegador no
  puede hablar lo dice en la zona de avisos.
- En el dashboard ofrece **Probá el modo demo →** mientras la sugerencia del demo
  esté activa (en celular reemplaza a la tarjeta, que se oculta).
- Las capas: marco (1370) < panel (1380) < menú Ö (1384–1386) < bienvenida
  (1390) < recorrido (1400).

## Anclas en el centro de la cuenta

El panel enfoca `[data-assist~="<paso>.<check>"]` y, si no hay, `[data-assist~="<paso>"]`
(cada `<section id="aac-…">` relevante lo tiene). `data-assist` es una lista
separada por espacios. Anclas actuales: `perfil.banner`, `perfil.foto`,
`perfil.redes`, `perfil.whatsapp`, `perfil.email`, `perfil.bio`,
`portafolio.trabajos`, `portafolio.instagram_validado`,
`portafolio.portafolio_validado` (tarjeta `#aac-ig-verify`), `retiro.destino`,
`disponibilidad.modalidad` (`#aac-modalidad`), `disponibilidad.estudio`,
`disponibilidad.horarios`, `notificaciones.preferencias`,
`verificacion.identidad|domicilio|bioseguridad|solicitud`,
`configuracion.region`, `configuracion.moneda`.

Al agregar un campo nuevo a un paso: sumar el check en
`services/artist-onboarding.js` (`computeSteps`), el ancla `data-assist` en el
HTML, el copy en `STEP_COPY` de `wo-assist.js`, y disparar
`wo:assist-refresh` después de guardarlo.

## Cambios en el centro de la cuenta que acompañan al modo asistido

- **Mi perfil → Contacto:** WhatsApp (formato internacional `+54 9 11 1234 5678`;
  un número viejo con otro formato no bloquea guardar el resto) y Email (cambia
  el email de la cuenta con confirmación por correo; en demo no hace nada).
- **Portafolio:** tarjeta de validación de Instagram y marca "Pendiente de
  validación" en las fotos importadas que todavía no se muestran.
- **Disponibilidad → Modalidad de trabajo:** Estudio / Independiente / Ambos con
  buscador de estudios ("Agregar «x»" crea uno). Actualiza `work_type`,
  `estudios`, `studio_id` y la ubicación base.
- **Verificación:** documento de identidad y comprobante de domicilio
  "Obligatorio", certificado de bioseguridad "Opcional".

## API

| Ruta | Uso |
| --- | --- |
| `GET /api/artist/onboarding` | Estado completo: `onboarding`, `steps` (con `checks` y `section`), `current_step`, `completed`, `progress`, `profile_url`, `is_new`, `instagram`. 503 `ONBOARDING_PREFS_UNAVAILABLE` si no se pudieron leer las preferencias (el navegador conserva su estado). |
| `POST /api/artist/onboarding` | `{ demo_suggestions?, demo_auto_started?, assisted?: { active?, acknowledge?, skip?, unskip?, welcome_seen? } }`. Mezcla en profundidad sin pisar otras claves de `app_settings`; las escrituras de un mismo artista se serializan. |

Ambas exigen `Authorization: Bearer <access_token>` y una fila en `artists_db`
(401 / 403). Implementación: `services/artist-onboarding.js` (lógica pura en
`_internal.computeSteps`).

## Archivos

| Archivo | Rol |
| --- | --- |
| `public/shared/js/wo-assist.js`, `public/shared/css/wo-assist.css` | Panel, marco, paso de compartir y pantalla final. |
| `services/artist-onboarding.js` | Estado y pasos del onboarding. |
| `public/shared/js/artist-account.js`, `wallet-account.js`, `account-contact-model.js`, `public/artist/account/index.html`, `artist-account-ds.css` | Campos nuevos, anclas y avisos de guardado. |
| `tests/assisted-mode.test.js`, `tests/artist-onboarding.test.js`, `tests/account-assisted.test.js`, `tests/assisted-flow-integration.test.js` | Panel, cálculo de pasos, centro de la cuenta y flujo completo del servidor con una base en memoria. |

## Limitaciones

- No se probó todavía con una sesión real de artista en el navegador: la QA se
  hizo con páginas de prueba que cargan el código real y datos simulados.
- El Wallet depende de una migración todavía no aplicada
  (`20261028150000_artist_wallet.sql`): mientras tanto el paso de retiro queda
  "no disponible". La validación de Instagram ya está aplicada en producción.
- En el preview local no hay modo asistido (el preview quita `wo-demo.js`).
