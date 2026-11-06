const film = document.getElementById("film");
const filmCtx = film.getContext("2d", { alpha: true });
const wash = document.getElementById("film-wash");
const washCtx = wash.getContext("2d", { alpha: false });
const screen = document.getElementById("screen");
const scroller = document.getElementById("scroller");
const story = document.getElementById("story");
const vendors = document.getElementById("vendors");
const contact = document.getElementById("contact");
const tabletForm = document.getElementById("contact-form");
const connectCta = document.getElementById("connect-cta");
const chapters = [...document.querySelectorAll(".chapter")];
const progressBar = document.getElementById("progress-bar");
const nav = document.getElementById("nav");
const wa = document.querySelector(".wa");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let pictureWidth = 0;
let pictureHeight = 0;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function viewWidth() {
  return scroller.clientWidth;
}

function viewHeight() {
  return scroller.clientHeight;
}

function contentTop(element) {
  let top = 0;
  let node = element;
  while (node && node !== scroller) {
    top += node.offsetTop;
    node = node.offsetParent;
  }
  return top;
}

function viewTop(element) {
  if (landscapeTurned()) return contentTop(element) - scroller.scrollTop;
  return element.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
}

function storyProgress() {
  const total = story.offsetHeight - viewHeight();
  if (total <= 0) return 0;
  return clamp(-viewTop(story) / total, 0, 1);
}

function filmProgress() {
  const contactTop = viewTop(contact) + scroller.scrollTop;
  if (contactTop <= 0) return 1;
  return clamp(scroller.scrollTop / contactTop, 0, 1);
}

function frameScale(boxW, boxH, imageW, imageH) {
  return Math.max(boxW / imageW, boxH / imageH);
}

let forceLandscape = false;

function viewportSize() {
  const viewport = window.visualViewport;
  return {
    width: Math.round(viewport ? viewport.width : window.innerWidth),
    height: Math.round(viewport ? viewport.height : window.innerHeight),
  };
}

function landscapeTurned() {
  const view = viewportSize();
  return forceLandscape && view.height > view.width;
}

function layoutBox(element) {
  if (!landscapeTurned()) return element.getBoundingClientRect();
  let left = 0;
  let top = 0;
  let node = element;
  while (node && node !== screen) {
    left += node.offsetLeft;
    top += node.offsetTop;
    node = node.offsetParent;
  }
  return {
    left,
    top,
    width: element.offsetWidth,
    height: element.offsetHeight,
    right: left + element.offsetWidth,
    bottom: top + element.offsetHeight,
  };
}

function squeezePortrait() {
  return viewWidth() < 900 && viewHeight() > viewWidth();
}

function pictureFit(rect) {
  if (squeezePortrait()) {
    return {
      scaleX: rect.width / pictureWidth,
      scaleY: rect.height / pictureHeight,
      originX: rect.left,
      originY: rect.top,
    };
  }
  const scale = frameScale(rect.width, rect.height, pictureWidth, pictureHeight);
  return {
    scaleX: scale,
    scaleY: scale,
    originX: rect.left + (rect.width - pictureWidth * scale) / 2,
    originY: rect.top + (rect.height - pictureHeight * scale) / 2,
  };
}

let formOpen = false;

function contactOnStage() {
  const top = viewTop(contact);
  const next = viewTop(vendors);
  return top <= 48 && next > viewHeight() * 0.55;
}

function placeTabletForm() {
  const onStage = contactOnStage();
  const typing = formOpen && tabletForm.contains(document.activeElement);
  if (!onStage && !typing) formOpen = false;
  const live = formOpen && (onStage || typing);
  const offer = onStage && !live;
  tabletForm.classList.toggle("is-live", live);
  tabletForm.setAttribute("aria-hidden", live ? "false" : "true");
  connectCta.classList.toggle("is-live", offer);
  connectCta.setAttribute("aria-hidden", offer ? "false" : "true");
  connectCta.setAttribute("aria-expanded", live ? "true" : "false");
  if (!live && tabletForm.contains(document.activeElement)) document.activeElement.blur();
}

function paintChapters(progress) {
  chapters.forEach((chapter) => {
    const from = Number(chapter.dataset.from);
    const to = Number(chapter.dataset.to);
    const fade = 0.05;
    const enter = from <= 0 ? 1 : clamp((progress - from) / fade, 0, 1);
    const exit = to >= 1 ? 1 : clamp((to - progress) / fade, 0, 1);
    const opacity = Math.min(enter, exit);
    chapter.style.opacity = String(opacity);
    chapter.style.transform = "none";
    chapter.classList.toggle("is-on", opacity > 0.45);
    if (opacity > 0.45) {
      showPops(chapter, true);
    } else if (opacity < 0.08) {
      showPops(chapter, false);
    }
  });
}

