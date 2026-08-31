import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { base64ToBytes, parseProtobufDanmaku, parseLegacyXml, mergeDanmaku, toAss, toBilibiliXml } from "../lib/danmaku.js";
import { buildContext, toEpisodeNfo, toVideoNfo } from "../lib/metadata.js";
import { historyMonths, selectMedia } from "../lib/bilibili.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.resolve(here, "..", "..");
const outputs = path.join(workspace, "outputs");

const sourceXml = fs.readFileSync(path.join(outputs, "BILIBILI_MACRO_LINK_2016_上半场_弹幕.xml"), "utf8");
const videoPayload = JSON.parse(fs.readFileSync(path.join(outputs, "BILIBILI_MACRO_LINK_2016_上半场_视频信息.json"), "utf8"));
const seasonPayload = JSON.parse(fs.readFileSync(path.join(outputs, "BILIBILI_MACRO_LINK_2016_上半场_剧集信息.json"), "utf8"));

const comments = mergeDanmaku([parseLegacyXml(sourceXml)]);
if (comments.length !== 11770) throw new Error(`Expected 11770 comments, got ${comments.length}`);

const page = { url: "https://www.bilibili.com/bangumi/play/ep315550", title: "BML 2016", epId: 315550, bvid: "", aid: 0, cid: 0 };
const context = buildContext(page, videoPayload, seasonPayload);
const media = { width: 1280, height: 720, videoCodec: "h264", audioCodec: "aac", audioChannels: 2 };
const xml = toBilibiliXml(comments, context.cid);
const ass = toAss(comments, { width: 1280, height: 720, durationSeconds: 4884.2, title: context.title });
const movieNfo = toVideoNfo(context, media);
const episodeNfo = toEpisodeNfo(context, media);

if ((ass.match(/^Dialogue:/gm) || []).length !== comments.length) throw new Error("ASS dialogue count mismatch");
if (!xml.includes(`<maxlimit>${comments.length}</maxlimit>`)) throw new Error("XML maxlimit mismatch");
if (!movieNfo.includes("<movie>") || !episodeNfo.includes("<episodedetails>")) throw new Error("NFO root mismatch");
if (historyMonths("2016-07-23", "enhanced", new Date("2026-08-31T00:00:00Z")).length >= historyMonths("2016-07-23", "monthly", new Date("2026-08-31T00:00:00Z")).length) {
  throw new Error("Enhanced history plan should be smaller than monthly plan");
}

const fallbackMedia = selectMedia({
  code: 0,
  data: {
    quality: 64,
    accept_quality: [64],
    accept_description: ["720P"],
    dash: {
      video: [{ id: 64, codecs: "avc1.640033", width: 1280, height: 720, baseUrl: "https://primary.example/video.m4s", backupUrl: ["https://backup.example/video.m4s"] }],
      audio: [{ id: 30232, codecs: "mp4a.40.2", base_url: "https://primary.example/audio.m4s", backup_url: ["https://backup.example/audio.m4s"] }],
    },
  },
}, 64, "fallback-test");
if (fallbackMedia.items[0].urls.length !== 2 || fallbackMedia.items[1].urls.length !== 2) {
  throw new Error("Media items must retain primary and backup CDN URLs");
}

const ugcPage = { url: "https://www.bilibili.com/video/BV1QVQRYVE96", title: "LLM", bvid: "BV1QVQRYVE96", aid: 114187963466676, cid: 38255528603, epId: 0 };
const ugcPayload = { code: 0, data: {
  bvid: ugcPage.bvid, aid: ugcPage.aid, videos: 32, tid: 231, tid_v2: 2096, copyright: 1,
  pic: "http://i0.hdslb.com/cover.jpg", title: "李宏毅LLM大模型课程", pubdate: 1742370680, ctime: 1742370680, desc: "。", duration: 5061,
  owner: { mid: 3546866876680925, name: "李宏毅-机器学习", face: "https://i2.hdslb.com/avatar.jpg" },
  stat: { view: 25250, danmaku: 1, reply: 139, favorite: 1097, coin: 162, share: 95, like: 256 },
  rights: { download: 1, pay: 0, no_reprint: 0 },
  pages: [{ cid: ugcPage.cid, page: 1, part: "第1节：第一讲", duration: 5061, first_frame: "http://i2.hdslb.com/frame.jpg", ctime: 1778487022 }],
} };
const ugcTags = { code: 0, data: [{ tag_id: 46183, tag_name: "人工智能" }, { tag_id: 54148, tag_name: "AI" }] };
const ugcContext = buildContext(ugcPage, ugcPayload, null, ugcTags);
if (!/^Bilibili_BV1QVQRYVE96_P01$/.test(ugcContext.baseName) || /[^\x00-\x7F]/.test(ugcContext.baseName)) {
  throw new Error(`Archive base name must be stable ASCII: ${ugcContext.baseName}`);
}
const ugcNfo = toVideoNfo(ugcContext, {
  width: 1280, height: 720, videoCodec: "h264", audioCodec: "aac", audioChannels: 2,
  qualityCode: 64, qualityLabel: "高清 720P", videoCodecid: 7, videoBandwidth: 101861, audioId: 30232, audioBandwidth: 66146, frameRate: "30",
});
for (const expected of [
  "<sorttitle>20250319 - 01 - 第1节：第一讲</sorttitle>",
  "<runtime>85</runtime>",
  '<uniqueid type="bilibili" default="true">BV1QVQRYVE96</uniqueid>',
  "<viewcount>25250</viewcount>",
  "<replycount>139</replycount>",
  "<qualitycode>64</qualitycode>",
  "<codecid>7</codecid>",
  "<videowidth>1280</videowidth>",
  "<videobandwidth>101861</videobandwidth>",
  "<audiobandwidth>66146</audiobandwidth>",
  "<durationseconds>5061</durationseconds>",
  '<tag id="46183">人工智能</tag>',
  "<role>UP主</role>",
  "<download>1</download>",
]) {
  if (!ugcNfo.includes(expected)) throw new Error(`Rich UGC NFO missing: ${expected}`);
}
if (ugcNfo.includes("<genre>音乐</genre>") || ugcNfo.includes("<genre>晚会</genre>")) {
  throw new Error("UGC NFO must not contain hard-coded music/event genres");
}

