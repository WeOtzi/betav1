# Publicación y recuperación en Hostinger

El servidor publica commits de GitHub. La aplicación de beta funciona desde releases privadas y el tráfico público pasa por el proxy PHP. Los archivos anteriores se conservan como respaldo y no se actualizan mediante Git. Las previews usan otro origen y un servidor de archivos de confianza; nunca ejecutan `server.js`, servicios, dependencias o scripts de instalación de una rama.

## Carpetas privadas

- `~/weotzi-deploy/control/`: copia revisada de los scripts de despliegue, gateway, adaptador demo y configuración del servidor. El poller la utiliza; una rama no puede actualizarla por sí misma.
- `repository.git/`: copia Git privada con el origen configurado. El deploy obtiene la rama de GitHub y comprueba su SHA completa antes de copiar archivos.
- `releases/main/<release>/`: código y dependencias de una publicación de beta.
- `releases/preview-<rama>-<hash>/<release>/`: solamente archivos públicos de la rama, con configuración ficticia.
- `shared/main.env`: configuración y secretos de beta, con permisos `600`; nunca se incorpora al repositorio.
- `shared/public-uploads/`, `shared/public-storage/`, `shared/logs/`: estado persistente, enlazado desde cada release de beta.
- `sockets/main.sock`, `sockets/previews.sock`: listeners Unix privados; permisos `600`, carpeta `700`.
- `pm2/`: daemon y estado de PM2 propios de We Ötzi. Todas las operaciones pasan este `PM2_HOME` y no administran procesos ajenos.
- `current/`, `targets/`, `preview-map.json`, `history/`: publicación activa, relación con la anterior y registro de despliegues. No contienen contraseñas.

No se borran releases anteriores automáticamente. Revisar el espacio disponible y conservar las publicaciones que se necesiten recuperar antes de realizar cualquier limpieza.

## Instalación inicial por el administrador

Copiar los scripts de `scripts/release/` a la carpeta privada `control/`, junto con `preview-bootstrap.js` y `deploy-config.json` creado a partir del ejemplo. Adoptar la aplicación real que estaba funcionando antes de publicar el primer commit:

```sh
/opt/alt/alt-nodejs22/root/bin/node ~/weotzi-deploy/control/deploy.cjs adopt \
  --source /home/u795331143/domains/weotzi.com/public_html/beta
```

La adopción respalda su código operativo, importa el `.env` y conserva uploads/storage/logs. No cambia el proceso activo. Si ya existe una publicación registrada, rechaza sobrescribir el historial. La versión anterior también conserva un hook para escuchar en el socket Unix privado configurado en este servidor.

El administrador instala el proxy de beta y el proxy de previews en sus respectivos dominios. En este alojamiento las pruebas detectaron que TCP loopback no comunica los procesos; se usan sockets Unix privados: `main.sock` para beta y `previews.sock` para el gateway. Los puertos `4545` y `4670` son solamente un fallback para otros entornos compatibles. Las previews deben utilizar un origen diferente a beta para evitar compartir cookies o almacenamiento del navegador.

## Publicar un commit verificado

El poller debe verificar primero que el workflow de CI pasó para la SHA exacta. Después ejecuta:

```sh
node ~/weotzi-deploy/control/deploy.cjs deploy --ref main --sha SHA_COMPLETA_DE_40_CARACTERES
node ~/weotzi-deploy/control/deploy.cjs deploy --ref valentina/nombre-de-tarea --sha SHA_COMPLETA_DE_40_CARACTERES
```

Si la rama se movió desde el inicio del workflow, el despliegue se cancela. Una única cerradura de despliegue evita dos operaciones simultáneas. Los archivos se copian mediante una lista permitida; symlinks, submódulos, credenciales y datos mutables se rechazan. Beta utiliza `npm ci --omit=dev --ignore-scripts`; las previews no instalan ni ejecutan dependencias de la rama.

La activación cambia el enlace a la release y reinicia el proceso PM2 real. Comprueba `/api/release` en el listener privado y en la URL pública de beta, exigiendo la misma SHA. Si falla, vuelve a iniciar la publicación anterior y restaura la ruta y el estado registrado. Puede haber una interrupción breve durante el reinicio: el alojamiento utiliza un único listener de beta.

