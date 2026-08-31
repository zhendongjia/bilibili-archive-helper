[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

if ($PSVersionTable.PSEdition -eq 'Core') {
    $windowsPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    & $windowsPowerShell -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath
    exit $LASTEXITCODE
}

$extensionRoot = Split-Path -Parent $PSScriptRoot
$extensionManifestPath = Join-Path $extensionRoot 'manifest.json'
$sourcePath = Join-Path $PSScriptRoot 'BilibiliArchiveNativeHost.cs'
$extensionManifest = Get-Content -LiteralPath $extensionManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $extensionManifest.key) { throw 'manifest.json is missing the extension key' }

$keyBytes = [Convert]::FromBase64String([string]$extensionManifest.key)
$sha256 = [Security.Cryptography.SHA256]::Create()
try { $digest = $sha256.ComputeHash($keyBytes) }
finally { $sha256.Dispose() }
$alphabet = 'abcdefghijklmnop'
$extensionIdBuilder = [Text.StringBuilder]::new(32)
foreach ($value in $digest[0..15]) {
    [void]$extensionIdBuilder.Append($alphabet[$value -shr 4])
    [void]$extensionIdBuilder.Append($alphabet[$value -band 0x0F])
}
$extensionId = $extensionIdBuilder.ToString()

$installRoot = Join-Path $env:LOCALAPPDATA 'BilibiliArchiveHelper\NativeHost'
$hostExe = Join-Path $installRoot 'BilibiliArchiveNativeHost.exe'
$hostManifestPath = Join-Path $installRoot 'com.bilibili_archive_helper.native.json'
New-Item -ItemType Directory -Force -Path $installRoot | Out-Null

$temporaryExe = Join-Path $env:TEMP ('BilibiliArchiveNativeHost-' + [Guid]::NewGuid().ToString('N') + '.exe')
try {
    Add-Type -Path $sourcePath -OutputAssembly $temporaryExe -OutputType ConsoleApplication -ReferencedAssemblies @(
        'System.dll',
        'System.Core.dll',
        'System.Net.Http.dll',
        'System.Web.Extensions.dll',
        'System.Windows.Forms.dll',
        'System.Drawing.dll'
    )
    Move-Item -LiteralPath $temporaryExe -Destination $hostExe -Force
}
finally {
    if (Test-Path -LiteralPath $temporaryExe) { Remove-Item -LiteralPath $temporaryExe -Force }
}

$hostManifest = [ordered]@{
    name = 'com.bilibili_archive_helper.native'
    description = 'Bilibili Archive Helper FFmpeg native host'
    path = $hostExe
    type = 'stdio'
    allowed_origins = @("chrome-extension://$extensionId/")
}
$hostManifestJson = $hostManifest | ConvertTo-Json -Depth 4
[IO.File]::WriteAllText($hostManifestPath, $hostManifestJson, [Text.UTF8Encoding]::new($false))

foreach ($registryPath in @(
    'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.bilibili_archive_helper.native',
    'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.bilibili_archive_helper.native'
)) {
    New-Item -Path $registryPath -Force | Out-Null
    Set-Item -Path $registryPath -Value $hostManifestPath
}

$ffmpeg = Get-Command ffmpeg.exe -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $ffmpeg) {
    $known = 'C:\Program Files\ffmpeg-9.0-full_build\bin\ffmpeg.exe'
    if (Test-Path -LiteralPath $known) { $ffmpeg = Get-Item -LiteralPath $known }
}

Write-Host ''
Write-Host 'Bilibili Archive Helper native host installed successfully.' -ForegroundColor Green
Write-Host "Extension ID: $extensionId"
Write-Host "Native host: $hostExe"
$ffmpegPath = if ($ffmpeg) {
    if ($ffmpeg.Source) { $ffmpeg.Source } else { $ffmpeg.FullName }
} else {
    'Not found; install FFmpeg and add it to PATH'
}
Write-Host "FFmpeg: $ffmpegPath"
Write-Host 'Reload the extension at chrome://extensions/ and reopen the save page.'
