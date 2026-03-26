# Job Board - Plan de Pruebas Manuales

**Version:** 1.0.0
**Fecha:** 2026-02-22
**Total de pruebas:** 88

---

## A. Formulario de Solicitud (`/job-board/request`) - 17 pruebas

### TEST-A01: Carga inicial del wizard
- **Prioridad**: P1
- **Precondiciones**: Ninguna
- **Pasos**:
  1. Abrir `/job-board/request` en el navegador
  2. Esperar a que cargue la pagina
- **Resultado Esperado**: Se muestra la pantalla de bienvenida con titulo "Publica tu solicitud de tatuaje", 3 feature cards y boton "Comenzar". La barra de progreso esta en 0%.
- **Notas**: Verificar que no hay errores en consola.

### TEST-A02: Navegacion con boton Comenzar
- **Prioridad**: P1
- **Precondiciones**: TEST-A01 completado
- **Pasos**:
  1. Click en "Comenzar"
- **Resultado Esperado**: Se muestra el paso 1 (zona del cuerpo). La barra de progreso avanza. El boton "Atras" aparece.
- **Notas**: -

### TEST-A03: Seleccion de zona del cuerpo
- **Prioridad**: P1
- **Precondiciones**: Estar en paso 1
- **Pasos**:
  1. Click en una zona (ej: "Brazo")
  2. Verificar que se resalta la card seleccionada
  3. Si la zona tiene sub-partes, verificar que aparecen
  4. Seleccionar una sub-parte (ej: "Antebrazo")
  5. Click "Siguiente"
- **Resultado Esperado**: La card se marca con clase "selected" (fondo invertido). Las sub-partes aparecen debajo. Al pasar al siguiente paso, `formData.tattoo_body_part` contiene "Brazo - Antebrazo".
- **Notas**: -

### TEST-A04: Validacion de zona del cuerpo requerida
- **Prioridad**: P1
- **Precondiciones**: Estar en paso 1 sin seleccion
- **Pasos**:
  1. Click "Siguiente" sin seleccionar zona
- **Resultado Esperado**: Se muestra notificacion "Selecciona una zona del cuerpo". El grid hace animacion shake. No avanza al siguiente paso.
- **Notas**: -

### TEST-A05: Descripcion de la idea
- **Prioridad**: P1
- **Precondiciones**: Estar en paso 2
- **Pasos**:
  1. Escribir una descripcion con menos de 10 caracteres
  2. Click "Siguiente"
  3. Escribir una descripcion con 10+ caracteres
  4. Marcar checkbox "Es mi primer tatuaje"
  5. Click "Siguiente"
- **Resultado Esperado**: Con menos de 10 caracteres: muestra "La descripcion debe tener al menos 10 caracteres". Con 10+: avanza al paso 3. El checkbox se guarda en formData.
- **Notas**: Verificar el contador de caracteres (X / 1000).

### TEST-A06: Contador de caracteres en descripcion
- **Prioridad**: P3
- **Precondiciones**: Estar en paso 2
- **Pasos**:
  1. Escribir texto en el textarea
  2. Verificar que el contador se actualiza en tiempo real
  3. Intentar escribir mas de 1000 caracteres
- **Resultado Esperado**: Contador refleja la longitud exacta. El textarea tiene maxlength="1000" y no permite excederlo.
- **Notas**: -

### TEST-A07: Seleccion de tamano
- **Prioridad**: P1
- **Precondiciones**: Estar en paso 3
- **Pasos**:
  1. Click en "Mediano (5-15cm)"
  2. Verificar seleccion visual
  3. Click "Siguiente"
- **Resultado Esperado**: Card "Mediano" se marca como selected. Avanza al paso 4.
- **Notas**: -

### TEST-A08: Validacion de tamano requerido
- **Prioridad**: P1
- **Precondiciones**: Estar en paso 3 sin seleccion
- **Pasos**:
  1. Click "Siguiente" sin seleccionar tamano
- **Resultado Esperado**: Muestra "Selecciona un tamano" con shake animation. No avanza.
- **Notas**: -

### TEST-A09: Seleccion multiple de estilos
- **Prioridad**: P2
- **Precondiciones**: Estar en paso 4
- **Pasos**:
  1. Click en "Realismo" - verificar que se selecciona
  2. Click en "Fine Line" - verificar que tambien se selecciona
  3. Click en "Realismo" de nuevo - verificar que se deselecciona
  4. Click "Siguiente"
- **Resultado Esperado**: Se permite multi-seleccion (toggle). formData.tattoo_style es un array con los estilos seleccionados.
- **Notas**: -

### TEST-A10: Saltar paso de estilos
- **Prioridad**: P2
- **Precondiciones**: Estar en paso 4
- **Pasos**:
  1. Click en "Saltar este paso"
- **Resultado Esperado**: Avanza al paso 5 sin seleccionar ningun estilo. formData.tattoo_style queda vacio.
- **Notas**: -

### TEST-A11: Upload de imagenes de referencia
- **Prioridad**: P1
- **Precondiciones**: Estar en paso 5
- **Pasos**:
  1. Click en el area de upload
  2. Seleccionar una imagen JPG valida (< 5MB)
  3. Verificar que aparece la preview
  4. Agregar 3 imagenes mas
  5. Intentar agregar una quinta imagen
