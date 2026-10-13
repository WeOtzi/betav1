# Acceso de artista · copia ampliada 24:1262

Referencia: [Pantallas We Ötzi — copia ampliada, nodo 24:1262](https://www.figma.com/design/WHCgICsA3ipbAE2srVls9A/Pantallas--We-Otzi--copia-?node-id=24-1262). El SVG de 1440 × 1024 fue proporcionado en la tarea; no hubo conector Figma autenticado para leer variantes o metadatos del nodo. Sistema de diseño: `public/shared/css/ds/` y sus fuentes/iconos locales ya utilizados por el acceso.

Entorno: `http://localhost:4647/preview/preview-local-safe/artist/login/`, `npm run dev:safe`; PREVIEW confirmó datos ficticios, sin backend ni emails reales. Base local: `2.2.2` (`65de880`); rama `valentina/artist-login-figma`. La beta pública no fue modificada ni verificada.

| ID | Rol / URL / estado | Nodo auditoría | Nodo rediseño | Visual | Funcional | Evidencia / acción |
| --- | --- | --- | --- | --- | --- | --- |
| V-AL-01 | Artista · `/artist/login/` · anónimo | No leído en esta tarea | Copia ampliada `24:1262` (SVG entregado) | Coincide en el primer encuadre 1440 × 1024; el widget de soporte compartido no figura en el SVG | Probado en preview | Captura local a 1440 × 1024, siete SVG cargados y medidas del póster/formulario comprobadas. Google y acceso cliente quedan después del encuadre, no ocultos detrás de una acción social. |
| V-AL-02 | Instagram / Facebook | No leído | `24:1262` | Coincide en estado inicial | Probado en preview | Cada botón anuncia que el proveedor no está disponible; no inicia OAuth ficticio. Email enfoca el campo existente. |
| V-AL-03 | Recuperación y validación | No leído | `24:1262` para enlace visible | Coincide en el estado inicial | Simulado | Campos vacíos y email inválido activan validación nativa; recuperación navega a `/recover/?from=artist&email=…`. No se envió correo. |
| V-AL-04 | Tablet 768 y móvil 390 | No leído | Falta referencia responsive | Falta referencia | Probado en preview | Sin scroll horizontal; controles accesibles por desplazamiento. Capturas locales no incorporadas al repositorio. |
| V-AL-05 | Google y autenticación real | No leído | No definidos en `24:1262` | Fuera del primer encuadre por acuerdo | No probado | Se conserva el handler existente, sin invocar Google ni Supabase real; requiere cuentas y entorno autorizados. |

Pruebas: `node --test tests/artist-login-extras.test.js` (2/2); navegador Chrome a 1440, 768 y 390 px (sin errores de página, iconos cargados, sin desbordamiento). `npm run check:release` aprobado antes de preparar versión. `npm test`: 401/402 aprobadas; falla preexistente `Job Board Figma feed seed owns a complete guarded rank sequence` en `tests/opportunity-persistence.test.js:70`, porque compara `\n` exacto con el seed que Windows extrajo como CRLF (`core.autocrlf=true`). No se tocaron ese seed ni su prueba fuera de alcance.

Límite: el resultado visual se contrastó con el SVG suministrado, no con una lectura directa de Figma. La preview no acredita autenticación ni entrega de correo reales. Reversión: revertir el commit de esta rama cuando exista; no hay migraciones ni cambios de datos.
