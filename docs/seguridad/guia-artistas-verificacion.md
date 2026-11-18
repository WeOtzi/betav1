# Tu identidad y tu obra, protegidas: guía de verificación y seguridad para artistas

*We Ötzi 2.7.0 · Seguridad: identidad, suplantación y plagio · 18 de noviembre de 2026*

<!--
NOTA EDITORIAL (no se muestra al publicar). Antes de publicar esta guía:
1. Instalar sharp@0.35.5, aplicar las migraciones 20261118130000 y 20261118140000 en el proyecto vivo
   y correr scripts/backfill-image-fingerprints.js. Sin eso no hay huellas, ni alertas «Posible copia
   de imagen», ni fechas de primera publicación, y el buscador responde «El buscador se habilita pronto.».
   Si se publica antes, la sección 5 ya avisa que la detección se activa por etapas.
2. Confirmar que el relé de mensajes directos (n8n + Meta → POST /api/instagram-verification/inbound)
   funciona en producción. Si no, toda validación de Instagram espera la confirmación manual de soporte.
3. Revisión legal de /legal/terms (1.1) y /legal/privacy (1.2): hoy muestran «pendiente de revisión
   legal» y marcadores «[A COMPLETAR: …]». La guía invita a leerlos.
4. El protocolo de soporte tiene que hacer obligatorio el aviso previo al denunciado (5 días hábiles,
   Términos §20) antes de proponer una advertencia o una suspensión no preventiva. El panel ya manda
   el aviso («Avisar al denunciado»), pero el código no exige que se haya mandado ni que venza el
   plazo antes de sancionar (la advertencia se aplica al proponerla).
-->

Tu nombre y tu trabajo te costaron años. En We Ötzi queremos que cada perfil sea de quien dice ser y que cada trabajo publicado sea de quien lo hizo. Esta guía te explica cómo verificar tu perfil, cómo cuidamos tus diseños y qué puedes hacer si alguien se hace pasar por ti o copia tu obra.

Si quieres ver la versión corta para todo el público, entra a **Suplantación y plagio** (`/seguridad`).

---

## 1. Por qué vale la pena verificarte

- **Los clientes confían en la insignia de verificado.** Les dice que revisamos que el perfil es de quien dice ser. Aparece en tu perfil público, en el explorador, en el mapa y en el marketplace.
- **Solo los artistas verificados ven los datos de contacto del cliente.** En una cotización, el correo, el WhatsApp, el Instagram y la preferencia de contacto del cliente se muestran solo si tu perfil está verificado y el cliente no rechazó la cotización. (En las cotizaciones manuales que creas tú, el contacto lo cargas tú mismo.)
- **Más confianza y prioridad en el Job Board**, como dice la sección Verificación de tu cuenta.
- **Te protege contra la suplantación.** Si alguien abre un perfil con tu nombre o tus fotos, tu perfil verificado y tu Instagram validado son la mejor prueba de quién es el titular.

> La insignia no es una certificación profesional ni sanitaria: confirma tu identidad y que el Instagram de tu perfil es tuyo.

> **¿Ya estabas verificado?** Desde esta versión, la insignia también exige que valides tu Instagram con el código. Si todavía no lo hiciste, tu perfil se va a mostrar sin la insignia y en Cuenta · Verificación vas a ver «Tu insignia de verificado está oculta». Tu verificación y el acceso al contacto de tus clientes siguen igual: valida tu Instagram en **Cuenta · Portafolio** (Paso 2 de la sección 2) y la insignia vuelve.

---

## 2. Cómo verificarte, paso a paso

Para tener la insignia hacen falta **dos cosas**: tus documentos aprobados por soporte y tu Instagram validado con el código. Las dos se hacen desde tu **Cuenta**.

### Paso 1 · Sube tus documentos (Cuenta · Verificación)

En **Cuenta → Verificación**, en el bloque **Documentos**, vas a ver tres documentos:

| Documento | ¿Es obligatorio? |
|---|---|
| Documento de identidad | Obligatorio |
| Comprobante de domicilio | Obligatorio |
| Certificado de bioseguridad | Opcional (suma confianza) |

