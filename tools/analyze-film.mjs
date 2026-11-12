// Freeze analysis gated by what is actually on screen. Text panels scroll with
// tiny frame deltas and fake "stalls", so each frame is classified as film
// (bright letterboxed photo) or text/dark panel using centre-crop luma, and the
// two are judged with different thresholds.
import { readFileSync } from 'node:fs';

const [diffFile, lumaFile, label = diffFile, tArg] = process.argv.slice(2);
const T = tArg ? +tArg : 30;

function parse(file) {
  const rows = [];
  let cur = null;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^frame:(\d+)\s+pts:-?\d+\s+pts_time:([0-9.]+)/.exec(line);
    if (m) { cur = { t: +m[2], y: null }; rows.push(cur); continue; }
    const v = /^lavfi\.signalstats\.YAVG=([0-9.]+)/.exec(line);
    if (v && cur) cur.y = +v[1];
  }
  return rows.filter((r) => r.y !== null);
}

const diff = parse(diffFile).slice(1);
const luma = parse(lumaFile);
const fps = (diff.length - 1) / (diff[diff.length - 1].t - diff[0].t);
const lumaAt = (t) => {
  let lo = 0, hi = luma.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (luma[mid].t < t) lo = mid + 1; else hi = mid; }
  return luma[lo] ? luma[lo].y : 0;
};

const L = luma.map((r) => r.y).slice().sort((a, b) => a - b);
const pct = (p) => L[Math.min(L.length - 1, Math.floor(p / 100 * L.length))];
console.log(`\n===== ${label} =====`);
console.log(`luma(centre crop) p5 ${pct(5).toFixed(1)} p25 ${pct(25).toFixed(1)} p50 ${pct(50).toFixed(1)} p75 ${pct(75).toFixed(1)} p95 ${pct(95).toFixed(1)}  -> film gate ${T}`);

const isFilm = diff.map((r) => lumaAt(r.t) >= T);
const filmPct = 100 * isFilm.filter(Boolean).length / isFilm.length;
console.log(`frames on film: ${filmPct.toFixed(1)}%   on text/dark: ${(100 - filmPct).toFixed(1)}%`);

// film panels: photo motion is unmistakable, same threshold as before
// text panels: small deltas, so a much lower threshold
const changed = diff.map((r, i) => r.y >= (isFilm[i] ? 0.5 : 0.08));

const runs = [];
let start = -1;
for (let i = 0; i < diff.length; i++) {
  if (!changed[i]) { if (start < 0) start = i; }
  else if (start >= 0) { runs.push({ i: start, n: i - start, t: diff[start].t }); start = -1; }
}
if (start >= 0) runs.push({ i: start, n: diff.length - start, t: diff[start].t });

const idxAt = (t) => { let lo = 0, hi = diff.length - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (diff[mid].t < t) lo = mid + 1; else hi = mid; } return lo; };
const rate = (a, b) => {
  const s = Math.max(0, idxAt(a)), e = Math.min(diff.length, idxAt(b));
  if (e <= s) return -1;
  let c = 0; for (let i = s; i < e; i++) if (changed[i]) c++;
  return c / (e - s);
};

const onFilm = runs.filter((r) => isFilm[r.i]);
const ms = (n) => n / fps * 1000;
const stalls = [];
for (const r of onFilm) {
  if (ms(r.n) < 100) continue;
  const pre = rate(diff[r.i].t - 0.35, diff[r.i].t);
  const tEnd = diff[r.i + r.n] ? diff[r.i + r.n].t : 1e9;
  const post = rate(tEnd, tEnd + 0.35);
  if (pre < 0.45 || post < 0.45) continue; // pause, not a stall
  let burst = 0;
  for (let k = r.i + r.n; k < Math.min(diff.length, r.i + r.n + Math.round(fps * 0.2)); k++) burst = Math.max(burst, diff[k].y);
  stalls.push({ t: r.t, dur: ms(r.n), pre, post, burst });
}

// how often the film actually advanced while it was on screen and moving
let filmFrames = 0, filmChanged = 0, textFrames = 0, textChanged = 0;
for (let i = 0; i < diff.length; i++) {
  if (isFilm[i]) { filmFrames++; if (changed[i]) filmChanged++; }
  else { textFrames++; if (changed[i]) textChanged++; }
}
console.log(`film frames advancing: ${(100 * filmChanged / filmFrames).toFixed(1)}%  (${(fps * filmChanged / filmFrames).toFixed(1)} updates/s at ${fps.toFixed(1)} fps recording)`);
console.log(`text frames advancing: ${(100 * textChanged / textFrames).toFixed(1)}%`);
console.log(`film stalls (finger moving both sides, >=100ms): ${stalls.length}, total ${(stalls.reduce((a, s) => a + s.dur, 0) / 1000).toFixed(2)}s`);
console.log(`   over 200ms: ${stalls.filter((s) => s.dur > 200).length}   over 400ms: ${stalls.filter((s) => s.dur > 400).length}   with snap-after: ${stalls.filter((s) => s.burst > 8).length}`);
console.log(`   time    freeze  before  after  snap`);
for (const s of stalls.sort((a, b) => b.dur - a.dur).slice(0, 15)) {
  console.log(`  ${s.t.toFixed(2).padStart(6)}s  ${s.dur.toFixed(0).padStart(5)}ms  ${(100 * s.pre).toFixed(0).padStart(4)}%  ${(100 * s.post).toFixed(0).padStart(4)}%  ${s.burst.toFixed(1).padStart(4)}`);
}
