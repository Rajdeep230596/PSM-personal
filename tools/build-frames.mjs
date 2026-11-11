// Builds the scrubbable frame tiers the site actually ships.
//
// masters : assets/frames/<reel>/NNN.jpg   (1280x720, the original render)
// wide    : assets/frames/1280/<reel>/NNN.jpg   laptops and desktops
// retina  : assets/frames/1080/<reel>/NNN.jpg   DPR-2/3 phones and tablets
// phone   : assets/frames/720/<reel>/NNN.jpg    1x phones and save-data
//
// Run: node tools/build-frames.mjs
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = "assets/frames";
const REELS = ["shot-1", "shot-2", "shot-3", "shot-4"];

// q:v 5 keeps the grade and the grain while cutting ~30% off the original
// encode. A 402pt iPhone spans 1206 device pixels, so 720 was visibly soft on
// it: 1080 lands at 1.12x instead of 1.68x for well under the 1280 payload.
// 720 q:v 6 is for 1x screens, where the extra pixels are never displayed.
const TIERS = [
  { dir: "1280", width: 1280, height: 720, quality: 5 },
  { dir: "1080", width: 1080, height: 608, quality: 6 },
  { dir: "720", width: 720, height: 404, quality: 6 },
];

const manifest = {};

for (const tier of TIERS) {
  for (const reel of REELS) {
    const from = join(ROOT, reel);
    const to = join(ROOT, tier.dir, reel);
    if (!existsSync(from)) throw new Error(`missing master reel ${from}`);
    const count = readdirSync(from).filter((name) => name.endsWith(".jpg")).length;
    if (!count) throw new Error(`no frames in ${from}`);
    mkdirSync(to, { recursive: true });
    execFileSync(
      "ffmpeg",
      [
        "-v", "error", "-y",
        "-f", "image2", "-start_number", "0", "-i", join(from, "%03d.jpg"),
        "-vf", `scale=${tier.width}:${tier.height}:flags=lanczos`,
        "-q:v", String(tier.quality),
        "-pix_fmt", "yuvj420p",
        "-f", "image2", "-start_number", "0", join(to, "%03d.jpg"),
      ],
      { stdio: "inherit" }
    );
    console.log(`${tier.dir}/${reel}: ${count} frames`);
  }
}

const masters = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
for (const reel of REELS) manifest[reel] = masters[reel];
manifest.tiers = TIERS.map((tier) => tier.dir);
writeFileSync(join(ROOT, "manifest.json"), `${JSON.stringify(manifest)}\n`);

// main.js carries the same table inline so the first frame never waits on a
// manifest request. Keep the two in sync from this single source.
const block = /\/\* REELS:START \*\/[\s\S]*?\/\* REELS:END \*\//;
const mainJs = readFileSync("main.js", "utf8");
if (!block.test(mainJs)) throw new Error("main.js is missing the REELS:START / REELS:END markers");
const inline = {};
for (const reel of REELS) inline[reel] = manifest[reel];
writeFileSync(
  "main.js",
  mainJs.replace(block, `/* REELS:START */ ${JSON.stringify(inline, null, 2)} /* REELS:END */`)
);
console.log("manifest updated, main.js reel table inlined");
