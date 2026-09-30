# Activar GitHub desde la cuenta propietaria

Estos scripts los ejecuta **Isaí**. No requieren administrador de Windows: requieren una sesión propia de GitHub CLI con **Administration** sobre [WeOtzi/betav1](https://github.com/WeOtzi/betav1). No hacen login, no copian tokens del conector Codex y no envían credenciales al servidor. Sin `-Apply` solo leen; `-AuditOnly` y `-Apply` juntos se rechazan.

## 1. Iniciar sesión y revisar

En PowerShell de **tu perfil Windows**, abre `C:\dev\weotzi-unified`. La cuenta CLI comprobada el 30/09/2026 es `isai-weotzi`, con lectura; eso no demuestra permiso administrativo aunque el conector Codex haya publicado código. Para administrar, inicia sesión con **WeOtzi** o una cuenta con administración efectiva del repositorio. El login y su autorización los completas tú:

```powershell
cd C:\dev\weotzi-unified
gh auth login --hostname github.com --git-protocol https --web
gh api user --jq .login
gh api repos/WeOtzi/betav1 --jq .permissions
gh auth setup-git --hostname github.com
& '.\scripts\github\Configure-WeOtziRepository.ps1' -AuditOnly -GrantWriteLogin isai-weotzi
```

Si una política de ejecución bloquea un script, revisa la firma y la política con Isaí; este procedimiento no la desactiva. El script exige `permissions.admin=true` antes de escribir. Si la sesión sigue siendo de lectura, la auditoría lo informa y termina sin cambios. No pongas contraseñas ni tokens en comandos, archivos o chats. Si ya hay varias cuentas guardadas, puedes elegir tú la propietaria con `gh auth switch --hostname github.com --user WeOtzi` en vez de registrar otra sesión.

## 2. Aplicar la protección y habilitar tu cuenta de trabajo

Revisa la auditoría y después ejecuta:

```powershell
& '.\scripts\github\Configure-WeOtziRepository.ps1' -Apply -GrantWriteLogin isai-weotzi
```

Primero crea un respaldo privado bajo **`%USERPROFILE%\WeOtzi-Admin-Backups\github-<fecha>-<id>\backup.json`**, con ACL para tu perfil, SYSTEM y administradores. Incluye reglas y permisos, nunca tokens. No lo agregues a Git ni lo compartas con Dev.

Configura una **protección clásica para `main`**, conservando otros checks y las restricciones más fuertes existentes: PR con al menos una aprobación, descartar aprobaciones al subir cambios, revisión de CODEOWNERS, conversaciones resueltas y rama actualizada. Requiere exactamente **`Tests and release policy`**, vinculado al ID real de la App oficial GitHub Actions leído y comprobado contra el SHA actual de `main`. Incluye administradores; deshabilita force push, eliminación y excepciones de revisión. Conserva firmas, historial lineal, locks y restricciones previas. Comprueba CODEOWNERS remoto y todos estos campos mediante una nueva lectura antes de **cada** invitación. Los rulesets, incluso heredados, se inspeccionan pero no se reescriben.

Solo después intenta habilitar **escritura** para `isai-weotzi`. Nunca le otorga administración ni le baja un permiso superior existente. Una respuesta `201` crea una invitación: **tienes que aceptarla con `isai-weotzi`**; todavía no significa que el CLI pueda publicar. El script vuelve a leer los permisos o la invitación, sin afirmar aceptación. Si ya hay otra invitación pendiente, no la sustituye. En repositorios de organización detiene el cambio de usuarios, porque el REST consultado no diferencia todos los permisos heredados y no permite un rollback individual fiable.

Después de aceptar, cambia a tu cuenta de trabajo y conecta **su** sesión con Git:

```powershell
gh auth switch --hostname github.com --user isai-weotzi
gh auth setup-git --hostname github.com
gh api user --jq .login
gh api repos/WeOtzi/betav1 --jq .permissions
```

Comprueba `push=true`. El script no hace un push de prueba ni modifica archivos del proyecto. El próximo cambio se publica en una rama y PR; `main` exige aprobación de **WeOtzi**, distinta de la cuenta autora del PR. No uses un push a `main` para ensayar.

## 3. Habilitar el GitHub de Dev / Valentina

**Dev es el usuario Windows; no es automáticamente un usuario GitHub.** Cuando Valentina informe su login personal y el aislamiento Windows esté comprobado, puedes ejecutar desde la sesión administradora:

```powershell
# Sustituye LOGIN_PERSONAL por el usuario GitHub real que ella confirmo.
& '.\scripts\github\Configure-WeOtziRepository.ps1' -AuditOnly -DevGitHubLogin LOGIN_PERSONAL
& '.\scripts\github\Configure-WeOtziRepository.ps1' -Apply -DevGitHubLogin LOGIN_PERSONAL
```

La invitación le llega a **su cuenta GitHub** y ella la acepta. Luego inicia sesión con GitHub CLI en su perfil Dev y ejecuta `gh auth setup-git`; no compartas la sesión administradora. Trabaja en `valentina/<tarea>` y abre un PR; Isaí revisa. El servidor descarga commits aprobados por CI y publica sus previews sin darle SSH. Consulta [el handoff](HANDOFF-VALENTINA.md) y [su primera tarea](VALENTINA-FIRST-TASK.md).

## 4. Volver atrás de esta configuración

No confundir este rollback de **permisos GitHub** con `git revert`, rollback del servidor o recuperación de Supabase. Primero revisa el respaldo exacto cuya ruta imprimió el script:

```powershell
$respaldo = 'C:\Users\TU_PERFIL\WeOtzi-Admin-Backups\github-FECHA-ID\backup.json'
& '.\scripts\github\Restore-WeOtziRepository.ps1' -BackupPath $respaldo -AuditOnly
& '.\scripts\github\Restore-WeOtziRepository.ps1' -BackupPath $respaldo -Apply
```

El rollback normal cancela solamente invitaciones nuevas todavía pendientes y revierte cambios individuales registrados. **Conserva `main` protegida.** No toca accesos previos, equipos, rulesets o una regla que haya cambiado desde la aplicación. Si una invitación ya fue aceptada, detenerse es intencional: retirar un colaborador puede afectar sus forks y PR. Para retirar solamente el acceso nuevo registrado, después de revisar ese efecto añade `-RemoveAcceptedCollaborators`.

Para recuperar una protección clásica que ya existía antes, añade `-RestoreProtection`; normaliza el payload de REST y elimina campos de lectura que no admite PUT. Si antes no había protección, este parámetro también la conserva: retirarla exige adicionalmente **`-RemoveCreatedProtection`**, decisión administrativa explícita que deja la rama con el estado previo. No retires la protección mientras Dev u otra colaboradora conserve escritura. Una operación incierta o un cambio posterior exige revisión manual: no repitas PUT/DELETE ciegamente ni uses un respaldo de otro perfil.

Referencia de los contratos usados: [protección de ramas](https://docs.github.com/en/rest/branches/branch-protection#update-branch-protection), [permisos e invitaciones de colaboradores](https://docs.github.com/en/rest/collaborators/collaborators#add-a-repository-collaborator), [check runs y App de origen](https://docs.github.com/en/rest/checks/runs#list-check-runs-for-a-git-reference).
