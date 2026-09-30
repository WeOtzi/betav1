# Handoff para Valentina — We Ötzi

Fecha: 30 de septiembre de 2026. Responsable del proyecto y de aprobar publicaciones: Isaí.

Esta guía explica cómo trabajar en este PC con tu propia cuenta, conversar con un agente IA, aplicar el rediseño pendiente y probar la aplicación. Isaí revisa los cambios antes de incorporarlos a la beta principal.

**Estado comprobado al 30/09:** GitHub, CI, publicación automática de beta, preview de rama y rollback real funcionan. La entrega **2.1.1**, commit `ee702262fb765744b1df5dc1f42b68eb1da9c5ef`, tiene la evidencia histórica detallada abajo; comprueba la versión actual antes de cada prueba. Isaí ya creó la cuenta Windows estándar **Dev**. Quedan aplicar y comprobar el aislamiento y el clon independiente, informar tu identidad GitHub y verificar la [protección de `main`](MAIN-PROTECTION.md) antes de otorgarte escritura. Los scripts de [preparación Windows](DEV-WINDOWS-SETUP.md) y [preparación GitHub](DEV-GITHUB-SETUP.md) los ejecuta Isaí manualmente; su presencia no significa que los permisos ya estén aplicados.

## 1. Empieza aquí

