#!/bin/sh
set -eu

HOST_NAME="com.bilibili_archive_helper.native"
EXTENSION_ID="decnollliepohlnakpbbbkadcpgjblda"
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SYSTEM_NAME=$(uname -s)

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
    echo "Homebrew is unavailable. Install it from https://brew.sh/ then run: brew install $packages"
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
    echo "No supported package manager was found. Install these packages manually: $packages"
    return 1
  fi
}

if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 is required by the Linux/macOS native host."
  if ask_yes "Install Python 3 now?"; then
    if [ "$SYSTEM_NAME" = "Darwin" ]; then install_packages python; else install_packages python3; fi
  fi
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 is still missing. Install it, then rerun this script."
  exit 1
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "FFmpeg is required for automatic MP4 merging."
  if ask_yes "Install FFmpeg now?"; then install_packages ffmpeg || true; fi
fi
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "FFmpeg is still missing. Install guide: https://ffmpeg.org/download.html"
fi

if [ "$SYSTEM_NAME" != "Darwin" ] &&
   ! command -v zenity >/dev/null 2>&1 &&
   ! command -v kdialog >/dev/null 2>&1 &&
   ! python3 -c 'import tkinter' >/dev/null 2>&1; then
  echo "A graphical folder picker is required (zenity, kdialog, or tkinter)."
  if ask_yes "Install zenity now?"; then install_packages zenity || true; fi
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
echo "Bilibili Archive Helper native host installed successfully."
echo "Extension ID: $EXTENSION_ID"
echo "Native host: $HOST_WRAPPER"
if command -v ffmpeg >/dev/null 2>&1; then echo "FFmpeg: $(command -v ffmpeg)"; fi
echo "Reload the extension and reopen the save page."
