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

function meaningfulText(value) {
  const normalized = normalizeTitle(value);
  return normalized && !/^[\s。．.，,、；;：:！!？?…—_-]+$/.test(normalized) ? normalized : "";
}

function dateFromUnix(seconds) {
  return Number(seconds) ? new Date((Number(seconds) + 8 * 3600) * 1000).toISOString().slice(0, 10) : "";
}

function chinaDateTimeFromUnix(seconds) {
  if (!Number(seconds)) return "";
  const local = new Date((Number(seconds) + 8 * 3600) * 1000).toISOString().slice(0, 19).replace("T", " ");
  return `${local} +08:00`;
}

function durationText(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total % 3600 / 60);
  const secs = total % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function uniqueValues(values) {
  return [...new Set(values.map((value) => normalizeTitle(value)).filter(Boolean))];
}

function pad2(value) {
  return String(Math.max(0, Number(value) || 0)).padStart(2, "0");
}

function streamDetails(media, indent = 1) {
  const width = Number(media.width || 0);
  const height = Number(media.height || 0);
  const duration = Math.round(media.durationSeconds || 0);
  const aspect = width && height ? (width / height).toFixed(6) : "";
  const p = "  ".repeat(indent);
  const p1 = "  ".repeat(indent + 1);
  const p2 = "  ".repeat(indent + 2);
  return [
    `${p}<fileinfo>`,
    `${p1}<streamdetails>`,
    `${p2}<video>`,
    tag("codec", media.videoCodec || "h264", indent + 3),
    tag("aspect", aspect, indent + 3),
    tag("width", width, indent + 3),
    tag("height", height, indent + 3),
    tag("durationinseconds", duration, indent + 3),
    tag("bitrate", media.videoBandwidth || "", indent + 3),
    tag("fps", media.frameRate, indent + 3),
    tag("scantype", "Progressive", indent + 3),
    `${p2}</video>`,
    `${p2}<audio>`,
    tag("codec", media.audioCodec || "aac", indent + 3),
    tag("language", "zho", indent + 3),
    tag("channels", media.audioChannels || 2, indent + 3),
    tag("bitrate", media.audioBandwidth || "", indent + 3),
    `${p2}</audio>`,
    `${p1}</streamdetails>`,
    `${p}</fileinfo>`,
  ].filter(Boolean);
}

function relationFor(context) {
  const { video, season, episode, pageInfo, bvid, cid, epId, title, showTitle } = context;
  if (season) {
    const index = Math.max(0, (season.episodes || []).findIndex((item) => Number(item.ep_id || item.id) === Number(epId)));
    return {
      type: "pgc",
      groupId: season.season_id || season.media_id || "",
      itemId: epId || cid,
      tabIndex: index,
      overallPosition: index + 1,
      itemNumber: index + 1,
      pageCount: (season.episodes || []).length,
      groupTitle: showTitle,
      tabName: title,
      isCollection: true,
      cover: episode?.cover || video?.pic || season.cover,
      groupCover: season.cover || video?.pic,
    };
  }
  const itemNumber = Math.max(1, Number(pageInfo?.page || 1));
  const pageCount = Math.max(1, Number(video?.videos || video?.pages?.length || 1));
  return {
    type: "ugc",
    groupId: bvid,
    itemId: cid,
    tabIndex: itemNumber - 1,
    overallPosition: itemNumber,
    itemNumber,
    pageCount,
    groupTitle: showTitle,
    tabName: title,
    isCollection: pageCount > 1 || normalizeTitle(title) !== normalizeTitle(showTitle),
    cover: video?.pic,
    groupCover: video?.pic,
  };
}

function statsPlot(context, media, relation) {
  const { video, season, aid, bvid, cid, epId, durationSeconds, title } = context;
  const stat = video?.stat || {};
  const description = meaningfulText(season?.evaluate || video?.desc);
  const details = [];
  if (relation.isCollection) details.push(`所属合集：${relation.groupTitle}`);
  if (relation.tabName) details.push(`${relation.type === "pgc" ? "剧集" : "分P"}：${pad2(relation.itemNumber)}/${relation.pageCount || 1} ${relation.tabName}`);
  if (video?.owner?.name) details.push(`UP主：${video.owner.name}`);
  const published = chinaDateTimeFromUnix(video?.pubdate);
  if (published) details.push(`发布日期：${published}`);
  if (durationSeconds) details.push(`时长：${durationText(durationSeconds)}`);
  if (stat.view !== undefined) details.push(`播放量：${stat.view}`);
  if (stat.danmaku !== undefined) details.push(`页面弹幕计数：${stat.danmaku}`);
  if (stat.reply !== undefined) details.push(`评论数：${stat.reply}`);
  if (stat.favorite !== undefined) details.push(`收藏数：${stat.favorite}`);
  if (stat.coin !== undefined) details.push(`投币数：${stat.coin}`);
  if (stat.share !== undefined) details.push(`分享数：${stat.share}`);
  if (stat.like !== undefined) details.push(`点赞数：${stat.like}`);
  if (bvid) details.push(`BVID：${bvid}`);
  if (aid) details.push(`AID：${aid}`);
  if (cid) details.push(`CID：${cid}`);
  if (epId) details.push(`EPID：${epId}`);
  if (relation.itemId) details.push(`Item ID：${relation.itemId}`);
  if (media.qualityCode) details.push(`Bilibili 画质：${media.qualityLabel || ""}（${media.qualityCode}）`);
  if (media.videoCodecid) details.push(`Bilibili 编码代码：${media.videoCodecid}`);
  if (description) details.push("", "简介：", description);
  return details.join("\n") || title;
}

