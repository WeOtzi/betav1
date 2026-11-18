# Plan: identidad, suplantación y plagio de diseños

Estado: **propuesto** (2026-11-18). Rama: `feature/kyc-antisuplantacion`.

Objetivo: que nadie pueda hacerse pasar por un artista o un estudio, que copiar
diseños de otro tenga consecuencias, y que quien suplante identidad quede fuera
de la plataforma de forma permanente.

Tres fases:

| Fase | Qué resuelve | Costo externo | Dependencias nuevas |
|---|---|---|---|
| 1 · Denuncias, sanciones e insignia | Cualquiera puede denunciar; soporte sanciona con un proceso claro; la insignia exige controlar el Instagram | Ninguno | Ninguna |
| 2 · Huellas de imágenes y buscador | Detecta fotos copiadas de otro portfolio y deja buscar un diseño con una foto | Ninguno | Una librería de imágenes (a auditar) |
| 3 · KYC propio y búsqueda por parecido | Identidad con documento + selfie sin proveedor pago y sin guardar documentos ni caras; diseños redibujados | Ninguno | Modelos open source (a auditar) |

## Punto de partida (2026-11-18)

- **Verificación de artistas**: documentos de identidad y domicilio que soporte revisa a mano; la insignia sale de `artists_db.verification_state = 'Yes'`. El código de Instagram (`instagram_verified_at`) existe pero no cuenta para la insignia. 0 artistas verificados.
- **Verificación de estudios**: documento de representación + fotos de la sede + Instagram opcional (soporte puede confirmarlo al aprobar).
- **Denuncias** (`lib/denuncias.js`, `lib/routes/denuncias.js`, modal `public/shared/js/wo-report.js`): motivos `suplantacion_identidad`, `robo_propiedad_intelectual`, `difamacion`. **Solo** artistas denuncian artistas y **solo** quienes administran un estudio denuncian estudios. Los clientes no pueden denunciar perfiles.
- **Sanciones**: no existen. No hay baneo, suspensión ni bloqueo de reingreso.
- **Imágenes del portfolio**: `artists_db.gallery_images` (49) y `artists_db.gallery_feed_items` (59 ítems, incluidos los flashes con `category: 'flash'`), `studios.photo_feed_items`, `store_design_assets` (0). Volumen chico: el procesamiento inicial tarda minutos.
- **Base**: Postgres 15.8 con `pgvector` instalado y `bit_count` disponible.
- **Cifrado de campos**: `lib/field-crypto.js` (AES-256-GCM con AAD, clave en el `.env` del servidor) y bitácora `sensitive_data_access_log`. Se reutiliza en las fases 1 y 3.

---

## Fase 1 · Denuncias abiertas, sanciones e insignia con Instagram

### 1.1 Denunciar es para todos

- `lib/routes/denuncias.js`: cualquier usuario con sesión iniciada puede denunciar un **perfil de artista** o un **estudio** (cliente, artista o estudio). Se mantiene que nadie se denuncia a sí mismo. `requester_role` del ticket: `client` cuando no es artista (la columna ya lo admite).
- Motivos de perfil (mismo catálogo en `lib/denuncias.js` y `wo-report.js`, con su test de alineación):
  - `suplantacion_identidad` — «Se hace pasar por otra persona o estudio»
  - `plagio_diseno` (nuevo) — «Publica diseños o fotos de otro artista como propios»
  - `robo_propiedad_intelectual` — se mantiene para marca, logo o nombre
  - `difamacion`
  - `estafa` (nuevo) — «Cobró y no cumplió, o pidió pagos fuera de la plataforma»
- Campo opcional **«¿Eres la persona o el estudio suplantado?»**: si responde sí, pide el Instagram real y un enlace de prueba. Si esa cuenta valida el código de Instagram (flujo existente), la denuncia sube a prioridad alta y soporte sabe que habla con el titular.
- Quien sufre la suplantación puede no tener cuenta: el formulario invita a crear una cuenta de cliente (es corta) para seguir el caso por correo.
- Límite: 5 denuncias por usuario por día y una denuncia abierta por par denunciante/denunciado (ya existe `targetKey`).
- Botón **«Denunciar»** visible en el perfil del artista, el perfil del estudio y cada ítem del portfolio (en el ítem, el motivo `plagio_diseno` ya viene marcado y la imagen queda como referencia del expediente).

