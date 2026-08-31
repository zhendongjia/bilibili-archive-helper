[CmdletBinding()]
param([switch]$InstallFfmpeg)

$ErrorActionPreference = 'Stop'

function Find-Ffmpeg {
    $command = Get-Command ffmpeg.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command) { return $command.Source }
    foreach ($candidate in @(
        'C:\Program Files\ffmpeg-9.0-full_build\bin\ffmpeg.exe',
        (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\ffmpeg.exe')
    )) {
        if (Test-Path -LiteralPath $candidate) { return $candidate }
    }
    $packages = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
    if (Test-Path -LiteralPath $packages) {
        $match = Get-ChildItem -LiteralPath $packages -Directory -Filter 'Gyan.FFmpeg*' -ErrorAction SilentlyContinue |
            ForEach-Object { Get-ChildItem -LiteralPath $_.FullName -Recurse -File -Filter 'ffmpeg.exe' -ErrorAction SilentlyContinue } |
            Select-Object -First 1
        if ($match) { return $match.FullName }
    }
    return $null
}

function Install-FfmpegIfRequested {
    param([bool]$Force)
    $winget = Get-Command winget.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $winget) {
        Write-Warning 'FFmpeg was not found and WinGet is unavailable.'
        Write-Host 'Install FFmpeg from https://ffmpeg.org/download.html and add ffmpeg to PATH.'
        return
    }
    $approved = $Force
    if (-not $approved) {
        $answer = Read-Host 'FFmpeg was not found. Install Gyan.FFmpeg with WinGet now? [Y/n]'
        $approved = [string]::IsNullOrWhiteSpace($answer) -or $answer.Trim().StartsWith('y', [StringComparison]::OrdinalIgnoreCase)
    }
    if (-not $approved) {
        Write-Host 'Skipped FFmpeg installation.'
        Write-Host 'Later you can run: winget install --id Gyan.FFmpeg --exact --source winget'
        return
    }
    Write-Host 'Installing Gyan.FFmpeg with WinGet...'
    & $winget.Source install --id Gyan.FFmpeg --exact --source winget --accept-source-agreements --accept-package-agreements --disable-interactivity
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "WinGet failed with exit code $LASTEXITCODE."
        Write-Host 'Retry manually: winget install --id Gyan.FFmpeg --exact --source winget'
    }
}

if ($PSVersionTable.PSEdition -eq 'Core') {
    $windowsPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath)
    if ($InstallFfmpeg) { $arguments += '-InstallFfmpeg' }
    & $windowsPowerShell @arguments
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
    'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.bilibili_archive_helper.native',
    'HKCU:\Software\Chromium\NativeMessagingHosts\com.bilibili_archive_helper.native',
    'HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.bilibili_archive_helper.native'
)) {
    New-Item -Path $registryPath -Force | Out-Null
    Set-Item -Path $registryPath -Value $hostManifestPath
}

$ffmpegPath = Find-Ffmpeg
if (-not $ffmpegPath) {
    Install-FfmpegIfRequested -Force ([bool]$InstallFfmpeg)
    $ffmpegPath = Find-Ffmpeg
}

Write-Host ''
Write-Host 'Bilibili Archive Helper native host installed successfully.' -ForegroundColor Green
Write-Host "Extension ID: $extensionId"
Write-Host "Native host: $hostExe"
Write-Host 'Network access: none (all media requests remain in Chrome)'
if ($ffmpegPath) {
    Write-Host "FFmpeg: $ffmpegPath"
} else {
    Write-Warning 'FFmpeg is still missing. Automatic MP4 merging will remain disabled.'
    Write-Host 'Install guide: https://ffmpeg.org/download.html'
}
Write-Host 'Reload the extension at chrome://extensions/ and reopen the save page.'
