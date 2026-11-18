# Guía de soporte: verificaciones, denuncias y sanciones (2.7.0)

Para el equipo de soporte y el dueño de We Ötzi. Es el manual para operar desde el primer día la versión 2.7.0, «Seguridad: identidad, suplantación y plagio».

Base de esta guía:

- el plan [2026-11-18-kyc-antisuplantacion.md](../plans/2026-11-18-kyc-antisuplantacion.md), con las decisiones del dueño;
- [2026-11-18-kyc-sprints.md](../plans/2026-11-18-kyc-sprints.md);
- [deployments/DEPLOY.md](../../deployments/DEPLOY.md) (sección «Beta 2.7.0»);
- el código de la rama `feature/kyc-antisuplantacion`.

Los nombres de botones, estados y mensajes son los que muestra la app. Si en el panel ves algo distinto, manda lo que dice la app y avisa para corregir esta guía.

---

## Dónde está cada cosa

| Qué haces | Dónde |
|---|---|
| Validar el Instagram de un artista cuando el mensaje automático no alcanza | Panel de soporte (`/support/dashboard`) → pestaña **VALIDACIONES IG** |
| Revisar documentos y decidir la verificación de un artista | Pestaña **VERIFICACIONES** → filtro «Solicitudes de artistas» |
| Revisar la verificación de un estudio | Pestaña **ESTUDIOS**, al lado de VERIFICACIONES. La misma cola está en el backoffice, en «Verificaciones de estudios». |
| Revisar denuncias | Pestaña **DENUNCIAS** |
| Advertencias, suspensiones, cierres, apelaciones y alertas de seguridad | Pestaña **SANCIONES**, con las vistas Propuestas, Activas, Apeladas, Levantadas y Alertas |
| Buscar dónde aparece una foto dentro de We Ötzi | `/buscar-diseno` (con sesión iniciada) |
| Página pública que explica todo a los usuarios | `/seguridad` («Suplantación y plagio») |
| Página donde la persona sancionada apela | `/apelacion`, solo desde el enlace firmado del correo |

Quién puede actuar en DENUNCIAS, SANCIONES y ESTUDIOS: cualquier **agente activo** de `support_users_db` y el **superadmin** del backoffice. El superadmin cuenta como un agente más.

---

## 1. Qué cambia en 2.7.0

| Área | Antes | Desde 2.7.0 |
|---|---|---|
| Quién denuncia perfiles | Solo artistas a artistas y administradores de estudio a estudios | Cualquier persona con sesión iniciada (cliente, artista o estudio) denuncia un perfil de artista o un estudio. Nadie se denuncia a sí mismo. |
| Motivos de denuncia de perfil | 3 | 5: suplantación de identidad, plagio de diseños, uso de marca o nombre ajeno, difamación y estafa |
| Reclamo del titular | No existía | Quien dice ser la persona o el estudio suplantado deja su Instagram. Si lo validó con el código, la denuncia entra como urgente. |
| Denunciar una foto | No existía | Cada trabajo del portafolio tiene su botón «Denunciar», con el motivo de plagio ya marcado y la imagen adjunta al expediente |
| Sanciones | No existían | Advertencia, suspensión y cierre permanente. Un cierre lo propone un agente y lo confirma otro. Hay una sola apelación. |
| Reingreso | Sin control | El sistema guarda huellas cifradas (HMAC) del correo, el teléfono y el Instagram de las cuentas cerradas. Si una cuenta nueva coincide, no se crea, o se cierra sola si ya existía, y soporte recibe una alerta. |
| Insignia de verificado | Artista: solo documentos. Estudio: Instagram opcional. | Artista y estudio necesitan además el Instagram validado. La insignia se oculta si cambia el Instagram del perfil. |
| Términos y Privacidad | Términos v1.0 y Privacidad v1.1 | Términos v1.1 y Privacidad v1.2 (versión `2026-11-18`). **Todos los usuarios tienen que volver a aceptarlos.** |
| Imágenes | Sin control | Huella de cada imagen publicada. Si una imagen coincide con otra subida antes por otra cuenta, llega una alerta a soporte. Nada se oculta solo. |
| Buscador `/buscar-diseno` | No existía | Subes una foto y ves dónde aparece la misma imagen dentro de We Ötzi |
| Página `/seguridad` | No existía | Explica la suplantación, el plagio, la insignia, las denuncias, las sanciones, la apelación y el buscador |

---

## 2. Antes del lanzamiento (checklist del dueño)

Hazlo en este orden. Todo lo que dice «antes del código» tiene que estar listo antes de desplegar 2.7.0.

### 2.1 Migraciones, en orden y antes del código

- [ ] Valida cada migración con `execute_sql` dentro de `begin … rollback` en el proyecto vivo `flbgmlvfiejfttlawnfu`. Aplícalas después de aprobar el PR.

| Orden | Migración | Qué habilita | Si falta |
|---|---|---|---|
| 1 | `20261118100000_insignia_instagram.sql` | La insignia exige el Instagram validado (columna `instagram_badge_ok`) | La insignia de artistas y estudios queda oculta para todos |
| 2 | `20261118110000_denuncias_abiertas.sql` | Clientes y estudios denuncian; motivos `plagio_diseno` y `estafa`; tope de 5 por día | Las denuncias nuevas de clientes y los motivos nuevos fallan |
| 3 | `20261118120000_terminos_reaceptacion.sql` | Tabla `terms_acceptances`, versión `2026-11-18` y control de cuentas nuevas | No hay re-aceptación ni barrido de reingreso |
| 4 | `20261118130000_account_sanctions.sql` | Sanciones, huellas de cuentas cerradas, alertas de seguridad, `sanction_state` en artistas y estudios, bloqueo de retiros con sanción | El código 2.7.0 lee `sanction_state`: el flash, los turnos y las sugerencias de artistas fallan. La pestaña SANCIONES dice que falta la migración. |
| 5 | `20261118140000_image_fingerprints.sql` | Huellas de imágenes, cola de procesamiento y registro del buscador | El buscador y las alertas de imágenes no funcionan |

- [ ] Para volver atrás: primero el código 2.6.1 y después las reversas de `supabase/rollbacks/` en orden inverso, de la 140000 a la 100000. La reversa de sanciones borra sanciones, huellas y alertas, pero **no toca Auth**: antes de correrla, levanta desde el panel las sanciones vigentes para que esas cuentas vuelvan a poder entrar.

### 2.2 `BAN_HMAC_KEY` en el servidor

- [ ] Genera la clave **en el servidor** y nunca la muestres en un chat, un log ni un ticket. El comando está en DEPLOY.md, sección 2.7.0 §1: 32 bytes aleatorios en base64, en `~/weotzi-deploy/shared/main.env`, con `chmod 600` y `pm2 restart weotzi --update-env`.
- [ ] Guarda una copia en el gestor de secretos del dueño.

Esta clave hace dos cosas: calcula las huellas de correo, teléfono e Instagram de las cuentas cerradas y firma los enlaces de apelación.

| Situación | Qué pasa |
|---|---|
| **Falta o no es válida** | El servidor arranca igual y **falla abierta**: <br>• los cierres no guardan huellas, y en «Qué hizo» la sanción dice «Sin huellas: falta BAN_HMAC_KEY en el servidor»; <br>• el registro no bloquea el reingreso; <br>• el correo de sanción sale sin enlace de apelación y lleva a `/seguridad`; <br>• `/apelacion` responde «Las apelaciones no están disponibles en este momento. Escribe a soporte.» |
| **Se pierde o se cambia** | Las huellas guardadas dejan de coincidir, así que el reingreso de esas cuentas ya no se detecta. Los enlaces de apelación que ya enviaste dejan de funcionar. No la rotes sin un plan para volver a calcular las huellas. |

### 2.3 Decisión sobre `sharp`

`sharp` es la librería que decodifica imágenes. **Hoy no está en `package.json`.** Sin ella:

- el motor de huellas queda apagado y no llega ninguna alerta «Posible copia de imagen»;
- el buscador `/buscar-diseno` responde «El buscador se habilita pronto.»;
- el resto de 2.7.0 funciona igual.

La auditoría ([2026-11-18-auditoria-sharp.md](../plans/2026-11-18-auditoria-sharp.md)) dio **apto con condiciones**. Si decides incluirla:

- [ ] Por SSH, confirma que el servidor tiene glibc 2.28 o superior (`ldd --version`) y una CPU con SSE4.2 (`grep -c sse4_2 /proc/cpuinfo`).
- [ ] Instala la versión exacta: `npm install --save-exact sharp@0.35.5`.
- [ ] Revisa que el lockfile incluya `@img/sharp-linux-x64` y `@img/sharp-libvips-linux-x64`. Si se generó en Windows, npm puede dejarlos fuera.
- [ ] El código ya aplica los límites que pide la auditoría (`lib/image-decode.js`).
- [ ] Si el servidor no cumple los requisitos, el plan B es `jimp`, que es más lento. Hoy no está implementado.

### 2.4 Un segundo agente de soporte activo

- [ ] Crea un **segundo agente activo** en `support_users_db` antes de usar cierres en serio. Hoy hay uno solo.

Por qué hace falta:

- Un **cierre permanente** lo propone un agente y lo confirma **otro**. Lo exige la base de datos.
- Una **apelación** la decide un agente que **no propuso ni confirmó** la sanción.
- Con un solo agente más el superadmin, uno propone el cierre y el otro lo confirma. Si esa persona apela, **nadie puede decidir la apelación**.

Con dos agentes más el superadmin, cada cierre tiene quien lo proponga, quien lo confirme y quien decida su apelación.

### 2.5 El estudio verificado sin Instagram validado

- [ ] Hay **un** estudio verificado que no tiene su Instagram validado. No se le respetó el estado anterior: al desplegar, **su insignia se oculta** hasta que el Instagram quede validado.
- [ ] Antes del deploy, pídele al dueño del estudio que lo valide desde su panel: **Verificación → «Instagram del estudio» → «Enviar código a mi email»**. Después manda el código por mensaje directo a @weotzi desde la cuenta del estudio.
- [ ] La casilla «Confirmo que el Instagram … es del estudio» solo aparece al decidir una solicitud pendiente. No sirve para un estudio que ya está aprobado.

Hoy no hay artistas verificados, así que ningún artista pierde la insignia.

### 2.6 Carga inicial de huellas, después del deploy

Requiere la migración 140000 y `sharp` instalado. Corre desde la raíz del repo, con el `.env` del servidor:

```bash
node scripts/backfill-image-fingerprints.js --dry-run   # solo cuenta, no escribe
node scripts/backfill-image-fingerprints.js             # encola a todos los dueños de imágenes
# o, para procesar todo en el momento:
node scripts/backfill-image-fingerprints.js --run
```

- [ ] Sin `--run`, el trabajo del servidor procesa 20 dueños por minuto. Son unas 110 imágenes, así que tarda minutos.
- [ ] Ojo: el paquete de la release no incluye la carpeta `scripts/`. Asegúrate de correrlo donde el script exista.
- [ ] La carga inicial **puede generar alertas** por copias que ya existían. Revisa SANCIONES → Alertas después de correrla.
- [ ] La variable `IMAGE_FP_JOB=off` apaga el trabajo del servidor.
- [ ] Sobrescribir un archivo en Storage no avisa a la base. Correr el script de nuevo de vez en cuando (por ejemplo, de noche) cubre ese hueco.

### 2.7 Re-aceptación de Términos: afecta a todos

- [ ] Todas las personas con sesión iniciada (artistas, clientes y estudios) ven en la siguiente página un aviso que **no se puede saltar**: «Actualizamos los Términos y la Política de privacidad». Para seguir, marcan «Leí y acepto los Términos y Condiciones y la Política de privacidad.» y tocan **«Aceptar y continuar»**. La otra opción es **«Cerrar sesión»**.
- [ ] El aviso no aparece en `/legal`, `/seguridad`, `/apelacion`, `/support` ni `/backoffice`, así que los Términos se pueden leer sin aceptar.
- [ ] Espera consultas los primeros días. Respuesta corta: «Actualizamos los Términos para sumar las reglas de identidad, obra propia, denuncias y sanciones. Para seguir usando tu cuenta tienes que aceptarlos. Si no estás de acuerdo, puedes cerrar sesión y pedir la baja de tu cuenta.»

### 2.8 Pendientes legales

- [ ] La Política de privacidad tiene marcadores «[A COMPLETAR …]». Uno de ellos son los plazos de conservación de los expedientes de denuncias y sanciones, y qué pasa con las huellas de imágenes al eliminar una cuenta. Complétalos antes de publicar.

### 2.9 Prueba después del deploy (con cuentas de prueba)

- [ ] `/support/dashboard#sanciones` abre la pestaña con Propuestas, Activas, Apeladas, Levantadas y Alertas.
- [ ] Propón una **advertencia** a una cuenta de prueba. Se aplica en el acto y llega el correo con el botón «Apelar la sanción».
- [ ] Abre el enlace y apela una vez. La segunda vez la página dice «Ya enviaste tu apelación».
- [ ] Propón un **cierre** con un agente. Para él, el formulario dice «Tú propusiste este cierre: lo tiene que confirmar otro agente.»
- [ ] Confírmalo con otro agente. Comprueba que:
  - el perfil sale del explorador;
  - la cuenta no puede iniciar sesión;
  - registrarse de nuevo con el mismo correo muestra «No podemos crear esta cuenta. Si crees que es un error, escribe a soporte.» y deja una alerta «Reingreso bloqueado».
- [ ] Levanta la sanción de prueba. El perfil vuelve, la cuenta puede entrar y se borran sus huellas.

---

## 3. Verificación de artistas

### 3.1 Qué hace falta para la insignia

| Requisito | Detalle |
|---|---|
| Documento de identidad | **Obligatorio.** Lo aprueba soporte. |
| Comprobante de domicilio | **Obligatorio.** Lo aprueba soporte. |
| Certificado de bioseguridad | Opcional. Suma confianza. |
| Instagram validado con el código | **Obligatorio desde 2.7.0.** El Instagram validado tiene que ser **el mismo** que figura en el perfil. Sin esto, el artista no puede pedir la verificación: el botón «Solicitar verificación» se convierte en «Validar mi Instagram» y el mensaje dice «Antes de solicitarla, valida tu Instagram con el código.» |

El artista pide la verificación en **Cuenta · Verificación**.

### 3.2 Cómo se valida el Instagram

1. El artista pide un código en su cuenta (Portafolio). Le llega por correo con el formato `WO-XXXXXX`.
2. Lo manda por mensaje directo a **@weotzi** desde la cuenta de Instagram de su perfil.
3. Si la automatización lo reconoce, queda validado solo.
4. Si no, aparece en **VALIDACIONES IG**:
   - **VALIDAR CON CÓDIGO**: pegas el código o el mensaje entero.
   - **VALIDAR SIN CÓDIGO**: con nota interna obligatoria. Úsala solo si viste que el mensaje llegó **desde esa cuenta**, por ejemplo con un código vencido.
   - **RECHAZAR**: con nota obligatoria.

Si el Instagram pertenece a una cuenta cerrada, la validación se rechaza con «No podemos validar esta cuenta de Instagram. Si crees que es un error, escribe a soporte.», y soporte recibe una alerta «Reingreso bloqueado».

### 3.3 Estados