- Toca **Subir** en cada uno. Se aceptan **PDF, JPG, PNG o WebP de hasta 10 MB**.
- Cada documento muestra su estado: **Sin cargar**, **Pendiente**, **Verificado** o **Rechazado**.
- Si soporte rechaza un documento, debajo vas a ver el **Motivo del rechazo**. Toca **Reemplazar** y sube uno nuevo. Lo que sigue depende del estado de tu solicitud:
  - **Si tu solicitud sigue en revisión** («Verificación en proceso»), con reemplazar el documento alcanza: soporte revisa el nuevo dentro de la misma solicitud. No hace falta (ni se puede) volver a solicitarla.
  - **Si te denegaron la verificación** («Verificación denegada»), reemplaza el documento y toca de nuevo **Solicitar verificación**.
- Mientras un documento no esté aprobado, puedes reemplazarlo o eliminarlo.

Tus documentos se guardan en un espacio privado: solo los ve el equipo de soporte para revisarlos. Nunca se muestran en tu perfil.

### Paso 2 · Valida tu Instagram con el código (Cuenta · Portafolio)

Primero, revisa que tu usuario de Instagram esté cargado en **Cuenta → Mi perfil**. Después, en **Cuenta → Portafolio**, busca la tarjeta **Validación de Instagram**:

1. Toca **Generar código**. Te mandamos por correo un código que **empieza con WO-**.
2. Desde la cuenta de Instagram de tu perfil, **sigue a @weotzi** (el botón **Abrir @weotzi →** te lleva directo).
3. **Manda el código por mensaje directo a @weotzi.** Cuando lo recibimos, tu Instagram queda validado y la tarjeta muestra **Instagram validado · @tuusuario**.

Lo que conviene saber:

- **El código vence a las 72 horas.** La tarjeta te muestra la fecha exacta («El código vence el…»). Si venció, genera uno nuevo.
- **La validación puede no ser inmediata:** en algunos casos soporte confirma tu mensaje a mano. Si ya mandaste el código y pasaron más de 24 horas sin que la tarjeta diga «Instagram validado», escríbenos desde tu **Inbox** o a artistas@weotzi.com antes de generar otro código.
- Si no te llega el correo, toca **Reenviar código**. Si pides varios seguidos, vas a ver «Pediste varios códigos seguidos. Prueba de nuevo en un rato.»
- El mensaje tiene que salir **desde la misma cuenta** que figura en tu perfil.
- Validar tu Instagram también publica las fotos que importaste desde esa cuenta: hasta entonces, los clientes no las ven.

### Paso 3 · Solicita la verificación

Vuelve a **Cuenta → Verificación** y toca **Solicitar verificación**.

- Si te falta un documento obligatorio, te avisamos: «Antes de solicitarla, sube tu documento de identidad y tu comprobante de domicilio».
- Si tu Instagram no está validado, el botón cambia a **Validar mi Instagram** y vas a ver: «Antes de solicitarla, valida tu Instagram con el código.»
- Cuando la solicitud sale, vas a ver «Solicitud de verificación enviada. Soporte la revisa y te avisamos por email.»

### Qué revisa soporte

Una persona del equipo de soporte revisa tu solicitud a mano:

- Que tu **documento de identidad** y tu **comprobante de domicilio** sean válidos y coincidan contigo. Revisa cada documento y lo aprueba o lo rechaza con un motivo que tú ves.
- Que tu **Instagram esté validado** y sea el mismo que figura en tu perfil.
- Una revisión final de tu perfil. Mientras tanto, tu cuenta muestra **Documentos aprobados · falta la revisión final**.

### Cuánto tarda

No hay un plazo fijo: depende de la cantidad de solicitudes. Mientras se revisa, vas a ver **Verificación en proceso** en Cuenta · Verificación. Te avisamos por correo y en tus notificaciones cuando termine.

### Los correos que vas a recibir

| Cuándo | Qué te llega |
|---|---|
| Generas el código de Instagram | Un correo con tu código WO- |
| Soporte aprueba o rechaza uno de tus documentos | Un aviso de soporte con la decisión y, si lo rechaza, el motivo (por correo según tus preferencias de notificación; siempre lo ves en tu cuenta) |
| Soporte aprueba tu perfil | Un correo de perfil verificado, con el enlace a tu perfil |
| Soporte deniega la verificación | Un correo con el motivo y el enlace a Cuenta · Verificación |
| Soporte revoca una verificación | Un aviso de soporte con el motivo |

