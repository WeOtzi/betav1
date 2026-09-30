#requires -Version 5.1
<#
Manual administrator operation. Keeps the existing Dev account standard, backs
up DACLs, denies only its SID on private roots and creates a public Git clone.
AuditOnly is read-only and does not require elevation. No password is needed.
#>
[CmdletBinding()]
param(
    [switch]$Apply,
    [switch]$AuditOnly,
    [string]$ExpectedDevSid
)
$ErrorActionPreference = 'Stop'
if ($Apply -and $AuditOnly) { throw 'Choose Apply or AuditOnly, never both.' }
$workspace = 'C:\WeOtzi-Dev'
$clone = Join-Path $workspace 'weotzi-unified'
$repository = 'https://github.com/WeOtzi/betav1.git'
$backupBase = 'C:\ProgramData\WeOtzi\DevWorkspaceBackups'
$candidateRoots = @('C:\dev', 'C:\Webs Alejo Igoa Team', 'C:\c', 'C:\Remote', 'C:\Users\Isaí')
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$isAdmin = ([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$dev = Get-LocalUser -Name 'Dev'
if ($ExpectedDevSid -and $dev.SID.Value -ne $ExpectedDevSid) { throw 'The existing Dev SID differs from the SID you specified. Review the account before proceeding.' }
if ($identity.User.Value -eq $dev.SID.Value) { throw 'Configuration must be run by the owner, not by Dev.' }
if (-not $dev.Enabled) { throw 'Dev is disabled. This script does not change account state or its password.' }
$owner = Get-LocalUser -Name 'Isaí'
$ownerSid = $owner.SID.Value
$devGroups = @(Get-LocalGroup | ForEach-Object {
    $group = $_
    if (@(Get-LocalGroupMember -Group $group -ErrorAction Stop | Where-Object { $_.SID.Value -eq $dev.SID.Value }).Count) { $group.SID.Value }
})
if ($devGroups.Count -ne 1 -or $devGroups[0] -ne 'S-1-5-32-545') {
    throw 'Dev must belong only to the standard Users group. No groups are changed automatically.'
}
function Assert-PlainPath([string]$Path, [switch]$MustExist) {
    $absolute = [IO.Path]::GetFullPath($Path).TrimEnd('\')
    if ($absolute -notmatch '^C:\\[^\\]+' -or $absolute -ne $Path.TrimEnd('\')) { throw "Refusing an unexpected or drive-root path: $Path" }
    $cursor = $absolute
    while ($cursor -and $cursor -ne 'C:\' -and $cursor -ne 'C:') {
        if (Test-Path -LiteralPath $cursor) {
            $item = Get-Item -LiteralPath $cursor -Force
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Refusing a linked path or ancestor: $cursor" }
        }
        $cursor = Split-Path -Parent $cursor
    }
    if ($MustExist -and -not (Test-Path -LiteralPath $absolute -PathType Container)) { throw "Directory does not exist: $absolute" }
    return $absolute
}
$protectedRoots = @($candidateRoots | Where-Object { Test-Path -LiteralPath $_ } | ForEach-Object { Assert-PlainPath $_ -MustExist })
if ($protectedRoots -notcontains 'C:\Users\Isaí' -or $protectedRoots -notcontains 'C:\dev') { throw 'Required owner profile or project root is missing.' }
[void](Assert-PlainPath $workspace)
[void](Assert-PlainPath $backupBase)
if ($AuditOnly -or -not $Apply) {
    [ordered]@{
        mode='read-only'; elevated=$isAdmin; user=$dev.Name; sid=$dev.SID.Value; standardUser=$true
        workspace=$workspace; clone=$clone; cloneAlreadyExists=(Test-Path -LiteralPath $workspace)
        repository=$repository; protectedRoots=$protectedRoots; backupBase=$backupBase
        mechanism='Full DACL snapshot before SID-specific deny; no owner data copied'
        changesAccount=$false; changesGroups=$false; changesExecutionPolicy=$false
        next='Owner explicitly runs -Apply manually in elevated Windows PowerShell; Dev verifies in its own session.'
    } | ConvertTo-Json -Depth 5
    return
}
if (-not $isAdmin) { throw 'Open Windows PowerShell as Administrator yourself, then run this script. No automatic elevation is attempted.' }
if (Test-Path -LiteralPath $workspace) { throw 'C:\WeOtzi-Dev already exists. Refusing to take over existing files; inspect the previous manifest or restore first.' }
if (Test-Path -LiteralPath $backupBase) {
    foreach ($previousFolder in @(Get-ChildItem -LiteralPath $backupBase -Directory -Force)) {
        if ($previousFolder.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked backup folder found; inspect manually.' }
        $previousManifest = Join-Path $previousFolder.FullName 'manifest.json'
        if (Test-Path -LiteralPath $previousManifest) {
            [void](Assert-PlainPath $previousManifest)
            $previous = Get-Content -LiteralPath $previousManifest -Raw | ConvertFrom-Json
            if ($previous.kind -eq 'WeOtzi-DevWorkspace' -and $previous.userSid -eq $dev.SID.Value -and $previous.aclChangesStarted -and $previous.status -ne 'restored') {
                throw "An earlier permission operation is still active. Restore or review its private manifest first: $previousManifest"
            }
        }
    }
}
$gitCommand = Get-Command git.exe -ErrorAction Stop
$backup = Join-Path $backupBase ((Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '-' + [guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Path $backup -Force | Out-Null
# The private backup is inaccessible to Dev even if ProgramData is broadly readable.
$privateAcl = New-Object Security.AccessControl.DirectorySecurity
$privateAcl.SetAccessRuleProtection($true, $false)
foreach ($sid in @('S-1-5-18','S-1-5-32-544',$ownerSid) | Select-Object -Unique) {
    $privateAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid),'FullControl','ContainerInherit,ObjectInherit','None','Allow'))
}
Set-Acl -LiteralPath $backup -AclObject $privateAcl
$manifestPath = Join-Path $backup 'manifest.json'
$snapshotPath = Join-Path $backup 'dacl-snapshot.jsonl'
$manifest = [ordered]@{
    schema=1; kind='WeOtzi-DevWorkspace'; machine=$env:COMPUTERNAME; createdAt=(Get-Date).ToUniversalTime().ToString('o')
    user='Dev'; userSid=$dev.SID.Value; ownerSid=$ownerSid; previousEnabled=[bool]$dev.Enabled; previousGroups=$devGroups
    workspace=$workspace; clone=$clone; repository=$repository; protectedRoots=$protectedRoots
    snapshotFile=$snapshotPath; snapshotSha256=$null; snapshotCount=0; status='backing-up'
    aclChangesStarted=$false; workspaceCreated=$false; workspaceOriginalSddl=$null
    cloneOwnershipSnapshot=$null; cloneOwnershipSha256=$null; cloneOwnershipChanged=$false
}
function Save-Manifest {
    $temporary = Join-Path $backup ('.manifest-'+[guid]::NewGuid().ToString('N')+'.tmp')
    [IO.File]::WriteAllText($temporary,($manifest | ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($true))
    # A plain $null binds as an empty backup path; NullString passes a true .NET null.
    if ([IO.File]::Exists($manifestPath)) { [IO.File]::Replace($temporary,$manifestPath,[NullString]::Value) }
    else { [IO.File]::Move($temporary,$manifestPath) }
}
function Write-Snapshot($Entry, [IO.StreamWriter]$Writer) { $Writer.WriteLine(($Entry | ConvertTo-Json -Compress -Depth 5)) }
$reparseKinds = @{}
function Get-ReparseKind($Item) {
    if ($reparseKinds.ContainsKey($Item.FullName)) { return $reparseKinds[$Item.FullName] }
    $query = @(& "$env:SystemRoot\System32\fsutil.exe" reparsepoint query $Item.FullName 2>&1)
    $tagMatch = [regex]::Match(($query | Out-String),'(?i)0x([0-9a-f]{8})')
    if ($LASTEXITCODE -ne 0 -or -not $tagMatch.Success) { throw "Cannot identify a private reparse point safely: $($Item.FullName)" }
    $tag = [Convert]::ToUInt32($tagMatch.Groups[1].Value,16)
    $cloud = ($tag -band [uint32]4294905855) -eq [uint32]2415919130 # CLOUD + CLOUD_1..F; not a name surrogate.
    if ($cloud) { $kind = 'cloud' }
    elseif ($tag -eq [uint32]2147483675 -and -not $Item.PSIsContainer) { $kind = 'execution-alias' }
    elseif ($tag -eq [uint32]2684354563 -or $tag -eq [uint32]2684354572) { $kind = 'name-link' } # Junction / symbolic link.
    else { throw "Unsupported private reparse tag at $($Item.FullName). No private-root deny has been applied." }
    $result = [pscustomobject]@{kind=$kind; tag=$tag; directory=[bool]$Item.PSIsContainer}
    $reparseKinds[$Item.FullName] = $result
    return $result
}
function Get-SafeTree([string]$Root) {
    $pending = New-Object 'Collections.Generic.Stack[string]'
    $pending.Push($Root)
    while ($pending.Count) {
        $path = $pending.Pop()
        $item = Get-Item -LiteralPath $path -Force -ErrorAction Stop
        $canEnumerate = $item.PSIsContainer
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { $canEnumerate = $item.PSIsContainer -and (Get-ReparseKind $item).kind -eq 'cloud' }
        Write-Output $item
        # Known CLOUD tags are placeholders in this same filesystem namespace,
        # not name-redirection junctions. Inventory their actual descendants.
        if ($canEnumerate) {
            foreach ($child in @(Get-ChildItem -LiteralPath $path -Force -ErrorAction Stop)) { $pending.Push($child.FullName) }
        }
    }
}
function Assert-LinkTargetIsProtected($Item) {
    $class = Get-ReparseKind $Item
    if ($class.kind -in @('cloud','execution-alias')) { return }
    $targets = @($Item.Target | Where-Object { $_ })
    if ($targets.Count -ne 1) {
        throw "Cannot establish the target of a private name-redirection link: $($Item.FullName)"
    }
    $target = [string]$targets[0]
    if ($target.StartsWith('\??\')) { $target = $target.Substring(4) }
    if ($target.StartsWith('\\?\')) { $target = $target.Substring(4) }
    if (-not [IO.Path]::IsPathRooted($target)) { $target = Join-Path (Split-Path -Parent $Item.FullName) $target }
    $target = [IO.Path]::GetFullPath($target).TrimEnd('\')
    if (-not @($protectedRoots | Where-Object { $target.Equals($_,[StringComparison]::OrdinalIgnoreCase) -or $target.StartsWith($_+'\',[StringComparison]::OrdinalIgnoreCase) }).Count) {
        throw "A private link points outside the approved private roots: $($Item.FullName). Review that target manually; no private-root deny has been applied."
    }
}
function Invoke-Icacls([string[]]$Arguments) {
    $output = @(& "$env:SystemRoot\System32\icacls.exe" @Arguments 2>&1)
    if ($LASTEXITCODE -ne 0) { throw ('icacls failed: ' + ($output | Select-Object -Last 4 | Out-String)) }
}
function Get-LinkAclRules([string]$Path) {
    $lines = @(& "$env:SystemRoot\System32\icacls.exe" $Path /L 2>&1)
    if ($LASTEXITCODE -ne 0) { throw "Cannot read link ACL rules safely: $Path" }
    $rules = @($lines | ForEach-Object {
        $line = ([string]$_).Trim()
        if ($line.StartsWith($Path,[StringComparison]::OrdinalIgnoreCase)) { $line=$line.Substring($Path.Length).Trim() }
        if ($line -match '^[^:]+:\([^\r\n]+') { $line }
    })
    if (-not $rules.Count) { throw "No explicit link ACL baseline could be established: $Path" }
    return $rules
}
Save-Manifest
try {
    $writer = [IO.StreamWriter]::new($snapshotPath,$false,[Text.UTF8Encoding]::new($false))
    $samples = New-Object 'Collections.Generic.List[string]'
    $sampleProjects = @{}
    try {
        foreach ($root in $protectedRoots) {
            Get-SafeTree $root | ForEach-Object {
                $item = $_
                $manifest.snapshotCount++
                if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
                    Assert-LinkTargetIsProtected $item
                    $linkFile = Join-Path $backup ('link-' + $manifest.snapshotCount + '.acl')
                    Invoke-Icacls @($item.FullName,'/save',$linkFile,'/L','/Q')
                    # icacls /deny removes this SID's existing explicit grants.
                    # Reject that baseline before any deny, rather than letting
                    # rollback mistake our own removed grant for unrelated drift.
                    # icacls /save writes UTF-16LE and can omit the BOM. Decode
                    # explicitly and reject malformed input before trusting it.
                    $savedSddl = @([IO.File]::ReadAllLines($linkFile,[Text.UnicodeEncoding]::new($false,$false,$true)) | Where-Object { $_ -match '^(O:|G:|D:|S:)' })
                    if ($savedSddl.Count -ne 1) { throw "Cannot inspect the reparse ACL baseline: $($item.FullName)" }
                    $descriptor = [Security.AccessControl.RawSecurityDescriptor]::new($savedSddl[0])
                    if ($null -eq $descriptor.DiscretionaryAcl) { throw "A reparse null DACL cannot receive a safe private deny: $($item.FullName)" }
                    foreach ($ace in $descriptor.DiscretionaryAcl) {
                        if ($ace -is [Security.AccessControl.QualifiedAce] -and $ace.AceQualifier -eq [Security.AccessControl.AceQualifier]::AccessAllowed -and $ace.SecurityIdentifier.Value -eq $dev.SID.Value -and -not $ace.IsInherited) {
                            throw "An explicit Dev grant exists on a reparse item: $($item.FullName). Review it before configuration; no private-root deny has been applied."
                        }
                    }
                    $class = Get-ReparseKind $item
                    Write-Snapshot ([ordered]@{path=$item.FullName; kind='link'; reparseKind=$class.kind; reparseTag=$class.tag; directory=[bool]$item.PSIsContainer; rules=@(Get-LinkAclRules $item.FullName); backup=$linkFile; sha256=(Get-FileHash -LiteralPath $linkFile -Algorithm SHA256).Hash}) $writer
                } else {
                    $acl = Get-Acl -LiteralPath $item.FullName -ErrorAction Stop
                    if ([Security.AccessControl.RawSecurityDescriptor]::new($acl.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access)).DiscretionaryAcl -eq $null) { throw "A null DACL cannot receive a deny without affecting other users: $($item.FullName)" }
                    Write-Snapshot ([ordered]@{path=$item.FullName; kind=$(if($item.PSIsContainer){'directory'}else{'file'}); sddl=$acl.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access)}) $writer
                    if (-not $item.PSIsContainer) {
                        # One actual file per immediate project and per root. Do not copy or read its contents.
                        $relative = $item.FullName.Substring($root.Length).TrimStart('\')
                        $parts = $relative.Split('\')
                        $sampleKey = $root + '\' + $(if($parts.Count -gt 1){$parts[0]}else{''})
                        $rank = 0
                        if ($item.Name -match '^(README(?:\..*)?|package\.json|\.env|auth\.json)$') { $rank=100 }
                        elseif ($item.Name -match '\.(js|cjs|mjs|py|html|csproj|sln|json|md)$') { $rank=50 }
                        if ($item.FullName -match '\\(Temp|Cache|Caches|node_modules)\\') { $rank=-100 }
                        if (-not $sampleProjects.ContainsKey($sampleKey) -or $rank -gt $sampleProjects[$sampleKey].rank) { $sampleProjects[$sampleKey]=[pscustomobject]@{rank=$rank;path=$item.FullName} }
                    }
                }
            }
        }
    } finally { $writer.Dispose() }
    $manifest.snapshotSha256 = (Get-FileHash -LiteralPath $snapshotPath -Algorithm SHA256).Hash
    foreach ($sample in $sampleProjects.Values) { $samples.Add($sample.path) }
    $manifest.status = 'backups-complete'
    Save-Manifest
    # All roots have been captured before the first deny. Mark before applying,
    # so restoration includes a partially completed operation after a failure.
    $manifest.aclChangesStarted = $true
    $manifest.status = 'applying-private-denies'
    Save-Manifest
    foreach ($line in [IO.File]::ReadLines($snapshotPath)) {
        $entry = $line | ConvertFrom-Json
        if ($entry.kind -eq 'link') {
            $rights = if ($entry.directory) { ':(OI)(CI)(F)' } else { ':(F)' }
            Invoke-Icacls @($entry.path,'/deny',('*'+$dev.SID.Value+$rights),'/L','/Q')
        } else {
            $acl = Get-Acl -LiteralPath $entry.path
            $rule = if ($entry.kind -eq 'directory') {
                [Security.AccessControl.FileSystemAccessRule]::new($dev.SID,'FullControl','ContainerInherit,ObjectInherit','None','Deny')
            } else { [Security.AccessControl.FileSystemAccessRule]::new($dev.SID,'FullControl','Deny') }
            $acl.AddAccessRule($rule)
            Set-Acl -LiteralPath $entry.path -AclObject $acl
        }
    }
    New-Item -ItemType Directory -Path $workspace | Out-Null
    $manifest.workspaceCreated = $true
    $manifest.workspaceOriginalSddl = (Get-Acl -LiteralPath $workspace).GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access)
    Save-Manifest
    $workspaceAcl = New-Object Security.AccessControl.DirectorySecurity
    $workspaceAcl.SetAccessRuleProtection($true,$false)
    foreach ($sid in @('S-1-5-18','S-1-5-32-544',$ownerSid) | Select-Object -Unique) {
        $workspaceAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid),'FullControl','ContainerInherit,ObjectInherit','None','Allow'))
    }
    $workspaceAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($dev.SID,'Modify','ContainerInherit,ObjectInherit','None','Allow'))
    Set-Acl -LiteralPath $workspace -AclObject $workspaceAcl
    # Public HTTPS only. Suppress all owner credential helpers and hooks.
    $oldGlobal=$env:GIT_CONFIG_GLOBAL; $oldSystem=$env:GIT_CONFIG_SYSTEM; $oldPrompt=$env:GIT_TERMINAL_PROMPT
    try {
        $env:GIT_CONFIG_GLOBAL='NUL'; $env:GIT_CONFIG_SYSTEM='NUL'; $env:GIT_TERMINAL_PROMPT='0'
        & $gitCommand.Source -c credential.helper= -c credential.interactive=never -c core.hooksPath=NUL -c protocol.file.allow=never clone --depth 1 --no-tags --no-local -- $repository $clone
        if ($LASTEXITCODE -ne 0) { throw 'Public clone failed; restore using the printed private manifest. No owner credentials were copied.' }
    } finally { $env:GIT_CONFIG_GLOBAL=$oldGlobal; $env:GIT_CONFIG_SYSTEM=$oldSystem; $env:GIT_TERMINAL_PROMPT=$oldPrompt }
    $dangerous = @(& $gitCommand.Source -c "safe.directory=$clone" -C $clone ls-files | Where-Object { $_ -match '(^|/)(\.env($|\.)|\.server-credentials|auth\.json$)|\.(clixml|dpapi|pem|key)$' -and $_ -notmatch '(^|/)\.env\.(example|sample|template)$' })
    if ($LASTEXITCODE -ne 0 -or $dangerous.Count) { throw 'The public checkout contains a private-looking file. Review it before Dev starts; no private file contents were printed.' }
    $ownershipPath = Join-Path $backup 'clone-owner-snapshot.jsonl'
    $ownerWriter = [IO.StreamWriter]::new($ownershipPath,$false,[Text.UTF8Encoding]::new($false))
    try {
        Get-SafeTree $clone | ForEach-Object {
            $item = $_
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'New clone contains a link; refusing recursive ownership changes.' }
            $acl = Get-Acl -LiteralPath $item.FullName
            Write-Snapshot ([ordered]@{path=$item.FullName; kind=$(if($item.PSIsContainer){'directory'}else{'file'}); sddl=$acl.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Owner)}) $ownerWriter
        }
    } finally { $ownerWriter.Dispose() }
    $manifest.cloneOwnershipSnapshot=$ownershipPath
    $manifest.cloneOwnershipSha256=(Get-FileHash -LiteralPath $ownershipPath -Algorithm SHA256).Hash
    $manifest.cloneOwnershipChanged=$true
    Save-Manifest
    Invoke-Icacls @($clone,'/setowner',('*'+$dev.SID.Value),'/T','/L','/Q')
    $verification = [ordered]@{
        schema=1; user='Dev'; userSid=$dev.SID.Value; machine=$env:COMPUTERNAME; workspace=$workspace; clone=$clone
        repository=$repository; protectedRoots=$protectedRoots; protectedFiles=@($samples)
        accountAndGroupsUnchanged=$true; createdAt=(Get-Date).ToUniversalTime().ToString('o')
    }
    foreach ($secretPath in @('C:\dev\weotzi-unified\.env','C:\dev\weotzi-unified\.server-credentials','C:\Users\Isaí\.codex\auth.json','C:\Users\Isaí\.ssh\id_ed25519','C:\Users\Isaí\.ssh\id_rsa','C:\Users\Isaí\.codex\skills\weotzi-deploy-web\secrets\weotzi-ssh.credential.clixml')) {
        if ((Test-Path -LiteralPath $secretPath -PathType Leaf) -and $verification.protectedFiles -notcontains $secretPath) { $verification.protectedFiles += $secretPath }
    }
    $verification | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $workspace 'verify-plan.json') -Encoding UTF8
    [ordered]@{user='Dev'; userSid=$dev.SID.Value; workspace=$workspace; clone=$clone; privateManifest=$manifestPath; noOwnerCredentialsCopied=$true} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $workspace 'setup-info.json') -Encoding UTF8
    $manifest.status='configured-awaiting-Dev-effective-verification'
    Save-Manifest
    [ordered]@{configured=$true; isolationVerified=$false; accountUnchanged=$true; groupsUnchanged=$true; clone=$clone; privateManifest=$manifestPath; backedUpItems=$manifest.snapshotCount; next='Sign in as Dev and run Verify-DevWorkspace.ps1 from that session and its Codex.'} | ConvertTo-Json
} catch {
    $manifest.status='failed'
    $manifest.error=$_.Exception.Message
    Save-Manifest
    Write-Warning "Configuration stopped. No account or password was changed. Private rollback manifest: $manifestPath"
    throw
}
