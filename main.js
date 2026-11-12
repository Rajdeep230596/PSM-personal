const scroller = document.getElementById("scroller");
const screen = document.getElementById("screen");
const nav = document.getElementById("nav");
const progressBar = document.getElementById("progress-bar");
const shot1 = document.getElementById("shot-1");
const shot2 = document.getElementById("shot-2");
const shot3 = document.getElementById("shot-3");
const shot4 = document.getElementById("shot-4");
const play1 = shot1.querySelector(".shot-video");
const play2 = shot2.querySelector(".shot-video");
const play3 = shot3.querySelector(".shot-video");
const play4 = shot4.querySelector(".shot-video");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let forceLandscape = false;
let scrollTick = 0;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function viewportSize() {
  const view = window.visualViewport;
  return {
    width: view ? view.width : window.innerWidth,
    height: view ? view.height : window.innerHeight,
  };
}

function landscapeTurned() {
  return document.documentElement.classList.contains("force-landscape");
}

function fitScreen() {
  const view = viewportSize();
  const turned = forceLandscape && view.height > view.width;
  const fullW = turned ? view.height : view.width;
  const fullH = turned ? view.width : view.height;
  document.documentElement.style.setProperty("--screen-w", `${fullW}px`);
  document.documentElement.style.setProperty("--screen-h", `${fullH}px`);
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
  layoutFilms();
}

function spanOf(section) {
  return Math.max(1, section.offsetHeight - scroller.clientHeight);
}

function sectionProgress(section) {
  return clamp((scroller.scrollTop - section.offsetTop) / spanOf(section), 0, 1);
}

function band(progress, from, to) {
  const fade = 0.07;
  if (progress <= from || progress >= to) return 0;
  if (progress < from + fade) return (progress - from) / fade;
  if (progress > to - fade) return (to - progress) / fade;
  return 1;
}

function paintLines(section, progress) {
  section.querySelectorAll(".scrub-line").forEach((line) => {
    const amount = band(progress, Number(line.dataset.from), Number(line.dataset.to));
    line.style.opacity = String(amount);
    line.classList.toggle("is-shown", amount > 0.02);
    line.classList.toggle("is-live", amount > 0.35);
  });
}

function bufferedEnd(video) {
  let end = 0;
  for (let i = 0; i < video.buffered.length; i += 1) {
    if (video.buffered.start(i) <= 0.25) end = Math.max(end, video.buffered.end(i));
  }
  return end;
}

function holds(video, time) {
  for (let i = 0; i < video.buffered.length; i += 1) {
    if (time >= video.buffered.start(i) && time <= video.buffered.end(i) - 0.05) return true;
  }
  return false;
}

function seekTo(video, time) {
  if (!Number.isFinite(video.duration) || video.duration <= 0) return;
  const span = Math.max(0, video.duration - 0.05);
  const want = clamp(time, 0, span);
  const next = holds(video, want) ? want : Math.min(want, Math.max(0, bufferedEnd(video) - 0.12));
  if (video.seeking) return;
  if (Math.abs(video.currentTime - next) < 0.08) return;
  try {
    video.currentTime = next;
  } catch (err) {
    /* the next scroll frame tries again */
  }
}

function shot4Time(progress, duration) {
  const logo = 0.28 * duration;
  const takeoff = 0.33 * duration;
  const away = 0.8 * duration;
  const tablet = 0.92 * duration;
  if (progress < 0.086) return (progress / 0.086) * logo;
  if (progress < 0.463) return logo;
  if (progress < 0.634) return takeoff + ((progress - 0.463) / 0.171) * (away - takeoff);
  if (progress < 0.703) return away + ((progress - 0.634) / 0.069) * (tablet - away);
  return tablet;
}

