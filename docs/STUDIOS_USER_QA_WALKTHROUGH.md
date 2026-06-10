# Estudios - Plan paso a paso de pruebas de usuario

Actualizado: 2026-05-27  
Alcance: pruebas manuales completas para validar el usuario tipo `estudio` de principio a fin.

## Objetivo

Este documento ordena todas las pruebas de usuario de Estudios para que una persona pueda recorrer el producto completo sin saltos: registro, login, perfil publico, dashboard, spots, postulaciones, roster, operaciones, inventario, sponsors, analytics, seguridad basica y responsive.

Usar este documento como guia de ejecucion. Usar `docs/STUDIOS_TEST_PLAN.md` como respaldo tecnico cuando haga falta validar SQL, RLS o casos atomicos.

## Resultado esperado al terminar

Al completar la guia debe quedar verificado que:

- Un estudio nuevo puede registrarse, iniciar sesion y administrar su perfil.
- El perfil publico del estudio muestra identidad, sedes, mapa, galeria, roster y sponsors.
- El estudio puede publicar spots y recibir postulaciones de artistas.
- El estudio puede invitar artistas al roster y gestionar roles, splits y estados.
- El estudio puede registrar trabajos, clientes, facturas internas y documentos.
- El estudio puede crear proveedores, inventario, movimientos y sponsors.
- El dashboard muestra analytics coherentes con los datos cargados.
- Las pantallas principales funcionan en mobile, tablet y desktop.
- Las rutas protegidas y las acciones sensibles no quedan abiertas para usuarios incorrectos.

## Preparacion antes de empezar

### 1. Entorno

1. Levantar la app local o abrir staging.
   - Local: `http://localhost:4545`
   - Staging: usar el dominio vigente si la prueba se hace fuera del entorno local.
2. Confirmar que las migraciones de Estudios estan aplicadas en Supabase, incluyendo:
   - `20260527000000_studio_storage_and_views.sql`
3. Abrir una ventana normal del navegador para el estudio.
4. Abrir una ventana incognito o un segundo navegador para el artista.
5. Abrir DevTools Console en ambas ventanas.
6. Crear una hoja de evidencia con estas columnas:
   - `ID`
   - `Flujo`
   - `Paso`
   - `Resultado esperado`
   - `Resultado real`
   - `Estado`
   - `Captura/nota`

### 2. Cuentas de prueba

Usar cuentas nuevas para evitar datos mezclados:

| Rol | Email sugerido | Password sugerido |
| --- | --- | --- |
| Estudio | `studio-qa-001@weotzi.test` | `TestPass1234!` |
| Artista | `artist-qa-001@weotzi.test` | `TestPass1234!` |

Si el email ya existe, incrementar el numero: `studio-qa-002@weotzi.test`, `artist-qa-002@weotzi.test`.

### 3. Reglas de avance

- No pasar al siguiente flujo si hay un error rojo en consola que bloquee la pantalla.
- No pasar al siguiente flujo si la pantalla no guarda o no persiste al recargar.
- Si un caso falla, anotar URL exacta, usuario usado, hora, captura y consola.
- Despues de cada bloque importante, recargar la pagina y confirmar que los datos siguen ahi.

---

## Orden completo de pruebas

## Bloque 1 - Superficies publicas antes de crear cuenta

**Objetivo:** confirmar que un visitante puede descubrir estudios y spots sin autenticarse.

### PU-01 - Perfil publico demo

1. Abrir `/studio/profile/?studio=palermo-tattoo-club`.
2. Verificar que carga nombre del estudio, portada, bio y datos principales.
3. Verificar que el mapa aparece y muestra pines de sedes.
4. Verificar que se ve roster publico si hay artistas activos.
5. Verificar que galeria y sponsors no rompen aunque falten imagenes.
6. Revisar consola.

Resultado esperado: la pagina carga sin login, sin errores rojos y con layout correcto.

### PU-02 - Directorio publico de spots

1. Abrir `/studio-spots`.
2. Verificar que aparecen cards de spots abiertos.
3. Abrir una card.
4. Confirmar que el modal muestra detalles del spot.
5. Confirmar que, sin sesion, aparece CTA para ingresar antes de postular.
6. Cerrar modal.
7. Revisar consola.

Resultado esperado: el directorio funciona anonimamente y no permite postular sin login.

