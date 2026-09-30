#requires -Version 5.1
# This script must run from Valentina's Codex terminal, not the owner's.
[CmdletBinding()]
param([string]$WorkspaceRoot = 'C:\WeOtzi-Valentina')
$ErrorActionPreference = 'Stop'
$marker = Get-Content -LiteralPath (Join-Path $WorkspaceRoot '.weotzi-windows-isolation.json') -Raw | ConvertFrom-Json
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$checks = New-Object Collections.Generic.List[object]
$checks.Add([pscustomobject]@{kind='tool-process-user'; expected=$marker.userSid; actual=$identity.User.Value; passed=($identity.User.Value -eq $marker.userSid)})
foreach ($path in @('C:\dev\weotzi-unified\.env', 'C:\Users\Isaí\.codex\auth.json', 'C:\Users\Isaí\.codex\skills\weotzi-deploy-web\secrets\weotzi-ssh.credential.clixml')) {
    $opened = $false
    try { $stream = [IO.File]::Open($path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite); $stream.Dispose(); $opened = $true } catch { }
    $checks.Add([pscustomobject]@{kind='owner-secret-direct-open'; path=$path; expected='denied'; passed=(-not $opened)})
}
foreach ($path in @('C:\dev', 'C:\Users\Isaí\.codex')) {
    $listed = $false
    try { $iterator = [IO.Directory]::EnumerateFileSystemEntries($path).GetEnumerator(); [void]$iterator.MoveNext(); $listed = $true; $iterator.Dispose() } catch { }
    $checks.Add([pscustomobject]@{kind='other-project-directory-list'; path=$path; expected='denied'; passed=(-not $listed)})
}
$report = [ordered]@{actualUser=$identity.Name; actualSid=$identity.User.Value; checks=@($checks); passed=(@($checks | Where-Object { -not $_.passed }).Count -eq 0)}
$report | ConvertTo-Json -Depth 7
if (-not $report.passed) { throw 'Codex tools are not running with the verified restricted user. Stop onboarding and ask the owner to inspect sandbox/process identity.' }
