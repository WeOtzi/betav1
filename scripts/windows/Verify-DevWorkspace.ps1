#requires -Version 5.1
<#
Run in Dev's real Windows session, then once more from Dev's Codex terminal.
Reads private paths without printing their contents. Writes temporary probes
only in Dev's own clone. It never uses another user's password or RunAs.
#>
[CmdletBinding()]
param([string]$PlanPath='C:\WeOtzi-Dev\verify-plan.json', [switch]$RunTests)
$ErrorActionPreference='Stop'
$expectedSid=(Get-LocalUser -Name Dev).SID.Value
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
if ($identity.User.Value -ne $expectedSid) { throw "Run under the actual Dev account, including in Codex. Current identity: $($identity.Name). No verification was performed." }
$plan=Get-Content -LiteralPath $PlanPath -Raw | ConvertFrom-Json
if ($plan.schema -ne 1 -or $plan.userSid -ne $expectedSid -or $plan.machine -ne $env:COMPUTERNAME -or $plan.workspace -ne 'C:\WeOtzi-Dev' -or $plan.clone -ne 'C:\WeOtzi-Dev\weotzi-unified') { throw 'Verification plan does not match this Dev account and workspace.' }
$principal=[Security.Principal.WindowsPrincipal]::new($identity)
$checks=New-Object 'Collections.Generic.List[object]'
function Add-Check([string]$Kind,[string]$Path,[bool]$Passed,[string]$Detail) { $checks.Add([pscustomobject]@{kind=$Kind; path=$Path; passed=$Passed; detail=$Detail}) }
function Is-AccessDenied($ErrorRecord) {
    $exception=$ErrorRecord.Exception
    while ($exception) {
        if ($exception -is [UnauthorizedAccessException] -or (($exception.HResult -band 65535) -eq 5)) { return $true }
        $exception=$exception.InnerException
    }
    return $false
}
Add-Check 'actual-windows-identity' $identity.Name ($identity.User.Value -eq $expectedSid) $identity.User.Value
Add-Check 'not-administrator' $identity.Name (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) 'Dev must be standard; an administrator can take ownership of private data.'
foreach ($sid in @('S-1-5-32-544','S-1-5-32-547','S-1-5-32-551')) {
    Add-Check 'no-elevated-token-group' $sid (-not @($identity.Groups | Where-Object {$_.Value -eq $sid}).Count) 'Checks token membership, including a filtered administrator token.'
}
$sharedGroups=@($identity.Groups | ForEach-Object { try { $_.Translate([Security.Principal.NTAccount]).Value } catch { } } | Where-Object { $_ -match '\\(docker-users|CodexSandboxUsers)$' })
Add-Check 'no-shared-elevated-development-group' $identity.Name ($sharedGroups.Count -eq 0) 'No docker-users or shared Codex sandbox group in the actual token.'
$profile=[IO.Path]::GetFullPath($env:USERPROFILE).TrimEnd('\')
$ownProfile=$profile -match '^C:\\Users\\Dev(?:\.[^\\]+)?$' -and $env:USERNAME -eq 'Dev'
Add-Check 'separate-user-profile' $profile $ownProfile 'Windows USERPROFILE must belong to Dev; do not use the owner or shared Codex sandbox identity.'
foreach ($name in @('LOCALAPPDATA','APPDATA','TEMP','TMP')) {
    $value=[Environment]::GetEnvironmentVariable($name)
    $ownLocation=$false
    if ($value) { $ownLocation=[IO.Path]::GetFullPath($value).StartsWith($profile+'\',[StringComparison]::OrdinalIgnoreCase) }
    Add-Check 'own-profile-cache-location' $value $ownLocation ($name+' must use the Dev profile, not the owner profile or a shared sandbox.')
}
$requiredRoots=@('C:\dev','C:\Users\Isaí')
if (@($requiredRoots | Where-Object { $plan.protectedRoots -notcontains $_ }).Count) { throw 'Required private roots are missing from the verification plan.' }
foreach ($path in $plan.protectedRoots) {
    $denied=$false; $detail='Directory listing unexpectedly succeeded.'
    $iterator=$null
    try { $iterator=[IO.Directory]::EnumerateFileSystemEntries($path).GetEnumerator(); [void]$iterator.MoveNext() }
    catch { $denied=Is-AccessDenied $_; $detail=$(if($denied){'Access denied under the actual Dev token.'}else{'Missing path or unexpected error is not isolation evidence.'}) }
    finally { if ($iterator -is [IDisposable]) { $iterator.Dispose() } }
    Add-Check 'private-directory-list-denied' $path $denied $detail
}
if (-not @($plan.protectedFiles).Count) { throw 'No known existing private files were captured; direct-file isolation is unverified.' }
foreach ($path in $plan.protectedFiles) {
    if (-not @($plan.protectedRoots | Where-Object { $path.StartsWith($_+'\',[StringComparison]::OrdinalIgnoreCase) }).Count) { throw 'A file probe escaped the protected roots.' }
    $denied=$false; $detail='Known private file could be opened.'
    $stream=$null
    try { $stream=[IO.File]::Open($path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite) }
    catch { $denied=Is-AccessDenied $_; $detail=$(if($denied){'Opening an actual private file was denied; no contents were read.'}else{'Missing path or unexpected error is not proof of denied access.'}) }
    finally { if ($stream) { $stream.Dispose() } }
    Add-Check 'private-direct-file-open-denied' $path $denied $detail
}
foreach ($path in @($plan.workspace,$plan.clone,(Join-Path $plan.clone '.git'))) {
    $probe=Join-Path $path ('.dev-permission-probe-'+[guid]::NewGuid().ToString('N'))
    $passed=$false; $detail='Cannot create, read and delete an own-workspace probe.'
    try { [IO.File]::WriteAllText($probe,'temporary Dev permission verification'); $readBack=([IO.File]::ReadAllText($probe) -eq 'temporary Dev permission verification'); [IO.File]::Delete($probe); $passed=$readBack; $detail='Own workspace write, read and delete succeeded.' }
    catch { $detail='Own workspace probe failed; no private paths were modified.' }
    Add-Check 'own-workspace-read-write' $path $passed $detail
}
$commands=@{node='node.exe'; git='git.exe'; npm='npm.cmd'}
foreach ($name in $commands.Keys) {
    try {
        $command=Get-Command $commands[$name] -ErrorAction Stop
        $version=@(& $command.Source --version 2>&1)
        $passed=($LASTEXITCODE -eq 0)
        if ($name -eq 'node') { $passed=$passed -and (($version | Out-String).Trim() -match '^v22\.') }
        Add-Check 'runtime-available' $command.Source $passed (($version | Out-String).Trim())
    } catch { Add-Check 'runtime-available' $commands[$name] $false 'Not available in the Dev PATH; reopen its session after a system installation.' }
}
Push-Location $plan.clone
try {
    $remote=@(& git.exe remote get-url origin 2>&1)
    Add-Check 'git-own-clone-no-safe-directory-bypass' $plan.clone ($LASTEXITCODE -eq 0 -and ($remote | Out-String).Trim() -eq $plan.repository) 'Git must accept its own clone without a global safe.directory exception.'
    $privateNames=@(& git.exe ls-files | Where-Object { $_ -match '(^|/)(\.env($|\.)|\.server-credentials|auth\.json$)|\.(clixml|dpapi|pem|key)$' -and $_ -notmatch '(^|/)\.env\.(example|sample|template)$' })
    Add-Check 'no-private-files-in-public-checkout' $plan.clone ($LASTEXITCODE -eq 0 -and $privateNames.Count -eq 0) 'Filename-only review; no file contents or credentials are printed.'
    $npmCache=@(& npm.cmd config get cache 2>&1)
    $cacheText=($npmCache | Out-String).Trim()
    $ownNpmCache=$LASTEXITCODE -eq 0 -and $cacheText.StartsWith($profile+'\',[StringComparison]::OrdinalIgnoreCase)
    Add-Check 'own-npm-cache' $cacheText $ownNpmCache 'npm must keep its cache under the Dev profile.'
    if ($RunTests) {
        & npm.cmd ci --ignore-scripts
        Add-Check 'npm-ci-user-session' $plan.clone ($LASTEXITCODE -eq 0) 'Dependency installation ran with the Dev token, without lifecycle scripts or elevation.'
        if ($LASTEXITCODE -eq 0) {
            $previousTestToken=$env:CRON_API_TOKEN
            try {
                # Synthetic fixture only. Prevent server tests from generating
                # a local .env while keeping this value out of normal runtime.
                $env:CRON_API_TOKEN='dev-local-test-only'
                & npm.cmd test
                Add-Check 'npm-tests-user-session' $plan.clone ($LASTEXITCODE -eq 0) 'Full project test command under Dev, using a synthetic test-only token.'
            } finally { $env:CRON_API_TOKEN=$previousTestToken }
        }
    }
} finally { Pop-Location }
$report=[ordered]@{checkedAt=(Get-Date).ToUniversalTime().ToString('o'); actualUser=$identity.Name; actualSid=$identity.User.Value; profile=$profile; checks=@($checks); passed=(@($checks | Where-Object {-not $_.passed}).Count -eq 0); browserAndCodexLoginVerified=$false}
$reportPath=Join-Path $plan.workspace ('verification-'+(Get-Date -Format 'yyyyMMdd-HHmmss-fff')+'.json')
$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $reportPath -Encoding UTF8
$report | ConvertTo-Json -Depth 6
Write-Output "Report: $reportPath"
if (-not $report.passed) { throw 'Effective-access verification failed. Do not use this account for private project work until the owner reviews the failed checks.' }
Write-Output 'File access verified under Dev. Now open localhost:4647 using npm.cmd run dev:safe and confirm the PREVIEW banner, navigation and Dev-owned Codex identity.'
