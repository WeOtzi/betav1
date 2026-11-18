# Kit de marketing · Seguridad: identidad, suplantación y plagio (2.7.0)

Para: equipo de marketing de We Ötzi.
Público: personas nuevas en la plataforma (clientes, artistas y estudios). Todas las piezas están escritas para quien recién llega. El único texto que habla de «cambios» es el correo opcional para la base actual (D3b), y está marcado así.
Fuente: el código de la 2.7.0 y el plan [2026-11-18-kyc-antisuplantacion.md](../plans/2026-11-18-kyc-antisuplantacion.md). Los textos entre «comillas» son los de la pantalla. Si la pantalla cambia, cambia también este kit.

---

## 0 · Antes de publicar (checklist interno)

Ninguna pieza sale hasta que se cumpla la parte **Base**. Las demás partes dicen qué piezas dependen de ellas y qué hacer si no se cumplen. En el kit, las piezas condicionadas llevan la marca *(condicionado: …)*.

### Base (todas las piezas)

- [ ] La 2.7.0 está publicada en beta y las migraciones de la versión están aplicadas.
- [ ] **Dominio y enlaces.** La app, con `/seguridad`, el buscador y las cuentas, vive en **https://beta.weotzi.com**. `weotzi.com` es el sitio corporativo (inicio, quiénes somos, preguntas frecuentes y tatuadores) y **no** tiene `/seguridad`. En todas las piezas (pantalla, voz, publicaciones, correos, push y landing) usa URLs absolutas de la app:
  - https://beta.weotzi.com/seguridad
  - https://beta.weotzi.com/buscar-diseno
  - https://beta.weotzi.com/artist/account#verificacion
  - https://beta.weotzi.com/studio/dashboard#verificacion
  - https://beta.weotzi.com/explore
  - https://beta.weotzi.com/legal/terms y https://beta.weotzi.com/legal/privacy

  Nunca pongas una ruta suelta como «/seguridad»: en una publicación no lleva a ningún lado y en el sitio corporativo da error. Si más adelante se agrega `/seguridad` al sitio corporativo, cambia las URLs solo después de comprobar que abren.
- [ ] Abre cada URL que vayas a usar y confirma que carga. El modal de denuncia **no** enlaza al buscador ni a `/seguridad`, y el pie de página tampoco enlaza `/seguridad`. Para llevar gente ahí, comparte el enlace directo.
- [ ] **Grabaciones con cuentas de prueba.** Nada de correos, teléfonos, documentos ni Instagram de personas reales en pantalla. Difumina los códigos `WO-…` y los números de ticket.

### Instagram y correos (identidad)

Dependen de esto: pilar 1, tutoriales 1 y 2, C1 (0:13–0:22), C2 (0:13–0:19), C3 (0:08–0:14), C5, carrusel 1, D1 bloque 1, D3, D3b y D4.

- [ ] **El correo del código llega.** Con una cuenta de artista de prueba, toca «Generar código» y confirma que llega el correo con el código `WO-…`. Repite con una cuenta de estudio («Enviar código a mi email»). El correo necesita su nodo en n8n (o el relé de correo); sin eso, la app no lo envía y la tarjeta lo avisa. Si no llega, **no publiques** las piezas de identidad.
- [ ] **El mensaje directo valida solo.** Desde una cuenta de Instagram de prueba que sigue a @weotzi, manda el código por mensaje directo y confirma que la tarjeta pasa a «Validado» **sin que soporte intervenga**. Repite con un estudio. Esto depende de una automatización externa que lee los mensajes directos de @weotzi y avisa a la app (docs/VALIDACION-INSTAGRAM.md, paso 3). Sin ella, soporte valida cada mensaje a mano desde «Soporte → Validaciones IG».
  - Si no pasa: usa en todas las piezas la **variante manual**: «Soporte lo valida al recibir tu mensaje. Puede tardar un poco.» No digas «automáticamente», «al instante» ni «listo, quedó validado» en la voz ni en los textos propios. El texto de la tarjeta del estudio («Lo validamos automáticamente.») puede verse en pantalla, pero no lo leas ni lo resaltes.
- [ ] **Los correos de la denuncia llegan.** Envía una denuncia de prueba y confirma que llega «Recibimos tu denuncia». Si soporte cierra esa denuncia de prueba, confirma también que llega el aviso del resultado. Si alguno no llega, quita de las piezas «te avisamos por correo» referido a denuncias (tutorial 4, D5, D8).

### Sanciones y apelación

