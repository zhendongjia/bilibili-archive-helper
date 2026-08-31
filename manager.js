const elements = {
  title: document.querySelector("#job-title"),
  meta: document.querySelector("#job-meta"),
  start: document.querySelector("#start"),
  cancel: document.querySelector("#cancel"),
  progressLabel: document.querySelector("#progress-label"),
  progressPercent: document.querySelector("#progress-percent"),
  progressBar: document.querySelector("#progress-bar"),
  log: document.querySelector("#log"),
};

const NATIVE_HOST = "com.bilibili_archive_helper.native";
let job = null;
let abortController = null;
let nativePort = null;
let nativePending = null;
let nativeAvailable = false;
let logLines = [];

function log(message) {
  const timestamp = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  logLines.push(`[${timestamp}] ${message}`);
  logLines = logLines.slice(-120);
  elements.log.textContent = logLines.join("\n");
  elements.log.scrollTop = elements.log.scrollHeight;
}

function progress(percent, label) {
  const normalized = Math.max(0, Math.min(100, percent));
  elements.progressBar.style.width = `${normalized}%`;
  elements.progressPercent.textContent = `${Math.round(normalized)}%`;
  elements.progressLabel.textContent = label;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

function safePathParts(filename) {
  return String(filename || "")
    .replaceAll("\\", "/")
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part && part !== "." && part !== "..");
}

async function destination(root, filename) {
  const parts = safePathParts(filename);
  if (!parts.length) throw new Error("文件名为空");
  let directory = root;
  for (const part of parts.slice(0, -1)) {
    directory = await directory.getDirectoryHandle(part, { create: true });
  }
  return { directory, name: parts.at(-1) };
}

async function writeTextFile(root, item) {
  const target = await destination(root, item.filename);
  const handle = await target.directory.getFileHandle(target.name, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(item.content || "");
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => {});
    await target.directory.removeEntry(target.name).catch(() => {});
    throw error;
  }
}

function mediaUrls(item) {
  return [...new Set([...(Array.isArray(item.urls) ? item.urls : []), item.url].filter(Boolean))];
}

async function openMediaResponse(item, signal) {
  const errors = [];
  for (const url of mediaUrls(item)) {
    const host = new URL(url).host;
    try {
      log(`连接 CDN：${host}`);
      const response = await fetch(url, {
        credentials: "omit",
        cache: "no-store",
        headers: { Accept: "application/octet-stream,*/*" },
        signal,
      });
      const contentType = String(response.headers.get("content-type") || "").toLowerCase();
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (/text\/html|application\/(?:json|xml)/.test(contentType)) {
        await response.body?.cancel();
        throw new Error(`返回了 ${contentType || "非媒体内容"}`);
      }
      if (!response.body) throw new Error("响应没有可读取的数据流");
      return response;
    } catch (error) {
      if (signal.aborted) throw error;
      errors.push(`${host}: ${error.message || error}`);
      log(`节点失败，尝试备用地址：${host}`);
    }
  }
  throw new Error(errors.join("；") || "没有可用的媒体地址");
}

async function writeMediaFile(root, item, signal, onChunk) {
  const response = await openMediaResponse(item, signal);
  const total = Number(response.headers.get("content-length") || 0);
  const target = await destination(root, item.filename);
  const handle = await target.directory.getFileHandle(target.name, { create: true });
  const writable = await handle.createWritable();
  const reader = response.body.getReader();
  let written = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (signal.aborted) throw new DOMException("已停止", "AbortError");
      await writable.write(value);
      written += value.byteLength;
      onChunk(written, total);
    }
    await writable.close();
  } catch (error) {
    await reader.cancel().catch(() => {});
    await writable.abort().catch(() => {});
    await target.directory.removeEntry(target.name).catch(() => {});
    throw error;
  }
  return written;
}

async function runJob(root) {
  abortController = new AbortController();
  elements.start.disabled = true;
  elements.cancel.disabled = false;
  logLines = [];
  log(`开始串行保存 ${job.items.length} 个文件`);

  for (let index = 0; index < job.items.length; index += 1) {
    const item = job.items[index];
    const basePercent = index / job.items.length * 100;
    const itemWeight = 100 / job.items.length;
    progress(basePercent, `${index + 1}/${job.items.length} · ${item.filename}`);
    log(`保存：${item.filename}`);
    if (item.kind === "text") {
      await writeTextFile(root, item);
    } else {
      const bytes = await writeMediaFile(root, item, abortController.signal, (written, total) => {
        const fraction = total > 0 ? written / total : 0;
        progress(basePercent + itemWeight * Math.min(1, fraction), `${index + 1}/${job.items.length} · ${formatBytes(written)}${total ? ` / ${formatBytes(total)}` : ""}`);
      });
      log(`媒体完成：${formatBytes(bytes)}`);
    }
  }

  progress(100, "全部保存完成");
  log("全部文件已成功写入所选目录。");
  elements.cancel.disabled = true;
  await chrome.storage.local.remove("pendingDownloadJob");
}

function sendNativeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage(NATIVE_HOST, message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(response);
    });
  });
}

function bytesToBase64(bytes) {
  let raw = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    raw += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(raw);
}

function connectNativeSession() {
  nativePort = chrome.runtime.connectNative(NATIVE_HOST);
  nativePort.onMessage.addListener((message) => {
    if (!nativePending || !message || typeof message !== "object") return;
    const pending = nativePending;
    nativePending = null;
    if (message.type === "error") pending.reject(new Error(message.message || "本地助手执行失败"));
    else if (message.type === "cancelled") pending.reject(new DOMException("已取消目录选择", "AbortError"));
    else pending.resolve(message);
  });
  nativePort.onDisconnect.addListener(() => {
    const error = chrome.runtime.lastError;
    const pending = nativePending;
    nativePending = null;
    nativePort = null;
    if (pending) pending.reject(new Error(error?.message || "本地助手连接已断开"));
  });
}

