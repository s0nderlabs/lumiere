#!/usr/bin/env bun
/* lumiere-render - stable render entry point for lumiere-scaffolded projects.
   Usage:
     bun bin/lumiere-render.mjs <project-dir> [options]
   Options:
     --engine hyperframes|own|own-parallel   render engine (default: hyperframes)
     --fps <n>                  override fps (default: lock meta.render.fps, else 30)
     --quality draft|standard|high   (hyperframes engine; default high)
     --out <file>               output path relative to project (default: lock
                                meta.render.output, else renders/<project>.mp4)
     --resolution <preset>      hyperframes resolution preset (e.g. landscape-4k);
                                derived from the lock when render dims are an
                                integer multiple of stage dims
     --shards <n>               own-parallel engine only: worker count (default 4)
   The interface stays identical across engines: studio v2 shells to the
   hyperframes CLI, studio v3 swaps in lumiere's own pipeline via --engine own,
   and --engine own-parallel shards the own pipeline across N workers for fast
   4K (the only engine that handles a composition embedding a per-frame-seeked
   <video>, since it loads file:// and waits for each frame's `seeked`). */
import { spawnSync } from "node:child_process"
import { readFileSync, existsSync } from "node:fs"
import { resolve, join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))

function fail(msg) {
  console.error("lumiere-render: " + msg)
  process.exit(2)
}

const argv = process.argv.slice(2)
if (!argv.length || argv[0].startsWith("--")) {
  fail("usage: bun bin/lumiere-render.mjs <project-dir> [--engine hyperframes|own] [--fps N] [--quality q] [--out file] [--resolution preset]")
}

const projectDir = resolve(argv[0])
if (!existsSync(join(projectDir, "index.html"))) fail(`no index.html in ${projectDir}`)

const opts = { engine: "hyperframes", fps: null, quality: "high", out: null, resolution: null, shards: null }
for (let i = 1; i < argv.length; i++) {
  const a = argv[i]
  if (a === "--engine") opts.engine = argv[++i]
  else if (a === "--fps") opts.fps = Number(argv[++i])
  else if (a === "--quality") opts.quality = argv[++i]
  else if (a === "--out") opts.out = argv[++i]
  else if (a === "--resolution") opts.resolution = argv[++i]
  else if (a === "--shards") opts.shards = Number(argv[++i])
  else fail(`unknown option ${a}`)
}
if (!["hyperframes", "own", "own-parallel"].includes(opts.engine)) fail(`unknown engine ${opts.engine}`)
if (opts.fps != null && (!Number.isFinite(opts.fps) || opts.fps <= 0 || opts.fps > 240)) fail(`bad --fps value`)
if (opts.shards != null && (!Number.isInteger(opts.shards) || opts.shards < 1 || opts.shards > 16)) fail(`bad --shards value`)
if (opts.shards != null && opts.engine !== "own-parallel") console.error(`lumiere-render: note: --shards applies only to --engine own-parallel; ignored for ${opts.engine}`)

/* defaults from the project's lock, when present */
const lockPath = join(projectDir, "launch-video.lock.json")
let lock = null
if (existsSync(lockPath)) {
  try { lock = JSON.parse(readFileSync(lockPath, "utf8")) } catch (e) { fail(`unreadable lock: ${e.message}`) }
}
if (lock) {
  const r = lock.meta && lock.meta.render
  if (r) {
    if (opts.fps == null) opts.fps = r.fps
    if (opts.out == null && r.output) opts.out = r.output
    /* honor the lock's render dims on the hyperframes engine. The CLI only
       takes named presets, so derive the one we can; anything else must fail
       LOUDLY rather than silently render at stage resolution. The own /
       own-parallel engines honor any integer multiple directly (deviceScaleFactor),
       so they never consult opts.resolution and this whole block is hyperframes-only;
       the engines stay in agreement: neither ever under-renders a lock. */
    const s = lock.meta.stage
    if (opts.engine === "hyperframes" && opts.resolution == null && s && r.width && r.height && (r.width !== s.width || r.height !== s.height)) {
      if (r.width === s.width * 2 && r.height === s.height * 2 && s.width === 1920 && s.height === 1080) {
        opts.resolution = "landscape-4k"
      } else {
        fail(`lock render ${r.width}x${r.height} differs from stage ${s.width}x${s.height} and no hyperframes preset matches; pass --resolution <preset> or use --engine own / own-parallel (handles any integer multiple)`)
      }
    }
  }
}
if (opts.fps == null) opts.fps = 30
if (opts.out == null) opts.out = `renders/${lock && lock.meta ? lock.meta.project : "out"}.mp4`

console.log(`lumiere-render: ${projectDir}`)
console.log(`  engine=${opts.engine} fps=${opts.fps} quality=${opts.quality} out=${opts.out}${opts.resolution ? " resolution=" + opts.resolution : ""}${opts.engine === "own-parallel" && opts.shards != null ? " shards=" + opts.shards : ""}`)

if (opts.engine === "hyperframes") {
  const args = ["--yes", "hyperframes@0.6.7", "render", "-f", String(opts.fps), "-q", opts.quality, "-o", opts.out]
  if (opts.resolution) args.push("--resolution", opts.resolution)
  const res = spawnSync("npx", args, { cwd: projectDir, stdio: "inherit" })
  if (res.error) fail(`failed to spawn npx: ${res.error.message}`)
  process.exit(res.status ?? 1)
} else {
  /* studio v3: lumiere's own frame-exact pipeline. own = single-thread;
     own-parallel = sharded across N workers + per-frame video seeked-wait
     (the path for compositions embedding a per-frame-seeked <video>). */
  const script = opts.engine === "own-parallel" ? "own-renderer-parallel.mjs" : "own-renderer.mjs"
  const ownPath = join(here, "..", "render", script)
  if (!existsSync(ownPath)) fail(`${opts.engine} engine not available (render/${script} missing)`)
  const args = [ownPath, projectDir, "--fps", String(opts.fps), "--out", opts.out]
  if (opts.engine === "own-parallel" && opts.shards != null) args.push("--shards", String(opts.shards))
  const res = spawnSync("bun", args, { stdio: "inherit" })
  if (res.error) fail(`failed to spawn bun: ${res.error.message}`)
  process.exit(res.status ?? 1)
}
