# Mapeo Figma final ↔ web · flujo de artista

**Fuente de verdad**: Figma “We Otzi Pantallas final”, fileKey `w3JA83CcP5ISKjyOu87mx1`, página `0:1` (Flujo artistas).
Implementado el 28 oct 2026 en la rama `feature/figma-final-artista` (punto de partida: tag `pre-figma-final-artista-20261028`).
Reemplaza como referencia a `2026-08-25-rediseno-figma-mapeo.md` (archivo Figma anterior `UmVbDewiAHkfLedTR5uyFj`).

Para re-auditar una pantalla: tomá el node-id de la tabla, pedí `get_screenshot` y `get_design_context` al MCP de Figma y capturá la implementación con el `state_url` en el preview local (`npm run dev:safe`, `http://localhost:4647/preview/preview-local-safe<state_url>`).

## Acceso y registro

| Nodo | Frame | Ruta / estado | Resultado | Fidelidad |
| --- | --- | --- | --- | --- |
| `797:269` | Inicio - Elegir experiencia | `/bienvenida/?role=artist` | Rediseñada | alta |
| `801:585` | Iniciar sesión - Email y redes sociales | `/artist/login/?state=login` | Rediseñada | alta |
| `2001:3334` | Iniciar sesión - usuario registrado | `/artist/login/` | Estado nuevo | exacta |
| `801:1099` | Registro - 09 Organizando tu agenda - Variante 01 | `/artist/login/?postauth=v1` | Rediseñada | exacta |
| `2001:3335` | Registro - 09 Organizando tu agenda - Variante 2 | `/artist/login/?postauth=v2` | Estado nuevo | exacta |
| `2001:4308` | Registro - 09 Organizando tu agenda - Variante 3 | `/artist/login/?postauth=v3` | Estado nuevo | exacta |
| `801:536` | Crear cuenta - Email y redes sociales | `/registerclosedbeta/?state=signup` | Rediseñada | alta |
| `801:1086` | Registro - 01 Quién sos | `/register-artist/?step=1` | Rediseñada | alta |
| `801:1087` | Registro - 02 Tu acceso | `/register-artist/?step=2&state=nuevo` | Rediseñada | alta |
| `801:1088` | Registro - 03 Tu oficio | `/register-artist/?step=3` | Rediseñada | alta |
| `2001:3897` | Registro - 03 Tu oficio - Selector de estilos abierto | `/register-artist/?step=3&state=estilos` | Creada desde 0 | alta |
| `801:1091` | Registro - 04 Tu presencia - Elegir cómo subir el portafolio | `/register-artist/?step=4` | Rediseñada | alta |
| `801:1092` | Registro - 04 Tu presencia - Conectar Instagram | `/register-artist/?step=4&state=instagram` | Estado nuevo | alta |
| `801:1093` | Registro - 04 Tu presencia - Portafolio cargado | `/register-artist/?step=4&state=cargado` | Estado nuevo | alta |
| `801:1094` | Registro - 05 Cómo trabajás - Independiente | `/register-artist/?step=5` | Rediseñada | alta |
| `801:1095` | Registro - 05 Cómo trabajás - Buscar estudio | `/register-artist/?step=5&state=estudio` | Rediseñada | alta |
| `801:1096` | Registro - 06 Novedades y comunicaciones | `/register-artist/?step=6&state=todas` | Rediseñada | exacta |
| `801:1097` | Registro - 07 Revisá y confirmá | `/register-artist/?step=7&state=aceptado` | Rediseñada | alta |
| `801:1098` | Registro - 08 Perfil creado | `/register-artist/?step=8` | Rediseñada | alta |
| `801:1104` | Recuperar acceso - 01 Ingresar email | `/recover/?from=artist&step=1` | Rediseñada | exacta |
| `801:1105` | Recuperar acceso - 02 Verificar código | `/recover/?from=artist&step=2&email=lalal3647@gmail.com` | Rediseñada | exacta |
| `801:1106` | Recuperar acceso - 03 Nueva contraseña | `/recover/?from=artist&step=3` | Rediseñada | alta |
| `801:1107` | Recuperar acceso - 04 Contraseña actualizada | `/recover/?from=artist&step=4` | Rediseñada | exacta |
| `801:1116` | Correo - Código para recuperar acceso | `templates/email/supabase-recovery.html` | Rediseñada | alta |
| `2001:3351` | Recuperar acceso - 05 Correo contraseña actualizada | `templates/email/password-updated.html` | Creada desde 0 | alta |

