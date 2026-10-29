# Pantalla 3 · acceso de clientes · 801:1124

Versión: `2.2.3-valentina.rediseno-laura.8`. Rama: `valentina/rediseno-laura`.

Referencia: [frame final 801:1124](https://www.figma.com/design/w3JA83CcP5ISKjyOu87mx1/We-Otzi-Pantallas-final?node-id=801-1124).
Leídos con Figma MCP el contexto detallado y su captura; consultado también el sistema de diseño.

| Ruta / estado | Visual | Funcional | Evidencia |
| --- | --- | --- | --- |
| `/client/login/` anónimo | Coincide con referencia desktop; adaptación móvil | Probado | Panel 728 px, formulario x=875 / y=226 y ancho 422 a 1440×1024; captura comparada con Figma |
| Instagram / Facebook | Botones y recomendado según Figma | Probado: aviso; autenticación no disponible | Aviso identifica proveedor, no inicia OAuth; Google anterior solo aparece dentro del aviso |
| Email | Botón según frame | Probado | Cierra aviso y enfoca login-email |
| Formulario inválido | Estado adicional sin referencia | Probado | Requerido y formato email; error simulado restaura botón |
| Login válido | Estado adicional sin referencia | Simulado | Datos ficticios producen mensaje de éxito y navegación a client/dashboard |
| 768 / 390 px | Adaptación, sin frame móvil proporcionado | Probado | Capturas en Browser; botones de 44 px y sin overflow |

## Cambios y aislamiento

- Solo HTML de acceso cliente y CSS/JS cargados exclusivamente por esa página. Registro, artista, shared auth, consultas y permisos no se modifican.
- Título centrado, marcas arriba, triángulo rojo abajo; reemplazado el cuadrado amarillo.
- Copy literal, campos y botón, divisor, recomendado, Instagram/Email/Facebook y único enlace inferior de registro del frame.
- Los siete SVG descargados desde las URLs del contexto Figma dieron SHA256 idéntico a los de `public/shared/assets/figma/artist-login/`; se reutilizan sin alterar dimensiones intrínsecas. Mail/lock/arrow/Instagram/email ≈19.989 px, Facebook ≈16.658 px; estrella con el sangrado de su SVG original. Todas las imágenes cargadas y en su lugar.
- Fuentes locales Archivo Black, Inter y JetBrains Mono existentes; tokens del DS. Valores dimensionales específicos del frame aislados en client-login-figma.css.

## Verificación

- `node --test tests/client-login-social.test.js`: 3 fallos iniciales por acciones aún no implementadas, luego 3 aprobadas.
- `npm test`: 422/422 aprobadas. `check:release` se ejecuta nuevamente en la entrega automática.
- Browser MCP disponible: navegación, evaluación DOM, capturas y consola; sin fallback Playwright. Para tamaños exactos, página real dentro de iframe same-origin de QA (no se guarda en el producto).
- Anchos 390, 768, 800, 801, 1024, 1100, 1280 y 1440: scrollWidth igual al viewport y botones sin texto recortado. Último ajuste de desktop fija panel 728 px y origen x=875 del formulario.
- Capturas locales temporales, no privadas: desktop `C:/Users/Dev/AppData/Local/Temp/opencode-browser-CgaC0e/0/screenshot.png`; tablet `C:/Users/Dev/AppData/Local/Temp/opencode-browser-HeOUqX/0/screenshot.png`; móvil `C:/Users/Dev/AppData/Local/Temp/opencode-browser-im2ILP/0/screenshot.png`.
- Identidad/título, contenido visible, imágenes, avisos, foco, validaciones, error/éxito simulado y destino del registro comprobados.
- Consola: error esperado de prueba de login inválido; warnings preexistentes de soporte 501 y configuración Supabase vacía en preview. Sin errores nuevos del JS de presentación. Widget de soporte preexistente conservado, aunque no está dibujado en el frame.

## Límites y publicación

Local: `http://localhost:4647/preview/preview-local-safe/client/login/`, datos ficticios y servicios reales desactivados. No prueba OAuth, contraseña real, correos ni persistencia Supabase. Instagram/Facebook no se presentan como integraciones operativas.

Destino: https://preview.weotzi.chat/client/login/ . La entrega automática comprueba CI y la versión/SHA en `/api/release`; el resultado y enlace CI quedan en la entrega de OpenCode, no se infieren de un HTTP 200.

Rollback: revertir el commit de esta versión mediante una entrega versionada. Sin migraciones ni cambios de datos. No mezclar a main; Isaí revisa el PR.
