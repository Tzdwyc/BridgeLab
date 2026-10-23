# Prepared after automatic approval blocked execution. Not run by the assistant.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$bridgeRoot = 'H:\Projects\Bridge'
$retained = 'H:\Projects\Bridge\resources\original-2000\original-2000-foundation6.jsonl'
$expectedHash = '5037bb01c615a31fc6105a247452b0076c7dfbe69a32bc3de1cebcfb32a75cbe'
if ((Get-FileHash -LiteralPath $retained -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHash) {
    throw 'The verified retained 2000-board source is missing or changed. Nothing was deleted.'
}
$targets = @(
    'H:\Projects\Bridge\versions\v0.1',
    'H:\Projects\Bridge\versions\v0.2',
    'H:\Projects\Bridge\versions\v0.3',
    'H:\Projects\Bridge\versions\v0.3-mobile',
    'H:\Projects\Bridge\versions\v0.3.1',
    'H:\Projects\Bridge\versions\v0.3.2',
    'H:\Projects\Bridge\versions\v0.3.2-mobile'
)
foreach ($target in $targets) {
    $absolute = [IO.Path]::GetFullPath($target)
    if ($absolute -ne $target -or [IO.Path]::GetDirectoryName($absolute) -ne "$bridgeRoot\versions") {
        throw "Refusing unexpected path: $absolute"
    }
}
foreach ($target in $targets) {
    if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
}
Write-Output 'Removed only v0.3.2 and earlier version folders, including the original full 10000-board source.'
Write-Output 'Retained: verified original 2000-board source, v0.3.3, v0.3.4, v0.3.5 and their mobile projects.'
