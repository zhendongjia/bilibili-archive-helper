import {
  inspectPageInMainWorld,
  fetchInMainWorld,
  videoInfoUrl,
  seasonInfoUrl,
  playUrl,
  legacyDanmakuUrl,
  danmakuSegmentUrl,
  historyIndexUrl,
  historySegmentUrl,
  selectMedia,
  historyMonths,
  mergeInstructions,
} from "./lib/bilibili.js";
import {
  base64ToBytes,
  parseProtobufDanmaku,
  parseLegacyXml,
  mergeDanmaku,
  toBilibiliXml,
  toAss,
} from "./lib/danmaku.js";
import { buildContext, sanitizeFilename, toVideoNfo, toEpisodeNfo } from "./lib/metadata.js";

const elements = {
  pageTitle: document.querySelector("#page-title"),
  pageMeta: document.querySelector("#page-meta"),
  quality: document.querySelector("#quality"),
  historyMode: document.querySelector("#history-mode"),
  includeVideo: document.querySelector("#include-video"),
  includeDanmaku: document.querySelector("#include-danmaku"),
  includeMetadata: document.querySelector("#include-metadata"),
  analyze: document.querySelector("#analyze"),
  download: document.querySelector("#download"),
  progressLabel: document.querySelector("#progress-label"),
  progressBar: document.querySelector("#progress-bar"),
  log: document.querySelector("#log"),
};

let activeTab = null;
let analyzed = null;
let logLines = [];
let queuePoll = null;

function log(message) {
  const timestamp = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  logLines.push(`[${timestamp}] ${message}`);
  logLines = logLines.slice(-80);
  elements.log.textContent = logLines.join("\n");
  elements.log.scrollTop = elements.log.scrollHeight;
}

function progress(percent, label) {
  elements.progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  elements.progressLabel.textContent = label;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function politeDelay() {
  await sleep(550 + Math.floor(Math.random() * 350));
}

async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https:\/\/(?:www\.)?bilibili\.com\//.test(tab.url || "")) {
    throw new Error("请先打开 Bilibili 视频或番剧播放页");
  }
  return tab;
}

async function executeMain(func, args = []) {
  const results = await chrome.scripting.executeScript({
    target: { tabId: activeTab.id },
    world: "MAIN",
    func,
    args,
  });
  if (!results?.[0]) throw new Error("页面脚本没有返回结果");
  return results[0].result;
}

function bytesToBase64(bytes) {
  let raw = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    raw += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(raw);
}

async function pageFetch(url, binary = false) {
  let result = await executeMain(fetchInMainWorld, [url, binary]);
  if (!result?.ok) {
    try {
      const response = await fetch(url, { credentials: "include", cache: "no-store" });
      if (binary) {
        const bytes = new Uint8Array(await response.arrayBuffer());
        result = { ok: response.ok, status: response.status, url: response.url, base64: bytesToBase64(bytes), bytes: bytes.length };
      } else {
        result = { ok: response.ok, status: response.status, url: response.url, text: await response.text() };
      }
    } catch (error) {
      result.error ||= error.message || String(error);
    }
  }
  if (!result?.ok) throw new Error(`${result?.status || "网络"}：${result?.error || url}`);
  return result;
}

async function apiJson(url, allowApiError = false) {
  const response = await pageFetch(url, false);
  let payload;
  try {
    payload = JSON.parse(response.text);
  } catch {
    throw new Error(`接口未返回 JSON：${url}`);
  }
  if (!allowApiError && Number(payload.code) !== 0) throw new Error(payload.message || `接口错误 ${payload.code}`);
  return payload;
}

async function analyzePage() {
  elements.analyze.disabled = true;
  elements.download.disabled = true;
  progress(5, "识别中");
  logLines = [];
  log("识别当前页面……");
  try {
    activeTab = await currentTab();
    const page = await executeMain(inspectPageInMainWorld);
    if (!page.epId && !page.bvid && !page.aid) throw new Error("没有识别到 EPID、BVID 或 AID");

    let seasonPayload = null;
    if (page.epId) {
      seasonPayload = await apiJson(seasonInfoUrl(page.epId));
      const episode = seasonPayload.result?.episodes?.find((item) => Number(item.ep_id || item.id) === Number(page.epId));
      if (episode) {
        page.bvid ||= episode.bvid;
        page.aid ||= Number(episode.aid);
        page.cid ||= Number(episode.cid);
      }
      await politeDelay();
    }

    const infoUrl = videoInfoUrl(page);
    if (!infoUrl) throw new Error("无法构造视频信息接口");
    const videoPayload = await apiJson(infoUrl);
    const context = buildContext(page, videoPayload, seasonPayload);
    if (!context.cid || !context.aid) throw new Error("视频信息缺少 CID 或 AID");

    const requestedQuality = Number(elements.quality.value);
    await politeDelay();
    const playPayload = await apiJson(playUrl(context, requestedQuality));
    const media = selectMedia(playPayload, requestedQuality, context.baseName);
    analyzed = { page, videoPayload, seasonPayload, context, media };

    elements.pageTitle.textContent = `${context.showTitle} · ${context.title}`;
    elements.pageMeta.textContent = `${context.bvid || `av${context.aid}`} · CID ${context.cid} · ${Math.round(context.durationSeconds / 60)} 分钟 · ${media.label} · ${media.type === "dash" ? "DASH 双流" : "单文件"}`;
    elements.download.disabled = false;
    progress(100, "识别完成");
    log(`识别完成：${media.label}，${media.type === "dash" ? "视频/音频分离" : "渐进式单文件"}`);
  } catch (error) {
    analyzed = null;
    elements.pageTitle.textContent = "识别失败";
    elements.pageMeta.textContent = error.message || String(error);
    progress(0, "失败");
    log(`错误：${error.message || error}`);
  } finally {
    elements.analyze.disabled = false;
  }
}

