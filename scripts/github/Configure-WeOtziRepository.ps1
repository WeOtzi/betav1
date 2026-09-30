#requires -Version 5.1
<#
.SYNOPSIS
Inspects WeOtzi/betav1, or applies its owner-reviewed protection/access setup.
.DESCRIPTION
Read-only unless the human operator supplies -Apply. Authentication remains in
GitHub CLI; this script neither logs in nor reads, copies or prints its token.
Restore-WeOtziRepository.ps1 delegates to the private restore parameter set.
#>
[CmdletBinding(DefaultParameterSetName = 'Configure')]
param(
    [switch]$AuditOnly,
    [switch]$Apply,
    [Parameter(ParameterSetName = 'Configure')]
    [ValidatePattern('^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$')]
    [string[]]$GrantWriteLogin = @(),
    [Parameter(ParameterSetName = 'Configure')]
    [ValidatePattern('^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$')]
    [string]$DevGitHubLogin,
    [Parameter(Mandatory = $true, ParameterSetName = 'Restore')]
    [string]$RestoreFrom,
    [Parameter(ParameterSetName = 'Restore')]
    [switch]$RestoreProtection,
    [Parameter(ParameterSetName = 'Restore')]
    [switch]$RemoveCreatedProtection,
    [Parameter(ParameterSetName = 'Restore')]
    [switch]$RemoveAcceptedCollaborators
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$script:Repo = 'WeOtzi/betav1'
$script:CheckName = 'Tests and release policy'
$script:CanMutate = $false
$script:GhPath = $null
$script:BackupFile = $null

function Get-Field($Object, [string]$Name, $Default = $null) {
    if ($null -eq $Object) { return $Default }
    if ($Object -is [System.Collections.IDictionary]) {
        if ($Object.Contains($Name)) { return $Object[$Name] }
        return $Default
    }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $Default }
    return $property.Value
}

function ConvertTo-WindowsArgument([string]$Value) {
    # CommandLineToArgvW quoting, including trailing backslashes before a quote.
    '"' + [regex]::Replace([regex]::Replace($Value, '(\\*)"', '$1$1\"'), '(\\+)$', '$1$1') + '"'
}

function Invoke-RepoApi {
    param([string]$Path, [ValidateSet('GET', 'PUT', 'DELETE')][string]$Method = 'GET', $Body = $null, [int[]]$AllowedStatus = @(200))
    if ($Method -ne 'GET') {
        if (-not $script:CanMutate -or -not $Apply -or $AuditOnly) { throw 'Escritura bloqueada: hace falta -Apply humano y permiso administrativo comprobado.' }
        if ($Path -notmatch '^repos/WeOtzi/betav1/(branches/main/protection|collaborators/[A-Za-z0-9-]+|invitations/[0-9]+)$') { throw 'Endpoint de escritura fuera del alcance autorizado.' }
    }
    if ($Path -match '^[a-z]+://' -or $Path.StartsWith('/') -or $Path.Contains('..')) { throw 'Ruta API no permitida.' }
    $arguments = @('api', '--hostname', 'github.com', '--method', $Method, '--include', '-H', 'Accept: application/vnd.github+json', '-H', 'X-GitHub-Api-Version: 2022-11-28', $Path)
    if ($null -ne $Body) { $arguments += @('--input', '-') }
    $start = New-Object System.Diagnostics.ProcessStartInfo
    $start.FileName = $script:GhPath
    $start.Arguments = (($arguments | ForEach-Object { ConvertTo-WindowsArgument $_ }) -join ' ')
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.RedirectStandardInput = $true
    $start.StandardOutputEncoding = New-Object System.Text.UTF8Encoding($false)
    $start.StandardErrorEncoding = New-Object System.Text.UTF8Encoding($false)
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $start
    try {
        [void]$process.Start()
        $outputTask = $process.StandardOutput.ReadToEndAsync()
        $errorTask = $process.StandardError.ReadToEndAsync()
        if ($null -ne $Body) {
            $bytes = (New-Object System.Text.UTF8Encoding($false)).GetBytes(($Body | ConvertTo-Json -Depth 60 -Compress))
            $process.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
        }
        $process.StandardInput.Close()
        if (-not $process.WaitForExit(55000)) {
            $process.Kill()
            throw "Timeout consultando $Method $Path. No repitas una escritura sin inspeccionar el backup y el estado remoto."
        }
        $output = $outputTask.GetAwaiter().GetResult()
        [void]$errorTask.GetAwaiter().GetResult() # Never echo stderr, headers or authentication diagnostics.
        $match = [regex]::Match($output, '(?s)\AHTTP/\S+\s+(\d{3})[^\r\n]*\r?\n.*?\r?\n\r?\n(.*)\z')
        if (-not $match.Success) { throw "gh no devolvio una respuesta HTTP valida para $Method $Path. Comprueba gh auth status manualmente." }
        $status = [int]$match.Groups[1].Value
        if ($AllowedStatus -notcontains $status) { throw "GitHub rechazo $Method $Path (HTTP $status). No se imprimen credenciales ni cabeceras. Revisa permiso administrativo y alcance del token desde tu cuenta." }
        $data = $null
        if (-not [string]::IsNullOrWhiteSpace($match.Groups[2].Value)) { $data = $match.Groups[2].Value | ConvertFrom-Json }
        return [pscustomobject]@{ Status = $status; Data = $data }
    } finally { $process.Dispose() }
}

