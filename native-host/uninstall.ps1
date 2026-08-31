[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$messageLocale = if ($PSUICulture -like 'zh*') { 'zh-CN' } else { 'en' }
$messagePath = Join-Path $PSScriptRoot "install-messages.$messageLocale.json"
$messages = Get-Content -LiteralPath $messagePath -Raw -Encoding UTF8 | ConvertFrom-Json
$installRoot = Join-Path $env:LOCALAPPDATA 'BilibiliArchiveHelper\NativeHost'
foreach ($registryPath in @(
    'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.bilibili_archive_helper.native',
    'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.bilibili_archive_helper.native',
    'HKCU:\Software\Chromium\NativeMessagingHosts\com.bilibili_archive_helper.native',
    'HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.bilibili_archive_helper.native'
)) {
    if (Test-Path -LiteralPath $registryPath) { Remove-Item -LiteralPath $registryPath -Recurse -Force }
}
if (Test-Path -LiteralPath $installRoot) { Remove-Item -LiteralPath $installRoot -Recurse -Force }
Write-Host ([string]$messages.uninstalled)
