#requires -Version 5.1
<#
.SYNOPSIS
Inspects/restores only changes recorded by Configure-WeOtziRepository.ps1.
.DESCRIPTION
Read-only by default. Keeps main protected unless the owner explicitly requests
protection restoration, and separately opts into removing a newly created rule.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$BackupPath,
    [switch]$AuditOnly,
    [switch]$Apply,
    [switch]$RestoreProtection,
    [switch]$RemoveCreatedProtection,
    [switch]$RemoveAcceptedCollaborators
)
$ErrorActionPreference = 'Stop'
if ($AuditOnly -and $Apply) { throw 'Elige -AuditOnly o -Apply; nunca ambos.' }
$configure = Join-Path $PSScriptRoot 'Configure-WeOtziRepository.ps1'
& $configure -RestoreFrom $BackupPath -AuditOnly:$AuditOnly -Apply:$Apply -RestoreProtection:$RestoreProtection -RemoveCreatedProtection:$RemoveCreatedProtection -RemoveAcceptedCollaborators:$RemoveAcceptedCollaborators