const webKitFilm = (() => {
  const ua = navigator.userAgent;
  const iOS = /iP(hone|ad|od)/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const safari = /Safari\//.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|Android/.test(ua);
  return iOS || safari;
})();
const frameUrl = "assets/frames.bin?v=7";
const frameCache = new Map();
const frameCacheMax = webKitFilm ? 18 : 48;
const frameDecodeAhead = webKitFilm ? 16 : 36;
const frameDecodeSlots = webKitFilm ? 2 : 3;
const frameFetchMax = 2;
const frameBatchLimit = webKitFilm ? 8 : 12;
const frameBatchBytes = webKitFilm ? 640000 : 1100000;
const frameFailed = new Set();
const frameBytes = new Map();
const frameAbort = new Map();
const frameTries = new Map();
let frameChunks = [];
let frameReceived = 0;
let frameCount = 0;
let frameOffsets = null;
let frameParsed = false;
let frameStream = false;
let frameFetchSlots = 0;
let frameShown = -1;
let frameShownKey = "";
let frameInflight = 0;
let frameSharp = true;
let frameSharpTimer = 0;
const framePending = new Set();
let paintQueued = false;
let motionIndex = -1;
let stageW = 0;
let stageH = 0;
let filmCssW = 0;
let filmCssH = 0;

function sliceBytes(start, end) {
  const out = new Uint8Array(end - start);
  let pos = 0;
  let offset = 0;
  for (const chunk of frameChunks) {
    const chunkEnd = offset + chunk.length;
    if (chunkEnd > start && offset < end) {
      const from = Math.max(0, start - offset);
      const to = Math.min(chunk.length, end - offset);
      out.set(chunk.subarray(from, to), pos);
      pos += to - from;
    }
    offset = chunkEnd;
    if (offset >= end) break;
  }
  return out;
}

function frameReady(index) {
  return frameBytes.has(index);
}

function nearestCached(index) {
  if (frameCache.has(index)) return index;
  let best = -1;
  for (const key of frameCache.keys()) {
    if (best < 0 || Math.abs(key - index) < Math.abs(best - index)) best = key;
  }
  return best;
}

function trimFrameCache(index) {
  if (frameCache.size <= frameCacheMax) return;
  const ranked = [...frameCache.keys()].sort((a, b) => Math.abs(b - index) - Math.abs(a - index));
  while (frameCache.size > frameCacheMax && ranked.length) {
    const drop = ranked.shift();
    if (drop === index || drop === frameShown) continue;
    const bitmap = frameCache.get(drop);
    frameCache.delete(drop);
    if (bitmap && bitmap.close) bitmap.close();
    else if (bitmap && "src" in bitmap) bitmap.src = "";
  }
}

function filmDpr() {
  return Math.min(window.devicePixelRatio || 1, frameSharp ? 2 : 1);
}

