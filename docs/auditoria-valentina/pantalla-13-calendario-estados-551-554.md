# Pantalla 13 · Guest Spot, Convención, Recordatorio y Evento personal

## Referencias y repetidos

Continuación de la misma pantalla 13, únicamente en `/calendar/`, rama `valentina/rediseno-laura`. Base publicada: `.26`, SHA `3400ee7f7814eb833d153c95f943dacb1159190a`.

| Frame del diseño final | Estado | Comparación / acción |
| --- | --- | --- |
| [801:551](https://www.figma.com/design/w3JA83CcP5ISKjyOu87mx1/We-Otzi-Pantallas-final?node-id=801-551) | Nuevo Guest Spot | Nuevo estado visual: Estudio, fecha/hora, Todo el día y notas |
| [801:552](https://www.figma.com/design/w3JA83CcP5ISKjyOu87mx1/We-Otzi-Pantallas-final?node-id=801-552) | Nueva Convención | Nuevo estado visual: Nombre del evento, fecha/hora, Todo el día y notas |
| [801:553](https://www.figma.com/design/w3JA83CcP5ISKjyOu87mx1/We-Otzi-Pantallas-final?node-id=801-553) | Nuevo Recordatorio | Nuevo estado visual: Título, fecha/hora, Se repite y notas |
| [801:554](https://www.figma.com/design/w3JA83CcP5ISKjyOu87mx1/We-Otzi-Pantallas-final?node-id=801-554) | Nuevo Evento personal | Nuevo estado visual: Título, fecha/hora, Todo el día y notas |

Se leyeron los cuatro nodos con `get_design_context`, código de alta fidelidad y sus capturas. **No hay frames repetidos exactos entre estos cuatro ni entre los siete ya entregados.** Recordatorio comparte campos con Disponibilidad, pero la selección y el `event_type` son distintos; no se descarta ni se guarda con el tipo equivocado. Se reutiliza el editor existente, sin crear otra página, formulario ni copia de navegación.

## Implementación y datos

- Se amplía la lista de estados aprobados en `calendar-editor-reference.js`. La capa de referencia ahora cubre elegir tipo y siete tipos de alta; Día bloqueado y toda edición siguen excluidos.
- `calendar-editor.css` reutiliza la presentación ya publicada. Para estos cuatro frames se respeta la inversión de alturas del selector: primera fila 65.6 px y segunda 67.2 px, con tarjeta seleccionada en la segunda fila. El ajuste y el amarillo del indicador Convención se limitan a los cuatro estados nuevos.
- Se descargó el SVG original `59db9.svg` como `public/shared/assets/calendar-editor/studio.svg`, raíz 18 × 18, sin modificar bytes. La capa Briefcase existente se sustituye visualmente solo en el editor aprobado, a 18 × 18.
- Los otros once identificadores de SVG son los mismos de `.26`; se descargaron a temporales y sus SHA-256 coincidieron con los recursos locales reutilizados. No se duplican assets ni se usan enlaces temporales de Figma en runtime.
- La etiqueta Estudio reproduce el frame sin asterisco, pero el input continúa siendo obligatorio. En edición mantiene la etiqueta/validación previa. El nombre del estudio sigue siendo texto del evento; no se inventa una relación con un estudio del directorio.
- No se cambian handlers de guardado, repositorios, consultas, identidad, permisos, RLS, autenticación, migraciones ni avisos/remotos. Se conservan los `event_type`, prefijo `Guest en`, `all_day`, fechas, notas y recurrencia `weekly` originales.
- El resumen continúa mostrando el tipo y la ubicación reales. No se reemplaza Guest Spot/Convención/Recordatorio/Evento personal por el texto «Turno con cliente» repetido en los ejemplos del Figma, ni se inventa «Estudio propio» como ubicación. El header conserva sección activa y contadores dinámicos, como en las entregas previas.
- Sigue vigente el límite de vinculación con cotizaciones acordado en `.26`; estos cuatro estados no agregan esa función ni cambian su guarda.

## Inventario de validación

Visual: composición ajustada a los frames, con desvíos intencionales de datos/resumen/header explicados arriba. Funcional: **simulado**, no validación remota.

- Prueba de aislamiento actualizada: primero falló porque `guest_spot` todavía no recibía la capa; después aprobó los siete tipos de alta y la exclusión de edición/Día bloqueado.
- Cuatro pruebas de caracterización del controlador real verifican que cada tipo conserva su payload: prefijo del Guest Spot, fin al día siguiente en eventos todo-el-día, hora local, notas, ubicación nula y recurrencia semanal del Recordatorio. Pasaron antes y después del cambio visual.
- Pruebas focalizadas de Calendario: 20/20. Suite completa 463/463 y check:release aprobados antes de publicar; la autoentrega los repite e incluye los archivos nuevos en la revisión de credenciales. Versión y evidencia definitiva en `docs/CHANGELOG.md`.

### Browser integrado

Se confirmó el entorno seguro `WEOTZI_PREVIEW === true`. El proceso local antiguo de Dev devolvía 503 para `__preview/bootstrap.js` («Preview fixture adapter is not installed»); se identificó su propietario y comando y se reinició únicamente `node scripts/release/local-preview.cjs` mediante `npm run dev:safe`. No se modificó la infraestructura ni sus scripts, no se debilitó CSP y la preview pública no estaba afectada. Después funcionaron los controles de prueba y la sesión ficticia.

- Comparación visual con las cuatro capturas y geometría a 1440 CSS px. Contenido x76; primer campo y458.58; primera fila 65.59 px y tarjeta seleccionada 67.20 px en y358.59, coherentes con los valores 65.6/67.2 del frame.
- Icono Estudio cargado: raíz y background-size 18 × 18, wrapper 18 × 18. Los once recursos compartidos se reutilizan sin alterar proporciones.
- Matriz 1920/1600/1440/1366/1280/1024/768/390 por estado: **32 combinaciones sin overflow horizontal ni controles fuera de la página**.
- Selección de tipo, required del título/estudio, fecha/hora, Todo el día, deshabilitación de la hora y Se repite comprobados. Navegación por teclado: Enter abre el editor; ArrowRight pasa de Guest Spot a Convención; Space activa Todo el día y el resumen pasa a 1 día, con foco visible.
- Una comprobación encadenada de teclado consultó los campos antes de asentarse el nuevo estado; se inspeccionó el foco y se repitió por pasos, con resultado correcto, sin cambiar el comportamiento del producto.
- Se guardaron por la UI cuatro eventos ficticios, uno de cada tipo, en días distintos. Recarga y lectura mediante el repositorio confirmaron cuatro baseId únicos y seis ocurrencias de julio (tres del mismo Recordatorio semanal), con tipos/all_day/recurrencia correctos. No se interpretó una inspección inmediata anterior al render como pérdida del guardado.
- Estudio vacío sigue siendo inválido por validación nativa (`valueMissing` y `checkValidity`), aunque no muestre el asterisco del frame. Los otros tres formularios muestran su error de título vacío. No se creó un evento vacío.
- Se abrió en edición un Guest Spot guardado: la capa nueva no se aplica y el estudio sigue requerido. Después se eliminaron solo los cuatro baseId del conjunto QA, por propietario, mediante el repositorio; lectura posterior confirmó cero registros QA y se conservaron los demás.
- Regresión contra la CSS pública `.26`: elegir tipo, Turno con cliente, Reserva, Disponibilidad, Día bloqueado, Mes, Semana, Día y Agenda mantuvieron idénticos los estilos calculados de todos los elementos visibles. Transiciones desactivadas únicamente durante la comparación para no confundir un hover interpolado con una regresión.

La comparación de capturas usa cuatro eventos de referencia solo en memoria de una pestaña QA para reproducir el aviso de superposición y los puntos del mini calendario. No se agregan mocks ni personas de ejemplo al runtime. El guardado/persistencia se probó aparte con el adaptador seguro normal, no con escrituras a Supabase ni integraciones reales.

### Capturas temporales finales

- Guest Spot: `C:\Users\Dev\AppData\Local\Temp\opencode-browser-MkFNR2\0\screenshot.png`.
- Convención: `C:\Users\Dev\AppData\Local\Temp\opencode-browser-VvXCvE\0\screenshot.png`.
- Recordatorio: `C:\Users\Dev\AppData\Local\Temp\opencode-browser-UgqiAy\0\screenshot.png`.
- Evento personal: `C:\Users\Dev\AppData\Local\Temp\opencode-browser-hvq66w\0\screenshot.png`.

## Entrega, límites y recuperación

Recorrido de preview: `https://preview.weotzi.chat/calendar/` → Nuevo evento → Guest Spot / Convención / Recordatorio / Evento personal. Si falta sesión ficticia, usar Artista de prueba del ojo flotante.

La autoentrega publica únicamente la rama permanente y exige CI de push aprobado y la misma SHA/versión en `/api/release` antes de declarar publicada `.27`. El PR permanente es https://github.com/WeOtzi/betav1/pull/12; Isaí revisa, sin merge automático a main.

Continúan fuera de esta entrega el frame de Día bloqueado no enviado, otros estados no solicitados y cualquier integración o vínculo real pendiente. Los once frames aprobados hasta ahora siguen contando como una sola pantalla 13; no se declara todo el módulo terminado.

Rollback: revertir el commit de `.27` mediante una nueva entrega para recuperar `.26` (`3400ee7f7814eb833d153c95f943dacb1159190a`). No hay migraciones ni escrituras remotas que revertir; el rollback operativo corresponde a Isaí.