- **Resultado Esperado**: La preview se muestra con boton de eliminar. Al llegar a 4, muestra "Maximo 4 imagenes permitidas".
- **Notas**: -

### TEST-A12: Validacion de tipo de archivo
- **Prioridad**: P2
- **Precondiciones**: Estar en paso 5
- **Pasos**:
  1. Intentar subir un archivo PDF
  2. Intentar subir un archivo GIF
- **Resultado Esperado**: Muestra "Solo se permiten imagenes JPG, PNG o WebP". El archivo no se agrega.
- **Notas**: -

### TEST-A13: Validacion de tamano de archivo
- **Prioridad**: P2
- **Precondiciones**: Estar en paso 5
- **Pasos**:
  1. Intentar subir una imagen de mas de 5MB
- **Resultado Esperado**: Muestra "El archivo [nombre] supera los 5MB". El archivo no se agrega.
- **Notas**: -

### TEST-A14: Campo de presupuesto y ciudad
- **Prioridad**: P2
- **Precondiciones**: Estar en paso 6
- **Pasos**:
  1. Ingresar presupuesto min: 200, max: 500
  2. Cambiar moneda a EUR
  3. Escribir una ciudad y verificar si autocomplete de Google Places funciona
  4. Seleccionar fecha preferida
  5. Marcar "Fechas flexibles" y "Dispuesto/a a viajar"
  6. Click "Siguiente"
- **Resultado Esperado**: Todos los campos se guardan en formData correctamente. El autocomplete de Google funciona si la API key esta configurada.
- **Notas**: Google Places es opcional, degrada graciosamente si no esta disponible.

### TEST-A15: Auth gate - usuario no logueado
- **Prioridad**: P1
- **Precondiciones**: No estar logueado, llegar al paso 7
- **Pasos**:
  1. Verificar que se muestra el formulario de registro/login con tabs
  2. Cambiar entre tab "Registrarse" y "Iniciar sesion"
- **Resultado Esperado**: Se muestran los formularios correctos. Tab activo se resalta.
- **Notas**: -

### TEST-A16: Registro inline y publicacion
- **Prioridad**: P1
- **Precondiciones**: No estar logueado, paso 7, tab registro
- **Pasos**:
  1. Completar nombre, email, contrasena (min 6 chars), confirmar contrasena
  2. Click "Crear cuenta y publicar"
  3. Esperar proceso de registro
- **Resultado Esperado**: Se crea cuenta en auth, se inserta en clients_db, se hace auto-login, se re-renderiza el paso como resumen con boton "Publicar solicitud".
- **Notas**: Verificar que se envia evento N8N `client_registration_completed` si esta habilitado.

### TEST-A17: Draft persistence
- **Prioridad**: P2
- **Precondiciones**: Haber completado al menos 3 pasos del formulario
- **Pasos**:
  1. Cerrar la pestana del navegador
  2. Volver a abrir `/job-board/request`
- **Resultado Esperado**: Se muestra prompt "Tienes un borrador guardado" con opciones "Continuar borrador" y "Empezar de nuevo". Al continuar, se restauran los datos y el paso.
- **Notas**: El draft expira despues de 7 dias.

---

## B. Feed Publico (`/job-board`) - 13 pruebas

### TEST-B01: Carga inicial del feed
- **Prioridad**: P1
- **Precondiciones**: Existen solicitudes abiertas en la DB
- **Pasos**:
  1. Abrir `/job-board` en el navegador
- **Resultado Esperado**: Se muestra el header con "WE OTZI | JOB BOARD", el hero con busqueda, filtros de estilo, filtros avanzados y grid de cards. El contador muestra "X solicitudes encontradas".
- **Notas**: -

### TEST-B02: Cards muestran informacion correcta
- **Prioridad**: P1
- **Precondiciones**: Hay solicitudes con datos completos
- **Pasos**:
  1. Revisar las cards en el grid
- **Resultado Esperado**: Cada card muestra: imagen de referencia (o placeholder Bauhaus), codigo JB-XXXXX, descripcion truncada, tags de estilo/tamano/color, ciudad, zona del cuerpo, numero de postulaciones, dias restantes, presupuesto, boton "POSTULARME" o "INICIA SESION".
- **Notas**: -

### TEST-B03: Filtro por estilo
- **Prioridad**: P1
- **Precondiciones**: Hay solicitudes con diferentes estilos
- **Pasos**:
  1. Click en boton de estilo "Realismo"
  2. Verificar que se filtran las cards
  3. Click en "Realismo" de nuevo para desactivar
- **Resultado Esperado**: Solo se muestran cards que contienen "Realismo" en su estilo. El boton se marca como active. Al desactivar, se muestran todas. Aparece chip "Estilo: Realismo" en filtros activos.
- **Notas**: -

### TEST-B04: Filtro por ciudad
- **Prioridad**: P2
- **Precondiciones**: Hay solicitudes de diferentes ciudades
- **Pasos**:
  1. Seleccionar una ciudad del dropdown
