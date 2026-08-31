# Bilibili Archive Helper

[English](README.md) | 简体中文

这是一个无需构建工具的 Chrome Manifest V3 扩展，用于以严格串行流程归档当前 Bilibili 视频或番剧剧集。

## 功能

- 下载当前登录账号可访问的最高画质。
- 合并旧 XML 接口、当前 protobuf 分段和可选历史快照，提高弹幕完整度。
- 将弹幕转换为 ASS，并保留滚动、顶部、底部、颜色和字号属性。
- 为 Kodi、Emby、Jellyfin 生成详细的电影或剧集 NFO。
- 可选本地 FFmpeg 助手，将 DASH 视频流和音频流无损封装为 MP4。
- 默认情况下，任务成功后只保留三个同名文件：`.mp4`、`.ass` 和 `.nfo`。
- 归档目录和文件名使用 `Bilibili_BV..._P01_1080P` 这类 ASCII 标识；原语言标题仍完整保留在 NFO 和 ASS 元数据中。
- 扩展界面跟随 Chrome 界面语言：`zh` 语言环境显示简体中文，其余或无法识别的语言环境显示英文。

NFO 会尽可能保留网页和接口中可可靠取得的信息，包括分 P 或剧集关系、排序标题、UP 主 UID 与头像、封面与 fanart、发布日期、时长、各项统计、BVID/AID/CID/EPID、画质与编码编号、标签、版权标记以及音视频流参数。除 Kodi/Emby/Jellyfin 通用字段外，Bilibili 特有值会写入 `<bilibili>` 扩展块。

## 安装扩展

1. 打开 `chrome://extensions/`。
2. 开启右上角的“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择 `bilibili-archive-helper` 目录。
5. 打开 Bilibili 视频或番剧播放页，按需登录，然后点击扩展图标。

### 安装自动合并助手

Windows：

1. 双击扩展目录中的 `install-native-host.cmd`。
2. 如果未检测到 FFmpeg，安装器会询问是否通过 WinGet 安装 `Gyan.FFmpeg`，同时也会显示手动安装方法。

Linux / macOS：

```sh
sh install-native-host.sh
```

Unix 助手仅使用 Python 3 标准库。如果缺少 Python、FFmpeg 或 Linux 图形目录选择器，安装脚本会检测 Homebrew、APT、DNF、Pacman、Zypper 或 APK，在支持时询问是否安装，否则显示手动操作指导。

安装器只写入当前用户目录，并为 Chrome、Chromium、Edge 和 Brave 注册 Native Messaging。助手本身不需要管理员权限，但系统包管理器可能按平台规则请求 `sudo`。安装或更新助手后，请重新加载扩展。

## 使用方法

1. 扩展识别当前视频、CID、时长和可用画质。
2. 默认选择“最高可用”和“增强补全”。
3. 选择需要的输出，然后点击准备按钮。
4. 扩展打开独立保存页后，只需点击一次并选择目标目录。
5. 所有 API、媒体和写入操作均串行执行。DASH 合并并通过 ffprobe 校验后，中间 `.m4s` 会被删除，最终留下 MP4、ASS 和 NFO。

历史弹幕模式：

- **当前接口合并**：合并旧 XML 和当前 protobuf 分段，速度最快。
- **增强补全**：逐月检查前 18 个月，之后每半年获取一次快照。
- **逐月快照**：从发布时间到现在逐月检查，速度最慢，而且仍无法恢复服务器已经删除的弹幕。

## 媒体与 FFmpeg 行为

- Bilibili 返回渐进式 `durl` 时，扩展直接保存 MP4。
- Bilibili 只返回 DASH 时，由 Chrome 串行读取视频流和音频流，再通过 Native Messaging 分块交给本地助手。
- FFmpeg 只做流复制，不重新编码，等价于：

```sh
ffmpeg -i "video-stream.m4s" -i "audio-stream.m4s" -c copy "output.mp4"
```

助手会使用 ffprobe 确认结果同时包含视频流和音频流。只有校验成功后才会删除源文件；如果合并失败，完整的源流会暂时保留以防数据丢失，保存页会显示错误。

扩展不会解密 DRM，也不会绕过大会员、付费墙、地区限制或账号权限。

## 登录、Cookie 与代理

- 扩展不申请 `cookies` 权限，不读取、不显示、不导出 Cookie 值。
- Bilibili API 请求由当前播放页发起，让 Chrome 正常应用页面已有登录态。
- 扩展不申请 `proxy` 权限，也不会修改 Chrome、系统或 Codex 的代理设置。
- 所有视频和音频请求都由 Chrome 发起，因此会遵循 Chrome 当前代理、PAC 规则及 SwitchyOmega 等扩展的分流策略，即使这些规则与系统代理不同。
- 本地助手没有任何联网逻辑，只接收 Chrome 已下载的分块、写入本地文件并运行 FFmpeg/ffprobe。

## 权限说明

- `activeTab`、`scripting`：仅在用户点击扩展后读取当前 Bilibili 页面的公开状态，并从页面来源发起 GET 请求。
- `storage`、`unlimitedStorage`：在弹窗与保存页之间传递一次性任务；完成后清空任务正文。
- `nativeMessaging`：启用自动合并时，将 ASS、NFO 和 Chrome 已下载的媒体分块交给本地助手。
- `declarativeNetRequestWithHostAccess`：只为 Bilibili CDN 下载添加 `Referer: https://www.bilibili.com/`。
- 主机权限仅覆盖 Bilibili 及其视频 CDN 域名。

## 设计与限制

- 弹窗准备任务后会打开独立保存页，目标目录只需授权一次。
- 所有请求按顺序执行，不并发抓取。媒体以小块流式传输，不会把整部视频装入内存。
- 本地助手使用 `.part` 临时文件，避免把中断写入误认为完整文件。
- Bilibili 接口属于站点内部接口，站点改版后可能需要更新解析逻辑。
- 历史弹幕接口需要登录态，并可能限制账号、日期或请求频率。
- 页面显示的弹幕池数量不一定等于接口当前实际返回的弹幕数。
- 某些视频只返回播放器配置而没有普通弹幕；扩展仍会生成合法的空 ASS 并继续保存。
- Windows 使用安装脚本编译的小型 .NET Framework 助手；Linux 和 macOS 使用 Python 3 助手。Linux 需要 `zenity`、`kdialog` 或可用的 tkinter 目录选择器。
- 未安装助手或缺少 FFmpeg 时，自动合并任务会停止并显示安装指导，不会悄悄留下大量中间文件。

Chrome 官方文档：[Manifest V3](https://developer.chrome.com/docs/extensions/reference/manifest)、[chrome.scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting)、[跨域网络请求](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)、[File System Access](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access) 和 [Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)。
