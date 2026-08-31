const QUEUE_KEY = "downloadQueue";

function utf8DataUrl(text, mime = "text/plain;charset=utf-8") {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

async function getQueue() {
  return (await chrome.storage.local.get(QUEUE_KEY))[QUEUE_KEY] || null;
}

async function setQueue(queue) {
  await chrome.storage.local.set({ [QUEUE_KEY]: queue });
}

function publicQueue(queue) {
  if (!queue) return null;
  return {
    status: queue.status,
    total: queue.total,
    completed: queue.completed,
    failed: queue.failed,
    currentFilename: queue.currentFilename || "",
    error: queue.error || "",
    startedAt: queue.startedAt,
    finishedAt: queue.finishedAt || null,
  };
}

async function startNext() {
  const queue = await getQueue();
  if (!queue || queue.status !== "running" || queue.currentDownloadId) return;

  if (queue.index >= queue.items.length) {
    queue.status = queue.failed ? "completed_with_errors" : "completed";
    queue.finishedAt = Date.now();
    queue.currentFilename = "";
    queue.items = [];
    await setQueue(queue);
    return;
  }

  const item = queue.items[queue.index];
  const url = item.kind === "text" ? utf8DataUrl(item.content, item.mime) : item.url;
  try {
    const downloadId = await chrome.downloads.download({
      url,
      filename: item.filename,
      conflictAction: "uniquify",
      saveAs: false,
    });
    queue.currentDownloadId = downloadId;
    queue.currentFilename = item.filename;
    queue.error = "";
    await setQueue(queue);

    const [current] = await chrome.downloads.search({ id: downloadId });
    if (current?.state === "complete") await finishCurrent(downloadId, true);
    if (current?.state === "interrupted") await finishCurrent(downloadId, false, current.error || "下载中断");
  } catch (error) {
    queue.failed += 1;
    queue.index += 1;
    queue.error = `${item.filename}: ${error.message || error}`;
    queue.currentDownloadId = null;
    queue.currentFilename = "";
    await setQueue(queue);
    await startNext();
  }
}

async function finishCurrent(downloadId, succeeded, error = "") {
  const queue = await getQueue();
  if (!queue || queue.currentDownloadId !== downloadId) return;
  if (succeeded) queue.completed += 1;
  else queue.failed += 1;
  queue.index += 1;
  queue.currentDownloadId = null;
  queue.currentFilename = "";
  queue.error = error || queue.error;
  await setQueue(queue);
  await startNext();
}

chrome.downloads.onChanged.addListener((delta) => {
  if (delta.state?.current === "complete") {
    finishCurrent(delta.id, true).catch(console.error);
  } else if (delta.state?.current === "interrupted") {
    finishCurrent(delta.id, false, delta.error?.current || "下载中断").catch(console.error);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "ENQUEUE_DOWNLOADS") {
    (async () => {
      const existing = await getQueue();
      if (existing?.status === "running") throw new Error("已有下载队列正在运行");
      if (!Array.isArray(message.items) || message.items.length === 0) throw new Error("下载队列为空");
      const queue = {
        status: "running",
        items: message.items,
        index: 0,
        total: message.items.length,
        completed: 0,
        failed: 0,
        currentDownloadId: null,
        currentFilename: "",
        error: "",
        startedAt: Date.now(),
      };
      await setQueue(queue);
      await startNext();
      return publicQueue(await getQueue());
    })().then((result) => sendResponse({ ok: true, queue: result }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  if (message?.type === "GET_QUEUE") {
    getQueue().then((queue) => sendResponse({ ok: true, queue: publicQueue(queue) }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  return false;
});

chrome.runtime.onStartup.addListener(() => startNext().catch(console.error));
chrome.runtime.onInstalled.addListener(() => startNext().catch(console.error));
