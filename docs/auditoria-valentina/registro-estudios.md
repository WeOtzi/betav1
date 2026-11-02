# Registro de Estudios

Fecha: 31/10/2026. Entrega 2.2.3 preparada en una rama aislada desde el commit de beta 65de880. Runtime principal HTML/CSS/JavaScript y Supabase Auth existentes.

El registro de `/studio/register/` se adapta al flujo de cinco pasos del diseño: Cuenta, Identidad, Sedes, Fotos y Confirmar. Se conservan el alta autenticada, la asociación a una cuenta existente y el RPC transaccional `complete_studio_registration`. Esta entrega no agrega ni ejecuta migraciones.

## Referencias y entorno

- [Registro desktop en Figma](https://www.figma.com/design/WHCgICsA3ipbAE2srVls9A/Pantallas--We-Otzi--copia-?node-id=2012-290): frames `2012:291` a `2012:298`.
- [Registro móvil de 390 px](https://www.figma.com/design/WHCgICsA3ipbAE2srVls9A/Pantallas--We-Otzi--copia-?node-id=2014-2507).
- [Design System](https://www.figma.com/design/jLxPQyG2rxrq5bvfQgNcBd/Design-System-We-Otzi?node-id=11-782).
- [Preview local segura](http://localhost:4647/preview/preview-local-safe/studio/register/), iniciada con `npm run dev:safe`. La barra **PREVIEW** debe identificar datos ficticios, sin emails ni backend real.
- Publicación: versión `2.2.3`, rama `codex/registro-estudios`, basada en beta `2.2.2`. La entrega incluye el selector Estudios en Inicio y solo los archivos del registro; CI y `/api/release` determinan su SHA efectiva.

## Inventario del flujo

La referencia procede de la copia ampliada; no se identificó un nodo de auditoría de Laura para Estudios. Se inspeccionaron las capturas de cuenta en desktop, móvil y tablet y del estado de éxito. Se mantiene **Con desvíos** para registrar las alternativas de URLs de imágenes e ingreso manual de direcciones y los avisos para acciones legales y de verificación sin implementación disponible. **Simulado** acredita comportamiento observado en preview o dobles de prueba; no acredita escrituras en Supabase compartido.

| ID | Rol / URL / estado | Nodo auditoría | Nodo rediseño | Visual | Funcional | Evidencia | Acción / PR |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E-REG-01 | Estudio · `/studio/register/` · Cuenta | Sin referencia | `2012:291` | Con desvíos | Simulado | [Cuenta desktop](registro-estudios/evidencia/studio-register-desktop.png); rechazó nombre vacío y contraseñas distintas en Chromium | Implementado local |
| E-REG-02 | Estudio · registro · Identidad | Sin referencia | `2012:292` | Con desvíos | Simulado | Recorrido de los cinco pasos y edición de identidad desde revisión; URL `javascript:` rechazada | Importación remota de Instagram no acreditada |
| E-REG-03 | Estudio · registro · Sedes | Sin referencia | `2012:293`, `2024:22477` | Con desvíos: ingreso manual alternativo | Simulado | Rechazó dirección sin seleccionar; añadir/quitar sede y alta manual; cambio de principal conserva una sola; dos sedes persistidas tras recarga (comprobación de navegador) | Google Maps/Places real pendiente de prueba autorizada |
| E-REG-04 | Estudio · registro · Fotos | Sin referencia | `2012:294` | Con desvíos: URLs opcionales | Simulado | [Fotos](registro-estudios/evidencia/studio-register-photos.png); portada, quitar/reseleccionar el mismo archivo, mover imágenes antes en galería y recuperación desde IndexedDB al recargar | Storage real no acreditado |
| E-REG-05 | Estudio · registro · Confirmar | Sin referencia | `2012:295` | Con desvíos | Simulado | [Revisión](registro-estudios/evidencia/studio-register-review.png); regresó a identidad, editó y completó el alta | Implementado local |
| E-REG-06 | Estudio · registro · Confirmación por email | Sin referencia | `2012:296` | Con desvíos | Simulado con stub explícito | [Confirmación](registro-estudios/evidencia/studio-register-confirmation-simulated.png); `auth.register` sustituido para mostrar rama sin sesión; estado tras recarga, reenvío indisponible con aviso y cambio de email vuelve a Cuenta | Entrega y recepción real de correo no probadas |
| E-REG-07 | Estudio · registro · Éxito | Sin referencia | `2012:297` | Con desvíos: verificación informativa | Simulado | [Éxito](registro-estudios/evidencia/studio-register-success.png); alta de cinco pasos, acceso al panel y perfil persistente después de recargar | Solicitud de verificación de Estudios no implementada en backend; CTA informa el límite |
| E-REG-08 | Estudio · registro · Configuración pendiente | Sin referencia | `2012:298` | Con desvíos | Simulado | [Fotos pendientes](registro-estudios/evidencia/studio-register-photos-pending.png); cuenta creada, Storage bloqueado, reintento con error visible y acceso al panel | No declara éxito de fotos ante un error de subida |
| E-REG-M01 | Estudio · registro móvil | Sin referencia | `2014:2507` | Con desvíos | Simulado en Chromium | [390 px](registro-estudios/evidencia/studio-register-mobile.png) y [768 px](registro-estudios/evidencia/studio-register-tablet.png); todos los pasos y estado pendiente sin overflow a 390 px; menú cierra con Escape y diálogo de Privacidad funciona | Dispositivo físico no probado |

## Persistencia y recuperación

Los campos de texto y sedes tienen un borrador de `sessionStorage` por ruta base. Las contraseñas quedan fuera de ese borrador y de la metadata de Auth. El email y el perfil que requiere la confirmación se envían a Auth como parte del contrato existente; el RPC crea el estudio y sus sedes solo con una sesión válida.

Las fotos elegidas como archivos se guardan temporalmente en IndexedDB de este navegador, por email y ruta base. Se aceptan JPG, PNG y WebP de hasta 5 MB cada una, con un máximo de ocho imágenes de galería contando también sus URLs. Cambiar de dispositivo no transporta estos archivos: después de confirmar el correo se debe volver al navegador donde se seleccionaron.

La subida comienza después de crear el estudio y comprobar que la sesión es su propietaria. Se reutiliza `WeOtziUploader` con el bucket `studio-photos`; después se guardan los enlaces en el perfil y se verifica que el UPDATE devuelva la fila. Si falla una subida o el guardado, se conservan archivos y progreso para reintentar sin repetir los uploads ya completados. El borrador de fotos se elimina cuando el perfil confirma su guardado.

En preview, `complete_studio_registration` ahora crea estudio y sedes únicamente en el emulador del navegador. El propietario y el email provienen de la sesión ficticia. El reintento devuelve el estudio de ese usuario sin duplicarlo; un registro de Estudio no crea perfiles de artista o cliente por efecto secundario. Storage, envío de correos y servicios externos siguen sin simularse como operaciones reales.

## Componentes y límites de producto

Se reutilizan tokens, inputs, botones e iconos del sistema de diseño. La cabecera y el pie del registro se encapsulan como componentes compartidos de onboarding. El pie enlaza al [centro de ayuda público](https://weotzi.com/faqs/). Como los documentos legales no están disponibles en esta aplicación, los botones de Privacidad y Términos y condiciones muestran un diálogo que lo informa; no se inventa su contenido ni se dan por aceptados.

El CTA **Verificar** del estado de éxito informa que la solicitud de verificación de Estudios aún no está disponible desde el panel. Registrar el estudio no significa que esté verificado. El CTA de invitación abre el área de equipo existente; esta tarea no modifica ese flujo.

## Validación

- Suite general final `npm test`: **1235 aprobadas, 0 fallidas, 1 omitida de 1236**. Evidencia: registro local `output/studio-registration-tests-final.log` (no versionado).
- `npm run check:release`: aprobado para la versión actual `2.2.1`. No sustituye preparar y verificar una nueva versión antes de publicar cambios.
- Cobertura focal final: **36/36 aprobadas** con `node --test tests/studio-identity-flows.test.js tests/studio-registration-media.test.js tests/studio-registration-preview.test.js tests/preview-bootstrap.test.js`. Comprueba propiedad derivada de sesión, idempotencia, persistencia local después de logout/recarga/login, ausencia de filas parciales y de red real, y recuperación de archivos con dobles de prueba. Las pruebas automatizadas de uploads no acreditan el bucket remoto ni sus políticas.
- QA manual en **Chromium con ventana visible**, preview local: registro de cinco pasos → edición de identidad desde revisión → éxito → panel; perfil conserva datos tras recargar. Errores de nombre vacío, contraseña distinta, URL `javascript:` y dirección sin seleccionar bloquean el avance. Se comprobó añadir y quitar sedes, cambiar la principal conservando una sola y persistir dos sedes en el panel y después de recargar (comprobación de navegador).
- Fotos: selección de portada, quitar y volver a seleccionar el mismo archivo, mover imágenes antes en galería, recuperación de IndexedDB tras recarga, cuenta creada con imágenes pendientes ante el bloqueo de Storage, reintento y acceso al panel.
- Confirmación de email: el estado UI se ejercitó con un **stub explícito de `auth.register`**, sin envío de correo; persistió después de recargar, mostró aviso cuando el reenvío no estaba disponible y permitió volver a Cuenta para cambiar el email.
- Responsive: sin overflow horizontal a **390, 768 y 1440 px**; menú móvil cierra con Escape y diálogo de Privacidad abre y cierra. Se inspeccionaron las capturas desktop, móvil, tablet y éxito. A 390 px se verificaron también [Identidad](registro-estudios/evidencia/studio-register-mobile-identity.png), [Sedes](registro-estudios/evidencia/studio-register-mobile-locations.png), [Fotos](registro-estudios/evidencia/studio-register-mobile-photos.png), [Revisión](registro-estudios/evidencia/studio-register-mobile-review.png) y [Configuración pendiente](registro-estudios/evidencia/studio-register-mobile-pending.png), sin overflow. No se probó un dispositivo físico.
- La automatización de QA tuvo dos fallos de selectores: una expectativa sobre la barra final de una URL y campos del dashboard sin label asociado. Se corrigieron las comprobaciones y se verificó el estado final; esos fallos no fueron defectos del registro.

En el dashboard, fuera del alcance de esta entrega, se observaron bloqueos existentes: FontAwesome rechazado por CSP y operaciones de travel y soporte no simuladas por el adaptador. El acceso al panel y la persistencia de las sedes se comprobaron sin dar por acreditadas esas áreas.

No se acreditan recepción de emails, Google Maps/Places, importación real de Instagram, subida remota de imágenes ni persistencia sobre Supabase compartido. No se usaron usuarios reales para los ensayos de preview.

## Entrega y reversión

Entrega para publicación automatizada en beta mediante Git y CI. No incluye migraciones. La URL de preview es local; la versión pública se comprueba en https://beta.weotzi.com/api/release.

Composición aislada de entrega: `npm test` aprobó 417/417; `npm run check:release` y sintaxis aprobadas. Navegador Chromium comprobó Inicio → Estudios → cinco pasos → éxito → panel → recarga. La suite de 1236 más abajo corresponde al checkout de trabajo con otras tareas, no a la composición publicada. Se verificó de solo lectura el esquema real: 42 campos de estudio y 28 de sede, documentados en [CAMPOS-ESTUDIOS](../CAMPOS-ESTUDIOS.md). La prueba real de cuenta/email/Storage requiere el correo de prueba indicado por el propietario.

Para descartar esta entrega local, revertir únicamente sus cambios y archivos nuevos después de revisar el diff, preservando los cambios ajenos del checkout. No usar restauraciones generales. Si se integra, el camino normal es `git revert` del commit de esta tarea desde una rama y un nuevo PR. La reversión de código no elimina cuentas, sedes ni imágenes que eventualmente se hubieran creado en un entorno real; esos datos requieren una recuperación específica.

## Selector de Inicio y composición publicada

- Se añadió Estudios junto a Cliente y Artista; la tarjeta conduce a /studio/register/ y el registro ofrece Ya tengo cuenta.
- Inicio se comprobó a 1440, 768 y 390 px, sin overflow y con navegación al registro y al login.
- Se conserva beta como base; no se incluyen cambios ajenos de soporte, artista, servidor o permisos Windows.
- [Inicio desktop](registro-estudios/evidencia/inicio-estudios-desktop.png) y [móvil](registro-estudios/evidencia/inicio-estudios-390.png).
