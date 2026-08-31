# Bilibili Archive Helper

一个无需构建工具的 Chrome Manifest V3 扩展，用于从当前 Bilibili 视频或番剧播放页串行保存：

- 当前账号可访问的最高画质视频；
- 旧 XML、当前 protobuf 分段和可选历史快照合并后的弹幕；
- 保留滚动、顶部、底部、颜色和字号的 ASS 字幕；
- Bilibili 原始视频、剧集和标签 JSON；
- Kodi、Emby、Jellyfin 可读取的电影与剧集 NFO；
- 可选本地助手调用 FFmpeg，将 DASH 视频/音频流自动无损合并为 MP4；
- 与媒体文件同名的 `.ass` 和 `.nfo` 旁挂文件。

NFO 会尽可能保留网页接口可可靠取得的信息，包括分P/剧集关系、排序标题、UP 主 UID 与头像、封面与 fanart、发布日期、时长、播放/弹幕/评论/收藏/投币/分享/点赞统计、BVID/AID/CID/EPID、画质和编码代码、标签、版权权限以及音视频流参数。除 Kodi/Emby/Jellyfin 通用字段外，原始站点字段会写入 `<bilibili>` 扩展块。

## 安装

1. 打开 `chrome://extensions/`。
2. 开启右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本目录 `bilibili-archive-helper`。
5. 打开一个 Bilibili 视频或番剧播放页，确认页面已经登录，然后点击扩展图标。

### 安装自动合并助手（Windows）

1. 确认已安装 FFmpeg；助手会优先查找 PATH，也会识别 `C:\Program Files\ffmpeg-9.0-full_build\bin\ffmpeg.exe`。
2. 双击扩展目录中的 `安装本地合并助手.cmd`。
3. 安装完成后，在 `chrome://extensions/` 重新加载扩展。

安装器只在当前用户的 `%LOCALAPPDATA%\BilibiliArchiveHelper\NativeHost` 下安装一个小型助手，并注册当前用户的 Chrome/Edge Native Messaging 项，不需要管理员权限。扩展使用固定 ID，助手只接受该扩展发来的消息。若不安装助手，原有浏览器内保存仍可使用，只是不自动合并。

## 使用

1. 扩展会自动识别当前视频、CID、时长与可用画质。
2. 默认选择“最高可用”和“增强补全”。
3. 勾选所需输出后点击“准备文件并选择保存目录”。
4. 扩展会打开独立保存页；点击一次保存按钮并选择目标目录。
5. 所有文件会按顺序写入所选目录下的同名子目录，不会为每个文件重复弹窗。启用本地助手时，下载结束后会自动生成同名 MP4。

历史弹幕模式：

- **当前接口合并**：旧 XML + 当前 protobuf 分段，速度最快。
- **增强补全**：前 18 个月逐月取快照，之后每半年取一次，兼顾请求数量和完整度。
- **逐月快照**：从发布时间到现在逐月查询，最慢，也仍无法恢复服务器已经删除的弹幕。

## 视频格式

- Bilibili 返回渐进式 `durl` 时，扩展直接保存 MP4。
- Bilibili 只返回 DASH 时，扩展严格串行保存视频流和音频流。勾选“自动无损合并 MP4”且已安装本地助手时，会自动执行等价于下列命令的封装：

```powershell
ffmpeg -i "视频流.m4s" -i "音频流.m4s" -c copy "输出.mp4"
```

合并不重新编码；生成后会用 ffprobe 检查 MP4 是否同时包含视频流和音频流。为避免误删，默认保留原始 `.m4s`。如果 FFmpeg 失败，原始双流和旁挂文件仍会保留，保存页会显示错误。

扩展不会解密或处理 DRM，也不会绕过大会员、付费墙、地区限制或账号权限。

## 登录、Cookie 与代理

- 扩展不申请 `cookies` 权限，不读取、不显示、不导出 Cookie。
- Bilibili API 请求由当前播放页发起，浏览器会按正常规则使用该页面已有登录态。
- 扩展不申请 `proxy` 权限，也不会修改 Chrome、系统或 Codex 的代理设置。
- 本地合并助手下载媒体时明确禁用系统代理，仅直连 Bilibili CDN；它不接收或读取 Cookie。
- 如果 Bilibili 必须直连，请在 Chrome/系统的现有网络配置中为 `bilibili.com`、`hdslb.com` 和 `bilivideo.com` 设置直连。

## 权限说明

- `activeTab`、`scripting`：只在用户点击扩展时读取当前 Bilibili 页面的公开状态，并从页面发起 GET 请求。
- `storage`、`unlimitedStorage`：在弹窗和独立保存页之间传递一次性任务；完成后会清空任务正文。
- `nativeMessaging`：仅在启用自动合并时把文件内容和有时效的媒体 URL 交给本机助手，由助手串行保存并运行 FFmpeg。
- `declarativeNetRequestWithHostAccess`：只为 Bilibili CDN 下载补充 `Referer: https://www.bilibili.com/`。
- 主机权限仅限 Bilibili 及其视频 CDN。

## 设计说明

- 弹窗准备好任务后打开独立保存页，用户只需授权一次目标目录。
- 所有 API 和媒体下载都按顺序执行，不并发抓取。
- 当前页面脚本使用 Chrome `scripting` API 的 `MAIN` world，目的是复用页面登录态而不接触 Cookie 值。
- 媒体由扩展页面跨域读取并以流式方式直接写入目标文件；主 CDN 失败时串行尝试播放接口给出的备用节点。
- 自动合并模式由本地助手执行相同的串行下载，并使用 `.part` 临时文件保证失败时不会留下伪装成完整文件的结果。

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
- 某些视频的弹幕接口只有播放器配置而没有普通弹幕；扩展会生成合法的空 XML/ASS，并继续保存其余文件。
- 自动合并助手目前仅支持 Windows；其他系统仍会保存 DASH 双流和 FFmpeg 合并说明。