function drawWash(bitmap) {
  if (!squeezePortrait()) return;
  const cssW = stageW || screen.getBoundingClientRect().width;
  const cssH = stageH || screen.getBoundingClientRect().height;
  const dpr = filmDpr();
  const w = Math.max(1, Math.round(cssW * dpr));
  const h = Math.max(1, Math.round(cssH * dpr));
  if (wash.width !== w || wash.height !== h) {
    wash.width = w;
    wash.height = h;
  }
  washCtx.imageSmoothingEnabled = true;
  washCtx.imageSmoothingQuality = "low";
  const scale = Math.max(w / bitmap.width, h / bitmap.height) * 1.22;
  const dw = bitmap.width * scale;
  const dh = bitmap.height * scale;
  washCtx.globalAlpha = 1;
  washCtx.drawImage(bitmap, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

function drawCover(bitmap) {
  const dpr = filmDpr();
  const cssW = filmCssW || film.getBoundingClientRect().width;
  const cssH = filmCssH || film.getBoundingClientRect().height;
  const scale = frameScale(cssW, cssH, bitmap.width, bitmap.height);
  const dw = bitmap.width * scale * dpr;
  const dh = bitmap.height * scale * dpr;
  filmCtx.globalAlpha = 1;
  filmCtx.drawImage(bitmap, (film.width - dw) / 2, (film.height - dh) / 2, dw, dh);
}

function drawFrame(index, bitmap) {
  const dpr = filmDpr();
  const cssW = filmCssW || film.getBoundingClientRect().width;
  const cssH = filmCssH || film.getBoundingClientRect().height;
  const w = Math.max(1, Math.round(cssW * dpr));
  const h = Math.max(1, Math.round(cssH * dpr));
  if (film.width !== w || film.height !== h) {
    film.width = w;
    film.height = h;
  }
  filmCtx.imageSmoothingEnabled = true;
  filmCtx.imageSmoothingQuality = frameSharp ? "high" : "medium";
  filmCtx.globalAlpha = 1;
  if (squeezePortrait()) {
    drawWash(bitmap);
    filmCtx.clearRect(0, 0, w, h);
    filmCtx.drawImage(bitmap, 0, 0, w, h);
  } else {
    filmCtx.fillStyle = "#050607";
    filmCtx.fillRect(0, 0, w, h);
    drawCover(bitmap);
  }
  frameShown = index;
  film.dataset.frame = String(index);
}

function filmIndex() {
  if (reduceMotion) return Math.max(motionIndex, 0);
  if (frameCount < 2) return 0;
  return clamp(Math.round(filmProgress() * (frameCount - 1)), 0, frameCount - 1);
}

function renderFilm() {
  const index = filmIndex();
  const base = nearestCached(index);
  if (base < 0) return false;
  if (!filmCssW) measureFilmBox();
  const key = `${base}:${frameSharp ? 1 : 0}:${squeezePortrait() ? 1 : 0}:${Math.round(filmCssW)}`;
  if (key === frameShownKey) return true;
  drawFrame(base, frameCache.get(base));
  frameShownKey = key;
  return true;
}

function nextToDecode(index) {
  const ready = (candidate) => (
    candidate >= 0 &&
    candidate < frameCount &&
    !frameCache.has(candidate) &&
    !framePending.has(candidate) &&
    !frameFailed.has(candidate) &&
    frameReady(candidate)
  );
  if (ready(index)) return index;
  let best = -1;
  frameBytes.forEach((_, frame) => {
    if (!ready(frame)) return;
    if (best < 0 || Math.abs(frame - index) < Math.abs(best - index)) best = frame;
  });
  return best;
}

function decodeWithImage(blob) {
  const url = URL.createObjectURL(blob);
  const image = new Image();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      image.onload = null;
      image.onerror = null;
      URL.revokeObjectURL(url);
      reject(new Error("timeout"));
    }, 4000);
    image.onload = () => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      reject(new Error("decode"));
    };
    image.src = url;
  });
}

function decodeJpeg(bytes) {
  const blob = new Blob([bytes], { type: "image/jpeg" });
  if (typeof createImageBitmap !== "function") return decodeWithImage(blob);
  let settled = false;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      if (webKitFilm) decodeWithImage(blob).then(resolve, reject);
      else reject(new Error("timeout"));
    }, webKitFilm ? 1800 : 8000);
    createImageBitmap(blob).then((bitmap) => {
      if (settled) {
        if (bitmap.close) bitmap.close();
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(bitmap);
    }, (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (webKitFilm) decodeWithImage(blob).then(resolve, reject);
      else reject(err);
    });
  });
}

function pumpFrames() {
  if (!frameParsed) return;
  const index = filmIndex();
  const slots = frameSharp ? frameDecodeSlots : 1;
  while (frameInflight < slots) {
    const want = nextToDecode(index);
    if (want < 0) break;
    if (!frameSharp) {
      frameBytes.forEach((_, frame) => {
        if (framePending.has(frame) || frame >= Math.min(want, index) - 1) return;
        frameBytes.delete(frame);
      });
    }
    const bytes = frameBytes.get(want);
    if (!bytes) break;
    framePending.add(want);
    frameInflight += 1;
    decodeJpeg(bytes)
      .then((bitmap) => {
        framePending.delete(want);
        frameInflight -= 1;
        frameBytes.delete(want);
        const indexNow = filmIndex();
        const useful = Math.abs(want - indexNow) <= Math.abs(frameShown - indexNow) || Math.abs(want - indexNow) <= frameDecodeAhead + 2;
        if (!useful) {
          if (bitmap.close) bitmap.close();
          else if ("src" in bitmap) bitmap.src = "";
        } else {
          frameCache.set(want, bitmap);
          trimFrameCache(indexNow);
          renderFilm();
        }
        pumpFrames();
      })
      .catch((err) => {
        framePending.delete(want);
        frameInflight -= 1;
        if (!err || err.message !== "timeout") frameFailed.add(want);
        pumpFrames();
      });
  }
}

function paintFrame() {
  if (!frameParsed) return;
  frameSharp = false;
  clearTimeout(frameSharpTimer);
  frameSharpTimer = setTimeout(() => {
    frameSharp = true;
    frameShownKey = "";
    renderFilm();
  }, 120);
  renderFilm();
  pumpFrames();
}

