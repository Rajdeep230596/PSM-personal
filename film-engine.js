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
  const SHEET_KEEP = 16;
  const SHEET_SLOTS = 8;
  // Phones scrub from sprite pages. iOS will not present a canvas that lives
  // inside position: sticky, and it will not show a new video frame from a seek,
  // so both of those paths stay on the opening picture.
  // iPhone and iPad, including an iPad with a keyboard. iPadOS reports itself
  // as a Mac, so the touch points are what still mark it as an iPad. A MacBook
  // has none, and it can paint the canvas, so it keeps that path.
  const appleTouch = /iPhone|iPad|iPod/.test(navigator.userAgent || "")
    || ((navigator.maxTouchPoints || 0) > 1 && /Macintosh/.test(navigator.userAgent || ""));
  const phoneFilm = appleTouch || window.matchMedia("(hover: none) and (pointer: coarse)").matches;
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
  // Every reel is drawn from the crisp stills. The 720p streams for shots 2–4
  // were soft enough that the jet, the crew and the car lost their edges once
  // the picture was scaled up, so they are not used.
  const videos = new Map();
  const videoBroken = new Set();

  function crispUrl(id, index) {
    return `assets/frames/${TIER}/${id}/${String(index).padStart(3, "0")}.webp?${ASSET_VERSION}`;
  }

  function sheetUrl(id, page) {
    return `assets/frames/sheet/${id}/${String(page).padStart(2, "0")}.webp?${ASSET_VERSION}`;
  }

  // iPhone 17 never completed a canvas frame. The boot percentage stayed at 0
  // until the timeout because fetch() plus a blob decode never settled, and the
  // empty canvas (black) was then laid over the poster. A plain image is the
  // surface that phone actually paints. Requests are aborted if they stall so
  // one hung download cannot pin every connection.
  const phoneReady = new Set();
  const phoneFailed = new Set();
  const phoneQueued = new Set();
  const phoneQueue = [];
  const phoneListeners = new Set();
  let phoneActive = 0;
  let phoneSeq = 0;
  let phonePlay = { reel: "", index: 0 };
  let stageFront = null;
  let stageBack = null;
  let stageToken = 0;
  const PHONE_SLOTS = 4;
  const PHONE_TIMEOUT_MS = 7000;

  function onPhone(listener) {
    phoneListeners.add(listener);
    return () => phoneListeners.delete(listener);
  }

  function emitPhone() {
    for (const listener of phoneListeners) listener();
  }

  function wantPhone(id, index, priority) {
    if (!phoneFilm || index < 0 || index >= countOf(id)) return;
    const key = `${id}/${index}`;
    if (phoneReady.has(key) || phoneFailed.has(key) || phoneQueued.has(key)) return;
    phoneQueued.add(key);
    phoneQueue.push({ id, index, key, priority, seq: phoneSeq++ });
    phoneQueue.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
    pumpPhone();
  }

  function pumpPhone() {
    while (phoneActive < PHONE_SLOTS && phoneQueue.length) {
      const job = phoneQueue.shift();
      phoneQueued.delete(job.key);
      phoneActive += 1;
      const image = new Image();
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        image.onload = null;
        image.onerror = null;
        phoneActive -= 1;
        if (ok && image.naturalWidth > 0) phoneReady.add(job.key);
        else {
          image.src = "";
          phoneFailed.add(job.key);
        }
        emitPhone();
        if (ok) scheduleRepaint();
        pumpPhone();
      };
      const timer = window.setTimeout(() => {
        image.onload = null;
        image.onerror = null;
        image.src = "";
        finish(false);
      }, PHONE_TIMEOUT_MS);
      image.onload = () => finish(true);
      image.onerror = () => finish(false);
      image.src = crispUrl(job.id, job.index);
    }
  }

  function nearestPhone(id, index) {
    const total = countOf(id);
    for (let delta = 0; delta <= 6; delta += 1) {
      const ahead = index + delta;
      const behind = index - delta;
      if (ahead < total && phoneReady.has(`${id}/${ahead}`)) return ahead;
      if (delta && behind >= 0 && phoneReady.has(`${id}/${behind}`)) return behind;
    }
    return -1;
  }

  function ensureStages() {
    if (stageFront) return;
    const host = document.getElementById("screen");
    if (!host) return;
    const make = () => {
      const image = document.createElement("img");
      image.className = "film-stage";
      image.alt = "";
      image.decoding = "async";
      // visibility, not display:none. iOS will not load an image that is
      // display:none, which would leave the film on the poster forever.
      image.style.visibility = "hidden";
      host.appendChild(image);
      return image;
    };
    stageFront = make();
    stageBack = make();
  }

  function presentPhone(id, index) {
    phonePlay = { reel: id, index };
    ensureStages();
    if (!stageFront) return;
    const total = countOf(id);
    for (let step = 0; step <= 16; step += 1) {
      if (index + step < total) wantPhone(id, index + step, step);
      if (step && index - step >= 0) wantPhone(id, index - step, 6 + step);
    }
    const frame = nearestPhone(id, index);
    if (frame < 0) return;
    markGrade(id);
    const url = crispUrl(id, frame);
    const mark = `i:${frame}`;
    if (painted.get(id) === mark) {
      if (placeStage(id)) stageFront.style.visibility = "visible";
      return;
    }
    const absolute = new URL(url, document.baseURI).href;
    if (stageBack.dataset.pending === absolute) return;
    stageBack.dataset.pending = absolute;
    const token = String(++stageToken);
    stageBack.dataset.token = token;
    const reveal = () => {
      if (stageBack.dataset.token !== token || !stageBack.naturalWidth) return;
      if (!placeStage(id)) {
        stageBack.dataset.pending = "";
        return;
      }
      stageBack.style.visibility = "visible";
      stageFront.style.visibility = "hidden";
      const previous = stageFront;
      stageFront = stageBack;
      stageBack = previous;
      stageBack.dataset.pending = "";
      painted.set(id, mark);
      shown.set(id, frame);
      document.documentElement.classList.add("has-film-stage");
    };
    stageBack.onload = reveal;
    stageBack.onerror = () => {
      stageBack.dataset.pending = "";
    };
    if (stageBack.src === absolute && stageBack.complete && stageBack.naturalWidth) {
      reveal();
      return;
    }
    stageBack.src = url;
  }

  function countOf(id) {
    const reel = reels[id];
    return reel ? reel.count : 0;
  }

  function pageCount(id) {
    return Math.ceil(countOf(id) / SHEET_CELLS);
  }

  function release(bitmap) {
    if (bitmap && bitmap.__url) {
      URL.revokeObjectURL(bitmap.__url);
      bitmap.__url = "";
    }
    if (bitmap && typeof bitmap.close === "function") bitmap.close();
  }

  function decode(blob) {
    // createImageBitmap on iOS often draws once and then sticks. An Image
    // element keeps presenting new frames to the canvas.
    if (!phoneFilm && typeof window.createImageBitmap === "function") {
      return window.createImageBitmap(blob).catch(() => decodeWithImage(blob));
    }
    return decodeWithImage(blob);
  }

  function decodeWithImage(blob) {
    return new Promise((resolve, reject) => {
      const scratch = URL.createObjectURL(blob);
      const image = new Image();
      image.onload = () => {
        // iOS draws a blank frame if the blob URL is revoked while the
        // image is still the canvas source. Release it with the bitmap.
        // image.decode() is not waited on: on iPhone 17 it never settles,
        // the slot stays busy, and the boot screen sits at 0%.
        image.__url = scratch;
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
      const slots = phoneFilm ? 6 : CONCURRENCY - 2;
      while (this.active < slots && this.queue.length) {
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
      // Phones never fetch frames. On iPhone 17 those fetches never settled and
      // the boot screen stayed at 0% until it gave up.
      if (phoneFilm) {
        this.failed.add(job.key);
        done();
        return;
      }
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
    const slots = phoneFilm ? 4 : SHEET_SLOTS;
    while (pageActive < slots && pageQueue.length) {
      const job = pageQueue.shift();
      pageQueued.delete(job.key);
      pageActive += 1;
      loadPage(job);
    }
  }

  const decoding = new Set();

  function loadPage(job) {
    const done = () => {
      pageActive -= 1;
      for (const listener of pageListeners) listener(job);
      scheduleRepaint();
      pumpPages();
    };
    if (phoneFilm) {
      pageFailed.add(job.key);
      done();
      return;
    }
    fetch(sheetUrl(job.id, job.page), { credentials: "same-origin" })
      .then((response) => {
        if (!response.ok) throw new Error(`page ${response.status}`);
        return response.blob();
      })
      .then((blob) => {
        // Keep the bytes. Trimmed bitmaps can be decoded again without another
        // download, which is what makes a second pass through a reel instant.
        sheetBlobs.set(job.key, blob);
        // The opening reel is decoded before the slot is freed, so the gate
        // cannot open on a film that is still a poster. Later reels decode
        // off to the side and do not hold up the download.
        if (phoneFilm && order[0] && job.id !== order[0]) {
          pageDone.add(job.key);
          pageBitmap(job.key);
          done();
          return;
        }
        return decode(blob).then((bitmap) => {
          sheets.set(job.key, bitmap);
          pageDone.add(job.key);
          trimSheets();
          done();
        });
      })
      .catch(() => {
        pageFailed.add(job.key);
        done();
      });
  }

  // Bitmap if it is decoded. If the bytes are already here, decode them and
  // paint on the next frame instead of going back to the network.
  function pageBitmap(key) {
    const bitmap = sheets.get(key);
    if (bitmap) return bitmap;
    const blob = sheetBlobs.get(key);
    if (!blob || decoding.has(key)) return null;
    decoding.add(key);
    decode(blob)
      .then((decoded) => {
        decoding.delete(key);
        sheets.set(key, decoded);
        const cut = key.lastIndexOf("/");
        trimSheets(key.slice(0, cut), Number(key.slice(cut + 1)));
        scheduleRepaint();
      })
      .catch(() => {
        decoding.delete(key);
      });
    return null;
  }

  // Keep the pages around the playhead, close the rest. Blobs stay.
  function trimSheets() {
    if (!manager.booted) return;
    const headId = manager.playhead.reel || order[0] || "";
    const nextId = order[order.indexOf(headId) + 1] || "";
    const budget = Math.max(SHEET_KEEP, pageCount(headId) + (nextId ? pageCount(nextId) : 0));
    if (sheets.size <= budget) return;
    const headPage = Math.floor((manager.playhead.index || 0) / SHEET_CELLS);
    const scored = [];
    for (const [key, bitmap] of sheets) {
      const cut = key.lastIndexOf("/");
      const reelId = key.slice(0, cut);
      const pageIndex = Number(key.slice(cut + 1));
      let distance = 500 + pageIndex;
      if (reelId === headId) distance = Math.abs(pageIndex - headPage);
      else if (reelId === nextId) distance = 40 + pageIndex;
      scored.push({ key, bitmap, distance });
    }
    scored.sort((a, b) => b.distance - a.distance);
    for (let i = 0; i < scored.length && sheets.size > budget; i += 1) {
      release(scored[i].bitmap);
      sheets.delete(scored[i].key);
    }
  }

  function onPage(listener) {
    pageListeners.add(listener);
    return () => pageListeners.delete(listener);
  }

  // ----------------------------------------------------------------- canvas

  let stageCanvas = null;

  function staging() {
    return phoneFilm && !document.documentElement.classList.contains("force-landscape");
  }

  function ensureStage() {
    if (stageCanvas) return stageCanvas;
    const host = document.getElementById("screen");
    if (!host) return null;
    const canvas = document.createElement("canvas");
    canvas.className = "film-stage";
    canvas.hidden = true;
    canvas.setAttribute("aria-hidden", "true");
    host.appendChild(canvas);
    stageCanvas = canvas;
    return canvas;
  }

  // The picture band inside a full-screen sticky, matching object-fit: contain
  // on a 16:9 frame. The canvas sits on this band, above the scroller. iOS
  // will not show a canvas painted behind a scrolling layer, which is why the
  // film turned into a black panel.
  function filmBand(rect) {
    const ratio = 16 / 9;
    let width = rect.width;
    let height = width / ratio;
    if (height > rect.height) {
      height = rect.height;
      width = height * ratio;
    }
    return {
      left: rect.left + (rect.width - width) / 2,
      top: rect.top + (rect.height - height) / 2,
      width,
      height,
    };
  }

  function placeStage(id) {
    const nodes = [stageFront, stageBack, stageCanvas].filter(Boolean);
    const sticky = document.querySelector(`#${id} .shot-sticky`);
    const host = document.getElementById("screen");
    if (!nodes.length || !sticky || !host) return false;
    const hostRect = host.getBoundingClientRect();
    const band = filmBand(sticky.getBoundingClientRect());
    const visible = band.width > 8 && band.height > 8 && band.top + band.height > hostRect.top + 4 && band.top < hostRect.bottom - 4;
    if (!visible) {
      for (const node of nodes) node.style.visibility = "hidden";
      return false;
    }
    for (const node of nodes) {
      node.style.left = `${band.left - hostRect.left}px`;
      node.style.top = `${band.top - hostRect.top}px`;
      node.style.width = `${band.width}px`;
      node.style.height = `${band.height}px`;
      node.style.right = "auto";
      node.style.bottom = "auto";
    }
    return true;
  }

  function surface(id) {
    if (staging()) return ensureStage();
    document.documentElement.classList.remove("has-film-stage");
    if (stageCanvas) stageCanvas.hidden = true;
    if (canvases.has(id)) return canvases.get(id);
    const canvas = document.querySelector(`#${id} canvas.shot-frame`);
    if (canvas) canvases.set(id, canvas);
    return canvas || null;
  }

  function fullFrame() {
    if (document.documentElement.classList.contains("force-landscape")) return false;
    const width = window.innerWidth || 1;
    const height = window.innerHeight || 1;
    const ratio = width / height;
    // Taller than a MacBook, or wider than an iPhone on its side.
    return ratio <= 16 / 10 || ratio >= 19 / 10;
  }

  function fitOf(id) {
    // These screens are not 16:9. Cover would cut the jet, the crew and the car.
    if (fullFrame()) return "contain";
    if (fits.has(id)) return fits.get(id);
    const picture = document.querySelector(`#${id} img.shot-video`);
    if (!picture) return "cover";
    const fit = getComputedStyle(picture).objectFit || "cover";
    fits.set(id, fit);
    return fit;
  }

  // Shot 1's grade: the same curve as the #shot1-blacks filter. It is baked into
  // the picture that plays, because a CSS filter on the canvas sticks on iOS.
  const GRADED = { "shot-2": 1, "shot-3": 1, "shot-4": 1 };
  const GRADE_STOPS = [0, 0.056, 0.112, 0.168, 0.24, 0.344, 0.474, 0.625, 0.748, 0.865, 1];
  const GRADE_LUT = new Uint8ClampedArray(256);
  for (let step = 0; step < 256; step += 1) {
    const position = (step / 255) * 10;
    const lower = Math.floor(position);
    const upper = Math.min(10, lower + 1);
    const mix = position - lower;
    GRADE_LUT[step] = Math.round((GRADE_STOPS[lower] * (1 - mix) + GRADE_STOPS[upper] * mix) * 255);
  }
  const gradeCache = new WeakMap();

  function markGrade(id) {
    const on = !!GRADED[id];
    if (stageFront) stageFront.classList.toggle("is-shot1-grade", on);
    if (stageBack) stageBack.classList.toggle("is-shot1-grade", on);
  }

  function gradedSource(bitmap) {
    const cached = gradeCache.get(bitmap);
    if (cached) return cached;
    const width = bitmap.videoWidth || bitmap.width;
    const height = bitmap.videoHeight || bitmap.height;
    if (!width || !height) return bitmap;
    const copy = document.createElement("canvas");
    copy.width = width;
    copy.height = height;
    const context = copy.getContext("2d", { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0, width, height);
    const image = context.getImageData(0, 0, width, height);
    const data = image.data;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = GRADE_LUT[data[i]];
      data[i + 1] = GRADE_LUT[data[i + 1]];
      data[i + 2] = GRADE_LUT[data[i + 2]];
    }
    context.putImageData(image, 0, 0);
    gradeCache.set(bitmap, copy);
    return copy;
  }

  // Draws a bitmap, or a cell of a sheet, into the reel's canvas with the same
  // framing the poster uses (cover or contain, centred).
  function draw(id, bitmap, sx, sy, sw, sh) {
    const canvas = surface(id);
    if (!canvas || !bitmap) return false;
    if (canvas === stageCanvas) {
      document.documentElement.classList.add("has-film-stage");
      if (!placeStage(id)) return false;
    }
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width < 2 || height < 2) return false;
    const scale = Math.min(window.devicePixelRatio || 1, phoneFilm ? 3 : 2);
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
    const context = canvas.getContext("2d");
    if (!context) return false;
    const source = GRADED[id] && !(bitmap instanceof HTMLVideoElement) ? gradedSource(bitmap) : bitmap;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.fillStyle = "#050607";
    context.fillRect(0, 0, targetW, targetH);
    if (hasRect) {
      context.drawImage(source, sx, sy, sourceW, sourceH, (targetW - drawW) / 2, (targetH - drawH) / 2, drawW, drawH);
    } else {
      context.drawImage(source, (targetW - drawW) / 2, (targetH - drawH) / 2, drawW, drawH);
    }
    if (GRADED[id] && bitmap instanceof HTMLVideoElement) {
      const frame = context.getImageData(0, 0, targetW, targetH);
      const data = frame.data;
      for (let i = 0; i < data.length; i += 4) {
        data[i] = GRADE_LUT[data[i]];
        data[i + 1] = GRADE_LUT[data[i + 1]];
        data[i + 2] = GRADE_LUT[data[i + 2]];
      }
      context.putImageData(frame, 0, 0);
    }
    if (canvas === stageCanvas) canvas.hidden = false;
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
      if (phoneFilm) {
        const reel = phonePlay.reel || order[0];
        if (!reel || !manager.booted) return;
        presentPhone(reel, phonePlay.reel ? phonePlay.index : 0);
        return;
      }
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

  function paint(id, index) {
    // Full frames only. The 320px sheet, scaled to the screen, is the blur,
    // and replacing it with the real frame a moment later is the flicker.
    const crisp = manager.nearest(id, index, 4);
    if (crisp) {
      const mark = `c:${crisp.index}`;
      if (painted.get(id) === mark) return true;
      if (draw(id, crisp.bitmap)) {
        painted.set(id, mark);
        shown.set(id, crisp.index);
        return true;
      }
    }
    if (painted.has(id)) {
      if (staging()) placeStage(id);
      return true;
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
    if (phoneFilm) {
      presentPhone(id, index);
      if (id !== activeReel) {
        activeReel = id;
        const total = countOf(id);
        for (let frame = 0; frame < total; frame += 1) wantPhone(id, frame, 20 + frame);
        const next = order[order.indexOf(id) + 1];
        const head = next ? Math.min(24, countOf(next)) : 0;
        for (let frame = 0; frame < head; frame += 1) wantPhone(next, frame, 60 + frame);
      }
      return;
    }
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
    const previous = Number.isFinite(shown.get(id)) ? shown.get(id) : index;
    const forward = index >= previous;
    for (let step = 0; step <= (forward ? RUNWAY_AHEAD : RUNWAY_BEHIND); step += 1) {
      const ahead = forward ? index + step : index - step;
      const behind = forward ? index - step : index + step;
      if (ahead >= 0 && ahead < total) manager.want(id, ahead, 1 + step);
      if (step && behind >= 0 && behind < total) manager.want(id, behind, 3 + step);
    }
    // The next reel gets a short run of full frames. Sprite sheets are not
    // drawn, and asking for them here only delays the frame on screen.
    if (id !== activeReel) {
      activeReel = id;
      const next = order[order.indexOf(id) + 1];
      const head = next ? Math.min(24, countOf(next)) : 0;
      for (let frame = 0; frame < head; frame += 1) manager.want(next, frame, 30 + frame);
    }
    paint(id, index, SHOW_GAP + 40);
  }

  // Asks for the pages under a reel that is near, without painting over the
  // one the stage is showing.
  function prepare(id, index) {
    if (phoneFilm) {
      wantPhone(id, index, 12);
      wantPhone(id, index + 1, 13);
      wantPhone(id, index - 1, 14);
      return;
    }
    manager.want(id, index, 12);
    manager.want(id, index + 1, 13);
    manager.want(id, index - 1, 14);
  }

  function fillReel(id, priority = 40) {
    const pages = pageCount(id);
    for (let page = 0; page < pages; page += 1) wantPage(id, page, priority);
  }

  function still(id) {
    if (phoneFilm) {
      wantPhone(id, 0, 1);
      presentPhone(id, 0);
      return;
    }
    manager.focus(id, 0);
    manager.want(id, 0, 1);
    paint(id, 0, 60);
  }

  function prewarm(id) {
    const next = order[order.indexOf(id) + 1];
    if (!next) return;
    if (phoneFilm) {
      const head = Math.min(16, countOf(next));
      for (let index = 0; index < head; index += 1) wantPhone(next, index, 12 + index);
      return;
    }
    const head = Math.min(24, countOf(next));
    for (let frame = 0; frame < head; frame += 1) manager.want(next, frame, 30 + frame);
  }

  // ------------------------------------------------------------------ video

  function videoFor() {
    // The 720p files smear the jet, the crew and the car once they are scaled
    // up. Every reel is drawn from the crisp stills instead.
    return null;
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
  const GATE_PAGES = 2;
  // The gate is a greeting, not a download screen, on a desktop where the
  // stream can keep up. On a phone it waits until the frames are decoded:
  // scrolling into a page that is still in flight is what feels stuck.
  const GATE_MIN_MS = 250;
  const GATE_MAX_MS = phoneFilm ? 1200 : 700;

  function gatePlan() {
    const pages = [];
    const hero = order[0];
    // Phone: the whole opening reel, decoded, before the curtain lifts.
    // Desktop: the first two pages, then the stream takes over.
    const total = phoneFilm ? pageCount(hero) : Math.min(GATE_PAGES, pageCount(hero));
    for (let page = 0; page < total; page += 1) pages.push(pageKey(hero, page));
    const crispKeys = [];
    const head = Math.min(phoneFilm ? 36 : 6, countOf(hero));
    const stride = phoneFilm ? 1 : 2;
    for (let index = 0; index < head; index += stride) crispKeys.push(manager.key(hero, index));
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

    const hero = order[0];
    const phoneHead = Math.min(6, countOf(hero));
    const { pages, crispKeys } = gatePlan();
    manager.keep = new Set(order);
    manager.focus(hero, 0);
    if (!phoneFilm) loadPosters();
    if (phoneFilm) {
      for (let index = 0; index < phoneHead; index += 1) wantPhone(hero, index, index);
    } else {
      for (const key of crispKeys) {
        const cut = key.lastIndexOf("/");
        manager.want(key.slice(0, cut), Number(key.slice(cut + 1)), 1);
      }
    }

    if (overlay) {
      overlay.hidden = false;
      root.classList.add("is-booting");
    }

    const close = () => {
      manager.booted = true;
      trimSheets();
      // Surfaced for ?debug=1 so the boot time can be read on a real phone.
      window.__psmGateMs = Math.round(performance.now());
      offPages();
      offCrisp();
      offPhone();
      root.classList.remove("is-booting");
      if (overlay) {
        overlay.classList.add("is-done");
        setTimeout(() => {
          overlay.hidden = true;
          overlay.remove();
        }, 320);
      }
      ready();
      scheduleRepaint();
    };

    let opened = false;
    let lastPercent = -1;
    const bootedAt = performance.now();
    const finish = () => {
      if (opened) return;
      let shownPercent = 0;
      let readyToOpen = false;
      if (phoneFilm) {
        let done = 0;
        for (let index = 0; index < phoneHead; index += 1) {
          const key = `${hero}/${index}`;
          if (phoneReady.has(key) || phoneFailed.has(key)) done += 1;
        }
        const share = phoneHead ? done / phoneHead : 1;
        shownPercent = Math.round(share * 100);
        readyToOpen = done >= 2 || stills.has(hero);
      } else {
        shownPercent = 100;
        readyToOpen = true;
      }
      // Repainting the gate is not free on a throttled phone: only touch the
      // DOM when the number actually changes.
      if (shownPercent !== lastPercent) {
        lastPercent = shownPercent;
        if (bar) bar.style.width = `${shownPercent}%`;
        if (percent) percent.textContent = `${shownPercent}%`;
      }
      if (!readyToOpen) return;
      if (performance.now() - bootedAt < GATE_MIN_MS) {
        setTimeout(finish, GATE_MIN_MS);
        return;
      }
      opened = true;
      close();
      startBackground();
    };

    const offPages = phoneFilm ? () => {} : onPage(finish);
    const offCrisp = phoneFilm ? () => {} : manager.onChange(finish);
    const offPhone = phoneFilm ? onPhone(finish) : () => {};
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
    if (phoneFilm) {
      const count = countOf(hero);
      for (let index = 0; index < count; index += 1) wantPhone(hero, index, 8);
      return;
    }
    const total = countOf(hero);
    for (let index = 0; index < total; index += 1) manager.want(hero, index, 40 + index);
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
        `tier ${state.tier} booted ${window.PSMFilm.booted} phone ${phoneFilm}`,
        `img ${phoneReady.size} fail ${phoneFailed.size} q ${phoneQueue.length} act ${phoneActive}`,
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
    prepare,
    still,
    prewarm,
    staging,
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