---

## Bloque 2 - Registro completo de estudio

**Objetivo:** crear un estudio real desde cero y entrar al dashboard.

### PU-03 - Wizard de registro

1. Abrir `/studio/register`.
2. Paso Cuenta:
   - Nombre: `Estudio QA 001`
   - Email: `studio-qa-001@weotzi.test`
   - Password: `TestPass1234!`
   - Repetir password: `TestPass1234!`
3. Click en continuar.
4. Paso Identidad:
   - Tagline: `Tattoo studio de prueba QA`
   - Bio: `Estudio creado para validar el flujo completo de usuarios estudio.`
   - Ano de fundacion: `2026`
   - Idiomas: `Espanol, Ingles`
   - Instagram: `@estudioqa001`
   - Web: `https://estudioqa.example`
   - WhatsApp: `+5491100000000`
5. Click en continuar.
6. Paso Sedes:
   - Cargar direccion principal: `Av. Santa Fe 1750, Buenos Aires`
   - Elegir una sugerencia si el autocompletado esta disponible.
   - Confirmar que ciudad/pais/direccion quedan completos.
7. Agregar segunda sede:
   - `Honduras 5024, Buenos Aires`
8. Click en continuar.
9. Paso Fotos:
   - Cargar o pegar una portada.
   - Cargar o pegar al menos 2 imagenes de galeria.
10. Click en continuar.
11. Paso Confirmar:
   - Revisar nombre, sedes y fotos.
   - Click en crear estudio.
12. Esperar redireccion a `/studio/dashboard`.

Resultado esperado: el estudio se crea, queda autenticado y entra al dashboard.

### PU-04 - Validaciones negativas del registro

Ejecutar en una sesion aparte o despues de cerrar sesion:

1. Intentar password de menos de 8 caracteres.
2. Intentar passwords distintas.
3. Intentar continuar sin sede.
4. Intentar registrar un email ya usado.

Resultado esperado: cada caso muestra error claro y no crea un estudio incompleto visible.

---

## Bloque 3 - Login, logout y proteccion de dashboard

**Objetivo:** confirmar que solo un estudio autenticado entra al panel.

### PU-05 - Login correcto

1. Cerrar sesion desde el dashboard si ya estas adentro.
2. Abrir `/studio/login`.
3. Entrar con `studio-qa-001@weotzi.test` y `TestPass1234!`.
4. Confirmar redireccion a `/studio/dashboard`.

Resultado esperado: dashboard visible y sin errores de sesion.

### PU-06 - Dashboard protegido

1. Cerrar sesion.
2. Abrir directamente `/studio/dashboard`.
3. Observar redireccion.

Resultado esperado: redirige a `/studio/login`.

### PU-07 - Login incorrecto

1. Abrir `/studio/login`.
2. Usar el email correcto con password incorrecto.

Resultado esperado: muestra error de credenciales y no entra al dashboard.

---

## Bloque 4 - Perfil, sedes y perfil publico propio

**Objetivo:** validar que el estudio puede editar su identidad y que eso se ve publicamente.

### PU-08 - Editar perfil

1. Entrar a `/studio/dashboard`.
2. Abrir tab `Perfil`.
3. Cambiar tagline y bio.
4. Cambiar o cargar logo, portada y galeria.
5. Guardar.
6. Recargar dashboard.
7. Confirmar que los cambios persisten.

Resultado esperado: los datos se guardan y sobreviven al refresh.

### PU-09 - Gestionar sedes

1. Abrir tab `Sedes`.
2. Confirmar que estan las 2 sedes del registro.
3. Agregar una tercera sede.
4. Guardar.
5. Marcar otra sede como principal si la UI lo permite.
6. Recargar.

Resultado esperado: las sedes persisten, hay una sede principal y el mapa del perfil publico las refleja.

### PU-10 - Revisar perfil publico propio

1. Desde dashboard, usar `Ver perfil publico` si existe.
2. Si no, abrir `/studio/profile/?studio=estudio-qa-001`.
3. Confirmar que se ven nombre, bio, sedes, mapa y galeria.
4. Probar en mobile con DevTools o redimensionando.

Resultado esperado: el perfil publico muestra la informacion actualizada y no rompe en mobile.

---

## Bloque 5 - Roster e invitaciones

