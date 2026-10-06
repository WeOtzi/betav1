# Acceso de artista · comparación con Figma

Entrega local: `2.2.2-valentina.login-artista.1`, rama `valentina/rediseno-login-artista`.
Fecha: 2026-10-06. Ruta: `/artist/login/`.

Referencia: [Pantallas We Otzi · 24:1261](https://www.figma.com/design/UmVbDewiAHkfLedTR5uyFj/Pantallas--We-Otzi?node-id=24-1261).
Sistema de diseño: [Formulario de inicio · 21:7162](https://www.figma.com/design/jLxPQyG2rxrq5bvfQgNcBd/Design-System-We-Otzi?node-id=21-7162).
Se leyeron contexto, geometría, texto, iconos y captura del nodo exacto y del formulario del DS.

## Cambios

- Póster con título Archivo Black de 72 px, marcas superiores y triángulo rojo inferior; composición dividida y fondo crema.
- Formulario de 422 px, tipografía y dimensiones del nodo; recuperación entre Entrar y el divisor social.
- Instagram, Email y Facebook con los SVG originales exportados sin modificar. Fuentes Archivo Black, Inter y JetBrains Mono locales con sus licencias OFL.
- Instagram/Facebook muestran aviso de indisponibilidad a petición del usuario; el aviso ofrece el login existente con Google. Email enfoca el campo de correo.
- Se conserva la autenticación, lookup de perfiles, destino posterior, recuperación y sesión activa. No se habilitan proveedores nuevos ni se cambian datos o permisos.
- CSS específico de la página; no se altera `artist-auth-ds.css` ni el estilo de otros accesos. Tablet/móvil se adaptan porque la referencia suministrada es desktop.

## Inventario y evidencia

Entorno: `npm run dev:safe`, `http://localhost:4647/preview/preview-local-safe/artist/login/`.
Las capturas muestran el contenido de la pantalla sin la banda de identificación del entorno; esa banda sigue visible en la preview.

| Estado | Visual | Funcional | Evidencia / límite |
| --- | --- | --- | --- |
| Anónimo, desktop 1440 × 1024 | Coincide en composición, texto, fuentes, colores e iconos | Probado | [Desktop](login-artista/desktop.png); comparación con la captura Figma |
| Tablet 768 px | Adaptado; falta referencia específica | Probado | [Tablet](login-artista/tablet.png); sin overflow |
| Móvil 390 × 844 | Adaptado; falta referencia específica | Probado | [Móvil](login-artista/mobile.png); campos y controles accesibles |
| Campos vacíos / email inválido | Validación nativa conservada | Probado | Required/typeMismatch y foco en navegador |
| Instagram / Facebook | Aviso fuera del estado inicial | Probado | Texto del proveedor correcto y alternativa Google visible |
| Email | Estado inicial | Probado | Enfoca email y oculta aviso social |
| Error / éxito de acceso | Mensajes existentes conservados | Simulado | Password corto rechazado por fixture; credencial ficticia válida dirige al dashboard |
| Recuperación | Destino existente conservado | Simulado | Navegación a `/recover/?from=artist&email=…`, correo prefilleado; no se envió email |
| Sesión activa | Vista existente conservada | Simulado | La preview con sesión de artista muestra acciones de dashboard |
| Google / Supabase / entrega de emails | Sin cambios en handlers existentes | No probado con servicios reales | Requiere entorno y cuenta de prueba autorizados |

Verificado en Chromium: los siete SVG locales son no vacíos y cargan en su slot con sus dimensiones originales (20 × 20, estrella 13 × 12, Facebook 17 × 17); las tres familias locales cargan. Sin errores JavaScript; navegación por Tab de email a contraseña y Entrar. Ningún viewport probado tiene scroll horizontal.

Checks: `npm test`: 400 pruebas, 398 aprobadas, 2 omitidas (PowerShell Windows). `npm run check:release` aprobado. `git diff --check` aprobado.

## Límites y entrega

El botón flotante de soporte ya existente no aparece en Figma y se conserva; su servicio no está simulado en esta preview. La comparación de la composición del login excluye ese componente compartido. No se añadieron nuevas acciones de soporte.

Los mensajes sociales y las alturas de botones táctiles son las adaptaciones aceptadas o necesarias respecto del frame desktop. No se afirma identidad píxel a píxel entre el frame y todos los tamaños de pantalla.

Cambios preparados localmente, sin push, PR, merge ni despliegue a `beta.weotzi.com`. No se afirma verificación de la beta pública: el acceso HTTP a ese dominio estaba bloqueado en este entorno.

Rollback: retirar los cambios de esta entrega o revertir su commit cuando exista, en una nueva rama. No hay migraciones ni datos que restaurar.
