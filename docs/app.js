const copy = {
  en: {
    skip: "Skip to content", navFeatures: "Features", navInstall: "Install", navPrivacy: "Privacy",
    releaseLabel: "Version 0.5.2 · Chrome MV3",
    heroTitle: "A clean Bilibili archive, not a folder of fragments.",
    heroLede: "Save the highest quality your account can access, merge DASH streams locally, recover richer danmaku history, and keep only MP4, ASS, and NFO.",
    download: "Download 0.5.2", viewSource: "View source on GitHub",
    workflowTitle: "One serial, verifiable workflow", ready: "Ready",
    flowChrome: "Chrome downloads", flowChromeDetail: "Uses your login and SwitchyOmega/PAC rules",
    flowHelper: "Local helper writes", flowHelperDetail: "No network access, no cookie access",
    flowFfmpeg: "FFmpeg validates", flowFfmpegDetail: "Lossless mux plus audio/video verification",
    videoFile: "Video", subtitleFile: "Subtitle", metadataFile: "Metadata",
    trustOne: "Highest available quality", trustTwo: "Serial requests", trustThree: "No DRM bypass", trustFour: "Windows · Linux · macOS",
    featuresEyebrow: "Built for durable archives", featuresTitle: "Everything important stays. The clutter does not.",
    featureQualityTitle: "Account-aware quality", featureQualityBody: "Uses the active Bilibili session and selects the highest stream that account can access.",
    featureDanmakuTitle: "Richer danmaku history", featureDanmakuBody: "Combines legacy XML, current protobuf segments, and optional historical snapshots.",
    featureMetadataTitle: "Detailed NFO metadata", featureMetadataBody: "Preserves IDs, episode relationships, artwork, statistics, tags, rights, and stream properties.",
    visualAlt: "Chrome sends serial media chunks to a local FFmpeg helper, which creates MP4, ASS, and NFO files",
    visualCaption: "Chrome owns the network. The helper owns local files and FFmpeg. The boundary is deliberate.",
    outputEyebrow: "A small, useful result", outputTitle: "Three files. One stable ASCII name.",
    outputLede: "Archive paths use IDs such as Bilibili_BV1QVQRYVE96_P01_1080P. Original-language titles remain inside the subtitle and metadata.",
    mp4Title: "Merged video", mp4Body: "Lossless DASH mux with verified video and audio streams.",
    assTitle: "Danmaku subtitle", assBody: "Scrolling, top, bottom, color, and font-size attributes preserved.",
    nfoTitle: "Rich metadata", nfoBody: "Ready for Kodi, Emby, and Jellyfin, with a detailed Bilibili extension block.",
    detailsEyebrow: "What gets preserved", detailsTitle: "Enough context to remain useful years later.",
    detailEpisodes: "Parts and episode relationships", detailArtwork: "Poster, fanart, uploader avatar",
    detailStats: "Views, danmaku, replies, favorites, coins, shares, likes", detailStreams: "Codec, resolution, bitrate, duration",
    detailRights: "Tags, categories, rights, and publication time",
    installEyebrow: "Cross-platform setup", installTitle: "Install the extension, then let the helper handle FFmpeg.",
    installLede: "No build step is required. The installers stay in your user account and provide automatic or manual FFmpeg guidance.",
    windowsInstall: "Double-click the installer. If FFmpeg is missing, it can offer WinGet installation.",
    macInstall: "Uses Python 3 and can guide Homebrew installation for missing dependencies.",
    linuxInstall: "Supports APT, DNF, Pacman, Zypper, and APK, plus common folder pickers.",
    installStepOne: "Extract the ZIP, open chrome://extensions/, enable Developer mode, and load the unpacked folder.",
    installStepTwo: "Run the native-host installer for your operating system.",
    installStepThree: "Reload the extension, open a Bilibili playback page, and click the extension icon.",
    englishDocs: "English documentation ↗", chineseDocs: "中文说明 ↗",
    privacyEyebrow: "A clear network boundary", privacyTitle: "Your browser policy stays in charge.",
    chromeBoundaryTitle: "Every network request stays in Chrome",
    chromeBoundaryBody: "Bilibili API and media requests follow the current Chrome login, proxy, PAC, and SwitchyOmega configuration—even when it differs from the system proxy.",
    localHelperLabel: "Local helper", helperBoundaryTitle: "No network client",
    helperBoundaryBody: "The helper receives already-downloaded chunks, writes .part files, runs FFmpeg and ffprobe, then removes sources only after validation.",
    permissionsLabel: "Permissions", permissionsTitle: "No cookie or proxy permission",
    permissionsBody: "The extension does not read, display, or export cookie values and never changes browser, system, or Codex proxy settings.",
    faqTitle: "The important edge cases, up front.",
    faq1080Question: "Why might 1080P not appear?", faq1080Answer: "The extension requests the highest stream available to the current signed-in account. Some qualities require login or membership, and the extension does not bypass those restrictions.",
    faqFfmpegQuestion: "What happens if FFmpeg is missing?", faqFfmpegAnswer: "The save page stops with installation guidance instead of silently leaving raw fragments. Installers can automate supported package managers or show manual commands.",
    faqDanmakuQuestion: "Is historical danmaku guaranteed complete?", faqDanmakuAnswer: "No. The extension merges every accessible source it can query, but comments already removed by the server cannot be restored.",
    faqFailureQuestion: "What is kept after a failed merge?", faqFailureAnswer: "Complete source streams are retained to prevent data loss. After a successful ffprobe validation, the intermediate streams are deleted.",
    downloadEyebrow: "Current release", downloadTitle: "Ready for a cleaner archive?",
    downloadBody: "Download version 0.5.2, verify the checksum, and load the unpacked extension.",
    downloadZip: "Download ZIP", releaseNotes: "Release notes", footerNote: "Open source. No DRM or paywall bypass."
  },
  "zh-CN": {
    skip: "跳到正文", navFeatures: "功能", navInstall: "安装", navPrivacy: "隐私",
    releaseLabel: "版本 0.5.2 · Chrome MV3",
    heroTitle: "留下完整归档，而不是一堆零散文件。",
    heroLede: "保存当前账号可访问的最高画质，在本地合并 DASH 音视频，补全更多历史弹幕，最终只保留 MP4、ASS 和 NFO。",
    download: "下载 0.5.2", viewSource: "在 GitHub 查看源码",
    workflowTitle: "串行、透明、可验证的流程", ready: "已就绪",
    flowChrome: "Chrome 下载", flowChromeDetail: "使用现有登录态及 SwitchyOmega/PAC 规则",
    flowHelper: "本地助手写盘", flowHelperDetail: "不联网，也不接触 Cookie",
    flowFfmpeg: "FFmpeg 校验", flowFfmpegDetail: "无损封装并确认音视频流完整",
    videoFile: "视频", subtitleFile: "字幕", metadataFile: "元数据",
    trustOne: "最高可用画质", trustTwo: "所有请求串行", trustThree: "不绕过 DRM", trustFour: "Windows · Linux · macOS",
    featuresEyebrow: "为长期归档而设计", featuresTitle: "重要信息完整保留，中间杂项自动清理。",
    featureQualityTitle: "登录态画质识别", featureQualityBody: "使用当前 Bilibili 登录态，并选择该账号能够访问的最高画质。",
    featureDanmakuTitle: "更完整的历史弹幕", featureDanmakuBody: "合并旧 XML、当前 protobuf 分段和可选历史快照。",
    featureMetadataTitle: "详细 NFO 元数据", featureMetadataBody: "保留 ID、分集关系、图片、统计、标签、版权信息和音视频流参数。",
    visualAlt: "Chrome 将媒体分块串行交给本地 FFmpeg 助手，并生成 MP4、ASS 和 NFO 文件",
    visualCaption: "Chrome 负责网络，本地助手负责文件和 FFmpeg——边界清晰明确。",
    outputEyebrow: "精简而实用的结果", outputTitle: "三个文件，一个稳定的 ASCII 名称。",
    outputLede: "归档路径使用 Bilibili_BV1QVQRYVE96_P01_1080P 这类 ID；原语言标题仍保留在字幕和元数据中。",
    mp4Title: "合并视频", mp4Body: "无损封装 DASH，并验证结果同时包含视频流与音频流。",
    assTitle: "弹幕字幕", assBody: "保留滚动、顶部、底部、颜色和字号属性。",
    nfoTitle: "详细元数据", nfoBody: "兼容 Kodi、Emby 和 Jellyfin，并包含完整的 Bilibili 扩展块。",
    detailsEyebrow: "保留的信息", detailsTitle: "多年以后，归档仍有足够上下文。",
    detailEpisodes: "分 P 与剧集关系", detailArtwork: "封面、fanart、UP 主头像",
    detailStats: "播放、弹幕、评论、收藏、投币、分享、点赞", detailStreams: "编码、分辨率、码率、时长",
    detailRights: "标签、分类、版权信息和发布时间",
    installEyebrow: "跨平台安装", installTitle: "安装扩展，然后让本地助手处理 FFmpeg。",
    installLede: "无需构建。安装器仅写入当前用户目录，并提供 FFmpeg 自动安装或手动指导。",
    windowsInstall: "双击安装器。如果缺少 FFmpeg，可选择通过 WinGet 安装。",
    macInstall: "使用 Python 3，并可指导通过 Homebrew 安装缺失依赖。",
    linuxInstall: "支持 APT、DNF、Pacman、Zypper、APK 及常见目录选择器。",
    installStepOne: "解压 ZIP，打开 chrome://extensions/，启用开发者模式并加载解压后的目录。",
    installStepTwo: "运行当前操作系统对应的本地助手安装脚本。",
    installStepThree: "重新加载扩展，打开 Bilibili 播放页，然后点击扩展图标。",
    englishDocs: "English documentation ↗", chineseDocs: "中文说明 ↗",
    privacyEyebrow: "清晰的网络边界", privacyTitle: "始终由你的浏览器策略决定网络路径。",
    chromeBoundaryTitle: "所有网络请求都留在 Chrome",
    chromeBoundaryBody: "Bilibili API 和媒体请求遵循 Chrome 当前的登录态、代理、PAC 及 SwitchyOmega 配置，即使它们与系统代理不同。",
    localHelperLabel: "本地助手", helperBoundaryTitle: "没有网络客户端",
    helperBoundaryBody: "助手只接收 Chrome 已下载的分块、写入 .part 文件、运行 FFmpeg 与 ffprobe，并在校验成功后删除源流。",
    permissionsLabel: "权限", permissionsTitle: "不申请 Cookie 或代理权限",
    permissionsBody: "扩展不会读取、显示或导出 Cookie 值，也不会修改浏览器、系统或 Codex 的代理设置。",
    faqTitle: "重要边界问题，一次说清。",
    faq1080Question: "为什么有时没有 1080P？", faq1080Answer: "扩展请求当前登录账号可访问的最高画质。部分画质需要登录或会员权限，扩展不会绕过这些限制。",
    faqFfmpegQuestion: "没有安装 FFmpeg 会怎样？", faqFfmpegAnswer: "保存页会停止并显示安装指导，不会悄悄留下原始碎片。安装器可调用受支持的包管理器，或显示手动命令。",
    faqDanmakuQuestion: "历史弹幕一定完整吗？", faqDanmakuAnswer: "不能保证。扩展会合并所有可以访问的来源，但无法恢复服务器已经删除的弹幕。",
    faqFailureQuestion: "合并失败后会保留什么？", faqFailureAnswer: "为避免数据丢失，会保留已经完整下载的源流；ffprobe 校验成功后才删除中间流。",
    downloadEyebrow: "当前版本", downloadTitle: "准备好获得更干净的归档了吗？",
    downloadBody: "下载 0.5.2，核对校验值，然后加载解压后的扩展。",
    downloadZip: "下载 ZIP", releaseNotes: "版本说明", footerNote: "开源，不绕过 DRM 或付费墙。"
  }
};

