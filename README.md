# Bilibili Archive Helper

一个无需构建工具的 Chrome Manifest V3 扩展，用于从当前 Bilibili 视频或番剧播放页串行保存：

- 当前账号可访问的最高画质视频；
- 合并旧 XML 接口、当前 protobuf 分段和可选历史快照中的弹幕；
- 保留滚动、顶部、底部、颜色和字号的 ASS 字幕；
- Kodi、Emby、Jellyfin 可读取的电影与剧集 NFO；
- 可选本地助手调用 FFmpeg，将 DASH 视频/音频流自动无损合并为 MP4；
- 默认最终只保留同名 `.mp4`、`.ass` 和 `.nfo` 三个文件。

NFO 会尽可能保留网页接口可可靠取得的信息，包括分P/剧集关系、排序标题、UP 主 UID 与头像、封面与 fanart、发布日期、时长、播放/弹幕/评论/收藏/投币/分享/点赞统计、BVID/AID/CID/EPID、画质和编码代码、标签、版权权限以及音视频流参数。除 Kodi/Emby/Jellyfin 通用字段外，原始站点字段会写入 `<bilibili>` 扩展块。

## 安装

1. 打开 `chrome://extensions/`。
2. 开启右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本目录 `bilibili-archive-helper`。
5. 打开一个 Bilibili 视频或番剧播放页，确认页面已经登录，然后点击扩展图标。

### 安装自动合并助手

Windows：

1. 双击扩展目录中的 `安装本地合并助手.cmd`。
2. 如果未检测到 FFmpeg，安装器会询问是否通过 WinGet 安装 `Gyan.FFmpeg`；也会给出手动安装命令和链接。

Linux / macOS：

```sh
sh install-native-host.sh
```

脚本使用 Python 3 标准库运行助手。缺少 Python、FFmpeg 或 Linux 图形目录选择器时，会检测 Homebrew、APT、DNF、Pacman、Zypper、APK 等环境，询问是否安装，并在无法自动安装时打印对应指导。安装完成后，在扩展管理页重新加载扩展。

安装器只写入当前用户目录，并为 Chrome、Chromium、Edge 和 Brave 注册 Native Messaging，不需要管理员权限（包管理器安装依赖时可能按系统规则请求 `sudo`）。扩展使用固定 ID，助手只接受该扩展发来的消息。

## 使用

1. 扩展会自动识别当前视频、CID、时长与可用画质。
2. 默认选择“最高可用”和“增强补全”。
3. 勾选所需输出后点击“准备文件并选择保存目录”。
4. 扩展会打开独立保存页；点击一次保存按钮并选择目标目录。
5. 所有步骤按顺序执行，不会为每个文件重复弹窗。DASH 合并并校验成功后会删除中间 `.m4s`，最终只留下 MP4、ASS 和 NFO。

历史弹幕模式：

- **当前接口合并**：旧 XML + 当前 protobuf 分段，速度最快。
- **增强补全**：前 18 个月逐月取快照，之后每半年取一次，兼顾请求数量和完整度。
- **逐月快照**：从发布时间到现在逐月查询，最慢，也仍无法恢复服务器已经删除的弹幕。

## 视频格式

- Bilibili 返回渐进式 `durl` 时，扩展直接保存 MP4。
- Bilibili 只返回 DASH 时，Chrome 严格串行读取视频流和音频流，再通过小块 Native Messaging 消息交给本地助手写盘。勾选“自动无损合并 MP4”且已安装助手时，会自动执行等价于下列命令的封装：

```powershell
ffmpeg -i "视频流.m4s" -i "音频流.m4s" -c copy "输出.mp4"
```

合并不重新编码；生成后会用 ffprobe 检查 MP4 是否同时包含视频流和音频流。只有校验成功后才会删除原始 `.m4s`；如果 FFmpeg 失败，双流会暂时保留以免数据丢失，保存页会显示错误。

扩展不会解密或处理 DRM，也不会绕过大会员、付费墙、地区限制或账号权限。

## 登录、Cookie 与代理

- 扩展不申请 `cookies` 权限，不读取、不显示、不导出 Cookie。
- Bilibili API 请求由当前播放页发起，浏览器会按正常规则使用该页面已有登录态。
- 扩展不申请 `proxy` 权限，也不会修改 Chrome、系统或 Codex 的代理设置。
- 视频和音频网络请求也始终由 Chrome 发起，因此会遵循 Chrome 当前代理配置、PAC 和 SwitchyOmega 等扩展的分流策略，即使它与系统代理不同。
- 本地助手完全不联网，只接收 Chrome 传来的文件分块并执行本地写盘、FFmpeg 和 ffprobe；它不判断直连/代理，也不接收 Cookie。

## 权限说明

- `activeTab`、`scripting`：只在用户点击扩展时读取当前 Bilibili 页面的公开状态，并从页面发起 GET 请求。
- `storage`、`unlimitedStorage`：在弹窗和独立保存页之间传递一次性任务；完成后会清空任务正文。
- `nativeMessaging`：仅在启用自动合并时把 ASS、NFO 和 Chrome 已下载的媒体分块交给本机助手，由助手串行写盘并运行 FFmpeg。
- `declarativeNetRequestWithHostAccess`：只为 Bilibili CDN 下载补充 `Referer: https://www.bilibili.com/`。
- 主机权限仅限 Bilibili 及其视频 CDN。

## 设计说明

- 弹窗准备好任务后打开独立保存页，用户只需授权一次目标目录。
- 所有 API 和媒体下载都按顺序执行，不并发抓取。
- 当前页面脚本使用 Chrome `scripting` API 的 `MAIN` world，目的是复用页面登录态而不接触 Cookie 值。
- 媒体始终由扩展页面跨域读取；主 CDN 失败时串行尝试播放接口给出的备用节点。自动合并模式把每个网络分块逐个交给助手，不会把整部视频装入内存。
- 本地助手不包含网络客户端，只负责文件写入和 FFmpeg；使用 `.part` 临时文件保证失败时不会留下伪装成完整文件的结果。

相关 Chrome 官方文档：

- [Manifest V3](https://developer.chrome.com/docs/extensions/reference/manifest)
- [chrome.scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting)
- [跨域网络请求](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)
- [File System Access API](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)
- [Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)

## 已知限制

- Bilibili 接口是站点内部接口，站点改版后可能需要更新 URL 或字段解析。
- 历史弹幕接口需要 Bilibili 登录态，并可能对账号、日期或请求频率有限制。
- “页面显示的弹幕池数量”不等于接口当前实际返回数量。
- 某些视频的弹幕接口只有播放器配置而没有普通弹幕；扩展会生成合法的空 ASS，并继续保存其余文件。
- Windows 使用随安装脚本编译的小型 .NET Framework 助手；Linux/macOS 使用 Python 3 助手。Linux 桌面需要 `zenity`、`kdialog` 或可用的 tkinter 目录选择器。
- 未安装助手或缺少 FFmpeg 时，启用了自动合并的保存任务会停在保存页并给出安装指导，不会悄悄退回为一堆中间文件。