Si te la deniegan, corrige lo que te indican y vuelve a solicitarla desde el mismo lugar.

---

## 3. Las reglas de la insignia

> **Si ya estabas verificado antes de esta versión:** la insignia ahora también exige tu Instagram validado, y no hay excepciones para las verificaciones anteriores. Tu verificación y el acceso al contacto de tus clientes siguen igual; valida tu Instagram en **Cuenta · Portafolio** para volver a mostrar la insignia.

- **La insignia necesita las dos cosas a la vez:** perfil verificado **y** el Instagram de tu perfil validado con el código.
- **Si cambias tu Instagram en Mi perfil, la insignia se oculta** hasta que valides la cuenta nueva. En Cuenta · Verificación vas a ver «Tu insignia de verificado está oculta» y «Cambiaste tu Instagram: la insignia se oculta hasta que valides @tunuevousuario.». En la tarjeta de Instagram, toca **Validar esta cuenta** y repite el envío del código.
- **Ocultar la insignia no te quita la verificación.** Mientras tanto sigues viendo los datos de contacto de tus clientes, pero tu perfil público se muestra sin la insignia.
- Si tu cuenta recibe una suspensión o un cierre, tu perfil deja de mostrarse en el explorador y en el resto de las páginas públicas (ver la sección 8).

---

## 4. Los nuevos Términos: qué vas a aceptar y qué significan para ti

La próxima vez que entres a We Ötzi vas a ver una ventana: **«Actualizamos los Términos y la Política de privacidad»** (versión `2026-11-18`: Términos 1.1 y Privacidad 1.2). Para seguir usando la plataforma tienes que marcar «Leí y acepto los Términos y Condiciones y la Política de privacidad.» y tocar **Aceptar y continuar**. Si prefieres leerlos con calma antes, puedes tocar **Cerrar sesión** y volver después.

Lo principal, en palabras simples:

- **Identidad.** Una persona tiene una sola cuenta de artista, y es solo suya: no se comparte, no se vende y no se usa para otra persona. Tus datos, tus documentos y tu Instagram tienen que ser verdaderos y tuyos. Nadie puede hacerse pasar por otra persona, artista o estudio.
- **Tu obra.** Solo publicas trabajos tuyos o de otra persona si tienes el permiso de su autor: en tu portafolio, tus flashes y tu Store. Copiar un diseño ajeno es plagio aunque le cambies el color, lo recortes o lo espejes. Inspirarte en un estilo o una técnica no lo es. Tú y el estudio donde trabajas pueden publicar las mismas fotos de tus trabajos.
- **Sanciones.** Según la gravedad: advertencia, suspensión o cierre permanente de la cuenta. La suplantación de identidad se sanciona con el **cierre permanente y el bloqueo para volver a registrarse**.
- **Tus derechos.** Puedes responder a una denuncia y apelar una sanción. Denunciar de mala fe también se sanciona.

Lees el texto completo en **Términos y Condiciones** (`/legal/terms`, secciones 5, 17 y 20 a 23) y en la **Política de privacidad** (`/legal/privacy`, sección 11).

---

## 5. Cómo protegemos tu obra

> **Se activa por etapas.** La detección de copias es nueva en esta versión y se pone en marcha de a poco: mientras no esté activa, no se calculan huellas ni se generan avisos a soporte, y el buscador muestra «El buscador se habilita pronto.». Cuando se active, las imágenes que ya tenías publicadas toman como fecha el momento en que las subiste a We Ötzi. Mientras tanto, puedes denunciar un plagio como siempre (sección 6).

### La fecha en que publicaste en We Ötzi cuenta como prueba

De cada imagen que publicas en tu portafolio, tus flashes, el feed de un estudio o la Store, calculamos una **huella digital** y guardamos **la fecha en que apareció por primera vez en We Ötzi**. Si después borras la imagen, conservamos su huella y esa fecha, sin la imagen, como prueba de antigüedad.

Esa fecha es lo que soporte usa para saber quién subió una imagen primero dentro de la plataforma. Por eso conviene que publiques tus trabajos en We Ötzi apenas puedas. Ten en cuenta que prueba cuándo apareció la imagen **aquí**, no fuera de We Ötzi: guarda también tus archivos originales y tus publicaciones con fecha.

