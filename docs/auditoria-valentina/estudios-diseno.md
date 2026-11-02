# Estudios: acceso y dashboard

Fecha: 01/11/2026. Rama de trabajo: `codex/estudios-diseno`. Versión preparada: `2.2.4`. Este informe describe la implementación local; la publicación se confirma con CI y la versión informada por `/api/release`.

El acceso y el dashboard de Estudios adoptan los componentes y la composición que ya usan el artista y el sitio. El alcance incluye `/studio/login/`, las doce secciones de `/studio/dashboard/`, las cinco áreas de Operaciones y sus editores. Se mantiene el runtime HTML/CSS/JavaScript, los repositorios de datos y `studio-auth.js`. No se agregan migraciones.

## Referencia y continuidad del sistema

Las referencias de esta extensión son [acceso del artista](../../public/artist/login/index.html), [estilos de autenticación](../../public/shared/css/artist-auth-ds.css), [composición del login](../../public/shared/css/artist-login-figma.css), [dashboard del artista](../../public/artist/dashboard/index.html) y [estilos del dashboard](../../public/shared/css/dashboard-redesign.css). El contrato local de trabajo queda en `output/playwright/studio-design-direction.md`; los archivos de `output/` son evidencia local ignorada por Git.

La fuente normativa de color, tipografía y controles sigue en [tokens](../../public/shared/css/ds/tokens.css), [componentes](../../public/shared/css/ds/components.css) y [organismos](../../public/shared/css/ds/organisms.css). Esta entrega extiende ese sistema y no define una identidad nueva ni modifica sus tokens. [PRODUCT.md](../../PRODUCT.md) registra el contexto factual y los límites de esta extensión.

| Regla observada | Aplicación en Estudios |
| --- | --- |
| Papel, tinta y acentos del DS existente | Fondos y bordes usan las variables semánticas; el login conserva el póster azul y amarillo del artista. |
| Archivo Black, Inter y JetBrains Mono | Títulos, contenido y datos auxiliares conservan las familias existentes, con los archivos de fuente locales. |
| Controles geométricos | Botones, campos, pestañas, badges y tablas reutilizan las clases compartidas `wo-*`. |
| Jerarquía por composición, fondos y bordes | Formularios y listas agrupan acciones y ayudas sin introducir una biblioteca de tarjetas alternativa. |
| Navegación y pie compartidos | Los organismos existentes reciben `context="studio"` y muestran destinos propios del estudio. |

La documentación se realizó con el rol alternativo descrito en `impeccable/reference/degraded/documenter.md`, porque el rol original no estaba habilitado. Al tratarse de una extensión, se documenta aquí la aplicación del sistema vigente; no se genera otro catálogo normativo de tokens.

Se conservan desvíos previos de la referencia: colores literales en la composición del artista y vocabulario de sombras duras ya presente en el DS. El azul del póster oscuro pertenece a una pieza decorativa con `aria-hidden="true"`; el enlace de salto sí usa texto claro. Estos rasgos no se reparan globalmente ni se convierten en nuevas reglas de marca en esta tarea. La revisión visual final utiliza un revisor fresco como sustituto del rol original no disponible; su alcance y resultado deben acompañar el cierre.

## Qué cambia

El [login](../../public/studio/login/index.html) reutiliza la composición dividida del artista. [Su controlador](../../public/shared/js/studio-login.js) conserva las llamadas de acceso y recuperación del servicio existente, con estados de espera, error y éxito, validación de contraseña repetida y recorrido por código o enlace de recuperación. Los controles bloquean envíos simultáneos y los errores pueden recibir foco. Los enlaces respetan el prefijo de beta o preview.

El [dashboard](../../public/studio/dashboard/index.html) incorpora un resumen alimentado por las colecciones autenticadas ya cargadas: estudio, sedes, equipo y spots. [El resumen](../../public/shared/js/studio-dashboard-shell.js) distingue carga, vacío, datos disponibles y error parcial; muestra una raya cuando una colección falla, en lugar de presentar cero como dato válido. Sus accesos llevan a las secciones existentes.