function placeOnFrame(element, screen, clearTop = 0, minSize = 160) {
  const box = play4.getBoundingClientRect();
  const sticky = element.parentElement.getBoundingClientRect();
  if (box.width < 2 || box.height < 2) return;
  const scale = Math.max(box.width / 16, box.height / 9);
  const drawnW = 16 * scale;
  const drawnH = 9 * scale;
  const originX = box.left + (box.width - drawnW) / 2;
  const originY = box.top + (box.height - drawnH) / 2;
  const inset = 10;
  let left = originX + screen.x * drawnW;
  let top = originY + screen.y * drawnH;
  let right = left + screen.w * drawnW;
  let bottom = top + screen.h * drawnH;
  left = Math.max(left, box.left + inset);
  top = Math.max(top, box.top + inset, clearTop);
  right = Math.min(right, box.right - inset);
  bottom = Math.min(bottom, box.bottom - inset);
  element.style.left = `${left - sticky.left}px`;
  element.style.top = `${top - sticky.top}px`;
  element.style.width = `${Math.max(minSize, right - left)}px`;
  element.style.height = `${Math.max(minSize, bottom - top)}px`;
  element.style.transform = "none";
}

const films = [
  [play1, shot1],
  [play2, shot2],
  [play3, shot3],
  [play4, shot4],
];

function render() {
  const max = Math.max(1, scroller.scrollHeight - scroller.clientHeight);
  progressBar.style.width = `${(scroller.scrollTop / max) * 100}%`;
  nav.classList.toggle("is-solid", scroller.scrollTop > shot1.offsetTop + scroller.clientHeight * 0.72);
  if (reduceMotion) {
    paintStills();
    return;
  }
  paintFilms();
  if (sectionOnScreen(shot3)) shot3.classList.toggle("is-cabin", Number(play3.dataset.part || 0) >= shot3CabinAt);
}

function sectionOnScreen(section) {
  const top = section.offsetTop;
  const bottom = top + section.offsetHeight;
  const viewTop = scroller.scrollTop;
  const viewBottom = viewTop + scroller.clientHeight;
  return bottom > viewTop + 24 && top < viewBottom - 24;
}

// Inlined so the first frame can be requested without waiting on a manifest
// round trip. tools/build-frames.mjs rewrites this block; keep the markers.
const reels = /* REELS:START */ {
  "shot-1": {
    "duration": 16,
    "fps": 10,
    "count": 160
  },
  "shot-2": {
    "duration": 12.07,
    "fps": 10,
    "count": 121
  },
  "shot-3": {
    "duration": 15.97,
    "fps": 10,
    "count": 160
  },
  "shot-4": {
    "duration": 19.2,
    "fps": 10,
    "count": 192
  }
} /* REELS:END */;

const reelLength = {
  "shot-1": 16,
  "shot-2": 12.07,
  "shot-3": 15.97,
  "shot-4": 19.2,
};

function reelDuration(video) {
  const reel = reels[video.dataset.reel];
  if (reel && reel.duration > 0) return reel.duration;
  return reelLength[video.dataset.reel] || 16;
}

// Three encodes of the same frames, picked by how many device pixels the film
// actually covers: desktops take the 1280 master, retina phones take a 1080
// cut (a 402pt iPhone spans 1206 device pixels, so 720 looked soft there) and
// 1x phones keep the 720 cut, where the extra pixels would never be shown.
// The media queries on the preload links in index.html mirror this exactly.
const TIER_WIDE = "1280";
const TIER_RETINA_PHONE = "1080";
const TIER_PHONE = "720";

// The film is drawn at the viewport width, so what matters is css width x
// device pixel ratio, not the ratio alone: an iPhone SE spans 750 device
// pixels and is wasteful on the 1080 cut, while a Pro Max spans 1320 and needs
// more than it. Pick the smallest encode that covers the screen to within 15%.
// index.html runs the same rule in its bootstrap so the preloads match.
function pickTier() {
  const connection = navigator.connection;
  if (connection && connection.saveData) return TIER_PHONE;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const need = Math.round((window.innerWidth || 390) * dpr * 0.85);
  if (need <= 720) return TIER_PHONE;
  if (need <= 1080) return TIER_RETINA_PHONE;
  return TIER_WIDE;
}

const frameTier = window.__psmTier || pickTier();
const dataSaver = Boolean(navigator.connection && navigator.connection.saveData);

function partFile(id, index) {
  return `assets/frames/${frameTier}/${id}/${String(index).padStart(3, "0")}.jpg?v=3`;
}

function frameIndex(reel, progress) {
  return Math.min(reel.count - 1, Math.max(0, Math.floor(progress * reel.count)));
}

