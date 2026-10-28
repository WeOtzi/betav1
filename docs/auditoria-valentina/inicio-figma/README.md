# Inicio · selector de experiencia

Referencia: [Figma 797:269](https://www.figma.com/design/UmVbDewiAHkfLedTR5uyFj/Pantallas--We-Otzi?node-id=797-269).

Se reemplazan las figuras decorativas por los espacios de ilustración visibles en Figma; se reproducen tarjetas, texto, proporciones, selección inicial de artista y botón Continuar. Los radios y sombras son excepciones locales requeridas por este nodo. Las fuentes se reutilizan desde los archivos locales del proyecto; no se modifica el sistema de diseño global.

El selector usa radios nativos y conserva los destinos existentes: cliente `/marketplace`, artista `/artist/login`. No guarda preferencias de cuenta: la ruta original no tenía persistencia y esta tarea no introduce cambios de datos.

## Validación

- Chromium con `npm run dev:safe`, sesión ficticia y servicios externos desactivados. Las capturas incluyen la banda amarilla de identificación del entorno seguro (39 px en desktop); esta banda no forma parte del diseño de producción.
- Sin overflow horizontal en 1024, 1280, 1440, 1920 y 2560 px; comprobación adicional a 768 y 390 px.
- A 1440 px, tarjeta cliente: x=160, ancho=514, alto=670; artista: x=738, ancho=504, alto=673, elevada 3 px. Las posiciones verticales descontando la banda son 319,97 y 316,97 px.
- Selección por clic en cliente y por teclado en artista; el botón cambia a los destinos existentes. Ningún error JavaScript durante la prueba.
- Todos los iconos visibles cargan desde SVG locales; las tres fuentes cargan desde TTF locales.
- `npm test`: 398 aprobadas, 2 omitidas (Windows), 0 fallos. `npm run check:release` aprobado; `git diff --check` sin errores.

## Límite de fidelidad pendiente

El contexto y la captura de Figma se obtuvieron correctamente, pero la descarga de sus recursos SVG mediante las URLs proporcionadas devuelve HTTP 403 (CONNECT del proxy). Se reutilizaron los mismos iconos Feather 4.29.2 del sistema existente, descargados localmente para no depender de su CDN en el navegador. El marcador de imagen de los espacios vacíos y los colores de algunas flechas requieren cotejo final con los SVG originales antes de afirmar igualdad exacta. No se inventaron ilustraciones ausentes en la referencia. No hay URLs temporales de Figma en el runtime.

No se han probado persistencia, autenticación remota ni publicación de beta. La integración a `main` y la publicación principal corresponden a Isaí según AGENTS.md. Rollback: revertir el commit de esta entrega en una rama nueva; no hay migraciones ni cambios de datos.