| Estado (base) | Lo que ve soporte | Lo que ve el artista |
|---|---|---|
| `No` | Sin solicitar | «Todavía no verificaste tu identidad» o, si se revocó, «Tu perfil quedó sin verificar» |
| `Requested` | En revisión | «Verificación en proceso» o «Documentos aprobados · falta la revisión final» |
| `Yes` | Verificado | «Perfil verificado» o, si cambió el Instagram, «Tu insignia de verificado está oculta» |
| `Denied` | Denegada | «Verificación denegada», con el motivo |

### 3.4 Cómo decidir (pestaña VERIFICACIONES)

1. Filtra **«Solicitudes de artistas»** y abre la solicitud.
2. Revisa el dato **Instagram** del expediente:
   - «Instagram validado · @…»: está listo;
   - «Sin validar»: falta validar;
   - «No coincide: …»: validó un Instagram distinto al de su perfil.
3. Abre cada documento con **Abrir**. El enlace dura 2 minutos. No lo descargues ni lo reenvíes.
4. En cada documento: **APROBAR DOCUMENTO** o **RECHAZAR**, con «Nota para el artista».
5. Cuando identidad y domicilio están aprobados («Identidad y domicilio aprobados.»), decide:

| Botón | Cuándo | Motivo |
|---|---|---|
| **MARCAR ARTISTA VERIFICADO** | Documentos aprobados e Instagram validado y coincidente | Opcional |
| **DENEGAR VERIFICACIÓN** | Documentos que no corresponden a la persona, datos inconsistentes | **Obligatorio**, mínimo 5 caracteres. Lo ve el artista por correo y en su cuenta. |
| **REVOCAR VERIFICACIÓN** | Aparece si ya está verificado. Úsalo si se descubre que los datos no eran válidos. | **Obligatorio**, mínimo 5 caracteres. Lo ve el artista. |

Cada decisión manda un correo al artista: verificado, denegado o revocado.

### 3.5 Qué significa la insignia y cuándo se oculta

- **Significa** que soporte revisó los documentos y que el artista controla el Instagram de su perfil. **No es** una certificación profesional ni sanitaria. Así lo dice `/seguridad`.
- **Se muestra** cuando el estado es Verificado **y** el Instagram validado coincide con el del perfil.
- **Se oculta sola** cuando:
  - el artista cambia el Instagram de su perfil. Vuelve cuando valide el nuevo, sin que soporte haga nada;
  - el perfil tiene una suspensión o un cierre: en ese caso todo el perfil deja de ser público.
- **No cambia** con la insignia oculta:
  - los retiros: para eso sigue contando solo el estado Verificado;
  - la regla de contacto de las cotizaciones.

---

## 4. Verificación de estudios

### 4.1 Qué manda el estudio

Solo la pide el **dueño** del estudio, desde su panel (**Verificación**). Un manager no ve esa pestaña.

| Campo | Obligatorio |
|---|---|
| Nombre legal o comercial | Sí |
| Responsable del estudio y su cargo | Sí |
| Email o teléfono del responsable | Sí |
| Sede a verificar (de las cargadas en «Sedes») | Sí |
| Documento que acredita la representación (habilitación, contrato o poder a nombre del responsable). PDF, JPG, PNG o WEBP de hasta 10 MB. | Sí |
| Evidencia del espacio: fotos de la sede, al menos una y hasta 6 | Sí |
| Comentario para soporte | No |

Por qué se abrió la solicitud (lo ves en la tarjeta):

- «Pedido del estudio»;
- «Nombre parecido a otro estudio»;
- «Mismo Instagram que otro estudio». Estos dos últimos casos los detecta el registro.

### 4.2 El Instagram es obligatorio para aprobar

En la tarjeta de la solicitud (pestaña **ESTUDIOS** o backoffice «Verificaciones de estudios») hay tres casos:

| Caso | Qué ves | Qué haces |
|---|---|---|
| Instagram validado con código | «@… validado» | **Aprobar verificación** queda habilitado |
| Tiene Instagram, pero no lo validó | La casilla «Confirmo que el Instagram @… es del estudio» | Márcala **solo si comprobaste** que la cuenta es del estudio: por ejemplo, un mensaje directo desde esa cuenta a @weotzi, o que el perfil de Instagram enlace a la misma sede. Si no puedes comprobarlo, **Pedir corrección** y pídele que valide el código. |
| No cargó Instagram | «El estudio no cargó su Instagram y sin él no se puede aprobar.» | **Pedir corrección**: que lo cargue en Perfil y lo valide |

Además, el servidor rechaza la aprobación si el Instagram pertenece a una cuenta cerrada.

### 4.3 Acciones

| Acción | Nota | Qué pasa |
|---|---|---|
| **Aprobar verificación** | Opcional | El sello aparece en el perfil público y el dueño recibe un correo |
| **Pedir corrección** | **Obligatoria**, mínimo 3 caracteres | El estado pasa a «Corrección pedida». El estudio recibe la nota por correo y ve «Necesitamos una corrección», con el botón «Corregir datos». |
| **Retirar el sello de verificado** → **Retirar sello** | Motivo obligatorio. Lo recibe el estudio. | El estado pasa a «Cancelada / sello retirado» |

Estados de la cola: Pendiente, Aprobada, Corrección pedida, Cancelada / sello retirado.

El sello del estudio también **se oculta solo**:

- si el estudio cambia su Instagram, hasta que valide el nuevo;
- si la cuenta dueña tiene una suspensión o un cierre: el estudio queda inactivo y deja de mostrarse en todas partes (su página, el explorador y el mapa, el filtro y las tarjetas del marketplace, el perfil de sus artistas, los spots y la Store), y nunca muestra «Estudio verificado». Vuelve cuando se levanta la sanción.

---

## 5. Denuncias (pestaña DENUNCIAS)

### 5.1 Quién denuncia qué

| Quién | Qué puede denunciar |
|---|---|
| Cualquier persona con sesión (cliente, artista o estudio) | El perfil de un artista o de un estudio, y cada trabajo de un portafolio |
| Un artista | Además, una cotización que recibió |
| Sin sesión | Nada. El modal invita a iniciar sesión o a crear una cuenta de cliente («es corta y te permite seguir el caso por correo»). |
| Nadie | Su propio perfil |

El botón **«Denunciar»** está en el perfil del artista, en el perfil del estudio y en cada trabajo del portafolio. En un trabajo, el motivo de plagio viene marcado y la foto se suma al expediente.

### 5.2 Motivos y prioridad inicial

| Motivo (como lo ve la persona) | Texto de ayuda | Prioridad al entrar |
|---|---|---|
| Suplantación de identidad | «Se hace pasar por otra persona o estudio» | Alta |
| Plagio de diseños | «Publica diseños o fotos de otro artista como propios» | Alta |
| Uso de marca o nombre ajeno | «Usa la marca, el logo o el nombre de otro» | Alta |
| Difamación | «Difunde acusaciones falsas para dañar su reputación» | Alta |
| Estafa | «Cobró y no cumplió, o pidió pagos fuera de la plataforma» | **Urgente** |

Motivos de cotización (solo artistas): Comentarios abusivos, Fotos inapropiadas, Violencia (**urgente**) y Spam.

Cualquier denuncia pasa a **Urgente** si quien denuncia demuestra ser el titular (ver 5.4).

### 5.3 Límites del formulario

- Hasta **5 denuncias por persona en 24 horas**.
- **Una denuncia abierta por denunciante, denunciado y motivo.** Si la misma persona vuelve a denunciar desde otra foto, la imagen se suma al expediente abierto («Ya tenías una denuncia abierta por este motivo: sumamos esta imagen a ese expediente.»).
- Descripción de 20 a 3000 caracteres.
- Hasta 5 enlaces que empiecen con `https://`.
- Hasta 3 imágenes JPG, PNG, WEBP o HEIC, de 10 MB cada una.
- La casilla «Confirmo que la información es verdadera y que envío esta denuncia de buena fe.» es obligatoria.

Cada denuncia abre un ticket con código `WO-00000`. Al denunciante le llega un acuse con el número, y a soporte, el aviso «Nueva denuncia».

