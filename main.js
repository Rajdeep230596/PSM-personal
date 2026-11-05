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

function frameScale(boxW, boxH, imageW, imageH) {
  return Math.max(boxW / imageW, boxH / imageH);
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

let formClosed = false;

function contactOnStage() {
  const top = viewTop(contact);
  const next = viewTop(vendors);
  return top <= 48 && next > viewHeight() * 0.55;
}

function placeTabletForm() {
  const onStage = contactOnStage();
  if (!onStage) formClosed = false;
  const typing = tabletForm.contains(document.activeElement);
  const live = (onStage || typing) && !formClosed;
  tabletForm.classList.toggle("is-live", live);
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
const frameUrl = "assets/frames.bin?v=4";
const frameCache = new Map();
const frameCacheMax = webKitFilm ? 14 : 40;
const frameDecodeAhead = webKitFilm ? 10 : 20;
const frameDecodeSlots = webKitFilm ? 2 : 4;
const frameFailed = new Set();
let frameChunks = [];
let frameReceived = 0;
let frameCount = 0;
let frameOffsets = null;
let frameParsed = false;
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
  return frameOffsets !== null && index >= 0 && index < frameCount && frameReceived >= frameOffsets[index + 1];
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
  return Math.min(window.devicePixelRatio || 1, 2);
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
  for (let step = 0; step <= frameDecodeAhead; step += 1) {
    const candidate = step === 0 ? index : index + step;
    if (candidate < 0 || candidate >= frameCount) continue;
    if (frameCache.has(candidate) || framePending.has(candidate) || frameFailed.has(candidate)) continue;
    if (!frameReady(candidate)) continue;
    return candidate;
  }
  const behind = index - 1;
  if (behind >= 0 && !frameCache.has(behind) && !framePending.has(behind) && !frameFailed.has(behind) && frameReady(behind)) {
    return behind;
  }
  return -1;
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
  while (frameInflight < frameDecodeSlots) {
    const want = nextToDecode(index);
    if (want < 0) break;
    framePending.add(want);
    frameInflight += 1;
    const bytes = sliceBytes(frameOffsets[want], frameOffsets[want + 1]);
    decodeJpeg(bytes)
      .then((bitmap) => {
        framePending.delete(want);
        frameInflight -= 1;
        const drifted = Math.abs(want - filmIndex()) > frameDecodeAhead + 2;
        if (drifted && frameCache.size >= frameCacheMax) {
          if (bitmap.close) bitmap.close();
          else if ("src" in bitmap) bitmap.src = "";
        } else {
          frameCache.set(want, bitmap);
          trimFrameCache(filmIndex());
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
    paintCue();
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
const tiltCue = window.matchMedia("(max-width: 899px) and (orientation: portrait), (max-width: 860px)");

function paintCue() {
  filmCue.textContent = tiltCue.matches ? "Tilt the device for a better experience" : "Scroll to unfold";
}

paintCue();
tiltCue.addEventListener("change", paintCue);
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
  const viewport = window.visualViewport;
  const fullW = Math.round(viewport ? viewport.width : window.innerWidth);
  const fullH = Math.round(viewport ? viewport.height : window.innerHeight);
  document.documentElement.style.setProperty("--screen-w", `${fullW}px`);
  document.documentElement.style.setProperty("--screen-h", `${fullH}px`);
  stageW = fullW;
  stageH = fullH;
  screen.style.top = "0";
  screen.style.left = "0";
  screen.style.right = "0";
  screen.style.bottom = "0";
  screen.style.width = `${fullW}px`;
  screen.style.height = `${fullH}px`;
  screen.style.margin = "0";
  screen.style.transform = "none";
  const changed = fullW !== fitScreen.width || fullH !== fitScreen.height;
  fitScreen.width = fullW;
  fitScreen.height = fullH;
  return changed;
}

function measureFilmBox() {
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
form.querySelector(".ipad-close").addEventListener("click", () => {
  formClosed = true;
  placeTabletForm();
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
