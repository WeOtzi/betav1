# Preparar la cuenta Windows Dev

Dev ya existe como cuenta local estándar. **El desarrollo de We Ötzi no necesita permisos de administrador**: puede editar archivos, instalar dependencias con npm, ejecutar Node en `localhost:4647`, hacer commits y usar sus propias cuentas GitHub y Codex. Ser administrador permitiría tomar posesión de carpetas ajenas y anular sus restricciones; no es compatible con impedirle el acceso a la cuenta de Isaí.

Se necesita una sola ejecución administrativa para preparar los permisos. Los scripts siguientes son para que **Isaí los ejecute manualmente**. No se ejecutaron cambios de permisos al prepararlos, no solicitan elevación automática y no cambian cuentas, contraseñas, grupos, firewall ni ExecutionPolicy. Configurar y restaurar son de solo lectura por defecto; la escritura exige `-Apply` explícito.

## 1. Isaí prepara el clon y las restricciones

Abre **Windows PowerShell como administrador** desde Windows. Antes puedes ver el plan en una consola normal:

```powershell
& 'C:\dev\weotzi-unified\scripts\windows\Configure-DevWorkspace.ps1' -AuditOnly
```

Antes de aplicar, cierra las sesiones de Dev y detén los programas que estén cambiando archivos o permisos en las carpetas privadas. Para aplicar el plan, ejecuta en la consola administrativa:

```powershell
& 'C:\dev\weotzi-unified\scripts\windows\Configure-DevWorkspace.ps1' -Apply
```

La política comprobada es `RemoteSigned`; estos scripts locales no necesitan cambiarla. Si aparece un bloqueo de firma o política, conserva el mensaje y revísalo antes de continuar; no desactives la política global.

El configurador comprueba el SID de la cuenta Dev y que pertenece únicamente a **Usuarios**. Deja esa cuenta y contraseña intactas. Respalda las DACL completas de los archivos y carpetas existentes en `C:\dev`, `C:\Webs Alejo Igoa Team`, `C:\c`, `C:\Remote` y `C:\Users\Isaí`; las rutas opcionales ausentes no se modifican. Deniega acceso solo al SID de Dev, también en descendientes con herencia protegida. No otorga derechos globales ni toca permisos de otros usuarios. El respaldo privado queda en `C:\ProgramData\WeOtzi\DevWorkspaceBackups\<fecha-id>` y el script imprime la ruta exacta de `manifest.json`. Guárdala para recuperación.

No sigue junctions ni symlinks. Los aliases de ejecución de `WindowsApps` y los placeholders cloud se identifican por su tag y se respaldan con `/L`, sin abrir archivos ni destinos de aliases. Los directorios **CLOUD reconocidos** de OneDrive/iCloud se enumeran en su propia ruta para capturar también sus descendientes: no se omiten de la protección. Un junction/symlink debe apuntar dentro de las raíces privadas aprobadas; cualquier tag desconocido, enlace externo o DACL que no se pueda capturar hace abortar **antes de las denegaciones privadas**. Revisa esa ruta; no omitas la comprobación ni interpretes un inventario incompleto como protección completa. El inventario y las consultas de metadata cloud pueden tardar si hay muchos archivos; no cierres la consola. Si falla durante la aplicación, usa el manifiesto impreso para restaurar; no se declara aislamiento comprobado.

Prepara **`C:\WeOtzi-Dev\weotzi-unified`** mediante un clon HTTPS del repositorio público, con `--depth 1 --no-tags`: trae la versión actual, sin importar todo el historial. No copia el checkout original, `.env`, `.server-credentials`, credenciales SSH, cachés, sesiones Codex ni configuraciones privadas de Git. Dev puede modificar y borrar sus archivos dentro de su espacio; Git reconoce el clon como suyo. Si `C:\WeOtzi-Dev` ya existe, el configurador se detiene y no toma posesión de datos anteriores.

**`C:\dev` será inaccesible para Dev.** Para ocultar el listado local de otros proyectos no basta con denegar el contenido de cada carpeta: un explorador local puede mostrar sus nombres. Compartir el checkout original tampoco es seguro porque contiene configuración privada. El clon separado da acceso al mismo proyecto mediante Git y preserva el trabajo/configuración de Isaí. No se crea una carpeta compartida de red.

El historial público sigue siendo accesible en GitHub; un clon corto y las ACL locales no revocan material que se hubiera publicado previamente. Las herramientas instaladas para todos los usuarios en `Program Files` siguen disponibles. Dev usa su propio perfil para `TEMP`, npm y cachés. No se agrega Dev a Administradores, Power Users, Backup Operators, `docker-users` ni a grupos compartidos del sandbox de Codex.

## 2. Dev verifica desde su propia sesión

Cierra la sesión actual de Dev si estaba abierta y entra de nuevo. Abre su propia cuenta ChatGPT/Codex y selecciona **`C:\WeOtzi-Dev\weotzi-unified`**. No importes sesiones ni claves de Isaí.

En PowerShell de **Dev**, ejecuta:

```powershell
& 'C:\WeOtzi-Dev\weotzi-unified\scripts\windows\Verify-DevWorkspace.ps1' -RunTests
```

Si se prepararon los scripts antes de publicarlos, Isaí debe copiar **solo los tres `.ps1` revisados** a `C:\WeOtzi-Dev\weotzi-unified\scripts\windows\`; nunca copiar la carpeta original completa. Tras publicar esta entrega, un clon actualizado ya los incluye. El verificador rechaza una ejecución desde Isaí, un administrador o un usuario compartido del sandbox. Comprueba la identidad real, apertura directa de archivos privados, rechazo del listado de raíces privadas, escritura/lectura/borrado en su propio clon, Git, Node 22 y npm. `-RunTests` instala dependencias con `npm.cmd ci --ignore-scripts` y ejecuta la suite bajo Dev. El resultado se guarda en `C:\WeOtzi-Dev\verification-<fecha>.json`; una ruta inexistente no cuenta como acceso denegado.

Ejecuta el mismo verificador **también desde la terminal que usa el agente de Codex**. Debe seguir identificándose con el SID real de Dev. Si aparece la identidad del propietario o un sandbox compartido, no sigas: informa a Isaí y revisa la configuración del agente. No se da por comprobado el aislamiento por ver una lista de ACL. Las pruebas usan un token sintético solo mientras se ejecuta `npm test`; después se restablece la variable anterior. Si la suite informa que el puerto de prueba `4687` está ocupado, identifica ese proceso y coordina con Isaí; el verificador no lo mata ni cambia el firewall.

Arranque habitual, sin elevación:

```powershell
cd C:\WeOtzi-Dev\weotzi-unified
npm.cmd ci --ignore-scripts
npm.cmd run dev:safe
```

Abre **http://localhost:4647**, confirma la barra **PREVIEW** y recorre modo artista/cliente. Las pruebas son ficticias; no envían correos ni escriben en Supabase. `npm.cmd` evita depender del script PowerShell `npm.ps1`, sin cambiar ExecutionPolicy. No cierres procesos de Isaí si un puerto está ocupado: identifica el dueño y coordina el cierre.

Las ACL protegen archivos, pero dos sesiones del mismo PC comparten red y servicios de `localhost`. Isaí debe cerrar servicios privados antes de prestarle el entorno o usar una VM separada si requiere aislamiento también de servicios. Dev usa sus propias sesiones de GitHub, Figma y Codex; revisa el [handoff](HANDOFF-VALENTINA.md) y [primera tarea](VALENTINA-FIRST-TASK.md).

## Recuperación por Isaí

En Windows PowerShell administrativo, revisa primero el manifiesto exacto impreso al configurar:

```powershell
& 'C:\dev\weotzi-unified\scripts\windows\Restore-DevWorkspace.ps1' -ManifestPath 'C:\ProgramData\WeOtzi\DevWorkspaceBackups\<fecha-id>\manifest.json' -AuditOnly
& 'C:\dev\weotzi-unified\scripts\windows\Restore-DevWorkspace.ps1' -ManifestPath 'C:\ProgramData\WeOtzi\DevWorkspaceBackups\<fecha-id>\manifest.json' -Apply
```

Sustituye `<fecha-id>` por la carpeta real. La recuperación valida rutas, SID, máquina y hashes antes de escribir, reconoce los directorios CLOUD originales y rechaza junctions nuevas o tags que hayan cambiado. Comprueba que no haya cambios ajenos en las DACL antes de reproducir el respaldo; si los encuentra se detiene para evitar sobrescribir una modificación legítima. Los archivos temporales que ya no existen se anotan como ausentes y no se recrean ni bloquean toda la recuperación. Una captura que falló antes de cualquier cambio devuelve “sin cambios que restaurar”. No borra archivos ni cuenta, no resetea contraseñas ni grupos. Se registra un informe nuevo; el respaldo no se sobrescribe y el manifiesto se actualiza mediante sustitución atómica. **Al restaurar las restricciones Dev vuelve a tener los accesos que tenía antes**: hazlo cuando no esté trabajando y no presentes el entorno como aislado después. Detén los programas que cambien archivos o permisos durante la recuperación.

**Estado de estos artefactos:** preparados para ejecución manual; no prueban por sí solos que los permisos se hayan aplicado, que Dev haya iniciado Codex ni que el navegador funcione. Conserva el resultado administrativo y el informe ejecutado bajo Dev como evidencia.

## Error de la primera ejecución 2.2.0

La entrega 2.2.1 corrige “Replace: La ruta de acceso no tiene un formato válido” y la lectura de los archivos ACL UTF-16LE sin BOM. El intento reportado quedó en el respaldo, con `aclChangesStarted=false` y sin crear el clon. Sus archivos de diagnóstico se conservan. Con los scripts actualizados puedes repetir el comando `Configure-DevWorkspace.ps1 -Apply` en tu consola administrativa: prepara un respaldo nuevo y no reutiliza la captura incompleta. Un intento con cambios ya iniciados requiere revisar y restaurar su manifiesto primero; no se debe asumir el mismo estado para otra ejecución.