1. Cuando Isaí haya preparado y comprobado el aislamiento, inicia sesión con **el usuario Windows estándar Dev**, tu cuenta de ChatGPT/Codex y tu cuenta de GitHub.
2. Abre únicamente **`C:\WeOtzi-Dev\weotzi-unified`** en Codex, después de que Isaí haya preparado y comprobado tu clon de [WeOtzi/betav1](https://github.com/WeOtzi/betav1).
3. Pide a la IA: “Lee AGENTS.md y el handoff de Valentina. Revisa la rama y el estado de Git. Explícame cómo arrancar el entorno seguro y comprueba que no usa datos ni correos reales”.
4. Abre PowerShell en esa carpeta, instala dependencias con `npm ci --ignore-scripts` y arranca **`npm run dev:safe`**. Abre **http://localhost:4647**. Si ya hay un proceso en ese puerto, identifica de quién es antes de cerrarlo.
5. Lee [tu primera tarea](VALENTINA-FIRST-TASK.md). El primer entregable es un inventario comprobado de pantallas y defectos, seguido de una corrección pequeña que puedas revisar de principio a fin.

Antes de empezar, confirma con Isaí que tu usuario Windows y clon están comprobados, la protección de `main` está activa, tu acceso de GitHub está habilitado y puedes abrir los tres archivos Figma. Estas identidades usan tus cuentas; no son las de Isaí. El nombre de usuario y correo de GitHub deben ser los tuyos al firmar commits. Mientras esos requisitos estén pendientes, puedes recorrer la preview ya publicada y preparar el inventario, pero no iniciar la publicación de ramas con una cuenta prestada.

## 2. Qué es We Ötzi

La aplicación ayuda a una persona a encontrar un tatuador, enviarle una idea, recibir una cotización y coordinar el trabajo. El tatuador administra su perfil, trabajos, cotizaciones, conversaciones y agenda. Los estudios administran su equipo, sedes, oportunidades y operaciones.

Una identidad puede usar **modo cliente y modo tatuador** con el mismo correo y contraseña. El modo cambia el panel que se muestra; los permisos y datos siguen ligados al usuario autenticado. Los estudios, soporte y backoffice tienen recorridos propios.

Tu primera misión se concentra en **artistas y clientes**: revisar el inventario de Laura, compararlo con el rediseño, aplicar lo que falta y verificar los flujos. Una pantalla puede parecer correcta y tener una acción rota; ambas cosas deben comprobarse.

## 3. Dónde trabajas y dónde se publica

| Lugar | Para qué sirve | Cómo se actualiza |
| --- | --- | --- |
| `C:\WeOtzi-Dev\weotzi-unified` | Tu código y pruebas locales | Tú y la IA editan archivos en una rama |
| `http://localhost:4647` | Prueba local segura con datos ficticios | `npm run dev:safe` |
| [GitHub WeOtzi/betav1](https://github.com/WeOtzi/betav1) | Historial, ramas, PR, versiones y automatización | Commit y push con tu GitHub |
| `https://preview.weotzi.chat/preview/<slug>/` | Preview de una rama `valentina/*` | El controlador del servidor publica el commit aprobado por CI; copia el enlace del [índice de previews](https://preview.weotzi.chat). Publicación de la rama de prueba comprobada |
| [beta.weotzi.com](https://beta.weotzi.com) | Beta principal que ya usan las pruebas del proyecto | El controlador del servidor descarga el commit de `main` aprobado por CI |
| Supabase | Usuarios, datos, permisos y archivos del entorno conectado | Migraciones y operaciones controladas por Isaí |

La preview tiene datos ficticios y no usa el backend real. Sirve para revisar diseño, navegación y los comportamientos simulados que se indiquen. La confirmación de guardar datos, recibir un email, autenticar una cuenta real o conectar un servicio externo se hace con cuentas de prueba en un entorno autorizado por Isaí. Anota esa diferencia en cada prueba; un botón visible no prueba una integración.

La barra amarilla **PREVIEW** identifica el entorno seguro. **Artista de prueba** y **Cliente de prueba** abren la misma identidad ficticia, con perfil, tres trabajos, agenda, cotizaciones y actividad. Dentro del producto, usa **Modo cliente / Modo tatuador** para revisar el cambio de modo. **Salir de prueba** permite recorrer los formularios de acceso: usa `valentina.preview@example.invalid` y `preview123`, datos de demostración sin acceso a Supabase. La preview acepta otros correos ficticios con formato válido y una contraseña de ocho caracteres; no verifica contraseñas reales. **Reiniciar datos** restaura los ejemplos.

Los cambios simulados se guardan solo en el navegador, por rama y commit. Si cambia el commit de una preview remota tendrás un nuevo juego de datos. Google, emails, soporte remoto y archivos privados muestran “No simulado en preview” cuando no están implementados por el adaptador: registra esa operación como bloqueada para una prueba real. No interpretes la sesión ficticia como una validación de la seguridad del login.

El flujo de trabajo es:

```text
Tu rama local → commit con explicación → push a valentina/<tarea>
                    ↓
          tests automáticos + preview de esa rama
                    ↓
        tú revisas → PR → revisión de Isaí
                    ↓
          merge a main → publicación de beta
```

Un `push` de tu rama no publica tus cambios en la beta principal. Tu preview y la beta principal tienen URLs y procesos separados. El DNS ya resuelve y el índice/preview funcionan por HTTPS. Para reconocer tu publicación, comprueba el nombre de la rama y su commit/versión en el índice; no basta con que un dominio responda.

## 4. Stack e infraestructura

| Tecnología | Uso en el proyecto |
| --- | --- |
| Node.js 22 | Ejecuta el servidor y herramientas de desarrollo |
| Express 4 | Sirve las páginas y endpoints `/api/*` desde `server.js` |
| HTML, CSS y JavaScript vanilla | Interfaz de las páginas en `public/`; sin un build de React para el producto principal |
| Supabase | PostgreSQL, Auth, Storage, funciones SQL, Realtime y reglas RLS |
| PM2 | Mantiene la aplicación Node funcionando en el servidor |
| Hostinger compartido / Linux | Hosting actual de beta; proxy PHP hacia un socket Unix del proceso Node |
| GitHub Actions | Workflow `Verify delivery`: pruebas y política de versiones/commits |
| Controlador del servidor + cron | Comprueba commits aprobados por CI, descarga releases y publica beta o preview; conserva versiones para rollback |
| n8n + SMTP Hostinger | Eventos y emails transaccionales; remitente `notificaciones@weotzi.chat` |
| Google, Gemini, Instagram/Apify y mapas | Integraciones específicas; requieren configuración y permisos propios |
| Figma | Auditoría, diseños de referencia y sistema de diseño |

La beta actual está en Hostinger. Los documentos antiguos sobre Docker/Easypanel son alternativas o antecedentes; no los uses como orden para cambiar la infraestructura.

El navegador comparte una sola instancia Supabase (`window._supabase` / ConfigManager). Mantén ese patrón. Las claves administrativas de Supabase y las credenciales de despliegue pertenecen al servidor y a la configuración privada administrada por Isaí; no se colocan en JavaScript público ni en los workflows de tus ramas.

## 5. Dónde encontrar cada cosa

```text
weotzi-unified/
├── AGENTS.md                   Reglas que debe leer tu agente IA
├── server.js                   Servidor Express, rutas API y configuración
├── package.json                Dependencias, scripts y versión
├── package-lock.json           Versiones exactas instaladas por npm ci --ignore-scripts
├── public/
│   ├── artist/                 Login, dashboard, perfil, inbox, travel, cuenta...
│   ├── client/                 Login, registro, dashboard, chats, solicitudes, cuenta
│   ├── quotation/              Wizard de cotización del cliente
│   ├── my-quotations/           Listado/detalle y estadísticas del artista
│   ├── calendar/               Agenda del artista
│   ├── marketplace/, explore/  Descubrimiento, mapa y globo
│   ├── studio/                 Recorridos de estudios
│   ├── componentes/            Catálogo visible del sistema de diseño
│   └── shared/
│       ├── css/ds/             Tokens, componentes, moléculas y organismos
│       ├── js/                 Lógica compartida y scripts de cada área
│       ├── js/ds/              Encabezados, navegación y componentes compartidos
│       └── assets/             Imágenes y recursos compartidos
├── lib/                        Acceso a datos, Auth y lógica de negocio reutilizable
├── services/                   Cotización, modos de cuenta, emails y servicios
├── templates/email/            Plantillas de correos
├── supabase/migrations/        Cambios SQL del esquema y permisos
├── supabase/seeds/             Fixtures/seeds identificados; no aplicar al remoto sola
├── tests/                      Pruebas con node:test
├── scripts/                    Herramientas de desarrollo y publicación
├── .github/workflows/          Automatizaciones de GitHub
└── docs/                       Guías, mapas, validaciones y changelog
```

Una ruta como `/client/chats/` suele corresponder a `public/client/chats/index.html`. La lógica puede estar en `public/shared/js/client-chats.js` y el estilo en una hoja compartida. Antes de modificar, pide a la IA que trace la ruta completa hasta las consultas y acciones.

Archivos útiles para comenzar:

| Documento o archivo | Cuándo leerlo |
| --- | --- |
| [MAPA_APLICACION.md](MAPA_APLICACION.md) | Buscar rutas, responsabilidades, tablas y servicios |
| [CHANGELOG.md](CHANGELOG.md) | Entender los cambios y el historial de versiones |
| [Guía del Design System](../public/shared/css/ds/README.md) | Reutilizar tipografía, colores, iconos, estados y componentes |
| [GUIA_CAPA_DATOS.md](GUIA_CAPA_DATOS.md) | Entender cómo leer/escribir datos y reusar repositorios |
| [ARTIST_SIGNUP_FLOW.md](ARTIST_SIGNUP_FLOW.md) | Cambios de registro: borrador antes de crear identidad |
| [AUDITORIA-LAURA-20260922.md](AUDITORIA-LAURA-20260922.md) | Antecedente del recorrido y los estados preparados para Laura |
| [AUDITORIA-LAURA-VALIDACION-20260922.md](AUDITORIA-LAURA-VALIDACION-20260922.md) | Evidencia de la preparación técnica del 22/09 |
| [MODO-DEMO-TOUR.md](MODO-DEMO-TOUR.md) | Qué simula el demo y por qué no demuestra persistencia |
| [RELEASE-RUNBOOK.md](../deployments/hostinger/RELEASE-RUNBOOK.md) | Operación del controlador y rollback por Isaí |
| [MAIN-PROTECTION.md](MAIN-PROTECTION.md) | Activación pendiente de las reglas de revisión y CI para `main` |

Los informes fechados describen pruebas realizadas entonces. Comprueba la implementación actual antes de repetir una afirmación de “funciona”.

## 6. Qué ya se hizo y qué tienes que completar

El código incluye perfiles y galerías, cotizador, cotizaciones y sesiones, agenda, chats, Job Board, spots e invitaciones, Travel, cuenta y estadísticas; también los módulos de estudios, soporte y backoffice. Hay una biblioteca de diseño compartida y catálogos en `/componentes/` y `/componentes/compuestos/`.

En agosto se trabajaron, entre otras áreas, dashboard, calendario, perfil público, Inbox, estadísticas y Travel con referencias Figma. En septiembre se publicaron la conexión del marketplace a `artists_db`, el cotizador, los flujos operativos de estudios, correos y el cambio cliente/tatuador. La guía de Laura registra una cuenta con actividad y una comprobación de 364 pruebas del 22/09. Esto es contexto histórico, no una aprobación nueva de todos los flujos.

Tu pendiente es el **inventario vivo de diferencias**: Laura dejó capturas y recorridos de Artistas y Clientes en Figma. Compara cada pantalla y estado con la versión local y el diseño original; registra desvíos visuales, acciones defectuosas y funciones sin evidencia. No se entrega una lista cerrada de “pantallas faltantes” inventada a partir de documentación vieja.

También quedan pruebas dependientes de servicios externos: Google/Instagram, correos reales, seguridad de cuenta, archivos y cualquier cobro. Registra qué necesitas para comprobarlas y coordina el entorno con Isaí. Los importes y estados de ejemplo no representan pagos reales.

## 7. Cómo trabajar con Git sin perder trabajo

Para empezar una tarea nueva, primero asegúrate de no tener cambios pendientes en otra tarea. Si los tienes, pide a la IA que los identifique y termine o guarde de forma explícita, sin borrarlos.

```powershell
git status
git switch main
git pull --ff-only origin main
git switch -c valentina/rediseno-login
```

Usa nombres de rama sin espacios ni tildes, por ejemplo `valentina/rediseno-login`. Cada rama debe tener un objetivo que puedas explicar en una frase. Continúa tu rama mientras esa tarea siga abierta.

Cuando el cambio esté revisado y probado:

```powershell
git diff
git status
git add public/client/login/index.html public/shared/css/client.css docs/CHANGELOG.md
git diff --cached
```

La lista es un ejemplo: agrega **los archivos de tu tarea**, incluidos versión y lockfile cuando corresponda. Evita un `git add .` automático. Verifica que no se incluyan `.env`, tokens, credenciales, capturas con datos privados o archivos de otros proyectos.

El commit debe tener un título claro y una explicación. Ejemplo de texto:

```text
feat(client-login): aplicar el rediseño de acceso

Problema: el acceso de cliente no coincide con el frame de referencia.
Cambio: reutiliza los campos y botones del sistema de diseño.
Version: 2.2.1-valentina.login.1
Validación: login/errores y capturas a 1440, 768 y 390 px en entorno seguro.
Límite: el email real no se prueba en la preview.
Rollback: revertir este commit; no incluye migraciones.
```

Después del commit, publica tu rama:

```powershell
git push -u origin valentina/rediseno-login
```

Antes de ese primer push, Isaí debe haber comprobado el aislamiento de tu usuario Windows y clon y las reglas efectivas de `main`. Después, la IA debe comprobar `gh auth status` y que **tu identidad personal tenga permiso de escritura** en `WeOtzi/betav1`. El CLI guardado del administrador usa `isai-weotzi` y actualmente solo tiene lectura; la publicación inicial la hizo el conector GitHub autorizado del propietario. No copies su sesión o token ni asumas que el CLI ya puede publicar. Si falta alguno de estos requisitos o el push devuelve falta de permisos, conserva el commit local y pide a Isaí la preparación pendiente. No pruebes publicar antes de que la protección esté activa.

Abre el workflow **Verify delivery** en [GitHub Actions](https://github.com/WeOtzi/betav1/actions) y espera que **Tests and release policy** pase para el commit que acabas de publicar. El controlador del servidor comprueba periódicamente ese resultado y descarga el commit aprobado. Después abre el índice **https://preview.weotzi.chat**, busca tu rama y comprueba que su versión/commit coinciden antes de probar. La rama `valentina/prueba-entorno` completó este recorrido para **2.1.1**, commit `ee702262fb765744b1df5dc1f42b68eb1da9c5ef`, con [CI aprobado](https://github.com/WeOtzi/betav1/actions/runs/36687128430) y [preview funcionando](https://preview.weotzi.chat/preview/preview-valentina-prueba-entorno-f6aefa2d/inicio/). Cada publicación posterior requiere su propia comprobación. Si falla CI, corrige la causa en la misma rama y haz un nuevo commit. La publicación no está comprobada solo porque `git push` haya terminado.

Abre un Pull Request hacia `main`. Incluye el problema, pantalla/nodo Figma, qué cambió, pruebas, capturas, URL de preview, versión y forma de revertir. Isaí revisa y decide el merge. Si `main` avanzó, incorpora esos cambios a tu rama y vuelve a revisar las partes afectadas.

## 8. Versión, changelog y rollback

Cada commit de cambios debe estar identificado por una versión única, y cada publicación por su commit y ejecución de Actions. La primera integración es **2.1.0**, commit `c181087ae3903771daa5418209ed141a75bd4ebc`, con [CI aprobado](https://github.com/WeOtzi/betav1/actions/runs/36684275260) y `/api/release` público comprobado. La **2.1.1**, commit `ee702262fb765744b1df5dc1f42b68eb1da9c5ef`, incorpora correcciones de arranque/recuperación y proxies. Su [CI de main](https://github.com/WeOtzi/betav1/actions/runs/36687126630) y [CI de preview](https://github.com/WeOtzi/betav1/actions/runs/36687128430) terminaron aprobados; el cron publicó beta a las **08:02:12 UTC** y preview a las **08:02:16 UTC** del 30/09. Ambos endpoints `/api/release` devolvieron esa SHA y versión. Es evidencia histórica de 2.1.1, no una garantía sobre la versión que encontrarás después. Consulta `package.json` y el commit de `/api/release` del entorno desplegado. No se crearon tags estables en esta entrega.

Antes del commit, usa la herramienta de versión. El ejemplo siguiente prepara el primer cambio de una rama; la IA debe recalcular el siguiente número libre desde la versión actual de `package.json`, no copiar un número que ya existe ni usar un prerelease anterior a la versión estable:

```powershell
npm run version:delivery -- 2.2.1-valentina.login.1 "Rediseño del acceso de cliente"
npm test
npm run check:release
```

La herramienta actualiza `package.json`, `package-lock.json` y crea una entrada de `docs/CHANGELOG.md`. **Completa la validación y el rollback de esa entrada con lo que realmente hiciste**, y agrega los tres archivos al commit. El siguiente commit de esa tarea usa, por ejemplo, `2.2.1-valentina.login.2`; recalcula también ese número desde `package.json` y el historial de la rama. El cuerpo de cada commit lleva `Version: <version>` y `Validación: <evidencia>` además de problema, cambio y rollback. Los checks de GitHub verifican esta política.

Usa patch para correcciones compatibles; minor para nuevas funciones compatibles; major requiere revisión de Isaí por incompatibilidades. En una rama las versiones llevan el sufijo de tarea. Isaí prepara la versión estable al integrar. No inventes resultados de pruebas ni publiques entradas genéricas.

Para corregir una tarea todavía en tu rama, haz otro commit. Para deshacer una corrección ya integrada, abre una rama nueva desde `main`, revierte el commit y crea otro PR. Ejemplo conceptual para que la IA lo prepare con el hash comprobado:

```powershell
git switch -c valentina/revertir-login
git revert <hash-del-commit>
```

No reemplaces el historial publicado con `reset --hard` ni `push --force`. Si hay una falla en beta, avisa a Isaí con URL, versión, error y pasos. **Isaí usa el rollback del controlador del servidor** para volver a un release anterior verificado, según el runbook operativo. Se comprobó recuperar la versión anterior 2.0.1 con HTTP 200, mantenerla durante el cron y volver a publicar la SHA aprobada 2.1.0 al reanudar. GitHub Actions verifica cambios y no conserva claves SSH del servidor. Tus credenciales no necesitan acceso SSH.

El rollback de código y el de datos son cosas distintas. Una migración SQL requiere compatibilidad, respaldo y recuperación propios. No borres usuarios o datos, cambies RLS ni apliques seeds/migraciones al Supabase compartido para arreglar un problema visual.

## 9. Cómo conversar con la IA

Puedes usar lenguaje natural. Pide acciones pequeñas, da contexto y exige que el agente muestre pruebas comprensibles. Ejemplos listos para copiar:

**Al comenzar:**

> Soy Valentina. Trabaja en este repositorio. Lee AGENTS.md, HANDOFF-VALENTINA.md y VALENTINA-FIRST-TASK.md. Revisa mi rama y los cambios pendientes. Arranca el entorno seguro y comprueba que estoy usando datos ficticios. Explícame en palabras simples qué harás y qué necesito verificar.

**Al comparar una pantalla:**

> Revisa esta pantalla de la auditoría [enlace con node-id], esta referencia del rediseño [enlace con node-id] y el Design System [enlace]. Abre la pantalla local y enumera las diferencias de estructura, componentes, texto, estados y comportamiento. Traza los archivos y consultas que usa. Todavía no cambies otras pantallas.

**Al implementar:**

> Aplica el rediseño de este flujo en mi rama. Reutiliza el sistema de diseño y los componentes compartidos. Conserva sus datos, acciones y permisos. Revisa todos los estados del Figma y desktop/tablet/móvil. Muéstrame las capturas y dime qué puedo comprobar yo. Actualiza changelog y versión según el procedimiento del proyecto.

**Si algo falla:**

> En [URL], como [modo], hago [pasos] y aparece [error]. Esperaba [resultado]. Reproduce el problema, identifica la causa y arréglalo si entra en esta tarea. Comprueba que se solucionó. Si depende de credenciales o del entorno real, registra el bloqueo y los datos que necesita Isaí, sin inventar una prueba exitosa.

**Antes de publicar:**

> Revisa el diff y los archivos staged. Comprueba que solo incluyen esta tarea y no secretos. Ejecuta las verificaciones necesarias, prepara un commit con problema/cambio/validación/rollback, publica mi rama y abre el PR con la preview. No integres a main: la revisión es de Isaí.

La IA puede equivocarse. Si algo no se parece a Figma, no funciona o no puedes explicar qué se guardó, pide que lo compruebe. Acepta una tarea cuando la evidencia coincide con lo que ves y con el resultado esperado.

## 10. Cómo probar sin afectar a otras personas

- Usa datos ficticios en local/preview. Para comprobar persistencia o entregas reales, usa cuentas identificadas como prueba y el entorno que autorice Isaí.
- Recorre tanto datos cargados como estados vacíos. Un listado lleno no prueba la pantalla vacía, y un toast de éxito no prueba que se guardó.
- Revisa recarga, navegación atrás/adelante, sesión y modo, duplicados, validaciones, carga/error, foco/teclado y tamaños 1440/768/390 px.
- Para probar cliente y artista como participantes distintos, usa dos cuentas de prueba y dos perfiles de navegador. Cambiar de modo sobre una misma identidad sirve para revisar el panel, pero no sustituye una conversación entre dos personas.
- Un correo se aprueba cuando se dispara el evento, llega al buzón de prueba y su enlace abre el destino correcto. Una preview que captura/simula emails no prueba entrega.
- No pruebes postulaciones, reservas, cancelaciones, pagos o eliminación contra registros reales. Documenta el caso que necesitas reproducir.

Anota cada defecto con ruta, modo, datos de prueba, pasos, esperado/observado, captura, consola o respuesta API relevante, versión y entorno. Nunca incluyas tokens, contraseñas ni datos privados en el informe.

## 11. Tu cuenta en este PC

Tu usuario Windows es **Dev** y debe seguir siendo estándar, con permisos de modificación en tu copia independiente de We Ötzi. Node, npm, Git y el servidor local no requieren permisos de administrador. Usa tu propio perfil de navegador; no abras las sesiones de Isaí. Tu Codex muestra los proyectos y chats de tu perfil y de tu cuenta, y debe abrir esta copia del proyecto.

La carpeta `C:\dev` del propietario queda fuera de tu entorno, porque contiene otros proyectos y el checkout original con secretos. Tu acceso es `C:\WeOtzi-Dev\weotzi-unified`. La configuración administrativa y su verificación están en [DEV-WINDOWS-SETUP.md](DEV-WINDOWS-SETUP.md). Una cuenta administradora podría cambiar estas restricciones; por eso no se utiliza para el desarrollo cotidiano.

El repositorio no entrega SSH, contraseña del servidor, `.env` del propietario ni secretos administrativos. GitHub Actions verifica tu commit y el controlador del servidor publica el commit aprobado. Isaí administra las cuentas, permisos, secretos, migraciones y rollback operativo. Si un comando pide elevación de administrador, acceso a otro proyecto o un secreto, detente y reporta la acción concreta necesaria.

La carpeta compartida por sí sola no limita una cuenta Windows: los permisos del sistema deben haber sido configurados por Isaí. Tu comprobación inicial es poder abrir y modificar tu clon, arrancar el entorno seguro y publicar tu rama, mientras otras carpetas de proyectos y el perfil de Isaí quedan inaccesibles. Si descubres acceso inesperado, repórtalo antes de seguir.

## 12. Checklist de inicio y de entrega

**Antes de la primera tarea:**

- [ ] Entré con mi usuario Windows estándar y mis cuentas de ChatGPT/Codex y GitHub.
- [ ] Mi carpeta y el remoto de Git corresponden a WeOtzi/betav1.
- [ ] Isaí comprobó las reglas efectivas de `main` antes de otorgarme escritura; exigen revisión y CI antes de integrar. Mi usuario GitHub puede publicar `valentina/*`.
- [ ] `gh auth status` muestra mi identidad; una publicación de prueba confirmó el permiso de escritura, sin reutilizar credenciales de Isaí.
- [ ] Puedo abrir la auditoría, el rediseño y el sistema de diseño con mi cuenta Figma.
- [ ] `npm ci --ignore-scripts` y `npm run dev:safe` funcionan; local usa datos ficticios.
- [ ] Una primera rama genera una preview y conozco su enlace.
- [ ] No tengo credenciales SSH ni acceso al perfil/otros proyectos de Isaí.

**Para entregar cada tarea:**

- [ ] Comparé nodo, pantalla y estados exactos.
- [ ] Probé el comportamiento, responsive y accesibilidad necesarios.
- [ ] Separé pruebas simuladas de pruebas de persistencia/servicios reales.
- [ ] Corregí o registré cada defecto encontrado, sin dejarlo oculto.
- [ ] Actualicé changelog y versión; el commit explica cambio y rollback.
- [ ] La preview corresponde al commit que entrego y sus checks están aprobados.
- [ ] El PR incluye pruebas, capturas, Figma y pendientes, y está listo para revisión de Isaí.