function nativeCommand(message) {
  if (!nativePort) throw new Error("本地助手尚未连接");
  if (nativePending) throw new Error("本地助手命令发生重叠");
  return new Promise((resolve, reject) => {
    nativePending = { resolve, reject };
    nativePort.postMessage(message);
  });
}

async function runNativeJob() {
  abortController = new AbortController();
  connectNativeSession();
  try {
    const selected = await nativeCommand({ action: "startJob", merge: job.merge });
    log(`保存目录：${selected.path}`);
    log("媒体请求由 Chrome 发起，将遵循 Chrome/SwitchyOmega 的当前代理规则。");

    for (let index = 0; index < job.items.length; index += 1) {
      const item = job.items[index];
      const basePercent = index / job.items.length * 90;
      const itemWeight = 90 / job.items.length;
      progress(basePercent, `${index + 1}/${job.items.length} · ${item.filename}`);
      log(`保存：${item.filename}`);
      if (item.kind === "text") {
        await nativeCommand({ action: "writeText", filename: item.filename, content: item.content || "" });
        continue;
      }

      const response = await openMediaResponse(item, abortController.signal);
      const total = Number(response.headers.get("content-length") || 0);
      const reader = response.body.getReader();
      let written = 0;
      await nativeCommand({ action: "startFile", filename: item.filename });
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (abortController.signal.aborted) throw new DOMException("已停止", "AbortError");
          await nativeCommand({ action: "writeChunk", data: bytesToBase64(value) });
          written += value.byteLength;
          const fraction = total > 0 ? written / total : 0;
          progress(basePercent + itemWeight * Math.min(1, fraction), `${index + 1}/${job.items.length} · ${formatBytes(written)}${total ? ` / ${formatBytes(total)}` : ""}`);
        }
        await nativeCommand({ action: "finishFile" });
      } catch (error) {
        await reader.cancel().catch(() => {});
        await nativeCommand({ action: "abortFile" }).catch(() => {});
        throw error;
      }
      log(`媒体完成：${formatBytes(written)}`);
    }

    progress(92, "FFmpeg 无损封装");
    log("开始自动合并并校验音视频流……");
    const completed = await nativeCommand({ action: "merge" });
    progress(100, "保存及合并完成");
    log(`MP4 已生成：${completed.outputFilename || job.merge.outputFilename}`);
    return completed;
  } finally {
    nativePort?.disconnect();
    nativePort = null;
    nativePending = null;
  }
}

async function start() {
  try {
    if (!job) throw new Error("没有可执行的保存任务");
    if (job.merge && nativeAvailable) {
      await runNativeJob();
      await chrome.storage.local.remove("pendingDownloadJob");
      elements.cancel.disabled = true;
    } else {
      const root = await window.showDirectoryPicker({ mode: "readwrite", id: "bilibili-archive-helper" });
      await runJob(root);
    }
  } catch (error) {
    if (error?.name === "AbortError") {
      progress(0, "已停止");
      log("任务已停止，未完成的 .part 临时文件已清理；已完整写入的中间流会保留以避免数据丢失。");
    } else {
      progress(0, "保存失败");
      log(`错误：${error.message || error}`);
    }
    elements.start.disabled = !job;
    elements.cancel.disabled = true;
  } finally {
    abortController = null;
    nativePort = null;
  }
}

elements.start.addEventListener("click", start);
elements.cancel.addEventListener("click", () => {
  abortController?.abort();
  nativePort?.disconnect();
});

(async () => {
  if (typeof window.showDirectoryPicker !== "function") {
    elements.title.textContent = "当前浏览器不支持一次性目录保存";
    elements.meta.textContent = "请使用较新的 Chrome 或 Edge。";
    log("缺少 File System Access API。请升级浏览器后重试。");
    return;
  }
  const expectedId = new URLSearchParams(location.search).get("job");
  job = (await chrome.storage.local.get("pendingDownloadJob")).pendingDownloadJob || null;
  if (!job || job.id !== expectedId) {
    job = null;
    elements.title.textContent = "保存任务不存在或已过期";
    elements.meta.textContent = "请回到 Bilibili 页面，重新点击扩展并准备文件。";
    log("没有找到与当前页面匹配的任务。");
    return;
  }
  elements.title.textContent = job.title;
  elements.meta.textContent = `${job.quality} · ${job.items.length} 个写入步骤${job.merge ? " · 成功后保留 MP4 + ASS + NFO" : ""} · 所有网络请求串行执行`;
  if (job.merge) {
    try {
      const status = await sendNativeMessage({ action: "ping" });
      if (!status?.ok) throw new Error(status?.message || "本地助手未就绪");
      nativeAvailable = true;
      elements.start.textContent = "选择目录、保存并自动合并 MP4";
      elements.meta.textContent += ` · FFmpeg ${status.ffmpegVersion || "已就绪"}`;
      log(`本地合并助手已就绪：${status.ffmpegPath}`);
    } catch (error) {
      nativeAvailable = false;
      elements.start.textContent = "需要安装或修复本地合并助手";
      log(`未连接本地合并助手：${error.message || error}`);
      log("请运行 native-host 目录内与当前系统对应的安装脚本；脚本会检测 FFmpeg 并提供安装指导。");
    }
  }
  elements.start.disabled = Boolean(job.merge && !nativeAvailable);
  if (!job.merge) logLines = [];
  log("任务已就绪，请选择一次保存目录。媒体链接有时效，建议立即开始。");
})();
