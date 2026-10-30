const film = document.getElementById("film");
const filmCtx = film.getContext("2d", { alpha: true });
const screen = document.getElementById("screen");
const scroller = document.getElementById("scroller");
const story = document.getElementById("story");
const siteFoot = document.querySelector(".site-foot");
const contact = document.getElementById("contact");
const tabletForm = document.getElementById("contact-form");
const chapters = [...document.querySelectorAll(".chapter")];
const progressBar = document.getElementById("progress-bar");
const chapterIndex = document.getElementById("chapter-index");
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

function viewTop(element) {
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

function placeTabletForm() {
  const top = viewTop(contact);
  const foot = viewTop(siteFoot);
  const locked = top >= -4 && top <= 12 && foot >= viewHeight() - 4;
  const live = pictureWidth > 0 && locked;
  tabletForm.classList.toggle("is-live", live);
  if (!live && tabletForm.contains(document.activeElement)) document.activeElement.blur();
  if (!pictureWidth || !pictureHeight) return;

  const rect = film.getBoundingClientRect();
  const scale = Math.max(rect.width / pictureWidth, rect.height / pictureHeight);
  const originX = rect.left + (rect.width - pictureWidth * scale) / 2;
  const originY = rect.top + (rect.height - pictureHeight * scale) / 2;
  const sx = pictureWidth / 1920;
  const sy = pictureHeight / 1080;
  const placed = [...tabletForm.querySelectorAll("[data-box]")].map((field) => {
    const [x, y, w, h] = field.dataset.box.split(",").map(Number);
    return {
      field,
      left: originX + x * sx * scale,
      top: originY + y * sy * scale,
      width: w * sx * scale,
      height: h * sy * scale,
    };
  });
  const margin = 10;
  const bounds = screen.getBoundingClientRect();
  const heavilyCropped = viewWidth() < 700 || placed.some((item) => {
    const visible = Math.min(item.left + item.width, bounds.right - margin) - Math.max(item.left, bounds.left + margin);
    return visible < item.width * 0.62;
  });
  const fits = !heavilyCropped;
  tabletForm.classList.toggle("is-fit", !fits);

  placed.forEach((item) => {
    if (!fits) {
      item.field.style.left = "";
      item.field.style.top = "";
      item.field.style.width = "";
      item.field.style.height = "";
      item.field.style.fontSize = "";
      return;
    }
    const host = tabletForm.getBoundingClientRect();
    const left = Math.max(bounds.left + margin, item.left);
    const top = Math.max(bounds.top + margin, item.top);
    const width = Math.max(48, Math.min(item.width, bounds.right - margin - left));
    const height = Math.max(28, Math.min(item.height, bounds.bottom - margin - top));
    item.field.style.left = `${left - host.left}px`;
    item.field.style.top = `${top - host.top}px`;
    item.field.style.width = `${width}px`;
    item.field.style.height = `${height}px`;
    const isButton = item.field.classList.contains("tablet-btn");
    item.field.style.fontSize = `${Math.max(16, (isButton ? 15 : 18) * scale)}px`;
  });
}

function paintChapters(progress) {
  let active = 1;
  chapters.forEach((chapter, index) => {
    const from = Number(chapter.dataset.from);
    const to = Number(chapter.dataset.to);
    const fade = 0.05;
    const enter = from <= 0 ? 1 : clamp((progress - from) / fade, 0, 1);
    const exit = to >= 1 ? 1 : clamp((to - progress) / fade, 0, 1);
    const opacity = Math.min(enter, exit);
    chapter.style.opacity = String(opacity);
    chapter.style.transform = `translateY(${(1 - opacity) * 22}px)`;
    chapter.classList.toggle("is-on", opacity > 0.45);
    if (opacity > 0.45) {
      active = index + 1;
      showPops(chapter, true);
    } else if (opacity < 0.08) {
      showPops(chapter, false);
    }
  });
  chapterIndex.textContent = `0${active}  —  04`;
}

const frameUrl = "assets/frames.bin?v=1";
const frameCache = new Map();
const frameCacheMax = 8;
const frameFailed = new Set();
let frameChunks = [];
let frameReceived = 0;
let frameCount = 0;
let frameOffsets = null;
let frameParsed = false;
let frameShown = -1;
let frameWanted = -1;
let frameDecoding = false;
let paintQueued = false;
let motionIndex = -1;

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
  return frameOffsets !== null && index >= 0 && index < frameCount && frameReceived >= frameOffsets[index + 1];
}

function nearestReady(index) {
  if (!frameParsed) return -1;
  if (frameReady(index)) return index;
  let best = -1;
  for (let i = 0; i < frameCount; i += 1) {
    if (!frameReady(i)) continue;
    if (best < 0 || Math.abs(i - index) < Math.abs(best - index)) best = i;
  }
  return best;
}

