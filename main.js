const scroller = document.getElementById("scroller");
const screen = document.getElementById("screen");
const nav = document.getElementById("nav");
const progressBar = document.getElementById("progress-bar");
const shot1 = document.getElementById("shot-1");
const shot2 = document.getElementById("shot-2");
const shot3 = document.getElementById("shot-3");
const shot4 = document.getElementById("shot-4");
const play1 = shot1.querySelector("video");
const play2 = shot2.querySelector("video");
const play3 = shot3.querySelector("video");
const play4 = shot4.querySelector("video");
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
  if (reduceMotion) return;
  films.forEach(([video, section]) => scrubFilm(video, section));
  if (sectionOnScreen(shot3)) shot3.classList.toggle("is-cabin", play3.currentTime >= shot3CabinAt);
}

function sectionOnScreen(section) {
  const top = section.offsetTop;
  const bottom = top + section.offsetHeight;
  const viewTop = scroller.scrollTop;
  const viewBottom = viewTop + scroller.clientHeight;
  return bottom > viewTop + 24 && top < viewBottom - 24;
}

function scrubTarget(video, section) {
  const span = Math.max(0, video.duration - 0.04);
  return clamp(sectionProgress(section) * span, 0, span);
}

function scrubFilm(video, section) {
  const view = scroller.clientHeight;
  const near = section.offsetTop < scroller.scrollTop + view * 1.4 && section.offsetTop + section.offsetHeight > scroller.scrollTop - view;
  if (near && video.preload !== "auto") video.preload = "auto";
  const on = sectionOnScreen(section);
  if (near && !on && video.dataset.warm !== "1" && video.readyState < 2) {
    video.dataset.warm = "1";
    video.play().then(() => {
      if (sectionOnScreen(section)) return;
      video.pause();
      video.currentTime = 0;
    }).catch(() => {});
  }
  if (!on) {
    if (!video.paused) video.pause();
    return;
  }
  if (section.offsetHeight <= scroller.clientHeight + 8) {
    if (video.paused) video.play().catch(() => {});
    return;
  }
  if (!Number.isFinite(video.duration) || video.readyState < 1) return;
  if (!video.paused) video.pause();
  video.dataset.want = String(scrubTarget(video, section));
  applyScrub(video);
}

function applyScrub(video) {
  if (video.dataset.scrubbing === "1" || video.seeking) return;
  const want = Number(video.dataset.want);
  if (!Number.isFinite(want)) return;
  const safe = holds(video, want) ? want : Math.min(want, Math.max(0, bufferedEnd(video) - 0.08));
  if (!Number.isFinite(safe) || Math.abs(video.currentTime - safe) < 0.04) return;
  video.dataset.scrubbing = "1";
  try {
    video.currentTime = safe;
  } catch (err) {
    video.dataset.scrubbing = "0";
  }
}

const shot3CabinAt = 8.9;

function layoutFilms() {
  const phone = window.matchMedia("(max-width: 899px) and (orientation: portrait)").matches && !landscapeTurned();
  films.forEach(([, section]) => {
    section.style.height = "";
    const next = section.nextElementSibling;
    if (!next || !next.classList.contains("interlude")) return;
    next.style.marginTop = "";
    next.style.minHeight = "";
  });
  if (!phone) {
    films.forEach(([video, section]) => {
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 16;
      section.style.setProperty("--span", (1 + duration / 5.5).toFixed(2));
    });
    return;
  }
  const view = scroller.clientHeight;
  const travel = Math.round(view * 0.72);
  films.forEach(([, section]) => {
    section.style.height = `${view + travel}px`;
  });
}

films.forEach(([video, section]) => {
  video.addEventListener("seeked", () => {
    video.dataset.scrubbing = "0";
    if (sectionOnScreen(section)) applyScrub(video);
  });
  video.addEventListener("progress", () => {
    if (sectionOnScreen(section)) applyScrub(video);
  });
  video.addEventListener("loadedmetadata", () => {
    layoutFilms();
    render();
  });
});

function onScroll() {
  if (scrollTick) return;
  scrollTick = requestAnimationFrame(() => {
    scrollTick = 0;
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
  form.classList.add("is-open");
  shot4.classList.add("is-form-open");
  const name = form.querySelector("input[name=name]");
  if (name) name.focus();
});
form.querySelector(".ipad-close").addEventListener("click", closeForm);

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