### 5.4 Reclamo del titular y «Confirmar titular»

En los motivos **suplantación** y **plagio**, el modal pregunta **«¿Eres la persona o el estudio suplantado?»**. Si la respuesta es sí, pide:

- **Tu Instagram** (obligatorio);
- **Enlace de prueba** (opcional; por ejemplo, la publicación original con fecha).

En el expediente aparece la sección **«Reclamo del titular»**, con Instagram, Enlace de prueba, Validado y Confirmado.

| Situación | Qué pasa |
|---|---|
| Ese Instagram ya está validado en We Ötzi por quien denuncia | La denuncia entra como **Urgente** y dice «Validado: Sí (código de Instagram …)» |
| Lo valida después | El sistema sube sus denuncias abiertas a **Urgente** y deja una nota de «Sistema» |
| No lo validó | Comprueba tú que controla esa cuenta, por ejemplo con un mensaje directo desde ese Instagram a @weotzi. Recién entonces toca **CONFIRMAR TITULAR**: la denuncia pasa a Urgente y queda la fecha de confirmación. |

> Toca **CONFIRMAR TITULAR** una sola vez y solo en denuncias activas. El botón no se bloquea solo: si lo tocas en un ticket resuelto, vuelve a marcarlo como urgente.

### 5.5 Imagen denunciada

Cuando la denuncia sale de un trabajo del portafolio, el expediente muestra **«Imagen denunciada»** (o «Imágenes denunciadas»). El servidor ya comprobó que esa foto está en el portafolio del perfil denunciado.

Límite conocido: si el trabajo era un video, la miniatura aparece rota. Abre el enlace.

### 5.6 Estados, resultado y correo al denunciante

| Estado | Úsalo para |
|---|---|
| Abierta | Recién llegada |
| En revisión | La estás investigando. **También mientras corre el plazo de 5 días hábiles del denunciado** (ver 6.5). |
| Esperando al denunciante | Le pediste más pruebas a quien denunció |
| Resuelta | Decidiste. Pide **Resultado** («Se tomó acción» o «Sin acción») y **Resolución** (mínimo 5 caracteres). |
| Cerrada | Archivo |

- Al pasar a **Resuelta por primera vez**, el denunciante recibe un correo automático: «Se tomó acción sobre tu denuncia» o «Tu denuncia se cerró sin acción». El correo no da detalles de la otra parte. Si cambias el resultado después, el correo **no** se vuelve a enviar.
- Una sanción no resuelve el ticket sola. Cuando confirmes la sanción, vuelve a la denuncia y márcala Resuelta.
- **Notas internas**: solo las ve soporte. Ni el denunciante ni el denunciado las reciben.
- El denunciado **no ve la denuncia**. En las denuncias de un artista o de un estudio, el aviso del plazo de 5 días hábiles lo mandas tú desde el expediente con **AVISAR AL DENUNCIADO** (ver 6.5).
- Desde el expediente, **PROPONER SANCIÓN** abre la pestaña Sanciones con el formulario precargado: cuenta, ticket, motivo y resumen.

---

## 6. Sanciones (pestaña SANCIONES)

### 6.1 Tipos

| Tipo | Quién la aplica | Efectos | Dura |
|---|---|---|---|
| **Advertencia** | Se aplica **al proponerla**, sin segundo agente | Queda registrada y la persona recibe un correo. La cuenta sigue funcionando. | Sin fin |
| **Suspensión** | Se propone y se **confirma**. Puede confirmarla el mismo agente, porque es urgente y reversible. | El perfil se oculta del explorador. No recibe cotizaciones nuevas. Los estudios del usuario quedan desactivados. **No puede pedir retiros.** Las cotizaciones en curso **no** se cancelan y **puede seguir iniciando sesión**: ve el aviso «Tu perfil está suspendido hasta el …». | Fecha de fin obligatoria: al menos 1 hora y como máximo 365 días. Se levanta sola al vencer (el servidor revisa cada 10 minutos). |
| **Cierre permanente** | La propone un agente y la **confirma otro** | Ver 6.3 | Sin fin |

Motivos: los 5 de denuncia, más «Denuncia de mala fe» y «Otro motivo».

> El panel y el correo llaman «Robo de propiedad intelectual» a lo que en Denuncias se llama «Uso de marca o nombre ajeno». Es el mismo motivo.

### 6.2 Proponer y confirmar

1. **PROPONER SANCIÓN**, o llega desde una denuncia o una alerta.
2. **Cuenta**: «Buscar por correo, usuario o nombre» → **BUSCAR**. O pega el «ID de usuario».
3. **Tipo de sanción**. Para una suspensión, también **Fin de la suspensión**.
4. **Motivo**.
5. **Resumen del caso**, de 10 a 2000 caracteres. Lo ven los agentes. Al sancionado le llegan solo el tipo y el motivo.
6. **Ticket de la denuncia** (opcional; viene completo si llegaste desde la denuncia).
7. **PROPONER**.

No puedes sancionar tu propia cuenta. Tampoco puede haber dos propuestas del mismo tipo esperando para la misma cuenta.

Para **confirmar**, otro agente abre la propuesta en **Propuestas** y toca **CONFIRMAR**. Puede dejar una «Nota (opcional)». Si fuiste tú quien propuso un cierre, el panel dice «Tú propusiste este cierre: lo tiene que confirmar otro agente.»

Si una propuesta no corresponde, **Descartar la propuesta** → **DESCARTAR**, con el motivo.

### 6.3 Qué hace exactamente un cierre permanente

Al confirmarlo, el sistema corre estos pasos en orden. El detalle de la sanción los resume en **«Qué hizo»**.

| Paso | Efecto | Línea en «Qué hizo» |
|---|---|---|
| Perfil | El artista sale del explorador, el mapa y el marketplace. Sus estudios quedan desactivados y el dueño no puede reactivarlos. | «Perfil de artista oculto», «N estudios desactivados» |
| Cotizaciones | Se cancelan las abiertas (pendientes, respondidas, aprobadas por el cliente, en progreso y vencidas) con el motivo «El perfil fue dado de baja por soporte.». Las terminadas por el artista o completadas **no** se tocan. | «N cotizaciones canceladas» |
| Aviso a clientes | Cada cliente recibe «Cancelamos tu cotización», con la nota «Si pagaste un anticipo, soporte se comunicará contigo para gestionar la devolución.» | «(N clientes avisados)» |
| Billetera y Store | Los retiros en proceso y las liberaciones pendientes quedan **bloqueados**. Los pedidos de la Store cobrados y no liberados quedan **retenidos**. | «N movimientos de la billetera retenidos», «N pedidos de la Store retenidos» |
| Alertas de devolución | Una alerta «Devolución de anticipo» por cliente con anticipo registrado en una cotización cancelada (ver 7.2) | «N alertas de devolución de anticipo» |
| Huellas | HMAC del correo de Auth, de los teléfonos (Auth, WhatsApp y teléfonos de los estudios) y de los Instagram de sus perfiles | «N huellas guardadas», o el aviso de que falta la clave |
| Auth | La cuenta queda bloqueada en Supabase Auth de forma permanente | «Ingreso bloqueado en Auth» |
| Sesiones | Se cierran todas sus sesiones | «Sesiones cerradas» |
| Aviso | Correo «Cerramos tu cuenta de We Ötzi», con el botón «Apelar la sanción» si hay clave | «Aviso enviado por correo» |

- Si un paso falla, la sanción queda **Activa**, en la lista aparece «Pasos pendientes» y el detalle dice «Un paso falló (…). Vuelve a confirmar para terminar.». Toca **REINTENTAR**: solo corre los pasos que faltan.
- Si otro agente está aplicando o levantando la misma sanción, verás «Otro agente la está aplicando o levantando en este momento. Espera un momento y actualiza.». Espera y toca **ACTUALIZAR**.
- Si la persona vuelve con un correo, un teléfono y un Instagram nuevos, el sistema no la reconoce. Lo que estos controles hacen es poner obstáculos. Comunica siempre «cierre permanente y bloqueo para volver a registrarse», nunca «de por vida».