## Automatización sin secretos en GitHub

```sh
node ~/weotzi-deploy/control/poll.cjs
```

El cron del administrador invoca el poller cada minuto. Una cerradura evita invocaciones simultáneas. Lee las ramas públicas `main` y `valentina/*` mediante Git, sin tokens. Publica solamente cuando GitHub demuestra un workflow `Verify delivery` y su job `Tests and release policy` concluidos con éxito para la misma SHA, rama y evento `push`.

El wrapper versionado `poll-cron.php` se instala en `control/` y se invoca con PHP CLI. En este alojamiento la tarea existente de hPanel apunta a `beta/auto_monitor.php`: ese archivo contiene únicamente el puente `cron-bridge.php`, que requiere el wrapper privado. El puente rechaza peticiones web. La tarea programada de hPanel se conserva; `crontab` no está disponible por SSH.

El origen de previews es `https://preview.weotzi.chat`. Instalar `preview-proxy.php` como `proxy.php` y `preview.htaccess` como `.htaccess` en `/home/u795331143/domains/preview.weotzi.chat/public_html`. El proxy lee la configuración privada del controlador, permite GET/HEAD y rechaza operaciones reales; no reenvía credenciales de aplicación.

Para una rama junior, exige que `verify.yml`, `check-policy.cjs` y el comando `npm test` coincidan con los de `main`; no acepta un workflow cambiado por la rama que simplemente declare un éxito. Este control no sustituye la revisión humana de las modificaciones ni demuestra integraciones externas: las previews ejecutan solamente UI y datos ficticios. Los scripts del controlador se instalan desde `main` revisada, fuera de las ramas.

Cuando CI todavía no terminó o GitHub limita las consultas anónimas, el poller conserva caché, ETags y reintentos con espera creciente. Nunca interpreta un error o un límite de consultas como autorización para publicar. El registro `logs/poll.log` se limita a 128 KiB y una rotación anterior.

## Desarrollo local seguro

```sh
npm run dev:safe
```

Abre `http://localhost:4647/preview/preview-local-safe/inicio/`. El gateway lee los archivos actuales de `public/` en cada petición; basta editar y refrescar. No carga `.env`, no ejecuta `server.js` ni entrega credenciales o datos reales. El adaptador simula auth y PostgREST con fixtures; las funciones no simuladas muestran un estado explícito. La configuración utiliza únicamente un dominio ficticio `.invalid` y un marcador público de preview; el flag legacy `demoMode` queda apagado para que los controladores normales funcionen contra este adaptador ficticio.

## Volver a una publicación anterior

```sh
node ~/weotzi-deploy/control/deploy.cjs status
node ~/weotzi-deploy/control/deploy.cjs rollback --target main
node ~/weotzi-deploy/control/deploy.cjs rollback --target main --release ID_DE_RELEASE_CONSERVADA
```

Un rollback registra `rollbackHold.blockedCommit` en `targets/main.json`. El poller debe evitar volver a publicar esa SHA inmediatamente. Un commit nuevo puede publicarse; para volver a permitir explícitamente la misma SHA:

```sh
node ~/weotzi-deploy/control/deploy.cjs resume --target main
```

Se puede recuperar una preview con el mismo comando `rollback`, usando el identificador de su target. Los IDs y las rutas se validan antes de acceder al sistema de archivos.

El rollback recupera código y dependencias; preserva el `.env`, uploads y registros actuales. Las migraciones de Supabase requieren otro procedimiento: diseñarlas compatibles con la versión anterior, respaldar datos y revisar su recuperación antes de aplicarlas. El deploy de Git no ejecuta migraciones de bases de datos.

## Actualizar el controlador

Los scripts de `control/` son herramientas de administración. Se actualizan solamente desde una revisión aprobada de `main`, después de pasar las pruebas de `tests/release-pipeline.test.js`. Evitar copiar archivos de una rama junior a esa carpeta.

Valentina necesita su GitHub y el entorno local con datos ficticios. Su trabajo se publica a través del repositorio y de CI; no necesita SSH, credenciales de Hostinger ni secretos de beta.