function Get-Collection([string]$Path) {
    $items = @()
    $separator = '?'
    if ($Path.Contains('?')) { $separator = '&' }
    for ($page = 1; $page -le 100; $page++) {
        $response = Invoke-RepoApi "$Path${separator}per_page=100&page=$page"
        $batch = @()
        if ($null -ne $response.Data) { $batch = @($response.Data) }
        $items += $batch
        if ($batch.Count -lt 100) { return $items }
    }
    throw 'La coleccion supera 10000 entradas; no se realizara una comprobacion parcial.'
}

function Get-Names($Object, [string]$Field, [string]$Property) {
    @(@(Get-Field $Object $Field @()) | ForEach-Object { if ($_ -is [string]) { $_ } else { Get-Field $_ $Property } } | Where-Object { $_ } | Sort-Object -Unique)
}

function Convert-Restrictions($Restrictions) {
    if ($null -eq $Restrictions) { return $null }
    [ordered]@{ users = @(Get-Names $Restrictions 'users' 'login'); teams = @(Get-Names $Restrictions 'teams' 'slug'); apps = @(Get-Names $Restrictions 'apps' 'slug') }
}

function Convert-Protection($Protection) {
    if ($null -eq $Protection) { return $null }
    $status = Get-Field $Protection 'required_status_checks'
    $checks = @()
    if ($null -ne $status) {
        foreach ($check in @(Get-Field $status 'checks' @())) { $checks += [ordered]@{ context = [string](Get-Field $check 'context'); app_id = Get-Field $check 'app_id' } }
        foreach ($context in @(Get-Field $status 'contexts' @())) {
            if (@($checks | Where-Object { $_.context -ceq $context }).Count -eq 0) { $checks += [ordered]@{ context = [string]$context; app_id = $null } }
        }
        $status = [ordered]@{ strict = [bool](Get-Field $status 'strict' $false); contexts = @(); checks = @($checks | Sort-Object context, app_id) }
    }
    $reviews = Get-Field $Protection 'required_pull_request_reviews'
    if ($null -ne $reviews) {
        $normalizedReviews = [ordered]@{
            dismiss_stale_reviews = [bool](Get-Field $reviews 'dismiss_stale_reviews' $false)
            require_code_owner_reviews = [bool](Get-Field $reviews 'require_code_owner_reviews' $false)
            required_approving_review_count = [int](Get-Field $reviews 'required_approving_review_count' 0)
            require_last_push_approval = [bool](Get-Field $reviews 'require_last_push_approval' $false)
        }
        $dismissal = Convert-Restrictions (Get-Field $reviews 'dismissal_restrictions')
        if ($null -ne $dismissal -and (@($dismissal.users).Count + @($dismissal.teams).Count + @($dismissal.apps).Count) -gt 0) { $normalizedReviews['dismissal_restrictions'] = $dismissal }
        $bypass = Convert-Restrictions (Get-Field $reviews 'bypass_pull_request_allowances')
        if ($null -eq $bypass) { $bypass = [ordered]@{ users = @(); teams = @(); apps = @() } }
        $normalizedReviews['bypass_pull_request_allowances'] = $bypass
        $reviews = $normalizedReviews
    }
    $payload = [ordered]@{
        required_status_checks = $status
        enforce_admins = [bool](Get-Field (Get-Field $Protection 'enforce_admins') 'enabled' $false)
        required_pull_request_reviews = $reviews
        restrictions = Convert-Restrictions (Get-Field $Protection 'restrictions')
    }
    foreach ($field in @('required_linear_history', 'allow_force_pushes', 'allow_deletions', 'block_creations', 'required_conversation_resolution', 'lock_branch', 'allow_fork_syncing')) {
        $payload[$field] = [bool](Get-Field (Get-Field $Protection $field) 'enabled' $false)
    }
    return $payload
}