### 1.2 Página pública «Suplantación y plagio»

Ruta `/seguridad` (o una sección en `/legal`), enlazada desde el modal de denuncia, el pie de página y el correo de bienvenida del artista. Contenido:

- Qué es suplantación y qué es plagio en We Ötzi, con ejemplos.
- Cómo denunciar y qué pasa después (plazos de soporte).
- Las sanciones: **la cuenta que suplanta identidad se cierra de forma permanente y se bloquea para volver a registrarse**. No prometer «de por vida» como garantía técnica.
- Que el denunciado puede responder y que hay una apelación.
- Que denunciar de mala fe también se sanciona.

### 1.3 Términos y Privacidad

- **Términos**: cláusula de identidad (una persona = una cuenta de artista; prohibido suplantar), cláusula de obra (solo publicas trabajos tuyos o con permiso), sanciones (advertencia, suspensión, cierre permanente con bloqueo de reingreso), apelación y denuncias de mala fe.
- **Privacidad**: qué se guarda de una cuenta sancionada (huellas cifradas de correo, teléfono e Instagram; ver 1.4), para qué y por cuánto tiempo (mientras dure la sanción).
- Subir `TERMS_VERSION` en los tres lugares (`lib/terms-acceptance.js`, `public/shared/js/studio-register.js`, `public.handle_new_user()`).
- **Decisión del dueño**: ¿se pide volver a aceptar los Términos al iniciar sesión? (Hasta ahora nada obliga a re-aceptar.)

### 1.4 Sistema de sanciones

**Migración nueva** `…_account_sanctions.sql` (con su reversa en `supabase/rollbacks/`):

- `account_sanctions`: `id`, `user_id`, `kind` (`warning` | `suspension` | `ban`), `reason_code` (los mismos códigos de denuncia), `summary`, `ticket_id`, `proposed_by`, `confirmed_by` (otro agente, obligatorio para `ban`), `starts_at`, `ends_at` (null = permanente), `status` (`proposed` | `active` | `appealed` | `lifted`), `appeal_text`, `appeal_decided_by`, `appeal_decided_at`, timestamps. RLS: el usuario ve sus propias sanciones activas; soporte ve todas; solo el servidor escribe.
- `banned_identifiers`: `id`, `sanction_id`, `kind` (`email` | `phone` | `instagram`; en la fase 3 se suman `document` y `face`), `value_hmac` (HMAC-SHA256 con una clave del servidor, nunca el valor en claro), `created_at`. Índice único `(kind, value_hmac)`. Sin acceso para `anon` ni `authenticated`.
- Normalización antes del HMAC:
  - correo en minúsculas, sin `+etiqueta` y sin puntos en Gmail;
  - teléfono en E.164;
  - Instagram sin `@` y en minúsculas.

**Clave**: `BAN_HMAC_KEY` en `~/weotzi-deploy/shared/main.env` (no en Supabase). Sin la clave, una fila de `banned_identifiers` no dice nada.

**Proceso** (en el panel de soporte, pestaña nueva «Sanciones» y botones en el expediente de la denuncia):

1. Soporte investiga la denuncia.
   - Para suplantación: compara con el Instagram real, revisa fechas de subida (fase 2) y pide pruebas.
2. **Aviso al denunciado** (ticket en `waiting_user`). Tiene 5 días hábiles para responder.
   - Mientras tanto, soporte puede **suspender** el perfil si el riesgo es alto, por ejemplo si hay cotizaciones activas con clientes: lo oculta del explorador y bloquea las cotizaciones nuevas.
