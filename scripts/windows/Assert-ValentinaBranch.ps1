param([string]$Workspace = 'C:\WeOtzi-Dev\weotzi-unified')
$ErrorActionPreference = 'Stop'
$branch = & git -C $Workspace branch --show-current
if ($LASTEXITCODE -ne 0) { throw 'No se pudo comprobar el clon de Valentina. Abre este lanzador desde Windows Dev.' }
if ($branch.Trim() -ne 'valentina/rediseno-laura') {
    throw "Rama actual: $branch. Conserva los cambios y vuelve a valentina/rediseno-laura antes de trabajar. Consulta docs/VALENTINA-PUBLICAR.md."
}
Write-Host 'Rama de Valen: valentina/rediseno-laura. Publicacion: https://preview.weotzi.chat/inicio/'