function actorBlock(owner, indent = 1, role = "UP主") {
  if (!owner?.name) return [];
  const p = "  ".repeat(indent);
  return [
    `${p}<actor>`,
    tag("name", owner.name, indent + 1),
    tag("role", role, indent + 1),
    tag("thumb", owner.face, indent + 1),
    tag("profile", owner.mid ? `https://space.bilibili.com/${owner.mid}` : "", indent + 1),
    tag("order", 0, indent + 1),
    `${p}</actor>`,
  ].filter(Boolean);
}

function fanartBlock(url, indent = 1) {
  if (!url) return [];
  const p = "  ".repeat(indent);
  return [`${p}<fanart>`, tag("thumb", url, indent + 1), `${p}</fanart>`];
}

function setBlock(context, relation, indent = 1) {
  if (!relation.isCollection || !relation.groupTitle) return [];
  const p = "  ".repeat(indent);
  return [
    `${p}<set>`,
    tag("name", relation.groupTitle, indent + 1),
    tag("overview", meaningfulText(context.season?.evaluate || context.video?.desc), indent + 1),
    `${p}</set>`,
  ].filter(Boolean);
}

function bilibiliBlock(context, media, relation, indent = 1) {
  const { video, season, episode, pageInfo, bvid, aid, cid, epId, tags } = context;
  const stat = video?.stat || {};
  const rights = video?.rights || {};
  const p = "  ".repeat(indent);
  const p1 = "  ".repeat(indent + 1);
  const lines = [
    `${p}<bilibili>`,
    tag("type", relation.type, indent + 1),
    tag("groupid", relation.groupId, indent + 1),
    tag("itemid", relation.itemId, indent + 1),
    tag("tabindex", relation.tabIndex, indent + 1),
    tag("overallposition", relation.overallPosition, indent + 1),
    tag("pagecount", relation.pageCount, indent + 1),
    tag("bvid", bvid, indent + 1),
    tag("aid", aid, indent + 1),
    tag("cid", cid, indent + 1),
    tag("epid", epId, indent + 1),
    tag("seasonid", season?.season_id, indent + 1),
    tag("mediaid", season?.media_id, indent + 1),
    tag("uid", video?.owner?.mid, indent + 1),
    tag("uname", video?.owner?.name, indent + 1),
    tag("avatar", video?.owner?.face, indent + 1),
    tag("cover", relation.cover, indent + 1),
    tag("groupcover", relation.groupCover, indent + 1),
    tag("firstframe", pageInfo?.first_frame, indent + 1),
    tag("qualitycode", media.qualityCode, indent + 1),
    tag("qualitylabel", media.qualityLabel, indent + 1),
    tag("format", media.format, indent + 1),
    tag("codecid", media.videoCodecid, indent + 1),
    tag("videocodec", media.videoCodec, indent + 1),
    tag("videowidth", media.width || video?.dimension?.width || pageInfo?.dimension?.width, indent + 1),
    tag("videoheight", media.height || video?.dimension?.height || pageInfo?.dimension?.height, indent + 1),
    tag("videobandwidth", media.videoBandwidth, indent + 1),
    tag("framerate", media.frameRate, indent + 1),
    tag("audiocodec", media.audioCodec, indent + 1),
    tag("audioid", media.audioId, indent + 1),
    tag("audiobandwidth", media.audioBandwidth, indent + 1),
    tag("audiochannels", media.audioChannels, indent + 1),
    tag("durationseconds", context.durationSeconds, indent + 1),
    tag("pagefrom", pageInfo?.from, indent + 1),
    tag("pagevid", pageInfo?.vid, indent + 1),
    tag("pageweblink", pageInfo?.weblink, indent + 1),
    tag("rotation", pageInfo?.dimension?.rotate ?? video?.dimension?.rotate, indent + 1),
    tag("viewcount", stat.view, indent + 1),
    tag("danmakucount", stat.danmaku, indent + 1),
    tag("replycount", stat.reply, indent + 1),
    tag("favoritecount", stat.favorite, indent + 1),
    tag("coincount", stat.coin, indent + 1),
    tag("sharecount", stat.share, indent + 1),
    tag("likecount", stat.like, indent + 1),
    tag("tid", video?.tid, indent + 1),
    tag("tidv2", video?.tid_v2, indent + 1),
    tag("tname", video?.tname || video?.tname_v2, indent + 1),
    tag("copyright", video?.copyright, indent + 1),
    tag("state", video?.state, indent + 1),
    tag("videopages", video?.videos, indent + 1),
    tag("premiere", video?.premiere, indent + 1),
    tag("teenagemode", video?.teenage_mode, indent + 1),
    tag("chargeableseason", video?.is_chargeable_season, indent + 1),
    tag("story", video?.is_story, indent + 1),
    tag("upowerexclusive", video?.is_upower_exclusive, indent + 1),
    tag("upowerplay", video?.is_upower_play, indent + 1),
    tag("upowerpreview", video?.is_upower_preview, indent + 1),
    tag("enablevt", video?.enable_vt, indent + 1),
    tag("nocache", video?.no_cache, indent + 1),
    tag("dynamic", meaningfulText(video?.dynamic), indent + 1),
    tag("pubdate", video?.pubdate, indent + 1),
    tag("ctime", video?.ctime, indent + 1),
    tag("pagetime", pageInfo?.ctime, indent + 1),
  ].filter(Boolean);
  if (Object.keys(stat).length) {
    lines.push(`${p1}<statistics>`);
    for (const [name, value] of Object.entries(stat)) lines.push(tag(name, value, indent + 2));
    lines.push(`${p1}</statistics>`);
  }
  if (Object.keys(rights).length) {
    lines.push(`${p1}<rights>`);
    for (const [name, value] of Object.entries(rights)) lines.push(tag(name, value, indent + 2));
    lines.push(`${p1}</rights>`);
  }
  if (tags?.length) {
    lines.push(`${p1}<tags>`);
    for (const item of tags) {
      const id = Number(item.id || 0);
      lines.push(tag("tag", item.name, indent + 2, id ? ` id="${id}"` : ""));
    }
    lines.push(`${p1}</tags>`);
  }
  if (episode?.badge) lines.push(tag("badge", episode.badge, indent + 1));
  lines.push(`${p}</bilibili>`);
  return lines;
}

