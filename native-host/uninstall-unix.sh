#!/bin/sh
set -eu

HOST_NAME="com.bilibili_archive_helper.native"
SYSTEM_NAME=$(uname -s)
if [ "$SYSTEM_NAME" = "Darwin" ]; then
  INSTALL_ROOT="$HOME/Library/Application Support/BilibiliArchiveHelper/NativeHost"
  MANIFEST_DIRS="
$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts
$HOME/Library/Application Support/Chromium/NativeMessagingHosts
$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts
$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts"
else
  INSTALL_ROOT="${XDG_DATA_HOME:-$HOME/.local/share}/bilibili-archive-helper/native-host"
  MANIFEST_DIRS="
${XDG_CONFIG_HOME:-$HOME/.config}/google-chrome/NativeMessagingHosts
${XDG_CONFIG_HOME:-$HOME/.config}/chromium/NativeMessagingHosts
${XDG_CONFIG_HOME:-$HOME/.config}/microsoft-edge/NativeMessagingHosts
${XDG_CONFIG_HOME:-$HOME/.config}/BraveSoftware/Brave-Browser/NativeMessagingHosts"
fi

printf '%s\n' "$MANIFEST_DIRS" | while IFS= read -r directory; do
  [ -n "$directory" ] || continue
  rm -f "$directory/$HOST_NAME.json"
done
rm -rf "$INSTALL_ROOT"
echo "Bilibili Archive Helper native host uninstalled."
