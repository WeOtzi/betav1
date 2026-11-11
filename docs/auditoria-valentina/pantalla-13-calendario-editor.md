# Pantalla 13 · Agregar al calendario (cuatro estados)

## Alcance y decisiones de Valentina

Continuación de Calendario, no una pantalla 14. Referencias del archivo `w3JA83CcP5ISKjyOu87mx1`:

| Frame | Estado | Visual / funcional |
| --- | --- | --- |
| [801:546](https://www.figma.com/design/w3JA83CcP5ISKjyOu87mx1/We-Otzi-Pantallas-final?node-id=801-546) | Elegir tipo | Ajustado al frame; selección, mini calendario, vacío y botón deshabilitado probados |
| [801:547](https://www.figma.com/design/w3JA83CcP5ISKjyOu87mx1/We-Otzi-Pantallas-final?node-id=801-547) | Turno con cliente | Diseño/selector de cotizaciones implementados; **vinculación no disponible, con aviso y bloqueo de escritura acordados** |
| [801:548](https://www.figma.com/design/w3JA83CcP5ISKjyOu87mx1/We-Otzi-Pantallas-final?node-id=801-548) | Reserva pendiente | Formulario, checkbox y resumen dinámicos conservados; presentación ajustada |
| [801:549](https://www.figma.com/design/w3JA83CcP5ISKjyOu87mx1/We-Otzi-Pantallas-final?node-id=801-549) | Disponibilidad | Formulario, recurrencia y resumen dinámicos conservados; guardado manual probado en simulación |

Los cuatro frames se leyeron con `get_design_context` y capturas, además del selector `2005:4395` y medidas de sus componentes. Valentina rechazó agregar Code Connect y eligió explícitamente **«Diseño y límite visible»** para la vinculación de cotizaciones. No se amplían contratos de guardado ni se simula una relación inexistente.

Solo `/calendar/`. Conserva Mes/Semana/Día ya publicados en `.25`, Agenda, edición de eventos y los cinco tipos adicionales sin rediseñar sus formularios. Los otros frames pendientes no se implementan por inferencia.

## Implementación y contratos

- `calendar-editor.css` se activa únicamente con `data-reference-state` en alta de estos cuatro estados. Ajusta fondo, título, tarjetas, campos, botones, mini calendario, resumen y aviso de superposición. El header compartido se reutiliza sin cambiar sus archivos.
- `calendar-editor-reference.js` contiene el modelo puro: aislamiento de estados, filtrado de cotizaciones por propietario, búsqueda sin acentos, estados no disponibles y semanas reales del mes. Se excluyen borradores `in_progress` como hace el repositorio existente. No escribe datos.
- El selector lee mediante `WeotziData.Quotations.listForArtist`, limitado a la identidad autenticada. Conserva `id` numérico separado de `quote_id`; no usa emails ni datos personales en fixtures nuevos del runtime. No cambia repositorios, RLS, migraciones ni crea otro cliente Supabase.
- Al seleccionar una cotización se completa el cliente y aparece el límite visible. **Guardar intenta vincular: se informa que no se guardó y no se llama a Calendar.create/update.** Quitar la selección conserva el guardado manual anterior. El asterisco del diseño se mantiene visualmente, sin convertir la vinculación pendiente en un requisito nuevo para los eventos manuales existentes.
- Rechazadas/vencidas/finalizadas se deshabilitan. «Crear cotización manual» reutiliza la ruta `/quotation` del producto y el prefijo seguro. No inventa un flujo nuevo ni envía notificaciones.
- Se conservan formatos/estados de negocio reales: Reserva pendiente y Disponibilidad muestran su tipo correcto, aunque los dos frames repitan «Turno con cliente» en el resumen. Disponibilidad no muestra una ubicación ficticia. `artist_completed` mantiene «Lista para cliente», no se renombra falsamente «En progreso». Los números de sesiones y fechas no disponibles en la lectura no se inventan para copiar metadatos de ejemplo.

## SVG originales

17 archivos sin modificar en `public/shared/assets/calendar-editor/`, descargados con curl desde las URLs de assets de Figma. Todos no vacíos, cargados en navegador y usados en su slot; sin URLs temporales en runtime.

| Slot | Recursos / dimensiones nativas |
| --- | --- |
| Volver | `back.svg` 14 × 14 |
| Calendario vacío 28 × 28 | cuerpo 23.3333 × 23.3333, dos anillas 2.33333 × 7 y regla 23.3333 × 2.33333, colocados como las capas de Figma |
| Fecha 16 × 16 | cuerpo 13.3333 × 13.3333, dos anillas 1.33333 × 4 y regla 13.3333 × 1.33333 |
| Cliente / selects / guardar | `user.svg`, `select.svg`, `save.svg` 18 × 18 |
| Mes anterior/siguiente | dos SVG 5.33333 × 9.33333 |
| Selección de tarjeta | check 8.25 × 5.95833 sobre el círculo del componente |
| Valores vacíos | `empty-value.svg` 13.5 × 1.57837 |
| Aviso 16 × 16 | cuerpo 15.264 × 13.4019, trazo 1.33333 × 4 y punto 1.34 × 1.33333 |

No se redibujan ni se escalan las raíces de SVG; las piezas se componen como fondos a sus medidas originales.

## QA y evidencia

Browser integrado; entorno local seguro `WEOTZI_PREVIEW === true`. Comparación en iframe del mismo origen con ancho CSS real 1440, y prueba directa de la ruta local. El escalado exterior de Review no altera el layout interior.

- Elegir tipo: título x72/y162; tarjetas y284; vacío x72/y459.19/ancho881.28/alto191.59; botón deshabilitado y682.78/alto29. Medidas contrastadas con Figma (vacío y459.2/alto191.6).
- Turno: selector ancho870.79, listbox y550/alto383.20; Cliente y956.59 frente a 956.6 del layout de referencia. Se corrigieron la apertura inicial y el reabrir al hacer clic en el input que ya tenía foco.
- Se corrigieron una línea de base extra en Volver, márgenes de tarjetas, alto de textarea 100, checkbox, toggle 67.2 y botones, manteniendo el comportamiento de los campos.
- Matriz de los cuatro estados a 1920/1600/1440/1366/1280/1024/768/390: 32 combinaciones sin overflow de página ni controles fuera del ancho.
- Selector: lista, grupos, búsqueda sin acentos/por proyecto/número, vacío, selección, estados deshabilitados, clic fuera, ArrowDown/Enter/Escape, retorno de foco y reapertura aprobados. El intento de guardar vinculado mostró error y el contador de escrituras se mantuvo en cero.
- Mini calendario: selección de fecha sincroniza formulario/resumen; julio tiene 35 días de grilla, agosto 42; no se agrega una sexta fila artificial a julio. La recurrencia conserva su control y payload existentes.
- Error de lectura de cotizaciones inyectado solo en navegador: mensaje visible aprobado. Una espera con requestAnimationFrame en una pestaña no enfocada agotó 60 s; se inspeccionó el estado (sin guardado), se recargó antes de continuar y se verificó lectura normal de 14 cotizaciones ficticias. No se repitió a ciegas una mutación.
- Prueba directa sin mocks del adaptador seguro: validación de título vacío; se creó una única disponibilidad «QA Calendario 13 temporal» el 11 de julio; toast, un evento y persistencia tras recarga comprobados. Se abrió en edición sin aplicar la nueva capa y se eliminó **solo ese evento ficticio** por su baseId/propietario; recarga confirmó su ausencia. No se tocaron otros registros.
- Comparación de estilos calculados con la hoja nueva activa/inactiva: Día bloqueado, Guest Spot, Convención, Recordatorio, Evento personal, Mes, Semana, Día y Agenda sin diferencias. La edición queda excluida por modelo y atributo comprobados.
- Sin errores JavaScript del calendario en la revisión. Soporte 501 es una limitación previa de preview.

Los datos de Julieta y las otras filas del frame se usaron únicamente en memoria de una pestaña QA para comparar capturas. No se agregaron mocks de personas al runtime ni se alteró el adaptador de preview. Cerrar esa pestaña elimina la sustitución. Las pruebas de guardado anteriores son **persistencia simulada del navegador**, no escritura ni integración remotas.

### Capturas finales temporales

- Elegir tipo: `C:\Users\Dev\AppData\Local\Temp\opencode-browser-Lvtoig\0\screenshot.png`.
- Turno/lista abierta: `C:\Users\Dev\AppData\Local\Temp\opencode-browser-EAPBT2\0\screenshot.png`.
- Reserva: `C:\Users\Dev\AppData\Local\Temp\opencode-browser-abuTZ2\0\screenshot.png`.
- Disponibilidad: `C:\Users\Dev\AppData\Local\Temp\opencode-browser-5wkQBX\0\screenshot.png`.

## Entrega y límites

Se agregaron seis pruebas de modelo/guardado: cinco casos de modelo se observaron fallar antes de sus correcciones; la prueba integrada adicional de submit confirma que nunca se sustituye un turno vinculado por un evento manual. Suite completa 459/459 y check:release aprobados antes de publicar; la autoentrega los repite y agrega los archivos nuevos a la revisión de credenciales. Versión definitiva en `docs/CHANGELOG.md`.

Publicación únicamente en `valentina/rediseno-laura`, CI de push y misma SHA en `https://preview.weotzi.chat/api/release`. Recorrido: `/calendar/` → Nuevo evento → elegir uno de los tres tipos. Mes/Semana/Día son la misma pantalla 13 y conservan su entrega previa. No se declara el flujo completo de vinculación ni todos los estados de Calendario terminados.

Rollback: revertir el commit de `.26` y preparar una nueva entrega para volver a `.25` (`d09239ceb7634e01c47385205dbe387e890be04f`). No hay migraciones ni escrituras remotas que revertir. Isaí revisa el PR permanente #12; no se mezcla a main.