### Aviso automático de copias a soporte

Cuando alguien sube una imagen que coincide con una que otra cuenta publicó **antes**, el sistema crea una alerta **«Posible copia de imagen»** para el equipo de soporte, con las dos imágenes, sus fechas y qué tan parecidas son.

- **Solo se avisa a soporte.** La imagen no se oculta ni se retiene de forma automática, ni siquiera si es idéntica.
- Soporte revisa cada caso y decide: si es legítimo, lo descarta; si es una copia, puede **retirar la foto** del portafolio de quien la subió después o **proponer una sanción** a esa cuenta (ver las secciones 7 y 8).
- Las fotos que comparten un artista y el estudio donde trabaja no generan alertas.
- Detecta la misma foto o copias con cambios menores (otro tamaño, más compresión, un recorte chico o la imagen espejada). **Todavía no detecta diseños redibujados.**

Si el retiro te toca a ti, te llega el correo **«Retiramos una foto de tu portafolio»**. Retirar una foto **no es una sanción**: el resto de tu perfil sigue igual. Si la foto es tuya o tienes permiso para publicarla, responde a ese correo o escribe a soporte@weotzi.com con lo que lo demuestre (por ejemplo, el archivo original o el permiso del autor). Revisamos el caso y, si corresponde, la volvemos a publicar.

### El buscador «¿Dónde está este diseño?»

Con el buscador (`/buscar-diseno`, también enlazado desde la página Suplantación y plagio) subes una foto y te mostramos si esa imagen ya está publicada **dentro de We Ötzi**, quién la subió y desde cuándo.

**Cómo usarlo:**

1. Inicia sesión. El buscador es solo para personas con cuenta, así nadie puede usarlo para copiar el catálogo.
2. En **Sube la foto**, arrastra la imagen o elige un archivo: **JPG, PNG, WebP o HEIC de hasta 10 MB**.
3. Toca **Buscar**.
4. Vas a ver hasta 12 coincidencias, ordenadas por parecido. Cada una muestra la foto, el artista o estudio, su usuario, la fecha («Subido a We Ötzi el…») y una etiqueta de confianza:
   - **Casi segura:** es la misma foto o una copia casi exacta.
   - **Posible:** parece una copia con cambios menores.
   - **Parecida:** se parece; revísala con atención.
5. Si una coincidencia es tuya y la publicó otra persona, usa los botones del resultado: **Denunciar plagio** o **Es una suplantación**. Se abre la denuncia con tu foto y la coincidencia ya adjuntas.

**Sus límites, con honestidad:**

- Busca **la misma foto o copias con cambios menores, dentro de We Ötzi**. No busca en Instagram ni en otros sitios.
- **Todavía no encuentra diseños redibujados** ni fotos muy editadas. Si no aparece nada, eso no garantiza que no exista una copia.
- Que dos diseños se parezcan **no prueba un plagio**: soporte revisa cada caso.
- Puedes hacer **hasta 20 búsquedas por día**. La pantalla te dice cuántas te quedan.
- **Tu foto no se guarda:** la procesamos en memoria y la descartamos. Solo se adjunta si decides abrir una denuncia.
- Si ves «El buscador se habilita pronto.», el buscador todavía no está activo; vuelve a probar más adelante.

---

## 6. Cómo denunciar una suplantación o un plagio

Cualquier persona con cuenta puede denunciar: tú también, como artista, puedes denunciar el perfil de otro artista o de un estudio. Nadie puede denunciarse a sí mismo.

### Dónde está el botón

- **En el perfil de cada artista:** al final, «¿Ves algo en este perfil que no corresponde?» y el botón **Denunciar perfil**.
- **En el perfil de cada estudio:** el botón **Denunciar**.
- **En cada trabajo del portafolio**, también dentro del visor de la foto: el botón **Denunciar**. Si denuncias un trabajo, el motivo **Plagio de diseños** ya viene marcado y la imagen se suma al expediente como referencia.
- **Desde el buscador de diseños:** **Denunciar plagio** o **Es una suplantación**.

### Los tres pasos de la denuncia

**Paso 1 de 3 · Motivo.** Elige uno:

| Motivo | Cuándo usarlo |
|---|---|
| Suplantación de identidad | Se hace pasar por otra persona o estudio |
| Plagio de diseños | Publica diseños o fotos de otro artista como propios |
| Uso de marca o nombre ajeno | Usa la marca, el logo o el nombre de otro |
| Difamación | Difunde acusaciones falsas para dañar su reputación |
| Estafa | Cobró y no cumplió, o pidió pagos fuera de la plataforma |

**Si te suplantan o te copian a ti**, en los motivos de suplantación y plagio vas a ver la casilla **«¿Eres la persona o el estudio suplantado?»**. Márcala y completa:

- **Tu Instagram** (obligatorio), para que soporte confirme que eres el titular.
- **Enlace de prueba** (opcional), por ejemplo tu publicación original con fecha.

Si ya validaste ese Instagram en We Ötzi, tu denuncia pasa a **prioridad urgente**. Si todavía no lo validaste, soporte lo confirma contigo; y si lo validas después con el código, tu denuncia abierta sube de prioridad.

**Paso 2 de 3 · Evidencia.**

- **Cuéntanos qué pasó:** qué pasó, cuándo y dónde lo viste. Entre 20 y 3.000 caracteres.
- **Enlaces:** hasta 5, uno por línea, cada uno con la dirección completa que empiece con `https://`.
- **Imágenes:** hasta 3, en JPG, PNG, WEBP o HEIC, de 10 MB como máximo cada una. Solo las ve el equipo de soporte.

**Paso 3 de 3 · Confirmación.** Revisa el resumen, marca «Confirmo que la información es verdadera y que envío esta denuncia de buena fe.» y toca **Enviar denuncia**. Te damos un **número de ticket**: guárdalo. También te llega el correo «Recibimos tu denuncia».

### Consejos para que tu evidencia sea fuerte

- **La publicación original con fecha:** el enlace a tu post de Instagram o a tu perfil donde se ve cuándo lo publicaste.
- **El perfil o la publicación que te copia:** su enlace completo, y capturas por si lo borran.
- **Tu proceso:** bocetos, archivos originales o fotos del trabajo en sesión.
- **La fecha en We Ötzi:** busca la foto en «¿Dónde está este diseño?»; el resultado muestra cuándo se subió cada copia.
- **Permisos:** si el diseño tiene una licencia o un permiso del autor, súmalo.
- **Valida tu Instagram** antes o después de denunciar: es la forma más rápida de que soporte sepa que habla con el titular.

### Límites para evitar abusos

- Hasta **5 denuncias por día**.
- No puedes duplicar una denuncia abierta. Si denuncias otra foto del mismo perfil por el mismo motivo, la imagen se suma a tu expediente abierto.
- La persona denunciada **no ve tu denuncia ni tus datos**.

### Qué pasa después

1. **Soporte revisa:** compara con el Instagram real, mira las fechas en que se publicaron las imágenes y puede pedirte más pruebas.
2. **La otra parte puede responder:** soporte le avisa el motivo y tiene 5 días hábiles.
3. **Se decide:** sin acción, advertencia, suspensión o cierre permanente.
4. **Te avisamos por correo** si se tomó acción o si la denuncia se cerró sin acción, sin detalles sobre la otra parte.

---

## 7. Si alguien te denuncia a ti

Nos importa que nadie quede sancionado sin poder explicarse.

- **No ves la denuncia ni quién la hizo.**
- **Antes de sancionarte, soporte te avisa el motivo** con el correo «Recibimos una denuncia sobre tu perfil». Trae el motivo, el número de ticket, la fecha límite y, si hace falta, lo que soporte te pide. **Tienes 5 días hábiles para responder** desde ese aviso (no cuentan sábados ni domingos). Escríbenos por el chat de soporte de tu panel o a **soporte@weotzi.com** con el número de ticket, y suma tus pruebas: archivos originales, publicaciones con fecha, permisos del autor o lo que muestre que el trabajo o el perfil son tuyos. Si no respondes dentro del plazo, soporte decide con la información que tiene.
- **Suspensión preventiva:** si hay riesgo alto para otras personas, por ejemplo cotizaciones activas con clientes, soporte puede suspender tu perfil mientras revisa el caso, sin esperar esos 5 días. Igual puedes responder y, si te sancionan, apelar.
- **Los resultados posibles:**
  - **Sin acción:** la denuncia se cierra y no pasa nada en tu cuenta.
  - **Retiro de una foto puntual:** no es una sanción; te avisamos por correo y puedes demostrar que es tuya.
  - **Advertencia, suspensión o cierre permanente** (ver la sección siguiente).