const emptyXml = toBilibiliXml([], 38255528603);
const emptyAss = toAss([], { width: 1280, height: 720, durationSeconds: 5061, title: "No comments" });
if (!emptyXml.includes("<maxlimit>0</maxlimit>") || !emptyAss.includes("[Events]")) {
  throw new Error("Zero-comment videos must still produce valid XML and ASS conversion results");
}
const configurationOnlySegment = "IgQAwPwVKrgBCOHUAxKxAXsiZmlsbF9jb2xvciI6Imh0dHA6Ly9pMC5oZHNsYi5jb20vYmZzL2RtLzlkY2QzMjllNjE3MDM1YjQ1ZDIwNDFhYzg4OWM0OWNiNWVkZDNlNDQucG5nIiwic3Ryb2tlX2NvbG9yIjoiaHR0cDovL2kwLmhkc2xiLmNvbS9iZnMvZG0vNzE2YTc0OWIyNDYxZTAyZGYwYjRkYWZiNTliYmFmMGNlYWI3OWRhOS5wbmcifQ==";
if (parseProtobufDanmaku(base64ToBytes(configurationOnlySegment)).length !== 0) {
  throw new Error("Configuration-only protobuf segments must not be treated as comments");
}

const manifest = JSON.parse(fs.readFileSync(path.join(here, "..", "manifest.json"), "utf8"));
if (manifest.version !== "0.5.2" || manifest.default_locale !== "en" || !manifest.permissions.includes("nativeMessaging") || !manifest.key) {
  throw new Error("Native merge manifest configuration is incomplete");
}
const managerSource = fs.readFileSync(path.join(here, "..", "manager.js"), "utf8");
const popupSource = fs.readFileSync(path.join(here, "..", "popup.js"), "utf8");
for (const expected of ["com.bilibili_archive_helper.native", "startJob", "writeChunk", "connectNative"]) {
  if (!managerSource.includes(expected)) throw new Error(`Manager missing native merge token: ${expected}`);
}
for (const expected of ["outputFilename", "keepSources: false", "autoMerge.checked", "`${mediaStem}.ass`", "`${mediaStem}.nfo`"]) {
  if (!popupSource.includes(expected)) throw new Error(`Popup missing merge job token: ${expected}`);
}
for (const removedOutput of ["_视频信息.json", "_剧集信息.json", "_标签信息.json", "_弹幕.xml", "_合并说明.txt"]) {
  if (popupSource.includes(removedOutput)) throw new Error(`Popup still emits intermediate output: ${removedOutput}`);
}
const windowsHostSource = fs.readFileSync(path.join(here, "..", "native-host", "BilibiliArchiveNativeHost.cs"), "utf8");
const unixHostSource = fs.readFileSync(path.join(here, "..", "native-host", "bilibili_archive_native_host.py"), "utf8");
if (!windowsHostSource.includes('HelperVersion = "0.5.2"') || !unixHostSource.includes('HOST_VERSION = "0.5.2"')) {
  throw new Error("Native-helper versions must match the extension release");
}
for (const forbiddenNetworkClient of ["HttpClient", "urllib.request", "urlopen("]) {
  if (windowsHostSource.includes(forbiddenNetworkClient) || unixHostSource.includes(forbiddenNetworkClient)) {
    throw new Error(`Native host must not perform network requests: ${forbiddenNetworkClient}`);
  }
}
if (!managerSource.includes("openMediaResponse") || !managerSource.includes("writeChunk")) {
  throw new Error("Chrome must fetch media and stream chunks to the native host");
}
for (const crossPlatformFile of ["bilibili_archive_native_host.py", "install-unix.sh", "uninstall-unix.sh"]) {
  if (!fs.existsSync(path.join(here, "..", "native-host", crossPlatformFile))) {
    throw new Error(`Cross-platform native host file is missing: ${crossPlatformFile}`);
  }
}
if (!fs.existsSync(path.join(here, "..", "install-native-host.cmd"))) {
  throw new Error("English-named Windows installer entry point is missing");
}
function assertAsciiFilenames(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if ([".git", "_metadata", "__pycache__"].includes(entry.name)) continue;
    if (/[^\x00-\x7F]/.test(entry.name)) throw new Error(`Non-ASCII filename remains: ${entry.name}`);
    if (entry.isDirectory()) assertAsciiFilenames(path.join(directory, entry.name));
  }
}
assertAsciiFilenames(path.join(here, ".."));

