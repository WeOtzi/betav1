#requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$ManifestPath,
    [Parameter(Mandatory=$true)][Management.Automation.PSCredential]$Credential,
    [string[]]$SensitiveFiles = @('C:\dev\weotzi-unified\.env', 'C:\Users\Isaí\.codex\auth.json', 'C:\Users\Isaí\.codex\skills\weotzi-deploy-web\secrets\weotzi-ssh.credential.clixml'),
    [ValidateRange(10,180)][int]$TimeoutSeconds = 60
)
$ErrorActionPreference = 'Stop'
$manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
$expectedSid = (Get-LocalUser -Name $manifest.user).SID.Value
if ($expectedSid -ne $manifest.userSid) { throw 'Manifest SID does not match the current local account.' }
$credentialSid = [Security.Principal.NTAccount]::new($Credential.UserName).Translate([Security.Principal.SecurityIdentifier]).Value
if ($credentialSid -ne $expectedSid) { throw 'Credential must belong to the exact provisioned Windows user.' }
$workspacePath = (Resolve-Path -LiteralPath $manifest.workspace).ProviderPath
$testDirectory = Join-Path $workspacePath ('access-check-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testDirectory | Out-Null
$requestPath = Join-Path $testDirectory 'request.json'
$responsePath = Join-Path $testDirectory 'response.json'
$workerPath = Join-Path $testDirectory 'access-probe.ps1'
$effectiveFiles = @($SensitiveFiles | Where-Object { Test-Path -LiteralPath $_ })
foreach ($aclEntry in $manifest.aclBackups) {
    # Include one actual source/config file per root as a direct path probe;
    # a denied directory listing alone is insufficient (Windows can traverse).
    $sampleFile = Get-ChildItem -LiteralPath $aclEntry.root -File -Force -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
    if ($sampleFile) { $effectiveFiles += $sampleFile }
    foreach ($childDirectory in @(Get-ChildItem -LiteralPath $aclEntry.root -Directory -Force -ErrorAction SilentlyContinue)) {
        if ($childDirectory.Attributes -band [IO.FileAttributes]::ReparsePoint) { continue }
        $projectSample = Get-ChildItem -LiteralPath $childDirectory.FullName -File -Force -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
        if ($projectSample) { $effectiveFiles += $projectSample }
    }
}
[ordered]@{expectedSid=$expectedSid; workspace=$workspacePath; clone=$manifest.clone; protectedRoots=@($manifest.aclBackups.root); sensitiveFiles=@($effectiveFiles | Select-Object -Unique)} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $requestPath -Encoding UTF8
$workerSource = @'
param([string]$RequestPath,[string]$ResponsePath)
$ErrorActionPreference = 'Stop'
$request = Get-Content -LiteralPath $RequestPath -Raw | ConvertFrom-Json
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
$checks = New-Object Collections.Generic.List[object]
foreach ($path in $request.protectedRoots) {
    $canList = $false
    try { $iterator = [IO.Directory]::EnumerateFileSystemEntries($path).GetEnumerator(); [void]$iterator.MoveNext(); $canList = $true; $iterator.Dispose() } catch { }
    $checks.Add([pscustomobject]@{kind='directory-list'; path=$path; expected='denied'; passed=(-not $canList)})
    $probeFile = [IO.Path]::Combine($path, '.valentina-permission-probe-' + [guid]::NewGuid().ToString('N'))
    $canWrite = $false
    try { $stream = [IO.File]::Open($probeFile, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write); $stream.Dispose(); $canWrite = $true; [IO.File]::Delete($probeFile) } catch { }
    $checks.Add([pscustomobject]@{kind='directory-write'; path=$path; expected='denied'; passed=(-not $canWrite)})
}
foreach ($path in $request.sensitiveFiles) {
    $canRead = $false
    try { $stream = [IO.File]::Open($path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite); $stream.Dispose(); $canRead = $true } catch { }
    $checks.Add([pscustomobject]@{kind='direct-file-open'; path=$path; expected='denied'; passed=(-not $canRead)})
}
$ownProbe = Join-Path $request.workspace ('.valentina-own-probe-' + [guid]::NewGuid().ToString('N'))
$canUseWorkspace = $false
try { [IO.File]::WriteAllText($ownProbe, 'temporary isolation verification'); $canUseWorkspace = ([IO.File]::ReadAllText($ownProbe) -eq 'temporary isolation verification'); [IO.File]::Delete($ownProbe) } catch { }
$checks.Add([pscustomobject]@{kind='own-workspace-read-write'; path=$request.workspace; expected='allowed'; passed=$canUseWorkspace})
$cloneReady = $false
try {
    $packagePath = Join-Path $request.clone 'package.json'
    $packageText = [IO.File]::ReadAllText($packagePath)
    $cloneProbe = Join-Path $request.clone ('.valentina-clone-probe-' + [guid]::NewGuid().ToString('N'))
    [IO.File]::WriteAllText($cloneProbe, 'temporary clone write verification')
    [IO.File]::Delete($cloneProbe)
    $cloneReady = ($packageText -match 'weotzi-unified')
} catch { }
$checks.Add([pscustomobject]@{kind='independent-clone-read-write'; path=$request.clone; expected='allowed'; passed=$cloneReady})
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$checks.Add([pscustomobject]@{kind='administrator-membership'; path=$identity.Name; expected='standard-user'; passed=(-not $isAdmin)})
$profileReady = $env:USERPROFILE -and (Split-Path -Leaf $env:USERPROFILE) -like '*Valentina*'
$checks.Add([pscustomobject]@{kind='independent-profile'; path=$env:USERPROFILE; expected='own-profile'; passed=[bool]$profileReady})
$report = [ordered]@{actualUser=$identity.Name; actualSid=$identity.User.Value; expectedSid=$request.expectedSid; sidMatches=($identity.User.Value -eq $request.expectedSid); isAdmin=$isAdmin; profile=$env:USERPROFILE; checks=@($checks); passed=(($identity.User.Value -eq $request.expectedSid) -and @($checks | Where-Object { -not $_.passed }).Count -eq 0)}
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ResponsePath -Encoding UTF8
if (-not $report.passed) { exit 1 }
'@
$workerSource | Set-Content -LiteralPath $workerPath -Encoding UTF8
$powershellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$argumentString = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $workerPath + '" -RequestPath "' + $requestPath + '" -ResponsePath "' + $responsePath + '"'
$process = Start-Process -FilePath $powershellPath -ArgumentList $argumentString -Credential $Credential -LoadUserProfile -WorkingDirectory $workspacePath -WindowStyle Hidden -PassThru
if (-not $process.WaitForExit($TimeoutSeconds * 1000)) { Stop-Process -Id $process.Id -Force; throw 'Effective-access probe timed out; isolation is not verified.' }
if (-not (Test-Path -LiteralPath $responsePath)) { throw 'User process did not write a report; isolation is not verified.' }
$report = Get-Content -LiteralPath $responsePath -Raw | ConvertFrom-Json
$persistedReport = Join-Path (Split-Path -Parent $ManifestPath) 'effective-access-report.json'
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $persistedReport -Encoding UTF8
$report | ConvertTo-Json -Depth 8
if (-not $report.passed -or $process.ExitCode -ne 0) { throw "Isolation failed under the user token. Review $persistedReport" }
Write-Output "Effective access verified under $($report.actualUser). Report: $persistedReport"