---

## 8. Sanciones y apelación

### Los tres niveles

| Nivel | Qué significa |
|---|---|
| **Advertencia** | Te avisamos el motivo y queda registrada en tu cuenta. Tu cuenta sigue funcionando con normalidad. |
| **Suspensión** | Por un plazo con fecha de fin, tu perfil se oculta, no recibes cotizaciones nuevas y no puedes pedir retiros. Tus cotizaciones en curso siguen como estaban. Al iniciar sesión vas a ver un aviso con la fecha de fin. Cuando termina el plazo, la sanción se levanta y te avisamos por correo. |
| **Cierre permanente** | La cuenta se cierra y se bloquea para volver a registrarse. |

**Cuando se cierra una cuenta:**

- Ya no puede iniciar sesión.
- El perfil deja de mostrarse en el explorador, el mapa, el marketplace y la Store.
- Las cotizaciones abiertas se cancelan y avisamos a cada cliente.
- Los anticipos y fondos que pasaron por We Ötzi quedan retenidos, y soporte gestiona la devolución a cada cliente.
- Los retiros quedan bloqueados.
- Guardamos huellas cifradas del correo, el teléfono y el Instagram de la cuenta, nunca esos datos en claro, para impedir que vuelva a registrarse. Ningún control es infalible: si detectamos que la misma persona volvió con otros datos, cerramos también la cuenta nueva.

**Un cierre permanente lo deciden dos personas de soporte:** una lo propone y otra distinta lo confirma.

Cada sanción te llega por correo con el tipo, el motivo, desde cuándo, hasta cuándo y **la fecha límite para apelar**.

### Cómo apelar

- Tienes **una sola apelación**, dentro de **30 días** desde que empieza la sanción.
- Se hace desde el botón **Apelar la sanción** del correo de aviso. Funciona aunque no puedas iniciar sesión.
- En la página **Apelar una sanción**, cuéntanos tu versión (entre 20 y 3.000 caracteres) y toca **Enviar apelación**.
- La revisa **una persona de soporte que no intervino** en la sanción.
- **Mientras se resuelve, la sanción sigue vigente.**
- Si la apelación prospera, recibes «Levantamos la sanción de tu cuenta»: quitamos los bloqueos y borramos las huellas guardadas. Las cotizaciones que se cancelaron no se reabren.
- Si no prospera, recibes «Revisamos tu apelación» y la decisión queda firme dentro de la plataforma.

---

## 9. Preguntas frecuentes

**¿Puedo ver el contacto de mis clientes si no estoy verificado?**
No. El correo, el WhatsApp, el Instagram y la preferencia de contacto del cliente se muestran solo a artistas con el perfil verificado, y solo si el cliente no rechazó la cotización. La excepción son las cotizaciones manuales, donde el contacto lo cargas tú.

**Cambié mi Instagram y desapareció la insignia. ¿Perdí la verificación?**
No. Tu perfil sigue verificado y sigues viendo el contacto de tus clientes. La insignia se oculta hasta que valides la cuenta nueva: en Cuenta · Portafolio, toca **Validar esta cuenta** y manda el nuevo código por mensaje directo a @weotzi.

**¿Cuánto tarda la verificación?**
No hay un plazo fijo. Mientras tanto ves «Verificación en proceso» y te avisamos por correo y en tus notificaciones cuando termine.

**No me llegó el código de Instagram. ¿Qué hago?**
Revisa la carpeta de spam y toca **Reenviar código**. Si la tarjeta dice «No pudimos enviarte el correo con el código», vuelve a intentarlo o escríbenos por soporte. Recuerda que el código vence a las 72 horas.

**¿Puedo mandar el código desde otra cuenta de Instagram?**
No. Tiene que salir desde la cuenta que figura en tu perfil: así comprobamos que es tuya.

**¿El certificado de bioseguridad es obligatorio?**
No. Es opcional y suma confianza. Los obligatorios son el documento de identidad y el comprobante de domicilio.

