# We Ötzi: instrucciones para agentes IA

Estas instrucciones se aplican a este repositorio. Lee `docs/HANDOFF-VALENTINA.md` y `docs/VALENTINA-FIRST-TASK.md` al comenzar una tarea de Valentina. El estado actual de los archivos, Git y el navegador tiene prioridad sobre informes antiguos.

## Producto y arquitectura

We Ötzi conecta clientes, tatuadores y estudios. El runtime principal es Node.js + Express (`server.js`) y páginas HTML/CSS/JavaScript en `public/`. Supabase aporta Auth, PostgreSQL/RLS y Storage. No conviertas este producto a React ni trabajes en `apps/weotzi-prototype/` salvo petición explícita.

## Entorno de Valentina

- Trabaja en `C:\WeOtzi-Dev\weotzi-unified`, con el usuario Windows estándar `Dev`, su GitHub y su propia cuenta de ChatGPT/Codex. El checkout de Isaí en `C:\dev\weotzi-unified` contiene archivos privados y no es la copia compartida.
- Usa `npm run dev:safe` y `http://localhost:4647`. La configuración segura usa datos ficticios. Comprueba que se identifica como entorno de prueba antes de interactuar.
- Crea una rama `valentina/<tarea>` desde `main` actualizado. Valentina publica esa rama y abre un PR a `main`; Isaí revisa la integración.
- El push de `valentina/*` ejecuta `Verify delivery`. El servidor publica la preview cuando comprueba el commit aprobado por CI. Abre el índice de previews y copia la URL de esa rama; no inventes el slug.
- No copies `.env`, credenciales SSH, tokens, sesiones del propietario ni archivos de otros proyectos. El controlador del servidor descarga commits aprobados por CI con permisos administrados por Isaí; GitHub Actions no recibe acceso SSH.
- Las previews usan datos ficticios y servicios externos desactivados. La prueba de persistencia real, correos o integraciones requiere el entorno y las cuentas de prueba que indique Isaí.

## Método de trabajo

1. Lee `git status`, rama, archivos relevantes y documentación antes de editar. Preserva trabajo ajeno; no uses `reset --hard`, `clean -fd` o restauraciones generales para limpiar el checkout.
2. Explica el problema, el alcance y la evidencia necesaria en lenguaje simple. Una tarea debe corresponder a un flujo o corrección revisable.
3. Conserva consultas, permisos, estados y comportamiento existentes al aplicar diseño. No reemplaces datos reales por mocks en el runtime normal.
4. Prueba el cambio en navegador. La inspección de CSS o un HTTP 200 no demuestra que una interacción funcione. Comprueba el resultado visible, validaciones, responsive y persistencia cuando el entorno permita guardar datos.
5. Antes de cada commit de cambios, prepara una versión única con `npm run version:delivery -- <version> "Descripción"`, completa la entrada de `docs/CHANGELOG.md` y revisa package/lockfile. Para una rama calcula el siguiente patch desde la versión actual de `package.json` y añade el sufijo `-valentina.<tarea>.1`; incrementa el último número en el siguiente commit. Cada commit debe explicar problema, cambio, validación y forma de revertirlo y llevar las líneas `Version:` y `Validación:`; no publiques un commit titulado solamente "cambios" o "fix".
6. Antes del push, revisa el diff y los archivos incluidos, ejecuta `npm test` y `npm run check:release` y confirma que no hay secretos ni datos privados. Adjunta evidencia y límites de la prueba al PR.
7. Valentina no mezcla su PR a `main`, no opera SSH ni ejecuta migraciones sobre Supabase compartido. Si el propietario autoriza expresamente una de estas acciones, sigue el procedimiento de despliegue y respaldos vigente.

## Diseño

- Lee el nodo exacto de Figma y el sistema de diseño, no solo una captura general. Las tres fuentes están enlazadas en `docs/VALENTINA-FIRST-TASK.md`.
- Reutiliza `public/shared/css/ds/`, `public/shared/js/ds/`, `wo-icons.js`, encabezados y footer compartidos. No dupliques navegación para cada página.
- Mantén texto literal y estados del Figma. Si una referencia contradice un contrato de datos o deja una acción sin definición, registra la duda concreta; no inventes una función.
- Mantén la composición desktop y adapta tablet/móvil. Revisa carga, vacío, error, éxito, foco, teclado, menús, modales y pasos alternativos.

## Datos y verificaciones

No confundas una preview con una prueba de escritura real; no declares emails recibidos, cobros realizados, integraciones conectadas o funciones completas sin evidencia correspondiente. No uses usuarios reales para ensayos. No envíes correos masivos ni ejecutes seeds remotos sin autorización y alcance definidos. Nunca incluyas contraseñas, tokens, archivos `.env` ni datos personales en un commit, captura o informe.

Las migraciones se agregan como nuevos archivos fechados en `supabase/migrations/`; no se reescribe una migración aplicada. Explica compatibilidad, respaldo y recuperación de datos. Un rollback de código no revierte automáticamente una base de datos.

## Cierre de cada tarea

Indica qué cambió, qué fue probado, dónde está la preview/PR, qué falta y cómo volver a la versión previa. Para una corrección ya integrada, el camino normal es `git revert` en una rama y un nuevo PR. El rollback operativo del servidor lo ejecuta Isaí desde la automatización documentada; conserva la evidencia de la versión desplegada.
