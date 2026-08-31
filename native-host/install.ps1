[CmdletBinding()]
param([switch]$InstallFfmpeg)

$ErrorActionPreference = 'Stop'
$messageLocale = if ($PSUICulture -like 'zh*') { 'zh-CN' } else { 'en' }
$messagePath = Join-Path $PSScriptRoot "install-messages.$messageLocale.json"
$messages = Get-Content -LiteralPath $messagePath -Raw -Encoding UTF8 | ConvertFrom-Json

function Msg {
    param([string]$Key)
    return [string]$messages.$Key
}

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
        Write-Warning (Msg 'ffmpegWingetUnavailable')
        Write-Host (Msg 'installFfmpegManual')
        return
    }
    $approved = $Force
    if (-not $approved) {
        $answer = Read-Host (Msg 'installFfmpegPrompt')
        $approved = [string]::IsNullOrWhiteSpace($answer) -or $answer.Trim().StartsWith('y', [StringComparison]::OrdinalIgnoreCase)
    }
    if (-not $approved) {
        Write-Host (Msg 'ffmpegSkipped')
        Write-Host (Msg 'ffmpegLater')
        return
    }
    Write-Host (Msg 'ffmpegInstalling')
    & $winget.Source install --id Gyan.FFmpeg --exact --source winget --accept-source-agreements --accept-package-agreements --disable-interactivity
    if ($LASTEXITCODE -ne 0) {
        Write-Warning ((Msg 'wingetFailed') -f $LASTEXITCODE)
        Write-Host (Msg 'wingetRetry')
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
if (-not $extensionManifest.key) { throw (Msg 'manifestKeyMissing') }

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
Write-Host (Msg 'installed') -ForegroundColor Green
Write-Host ((Msg 'extensionId') -f $extensionId)
Write-Host ((Msg 'nativeHost') -f $hostExe)
Write-Host (Msg 'networkNone')
if ($ffmpegPath) {
    Write-Host ((Msg 'ffmpegPath') -f $ffmpegPath)
} else {
    Write-Warning (Msg 'ffmpegStillMissing')
    Write-Host (Msg 'installGuide')
}
Write-Host (Msg 'reload')