function trimFrameCache(index) {
  if (frameCache.size <= frameCacheMax) return;
  const ranked = [...frameCache.keys()].sort((a, b) => Math.abs(b - index) - Math.abs(a - index));
  while (frameCache.size > frameCacheMax && ranked.length) {
    const drop = ranked.shift();
    const bitmap = frameCache.get(drop);
    frameCache.delete(drop);
    if (bitmap && bitmap.close) bitmap.close();
  }
}

function drawFrame(index, bitmap) {
  filmCtx.drawImage(bitmap, 0, 0, pictureWidth, pictureHeight);
  frameShown = index;
  film.dataset.frame = String(index);
}

function targetFrame() {
  if (reduceMotion) return Math.max(motionIndex, 0);
  if (frameCount < 2) return 0;
  return clamp(Math.round(filmProgress() * (frameCount - 1)), 0, frameCount - 1);
}

function paintFrame() {
  const ready = nearestReady(targetFrame());
  if (ready < 0 || frameFailed.has(ready)) return;
  frameWanted = ready;
  if (frameCache.has(ready)) {
    if (frameShown !== ready) drawFrame(ready, frameCache.get(ready));
    return;
  }
  pumpFrames();
}

async function pumpFrames() {
  if (frameDecoding) return;
  frameDecoding = true;
  while (frameWanted >= 0 && !frameCache.has(frameWanted) && !frameFailed.has(frameWanted)) {
    const index = frameWanted;
    try {
      const bitmap = await createImageBitmap(new Blob([sliceBytes(frameOffsets[index], frameOffsets[index + 1])], { type: "image/jpeg" }));
      frameCache.set(index, bitmap);
      trimFrameCache(targetFrame());
    } catch (err) {
      frameFailed.add(index);
    }
  }
  frameDecoding = false;
  const ready = nearestReady(targetFrame());
  if (ready >= 0 && frameCache.has(ready) && frameShown !== ready) drawFrame(ready, frameCache.get(ready));
  if (frameWanted >= 0 && !frameCache.has(frameWanted) && !frameFailed.has(frameWanted)) pumpFrames();
}

function requestFilm() {
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
  film.width = pictureWidth;
  film.height = pictureHeight;
  placeWhatsApp();
  placeTabletForm();
  requestFilm();
}

async function loadFrames() {
  try {
    const response = await fetch(frameUrl);
    if (!response.ok || !response.body) return;
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      frameChunks.push(value);
      frameReceived += value.length;
      parseFrameHeader();
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
    requestFilm();
  } catch (err) {
    filmCue.textContent = "Scroll to unfold";
  }
}

function onScroll() {
  const progress = storyProgress();
  progressBar.style.width = `${filmProgress() * 100}%`;
  if (!reduceMotion) paintChapters(progress);
  nav.classList.toggle("is-solid", story.getBoundingClientRect().bottom - scroller.getBoundingClientRect().top < viewHeight() * 0.9);
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

  const rect = film.getBoundingClientRect();
  const scale = Math.max(rect.width / pictureWidth, rect.height / pictureHeight);
  const originX = rect.left + (rect.width - pictureWidth * scale) / 2;
  const originY = rect.top + (rect.height - pictureHeight * scale) / 2;
  const sx = pictureWidth / 1920;
  const sy = pictureHeight / 1080;
  const markX = 1692 * sx;
  const markY = 822 * sy;
  const markW = 96 * sx;
  const markH = 126 * sy;
  const centerX = originX + (markX + markW / 2) * scale;
  const centerY = originY + (markY + markH / 2) * scale;
  const bounds = screen.getBoundingClientRect();
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
filmCue.textContent = "Scroll to unfold";
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
document.getElementById("year").textContent = String(new Date().getFullYear());
if (!reduceMotion) paintChapters(0);
scroller.addEventListener("scroll", onScroll, { passive: true });
onScroll();

window.addEventListener("resize", () => {
  placeWhatsApp();
  placeTabletForm();
  if (!reduceMotion) onScroll();
});
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", () => {
    placeWhatsApp();
    placeTabletForm();
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
  if (muted) return;
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
  const subject = String(data.get("subject") || "").trim();
  const note = String(data.get("note") || "").trim();
  const reference = String(data.get("reference") || "").trim();
  const message = String(data.get("message") || "").trim();
  const lines = [`Name: ${name}`, `Email: ${email}`];
  if (note) lines.push(`Note: ${note}`);
  if (reference) lines.push(`Reference: ${reference}`);
  lines.push("", message);
  const body = lines.join("\n");
  window.location.href = `mailto:psminfinity@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  status.textContent = "Your email app is opening.";
});
form.addEventListener("reset", () => {
  status.textContent = "";
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
  [document.querySelector(".directory"), [...document.querySelectorAll(".details > div")]],
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