- **Resultado Esperado**: Solo se muestran solicitudes de esa ciudad. El dropdown muestra el conteo por ciudad.
- **Notas**: -

### TEST-B05: Filtro por tamano
- **Prioridad**: P2
- **Precondiciones**: Hay solicitudes con diferentes tamanos
- **Pasos**:
  1. Seleccionar "Mediano (10-20 cm)" del dropdown
- **Resultado Esperado**: Se filtran solicitudes con tamano mediano. El mapping incluye variantes: "mediano", "medium".
- **Notas**: -

### TEST-B06: Filtro por presupuesto
- **Prioridad**: P2
- **Precondiciones**: Hay solicitudes con presupuestos variados
- **Pasos**:
  1. Seleccionar "Hasta $200 USD"
- **Resultado Esperado**: Solo se muestran solicitudes con presupuesto efectivo <= 200. El presupuesto efectivo es budget_max o budget_min.
- **Notas**: -

### TEST-B07: Busqueda por texto
- **Prioridad**: P1
- **Precondiciones**: Hay solicitudes con datos variados
- **Pasos**:
  1. Escribir "dragon" en el campo de busqueda
  2. Esperar 300ms (debounce)
- **Resultado Esperado**: Se filtran solicitudes que contengan "dragon" en descripcion, ciudad, zona del cuerpo, estilos o codigo. El contador se actualiza.
- **Notas**: La busqueda es case-insensitive.

### TEST-B08: Ordenamiento
- **Prioridad**: P2
- **Precondiciones**: Hay multiples solicitudes
- **Pasos**:
  1. Cambiar orden a "Presupuesto: Mayor"
  2. Cambiar a "Fecha limite"
  3. Volver a "Mas recientes"
- **Resultado Esperado**: Las cards se reordenan correctamente segun el criterio seleccionado.
- **Notas**: -

### TEST-B09: Combinacion de filtros
- **Prioridad**: P2
- **Precondiciones**: Hay solicitudes variadas
- **Pasos**:
  1. Seleccionar estilo "Realismo"
  2. Seleccionar tamano "Grande"
  3. Escribir "Buenos Aires" en busqueda
- **Resultado Esperado**: Se aplican los 3 filtros en AND. Los chips activos muestran los 3 filtros. Se puede limpiar cada uno individualmente o todos con "Limpiar filtros".
- **Notas**: -

### TEST-B10: Estado vacio
- **Prioridad**: P2
- **Precondiciones**: Filtros que no matchean ninguna solicitud
- **Pasos**:
  1. Aplicar filtros que no tengan resultados
- **Resultado Esperado**: Se muestra el estado vacio: "No hay solicitudes con esos criterios" con boton "Ver todas las solicitudes".
- **Notas**: -

### TEST-B11: Paginacion
- **Prioridad**: P2
- **Precondiciones**: Hay mas de 20 solicitudes abiertas
- **Pasos**:
  1. Verificar que se muestra la paginacion
  2. Click "Siguiente pagina"
  3. Click "Pagina anterior"
- **Resultado Esperado**: Se muestran 20 items por pagina. La paginacion muestra "Pagina X de Y". Los botones se desactivan en los extremos. Scroll to top al cambiar pagina.
- **Notas**: -

### TEST-B12: Click en card como no-artista
- **Prioridad**: P1
- **Precondiciones**: No estar logueado como artista
- **Pasos**:
  1. Click en cualquier card de solicitud
- **Resultado Esperado**: Se abre un modal con los detalles de la solicitud (descripcion, estilos, tamano, color, zona, ciudad, presupuesto, galeria de referencias) y un prompt de login: "Inicia sesion como artista para postularte" con botones "Iniciar Sesion" y "Registrarme".
- **Notas**: -

### TEST-B13: Header auth state
- **Prioridad**: P3
- **Precondiciones**: Probar en 3 estados: no logueado, logueado como cliente, logueado como artista
- **Pasos**:
  1. Verificar el boton de auth en el header en cada estado
- **Resultado Esperado**: No logueado: "Iniciar Sesion" apunta a /registerclosedbeta. Cliente: "Mi Cuenta" apunta a /client/dashboard. Artista: muestra username o "Mi Panel" apuntando a /artist/dashboard.
- **Notas**: -

---

## C. Dashboard del Cliente (`/client/dashboard`) - 11 pruebas

### TEST-C01: Tab Solicitudes visible
- **Prioridad**: P1
- **Precondiciones**: Logueado como cliente
- **Pasos**:
  1. Acceder a `/client/dashboard`
  2. Verificar que existe el tab "Solicitudes"
- **Resultado Esperado**: El tab "Solicitudes" aparece en la barra de tabs junto a Activas, Pendientes, Completadas. Muestra un badge con el conteo si hay solicitudes.
- **Notas**: -

### TEST-C02: Carga del tab Solicitudes
- **Prioridad**: P1
- **Precondiciones**: Cliente con solicitudes creadas
- **Pasos**:
  1. Click en tab "Solicitudes"
- **Resultado Esperado**: Se oculta la lista de cotizaciones y se muestra la lista de solicitudes del Job Board. Cada solicitud muestra: codigo, estado (con color), descripcion, zona, presupuesto, postulaciones (total y nuevas).
- **Notas**: -