function New-ProtectionPolicy($Previous, [int]$ActionsAppId, [string]$OwnerType, [string]$AdminLogin) {
    $payload = Convert-Protection $Previous
    if ($null -eq $payload) {
        $payload = [ordered]@{ required_status_checks = $null; enforce_admins = $false; required_pull_request_reviews = $null; restrictions = $null }
        foreach ($field in @('required_linear_history', 'allow_force_pushes', 'allow_deletions', 'block_creations', 'required_conversation_resolution', 'lock_branch', 'allow_fork_syncing')) { $payload[$field] = $false }
    }
    $checks = @()
    if ($null -ne $payload.required_status_checks) { $checks = @($payload.required_status_checks.checks) }
    foreach ($check in @($checks | Where-Object { $_.context -ceq $script:CheckName })) {
        if ($null -ne $check.app_id -and [int]$check.app_id -gt 0 -and [int]$check.app_id -ne $ActionsAppId) { throw 'El check existente del mismo nombre pertenece a otra App; revisa la regla sin sobrescribirla.' }
    }
    $checks = @($checks | Where-Object { $_.context -cne $script:CheckName }) + @([ordered]@{ context = $script:CheckName; app_id = $ActionsAppId })
    $payload.required_status_checks = [ordered]@{ strict = $true; contexts = @(); checks = @($checks | Sort-Object context, app_id) }
    $payload.enforce_admins = $true
    if ($null -eq $payload.required_pull_request_reviews) {
        $payload.required_pull_request_reviews = [ordered]@{ required_approving_review_count = 1; require_last_push_approval = $false }
    }
    $payload.required_pull_request_reviews.required_approving_review_count = [Math]::Max(1, [int]$payload.required_pull_request_reviews.required_approving_review_count)
    $payload.required_pull_request_reviews['dismiss_stale_reviews'] = $true
    $payload.required_pull_request_reviews['require_code_owner_reviews'] = $true
    $payload.required_pull_request_reviews['bypass_pull_request_allowances'] = [ordered]@{ users = @(); teams = @(); apps = @() }
    if ($OwnerType -eq 'Organization' -and $null -eq $payload.restrictions) { $payload.restrictions = [ordered]@{ users = @($AdminLogin); teams = @(); apps = @() } }
    if ($OwnerType -ne 'Organization' -and $null -ne $payload.restrictions) { throw 'Restricciones antiguas incompatibles con repositorio personal; no se sobrescribiran.' }
    $payload.allow_force_pushes = $false
    $payload.allow_deletions = $false
    $payload.required_conversation_resolution = $true
    return $payload
}

function Get-ProtectionSnapshot {
    $branch = (Invoke-RepoApi "repos/$script:Repo/branches/main").Data
    $response = Invoke-RepoApi "repos/$script:Repo/branches/main/protection" -AllowedStatus @(200, 404)
    $protection = $response.Data
    if ($response.Status -eq 404) { $protection = $null }
    # Rulesets are independent: never rewrite them, including inherited rules.
    $rulesets = @(Get-Collection "repos/$script:Repo/rulesets?includes_parents=true")
    [pscustomobject]@{
        protected = [bool]$branch.protected
        classicExists = ($null -ne $protection)
        classic = $protection
        payload = Convert-Protection $protection
        signatures = [bool](Get-Field (Get-Field $protection 'required_signatures') 'enabled' $false)
        rulesets = $rulesets
    }
}

