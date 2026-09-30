#requires -Version 5.1
<#
Creates a standard local account and an independent working copy. Run in an
elevated Windows PowerShell. Credentials remain in memory; none are copied.
Use -AuditOnly to inspect the plan without changing the computer.
#>
[CmdletBinding()]
param(
    [ValidatePattern('^[A-Za-z][A-Za-z0-9_-]{0,19}$')][string]$UserName = 'Valentina',
    [Security.SecureString]$AccountPassword,
    [string]$WorkspaceRoot = 'C:\WeOtzi-Valentina',
    [string]$RepositoryUrl = 'https://github.com/WeOtzi/betav1.git',
    [string]$OwnerProfilePath = 'C:\Users\Isaí',
    [string[]]$ProtectedRoots = @('C:\dev', 'C:\Webs Alejo Igoa Team', 'C:\c', 'C:\Remote'),
    [switch]$SkipClone,
    [switch]$AuditOnly
)
$ErrorActionPreference = 'Stop'
$accountIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$isAdmin = ([Security.Principal.WindowsPrincipal]::new($accountIdentity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$workspacePath = [IO.Path]::GetFullPath($WorkspaceRoot).TrimEnd('\')
if ($workspacePath -notmatch '^[A-Za-z]:\\[^\\]+' -or (Split-Path -Leaf $workspacePath) -notlike "*$UserName*") { throw 'Workspace must be an absolute named folder for this user, never a drive root.' }
if ($RepositoryUrl -ne 'https://github.com/WeOtzi/betav1.git') { throw 'Repository must be the verified WeOtzi/betav1 HTTPS URL, without embedded credentials.' }
$ownerProfileResolved = (Resolve-Path -LiteralPath $OwnerProfilePath).ProviderPath.TrimEnd('\')
$privateProfileRoots = @($ownerProfileResolved, (Join-Path $ownerProfileResolved '.codex'), (Join-Path $ownerProfileResolved '.ssh'), (Join-Path $ownerProfileResolved 'AppData\Local\Codex'), (Join-Path $ownerProfileResolved '.codex\skills\weotzi-deploy-web\secrets'))
$selectedRoots = @(@($ProtectedRoots) + $privateProfileRoots | Where-Object { Test-Path -LiteralPath $_ } | ForEach-Object { (Resolve-Path -LiteralPath $_).ProviderPath.TrimEnd('\') } | Select-Object -Unique)
foreach ($protectedPath in $selectedRoots) {
    $protectedItem = Get-Item -LiteralPath $protectedPath -Force
    if (-not $protectedItem.PSIsContainer -or ($protectedItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "Refusing non-directory or reparse root: $protectedPath" }
    if ($protectedPath -eq [IO.Path]::GetPathRoot($protectedPath).TrimEnd('\')) { throw 'Refusing a whole drive ACL change.' }
    if ($workspacePath.Equals($protectedPath, [StringComparison]::OrdinalIgnoreCase) -or $workspacePath.StartsWith($protectedPath + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Independent workspace cannot be inside a protected root.' }
}
$existingUser = Get-LocalUser -Name $UserName -ErrorAction SilentlyContinue
$plan = [ordered]@{user=$UserName; elevated=$isAdmin; existingAccount=[bool]$existingUser; workspace=$workspacePath; clone=(Join-Path $workspacePath 'weotzi-unified'); repository=$RepositoryUrl; protectedRoots=$selectedRoots; mechanism='Explicit deny for this SID only; recursive DACL backup and restore'; copiesCredentials=$false}
if ($AuditOnly) { $plan | ConvertTo-Json -Depth 5; return }
if (-not $isAdmin) { throw 'Run this script as Administrator. AuditOnly is available without elevation.' }
if ($existingUser -and $existingUser.SID -eq $accountIdentity.User) { throw 'Refusing to restrict the currently running account.' }
$markerPath = Join-Path $workspacePath '.weotzi-windows-isolation.json'
if ((Test-Path -LiteralPath $workspacePath) -and -not (Test-Path -LiteralPath $markerPath)) { throw 'Existing workspace has no provisioning marker; choose a fresh folder instead of taking over existing data.' }
if (Test-Path -LiteralPath $workspacePath) {
    if ((Get-Item -LiteralPath $workspacePath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Workspace cannot be a junction or symlink.' }
    $existingMarker = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
    if ($existingMarker.user -ne $UserName -or $existingMarker.workspace -ne $workspacePath) { throw 'Workspace marker does not match this account and path.' }
}
$ownerSid = (Get-Acl -LiteralPath $OwnerProfilePath).Access | Where-Object { $_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Value -like '*\Isa*' } | Select-Object -First 1 -ExpandProperty IdentityReference
if ($ownerSid) { $ownerSid = $ownerSid.Translate([Security.Principal.SecurityIdentifier]).Value } else { $ownerSid = $accountIdentity.User.Value }
$backupPath = Join-Path 'C:\ProgramData\WeOtzi\WindowsIsolation' ($UserName + '-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
New-Item -ItemType Directory -Path $backupPath -Force | Out-Null
$backupAcl = New-Object Security.AccessControl.DirectorySecurity
$backupAcl.SetAccessRuleProtection($true, $false)
foreach ($principalSid in @('S-1-5-18', 'S-1-5-32-544', $ownerSid) | Select-Object -Unique) {
    $backupAcl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule([Security.Principal.SecurityIdentifier]::new($principalSid), 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
}
Set-Acl -LiteralPath $backupPath -AclObject $backupAcl
$manifestPath = Join-Path $backupPath 'manifest.json'
$manifest = [ordered]@{schema=1; createdAt=(Get-Date).ToUniversalTime().ToString('o'); user=$UserName; userSid=$null; createdAccount=$false; workspace=$workspacePath; createdWorkspace=(-not (Test-Path -LiteralPath $workspacePath)); ownerSid=$ownerSid; previousGroups=@(); aclBackups=@(); status='preparing'; clone=(Join-Path $workspacePath 'weotzi-unified')}
function Save-Manifest { $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifestPath -Encoding UTF8 }
function Invoke-CheckedIcacls([string[]]$Arguments) {
    $icaclsOutput = @(& "$env:SystemRoot\System32\icacls.exe" @Arguments 2>&1)
    if ($LASTEXITCODE -ne 0) { throw ('icacls failed; no account access will be enabled. ' + ($icaclsOutput | Select-Object -Last 5 | Out-String)) }
}
try {
    if (-not $existingUser) {
        if (-not $AccountPassword) { $AccountPassword = Read-Host "Choose a unique temporary Windows password for $UserName" -AsSecureString }
        $existingUser = New-LocalUser -Name $UserName -FullName 'Valentina - We Otzi development' -Description 'Standard user, independent We Otzi working copy' -Password $AccountPassword -Disabled
        $manifest.createdAccount = $true
    }
    $userSid = $existingUser.SID.Value
    $manifest.userSid = $userSid
    $manifest.previousGroups = @(Get-LocalGroup | ForEach-Object {
        $localGroup = $_
        if (@(Get-LocalGroupMember -Group $localGroup -ErrorAction SilentlyContinue | Where-Object { $_.SID.Value -eq $userSid }).Count) { $localGroup.Name }
    })
    Save-Manifest
    $standardGroup = Get-LocalGroup -SID 'S-1-5-32-545'
    if ($manifest.previousGroups -notcontains $standardGroup.Name) { Add-LocalGroupMember -Group $standardGroup -Member $existingUser }
    foreach ($groupName in $manifest.previousGroups) {
        if ($groupName -ne $standardGroup.Name) { Remove-LocalGroupMember -Group $groupName -Member $existingUser }
    }
    $rootIndex = 0
    foreach ($protectedPath in $selectedRoots) {
        $rootIndex++
        $aclBackup = Join-Path $backupPath ("root-$rootIndex.acl")
        # The owner profile is already private. Protect its root and known
        # secret/profile directories explicitly without walking OS caches or
        # restricted legacy junctions. Shared project roots use /T to cover
        # children with protected inheritance. /L never changes a linked target.
        $recursiveAcl = -not ($privateProfileRoots -contains $protectedPath)
        $saveArguments = @($protectedPath, '/save', $aclBackup, '/C', '/L', '/Q')
        if ($recursiveAcl) { $saveArguments += '/T' }
        Invoke-CheckedIcacls $saveArguments
        $manifest.aclBackups += [ordered]@{root=$protectedPath; restoreBase=(Split-Path -Parent $protectedPath); file=$aclBackup; recursive=$recursiveAcl; applied=$false}
        Save-Manifest
    }
    # Capture every baseline before any deny is added. Otherwise a nested
    # directory backup could already include the parent deny and undo would
    # accidentally restore that new inherited restriction.
    foreach ($aclEntry in $manifest.aclBackups) {
        $protectedPath = $aclEntry.root
        $denyArguments = @($protectedPath, '/deny', ("*${userSid}:(OI)(CI)(F)"), '/C', '/L', '/Q')
        if ($aclEntry.recursive) { $denyArguments += '/T' }
        Invoke-CheckedIcacls $denyArguments
        $aclEntry.applied = $true
        Save-Manifest
    }
    New-Item -ItemType Directory -Path $workspacePath -Force | Out-Null
    $workspaceAcl = New-Object Security.AccessControl.DirectorySecurity
    $workspaceAcl.SetAccessRuleProtection($true, $false)
    foreach ($principalSid in @('S-1-5-18', 'S-1-5-32-544', $ownerSid) | Select-Object -Unique) {
        $workspaceAcl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule([Security.Principal.SecurityIdentifier]::new($principalSid), 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
    }
    $workspaceAcl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule([Security.Principal.SecurityIdentifier]::new($userSid), 'Modify', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
    Set-Acl -LiteralPath $workspacePath -AclObject $workspaceAcl
    $clonePath = $manifest.clone
    if (-not $SkipClone) {
        if (-not (Test-Path -LiteralPath $clonePath)) {
            & git -c credential.interactive=never clone --quiet -- $RepositoryUrl $clonePath
            if ($LASTEXITCODE -ne 0) { throw 'Clone failed. Use SkipClone to provision first, then clone using her own GitHub account.' }
        } else {
            $actualRemote = (& git -c "safe.directory=$clonePath" -C $clonePath remote get-url origin 2>$null)
            if ($LASTEXITCODE -ne 0 -or $actualRemote -ne $RepositoryUrl) { throw 'Existing clone origin does not match the expected repository.' }
        }
        if (Test-Path -LiteralPath (Join-Path $clonePath '.env')) { throw 'Unexpected .env in the independent clone. Inspect it privately before proceeding.' }
        # Git is used by Valentina, so the clone must not be owned by Isaí.
        Invoke-CheckedIcacls @($clonePath, '/setowner', ("*$userSid"), '/T', '/C', '/L', '/Q')
    }
    [ordered]@{schema=1; user=$UserName; userSid=$userSid; workspace=$workspacePath; clone=$clonePath; provisionManifest=$manifestPath; noCredentialsCopied=$true} | ConvertTo-Json | Set-Content -LiteralPath $markerPath -Encoding UTF8
    $manifest.status = 'provisioned-awaiting-effective-access-verification'
    Save-Manifest
    Enable-LocalUser -Name $UserName
    Write-Output ([pscustomobject]@{user=$UserName; clone=$clonePath; manifest=$manifestPath; accountEnabled=$true; next='Run Verify-ValentinaAccess.ps1 with this user credential; do not infer isolation solely from ACLs.'} | ConvertTo-Json)
} catch {
    $manifest.status = 'failed'
    $manifest.error = $_.Exception.Message
    Save-Manifest
    if ($manifest.createdAccount) { Disable-LocalUser -Name $UserName -ErrorAction SilentlyContinue }
    throw
} finally { $AccountPassword = $null }
