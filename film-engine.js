/* Progressive Stride Frame Engine
 *
 * One manager owns every film frame: it fetches through a hard concurrency
 * limit, decodes off the main thread with createImageBitmap, keeps only the
 * reels around the playhead in memory and paints the nearest decoded frame
 * into a canvas. The <img> underneath stays as the poster, so a panel is never
 * blank even before a single frame has arrived.
 */
(() => {
  const CONCURRENCY = 6;
  const DPR_CAP = 2;
  // Frames kept decoded at once. A 1080 frame is 1080x608x4 = 2.6 MB of GPU
  // memory, so this is the difference between 60 MB and a dead tab.
  const TIER = window.__psmTier || "1280";
  const BUDGET = TIER === "1280" ? 40 : TIER === "1080" ? 56 : 88;
  // Radius of the window kept warm around the playhead while scrolling.
  const RUNWAY_AHEAD = 24;
  const RUNWAY_BEHIND = 10;
  // The anti-freeze rule: never travel more than this many frames to find
  // something to draw, unless the scroll itself has already gone further.
  const SHOW_GAP = 20;

  let reels = {};
  let order = [];
  const canvases = new Map();
  const posters = new Map();
  const shown = new Map();

  function url(id, index) {
    return `assets/frames/${TIER}/${id}/${String(index).padStart(3, "0")}.jpg?v=3`;
  }

  function countOf(id) {
    const reel = reels[id];
    return reel ? reel.count : 0;
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

  class FrameManager {
    constructor() {
      this.bitmaps = new Map();
      this.queued = new Map();
      this.queue = [];
      this.active = 0;
      this.failed = new Set();
      this.keep = new Set();
      this.playhead = { reel: "", index: 0 };
      this.listeners = new Set();
      this.seq = 0;
      this.paused = false;
      this.booted = false;
      // Every frame that has ever been fetched. Eviction takes the bitmap, not
      // this record: the gate can finish without holding a reel in memory.
      this.loaded = new Set();
    }

    get count() {
      let total = 0;
      for (const id of order) total += countOf(id);
      return total;
    }

    key(id, index) {
      return `${id}/${index}`;
    }

    get(id, index) {
      if (index < 0 || index >= countOf(id)) return null;
      return this.bitmaps.get(this.key(id, index)) || null;
    }

    want(id, index, priority = 60) {
      if (this.paused) return;
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
      while (!this.paused && this.active < CONCURRENCY && this.queue.length) {
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
      fetch(url(job.id, job.index), { credentials: "same-origin" })
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

    // Only the active reel and its two neighbours stay decoded. Anything
    // further away is closed here and re-fetched from the browser's disk cache
    // if the visitor scrolls back.
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
      if (keep.size === this.keep.size && [...keep].every((item) => this.keep.has(item))) {
        this.evict();
        return;
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
      if (this.bitmaps.size <= BUDGET) return;
      const scored = [];
      for (const [key, bitmap] of this.bitmaps) {
        const cut = key.lastIndexOf("/");
        const id = key.slice(0, cut);
        const index = Number(key.slice(cut + 1));
        const distance = id === this.playhead.reel ? Math.abs(index - this.playhead.index) : 100000;
        scored.push({ key, bitmap, distance });
      }
      scored.sort((a, b) => b.distance - a.distance);
      for (let i = 0; i < scored.length && this.bitmaps.size > BUDGET; i += 1) {
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

  const manager = new FrameManager();

  // ------------------------------------------------------------------ canvas

  function surface(id) {
    if (canvases.has(id)) return canvases.get(id);
    const canvas = document.querySelector(`#${id} canvas.shot-frame`);
    if (canvas) canvases.set(id, canvas);
    return canvas || null;
  }

  function fitOf(id) {
    if (posters.has(id)) return posters.get(id);
    const picture = document.querySelector(`#${id} img.shot-video`);
    if (!picture) return "cover";
    const fit = getComputedStyle(picture).objectFit || "cover";
    posters.set(id, fit);
    return fit;
  }

  function draw(id, bitmap) {
    const canvas = surface(id);
    if (!canvas || !bitmap) return false;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width < 2 || height < 2) return false;
    const scale = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    const targetW = Math.round(width * scale);
    const targetH = Math.round(height * scale);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
    const source = bitmap.width ? bitmap : null;
    const sourceW = source ? source.width : targetW;
    const sourceH = source ? source.height : targetH;
    if (!sourceW || !sourceH) return false;
    const contain = fitOf(id) === "contain";
    const ratio = contain
      ? Math.min(targetW / sourceW, targetH / sourceH)
      : Math.max(targetW / sourceW, targetH / sourceH);
    const drawW = sourceW * ratio;
    const drawH = sourceH * ratio;
    // alpha: true matters. iOS discards the backing store of canvases that
    // have been offscreen for a while; an opaque canvas comes back as a solid
    // black rectangle, while a transparent one simply falls through to the
    // poster beneath it.
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return false;
    context.drawImage(bitmap, (targetW - drawW) / 2, (targetH - drawH) / 2, drawW, drawH);
    return true;
  }

  // A frame landing is the other half of the anti-freeze rule: if the picture
  // was waiting for something near the playhead, it must appear the moment it
  // arrives rather than waiting for the visitor to move again.
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
    // rAF coalesces a batch of arrivals into one paint, but it does not run in
    // a background tab and can stall on a busy phone. The timer is the guard.
    requestAnimationFrame(run);
    setTimeout(run, 120);
  }

  // iOS throws away canvas contents when the page is backgrounded or memory
  // tightens, and a resize reallocates them. Forget what was on screen and
  // redraw the playhead, otherwise the canvas stays empty until the next scroll.
  function refresh() {
    shown.clear();
    scheduleRepaint();
  }

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refresh();
  });
  window.addEventListener("pageshow", refresh);
  window.addEventListener("orientationchange", refresh);
  window.addEventListener("resize", refresh);

  function paint(id, index, distance) {
    const limit = Number.isFinite(shown.get(id)) ? Math.max(SHOW_GAP, Math.abs(index - shown.get(id))) : SHOW_GAP;
    const found = manager.nearest(id, index, Math.min(limit, distance));
    if (!found) return false;
    if (shown.get(id) === found.index) return true;
    if (!draw(id, found.bitmap)) return false;
    shown.set(id, found.index);
    return true;
  }

  // ----------------------------------------------------------------- scrub

  function scrub(id, index) {
    manager.focus(id, index);
    const total = countOf(id);
    const previous = Number.isFinite(shown.get(id)) ? shown.get(id) : index;
    const forward = index >= previous;
    for (let step = 0; step <= (forward ? RUNWAY_AHEAD : RUNWAY_BEHIND); step += 1) {
      const ahead = forward ? index + step : index - step;
      const behind = forward ? index - step : index + step;
      if (ahead >= 0 && ahead < total) manager.want(id, ahead, 10 + step);
      if (step && behind >= 0 && behind < total) manager.want(id, behind, 20 + step);
    }
    paint(id, index, SHOW_GAP + 40);
  }

  function still(id) {
    manager.focus(id, 0);
    manager.want(id, 0, 1);
    paint(id, 0, 60);
  }

  function prewarm(id) {
    const at = order.indexOf(id);
    const next = order[at + 1];
    if (!next) return;
    const total = Math.min(24, countOf(next));
    for (let index = 0; index < total; index += 1) manager.want(next, index, 30 + index);
  }

  // ------------------------------------------------------------- bootloader

  const BOOT_GATE = 0.5;
  // Half of every reel before the gate opens: every second frame of shot-1..N.
  // That is the coverage the scrubber needs to step through a whole reel, so no
  // reel opens on an empty panel even if the visitor flicks straight past one.
  // The frames behind the gate are cached, not held: memory stays at BUDGET and
  // a reel re-hydrates from disk in milliseconds when it comes into reach.
  const GATE_STRIDE = 2;
  // The very first screen of the hero, at full density, so the opening is
  // perfect the instant the overlay lifts.
  const HERO_FIRST = 24;

  function gateKeys() {
    const keys = [];
    const priority0 = [];
    for (const id of order) {
      const total = countOf(id);
      for (let index = 0; index < total; index += GATE_STRIDE) {
        const key = manager.key(id, index);
        keys.push(key);
        if (id === order[0] && index < HERO_FIRST) priority0.push(key);
      }
    }
    return { priority0, keys };
  }

  function boot(ready) {
    const overlay = document.getElementById("boot");
    const bar = document.getElementById("boot-bar");
    const percent = document.getElementById("boot-percent");
    const root = document.documentElement;

    if (!reels["shot-1"] || !countOf("shot-1")) {
      if (overlay) overlay.remove();
      ready();
      return;
    }

    const { priority0, keys } = gateKeys();
    // Every reel may be decoded during the gate; the budget still trims the
    // decode cache, but the fetched record (manager.loaded) is what the gate
    // counts, so a dropped bitmap does not reopen the gate.
    manager.keep = new Set(order);
    manager.focus("shot-1", 0);
    for (const key of priority0) {
      const cut = key.lastIndexOf("/");
      manager.want(key.slice(0, cut), Number(key.slice(cut + 1)), 1);
    }
    for (const key of keys) {
      if (priority0.includes(key)) continue;
      const cut = key.lastIndexOf("/");
      manager.want(key.slice(0, cut), Number(key.slice(cut + 1)), 40);
    }

    if (overlay) {
      overlay.hidden = false;
      root.classList.add("is-booting");
    }

    let opened = false;
    const finish = () => {
      if (opened) return;
      const gate = manager.progress(priority0);
      const total = manager.progress(keys);
      const shownPercent = Math.round(Math.max(gate, total) * 100);
      if (bar) bar.style.width = `${shownPercent}%`;
      if (percent) percent.textContent = `${shownPercent}%`;
      if (gate < 1 || total < BOOT_GATE) return;
      opened = true;
      manager.booted = true;
      unsubscribe();
      root.classList.remove("is-booting");
      if (overlay) {
        overlay.classList.add("is-done");
        setTimeout(() => {
          overlay.hidden = true;
          overlay.remove();
        }, 900);
      }
      ready();
      startBackground();
      scheduleRepaint();
    };

    const unsubscribe = manager.onChange(finish);
    finish();
    // Never trap the visitor behind a stalled network.
    setTimeout(() => {
      if (opened) return;
      opened = true;
      manager.booted = true;
      unsubscribe();
      root.classList.remove("is-booting");
      if (overlay) {
        overlay.classList.add("is-done");
        setTimeout(() => {
          overlay.hidden = true;
          overlay.remove();
        }, 900);
      }
      ready();
      startBackground();
      scheduleRepaint();
    }, 20000);
  }

  // Cascade: even then odd frames of the next two reels, then the keyframes of
  // everything after them. Those later reels are filled on approach, not on
  // load, so a long visit does not silently download the whole library.
  function startBackground() {
    const plan = [];
    // The odd frames the gate skipped, reel by reel, so every reel is complete
    // before the visitor reaches the last one. Frames the gate already fetched
    // are left alone: they are on disk and re-hydrate when their reel is near.
    for (const id of order) {
      const total = countOf(id);
      for (let index = 1; index < total; index += 2) plan.push([id, index]);
    }
    let priority = 400;
    for (const [id, index] of plan) {
      if (manager.loaded.has(manager.key(id, index))) continue;
      manager.want(id, index, priority);
      priority += 0.001;
    }
  }

  function init(config) {
    reels = config.reels || {};
    order = Object.keys(reels);
    manager.focus("shot-1", 0);
    window.PSMFilm.reels = reels;
    boot(config.ready || (() => {}));
  }

  window.PSMFilm = {
    init,
    scrub,
    still,
    prewarm,
    manager,
    get booted() {
      return !document.documentElement.classList.contains("is-booting");
    },
    debug() {
      return {
        tier: TIER,
        budget: BUDGET,
        active: manager.active,
        queued: manager.queue.length,
        decoded: manager.bitmaps.size,
        keep: [...manager.keep],
        shown: Object.fromEntries(shown),
      };
    },
  };
})();
