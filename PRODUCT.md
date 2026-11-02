# We Ötzi

We Ötzi conecta a clientes, tatuadores y estudios. El cliente puede encontrar un artista, enviar una idea y coordinar un trabajo; el artista administra su perfil, oportunidades y actividad; el estudio organiza sus espacios, equipo y operación. El producto existente incluye marketplace, cotizaciones, agenda y herramientas de gestión.

Este archivo registra contexto del producto ya implementado. Sus fuentes son [README](README.md), el [mapa de la aplicación](docs/MAPA_APLICACION.md), las superficies actuales de artista y Estudios y el [Design System compartido](public/shared/css/ds/tokens.css).

## Producto y entorno

La aplicación beta usa Node.js y Express en `server.js`, con páginas HTML/CSS/JavaScript en `public/`. Supabase aporta Auth, PostgreSQL con políticas de acceso y Storage. Los permisos y las asociaciones de datos dependen de la identidad autenticada; un cambio visual debe conservar esos contratos.

`npm run dev:safe` ofrece una preview local con datos ficticios y servicios externos desactivados. La barra **PREVIEW** distingue ese entorno. La preview permite revisar composición, navegación e interacciones simuladas; la beta conectada y sus integraciones requieren evidencia propia.

## Usuarios y tarea prioritaria

La extensión visual de Estudios del 01/11/2026 prioriza que la persona responsable pueda operar su estudio desde un mismo espacio, con acciones y estados claros. El acceso y el dashboard deben conservar los datos y las funciones existentes al aplicar el sistema compartido.

El dashboard reúne doce destinos: Resumen, Perfil, Sedes, Equipo, Spots, Visitas, Operaciones, Inventario, Proveedores, Sponsors, Estadísticas y Cuenta. Operaciones contiene Agenda, Trabajos, Clientes, Facturas y Documentos. El resumen deriva sus valores de las colecciones autenticadas disponibles; debe distinguir una colección vacía de una carga pendiente o fallida.

Estas áreas administran datos reales cuando el runtime se conecta al entorno autorizado. Las fixtures de QA pertenecen al entorno aislado de prueba y no deben reemplazar consultas ni contenido de negocio en el runtime normal. El detalle de implementación y validación está en [Estudios: acceso y dashboard](docs/auditoria-valentina/estudios-diseno.md).

## Continuidad visual

El mundo visual fijado para esta tarea es el sistema Bauhaus que ya utilizan el artista y el sitio: fondos de papel, tinta, acentos azul, amarillo y rojo, tipografía Archivo Black/Inter/JetBrains Mono y controles geométricos. Los valores concretos y estados de los componentes proceden de `public/shared/css/ds/` y los organismos de `public/shared/js/ds/`.

La extensión de Estudios reutiliza esos componentes, `wo-icons.js`, navegación y pie compartidos, y adapta la composición a escritorio, tablet y móvil. Este contexto no autoriza una nueva marca ni sustituye las fuentes del DS. Una acción sin implementación debe informar su disponibilidad real, sin prometer una integración por su apariencia.

## Evidencia y límites

Una entrega necesita comprobar el resultado visible, validaciones, teclado, estados de carga/vacío/error/éxito y responsive. Un guardado simulado o una captura no acredita una escritura remota.

Las pruebas de Auth/OTP, recepción de emails, Storage y RLS reales requieren un entorno autorizado y cuentas de prueba. Los dobles de servicios y RPC usados en QA deben identificarse como simulados. No se certifican correos, archivos almacenados ni permisos remotos sin evidencia correspondiente.
