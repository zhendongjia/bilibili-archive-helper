import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseLegacyXml, mergeDanmaku, toAss, toBilibiliXml } from "../lib/danmaku.js";
import { buildContext, toEpisodeNfo, toVideoNfo } from "../lib/metadata.js";
import { historyMonths } from "../lib/bilibili.js";

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

console.log(JSON.stringify({
  comments: comments.length,
  assDialogues: (ass.match(/^Dialogue:/gm) || []).length,
  cid: context.cid,
  epId: context.epId,
  actors: (episodeNfo.match(/<actor>/g) || []).length,
  enhancedMonths: historyMonths("2016-07-23", "enhanced", new Date("2026-08-31T00:00:00Z")).length,
  monthlyMonths: historyMonths("2016-07-23", "monthly", new Date("2026-08-31T00:00:00Z")).length,
}, null, 2));