3. Un agente **propone** la sanción y **otro agente la confirma**. Un mismo agente no puede hacer las dos cosas: lo impide la base.
4. Al confirmarse un `ban`:
   - Se bloquea la cuenta en Supabase Auth: `ban_duration` desde el servidor con service-role; sus sesiones dejan de renovarse.
   - Se oculta el perfil: el artista sale del explorador, el mapa y el marketplace, y el estudio queda con `is_active = false`.
   - Se guardan los HMAC de correo, teléfono e Instagram en `banned_identifiers`.
   - **Cotizaciones abiertas**: pasan a canceladas con el motivo «el perfil fue dado de baja por soporte» y se avisa a cada cliente.
     - **Decisión del dueño**: qué pasa con anticipos ya cobrados (propuesta: se retienen en la billetera y soporte gestiona la devolución al cliente).
   - Correos: al sancionado (motivo y cómo apelar) y al denunciante («Se tomó acción», sin detalles del otro).
5. **Apelación**: una sola, dentro de 30 días, desde un enlace del correo. La revisa un agente que no intervino. Si prospera, la sanción pasa a `lifted` y se borran sus `banned_identifiers`.

**Bloqueo de reingreso** (servidor):

- Registro de artista, de cliente y de estudio: antes de crear el perfil se comparan los HMAC de correo y teléfono.
- Validación de Instagram (artista y estudio): se rechaza un handle baneado.
- Si coincide, el usuario ve «No podemos crear esta cuenta. Si crees que es un error, escribe a soporte.», sin decir por qué, y soporte recibe una alerta con la coincidencia.
- **Límite conocido**: con correo, teléfono e Instagram nuevos, alguien puede volver. Ese hueco lo cierra el documento de la fase 3.

**Denuncias de mala fe**: la misma tabla permite sancionar al denunciante (`reason_code = 'denuncia_mala_fe'`).

### 1.5 La insignia exige controlar el Instagram

- **Artistas**: `request_artist_verification` exige además `instagram_verified_at` con `instagram_verified_handle` igual al Instagram del perfil (migración nueva que parte de la definición viva). Mensaje: «Antes de solicitarla, valida tu Instagram con el código.» El mismo requisito va en `requestEligibility` de `lib/verificacion-artista.js` y en la pantalla de Cuenta · Verificación.
- **Estudios**: aprobar exige Instagram validado (por código o confirmado por soporte con `confirm_instagram`). Hoy es opcional.
- **Si cambia el Instagram después de verificado**: la insignia se oculta hasta validar el nuevo. En el navegador ya hay un criterio parecido para estudios (`buildInstagramState`); se aplica también a artistas y en los lugares que pintan la insignia (`artist-profile.js`, `explore-map.js`, `marketplace.js`, `studio-spots-directory.js`, `lib/artist-matching.js`). Para no repetir la regla, una función compartida `isBadgeVisible(artist)`.
- La regla de contacto (`lib/cot-detalle.js`) sigue mirando solo `verification_state = 'Yes'`.

### 1.6 Pruebas y entrega

- Tests nuevos:
  - catálogo de motivos alineado;
  - un cliente puede denunciar;
  - nadie se denuncia a sí mismo;
  - normalización y HMAC;
  - `confirmed_by` distinto de `proposed_by`;
  - bloqueo en el registro;
  - insignia con Instagram distinto.
- Migración validada con `execute_sql` dentro de `begin … rollback` en el proyecto vivo, y aplicada después de aprobar el PR.
- Env nuevo en el servidor: `BAN_HMAC_KEY` (generada en el servidor, sin mostrarla).
- Guía de pruebas: nuevas pruebas de denuncia de cliente, sanción con dos agentes, apelación y reingreso bloqueado.

---

## Fase 2 · Huellas de imágenes y buscador de diseños

### 2.1 Huella de cada imagen

Por cada imagen publicada se calcula:

- `sha256` del archivo: la copia exacta byte a byte;
- **hash perceptual** de 64 bits (pHash, más dHash como respaldo): sigue reconociendo la imagen aunque se cambie el tamaño, se recomprima o se recorte un poco;
- el pHash de la imagen **espejada**, porque es un truco común para esquivar la detección.