**Objetivo:** validar que el estudio puede buscar artistas, invitarlos y administrar membresias.

### PU-11 - Invitar artista al roster

1. Abrir tab `Roster`.
2. Buscar un artista existente por nombre o username.
3. Seleccionar un resultado.
4. Elegir rol: `Itinerante` o `Guest`.
5. Elegir sede.
6. Definir split, por ejemplo `60`.
7. Click en invitar.
8. Recargar tab.

Resultado esperado: aparece una membership pendiente o activa segun el flujo configurado.

### PU-12 - Gestionar membership

1. En la fila del artista, cambiar rol.
2. Cambiar split.
3. Guardar.
4. Recargar.
5. Si existe accion de pausa/reactivar, probarla.
6. Si existe accion de desvincular, probarla solo con un artista de prueba.

Resultado esperado: los cambios persisten y el estado se refleja en la tabla.

### PU-13 - Vista artista de invitaciones

1. En ventana incognito, iniciar sesion como artista.
2. Abrir `/artist/invitations`.
3. Confirmar que aparece invitacion del estudio si fue creada como pendiente.
4. Aceptar o rechazar.
5. Volver al dashboard del estudio y revisar roster.

Resultado esperado: el cambio hecho por el artista se refleja en el dashboard del estudio.

---

## Bloque 6 - Spots y postulaciones

**Objetivo:** publicar un spot, verlo publicamente, postular como artista y decidir desde el estudio.

### PU-14 - Crear spot abierto

1. Como estudio, abrir tab `Spots`.
2. Click en nuevo spot.
3. Completar:
   - Titulo: `Guest spot QA mayo`
   - Tipo: `Guest spot`
   - Descripcion: `Spot creado para validar postulaciones de artistas.`
   - Estilos: `Fine line, Realismo`
   - Fecha inicio: una fecha futura o vigente
   - Fecha fin: fecha posterior
   - Split: `60`
4. Cargar cover si la UI lo permite.
5. Publicar como abierto.
6. Recargar tab.

Resultado esperado: el spot queda `open` y aparece en la lista.

### PU-15 - Ver spot en directorio publico

1. Abrir `/studio-spots`.
2. Buscar el spot `Guest spot QA mayo`.
3. Abrir modal.

Resultado esperado: el spot publico muestra datos completos y el link/modal funciona.

### PU-16 - Postular como artista

1. En ventana de artista, abrir `/studio-spots`.
2. Abrir el spot creado.
3. Si pide login, iniciar sesion como artista y volver.
4. Completar mensaje:
   - `Hola, me interesa aplicar a este guest spot.`
5. Agregar portfolio si existe campo.
6. Enviar postulacion.

Resultado esperado: aparece confirmacion y no permite duplicar la postulacion.

### PU-17 - Aceptar o rechazar postulacion

1. Como estudio, volver a tab `Spots`.
2. Abrir postulaciones del spot.
3. Confirmar que aparece la postulacion del artista.
4. Click en aceptar.
5. Confirmar mensaje de exito.
6. Ir a tab `Roster`.

Resultado esperado: el artista aceptado queda agregado al roster y la accion no falla si la notificacion email no esta configurada.

---

## Bloque 7 - Operaciones: trabajos, clientes, facturas y documentos

**Objetivo:** validar el dia a dia operativo del estudio.

### PU-18 - Registrar trabajo

1. Abrir tab `Operaciones`.
2. Entrar a sub-seccion `Trabajos`.
3. Click en nuevo trabajo.
4. Seleccionar artista del roster.
5. Completar:
   - Cliente: `Maria Gonzalez QA`
   - Horas: `3.5`
   - Bruto: `450`
   - Moneda: `USD`
   - Split artista: `270`
   - Split estudio: `135`
   - Supplies: `15`
   - Notas: `Sesion QA`
6. Guardar.
7. Recargar.

Resultado esperado: el trabajo aparece y persiste.

### PU-19 - Revisar clientes derivados

1. En `Operaciones`, abrir sub-seccion `Clientes`.
2. Buscar `Maria Gonzalez QA`.

Resultado esperado: aparece como cliente con sesiones y total coherente.

### PU-20 - Crear factura interna

1. Abrir sub-seccion `Facturas`.
2. Crear nueva factura.
3. Completar cliente `Maria Gonzalez QA`.
4. Agregar item:
   - Descripcion: `Sesion de tatuaje QA`
   - Cantidad: `1`
   - Precio unitario: `450`
