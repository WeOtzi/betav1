# Área acceso · Figma final del flujo de artista (oct 2026)

Inicio, login, crear cuenta, registro 01–08, recuperar acceso, loader post-auth y correos de recuperación. Las capturas finales están en `output/figma-final-artista/shots/acceso/<nodo>.png`. Las de 801:1091, 801:1094, 801:1095 y 801:1097 se rehicieron en la ronda 2. El detalle por frame está en `acceso.json`.

## Ronda 2 · correcciones de la auditoría

**Corregido (P1)**
- **07 Revisá y confirmá (801:1097)**: las filas usan columnas de 140 + 581 + 39px sin gap. El valor arranca en x+140, como en el frame; antes había un gap de 16px y arrancaba en x+156. A 390px las filas vuelven a apilarse, con la etiqueta arriba y el valor y EDITAR abajo. La regla de la ronda 1 forzaba los 140px también en mobile.
- **05 Independiente (801:1094)**:
  - Las tarjetas de modalidad miden 84.2px (antes 99px). Tienen borde de 1px ink, sin relleno, kicker mono de 10px y valor de 24px.
  - La tarjeta elegida va en ink sin sombra. La sombra dura de 3px quedó para el hover.
  - TU DIRECCIÓN tiene borde de 1px, sombra de 3px 3px y 8px entre la etiqueta y el campo. Antes, el picker compartido le ponía en reposo un borde de 2px y una sombra de 4px 4px, y la etiqueta tocaba el campo.
  - Se midió en el navegador: 20px entre el título y las tarjetas, 20px entre las tarjetas y la etiqueta, 8px entre la etiqueta y el campo y 22px entre el campo y CONTINUAR.
- **05 Buscar estudio (801:1095)**:
  - CONTINUAR deshabilitado mide 162×46. El frame marca 160.65×46. Tiene padding de 15/22, texto de 13px y flecha de 16px separada 12px. El aviso queda a 20px del botón.
  - La lista va sobre arena (`--surface-input`) y no sobre blanco.
  - El input tiene borde ink de 1px y sombra de 3px 3px, también mientras se escribe. Entre la etiqueta y el input hay 10px.
- **04 Subir manualmente (801:1091)**: los mensajes de validación ahora nombran los mismos formatos que la card ("Usá JPG, PNG o WebP"). Antes decían "JPG o PNG".

**No corregido**
- **"JPG, PNG o PDF" en 801:1091**: el reemplazo de PDF por WebP no es una corrección ortográfica. Por eso salió de `copy_fixes` y quedó en `missing_functions` como desvío pendiente de aprobación de diseño. La galería pública solo publica imágenes, y volver al copy del Figma prometería un formato que después se rechaza. Hay dos opciones:
  - Diseño aprueba "JPG, PNG o WebP" y actualiza el frame.
  - Se agrega soporte de PDF: rasterizar las páginas antes de subirlas o publicar el PDF como documento del perfil.

**A tener en cuenta**
- 801:1094 y 801:1095 dibujan distinto las tarjetas de modalidad:

  | | 801:1094 | 801:1095 |
  | --- | --- | --- |
  | Alto | 84.2px | 87.2px |
  | Kicker | 10px ink | 11px gris |
  | Tarjeta elegida | Sin sombra | Sombra de 3px y desplazada -2px |

  Para el reposo se usó 801:1094 y la sombra de 801:1095 quedó para el hover. Conviene que diseño unifique el componente.
- Los campos "duros" del paso 05 mantienen el borde de 1px al recibir el foco. El foco se nota por la sombra de 3px (con el campo vacío) y por el fondo blanco del DS.
- No hay token para una sombra de 3px. Se usa `3px 3px 0 var(--neutral-500)`.

## Ronda 1 · correcciones de la auditoría

**Corregido (P1)**
- **Registro 08 a 390px**: el CTA "IR A TU PANEL" ya no desborda. Tiene `box-sizing` y `max-width`, y `scrollWidth` da 390.
- **Gate del grupo 05**: CONTINUAR queda deshabilitado mientras el estudio no esté resuelto, igual que en el frame. Hay que elegirlo de la lista o tocar "Crear «x»" y elegir una dirección. `isGroupReady`, `validateStep(9)` y el aviso usan la misma regla. Si el artista elige un estudio y después vuelve a escribir, se descarta la dirección que venía de esa sede. Se probó en el preview: con "c" y con "ca" el botón queda deshabilitado; al elegir un estudio se habilita; con "Crear" y sin dirección vuelve a quedar deshabilitado.
- **Instagram en el login**: el botón "Recomendado" ahora abre el inicio rápido de registro con Instagram (`/register-artist/?source=instagram`), el mismo que en Crear cuenta. Se verificó la navegación.
- **Links legales**: el registro usaba `/terminos` y `/privacidad`; ahora usa `/legal/terms` y `/legal/privacy`, igual que Crear cuenta, los correos y el footer del cliente. Abren en otra pestaña. **Esas páginas siguen sin existir** (ver Pendiente).

