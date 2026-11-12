// Classifies every freeze in a recording: a deliberate pause (no motion before
// or after) versus a scroll stall (the finger was still moving on both sides).
import { readFileSync } from 'node:fs';

const [file, label = file, fpsArg] = process.argv.slice(2);
const frames = [];
let cur = null;
for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
  const m = /^frame:(\d+)\s+pts:-?\d+\s+pts_time:([0-9.]+)/.exec(line);
  if (m) { cur = { n: +m[1], t: +m[2], y: null }; frames.push(cur); continue; }
  const v = /^lavfi\.signalstats\.YAVG=([0-9.]+)/.exec(line);
  if (v && cur) cur.y = +v[1];
}
const f = frames.filter((x) => x.y !== null).slice(1);
const fps = fpsArg ? +fpsArg : (f.length - 1) / (f[f.length - 1].t - f[0].t);
const thr = 0.5;
const changed = f.map((x) => x.y >= thr);
const idxAt = (t) => { let lo = 0, hi = f.length - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (f[mid].t < t) lo = mid + 1; else hi = mid; } return lo; };
const pctBetween = (a, b) => {
  const s = Math.max(0, idxAt(a)), e = Math.min(f.length, idxAt(b));
  if (e <= s) return -1;
  let c = 0; for (let i = s; i < e; i++) if (changed[i]) c++;
  return c / (e - s);
};

const runs = [];
let start = -1;
for (let i = 0; i < f.length; i++) {
  if (!changed[i]) { if (start < 0) start = i; }
  else if (start >= 0) { runs.push({ i: start, n: i - start, t: f[start].t }); start = -1; }
}
if (start >= 0) runs.push({ i: start, n: f.length - start, t: f[start].t });

const ms = (n) => n / fps * 1000;
const events = [];
for (const r of runs) {
  const dur = ms(r.n);
  if (dur < 120) continue;
  const pre = pctBetween(f[r.i].t - 0.35, f[r.i].t);
  const post = pctBetween(f[r.i + r.n] ? f[r.i + r.n].t : 1e9, (f[r.i + r.n] ? f[r.i + r.n].t : 1e9) + 0.35);
  let burst = 0;
  for (let k = r.i + r.n; k < Math.min(f.length, r.i + r.n + Math.round(fps * 0.2)); k++) burst = Math.max(burst, f[k].y);
  const kind = pre >= 0.5 && post >= 0.5 ? 'STALL' : pre <= 0.15 && post <= 0.15 ? 'pause' : 'mixed';
  events.push({ t: r.t, dur, pre, post, burst, kind });
}

// chapter switches: content swaps produce the largest frame deltas
const ys = f.map((x) => x.y).slice().sort((a, b) => a - b);
const p99 = ys[Math.floor(ys.length * 0.99)];
const cuts = [];
for (let i = 1; i < f.length; i++) {
  if (f[i].y >= Math.max(p99, 8) && f[i].t - (cuts.at(-1) || -9) > 0.5) cuts.push(f[i].t);
}

const relevant = events.filter((e) => e.pre !== -1 && e.post !== -1);
const stalls = relevant.filter((e) => e.kind === 'STALL');
const pauses = relevant.filter((e) => e.kind === 'pause');
const totalStall = stalls.reduce((a, e) => a + e.dur, 0);

console.log(`\n===== ${label} =====`);
console.log(`freezes >=120ms: ${relevant.length}  ->  scroll stalls ${stalls.length} (${(totalStall / 1000).toFixed(2)}s)  deliberate pauses ${pauses.length}`);
console.log(`scroll stalls over 200ms: ${stalls.filter((e) => e.dur > 200).length}, over 400ms: ${stalls.filter((e) => e.dur > 400).length}`);
console.log(`post-stall snap (jump > 8): ${stalls.filter((e) => e.burst > 8).length}`);
console.log(`\nscroll stalls (finger moving before and after):`);
console.log(`   time   freeze   before%  after%  snap`);
for (const e of stalls.sort((a, b) => b.dur - a.dur).slice(0, 20)) {
  console.log(`  ${e.t.toFixed(2).padStart(6)}s  ${e.dur.toFixed(0).padStart(5)}ms  ${(100 * e.pre).toFixed(0).padStart(6)}%  ${(100 * e.post).toFixed(0).padStart(5)}%  ${e.burst.toFixed(1).padStart(5)}`);
}
console.log(`\nchapter/content switches detected: ${cuts.length} at ${cuts.slice(0, 20).map((t) => t.toFixed(1) + 's').join(', ')}`);