### 6.4 Levantar una sanción

- En **Activas** abre la sanción → **Levantar la sanción**, con un motivo de al menos 10 caracteres → **LEVANTAR**.
- Revierte lo que la sanción registró:
  - el perfil vuelve y los estudios que estaban activos se reactivan;
  - se liberan los movimientos de la billetera y los pedidos de la Store;
  - se borran sus huellas;
  - se quita el bloqueo de Auth.
- En un **cierre permanente**, levantarlo (o que se levante por una apelación) deja la cuenta **marcada como revisada**: ya no se vuelve a bloquear por coincidir con las huellas de **otra** cuenta cerrada, ni al iniciar sesión, ni en el barrido, ni al validar su Instagram. Las huellas de la otra cuenta siguen bloqueando a cualquier otra. En «Qué hizo» aparece «Cuenta marcada como revisada: ya no se bloquea por coincidir con otra cuenta sancionada».
- Si en cambio dice «La cuenta todavía no quedó marcada como revisada (faltaba aplicar una migración)…», cuando la migración esté aplicada, abre la sanción en **Levantadas** → **Terminar de levantar** → **LEVANTAR**. Solo se guarda la marca; no se repiten el desbloqueo ni el correo.
- La persona recibe «Levantamos la sanción de tu cuenta».
- Las cotizaciones canceladas **no se reabren**, y las alertas de devolución siguen abiertas.
- **Nunca uses «Levantar» en una sanción Apelada.** Decide la apelación (6.6): si no, la apelación queda sin decisión registrada.

### 6.5 El plazo de 5 días hábiles del denunciado

Los Términos (sección 20) y `/seguridad` prometen que, **antes de sancionar**, avisamos el motivo a la persona denunciada y le damos **5 días hábiles** para responder y presentar pruebas.

En las denuncias de un **artista** o de un **estudio**, el expediente tiene la sección **«Aviso al denunciado»**:

- Escribe, si hace falta, **«Qué tiene que responder (opcional)»** (hasta 1000 caracteres; va en el correo tal cual, por ejemplo «Envíanos los archivos originales del diseño») y toca **AVISAR AL DENUNCIADO**. Confirma el aviso: no se puede deshacer.
- Al artista, o a quien es dueño del estudio, le llega el correo «Recibimos una denuncia sobre tu perfil» con el motivo, el número de ticket y la fecha límite. El sistema calcula **5 días hábiles** (no cuentan sábados ni domingos). El correo **nunca** dice quién denunció ni incluye la descripción o la evidencia. Para responder, le indica que escriba por el chat de soporte o por correo con el número de ticket.
- Se manda **una sola vez por ticket**. Después, la sección muestra «Avisado», «Plazo para responder» y «Lo que se le pidió», y queda una nota interna con las fechas.
- Solo se puede avisar con la denuncia abierta: si está Resuelta o Cerrada, reábrela antes.
- Si dice «No pudimos confirmar la entrega del correo», revisa el registro de envíos antes de volver a escribirle. Si no hay un correo al que escribir, el panel lo dice: avísale por otro medio (plantilla 10.2) y déjalo en una nota interna.
- El sistema **no** frena una sanción mientras corre el plazo: respetarlo depende de ti.

Además:

- [ ] Avisa al denunciado con **AVISAR AL DENUNCIADO** antes de proponer una sanción.
- [ ] Deja la denuncia en **En revisión**.
- [ ] Si el riesgo es alto (por ejemplo, cotizaciones activas con clientes en un caso de suplantación o estafa), puedes aplicar una **suspensión preventiva** mientras corre el plazo. Ponle como fin el plazo más un margen para decidir.
- [ ] Cuando venza el plazo, con o sin respuesta, decide.

La **advertencia** se aplica en cuanto la propones. Proponla recién cuando haya vencido el plazo.

### 6.6 Apelaciones

| Regla | Detalle |
|---|---|
| Cuántas | **Una sola** por sanción |
| Plazo | **30 días** desde que empezó la sanción |
| Desde dónde | El botón «Apelar la sanción» del correo de aviso, que lleva a `/apelacion` con un enlace firmado. No requiere iniciar sesión. |
| Texto | De 20 a 3000 caracteres. No se puede editar después. |
| Mientras tanto | La sanción sigue vigente, en estado **Apelada** |
| Quién decide | Un agente que **no propuso ni confirmó** la sanción |

Cómo decidir:

1. Llega un correo «Nueva apelación» y la sanción aparece en **Apeladas**.
2. Lee el bloque «Apelación» y el caso.
3. En **Decidir la apelación**, elige **Se mantiene** o **Se levanta**.
4. Escribe el **Fundamento**, de al menos 10 caracteres.
5. Toca **GUARDAR DECISIÓN**.

Qué recibe la persona:

- **Se mantiene**: «Revisamos tu apelación». La decisión es final.
- **Se levanta**: se revierte todo como en 6.4 y le llega «Levantamos la sanción».

El panel no puede reenviar el enlace de apelación. Si alguien perdió el correo, avisa al dueño.

### 6.7 Denuncias de mala fe

- Denunciar algo que sabes falso, con pruebas falsas o para perjudicar a un competidor se sanciona con las mismas medidas. Se le propone la sanción **al denunciante** con el motivo «Denuncia de mala fe».
- Una denuncia de buena fe que no prospera **no** tiene consecuencias. Así lo dice `/seguridad`.
- Límite conocido: el correo de **advertencia** siempre dice «Nuestro equipo de soporte revisó una denuncia sobre tu cuenta». Si adviertes a alguien por mala fe, explícale el caso aparte con un correo de soporte.

### 6.8 Cierres automáticos por reingreso

Cuando una cuenta **nueva** coincide con una cerrada, el sistema crea un cierre con «Propuso: Sistema» y el resumen «Reingreso bloqueado (…)». En «Qué hizo» dice «Bloqueo automático por reingreso». No hay correo a la persona.

**Un falso positivo (por ejemplo, un teléfono compartido) se corrige levantando el cierre automático.** Búscalo en **Activas** por esa cuenta y levántalo con el motivo (6.4). La cuenta queda marcada como revisada y el control la respeta: en el próximo inicio de sesión, en el barrido o al validar su Instagram ya no se vuelve a cerrar por coincidir con la cuenta sancionada. Las huellas de la cuenta sancionada siguen bloqueando a cualquier otra cuenta. Anota el caso en la alerta (7.1) y no le expliques a la persona qué dato coincidió.

El control corre:

- en el registro de artista, de cliente y de estudio;
- en el primer inicio de sesión de una cuenta nueva;
- en un barrido del servidor cada 10 minutos.

Solo aplica a cuentas creadas **desde el 18 de noviembre de 2026**.

---

## 7. Alertas de seguridad (SANCIONES → Alertas)

Las alertas también llegan por correo a soporte («Alerta de seguridad: …»). Tienen tres estados: Abierta, Gestionada y Descartada.

### 7.1 Reingreso bloqueado

- **Qué dice:** el resumen es «Coincide por correo / teléfono / Instagram · código». El código del flujo aparece **tal cual, sin traducir**:

  | Código | Flujo |
  |---|---|
  | `artist` | Registro de artista |
  | `client` | Registro de cliente |
  | `studio` | Registro de estudio |
  | `instagram` | Validación de Instagram |
  | `login` | Inicio de sesión (o barrido del servidor) |
  | `precheck` | Comprobación antes del registro |

  La alerta **no** muestra el dato en claro.
- **Qué pasó:** según el flujo:
  - `precheck`: no se creó la cuenta, así que no hay sanción ni «Cuenta»;
  - `instagram`: se rechazó la validación; no se crea ninguna sanción;
  - el resto: la cuenta nueva se cerró sola (6.8).