function requestFilm() {
  scheduleFrames();
  if (webKitFilm) {
    paintFrame();
    return;
  }
  if (paintQueued) return;
  paintQueued = true;
  requestAnimationFrame(() => {
    paintQueued = false;
    paintFrame();
  });
}

function parseFrameHeader() {
  if (frameParsed || frameReceived < 12) return;
  const head = sliceBytes(0, 12);
  if (head[0] !== 80 || head[1] !== 83 || head[2] !== 77 || head[3] !== 70) return;
  const view = new DataView(head.buffer);
  const count = view.getUint16(10, true);
  const headerLen = 12 + 4 * (count + 1);
  if (frameReceived < headerLen) return;
  pictureWidth = view.getUint16(6, true);
  pictureHeight = view.getUint16(8, true);
  frameCount = count;
  const table = sliceBytes(12, headerLen);
  const tableView = new DataView(table.buffer);
  frameOffsets = new Uint32Array(frameCount + 1);
  for (let i = 0; i <= frameCount; i += 1) frameOffsets[i] = tableView.getUint32(i * 4, true);
  frameParsed = true;
  placeWhatsApp();
  placeTabletForm();
  requestFilm();
}

function harvestFrames() {
  if (!frameParsed || !frameOffsets) return;
  for (let index = 0; index < frameCount; index += 1) {
    if (frameBytes.has(index)) continue;
    if (frameReceived < frameOffsets[index + 1]) break;
    frameBytes.set(index, sliceBytes(frameOffsets[index], frameOffsets[index + 1]));
  }
}

function headerLength(buf) {
  if (buf.length < 12) return 0;
  if (buf[0] !== 80 || buf[1] !== 83 || buf[2] !== 77 || buf[3] !== 70) return 0;
  const count = new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint16(10, true);
  return 12 + 4 * (count + 1);
}

function adoptHeader(buf) {
  const needed = headerLength(buf);
  if (!needed || buf.length < needed) return false;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  pictureWidth = view.getUint16(6, true);
  pictureHeight = view.getUint16(8, true);
  frameCount = view.getUint16(10, true);
  frameOffsets = new Uint32Array(frameCount + 1);
  for (let i = 0; i <= frameCount; i += 1) frameOffsets[i] = view.getUint32(12 + i * 4, true);
  frameParsed = true;
  placeWhatsApp();
  placeTabletForm();
  return true;
}

function needsFrame(index) {
  return index >= 0 && index < frameCount && !frameBytes.has(index) && !frameCache.has(index) && !frameFailed.has(index);
}

function batchCovers(index) {
  for (const entry of frameAbort.values()) {
    if (index >= entry.start && index <= entry.end) return true;
  }
  return false;
}

function planBatch(index) {
  const targets = [];
  for (let step = 0; step <= frameDecodeAhead; step += 1) targets.push(index + step);
  if (index > 0) targets.push(index - 1);
  for (let i = 0; i < targets.length; i += 1) {
    const start = targets[i];
    if (!needsFrame(start) || batchCovers(start)) continue;
    if (start < index) return { start, end: start };
    let end = start;
    let bytes = frameOffsets[end + 1] - frameOffsets[end];
    const limit = frameSharp ? frameBatchLimit : 3;
    const budget = frameSharp ? frameBatchBytes : 260000;
    while (end - start + 1 < limit && end < index + frameDecodeAhead) {
      const next = end + 1;
      if (!needsFrame(next) || batchCovers(next)) break;
      const size = frameOffsets[next + 1] - frameOffsets[next];
      if (bytes + size > budget) break;
      bytes += size;
      end = next;
    }
    return { start, end };
  }
  return null;
}

function sliceChunks(chunks, from, to) {
  const out = new Uint8Array(to - from);
  let pos = 0;
  let offset = 0;
  for (const chunk of chunks) {
    const end = offset + chunk.length;
    if (end > from && offset < to) {
      const start = Math.max(0, from - offset);
      const stop = Math.min(chunk.length, to - offset);
      out.set(chunk.subarray(start, stop), pos);
      pos += stop - start;
    }
    offset = end;
    if (offset >= to) break;
  }
  return out;
}