const frameCache = new Map();
const frameQueue = [];
const queuedAt = new Map();
let frameSlots = 0;
let scrollDirection = 1;
let lastScrollTop = 0;
let fillTimer = 0;

// A long visit can touch all 633 frames. At 1080x608 each one is ~2.6 MB of
// decoded pixels, so the cache is capped and trimmed by distance from the
// playhead rather than by insertion order: the frames about to be shown are
// the last thing to go. Roughly 120 MB of decoded frames at every tier.
const FRAME_BUDGET = frameTier === "1280" ? 34 : frameTier === "1080" ? 46 : 96;
const FRAME_KEEP = 24;
// The head of the next reel is what the hand-off paints, but it is "infinitely
// far" from the playhead, so the trim used to throw it away and the prewarm
// fetched the same frames over and over. These stay pinned instead.
const PIN_AHEAD = 10;
const pinnedFrames = new Set();
let activeReel = "shot-1";
let activeIndex = 0;

function framePlace(url) {
  const match = /\/frames\/[^/]+\/([^/]+)\/(\d+)\.jpg/.exec(url);
  return match ? { reel: match[1], index: Number(match[2]) } : null;
}

function trimFrames() {
  if (frameCache.size <= FRAME_BUDGET) return;
  const spare = [];
  for (const [url, value] of frameCache) {
    if (typeof value === "string") continue; // in flight, or already failed
    const place = framePlace(url);
    const distance = place && place.reel === activeReel ? Math.abs(place.index - activeIndex) : Number.MAX_SAFE_INTEGER;
    if (distance <= FRAME_KEEP) continue;
    if (pinnedFrames.has(url)) continue;
    spare.push({ url, distance });
  }
  spare.sort((a, b) => b.distance - a.distance);
  for (let i = 0; i < spare.length && frameCache.size > FRAME_BUDGET; i += 1) {
    frameCache.delete(spare[i].url);
  }
}

function keepOpeningFrame() {
  const opening = partFile("shot-1", 0);
  if (play1.getAttribute("src") !== opening) return;
  play1.dataset.shown = "0";
  play1.dataset.part = "0";
  const store = () => {
    if (play1.naturalWidth) frameCache.set(opening, play1);
  };
  if (play1.complete && play1.naturalWidth) {
    store();
    return;
  }
  frameCache.set(opening, "loading");
  play1.addEventListener("load", store, { once: true });
}

keepOpeningFrame();

// Six requests in flight is the browser's per-host ceiling on HTTP/1.1 and
// keeps an HTTP/2 connection busy; three was the old bottleneck.
const MAX_FRAME_SLOTS = 6;
const AHEAD_FRAMES = 22;
const BEHIND_FRAMES = 8;

function enqueueFrame(url, priority = 50, reserved = false) {
  if (frameCache.has(url)) return;
  const queued = queuedAt.get(url);
  if (queued !== undefined) {
    if (queued <= priority) return;
    for (let i = 0; i < frameQueue.length; i += 1) {
      if (frameQueue[i].url === url) {
        frameQueue[i].priority = priority;
        frameQueue[i].reserved = reserved;
        break;
      }
    }
    queuedAt.set(url, priority);
    return;
  }
  frameQueue.push({ url, priority, reserved });
  queuedAt.set(url, priority);
}

// Two of the six slots are held for the next reel's head. Without them a fast
// flick fills every slot with runway frames from the current reel, the hand-off
// arrives with nothing loaded to paint, and the film sits still until the
// network catches up. That was the 0.8s freeze at a reel change on a phone.
const RESERVED_SLOTS = 2;
let reservedInFlight = 0;

function nextJob() {
  if (reservedInFlight < RESERVED_SLOTS) {
    const held = frameQueue.findIndex((job) => job.reserved);
    if (held >= 0) return held;
  }
  const normal = frameQueue.findIndex((job) => !job.reserved);
  return normal >= 0 ? normal : frameQueue.length ? 0 : -1;
}