### TEST-C03: URL param tab=solicitudes
- **Prioridad**: P2
- **Precondiciones**: Cliente con solicitudes
- **Pasos**:
  1. Acceder a `/client/dashboard?tab=solicitudes`
- **Resultado Esperado**: El dashboard carga directamente en el tab de Solicitudes del Job Board.
- **Notas**: Este es el destino tras publicar una solicitud.

### TEST-C04: Estado vacio de solicitudes
- **Prioridad**: P2
- **Precondiciones**: Cliente sin solicitudes
- **Pasos**:
  1. Click en tab "Solicitudes"
- **Resultado Esperado**: Muestra "No tienes solicitudes en el Job Board" con enlace "Publicar Solicitud" que lleva a `/job-board/request`.
- **Notas**: -

### TEST-C05: Ver postulaciones de una solicitud
- **Prioridad**: P1
- **Precondiciones**: Solicitud con postulaciones
- **Pasos**:
  1. Click en una solicitud o "Ver Postulaciones"
- **Resultado Esperado**: Se abre modal con el codigo de la solicitud y todas las postulaciones. Cada postulacion muestra: foto del artista, nombre, ubicacion, estilos, estado (badge color), mensaje, precio estimado, sesiones, link al perfil.
- **Notas**: -

### TEST-C06: Solicitud sin postulaciones
- **Prioridad**: P2
- **Precondiciones**: Solicitud sin postulaciones
- **Pasos**:
  1. Click en la solicitud
- **Resultado Esperado**: Modal muestra "Aun no hay postulaciones para esta solicitud. Comparte el enlace del Job Board para atraer mas artistas."
- **Notas**: -

### TEST-C07: Aceptar postulacion
- **Prioridad**: P1
- **Precondiciones**: Solicitud con postulacion pendiente
- **Pasos**:
  1. Click "Aceptar" en una postulacion
  2. Confirmar en el dialogo
- **Resultado Esperado**: Se crea una cotizacion. Se muestra alert "Artista aceptado. Se ha creado una cotizacion." El modal se cierra. La lista se refresca. La solicitud cambia a estado "Aceptada". Las demas postulaciones se rechazan automaticamente.
- **Notas**: Verificar en quotations_db que la cotizacion tiene source='job_board'.

### TEST-C08: Rechazar postulacion
- **Prioridad**: P1
- **Precondiciones**: Solicitud con postulacion pendiente
- **Pasos**:
  1. Click "Rechazar" en una postulacion
  2. Confirmar en el dialogo
- **Resultado Esperado**: La postulacion cambia a estado "Rechazada". El modal se refresca mostrando el nuevo estado. Las demas postulaciones no se afectan.
- **Notas**: -

### TEST-C09: Link a cotizacion creada
- **Prioridad**: P2
- **Precondiciones**: Postulacion ya aceptada
- **Pasos**:
  1. Abrir modal de la solicitud aceptada
- **Resultado Esperado**: La postulacion aceptada muestra un enlace "Ver Cotizacion Creada" que lleva a `/my-quotations`.
- **Notas**: -

### TEST-C10: Badge de conteo se actualiza
- **Prioridad**: P3
- **Precondiciones**: Cliente con solicitudes
- **Pasos**:
  1. Verificar el badge junto al tab "Solicitudes"
  2. Publicar una nueva solicitud
  3. Verificar que el badge se incrementa
- **Resultado Esperado**: El badge muestra el numero correcto de solicitudes y se actualiza al refrescar.
- **Notas**: -

### TEST-C11: Realtime - nueva postulacion
- **Prioridad**: P2
- **Precondiciones**: Cliente en tab Solicitudes. Otro usuario (artista) listo para postularse.
- **Pasos**:
  1. Mantener abierto el dashboard del cliente en tab Solicitudes
  2. Desde otra sesion, hacer que un artista se postule a una de sus solicitudes
- **Resultado Esperado**: La lista se refresca automaticamente mostrando la nueva postulacion (conteo incrementa) sin necesidad de recargar la pagina.
- **Notas**: Funciona via Supabase Realtime channel "jb-applications-updates".

---

## D. Panel del Artista - 8 pruebas

### TEST-D01: Enlace a Job Board desde dashboard
- **Prioridad**: P2
- **Precondiciones**: Logueado como artista
- **Pasos**:
  1. Acceder a `/artist/dashboard`
  2. Buscar enlace "Job Board" en el panel
- **Resultado Esperado**: Existe un boton/enlace rojo "Job Board" que lleva a `/job-board`.
- **Notas**: -

### TEST-D02: Postulacion completa a una solicitud
- **Prioridad**: P1
- **Precondiciones**: Logueado como artista, hay solicitudes abiertas
- **Pasos**:
  1. Ir a `/job-board`
  2. Click en "POSTULARME" de una solicitud
  3. Llenar mensaje (min 10 chars), precio estimado, sesiones, disponibilidad
  4. Click "Enviar postulacion"
- **Resultado Esperado**: Modal se cierra. Toast "Postulacion enviada con exito" aparece. La card actualiza el conteo de postulaciones. El artista no puede postularse de nuevo a la misma solicitud.
- **Notas**: -

