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
  // Four slots for crisp frames and four for sheet pages: eight in flight over
  // HTTP/2, which is what the host will actually service.
  // Measured against this host: 8 streams is the sweet spot (8 pages in 3.0s)
  // and 16 is slower (4.9s) because the host throttles. Pages get most of the
  // slots; crisp frames only matter once a reel settles.
  const CONCURRENCY = 10;
  const TIER = window.__psmTier || "1280";
  const ASSET_VERSION = "v=5";
  // Decoded budgets. A crisp 1080 frame is 2.6 MB, a sheet page is 480*270*16
  // pixels = 8.3 MB, so both are capped hard.
  const CRISP_BUDGET = TIER === "1280" ? 30 : TIER === "1080" ? 32 : 72;
  const SHEET_CELLS = 16;
  const SHEET_COLS = 4;
  // 320x180 cells: a whole page is 62 KB, so the gate's 34 pages are ~2 MB.
  // The scroll is carried at this size and the crisp frame takes over the
  // moment the reel settles, which is where the sharpness actually matters.
  const SHEET_W = 320;
  const SHEET_H = 180;
  const SHEET_KEEP = 5;
  const SHEET_SLOTS = 8;
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
  // The opening reel is drawn from frames. Every reel after it is a single
  // 540p stream: one request instead of eight pages, decoded in hardware, and
  // the phone's CPU stays free for the scroll itself.
  const videos = new Map();
  const videoBroken = new Set();

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
  // Pages the gate has downloaded but not yet decoded. Decoding ten 1280x720
  // bitmaps during the concierge gate blocks the main thread for close to two
  // seconds on a throttled phone, so a page is decoded only when it is about
  // to be drawn.
  const sheetBlobs = new Map();
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
      .then((blob) => {
        pageDone.add(job.key);
        sheetBlobs.set(job.key, blob);
        done();
      })
      .catch(() => {
        pageFailed.add(job.key);
        done();
      });
  }

  // Decoded page if it is here, otherwise start decoding it and paint once it
  // lands.
  function pageBitmap(key) {
    const bitmap = sheets.get(key);
    if (bitmap) return bitmap;
    const blob = sheetBlobs.get(key);
    if (!blob) return null;
    sheetBlobs.delete(key);
    decode(blob)
      .then((decoded) => {
        sheets.set(key, decoded);
        const cut = key.lastIndexOf("/");
        trimSheets(key.slice(0, cut), Number(key.slice(cut + 1)));
        scheduleRepaint();
      })
      .catch(() => {});
    return null;
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
    const sourceW = hasRect ? sw : bitmap.videoWidth || bitmap.width;
    const sourceH = hasRect ? sh : bitmap.videoHeight || bitmap.height;
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
      const video = videoFor(reel);
      if (video) {
        if (video.readyState >= 2) drawVideo(reel, video);
        else scrubVideo(reel, video, index);
        return;
      }
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
    let bitmap = pageBitmap(pageKey(id, page));
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
    const video = videoFor(id);
    if (video) {
      if (id !== activeReel) {
        activeReel = id;
        prewarm(id);
      }
      scrubVideo(id, video, index);
      return;
    }
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
    if (!next) return;
    const video = videoFor(next);
    if (video) return;
    fillReel(next, 30);
  }

  // ------------------------------------------------------------------ video

  function videoFor(id) {
    // order is empty until init runs; without this guard a scrub arriving
    // early would build a player for the hero and pull its 41 MB master.
    if (!order.length || id === order[0] || videoBroken.has(id)) return null;
    const existing = videos.get(id);
    if (existing) return existing;
    const video = document.createElement("video");
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("muted", "");
    video.preload = "auto";
    video.addEventListener("seeked", () => {
      if (video.dataset.pending !== undefined) drawVideo(id, video);
    });
    video.addEventListener("loadeddata", () => {
      if (video.dataset.pending !== undefined) drawVideo(id, video);
    });
    video.addEventListener("error", () => {
      videoBroken.add(id);
      videos.delete(id);
    });
    video.src = `assets/video/${id}.mp4?v=1`;
    video.load();
    videos.set(id, video);
    return video;
  }

  function drawVideo(id, video) {
    if (video.readyState < 2) return false;
    const mark = `v:${video.currentTime.toFixed(2)}`;
    if (painted.get(id) === mark) return true;
    if (!draw(id, video)) return false;
    painted.set(id, mark);
    return true;
  }

  function scrubVideo(id, video, index) {
    manager.focus(id, index);
    shown.set(id, index);
    video.dataset.pending = String(index);
    if (video.readyState < 2) {
      // Mid-seek the decoder reports no frame; hold what is already drawn
      // rather than dropping back to the poster and flickering.
      if (painted.has(id)) return;
      const still = stills.get(id);
      if (still && draw(id, still)) painted.set(id, `p:${still.width}x${still.height}`);
      return;
    }
    const total = Math.max(1, countOf(id) - 1);
    const duration = video.duration || reels[id].duration || 1;
    const want = (index / total) * Math.max(0, duration - 0.05);
    if (Math.abs(video.currentTime - want) > 0.07) {
      try {
        video.currentTime = want;
      } catch (err) {
        /* the next scroll tick tries again */
      }
      return;
    }
    drawVideo(id, video);
  }

  // ------------------------------------------------------------- bootloader

  // The plan the concierge screen waits on: close to the whole first film and
  // most of the others, expressed in pages rather than frames.
  // 90% + 80% is 34 pages, which this host cannot deliver in under twelve
  // seconds. The gate therefore takes the whole first reel (so the film you
  // land on is complete and cannot stutter) plus the opening pages of the
  // others, which is enough that no reel can look empty. The rest arrives on
  // approach: each reel is ~0.6 MB, about four seconds of scrolling away.
  const GATE_REST_PAGES = 2;
  const GATE_PAGES = 2;
  // The gate is a greeting, not a download screen. It opens on the first
  // thirty-two frames and three crisp stills, then the rest of the reel fills in
  // behind the scroll: painting the film progressively is worth far more to
  // how fast the page feels than holding a curtain until everything lands.
  const GATE_MIN_MS = 700;
  const GATE_MAX_MS = 5000;

  function gatePlan() {
    const pages = [];
    // Only the opening reel is frames now; the others are streams that start
    // filling the moment the gate lifts, so preloading their pages would be
    // wasted bytes.
    const hero = order[0];
    // Five pages is eighty frames, three screens of film: enough that the
    // opening scroll never reaches the edge of what is ready, and 280 KB
    // instead of 560 KB, which is what the gate's own duration costs.
    const total = Math.min(GATE_PAGES, pageCount(hero));
    for (let page = 0; page < total; page += 1) pages.push(pageKey(hero, page));
    const crispKeys = [];
    const head = Math.min(6, countOf(hero));
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

    // Posters first: four requests that guarantee every panel can paint. The
    // opening one is what the gate fades away to if the film is not ready.
    const loadPosters = () => {
      for (const id of order) {
        if (stills.has(id)) continue;
        fetch(`assets/${id}.jpg?v=1`, { credentials: "same-origin" })
          .then((response) => (response.ok ? response.blob() : Promise.reject(new Error("poster"))))
          .then(decode)
          .then((bitmap) => {
            stills.set(id, bitmap);
            scheduleRepaint();
          })
          .catch(() => {});
      }
    };

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
      // Surfaced for ?debug=1 so the boot time can be read on a real phone.
      window.__psmGateMs = Math.round(performance.now());
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
    loadPosters();

    let opened = false;
    let lastPercent = -1;
    const bootedAt = performance.now();
    const finish = () => {
      if (opened) return;
      const pageShare = pageProgress(pages);
      const crispShare = manager.progress(crispKeys);
      const overall = (pageShare * pages.length + crispShare * crispKeys.length) / Math.max(1, pages.length + crispKeys.length);
      const shownPercent = Math.round(overall * 100);
      // Repainting the gate is not free on a throttled phone: only touch the
      // DOM when the number actually changes.
      if (shownPercent !== lastPercent) {
        lastPercent = shownPercent;
        if (bar) bar.style.width = `${shownPercent}%`;
        if (percent) percent.textContent = `${shownPercent}%`;
      }
      if (pageShare < 1 || crispShare < 0.5) return;
      if (performance.now() - bootedAt < GATE_MIN_MS) {
        setTimeout(finish, GATE_MIN_MS);
        return;
      }
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
    }, GATE_MAX_MS);
  }

  // Everything the gate did not wait for: the rest of the pages in order, then
  // the crisp frames of the opening reel.
  function startBackground() {
    const hero = order[0];
    fillReel(hero, 400);
    const total = countOf(hero);
    for (let index = 0; index < Math.min(total, 24); index += 1) manager.want(hero, index, 500 + index);
    // Everything after the opening reel is one stream each. Nothing is spent
    // on them until the visitor moves: 3.5 MB of film that nobody has asked
    // for is a cost, not a feature.
    const startVideos = () => {
      for (const id of order.slice(1)) videoFor(id);
    };
    const onMove = () => {
      window.removeEventListener("scroll", onMove, { capture: true });
      window.removeEventListener("pointerdown", onMove, { capture: true });
      startVideos();
    };
    window.addEventListener("scroll", onMove, { capture: true, passive: true });
    window.addEventListener("pointerdown", onMove, { capture: true, passive: true });
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
        videos: [...videos.entries()].map(([id, video]) => [id, video.readyState, Number(video.duration || 0).toFixed(1), Number(video.buffered.length ? video.buffered.end(video.buffered.length - 1) : 0).toFixed(1)]),
        videoBroken: [...videoBroken],
      };
    },
  };
})();
