/* Progressive Stride Frame Engine
 *
 * Two sources, one picture:
 *   crisp  one WebP per frame, full resolution, drawn when the scroll settles
 *   sheets 16 frames packed into one 480px sprite page, drawn while scrolling
 *
 * One page request covers 16 frames, which is the whole point: this host serves
 * about two and a half frame requests a second, so 633 separate motion frames
 * is a four minute wait while 40 pages is seconds.
 *
 * The poster of each reel is decoded first and drawn whenever neither source
 * has a frame, so no panel can ever be empty.
 */
(() => {
  const CONCURRENCY = 6;
  const TIER = window.__psmTier || "1280";
  const ASSET_VERSION = "v=5";
  // Decoded budgets. A crisp 1080 frame is 2.6 MB, a sheet page is 480*270*16
  // pixels = 8.3 MB, so both are capped hard.
  const CRISP_BUDGET = TIER === "1280" ? 30 : TIER === "1080" ? 32 : 72;
  const SHEET_CELLS = 16;
  const SHEET_COLS = 4;
  const SHEET_W = 480;
  const SHEET_H = 270;
  const SHEET_KEEP = 5;
  const SHEET_SLOTS = 4;
  const RUNWAY_AHEAD = 24;
  const RUNWAY_BEHIND = 10;
  const SHOW_GAP = 20;

  let reels = {};
  let order = [];
  const canvases = new Map();
  const fits = new Map();
  const stills = new Map();
  const painted = new Map();
  const shown = new Map();

  function crispUrl(id, index) {
    return `assets/frames/${TIER}/${id}/${String(index).padStart(3, "0")}.webp?${ASSET_VERSION}`;
  }

  function sheetUrl(id, page) {
    return `assets/frames/sheet/${id}/${String(page).padStart(2, "0")}.webp?${ASSET_VERSION}`;
  }

  function countOf(id) {
    const reel = reels[id];
    return reel ? reel.count : 0;
  }

  function pageCount(id) {
    return Math.ceil(countOf(id) / SHEET_CELLS);
  }

  function release(bitmap) {
    if (bitmap && typeof bitmap.close === "function") bitmap.close();
  }

  function decode(blob) {
    if (typeof window.createImageBitmap === "function") {
      return window.createImageBitmap(blob).catch(() => decodeWithImage(blob));
    }
    return decodeWithImage(blob);
  }

  function decodeWithImage(blob) {
    return new Promise((resolve, reject) => {
      const scratch = URL.createObjectURL(blob);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(scratch);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(scratch);
        reject(new Error("decode failed"));
      };
      image.src = scratch;
    });
  }

  // ------------------------------------------------------------- crisp frames

  class FrameManager {
    constructor(budget) {
      this.budget = budget;
      this.bitmaps = new Map();
      this.queued = new Map();
      this.queue = [];
      this.active = 0;
      this.failed = new Set();
      this.loaded = new Set();
      this.keep = new Set();
      this.playhead = { reel: "", index: 0 };
      this.listeners = new Set();
      this.seq = 0;
      this.booted = false;
    }

    get size() {
      return this.bitmaps.size;
    }

    key(id, index) {
      return `${id}/${index}`;
    }

    get(id, index) {
      if (index < 0 || index >= countOf(id)) return null;
      return this.bitmaps.get(this.key(id, index)) || null;
    }

    want(id, index, priority = 60) {
      if (index < 0 || index >= countOf(id)) return;
      const key = this.key(id, index);
      if (this.bitmaps.has(key) || this.failed.has(key)) return;
      const waiting = this.queued.get(key);
      if (waiting) {
        if (priority < waiting.priority) waiting.priority = priority;
        return;
      }
      const job = { key, id, index, priority, seq: this.seq++ };
      this.queued.set(key, job);
      this.queue.push(job);
      this.pump();
    }

    pump() {
      if (this.queue.length > 1) {
        this.queue.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
      }
      while (this.active < CONCURRENCY - SHEET_SLOTS && this.queue.length) {
        const job = this.queue.shift();
        this.queued.delete(job.key);
        this.active += 1;
        this.load(job);
      }
    }

    load(job) {
      const done = () => {
        this.active -= 1;
        this.emit();
        this.pump();
      };
      fetch(crispUrl(job.id, job.index), { credentials: "same-origin" })
        .then((response) => {
          if (!response.ok) throw new Error(`frame ${response.status}`);
          return response.blob();
        })
        .then(decode)
        .then((bitmap) => {
          this.loaded.add(job.key);
          if (!this.keep.has(job.id)) {
            release(bitmap);
            done();
            return;
          }
          this.bitmaps.set(job.key, bitmap);
          this.evict();
          scheduleRepaint();
          done();
        })
        .catch(() => {
          this.failed.add(job.key);
          done();
        });
    }

    focus(id, index) {
      this.playhead = { reel: id, index };
      if (!this.booted) {
        this.evict();
        return;
      }
      const at = order.indexOf(id);
      const keep = new Set();
      for (const step of [-1, 0, 1]) {
        const near = order[at + step];
        if (near) keep.add(near);
      }
      this.keep = keep;
      this.evict();
    }

    evict() {
      for (const [key, bitmap] of this.bitmaps) {
        const id = key.slice(0, key.lastIndexOf("/"));
        if (this.keep.has(id)) continue;
        release(bitmap);
        this.bitmaps.delete(key);
      }
      if (this.bitmaps.size <= this.budget) return;
      const scored = [];
      for (const [key, bitmap] of this.bitmaps) {
        const cut = key.lastIndexOf("/");
        const id = key.slice(0, cut);
        const index = Number(key.slice(cut + 1));
        const distance = id === this.playhead.reel ? Math.abs(index - this.playhead.index) : 100000;
        scored.push({ key, bitmap, distance });
      }
      scored.sort((a, b) => b.distance - a.distance);
      for (let i = 0; i < scored.length && this.bitmaps.size > this.budget; i += 1) {
        release(scored[i].bitmap);
        this.bitmaps.delete(scored[i].key);
      }
    }

    nearest(id, index, limit) {
      const total = countOf(id);
      for (let step = 0; step <= limit; step += 1) {
        const ahead = index + step;
        if (ahead < total) {
          const bitmap = this.bitmaps.get(this.key(id, ahead));
          if (bitmap) return { index: ahead, bitmap };
        }
        const behind = index - step;
        if (step && behind >= 0) {
          const bitmap = this.bitmaps.get(this.key(id, behind));
          if (bitmap) return { index: behind, bitmap };
        }
      }
      return null;
    }

    onChange(listener) {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }

    emit() {
      for (const listener of this.listeners) listener(this);
    }

    progress(keys) {
      if (!keys.length) return 1;
      let done = 0;
      for (const key of keys) {
        if (this.loaded.has(key) || this.failed.has(key)) done += 1;
      }
      return done / keys.length;
    }
  }

  const manager = new FrameManager(CRISP_BUDGET);

  // ------------------------------------------------------------ sheet pages

  const sheets = new Map(); // "reel/page" -> ImageBitmap
  const pageQueued = new Map(); // url -> job
  const pageQueue = [];
  const pageDone = new Set();
  const pageFailed = new Set();
  let pageActive = 0;
  let pageSeq = 0;
  const pageListeners = new Set();

  function pageKey(id, page) {
    return `${id}/${page}`;
  }

  function wantPage(id, page, priority = 50) {
    const total = pageCount(id);
    if (page < 0 || page >= total) return;
    const key = pageKey(id, page);
    if (pageDone.has(key) || pageFailed.has(key) || sheets.has(key)) return;
    const waiting = pageQueued.get(key);
    if (waiting) {
      if (priority < waiting.priority) waiting.priority = priority;
      return;
    }
    const job = { key, id, page, priority, seq: pageSeq++ };
    pageQueued.set(key, job);
    pageQueue.push(job);
    pumpPages();
  }

  function pumpPages() {
    if (pageQueue.length > 1) {
      pageQueue.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
    }
    while (pageActive < SHEET_SLOTS && pageQueue.length) {
      const job = pageQueue.shift();
      pageQueued.delete(job.key);
      pageActive += 1;
      loadPage(job);
    }
  }

  function loadPage(job) {
    const done = () => {
      pageActive -= 1;
      for (const listener of pageListeners) listener(job);
      scheduleRepaint();
      pumpPages();
    };
    fetch(sheetUrl(job.id, job.page), { credentials: "same-origin" })
      .then((response) => {
        if (!response.ok) throw new Error(`page ${response.status}`);
        return response.blob();
      })
      .then(decode)
      .then((bitmap) => {
        pageDone.add(job.key);
        sheets.set(job.key, bitmap);
        trimSheets(job.id, job.page);
        done();
      })
      .catch(() => {
        pageFailed.add(job.key);
        done();
      });
  }

  // Keep the pages around the playhead, close the rest.
  function trimSheets(id, page) {
    if (sheets.size <= SHEET_KEEP) return;
    const scored = [];
    for (const [key, bitmap] of sheets) {
      const cut = key.lastIndexOf("/");
      const reelId = key.slice(0, cut);
      const pageIndex = Number(key.slice(cut + 1));
      const distance = reelId === id ? Math.abs(pageIndex - page) : 1000;
      scored.push({ key, bitmap, distance });
    }
    scored.sort((a, b) => b.distance - a.distance);
    for (let i = 0; i < scored.length && sheets.size > SHEET_KEEP; i += 1) {
      release(scored[i].bitmap);
      sheets.delete(scored[i].key);
    }
  }

  function onPage(listener) {
    pageListeners.add(listener);
    return () => pageListeners.delete(listener);
  }

  // ----------------------------------------------------------------- canvas

  function surface(id) {
    if (canvases.has(id)) return canvases.get(id);
    const canvas = document.querySelector(`#${id} canvas.shot-frame`);
    if (canvas) canvases.set(id, canvas);
    return canvas || null;
  }

  function fitOf(id) {
    if (fits.has(id)) return fits.get(id);
    const picture = document.querySelector(`#${id} img.shot-video`);
    if (!picture) return "cover";
    const fit = getComputedStyle(picture).objectFit || "cover";
    fits.set(id, fit);
    return fit;
  }

  // Draws a bitmap, or a cell of a sheet, into the reel's canvas with the same
  // framing the poster uses (cover or contain, centred).
  function draw(id, bitmap, sx, sy, sw, sh) {
    const canvas = surface(id);
    if (!canvas || !bitmap) return false;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width < 2 || height < 2) return false;
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    const targetW = Math.round(width * scale);
    const targetH = Math.round(height * scale);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
    const hasRect = typeof sw === "number" && sw > 0;
    const sourceW = hasRect ? sw : bitmap.width;
    const sourceH = hasRect ? sh : bitmap.height;
    if (!sourceW || !sourceH) return false;
    const contain = fitOf(id) === "contain";
    const ratio = contain
      ? Math.min(targetW / sourceW, targetH / sourceH)
      : Math.max(targetW / sourceW, targetH / sourceH);
    const drawW = sourceW * ratio;
    const drawH = sourceH * ratio;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return false;
    if (hasRect) {
      context.drawImage(bitmap, sx, sy, sourceW, sourceH, (targetW - drawW) / 2, (targetH - drawH) / 2, drawW, drawH);
    } else {
      context.drawImage(bitmap, (targetW - drawW) / 2, (targetH - drawH) / 2, drawW, drawH);
    }
    return true;
  }

  let repaintQueued = false;
  function scheduleRepaint() {
    if (repaintQueued) return;
    repaintQueued = true;
    let done = false;
    const run = () => {
      if (done) return;
      done = true;
      repaintQueued = false;
      const { reel, index } = manager.playhead;
      if (!reel || !manager.booted) return;
      paint(reel, index, SHOW_GAP + 40);
    };
    requestAnimationFrame(run);
    setTimeout(run, 120);
  }

  function drawSheetCell(id, bitmap, index, cell) {
    const col = cell % SHEET_COLS;
    const row = Math.floor(cell / SHEET_COLS);
    return draw(id, bitmap, col * SHEET_W, row * SHEET_H, SHEET_W, SHEET_H);
  }

  function paint(id, index, distance) {
    const previous = Number.isFinite(shown.get(id)) ? shown.get(id) : null;
    const limit = previous === null ? SHOW_GAP : Math.max(SHOW_GAP, Math.abs(index - previous));
    const reach = Math.min(limit, distance);
    const crisp = manager.nearest(id, index, reach);
    if (crisp) {
      shown.set(id, crisp.index);
      const mark = `c:${crisp.index}`;
      if (painted.get(id) !== mark && draw(id, crisp.bitmap)) {
        painted.set(id, mark);
        return true;
      }
      if (painted.get(id) === mark) return true;
    }
    const page = Math.floor(index / SHEET_CELLS);
    let bitmap = sheets.get(pageKey(id, page));
    let cell = index % SHEET_CELLS;
    if (!bitmap) {
      // Nearest decoded page on this reel, so the film still steps while the
      // page under the playhead is still downloading.
      let best = -1;
      for (const key of sheets.keys()) {
        if (!key.startsWith(`${id}/`)) continue;
        const pageIndex = Number(key.slice(key.lastIndexOf("/") + 1));
        if (best < 0 || Math.abs(pageIndex - page) < Math.abs(best - page)) best = pageIndex;
      }
      if (best >= 0) {
        bitmap = sheets.get(pageKey(id, best));
        const within = index - best * SHEET_CELLS;
        cell = Math.min(Math.max(within, 0), SHEET_CELLS - 1);
      }
    }
    if (bitmap) {
      const mark = `s:${page}:${cell}`;
      if (painted.get(id) === mark) return true;
      if (drawSheetCell(id, bitmap, index, cell)) {
        painted.set(id, mark);
        shown.set(id, index);
        return true;
      }
    }
    const still = stills.get(id);
    if (still) {
      const mark = `p:${still.width}x${still.height}`;
      if (painted.get(id) === mark) return true;
      if (draw(id, still)) {
        painted.set(id, mark);
        return true;
      }
    }
    return false;
  }

  // ------------------------------------------------------------------ scrub

  let activeReel = "";

  function scrub(id, index) {
    manager.focus(id, index);
    const total = countOf(id);
    const page = Math.floor(index / SHEET_CELLS);
    // Never scroll onto a frame whose page has not been asked for.
    wantPage(id, page, 6);
    wantPage(id, page + 1, 9);
    wantPage(id, page - 1, 9);
    const previous = Number.isFinite(shown.get(id)) ? shown.get(id) : index;
    const forward = index >= previous;
    for (let step = 0; step <= (forward ? RUNWAY_AHEAD : RUNWAY_BEHIND); step += 1) {
      const ahead = forward ? index + step : index - step;
      const behind = forward ? index - step : index + step;
      if (ahead >= 0 && ahead < total) manager.want(id, ahead, 10 + step);
      if (step && behind >= 0 && behind < total) manager.want(id, behind, 20 + step);
    }
    // Crossing into a reel pulls the next one in fully, as asked: at reel 2 the
    // third reel completes, at reel 3 the fourth does.
    if (id !== activeReel) {
      activeReel = id;
      const next = order[order.indexOf(id) + 1];
      if (next) fillReel(next, 14);
    }
    paint(id, index, SHOW_GAP + 40);
  }

  function fillReel(id, priority = 40) {
    const pages = pageCount(id);
    for (let page = 0; page < pages; page += 1) wantPage(id, page, priority);
  }

  function still(id) {
    manager.focus(id, 0);
    manager.want(id, 0, 1);
    wantPage(id, 0, 1);
    paint(id, 0, 60);
  }

  function prewarm(id) {
    const next = order[order.indexOf(id) + 1];
    if (next) fillReel(next, 30);
  }

  // ------------------------------------------------------------- bootloader

  // The plan the concierge screen waits on: close to the whole first film and
  // most of the others, expressed in pages rather than frames.
  const GATE_FIRST = 0.9;
  const GATE_REST = 0.8;

  function gatePlan() {
    const pages = [];
    order.forEach((id, at) => {
      const total = pageCount(id);
      const want = Math.ceil(total * (at === 0 ? GATE_FIRST : GATE_REST));
      for (let page = 0; page < want; page += 1) pages.push(pageKey(id, page));
    });
    const hero = order[0];
    const crispKeys = [];
    const head = Math.min(12, countOf(hero));
    for (let index = 0; index < head; index += 2) crispKeys.push(manager.key(hero, index));
    return { pages, crispKeys };
  }

  function pageProgress(keys) {
    if (!keys.length) return 1;
    let done = 0;
    for (const key of keys) {
      if (pageDone.has(key) || pageFailed.has(key)) done += 1;
    }
    return done / keys.length;
  }

  function boot(ready) {
    const overlay = document.getElementById("boot");
    const bar = document.getElementById("boot-bar");
    const percent = document.getElementById("boot-percent");
    const root = document.documentElement;

    if (!reels[order[0]] || !countOf(order[0])) {
      if (overlay) overlay.remove();
      ready();
      return;
    }

    // Posters first: four requests that guarantee every panel can paint.
    for (const id of order) {
      fetch(`assets/${id}.jpg?v=1`, { credentials: "same-origin" })
        .then((response) => (response.ok ? response.blob() : Promise.reject(new Error("poster"))))
        .then(decode)
        .then((bitmap) => {
          stills.set(id, bitmap);
          scheduleRepaint();
        })
        .catch(() => {});
    }

    const { pages, crispKeys } = gatePlan();
    manager.keep = new Set(order);
    manager.focus(order[0], 0);
    for (const key of pages) {
      const cut = key.lastIndexOf("/");
      wantPage(key.slice(0, cut), Number(key.slice(cut + 1)), 1);
    }
    for (const key of crispKeys) {
      const cut = key.lastIndexOf("/");
      manager.want(key.slice(0, cut), Number(key.slice(cut + 1)), 30);
    }

    if (overlay) {
      overlay.hidden = false;
      root.classList.add("is-booting");
    }

    const close = () => {
      manager.booted = true;
      offPages();
      offCrisp();
      root.classList.remove("is-booting");
      if (overlay) {
        overlay.classList.add("is-done");
        setTimeout(() => {
          overlay.hidden = true;
          overlay.remove();
        }, 900);
      }
      ready();
      scheduleRepaint();
    };

    let opened = false;
    const finish = () => {
      if (opened) return;
      const pageShare = pageProgress(pages);
      const crispShare = manager.progress(crispKeys);
      const overall = (pageShare * pages.length + crispShare * crispKeys.length) / Math.max(1, pages.length + crispKeys.length);
      const shownPercent = Math.round(overall * 100);
      if (bar) bar.style.width = `${shownPercent}%`;
      if (percent) percent.textContent = `${shownPercent}%`;
      if (pageShare < 1 || crispShare < 0.5) return;
      opened = true;
      close();
      startBackground();
    };

    const offPages = onPage(finish);
    const offCrisp = manager.onChange(finish);
    finish();
    // Never trap the visitor behind a slow network.
    setTimeout(() => {
      if (opened) return;
      opened = true;
      close();
      startBackground();
    }, 15000);
  }

  // Everything the gate did not wait for: the rest of the pages in order, then
  // the crisp frames of the opening reel.
  function startBackground() {
    for (const id of order) fillReel(id, 400);
    const hero = order[0];
    const total = countOf(hero);
    for (let index = 0; index < Math.min(total, 120); index += 1) manager.want(hero, index, 500 + index);
  }

  // --------------------------------------------------------------- plumbing

  function refresh() {
    shown.clear();
    painted.clear();
    scheduleRepaint();
  }

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refresh();
  });
  window.addEventListener("pageshow", refresh);
  window.addEventListener("orientationchange", refresh);
  window.addEventListener("resize", refresh);

  function totalPages() {
    let total = 0;
    for (const id of order) total += pageCount(id);
    return total;
  }

  function startDebug() {
    const panel = document.createElement("pre");
    panel.style.cssText = "position:fixed;left:8px;bottom:8px;z-index:10000;margin:0;padding:8px 10px;font:11px/1.45 ui-monospace,monospace;color:#9fe8c0;background:rgba(0,0,0,.86);border:1px solid rgba(255,255,255,.18);white-space:pre-wrap;max-width:94vw;pointer-events:none";
    document.body.appendChild(panel);
    const errors = [];
    window.addEventListener("error", (event) => errors.push(String(event.message || "error").slice(0, 80)));
    window.addEventListener("unhandledrejection", (event) => {
      const reason = event.reason;
      errors.push(String((reason && reason.message) || reason || "rejection").slice(0, 80));
    });
    setInterval(() => {
      const state = window.PSMFilm.debug();
      panel.textContent = [
        `tier ${state.tier} booted ${window.PSMFilm.booted}`,
        `pages ${pageDone.size}/${totalPages()} dec ${sheets.size} q ${pageQueue.length} act ${pageActive}`,
        `crisp ${state.loaded} dec ${state.decoded} q ${state.queued}`,
        `paint ${JSON.stringify(state.painted)}`,
        errors.length ? `err ${errors.slice(-2).join(" | ")}` : "err none",
      ].join("\n");
    }, 600);
  }

  function init(config) {
    reels = config.reels || {};
    order = Object.keys(reels);
    manager.focus(order[0] || "shot-1", 0);
    window.PSMFilm.reels = reels;
    boot(config.ready || (() => {}));
    if (/[?&]debug=1/.test(location.search)) startDebug();
  }

  window.PSMFilm = {
    init,
    scrub,
    still,
    prewarm,
    manager,
    get booted() {
      return manager.booted;
    },
    debug() {
      return {
        tier: TIER,
        budget: CRISP_BUDGET,
        decoded: manager.bitmaps.size,
        queued: manager.queue.length,
        active: manager.active,
        loaded: manager.loaded.size,
        stills: stills.size,
        papers: sheets.size,
        shown: Object.fromEntries(shown),
        painted: Object.fromEntries(painted),
      };
    },
  };
})();