### TEST-D03: Validacion de mensaje minimo
- **Prioridad**: P2
- **Precondiciones**: Modal de postulacion abierto
- **Pasos**:
  1. Escribir mensaje con menos de 10 caracteres
  2. Click "Enviar postulacion"
- **Resultado Esperado**: Toast "El mensaje debe tener al menos 10 caracteres". No se envia.
- **Notas**: -

### TEST-D04: Doble postulacion a la misma solicitud
- **Prioridad**: P1
- **Precondiciones**: Artista ya postulado a una solicitud
- **Pasos**:
  1. Intentar postularse de nuevo a la misma solicitud
- **Resultado Esperado**: Toast "Ya te postulaste a esta solicitud" de tipo warning. No se crea nueva postulacion.
- **Notas**: -

### TEST-D05: Solicitud con max postulaciones alcanzado
- **Prioridad**: P2
- **Precondiciones**: Solicitud con application_count >= max_applications
- **Pasos**:
  1. Intentar postularse
- **Resultado Esperado**: Toast "Esta solicitud ya alcanzo el maximo de postulaciones". No se permite postularse.
- **Notas**: Tambien bloqueado por RLS a nivel de DB.

### TEST-D06: Vista "Mis Postulaciones" en my-quotations
- **Prioridad**: P1
- **Precondiciones**: Artista con postulaciones enviadas
- **Pasos**:
  1. Ir a `/my-quotations`
  2. Click en enlace/nav "Mis Postulaciones" o "Job Board"
- **Resultado Esperado**: Se muestra una vista con tabla grid de postulaciones: columnas Fecha, Idea, Ciudad, Zona, Presupuesto, Estado, Mi Precio. Cada fila corresponde a una postulacion.
- **Notas**: -

### TEST-D07: Estado de postulacion aceptada con link
- **Prioridad**: P2
- **Precondiciones**: Artista con postulacion aceptada
- **Pasos**:
  1. Ver la postulacion aceptada en "Mis Postulaciones"
- **Resultado Esperado**: El estado muestra "Aceptada" en verde. Aparece un enlace "VER" que lleva a la cotizacion en `/my-quotations`.
- **Notas**: -

### TEST-D08: Vista vacia de postulaciones
- **Prioridad**: P3
- **Precondiciones**: Artista sin postulaciones
- **Pasos**:
  1. Ir a "Mis Postulaciones"
- **Resultado Esperado**: Muestra "No tienes postulaciones aun" con enlace "Explorar Job Board" que lleva a `/job-board`.
- **Notas**: -

---

## E. Endpoint Accept (`POST /api/job-board/accept-application`) - 7 pruebas

### TEST-E01: Accept exitoso
- **Prioridad**: P1
- **Precondiciones**: Solicitud con postulacion pendiente
- **Pasos**:
  1. Enviar POST con applicationId y requestId validos
- **Resultado Esperado**: Response 200 con `{ success: true, quoteId: "QN-...", message: "..." }`. En DB: cotizacion creada en quotations_db con source='job_board'. Application con status='accepted'. Otras applications con status='rejected'. Request con status='accepted', is_public=false.
- **Notas**: -

### TEST-E02: Parametros faltantes
- **Prioridad**: P2
- **Precondiciones**: Ninguna
- **Pasos**:
  1. Enviar POST sin applicationId
  2. Enviar POST sin requestId
- **Resultado Esperado**: Response 400 con `{ success: false, error: "applicationId and requestId are required" }`.
- **Notas**: -

### TEST-E03: Application no existente
- **Prioridad**: P2
- **Precondiciones**: Ninguna
- **Pasos**:
  1. Enviar POST con applicationId que no existe en la DB
- **Resultado Esperado**: Response 500 con `{ success: false, error: "Application not found" }`.
- **Notas**: -

### TEST-E04: Request no existente
- **Prioridad**: P2
- **Precondiciones**: Ninguna
- **Pasos**:
  1. Enviar POST con requestId que no existe en la DB
- **Resultado Esperado**: Response 500 con `{ success: false, error: "Request not found" }`.
- **Notas**: -

### TEST-E05: Datos de cotizacion creada correctos
- **Prioridad**: P1
- **Precondiciones**: Accept exitoso (TEST-E01)
- **Pasos**:
  1. Consultar la cotizacion creada en quotations_db
  2. Verificar que los datos del tatuaje, cliente y artista se mapearon correctamente
- **Resultado Esperado**: tattoo_body_part, tattoo_idea_description, tattoo_size, tattoo_style, tattoo_color_type coinciden con la request. client_full_name, client_email, client_city_residence del cliente. artist_name, artist_id, artist_email del artista. source = 'job_board'. job_board_request_id apunta a la request.
- **Notas**: -

### TEST-E06: Rechazo automatico de otras postulaciones
- **Prioridad**: P1
- **Precondiciones**: Solicitud con 3+ postulaciones pendientes
- **Pasos**:
  1. Aceptar una postulacion
  2. Verificar estado de las demas
