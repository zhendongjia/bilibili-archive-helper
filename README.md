# Bilibili Archive Helper

English | [Simplified Chinese](README.zh-CN.md)

A build-free Chrome Manifest V3 extension that archives the current Bilibili video or bangumi episode in a strictly serial workflow.

## Features

- Downloads the highest quality available to the current signed-in account.
- Combines legacy XML, current protobuf segments, and optional historical snapshots to improve danmaku completeness.
- Converts danmaku to ASS while preserving scrolling, top, bottom, color, and font-size attributes.
- Creates rich movie or episode NFO metadata for Kodi, Emby, and Jellyfin.
- Uses an optional local FFmpeg helper to losslessly mux DASH video and audio into MP4.
- By default, a successful job leaves exactly three same-stem files: `.mp4`, `.ass`, and `.nfo`.
- Archive directory and file names use ASCII identifiers such as `Bilibili_BV..._P01_1080P`; the original-language title remains inside the NFO and ASS metadata.
- The extension UI follows Chrome's UI language: Simplified Chinese for `zh` locales and English for all other or unknown locales.

The NFO retains as much reliable page and API metadata as possible, including part or episode relationships, sort titles, uploader UID and avatar, posters and fanart, publication date, duration, statistics, BVID/AID/CID/EPID, quality and codec IDs, tags, copyright flags, and audio/video stream parameters. Bilibili-specific values are stored in a `<bilibili>` extension block alongside standard Kodi/Emby/Jellyfin fields.

## Install the extension

1. Open `chrome://extensions/`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the `bilibili-archive-helper` directory.
5. Open a Bilibili video or bangumi page, sign in if needed, and click the extension icon.

### Install the automatic merge helper

Windows:

1. Double-click `install-native-host.cmd` in the extension directory.
2. If FFmpeg is missing, the installer offers to install `Gyan.FFmpeg` through WinGet and also prints manual instructions.

Linux / macOS:

```sh
sh install-native-host.sh
```

The Unix installer uses only the Python 3 standard library for the helper. If Python, FFmpeg, or a Linux graphical folder picker is missing, it detects Homebrew, APT, DNF, Pacman, Zypper, or APK, offers installation where supported, and prints manual guidance otherwise.

The installers write only to the current user's directories and register Native Messaging for Chrome, Chromium, Edge, and Brave. Administrator access is not required by the helper itself, although the operating system's package manager may request `sudo`. Reload the extension after installing or updating the helper.

## Usage

1. The extension identifies the current video, CID, duration, and available qualities.
2. **Highest available** and **Enhanced history** are selected by default.
3. Select the desired outputs and click the preparation button.
4. On the separate save page, click once and choose a destination directory.
5. All API, media, and write operations run serially. After a DASH mux passes ffprobe validation, the intermediate `.m4s` streams are removed, leaving MP4, ASS, and NFO.

Danmaku history modes:

- **Current endpoints**: combines legacy XML with current protobuf segments; fastest.
- **Enhanced history**: checks each of the first 18 months, then one snapshot every six months.
- **Monthly history**: checks every month from publication to the present; slowest and still cannot restore comments already removed by the server.

## Media and FFmpeg behavior

- For progressive `durl` media, the extension saves the MP4 directly.
- For DASH media, Chrome reads video and audio sequentially and sends small chunks to the local helper through Native Messaging.
- FFmpeg performs stream copy without re-encoding, equivalent to:

```sh
ffmpeg -i "video-stream.m4s" -i "audio-stream.m4s" -c copy "output.mp4"
```

The helper uses ffprobe to confirm that the result contains both video and audio. Source streams are deleted only after successful validation. If merging fails, complete source streams are retained to avoid data loss and the save page reports the error.

The extension does not decrypt DRM or bypass memberships, paywalls, regional restrictions, or account permissions.

## Login, cookies, and proxy behavior

- The extension does not request the `cookies` permission and never reads, displays, or exports cookie values.
- Bilibili API calls originate from the current playback page so Chrome can apply the existing signed-in session normally.
- The extension does not request the `proxy` permission and never changes Chrome, system, or Codex proxy settings.
- All video and audio requests are made by Chrome. They therefore follow Chrome's active proxy configuration, PAC rules, and extensions such as SwitchyOmega, even when those rules differ from the system proxy.
- The native helper has no networking code. It only receives chunks already downloaded by Chrome, writes local files, and runs FFmpeg/ffprobe.

## Permissions

- `activeTab`, `scripting`: reads public state from the current Bilibili page after the user clicks the extension and issues page-origin GET requests.
- `storage`, `unlimitedStorage`: transfers a one-time job between the popup and save page; the job body is cleared after completion.
- `nativeMessaging`: sends ASS, NFO, and Chrome-downloaded media chunks to the local helper when automatic merging is enabled.
- `declarativeNetRequestWithHostAccess`: adds `Referer: https://www.bilibili.com/` only for Bilibili CDN downloads.
- Host permissions are limited to Bilibili and its video CDN domains.

## Design and limitations

- The popup prepares a job and opens a dedicated save page, so the destination directory is authorized only once.
- Requests are sequential, not concurrent. Media is streamed in chunks and is never buffered as an entire video in memory.
- The native helper uses `.part` files so interrupted writes are not mistaken for completed files.
- Bilibili endpoints are internal and may require parser updates after site changes.
- Historical danmaku endpoints require a signed-in session and may enforce account, date, or rate limits.
- A displayed danmaku-pool count does not necessarily equal the comments currently returned by the APIs.
- Some videos return only player configuration and no ordinary danmaku. The extension still creates a valid empty ASS and continues.
- Windows uses a small .NET Framework helper compiled by the installer. Linux and macOS use the Python 3 helper. Linux needs `zenity`, `kdialog`, or a working tkinter folder picker.
- When the helper or FFmpeg is missing, an automatic-merge job stops with installation guidance instead of silently leaving a collection of intermediate files.

Chrome documentation: [Manifest V3](https://developer.chrome.com/docs/extensions/reference/manifest), [chrome.scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting), [cross-origin requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests), [File System Access](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access), and [Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging).
