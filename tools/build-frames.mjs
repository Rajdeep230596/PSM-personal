// Builds the scrubbable frame tiers the site actually ships.
//
// masters : assets/frames/<reel>/NNN.jpg   (1280x720, the original render)
// wide    : assets/frames/1280/<reel>/NNN.webp   laptops and desktops
// retina  : assets/frames/1080/<reel>/NNN.webp   DPR-2/3 phones and tablets
// phone   : assets/frames/720/<reel>/NNN.webp    1x phones and save-data
// motion  : assets/frames/motion/<reel>/NNN.webp 480px, drawn while scrolling
//
// WebP replaces the JPEG tiers at matched visual quality and roughly 40% fewer
// bytes. The motion tier exists so a moving scrub never waits for a full
// resolution frame: the light encode paints during the scroll, and the crisp
// frame of the same index replaces it the moment the scroll settles.
//
// Run: node tools/build-frames.mjs
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = "assets/frames";
const REELS = ["shot-1", "shot-2", "shot-3", "shot-4"];

// Quality is set to match the JPEG tiers these replace: 1280 keeps the grade
// and the grain, 1080 and 720 are a touch tighter, motion is only ever shown
// mid-flick and is replaced by the crisp frame as soon as the scroll stops.
// Measured on this library: the 1280 JPEG tier is 25 MB at 40 KB a frame, and
// WebP q84 is 22 MB at 35 KB with more detail kept, so the crisp tiers stay at
// the top of the WebP range and nothing looks worse than it did. The motion
// tier is 480px q58, 7.8 KB a frame, so a whole reel of coverage costs 1.2 MB.
const TIERS = [
  { dir: "1280", width: 1280, height: 720, quality: 84 },
  { dir: "1080", width: 1080, height: 608, quality: 82 },
  { dir: "720", width: 720, height: 404, quality: 80 },
  { dir: "motion", width: 480, height: 270, quality: 58 },
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
        "-c:v", "libwebp",
        "-quality", String(tier.quality),
        "-compression_level", "6",
        "-pix_fmt", "yuv420p",
        "-f", "image2", "-start_number", "0", join(to, "%03d.webp"),
      ],
      { stdio: "inherit" }
    );
    console.log(`${tier.dir}/${reel}: ${count} frames`);
  }
}

const masters = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
for (const reel of REELS) manifest[reel] = masters[reel];
manifest.tiers = TIERS.map((tier) => tier.dir);
manifest.motion = "motion";
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