- **Resultado Esperado**: La postulacion aceptada tiene status='accepted'. Todas las demas postulaciones pendientes/viewed tienen status='rejected' con decided_at.
- **Notas**: -

### TEST-E07: Request se oculta del feed
- **Prioridad**: P1
- **Precondiciones**: Accept exitoso
- **Pasos**:
  1. Ir al feed publico `/job-board`
  2. Buscar la solicitud aceptada
- **Resultado Esperado**: La solicitud ya no aparece en el feed publico. Su is_public = false y status = 'accepted'.
- **Notas**: -

---

## F. Seguridad - 9 pruebas

### TEST-F01: RLS - Solo se ven solicitudes abiertas y publicas
- **Prioridad**: P1
- **Precondiciones**: Hay solicitudes con diferentes estados
- **Pasos**:
  1. Hacer query con anon key: `SELECT * FROM job_board_requests`
- **Resultado Esperado**: Solo se devuelven solicitudes con status='open' AND is_public=true. Las cerradas, aceptadas, expiradas, draft no son visibles.
- **Notas**: -

### TEST-F02: RLS - Cliente solo ve sus propias solicitudes
- **Prioridad**: P1
- **Precondiciones**: Dos clientes con solicitudes
- **Pasos**:
  1. Logueado como Cliente A, consultar job_board_requests
  2. Verificar que no ve solicitudes de Cliente B (excepto las publicas/abiertas)
- **Resultado Esperado**: Cliente A ve sus propias solicitudes (cualquier estado) + solicitudes publicas/abiertas de otros.
- **Notas**: -

### TEST-F03: RLS - Artista no puede crear solicitudes
- **Prioridad**: P2
- **Precondiciones**: Logueado como artista
- **Pasos**:
  1. Intentar INSERT en job_board_requests con client_user_id diferente al propio
- **Resultado Esperado**: Error de RLS. Solo el propietario (client_user_id = auth.uid()) puede crear.
- **Notas**: -

### TEST-F04: RLS - Artista solo ve sus postulaciones
- **Prioridad**: P1
- **Precondiciones**: Dos artistas con postulaciones
- **Pasos**:
  1. Logueado como Artista A, consultar job_board_applications
- **Resultado Esperado**: Solo ve sus propias postulaciones. No puede ver las de Artista B.
- **Notas**: -

### TEST-F05: RLS - Postulacion solo a solicitudes abiertas
- **Prioridad**: P1
- **Precondiciones**: Solicitud con status='accepted'
- **Pasos**:
  1. Intentar insertar en job_board_applications con request_id de la solicitud cerrada
- **Resultado Esperado**: Error de RLS. La politica valida que request.status = 'open' AND application_count < max_applications.
- **Notas**: -

### TEST-F06: RLS - Adjuntos solo visibles para solicitudes abiertas/publicas
- **Prioridad**: P2
- **Precondiciones**: Solicitud cerrada con adjuntos
- **Pasos**:
  1. Intentar consultar job_board_attachments de solicitud cerrada con anon key
- **Resultado Esperado**: No se devuelven adjuntos. Solo son visibles si la request es open y publica.
- **Notas**: -

### TEST-F07: Escape HTML en contenido renderizado
- **Prioridad**: P1
- **Precondiciones**: Crear solicitud con XSS en descripcion
- **Pasos**:
  1. Publicar solicitud con descripcion: `<script>alert('xss')</script>`
  2. Ver la solicitud en el feed
  3. Ver la solicitud en el dashboard del cliente
- **Resultado Esperado**: El HTML se muestra como texto plano, no se ejecuta. La funcion escapeHtml() convierte < > " ' & en entidades HTML.
- **Notas**: -

### TEST-F08: Endpoint accept sin credenciales server
- **Prioridad**: P2
- **Precondiciones**: Variables SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY no configuradas
- **Pasos**:
  1. Enviar POST a /api/job-board/accept-application
- **Resultado Esperado**: Response 500 con `{ success: false, error: "Server configuration incomplete" }`.
- **Notas**: -

### TEST-F09: Limite de archivos y tamano en upload
- **Prioridad**: P2
- **Precondiciones**: Estar en paso 5 del wizard
- **Pasos**:
  1. Intentar subir 5 archivos (max es 4)
  2. Intentar subir archivo > 5MB
  3. Intentar subir tipo no permitido (.gif, .pdf)
- **Resultado Esperado**: Todos los casos son rechazados con mensajes apropiados. Las constantes MAX_FILES=4, MAX_FILE_SIZE=5MB, ACCEPTED_IMAGE_TYPES se validan en el frontend.
- **Notas**: -

---

## G. Responsive / Mobile - 7 pruebas

### TEST-G01: Wizard en mobile (< 600px)
- **Prioridad**: P1
- **Precondiciones**: Viewport < 600px
- **Pasos**:
  1. Navegar por todos los pasos del wizard en mobile
- **Resultado Esperado**: El wizard es usable. El grid de opciones cambia de 3 a 2 columnas. Los botones tienen padding reducido. El area de upload se adapta. El formulario de registro/login es legible.
- **Notas**: -

### TEST-G02: Feed en mobile (< 600px)
- **Prioridad**: P1
- **Precondiciones**: Viewport < 600px
- **Pasos**:
  1. Abrir `/job-board` en mobile