## Dashboard y navegación

| Nodo | Frame | Ruta / estado | Resultado | Fidelidad |
| --- | --- | --- | --- | --- |
| `24:1425` | Dashboard - Contenido principal | `/artist/dashboard/` | Rediseñada | alta |
| `801:559` | Dashboard - Menú de cuenta abierto | `/artist/dashboard/?menu=cuenta` | Rediseñada | alta |
| `801:558` | Dashboard - Notificaciones abiertas | `/artist/dashboard/?menu=notificaciones` | Rediseñada | alta |
| `801:563` | Recordatorios - Ver detalle | `/artist/dashboard/?modal=recordatorio&id=0000c0de-0000-4000-8000-d45b00000001` | Estado nuevo | alta |
| `801:560` | Recordatorios - Nuevo recordatorio | `/artist/dashboard/?modal=nuevo-recordatorio` | Estado nuevo | exacta |
| `801:1109` | Recordatorios - Editar detalle y prioridad | `/artist/dashboard/?modal=editar-recordatorio&id=0000c0de-0000-4000-8000-d45b00000004&iconos=1` | Estado nuevo | exacta |
| `801:561` | Compartir perfil - Generar tarjeta QR | `/artist/dashboard/?panel=qr (galería: &destino=galeria)` | Estado nuevo | alta |
| `801:562` | Compartir perfil - Enlace y redes sociales | `/artist/dashboard/?panel=compartir` | Estado nuevo | alta |
| `2003:1191` | 01 Importar IG | `/artist/dashboard/?ig=1` | Rediseñada | alta |
| `2003:1902` | 02 Importar IG | `/artist/dashboard/?ig=2 (muestra del preview)` | Estado nuevo | alta |
| `2003:2583` | 03 Importar IG | `/artist/dashboard/?ig=3 (muestra del preview; importa de verdad en el preview)` | Estado nuevo | alta |
| `2003:862` | Galería de trabajos (sección de 2003:1191 / 1902 / 2583) | `/artist/dashboard/?ig=3 (galería con NUEVO · IG; después subir un archivo con SUBIR FOTOS/VIDEOS) · /artist/dashboard/ (galería base)` | Rediseñada | alta |

## Cotizaciones

| Nodo | Frame | Ruta / estado | Resultado | Fidelidad |
| --- | --- | --- | --- | --- |
| `801:555` | Cotizaciones - Listado y prioridades | `/my-quotations/ (orden por presupuesto: elegir 'Mayor presupuesto' en el select; móvil: output/figma-final-artista/shots/cotizaciones/801-555-390.png)` | Rediseñada | alta |
| `801:564` | Cotizaciones - Resumen lateral de solicitud | `/my-quotations/?resumen=DEMO-P01` | Estado nuevo | alta |
| `801:556` | Cotizaciones - Nueva cotización manual (+ instancia 2004:2968) | `/my-quotations/new/ (también ?origen=cliente, ?origen=cita&fecha=2026-11-03, ?borrador=COT-DEMO01, ?volver=/calendar/)` | Creada desde 0 | alta |
| `801:557` | Cotizaciones - Vista previa para el cliente | `/my-quotations/new/?step=preview` | Estado nuevo | exacta |

## Detalle de cotización y notas

