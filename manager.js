import { language, localizeDocument, t } from "./lib/i18n.js";

localizeDocument();

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
  const timestamp = new Date().toLocaleTimeString(language, { hour12: false });
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
  if (!parts.length) throw new Error(t("filenameEmpty"));
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
      log(t("connectingCdn", { host }));
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
        throw new Error(t("nonMedia", { type: contentType || t("nonMediaFallback") }));
      }
      if (!response.body) throw new Error(t("unreadableStream"));
      return response;
    } catch (error) {
      if (signal.aborted) throw error;
      errors.push(`${host}: ${error.message || error}`);
      log(t("nodeFailed", { host }));
    }
  }
  throw new Error(errors.join("; ") || t("noMediaUrl"));
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
      if (signal.aborted) throw new DOMException(t("stopped"), "AbortError");
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
  log(t("startingSerial", { count: job.items.length }));

  for (let index = 0; index < job.items.length; index += 1) {
    const item = job.items[index];
    const basePercent = index / job.items.length * 100;
    const itemWeight = 100 / job.items.length;
    progress(basePercent, `${index + 1}/${job.items.length} · ${item.filename}`);
    log(t("saving", { filename: item.filename }));
    if (item.kind === "text") {
      await writeTextFile(root, item);
    } else {
      const bytes = await writeMediaFile(root, item, abortController.signal, (written, total) => {
        const fraction = total > 0 ? written / total : 0;
        progress(basePercent + itemWeight * Math.min(1, fraction), `${index + 1}/${job.items.length} · ${formatBytes(written)}${total ? ` / ${formatBytes(total)}` : ""}`);
      });
      log(t("mediaComplete", { size: formatBytes(bytes) }));
    }
  }

  progress(100, t("allSaved"));
  log(t("allWritten"));
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
    if (message.type === "error") pending.reject(new Error(message.message || t("nativeFailed")));
    else if (message.type === "cancelled") pending.reject(new DOMException(t("folderCancelled"), "AbortError"));
    else pending.resolve(message);
  });
  nativePort.onDisconnect.addListener(() => {
    const error = chrome.runtime.lastError;
    const pending = nativePending;
    nativePending = null;
    nativePort = null;
    if (pending) pending.reject(new Error(error?.message || t("nativeDisconnected")));
  });
}

function nativeCommand(message) {
  if (!nativePort) throw new Error(t("nativeNotConnected"));
  if (nativePending) throw new Error(t("nativeOverlap"));
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
    log(t("selectedFolder", { path: selected.path }));
    log(t("chromeProxy"));

    for (let index = 0; index < job.items.length; index += 1) {
      const item = job.items[index];
      const basePercent = index / job.items.length * 90;
      const itemWeight = 90 / job.items.length;
      progress(basePercent, `${index + 1}/${job.items.length} · ${item.filename}`);
      log(t("saving", { filename: item.filename }));
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
          if (abortController.signal.aborted) throw new DOMException(t("stopped"), "AbortError");
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
      log(t("mediaComplete", { size: formatBytes(written) }));
    }

    progress(92, t("ffmpegMuxing"));
    log(t("muxStarting"));
    const completed = await nativeCommand({ action: "merge" });
    progress(100, t("muxComplete"));
    log(t("mp4Created", { filename: completed.outputFilename || job.merge.outputFilename }));
    return completed;
  } finally {
    nativePort?.disconnect();
    nativePort = null;
    nativePending = null;
  }
}

async function start() {
  try {
    if (!job) throw new Error(t("noJob"));
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
      progress(0, t("stopped"));
      log(t("taskStopped"));
    } else {
      progress(0, t("saveFailed"));
      log(t("error", { error: error.message || error }));
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
    elements.title.textContent = t("browserUnsupported");
    elements.meta.textContent = t("useModernBrowser");
    log(t("missingFsApi"));
    return;
  }
  const expectedId = new URLSearchParams(location.search).get("job");
  job = (await chrome.storage.local.get("pendingDownloadJob")).pendingDownloadJob || null;
  if (!job || job.id !== expectedId) {
    job = null;
    elements.title.textContent = t("jobExpired");
    elements.meta.textContent = t("reopenExtension");
    log(t("jobMismatch"));
    return;
  }
  elements.title.textContent = job.title;
  elements.meta.textContent = t("jobMeta", { quality: job.quality, count: job.items.length, result: job.merge ? t("finalThree") : "" });
  if (job.merge) {
    try {
      const status = await sendNativeMessage({ action: "ping" });
      if (!status?.ok) throw new Error(status?.message || t("nativeNotReady"));
      nativeAvailable = true;
      elements.start.textContent = t("selectSaveMerge");
      elements.meta.textContent += ` · FFmpeg ${status.ffmpegVersion || t("ready")}`;
      log(t("nativeReady", { path: status.ffmpegPath }));
    } catch (error) {
      nativeAvailable = false;
      elements.start.textContent = t("installOrRepair");
      log(t("nativeUnavailable", { error: error.message || error }));
      log(t("installGuide"));
    }
  }
  elements.start.disabled = Boolean(job.merge && !nativeAvailable);
  if (!job.merge) logLines = [];
  log(t("jobReady"));
})();
