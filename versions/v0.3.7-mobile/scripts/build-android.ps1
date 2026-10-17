[CmdletBinding()]
param(
    [string]$SourceRoot = (Join-Path $PSScriptRoot '..\..\v0.3.7'),
    [switch]$ReuseNativeValidation
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$env:JAVA_HOME = 'E:\AndroidStudio\jbr'
$env:PATH = 'E:\flutter_windows_3.41.9-stable\flutter\bin;' + $env:JAVA_HOME + '\bin;' + $env:PATH
$env:PUB_HOSTED_URL = 'https://pub.flutter-io.cn'
$env:FLUTTER_STORAGE_BASE_URL = 'https://storage.flutter-io.cn'
$gradleArgs = @(
    'assembleRelease', '--init-script', '..\scripts\mobile-repositories.gradle',
    '-Ptarget-platform=android-arm,android-arm64,android-x64',
    '-Ptarget=lib/main.dart', '-Pbuild-mode=release'
)
if ($env:HTTPS_PROXY) {
    $proxyUri = [Uri]$env:HTTPS_PROXY
    $gradleArgs += @(
        "-Dhttp.proxyHost=$($proxyUri.Host)", "-Dhttp.proxyPort=$($proxyUri.Port)",
        "-Dhttps.proxyHost=$($proxyUri.Host)", "-Dhttps.proxyPort=$($proxyUri.Port)"
    )
}

& (Join-Path $PSScriptRoot 'sync-v03.ps1') -SourceRoot $SourceRoot
if ($LASTEXITCODE -ne 0) { throw 'v0.3 sync failed.' }

Push-Location $root
try {
    flutter pub get
    if ($LASTEXITCODE -ne 0) { throw 'flutter pub get failed.' }
    if ($ReuseNativeValidation) {
        $preparation = Get-Content -LiteralPath 'docs\NATIVE_VALIDATION_INPUTS_CODE44.json' -Raw | ConvertFrom-Json
        foreach ($file in $preparation.files) {
            $actual = (Get-FileHash -LiteralPath (Join-Path $root $file.path) -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($actual -ne $file.sha256) { throw "Native inputs changed since preparation checks: $($file.path)" }
        }
        Write-Host "Native preparation checks reused: all $($preparation.files.Count) recorded inputs match SHA-256."
    } else {
    dart format --output=none --set-exit-if-changed lib test
    if ($LASTEXITCODE -ne 0) { throw 'Dart formatting check failed.' }
    flutter analyze
    if ($LASTEXITCODE -ne 0) { throw 'Flutter analysis failed.' }
    flutter test
    if ($LASTEXITCODE -ne 0) { throw 'Flutter tests failed.' }
    node scripts\verify-native-scripts.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Native JavaScript bridge/recovery tests failed.' }
    }
    $versionLine = Select-String -LiteralPath 'pubspec.yaml' -Pattern '^version:\s+0\.3\.7\+44\s*$'
    if (-not $versionLine) { throw 'Expected pubspec version 0.3.7+44.' }
    $localPropertiesPath = Join-Path $root 'android\local.properties'
    $localProperties = [IO.File]::ReadAllText($localPropertiesPath)
    foreach ($property in @('flutter.versionName=0.3.7', 'flutter.versionCode=44', 'flutter.buildMode=release')) {
        $propertyKey = $property.Split('=')[0]
        $propertyPattern = '(?m)^' + [Regex]::Escape($propertyKey) + '=.*$'
        if ($localProperties -match $propertyPattern) {
            $localProperties = [Regex]::Replace($localProperties, $propertyPattern, $property)
        } else {
            $localProperties = $localProperties.TrimEnd() + "`n$property`n"
        }
    }
    [IO.File]::WriteAllText($localPropertiesPath, $localProperties, [Text.UTF8Encoding]::new($false))
    Push-Location (Join-Path $root 'android')
    try {
        & .\gradlew.bat @gradleArgs
        if ($LASTEXITCODE -ne 0) { throw 'Android release build failed.' }
    } finally { Pop-Location }
} finally {
    Pop-Location
}

$builtApk = Join-Path $root 'build\app\outputs\flutter-apk\app-release.apk'
if (-not (Test-Path -LiteralPath $builtApk)) { throw "Built APK not found: $builtApk" }
$releaseDir = Join-Path $root 'release'
New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null
$releaseApk = Join-Path $releaseDir 'BridgeLab-v0.3.7-mobile-android.apk'
Copy-Item -LiteralPath $builtApk -Destination $releaseApk -Force
$apkHash = (Get-FileHash -LiteralPath $releaseApk -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText((Join-Path $releaseDir 'BridgeLab-v0.3.7-mobile-android.sha256'), "$apkHash  BridgeLab-v0.3.7-mobile-android.apk`n", [Text.UTF8Encoding]::new($false))

$sdkRoot = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } elseif ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
$buildTools = Get-ChildItem -LiteralPath (Join-Path $sdkRoot 'build-tools') -Directory | Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
if (-not $buildTools) { throw 'Android build-tools not found.' }
$aapt = Join-Path $buildTools.FullName 'aapt.exe'
$apksigner = Join-Path $buildTools.FullName 'apksigner.bat'
$badging = (& $aapt dump badging $releaseApk 2>&1) -join "`n"
if ($LASTEXITCODE -ne 0) { throw 'aapt APK inspection failed.' }
if ($badging -notmatch "application-label:'BridgeLab v0\.3\.7'") { throw 'APK launcher label is not BridgeLab v0.3.7.' }
if ($badging -notmatch "versionCode='44' versionName='0\.3\.7'") { throw 'APK version does not match v0.3.7+44.' }
$signature = (& $apksigner verify --verbose $releaseApk 2>&1) -join "`n"
if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($releaseApk)
try {
    $entries = @($archive.Entries.FullName)
    $sync = Get-Content -LiteralPath (Join-Path $root 'docs\SYNC_MANIFEST.json') -Raw | ConvertFrom-Json
    $mainBundleEntryName = "assets/flutter_assets/assets/www/assets/$($sync.desktopMainBundle)"
    $mainBundleEntry = $archive.GetEntry($mainBundleEntryName)
    if (-not $mainBundleEntry) { throw "APK is missing the synced desktop main bundle: $mainBundleEntryName" }
    $bundleStream = $mainBundleEntry.Open()
    try {
        $bundleSha = [Security.Cryptography.SHA256]::Create()
        try {
            $embeddedMainBundleHash = [Convert]::ToHexString($bundleSha.ComputeHash($bundleStream)).ToLowerInvariant()
        } finally {
            $bundleSha.Dispose()
        }
    } finally {
        $bundleStream.Dispose()
    }
    $missingDistEntries = @()
    $mismatchedDistEntries = @()
    foreach ($distFile in $sync.desktopDistFiles) {
        $entryName = "assets/flutter_assets/assets/www/$($distFile.path)"
        $entry = $archive.GetEntry($entryName)
        if (-not $entry) {
            $missingDistEntries += $distFile.path
            continue
        }
        if ($distFile.path -eq 'index.html') { continue }
        $entryStream = $entry.Open()
        try {
            $entrySha = [Security.Cryptography.SHA256]::Create()
            try {
                $entryHash = [Convert]::ToHexString($entrySha.ComputeHash($entryStream)).ToLowerInvariant()
            } finally {
                $entrySha.Dispose()
            }
        } finally {
            $entryStream.Dispose()
        }
        if ($entryHash -ne $distFile.sha256) { $mismatchedDistEntries += $distFile.path }
    }
    $mobileAssetHashes = [ordered]@{}
    foreach ($mobileAsset in @('index.html', 'mobile.css', 'mobile-build.json')) {
        $entry = $archive.GetEntry("assets/flutter_assets/assets/www/$mobileAsset")
        if (-not $entry) { throw "APK is missing mobile asset: $mobileAsset" }
        $entryStream = $entry.Open()
        $entrySha = [Security.Cryptography.SHA256]::Create()
        try { $embeddedHash = [Convert]::ToHexString($entrySha.ComputeHash($entryStream)).ToLowerInvariant() }
        finally { $entrySha.Dispose(); $entryStream.Dispose() }
        $sourceHash = (Get-FileHash -LiteralPath (Join-Path $root "assets\www\$mobileAsset") -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($embeddedHash -ne $sourceHash) { throw "APK mobile asset hash mismatch: $mobileAsset" }
        $mobileAssetHashes[$mobileAsset] = $embeddedHash
    }
    $nativeRecoveryChecks = @()
    foreach ($abi in @('armeabi-v7a', 'arm64-v8a', 'x86_64')) {
        $entry = $archive.GetEntry("lib/$abi/libapp.so")
        if (-not $entry) { throw "APK is missing the native Flutter application: $abi" }
        $entryStream = $entry.Open()
        $memory = [IO.MemoryStream]::new()
        try {
            $entryStream.CopyTo($memory)
            $nativeText = [Text.Encoding]::UTF8.GetString($memory.ToArray())
        } finally { $entryStream.Dispose(); $memory.Dispose() }
        $recoveryCompiled = $nativeText.Contains('Packaged bundle verification failed after recovery: ')
        $captureCompiled = $nativeText.Contains('__bridgeDiagnosticCaptureInstalled')
        $filesBridgeCompiled = $nativeText.Contains('window.BridgeLabNativeFiles =')
        if (-not ($recoveryCompiled -and $captureCompiled -and $filesBridgeCompiled)) {
            throw "APK native recovery, background capture or file bridge is missing: $abi"
        }
        $nativeRecoveryChecks += [ordered]@{
            abi = $abi
            recoveryScriptCompiled = $recoveryCompiled
            backgroundCaptureCompiled = $captureCompiled
            nativeFilesBridgeCompiled = $filesBridgeCompiled
        }
    }
    $dexText = ''
    foreach ($dexEntry in @($archive.Entries | Where-Object { $_.FullName -match '^classes\d*\.dex$' })) {
        $dexStream = $dexEntry.Open()
        $memory = [IO.MemoryStream]::new()
        try { $dexStream.CopyTo($memory); $dexText += [Text.Encoding]::UTF8.GetString($memory.ToArray()) }
        finally { $dexStream.Dispose(); $memory.Dispose() }
    }
    $documentPickerCodeCompiled = $dexText.Contains('android.intent.action.CREATE_DOCUMENT') -and $dexText.Contains('android.intent.action.OPEN_DOCUMENT') -and $dexText.Contains('cn.bridgelab.v03mobile/files')
    if (-not $documentPickerCodeCompiled) { throw 'Android document-picker code or method channel is missing from APK DEX.' }
} finally {
    $archive.Dispose()
}
if ($missingDistEntries.Count -gt 0) { throw "APK is missing desktop dist files: $($missingDistEntries -join ', ')" }
if ($mismatchedDistEntries.Count -gt 0) { throw "APK desktop dist file hash mismatch: $($mismatchedDistEntries -join ', ')" }
$requiredEntries = @(
    'assets/flutter_assets/assets/www/index.html',
    'assets/flutter_assets/assets/www/mobile.css',
    'assets/flutter_assets/assets/www/mobile-build.json'
)
foreach ($entry in $requiredEntries) {
    if ($entries -notcontains $entry) { throw "APK is missing required bundled asset: $entry" }
}
if (-not ($entries | Where-Object { $_ -like 'assets/flutter_assets/assets/www/assets/worker-*.js' })) { throw 'APK is missing the bundled DDS worker.' }
if (-not ($entries | Where-Object { $_ -like 'assets/flutter_assets/assets/www/assets/play-advisor-worker-*.js' })) { throw 'APK is missing the bundled play-advisor worker.' }

$desktopBundlePath = Join-Path $SourceRoot "dist\assets\$($sync.desktopMainBundle)"
$desktopMainBundleHash = (Get-FileHash -LiteralPath $desktopBundlePath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($embeddedMainBundleHash -ne $desktopMainBundleHash) {
    throw "APK main bundle hash mismatch: desktop=$desktopMainBundleHash embedded=$embeddedMainBundleHash"
}
$validation = [ordered]@{
    builtAt = (Get-Date).ToString('o')
    apk = $releaseApk
    bytes = (Get-Item -LiteralPath $releaseApk).Length
    sha256 = $apkHash
    desktopMainBundle = $sync.desktopMainBundle
    desktopMainBundleSha256 = $desktopMainBundleHash
    embeddedMainBundleSha256 = $embeddedMainBundleHash
    mainBundleHashMatch = $true
    desktopDistFileCount = @($sync.desktopDistFiles).Count
    desktopDistFilesPresent = $true
    unchangedDistFileHashesMatch = $true
    mobileAssetHashes = $mobileAssetHashes
    sourceSnapshotSha256 = $sync.sourceSnapshotSha256
    packageBadging = ($badging -split "`n" | Select-Object -First 3)
    signature = ($signature -split "`n" | Select-Object -First 12)
    bundledAssetChecks = $requiredEntries + @($mainBundleEntryName, 'DDS worker', 'play-advisor worker')
    nativeRecoveryChecks = $nativeRecoveryChecks
    nativeValidation = $(if ($ReuseNativeValidation) { 'Preparation checks reused after all recorded native input hashes matched; see NATIVE_VALIDATION_INPUTS_CODE44.json' } else { 'Fresh native format/analyze/test checks' })
    documentPickerNativeCodeCompiled = $documentPickerCodeCompiled
    applicationId = 'cn.bridgelab.v03mobile'
    versionName = '0.3.7'
    versionCode = 44
    storageOrigin = 'http://127.0.0.1:51893'
    storageKey = 'bridgelab.session.v3.6'
    previousStorageKey = 'bridgelab.session.v3.5'
    diagnosticsFloatingButton = $false
    saveDataCleared = $false
    previousDelivery = 'artifacts/previous-code43/release/BridgeLab-v0.3.7-mobile-android.apk'
    deviceLaunch = 'not performed in this task; Android installation, WebView and system document picker remain unverified on device'
}
[IO.File]::WriteAllText((Join-Path $root 'docs\VALIDATION.json'), ($validation | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))

$nativeCheckSummary = if ($ReuseNativeValidation) { 'Preparation Dart formatting, Flutter analysis, 7 Flutter tests and 8 native-script checks reused after native input SHA-256 equality' } else { 'Fresh Dart formatting, Flutter analysis, Flutter tests and native-script checks passed' }
$report = @"
# BridgeLab v0.3.7 Android validation

- Built: $($validation.builtAt)
- APK: release/BridgeLab-v0.3.7-mobile-android.apk
- SHA256: $apkHash
- $nativeCheckSummary; Android release build and signature verification passed.
- All $(@($sync.desktopDistFiles).Count) frozen desktop dist assets are present in the APK. Except index.html with a mobile CSS link, their hashes match.
- Main bundle hash: $embeddedMainBundleHash
- Uses the final v0.3.7 desktop build, without modifying any desktop version.
- Android installation, WebView interactions and system document picker were not exercised on a device in this task.
- Internal sideload release uses the existing debug signing certificate, with the existing application ID for upgrading v0.3.
"@
[IO.File]::WriteAllText((Join-Path $root 'docs\VALIDATION_REPORT.md'), $report, [Text.UTF8Encoding]::new($false))

Write-Host "APK: $releaseApk"
Write-Host "SHA-256: $apkHash"