| Nodo | Frame | Ruta / estado | Resultado | Fidelidad |
| --- | --- | --- | --- | --- |
| `801:576` | Cotizaciones - Detalle - Pendiente de respuesta | `/my-quotations/detail/?id=DEMO-P01 (real) · &estado=pendiente (solo preview)` | Rediseñada | alta |
| `801:577` | Cotizaciones - Detalle - Respuesta enviada | `/my-quotations/detail/?id=DEMO-S01 (real) · &estado=respondida (solo preview)` | Estado nuevo | alta |
| `801:580` | Cotizaciones - Detalle - Acuerdo aprobado | `/my-quotations/detail/?id=DEMO-D01&estado=aprobada (escenario del frame) · ?id=DEMO-D01 (real)` | Estado nuevo | alta |
| `801:581` | Cotizaciones - Detalle - Sesiones en progreso | `/my-quotations/detail/?id=DEMO-D01&estado=en-progreso (escenario del frame) · /my-quotations/detail/?id=DEMO-D01 real + "Marcar realizada" en la sesión 2 (output/figma-final-artista/shots/cotizaciones-detalle/801-581-d01-real.png)` | Estado nuevo | alta |
| `801:582` | Cotizaciones - Detalle - Marcar listo para cliente | `/my-quotations/detail/?id=DEMO-D01&estado=listo (escenario) · real: DEMO-D01 con las 3 sesiones realizadas y "Marcar listo para cliente" (output/figma-final-artista/shots/cotizaciones-detalle/801-582-d01-listo.png)` | Estado nuevo | alta |
| `801:583` | Cotizaciones - Detalle - Proyecto completado | `/my-quotations/detail/?id=DEMO-C01 (real, 2 sesiones) · &estado=completada` | Estado nuevo | alta |
| `801:584` | Cotizaciones - Detalle - Disputa abierta | `/my-quotations/detail/?id=DEMO-D03 (real) · &estado=disputa · &modal=disputa abre el menú · corrección registrada: output/figma-final-artista/shots/cotizaciones-detalle/801-584-correccion.png` | Estado nuevo | alta |
| `801:578` | Notas de trabajo - Brief y preparación | `/my-quotations/detail/?id=DEMO-S01&panel=notas` | Creada desde 0 | alta |
| `801:579` | Notas de trabajo - Nueva nota | `/my-quotations/detail/?id=DEMO-S01&panel=notas&nota=nueva` | Creada desde 0 | alta |
| `801:1111` | Plantilla de brief | `/my-quotations/detail/?id=DEMO-S01&panel=notas&plantilla=brief` | Creada desde 0 | alta |
| `801:1112` | Plantilla de preparación de sesión | `/my-quotations/detail/?id=DEMO-S01&panel=notas&plantilla=preparacion` | Creada desde 0 | alta |
| `801:1113` | Plantilla de seguimiento | `/my-quotations/detail/?id=DEMO-S01&panel=notas&plantilla=seguimiento` | Creada desde 0 | alta |
| `801:1114` | Plantilla de cuidados | `/my-quotations/detail/?id=DEMO-S01&panel=notas&plantilla=cuidados` | Creada desde 0 | alta |
| `801:1115` | Plantilla de pendientes | `/my-quotations/detail/?id=DEMO-S01&panel=notas&plantilla=pendientes` | Creada desde 0 | alta |

## Calendario

| Nodo | Frame | Ruta / estado | Resultado | Fidelidad |
| --- | --- | --- | --- | --- |
| `801:542` | Calendario - Vista mensual | `/calendar/` | Rediseñada | alta |
| `801:544` | Calendario - Vista semanal | `/calendar/?view=week` | Rediseñada | alta |
| `801:545` | Calendario - Vista diaria | `/calendar/?view=day` | Rediseñada | alta |
| `801:546` | Calendario - Nuevo evento - Elegir tipo | `/calendar/?new` | Rediseñada | exacta |
| `801:547` | Calendario - Nuevo turno con cliente | `/calendar/?new=turno&picker=open` | Estado nuevo | alta |
| `801:548` | Calendario - Nueva reserva pendiente | `/calendar/?new=reserva` | Rediseñada | alta |
| `801:549` | Calendario - Nueva disponibilidad | `/calendar/?new=disponibilidad` | Rediseñada | alta |
| `801:550` | Calendario - Bloquear un día | `/calendar/?new=bloqueo` | Rediseñada | alta |
| `801:551` | Calendario - Nuevo guest spot | `/calendar/?new=guest-spot` | Rediseñada | alta |
| `801:552` | Calendario - Nueva convención | `/calendar/?new=convencion` | Rediseñada | alta |
| `801:553` | Calendario - Nuevo recordatorio | `/calendar/?new=recordatorio` | Rediseñada | alta |
| `801:554` | Calendario - Nuevo evento personal | `/calendar/?new=personal` | Rediseñada | alta |

## Centro de la cuenta

