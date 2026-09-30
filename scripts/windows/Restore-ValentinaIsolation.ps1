#requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$ManifestPath,
    [switch]$RemoveCreatedAccount
)
$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not ([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run rollback as Administrator.' }
$resolvedManifest = (Resolve-Path -LiteralPath $ManifestPath).ProviderPath
if (-not $resolvedManifest.StartsWith('C:\ProgramData\WeOtzi\WindowsIsolation\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Manifest must be the private provisioning backup.' }
$manifest = Get-Content -LiteralPath $resolvedManifest -Raw | ConvertFrom-Json
$account = Get-LocalUser -Name $manifest.user -ErrorAction SilentlyContinue
if ($account -and $account.SID.Value -ne $manifest.userSid) { throw 'Current account SID differs; refusing rollback against another user.' }
if ($account -and $account.SID.Value -eq $identity.User.Value) { throw 'Do not roll back the account running this script.' }
if ($account) { Disable-LocalUser -Name $manifest.user }
$backupFolder = Split-Path -Parent $resolvedManifest
foreach ($entry in @($manifest.aclBackups)) {
    $backupFile = (Resolve-Path -LiteralPath $entry.file).ProviderPath
    if (-not $backupFile.StartsWith($backupFolder + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'ACL backup escaped the verified backup folder.' }
    $actualRoot = (Resolve-Path -LiteralPath $entry.root).ProviderPath.TrimEnd('\')
    if ($actualRoot -eq [IO.Path]::GetPathRoot($actualRoot).TrimEnd('\') -or (Split-Path -Parent $actualRoot) -ne $entry.restoreBase) { throw 'Refusing an invalid restore root.' }
    $restoreOutput = @(& "$env:SystemRoot\System32\icacls.exe" $entry.restoreBase /restore $backupFile /C /L /Q 2>&1)
    if ($LASTEXITCODE -ne 0) { throw ('ACL restore failed; account remains disabled. ' + ($restoreOutput | Select-Object -Last 5 | Out-String)) }
}
if ($account) {
    foreach ($group in Get-LocalGroup) {
        if (@(Get-LocalGroupMember -Group $group -ErrorAction SilentlyContinue | Where-Object { $_.SID.Value -eq $manifest.userSid }).Count -and $manifest.previousGroups -notcontains $group.Name) { Remove-LocalGroupMember -Group $group -Member $account }
    }
    foreach ($groupName in @($manifest.previousGroups)) {
        if (-not @(Get-LocalGroupMember -Group $groupName -ErrorAction SilentlyContinue | Where-Object { $_.SID.Value -eq $manifest.userSid }).Count) { Add-LocalGroupMember -Group $groupName -Member $account }
    }
    if ($RemoveCreatedAccount -and $manifest.createdAccount) { Remove-LocalUser -Name $manifest.user }
}
[ordered]@{restoredAt=(Get-Date).ToUniversalTime().ToString('o'); restoredRoots=@($manifest.aclBackups.root); accountRemoved=[bool]($RemoveCreatedAccount -and $manifest.createdAccount); accountEnabled=$false; workspacePreserved=$manifest.workspace} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $backupFolder 'rollback-report.json') -Encoding UTF8
Write-Output 'Previous DACLs and group membership restored. Account stays disabled (or was removed); working copy is preserved for recovery.'