function pumpFrames() {
  if (frameQueue.length > 1) frameQueue.sort((a, b) => a.priority - b.priority);
  while (frameSlots < MAX_FRAME_SLOTS && frameQueue.length) {
    const pick = nextJob();
    if (pick < 0) break;
    const job = frameQueue.splice(pick, 1)[0];
    queuedAt.delete(job.url);
    if (frameCache.has(job.url)) continue;
    frameCache.set(job.url, "loading");
    frameSlots += 1;
    if (job.reserved) reservedInFlight += 1;
    const image = new Image();
    image.decoding = "async";
    // The runway in front of the playhead outranks the background fill.
    if ("fetchPriority" in image) image.fetchPriority = job.priority < 8 ? "high" : "low";
    // The network slot is freed the moment the bytes land. Waiting for
    // decode() to resolve before freeing it deadlocks the loader: decoding a
    // large frame can take longer than the next five downloads, so all six
    // slots end up parked on decodes and the film stops advancing until they
    // finish. That is the freeze-then-jump seen at a reel change on a phone.
    const release = () => {
      if (job.reserved) reservedInFlight -= 1;
      frameSlots -= 1;
    };
    image.onload = () => {
      release();
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        frameCache.set(job.url, image);
        trimFrames();
        render();
      };
      if (image.decode) {
        image.decode().then(finish, finish);
        // A frame that never reports decoded still gets used, exactly as it
        // did before decode() was called at all, rather than being dropped.
        setTimeout(finish, 1500);
      } else {
        finish();
      }
      pumpFrames();
    };
    image.onerror = () => {
      release();
      frameCache.set(job.url, "error");
      trimFrames();
      pumpFrames();
      render();
    };
    image.src = job.url;
  }
}

// Rebuilds the pending queue around the playhead, weighted towards where the
// scroll is heading. Requests already in flight are never dropped, so a fast
// scroll no longer restarts the reel from the current frame on every tick.
function queueReel(id, count, center) {
  // Reserved next-reel work survives a rebuild of the pending queue, otherwise
  // every scroll tick would throw the prewarm away and re-queue it behind the
  // runway frames it is meant to get ahead of.
  const held = frameQueue.filter((job) => job.reserved);
  frameQueue.length = 0;
  queuedAt.clear();
  for (let i = 0; i < held.length; i += 1) {
    frameQueue.push(held[i]);
    queuedAt.set(held[i].url, held[i].priority);
  }
  const forward = scrollDirection >= 0;
  const ahead = forward ? AHEAD_FRAMES : BEHIND_FRAMES;
  const behind = forward ? BEHIND_FRAMES : AHEAD_FRAMES;
  for (let step = 0; step <= Math.max(ahead, behind); step += 1) {
    const front = forward ? center + step : center - step;
    const back = forward ? center - step : center + step;
    if (step <= ahead && front >= 0 && front < count) enqueueFrame(partFile(id, front), step);
    if (step && step <= behind && back >= 0 && back < count) enqueueFrame(partFile(id, back), step + 4);
  }
  pumpFrames();
}

// Once a real scroll settles, quietly extend the runway ahead of the playhead
// so a fast flick later never waits. Never runs before the visitor interacts,
// so the first paint is not competing with a megabyte of frames, and never
// fetches a whole reel. Off on save-data connections.
const FILL_AHEAD = 60;
const FILL_BEHIND = 16;
let hasScrolled = false;

function scheduleFill(id, count, center) {
  clearTimeout(fillTimer);
  if (dataSaver || !hasScrolled) return;
  fillTimer = setTimeout(() => {
    for (let step = 0; step <= FILL_AHEAD; step += 1) {
      const ahead = center + step;
      if (ahead < count) enqueueFrame(partFile(id, ahead), 80 + step);
    }
    for (let step = 1; step <= FILL_BEHIND; step += 1) {
      const behind = center - step;
      if (behind >= 0) enqueueFrame(partFile(id, behind), 80 + step);
    }
    pumpFrames();
  }, 300);
}

const reelOrder = ["shot-1", "shot-2", "shot-3", "shot-4"];

