#requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$CredentialPath,
    [Parameter(Mandatory=$true)][string]$ResultPath,
    [string]$OwnerProfilePath = 'C:\Users\Isaí',
    [switch]$SkipClone
)
$ErrorActionPreference = 'Stop'
$currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not ([Security.Principal.WindowsPrincipal]::new($currentIdentity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'The wrapper must be started elevated with RunAs.' }
$ownerProfile = (Resolve-Path -LiteralPath $OwnerProfilePath).ProviderPath.TrimEnd('\')
$credentialFile = (Resolve-Path -LiteralPath $CredentialPath).ProviderPath
$resultFile = [IO.Path]::GetFullPath($ResultPath)
foreach ($checkedPath in @($credentialFile, $resultFile)) {
    if (-not $checkedPath.StartsWith($ownerProfile + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Credential and result files must stay inside the protected owner profile.' }
}
$result = [ordered]@{startedAt=(Get-Date).ToUniversalTime().ToString('o'); elevated=$true; status='starting'; user='Valentina'; skipClone=[bool]$SkipClone; credentialsCopied=$false; manifest=$null; error=$null}
New-Item -ItemType Directory -Path (Split-Path -Parent $resultFile) -Force | Out-Null
try {
    # DPAPI decrypts only for the owner account that exported the PSCredential.
    # UAC raises that same account; logging in as another administrator fails.
    $credential = Import-Clixml -LiteralPath $credentialFile
    if ($credential -isnot [Management.Automation.PSCredential] -or $credential.UserName -notmatch '(^|\\)Valentina$') { throw 'Credential file must be an owner-encrypted PSCredential for the Valentina local account.' }
    $provisionArguments = @{AccountPassword=$credential.Password; OwnerProfilePath=$ownerProfile; SkipClone=[bool]$SkipClone}
    $provisionText = & (Join-Path $PSScriptRoot 'Provision-Valentina.ps1') @provisionArguments
    $provisionResult = ($provisionText | Out-String) | ConvertFrom-Json
    $result.manifest = $provisionResult.manifest
    $result.workspace = $provisionResult.clone
    $result.status = 'provisioned-awaiting-effective-access-verification'
    if (-not $SkipClone) {
        & (Join-Path $PSScriptRoot 'Verify-ValentinaAccess.ps1') -ManifestPath $result.manifest -Credential $credential | Out-Null
        $result.status = 'verified'
    }
} catch {
    $result.status = 'failed'
    $result.error = $_.Exception.Message
    if (Get-LocalUser -Name Valentina -ErrorAction SilentlyContinue) { Disable-LocalUser -Name Valentina -ErrorAction SilentlyContinue }
    throw
} finally {
    $result.finishedAt = (Get-Date).ToUniversalTime().ToString('o')
    $result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $resultFile -Encoding UTF8
    $credential = $null
}