| Sección | Alcance visual y funcional conservado |
| --- | --- |
| Resumen | Sedes activas, artistas activos, spots abiertos y accesos a las áreas de gestión. |
| Perfil | Datos públicos, portada, logo y galería; guardado mediante el repositorio existente. |
| Sedes | Edición de espacios, sede principal y alternativa de dirección manual. |
| Equipo | Búsqueda e invitación de artistas, roles, sedes y tabla de miembros. |
| Spots | Listado, editor, adjuntos y postulaciones. |
| Visitas | Solicitudes Travel con estados y acciones de confirmar o rechazar. |
| Operaciones | Agenda, Trabajos, Clientes, Facturas y Documentos. |
| Inventario | Existencias, movimientos y señal de reposición. |
| Proveedores | Listado y editor de proveedores. |
| Sponsors | Listado, editor y asignación de artistas. |
| Estadísticas | Resumen agregado y rendimiento por artista, respetando la moneda de los datos. |
| Cuenta | Datos de la cuenta y acciones existentes de acceso. |

La cabecera conserva los destinos principales en escritorio y el menú ofrece las doce secciones en tablet y móvil. La pestaña activa se sincroniza con el hash y con `aria-current`; solo queda visible un panel. El menú admite clic, flecha abajo, Escape, clic fuera y cierre al navegar. El pie enlaza al centro de ayuda público; los documentos legales sin contenido disponible muestran un aviso explícito.

Los formularios se adaptan de dos columnas a una. Las tablas conservan sus datos y acciones dentro de regiones con desplazamiento horizontal y foco, sin ensanchar la página. Las reglas específicas están en [dashboard](../../public/shared/css/studio-dashboard-ds.css) y [operaciones](../../public/shared/css/studio-dashboard-ops-ds.css).

## Componentes compartidos y correcciones de regresión

- [Organismos](../../public/shared/js/ds/organisms.js): variante de navegación y pie para Estudios, con destinos reales y limpieza de listeners al volver a enlazar el menú.
- [Iconos](../../public/shared/js/wo-icons.js): permite una base local opcional. Estudios usa los SVG Feather incluidos en `public/shared/assets/feather-studio/`, sin depender de la carga de FontAwesome.
- [Uploader](../../public/shared/js/weotzi-uploader.js): opción `designSystem` para controles e iconos compartidos, nombres accesibles, estado anunciado y conservación del vínculo con el label. El comportamiento previo continúa disponible para los consumidores que no activan la opción.
- Facturas: los conceptos se leen mediante atributos `data-field`, evitando que las clases añadidas por el DS rompan los selectores de descripción, cantidad y precio. Se mantienen las validaciones antes de llamar a `saveInvoice`.
- Sponsors: los controles usan identificadores `sponsor-*`, separados de los `sp-*` del editor de spots. La prueba focal comprueba que guardar un sponsor no ejecuta ni modifica el guardado de un spot abierto.
- Estadísticas y Visitas: escuchan `studio:tabchange`, por lo que la navegación desde el menú móvil también vuelve a cargar sus datos. La prueba de estadísticas registró un trabajo ficticio de 120 y comprobó el cambio del agregado de 520 a 640 usando una vista local del simulador.
- Galería: un fallo total o parcial muestra el error y cuántos archivos se subieron; ya no anuncia «¡Listo!» cuando alguna carga falla. Se conservan los enlaces de las cargas completadas.

## Validación y evidencia

Las pruebas de navegador se realizaron en Chromium sobre `npm run dev:safe`, con la barra **PREVIEW** y datos QA ficticios. La fixture `output/playwright/studio-design-fixture.js` está restringida a localhost y al runtime simulado; instala relaciones, vistas y dobles de RPC solo en el navegador de prueba. No se importa desde `public/` ni reemplaza datos en el runtime normal.

