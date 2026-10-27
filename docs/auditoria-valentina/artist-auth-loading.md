# Carga al entrar y recuperar acceso de artista

Rama `valentina/artist-auth-loading` · versión `2.2.3-valentina.artist-auth-loading.1` · 2026-10-19.

Referencia inmediata: dos capturas compartidas en la conversación, una con el comentario de la diseñadora en acceso/recuperación y otra con el estado de carga «ORGANIZANDO TU AGENDA…». Contexto del flujo: [login de artistas 24:1261](https://www.figma.com/design/UmVbDewiAHkfLedTR5uyFj/Pantallas--We-Otzi?node-id=24-1261) y [recuperación 243:2530](https://www.figma.com/design/UmVbDewiAHkfLedTR5uyFj/Pantallas--We-Otzi?node-id=243-2530). El ID exacto del frame de carga de las capturas no se verificó en Figma; medidas inferidas de la imagen, no lectura de nodo.

Entorno: `http://localhost:4651/preview/preview-local-safe/` porque 4647 ya estaba ocupado por otro proceso seguro. La banda PREVIEW confirmó datos ficticios y servicios externos desactivados. Las capturas de composición a 1440, 768 y 390 px se hicieron en Chromium; la banda PREVIEW se ocultó **solo durante la captura** para mostrar el diseño a pantalla completa y sigue presente en la preview interactiva. Los PNG permanecen fuera del repositorio, en `C:\Users\Dev\AppData\Local\Temp\opencode\artist-auth-loading-{1440,768,390}.png`.

| ID | Rol / URL / estado | Nodo auditoría | Nodo rediseño | Visual | Funcional | Evidencia / acción |
| --- | --- | --- | --- | --- | --- | --- |
| VA-L01 | Artista · `/artist/login/` · acceso válido | Captura aportada; ID exacto sin verificar | Captura aportada; ID exacto sin verificar | Coincide con la composición de la captura | Simulado | Login con cuenta ficticia muestra overlay y navega al dashboard; screenshot 1440 px y pruebas unitarias. |
| VA-L02 | Artista · `/recover/?from=artist` · salida de éxito hacia panel artista | Captura aportada; ID exacto sin verificar | Captura aportada; ID exacto sin verificar | Coincide con la composición de la captura | Simulado | El enlace de retorno del email conserva `from=artist`; prueba del selector de origen/rol y pantalla. No se simuló el email/OTP completo. |
| VA-L03 | Cliente · recuperación, o destino cliente desde acceso de artista | No aplica | No aplica | Sin rediseño | Probado en test | Continúa usando `WoPostAuthLoader` o su destino existente. |
| VA-L04 | Artista · error de contraseña | No aplica | No aplica | Sin rediseño | Probado en test | Permanece el mensaje de error y el botón se reactiva; no aparece overlay. |

El nuevo módulo y CSS son exclusivos de estas rutas; `wo-postauth-loader.js` no cambió. Responsive comprobado en 1440, 768 y 390 px; `prefers-reduced-motion` deja el aro estático. La recuperación con envío real, persistencia y permisos Supabase requieren un entorno y cuentas de prueba autorizados.

`node --test tests/artist-auth-loading.test.js`: 7/7. `npm test`: 406/407; el único fallo es `Job Board Figma feed seed owns a complete guarded rank sequence` en `tests/opportunity-persistence.test.js`, que busca `with seed(\n` pero el archivo `supabase/seeds/20260829_opportunities_figma_demo.sql` tiene CRLF en este checkout. No se alteró ese seed ni su test. La publicación y la preview remota se verifican por separado después del push.
