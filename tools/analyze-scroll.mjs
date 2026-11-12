// Reads the frame-difference signal produced by
//   ffmpeg -vf "scale=240:-2,tblend=all_mode=difference,signalstats,metadata=print:file=..."
// and reports how the picture actually moves: stall runs, catch-up snaps,
// effective visible update rate, and a coarse timeline strip.
import { readFileSync } from 'node:fs';

const [file, label = file] = process.argv.slice(2);
const frames = [];
let cur = null;
for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
  const m = /^frame:(\d+)\s+pts:-?\d+\s+pts_time:([0-9.]+)/.exec(line);
  if (m) { cur = { n: +m[1], t: +m[2], y: null }; frames.push(cur); continue; }
  const v = /^lavfi\.signalstats\.YAVG=([0-9.]+)/.exec(line);
  if (v && cur) cur.y = +v[1];
}
const f = frames.filter((x) => x.y !== null).slice(1); // first diff frame is meaningless
if (!f.length) { console.log(`${label}: no frames parsed`); process.exit(0); }

const ys = f.map((x) => x.y).sort((a, b) => a - b);
const pct = (p) => ys[Math.min(ys.length - 1, Math.floor((p / 100) * ys.length))];
const p = { p1: pct(1), p5: pct(5), p10: pct(10), p25: pct(25), p50: pct(50), p75: pct(75), p90: pct(90), p99: pct(99), max: ys[ys.length - 1] };
const fps = (f.length - 1) / (f[f.length - 1].t - f[0].t);
const dur = f[f.length - 1].t - f[0].t;

// A frame "changed visibly" if its difference clears the noise floor.
const thr = Math.max(0.5, p.p25 * 0.5);
const changed = f.map((x) => x.y >= thr);

// run-length histogram of unchanged stretches
const runs = [];
let start = -1;
for (let i = 0; i < f.length; i++) {
  if (!changed[i]) { if (start < 0) start = i; }
  else if (start >= 0) { runs.push({ i: start, n: i - start, t: f[start].t }); start = -1; }
}
if (start >= 0) runs.push({ i: start, n: f.length - start, t: f[start].t });
const hist = new Map();
for (const r of runs) hist.set(r.n, (hist.get(r.n) || 0) + 1);

// catch-up snaps: a big jump right after a stall
const snaps = [];
for (let k = 0; k < runs.length; k++) {
  const r = runs[k];
  if (r.n < 2) continue;
  const after = f[r.i + r.n];
  if (!after) continue;
  if (after.y > Math.max(3, p.p90 * 1.6)) snaps.push({ t: after.t, stall: r.n / fps * 1000, y: after.y });
}

console.log(`\n===== ${label} =====`);
console.log(`frames ${f.length}, span ${dur.toFixed(2)}s, ${fps.toFixed(2)} fps, threshold ${thr.toFixed(2)}`);
console.log(`motion percentiles  p1 ${p.p1.toFixed(2)}  p5 ${p.p5.toFixed(2)}  p10 ${p.p10.toFixed(2)}  p25 ${p.p25.toFixed(2)}  p50 ${p.p50.toFixed(2)}  p75 ${p.p75.toFixed(2)}  p90 ${p.p90.toFixed(2)}  p99 ${p.p99.toFixed(2)}  max ${p.max.toFixed(2)}`);
console.log(`frames with visible change: ${changed.filter(Boolean).length}/${f.length} (${(100 * changed.filter(Boolean).length / f.length).toFixed(1)}%)`);

console.log(`\nunchanged-run histogram (frames -> count):`);
[...hist.entries()].sort((a, b) => a[0] - b[0]).forEach(([n, c]) => console.log(`  ${String(n).padStart(3)}f (${(n / fps * 1000).toFixed(0).padStart(4)}ms) x ${c}`));

const long = runs.filter((r) => r.n >= 3).sort((a, b) => b.n - a.n);
console.log(`\nlongest stalls (>=3 unchanged frames): ${long.length} total`);
long.slice(0, 12).forEach((r) => console.log(`  t=${r.t.toFixed(2)}s  ${r.n}f  ${(r.n / fps * 1000).toFixed(0)}ms`));

console.log(`\ncatch-up snaps (big jump after a stall): ${snaps.length}`);
snaps.slice(0, 12).forEach((s) => console.log(`  t=${s.t.toFixed(2)}s  after ${s.stall.toFixed(0)}ms stall  motion ${s.y.toFixed(1)}`));

console.log(`\nper-second: sec  changed%  meanY  maxY`);
const secs = Math.ceil(dur);
for (let s = 0; s < secs; s++) {
  const seg = f.filter((x) => x.t >= s && x.t < s + 1);
  if (!seg.length) continue;
  const ch = seg.filter((x, i) => x.y >= thr).length;
  const mean = seg.reduce((a, x) => a + x.y, 0) / seg.length;
  const mx = Math.max(...seg.map((x) => x.y));
  console.log(`${String(s).padStart(4)}  ${String(Math.round(100 * ch / seg.length)).padStart(7)}%  ${mean.toFixed(2).padStart(6)}  ${mx.toFixed(1).padStart(5)}`);
}

// one char per ~100ms: block median of motion
const per = Math.max(1, Math.round(fps / 10));
let strip = '';
for (let i = 0; i < f.length; i += per) {
  const block = f.slice(i, i + per).map((x) => x.y).sort((a, b) => a - b);
  const med = block[Math.floor(block.length / 2)] || 0;
  strip += med >= p.p75 ? '#' : med >= p.p50 ? '+' : med >= thr ? '-' : med > 0.05 ? ':' : ' ';
}
console.log(`\ntimeline (1 char = ${(1000 * per / fps).toFixed(0)}ms; # fast  + normal  - slow  : crawl  ' ' frozen)`);
for (let i = 0; i < strip.length; i += 100) console.log(`  ${String((i * per / fps).toFixed(1)).padStart(6)}s |${strip.slice(i, i + 100)}|`);