function commonVideoValues(context, media) {
  const { video, pageInfo, bvid, title, showTitle, durationSeconds } = context;
  const relation = relationFor(context);
  const premiered = dateFromUnix(video?.pubdate);
  const displayTitle = relation.isCollection ? `${showTitle} - ${pad2(relation.itemNumber)} - ${title}` : (title || showTitle);
  const sortTitle = [premiered.replaceAll("-", ""), relation.isCollection ? pad2(relation.itemNumber) : "", title || showTitle].filter(Boolean).join(" - ");
  const link = bvid ? `https://www.bilibili.com/video/${bvid}${pageInfo?.page > 1 ? `?p=${pageInfo.page}` : ""}` : context.page.url;
  const categories = uniqueValues([video?.tname, video?.tname_v2]);
  const tagNames = context.tags?.map((item) => item.name) || [];
  return {
    relation,
    premiered,
    displayTitle,
    sortTitle,
    link,
    runtime: Math.ceil(durationSeconds / 60),
    plot: statsPlot(context, media, relation),
    outline: meaningfulText(video?.desc) || title,
    genres: uniqueValues(["网络视频", "Bilibili", ...categories]),
    tags: uniqueValues(["Bilibili", relation.type, relation.isCollection ? showTitle : "", title, ...categories, ...tagNames]),
  };
}

export function sanitizeFilename(value, fallback = "bilibili-video") {
  const sanitized = normalizeTitle(value)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 120);
  return sanitized || fallback;
}

export function buildContext(page, videoPayload, seasonPayload, tagsPayload = null) {
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
  const title = normalizeTitle(episode?.show_title || episode?.title || pageInfo?.part || video?.title || page.title);
  const showTitle = normalizeTitle(season?.season_title || video?.title || page.title);
  const identity = bvid || (aid ? `av${aid}` : `cid${cid}`);
  const sequence = epId ? `_EP${epId}` : pageInfo?.page ? `_P${pad2(pageInfo.page)}` : "";
  const baseName = sanitizeFilename(`Bilibili_${identity}${sequence}`);
  const durationSeconds = Number(episode?.duration ? episode.duration / 1000 : pageInfo?.duration || video?.duration || 0);
  const tags = (Array.isArray(tagsPayload?.data) ? tagsPayload.data : []).map((item) => ({
    id: Number(item.tag_id || item.id || 0),
    name: normalizeTitle(item.tag_name || item.name),
  })).filter((item) => item.name);
  return { page, video, season, episode, pageInfo, aid, cid, bvid, epId, title, showTitle, baseName, durationSeconds, tags };
}

