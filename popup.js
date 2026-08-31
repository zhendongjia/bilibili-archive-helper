import {
  inspectPageInMainWorld,
  fetchInMainWorld,
  videoInfoUrl,
  videoTagsUrl,
  seasonInfoUrl,
  playUrl,
  legacyDanmakuUrl,
  danmakuSegmentUrl,
  historyIndexUrl,
  historySegmentUrl,
  selectMedia,
  historyMonths,
} from "./lib/bilibili.js";
import {
  base64ToBytes,
  parseProtobufDanmaku,
  parseLegacyXml,
  mergeDanmaku,
  toAss,
} from "./lib/danmaku.js";
import { buildContext, sanitizeFilename, toVideoNfo, toEpisodeNfo } from "./lib/metadata.js";
import { language, localizeDocument, t } from "./lib/i18n.js";

localizeDocument();

const elements = {
  pageTitle: document.querySelector("#page-title"),
  pageMeta: document.querySelector("#page-meta"),
  quality: document.querySelector("#quality"),
  historyMode: document.querySelector("#history-mode"),
  includeVideo: document.querySelector("#include-video"),
  includeDanmaku: document.querySelector("#include-danmaku"),
  includeMetadata: document.querySelector("#include-metadata"),
  autoMerge: document.querySelector("#auto-merge"),
  analyze: document.querySelector("#analyze"),
  download: document.querySelector("#download"),
  progressLabel: document.querySelector("#progress-label"),
  progressBar: document.querySelector("#progress-bar"),
  log: document.querySelector("#log"),
};

let activeTab = null;
let analyzed = null;
let logLines = [];

function log(message) {
  const timestamp = new Date().toLocaleTimeString(language, { hour12: false });
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
    throw new Error(t("openBilibiliPage"));
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
  if (!results?.[0]) throw new Error(t("noPageResult"));
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
  if (!result?.ok) throw new Error(`${result?.status || t("network")}: ${result?.error || url}`);
  return result;
}

async function apiJson(url, allowApiError = false) {
  const response = await pageFetch(url, false);
  let payload;
  try {
    payload = JSON.parse(response.text);
  } catch {
    throw new Error(t("apiNotJson", { url }));
  }
  if (!allowApiError && Number(payload.code) !== 0) throw new Error(payload.message || t("apiError", { code: payload.code }));
  return payload;
}

