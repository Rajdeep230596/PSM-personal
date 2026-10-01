const film = document.getElementById("film");
const story = document.getElementById("story");
const chapters = [...document.querySelectorAll(".chapter")];
const progressBar = document.getElementById("progress-bar");
const chapterIndex = document.getElementById("chapter-index");
const nav = document.getElementById("nav");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let scrubQueued = false;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function storyProgress() {
  const total = story.offsetHeight - window.innerHeight;
  if (total <= 0) return 0;
  return clamp(-story.getBoundingClientRect().top / total, 0, 1);
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
    if (opacity > 0.45) active = index + 1;
  });
  chapterIndex.textContent = `0${active}  —  04`;
}

function scrub() {
  if (reduceMotion || !film.duration || scrubQueued) return;
  if (!film.seekable.length || film.seekable.end(film.seekable.length - 1) < 0.5) return;
  scrubQueued = true;
  requestAnimationFrame(() => {
    scrubQueued = false;
    const next = storyProgress() * Math.max(film.duration - 0.04, 0);
    if (Math.abs(next - film.currentTime) < 1 / 24) return;
    try {
      film.currentTime = next;
    } catch (err) {
      /* Seeking waits until the browser can buffer the film. */
    }
  });
}

function onScroll() {
  const progress = storyProgress();
  progressBar.style.width = `${progress * 100}%`;
  if (!reduceMotion) paintChapters(progress);
  nav.classList.toggle("is-solid", story.getBoundingClientRect().bottom < window.innerHeight * 0.9);
  scrub();
}

function unlockFilm() {
  film.pause();
  if (reduceMotion) {
    film.loop = true;
    film.play().catch(() => {});
    return;
  }
  onScroll();
}

film.addEventListener("loadedmetadata", unlockFilm);
film.addEventListener("progress", () => {
  if (!reduceMotion) scrub();
});
film.addEventListener("canplay", () => {
  if (!reduceMotion) scrub();
});

document.getElementById("year").textContent = String(new Date().getFullYear());

if (!reduceMotion) paintChapters(0);
window.addEventListener("scroll", onScroll, { passive: true });
onScroll();

window.addEventListener("resize", () => {
  if (!reduceMotion) onScroll();
});

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
