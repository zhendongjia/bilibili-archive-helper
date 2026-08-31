#!/bin/sh
set -eu

HOST_NAME="com.bilibili_archive_helper.native"
EXTENSION_ID="decnollliepohlnakpbbbkadcpgjblda"
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SYSTEM_NAME=$(uname -s)

case "${LC_ALL:-${LC_MESSAGES:-${LANG:-en}}}" in
  zh*)
    MSG_BREW_MISSING="Homebrew 不可用。请从 https://brew.sh/ 安装，然后运行：brew install"
    MSG_NO_MANAGER="未找到受支持的包管理器。请手动安装这些软件包："
    MSG_PY_REQUIRED="Linux/macOS 本地助手需要 Python 3。"
    MSG_PY_INSTALL="现在安装 Python 3 吗？"
    MSG_PY_MISSING="仍未找到 Python 3。请安装后重新运行此脚本。"
    MSG_FFMPEG_REQUIRED="自动合并 MP4 需要 FFmpeg。"
    MSG_FFMPEG_INSTALL="现在安装 FFmpeg 吗？"
    MSG_FFMPEG_MISSING="仍未找到 FFmpeg。安装指南：https://ffmpeg.org/download.html"
    MSG_PICKER_REQUIRED="需要图形目录选择器（zenity、kdialog 或 tkinter）。"
    MSG_ZENITY_INSTALL="现在安装 zenity 吗？"
    MSG_INSTALLED="Bilibili Archive Helper 本地助手安装成功。"
    MSG_EXTENSION_ID="扩展 ID"
    MSG_NATIVE_HOST="本地助手"
    MSG_NETWORK_NONE="网络访问：无（所有媒体请求均由 Chrome 发起）"
    MSG_RELOAD="请重新加载扩展，然后重新打开保存页。"
    ;;
  *)
    MSG_BREW_MISSING="Homebrew is unavailable. Install it from https://brew.sh/ then run: brew install"
    MSG_NO_MANAGER="No supported package manager was found. Install these packages manually:"
    MSG_PY_REQUIRED="Python 3 is required by the Linux/macOS native host."
    MSG_PY_INSTALL="Install Python 3 now?"
    MSG_PY_MISSING="Python 3 is still missing. Install it, then rerun this script."
    MSG_FFMPEG_REQUIRED="FFmpeg is required for automatic MP4 merging."
    MSG_FFMPEG_INSTALL="Install FFmpeg now?"
    MSG_FFMPEG_MISSING="FFmpeg is still missing. Install guide: https://ffmpeg.org/download.html"
    MSG_PICKER_REQUIRED="A graphical folder picker is required (zenity, kdialog, or tkinter)."
    MSG_ZENITY_INSTALL="Install zenity now?"
    MSG_INSTALLED="Bilibili Archive Helper native host installed successfully."
    MSG_EXTENSION_ID="Extension ID"
    MSG_NATIVE_HOST="Native host"
    MSG_NETWORK_NONE="Network access: none (all media requests remain in Chrome)"
    MSG_RELOAD="Reload the extension and reopen the save page."
    ;;
esac

ask_yes() {
  if [ ! -t 0 ]; then return 1; fi
  printf '%s [Y/n] ' "$1"
  read -r answer
  case "$answer" in
    ""|y|Y|yes|YES) return 0 ;;
    *) return 1 ;;
  esac
}

install_packages() {
  packages="$*"
  if [ "$SYSTEM_NAME" = "Darwin" ]; then
    if command -v brew >/dev/null 2>&1; then
      # shellcheck disable=SC2086
      brew install $packages
      return
    fi
    echo "$MSG_BREW_MISSING $packages"
    return 1
  fi

  if [ "$(id -u)" -eq 0 ]; then SUDO=""; else SUDO="sudo"; fi
  if command -v apt-get >/dev/null 2>&1; then
    $SUDO apt-get update
    # shellcheck disable=SC2086
    $SUDO apt-get install -y $packages
  elif command -v dnf >/dev/null 2>&1; then
    # shellcheck disable=SC2086
    $SUDO dnf install -y $packages
  elif command -v pacman >/dev/null 2>&1; then
    # shellcheck disable=SC2086
    $SUDO pacman -S --needed $packages
  elif command -v zypper >/dev/null 2>&1; then
    # shellcheck disable=SC2086
    $SUDO zypper --non-interactive install $packages
  elif command -v apk >/dev/null 2>&1; then
    # shellcheck disable=SC2086
    $SUDO apk add $packages
  else
    echo "$MSG_NO_MANAGER $packages"
    return 1
  fi
}