function ConvertTo-StableJson($Value) {
    # API field order is irrelevant; allowlist arrays are sorted by normalization.
    if ($null -eq $Value) { return 'null' }
    if ($Value -is [System.Collections.IDictionary]) {
        $parts = @($Value.Keys | Sort-Object | ForEach-Object { (ConvertTo-StableJson ([string]$_)) + ':' + (ConvertTo-StableJson $Value[$_]) })
        return '{' + ($parts -join ',') + '}'
    }
    if ($Value -is [pscustomobject]) {
        $parts = @($Value.PSObject.Properties.Name | Sort-Object | ForEach-Object { (ConvertTo-StableJson ([string]$_)) + ':' + (ConvertTo-StableJson $Value.PSObject.Properties[$_].Value) })
        return '{' + ($parts -join ',') + '}'
    }
    if ($Value -is [System.Array]) { return '[' + (@($Value | ForEach-Object { ConvertTo-StableJson $_ }) -join ',') + ']' }
    return ($Value | ConvertTo-Json -Depth 60 -Compress)
}

function Assert-ProtectionMatches($Snapshot, $Expected, [bool]$Signatures) {
    if (-not $Snapshot.protected -or -not $Snapshot.classicExists) { throw 'main no muestra una proteccion clasica activa; no se habilitara escritura.' }
    if ((ConvertTo-StableJson $Snapshot.payload) -cne (ConvertTo-StableJson $Expected)) { throw 'La proteccion efectiva no coincide con la politica prevista. No se habilitara escritura ni se sobreescribira un cambio posterior.' }
    if ($Snapshot.signatures -ne $Signatures) { throw 'La exigencia de firmas cambio. Se detiene para preservar la regla existente.' }
}

function Assert-RulesetsUnchanged($Before, $After) {
    if ((ConvertTo-StableJson @($Before | Sort-Object id)) -cne (ConvertTo-StableJson @($After | Sort-Object id))) { throw 'Los rulesets cambiaron durante la operacion; no se habilitaran mas accesos.' }
}

function Get-AccessState([string]$Login) {
    $permission = Invoke-RepoApi "repos/$script:Repo/collaborators/$Login/permission" -AllowedStatus @(200, 404)
    $collaborators = @(Get-Collection "repos/$script:Repo/collaborators?affiliation=direct")
    $direct = @($collaborators | Where-Object { $_.login -ieq $Login })
    $invitations = @(Get-Collection "repos/$script:Repo/invitations")
    $pending = @($invitations | Where-Object { (Get-Field (Get-Field $_ 'invitee') 'login') -ieq $Login })
    $basePermission = 'none'
    $role = 'none'
    if ($permission.Status -eq 200) {
        $basePermission = [string](Get-Field $permission.Data 'permission' 'none')
        $role = [string](Get-Field $permission.Data 'role_name' $basePermission)
    }
    [pscustomobject]@{ login = $Login; basePermission = $basePermission; role = $role; direct = $direct; invitations = $pending }
}

function Test-WritePermission([string]$Permission) { return @('write', 'push', 'maintain', 'admin') -contains $Permission }

function New-PrivateBackup($Record) {
    $profile = [Environment]::GetFolderPath('UserProfile')
    if ([string]::IsNullOrWhiteSpace($profile)) { throw 'No se encontro un perfil privado para guardar el respaldo.' }
    $root = Join-Path $profile 'WeOtzi-Admin-Backups'
    if (Test-Path -LiteralPath $root) {
        $existingRoot = Get-Item -LiteralPath $root
        if (-not $existingRoot.PSIsContainer -or ($existingRoot.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'El directorio privado de respaldos no puede ser un archivo, enlace o junction.' }
    }
    $folder = Join-Path $root (('github-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffffffZ') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)))
    [void][System.IO.Directory]::CreateDirectory($folder)
    $security = New-Object System.Security.AccessControl.DirectorySecurity
    $security.SetAccessRuleProtection($true, $false)
    $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    $security.SetOwner($sid)
    foreach ($identity in @($sid, (New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')), (New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-544')))) {
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        $security.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $folder -AclObject $security
    $script:BackupFile = Join-Path $folder 'backup.json'
    Save-Backup $Record
    Write-Host "Respaldo privado: $script:BackupFile"
}

function Save-Backup($Record) {
    $temporary = Join-Path ([System.IO.Path]::GetDirectoryName($script:BackupFile)) ('journal-' + [Guid]::NewGuid().ToString('N') + '.tmp')
    [System.IO.File]::WriteAllText($temporary, ($Record | ConvertTo-Json -Depth 60), (New-Object System.Text.UTF8Encoding($false)))
    if (Test-Path -LiteralPath $script:BackupFile) { [System.IO.File]::Replace($temporary, $script:BackupFile, $null) }
    else { [System.IO.File]::Move($temporary, $script:BackupFile) }
}

