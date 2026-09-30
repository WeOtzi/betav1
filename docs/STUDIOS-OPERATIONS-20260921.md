# Operaciones del estudio — guía de prueba

Actualizado: 2026-09-21.

Entrá con una cuenta de estudio en `/studio/login/` y abrí `/studio/dashboard/`.
Para registrar reservas y trabajos necesitás al menos un artista activo en **Roster**: invitá al artista y aceptá la invitación desde su cuenta.

## Agenda

1. Abrí **Operaciones → Agenda → Nueva reserva**.
2. Elegí artista y sede; completá inicio, fin, cliente, correo opcional, importe, moneda y notas.
3. Guardá. La reserva aparece en el mes elegido y permanece después de recargar.
4. Intentá reservar al mismo artista en un horario superpuesto: se rechaza sin cambiar la primera reserva.
5. Usá **Editar** para reprogramar o **Cancelar** para liberar el horario.
6. Cuando la sesión haya comenzado y el trabajo esté realizado, elegí **Completar**. Se crea un trabajo con el cliente, duración e importe de la reserva. Repetir la operación no duplica el trabajo.

Las reservas completadas conservan su historial. Se puede cancelar una reserva de un artista que haya salido del roster. La agenda pertenece al estudio; actualmente no sincroniza servicios de calendario externos ni envía automáticamente un correo por cada reserva.

## Trabajos y clientes

**Operaciones → Trabajos** permite registrar y editar fecha y hora local, artista, nombre y correo del cliente, duración, importe, moneda, distribución y notas. La tabla muestra los últimos 100 trabajos.

**Clientes** agrupa todos los trabajos completados por identidad, correo o nombre y muestra visitas, última fecha y totales separados por moneda. La consulta recorre páginas de 500 registros, por lo que no corta los totales al llegar a 1.000 filas.

## Facturas internas y pagos recibidos

1. En **Operaciones → Facturas**, creá una factura con número, cliente, fecha, moneda y al menos un concepto.
2. Completá cantidad positiva y precio no negativo en cada concepto. Podés agregar impuesto y vencimiento.
3. Guardá y recargá. Cabecera y conceptos se guardan juntos: si alguna línea falla, se conserva la versión anterior completa.
4. Cuando efectivamente hayas recibido el dinero, elegí **Registrar pago recibido** y confirmá. Queda registrada la fecha del pago.

Una factura pagada o anulada no se edita en este flujo. Solo los borradores muestran la acción de borrado. Estos documentos son un registro interno: no cobran dinero, no constituyen facturación fiscal y no implican que se haya enviado una factura por correo.

## Documentos y contratos

1. En **Operaciones → Documentos**, elegí tipo, título y descripción.
2. Adjuntá PDF, Word o imagen de hasta 10 MB, o un enlace HTTP(S).
3. Guardá. Los archivos se suben al guardar y permanecen privados en `studio-documents`; se almacena su ruta, no una URL firmada vencible.
4. **Ver archivo** genera un enlace temporal de cinco minutos. También se recuperan las rutas de documentos antiguos que habían guardado un enlace público de este bucket privado.
5. Volvé a **Editar** para vincular el documento a un artista del roster, una factura o un trabajo.
6. Si ya recibiste un documento firmado, conservá ese archivo y registrá nombre y fecha de firma. El registro es manual y no ofrece firma electrónica verificada.

Si falla el guardado de los datos después de subir el archivo, se intenta retirar el objeto recién subido. Los vínculos se validan contra registros del mismo estudio. Las cotizaciones no se ofrecen como destino mientras el contrato heredado mezcle IDs numéricos y UUID.

## Inventario

1. Creá dos items sin SKU: ambos deben guardarse. Si usás SKU, debe ser único dentro del estudio.
2. Registrá stock inicial, unidad, costo, moneda, proveedor y umbral de reposición.
3. En **Movimiento**, probá una entrada, consumo y pérdida. El consumo puede asociarse a un artista.
4. Un ajuste admite cantidad positiva o negativa. Ninguna operación permite dejar stock negativo.
5. Consultá los últimos 100 movimientos en el mismo editor.
6. **Archivar** retira un item de la lista activa y conserva su historial.

El stock de un item existente se cambia mediante movimientos. El resumen muestra valor separado por moneda; no suma ARS y USD como si fueran equivalentes.

## Proveedores y sponsors

**Proveedores** permite crear, editar y borrar contactos, categorías y notas.

**Sponsors** permite registrar marca, nivel, vigencia, monto, moneda, logo, sitio y visibilidad pública. Elegí artistas activos del roster para asociarlos. El reemplazo del conjunto de artistas se hace en una transacción y valida que pertenezcan al estudio. Los sponsors públicos se consultan en el perfil del estudio.

Si falla la asignación de artistas luego de guardar la ficha de un sponsor nuevo, el editor conserva su ID para reintentar sin duplicarlo.

## Travel

La pestaña **Travel** muestra solicitudes pendientes y su historial. Las pendientes ofrecen **Confirmar vínculo** y **Rechazar**. Las resueltas siguen visibles con su estado y fechas; un viaje cancelado ya no presenta acciones de confirmación.

## Analytics

Se muestran trabajos completados de los últimos 12 meses, separados por moneda. Las tablas mensuales muestran bruto, neto, distribución a artistas y ticket promedio. La tabla por artista muestra los 20 principales resultados por importe y moneda. Al volver a esta pestaña se actualizan los datos.

El conteo «Clientes por mes y moneda (suma)» es la suma de los grupos mensuales, no un conteo de personas únicas de todo el período.

## Verificación realizada

- Migración: `supabase/migrations/20260921212819_studio_operations_workflows.sql`.
- Vistas con RLS e inventario por moneda: `supabase/migrations/20260921213947_studio_analytics_invoker.sql`. Las tres vistas heredadas conservan sus columnas y usan `security_invoker`; el perfil público no depende de ellas.
- Prueba real con fixtures propios y `ROLLBACK`: `supabase/tests/studio_operations_workflows.sql`.
- Resultado remoto confirmado: factura atómica, stock, SKU opcional, reservas superpuestas, finalización idempotente, cancelación tras pausa del artista y aislamiento RLS entre estudios.
- Pruebas Node: `node --test tests/studio-operations-workflows.test.js tests/opportunity-persistence.test.js tests/travel-figma-data-contract.test.js`.
- Las pruebas de interfaz ejecutan los renderizadores de analytics con datos vacíos, completos y fallidos, y el editor de sponsor con asignaciones existentes; también verifican limpieza de archivo privado tras falla de metadata y bloqueo de doble envío.
- Sintaxis: `node --check` de `studio-dashboard-ops.js`, `studio-travel-links.js` y `data/studios-repo.js`.

La comprobación visual y el despliegue se registran por separado en el cierre general de la publicación.
