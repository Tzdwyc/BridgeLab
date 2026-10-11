[CmdletBinding()]
param(
    [string]$Apk = (Join-Path $PSScriptRoot '..\release\BridgeLab-v0.3.3-mobile-android.apk'),
    [string]$PreviousApk = (Join-Path $PSScriptRoot '..\..\v0.3.2-mobile\release\BridgeLab-v0.3.2-mobile-android.apk')
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$sdkRoot = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } elseif ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
$buildTools = Get-ChildItem -LiteralPath (Join-Path $sdkRoot 'build-tools') -Directory | Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
if (-not $buildTools) { throw 'Android build-tools not found.' }
$apksigner = Join-Path $buildTools.FullName 'apksigner.bat'
$aapt = Join-Path $buildTools.FullName 'aapt.exe'

function Read-PublicApkIdentity([string]$Path) {
    $resolved = [IO.Path]::GetFullPath($Path)
    if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) { throw "APK not found: $resolved" }
    $signatureOutput = (& $apksigner verify --print-certs $resolved 2>&1) -join "`n"
    if ($LASTEXITCODE -ne 0) { throw "APK signature verification failed: $resolved" }
    $certificate = [regex]::Match($signatureOutput, 'certificate SHA-256 digest:\s*([0-9a-fA-F]{64})')
    if (-not $certificate.Success) { throw 'APK certificate digest missing.' }
    $badging = (& $aapt dump badging $resolved 2>&1) -join "`n"
    if ($LASTEXITCODE -ne 0) { throw "APK package inspection failed: $resolved" }
    $package = [regex]::Match($badging, "package: name='([^']+)' versionCode='([0-9]+)' versionName='([^']+)'")
    if (-not $package.Success) { throw 'APK package identity missing.' }
    return [ordered]@{
        apk = $resolved
        sha256 = (Get-FileHash -LiteralPath $resolved -Algorithm SHA256).Hash.ToLowerInvariant()
        applicationId = $package.Groups[1].Value
        versionCode = [int]$package.Groups[2].Value
        versionName = $package.Groups[3].Value
        publicCertificateSha256 = $certificate.Groups[1].Value.ToLowerInvariant()
    }
}

$current = Read-PublicApkIdentity $Apk
$previous = Read-PublicApkIdentity $PreviousApk
if ($current.applicationId -ne 'cn.bridgelab.v03mobile' -or $current.applicationId -ne $previous.applicationId) { throw 'Application ID changed.' }
if ($current.versionName -ne '0.3.3' -or $current.versionCode -ne 33) { throw 'Expected version 0.3.3 with version code 33.' }
if ($current.versionCode -le $previous.versionCode) { throw 'Upgrade version code did not increase.' }
if ($current.publicCertificateSha256 -ne $previous.publicCertificateSha256) { throw 'APK signing certificate changed.' }
$result = [ordered]@{
    verifiedAt = (Get-Date).ToString('o')
    current = $current
    previous = $previous
    sameApplicationId = $true
    samePublicCertificate = $true
    versionCodeIncreased = $true
    deviceLaunch = 'not run: no connected Android device or configured AVD'
}
$output = Join-Path $root 'docs\UPGRADE_SIGNATURE_VALIDATION.json'
[IO.File]::WriteAllText($output, ($result | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
Write-Host "Upgrade identity verified: $($current.applicationId) $($current.versionName) ($($current.versionCode))"
Write-Host "Public certificate SHA-256: $($current.publicCertificateSha256)"
