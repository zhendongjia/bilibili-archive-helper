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

const emptyXml = toBilibiliXml([], 38255528603);
const emptyAss = toAss([], { width: 1280, height: 720, durationSeconds: 5061, title: "No comments" });
if (!emptyXml.includes("<maxlimit>0</maxlimit>") || !emptyAss.includes("[Events]")) {
  throw new Error("Zero-comment videos must still produce valid XML and ASS sidecars");
}
const configurationOnlySegment = "IgQAwPwVKrgBCOHUAxKxAXsiZmlsbF9jb2xvciI6Imh0dHA6Ly9pMC5oZHNsYi5jb20vYmZzL2RtLzlkY2QzMjllNjE3MDM1YjQ1ZDIwNDFhYzg4OWM0OWNiNWVkZDNlNDQucG5nIiwic3Ryb2tlX2NvbG9yIjoiaHR0cDovL2kwLmhkc2xiLmNvbS9iZnMvZG0vNzE2YTc0OWIyNDYxZTAyZGYwYjRkYWZiNTliYmFmMGNlYWI3OWRhOS5wbmcifQ==";
if (parseProtobufDanmaku(base64ToBytes(configurationOnlySegment)).length !== 0) {
  throw new Error("Configuration-only protobuf segments must not be treated as comments");
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