function Read-PrivateBackup([string]$Path) {
    $full = [System.IO.Path]::GetFullPath($Path)
    $root = [System.IO.Path]::GetFullPath((Join-Path ([Environment]::GetFolderPath('UserProfile')) 'WeOtzi-Admin-Backups')) + [System.IO.Path]::DirectorySeparatorChar
    if (-not $full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -or [System.IO.Path]::GetFileName($full) -cne 'backup.json') { throw 'Usa el backup.json original dentro de tu perfil WeOtzi-Admin-Backups.' }
    $item = Get-Item -LiteralPath $full
    $cursor = $item
    while ($null -ne $cursor -and $cursor.FullName.StartsWith($root.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)) {
        if (($cursor.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'El respaldo no puede atravesar enlaces o junctions.' }
        if ($cursor -is [System.IO.FileInfo]) { $cursor = $cursor.Directory }
        else { $cursor = $cursor.Parent }
    }
    $record = [System.IO.File]::ReadAllText($full, (New-Object System.Text.UTF8Encoding($false))) | ConvertFrom-Json
    if ($record.schemaVersion -ne 1 -or $record.repository -cne $script:Repo -or $record.branch -cne 'main') { throw 'El respaldo no corresponde a este repositorio y esquema.' }
    $script:BackupFile = $full
    return $record
}

function Invoke-Configure($RepoInfo, $Identity, [int]$AppId) {
    $before = Get-ProtectionSnapshot
    $policy = New-ProtectionPolicy $before.classic $AppId $RepoInfo.owner.type $Identity.login
    $logins = @(@($GrantWriteLogin) + @($DevGitHubLogin) | Where-Object { $_ } | Sort-Object -Unique)
    $access = @()
    foreach ($login in $logins) {
        $user = (Invoke-RepoApi "users/$login").Data
        if ($user.type -cne 'User' -or $user.login -ine $login) { throw "La identidad $login no es una cuenta personal comprobada de GitHub." }
        $state = Get-AccessState $user.login
        if ($RepoInfo.owner.type -eq 'Organization') {
            throw 'El repositorio ahora pertenece a una organizacion. Sus permisos efectivos no distinguen grants heredados; revisa el acceso individual manualmente para no cambiarlo.'
        }
        if (@($state.invitations).Count -gt 0 -and -not (Test-WritePermission $state.invitations[0].permissions)) { throw "$login ya tiene una invitacion distinta pendiente. Aceptala/resuelvela primero; el script no reemplaza invitaciones previas." }
        $access += $state
    }
    Write-Host "Politica prevista: PR y CODEOWNERS, aprobaciones >= $($policy.required_pull_request_reviews.required_approving_review_count), CI '$script:CheckName' de GitHub Actions ($AppId), rama actualizada, conversaciones resueltas, administradores incluidos, sin force-push ni borrado."
    Write-Host 'Se conservan otros checks, exigencia de firmas, historial lineal, locks y restricciones existentes. Los rulesets se inspeccionan pero no se modifican.'
    foreach ($state in $access) { Write-Host "Acceso previsto: $($state.login); actual=$($state.role); invitaciones pendientes=$(@($state.invitations).Count)." }
    if (-not $Apply) { Write-Host 'AUDITORIA: no se guardaron archivos ni se modifico GitHub. Ejecuta -Apply solo despues de revisar esta politica.'; return }
    $record = [ordered]@{
        schemaVersion = 1; repository = $script:Repo; branch = 'main'; createdUtc = [DateTime]::UtcNow.ToString('o'); administrator = $Identity.login
        beforeProtection = $before; expectedProtection = $policy; accessBefore = $access
        collaboratorsBefore = @(Get-Collection "repos/$script:Repo/collaborators?affiliation=direct")
        invitationsBefore = @(Get-Collection "repos/$script:Repo/invitations")
        actions = @(); protectionStage = 'not-started'; restoreStage = 'not-started'
    }
    New-PrivateBackup $record
    # Detect concurrent policy changes after the backup, before the first PUT.
    $current = Get-ProtectionSnapshot
    if ((ConvertTo-StableJson $before.payload) -cne (ConvertTo-StableJson $current.payload) -or $before.signatures -ne $current.signatures) { throw 'La proteccion cambio despues del respaldo; no se modificara.' }
    Assert-RulesetsUnchanged $before.rulesets $current.rulesets
    $record.protectionStage = 'request-started'; Save-Backup $record
    [void](Invoke-RepoApi "repos/$script:Repo/branches/main/protection" -Method PUT -Body $policy)
    $after = Get-ProtectionSnapshot
    Assert-ProtectionMatches $after $policy $before.signatures
    Assert-RulesetsUnchanged $before.rulesets $after.rulesets
    $record.protectionStage = 'verified'; Save-Backup $record
    Write-Host 'Proteccion efectiva de main verificada. Ahora se pueden preparar los accesos solicitados.'
    foreach ($original in $access) {
        # Recheck protection immediately before EACH invitation/access change.
        $protection = Get-ProtectionSnapshot
        Assert-ProtectionMatches $protection $policy $before.signatures
        Assert-RulesetsUnchanged $before.rulesets $protection.rulesets
        $state = Get-AccessState $original.login
        if ((ConvertTo-StableJson $state) -cne (ConvertTo-StableJson $original)) { throw "El acceso de $($original.login) cambio desde el respaldo; no se sobrescribira." }
        if (Test-WritePermission $state.basePermission) { Write-Host "$($state.login) ya tiene $($state.role); se conserva sin bajarle permisos."; continue }
        if (@($state.invitations).Count -gt 0) { Write-Host "$($state.login): invitacion de escritura previa PENDIENTE de aceptacion; no se modifica."; continue }
        $action = [ordered]@{ login = $state.login; before = $state; stage = 'request-started'; invitationId = $null; responseStatus = $null; restored = $false }
        $record.actions += $action; Save-Backup $record
        $result = Invoke-RepoApi "repos/$script:Repo/collaborators/$($state.login)" -Method PUT -Body @{ permission = 'push' } -AllowedStatus @(201, 204)
        $action.responseStatus = $result.Status
        if ($result.Status -eq 201) {
            if ((Get-Field (Get-Field $result.Data 'invitee') 'login') -ine $state.login -or [long](Get-Field $result.Data 'id' 0) -le 0) { throw 'GitHub devolvio una invitacion inesperada; revisa el backup antes de actuar.' }
            $action.invitationId = [long]$result.Data.id
            $action.stage = 'invitation-created'; Save-Backup $record
        } else { $action.stage = 'permission-updated'; Save-Backup $record }
        $verified = Get-AccessState $state.login
        if ($result.Status -eq 201 -and @($verified.invitations | Where-Object { $_.id -eq $action.invitationId -and (Test-WritePermission $_.permissions) }).Count -eq 1) {
            Write-Host "$($state.login): invitacion de escritura creada; PENDIENTE de que acepte con SU cuenta. No se declara acceso CLI operativo todavia."
        } elseif (Test-WritePermission $verified.basePermission) {
            Write-Host "$($state.login): escritura efectiva comprobada. Su sesion CLI personal debe comprobarse por separado."
        } else { throw "La escritura de $($state.login) aun no esta comprobada. Inspecciona el respaldo y el estado antes de repetir el PUT." }
    }
    Write-Host "Terminado. Respaldo para rollback: $script:BackupFile"
    Write-Host 'No se copiaron credenciales ni se cambio la identidad CLI. Cada usuario debe iniciar sesion y ejecutar gh auth setup-git en SU perfil.'
}

function Invoke-Restore($Identity) {
    $record = Read-PrivateBackup $RestoreFrom
    if ($RemoveCreatedProtection -and -not $RestoreProtection) { throw '-RemoveCreatedProtection requiere -RestoreProtection explicito.' }
    $current = Get-ProtectionSnapshot
    Assert-RulesetsUnchanged $record.beforeProtection.rulesets $current.rulesets
    if ($record.protectionStage -eq 'not-started') { Write-Host 'Este respaldo no inicio cambios; no hay nada para revertir.'; return }
    Assert-ProtectionMatches $current $record.expectedProtection $record.beforeProtection.signatures
    foreach ($action in @($record.actions)) {
        if ($action.restored) { continue }
        if (@('invitation-created', 'permission-updated') -notcontains $action.stage) { throw "Resultado incierto para $($action.login): inspeccion manual obligatoria; no se eliminara un acceso no comprobado." }
        $state = Get-AccessState $action.login
        $pending = @($state.invitations | Where-Object { $_.id -eq $action.invitationId })
        Write-Host "Rollback previsto para $($action.login): solo el cambio registrado en este backup."
        if (-not $Apply) { continue }
        if ($pending.Count -eq 1) {
            if (-not (Test-WritePermission $pending[0].permissions) -or @($state.direct).Count -gt 0) { throw 'La invitacion o el acceso cambio desde la configuracion; no se cancelara.' }
            [void](Invoke-RepoApi "repos/$script:Repo/invitations/$($action.invitationId)" -Method DELETE -AllowedStatus @(204))
            if (@((Get-AccessState $action.login).invitations | Where-Object { $_.id -eq $action.invitationId }).Count -ne 0) { throw 'La cancelacion de la invitacion no esta comprobada.' }
        } elseif (@($state.direct).Count -eq 0 -and -not (Test-WritePermission $state.basePermission)) {
            Write-Host "$($action.login) ya no tiene el acceso introducido; no se cambia nada."
        } else {
            if ($state.basePermission -notin @('write', 'push') -or $state.role -notin @('write', 'push') -or @($state.direct).Count -ne 1 -or @($state.invitations).Count -ne 0) { throw "El acceso de $($action.login) es distinto o mayor; no se degradara ni retirara." }
            if (@($action.before.direct).Count -eq 1) {
                $previousRole = [string](Get-Field $action.before.direct[0] 'role_name' $action.before.role)
                $restoreRole = $previousRole
                if ($previousRole -eq 'read') { $restoreRole = 'pull' }
                if ($previousRole -eq 'write') { $restoreRole = 'push' }
                [void](Invoke-RepoApi "repos/$script:Repo/collaborators/$($action.login)" -Method PUT -Body @{ permission = $restoreRole } -AllowedStatus @(204))
                if ((Get-AccessState $action.login).role -ine $previousRole) { throw 'El permiso anterior aun no esta comprobado; no se retirara la proteccion.' }
            } else {
                if (-not $RemoveAcceptedCollaborators) { throw 'La invitacion fue aceptada. Para retirar SOLO este nuevo colaborador, revisa efectos sobre forks/PR y usa -RemoveAcceptedCollaborators. main sigue protegida.' }
                [void](Invoke-RepoApi "repos/$script:Repo/collaborators/$($action.login)" -Method DELETE -AllowedStatus @(204))
                if (Test-WritePermission (Get-AccessState $action.login).basePermission) { throw 'El retiro del acceso aun no esta comprobado; no se retirara la proteccion.' }
            }
        }
        $action.restored = $true; Save-Backup $record
    }
    if (-not $Apply) { Write-Host 'AUDITORIA de rollback: no se escribio ningun archivo ni se modifico GitHub.'; return }
    if ($RestoreProtection) {
        $current = Get-ProtectionSnapshot
        Assert-ProtectionMatches $current $record.expectedProtection $record.beforeProtection.signatures
        Assert-RulesetsUnchanged $record.beforeProtection.rulesets $current.rulesets
        if ($record.beforeProtection.classicExists) {
            [void](Invoke-RepoApi "repos/$script:Repo/branches/main/protection" -Method PUT -Body $record.beforeProtection.payload)
            $restored = Get-ProtectionSnapshot
            Assert-ProtectionMatches $restored $record.beforeProtection.payload $record.beforeProtection.signatures
            Assert-RulesetsUnchanged $record.beforeProtection.rulesets $restored.rulesets
            $record.restoreStage = 'access-and-existing-protection-restored'
        } elseif ($RemoveCreatedProtection) {
            # Main should remain protected normally. Removal is a separate, explicit owner action.
            $collaborators = @(Get-Collection "repos/$script:Repo/collaborators?affiliation=direct")
            $invitations = @(Get-Collection "repos/$script:Repo/invitations")
            if ((ConvertTo-StableJson @($collaborators | Sort-Object login)) -cne (ConvertTo-StableJson @($record.collaboratorsBefore | Sort-Object login)) -or (ConvertTo-StableJson @($invitations | Sort-Object id)) -cne (ConvertTo-StableJson @($record.invitationsBefore | Sort-Object id))) {
                throw 'Hay colaboradores/invitaciones distintos del estado previo; no se dejara main sin proteccion.'
            }
            [void](Invoke-RepoApi "repos/$script:Repo/branches/main/protection" -Method DELETE -AllowedStatus @(204))
            $restored = Get-ProtectionSnapshot
            if ($restored.classicExists) { throw 'La eliminacion de la regla creada no esta comprobada.' }
            Assert-RulesetsUnchanged $record.beforeProtection.rulesets $restored.rulesets
            $record.restoreStage = 'access-restored-created-protection-removed'
        } else { $record.restoreStage = 'access-restored-protection-kept'; Write-Host 'Antes no habia regla clasica; se conserva main protegida. Retirarla exige -RemoveCreatedProtection explicito.' }
    } else { $record.restoreStage = 'access-restored-protection-kept' }
    Save-Backup $record
    Write-Host "Rollback comprobado: $($record.restoreStage). No se modificaron rulesets ni accesos ajenos."
}

if ($AuditOnly -and $Apply) { throw 'Elige -AuditOnly o -Apply; nunca ambos.' }
$command = Get-Command gh -CommandType Application -ErrorAction SilentlyContinue
if ($null -eq $command) { throw 'Instala GitHub CLI. No se instala ni autentica automaticamente.' }
$script:GhPath = $command.Source
$identity = (Invoke-RepoApi 'user').Data
$repoInfo = (Invoke-RepoApi "repos/$script:Repo").Data
if ($repoInfo.full_name -cne $script:Repo -or $repoInfo.owner.login -cne 'WeOtzi' -or $repoInfo.archived) { throw 'Repositorio inesperado o archivado; no se modificara.' }
$branch = (Invoke-RepoApi "repos/$script:Repo/branches/main").Data
Write-Host "Cuenta CLI: $($identity.login). Repositorio: $script:Repo. Administracion: $($repoInfo.permissions.admin). Escritura: $($repoInfo.permissions.push). main protegida: $($branch.protected)."
if (-not $repoInfo.permissions.admin) {
    Write-Host 'Necesitas una sesion de gh del propietario WeOtzi o de otro administrador comprobado. El conector Codex no transfiere su identidad a gh.'
    Write-Host 'Tu ejecutas manualmente: gh auth login --hostname github.com --git-protocol https --web'
    Write-Host 'Despues de verificar la cuenta: gh auth setup-git --hostname github.com'
    if ($Apply) { throw 'No hay permiso administrativo; no se hicieron cambios.' }
    return
}
$script:CanMutate = [bool]$Apply
if ($PSCmdlet.ParameterSetName -eq 'Restore') { Invoke-Restore $identity; return }
$app = (Invoke-RepoApi 'apps/github-actions').Data
if ($app.slug -cne 'github-actions' -or $app.owner.login -cne 'github' -or [int]$app.id -le 0) { throw 'No se pudo comprobar la App oficial GitHub Actions.' }
$checks = (Invoke-RepoApi "repos/$script:Repo/commits/$($branch.commit.sha)/check-runs?per_page=100&filter=latest").Data
$matching = @($checks.check_runs | Where-Object { $_.name -ceq $script:CheckName -and $_.app.id -eq $app.id -and $_.app.slug -ceq 'github-actions' -and $_.head_sha -ceq $branch.commit.sha -and $_.status -ceq 'completed' -and $_.conclusion -ceq 'success' })
if ($matching.Count -eq 0) { throw 'El SHA actual de main no tiene el check aprobado de GitHub Actions requerido. No se inventara otro nombre o App ID.' }
$owners = (Invoke-RepoApi "repos/$script:Repo/contents/.github/CODEOWNERS?ref=$($branch.commit.sha)").Data
if ($owners.encoding -cne 'base64') { throw 'CODEOWNERS no se pudo leer de forma fiable.' }
$ownerText = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(($owners.content -replace '\s', '')))
$ownerLines = @($ownerText -split '\r?\n' | ForEach-Object { $_.Trim() } | Where-Object { $_ -and -not $_.StartsWith('#') })
if (@($ownerLines | Where-Object { $_ -match '^\*\s+@WeOtzi\s*$' }).Count -ne 1 -or @($ownerLines | Where-Object { $_ -notmatch '^\S+\s+@WeOtzi\s*$' }).Count -gt 0) { throw 'CODEOWNERS actual no asigna todas las rutas a WeOtzi; revisalo antes de habilitar accesos.' }
Invoke-Configure $repoInfo $identity ([int]$app.id)