async function analyzePage() {
  elements.analyze.disabled = true;
  elements.download.disabled = true;
  progress(5, t("recognizing"));
  logLines = [];
  log(t("inspectingPage"));
  try {
    activeTab = await currentTab();
    const page = await executeMain(inspectPageInMainWorld);
    if (!page.epId && !page.bvid && !page.aid) throw new Error(t("noVideoId"));

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
    if (!infoUrl) throw new Error(t("noVideoInfoUrl"));
    const videoPayload = await apiJson(infoUrl);
    let tagsPayload = null;
    const tagUrl = videoTagsUrl(page);
    if (tagUrl) {
      try {
        await politeDelay();
        tagsPayload = await apiJson(tagUrl);
      } catch (error) {
        log(t("tagApiFailed", { error: error.message || error }));
      }
    }
    const context = buildContext(page, videoPayload, seasonPayload, tagsPayload);
    if (!context.cid || !context.aid) throw new Error(t("missingCidAid"));

    const requestedQuality = Number(elements.quality.value);
    await politeDelay();
    const playPayload = await apiJson(playUrl(context, requestedQuality));
    const media = selectMedia(playPayload, requestedQuality, context.baseName);
    analyzed = { page, videoPayload, seasonPayload, tagsPayload, context, media };

    elements.pageTitle.textContent = `${context.showTitle} · ${context.title}`;
    elements.pageMeta.textContent = `${context.bvid || `av${context.aid}`} · CID ${context.cid} · ${t("minutes", { count: Math.round(context.durationSeconds / 60) })} · ${media.label} · ${media.type === "dash" ? t("dashDual") : t("singleFile")}`;
    elements.download.disabled = false;
    progress(100, t("recognitionComplete"));
    log(t("recognized", { quality: media.label, format: media.type === "dash" ? t("separatedStreams") : t("progressiveFile") }));
  } catch (error) {
    analyzed = null;
    elements.pageTitle.textContent = t("recognitionFailed");
    elements.pageMeta.textContent = error.message || String(error);
    progress(0, t("failed"));
    log(t("error", { error: error.message || error }));
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
  log(t("downloadingLegacy"));
  try {
    const legacy = await pageFetch(legacyDanmakuUrl(context.cid));
    const parsed = parseLegacyXml(legacy.text);
    groups.push(parsed);
    log(t("legacyCount", { count: parsed.length }));
  } catch (error) {
    log(t("legacyFailed", { error: error.message || error }));
  }

  const segmentCount = Math.max(1, Math.ceil(context.durationSeconds / 360));
  let currentComments = 0;
  for (let index = 1; index <= segmentCount; index += 1) {
    progress(15 + Math.round(index / segmentCount * 25), t("currentDanmaku", { current: index, total: segmentCount }));
    try {
      const response = await pageFetch(danmakuSegmentUrl(context.cid, index), true);
      const parsed = parseProtobufDanmaku(base64ToBytes(response.base64));
      groups.push(parsed);
      currentComments += parsed.length;
    } catch (error) {
      log(t("currentSegmentFailed", { index, error: error.message || error }));
    }
    if (index < segmentCount) await politeDelay();
  }
  log(t("currentSummary", { segments: segmentCount, count: currentComments }));

  const months = historyMonths(publishDate(context), historyMode);
  let historySnapshots = 0;
  let loggedOut = false;
  for (let index = 0; index < months.length; index += 1) {
    const month = months[index];
    progress(40 + Math.round((index + 1) / Math.max(1, months.length) * 40), t("historicalDanmaku", { current: index + 1, total: months.length }));
    try {
      const indexPayload = await apiJson(historyIndexUrl(context.cid, month), true);
      if (Number(indexPayload.code) === -101) {
        loggedOut = true;
        log(t("historyLoginMissing"));
        break;
      }
      if (Number(indexPayload.code) !== 0) {
        log(t("historyIndex", { month, message: indexPayload.message || indexPayload.code }));
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
      log(t("historyFailed", { month, error: error.message || error }));
    }
    if (index + 1 < months.length) await politeDelay();
  }
  if (months.length && !loggedOut) log(t("historySummary", { valid: historySnapshots, total: months.length }));
  return mergeDanmaku(groups);
}

async function startDownload() {
  elements.download.disabled = true;
  elements.analyze.disabled = true;
  progress(2, t("preparing"));
  log(t("preparingSerial"));
  try {
    if (!analyzed) await analyzePage();
    if (!analyzed) throw new Error(t("pageNotRecognized"));

    const { page, seasonPayload, context } = analyzed;
    const requestedQuality = Number(elements.quality.value);
    const playPayload = await apiJson(playUrl(context, requestedQuality));
    const mediaSelection = fillMediaDimensions(selectMedia(playPayload, requestedQuality, context.baseName), context);
    analyzed.media = mediaSelection;
    const mediaStem = `${context.baseName}_${mediaSelection.label}`;
    const folder = context.baseName;
    const queue = [];

    if (elements.includeMetadata.checked) {
      progress(10, t("generatingMetadata"));
      const videoNfo = toVideoNfo(context, mediaSelection.media);
      const episodeNfo = seasonPayload ? toEpisodeNfo(context, mediaSelection.media) : videoNfo;
      queue.push(textItem(folderFilename(folder, `${mediaStem}.nfo`), episodeNfo, "application/xml;charset=utf-8"));
      log(t("nfoGenerated"));
    }

    if (elements.includeDanmaku.checked) {
      const comments = await collectDanmaku(context, elements.historyMode.value);
      const width = mediaSelection.media.width || context.episode?.dimension?.width || context.pageInfo?.dimension?.width || 1280;
      const height = mediaSelection.media.height || context.episode?.dimension?.height || context.pageInfo?.dimension?.height || 720;
      const ass = toAss(comments, { width, height, durationSeconds: context.durationSeconds, title: `${context.showTitle} ${context.title}` });
      queue.push(textItem(folderFilename(folder, `${mediaStem}.ass`), ass, "text/x-ssa;charset=utf-8"));
      if (comments.length) log(t("mergedComments", { count: comments.length }));
      else log(t("noComments"));
    }

    let merge = null;
    if (elements.includeVideo.checked) {
      for (const item of mediaSelection.items) {
        queue.push({ ...item, filename: folderFilename(folder, item.filename) });
      }
      if (elements.autoMerge.checked && mediaSelection.type === "dash" && mediaSelection.items.length >= 2) {
        merge = {
          videoFilename: folderFilename(folder, mediaSelection.items[0].filename),
          audioFilename: folderFilename(folder, mediaSelection.items[1].filename),
          outputFilename: folderFilename(folder, `${mediaStem}.mp4`),
          keepSources: false,
        };
      }
      log(mediaSelection.type === "dash" ? t("dashDownload") : t("progressiveQueued"));
    }

    if (!queue.length) throw new Error(t("noOutputs"));
    progress(85, t("openingSavePage"));
    const job = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      sourceUrl: page.url,
      title: `${context.showTitle} · ${context.title}`,
      quality: mediaSelection.label,
      items: queue,
      merge,
    };
    await chrome.storage.local.set({ pendingDownloadJob: job });
    await chrome.tabs.create({ url: chrome.runtime.getURL(`manager.html?job=${encodeURIComponent(job.id)}`) });
    progress(100, t("waitingFolder"));
    log(t("savePageOpened", { count: queue.length }));
    window.close();
  } catch (error) {
    progress(0, t("failed"));
    log(t("error", { error: error.message || error }));
    elements.download.disabled = !analyzed;
  } finally {
    elements.analyze.disabled = false;
  }
}

elements.analyze.addEventListener("click", analyzePage);
elements.download.addEventListener("click", startDownload);
elements.quality.addEventListener("change", () => {
  if (analyzed) analyzePage();
});

analyzePage();