- **Los datos de la alerta:**
  - **Cuenta**: el ID de la cuenta nueva (vacío si no se llegó a crear);
  - **Cuenta relacionada**: el ID de la cuenta sancionada con la que coincide;
  - **Sanción**: el ID de la sanción original.

  Son texto, **no enlaces**. Para ver de quién se trata, copia el ID y pégalo en el buscador «Buscar por correo, usuario o nombre» de **Proponer una sanción** (acepta un ID y muestra el correo y el nombre); no guardes la propuesta. La sanción original la encuentras en **Activas** por esa cuenta.
- **Qué haces:**
  1. Copia los IDs y revisa la cuenta nueva y la sancionada como se explica arriba.
  2. Si es la misma persona, marca **Gestionada** y anota lo que viste en «Qué se hizo».
  3. Si fue un falso positivo (la cuenta no es de la persona sancionada):
     - **con cierre automático**: búscalo en **Activas** por esa cuenta y levántalo (6.4 y 6.8). Después marca la alerta **Gestionada** y anota lo que viste;
     - **sin cierre que levantar pero con «Cuenta»** (por ejemplo, una validación de Instagram rechazada): marca la alerta **«Descartada (falso positivo: la cuenta queda revisada)»**;
     - en los dos casos la cuenta queda revisada y no se vuelve a bloquear. Si el panel responde que falta aplicar una migración, la alerta sigue abierta: descártala de nuevo cuando esté aplicada;
     - **sin «Cuenta»** (`precheck`: la cuenta no llegó a crearse) no hay nada que marcar: anota el caso y **escala al dueño**.
- **Nunca** le digas a la persona qué dato coincidió ni con qué cuenta.

### 7.2 Devolución de anticipo

- **Qué dice:**
  - el nombre del cliente;
  - las cotizaciones con monto, moneda y fecha;
  - el total.

  No trae el correo: búscalo en la cotización (pestaña de cotizaciones, por el código).
- **Qué es:** decisión del dueño: los anticipos de una cuenta cerrada se retienen y soporte gestiona la devolución. Pero ojo:
  - En la beta, los anticipos de cotización los cobra el artista **por fuera de We Ötzi** y él los registra (Términos, sección 12). We Ötzi **no los recibe ni puede devolverlos con su dinero**.
  - Lo que sí pasó por We Ötzi (pedidos de la Store, movimientos de la billetera) quedó retenido por el cierre.
- **Qué haces:**
  1. Escribe al cliente con la plantilla 10.7.
  2. Reúne el comprobante del pago.
  3. Gestiona el reclamo. Si hay fondos retenidos en We Ötzi que correspondan a ese cliente, coordina la devolución con el dueño.
  4. Marca **Gestionada** con lo que se hizo.
- **Las alertas no cubren todo:** solo se generan por anticipos **que el artista registró**. Si un cliente escribe diciendo que pagó y no hay alerta, atiéndelo igual.

### 7.3 Posible copia de imagen

Llega cuando una imagen nueva coincide con una que **otra** cuenta subió **antes**, incluso si está espejada. Hay una sola alerta por par de imágenes, aunque la descartes.

- **Qué ves:**
  - «Imagen nueva» e «Imagen anterior», lado a lado, cada una con su dueño, su origen (Galería del artista, Flash, Fotos del estudio, Store) y la fecha «Vista por primera vez»;
  - la **Distancia**: «N de 64 (0 es idéntica)»;
  - la **Confianza**: «Casi segura» (distancia de 0 a 2, o el mismo archivo) o «Posible» (de 3 a 8).
- **Nada se ocultó solo.** La imagen sigue publicada hasta que decidas. Que dos imágenes se parezcan no prueba un plagio.
- **Excepción automática:** un artista y el estudio donde trabaja pueden compartir fotos sin alerta. Cuenta el estudio de su perfil o una membresía activa en ese estudio.

| Acción | Nota | Qué hace |
|---|---|---|
| **LEGÍTIMO** | Opcional | Descarta la alerta y la imagen sigue publicada. Úsala cuando haya permiso, cuando sea la misma obra publicada por el artista y por un estudio donde trabajó, o cuando la anterior también sea de la misma persona. |
| **RETIRAR** | **Obligatoria**, mínimo 3 caracteres. Le llega a quien subió la foto. | Quita la foto del portafolio, marca la huella como borrada y manda el correo «Retiramos una foto de tu portafolio» («retirar una foto no es una sanción»). La alerta guarda la «Copia de lo retirado» con los datos originales (URL, texto, categoría). Es solo una copia de consulta: **ningún botón del panel vuelve a publicar la foto**. Solo funciona con Galería del artista, Flash y Fotos del estudio. Para imágenes de la Store el botón está deshabilitado: retírala desde la gestión de la Store. |
| **ABRIR DENUNCIA** | Opcional | Cierra la alerta como Gestionada y abre **«Proponer una sanción»** precargado (cuenta de quien subió la imagen nueva, motivo Plagio de diseños, resumen). **No** crea un ticket en Denuncias ni avisa a nadie: antes de proponer, manda el aviso de 5 días (6.5). |

**Si la foto retirada vuelve a aparecer:**

- Si vuelve el mismo ítem, el sistema **reabre** la alerta y soporte recibe «Alerta reabierta: volvió a publicarse una imagen retirada». Revisa el par y decide de nuevo.
- Si se sube como un archivo nuevo, se crea una alerta nueva con la imagen anterior.

**Si la persona demuestra que la foto es suya (o tiene permiso):** el panel no la vuelve a publicar. Dile que puede subirla de nuevo a su portafolio, o escala al dueño si hace falta restaurarla con los datos de «Copia de lo retirado». Cuando vuelva a aparecer, llegará la alerta (reabierta o nueva): ciérrala como **LEGÍTIMO** con una nota que remita al caso.

---

## 8. Buscador de diseños (`/buscar-diseno`)

### 8.1 Qué hace y qué no

| Hace | No hace |
|---|---|
| Encuentra **la misma foto o copias con cambios menores**: otro tamaño, más compresión, un recorte chico o la imagen espejada | **No encuentra diseños redibujados** ni fotos muy editadas. Eso queda para una fase futura. |
| Busca **solo dentro de We Ötzi**, en imágenes públicas de perfiles sin sanción | No busca en Instagram, Google ni otros sitios |
| Muestra hasta 12 resultados, ordenados por parecido: «Casi segura», «Posible» o «Parecida» | No decide si hay plagio |
| Procesa la foto en memoria y la descarta | No guarda la foto, salvo que la persona abra una denuncia desde un resultado |

- Requiere sesión iniciada.
- Hasta **20 búsquedas por persona por día**, además de un límite por conexión.
- Acepta JPG, PNG, WebP o HEIC de hasta 10 MB.
- Una foto que no se puede leer igual cuenta como búsqueda.

### 8.2 Cómo usarlo en una investigación

1. Entra con tu cuenta. Las búsquedas de soporte cuentan para el mismo límite de 20.
2. Sube la imagen que te mandó el denunciante o la imagen original del titular.
3. En cada resultado mira quién la publicó y la fecha «Subido a We Ötzi el …». Esa fecha es **la primera vez que We Ötzi vio esa imagen**, no la fecha de creación de la obra. Sirve para saber quién la subió primero **aquí**.
4. Contrasta con fuentes externas: la publicación original en Instagram con su fecha, el archivo original, el enlace de prueba del reclamo.
5. Si el buscador no encuentra nada, eso **no** descarta el plagio: puede ser un redibujo.

Los usuarios pueden denunciar desde un resultado con **«Denunciar plagio»** o **«Es una suplantación»**. La denuncia llega con la foto buscada y el contexto «buscador: distancia N».

---

## 9. Árboles de decisión

