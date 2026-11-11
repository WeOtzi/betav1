# Design QA — Pantalla 6

**Resultado: passed para la vista y las interacciones locales; integraciones remotas blocked.**

## Referencia e implementación

- [Figma 801:1129](https://www.figma.com/design/w3JA83CcP5ISKjyOu87mx1/We-Otzi-Pantallas-final?node-id=801-1129), leído por `get_design_context` con captura y por `get_screenshot` a tamaño natural.
- [Captura fuente, 1440×1619](figma-801-1129.png).
- [Implementación desktop, 1440×1619](local-1440.png).
- [Adaptación, 390×1000](local-390.png).
- HTML: `public/job-board/request/index.html`.
- CSS aislado: `public/shared/css/job-board-inspiration-figma.css`.
- Controlador: `public/shared/js/job-board-request.js`.
- Recursos: `public/shared/assets/job-board-inspiration/` y fuentes existentes en `public/shared/fonts/artist-login/`.
- Versión: `2.2.3-valentina.rediseno-laura.14`.

## Matriz de estados

| Referencia / estado | Disparador | Datos | Evidencia / resultado |
| --- | --- | --- | --- |
| 801:1129 inicial | Abrir /job-board/request/ sin borrador | Galería sin imágenes | Quince espacios, todos los filtros y composición de Figma |
| Filtro | Elegir Blackwork | Espacios locales | Cinco resultados y aria-pressed actualizado |
| Vacío | Buscar «sin coincidencias» | Sin datos coincidentes | Mensaje Sin referencias para mostrar; Todos restaura los quince |
| Validación | Inspirarme con AI, sin texto | Prompt vacío | Aviso Contanos primero qué te gustaría tatuarte |
| Error | Inspirarme con AI, con texto | API deshabilitada en preview | Error visible, botón habilitado para reintentar; no se simula éxito |
| Carga | browse files | PNG sintético local | Selector real, archivo validado, aviso de referencia cargada |
| Continuar | Crear mi idea | Un PNG cargado | Formulario existente, un archivo retenido y navegación de cliente restaurada |
| Móvil | Menú / cerrar / Escape | Sin servicios externos | Menú compartido abre y cierra; Escape cubierto por regresión |
| Galería real | Fuente con una imagen pública | Fixture unitario, sin Supabase real | Renderiza URL original y conserva selección, sin sustituir por placeholders |

## Comparación y correcciones

1. Antes: márgenes de 112 px, título de 56 px, menú de cliente, panel de tamaño/fondo distintos, chips ausentes y galería vacía.
2. Causa de chips ausentes: `renderInspiration` consultaba IDs de nodos que todavía no se habían adjuntado al documento. Prueba primero fallida y luego aprobada al mover el render después del montaje.
3. Después: encabezado compartido, título de 44 px, panel arena, input y filtros, composición en cuatro columnas con alturas y separaciones del frame. SVG descargados sin redibujar y fuentes locales reutilizadas mediante alias exclusivos de esta vista.
4. Browser pudo leer la página pero rechazó la captura: «Screenshot needs a visible tab», incluso después de focus. Validación visual alternativa con Playwright del caché existente y Microsoft Edge instalado, sin instalar dependencias ni navegadores.
5. Prueba responsive detectó que el organismo deja el menú móvil a cargo del controlador. Se añadió el mismo cableado local usado en Mis postulaciones, con test primero fallido.
6. Comparación de PNG de 1440×1619: 95,85% de píxeles idénticos; 96,92% con diferencia máxima por canal ≤24. Se excluye únicamente el ojo de control de preview en la esquina inferior izquierda. No se declara igualdad de píxeles al 100%; la rasterización de fuentes y pequeños bordes difieren entre Figma y Edge. La captura de Figma recorta el lienzo a 1619 px; la web permite seguir desplazándose para acceder al contenido restante.

## Geometría desktop verificada

| Elemento | x | y | ancho | alto |
| --- | ---: | ---: | ---: | ---: |
| Header | 0 | 0 | 1440 | 75,83 |
| Título / bajada | 36 | 130,98 | 1360,81 | 77,59 |
| Panel AI | 36 | 230,97 | 1360,81 | 290,59 |
| Búsqueda | 36 | 563,36 | 460 | 47,19 |
| Filtros | 34 | 645,73 | 1359,02 | 36 |
| Galería | 36 | 743,92 | 1360,81 | Flujo desplazable |

## Verificación y límites

- Navegador a 1440, 1920, 1366, 1280, 1024, 768 y 390 px: contenido significativo, identidad de página correcta, sin overlay de error, sin overflow horizontal ni excepciones JavaScript.
- Cuatro SVG visibles originales con archivo local no vacío, naturalWidth >0 y dimensiones de diseño: lupa 18×18, flecha AI 18×18, volver 14×14 e imagen 28×29,1. Call sites e implementación visibles comprobados en los siete anchos.
- Fuentes Archivo Black, Inter y JetBrains Mono locales. No se editan los tokens ni los archivos compartidos del encabezado.
- `node --test tests/job-board-inspiration.test.js`: 5/5; montaje, filtro/búsqueda, conservación de galería real, menú móvil y restauración del alcance visual.
- `npm test`: 432/432. La entrega automática repite pruebas y `check:release`, incluye archivos explícitos y espera CI + SHA pública.
- Límites conocidos de la preview: Supabase/config no disponible en esta ruta, fallo de galería remota controlado, soporte 501, worker de HEIC bloqueado por CSP y generación de IA no simulada. No se afirma consola libre de avisos ni conexión real con esos servicios.
- La prueba de PNG valida carga local y transferencia entre pasos, no escritura a Storage ni publicación remota. No se envían correos, no se crean registros reales y no se prueban pagos ni OAuth.
- No se rediseñan el formulario, la revisión, el acceso ni otras pantallas. Al entrar al formulario se comprueba que desaparece la clase de esta capa y vuelve el encabezado original.

## Publicación y recuperación

Preview: https://preview.weotzi.chat/job-board/request/.
PR permanente: https://github.com/WeOtzi/betav1/pull/12.
La herramienta de entrega y el comentario del PR registran la SHA exacta y el CI de esta versión, comprobados contra `/api/release`.
Revertir esta entrega con una versión nueva; estado previo `4ff0b311c689529cde88ea46017e29c243081354`. Sin cambios de datos.