function textItem(filename, content, mime) {
  return { kind: "text", filename, content, mime };
}

function folderFilename(folder, name) {
  return `${sanitizeFilename(folder)}/${sanitizeFilename(name)}`;
}

function publishDate(context) {
  if (context.season?.publish?.pub_time) return String(context.season.publish.pub_time).slice(0, 10);
  if (context.video?.pubdate) return new Date(context.video.pubdate * 1000).toISOString().slice(0, 10);
  return "2010-01-01";
}

function fillMediaDimensions(mediaSelection, context) {
  mediaSelection.media.width ||= Number(context.page.videoWidth || context.pageInfo?.dimension?.width || context.episode?.dimension?.width || 1280);
  mediaSelection.media.height ||= Number(context.page.videoHeight || context.pageInfo?.dimension?.height || context.episode?.dimension?.height || 720);
  return mediaSelection;
}

async function collectDanmaku(context, historyMode) {
  const groups = [];
  log("下载旧 XML 弹幕……");
  try {
    const legacy = await pageFetch(legacyDanmakuUrl(context.cid));
    const parsed = parseLegacyXml(legacy.text);
    groups.push(parsed);
    log(`旧 XML：${parsed.length} 条`);
  } catch (error) {
    log(`旧 XML 失败：${error.message || error}`);
  }

  const segmentCount = Math.max(1, Math.ceil(context.durationSeconds / 360));
  for (let index = 1; index <= segmentCount; index += 1) {
    progress(15 + Math.round(index / segmentCount * 25), `当前弹幕 ${index}/${segmentCount}`);
    try {
      const response = await pageFetch(danmakuSegmentUrl(context.cid, index), true);
      groups.push(parseProtobufDanmaku(base64ToBytes(response.base64)));
    } catch (error) {
      log(`当前分段 ${index} 失败：${error.message || error}`);
    }
    if (index < segmentCount) await politeDelay();
  }
  log(`当前分段：${segmentCount} 段`);

  const months = historyMonths(publishDate(context), historyMode);
  let historySnapshots = 0;
  let loggedOut = false;
  for (let index = 0; index < months.length; index += 1) {
    const month = months[index];
    progress(40 + Math.round((index + 1) / Math.max(1, months.length) * 40), `历史弹幕 ${index + 1}/${months.length}`);
    try {
      const indexPayload = await apiJson(historyIndexUrl(context.cid, month), true);
      if (Number(indexPayload.code) === -101) {
        loggedOut = true;
        log("历史接口未识别登录态，跳过历史快照");
        break;
      }
      if (Number(indexPayload.code) !== 0) {
        log(`${month} 历史索引：${indexPayload.message || indexPayload.code}`);
        await politeDelay();
        continue;
      }
      const date = Array.isArray(indexPayload.data) ? indexPayload.data.at(-1) : "";
      if (date) {
        await politeDelay();
        const response = await pageFetch(historySegmentUrl(context.cid, date), true);
        const parsed = parseProtobufDanmaku(base64ToBytes(response.base64));
        if (parsed.length) {
          groups.push(parsed);
          historySnapshots += 1;
        }
      }
    } catch (error) {
      log(`${month} 历史快照失败：${error.message || error}`);
    }
    if (index + 1 < months.length) await politeDelay();
  }
  if (months.length && !loggedOut) log(`历史快照：${historySnapshots}/${months.length} 个有效月份`);
  return mergeDanmaku(groups);
}

