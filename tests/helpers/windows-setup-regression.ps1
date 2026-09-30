#requires -Version 5.1
[CmdletBinding()]
param([ValidateSet('journals','acl')][string]$Scenario)
$ErrorActionPreference = 'Stop'
$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('weotzi-journal-test-' + [guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($testRoot)
function Read-SourceAst([string]$RelativePath) {
    $tokens = $null; $errors = $null
    $ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $repository $RelativePath), [ref]$tokens, [ref]$errors)
    if ($errors.Count) { throw 'PowerShell source failed parsing.' }
    return $ast
}
function Import-JournalFunction($Ast, [string]$Name) {
    $matches = @($Ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $Name }, $true))
    if ($matches.Count -ne 1) { throw "Expected one source function: $Name" }
    return $matches[0].Extent.Text
}
function Assert-Stage([string]$Path, [int]$Expected) {
    $record = [IO.File]::ReadAllText($Path) | ConvertFrom-Json
    if ($record.stage -ne $Expected -or $record.description -ne ('revision con acento: sesi' + [char]0x00f3 + 'n')) { throw 'Journal replacement lost the expected JSON record.' }
}
try {
    $configure = Read-SourceAst 'scripts\windows\Configure-DevWorkspace.ps1'
    if ($Scenario -eq 'journals') {
        # Load only the JSON writers, never top-level account/ACL operations.
        Invoke-Expression (Import-JournalFunction $configure 'Save-Manifest')
        $backup = Join-Path $testRoot 'workspace con espacios'
        [void][IO.Directory]::CreateDirectory($backup)
        $manifestPath = Join-Path $backup 'manifest.json'
        $description = 'revision con acento: sesi' + [char]0x00f3 + 'n'
        $manifest = @{stage=1; description=$description}
        Save-Manifest
        Assert-Stage $manifestPath 1
        $manifest.stage = 2
        Save-Manifest
        Assert-Stage $manifestPath 2

        $github = Read-SourceAst 'scripts\github\Configure-WeOtziRepository.ps1'
        Invoke-Expression (Import-JournalFunction $github 'Save-Backup')
        $script:BackupFile = Join-Path $backup 'github-backup.json'
        Save-Backup @{stage=1; description=$description}
        Assert-Stage $script:BackupFile 1
        Save-Backup @{stage=2; description=$description}
        Assert-Stage $script:BackupFile 2

        $restore = Read-SourceAst 'scripts\windows\Restore-DevWorkspace.ps1'
        $calls = @($restore.FindAll({ param($node) $node -is [Management.Automation.Language.InvokeMemberExpressionAst] -and $node.Member.Extent.Text -eq 'Replace' -and $node.Expression.Extent.Text -eq '[IO.File]' }, $true))
        if ($calls.Count -ne 1) { throw 'Expected one atomic restore journal operation.' }
        $resolvedManifest = $manifestPath
        $temporary = Join-Path $backup 'restore.tmp'
        [IO.File]::WriteAllText($temporary, (@{stage=3; description=$description} | ConvertTo-Json), [Text.UTF8Encoding]::new($true))
        Invoke-Expression $calls[0].Extent.Text
        Assert-Stage $resolvedManifest 3
        if ([IO.File]::Exists($temporary)) { throw 'Atomic replace did not consume its source.' }
    } else {
        # icacls /save uses UTF-16LE without a BOM. The fixture has no real ACL
        # writes: only decode/validate its descriptor in memory.
        $reads = @($configure.FindAll({ param($node) $node -is [Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -eq '$savedSddl' }, $true))
        if ($reads.Count -ne 1) { throw 'Expected one reparse ACL decoder.' }
        $guards = @($configure.FindAll({ param($node) $node -is [Management.Automation.Language.IfStatementAst] -and $node.Extent.Text -match '^if \(\$savedSddl\.Count' }, $true))
        if ($guards.Count -ne 1) { throw 'Expected one source ACL validation guard.' }
        $linkFile = Join-Path $testRoot 'link.acl'
        $fixture = "vitest`r`nD:AI(A;;FA;;;SY)(A;;FA;;;BA)`r`n"
        [IO.File]::WriteAllText($linkFile, $fixture, [Text.UnicodeEncoding]::new($false,$false,$true))
        Invoke-Expression $reads[0].Extent.Text
        if ($savedSddl.Count -ne 1) { throw 'UTF-16LE without BOM was not decoded.' }
        $descriptor = [Security.AccessControl.RawSecurityDescriptor]::new($savedSddl[0])
        if ($descriptor.DiscretionaryAcl.Count -ne 2) { throw 'Descriptor decoding changed its access rules.' }
        [IO.File]::WriteAllText($linkFile, $fixture, [Text.UnicodeEncoding]::new($false,$true,$true))
        Invoke-Expression $reads[0].Extent.Text
        if ($savedSddl.Count -ne 1) { throw 'UTF-16LE with BOM was not decoded.' }
        [IO.File]::WriteAllBytes($linkFile, [byte[]]@(68,0,58))
        $rejected = $false
        $item = [pscustomobject]@{FullName=$linkFile}
        try { Invoke-Expression $reads[0].Extent.Text; Invoke-Expression $guards[0].Extent.Text } catch { $rejected = $true }
        if (-not $rejected) { throw 'Truncated ACL encoding was accepted.' }
    }
    Write-Output "PASS $Scenario on Windows PowerShell $($PSVersionTable.PSVersion)"
} finally {
    # Every deletion stays in the GUID directory created by this test.
    foreach ($file in [IO.Directory]::GetFiles($testRoot, '*', [IO.SearchOption]::AllDirectories)) { [IO.File]::Delete($file) }
    $directories = @([IO.Directory]::GetDirectories($testRoot, '*', [IO.SearchOption]::AllDirectories) | Sort-Object Length -Descending)
    foreach ($directory in $directories) { [IO.Directory]::Delete($directory) }
    [IO.Directory]::Delete($testRoot)
}