| Comprobación | Resultado y límite |
| --- | --- |
| Doce paneles y cinco subáreas de Operaciones | Recorridos a 1440, 768 y 390 px, con un único panel visible y sin errores JavaScript en el recorrido. Se abrieron también los editores. |
| Responsive final | Resumen y login a 1440, 768 y 390 px; resumen adicional a 320 px. El ajuste final del botón «Modo cliente» elimina el desbordamiento de 4 px detectado a 390 px; a 320 px la cabecera se redistribuye. |
| Navegación y teclado | Apertura y cierre del menú, Escape, navegación y foco; las pruebas focales cubren además flecha abajo y clic fuera. |
| Guardado y recarga | Perfil, proveedor y factura conservaron los datos en el almacén del simulador después de recargar. No acredita persistencia remota. |
| Resumen | Estados con datos, vacío y error parcial de sedes ejercitados con la fixture. |
| Autenticación y archivos | Recuperación por código y estados de upload individual, galería y fallo parcial ejercitados con dobles de prueba. No hubo envío de correo ni subida remota certificada. |
| Regresiones automatizadas | Pruebas de navegación/pie y separación sponsor/spot incorporadas en `tests/studio-product-navigation.test.js` y `tests/studio-dashboard-ops-ui.test.js`. |
| Suite de entrega | `npm test`: **421/421 aprobadas** para la versión `2.2.4`. |
| Política de entrega | `npm run check:release`: aprobado para `2.2.4`. Confirmación posterior: enlace de salto oculto sin foco y accesible por teclado; selects de Equipo legibles (rol 165 px, sede 247 px); sin desbordamiento del documento a 1440/768/390/320 px. |

Las capturas versionadas permiten revisar la composición final:

| Vista | Escritorio | Móvil |
| --- | --- | --- |
| Resumen del dashboard | [1440 px](estudios-diseno/evidencia/dashboard-desktop.png) | [390 px](estudios-diseno/evidencia/dashboard-mobile.png) |
| Acceso | [1440 px](estudios-diseno/evidencia/login-desktop.png) | [390 px](estudios-diseno/evidencia/login-mobile.png) |

La evidencia local adicional está en `output/playwright/`: capturas `studio-summary-final-*`, `studio-login-final-*`, paneles, subáreas, editores y estados vacío/error. Algunas capturas iniciales de editores preceden a la corrección de 4 px; la comprobación final de tamaño corresponde a las capturas `studio-summary-final-*` y al recorrido posterior al ajuste.

No se acreditan Auth/OTP real, recepción de emails, RLS, buckets de Storage, firmas de contratos Travel, cobros ni efectos secundarios reales de completar una reserva. La persistencia observada es local y las vistas/RPC de la fixture no representan una validación de permisos. No se probó un dispositivo físico.

La revisión visual independiente utilizó un revisor alternativo porque el rol específico de la skill no estaba habilitado. El veredicto final fue `ship` al puntuar como resueltos los tres hallazgos: enlace de salto, ancho de los selectores de Equipo y contexto `PRODUCT.md`. Esta confirmación se limita a esos hallazgos.

## Entrega y reversión

La entrega preparada es `2.2.4`, rama `codex/estudios-diseno`. Se publica por PR a `main`, CI de la SHA exacta y controlador privado. El estado efectivo y la SHA activa se consultan en [api/release](https://beta.weotzi.com/api/release); la evidencia de CI y publicación se adjunta al PR y al cierre de la tarea. No se infiere una URL de preview desde el nombre de la rama.

La versión pública previa informada para recuperación es `2.2.3`, SHA `54b43a5db4d667c69ceaca208a24515ad3ee009d`; debe verificarse frente al controlador antes de un rollback operativo. Para una corrección integrada, el procedimiento normal es `git revert` de los commits de esta entrega en una rama y un PR nuevo. Isaí ejecuta el rollback operativo mediante el [runbook del controlador](../../deployments/hostinger/RELEASE-RUNBOOK.md), conservando la evidencia de la versión desplegada.

Esta entrega no requiere una reversión de esquema. Revertir código no elimina ni restaura los datos que pudiera haber guardado una cuenta en un entorno real.