// Fetches the head of the next reel while the current chapter is being read, so
// the hand-off never waits on the network. Twelve frames ran out during a fast
// flick, so the head is warmed to more than a screen's worth and the trigger is
// moved out; these jobs are reserved (see RESERVED_SLOTS) and outrank fill.
const PREWARM_FRAMES = 32;
const PREWARM_VIEWS = 3.2;
function prewarmNext(picture) {
  const id = picture.dataset.reel;
  const next = reelOrder[reelOrder.indexOf(id) + 1];
  const reel = reels[next];
  if (!reel || !reel.count) return;
  const section = document.getElementById(next);
  if (!section) return;
  const view = scroller.clientHeight;
  if (section.offsetTop > scroller.scrollTop + view * PREWARM_VIEWS) {
    pinnedFrames.clear();
    return;
  }
  pinnedFrames.clear();
  const pin = Math.min(PIN_AHEAD, reel.count);
  for (let index = 0; index < pin; index += 1) pinnedFrames.add(partFile(next, index));
  const head = Math.min(PREWARM_FRAMES, reel.count);
  for (let index = 0; index < head; index += 1) enqueueFrame(partFile(next, index), 60 + index, true);
  pumpFrames();
}

// A missing frame must never transport the picture. Without a cap the nearest
// loaded frame can be a screenful away, so the film appears to skip ahead when
// the runway has a hole in it.
const SHOW_GAP = 20;

function nearestFrame(id, count, index, maxGap = Infinity) {
  const reach = Math.min(maxGap, count);
  for (let step = 0; step < reach; step += 1) {
    const ahead = index + step;
    const behind = index - step;
    if (ahead < count) {
      const image = frameCache.get(partFile(id, ahead));
      if (image && image !== "loading" && image !== "error") return { index: ahead, image };
    }
    if (step && behind >= 0) {
      const image = frameCache.get(partFile(id, behind));
      if (image && image !== "loading" && image !== "error") return { index: behind, image };
    }
  }
  return null;
}

function holdFilm(picture, section, queue) {
  const id = picture.dataset.reel;
  const reel = reels[id];
  if (!reel || !reel.count) return;
  const view = scroller.clientHeight;
  const mid = scroller.scrollTop + view * 0.42;
  const near = mid > section.offsetTop - view * 0.45 && mid < section.offsetTop + section.offsetHeight + view * 0.2;
  if (!near) return;
  const progress = sectionOnScreen(section) ? sectionProgress(section) : mid > section.offsetTop ? 1 : 0;
  const index = frameIndex(reel, progress);
  if (queue) {
    activeReel = id;
    activeIndex = index;
  }
  // Hold the frame already on screen rather than jumping across a gap; a reel
  // that has never painted still takes whatever is closest so it cannot sit
  // blank on the way in.
  let ready = nearestFrame(id, reel.count, index, SHOW_GAP);
  if (!ready && !picture.dataset.shown) ready = nearestFrame(id, reel.count, index);
  if (ready && picture.dataset.shown !== String(ready.index)) {
    picture.dataset.shown = String(ready.index);
    picture.dataset.part = String(ready.index / reel.fps);
    picture.src = ready.image.src;
  }
  if (queue && picture.dataset.center !== String(index)) {
    picture.dataset.center = String(index);
    queueReel(id, reel.count, index);
    scheduleFill(id, reel.count, index);
  }
}
// Reduced motion: the scrub is off, but every chapter still paints its own
// still frame as it comes into view, so nothing is left as a black panel or a
// blurred placeholder. One frame per reel, fetched only when the chapter is
// within reach, and it never swaps again afterwards.
function paintStills() {
  films.forEach(([picture, section]) => {
    const id = picture.dataset.reel;
    const reel = reels[id];
    if (!reel || !reel.count) return;
    const view = scroller.clientHeight;
    const mid = scroller.scrollTop + view * 0.42;
    const near = mid > section.offsetTop - view * 0.6 && mid < section.offsetTop + section.offsetHeight + view * 0.6;
    if (!near) return;
    activeReel = id;
    activeIndex = 0;
    const ready = nearestFrame(id, reel.count, 0);
    if (ready) {
      if (picture.dataset.shown === String(ready.index)) return;
      picture.dataset.shown = String(ready.index);
      picture.dataset.part = String(ready.index / reel.fps);
      picture.src = ready.image.src;
      return;
    }
    enqueueFrame(partFile(id, 0), 1);
    pumpFrames();
  });
}

