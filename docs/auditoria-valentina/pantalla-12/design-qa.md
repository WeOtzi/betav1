# Pantalla 12 — menú de cuenta y notificaciones

## Alcance y estado

Implementación de `801:559` y `801:558` sobre el dashboard publicado en `.22`
(`d8e1fbe65cedc29c8bc39e77ddc9c0eef4e090d9`). Rama permanente
`valentina/rediseno-laura`. QA de los overlays: **passed**, con las diferencias
de fondo y los límites de integración descritos abajo. No se declara que todo
el dashboard, ni otras pantallas, sean idénticos a todas las referencias.

| Referencia | Trigger y ruta | Datos | Visual / funcional | Evidencia |
| --- | --- | --- | --- | --- |
| [801:559](https://www.figma.com/design/w3JA83CcP5ISKjyOu87mx1/We-Otzi-Pantallas-final?node-id=801-559) | `/artist/dashboard/` → Ö | Identidad/resumen del menú | Coincide en composición del overlay; Simulado en preview | [Menú desktop](menu-desktop.png) |
| [801:558](https://www.figma.com/design/w3JA83CcP5ISKjyOu87mx1/We-Otzi-Pantallas-final?node-id=801-558) | Ö → Notificaciones | Nueve filas, cinco inicialmente sin leer | Coincide en composición del overlay; Simulado en preview | [Notificaciones desktop](notificaciones-desktop.png) |
| Adaptación móvil sin frame propio | Mismo recorrido, 390 × 844 | Mismas nueve filas, lista con scroll | Adaptación probada | [Móvil](notificaciones-mobile.png) |

## Implementación y aislamiento

- Se reutiliza `public/shared/js/wo-artist-menu.js`, no se crea un segundo menú.
  Los cambios de copy, geometría y teclado se activan solo si el body tiene
  `.artist-dashboard-page`. El resto de consumidores conserva sus defaults.
- La hoja `artist-dashboard-overlays.css` y el modelo de referencia se cargan
  únicamente desde `public/artist/dashboard/index.html`.
- `ArtistDashboardMenuModel.create` exige dashboard, `WEOTZI_PREVIEW === true`
  y `WeotziPreview.isSimulated === true`. No cambia identidad, repositorios ni
  preferencias compartidas. Los destinos de cuenta y perfil siguen usando la
  identidad autenticada, no el nombre ficticio de Laura.
- Las lecturas de los ejemplos se guardan con la clave local independiente
  `wo_dashboard_figma12_seen_v1`; no se hace upsert remoto ni se llama a
  `Chat.markRead` para esos ejemplos. Las notificaciones reales conservan sus
  consultas, recibos, permisos y refresco existentes.
- El resumen del Figma y su drawer son snapshots distintos: resumen con seis
  notificaciones y badge agregado 13, drawer con cinco no leídas entre nueve
  filas. Se conservan esos valores iniciales; las lecturas posteriores actualizan
  ambos. Leer no elimina invitaciones ni postulaciones.
- En runtime normal, el enlace Postulaciones del dashboard apunta al tab de Spots
  y cuenta las postulaciones del repositorio de Spots ya consultado. No se
  presentan cotizaciones como postulaciones. Los demás menús conservan Solicitudes
  pendientes y sus conteos originales.

## Comparación visual y assets

Fuente leída con contexto y captura de ambos nodos exactos; screenshots fuente
descargadas al temporal aprobado, nunca utilizadas como asset de implementación.
Capturas renderizadas con el navegador integrado, sin fallback. Para tener un
viewport CSS real de 1440 px dentro del panel de la aplicación se usó un iframe
same-origin temporal, eliminado al cerrar QA; no se agregó una página de producto.

| Elemento | Figma | Verificado / corrección |
| --- | --- | --- |
| Menú desktop | 340 × 454,273; x930, y82,73 en canvas1440 | 340 × 454; x929,71, y83 sin scrollbar. Diferencias subpíxel menores de 1 px |
| Panel desktop | 440 × 944; x1000, y84 | Mismas medidas y posición en viewport alto; se limita a la altura disponible en escritorios bajos |
| Tipografía | Inter14/13, Archivo Black22, JetBrains Mono10–11,5 | Familias cargadas, medidas aplicadas; corregidos links azules heredados |
| Fondo no leído | `#f5f8ff`, blanco, scrim `rgba(26,26,26,.45)` | Tokens locales de la referencia; no cambia el DS global |
| Flecha de perfil | SVG18 ×18 | Original descargado, 697 bytes, cargado y renderizado18 ×18; corregida compresión por wrapper16 |
| Punto rojo del menú | SVG4 ×4 | Original descargado, 230 bytes; CSS local en los slots sin leer |
| Azul de estados/progreso | `#0055ff` | Corregido uso de blue300 por blue400 solo en esta pantalla |

Los demás iconos reutilizan Feather del producto. Las dos exportaciones originales
están en `public/shared/assets/figma/artist-dashboard/`; no hay URLs temporales de
Figma en el runtime. Las capturas incluyen foco visible por la prueba de teclado
y los controles flotantes de preview/soporte, que no pertenecen al frame.

### Diferencias de referencia conservadas

Los dos frames adicionales usan una versión anterior del fondo con solo tres
acciones rápidas y recordatorios compactos. Al abrir/cerrar no se reemplaza ni se
reacomoda el fondo `.22`, basado en `24:1425`, que tiene cinco acciones y el botón
Nuevo recordatorio. Esto evita dos layouts contradictorios en una misma pantalla.
La comparación del fondo completo permanece clasificada como **Con desvíos**.
Nuevo recordatorio sigue informando indisponibilidad: estos frames tampoco definen
su formulario ni persistencia, por lo que no se inventó ese flujo.

## Pruebas

- Tres pruebas nuevas primero fallidas y luego aprobadas: triple aislamiento,
  nueve filas/cinco no leídas y snapshots independientes, lectura individual y
  total sin eliminar postulaciones.
- `npm test`: **453/453**. Sintaxis JS y `git diff --check` aprobados.
- Browser: identidad y contenido del dashboard, familias tipográficas, imagen
  original18 ×18 y geometría de ambos overlays verificadas.
- Ö → menú → Notificaciones por Home/Enter; ArrowDown cambia el foco; Shift+Tab
  desde Cerrar envuelve a la última fila y Tab vuelve a Cerrar.
- Escape cierra y devuelve el foco a Ö. Cerrar y clic fuera del menú comprobados.
- Abrir una notificación navega a Inbox dentro del prefijo local seguro. Tras
  volver y recargar quedan cuatro sin leer. Marcar todas deja cero y elimina el
  badge; reabrir y recargar conservan cero. El estado previo de la clave local de
  QA se restauró al terminar.
- Viewports reales de iframe: 1920,1440,1366,1280,1024,768 y390 px, altura1000;
  overlays dentro del viewport, sin overflow horizontal de página ni lista.
  Se reprodujo panel móvil x−15 por `100vw` con scrollbar; corregido a100% y
  repetida la matriz completa. Captura adicional390 ×844.
- Regresión de consumidores en Travel y Cotizaciones: sin nuevo modelo ni CSS,
  identidad ficticia original, Solicitudes pendientes y Recorrido guiado siguen
  presentes; ancho exterior original464 px conservado.
- Consola: sin excepciones nuevas del menú. Persiste el error CSP de worker HEIC
  preexistente; no se debilita CSP ni se acredita conversión HEIC.

La autoentrega repite suite, política de versión y revisión de credenciales antes
de commit/push y exige CI y misma versión/SHA pública. No acredita Supabase,
mensajes, notificaciones ni recibos remotos reales.

## Recuperación

Revertir únicamente el commit de esta entrega mediante una entrega versionada.
No incluye migraciones ni escrituras de datos compartidos. La entrega `.22`
anterior sigue disponible en el historial; el rollback operativo lo hace Isaí.
