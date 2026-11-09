[CmdletBinding()]
param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskPort = if ($env:BRIDGELAB_PORT) { [int]$env:BRIDGELAB_PORT } else { 5215 }
$taskUrl = "http://127.0.0.1:$taskPort"
$taskIndex = Join-Path $taskRoot 'dist\index.html'
if (-not (Test-Path -LiteralPath $taskIndex)) { throw 'Build files are missing. Run npm run build first.' }
$expectedIndexHash = (Get-FileHash -LiteralPath $taskIndex -Algorithm SHA256).Hash.ToLowerInvariant()
function Test-CurrentApplication {
    try {
        $response = Invoke-WebRequest -Uri "$taskUrl/index.html" -UseBasicParsing -TimeoutSec 1
        $digest = [Security.Cryptography.SHA256]::Create()
        try { $actual = [BitConverter]::ToString($digest.ComputeHash([Text.Encoding]::UTF8.GetBytes([string]$response.Content))).Replace('-', '').ToLowerInvariant() }
        finally { $digest.Dispose() }
        return $actual -eq $expectedIndexHash
    } catch { return $false }
}
$alreadyRunning = Test-CurrentApplication
if (-not $alreadyRunning) {
    $listener = Get-NetTCPConnection -LocalPort $taskPort -State Listen -ErrorAction SilentlyContinue
    if ($listener) { throw "Port $taskPort is occupied by a different application. Set BRIDGELAB_PORT to a free port." }
    $taskNode = (Get-Command node -ErrorAction Stop).Source
    $logs = Join-Path $taskRoot 'artifacts'; New-Item -ItemType Directory -Path $logs -Force | Out-Null
    $scriptArg = '"' + (Join-Path $PSScriptRoot 'serve.mjs') + '"'
    Start-Process -FilePath $taskNode -ArgumentList @($scriptArg) -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'desktop-server.log') -RedirectStandardError (Join-Path $logs 'desktop-server.err.log') | Out-Null
    $ready = $false
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        if (Test-CurrentApplication) { $ready = $true; break }
        Start-Sleep -Milliseconds 150
    }
    if (-not $ready) { throw 'The v3 server did not become ready. Inspect artifacts/desktop-server.err.log.' }
}
if (-not $NoBrowser) { Start-Process $taskUrl }
[pscustomobject]@{ version = '3.2.4'; url = $taskUrl; indexHashMatches = $true; reusedExistingServer = $alreadyRunning } | ConvertTo-Json