Dos imágenes se consideran la misma foto cuando la distancia de Hamming entre sus pHash es ≤ 8 de 64; el umbral se ajusta con datos reales. La consulta es `bit_count(a # b)` en Postgres 15.

**Migración nueva** `…_image_fingerprints.sql`:

- `image_fingerprints`: `id`, `source_kind` (`artist_gallery` | `artist_feed` | `flash` | `studio_feed` | `store_design`), `artist_id` / `studio_id`, `item_key` (id estable del ítem o URL), `image_url`, `sha256`, `phash` `bit(64)`, `phash_mirror` `bit(64)`, `dhash` `bit(64)`, `width`, `height`, `first_seen_at`, `removed_at`.
  - Al borrarse la imagen, la fila se conserva con `removed_at`: sirve como **prueba de antigüedad** (quién la subió primero), pero ya sin la imagen.
- RLS: lectura solo para soporte; escritura solo del servidor. El buscador consulta por un endpoint del servidor, nunca de forma directa.

**Cálculo**:

- Hace falta decodificar JPEG, PNG, WebP y HEIC en Node.
- **Decisión técnica, previa auditoría (política de dependencias)**:
  - `sharp`: rápido; binario nativo; Apache-2.0.
  - `jimp`: JavaScript puro, más lento, sin binarios; MIT. Alcanza para este volumen y es menos riesgoso en el hosting.
  - La recomendación es probar primero que `sharp` instala bien en el servidor; si no, `jimp`.
- El pHash (DCT 32×32 → 8×8 → mediana) se escribe en `lib/image-fingerprint.js`, sin otra dependencia, con tests de imágenes de ejemplo:
  - la misma imagen redimensionada debe dar distancia baja;
  - imágenes distintas deben dar distancia alta.
- **Cuándo se calcula**: al guardar la galería, el feed, un flash, la tienda o el feed del estudio.
  - Se encola en una tabla de pendientes y la procesa un trabajo del servidor cada minuto, para no frenar el guardado.
  - Se reutiliza el patrón de tareas programadas del servidor.
- **Carga inicial**: un script que recorre las ~110 imágenes actuales.

### 2.2 Aviso automático de copia

Cuando una imagen nueva coincide (Hamming ≤ 8, incluido el espejo) con una de **otro** artista o estudio subida **antes**:

1. Se crea un ticket automático de soporte, «Posible copia de imagen», con las dos imágenes, sus fechas y la distancia.
2. **Decisión del dueño: solo se avisa a soporte.** La imagen se publica igual; nada se oculta de forma automática. El ticket marca la confianza: «casi segura» (distancia 0–2 o sha256 idéntico) o «posible» (3–8).
3. Soporte decide:
   - «Es legítimo»: por ejemplo, la misma obra publicada por el artista y por su estudio. Para eso se marcan pares permitidos entre un artista y su estudio (`studio_id`).
   - «Retirar»: soporte oculta el ítem a mano, con aviso al que subió la imagen.
   - «Abrir denuncia»: lleva a la fase 1.
4. Excepción: un artista y el estudio donde trabaja pueden compartir fotos sin alerta.

### 2.3 Buscador «¿Dónde está este diseño?»

- Ruta `/buscar-diseno`, enlazada desde la página de seguridad y el modal de denuncia. Requiere sesión iniciada.
- El usuario sube una foto (máx. 10 MB). El servidor calcula la huella **en memoria** y descarta la imagen: no se guarda salvo que el usuario haga una denuncia.
- Resultados: hasta 12 coincidencias ordenadas por parecido, cada una con:
  - miniatura;
  - artista o estudio;
  - fecha en que se subió a We Ötzi;
  - enlace al perfil.

  Se muestran solo las de distancia ≤ 12; arriba de eso el resultado sería ruido.
- En cada resultado, dos botones:
  - **«Denunciar plagio»**;
  - **«Es una suplantación»**.

  Los dos abren la denuncia (fase 1) con la foto subida, que en ese momento sí se guarda en `support-attachments`, y la coincidencia ya adjuntas.
