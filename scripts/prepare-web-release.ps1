param([string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot))
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $ProjectRoot).Path
if (-not (Test-Path -LiteralPath (Join-Path $root 'server.js'))) { throw 'Invalid We Otzi project root' }
$releaseId = Get-Date -Format 'yyyyMMdd-HHmmss'
$releaseRoot = Join-Path $root "tmp\web-releases\$releaseId"
New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null
# Runtime allowlist prevents local credentials, agent files and QA artifacts reaching the web server.
foreach ($directory in @('public', 'lib', 'services', 'templates')) {
    $source = Join-Path $root $directory
    foreach ($file in Get-ChildItem -LiteralPath $source -Recurse -File) {
        $relative = [IO.Path]::GetRelativePath($root, $file.FullName)
        if ($relative -match '(^|[\\/])(uploads|storage|backups|node_modules)([\\/]|$)' -or $file.Name -match '^\.env|credential|\.log$') { continue }
        $destination = Join-Path $releaseRoot $relative
        New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
        Copy-Item -LiteralPath $file.FullName -Destination $destination
    }
}
foreach ($file in @('server.js', 'package.json', 'package-lock.json', 'ecosystem.config.js')) {
    Copy-Item -LiteralPath (Join-Path $root $file) -Destination (Join-Path $releaseRoot $file)
}
Copy-Item -LiteralPath (Join-Path $root 'deployments\hostinger\.htaccess') -Destination (Join-Path $releaseRoot '.htaccess')
Copy-Item -LiteralPath (Join-Path $root 'deployments\hostinger\proxy.php') -Destination (Join-Path $releaseRoot 'proxy.php')
$manifest = Get-ChildItem -LiteralPath $releaseRoot -Recurse -File -Force | ForEach-Object {
    [PSCustomObject]@{path=[IO.Path]::GetRelativePath($releaseRoot,$_.FullName).Replace('\','/');sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant();bytes=$_.Length}
}
$manifest | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path (Split-Path -Parent $releaseRoot) "$releaseId-manifest.json") -Encoding utf8
Write-Output $releaseRoot