function paintFilms() {
  const viewTop = scroller.scrollTop;
  const viewBottom = viewTop + scroller.clientHeight;
  let focus = null;
  let focusOverlap = 0;
  films.forEach((pair) => {
    const section = pair[1];
    const overlap = Math.min(section.offsetTop + section.offsetHeight, viewBottom) - Math.max(section.offsetTop, viewTop);
    if (overlap > focusOverlap) {
      focusOverlap = overlap;
      focus = pair[0];
    }
  });
  films.forEach(([picture, section]) => holdFilm(picture, section, picture === focus));
  if (focus) prewarmNext(focus);
}

function applyScrub(video) {
  const want = Number(video.dataset.want);
  if (!Number.isFinite(want)) return;
  const asked = Number(video.dataset.asked);
  if ((video.dataset.scrubbing === "1" || video.seeking) && Number.isFinite(asked) && Math.abs(want - asked) < 0.45) return;
  if (Math.abs(video.currentTime - want) < 0.12) return;
  video.dataset.scrubbing = "1";
  video.dataset.asked = String(want);
  video.dataset.seekAt = String(performance.now());
  try {
    video.currentTime = want;
  } catch (err) {
    video.dataset.scrubbing = "0";
  }
}

const shot3CabinAt = 8.9;

function layoutFilms() {
  films.forEach(([, section]) => {
    section.style.height = "";
    const next = section.nextElementSibling;
    if (!next || !next.classList.contains("interlude")) return;
    next.style.marginTop = "";
    next.style.minHeight = "";
  });
  const phone = window.matchMedia("(max-width: 899px) and (orientation: portrait)").matches && !landscapeTurned();
  if (!phone) {
    films.forEach(([picture, section]) => {
      // Reduced motion has no scrub, so there is nothing to travel through:
      // one screen per chapter keeps each still readable instead of asking the
      // visitor to scroll four empty viewports before the next one arrives.
      const span = reduceMotion ? 1 : 1 + reelDuration(picture) / 5.5;
      section.style.setProperty("--span", span.toFixed(2));
    });
    return;
  }
  const view = scroller.clientHeight;
  const travel = reduceMotion ? 0 : Math.round(view * 0.72);
  films.forEach(([, section]) => {
    section.style.height = `${view + travel}px`;
  });
}

function onScroll() {
  if (scrollTick) return;
  scrollTick = requestAnimationFrame(() => {
    scrollTick = 0;
    const top = scroller.scrollTop;
    if (Math.abs(top - lastScrollTop) > 1) {
      scrollDirection = top > lastScrollTop ? 1 : -1;
      hasScrolled = true;
    }
    lastScrollTop = top;
    render();
  });
}

function jumpTo(hash) {
  const target = document.querySelector(hash);
  if (target) scroller.scrollTop = target.offsetTop;
}

scroller.addEventListener("scroll", onScroll, { passive: true });
window.addEventListener("resize", () => {
  fitScreen();
  render();
});
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", () => {
    fitScreen();
    render();
  });
}

document.querySelectorAll(".nav-links a, .brand, .enter-house").forEach((link) => {
  link.addEventListener("click", (event) => {
    const hash = link.getAttribute("href");
    if (!hash || !hash.startsWith("#")) return;
    event.preventDefault();
    jumpTo(hash);
    nav.classList.remove("is-open");
    const toggle = document.querySelector(".nav-toggle");
    toggle.setAttribute("aria-expanded", "false");
    toggle.textContent = "Menu";
  });
});

const filmCue = document.querySelector(".scroll-cue");
const tiltCue = window.matchMedia("(max-width: 899px) and (orientation: portrait)");

function paintCue() {
  const turned = landscapeTurned();
  const offer = tiltCue.matches && !turned;
  filmCue.textContent = turned ? "Back to the original phone" : offer ? "Tilt the device for a better experience" : "Scroll";
  filmCue.classList.toggle("is-cta", offer || turned);
  if (offer || turned) filmCue.setAttribute("aria-pressed", String(turned));
  else filmCue.removeAttribute("aria-pressed");
}

