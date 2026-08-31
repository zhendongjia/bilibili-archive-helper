[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$installRoot = Join-Path $env:LOCALAPPDATA 'BilibiliArchiveHelper\NativeHost'
foreach ($registryPath in @(
    'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.bilibili_archive_helper.native',
    'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.bilibili_archive_helper.native'
)) {
    if (Test-Path -LiteralPath $registryPath) { Remove-Item -LiteralPath $registryPath -Recurse -Force }
}
if (Test-Path -LiteralPath $installRoot) { Remove-Item -LiteralPath $installRoot -Recurse -Force }
Write-Host 'Bilibili Archive Helper native host uninstalled.'