5. Guardar.
6. Marcar como pagada si la accion existe.
7. Recargar.

Resultado esperado: la factura persiste, calcula total y cambia a pagada.

### PU-21 - Crear documento

1. Abrir sub-seccion `Documentos`.
2. Crear documento:
   - Titulo: `Consentimiento QA`
   - Tipo: `consent`
   - Descripcion: `Documento de prueba`
3. Cargar archivo o URL si la UI lo permite.
4. Marcar plantilla y requiere firma si existen esos checks.
5. Guardar.
6. Recargar.

Resultado esperado: el documento aparece en la biblioteca.

---

## Bloque 8 - Proveedores, inventario y sponsors

**Objetivo:** validar el flujo operativo de insumos y sponsors publicos.

### PU-22 - Crear proveedor

1. Abrir tab `Proveedores`.
2. Crear proveedor:
   - Nombre: `Proveedor QA`
   - Categorias: `tintas, agujas`
   - Email: `proveedor.qa@example.com`
   - Web: `https://proveedorqa.example`
3. Guardar.
4. Recargar.

Resultado esperado: proveedor persistente en la lista.

### PU-23 - Crear item de inventario

1. Abrir tab `Inventario`.
2. Crear item:
   - Nombre: `Tinta negra QA`
   - SKU: `QA-BLK-001`
   - Categoria: `tinta`
   - Unidad: `ml`
   - Stock inicial: `500`
   - Reorder: `100`
   - Costo: `0.05`
   - Moneda: `USD`
   - Proveedor: `Proveedor QA`
3. Guardar.
4. Recargar.

Resultado esperado: el item aparece, el resumen de salud de inventario se actualiza.

### PU-24 - Registrar movimiento de inventario

1. En el item creado, abrir movimiento.
2. Elegir tipo `Consumo`.
3. Cantidad: `15`.
4. Elegir artista del roster si el campo existe.
5. Guardar.
6. Recargar.

Resultado esperado: el stock baja de `500` a `485` y queda registro del movimiento.

### PU-25 - Crear sponsor publico

1. Abrir tab `Sponsors`.
2. Crear sponsor:
   - Nombre: `Sponsor QA`
   - Tier: `gold`
   - Web: `https://sponsorqa.example`
   - Monto: `500`
   - Moneda: `USD`
   - Marcar como publico.
3. Seleccionar artistas asociados si aparecen checkboxes.
4. Guardar.
5. Abrir perfil publico del estudio.

Resultado esperado: el sponsor aparece publicamente y muestra artistas asociados si fueron elegidos.

---

## Bloque 9 - Analytics

**Objetivo:** confirmar que las metricas reflejan las operaciones cargadas.

### PU-26 - Revisar dashboard analytics

1. Abrir tab `Analytics`.
2. Verificar tarjetas principales:
   - Bruto
   - Neto estudio
   - Trabajos
   - Clientes unicos
3. Verificar tabla mensual.
4. Verificar performance por artista.
5. Comparar mentalmente contra el trabajo creado por `450 USD`.

Resultado esperado: las metricas no estan vacias si hay trabajos, y los totales son coherentes.

---

## Bloque 10 - Seguridad funcional de usuario

**Objetivo:** validar que las acciones no quedan expuestas a usuarios incorrectos.

### PU-27 - Estudio no autenticado

1. Cerrar sesion.
2. Abrir `/studio/dashboard`.

Resultado esperado: redirige a login.

### PU-28 - Artista intentando usar dashboard de estudio

1. Iniciar sesion como artista.
2. Abrir `/studio/dashboard`.

Resultado esperado: no entra como estudio; debe redirigir o mostrar acceso invalido.

### PU-29 - Postulacion anonima

1. Cerrar sesion.
2. Abrir `/studio-spots`.
3. Intentar postular.

Resultado esperado: pide login de artista y no crea postulacion anonima.

### PU-30 - Notificaciones no bloquean la accion principal

1. Aceptar una postulacion o invitar un artista.
2. Si el email real no esta configurado, observar mensaje/console.

Resultado esperado: la accion de datos queda guardada aunque el envio real de email no este activo.

---

## Bloque 11 - Responsive y navegacion visual