async function readFrameBatch(start, end, signal) {
  const startByte = frameOffsets[start];
  const endByte = frameOffsets[end + 1] - 1;
  const response = await fetch(frameUrl, {
    cache: "no-store",
    headers: { Range: `bytes=${startByte}-${endByte}` },
    signal,
  });
  if (response.status !== 206) {
    if (response.status === 200 && !frameParsed) return { full: response };
    if (response.body) response.body.cancel();
    throw new Error(String(response.status));
  }
  const reported = rangeStart(response);
  if (reported >= 0 && reported !== startByte) {
    if (response.body) response.body.cancel();
    throw new Error("range");
  }
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  let next = start;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    let stored = false;
    while (next <= end && received >= frameOffsets[next + 1] - startByte) {
      const slice = sliceChunks(chunks, frameOffsets[next] - startByte, frameOffsets[next + 1] - startByte);
      if (slice.length < 2 || slice[0] !== 0xff || slice[1] !== 0xd8) throw new Error("jpeg");
      frameBytes.set(next, slice);
      next += 1;
      stored = true;
    }
    if (stored) requestFilm();
  }
  if (next <= end) throw new Error("short");
  return null;
}

function rangeStart(response) {
  const header = response.headers.get("Content-Range") || "";
  const match = /^bytes (\d+)-/i.exec(header);
  return match ? Number(match[1]) : -1;
}

async function fetchRange(start, end, signal) {
  const response = await fetch(frameUrl, {
    cache: "no-store",
    headers: { Range: `bytes=${start}-${end}` },
    signal,
  });
  if (response.status === 206) {
    const reported = rangeStart(response);
    if (reported >= 0 && reported !== start) {
      if (response.body) response.body.cancel();
      throw new Error("range");
    }
    return { buf: new Uint8Array(await response.arrayBuffer()) };
  }
  if (response.status === 200 && !frameParsed) return { full: response };
  if (response.body) response.body.cancel();
  throw new Error(String(response.status));
}

async function consumeFrameResponse(response) {
  if (!response.ok || !response.body) return;
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    frameChunks.push(value);
    frameReceived += value.length;
    parseFrameHeader();
    harvestFrames();
    if (frameParsed) requestFilm();
  }
  if (frameChunks.length > 1) {
    const merged = new Uint8Array(frameReceived);
    let pos = 0;
    frameChunks.forEach((chunk) => {
      merged.set(chunk, pos);
      pos += chunk.length;
    });
    frameChunks = [merged];
  }
  parseFrameHeader();
  harvestFrames();
  requestFilm();
}

async function beginFullStream(response) {
  if (frameStream) {
    if (response && response.body) response.body.cancel();
    return;
  }
  frameStream = true;
  frameAbort.forEach((entry) => {
    entry.dropped = true;
    entry.controller.abort();
  });
  await consumeFrameResponse(response);
}

async function readFullStream() {
  if (frameStream) return;
  const response = await fetch(frameUrl, { cache: "no-store" });
  await beginFullStream(response);
}

function scheduleFrames() {
  if (!frameParsed || frameStream) return;
  const index = filmIndex();
  frameBytes.forEach((bytes, frame) => {
    if (framePending.has(frame)) return;
    if (frame >= frameShown && frame <= index + frameDecodeAhead + 4) return;
    if (Math.abs(frame - index) <= frameDecodeAhead + 4) return;
    frameBytes.delete(frame);
  });
  while (frameFetchSlots < frameFetchMax) {
    const batch = planBatch(index);
    if (!batch) return;
    const key = `${batch.start}:${batch.end}`;
    const entry = {
      controller: new AbortController(),
      start: batch.start,
      end: batch.end,
      dropped: false,
      timedOut: false,
    };
    frameAbort.set(key, entry);
    frameFetchSlots += 1;
    const timer = setTimeout(() => {
      entry.timedOut = true;
      entry.controller.abort();
    }, 12000);
    readFrameBatch(batch.start, batch.end, entry.controller.signal)
      .then((result) => {
        if (entry.dropped || entry.controller.signal.aborted) return;
        if (result && result.full) beginFullStream(result.full);
        else frameTries.delete(batch.start);
      })
      .catch((err) => {
        if (entry.dropped) return;
        if (err && err.name === "AbortError" && !entry.timedOut) return;
        const tries = (frameTries.get(batch.start) || 0) + 1;
        frameTries.set(batch.start, tries);
        if (tries >= 5) frameFailed.add(batch.start);
      })
      .finally(() => {
        clearTimeout(timer);
        frameAbort.delete(key);
        frameFetchSlots -= 1;
        if (!frameStream) scheduleFrames();
      });
  }
}