const languageButtons = [...document.querySelectorAll("[data-language-choice]")];

function applyLanguage(language, persist = false) {
  const selected = language === "zh-CN" ? "zh-CN" : "en";
  document.documentElement.lang = selected;
  document.documentElement.dataset.language = selected;
  document.title = selected === "zh-CN" ? "Bilibili Archive Helper｜干净完整的 B 站归档" : "Bilibili Archive Helper | Clean, complete archives";
  document.querySelector('meta[name="description"]').content = selected === "zh-CN"
    ? "将 Bilibili 视频保存为干净的 MP4、ASS 字幕和详细 NFO 元数据。"
    : "Archive Bilibili videos as a clean MP4, ASS subtitle, and rich NFO metadata set.";
  for (const element of document.querySelectorAll("[data-copy]")) {
    const value = copy[selected][element.dataset.copy];
    if (value) element.textContent = value;
  }
  for (const element of document.querySelectorAll("[data-alt-copy]")) {
    const value = copy[selected][element.dataset.altCopy];
    if (value) element.alt = value;
  }
  for (const button of languageButtons) button.setAttribute("aria-pressed", String(button.dataset.languageChoice === selected));
  if (persist) localStorage.setItem("bah-language", selected);
}

for (const button of languageButtons) {
  button.addEventListener("click", () => applyLanguage(button.dataset.languageChoice, true));
}

const savedLanguage = localStorage.getItem("bah-language");
const detectedLanguage = navigator.language?.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
applyLanguage(savedLanguage || detectedLanguage);