**Objetivo:** confirmar que todos los flujos son usables en mobile, tablet y desktop.

Probar estos viewports:

| Dispositivo | Ancho x alto sugerido |
| --- | --- |
| Mobile | `390 x 844` |
| Tablet | `834 x 1112` |
| Desktop | `1440 x 1000` |

### PU-31 - Mobile

1. Abrir `/studio/register`.
2. Recorrer pasos del wizard sin completar todo.
3. Abrir `/studio/login`.
4. Abrir `/studio-spots`.
5. Abrir `/studio/profile/?studio=palermo-tattoo-club`.
6. Si hay sesion de estudio, abrir `/studio/dashboard` y recorrer tabs.

Resultado esperado: no hay scroll horizontal de pagina, botones visibles y textos no se pisan.

### PU-32 - Tablet

1. Repetir las mismas rutas en viewport tablet.
2. En dashboard, confirmar que la navegacion lateral/rail es usable.
3. Revisar tablas de roster, jobs e inventario.

Resultado esperado: tablas usan scroll controlado y no rompen el layout.

### PU-33 - Desktop

1. Repetir rutas principales en desktop.
2. Confirmar que grids, cards, mapa y dashboard aprovechan el espacio.

Resultado esperado: layout estable, sin solapamientos y sin errores de consola.

---

## Bloque 12 - Smoke final de cierre

**Objetivo:** cerrar la corrida con una validacion rapida de todo el sistema.

1. Abrir `/studio/login`.
2. Abrir `/studio/register`.
3. Abrir `/studio-spots`.
4. Abrir `/studio/profile/?studio=palermo-tattoo-club`.
5. Abrir `/studio/dashboard` sin sesion y confirmar redirect.
6. Entrar como estudio y recorrer tabs:
   - Perfil
   - Sedes
   - Roster
   - Spots
   - Operaciones
   - Inventario
   - Proveedores
   - Sponsors
   - Analytics
7. Entrar como artista y abrir `/artist/invitations`.
8. Revisar consola en todas las paginas.

Resultado esperado: todas las rutas cargan, las protegidas protegen, las publicas son publicas y no hay errores rojos bloqueantes.

---

## Criterios de aprobacion

La prueba completa se considera aprobada si:

- Pasan todos los casos PU-01 a PU-33 o solo quedan fallas menores documentadas.
- Registro, login, dashboard y perfil publico pasan sin bloqueos.
- Spots y postulaciones pasan de extremo a extremo.
- Roster e invitaciones pasan con al menos un artista.
- Operaciones, inventario y sponsors persisten despues de recargar.
- Analytics refleja al menos un trabajo creado.
- Mobile, tablet y desktop no tienen overflow horizontal ni solapamientos criticos.
- No hay errores rojos de consola que rompan el flujo.

## Criterios de rechazo

Marcar la corrida como rechazada si aparece cualquiera de estos problemas:

- Un estudio no puede registrarse o iniciar sesion.
- Un usuario anonimo puede entrar al dashboard.
- Un artista puede editar datos privados del estudio.
- El estudio no puede guardar perfil, sedes, roster o spots.
- Una postulacion aceptada no crea o no actualiza el roster.
- Facturas, trabajos o inventario no persisten.
- El perfil publico no carga.
- El layout mobile impide completar registro, login o dashboard.

## Evidencia minima a guardar

Guardar capturas de:

- Registro completado.
- Dashboard tab Perfil.
- Dashboard tab Roster con artista.
- Dashboard tab Spots con postulacion.
- Perfil publico propio.
- Directorio `/studio-spots`.
- Operaciones con trabajo/factura.
- Inventario con stock actualizado.
- Sponsors visibles en perfil publico.
- Analytics con metricas.
- Mobile register.
- Mobile dashboard.

## Limpieza opcional de datos de QA

Si la corrida se hace en entorno compartido, limpiar o marcar como test:

- Estudios cuyo nombre empiece con `Estudio QA`.
- Spots cuyo titulo contenga `QA`.
- Proveedores, sponsors e inventario con sufijo `QA`.
- Usuarios `studio-qa-*@weotzi.test` y `artist-qa-*@weotzi.test` si el entorno permite borrarlos.

No limpiar datos demo como `palermo-tattoo-club` salvo que la prueba lo requiera explicitamente.
