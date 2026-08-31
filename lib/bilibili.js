export const QUALITY_NAMES = new Map([
  [127, "最高"], [126, "杜比视界"], [125, "HDR"], [120, "4K"],
  [116, "1080P60"], [112, "1080P+"], [80, "1080P"], [74, "720P60"],
  [64, "720P"], [32, "480P"], [16, "360P"],
]);

export function inspectPageInMainWorld() {
  const url = location.href;
  const epMatch = url.match(/\/bangumi\/play\/ep(\d+)/);
  const bvMatch = url.match(/\/video\/(BV[0-9A-Za-z]+)/i);
  const state = window.__INITIAL_STATE__ || {};
  const videoData = state.videoData || {};
  const video = document.querySelector("video");
  return {
    url,
    title: document.title.replace(/-哔哩哔哩.*$/, "").trim(),
    epId: Number(epMatch?.[1] || state.epInfo?.id || state.epInfo?.ep_id || 0),
    bvid: bvMatch?.[1] || videoData.bvid || state.bvid || "",
    aid: Number(videoData.aid || state.aid || state.epInfo?.aid || 0),
    cid: Number(videoData.cid || state.cid || state.epInfo?.cid || 0),
    hasPlayInfo: Boolean(window.__playinfo__),
    videoWidth: Number(video?.videoWidth || 0),
    videoHeight: Number(video?.videoHeight || 0),
  };
}

export async function fetchInMainWorld(url, binary = false) {
  try {
    const response = await fetch(url, {
      credentials: "include",
      cache: "no-store",
      headers: { Accept: binary ? "application/octet-stream,*/*" : "application/json,text/plain,*/*" },
    });
    if (binary) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      let raw = "";
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        raw += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      }
      return { ok: response.ok, status: response.status, url: response.url, base64: btoa(raw), bytes: bytes.length };
    }
    return { ok: response.ok, status: response.status, url: response.url, text: await response.text() };
  } catch (error) {
    return { ok: false, status: 0, url, error: error.message || String(error) };
  }
}

export function videoInfoUrl(page) {
  if (page.bvid) return `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(page.bvid)}`;
  if (page.aid) return `https://api.bilibili.com/x/web-interface/view?aid=${page.aid}`;
  return "";
}

export function seasonInfoUrl(epId) {
  return `https://api.bilibili.com/pgc/view/web/season?ep_id=${epId}`;
}

export function playUrl(context, quality) {
  const params = new URLSearchParams({
    avid: String(context.aid),
    cid: String(context.cid),
    qn: String(quality),
    fnver: "0",
    fnval: "4048",
    fourk: "1",
  });
  if (context.epId) {
    params.set("ep_id", String(context.epId));
    return `https://api.bilibili.com/pgc/player/web/playurl?${params}`;
  }
  return `https://api.bilibili.com/x/player/playurl?${params}`;
}

export function legacyDanmakuUrl(cid) {
  return `https://comment.bilibili.com/${cid}.xml`;
}

export function danmakuSegmentUrl(cid, index) {
  return `https://api.bilibili.com/x/v2/dm/web/seg.so?type=1&oid=${cid}&segment_index=${index}`;
}

export function historyIndexUrl(cid, month) {
  return `https://api.bilibili.com/x/v2/dm/history/index?type=1&oid=${cid}&month=${month}`;
}

export function historySegmentUrl(cid, date) {
  return `https://api.bilibili.com/x/v2/dm/web/history/seg.so?type=1&oid=${cid}&date=${date}`;
}

function bestUrl(stream) {
  return stream?.baseUrl || stream?.base_url || stream?.url || stream?.backupUrl?.[0] || stream?.backup_url?.[0] || "";
}

function candidateUrls(stream) {
  const primary = stream?.baseUrl || stream?.base_url || stream?.url || "";
  const backups = stream?.backupUrl || stream?.backup_url || [];
  return [...new Set([primary, ...backups].filter(Boolean))];
}

function codecPreference(stream) {
  const codec = String(stream.codecs || "").toLowerCase();
  if (codec.startsWith("avc")) return 3;
  if (codec.startsWith("hev") || codec.startsWith("hvc")) return 2;
  if (codec.startsWith("av01")) return 1;
  return 0;
}

function qualityLabel(playData, qualityId) {
  const index = (playData.accept_quality || []).findIndex((value) => Number(value) === Number(qualityId));
  return playData.accept_description?.[index] || QUALITY_NAMES.get(Number(qualityId)) || `Q${qualityId}`;
}