**Corregido (P2)**
- **Placeholders** en el gris del Figma, en el login, Crear cuenta, el registro y Recuperar. La regla del DS `.wo-app input::placeholder` les ganaba a las de cada página. No hay token gris, así que se usa `color-mix(--neutral-400 75%, --neutral-300)`.
- **Medidas del registro**: inputs de 47px y labels mono de 12px. El subtítulo mide 16/24 y 525px, y corta después de "Podés". En el paso 03, el subtítulo queda pegado al título y hay 80px entre la tarifa y CONTINUAR. Las filas de la revisión miden 12/12.8 con una etiqueta de 140px. La pantalla de perfil creado lleva figuras de 18px, título de 36px y CTA de 44px. Entre los campos y CONTINUAR hay 22px.
- **Flechas**: el carácter "→" se reemplazó por el ícono Feather `arrow-right` en todos los CONTINUAR y en IR A TU PANEL.
- **Topbar del registro**: la marca arranca a 32px, las figuras miden 14px y están separadas 10px. La navegación usa mono de 10px con tracking 0.05em y el check pegado al texto. La navegación arranca en x≈218; el Figma varía entre 214 y 243 según el frame.
- **Paso 05 Independiente**: se sacó el texto de ayuda visible (queda solo para lectores de pantalla). El valor del campo va en Inter. Al reanudar un perfil, TU DIRECCIÓN muestra la ubicación guardada.
- **Paso 05 Buscar estudio**: muestra hasta 5 estudios y "Crear «x»" siempre al pie, sin scroll interno. El input mide 560×52. CONTINUAR deshabilitado va en arena al 70% y el aviso en mono de 10px.
- **Portfolio**: el texto pasó a "JPG, PNG o WebP" y el input ya no acepta PDF.
- **Póster de Crear cuenta entre 1024 y 1279px**: el eyebrow baja debajo de las marcas y el manifiesto se angosta. Se midió sin superposiciones a 1024, 1100, 1180, 1279 y 1440px.
- **Facebook**: logo relleno del Figma (`public/artist/login/assets/facebook.svg`) en el login y en Crear cuenta.
- **Crear cuenta**:
  - Con sesión activa, la página redirige a `/artist/login`, que muestra "Ya iniciaste sesión" (2001:3334). Reemplaza al aviso azul.
  - La validación es propia (`novalidate`) y los mensajes salen en `#form-message`.
  - REGISTRARME ya no tiene colores inline ni el estado "ERROR": cambia el texto en `.btn-text` y la flecha se conserva.
- **Importador de Instagram**: mientras está abierto, la topbar del registro queda bajo el velo.
- **Recuperar**: el email de destino va en peso regular. `redirectTo` usa `appPath`, así que respeta `/beta`.
- **Correos**: el círculo amarillo de la marca tiene el mismo tamaño que el cuadrado. En el correo de recuperación hay 100px antes de la caja del código.

**No corregido**
- **Páginas legales** (`/legal/terms` y `/legal/privacy`): no existen en el repo ni en el sitio corporativo. Hace falta el texto legal y crear las páginas o las redirecciones. Queda fuera de los archivos del área y no se redactó texto legal.
- **Correo "Contraseña actualizada"**: falta elegir el canal. Se recomienda la opción A, que no requiere código: activar en Supabase la notificación de seguridad "Password changed" con `supabase-password-changed.html`. La opción B, por n8n, requiere tocar `services/email-event-mapping.js` y validar el destinatario en el servidor; si no, se podría mandar el aviso a cualquier dirección.
- **Botón ojo** en las contraseñas: se mantiene por accesibilidad. Falta que diseño decida si lo agrega al frame.
- **Bienvenida**: las dos ilustraciones son assets faltantes. Falta que diseño confirme el ícono de "Solicitar cotizaciones".

## Qué quedó hecho (acumulado)

- **/bienvenida (797:269)**: cards del Figma con estado elegido. `?role=artist|client` preselecciona la opción.
- **/artist/login (801:585 + 2001:3334)**: póster, formulario, redes y la vista "Ya iniciaste sesión".
- **Loader post-auth**: v1, v2 y v3 (801:1099, 2001:3335 y 2001:4308).
- **/registerclosedbeta (801:536)**.
- **/register-artist (801:1086–1098 + 2001:3897)**: panel "Todos los estilos", Behance, Portfolio con Instagram o archivos, "Tus trabajos" y temas de novedades persistidos.
- **/recover (801:1104–1107)**.
- **Correos**: `supabase-recovery.html`, `password-updated.html` y `supabase-password-changed.html`.

## Backend

Migración `supabase/migrations/20261028100000_acceso_registro_extras.sql` con su rollback. **No está aplicada.** Agrega `artists_db.profile_links` y `newsletter_topics`. Si las columnas no existen, el repo `WeotziData.Registration` degrada sin romper la página.

## Pasos manuales

1. Supabase → Emails → Reset Password: cargar `supabase-recovery.html`. Opcional: OTP Expiration de 600 s.
2. Supabase → Security notifications → Password changed: cargar `supabase-password-changed.html`.
3. Habilitar Facebook y Email OTP en Supabase, y agregar `/artist/login` y `/recover?recovery=1` (con y sin `/beta`) a Redirect URLs.
4. Aplicar la migración del registro.
5. Crear las páginas legales.

## Parámetros de QA (solo preview/demo)

- `/artist/login?state=login`
- `?postauth=v1|v2|v3`
- `/registerclosedbeta?state=signup`: sin el parámetro, con la sesión ficticia la página redirige al login.
- `/register-artist?step=1..8&state=nuevo|estilos|instagram|cargado|estudio|todas|aceptado`
- `/recover?step=1..4&email=…`

## Tests

Ronda 2, `node --test "tests/*.test.js"`: 608 tests. Pasan 604, fallan 3 y 1 se saltea.
- Las 3 fallas son las preexistentes de PowerShell 7.

`tests/figma-final-acceso.test.js` pasa 22/22. Suma 2 tests de la ronda 2: los mensajes del portfolio coinciden con la card y las medidas de los pasos 05 y 07. `artist-registration-responsive.test.js` pasa 13/13, incluido el test "solo tokens del DS".