Dependen de esto: pilar 3, C1 (0:45–1:00), carrusel 2 (lámina 7), D1 bloque 3, D3, D3b, D8 (#1, #2 y #5).

- [ ] **`BAN_HMAC_KEY` configurada en el servidor** (deployments/DEPLOY.md, sección «Variable de entorno nueva: `BAN_HMAC_KEY`»). Al arrancar, el registro del servidor **no** muestra el aviso `[ban-identifiers] BAN_HMAC_KEY …`. Sin esa clave, el bloqueo para volver a registrarse queda apagado y los enlaces de apelación no se pueden generar.
- [ ] **Un enlace de apelación de prueba abre `/apelacion`** con el formulario (sanción de prueba sobre una cuenta de prueba).
  - Hasta confirmar los dos puntos: no menciones el bloqueo para volver a registrarse ni la apelación. Usa la **variante sin bloqueo**: «La suplantación se sanciona con el cierre permanente de la cuenta.»
- [ ] **Procedimiento escrito para avisar a la persona denunciada.** Los Términos (sección 20) dicen que, antes de sancionar, avisamos a la persona denunciada y que tiene 5 días hábiles para responder. La app manda ese aviso por correo cuando soporte toca «Avisar al denunciado» en la denuncia, con la fecha límite ya calculada, pero no impide sancionar antes de que venza el plazo: respetarlo depende de soporte. Confirma que soporte tiene el procedimiento escrito (guía de soporte, sección 6.5) y que, en una denuncia de prueba sobre un perfil de prueba, llega el correo «Recibimos una denuncia sobre tu perfil». Sin las dos cosas, no menciones el derecho a responder ni los 5 días hábiles.

### Buscador «¿Dónde está este diseño?»

Dependen de esto: pilar 2 (las dos últimas pruebas), tutorial 3, C1 (0:27–0:37), carrusel 3, D1 bloque 2 y CTA principal, D3 punto 4, push «¿Dónde está este diseño?» y día 6 del plan.

- [ ] **Índice cargado.** El trabajo de huellas está activo (el servidor no tiene `IMAGE_FP_JOB=off`) y ya se ejecutó la carga inicial sobre los portafolios publicados (`scripts/backfill-image-fingerprints.js`). Sin esa carga, el buscador no tiene con qué comparar y siempre responde «No encontramos copias dentro de We Ötzi», aunque la foto esté publicada.
- [ ] **Prueba real.** Con una cuenta de prueba, entra a https://beta.weotzi.com/buscar-diseno, sube una foto que ya esté publicada en un portafolio y confirma que aparece un resultado «Casi segura». Abrir la página no alcanza: «El buscador se habilita pronto.» solo aparece después de enviar la foto.
- [ ] **HEIC.** Prueba también con una foto HEIC tomada con un iPhone. La página la convierte en el navegador antes de enviarla. Si falla, quita «HEIC» de las piezas.
  - Si sale «El buscador se habilita pronto.», o «No encontramos copias dentro de We Ötzi» con una foto que sí está publicada: **posterga** todas las piezas del buscador. Esto también apaga el aviso automático a soporte cuando alguien sube una foto que ya estaba publicada en otro perfil.
  - Mientras esté postergado, `/seguridad` igual enlaza al buscador («Buscar un diseño →» arriba e «Ir al buscador de diseños →» en la sección de herramientas). Pide a producto que oculte esos dos enlaces. Si no se ocultan, no uses `/seguridad` como CTA: lleva a la gente a https://beta.weotzi.com/artist/account#verificacion (artistas) o a https://beta.weotzi.com/legal/terms#denuncias (todos).

### Insignia y filtro de verificados

Dependen de esto: tutorial 5 (pantalla 3), C4 (0:08–0:13), D5, push y banner a clientes, día 5 del plan.

- [ ] **Insignia visible.** Abre un perfil verificado con el Instagram validado y confirma que se ve «Verificado» junto al nombre.
- [ ] **Mínimo de perfiles verificados.** Al cerrar el plan (2026-11-18) había 0 artistas verificados, y desde la 2.7.0 nadie se verifica sin validar antes su Instagram. Con 0, el explorador muestra «Solo verificados (0)» y no devuelve resultados, y el marketplace directamente oculta el botón «Verificados». Antes de usar el filtro en cualquier pieza, define con producto un mínimo (al menos ___ artistas verificados en cada ciudad principal de la campaña) y confírmalo.
  - Hasta llegar a ese mínimo: en las piezas a clientes, solo «busca la insignia» y «denuncia». Sin filtro, sin contadores y sin «miles de artistas verificados».
  - Cuando se use: el texto real del explorador es «Solo verificados (N)», con el número de perfiles.

---

## A · Posicionamiento

### Promesa en una línea

> **En We Ötzi, cada perfil es de quien dice ser y cada trabajo, de quien lo hizo.**

Variantes cortas:
- «Tu arte, tu nombre, protegidos.»
- «Verificado de verdad: con documentos y con tu Instagram.»
- «Si alguien copia tu obra o usa tu nombre, tienes cómo frenarlo.»

### Tres pilares

#### 1. Identidad verificada
En We Ötzi, la insignia de verificado exige documentos y demostrar que controlas el Instagram de tu perfil.

Pruebas (construidas; las que dependen del checklist, marcadas):
- Para la insignia de **artista** hacen falta el documento de identidad y el comprobante de domicilio aprobados por soporte, **más** el Instagram validado con un código.
- Para la de **estudio**: documento de representación, fotos de la sede y el Instagram del estudio validado con el código (o confirmado por soporte al revisar).
- El código llega por correo y se manda por mensaje directo a **@weotzi** desde la cuenta de Instagram del perfil, que además tiene que seguir a @weotzi. Vence a las 72 horas. *(Condicionado: «Instagram y correos». Que la validación sea automática depende de la automatización de mensajes; si no está, soporte valida cada mensaje.)*
- **Si cambias el Instagram del perfil, la insignia se oculta** hasta que valides el nuevo. Nadie puede «heredar» una insignia cambiando de cuenta.
- En el explorador y el marketplace se puede filtrar por perfiles verificados. *(Condicionado: «Insignia y filtro de verificados». Con 0 verificados el filtro no sirve.)*

#### 2. Tu obra protegida
Lo que publicas lleva tu nombre, y copiarlo tiene consecuencias.

Pruebas:
- Los Términos dicen que solo publicas trabajos tuyos o con permiso de su autor. Al registrarte los aceptas. (Las cuentas creadas antes de la 2.7.0 los aceptan al iniciar sesión.)
- Botón **«Denunciar»** en cada trabajo del portafolio, también desde el visor de fotos, con el motivo «Plagio de diseños» ya marcado.
- Buscador **«¿Dónde está este diseño?»**: subes una foto y ves si la misma imagen está publicada en We Ötzi, quién la subió y desde cuándo. *(Condicionado: «Buscador».)*
- Cuando alguien sube una foto que ya estaba publicada en otro perfil, soporte recibe un aviso para revisarla. *(Condicionado: «Buscador». Nada se oculta de forma automática: decide una persona.)*

#### 3. Una comunidad que se cuida
Denunciar es para todos, y el proceso es justo para las dos partes.

Pruebas:
- **Cualquier persona con cuenta** puede denunciar un perfil de artista o un estudio: clientes, artistas y estudios.
- La persona denunciada **no ve tu denuncia ni tus datos**.
- Si eres la persona suplantada y ya validaste tu Instagram en We Ötzi, tu denuncia pasa a **prioridad urgente**.
- Según los Términos, antes de sancionar avisamos por correo a la persona denunciada, que tiene **5 días hábiles** para responder. El aviso lo manda soporte al revisar el caso (no sale solo al recibir la denuncia) y nunca dice quién denunció. *(Condicionado: «Sanciones y apelación», procedimiento escrito.)*
- Un cierre permanente lo confirman **dos personas de soporte**: una lo propone y otra distinta lo confirma.
- Quien recibe una sanción puede **apelar una vez, dentro de 30 días**. La revisa alguien de soporte que no intervino. *(Condicionado: «Sanciones y apelación».)*
- La suplantación se sanciona con el **cierre permanente de la cuenta y el bloqueo para volver a registrarse**. *(Condicionado: «Sanciones y apelación». Sin la clave, solo «cierre permanente de la cuenta».)*
- Si se cierra la cuenta de un artista, sus cotizaciones abiertas se cancelan con aviso a cada cliente. Los anticipos que pasaron por We Ötzi quedan retenidos y soporte gestiona la devolución.
- Denunciar de mala fe también se sanciona.

### Palabras que sí y palabras que no

| Usa | Evita | Por qué |
|---|---|---|
| «cierre permanente y bloqueo para volver a registrarse» | «baneo de por vida», «nunca más vuelve» | Ningún control es infalible: alguien puede volver con otros datos. Si lo detectamos, cerramos también esa cuenta. |
| «más seguro», «más protección», «te ayudamos a frenarlo» | «100 % seguro», «a prueba de todo», «garantizado» | No es cierto en ninguna plataforma. |
| «insignia de verificado», «perfil verificado» | «certificado», «avalado», «tatuador aprobado» | La insignia confirma identidad, no calidad ni bioseguridad. |
| «dentro de We Ötzi» | «en todo internet», «en Instagram», «en Google» | El buscador solo mira lo publicado en We Ötzi. |
| «la misma foto o copias con cambios menores» | «cualquier copia», «diseños parecidos», «detecta plagios» | Todavía no encuentra diseños redibujados. |
| «soporte revisa cada caso» | «la IA detecta y elimina», «automático» | Nada se oculta ni se sanciona solo: deciden personas. |
| «según los Términos, la persona denunciada tiene 5 días hábiles para responder» | «le avisamos automáticamente», «le avisamos en cuanto denuncias» | El aviso lo manda soporte al revisar el caso, no sale solo con la denuncia. La app calcula la fecha límite, pero no frena una sanción mientras corre. |
| «huellas cifradas» (del correo, teléfono e Instagram de una cuenta cerrada) | «guardamos tus datos para siempre» | Solo se guardan huellas, no los datos en claro, y mientras dure la sanción. |
| «anticipo» | «seña» | Norma del producto. |
| «denunciar», «denuncia» | «reportar», «acusar», «escrachar» | Es el término de la interfaz. |
| «En We Ötzi, la insignia exige…», «Al registrarte aceptas…» | «ahora exige», «nuevo», «Términos actualizados», «con esta versión» | El público es nuevo: para esa persona no cambió nada. |

**No digas que existe** (todavía no está construido):
- verificación automática con documento y selfie o prueba de vida;
- búsqueda de diseños redibujados o «parecidos»;
- búsqueda fuera de We Ötzi;
- ocultar copias de forma automática;
- un aviso automático a la persona denunciada en cuanto llega la denuncia (lo manda soporte al revisar el caso) o un bloqueo que impida sancionar antes de que venzan los 5 días hábiles (respetarlos depende de soporte);
- un plazo de respuesta de soporte para revisar denuncias o verificaciones (no hay uno publicado).

---

## B · Tutoriales paso a paso

Formato: cada paso es una pantalla. **Narración** es lo que dice la voz o el texto del tutorial. **En pantalla** son los textos reales de la interfaz que hay que mostrar o resaltar.

### Tutorial 1 · «Verifícate en 3 pasos» (artistas)

*(Condicionado: «Instagram y correos».)*

Duración sugerida: 90 s en video o un carrusel de 8 láminas.
Ruta: tu Cuenta de artista (https://beta.weotzi.com/artist/account).

**Pantalla 1 · Mi Perfil: carga tu Instagram**
- Narración: «Primero, asegúrate de que tu Instagram esté en tu perfil. Entra a Mi Perfil, baja hasta Redes sociales y escribe tu usuario.»
- En pantalla: menú lateral «Mi Perfil» → bloque «Redes sociales» → campo «Instagram» (`@usuario`) → botón «Guardar cambios».

**Paso 1 de 3 · Valida tu Instagram (pantallas 2 a 4)**

Pantalla 2 · Portafolio: la tarjeta de validación
- Narración: «Ahora ve a Portafolio. Arriba vas a ver la tarjeta Validación de Instagram. Toca Generar código.»
- En pantalla: menú «Portafolio» → tarjeta «Validación de Instagram» · «Sin validar» → «Valida tu cuenta de Instagram» → «Cuenta a validar: @tuusuario» → botón «Generar código».

Pantalla 3 · El código y el mensaje directo
- Narración: «Te mandamos a tu correo un código que empieza con WO-. Desde tu cuenta de Instagram, sigue a @weotzi y mándale el código por mensaje directo.»
- En pantalla: chip «Pendiente» → «Valida @tuusuario» → los tres pasos de la tarjeta:
  1. «Revisa tu correo: te mandamos un código que empieza con WO-.»
  2. «Desde @tuusuario, sigue a @weotzi en Instagram.»
  3. «Manda el código por mensaje directo a @weotzi. Cuando lo recibamos, tu portafolio queda validado.»
- Debajo: «El código vence el …» y los botones «Abrir @weotzi →» y «Reenviar código».
- Nota de producción: difumina el código. Vence a las 72 horas; si vence, la tarjeta dice «Código vencido» y se genera uno nuevo.

Pantalla 4 · Validado
- Narración (si el mensaje directo valida solo): «Cuando recibimos tu mensaje, tu Instagram queda validado.»
- Narración (variante manual): «Soporte lo valida al recibir tu mensaje. Puede tardar un poco: cuando esté listo, la tarjeta dice Validado.»
- En pantalla: chip «Validado» → «Instagram validado · @tuusuario».
- Nota de producción: no muestres el paso de «Pendiente» a «Validado» como si fuera instantáneo; usa un corte o un rótulo de tiempo.

**Paso 2 de 3 · Sube tus documentos (pantalla 5)**
- Narración: «Ve a Verificación. Sube tu documento de identidad y un comprobante de domicilio: son obligatorios. El certificado de bioseguridad es opcional y suma confianza.»
- En pantalla: menú «Verificación» → «Un perfil verificado genera más confianza y prioridad en el Job Board.» → bloque «Documentos»:
  - «Documento de identidad» · «Obligatorio» · botón «Subir»
  - «Comprobante de domicilio» · «Obligatorio» · botón «Subir»
  - «Certificado de bioseguridad» · «Opcional» · botón «Subir»
- Rótulo: «PDF, JPG, PNG o WebP de hasta 10 MB». Cada documento muestra su estado: «Sin cargar», «Pendiente», «Verificado» o «Rechazado».
- Nota de producción: usa documentos de muestra. Nunca grabes un documento real.

**Paso 3 de 3 · Solicita la verificación (pantallas 6 y 7)**

Pantalla 6
- Narración: «Con todo cargado, toca Solicitar verificación.»
- En pantalla: botón «Solicitar verificación» → aviso «Solicitud de verificación enviada. Soporte la revisa y te avisamos por email.»
- Si falta el Instagram, el botón cambia a «Validar mi Instagram» y el texto dice «Antes de solicitarla, valida tu Instagram con el código.» Muéstralo como «si ves esto, vuelve al paso 1».

Pantalla 7 · En revisión
- Narración: «Soporte revisa tus documentos y te avisa cuando termina.»
- En pantalla: «Verificación en proceso» → «Estamos revisando tu solicitud. Te avisamos por email y en tus notificaciones cuando termine.»

**Pantalla 8 · Cierre**
- Narración: «Cuando se aprueba, tu perfil muestra la insignia de verificado. Un consejo: si cambias tu Instagram, la insignia se oculta hasta que valides el nuevo.»
- En pantalla: «Perfil verificado» · «Tu perfil público muestra la insignia de verificado.» Luego, el perfil público con «Verificado» junto al nombre.

### Tutorial 2 · «Verifica tu estudio» (estudios)

*(Condicionado: «Instagram y correos».)*

Duración sugerida: 90 s o un carrusel de 7 láminas.
Ruta: panel del estudio, pestaña «Verificación» (https://beta.weotzi.com/studio/dashboard#verificacion).

**Pantalla 1 · Antes de empezar**
- Narración: «Para verificar tu estudio necesitas tres cosas: el Instagram del estudio cargado en Perfil, al menos una sede cargada y el documento que acredita que representas al estudio.»
- En pantalla: pestañas del panel, con «Perfil», «Sedes» y «Verificación» resaltadas.

**Pantalla 2 · Datos para la revisión**
- Narración: «En Verificación completa los datos del estudio y del responsable.»
- En pantalla: título «Datos para la revisión» → «Todos los campos son obligatorios salvo el comentario. Los documentos solo los ve el equipo de soporte de We Ötzi.» → campos «Nombre legal o comercial», «Responsable del estudio», «Cargo del responsable» (Ej. Propietaria), «Email/teléfono del responsable», «Sede a verificar».

**Pantalla 3 · Documento y fotos de la sede**
- Narración: «Sube el documento de representación: una habilitación, un contrato o un poder a nombre del responsable. Y suma hasta seis fotos de la fachada, el cartel y las estaciones de trabajo.»
- En pantalla:
  - «Documento que acredita representación» · «Seleccionar archivo» · «PDF, JPG, PNG o WEBP · hasta 10 MB. Habilitación, contrato o poder a nombre del responsable.»
  - «Evidencia del espacio» · «Seleccionar imágenes» · «Hasta 6 fotos de la fachada, el cartel y las estaciones de trabajo.»
  - «Comentario para soporte (opcional)».

**Pantalla 4 · Envía**
- Narración: «Toca Enviar a revisión.»
- En pantalla: botón «Enviar a revisión» → estado «Verificación en revisión».

**Pantalla 5 · Instagram del estudio**
- Narración (si el mensaje directo valida solo): «Mientras tanto, valida el Instagram del estudio. Toca Enviar código a mi email. Abre Instagram con la cuenta del estudio, sigue a @weotzi y mándale el código por mensaje directo. Cuando lo recibimos, queda validado.»
- Narración (variante manual): «… sigue a @weotzi y mándale el código por mensaje directo. Soporte lo valida al recibir tu mensaje; puede tardar un poco.»
- En pantalla: bloque «Instagram del estudio» → «Valida que @tuestudio es la cuenta del estudio. Soporte también puede confirmarla al revisar tu solicitud.» → botón «Enviar código a mi email» → «Te mandamos un código…» con los pasos «Abre Instagram con la cuenta @tuestudio.» / «Manda el código por mensaje directo a @weotzi.» → botón «Abrir el chat con @weotzi» → «Validado».
- Rótulo propio (no está en la tarjeta): «Antes, sigue a @weotzi desde la cuenta del estudio.» Si la cuenta del estudio no sigue a @weotzi, el mensaje no valida nada y la tarjeta no avisa.
- Nota de producción: la tarjeta del estudio no menciona que hay que seguir a @weotzi; el rótulo lo cubre. No resaltes el paso «Lo validamos automáticamente.» de la tarjeta.
- Nota para producto: a la tarjeta del estudio le falta el paso «Sigue a @weotzi» que sí tiene la del artista.

**Pantalla 6 · Si hay que corregir algo**
- Narración: «Si soporte necesita una corrección, te avisa por email y te dice qué documento actualizar.»
- En pantalla: estado «Necesitamos una corrección» → «Documento observado» → botón «Reenviar documentación».

**Pantalla 7 · Aprobado**
- Narración: «Cuando se aprueba, tu perfil muestra Estudio verificado. Si cambia el responsable, la sede o el Instagram, actualiza los datos.»
- En pantalla: «Tu estudio está verificado» → botón «Ver perfil público» → perfil con el sello «Estudio verificado».
- Dato para el guion: sin el Instagram validado (por código o confirmado por soporte) un estudio no se puede aprobar.

### Tutorial 3 · «¿Dónde está este diseño?» (buscador)

*(Condicionado: «Buscador». Solo se publica si pasa ese bloque del checklist.)*

Duración sugerida: 45–60 s.
Ruta: https://beta.weotzi.com/buscar-diseno. Hace falta una cuenta (de cliente, artista o estudio).

**Pantalla 1 · Qué es**
- Narración: «¿Viste un diseño tuyo publicado por otra persona? Con el buscador puedes ver si la misma foto ya está en We Ötzi, quién la subió y desde cuándo.»
- En pantalla: «Seguridad · Plagio» → título «¿Dónde está este diseño?» → los tres avisos de la página:
  - «Busca la misma foto o copias con cambios menores, dentro de We Ötzi. Todavía no encuentra diseños redibujados.»
  - «Que dos diseños se parezcan no prueba un plagio: soporte revisa cada caso.»
  - «Tu foto no se guarda. Solo la adjuntamos si decides abrir una denuncia.»

**Pantalla 2 · Inicia sesión**
- Narración: «Para buscar, inicia sesión. Así nadie puede usarlo para copiar el catálogo.»
- En pantalla: «Inicia sesión para buscar» → botones «Inicia sesión» y «Crea tu cuenta» → «¿Eres artista? Entra con tu cuenta de artista.»

**Pantalla 3 · Sube la foto**
- Narración: «Arrastra la foto o elígela desde tu teléfono y toca Buscar.»
- En pantalla: «Sube la foto» → «Arrastra la foto aquí o elige un archivo» → «JPG, PNG, WebP o HEIC de hasta 10 MB.» → vista previa → botones «Buscar» y «Elegir otra foto» → estado «Buscando en We Ötzi…».

**Pantalla 4 · Resultados**
- Narración: «Vas a ver hasta 12 coincidencias, con la cuenta que publicó cada foto y la fecha en que la subió a We Ötzi. Cada una dice qué tan parecida es.»
- En pantalla: «Encontramos N coincidencias» → tarjeta con «Artista» o «Estudio», el nombre, el @usuario y «Subido a We Ötzi el …» → etiqueta de confianza:
  - «Casi segura»: «Es la misma foto o una copia casi exacta.»
  - «Posible»: «Parece una copia con cambios menores.»
  - «Parecida»: «Se parece: revísala con atención.»
- Abajo: «Te quedan N búsquedas hoy.» (son 20 por día).

**Pantalla 5 · Denuncia desde el resultado**
- Narración: «Si una es tuya y la publicó otra persona, denúncialo desde ahí mismo. Adjuntamos tu foto como evidencia.»
- En pantalla: botones «Denunciar plagio» y «Es una suplantación» → se abre el modal de denuncia con el motivo ya elegido.

**Pantalla 6 · Si no encuentra nada**
- Narración: «Si no aparece nada, no quiere decir que no exista: el buscador todavía no encuentra diseños redibujados ni fotos muy editadas.»
- En pantalla: «No encontramos copias dentro de We Ötzi» → «Eso no garantiza que no exista: el buscador todavía no encuentra diseños redibujados ni fotos muy editadas.»

### Tutorial 4 · «Cómo denunciar una suplantación» (todos)

Duración sugerida: 60 s.
Dónde está el botón: en el perfil de cada artista, al final («¿Ves algo en este perfil que no corresponde?» → «Denunciar perfil»); en el perfil de cada estudio; y en cada trabajo del portafolio, también desde el visor de fotos («Denunciar»).

**Pantalla 1 · Encuentra el botón**
- Narración: «¿Alguien se hace pasar por ti, por un artista o por un estudio? Entra a su perfil y toca Denunciar.»
- En pantalla: perfil de prueba → bloque «¿Ves algo en este perfil que no corresponde?» → botón «Denunciar perfil».

**Pantalla 2 · Si no tienes sesión**
- Narración: «Para denunciar necesitas una cuenta. Si te suplantan y no tienes cuenta, crea una cuenta de cliente: es corta y te deja seguir el caso por correo.»
- En pantalla: «Para enviar una denuncia, inicia sesión. Si eres la persona o el estudio suplantado y no tienes cuenta, crea una cuenta de cliente…» → botones «Inicia sesión» y «Crea tu cuenta de cliente».

**Pantalla 3 · Paso 1 de 3 · Motivo**
- Narración: «Elige Suplantación de identidad. Si eres tú a quien suplantan, márcalo y escribe tu Instagram real.»
- En pantalla: «Vas a denunciar: …» → «Paso 1 de 3 · Motivo» → opción «Suplantación de identidad» («Se hace pasar por otra persona o estudio»). Las otras opciones son «Plagio de diseños», «Uso de marca o nombre ajeno», «Difamación» y «Estafa».
  - Casilla «¿Eres la persona o el estudio suplantado?» → «Tu Instagram» (`@tuusuario`) → «Si ya validaste ese Instagram en We Ötzi, tu denuncia pasa a prioridad urgente. Si no, soporte lo confirma contigo.» → «Enlace de prueba (opcional)»: «Por ejemplo, tu publicación original con fecha.»
  - «Cuéntanos qué pasó» (mínimo 20 caracteres) → botón «Continuar».

**Pantalla 4 · Paso 2 de 3 · Evidencia**
- Narración: «Suma enlaces y capturas que lo muestren. Solo las ve el equipo de soporte.»
- En pantalla: «Paso 2 de 3 · Evidencia» → «Enlaces (opcional)»: uno por línea, hasta 5 → «Imágenes (opcional)» → «Agregar imágenes» → «Hasta 3 imágenes JPG, PNG, WEBP o HEIC, de 10 MB como máximo cada una. Solo las ve el equipo de soporte.» → «Continuar».

**Pantalla 5 · Paso 3 de 3 · Confirmación**
- Narración: «Revisa el resumen, confirma que la denuncia es de buena fe y envíala.»
- En pantalla: «Paso 3 de 3 · Confirmación» → resumen («Motivo», «Descripción», «Evidencia», «Titular») → casilla «Confirmo que la información es verdadera y que envío esta denuncia de buena fe.» → «Quien recibe la denuncia no ve tu denuncia ni tus datos.» → botón «Enviar denuncia».

**Pantalla 6 · Listo**
- Narración: «Tu denuncia queda registrada con un número de ticket. Soporte la revisa y te escribe si necesita más información. Al terminar, te avisamos por correo si se tomó acción, sin detalles de la otra parte.» *(La última frase, condicionada: «Instagram y correos», correos de la denuncia.)*
- En pantalla: «Tu denuncia quedó registrada. Guarda tu número de ticket:» → código (difuminado) → correo «Recibimos tu denuncia» *(solo si llega; ver checklist)*.

**Pantalla 7 · Qué pasa después** (lámina de cierre)
- Soporte revisa y puede pedirte más pruebas.
- Según los Términos, antes de sancionar se avisa a la persona denunciada, que tiene 5 días hábiles para responder. *(Condicionado: procedimiento escrito.)*
- Un cierre permanente lo confirman dos personas de soporte.
- Puedes hacer hasta 5 denuncias por día.
- Más detalle en https://beta.weotzi.com/seguridad.

### Tutorial 5 · «Cómo reconocer un perfil verificado» (clientes)

Duración sugerida: 30–45 s o un carrusel de 5 láminas (4 si se omite la pantalla 3).

**Pantalla 1 · En el perfil del artista**
- Narración: «Busca la insignia Verificado junto al nombre del artista.»
- En pantalla: encabezado del perfil con el chip «Verificado» (al pasar el cursor: «Perfil verificado»).

**Pantalla 2 · En el perfil del estudio**
- Narración: «En los estudios dice Estudio verificado.»
- En pantalla: sello «Estudio verificado» junto al nombre. En la ficha: «We Ötzi revisó la información y la sede del estudio.»

**Pantalla 3 · Al buscar** *(condicionado: «Insignia y filtro de verificados». Hasta llegar al mínimo, omite esta pantalla: con 0 verificados el marketplace no muestra el botón y no se puede grabar.)*
- Narración: «En el explorador y en el marketplace puedes ver solo perfiles verificados.»
- En pantalla: explorador → filtro «Verificación» → «Solo verificados (N)». Marketplace → botón «Verificados» y el ícono de verificado en cada tarjeta.

**Pantalla 4 · Qué significa**
- Narración: «La insignia quiere decir que soporte revisó los documentos y que el perfil controla el Instagram que muestra. Si el artista cambia su Instagram, la insignia se oculta hasta que valide el nuevo.»
- En pantalla: «Documentos aprobados» + «Instagram validado con el código».

**Pantalla 5 · Qué no significa**
- Narración: «La insignia confirma identidad: no es una certificación profesional ni sanitaria. Si algo no te convence, toca Denunciar.»
- En pantalla: «La insignia no es una certificación profesional ni sanitaria.» (texto de `/seguridad`) → botón «Denunciar perfil».

---

## C · Guiones de video

Notas para todos los videos:
- Graba la interfaz con cuentas y datos de prueba. Difumina códigos, tickets y correos.
- Subtítulos siempre, porque la mayoría lo mira sin sonido.
- Formato vertical 9:16 para reels y TikTok; 16:9 y 1:1 para el video principal.
- Los textos de la interfaz que se ven en pantalla tienen que coincidir con la versión publicada.
- Toda URL en pantalla o en la voz es la de la app: `beta.weotzi.com/seguridad` (ver checklist, «Dominio y enlaces»).

### C1 · Video principal: «Tu arte, tu nombre, protegidos» (70 s)

| Tiempo | Plano / visual | Voz en off | Texto en pantalla | Sonido |
|---|---|---|---|---|
| 0:00–0:04 | Primerísimo plano: una aguja termina una línea fina sobre la piel. | «Cada línea que haces lleva tu nombre.» | — | Zumbido de la máquina, cercano. Base grave que entra suave. |
| 0:04–0:09 | Pantalla de teléfono: alguien desliza un feed y aparece el mismo diseño en un perfil desconocido. Corte seco. | «Hasta que alguien la publica como propia.» | «¿Ese diseño es tuyo?» | La base se corta. Silencio de medio segundo. |
| 0:09–0:13 | Logo de We Ötzi sobre fondo plano (cuadrado, círculo, triángulo). | «Por eso en We Ötzi cuidamos dos cosas.» | «Tu arte. Tu nombre.» | Golpe de percusión. Entra el tema principal. |
| 0:13–0:22 | Grabación de pantalla: Cuenta → Portafolio → «Validación de Instagram» → «Generar código» → corte → chip «Validado». *(Condicionado: «Instagram y correos».)* | «Primero, quién es quién. Para tener la insignia de verificado, el artista sube sus documentos y demuestra que controla su Instagram con un código.» | «Documentos + Instagram validado = Verificado» | Clics suaves de interfaz. |
| 0:22–0:27 | Perfil público con el chip «Verificado» junto al nombre. Zoom lento. | «Si cambia de Instagram, la insignia se oculta hasta validar el nuevo.» | «Verificado de verdad» | — |
| 0:27–0:37 | Pantalla de `/buscar-diseno`: se suelta una foto, «Buscando en We Ötzi…», aparece una tarjeta con «Casi segura» y «Subido a We Ötzi el …». *(Condicionado: «Buscador». Si no pasa, reemplaza este plano por el de 0:37–0:45 alargado.)* | «Segundo, tu obra. Sube una foto y te mostramos si la misma imagen ya está publicada en We Ötzi, quién la subió y desde cuándo.» | «¿Dónde está este diseño?» | Sonido de búsqueda breve. |
| 0:37–0:45 | Mano que toca «Denunciar» en un trabajo del portafolio. Se abre el modal en «Paso 1 de 3 · Motivo» con «Plagio de diseños» marcado. | «Y si alguien copia tu trabajo o usa tu nombre, lo denuncias en tres pasos, desde el mismo perfil.» | «Denunciar · 3 pasos» | Clic. |
| 0:45–0:53 | Animación simple: dos íconos de agente, uno «propone» y otro «confirma». Luego un sobre «Apelación». *(Condicionado: «Sanciones y apelación». Sin la apelación confirmada, quita el sobre y la última frase; sin el procedimiento escrito, quita «la otra parte puede responder».)* | «Soporte revisa cada caso. La otra parte puede responder. Un cierre lo confirman dos personas, y hay una apelación.» | «Proceso justo para las dos partes» | Tema principal, más bajo. |
| 0:53–1:00 | Pantalla negra con texto blanco grande. *(Condicionado: «Sanciones y apelación». Sin la clave, usa la variante sin bloqueo.)* | «Quien suplanta una identidad pierde su cuenta, y queda bloqueado para volver a registrarse.» Variante sin bloqueo: «Quien suplanta una identidad pierde su cuenta.» | «Suplantar = cierre permanente y bloqueo para volver a registrarse» Variante: «Suplantar = cierre permanente de la cuenta» | Golpe seco de percusión. |
| 1:00–1:06 | Montaje rápido: un artista sonríe a cámara; una clienta mira un perfil verificado; la fachada de un estudio. | «Artistas, estudios y clientes, en una comunidad que se cuida.» | «Una comunidad que se cuida» | El tema sube. |
| 1:06–1:10 | Logo y enlace. | «We Ötzi. Tu arte, tu nombre, protegidos.» | «Conoce cómo en beta.weotzi.com/seguridad» | Cierre musical. |

Texto para la publicación del video:
> Cada perfil, de quien dice ser. Cada trabajo, de quien lo hizo. En We Ötzi la insignia de verificado exige documentos y tu Instagram validado; denunciar una suplantación o un plagio lleva tres pasos, y soporte revisa cada caso. Conoce cómo en https://beta.weotzi.com/seguridad

(En Instagram el enlace del texto no es clicable: pon la misma URL en el enlace de la biografía o en una historia con enlace.)

### C2 · Reel para artistas: «¿Y si alguien sube tu tatuaje?» (25 s)

| Tiempo | Plano / visual | Voz en off | Texto en pantalla | Sonido |
|---|---|---|---|---|
| 0:00–0:02 | Gancho: el artista mira el teléfono y pone cara de no creerlo. Pantalla dividida: su foto y la misma foto en otro perfil. | «Ese tatuaje es mío.» | «ESE TATUAJE ES MÍO» | Corte de audio seco, efecto de «disco rayado». |
| 0:02–0:07 | Grabación: perfil ajeno → trabajo → botón «Denunciar». | «En We Ötzi lo denuncias desde la misma foto.» | «Toca Denunciar en el trabajo» | Beat que entra. |
| 0:07–0:13 | Modal: «Plagio de diseños» ya marcado → «Cuéntanos qué pasó» → «Continuar» → «Enviar denuncia». | «El motivo ya viene marcado. Cuentas qué pasó, sumas pruebas y listo.» | «3 pasos · número de ticket» | Clics al ritmo. |
| 0:13–0:19 | Cuenta → «Validación de Instagram» → corte → «Validado». Luego el chip «Verificado» en el perfil. *(Condicionado: «Instagram y correos».)* | «Y verifícate: documentos más tu Instagram validado con un código. Así nadie se hace pasar por ti.» | «Verifícate en 3 pasos» | — |
| 0:19–0:25 | Texto fijo y logo. | «Tu arte, tu nombre, protegidos.» | «Cuenta → Verificación» | Remate del beat. |

Texto de la publicación: «Si alguien sube tu trabajo como propio, denúncialo desde la misma foto. Y verifícate: documentos + Instagram validado = insignia. Tu arte, tu nombre, protegidos. https://beta.weotzi.com/artist/account#verificacion»

### C3 · Reel para estudios: «¿Quién usa el nombre de tu estudio?» (25 s)

*(Condicionado: «Instagram y correos».)*

| Tiempo | Plano / visual | Voz en off | Texto en pantalla | Sonido |
|---|---|---|---|---|
| 0:00–0:02 | Gancho: fachada del estudio. Sobre ella aparece un perfil falso con el mismo logo. | «Ese no es tu estudio.» | «ESE NO ES TU ESTUDIO» | Golpe de bajo. |
| 0:02–0:08 | Panel del estudio → pestaña «Verificación» → formulario «Datos para la revisión». | «Verifica tu estudio: datos del responsable, documento de representación y fotos de la sede.» | «Verificación · Enviar a revisión» | Beat. |
| 0:08–0:14 | Bloque «Instagram del estudio» → «Enviar código a mi email» → «Abrir el chat con @weotzi» → corte → «Validado». | «Valida el Instagram del estudio: sigue a @weotzi y mándale el código por mensaje directo.» | «Sigue a @weotzi · manda el código» | Clics. |
| 0:14–0:19 | Perfil público con el sello «Estudio verificado». | «Tu perfil muestra Estudio verificado. Y si alguien usa tu nombre, lo denuncias desde su perfil.» | «Estudio verificado» | — |
| 0:19–0:25 | Logo. | «We Ötzi. Tu estudio, tu nombre.» | «Panel del estudio → Verificación» | Remate. |

Texto de la publicación: «Verifica tu estudio en We Ötzi: documento de representación, fotos de la sede e Instagram validado (sigue a @weotzi y mándale el código por mensaje directo). Tu nombre es tuyo. https://beta.weotzi.com/studio/dashboard#verificacion»

### C4 · Reel para clientes: «¿Cómo sabes que es el artista real?» (20 s)

*(Condicionado: «Insignia y filtro de verificados». Hasta llegar al mínimo, usa la versión sin filtro: quita el plano 0:08–0:13 y alarga 0:02–0:08 y 0:13–0:18.)*

| Tiempo | Plano / visual | Voz en off | Texto en pantalla | Sonido |
|---|---|---|---|---|
| 0:00–0:02 | Gancho: dos perfiles casi iguales lado a lado. | «¿Cuál es el real?» | «¿CUÁL ES EL REAL?» | Sonido de duda (dos notas). |
| 0:02–0:08 | Zoom al chip «Verificado» en uno de los dos. | «Busca la insignia Verificado: documentos revisados e Instagram validado.» | «Verificado = identidad revisada» | Beat suave. |
| 0:08–0:13 | Explorador → filtro «Verificación» → «Solo verificados (N)». | «Y filtra para ver solo perfiles verificados.» | «Solo verificados» | Clic. |
| 0:13–0:18 | Botón «Denunciar perfil». | «¿Algo no te convence? Denúncialo. Quien recibe la denuncia no ve tus datos.» | «Denunciar perfil» | — |
| 0:18–0:20 | Logo. | «We Ötzi.» | «Tatúate con confianza» | Remate. |

Texto de la publicación: «Antes de cotizar, busca la insignia Verificado. Si algo no te convence, denúncialo: la otra persona no ve tus datos. https://beta.weotzi.com/seguridad»

### C5 · Explicador de la insignia (30 s)

*(Condicionado: «Instagram y correos».)*

| Tiempo | Plano / visual | Voz en off | Texto en pantalla | Sonido |
|---|---|---|---|---|
| 0:00–0:03 | El chip «Verificado» grande, centrado, girando un poco. | «¿Qué quiere decir esta insignia?» | «¿Qué significa Verificado?» | Nota alta. |
| 0:03–0:10 | Ícono de documento con un tilde. | «Uno: soporte revisó los documentos. En artistas, identidad y domicilio. En estudios, la representación y la sede.» | «1 · Documentos aprobados» | Clic. |
| 0:10–0:17 | Ícono de Instagram con un código `WO-•••` que viaja a @weotzi. | «Dos: el perfil demostró que controla su Instagram, con un código que se envía por mensaje directo.» | «2 · Instagram validado con el código» | Clic. |
| 0:17–0:23 | El usuario de Instagram cambia en pantalla y la insignia se apaga. | «Si cambia el Instagram, la insignia se oculta hasta validar el nuevo.» | «Cambias el Instagram → la insignia se oculta» | Sonido de «apagado». |
| 0:23–0:27 | Texto sobre fondo plano. | «Confirma identidad. No es una certificación profesional ni sanitaria.» | «Identidad, no calidad» | — |
| 0:27–0:30 | Logo. | «We Ötzi. Verificado de verdad.» | «beta.weotzi.com/seguridad» | Remate. |

---

## D · Copy de lanzamiento

### D1 · Sección de la landing

Va en una página que exista (la de la app o una nueva del sitio corporativo). Todos los enlaces, absolutos a https://beta.weotzi.com.

**Titular:** Tu arte, tu nombre, protegidos.

**Bajada:** En We Ötzi cada perfil tiene que ser de quien dice ser, y cada trabajo, de quien lo hizo. Por eso la insignia de verificado exige documentos y el Instagram validado, cualquiera puede denunciar una suplantación o un plagio, y soporte revisa cada caso.

**Bloque 1 · Verificado de verdad**
Para tener la insignia, soporte revisa tus documentos y tú demuestras que controlas el Instagram de tu perfil, con un código por mensaje directo. Si cambias de Instagram, la insignia se oculta hasta que valides el nuevo.

**Bloque 2 · ¿Dónde está este diseño?** *(condicionado: «Buscador»; si no pasa, usa el bloque 2B)*
Sube una foto y te mostramos si la misma imagen ya está publicada en We Ötzi, quién la subió y desde cuándo. Tu foto no se guarda, salvo que abras una denuncia.

**Bloque 2B · Tu obra es tuya**
Solo se publican trabajos propios o con permiso de su autor. En cada trabajo del portafolio hay un botón para denunciar un plagio, con el motivo ya marcado.

**Bloque 3 · Denunciar es para todos**
Clientes, artistas y estudios pueden denunciar en tres pasos. La otra persona no ve tu denuncia ni tus datos. La suplantación se sanciona con el cierre permanente de la cuenta y el bloqueo para volver a registrarse. *(Condicionado: «Sanciones y apelación». Variante sin bloqueo: «La suplantación se sanciona con el cierre permanente de la cuenta.»)*

**CTA principal:** Conoce cómo te cuidamos → https://beta.weotzi.com/seguridad *(si el buscador está postergado y `/seguridad` sigue enlazándolo, usa el CTA de artistas como principal; ver checklist)*
**CTA secundario (artistas):** Verifica tu perfil → https://beta.weotzi.com/artist/account#verificacion

Letra chica bajo la sección: «Que dos diseños se parezcan no prueba un plagio: soporte revisa cada caso.»

### D2 · Carruseles de Instagram

#### Carrusel 1 · «Verifícate en 3 pasos» (artistas, 7 láminas)

*(Condicionado: «Instagram y correos».)*

1. **Portada:** «Verifícate en 3 pasos.» Subtítulo: «Para que nadie se haga pasar por ti.»
2. «Paso 0 · Carga tu Instagram en Mi Perfil.» Captura del campo «Instagram».
3. «Paso 1 · Valida tu Instagram.» Portafolio → «Validación de Instagram» → «Generar código».
4. «Te llega un código WO- por correo. Sigue a @weotzi y mándaselo por mensaje directo.» Captura con el código difuminado. (Variante manual: sumar «Soporte lo valida al recibir tu mensaje.»)
5. «Paso 2 · Sube tus documentos.» Verificación → identidad y domicilio (obligatorios), bioseguridad (opcional).
6. «Paso 3 · Toca Solicitar verificación.» Soporte la revisa y te avisa por email.
7. **Cierre:** «Insignia Verificado = documentos aprobados + Instagram validado. Si cambias de Instagram, se oculta hasta validar el nuevo.» CTA: «Guárdalo para cuando lo hagas.»

Pie: «En We Ötzi, la insignia de verificado exige documentos y tu Instagram validado. Así nadie puede usar tu nombre con otra cuenta. Te contamos cómo en 3 pasos. Enlace en la biografía.»

#### Carrusel 2 · «¿Te suplantan? Así lo denuncias» (todos, 7 láminas)
1. **Portada:** «¿Alguien usa tu nombre?»
2. «Entra a su perfil y toca Denunciar perfil.» Si no tienes cuenta, crea una de cliente: es corta.
3. «Paso 1 · Elige Suplantación de identidad.»
4. «Marca ¿Eres la persona o el estudio suplantado? y escribe tu Instagram real. Si ya lo validaste en We Ötzi, tu denuncia pasa a prioridad urgente.»
5. «Paso 2 · Suma enlaces e imágenes (hasta 3).» Solo las ve soporte.
6. «Paso 3 · Confirma y envía. Guarda tu número de ticket.»
7. **Cierre:** «La otra parte no ve tus datos. Según los Términos, antes de sancionar se le avisa y tiene 5 días hábiles para responder. Un cierre lo confirman dos personas de soporte. Suplantar = cierre permanente y bloqueo para volver a registrarse.» *(Condicionado: «Sanciones y apelación». Sin el procedimiento escrito, quita la segunda frase; sin la clave, termina en «cierre permanente de la cuenta».)*

Pie: «Denunciar es para todos: clientes, artistas y estudios. Te contamos los 3 pasos.»

#### Carrusel 3 · «¿Dónde está este diseño?» (artistas y clientes, 6 láminas)

*(Condicionado: «Buscador».)*

1. **Portada:** «¿Tu diseño está en otro perfil?»
2. «Entra a ¿Dónde está este diseño? con tu cuenta.»
3. «Sube la foto. JPG, PNG, WebP o HEIC, de hasta 10 MB.» (Sin «HEIC» si la prueba del checklist falló.)
4. «Ves quién la publicó en We Ötzi y desde cuándo, con una etiqueta: Casi segura, Posible o Parecida.»
5. «¿Es tuya? Toca Denunciar plagio o Es una suplantación. Adjuntamos tu foto como evidencia.»
6. **Cierre (honesto):** «Busca dentro de We Ötzi. Todavía no encuentra diseños redibujados. Que dos diseños se parezcan no prueba un plagio: soporte revisa cada caso.»

Pie: «Sube una foto y mira si ya está publicada en We Ötzi. Tu foto no se guarda, salvo que denuncies. Enlace en la biografía.»

### D3 · Correo a artistas nuevos

Para artistas que se registran durante la campaña. *(Condicionado: «Instagram y correos» y, en el párrafo de Términos, «Sanciones y apelación».)*

**Asunto (elige uno):**
- «Tu arte, tu nombre: así los protegemos»
- «Verifícate en 3 pasos»

**Preencabezado:** «Verifícate en 3 pasos y conoce cómo denunciar un plagio.»

**Cuerpo:**

Hola, {nombre}:

En We Ötzi cada perfil tiene que ser de quien dice ser, y cada trabajo, de quien lo hizo. Así lo cuidamos:

**1. La insignia de verificado exige tu Instagram validado.**
Además de tus documentos, demuestras que controlas el Instagram de tu perfil. En tu Cuenta, en Portafolio, toca «Generar código»: te llega un código por correo. Desde tu Instagram, sigue a @weotzi y mándale el código por mensaje directo. Si cambias de Instagram, la insignia se oculta hasta que valides el nuevo.

**2. Verifícate en 3 pasos.**
Valida tu Instagram, sube tu documento de identidad y tu comprobante de domicilio, y toca «Solicitar verificación». Soporte la revisa y te avisa por email.

**3. Si alguien copia tu trabajo, denúncialo desde la misma foto.**
Cada trabajo del portafolio tiene un botón «Denunciar» con el motivo «Plagio de diseños» ya marcado. La otra persona no ve tu denuncia ni tus datos.

*[Condicionado: «Buscador».]* **4. Busca dónde está tu diseño.** Sube una foto en «¿Dónde está este diseño?» y mira si la misma imagen está publicada en We Ötzi, quién la subió y desde cuándo. Por ahora encuentra la misma foto o copias con cambios menores, no diseños redibujados.

Al registrarte aceptaste los Términos. Lo principal: una persona tiene una sola cuenta de artista, solo publicas trabajos tuyos o con permiso de su autor, y la suplantación se sanciona con el cierre permanente de la cuenta y el bloqueo para volver a registrarse. *(Variante sin bloqueo: «…se sanciona con el cierre permanente de la cuenta.»)*

**[Verificar mi perfil]** → https://beta.weotzi.com/artist/account#verificacion

Todas las reglas, en «Suplantación y plagio»: https://beta.weotzi.com/seguridad

El equipo de We Ötzi

### D3b · Opcional, solo para la base actual: aviso de cambios a artistas existentes

Solo para artistas que ya tenían cuenta antes de la 2.7.0. No lo mandes a personas nuevas. Mismas condiciones que D3.

**Asunto:** «La insignia de verificado ahora pide tu Instagram»

**Cuerpo (cambia respecto de D3):**
- Abre con: «Con la versión 2.7.0 sumamos herramientas para que nadie use tu nombre ni presente tu obra como propia.»
- Punto 1: «La insignia ahora exige tu Instagram validado.» y el resto igual que en D3.
- En lugar de «Al registrarte aceptaste los Términos»: «Al iniciar sesión, te vamos a pedir que aceptes los Términos actualizados.» (Es el aviso «Actualizamos los Términos y la Política de privacidad», que solo ven las cuentas que no aceptaron la versión vigente.)
- Puntos 2 a 4, cierre y enlaces: igual que en D3.

### D4 · Correo a estudios nuevos

*(Condicionado: «Instagram y correos».)*

**Asunto:** «Verifica tu estudio: tu nombre es tuyo»
**Preencabezado:** «Documento de representación, fotos de la sede e Instagram validado.»

**Cuerpo:**

Hola, equipo de {estudio}:

Que nadie use el nombre ni el logo de tu estudio. En We Ötzi, la insignia «Estudio verificado» pide tres cosas:

- **El documento que acredita la representación** del estudio (habilitación, contrato o poder a nombre del responsable).
- **Hasta 6 fotos de la sede**: fachada, cartel y estaciones de trabajo.
- **El Instagram del estudio validado.** Toca «Enviar código a mi email». Desde la cuenta de Instagram del estudio, sigue a @weotzi y mándale el código por mensaje directo. Soporte también puede confirmarlo al revisar tu solicitud.

Lo encuentras en tu panel, en la pestaña «Verificación». Completa los datos y toca «Enviar a revisión». Si hace falta una corrección, te avisamos por email y te decimos qué documento actualizar.

Si algún perfil usa el nombre de tu estudio, denúncialo desde su perfil con el motivo «Suplantación de identidad» o «Uso de marca o nombre ajeno». Si validaste el Instagram del estudio, tu denuncia pasa a prioridad urgente.

Al registrarte aceptaste los Términos, con las reglas sobre suplantación y plagio.

**[Verificar mi estudio]** → https://beta.weotzi.com/studio/dashboard#verificacion

Las reglas completas: https://beta.weotzi.com/seguridad

El equipo de We Ötzi

### D5 · Correo a clientes nuevos

*(Condicionado: «Insignia y filtro de verificados». Hasta llegar al mínimo, quita la frase del filtro y cambia el botón por «Cómo reconocer un perfil verificado» → https://beta.weotzi.com/seguridad.)*

**Asunto:** «Cómo saber que tu artista es quien dice ser»
**Preencabezado:** «La insignia Verificado y un botón para denunciar.»

**Cuerpo:**

Hola, {nombre}:

Antes de cotizar un tatuaje, quieres saber que hablas con el artista real. En We Ötzi te lo hacemos más fácil:

- **Busca la insignia «Verificado».** Quiere decir que soporte revisó los documentos del artista y que él demostró que controla su Instagram. En los estudios dice «Estudio verificado». En el explorador puedes filtrar por «Solo verificados».
- **Si algo no te convence, denúncialo.** Cualquier persona con cuenta puede denunciar un perfil. La otra persona no ve tu denuncia ni tus datos, y te avisamos por correo cuando se resuelve. *(Última frase condicionada a «Los correos de la denuncia llegan».)*
- **Tu anticipo está cuidado.** Si cerramos la cuenta de un artista, sus cotizaciones abiertas se cancelan con aviso y los anticipos que pasaron por We Ötzi quedan retenidos: soporte gestiona la devolución a cada cliente.

La insignia confirma identidad: no es una certificación profesional ni sanitaria.

**[Explorar artistas verificados]** → https://beta.weotzi.com/explore

Más información: https://beta.weotzi.com/seguridad

El equipo de We Ötzi

### D6 · Notificaciones push

Destinos, siempre con la URL absoluta de la app.

| Público | Título (máx. 40) | Cuerpo (máx. 110) | Destino |
|---|---|---|---|
| Artistas | Verifícate en 3 pasos | La insignia exige documentos y tu Instagram validado. Hazlo en tu Cuenta y que nadie use tu nombre. | https://beta.weotzi.com/artist/account#verificacion |
| Estudios | Verifica tu estudio | Documento, fotos de la sede e Instagram validado. Tu nombre es tuyo. | https://beta.weotzi.com/studio/dashboard#verificacion |
| Clientes *(sin filtro)* | ¿Es el artista real? | Busca la insignia Verificado y, si algo no te convence, denúncialo. Tus datos no se comparten. | https://beta.weotzi.com/seguridad |
| Todos *(condicionado: «Buscador»)* | ¿Dónde está este diseño? | Sube una foto y mira si ya está publicada en We Ötzi, quién la subió y desde cuándo. | https://beta.weotzi.com/buscar-diseno |

Fuera de esta campaña (no es para personas nuevas): «Tu insignia está oculta» / «Valida tu Instagram con el código para volver a mostrar la insignia de verificado.» → https://beta.weotzi.com/artist/account#portafolio. Solo para artistas que ya tenían la insignia y cambiaron su Instagram; al 2026-11-18 ese grupo está vacío (0 verificados). Úsalo solo si el segmento tiene gente.

### D7 · Banner dentro de la app

- **Artistas:** «La insignia de verificado exige tu Instagram validado. **Verifícate en 3 pasos →**»
- **Estudios:** «Verifica tu estudio y muestra el sello Estudio verificado. **Empezar →**»
- **Clientes:** «Busca la insignia Verificado antes de cotizar. **Cómo funciona →**» (a https://beta.weotzi.com/seguridad)
- **Todos (opcional):** «Suplantación y plagio: así cuidamos a la comunidad. **Leer →**»

No hables de Términos en el banner. Las personas nuevas los aceptan al registrarse; a las cuentas anteriores, la app ya les muestra «Actualizamos los Términos y la Política de privacidad» al iniciar sesión.

### D8 · Cinco respuestas para comentarios en redes

**1. «¿Esto es 100 % seguro?»**
> Ninguna plataforma puede prometer eso, y no queremos prometer de más. Lo que sí hacemos: la insignia exige documentos e Instagram validado, cualquiera puede denunciar, soporte revisa cada caso y la suplantación se sanciona con el cierre permanente de la cuenta y el bloqueo para volver a registrarse.

*(Condicionado: «Sanciones y apelación». Sin la clave, termina en «cierre permanente de la cuenta».)*

**2. «¿Y si me denuncian injustamente?»**
> Según nuestros Términos, antes de sancionar te avisamos el motivo y tienes 5 días hábiles para responder y presentar pruebas. Un cierre permanente lo confirman dos personas de soporte distintas, y si recibes una sanción puedes apelarla una vez, dentro de 30 días. Además, denunciar de mala fe también se sanciona.

*(Condicionado: «Sanciones y apelación». Sin el procedimiento escrito, quita la primera frase; sin el enlace de apelación confirmado, quita la apelación.)*

**3. «¿El buscador encuentra mi diseño en Instagram o en Google?»**
> No: busca solo dentro de We Ötzi. Encuentra la misma foto o copias con cambios menores (otro tamaño, un recorte chico o la imagen espejada). Todavía no encuentra diseños redibujados. Y que dos diseños se parezcan no prueba un plagio: soporte revisa cada caso.

*(Condicionado: «Buscador».)*

**4. «¿Qué hacen con mis documentos y con la foto que subo al buscador?»**
> Los documentos de verificación los revisa solo el equipo de soporte y no se muestran en tu perfil. La foto del buscador no se guarda: se procesa y se descarta, salvo que abras una denuncia. Todo el detalle está en la Política de privacidad: https://beta.weotzi.com/legal/privacy

**5. «¿Pueden volver con otra cuenta?»**
> Para bloquear el reingreso guardamos huellas cifradas del correo, el teléfono y el Instagram de la cuenta cerrada, nunca esos datos en claro. Ningún control es infalible: si la misma persona vuelve con otros datos y lo detectamos, cerramos también la cuenta nueva.

*(Condicionado: «Sanciones y apelación». Sin la clave, no uses esta respuesta: di solo que soporte revisa cada caso y cierra las cuentas que detecta.)*

---

## E · Hashtags y plan de la semana de lanzamiento

### Hashtags

- **De marca (siempre):** #WeOtzi #TuArteTuNombre
- **De tema:** #ArteOriginal #NoAlPlagio #TatuajeOriginal #PerfilVerificado
- **De comunidad:** #Tatuadores #TattooArtist #EstudioDeTatuajes #FlashTattoo #Tatuajes
- Máximo 6 a 8 por publicación. No uses etiquetas de países ni de ciudades en la campaña general.

### Plan de la semana

| Día | Pieza principal | Formato | Público | Apoyo |
|---|---|---|---|---|
| 1 · Lanzamiento | Video principal «Tu arte, tu nombre, protegidos» (C1) | Feed 1:1 + YouTube 16:9 | Todos | Landing (D1), correos a artistas y estudios nuevos (D3, D4), banner en la app (D7), historia con enlace a https://beta.weotzi.com/seguridad |
| 2 | Carrusel 1 «Verifícate en 3 pasos» | Carrusel | Artistas | Reel C2, push a artistas |
| 3 | Reel C3 «¿Quién usa el nombre de tu estudio?» | Reel / TikTok | Estudios | Push a estudios, historia con el tutorial 2 |
| 4 | Carrusel 2 «¿Te suplantan? Así lo denuncias» | Carrusel | Todos | Correo a clientes nuevos (D5), push a clientes |
| 5 | Reel C4 «¿Cómo sabes que es el artista real?» *(versión con filtro solo si se llegó al mínimo de verificados; si no, la versión sin filtro)* | Reel / TikTok | Clientes | Tutorial 5 en historias (sin la pantalla 3 si no se llegó al mínimo) y encuesta: «¿Miras la insignia antes de cotizar?» |
| 6 | Carrusel 3 «¿Dónde está este diseño?» *(o, si el buscador no pasó el checklist, el explicador C5)* | Carrusel | Artistas y clientes | Push «¿Dónde está este diseño?» *(solo si aplica)* |
| 7 | Explicador de la insignia C5 *(o el carrusel 3 si se movió)* | Reel / TikTok | Todos | Historia de preguntas, respondida con D8 |

Durante toda la semana:
- Pon https://beta.weotzi.com/seguridad en el enlace de la biografía (o el enlace de verificación si `/seguridad` sigue enlazando un buscador postergado).
- Fija en el perfil el video principal y el carrusel 2.
- Responde los comentarios con las respuestas de D8, respetando sus condiciones. Si alguien cuenta un caso concreto, no lo discutas en público: pídele que use «Denunciar» o que escriba a soporte@weotzi.com.
- Nunca muestres ni menciones en público un perfil denunciado ni una sanción.
