$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
$sources = @(Get-ChildItem -LiteralPath 'vendor\dds-reference\src' -Filter '*.cpp' -File | ForEach-Object { $_.FullName })
& clang++ -O2 -std=c++14 -include cstdio -Wno-deprecated-declarations -Ivendor/dds-reference/include @sources scripts/dds-reference.cpp -o artifacts/dds-reference.exe -lpsapi
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Output 'Official DDS 2.9.0 reference built without source changes'
