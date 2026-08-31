function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function tag(name, value, indent = 1, attributes = "") {
  if (value === undefined || value === null || value === "") return "";
  return `${"  ".repeat(indent)}<${name}${attributes}>${xmlEscape(value)}</${name}>`;
}

function normalizeTitle(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function dateFromUnix(seconds) {
  return Number(seconds) ? new Date(Number(seconds) * 1000).toISOString().slice(0, 10) : "";
}

function streamDetails(media, indent = 1) {
  const width = media.width || 0;
  const height = media.height || 0;
  const duration = Math.round(media.durationSeconds || 0);
  const aspect = width && height ? (width / height).toFixed(6) : "";
  const p = "  ".repeat(indent);
  const p1 = "  ".repeat(indent + 1);
  const p2 = "  ".repeat(indent + 2);
  const p3 = "  ".repeat(indent + 3);
  return [
    `${p}<fileinfo>`,
    `${p1}<streamdetails>`,
    `${p2}<video>`,
    tag("codec", media.videoCodec || "h264", indent + 3),
    tag("aspect", aspect, indent + 3),
    tag("width", width, indent + 3),
    tag("height", height, indent + 3),
    tag("durationinseconds", duration, indent + 3),
    `${p2}</video>`,
    `${p2}<audio>`,
    tag("codec", media.audioCodec || "aac", indent + 3),
    tag("language", "zho", indent + 3),
    tag("channels", media.audioChannels || 2, indent + 3),
    `${p2}</audio>`,
    `${p1}</streamdetails>`,
    `${p}</fileinfo>`,
  ].filter(Boolean);
}

export function sanitizeFilename(value, fallback = "bilibili-video") {
  const sanitized = normalizeTitle(value)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 120);
  return sanitized || fallback;
}

export function buildContext(page, videoPayload, seasonPayload) {
  const video = videoPayload?.data || null;
  const season = seasonPayload?.result || null;
  const episode = season?.episodes?.find((item) => Number(item.ep_id || item.id) === Number(page.epId))
    || season?.episodes?.find((item) => String(item.bvid) === String(video?.bvid))
    || null;
  const pageInfo = video?.pages?.find((item) => Number(item.cid) === Number(episode?.cid || page.cid))
    || video?.pages?.[0]
    || null;
  const aid = Number(episode?.aid || video?.aid || page.aid || 0);
  const cid = Number(episode?.cid || pageInfo?.cid || video?.cid || page.cid || 0);
  const bvid = episode?.bvid || video?.bvid || page.bvid || "";
  const epId = Number(episode?.ep_id || episode?.id || page.epId || 0);
  const title = episode?.show_title || episode?.title || pageInfo?.part || video?.title || page.title;
  const showTitle = normalizeTitle(season?.season_title || video?.title || page.title);
  const baseName = sanitizeFilename(`${showTitle}_${title}`);
  const durationSeconds = Number(episode?.duration ? episode.duration / 1000 : pageInfo?.duration || video?.duration || 0);
  return { page, video, season, episode, pageInfo, aid, cid, bvid, epId, title, showTitle, baseName, durationSeconds };
}

export function toVideoNfo(context, media = {}) {
  const { video, episode, pageInfo, bvid, aid, cid, title, showTitle, durationSeconds } = context;
  const premiered = dateFromUnix(video?.pubdate);
  const runtime = Math.round(durationSeconds / 60);
  const link = bvid ? `https://www.bilibili.com/video/${bvid}${pageInfo?.page > 1 ? `?p=${pageInfo.page}` : ""}` : context.page.url;
  const lines = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    "<movie>",
    tag("title", `${showTitle} - ${title}`),
    tag("originaltitle", video?.title || showTitle),
    tag("plot", video?.desc),
    tag("outline", title),
    tag("year", premiered.slice(0, 4)),
    tag("premiered", premiered),
    tag("aired", premiered),
    tag("runtime", runtime),
    tag("studio", video?.owner?.name),
    tag("country", "中国大陆"),
    tag("genre", "音乐"),
    tag("genre", "晚会"),
    tag("tag", "Bilibili"),
    tag("thumb", episode?.cover || video?.pic),
    tag("uniqueid", bvid, 1, ' type="bilibili_bvid" default="true"'),
    tag("uniqueid", aid, 1, ' type="bilibili_aid"'),
    tag("uniqueid", cid, 1, ' type="bilibili_cid"'),
    tag("website", link),
    ...streamDetails({ ...media, durationSeconds }),
    "</movie>",
  ].filter(Boolean);
  return `${lines.join("\r\n")}\r\n`;
}

export function toEpisodeNfo(context, media = {}) {
  const { video, season, episode, bvid, aid, cid, epId, title, showTitle, durationSeconds } = context;
  const actors = String(season?.actors || "").split("、").map((name) => name.trim()).filter(Boolean);
  const aired = String(season?.publish?.pub_time || dateFromUnix(video?.pubdate)).slice(0, 10);
  const year = aired.slice(0, 4);
  const episodeNumber = Math.max(1, (season?.episodes || []).findIndex((item) => Number(item.ep_id || item.id) === epId) + 1);
  const lines = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    "<episodedetails>",
    tag("title", title),
    tag("showtitle", showTitle),
    tag("season", year),
    tag("episode", episodeNumber),
    tag("plot", season?.evaluate || video?.desc),
    tag("outline", video?.desc),
    tag("year", year),
    tag("aired", aired),
    tag("premiered", aired),
    tag("runtime", Math.round(durationSeconds / 60)),
    tag("rating", season?.rating?.score),
    tag("votes", season?.rating?.count),
    tag("studio", video?.owner?.name),
    tag("country", season?.areas?.map((area) => area.name).join(" / ") || "中国大陆"),
    tag("genre", "音乐"),
    tag("genre", "晚会"),
    tag("genre", "演唱会"),
    tag("tag", "Bilibili"),
    tag("thumb", episode?.cover || video?.pic),
    tag("uniqueid", epId, 1, ' type="bilibili_ep" default="true"'),
    tag("uniqueid", season?.season_id, 1, ' type="bilibili_season"'),
    tag("uniqueid", bvid, 1, ' type="bilibili_bvid"'),
    tag("uniqueid", aid, 1, ' type="bilibili_aid"'),
    tag("uniqueid", cid, 1, ' type="bilibili_cid"'),
    tag("website", episode?.link || context.page.url),
  ].filter(Boolean);
  for (const name of actors) lines.push("  <actor>", tag("name", name, 2), "  </actor>");
  lines.push(...streamDetails({ ...media, durationSeconds }), "</episodedetails>");
  return `${lines.join("\r\n")}\r\n`;
}
