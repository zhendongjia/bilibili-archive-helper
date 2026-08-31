const decoder = new TextDecoder("utf-8");

function readVarint(bytes, state) {
  let value = 0n;
  let shift = 0n;
  while (state.offset < bytes.length) {
    const byte = bytes[state.offset++];
    value |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return value;
    shift += 7n;
  }
  throw new Error("protobuf varint 提前结束");
}

function readFields(bytes) {
  const fields = [];
  const state = { offset: 0 };
  while (state.offset < bytes.length) {
    const key = Number(readVarint(bytes, state));
    const field = key >>> 3;
    const wire = key & 7;
    if (wire === 0) {
      fields.push({ field, wire, value: readVarint(bytes, state) });
    } else if (wire === 1) {
      const value = bytes.subarray(state.offset, state.offset + 8);
      state.offset += 8;
      fields.push({ field, wire, value });
    } else if (wire === 2) {
      const length = Number(readVarint(bytes, state));
      const value = bytes.subarray(state.offset, state.offset + length);
      state.offset += length;
      fields.push({ field, wire, value });
    } else if (wire === 5) {
      const value = bytes.subarray(state.offset, state.offset + 4);
      state.offset += 4;
      fields.push({ field, wire, value });
    } else {
      throw new Error(`暂不支持 protobuf wire type ${wire}`);
    }
  }
  return fields;
}

function scalar(fields, field, fallback = 0n) {
  return fields.find((item) => item.field === field && item.wire === 0)?.value ?? fallback;
}

function text(fields, field) {
  const value = fields.find((item) => item.field === field && item.wire === 2)?.value;
  return value ? decoder.decode(value) : "";
}

function parseElement(bytes) {
  const fields = readFields(bytes);
  return {
    id: scalar(fields, 1).toString(),
    progress: Number(scalar(fields, 2)),
    mode: Number(scalar(fields, 3)),
    fontsize: Number(scalar(fields, 4)),
    color: Number(scalar(fields, 5)),
    midHash: text(fields, 6),
    content: text(fields, 7),
    ctime: scalar(fields, 8).toString(),
    pool: Number(scalar(fields, 11)),
  };
}

function decodeXml(value) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function parseProtobufDanmaku(bytes) {
  const comments = [];
  for (const field of readFields(bytes)) {
    if (field.field === 1 && field.wire === 2) comments.push(parseElement(field.value));
  }
  return comments;
}

export function parseLegacyXml(xml) {
  const comments = [];
  const expression = /<d\s+p="([^"]*)">([\s\S]*?)<\/d>/g;
  for (const match of xml.matchAll(expression)) {
    const parts = decodeXml(match[1]).split(",");
    if (parts.length < 8) continue;
    comments.push({
      progress: Math.round(Number(parts[0]) * 1000),
      mode: Number(parts[1]),
      fontsize: Number(parts[2]),
      color: Number(parts[3]),
      ctime: parts[4] || "0",
      pool: Number(parts[5]),
      midHash: parts[6] || "",
      id: parts[7] || "",
      content: decodeXml(match[2]),
    });
  }
  return comments;
}

export function mergeDanmaku(groups) {
  const unique = new Map();
  for (const group of groups) {
    for (const comment of group || []) {
      const key = comment.id || `${comment.progress}:${comment.midHash}:${comment.content}`;
      unique.set(key, comment);
    }
  }
  return [...unique.values()].sort((a, b) => a.progress - b.progress || String(a.id).localeCompare(String(b.id)));
}

export function toBilibiliXml(comments, cid) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<i>",
    "<chatserver>chat.bilibili.com</chatserver>",
    `<chatid>${escapeXml(cid)}</chatid>`,
    "<mission>0</mission>",
    `<maxlimit>${comments.length}</maxlimit>`,
    "<state>0</state>",
    "<real_name>0</real_name>",
    "<source>bilibili-archive-helper</source>",
  ];
  for (const item of comments) {
    const p = [
      (item.progress / 1000).toFixed(3).replace(/\.0+$/, ""),
      item.mode || 1,
      item.fontsize || 25,
      item.color ?? 0xffffff,
      item.ctime || 0,
      item.pool || 0,
      item.midHash || "",
      item.id || "",
    ].join(",");
    lines.push(`<d p="${escapeXml(p)}">${escapeXml(item.content)}</d>`);
  }
  lines.push("</i>", "");
  return lines.join("\n");
}

function escapeAss(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/{/g, "\\{").replace(/}/g, "\\}").replace(/\r?\n/g, "\\N");
}