### 9.1 Denuncia por suplantación de identidad

```
¿Hay «Reclamo del titular»?
├─ Sí ─ ¿«Validado: Sí»?
│        ├─ Sí → el titular está identificado (Urgente). Sigue abajo.
│        └─ No → comprueba que controla ese Instagram (mensaje directo desde esa cuenta a @weotzi)
│                 → CONFIRMAR TITULAR. Si no lo comprueba: trátala como denuncia de un tercero.
└─ No → denuncia de un tercero: pide pruebas si faltan (plantilla 10.1).

Compara el perfil denunciado con el titular real:
  · nombre, fotos, Instagram del perfil (¿validado? ¿por quién?)
  · fechas de las imágenes: /buscar-diseno y alertas «Posible copia de imagen»
  · ¿el denunciado está verificado? ¿qué documentos tiene? (VERIFICACIONES)

¿Hay indicios claros de suplantación?
├─ No → Resuelta · «Sin acción» (con la resolución explicada en el ticket).
└─ Sí → ¿hay riesgo para clientes (cotizaciones activas, cobros)?
         ├─ Sí → suspensión preventiva (fin = plazo + margen).
         └─ No → sin suspensión.
       → AVISAR AL DENUNCIADO desde la denuncia: 5 días hábiles (6.5).
       → Vence el plazo: ¿la respuesta desarma la denuncia?
           ├─ Sí → levanta la suspensión si la hubo; Resuelta · «Sin acción».
           └─ No → PROPONER SANCIÓN · Cierre permanente · Suplantación de identidad.
                   Otro agente CONFIRMA. Revisa «Qué hizo» y las alertas de devolución.
                   Resuelta · «Se tomó acción».
```

Si la cuenta que suplanta tiene la insignia, revoca también su verificación (REVOCAR VERIFICACIÓN o Retirar sello).

### 9.2 Denuncia por plagio de diseños

```
¿Qué imagen se denuncia? → «Imagen denunciada» o las imágenes adjuntas.
Busca la imagen en /buscar-diseno y revisa SANCIONES → Alertas (¿hay «Posible copia de imagen» para ese par?).

¿Quién la tuvo primero?
  · Fecha «Vista por primera vez» / «Subido a We Ötzi el …» de cada cuenta.
  · Publicación original fuera de We Ötzi (Instagram con fecha, archivo original).

¿Hay relación legítima? (permiso del autor, licencia comprada, mismo artista en su estudio,
 diseño propio publicado en dos cuentas suyas)
├─ Sí → Resuelta · «Sin acción». Si hay alerta: LEGÍTIMO.
└─ No → ¿es un caso aislado (una o pocas fotos)?
         ├─ Sí → AVISAR AL DENUNCIADO, 5 días hábiles (6.5).
         │        Sin respuesta válida: RETIRAR desde la alerta (plantilla 10.8 si responde después)
         │        y, si corresponde, Advertencia · Plagio de diseños.
         └─ No (portafolio mayormente ajeno, reincidencia tras advertencia)
                  → aviso, 5 días hábiles → Suspensión o Cierre permanente · Plagio de diseños.
       → Resuelta · «Se tomó acción».
```

- Hoy «Retirar» solo existe dentro de una alerta de imagen. Si la foto denunciada no tiene alerta (por ejemplo, porque el motor está apagado sin `sharp`), el panel no tiene un botón para retirarla: pídele al denunciado que la quite o escala al dueño.
- Si el buscador no la encuentra, puede ser un **redibujo**: decide con las pruebas externas.

### 9.3 Denuncia por estafa

```
Entra como Urgente. Pide lo que falte (plantilla 10.1):
  · código de la cotización, comprobante del pago, conversaciones, qué se acordó y qué no se cumplió.

Ten en cuenta: en la beta el anticipo se cobra por fuera de We Ötzi y el artista lo registra
(Términos, sección 12). Pedir un anticipo por transferencia no es, por sí solo, una estafa.
Investiga si cobró y no cumplió, o si usó engaños para cobrar.

¿Hay otros clientes expuestos (cotizaciones activas)?
├─ Sí → suspensión preventiva: oculta el perfil y frena cotizaciones nuevas y retiros.
└─ No → sigue.
→ AVISAR AL DENUNCIADO desde la denuncia, 5 días hábiles (6.5).
→ ¿Hay más denuncias contra la misma cuenta? (DENUNCIAS, búsqueda por nombre o email)

¿Se confirma?
├─ No → levanta la suspensión si la hubo; Resuelta · «Sin acción».
├─ Incumplimiento aislado con disposición a resolver → Advertencia · Estafa; acompaña el acuerdo.
└─ Patrón o engaño → Cierre permanente · Estafa (lo confirma otro agente).
         → Gestiona cada alerta «Devolución de anticipo» (plantilla 10.7).
→ Resuelta · «Se tomó acción».
```

---

## 10. Plantillas de respuesta

Reemplaza lo que está entre `{llaves}`. Escribe siempre en tuteo y firma «Equipo de soporte de We Ötzi». No incluyas datos de la otra parte.

### 10.1 Denuncia recibida: necesitamos más información

> **Asunto:** Tu denuncia {ticket}: necesitamos un poco más de información
>
> Hola, {nombre}:
>
> Gracias por tu denuncia {ticket}. Ya la estamos revisando. Para avanzar necesitamos:
>
> - {lo que falta: enlace a la publicación original con fecha / comprobante del pago / código de la cotización / capturas}
>
> Puedes responder a este correo con lo que tengas. Si no lo recibimos en {plazo}, seguiremos con la información disponible.
>
> La persona o el estudio que denunciaste no ve tu denuncia ni tus datos.
>
> Equipo de soporte de We Ötzi

### 10.2 Aviso a la persona denunciada (5 días hábiles)

El aviso normal lo manda el sistema con **AVISAR AL DENUNCIADO** (6.5). Usa esta plantilla solo si el panel no encontró un correo al que escribir y le avisas por otro medio.

> **Asunto:** Revisión de tu cuenta en We Ötzi: puedes responder hasta el {fecha límite}
>
> Hola, {nombre}:
>
> Recibimos una denuncia sobre tu {perfil / estudio} por **{motivo}**. Antes de tomar cualquier decisión queremos escuchar tu versión.
>
> Tienes **5 días hábiles, hasta el {fecha límite}**, para responder a este correo y mandarnos lo que creas útil: por ejemplo, archivos originales, publicaciones con fecha, permisos del autor o comprobantes.
>
> {Solo si aplicaste una suspensión preventiva:} Mientras revisamos el caso suspendimos tu perfil de forma preventiva hasta el {fecha}: no aparece en el explorador ni recibe cotizaciones nuevas. Tus cotizaciones en curso siguen como estaban.
>
> Por privacidad no podemos compartir quién envió la denuncia. Puedes leer cómo funciona el proceso en {url}/seguridad.
>
> Equipo de soporte de We Ötzi

### 10.3 Decisión de cierre permanente

El sistema ya manda el correo oficial «Cerramos tu cuenta de We Ötzi», con el motivo y el botón para apelar. Usa esta plantilla si la persona escribe después.

> **Asunto:** Sobre el cierre de tu cuenta en We Ötzi
>
> Hola, {nombre}:
>
> Después de revisar el caso, dos personas de nuestro equipo de soporte decidieron cerrar tu cuenta de forma permanente por **{motivo}**, con bloqueo para volver a registrarte.
>
> Si crees que es un error, puedes apelar **una sola vez, dentro de los 30 días** desde el cierre, con el botón «Apelar la sanción» del correo que te enviamos. La apelación la revisa una persona de soporte que no intervino en la decisión.
>
> Equipo de soporte de We Ötzi

### 10.4 Suspensión