async function startDownload() {
  elements.download.disabled = true;
  elements.analyze.disabled = true;
  progress(2, "准备中");
  log("开始准备下载，所有网络请求保持串行……");
  try {
    if (!analyzed) await analyzePage();
    if (!analyzed) throw new Error("页面尚未成功识别");

    const { page, videoPayload, seasonPayload, context } = analyzed;
    const requestedQuality = Number(elements.quality.value);
    const playPayload = await apiJson(playUrl(context, requestedQuality));
    const mediaSelection = fillMediaDimensions(selectMedia(playPayload, requestedQuality, context.baseName), context);
    analyzed.media = mediaSelection;
    const mediaStem = `${context.baseName}_${mediaSelection.label}`;
    const folder = context.baseName;
    const queue = [];

    if (elements.includeMetadata.checked) {
      progress(10, "生成元数据");
      queue.push(textItem(folderFilename(folder, `${context.baseName}_视频信息.json`), `${JSON.stringify(videoPayload, null, 2)}\n`, "application/json;charset=utf-8"));
      if (seasonPayload) queue.push(textItem(folderFilename(folder, `${context.baseName}_剧集信息.json`), `${JSON.stringify(seasonPayload, null, 2)}\n`, "application/json;charset=utf-8"));
      const videoNfo = toVideoNfo(context, mediaSelection.media);
      const episodeNfo = seasonPayload ? toEpisodeNfo(context, mediaSelection.media) : videoNfo;
      queue.push(textItem(folderFilename(folder, `${context.baseName}_视频信息.nfo`), videoNfo, "application/xml;charset=utf-8"));
      if (seasonPayload) queue.push(textItem(folderFilename(folder, `${context.baseName}_剧集信息.nfo`), episodeNfo, "application/xml;charset=utf-8"));
      queue.push(textItem(folderFilename(folder, `${mediaStem}.nfo`), episodeNfo, "application/xml;charset=utf-8"));
      log("已生成 JSON 与 NFO");
    }

    if (elements.includeDanmaku.checked) {
      const comments = await collectDanmaku(context, elements.historyMode.value);
      if (!comments.length) throw new Error("没有取得任何弹幕");
      const width = mediaSelection.media.width || context.episode?.dimension?.width || context.pageInfo?.dimension?.width || 1280;
      const height = mediaSelection.media.height || context.episode?.dimension?.height || context.pageInfo?.dimension?.height || 720;
      const xml = toBilibiliXml(comments, context.cid);
      const ass = toAss(comments, { width, height, durationSeconds: context.durationSeconds, title: `${context.showTitle} ${context.title}` });
      queue.push(textItem(folderFilename(folder, `${context.baseName}_弹幕.xml`), xml, "application/xml;charset=utf-8"));
      queue.push(textItem(folderFilename(folder, `${context.baseName}_弹幕.ass`), ass, "text/x-ssa;charset=utf-8"));
      queue.push(textItem(folderFilename(folder, `${mediaStem}.ass`), ass, "text/x-ssa;charset=utf-8"));
      log(`合并后弹幕：${comments.length} 条`);
    }

    const instructions = mergeInstructions(context.baseName, mediaSelection);
    if (instructions) queue.push(textItem(folderFilename(folder, `${mediaStem}_合并说明.txt`), instructions, "text/plain;charset=utf-8"));

    if (elements.includeVideo.checked) {
      for (const item of mediaSelection.items) {
        queue.push({ ...item, filename: folderFilename(folder, item.filename) });
      }
      log(mediaSelection.type === "dash" ? "最高画质为 DASH，将先视频、后音频串行下载" : "视频将作为队列最后一项下载");
    }

    if (!queue.length) throw new Error("没有勾选任何输出");
    progress(85, "加入下载队列");
    const response = await chrome.runtime.sendMessage({ type: "ENQUEUE_DOWNLOADS", items: queue });
    if (!response?.ok) throw new Error(response?.error || "无法创建下载队列");
    log(`下载队列已创建：${queue.length} 个文件`);
    monitorQueue();
  } catch (error) {
    progress(0, "失败");
    log(`错误：${error.message || error}`);
    elements.download.disabled = !analyzed;
  } finally {
    elements.analyze.disabled = false;
  }
}

function monitorQueue() {
  if (queuePoll) clearInterval(queuePoll);
  const poll = async () => {
    const response = await chrome.runtime.sendMessage({ type: "GET_QUEUE" });
    const queue = response?.queue;
    if (!queue) return;
    const done = queue.completed + queue.failed;
    progress(85 + Math.round(done / Math.max(1, queue.total) * 15), queue.status === "running" ? `${done}/${queue.total}` : "完成");
    if (queue.currentFilename) log(`正在下载：${queue.currentFilename}`);
    if (queue.error) log(`下载提示：${queue.error}`);
    if (queue.status !== "running") {
      clearInterval(queuePoll);
      queuePoll = null;
      progress(100, queue.failed ? `完成，失败 ${queue.failed}` : "全部完成");
      log(`队列结束：成功 ${queue.completed}，失败 ${queue.failed}`);
      elements.download.disabled = !analyzed;
    }
  };
  poll().catch((error) => log(`队列状态错误：${error.message || error}`));
  queuePoll = setInterval(() => poll().catch(() => {}), 1200);
}

elements.analyze.addEventListener("click", analyzePage);
elements.download.addEventListener("click", startDownload);
elements.quality.addEventListener("change", () => {
  if (analyzed) analyzePage();
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.downloadQueue) monitorQueue();
});

analyzePage();
chrome.runtime.sendMessage({ type: "GET_QUEUE" }).then((response) => {
  if (response?.queue?.status === "running") monitorQueue();
});