export function selectMedia(playPayload, requestedQuality, baseName) {
  if (Number(playPayload?.code) !== 0) throw new Error(playPayload?.message || `播放接口错误 ${playPayload?.code}`);
  const data = playPayload.result || playPayload.data;
  if (!data) throw new Error("播放接口未返回数据");
  if (data.is_drm || data.drm_tech_type || data.drmTechType) throw new Error("该资源带有 DRM，扩展不会下载");

  if (Array.isArray(data.durl) && data.durl.length) {
    const label = qualityLabel(data, data.quality || requestedQuality);
    const suffix = data.durl.length > 1 ? "_part" : "";
    const items = data.durl.map((part, index) => {
      const urls = candidateUrls(part);
      return {
        kind: "url",
        url: urls[0] || "",
        urls,
        filename: `${baseName}_${label}${suffix}${suffix ? String(index + 1).padStart(2, "0") : ""}.mp4`,
      };
    }).filter((item) => item.url);
    return {
      type: "progressive",
      quality: data.quality || requestedQuality,
      label,
      items,
      media: {
        width: Number(data.dimension?.width || 0),
        height: Number(data.dimension?.height || 0),
        videoCodec: "h264",
        audioCodec: "aac",
        audioChannels: 2,
      },
    };
  }

  const videos = data.dash?.video || [];
  const audios = data.dash?.audio || [];
  if (!videos.length) throw new Error("没有可下载的非 DRM 视频流");
  const availableIds = [...new Set(videos.map((stream) => Number(stream.id)))].sort((a, b) => b - a);
  const selectedId = requestedQuality === 127
    ? availableIds[0]
    : availableIds.find((id) => id <= requestedQuality) || availableIds.at(-1);
  const video = videos
    .filter((stream) => Number(stream.id) === selectedId)
    .sort((a, b) => codecPreference(b) - codecPreference(a) || Number(b.bandwidth) - Number(a.bandwidth))[0];
  const audio = [...audios].sort((a, b) => Number(b.bandwidth) - Number(a.bandwidth))[0];
  const videoUrls = candidateUrls(video);
  const audioUrls = candidateUrls(audio);
  const videoUrl = videoUrls[0] || bestUrl(video);
  const audioUrl = audioUrls[0] || bestUrl(audio);
  if (!videoUrl) throw new Error("视频流地址为空");
  const label = qualityLabel(data, selectedId);
  const codec = String(video.codecs || "").split(".")[0] || "video";
  const items = [{ kind: "url", url: videoUrl, urls: videoUrls, filename: `${baseName}_${label}_${codec}_video.m4s` }];
  if (audioUrl) items.push({ kind: "url", url: audioUrl, urls: audioUrls, filename: `${baseName}_${label}_audio.m4s` });
  return {
    type: "dash",
    quality: selectedId,
    label,
    items,
    media: {
      width: Number(video.width || 0),
      height: Number(video.height || 0),
      videoCodec: codec.startsWith("avc") ? "h264" : codec,
      audioCodec: "aac",
      audioChannels: 2,
    },
  };
}

function monthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function addMonths(date, count) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + count, 1));
}

export function historyMonths(startDate, mode, now = new Date()) {
  if (mode === "current") return [];
  const start = new Date(`${startDate || "2010-01-01"}T00:00:00Z`);
  const first = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const all = [];
  for (let cursor = first; cursor <= end; cursor = addMonths(cursor, 1)) all.push(monthKey(cursor));
  if (mode === "monthly") return all;
  const selected = new Set(all.slice(0, 18));
  for (const month of all.slice(18)) {
    if (month.endsWith("-06") || month.endsWith("-12")) selected.add(month);
  }
  selected.add(all.at(-1));
  return [...selected].filter(Boolean);
}

export function mergeInstructions(baseName, mediaSelection) {
  if (mediaSelection.type !== "dash" || mediaSelection.items.length < 2) return "";
  const video = mediaSelection.items[0].filename.split("/").at(-1);
  const audio = mediaSelection.items[1].filename.split("/").at(-1);
  return [
    "该画质由 Bilibili 以 DASH 视频流和音频流分别提供。扩展按顺序下载，未绕过 DRM。",
    "使用 FFmpeg 无损封装：",
    "",
    `ffmpeg -i "${video}" -i "${audio}" -c copy "${baseName}_${mediaSelection.label}.mp4"`,
    "",
  ].join("\r\n");
}