- **Resultado Esperado**: Grid de cards pasa a 1 columna. El header se compacta (50px). Los filtros de estilo hacen scroll horizontal. El buscador se reduce en tamano. Las cards son legibles.
- **Notas**: -

### TEST-G03: Feed en tablet (768px)
- **Prioridad**: P2
- **Precondiciones**: Viewport ~768px
- **Pasos**:
  1. Abrir `/job-board` en tablet
- **Resultado Esperado**: Grid de cards muestra 2 columnas. El header se adapta. Los filtros se ajustan.
- **Notas**: -

### TEST-G04: Feed en desktop medio (1200px)
- **Prioridad**: P3
- **Precondiciones**: Viewport ~1200px
- **Pasos**:
  1. Abrir `/job-board`
- **Resultado Esperado**: Grid muestra 3 columnas.
- **Notas**: -

### TEST-G05: Feed en desktop ancho (> 1200px)
- **Prioridad**: P3
- **Precondiciones**: Viewport > 1200px
- **Pasos**:
  1. Abrir `/job-board`
- **Resultado Esperado**: Grid muestra 4 columnas. Max-width de 1520px centrado.
- **Notas**: -

### TEST-G06: Modal de postulacion en mobile
- **Prioridad**: P1
- **Precondiciones**: Viewport < 600px, logueado como artista
- **Pasos**:
  1. Abrir modal de postulacion en mobile
  2. Navegar por el formulario
  3. Enviar postulacion
- **Resultado Esperado**: Modal ocupa casi toda la pantalla (max-height: 95vh). El formulario es scrollable. Los campos son usables con teclado mobile.
- **Notas**: -

### TEST-G07: Wizard en pantalla muy estrecha (< 400px)
- **Prioridad**: P3
- **Precondiciones**: Viewport < 400px
- **Pasos**:
  1. Navegar el wizard
- **Resultado Esperado**: El contenido sigue siendo legible. El budget row se apila verticalmente. Los resumen rows se apilan en columna.
- **Notas**: CSS tiene media query @media (max-width: 400px) para el feed.

---

## H. Edge Cases - 9 pruebas

### TEST-H01: Solicitud expirada no aparece en feed
- **Prioridad**: P1
- **Precondiciones**: Solicitud con expires_at en el pasado
- **Pasos**:
  1. Ejecutar funcion expire_old_job_board_requests()
  2. Verificar el feed publico
- **Resultado Esperado**: La solicitud tiene status='expired', is_public=false. No aparece en el feed.
- **Notas**: La funcion de expiracion debe ser llamada manualmente o via cron.

### TEST-H02: Solicitud sin imagenes de referencia
- **Prioridad**: P2
- **Precondiciones**: Publicar solicitud sin subir imagenes
- **Pasos**:
  1. Completar el wizard saltando el paso de referencias
  2. Verificar la card en el feed
- **Resultado Esperado**: La card muestra un placeholder Bauhaus geometrico (circulo rojo, triangulo azul, cuadrado amarillo) en lugar de imagen. reference_images_count = 0.
- **Notas**: -

### TEST-H03: Solicitud con todos los campos opcionales vacios
- **Prioridad**: P2
- **Precondiciones**: Crear solicitud con solo los campos requeridos
- **Pasos**:
  1. Completar solo zona, descripcion, tamano
  2. Saltar estilos, color, preferencias
  3. Publicar
- **Resultado Esperado**: La solicitud se crea correctamente. En el feed: estilo muestra "Sin preferencia", color muestra "Sin preferencia", presupuesto muestra "A convenir", ciudad "No especificada".
- **Notas**: -

### TEST-H04: Artista intenta postularse a su propia solicitud
- **Prioridad**: P2
- **Precondiciones**: Un usuario que es tanto cliente como artista
- **Pasos**:
  1. El usuario publica una solicitud como cliente
  2. El mismo usuario intenta postularse como artista
- **Resultado Esperado**: No hay validacion explicita para esto en el codigo actual. La postulacion se crearia. Esto es un edge case que deberia tener validacion en produccion.
- **Notas**: Posible mejora futura.

### TEST-H05: Formatos de estilo inconsistentes
- **Prioridad**: P3
- **Precondiciones**: Solicitudes con tattoo_style en diferentes formatos
- **Pasos**:
  1. Verificar que el parser maneja: string JSON array, string comma-separated, string simple, array nativo
- **Resultado Esperado**: La funcion `parseStyles()` en job-board-feed.js maneja todos los formatos correctamente: JSON array (`["Realismo","Fine Line"]`), comma-separated (`"Realismo, Fine Line"`), string simple (`"Realismo"`).
- **Notas**: -

### TEST-H06: Multiples tabs abiertos del wizard
- **Prioridad**: P3
- **Precondiciones**: Abrir wizard en 2 tabs
- **Pasos**:
  1. Completar paso 1 en Tab A
  2. Completar paso 2 en Tab B
  3. Volver a Tab A e intentar continuar
- **Resultado Esperado**: El draft de localStorage puede sobreescribirse entre tabs. El comportamiento puede ser inconsistente, pero no debe causar errores criticos.
- **Notas**: Edge case aceptable para beta.