**Me rechazaron un documento. ¿Y ahora?**
En Cuenta · Verificación ves el motivo del rechazo. Toca **Reemplazar** y sube el documento corregido. Si tu solicitud sigue en revisión («Verificación en proceso»), con eso alcanza: soporte lo revisa en la misma solicitud. Si te denegaron la verificación («Verificación denegada»), después de reemplazarlo toca **Solicitar verificación** otra vez.

**Ya estaba verificado y ahora veo «Tu insignia de verificado está oculta». ¿Qué pasó?**
Desde esta versión, la insignia también exige tu Instagram validado con el código, también para quienes ya estaban verificados. No perdiste la verificación ni el acceso al contacto de tus clientes. Valida tu Instagram en Cuenta · Portafolio y la insignia vuelve a mostrarse.

**Mandé el código por mensaje directo y mi Instagram no aparece validado. ¿Qué hago?**
A veces soporte confirma el mensaje a mano. Si pasaron más de 24 horas, escríbenos desde tu Inbox o a artistas@weotzi.com antes de generar otro código. Si el código ya venció (72 horas), genera uno nuevo.

**¿Quién ve mis documentos?**
Solo el equipo de soporte, para revisarlos. Se guardan en un espacio privado y nunca aparecen en tu perfil.

**Trabajo en un estudio y los dos publicamos las mismas fotos. ¿Es plagio?**
No. Tú y el estudio donde trabajas pueden publicar las mismas fotos de tus trabajos, y esas fotos no generan alertas de copia.

**Alguien redibujó mi diseño. ¿El buscador lo encuentra?**
Todavía no: el buscador encuentra la misma foto o copias con cambios menores. Igual puedes denunciar con el motivo **Plagio de diseños** y sumar tu original, tus bocetos y enlaces con fecha. Soporte revisa cada caso.

**Encontré una copia de mi diseño en Instagram, fuera de We Ötzi. ¿Sirve el buscador?**
No: solo busca dentro de We Ötzi. Si la cuenta que te copia también tiene perfil en We Ötzi, puedes denunciarla desde su perfil o desde cada trabajo.

**Mi foto coincidió con otra. ¿Me van a sancionar automáticamente?**
No. Una coincidencia solo avisa a soporte (cuando la detección de copias esté activa), y tu foto sigue publicada mientras lo revisan. Si soporte decide retirarla, te avisa por correo y puedes demostrar que es tuya. Retirar una foto no es una sanción.

**¿La persona que me denunció sabe quién soy? ¿Yo sé quién me denunció?**
Quien recibe una denuncia no la ve ni ve los datos de quien la hizo. Antes de sancionar, soporte le avisa el motivo y tiene 5 días hábiles para responder. Al cerrar el caso, quien denunció recibe solo si se tomó acción o no, sin detalles sobre la otra parte.

**Hice una denuncia de buena fe y no prosperó. ¿Me pasa algo?**
No. Una denuncia de buena fe que no prospera no tiene consecuencias. Lo que se sanciona es denunciar algo que sabes que es falso, con pruebas falsas o para perjudicar a un competidor.

**¿Puedo apelar más de una vez?**
No. Tienes una sola apelación, dentro de 30 días, desde el enlace del correo de aviso.

**Si me suspenden, ¿qué pasa con mis cotizaciones en curso?**
Siguen como estaban. Durante la suspensión no recibes cotizaciones nuevas, tu perfil no aparece en búsquedas y no puedes pedir retiros. Al terminar el plazo, la sanción se levanta y te avisamos por correo.

**¿Puedo tener una segunda cuenta de artista?**
No. Cada persona puede tener una sola cuenta de artista. Abrir otra, por ejemplo después de una sanción, cuenta como suplantación.

**¿Qué pasa si no acepto los nuevos Términos?**
No puedes seguir usando la plataforma hasta aceptarlos. Puedes tocar **Cerrar sesión**, leerlos con calma en `/legal/terms` y `/legal/privacy`, y aceptarlos cuando vuelvas a entrar.

---

## 10. ¿Dudas?

- Página pública **Suplantación y plagio**: `/seguridad`
- **Términos y Condiciones**: `/legal/terms` · **Política de privacidad**: `/legal/privacy`
- Escríbenos a **artistas@weotzi.com** o desde el **Inbox** de tu cuenta si crees que una decisión es un error.

Tu arte y tu nombre son tuyos. Estamos para cuidarlos contigo.