| Nodo | Frame | Ruta / estado | Resultado | Fidelidad |
| --- | --- | --- | --- | --- |
| `801:565` | Cuenta - Mi perfil y redes sociales | `/artist/account/#perfil · /artist/account/?vista=oficio#perfil (Oficio y tarifa abierto, captura 801-565-oficio.png)` | Rediseñada | alta |
| `801:566` | Cuenta - Gestionar portafolio | `/artist/account/#portafolio` | Rediseñada | alta |
| `801:568` | Cobros - Wallet y movimientos | `/artist/account/#cobros` | Creada desde 0 | alta |
| `801:570` | Cobros - We Ötzi Card - Aviso de disponibilidad | `/artist/account/?modal=card#cobros` | Estado nuevo | alta |
| `801:569` | Cobros - Agregar destino de retiro - Variante 02 | `/artist/account/?modal=agregar-destino#cobros` | Estado nuevo | alta |
| `801:571` | Cuenta - Disponibilidad por ubicación | `/artist/account/#disponibilidad` | Rediseñada | alta |
| `801:1110` | Disponibilidad - Confirmación de cambios | `/artist/account/?vista=guardado#disponibilidad (banner) · /artist/account/?vista=editar#disponibilidad (edición, capturas 801-1110-editar.png y 801-1110-editar-390.png)` | Estado nuevo | alta |
| `801:572` | Cuenta - Preferencias de notificaciones | `/artist/account/#notificaciones` | Rediseñada | exacta |
| `801:575` | Cuenta - Seguridad y recuperación | `/artist/account/#seguridad · ?modal=telefono#seguridad · ?modal=pregunta#seguridad` | Rediseñada | alta |
| `801:573` | Cuenta - Verificación y documentos | `/artist/account/#verificacion` | Rediseñada | alta |
| `801:574` | Cuenta - Configuración y accesibilidad | `/artist/account/#configuracion` | Rediseñada | alta |

## Perfil público y estadísticas

| Nodo | Frame | Ruta / estado | Resultado | Fidelidad |
| --- | --- | --- | --- | --- |
| `801:1108` | Perfil público - Artista y portafolio | `/artist/profile/?artist=valentina-preview.wo (estados: &estilo=blackwork filtra el portafolio · &resenas=1 abre todas las reseñas)` | Rediseñada | alta |
| `801:543` | Estadísticas - Actividad y conversión | `/my-quotations/statistics/ (estados: ?periodo=semana|mes|anio · &metrica=visitas|solicitudes|reservas|ingresos · &visitantes=todos|clientes|estudios)` | Rediseñada | alta |

## Job board, postulaciones y spots

| Nodo | Frame | Ruta / estado | Resultado | Fidelidad |
| --- | --- | --- | --- | --- |
| `801:1067` | Job Board - Explorar solicitudes | `/job-board/` | Rediseñada | alta |
| `801:1068` | Job Board - Detalle y envío de propuesta | `/job-board/?solicitud=JB-45210` | Rediseñada | alta |
| `801:1069` | Job Board - Propuesta enviada | `/job-board/?solicitud=JB-24872&estado=enviada` | Rediseñada | alta |
| `801:1070` | Postulaciones - Todas las oportunidades (+ instancia 2007:5811) | `/artist/applications/` | Rediseñada | alta |
| `801:1071` | Postulaciones - Job Board - Variante 01 | `/artist/applications/?tab=jobboard` | Rediseñada | alta |
| `801:1073` | Postulaciones - Detalle y seguimiento de propuesta | `/artist/applications/?type=jobboard&id=0000c0de-0000-4000-8000-fa2000000002&from=todas` | Rediseñada | alta |
| `801:1075` | Postulaciones - Spots | `/artist/applications/?tab=spots` | Rediseñada | alta |
| `801:1074` | Postulaciones - Detalle y seguimiento de spot | `/artist/applications/?type=spot&id=0000c0de-0000-4000-8000-fb4000000001&from=spots` | Rediseñada | alta |
| `801:537` | Spots - Explorar oportunidades | `/studio-spots/` | Rediseñada | alta |
| `801:538` | Spots - Detalle y postulación | `/studio-spots/?spot=0000c0de-0000-4000-8000-fb3000000006` | Rediseñada | alta |
| `801:539` | Spots - Solicitud enviada | `/studio-spots/?spot=0000c0de-0000-4000-8000-b10000000003&estado=enviada` | Rediseñada | alta |

## Invitaciones de estudios

