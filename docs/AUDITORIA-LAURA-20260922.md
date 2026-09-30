# Guía de auditoría para Laura

## Entorno y accesos

Auditar **https://beta.weotzi.com/inicio/**. Es la beta publicada; comparte Supabase con el proyecto actual. Usar datos marcados **[AUDITORÍA]**, sin modificar perfiles ni solicitudes de otras personas.

Hay dos recorridos complementarios:

1. **Registro desde cero:** `lalal3647@gmail.com` quedó libre. Entrar en [acceso de artista](https://beta.weotzi.com/artist/login/) y elegir registrarse; o comenzar por [registro de cliente](https://beta.weotzi.com/client/register/). Crear una sola cuenta y elegir una contraseña propia. Luego usar **Modo cliente / Modo tatuador** en el encabezado. Al activar tatuador por primera vez se completa su perfil; no se crea otra identidad ni otra contraseña.
2. **Cuenta con actividad:** `lalal3647+auditoria@gmail.com`. Ambos modos pertenecen a esta misma cuenta. Para establecer una contraseña propia, usar [recuperación de acceso](https://beta.weotzi.com/recover/?from=artist&email=lalal3647%2Bauditoria%40gmail.com), abrir el mensaje en su Gmail y completar el cambio. Después entrar por [artista](https://beta.weotzi.com/artist/login/) o [cliente](https://beta.weotzi.com/client/login/).

El alias `+auditoria` llega a la misma bandeja `lalal3647@gmail.com`. Los remitentes transaccionales están configurados con `notificaciones@weotzi.chat`. Revisar entrada, promociones y spam. No hace falta acceder al buzón remitente ni compartir contraseñas de Gmail.

Durante estas pruebas se aceptan direcciones con formato de email aunque no tengan buzón real, sin confirmación para entrar. Para múltiples registros ficticios usar direcciones únicas como `laura-prueba-01@example.invalid`; estas direcciones no recibirán emails ni permitirán recuperar una contraseña por correo. Para probar entregas usar su correo real o alias como `lalal3647+prueba02@gmail.com`. Un correo ya registrado no permite crear otra identidad: iniciar sesión y cambiar de modo.

## Qué hay cargado

La cuenta `+auditoria` tiene perfil público `laura-auditoria.wo`, biografía, dos estilos, precio por sesión y tres imágenes ilustrativas de prueba. Tiene cinco cotizaciones: pendiente, respondida, aprobada, completada y rechazada; dos sesiones, tres eventos editables de agenda, dos mensajes, una publicación privada en Job Board y un viaje futuro a Córdoba.

Las cotizaciones cargadas permiten inspeccionar ambos lados desde la misma identidad. Son fixtures para revisar estados, no transacciones entre personas reales. Para probar una conversación o aceptación entre dos personas, usar la cuenta nueva `lalal3647@gmail.com` como cliente y la cuenta `+auditoria` como artista, en ventanas o perfiles de navegador separados.

No activar el recorrido **modo demo** del artista para comprobar persistencia: ese recorrido usa ejemplos en memoria y no guarda cambios. La cuenta preparada funciona en modo normal y guarda sus cambios en Supabase.

## Recorrido mínimo de funciones

| Flujo | Qué revisar |
|---|---|
| Acceso | Registro, validaciones, correo duplicado, login incorrecto/correcto, recuperación, logout, sesión al recargar y cambio entre ambos modos. |
| Artista: dashboard y perfil | Datos cargados, estados de cotizaciones, agenda del día, ingresos de ejemplo, [perfil público](https://beta.weotzi.com/artist/profile?artist=laura-auditoria.wo), edición de datos, subir/reordenar/destacar/eliminar un trabajo de prueba. |
| Artista: cotizaciones | [Listado](https://beta.weotzi.com/my-quotations/), filtros, detalle, responder precio/sesiones/comentario, diseño en proceso, notas, fechas, completar y consultar historial. |
| Artista: agenda | [Calendario](https://beta.weotzi.com/calendar/): vistas, crear/editar un evento, bloquear horario, reprogramar un evento de prueba y comprobarlo después de recargar. |
| Artista: oportunidades | [Job Board](https://beta.weotzi.com/job-board/), [postulaciones](https://beta.weotzi.com/artist/applications/), [spots](https://beta.weotzi.com/studio-spots/) e [invitaciones](https://beta.weotzi.com/artist/invitations/). Revisar estados vacíos y validaciones; no postularse a oportunidades reales para probar. |
| Artista: resto | [Estadísticas](https://beta.weotzi.com/my-quotations/statistics/), [Travel](https://beta.weotzi.com/artist/travel/), [Inbox](https://beta.weotzi.com/artist/inbox/), [Cuenta](https://beta.weotzi.com/artist/account/): preferencias, notificaciones, seguridad, documentación e integraciones. |
| Cliente: descubrimiento | [Marketplace](https://beta.weotzi.com/marketplace/): buscar y filtrar, favoritos, perfil del artista, [mapa](https://beta.weotzi.com/explore/) y [globo](https://beta.weotzi.com/explore/globe/). |
| Cliente: cotización | [Cotizar con la cuenta de auditoría](https://beta.weotzi.com/quotation/?artist=laura-auditoria.wo): todos los pasos, referencias, volver atrás, borrador, validaciones, envío, confirmación y aparición en ambos paneles. |
| Cliente: actividad | [Dashboard](https://beta.weotzi.com/client/dashboard/), aceptar/rechazar propuesta, [chats](https://beta.weotzi.com/client/chats/), [solicitudes](https://beta.weotzi.com/client/requests/), edición de [cuenta](https://beta.weotzi.com/client/profile/), notificaciones y soporte. |
| Emails | Registro, recuperación, cotización enviada/recibida, respuesta, aceptación/rechazo, mensajes y sesiones. Registrar evento, hora, destinatario, asunto, captura y destino del botón; anotar si no llega. No marcar como validado un evento que no se disparó y recibió. |

Para cada acción comprobar el resultado visible y recargar para confirmar que se guardó. Recorrer desktop y móvil, incluyendo menús, modales, validaciones y estados vacío/carga/error/éxito. Registrar URL, tamaño de pantalla, modo, pasos, resultado esperado, resultado observado y captura.

Las integraciones externas requieren conectar la cuenta correspondiente. La existencia del botón no prueba que Google, Instagram, MFA o un proveedor de pago esté conectado. Los importes y registros internos no representan cobros reales. Si una función depende de un servicio o no se puede completar, documentarla como bloqueada o con desvíos; no asumir que funciona.

## Entregables de Notion y Figma

Seguir [las tareas de Diseño Gráfico](https://app.notion.com/p/0f95f84769a9413b892a99931762c828?v=224d36b569724b7ba27122ade930a5cd).

- Crear ella misma el archivo **Auditoría Rediseño We Ötzi** y compartirlo con Isaí. Comparar con su [archivo original](https://www.figma.com/design/UmVbDewiAHkfLedTR5uyFj/Pantallas--We-Otzi?node-id=205-302&m=dev).
- **24 de septiembre:** páginas **Artista** y **Cliente** con todas las pantallas, incluidos dashboards, ordenadas según el recorrido real. Validar la cobertura con Isaí antes de continuar.
- **30 de septiembre:** cada pantalla, componente, estado, función y email debe tener etiqueta **✅ Rediseñada**, **🟡 Con desvíos** o **❌ Sin rediseño**. Cada 🟡/❌ necesita una nota concreta al lado. Separar los defectos visuales de los funcionales para facilitar su corrección.
- **2 de octubre:** portada con conteos X/Y por pantallas, componentes, estados, funciones y emails. Entregar la auditoría para validación.
- **15 de octubre:** Notion incluye una fase posterior de diseño faltante y Estudios; mantenerla separada del inventario inicial de artista y cliente.

Primera confirmación requerida de Laura: **pude registrarme, entrar a la cuenta con actividad, cambiar entre los dos modos y recibir un email**. La preparación técnica no sustituye esa confirmación ni la auditoría de diseño.