function useLandscape(on) {
  const orientation = window.screen.orientation;
  if (on) {
    if (orientation && typeof orientation.lock === "function") orientation.lock("landscape").catch(() => {});
    forceLandscape = true;
    document.documentElement.classList.add("force-landscape");
  } else {
    if (orientation && typeof orientation.unlock === "function") {
      try {
        orientation.unlock();
      } catch (err) {
        /* some browsers throw if nothing was locked */
      }
    }
    forceLandscape = false;
    document.documentElement.classList.remove("force-landscape");
    stopLandscapeGlide();
  }
  fitScreen();
  paintCue();
  render();
}

paintCue();
tiltCue.addEventListener("change", paintCue);
filmCue.addEventListener("click", () => {
  if (filmCue.classList.contains("is-cta")) {
    useLandscape(!landscapeTurned());
    return;
  }
  scroller.scrollTop = shot2.offsetTop + 8;
});

document.querySelector(".phone-return").addEventListener("click", () => useLandscape(false));

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
  if (event.target.closest("input, textarea, select, .ipad-screen, a, button")) return;
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
    } catch (err) {
      /* capture is optional */
    }
  }
  const step = landscapePointer.axis === "x" ? dx : -dy;
  const dt = Math.max(16, event.timeStamp - landscapePointer.lastTime);
  landscapePointer.velocity = (step / dt) * 16.7;
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
  stopLandscapeGlide();
});

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

["pointerdown", "keydown", "touchstart", "wheel"].forEach((type) => {
  window.addEventListener(type, () => {
    if (music.paused && !muted) startMusic();
  }, { passive: true });
});

const toggle = document.querySelector(".nav-toggle");
toggle.addEventListener("click", () => {
  const open = nav.classList.toggle("is-open");
  toggle.setAttribute("aria-expanded", String(open));
  toggle.textContent = open ? "Close" : "Menu";
});

const form = document.getElementById("contact-form");
const status = document.getElementById("form-status");
form.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const lines = [
    "Hello PSM Infinity,",
    "",
    `Name: ${String(data.get("name") || "").trim()}`,
    `Email: ${String(data.get("email") || "").trim()}`,
    `Country: ${String(data.get("country") || "").trim()}`,
    `Contact: ${String(data.get("contact") || "").trim()}`,
    "",
    String(data.get("message") || "").trim(),
  ];
  const url = `https://wa.me/919007431000?text=${encodeURIComponent(lines.join("\n"))}`;
  const opened = window.open(url, "_blank", "noopener");
  if (!opened) window.location.href = url;
  status.textContent = "WhatsApp is opening.";
});
function closeForm() {
  form.classList.remove("is-open");
  shot4.classList.remove("is-form-open");
}

const connect = document.getElementById("connect");
connect.addEventListener("click", () => {
  // The form is part of the page now: the button takes you to it.
  const section = document.getElementById("contact");
  if (section) scroller.scrollTop = section.offsetTop;
  const name = form.querySelector("input[name=name]");
  if (name) name.focus({ preventScroll: true });
});
const ipadClose = form.querySelector(".ipad-close");
if (ipadClose) ipadClose.addEventListener("click", closeForm);

document.getElementById("year").textContent = String(new Date().getFullYear());

function markPops(elements) {
  elements.forEach((element, index) => {
    element.classList.add("pop");
    element.style.setProperty("--pop-delay", `${index * 110}ms`);
  });
}

function showPops(root, visible) {
  root.querySelectorAll(".pop").forEach((element) => element.classList.toggle("is-in", visible));
}

[
  [document.querySelector(".vendors"), [...document.querySelectorAll(".vendors .panel-head > *"), ...document.querySelectorAll(".vendors .logo-grid > li")]],
  [document.querySelector(".directory"), [...document.querySelectorAll(".details > div")]],
  [document.querySelector(".footer"), [...document.querySelectorAll(".footer > *")]],
].forEach(([section, bits]) => {
  markPops(bits.filter(Boolean));
  if (reduceMotion || !section) return;
  const observer = new IntersectionObserver(
    ([entry]) => showPops(section, entry.isIntersecting),
    { root: scroller, threshold: 0.22 }
  );
  observer.observe(section);
});

fitScreen();
render();