### TEST-H07: Sesion expirada durante el wizard
- **Prioridad**: P2
- **Precondiciones**: Iniciar wizard logueado, sesion expira durante el llenado
- **Pasos**:
  1. Iniciar wizard logueado
  2. Esperar a que la sesion expire
  3. Llegar al paso 7 (account gate)
- **Resultado Esperado**: El account gate detecta que no hay sesion y muestra el formulario de login/registro. Los datos del formulario no se pierden porque se mantienen en formData.
- **Notas**: -

### TEST-H08: Navegacion con Enter y Escape
- **Prioridad**: P3
- **Precondiciones**: Wizard cargado
- **Pasos**:
  1. En paso welcome, presionar Enter
  2. En paso con input, presionar Enter (no en textarea)
  3. Presionar Escape para ir atras
- **Resultado Esperado**: Enter en welcome avanza a paso 1. Enter en input avanza al siguiente paso. Enter no se intercepta en textareas (permite newline). Escape vuelve al paso anterior via historyStack.
- **Notas**: -

### TEST-H09: Feed con 0 solicitudes abiertas
- **Prioridad**: P2
- **Precondiciones**: No hay solicitudes abiertas en la DB
- **Pasos**:
  1. Abrir `/job-board`
- **Resultado Esperado**: Se muestra el estado vacio con mensaje y boton "Ver todas las solicitudes". Los filtros de estilo no se renderizan (o muestran conteo 0).
- **Notas**: -

---

## I. Integracion N8N - 5 pruebas

### TEST-I01: Evento job_board_request_created
- **Prioridad**: P2
- **Precondiciones**: Evento habilitado en app-config.json (enabled: true), webhook URL configurado
- **Pasos**:
  1. Publicar una nueva solicitud
  2. Verificar logs del webhook o N8N
- **Resultado Esperado**: Se envia un POST al webhook con el payload completo: request_id, request_code, datos del cliente, datos del tatuaje, presupuesto, dashboard_url.
- **Notas**: Actualmente enabled: false en config. Habilitar para probar.

### TEST-I02: Evento job_board_application_received
- **Prioridad**: P2
- **Precondiciones**: Evento habilitado, artista logueado
- **Pasos**:
  1. Postularse a una solicitud
  2. Verificar logs del webhook
- **Resultado Esperado**: Se envia POST con: application_id, request_id, request_code, datos del artista, mensaje, precio, timestamp.
- **Notas**: -

### TEST-I03: Evento client_registration_completed desde Job Board
- **Prioridad**: P3
- **Precondiciones**: Evento habilitado
- **Pasos**:
  1. Registrarse como nuevo cliente desde el wizard del Job Board
  2. Verificar webhook
- **Resultado Esperado**: Se envia evento client_registration_completed con source: 'job_board'.
- **Notas**: -

### TEST-I04: Eventos N8N deshabilitados
- **Prioridad**: P3
- **Precondiciones**: Eventos con enabled: false (estado actual)
- **Pasos**:
  1. Publicar solicitud
  2. Postularse
- **Resultado Esperado**: No se envian webhooks. No hay errores en consola (la funcion sendN8NEvent maneja el caso graciosamente).
- **Notas**: -

### TEST-I05: Webhook falla
- **Prioridad**: P3
- **Precondiciones**: Evento habilitado con webhook URL invalida
- **Pasos**:
  1. Configurar una URL invalida
  2. Publicar solicitud
- **Resultado Esperado**: La solicitud se publica exitosamente. El error del webhook se logea como console.warn pero no bloquea el flujo principal.
- **Notas**: Los webhooks son fire-and-forget con try/catch.

---

## Resumen de Pruebas

| Categoria | Cantidad | P1 | P2 | P3 |
|-----------|----------|----|----|-----|
| A. Formulario de Solicitud | 17 | 8 | 6 | 3 |
| B. Feed Publico | 13 | 4 | 6 | 3 |
| C. Dashboard del Cliente | 11 | 4 | 5 | 2 |
| D. Panel del Artista | 8 | 3 | 3 | 2 |
| E. Endpoint Accept | 7 | 4 | 3 | 0 |
| F. Seguridad | 9 | 4 | 5 | 0 |
| G. Responsive/Mobile | 7 | 3 | 1 | 3 |
| H. Edge Cases | 9 | 1 | 4 | 4 |
| I. Integracion N8N | 5 | 0 | 2 | 3 |
| **TOTAL** | **88** | **31** | **35** | **20** |

### Orden de Ejecucion Recomendado
1. **Ronda 1 (Smoke Test):** Ejecutar todas las P1 (31 pruebas)
2. **Ronda 2 (Funcional):** Ejecutar todas las P2 (35 pruebas)
3. **Ronda 3 (Completitud):** Ejecutar todas las P3 (20 pruebas)

### Cuentas de Prueba Necesarias
- 1 cuenta de cliente (con solicitudes)
- 1 cuenta de cliente (sin solicitudes)
- 2 cuentas de artista (para probar postulaciones cruzadas)
- 1 sesion anonima (no logueado)