async function loadFrames() {
  try {
    let result = await fetchRange(0, 16383);
    if (result.full) {
      await beginFullStream(result.full);
      return;
    }
    let buf = result.buf;
    const needed = headerLength(buf);
    if (needed > buf.length) {
      result = await fetchRange(0, needed - 1);
      if (result.full) {
        await beginFullStream(result.full);
        return;
      }
      buf = result.buf;
    }
    if (!adoptHeader(buf)) return;
    scheduleFrames();
  } catch (err) {
    try {
      await readFullStream();
    } catch (again) {
      paintCue();
    }
  }
}

function onScroll() {
  const progress = storyProgress();
  progressBar.style.width = `${filmProgress() * 100}%`;
  if (!reduceMotion) paintChapters(progress);
  nav.classList.toggle("is-solid", viewTop(story) + story.offsetHeight < viewHeight() * 0.9);
  if (!reduceMotion) requestFilm();
  if (viewTop(contact) < viewHeight() * 1.2) placeTabletForm();
}

function placeWhatsApp() {
  if (!pictureWidth || !pictureHeight) return;
  wa.style.left = "";
  wa.style.top = "";
  wa.style.right = "";
  wa.style.bottom = "";
  wa.style.width = "";
  wa.style.height = "";

  const rect = layoutBox(film);
  const fit = pictureFit(rect);
  const { scaleX, scaleY, originX, originY } = fit;
  const sx = pictureWidth / 1920;
  const sy = pictureHeight / 1080;
  const markX = 1692 * sx;
  const markY = 822 * sy;
  const markW = 96 * sx;
  const markH = 126 * sy;
  const centerX = originX + (markX + markW / 2) * scaleX;
  const centerY = originY + (markY + markH / 2) * scaleY;
  const bounds = landscapeTurned()
    ? { left: 0, top: 0, right: screen.offsetWidth, bottom: screen.offsetHeight }
    : screen.getBoundingClientRect();
  const margin = 12;
  if (
    centerX < bounds.left + margin ||
    centerY < bounds.top + margin ||
    centerX > bounds.right - margin ||
    centerY > bounds.bottom - margin
  ) {
    return;
  }

  const size = wa.offsetWidth;
  wa.style.right = "auto";
  wa.style.bottom = "auto";
  wa.style.left = `${centerX - bounds.left - size / 2}px`;
  wa.style.top = `${centerY - bounds.top - size / 2}px`;
}

const filmCue = document.querySelector(".scroll-cue");
const tiltCue = window.matchMedia("(max-width: 899px) and (orientation: portrait)");

function paintCue() {
  const turned = landscapeTurned();
  const offer = tiltCue.matches && !turned;
  filmCue.textContent = turned
    ? "Back to the original phone"
    : offer
      ? "Tilt the device for a better experience"
      : "Scroll to unfold";
  filmCue.classList.toggle("is-cta", offer || turned);
  if (offer || turned) filmCue.setAttribute("aria-pressed", String(turned));
  else filmCue.removeAttribute("aria-pressed");
}

function useLandscape(on) {
  const orientation = window.screen.orientation;
  if (on) {
    if (orientation && typeof orientation.lock === "function") {
      orientation.lock("landscape").catch(() => {});
    }
    forceLandscape = true;
    document.documentElement.classList.add("force-landscape");
  } else {
    if (orientation && typeof orientation.unlock === "function") {
      try {
        orientation.unlock();
      } catch (err) {}
    }
    forceLandscape = false;
    document.documentElement.classList.remove("force-landscape");
    stopLandscapeGlide();
    scroller.scrollTop = 0;
  }
  fitStage();
  paintCue();
  if (!reduceMotion) onScroll();
}

