const film = document.getElementById("film");
const remoteSrc = film.dataset.src;
const story = document.getElementById("story");
const siteFoot = document.querySelector(".site-foot");
const chapters = [...document.querySelectorAll(".chapter")];
const progressBar = document.getElementById("progress-bar");
const chapterIndex = document.getElementById("chapter-index");
const nav = document.getElementById("nav");
const wa = document.querySelector(".wa");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let playhead = 0;
let seeking = false;
let scrubbing = false;
let seekTimer = 0;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function storyProgress() {
  const total = story.offsetHeight - window.innerHeight;
  if (total <= 0) return 0;
  return clamp(-story.getBoundingClientRect().top / total, 0, 1);
}

function filmProgress() {
  const footTop = siteFoot.getBoundingClientRect().top + window.scrollY;
  const end = footTop - window.innerHeight;
  if (end <= 0) return 1;
  return clamp(window.scrollY / end, 0, 1);
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

function targetTime() {
  return filmProgress() * Math.max(film.duration - 0.04, 0);
}

function releaseSeek() {
  seeking = false;
  window.clearTimeout(seekTimer);
}

function stepFilm() {
  scrubbing = false;
  if (reduceMotion || !film.duration) return;
  const seekable = film.seekable.length ? film.seekable.end(film.seekable.length - 1) : 0;
  if (seekable < 0.5 && film.readyState < 2) return;

  const target = targetTime();
  const gap = target - playhead;
  playhead = Math.abs(gap) < 0.008 ? target : playhead + gap * 0.62;

  if (!seeking && Math.abs(playhead - film.currentTime) > 1 / 60) {
    seeking = true;
    window.clearTimeout(seekTimer);
    seekTimer = window.setTimeout(() => {
      seeking = false;
      scrub();
    }, 160);
    try {
      film.currentTime = playhead;
    } catch (err) {
      releaseSeek();
    }
  }

  if (Math.abs(target - film.currentTime) > 1 / 60 || Math.abs(target - playhead) > 0.012) scrub();
}

function scrub() {
  if (reduceMotion || scrubbing) return;
  scrubbing = true;
  requestAnimationFrame(stepFilm);
}

function onScroll() {
  const progress = storyProgress();
  progressBar.style.width = `${filmProgress() * 100}%`;
  if (!reduceMotion) paintChapters(progress);
  nav.classList.toggle("is-solid", story.getBoundingClientRect().bottom < window.innerHeight * 0.9);
  scrub();
  placeWhatsApp();
}

function placeWhatsApp() {
  wa.style.left = "";
  wa.style.top = "";
  wa.style.right = "";
  wa.style.bottom = "";
  wa.style.width = "";
  wa.style.height = "";
  if (!film.videoWidth || !film.videoHeight) return;

  const rect = film.getBoundingClientRect();
  const scale = Math.max(rect.width / film.videoWidth, rect.height / film.videoHeight);
  const originX = rect.left + (rect.width - film.videoWidth * scale) / 2;
  const originY = rect.top + (rect.height - film.videoHeight * scale) / 2;
  const markX = 1692;
  const markY = 822;
  const markW = 96;
  const markH = 126;
  const centerX = originX + (markX + markW / 2) * scale;
  const centerY = originY + (markY + markH / 2) * scale;
  const margin = 12;
  if (
    centerX < margin ||
    centerY < margin ||
    centerX > window.innerWidth - margin ||
    centerY > window.innerHeight - margin
  ) {
    return;
  }

  const size = wa.offsetWidth;
  wa.style.right = "auto";
  wa.style.bottom = "auto";
  wa.style.left = `${centerX - size / 2}px`;
  wa.style.top = `${centerY - size / 2}px`;
}

function unlockFilm() {
  film.pause();
  placeWhatsApp();
  if (reduceMotion) {
    film.loop = true;
    film.play().catch(() => {});
    return;
  }
  onScroll();
}

const filmCue = document.querySelector(".scroll-cue");

function whenFilmReady(video) {
  return new Promise((resolve) => {
    if (video.readyState >= 2) {
      resolve();
      return;
    }
    video.addEventListener("loadeddata", () => resolve(), { once: true });
    video.addEventListener("error", () => resolve(), { once: true });
  });
}

function readFilm(src, onProgress) {
  const report = typeof onProgress === "function" ? onProgress : () => {};
  return fetch(src, { priority: "low" }).then(async (response) => {
    if (!response.ok || !response.body) throw new Error("film");
    const total = Number(response.headers.get("Content-Length")) || 0;
    const reader = response.body.getReader();
    const parts = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      received += value.byteLength;
      if (total) report(received / total);
    }
    report(1);
    return new Blob(parts, { type: "video/mp4" });
  });
}

function mountClip(video, src, onProgress) {
  return readFilm(src, onProgress).then((blob) => {
    video.src = URL.createObjectURL(blob);
    return whenFilmReady(video);
  });
}

function beginFilm() {
  mountClip(film, remoteSrc, (ratio) => {
    const pct = String(Math.round(ratio * 100)).padStart(2, "0");
    filmCue.textContent = `Loading film ${pct}`;
  })
    .then(() => {
      filmCue.textContent = "Scroll to unfold";
      if (!reduceMotion) onScroll();
    })
    .catch(() => {
      film.src = remoteSrc;
      filmCue.textContent = "Scroll to unfold";
    });
}

film.addEventListener("loadedmetadata", unlockFilm);
film.addEventListener("seeked", () => {
  releaseSeek();
  if (!reduceMotion) scrub();
});
film.addEventListener("error", releaseSeek);
film.addEventListener("progress", () => {
  if (!reduceMotion) scrub();
});
film.addEventListener("canplay", () => {
  if (!reduceMotion) scrub();
});

document.getElementById("year").textContent = String(new Date().getFullYear());

if (document.readyState === "complete") beginFilm();
else window.addEventListener("load", beginFilm, { once: true });
if (!reduceMotion) paintChapters(0);
window.addEventListener("scroll", onScroll, { passive: true });
onScroll();

window.addEventListener("resize", () => {
  placeWhatsApp();
  if (!reduceMotion) onScroll();
});
placeWhatsApp();

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
  const message = String(data.get("message") || "").trim();
  const body = `Name: ${name}\nEmail: ${email}\n\n${message}`;
  window.location.href = `mailto:psminfinity@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  status.textContent = "Your email app is opening.";
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
    [
      ...document.querySelectorAll(".contact .panel-head > *"),
      ...document.querySelectorAll(".form > label"),
      document.querySelector(".submit"),
    ],
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