export function toVideoNfo(context, media = {}) {
  const { video, bvid, aid, cid, title, showTitle, durationSeconds } = context;
  const common = commonVideoValues(context, media);
  const owner = video?.owner || null;
  const lines = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    "<movie>",
    tag("title", common.displayTitle),
    tag("originaltitle", showTitle),
    tag("sorttitle", common.sortTitle),
    tag("plot", common.plot),
    tag("outline", common.outline),
    tag("tagline", common.relation.isCollection ? `${showTitle} / ${title}` : title),
    tag("year", common.premiered.slice(0, 4)),
    tag("premiered", common.premiered),
    tag("releasedate", common.premiered),
    tag("aired", common.premiered),
    tag("runtime", common.runtime),
    tag("studio", owner?.name),
    tag("country", "中国大陆"),
  ].filter(Boolean);
  for (const value of common.genres) lines.push(tag("genre", value));
  for (const value of common.tags) lines.push(tag("tag", value));
  lines.push(
    ...setBlock(context, common.relation),
    tag("thumb", common.relation.cover || video?.pic),
    ...fanartBlock(common.relation.groupCover || video?.pic),
    tag("uniqueid", bvid, 1, ' type="bilibili" default="true"'),
    tag("uniqueid", aid, 1, ' type="bilibili-aid"'),
    tag("uniqueid", cid, 1, ' type="bilibili-cid"'),
    tag("uniqueid", common.relation.itemId, 1, ' type="bilibili-item"'),
    tag("website", common.link),
    ...actorBlock(owner),
    ...bilibiliBlock(context, media, common.relation),
    ...streamDetails({ ...media, durationSeconds }),
    "</movie>",
  );
  return `${lines.filter(Boolean).join("\r\n")}\r\n`;
}

export function toEpisodeNfo(context, media = {}) {
  const { video, season, episode, bvid, aid, cid, epId, title, showTitle, durationSeconds } = context;
  const relation = relationFor(context);
  const actorNames = String(season?.actors || "").split("、").map((name) => name.trim()).filter(Boolean);
  const aired = String(season?.publish?.pub_time || dateFromUnix(video?.pubdate)).slice(0, 10);
  const year = aired.slice(0, 4);
  const plot = statsPlot(context, media, relation);
  const genres = uniqueValues([...(season?.styles || []).map((style) => style.name || style), "Bilibili", "网络视频"]);
  const lines = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    "<episodedetails>",
    tag("title", title),
    tag("showtitle", showTitle),
    tag("sorttitle", `${aired.replaceAll("-", "")} - ${pad2(relation.itemNumber)} - ${title}`),
    tag("season", year),
    tag("episode", relation.itemNumber),
    tag("plot", plot),
    tag("outline", meaningfulText(season?.evaluate || video?.desc) || title),
    tag("tagline", `${showTitle} / ${title}`),
    tag("year", year),
    tag("aired", aired),
    tag("premiered", aired),
    tag("releasedate", aired),
    tag("runtime", Math.ceil(durationSeconds / 60)),
    tag("rating", season?.rating?.score),
    tag("votes", season?.rating?.count),
    tag("studio", video?.owner?.name),
    tag("country", season?.areas?.map((area) => area.name).join(" / ") || "中国大陆"),
  ].filter(Boolean);
  for (const value of genres) lines.push(tag("genre", value));
  for (const value of uniqueValues(["Bilibili", "pgc", showTitle, title, ...(context.tags || []).map((item) => item.name)])) lines.push(tag("tag", value));
  lines.push(
    tag("thumb", relation.cover),
    ...fanartBlock(relation.groupCover),
    tag("uniqueid", epId, 1, ' type="bilibili-ep" default="true"'),
    tag("uniqueid", season?.season_id, 1, ' type="bilibili-season"'),
    tag("uniqueid", bvid, 1, ' type="bilibili"'),
    tag("uniqueid", aid, 1, ' type="bilibili-aid"'),
    tag("uniqueid", cid, 1, ' type="bilibili-cid"'),
    tag("uniqueid", relation.itemId, 1, ' type="bilibili-item"'),
    tag("website", episode?.link || context.page.url),
  );
  for (const name of actorNames) lines.push("  <actor>", tag("name", name, 2), "  </actor>");
  if (video?.owner?.name && !actorNames.includes(video.owner.name)) lines.push(...actorBlock(video.owner));
  lines.push(...bilibiliBlock(context, media, relation), ...streamDetails({ ...media, durationSeconds }), "</episodedetails>");
  return `${lines.filter(Boolean).join("\r\n")}\r\n`;
}