function assTime(seconds) {
  const centiseconds = Math.max(0, Math.round(seconds * 100));
  const hours = Math.floor(centiseconds / 360000);
  const minutes = Math.floor((centiseconds % 360000) / 6000);
  const secs = Math.floor((centiseconds % 6000) / 100);
  const cs = centiseconds % 100;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function assColor(decimalColor) {
  const rgb = Math.max(0, Math.min(0xffffff, Number(decimalColor) || 0xffffff));
  const red = (rgb >> 16) & 0xff;
  const green = (rgb >> 8) & 0xff;
  const blue = rgb & 0xff;
  return `&H00${blue.toString(16).padStart(2, "0")}${green.toString(16).padStart(2, "0")}${red.toString(16).padStart(2, "0")}`.toUpperCase();
}

function outlineColor(decimalColor) {
  const rgb = Number(decimalColor) || 0xffffff;
  const red = (rgb >> 16) & 0xff;
  const green = (rgb >> 8) & 0xff;
  const blue = rgb & 0xff;
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue < 80 ? "&H00FFFFFF" : "&H00000000";
}

function estimatedTextWidth(value, fontSize) {
  let units = 0;
  for (const character of String(value)) units += character.codePointAt(0) <= 0x7f ? 0.56 : 1;
  return Math.max(fontSize, units * fontSize);
}

function chooseLane(availableAt, start, holdSeconds) {
  let lane = availableAt.findIndex((time) => time <= start);
  if (lane === -1) lane = availableAt.indexOf(Math.min(...availableAt));
  availableAt[lane] = start + holdSeconds;
  return lane;
}

export function toAss(comments, options = {}) {
  const width = options.width || 1280;
  const height = options.height || 720;
  const durationSeconds = options.durationSeconds || Number.POSITIVE_INFINITY;
  const title = options.title || "Bilibili Danmaku";
  const scrollLanes = Array(22).fill(0);
  const topLanes = Array(12).fill(0);
  const bottomLanes = Array(8).fill(0);
  const rowHeight = Math.max(24, Math.floor(height / 24));
  const speed = width / 7.1;
  const fixedDuration = 4.5;
  const dialogue = [];

  for (const comment of comments) {
    const start = Number(comment.progress) / 1000;
    if (!Number.isFinite(start) || start < 0 || start > durationSeconds + 5) continue;
    const content = escapeAss(comment.content);
    if (!content) continue;
    const size = Number(comment.fontsize) || 25;
    const common = `\\c${assColor(comment.color)}\\3c${outlineColor(comment.color)}\\fs${size}\\bord1\\shad0`;
    if (comment.mode === 4) {
      const lane = chooseLane(bottomLanes, start, fixedDuration + 0.15);
      const y = height - 12 - lane * rowHeight;
      dialogue.push(`Dialogue: 2,${assTime(start)},${assTime(start + fixedDuration)},Danmaku,,0,0,0,,{${common}\\an2\\pos(${width / 2},${y})}${content}`);
    } else if ([5, 7, 8].includes(comment.mode)) {
      const lane = chooseLane(topLanes, start, fixedDuration + 0.15);
      const y = 12 + lane * rowHeight;
      dialogue.push(`Dialogue: 2,${assTime(start)},${assTime(start + fixedDuration)},Danmaku,,0,0,0,,{${common}\\an8\\pos(${width / 2},${y})}${content}`);
    } else {
      const textWidth = estimatedTextWidth(comment.content, size);
      const movementDuration = (width + textWidth) / speed;
      const lane = chooseLane(scrollLanes, start, textWidth / speed + 0.28);
      const y = 12 + lane * rowHeight;
      const fromX = comment.mode === 6 ? -Math.ceil(textWidth) : width;
      const toX = comment.mode === 6 ? width : -Math.ceil(textWidth);
      dialogue.push(`Dialogue: 1,${assTime(start)},${assTime(start + movementDuration)},Danmaku,,0,0,0,,{${common}\\an7\\move(${fromX},${y},${toX},${y})}${content}`);
    }
  }

  return [
    "[Script Info]",
    "; Generated by Bilibili Archive Helper",
    `; Source comments: ${comments.length}`,
    `Title: ${title}`,
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "Collisions: Normal",
    "YCbCr Matrix: TV.709",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Danmaku,Microsoft YaHei,25,&H00FFFFFF,&H00FFFFFF,&H00000000,&H50000000,0,0,0,0,100,100,0,0,1,1,0,7,0,0,0,1",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...dialogue,
    "",
  ].join("\r\n");
}