- Texto claro en pantalla:
  - «Busca la misma foto o copias con cambios menores, dentro de We Ötzi. Todavía no encuentra diseños redibujados».
  - «Que dos diseños se parezcan no prueba un plagio: soporte revisa cada caso».
- Límites: 20 búsquedas por usuario por día. Sin búsquedas anónimas, para que nadie lo use para copiar el catálogo.

### 2.4 Pruebas y entrega

- Tests:
  - pHash estable ante cambio de tamaño, compresión y recorte del 5 %;
  - detección del espejo;
  - umbrales;
  - excepción artista-estudio;
  - la coincidencia crea el ticket y la imagen sigue publicada;
  - límite de búsquedas;
  - la foto del buscador no se guarda sin denuncia.
- Migración validada con rollback en vivo, aplicada después del PR. Carga inicial ejecutada después del deploy.

---

## Fase 3 · KYC propio con software libre (replanteada)

Requisito del dueño: sin proveedor pago, y que **ni el equipo de We Ötzi pueda ver los datos sensibles**; solo el sistema puede usarlos.

### 3.1 Cómo se cumple

El principio: **no guardar, en lugar de guardar cifrado**.

| Dato | Qué se hace | Qué queda guardado |
|---|---|---|
| Foto del documento (frente y dorso) | Se procesa en memoria y se descarta | Nada |
| Selfie / video de prueba de vida | Se procesa en memoria y se descarta | Nada |
| Número de documento + país | HMAC con clave del servidor | `document_hmac` (opaco) para detectar cuentas duplicadas y personas baneadas |
| Nombre y fecha de nacimiento leídos del documento | Se comparan con la cuenta y se descartan | Solo «coincide / no coincide» |
| Plantilla facial (vector de la cara) | Se compara contra las caras **baneadas** y se descarta | **Solo de personas baneadas**, cifrada (AES-256-GCM, `lib/field-crypto.js`, clave aparte) |
| Resultado | — | nivel de verificación, país, fecha, versión del modelo |

Así, una persona verificada que nunca fue sancionada deja en la base solo un HMAC y un resultado. Las caras se guardan únicamente de quienes fueron baneados por suplantación, que es justamente para lo que se necesitan.

### 3.2 Lo que hay que decir con honestidad

- **«Ni nosotros podemos verlos»** vale para:
  - el equipo de soporte;
  - quien acceda a la base de datos de Supabase;
  - cualquier respaldo de la base.

  Ninguno ve documentos ni caras, porque no se guardan, ni puede revertir un HMAC sin la clave.

  Pero si el sistema puede usar un dato, **quien controla por completo el servidor**, con acceso root y al `.env`, técnicamente también puede. Ese límite no lo elimina ningún diseño.

  Mitigaciones:
  - la clave vive solo en el servidor y nunca en Supabase ni en el repo;
  - permisos de archivo restringidos;
  - rotación de la clave;
  - bitácora de cada uso en `sensitive_data_access_log`;
  - el proceso de verificación no tiene ningún endpoint que devuelva datos.
- **Riesgo legal**: baja mucho, pero no desaparece.
  - Procesar una cara, aunque sea por segundos, es tratamiento de datos biométricos: hace falta **consentimiento explícito** y avisarlo en la Política de privacidad.
  - Un HMAC del documento es un dato *seudonimizado*: sigue siendo dato personal, aunque de riesgo bajo.
  - El texto correcto para el usuario es «**no guardamos tu documento ni fotos de tu cara**», no «no guardamos información sensible».
  - Conviene que un abogado lo revise para los países donde opera la beta: Argentina (Ley 25.326), México (LFPDPPP), Colombia (Ley 1581), Chile (Ley 21.719), y España/UE (RGPD art. 9) si aplica.
- **Calidad frente a un proveedor pago**: la prueba de vida open source es más débil contra deepfakes y ataques de inyección de video. Se compensa con:
  - desafíos aleatorios;
  - revisión humana de los casos dudosos;
  - el cruce con Instagram y la cuenta de cobro.

### 3.3 Piezas técnicas (todas con licencia que permite uso comercial)

