[CmdletBinding()]
param(
    [string]$SourceRoot = (Join-Path $PSScriptRoot '..\..\v0.3.6')
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$mobileRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$sourceRoot = [IO.Path]::GetFullPath($SourceRoot)
$snapshotRoot = Join-Path $mobileRoot 'upstream-src'
$webRoot = Join-Path $mobileRoot 'assets\www'

function Assert-MobileTarget([string]$Path) {
    $resolved = [IO.Path]::GetFullPath($Path)
    if (-not $resolved.StartsWith($mobileRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to modify a path outside the mobile project: $resolved"
    }
}

function Reset-Directory([string]$Path) {
    Assert-MobileTarget $Path
    if (Test-Path -LiteralPath $Path) { Remove-Item -LiteralPath $Path -Recurse -Force }
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
}

function Copy-Required([string]$RelativePath, [string]$DestinationRoot) {
    $source = Join-Path $sourceRoot $RelativePath
    if (-not (Test-Path -LiteralPath $source)) { throw "Missing required v0.3 item: $source" }
    $parent = Split-Path (Join-Path $DestinationRoot $RelativePath) -Parent
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination (Join-Path $DestinationRoot $RelativePath) -Recurse -Force
}

if (-not (Test-Path -LiteralPath $sourceRoot -PathType Container)) { throw "Desktop v0.3 source not found: $sourceRoot" }
$package = Get-Content -LiteralPath (Join-Path $sourceRoot 'package.json') -Raw | ConvertFrom-Json
if ($package.version -ne '0.3.6') { throw "Expected BridgeLab 0.3.6, found $($package.version)" }

$distRoot = Join-Path $sourceRoot 'dist'
if (-not (Test-Path -LiteralPath (Join-Path $distRoot 'index.html'))) { throw 'Desktop v0.3 dist is missing index.html; build it before syncing.' }
$distIndex = Get-Content -LiteralPath (Join-Path $distRoot 'index.html') -Raw
$mainBundleMatch = [regex]::Match($distIndex, 'assets/(index-[^"'']+\.js)')
if (-not $mainBundleMatch.Success) { throw 'Desktop v0.3 index.html does not reference a main JavaScript bundle.' }
$mainBundle = Get-Item -LiteralPath (Join-Path $distRoot "assets\$($mainBundleMatch.Groups[1].Value)")

Reset-Directory $snapshotRoot
foreach ($item in @('src', 'public', 'scripts', 'tests', 'docs', 'index.html', 'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'vendor\bridge-dds-LICENSE')) {
    Copy-Required $item $snapshotRoot
}

Reset-Directory $webRoot
Get-ChildItem -LiteralPath $distRoot -Force | Copy-Item -Destination $webRoot -Recurse -Force
Copy-Item -LiteralPath (Join-Path $mobileRoot 'mobile-overrides\mobile.css') -Destination (Join-Path $webRoot 'mobile.css') -Force

$indexPath = Join-Path $webRoot 'index.html'
$index = Get-Content -LiteralPath $indexPath -Raw
if ($index -notmatch '</head>') { throw 'Synced index.html has no closing head tag.' }
$index = $index.Replace('</head>', '  <link rel="stylesheet" href="./mobile.css"></head>')
[IO.File]::WriteAllText($indexPath, $index, [Text.UTF8Encoding]::new($false))

$distFiles = Get-ChildItem -LiteralPath $distRoot -Recurse -File | Sort-Object FullName
$distHashes = @($distFiles | ForEach-Object {
    [ordered]@{
        path = [IO.Path]::GetRelativePath($distRoot, $_.FullName).Replace('\', '/')
        sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        bytes = $_.Length
    }
})
$sourceFiles = Get-ChildItem -LiteralPath $snapshotRoot -Recurse -File | Sort-Object FullName
$sourceLines = $sourceFiles | ForEach-Object {
    $relative = [IO.Path]::GetRelativePath($snapshotRoot, $_.FullName).Replace('\', '/')
    "$relative=$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant())"
}
$sha = [Security.Cryptography.SHA256]::Create()
try {
    $sourceDigest = [Convert]::ToHexString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes(($sourceLines -join "`n")))).ToLowerInvariant()
} finally {
    $sha.Dispose()
}
$syncRecord = [ordered]@{
    product = 'BridgeLab v0.3.6 Mobile'
    desktopVersion = $package.version
    syncedAt = (Get-Date).ToString('o')
    sourcePath = $sourceRoot
    sourceSnapshotSha256 = $sourceDigest
    desktopMainBundle = $mainBundle.Name
    desktopDistFiles = $distHashes
    origin = 'Final v0.3.6 desktop build; no bidding changes during mobile packaging'
}
$syncJson = $syncRecord | ConvertTo-Json -Depth 6
[IO.File]::WriteAllText((Join-Path $webRoot 'mobile-build.json'), $syncJson, [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText((Join-Path $mobileRoot 'docs\SYNC_MANIFEST.json'), $syncJson, [Text.UTF8Encoding]::new($false))

python (Join-Path $mobileRoot 'scripts\generate-android-icons.py') (Join-Path $sourceRoot 'public\icons\icon-512.png') (Join-Path $mobileRoot 'android\app\src\main\res')
if ($LASTEXITCODE -ne 0) { throw 'Android icon generation failed.' }

Write-Host "Synced BridgeLab v0.3.6 source and dist. Main bundle: $($mainBundle.Name)"
