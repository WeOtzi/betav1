# Pantalla 10 — Vincular un estudio

## Referencia y alcance

- [Frame final 801:1081](https://www.figma.com/design/w3JA83CcP5ISKjyOu87mx1/We-Otzi-Pantallas-final?node-id=801-1081), modal `173:27451`. Leídos contexto de diseño, captura y geometría del nodo.
- Ruta pública: <https://preview.weotzi.chat/artist/travel/>.
- Recorrido: modo artista → Travel → en **Cronología de viajes**, abrir **Barcelona · Guest Spot** → **Vincular un estudio** en las acciones del viaje. Si no hay sesión de prueba, abrir el ojo flotante y elegir **Artista de prueba**, luego volver a Travel. El modal es un estado de esta ruta, no otra URL.
- Rama: `valentina/rediseno-laura`. Versión final: `2.2.3-valentina.rediseno-laura.19` (ajuste final sobre `.18`).
- Solo cambia `#tv-modal-link`: composición, tipografía, borde, fondo, campos, espaciados, estado vacío, botones e íconos. No cambia JavaScript, permisos, consultas, datos, otras pantallas ni otros modales.

| ID | Rol / URL / estado | Nodo auditoría | Nodo rediseño | Visual | Funcional | Evidencia | Acción |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P10-01 | Artista · `/artist/travel/` · vincular estudio, inicio | No aportado para esta tarea | `801:1081` / `173:27451` | Coincide (modal) | Simulado | Captura desktop, medidas y pruebas de navegador | Corregido |
| P10-02 | Mismo modal · búsqueda, filtros y selección | No aportado | Sin estado adicional solicitado | Coincide con la composición existente | Simulado | Resultados, sin coincidencias y habilitación del botón comprobados | Comportamiento conservado |

## Diferencias corregidas

| Referencia | Antes | Después |
| --- | --- | --- |
| Título vacío Inter 700, 15/22,5 px | Archivo Black, 24 px | Inter y medidas literales |
| Texto explicativo 13,5/20,25 px, ancho máximo 360 px | 16 px en una sola línea | Dos líneas a tamaño de referencia |
| Separación de filtros 10 px; búsqueda → filtros 20 px | 16 y 14 px | 10 y 20 px |
| Búsqueda con ícono y texto separados | La cascada anulaba el padding y superponía texto e ícono | Padding efectivo de 43,6 px e ícono exportado de 18×18 |
| Fondo blanco, borde fino, sin sombra ni desplazamiento vertical | Blanco DS #FCFCFC, borde 2 px, sombra 8 px, translateY(-45px) | Blanco #FFFFFF y geometría del frame |
| Controles e íconos del frame | Chevron y lupa heredados con distinto tamaño/color | Cerrar 20×20, lupa y chevron 18×18 originales, descargados y locales |

Colores y fuentes reutilizan tokens existentes; `#757575` del placeholder es la excepción local medida del frame. La lupa grande del estado vacío reutiliza el mismo ícono Feather `search` del sistema a 26×26. Los SVG exportados conservan su tamaño raíz. No hay URLs temporales de Figma en el runtime.

## Verificación

- Chrome instalado, automatizado con Playwright disponible en la caché del entorno, sin instalar dependencias. Browser integrado permitió inspección inicial pero `click` falló con `UnknownVizError` y no ofrece resize; se usó Chrome headless para interacciones, capturas y tamaños explícitos.
- Preview local segura del checkout en `http://localhost:51366/preview/preview-local-safe/artist/travel/`. Los puertos 4647 y 4648 estaban ocupados; no se cerraron procesos ajenos. Se comprobó la identificación **Datos ficticios / Sin emails ni backend real**.
- Aserción visual primero fallida: separación efectiva de filtros 16 px en lugar de 10 px. Después del cambio, pasó.
- Tamaños: **1444×1495, 1440×900, 1280×720, 1024×768, 1920×1080, 2560×1440, 1366×600, 768×1024 y 390×844**. Sin desborde horizontal del modal, controles dentro del panel, botones alcanzables en alturas bajas. A 1444 px: ancho 1203 px y alto 503,1 px, con tolerancia de redondeo subpíxel de 1 px.
- Búsqueda «Zorro» → resultado Zorro Rojo Tattoo; filtro ciudad Barcelona → resultados; selección → habilita Solicitar vinculación; búsqueda sin coincidencias → Sin resultados y envío deshabilitado.
- Cancelar, Cerrar y Escape ocultan el modal; foco inicial en búsqueda, regreso a la acción original y ciclo de teclado dentro del diálogo comprobados.
- SVG de búsqueda/cierre cargados, no vacíos y con dimensiones naturales y renderizadas coincidentes; selector usa el SVG local de chevron a 18×18.
- Sin excepciones JavaScript durante el recorrido. `npm test`: **441/441**. `check:release` y repetición de la suite mediante entrega automática.
- Prueba de aislamiento con intercepción temporal de CSS de `HEAD` frente al CSS nuevo: geometría, tipografía, colores y sombras idénticos para detalle de viaje y modales de fechas, compartir y editar.
- Revisión final: el borde de Cancelar heredaba #24211D; aserción primero fallida y luego aprobada al usar el negro literal #000000 del frame. No afecta otros botones ni otros modales.
- Capturas comparables sin datos personales: [desktop](desktop.png), [móvil](mobile.png). Evidencia ampliada y scripts temporales de QA en el directorio temporal aprobado de OpenCode, fuera del runtime.

## Límites y diferencias fuera de alcance

- El diseño del **modal** coincide; los datos de fondo son dinámicos. No se sustituyen fechas, duración, estados, checklist ni documentos por los ejemplos del frame. El aviso Vinculación pendiente solo corresponde a viajes con esa condición; la fixture de Barcelona está confirmada.
- La navegación compartida conserva Modo cliente, contadores y Travel activo, aunque el frame muestra otra selección. A 1280 px se observa un recorte previo del extremo derecho del header; no se cambia una pieza compartida en una tarea exclusiva de modal.
- La prueba de búsqueda/selección es simulada. No se envió una solicitud a un estudio real, no se verificó aceptación del estudio ni persistencia Supabase, notificaciones o correos reales.
- Consola de la preview pública: advertencia esperada de Supabase sin configurar (entorno seguro) y 404 preexistente de `/favicon.ico`; sin excepciones JavaScript ni assets faltantes del modal.
- No se acredita funcionamiento en todos los navegadores posibles ni identidad píxel a píxel de los datos dinámicos del fondo.

## Publicación y reversión

La entrega automática debe aprobar CI del evento push y comprobar la misma SHA/versión en `/api/release`. El cierre de la tarea informa la SHA y ejecución verificadas, sin confundir esta evidencia local con publicación remota.

Reversión: revertir únicamente el commit de esta entrega mediante una nueva entrega versionada; no requiere migraciones ni modifica datos. No revertir la Pantalla 9.
