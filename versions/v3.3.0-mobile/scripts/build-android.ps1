[CmdletBinding()]
param(
    [string]$SourceRoot = (Join-Path $PSScriptRoot '..\..\v3.3.0-desktop')
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$version = [regex]::Match([IO.File]::ReadAllText((Join-Path $root 'pubspec.yaml')), '(?m)^version:[ \t]+(?<name>\d+\.\d+\.\d+)\+(?<code>\d+)[ \t]*\r?$')
if (-not $version.Success) { throw 'Expected a version name and build number in pubspec.yaml.' }
$versionName = $version.Groups['name'].Value
$versionCode = [int]$version.Groups['code'].Value
$releaseDir = Join-Path $root 'release'
$releaseBaseName = "BridgeLab-v$versionName-mobile-android"
$releaseApk = Join-Path $releaseDir "$releaseBaseName.apk"
$releaseChecksum = Join-Path $releaseDir "$releaseBaseName.sha256"
if ((Test-Path -LiteralPath $releaseApk) -or (Test-Path -LiteralPath $releaseChecksum)) {
    throw 'Preserve the existing release generation before packaging again.'
}
$env:JAVA_HOME = 'E:\AndroidStudio\jbr'
$flutterRoot = 'E:\flutter_windows_3.41.9-stable\flutter'
$env:PATH = (Join-Path $flutterRoot 'bin') + ';' + $env:JAVA_HOME + '\bin;' + $env:PATH
$sdkRoot = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } elseif ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
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

& (Join-Path $PSScriptRoot 'sync-web.ps1') -SourceRoot $SourceRoot -MobileVersion $versionName
if ($LASTEXITCODE -ne 0) { throw 'v3.3.0 sync failed.' }

Push-Location $root
try {
    flutter pub get --offline
    if ($LASTEXITCODE -ne 0) { throw 'flutter pub get failed.' }
    dart format --output=none --set-exit-if-changed lib test
    if ($LASTEXITCODE -ne 0) { throw 'Dart formatting check failed.' }
    flutter analyze --no-pub
    if ($LASTEXITCODE -ne 0) { throw 'Flutter analysis failed.' }
    flutter test --no-pub
    if ($LASTEXITCODE -ne 0) { throw 'Flutter tests failed.' }
    node scripts\verify-native-scripts.mjs $versionName
    if ($LASTEXITCODE -ne 0) { throw 'Native JavaScript bridge/recovery tests failed.' }
    $localPropertiesPath = Join-Path $root 'android\local.properties'
    $localProperties = if (Test-Path -LiteralPath $localPropertiesPath) { [IO.File]::ReadAllText($localPropertiesPath) } else { '' }
    $wrapperRoot = Join-Path $flutterRoot 'bin\cache\artifacts\gradle_wrapper'
    foreach ($file in @('gradlew', 'gradlew.bat', 'gradle\wrapper\gradle-wrapper.jar')) {
        $destination = Join-Path $root "android\$file"
        if (-not (Test-Path -LiteralPath $destination)) {
            Copy-Item -LiteralPath (Join-Path $wrapperRoot $file) -Destination $destination
        }
    }
    foreach ($property in @("sdk.dir=$($sdkRoot.Replace('\', '/'))", "flutter.sdk=$($flutterRoot.Replace('\', '/'))", "flutter.versionName=$versionName", "flutter.versionCode=$versionCode", 'flutter.buildMode=release')) {
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
$apkHash = (Get-FileHash -LiteralPath $builtApk -Algorithm SHA256).Hash.ToLowerInvariant()

$buildTools = Get-ChildItem -LiteralPath (Join-Path $sdkRoot 'build-tools') -Directory | Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
if (-not $buildTools) { throw 'Android build-tools not found.' }
$aapt = Join-Path $buildTools.FullName 'aapt.exe'
$apksigner = Join-Path $buildTools.FullName 'apksigner.bat'
$badging = (& $aapt dump badging $builtApk 2>&1) -join "`n"
if ($LASTEXITCODE -ne 0) { throw 'aapt APK inspection failed.' }
if ($badging -notmatch "application-label:'BridgeLab v3.3.0'") { throw 'APK launcher label is not BridgeLab v3.3.0.' }
if (-not $badging.Contains("package: name='cn.bridgelab.v03mobile' versionCode='$versionCode' versionName='$versionName'")) {
    throw "APK package or version does not match $versionName+$versionCode."
}
$signature = (& $apksigner verify --verbose $builtApk 2>&1) -join "`n"
if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($builtApk)
try {
    $entries = @($archive.Entries.FullName)
    $sync = Get-Content -LiteralPath (Join-Path $root "docs\SYNC_MANIFEST_v$versionName.json") -Raw | ConvertFrom-Json
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
    $lanNativeCodeCompiled = $dexText.Contains('cn.bridgelab.v03mobile/lan') -and $dexText.Contains('wifiAddress') -and $dexText.Contains('keepAwake')
    if (-not $lanNativeCodeCompiled) { throw 'Android LAN method channel is missing from APK DEX.' }
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

New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null
[IO.File]::Copy($builtApk, $releaseApk, $false)
[IO.File]::WriteAllText($releaseChecksum, "$apkHash  $releaseBaseName.apk`n", [Text.UTF8Encoding]::new($false))
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
    nativeValidation = 'Fresh native format/analyze/test checks'
    documentPickerNativeCodeCompiled = $documentPickerCodeCompiled
    lanNativeCodeCompiled = $lanNativeCodeCompiled
    applicationId = 'cn.bridgelab.v03mobile'
    versionName = $versionName
    versionCode = $versionCode
    storageOrigin = 'http://127.0.0.1:51893'
    storageKey = 'bridgelab.session.v3.6'
    previousStorageKey = 'bridgelab.session.v3.5'
    diagnosticsFloatingButton = $false
    saveDataCleared = $false
    previousDelivery = '../v3.2.9-mobile/release/BridgeLab-v3.2.9-mobile-android.apk'
    deviceLaunch = 'not performed in this task; Android installation, WebView and system document picker remain unverified on device'
}
[IO.File]::WriteAllText((Join-Path $root "docs\VALIDATION_v$versionName.json"), ($validation | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))

$nativeCheckSummary = 'Fresh Dart formatting, Flutter analysis, Flutter tests and native-script checks passed'
$report = @"
# BridgeLab v$versionName Android validation

- Built: $($validation.builtAt)
- APK: release/$releaseBaseName.apk
- SHA256: $apkHash
- $nativeCheckSummary; Android release build and signature verification passed.
- All $(@($sync.desktopDistFiles).Count) frozen desktop dist assets are present in the APK. Except index.html with a mobile CSS link, their hashes match.
- Main bundle hash: $embeddedMainBundleHash
- Uses the final v3.3.0 desktop build, without modifying any desktop version.
- Android installation, WebView interactions and system document picker were not exercised on a device in this task.
- Internal sideload release uses the existing debug signing certificate, with the existing application ID for sideload upgrades.
"@
[IO.File]::WriteAllText((Join-Path $root "docs\VALIDATION_REPORT_v$versionName.md"), $report, [Text.UTF8Encoding]::new($false))

Write-Host "APK: $releaseApk"
Write-Host "SHA-256: $apkHash"
