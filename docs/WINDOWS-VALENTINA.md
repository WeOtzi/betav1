# Cuenta de Windows y entorno de Valentina

Este documento explica la separación de cuentas en este PC. El documento de handoff del proyecto explica las ramas, los previews, el rediseño y la publicación.

**Estado comprobado al 30/09/2026:** los scripts están preparados y auditados, pero la autorización UAC fue cancelada. **La cuenta Valentina y su clon todavía no están creados.** No se comprobó el aislamiento con su token Windows ni con el token de herramientas de su Codex. Las instrucciones siguientes se ejecutan después de que Isaí complete la preparación y verificación; la presencia de los scripts no acredita que ya se aplicaron los permisos.

## Para Valentina

1. Cuando Isaí confirme que creó y comprobó la cuenta y el clon, iniciá sesión en Windows con **Valentina**. Usá tu propia contraseña. No trabajes dentro de la sesión de Isaí.
2. Instalá o abrí Codex desde tu cuenta de Windows e iniciá sesión con **tu propia cuenta de ChatGPT**. Tu perfil y tus chats se guardan en tu cuenta, sin copiar la configuración de Isaí.
3. En Codex, agregá únicamente **`C:\WeOtzi-Valentina\weotzi-unified`** como proyecto. Es un clon separado del mismo repositorio [WeOtzi/betav1](https://github.com/WeOtzi/betav1).
4. Autenticá GitHub con tu propia cuenta. No uses la sesión, el token ni el correo de Git de Isaí. Configurá tu nombre y correo con `git config --local user.name "Valentina"` y `git config --local user.email "TU_CORREO_DE_GITHUB"` dentro del clon.
5. Ejecutá el modo seguro de desarrollo indicado en el handoff (`npm run dev:safe`). Este modo debe trabajar con los datos de prueba configurados por el proyecto. No copies `.env` de otro clon ni credenciales de servicios reales.
6. Después de que Isaí confirme la protección efectiva de `main` y te otorgue escritura en GitHub, trabajá en tu rama, hacé commits descriptivos, actualizá la versión y el changelog según el handoff y hacé push con tu cuenta. GitHub y el servidor publican la preview. No necesitás SSH ni el panel del hosting. La beta está en hosting compartido Hostinger, no en un VPS.

Solo si Isaí preparó la cuenta y permisos con `-SkipClone` y confirmó la carpeta de trabajo, ejecutá en tu cuenta:

```powershell
Set-Location C:\WeOtzi-Valentina
git clone https://github.com/WeOtzi/betav1.git weotzi-unified
Set-Location .\weotzi-unified
npm.cmd ci --ignore-scripts
```

Una cuenta normal no puede administrar Windows, instalar controladores ni cambiar permisos de otros usuarios. Si una instalación pide una cuenta de administrador, solicitá esa instalación a Isaí; no uses su cuenta para continuar desarrollando.

Si el clon se crea después con `-SkipClone`, Isaí debe completar la verificación de acceso real antes de dar por terminado el onboarding. No inicies un clon en la carpeta prevista antes de la preparación: los scripts rechazan apropiarse de una carpeta existente que no tenga el marcador de preparación.

## Qué queda separado

| Recurso | Cómo se separa |
| --- | --- |
| Código local de Valentina | Clon propio en `C:\WeOtzi-Valentina\weotzi-unified` |
| Otros proyectos y copias en `C:\dev` | Denegación NTFS específica al SID de Valentina, incluida la carpeta original de We Ötzi |
| Otros proyectos web detectados | Misma denegación en `C:\Webs Alejo Igoa Team` |
| Copia del perfil y helper remoto detectados | Denegación en `C:\c` y `C:\Remote` |
| Chats de Codex, navegador, `.ssh`, secretos y credenciales de Isaí | Perfil `C:\Users\Isaí` inaccesible a Valentina |
| ChatGPT y GitHub | Valentina inicia sesión con sus propias cuentas; no se copian perfiles |
| Credenciales SSH/SMTP/Supabase privilegiadas | No se copian al clon ni al perfil de Valentina |
| Publicación | Sólo GitHub y el procedimiento del servidor descritos en el handoff |

Los permisos agregados se aplican **sólo a Valentina**. Se conservan los permisos de Isaí, SYSTEM, administradores y usuarios existentes. No se cambia toda la unidad ni las carpetas de programas.

Una cuenta de Windows separada no crea una máquina virtual: comparte los programas instalados y la red del PC. Los servicios que Isaí deje escuchando en `localhost` siguen siendo alcanzables por otras cuentas si el propio servicio no exige autenticación. Cerrá las aplicaciones privadas que no necesite Valentina durante sus sesiones, o usá una máquina virtual si se requiere también separación de red y procesos. La garantía que verifican estos scripts es el acceso a archivos, al perfil y a los secretos dentro de los directorios protegidos inventariados.

## Para Isaí: preparación y verificación

La revisión del **30/09/2026** encontró que `C:\dev` permitía leer a todos los usuarios normales y modificar a usuarios autenticados. No existía la cuenta Valentina y el proceso de Codex no estaba elevado. El intento de preparación se detuvo porque la autorización UAC fue cancelada; la cuenta y el clon siguen sin crearse y las verificaciones efectivas están pendientes. Por eso abrir otro perfil de Codex en la misma cuenta de Windows no alcanza para separar los proyectos.

Los scripts son compatibles con **Windows PowerShell 5.1**, que está instalado para todas las cuentas. La copia actual de PowerShell 7 y Codex vive dentro del perfil de Isaí; no hay que dar acceso a ese perfil para reutilizarla.

Abrí **Windows PowerShell como administrador**. La elevación de UAC la realiza Windows. Los scripts no guardan ni muestran la contraseña de Valentina. Elegí una contraseña temporal nueva, diferente de cualquier credencial SSH o de correo, y entregala por un canal privado. Valentina debe cambiarla al empezar.

Primero podés inspeccionar el plan sin elevar ni cambiar permisos:

```powershell
Set-Location C:\dev\weotzi-unified
.\scripts\windows\Provision-Valentina.ps1 -AuditOnly
```

Preparación con un clon desde GitHub. La versión inicial y la corrección 2.1.1 ya se publicaron en `main`; el clon obtiene la versión vigente al ejecutarse:

```powershell
Set-Location C:\dev\weotzi-unified
$valentinaPassword = Read-Host 'Contraseña temporal nueva de Windows para Valentina' -AsSecureString
.\scripts\windows\Provision-Valentina.ps1 -AccountPassword $valentinaPassword
```

Si el repositorio es privado y se quiere que ella realice el clon con su propio GitHub, agregá `-SkipClone`. El script crea y protege la carpeta de trabajo; ella ejecuta luego el `git clone` mostrado arriba. El clon no contiene el `.env`, los archivos temporales, los chats ni las credenciales de la copia original.

Cada ejecución produce un manifiesto y backups de las DACL originales en una carpeta privada:

```text
C:\ProgramData\WeOtzi\WindowsIsolation\Valentina-<fecha-hora>\manifest.json
```

La ruta exacta aparece al finalizar. En las carpetas compartidas de proyectos, la copia de ACL usa `icacls /save /T`, y el cambio deniega sólo el SID de Valentina con `/T`. Así incluye archivos con herencia protegida. El perfil de Isaí ya tiene permisos privados: allí se respaldan y protegen directamente la raíz y las carpetas conocidas de Codex, SSH y secretos, sin recorrer caches de Windows ni enlaces de compatibilidad del perfil. La prueba usa rutas directas a los secretos; no se da por suficiente denegar una lista de directorio. `/L` evita modificar el destino de enlaces fuera de los directorios seleccionados. Si un backup o cambio falla, la cuenta nueva queda deshabilitada y el manifiesto registra qué cambios llegaron a hacerse para restaurarlos.

**No dar la preparación por terminada sólo porque existen ACL o un usuario.** Comprobá el acceso con su token real:

```powershell
$valentinaCredential = [pscredential]::new("$env:COMPUTERNAME\Valentina", $valentinaPassword)
.\scripts\windows\Verify-ValentinaAccess.ps1 `
  -ManifestPath 'C:\ProgramData\WeOtzi\WindowsIsolation\Valentina-<fecha-hora>\manifest.json' `
  -Credential $valentinaCredential
$valentinaPassword = $null
$valentinaCredential = $null
```

La verificación inicia un proceso oculto autenticado como Valentina y carga su propio perfil. Prueba leer y escribir la carpeta de trabajo, confirma que no es administradora y comprueba que no puede listar/escribir los directorios protegidos ni abrir directamente el `.env` original o la credencial SSH. Abre los archivos sólo para verificar permisos, sin leer ni mostrar su contenido. Guarda `effective-access-report.json` junto al manifiesto. Debe terminar con **`passed: true`** y el SID correcto.

La automatización de esta preparación puede usar `Initialize-ValentinaElevated.ps1`: recibe `-CredentialPath` con un archivo `PSCredential` cifrado con DPAPI por Isaí y `-ResultPath` para su informe JSON, ambos dentro de su perfil privado. Se lanza con `Start-Process -Verb RunAs -WindowStyle Hidden`; UAC requiere confirmación en Windows. El wrapper importa la contraseña sólo en memoria, ejecuta la preparación y, cuando crea el clon, también verifica el acceso real. Con `-SkipClone` sólo prepara cuenta y permisos y registra explícitamente que la verificación completa queda pendiente. Ese archivo DPAPI permanece exclusivamente en el perfil privado de Isaí; no debe entregarse a Valentina ni copiarse al repositorio.

Después, iniciá una sesión real de Valentina para comprobar Codex, GitHub y el modo de desarrollo. No la agregues a `Administradores`, `docker-users`, `CodexSandboxUsers` ni grupos de administración remota: eso cambiaría el límite que se verificó. Si más adelante se agrega otro proyecto fuera de los directorios inventariados, agregá su directorio a `-ProtectedRoots`, ejecutá la preparación y repetí la prueba. No se promete protección de ubicaciones que no se incluyeron en el manifiesto.

En la primera sesión de su Codex, pedile a la IA que ejecute:

```powershell
whoami /user
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\Test-MyIsolation.ps1
```

El informe también debe indicar **`passed: true`**. Esta prueba comprueba el usuario que ejecuta las herramientas de Codex, además del inicio de sesión de Windows. En este PC existen usuarios auxiliares `CodexSandboxOnline` y `CodexSandboxOffline` y un grupo `CodexSandboxUsers` con permisos en el perfil de Isaí. No se debe reutilizar un auxiliar compartido que mantenga acceso a ese perfil para ejecutar las herramientas de Valentina. Si el SID que imprime la herramienta no es el SID de Valentina, detengan el onboarding y revisen su configuración antes de continuar. La prueba no lee el contenido de los secretos.

## Volver atrás

Conservá el manifiesto y todos sus archivos `.acl`. En una consola elevada:

```powershell
.\scripts\windows\Restore-ValentinaIsolation.ps1 `
  -ManifestPath 'C:\ProgramData\WeOtzi\WindowsIsolation\Valentina-<fecha-hora>\manifest.json'
```

Esto restaura las DACL y los grupos anteriores. La cuenta queda deshabilitada para no abrir acceso involuntariamente después de quitar sus restricciones. El clon se conserva para recuperar trabajo. Si esa ejecución creó la cuenta y también querés eliminarla, agregá `-RemoveCreatedAccount`; no borra el clon ni el perfil.

Para deshacer toda la preparación usá el manifiesto **de la primera ejecución**, ya que una segunda ejecución respalda el estado ya protegido. No reemplaces este rollback por `icacls /reset` ni por eliminar permisos generales: se perderían reglas anteriores de otros usuarios.

El rollback de Windows es independiente del rollback de una versión de la web. El procedimiento de releases y rollback del servidor está en el handoff técnico del proyecto.