| Nodo | Frame | Ruta / estado | Resultado | Fidelidad |
| --- | --- | --- | --- | --- |
| `801:540` | Invitaciones - Listado de estudios | `/artist/invitations/` | Rediseñada | alta |
| `801:541` | Invitaciones - Detalle y condiciones | `/artist/invitations/?invitacion=0000c0de-0000-4000-8000-1dc100000001` | Rediseñada | alta |
| `2007:5792` | Invitaciones - Mapa de estudios | `/artist/invitations/?vista=mapa&grupo=0000c0de-0000-4000-8000-1da100000002,0000c0de-0000-4000-8000-a50000000004` | Creada desde 0 | parcial |
| `2007:5793` | Invitaciones - Mapa de estudios detalle | `/artist/invitations/?vista=mapa&estudio=0000c0de-0000-4000-8000-a50000000004&grupo=0000c0de-0000-4000-8000-1da100000002,0000c0de-0000-4000-8000-a50000000004` | Estado nuevo | parcial |
| `2007:5794` | Invitaciones - Detalle de estudio ampliado | `/artist/invitations/?estudio=0000c0de-0000-4000-8000-a50000000004` | Creada desde 0 | alta |
| `2007:5795` | Invitaciones - Escribir al estudio | `/artist/invitations/?estudio=0000c0de-0000-4000-8000-a50000000004&contactar=1` | Creada desde 0 | alta |
| `801:1101` | Solicitar cambios (aside 380px) | `/artist/invitations/?invitacion=0000c0de-0000-4000-8000-1dc100000002&drawer=cambios` | Ya fiel (sin cambios) | alta |
| `801:1102` | Invitación aceptada (aside 380px) | `/artist/invitations/?invitacion=0000c0de-0000-4000-8000-1dc100000004&drawer=aceptada` | Ya fiel (sin cambios) | alta |
| `801:1103` | Invitación rechazada (aside 380px) | `/artist/invitations/?invitacion=0000c0de-0000-4000-8000-d10000000003&drawer=rechazada` | Ya fiel (sin cambios) | exacta |

## Travel e Inbox

| Nodo | Frame | Ruta / estado | Resultado | Fidelidad |
| --- | --- | --- | --- | --- |
| `801:1076` | Travel - Mapa e itinerario | `/artist/travel/?parada=0000c0de-0000-4000-8000-e70000000004` | Rediseñada | alta |
| `801:1077` | Travel - Crear viaje | `/artist/travel/?modal=crear` | Rediseñada | alta |
| `801:1078` | Travel - Viaje agregado | `/artist/travel/?agregado=0000c0de-0000-4000-8000-e70000000001` | Estado nuevo | alta |
| `801:1079` | Travel - Detalle y checklist del viaje | `/artist/travel/?trip=0000c0de-0000-4000-8000-e70000000001` | Rediseñada | alta |
| `801:1080` | Travel - Editar datos del viaje | `/artist/travel/?trip=0000c0de-0000-4000-8000-e70000000001&modal=editar` | Rediseñada | alta |
| `801:1081` | Travel - Vincular un estudio | `/artist/travel/?trip=0000c0de-0000-4000-8000-e70000000001&modal=vincular` | Rediseñada | alta |
| `801:1082` | Travel - Cambiar fechas | `/artist/travel/?trip=0000c0de-0000-4000-8000-e70000000001&modal=fechas` | Rediseñada | exacta |
| `801:1083` | Travel - Compartir itinerario | `/artist/travel/?trip=0000c0de-0000-4000-8000-e70000000001&modal=compartir` | Rediseñada | alta |
| `801:1084` | Travel - Confirmar cancelación | `/artist/travel/?trip=0000c0de-0000-4000-8000-e70000000001&modal=cancelar` | Rediseñada | exacta |
| `801:1085` | Inbox - Conversaciones y seguimiento | `/artist/inbox/?thread=0000c0de-0000-4000-8000-a30000000001` | Rediseñada | alta |

## Rutas eliminadas

| Ruta | Redirige a | Motivo |
| --- | --- | --- |
| `/artist/profile/details` | `/artist/account#perfil` | El Figma no tiene una pantalla aparte para editar el perfil: la edición vive en el Centro de la cuenta, sección Perfil (801:568 y siguientes). |
| `/artist/profile/gallery` | `/artist/profile (conserva ?artist=)` | La galería pública es un bloque del perfil público (801:539). Los links que compartían clientes siguen funcionando porque el redirect conserva ?artist=<usuario>. |
| `/artist/visitors` | `/my-quotations/statistics` | El mapa de visitantes no existe en el Figma. Las métricas de visitas pasaron a Estadísticas (801:543). |
| `/archive` | `/my-quotations?alcance=archivadas` | Las cotizaciones archivadas son un alcance del listado de cotizaciones, no una pantalla aparte. |
| `/tutorial` | `/my-quotations?demo=1&tour=1` | El tutorial estático lo reemplaza el recorrido guiado del modo demo, que recorre las pantallas reales. |
| `/landing-tatuador` | `/bienvenida` | La landing comercial para tatuadores no forma parte del flujo del artista del Figma. La captación vive en el sitio corporativo (landing/) y el ingreso al producto empieza en /bienvenida (797:269). |