const englishReadme = fs.readFileSync(path.join(here, "..", "README.md"), "utf8");
const chineseReadme = fs.readFileSync(path.join(here, "..", "README.zh-CN.md"), "utf8");
if (!englishReadme.includes("[Simplified Chinese](README.zh-CN.md)") || !chineseReadme.includes("[English](README.md)")) {
  throw new Error("English and Chinese documentation must link to each other");
}
for (const localeName of ["en", "zh_CN"]) {
  const localeMessages = JSON.parse(fs.readFileSync(path.join(here, "..", "_locales", localeName, "messages.json"), "utf8"));
  if (!localeMessages.extensionName?.message || !localeMessages.extensionDescription?.message) {
    throw new Error(`Chrome locale is incomplete: ${localeName}`);
  }
}
for (const localeName of ["en", "zh-CN"]) {
  const installerMessages = JSON.parse(fs.readFileSync(path.join(here, "..", "native-host", `install-messages.${localeName}.json`), "utf8"));
  if (!installerMessages.installed || !installerMessages.reload || !installerMessages.uninstalled) {
    throw new Error(`Installer locale is incomplete: ${localeName}`);
  }
}
const windowsInstaller = fs.readFileSync(path.join(here, "..", "native-host", "install.ps1"), "utf8");
const unixInstaller = fs.readFileSync(path.join(here, "..", "native-host", "install-unix.sh"), "utf8");
if (!windowsInstaller.includes("$PSUICulture") || !unixInstaller.includes("LC_MESSAGES")) {
  throw new Error("Installers must follow the operating-system language");
}
globalThis.chrome = { i18n: { getUILanguage: () => "en-US" } };
const englishUi = await import("../lib/i18n.js?smoke=en");
if (englishUi.language !== "en" || englishUi.t("prepareSave") !== "Prepare files and choose a folder") {
  throw new Error("English UI must be the default for non-Chinese browser locales");
}
globalThis.chrome.i18n.getUILanguage = () => "zh-CN";
const chineseUi = await import("../lib/i18n.js?smoke=zh");
if (chineseUi.language !== "zh-CN" || chineseUi.t("prepareSave") !== "准备文件并选择保存目录") {
  throw new Error("Chinese UI must follow a Chinese browser locale");
}
const localizedSources = [
  popupSource,
  managerSource,
  fs.readFileSync(path.join(here, "..", "popup.html"), "utf8"),
  fs.readFileSync(path.join(here, "..", "manager.html"), "utf8"),
].join("\n");
const referencedMessageKeys = new Set([
  ...[...localizedSources.matchAll(/\bt\("([A-Za-z0-9]+)"/g)].map((match) => match[1]),
  ...[...localizedSources.matchAll(/data-i18n="([A-Za-z0-9]+)"/g)].map((match) => match[1]),
  ...[...localizedSources.matchAll(/data-i18n-title="([A-Za-z0-9]+)"/g)].map((match) => match[1]),
]);
for (const key of referencedMessageKeys) {
  if (!englishUi.hasMessage(key) || !chineseUi.hasMessage(key)) throw new Error(`Missing UI translation: ${key}`);
}

console.log(JSON.stringify({
  comments: comments.length,
  assDialogues: (ass.match(/^Dialogue:/gm) || []).length,
  cid: context.cid,
  epId: context.epId,
  actors: (episodeNfo.match(/<actor>/g) || []).length,
  enhancedMonths: historyMonths("2016-07-23", "enhanced", new Date("2026-08-31T00:00:00Z")).length,
  monthlyMonths: historyMonths("2016-07-23", "monthly", new Date("2026-08-31T00:00:00Z")).length,
}, null, 2));