- **Lectura del documento**:
  - el código **PDF417** del dorso (DNI argentino y muchos documentos de la región) se lee con ZXing (Apache-2.0);
  - la **MRZ** de pasaportes, con OCR Tesseract (Apache-2.0) y validación de dígitos verificadores;
  - se cruza con el texto del frente: si lo que dice el código no coincide con lo impreso, el caso va a revisión humana.
- **Cara**: detección con **YuNet** y comparación con **SFace**, ambos de OpenCV Zoo (MIT / Apache-2.0), en `onnxruntime-node` (MIT). Así todo corre en Node, sin un servicio Python aparte en el hosting.
  - **Ojo**: los modelos preentrenados de InsightFace/ArcFace **no** sirven, porque su licencia es solo para investigación.
- **Prueba de vida activa**:
  - En el navegador, MediaPipe Face Landmarker (Apache-2.0) guía al usuario con 2 o 3 desafíos aleatorios: girar la cabeza, parpadear, acercarse.
  - El navegador manda unos pocos cuadros firmados con un nonce de un solo uso.
  - El servidor **vuelve a verificar** los cuadros: no confía en lo que diga el navegador.
- **Prueba de vida pasiva** (opcional, como señal extra): Silent-Face-Anti-Spoofing (Apache-2.0).
- **Diseños redibujados** (lo que la fase 2 no encuentra): embeddings de imagen con **SigLIP** o **OpenCLIP** (Apache-2.0 / MIT) en `onnxruntime-node`, guardados en `pgvector`. No son datos sensibles: son huellas de diseños, no de personas. Activan el modo «parecidos» del buscador.
- **Rendimiento en el hosting**: hay que medir CPU y RAM de la inferencia (los modelos de cara pesan ~40 MB en conjunto) y revisar la cuota de disco del servidor. Si no alcanza, un servicio aparte en un VPS chico, accesible solo desde el servidor de la app.

### 3.4 Flujo para el artista y el dueño de estudio

1. Consentimiento explícito (casilla obligatoria): qué se procesa y qué se guarda.
2. Foto del frente y del dorso del documento (desde el celular, con una guía en pantalla).
3. Prueba de vida con desafíos.
4. Resultado:
   - **verificado**;
   - **a revisión humana**: el código del documento no coincide con lo impreso, la cara se parece poco o la prueba de vida da un resultado dudoso. Soporte revisa con el usuario en una videollamada, sin acceso a las imágenes;
   - **rechazado**: el documento ya se usó en otra cuenta, o la persona coincide con una baneada. En ese caso, alerta a soporte.
5. Esta verificación **reemplaza** la subida manual de identidad que hoy revisa soporte. Las fotos de documentos ya guardadas se borran al migrar.

### 3.5 Antes de construirla

- Prototipo en el scratchpad con 20–30 casos propios (documentos y selfies del equipo con su consentimiento) para medir aciertos y falsos rechazos.
- Auditoría de las librerías y modelos antes de instalarlos.
- Revisión legal del texto de consentimiento y de la Política de privacidad.

---

## Decisiones del dueño (2026-11-18)

1. **Sí** se pide volver a aceptar los Términos (con la cláusula de sanciones) al iniciar sesión. (1.3)
2. Los anticipos cobrados de una cuenta baneada **se retienen** y soporte gestiona la devolución a cada cliente. (1.4)
3. Las coincidencias de imágenes **solo avisan a soporte**: no se retiene ni se oculta ninguna imagen automáticamente, ni siquiera las idénticas. (2.2: reemplaza el punto 2 de esa sección.)
4. Países prioritarios para documentos y revisión legal: **Argentina, España y Estados Unidos** (fase 3).

## Orden de entrega sugerido

1. **Fase 1** en una versión (2.7.0): denuncias abiertas, página de seguridad, Términos, sanciones, bloqueo de reingreso, insignia con Instagram.
2. **Fase 2** en la siguiente (2.8.0): huellas, aviso automático, buscador.
3. **Fase 3**: primero el prototipo y la medición; recién después, el plan de implementación definitivo.