paintCue();
tiltCue.addEventListener("change", paintCue);
filmCue.addEventListener("click", () => {
  if (!filmCue.classList.contains("is-cta")) return;
  useLandscape(!landscapeTurned());
});
const phoneReturn = document.querySelector(".phone-return");
if (phoneReturn) {
  phoneReturn.addEventListener("click", () => {
    useLandscape(false);
  });
}
loadFrames();
if (reduceMotion) {
  const started = performance.now();
  const tick = () => {
    if (frameCount > 1) {
      motionIndex = Math.floor(((performance.now() - started) / 1000) * 12) % frameCount;
      requestFilm();
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
function fitScreen() {
  const view = viewportSize();
  const turned = forceLandscape && view.height > view.width;
  const fullW = turned ? view.height : view.width;
  const fullH = turned ? view.width : view.height;
  document.documentElement.style.setProperty("--screen-w", `${fullW}px`);
  document.documentElement.style.setProperty("--screen-h", `${fullH}px`);
  stageW = fullW;
  stageH = fullH;
  screen.style.margin = "0";
  screen.style.width = `${fullW}px`;
  screen.style.height = `${fullH}px`;
  if (turned) {
    screen.style.top = "0";
    screen.style.left = `${view.width}px`;
    screen.style.right = "auto";
    screen.style.bottom = "auto";
    screen.style.transformOrigin = "top left";
    screen.style.transform = "rotate(90deg)";
  } else {
    screen.style.top = "0";
    screen.style.left = "0";
    screen.style.right = "0";
    screen.style.bottom = "0";
    screen.style.transform = "none";
  }
  scroller.style.touchAction = turned ? "none" : "";
  const changed = fullW !== fitScreen.width || fullH !== fitScreen.height;
  fitScreen.width = fullW;
  fitScreen.height = fullH;
  return changed;
}

function measureFilmBox() {
  const layoutW = film.offsetWidth;
  const layoutH = film.offsetHeight;
  if (layoutW > 0 && layoutH > 0) {
    filmCssW = layoutW;
    filmCssH = layoutH;
    return;
  }
  const rect = film.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    filmCssW = rect.width;
    filmCssH = rect.height;
  }
}

function fitStage() {
  fitScreen();
  measureFilmBox();
  frameShownKey = "";
  if (frameParsed) {
    renderFilm();
    pumpFrames();
  }
  placeWhatsApp();
  placeTabletForm();
}

fitScreen();
document.getElementById("year").textContent = String(new Date().getFullYear());
if (!reduceMotion) paintChapters(0);
scroller.addEventListener("scroll", onScroll, { passive: true });
onScroll();

let landscapePointer = null;
let landscapeGlide = 0;
let landscapeGlideFrame = 0;

function stopLandscapeGlide() {
  landscapeGlide = 0;
  if (!landscapeGlideFrame) return;
  cancelAnimationFrame(landscapeGlideFrame);
  landscapeGlideFrame = 0;
}

function startLandscapeGlide(velocity) {
  stopLandscapeGlide();
  landscapeGlide = velocity;
  const step = () => {
    if (!landscapeTurned() || Math.abs(landscapeGlide) < 0.35) {
      landscapeGlideFrame = 0;
      landscapeGlide = 0;
      return;
    }
    scroller.scrollTop += landscapeGlide;
    landscapeGlide *= 0.94;
    landscapeGlideFrame = requestAnimationFrame(step);
  };
  landscapeGlideFrame = requestAnimationFrame(step);
}

scroller.addEventListener("pointerdown", (event) => {
  if (!landscapeTurned() || event.button !== 0) return;
  if (event.target.closest("input, textarea, select, .ipad-screen")) return;
  stopLandscapeGlide();
  landscapePointer = {
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    dragging: false,
    axis: "",
    lastTime: event.timeStamp,
    velocity: 0,
  };
});

scroller.addEventListener("pointermove", (event) => {
  if (!landscapePointer || event.pointerId !== landscapePointer.id || !landscapeTurned()) return;
  const dx = event.clientX - landscapePointer.x;
  const dy = event.clientY - landscapePointer.y;
  if (!landscapePointer.dragging) {
    if (Math.hypot(dx, dy) < 8) return;
    landscapePointer.dragging = true;
    landscapePointer.axis = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
    try {
      scroller.setPointerCapture(event.pointerId);
    } catch (err) {}
  }
  const step = landscapePointer.axis === "x" ? dx : -dy;
  const dt = Math.max(16, event.timeStamp - landscapePointer.lastTime);
  landscapePointer.velocity = step / dt * 16.7;
  landscapePointer.x = event.clientX;
  landscapePointer.y = event.clientY;
  landscapePointer.lastTime = event.timeStamp;
  scroller.scrollTop += step;
  event.preventDefault();
});

scroller.addEventListener("pointerup", (event) => {
  if (!landscapePointer || event.pointerId !== landscapePointer.id) return;
  const velocity = landscapePointer.dragging ? landscapePointer.velocity : 0;
  landscapePointer = null;
  if (Math.abs(velocity) < 0.6) return;
  startLandscapeGlide(velocity);
});

scroller.addEventListener("pointercancel", (event) => {
  if (!landscapePointer || event.pointerId !== landscapePointer.id) return;
  landscapePointer = null;
});

window.addEventListener("resize", () => {
  fitStage();
  paintCue();
  if (!reduceMotion) onScroll();
});
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", fitStage);
  window.visualViewport.addEventListener("scroll", () => {
    if (fitScreen()) fitStage();
  });
}
placeWhatsApp();
placeTabletForm();

const music = document.getElementById("music");
const sound = document.querySelector(".sound");
let muted = false;

function musicPlaying() {
  return !muted && !music.paused && !music.muted;
}

function paintSound() {
  const playing = musicPlaying();
  sound.classList.toggle("is-on", playing);
  sound.setAttribute("aria-pressed", String(playing));
  sound.setAttribute("aria-label", playing ? "Mute music" : "Unmute music");
}

function startMusic() {
  if (muted || musicPlaying()) return;
  music.muted = false;
  music.volume = 0.5;
  const pending = music.play();
  if (pending && pending.then) {
    pending.then(paintSound).catch(() => paintSound());
    return;
  }
  paintSound();
}

sound.addEventListener("pointerdown", (event) => event.stopPropagation());
sound.addEventListener("click", (event) => {
  event.stopPropagation();
  if (musicPlaying()) {
    muted = true;
    music.pause();
    paintSound();
    return;
  }
  muted = false;
  startMusic();
});

startMusic();
music.addEventListener("canplay", startMusic);
window.addEventListener("pageshow", startMusic);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") startMusic();
});
["pointerdown", "keydown", "touchstart", "wheel"].forEach((type) => {
  window.addEventListener(type, () => {
    if (music.paused && !muted) startMusic();
  }, { passive: true });
});
scroller.addEventListener("scroll", () => {
  if (music.paused && !muted) startMusic();
}, { passive: true });

