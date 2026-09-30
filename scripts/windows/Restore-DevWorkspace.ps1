#requires -Version 5.1
<#Manual owner rollback. Restores only captured DACLs/clone ownership, preserves
the existing Dev account, password, groups and all workspace files. No deletion.
AuditOnly validates the complete private manifest and hashes without writes.
#>
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$ManifestPath,[switch]$Apply,[switch]$AuditOnly)
$ErrorActionPreference='Stop'
if ($Apply -and $AuditOnly) { throw 'Choose Apply or AuditOnly, never both.' }
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$isAdmin=([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$backupBase='C:\ProgramData\WeOtzi\DevWorkspaceBackups'
$allowedRoots=@('C:\dev','C:\Webs Alejo Igoa Team','C:\c','C:\Remote','C:\Users\Isaí')
function Get-ReparseTag([string]$Path) {
    $lines=@(& "$env:SystemRoot\System32\fsutil.exe" reparsepoint query $Path 2>&1)
    $match=[regex]::Match(($lines | Out-String),'(?i)0x([0-9a-f]{8})')
    if ($LASTEXITCODE -ne 0 -or -not $match.Success) { throw "Cannot identify reparse metadata: $Path" }
    return [Convert]::ToUInt32($match.Groups[1].Value,16)
}
function Assert-PlainPath([string]$Path,[switch]$AllowCloudAncestors) {
    $absolute=[IO.Path]::GetFullPath($Path).TrimEnd('\')
    if ($absolute -notmatch '^C:\\[^\\]+' -or $absolute -ne $Path.TrimEnd('\')) { throw 'Invalid absolute path in the backup.' }
    $cursor=$absolute
    while ($cursor -and $cursor -ne 'C:\' -and $cursor -ne 'C:') {
        if (Test-Path -LiteralPath $cursor) {
            $item=Get-Item -LiteralPath $cursor -Force
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
                $knownCloudDirectory=$AllowCloudAncestors -and $item.PSIsContainer -and (((Get-ReparseTag $cursor) -band [uint32]4294905855) -eq [uint32]2415919130)
                if (-not $knownCloudDirectory) { throw "Linked backup path or unsupported ancestor: $cursor" }
            }
        }
        $cursor=Split-Path -Parent $cursor
    }
    return $absolute
}
$resolvedManifest=Assert-PlainPath $ManifestPath
if (-not $resolvedManifest.StartsWith($backupBase+'\',[StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $resolvedManifest) -ne 'manifest.json') { throw 'Use the exact private manifest printed by Configure-DevWorkspace.ps1.' }
$backup=Split-Path -Parent $resolvedManifest
if ((Split-Path -Parent $backup) -ne $backupBase) { throw 'Manifest must be directly in its private timestamped backup folder.' }
$manifest=Get-Content -LiteralPath $resolvedManifest -Raw | ConvertFrom-Json
$dev=Get-LocalUser -Name Dev
if ($manifest.schema -ne 1 -or $manifest.kind -ne 'WeOtzi-DevWorkspace' -or $manifest.machine -ne $env:COMPUTERNAME -or $manifest.userSid -ne $dev.SID.Value -or $manifest.workspace -ne 'C:\WeOtzi-Dev' -or $manifest.clone -ne 'C:\WeOtzi-Dev\weotzi-unified') { throw 'Manifest does not match this machine, account or workspace.' }
if ($identity.User.Value -eq $dev.SID.Value) { throw 'Only the owner restores private permissions, not Dev.' }
if ($manifest.status -eq 'restored') { throw 'This manifest was already restored. Do not replay a stale permission snapshot.' }
if (-not $manifest.aclChangesStarted -and -not $manifest.workspaceCreated -and -not $manifest.cloneOwnershipChanged) {
    [ordered]@{mode='read-only'; manifest=$resolvedManifest; noChangesToRestore=$true; privateAclChanges=$false; workspaceChanges=$false; accountPreserved=$true} | ConvertTo-Json
    return
}
foreach ($otherFolder in @(Get-ChildItem -LiteralPath $backupBase -Directory -Force)) {
    [void](Assert-PlainPath $otherFolder.FullName)
    $otherPath=Join-Path $otherFolder.FullName 'manifest.json'
    if ($otherPath -ne $resolvedManifest -and (Test-Path -LiteralPath $otherPath)) {
        [void](Assert-PlainPath $otherPath)
        $other=Get-Content -LiteralPath $otherPath -Raw | ConvertFrom-Json
        if ($other.kind -eq $manifest.kind -and $other.userSid -eq $manifest.userSid -and $other.aclChangesStarted -and $other.status -ne 'restored' -and [DateTimeOffset]::Parse($other.createdAt) -gt [DateTimeOffset]::Parse($manifest.createdAt)) {
            throw 'A newer permission operation is still active. Do not restore this older snapshot first.'
        }
    }
}
$accountGroups=@(Get-LocalGroup | ForEach-Object { $group=$_; if (@(Get-LocalGroupMember -Group $group -ErrorAction Stop | Where-Object {$_.SID.Value -eq $dev.SID.Value}).Count) { $group.SID.Value } })
if ([bool]$dev.Enabled -ne [bool]$manifest.previousEnabled -or @($accountGroups | Where-Object {$manifest.previousGroups -notcontains $_}).Count -or @($manifest.previousGroups | Where-Object {$accountGroups -notcontains $_}).Count) { throw 'Dev account state/groups changed after setup. Review those changes manually; this rollback never resets them.' }
function Assert-BackupFile([string]$Path,[string]$Hash) {
    $absolute=Assert-PlainPath $Path
    if ((Split-Path -Parent $absolute) -ne $backup) { throw 'Snapshot escaped the private backup folder.' }
    if (-not $Hash -or (Get-FileHash -LiteralPath $absolute -Algorithm SHA256).Hash -ne $Hash) { throw 'Snapshot hash mismatch; no restore will be applied.' }
    return $absolute
}
function Get-ExistingOrMissing([string]$Path) {
    try { return Get-Item -LiteralPath $Path -Force -ErrorAction Stop }
    catch { if ($_.CategoryInfo.Category -eq [Management.Automation.ErrorCategory]::ObjectNotFound) { return $null }; throw }
}
function Normalized-AccessRules($Acl) {
    @($Acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]) | Where-Object { -not ($_.IdentityReference.Value -eq $manifest.userSid -and $_.AccessControlType -eq 'Deny') } | ForEach-Object {
        '{0}|{1}|{2}|{3}|{4}|{5}' -f $_.IdentityReference.Value,$_.AccessControlType,[long]$_.FileSystemRights,$_.InheritanceFlags,$_.PropagationFlags,$_.IsInherited
    } | Sort-Object) -join "`n"
}
function Get-LinkAclRules([string]$Path) {
    $lines=@(& "$env:SystemRoot\System32\icacls.exe" $Path /L 2>&1)
    if ($LASTEXITCODE -ne 0) { throw "Cannot read current link ACL: $Path" }
    @($lines | ForEach-Object {
        $line=([string]$_).Trim()
        if ($line.StartsWith($Path,[StringComparison]::OrdinalIgnoreCase)) { $line=$line.Substring($Path.Length).Trim() }
        if ($line -match '^[^:]+:\([^\r\n]+') { $line }
    })
}
function Normalized-LinkRules([string[]]$Rules) {
    @($Rules | Where-Object {
        $rule=$_
        $identityName=$rule.Split(':')[0]
        $isDev=$identityName -eq $manifest.userSid -or $identityName -eq ($env:COMPUTERNAME+'\Dev')
        -not ($isDev -and $rule -match '\(DENY\)')
    } | Sort-Object) -join "`n"
}
$snapshot=Assert-BackupFile $manifest.snapshotFile $manifest.snapshotSha256
$entryCount=0
$missingPaths=New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
foreach ($line in [IO.File]::ReadLines($snapshot)) {
    $entry=$line | ConvertFrom-Json
    if (-not @($allowedRoots | Where-Object {$entry.path.Equals($_,[StringComparison]::OrdinalIgnoreCase) -or $entry.path.StartsWith($_+'\',[StringComparison]::OrdinalIgnoreCase)}).Count) { throw 'Snapshot entry escaped the approved private roots.' }
    $item=Get-ExistingOrMissing $entry.path
    if (-not $item) { [void](Assert-PlainPath (Split-Path -Parent $entry.path) -AllowCloudAncestors); [void]$missingPaths.Add($entry.path); $entryCount++; continue }
    if ($entry.kind -eq 'link') {
        [void](Assert-BackupFile $entry.backup $entry.sha256)
        # Root/ancestors must remain plain; the last component was deliberately a link.
        [void](Assert-PlainPath (Split-Path -Parent $entry.path) -AllowCloudAncestors)
        if (-not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or [bool]$item.PSIsContainer -ne [bool]$entry.directory -or (Get-ReparseTag $entry.path) -ne [uint32]$entry.reparseTag) { throw 'Captured reparse item changed type/tag; inspect before restoring.' }
        if ((Normalized-LinkRules @(Get-LinkAclRules $entry.path)) -ne (Normalized-LinkRules @($entry.rules))) { throw "Unrelated link ACL changes found: $($entry.path). Review before restoring an older baseline." }
    } elseif ($entry.kind -in @('directory','file')) {
        [void](Assert-PlainPath $entry.path -AllowCloudAncestors)
        if ([bool]$item.PSIsContainer -ne ($entry.kind -eq 'directory')) { throw 'Captured item changed file/directory type.' }
        $original=if($entry.kind -eq 'directory'){New-Object Security.AccessControl.DirectorySecurity}else{New-Object Security.AccessControl.FileSecurity}
        $original.SetSecurityDescriptorSddlForm($entry.sddl,[Security.AccessControl.AccessControlSections]::Access)
        $current=Get-Acl -LiteralPath $entry.path
        if ($current.AreAccessRulesProtected -ne $original.AreAccessRulesProtected -or (Normalized-AccessRules $current) -ne (Normalized-AccessRules $original)) { throw "Unrelated DACL changes found: $($entry.path). Review before restoring an older baseline." }
    }
    else { throw 'Unexpected snapshot entry kind.' }
    $entryCount++
}
if ($entryCount -ne $manifest.snapshotCount) { throw 'Snapshot item count mismatch.' }
$ownership=$null
if ($manifest.cloneOwnershipChanged) {
    $ownership=Assert-BackupFile $manifest.cloneOwnershipSnapshot $manifest.cloneOwnershipSha256
    foreach ($line in [IO.File]::ReadLines($ownership)) {
        $entry=$line | ConvertFrom-Json
        if (-not ($entry.path.Equals($manifest.clone,[StringComparison]::OrdinalIgnoreCase) -or $entry.path.StartsWith($manifest.clone+'\',[StringComparison]::OrdinalIgnoreCase))) { throw 'Ownership entry escaped the independent clone.' }
        [void](Assert-PlainPath $entry.path)
        if (-not (Get-ExistingOrMissing $entry.path)) { [void]$missingPaths.Add($entry.path) }
    }
}
if ($manifest.workspaceCreated) { [void](Assert-PlainPath $manifest.workspace) }
if ($AuditOnly -or -not $Apply) { [ordered]@{mode='read-only'; elevated=$isAdmin; manifest=$resolvedManifest; backedUpItems=$entryCount; missingItems=@($missingPaths); restoresDacl=[bool]$manifest.aclChangesStarted; restoresCloneOwnership=[bool]$manifest.cloneOwnershipChanged; preservesAccount=$true; preservesFiles=$true} | ConvertTo-Json -Depth 5; return }
if (-not $isAdmin) { throw 'Open Windows PowerShell as Administrator yourself. This script never requests elevation.' }
$restoreReport=Join-Path $backup ('restore-'+(Get-Date -Format 'yyyyMMdd-HHmmss-fff')+'.json')
$report=[ordered]@{startedAt=(Get-Date).ToUniversalTime().ToString('o'); status='restoring'; restoredPrivateItems=0; restoredOwners=0; missingItems=@($missingPaths); accountAndFilesPreserved=$true}
function Save-Report { $report | ConvertTo-Json | Set-Content -LiteralPath $restoreReport -Encoding UTF8 }
Save-Report
try {
    if ($manifest.aclChangesStarted) {
        # Snapshot order starts with each parent, then its actual descendants.
        foreach ($line in [IO.File]::ReadLines($snapshot)) {
            $entry=$line | ConvertFrom-Json
            if ($missingPaths.Contains($entry.path)) { continue }
            if ($entry.kind -eq 'link') {
                $output=@(& "$env:SystemRoot\System32\icacls.exe" (Split-Path -Parent $entry.path) /restore $entry.backup /L /Q 2>&1)
                if ($LASTEXITCODE -ne 0) { throw ('Link DACL restore failed: '+($output | Select-Object -Last 3 | Out-String)) }
            } else {
                $acl=Get-Acl -LiteralPath $entry.path
                $acl.SetSecurityDescriptorSddlForm($entry.sddl,[Security.AccessControl.AccessControlSections]::Access)
                Set-Acl -LiteralPath $entry.path -AclObject $acl
            }
            $report.restoredPrivateItems++
        }
    }
    if ($ownership) {
        foreach ($line in [IO.File]::ReadLines($ownership)) {
            $entry=$line | ConvertFrom-Json
            if ($missingPaths.Contains($entry.path)) { continue }
            $acl=Get-Acl -LiteralPath $entry.path
            $acl.SetSecurityDescriptorSddlForm($entry.sddl,[Security.AccessControl.AccessControlSections]::Owner)
            Set-Acl -LiteralPath $entry.path -AclObject $acl
            $report.restoredOwners++
        }
    }
    if ($manifest.workspaceCreated -and $manifest.workspaceOriginalSddl) {
        $acl=Get-Acl -LiteralPath $manifest.workspace
        $acl.SetSecurityDescriptorSddlForm($manifest.workspaceOriginalSddl,[Security.AccessControl.AccessControlSections]::Access)
        Set-Acl -LiteralPath $manifest.workspace -AclObject $acl
    }
    $report.status='restored'
    $report.finishedAt=(Get-Date).ToUniversalTime().ToString('o')
    Save-Report
    $manifest.status='restored'
    $manifest | Add-Member -NotePropertyName restoredAt -NotePropertyValue $report.finishedAt -Force
    $temporary=Join-Path $backup ('.manifest-'+[guid]::NewGuid().ToString('N')+'.tmp')
    [IO.File]::WriteAllText($temporary,($manifest | ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($true))
    # A plain $null binds as an empty backup path; NullString passes a true .NET null.
    [IO.File]::Replace($temporary,$resolvedManifest,[NullString]::Value)
    Write-Output "Captured DACLs/ownership restored for existing items; missing items were reported and not recreated. Dev's account/files preserved. Report: $restoreReport"
} catch { $report.status='failed'; $report.error=$_.Exception.Message; Save-Report; throw }