> **Asunto:** Tu perfil está suspendido hasta el {fecha}
>
> Hola, {nombre}:
>
> Suspendimos tu perfil hasta el **{fecha}** por **{motivo}**. Mientras dure la suspensión:
>
> - tu perfil no aparece en el explorador ni recibe cotizaciones nuevas;
> - no puedes pedir retiros;
> - tus cotizaciones en curso siguen como estaban y puedes seguir entrando a tu cuenta.
>
> Al llegar la fecha, la suspensión se levanta sola. Si quieres apelar, usa el botón «Apelar la sanción» del correo que te enviamos: tienes una sola apelación, dentro de los 30 días.
>
> Equipo de soporte de We Ötzi

### 10.5 Apelación recibida

La página ya le confirma a la persona que recibimos su apelación. Usa esta plantilla si escribe preguntando.

> **Asunto:** Recibimos tu apelación
>
> Hola, {nombre}:
>
> Tu apelación está recibida. La revisa una persona de soporte que no intervino en la sanción, y te vamos a escribir a este correo con la decisión. Mientras tanto, la sanción sigue vigente.
>
> Recuerda que la apelación es una sola y no se puede editar. Si tienes algo nuevo que agregar, responde a este correo y lo sumamos al caso.
>
> Equipo de soporte de We Ötzi

### 10.6 Apelación decidida

El sistema manda solo el correo de la decisión: «Revisamos tu apelación» o «Levantamos la sanción». Esta plantilla es para responder consultas.

**Se mantiene:**

> Hola, {nombre}:
>
> Revisamos tu apelación y lo que nos contaste. La sanción se mantiene: {fundamento breve, sin datos de otras personas}. Esta decisión es final, porque la apelación es una sola.
>
> Equipo de soporte de We Ötzi

**Se levanta:**

> Hola, {nombre}:
>
> Revisamos tu apelación y decidimos levantar la sanción. Tu cuenta vuelve a funcionar con normalidad. Las cotizaciones que se habían cancelado no se reabren: si quieres retomarlas, el cliente puede pedir una cotización nueva.
>
> Equipo de soporte de We Ötzi

### 10.7 Coordinar una devolución con un cliente

> **Asunto:** Tu cotización {código} y el anticipo que pagaste
>
> Hola, {nombre}:
>
> Te escribimos por la cotización **{código}** con {artista}, que se canceló porque su perfil fue dado de baja por soporte. Según nuestros registros pagaste un anticipo de **{monto} {moneda}** el {fecha}.
>
> Para ayudarte con la devolución necesitamos:
>
> - el comprobante del pago;
> - el medio por el que pagaste.
>
> {Si el anticipo se pagó directamente al artista:} Ese pago se hizo directamente al artista, por fuera de We Ötzi, así que no lo recibimos ni podemos devolverlo con nuestros fondos. Igual vamos a acompañarte en el reclamo y te contamos los pasos posibles.
>
> {Si hay fondos retenidos en We Ötzi para ese cliente:} Tenemos fondos retenidos de esa cuenta y estamos coordinando la devolución. Te avisamos cuando esté hecha.
>
> Equipo de soporte de We Ötzi

### 10.8 Imagen retirada: respuesta al artista

El sistema ya manda «Retiramos una foto de tu portafolio» con el motivo. Usa esta plantilla cuando la persona responde.

**Trae pruebas válidas:**

> Hola, {nombre}:
>
> Gracias por mandarnos {el archivo original / el permiso del autor}. Lo revisamos y la foto es tuya {o: tienes permiso para publicarla}, así que puedes volver a publicarla en tu portafolio. Retirar una foto no es una sanción y no queda nada registrado en tu contra por esto.
>
> Equipo de soporte de We Ötzi

**No alcanza:**

> Hola, {nombre}:
>
> Revisamos lo que nos mandaste, pero no alcanza para mostrar que la foto es tuya o que tienes permiso de su autor, así que la foto sigue retirada. Si consigues {el archivo original con fecha / el permiso escrito del autor}, respóndenos y lo revisamos de nuevo. En We Ötzi solo puedes publicar trabajos tuyos o de otra persona con su permiso.
>
> Equipo de soporte de We Ötzi

---

## 11. Privacidad: reglas para agentes

**Nunca compartas:**

- Con el **denunciado**: quién denunció, los datos del denunciante, la descripción literal ni las notas internas. Solo el motivo y el plazo para responder.
- Con el **denunciante**: qué sanción se aplicó ni ningún dato de la otra cuenta. Solo «se tomó acción» o «sin acción». Para eso está el correo automático.
- Con una persona **bloqueada al registrarse o al validar su Instagram**: por qué se bloqueó, qué dato coincidió (correo, teléfono o Instagram) ni con qué cuenta. La respuesta es siempre la del sistema: «No podemos crear esta cuenta. Si crees que es un error, escribe a soporte.» (o, con Instagram, «No podemos validar esta cuenta de Instagram. Si crees que es un error, escribe a soporte.»). Si escribe, revisa la alerta, anota el caso y, si parece un error, escala al dueño: desde el panel no se puede quitar el bloqueo (6.8 y 7.1).
- Con **terceros**: si una cuenta está sancionada, verificada o denunciada.
- Con el **titular de una imagen**: los datos de contacto de quien la copió.

**Cuida estos datos:**

- **Documentos de identidad y domicilio:** ábrelos solo desde el panel (enlaces de 2 minutos para artistas y de 10 minutos para estudios). No los descargues, no hagas capturas y no los pegues en tickets, chats ni correos.
- **`BAN_HMAC_KEY` y cualquier secreto del servidor:** nunca en un chat, un ticket, un correo ni un log.
- **El enlace de apelación** es personal: pídele a la persona que no lo comparta. No lo pidas reenviado a canales públicos.
- **Notas internas y resúmenes:** escribe hechos y decisiones. No copies datos personales que no hagan falta (documentos, teléfonos, direcciones).
- **Fotos que te mandan para una investigación:** quedan en el expediente de la denuncia. No las guardes en tu equipo ni en otras herramientas.
- **El buscador:** úsalo solo para investigar casos. No sirve para revisar perfiles por curiosidad, y cada búsqueda queda registrada.

---

## Anexo: límites conocidos de 2.7.0

| Límite | Cómo lo manejas |
|---|---|
| El sistema no frena una sanción mientras corre el plazo de 5 días hábiles del aviso al denunciado | Avisa con AVISAR AL DENUNCIADO y espera la fecha límite antes de proponer (6.5) |
| Sin `sharp` no hay huellas, ni alertas de imagen, ni buscador | Decisión del dueño (2.3) |
| El buscador no encuentra diseños redibujados | Decide con pruebas externas |
| Con datos nuevos (correo, teléfono e Instagram), una persona cerrada puede volver | Las alertas y las denuncias siguen siendo la red. La fase 3 (documento) es la que cierra ese hueco y todavía no está construida. |
| Un falso positivo de reingreso sin cuenta creada (`precheck`) no se puede marcar como revisado | Anota la alerta y escala al dueño (7.1) |
| Las alertas de reingreso muestran el flujo como código (`artist`, `login`…) y los IDs como texto, sin enlaces | Usa la tabla de 7.1 y busca los IDs a mano |
| El panel no vuelve a publicar una foto retirada | La persona la sube de nuevo, o escala al dueño; cierra la alerta como LEGÍTIMO |
| «Retirar» solo funciona desde una alerta de imagen y no con imágenes de la Store | Pídele al dueño de la cuenta que la quite, o escala |
| «Levantar» acepta una sanción Apelada sin registrar la decisión | Decide siempre desde «Decidir la apelación» |
| El correo de advertencia siempre habla de «una denuncia sobre tu cuenta» | En casos de mala fe, explica aparte |
| «CONFIRMAR TITULAR» se puede tocar más de una vez | Una vez y solo en denuncias activas |
| En denuncias de videos del portafolio, la miniatura aparece rota | Abre el enlace |
| El panel no reenvía el enlace de apelación | Escala al dueño |