if ! command -v python3 >/dev/null 2>&1; then
  echo "$MSG_PY_REQUIRED"
  if ask_yes "$MSG_PY_INSTALL"; then
    if [ "$SYSTEM_NAME" = "Darwin" ]; then install_packages python; else install_packages python3; fi
  fi
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "$MSG_PY_MISSING"
  exit 1
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "$MSG_FFMPEG_REQUIRED"
  if ask_yes "$MSG_FFMPEG_INSTALL"; then install_packages ffmpeg || true; fi
fi
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "$MSG_FFMPEG_MISSING"
fi

if [ "$SYSTEM_NAME" != "Darwin" ] &&
   ! command -v zenity >/dev/null 2>&1 &&
   ! command -v kdialog >/dev/null 2>&1 &&
   ! python3 -c 'import tkinter' >/dev/null 2>&1; then
  echo "$MSG_PICKER_REQUIRED"
  if ask_yes "$MSG_ZENITY_INSTALL"; then install_packages zenity || true; fi
fi

if [ "$SYSTEM_NAME" = "Darwin" ]; then
  INSTALL_ROOT="$HOME/Library/Application Support/BilibiliArchiveHelper/NativeHost"
else
  INSTALL_ROOT="${XDG_DATA_HOME:-$HOME/.local/share}/bilibili-archive-helper/native-host"
fi
HOST_PY="$INSTALL_ROOT/bilibili_archive_native_host.py"
HOST_WRAPPER="$INSTALL_ROOT/bilibili-archive-native-host"
HOST_MANIFEST="$INSTALL_ROOT/$HOST_NAME.json"
mkdir -p "$INSTALL_ROOT"
cp "$SCRIPT_DIR/bilibili_archive_native_host.py" "$HOST_PY"
chmod 755 "$HOST_PY"
{
  echo '#!/bin/sh'
  echo 'PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$HOME/.local/bin:$PATH"'
  echo 'export PATH'
  printf 'exec python3 "%s"\n' "$HOST_PY"
} > "$HOST_WRAPPER"
chmod 755 "$HOST_WRAPPER"

python3 - "$HOST_MANIFEST" "$HOST_WRAPPER" "$HOST_NAME" "$EXTENSION_ID" <<'PY'
import json
from pathlib import Path
import sys

manifest_path, host_path, name, extension_id = sys.argv[1:]
payload = {
    "name": name,
    "description": "Bilibili Archive Helper FFmpeg native host",
    "path": str(Path(host_path).resolve()),
    "type": "stdio",
    "allowed_origins": [f"chrome-extension://{extension_id}/"],
}
Path(manifest_path).write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
PY

if [ "$SYSTEM_NAME" = "Darwin" ]; then
  MANIFEST_DIRS="
$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts
$HOME/Library/Application Support/Chromium/NativeMessagingHosts
$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts
$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts"
else
  MANIFEST_DIRS="
${XDG_CONFIG_HOME:-$HOME/.config}/google-chrome/NativeMessagingHosts
${XDG_CONFIG_HOME:-$HOME/.config}/chromium/NativeMessagingHosts
${XDG_CONFIG_HOME:-$HOME/.config}/microsoft-edge/NativeMessagingHosts
${XDG_CONFIG_HOME:-$HOME/.config}/BraveSoftware/Brave-Browser/NativeMessagingHosts"
fi

printf '%s\n' "$MANIFEST_DIRS" | while IFS= read -r directory; do
  [ -n "$directory" ] || continue
  mkdir -p "$directory"
  cp "$HOST_MANIFEST" "$directory/$HOST_NAME.json"
done

echo
echo "$MSG_INSTALLED"
echo "$MSG_EXTENSION_ID: $EXTENSION_ID"
echo "$MSG_NATIVE_HOST: $HOST_WRAPPER"
echo "$MSG_NETWORK_NONE"
if command -v ffmpeg >/dev/null 2>&1; then echo "FFmpeg: $(command -v ffmpeg)"; fi
echo "$MSG_RELOAD"