const toggle = document.querySelector(".nav-toggle");
toggle.addEventListener("click", () => {
  const open = nav.classList.toggle("is-open");
  toggle.setAttribute("aria-expanded", String(open));
  toggle.textContent = open ? "Close" : "Menu";
});
document.querySelectorAll(".nav-links a").forEach((link) => {
  link.addEventListener("click", () => {
    nav.classList.remove("is-open");
    toggle.setAttribute("aria-expanded", "false");
    toggle.textContent = "Menu";
  });
});

const form = document.getElementById("contact-form");
const status = document.getElementById("form-status");
form.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const name = String(data.get("name") || "").trim();
  const email = String(data.get("email") || "").trim();
  const country = String(data.get("country") || "").trim();
  const contactNo = String(data.get("contact") || "").trim();
  const message = String(data.get("message") || "").trim();
  const lines = [
    "Hello PSM Infinity,",
    "",
    `Name: ${name}`,
    `Email: ${email}`,
    `Country: ${country}`,
    `Contact: ${contactNo}`,
    "",
    message,
  ];
  const url = `https://wa.me/919007431000?text=${encodeURIComponent(lines.join("\n"))}`;
  const opened = window.open(url, "_blank", "noopener");
  if (!opened) window.location.href = url;
  status.textContent = "WhatsApp is opening.";
});
connectCta.addEventListener("click", () => {
  formOpen = true;
  placeTabletForm();
  const name = form.querySelector("[name=name]");
  if (name) name.focus();
});
form.querySelector(".ipad-close").addEventListener("click", () => {
  formOpen = false;
  placeTabletForm();
  if (connectCta.classList.contains("is-live")) connectCta.focus();
});

function markPops(elements) {
  elements.forEach((element, index) => {
    element.classList.add("pop");
    element.style.setProperty("--pop-delay", `${index * 110}ms`);
  });
}

function showPops(root, visible) {
  root.querySelectorAll(".pop").forEach((element) => element.classList.toggle("is-in", visible));
}

markPops([...document.querySelectorAll(".chapter")].flatMap((chapter) => [...chapter.children]));
if (!reduceMotion) paintChapters(storyProgress());

[
  [
    document.querySelector(".services"),
    [
      ...document.querySelectorAll(".services .panel-head > *"),
      ...document.querySelectorAll(".services .service-list > li"),
    ],
  ],
  [
    document.querySelector(".about"),
    [
      ...document.querySelectorAll(".about-copy > *"),
      ...document.querySelectorAll(".about-side > .kicker"),
      ...document.querySelectorAll(".timeline > li"),
    ],
  ],
  [
    document.querySelector(".contact"),
    [],
  ],
  [
    document.querySelector(".vendors"),
    [
      ...document.querySelectorAll(".vendors .panel-head > *"),
      ...document.querySelectorAll(".vendors .logo-grid > li"),
    ],
  ],
  [
    document.querySelector(".directory"),
    [...document.querySelectorAll(".details > div")],
  ],
  [document.querySelector(".footer"), [...document.querySelectorAll(".footer > *")]],
].forEach(([section, bits]) => {
  markPops(bits.filter(Boolean));
  if (reduceMotion) return;
  const observer = new IntersectionObserver(
    ([entry]) => showPops(section, entry.isIntersecting),
    { threshold: 0.22 }
  );
  observer.observe(section);
});
