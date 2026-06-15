#!/usr/bin/env bun
/* lumiere parallel own-renderer (studio v3.1).
   Frame-exact, sharded 4K renderer for compositions that EMBED a <video>
   driven by the master timeline (demo.currentTime = playhead, per frame).

   Why this exists, separate from own-renderer.mjs and the hyperframes engine:
   - hyperframes serves the project over http and fans out parallel workers, but
     (a) a file:// <video> src cannot load from an http origin (browser blocks
     it) and (b) hyperframes has no <video> seeked-wait, so an embedded-video
     composition tears under it. It was built for pure DOM/GSAP comps.
   - own-renderer.mjs loads over file:// (same-origin to the video) and is
     correct, but single-threaded: ~1h+ at 4K.
   This engine keeps own-renderer's correctness (file:// load + deviceScaleFactor
   upscaling + timeline disarm) and adds the two things 4K-with-video needs:
     1. a per-frame `seeked`-wait so the all-intra decode lands on the exact
        frame BEFORE the screenshot (no torn/stale video frames),
     2. frame-range sharding across N worker processes, each rendering its slice
        to an H.264 segment; the parent concat-copies the segments (instant, no
        giant PNG dump on disk).

   Audio is NOT mixed (same as own-renderer.mjs). Mux the locked audio after,
   or use --engine hyperframes for audio-only comps.

   Usage:
     bun render/own-renderer-parallel.mjs <project-dir> [--fps N] [--out file]
                                          [--shards K] [--no-seek-wait]
   Defaults: fps/out from launch-video.lock.json meta.render; shards = 4
   (tuned for a 16GB box with a ~1.7GB all-intra source: each worker
   memory-maps its own copy of the video + holds 4K decode/screenshot buffers).
*/
import puppeteer from "puppeteer-core"
import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { resolve, join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const SELF = fileURLToPath(import.meta.url)

function fail(msg) { console.error("own-parallel: " + msg); process.exit(2) }

const argv = process.argv.slice(2)
const IS_WORKER = argv.includes("--worker")
function opt(name, def = null) { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def }
function flag(name) { return argv.includes(name) }

const projectDir = resolve(argv.find(a => !a.startsWith("--")) || ".")
const entry = join(projectDir, "index.html")
if (!existsSync(entry)) fail(`no index.html in ${projectDir}`)
if (!existsSync(CHROME)) fail(`Chrome not found at ${CHROME}`)

/* lock-driven defaults (flags win), identical precedence to own-renderer.mjs */
const lockPath = join(projectDir, "launch-video.lock.json")
let lock = null
if (existsSync(lockPath)) {
  try { lock = JSON.parse(readFileSync(lockPath, "utf8")) } catch (e) { fail(`unreadable lock: ${e.message}`) }
}
const lockRender = lock && lock.meta && lock.meta.render

let fps = opt("--fps") != null ? Number(opt("--fps")) : (lockRender && lockRender.fps) || 30
if (!Number.isFinite(fps) || fps <= 0 || fps > 240) fail(`bad fps ${fps}`)
let out = opt("--out") || (lockRender && lockRender.output) || "renders/own.mp4"
const SEEK_WAIT = !flag("--no-seek-wait")

/* compute viewport + scale + duration from the loaded composition. Shared by
   the parent probe (reads duration, then closes) and each worker (renders). */
async function setupPage(browser) {
  const page = await browser.newPage()
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 })
  await page.goto("file://" + entry, { waitUntil: "load", timeout: 60000 })
  await page.evaluate(() => document.fonts.ready.then(() => true))

  const stage = await page.evaluate(() => {
    const s = document.querySelector("[data-composition-id]")
    if (!s) return null
    return { w: Number(s.dataset.width || 1920), h: Number(s.dataset.height || 1080) }
  })
  if (!stage) fail("no [data-composition-id] stage element found")

  let scale = 1
  if (lockRender && lockRender.width && lockRender.height) {
    const k = lockRender.width / stage.w
    if (k !== lockRender.height / stage.h || !Number.isInteger(k) || k < 1) {
      fail(`lock render ${lockRender.width}x${lockRender.height} is not an integer multiple of stage ${stage.w}x${stage.h}`)
    }
    scale = k
  }
  if (stage.w !== 1920 || stage.h !== 1080 || scale !== 1) {
    await page.setViewport({ width: stage.w, height: stage.h, deviceScaleFactor: scale })
  }
  await page.evaluate(() => { const s = document.querySelector("[data-composition-id]"); if (s) s.style.transform = "none" })

  /* register + take exclusive control of the master timeline (disarm autoplay) */
  let info = null
  for (let tries = 0; tries < 50 && !info; tries++) {
    info = await page.evaluate(() => {
      const reg = window.__timelines
      if (!reg) return null
      const tl = reg.main || Object.values(reg)[0]
      if (!tl) return null
      window.__renderTl = tl
      tl.pause(); tl.time(0)
      tl.play = function () { return this }
      tl.resume = function () { return this }
      tl.restart = function () { return this }
      const d = tl.duration()
      return Number.isFinite(d) && d > 0 ? { duration: d } : { bad: true }
    })
    if (info && info.bad) fail("registered timeline has a non-finite duration")
    if (!info) await new Promise(r => setTimeout(r, 100))
  }
  if (!info) fail("no window.__timelines registry appeared within 5s")
  return { page, stage, scale, duration: info.duration }
}

/* seek the timeline to t and (optionally) WAIT for the embedded <video> to
   finish decoding to that currentTime before returning. One round-trip,
   resolves immediately when nothing is seeking (frames outside the video
   window), with a hard safety timeout so a stuck decode can never hang. */
const SEEK_JS = (tt, wait) => {
  const tl = window.__renderTl
  tl.pause(); tl.time(tt, false)
  if (!wait) return true
  return new Promise((res) => {
    const v = document.getElementById("demo") || document.querySelector("video")
    if (!v || !v.currentSrc || v.readyState < 1 || !v.seeking) return res(true)
    let done = false
    const fin = () => { if (done) return; done = true; v.removeEventListener("seeked", fin); res(true) }
    v.addEventListener("seeked", fin)
    setTimeout(fin, 2000)
  })
}

async function renderRange(page, start, end, fps, ffStdin) {
  for (let f = start; f < end; f++) {
    const t = f / fps
    await page.evaluate(SEEK_JS, t, SEEK_WAIT)
    const png = await page.screenshot({ type: "png" })
    await new Promise((res, rej) => {
      const ok = ffStdin.write(png, err => err && rej(err))
      ok ? res() : ffStdin.once("drain", res)
    })
    if ((f - start) % 120 === 0) console.log(`  [shard ${opt("--shard-id", "?")}] frame ${f - start + 1}/${end - start}`)
  }
}

function ffmpegSegment(fps, segPath) {
  const ff = spawn("ffmpeg", [
    "-y", "-loglevel", "error",
    "-f", "image2pipe", "-framerate", String(fps), "-i", "-",
    "-c:v", "libx264", "-preset", "medium", "-crf", "16",
    "-x264-params", "open-gop=0",
    "-pix_fmt", "yuv420p",
    segPath,
  ], { stdio: ["pipe", "inherit", "inherit"] })
  const done = new Promise((res, rej) => {
    ff.on("close", code => code === 0 ? res() : rej(new Error("ffmpeg exited " + code)))
    ff.on("error", rej)
  })
  return { ff, done }
}

/* ----------------------------- WORKER MODE ----------------------------- */
if (IS_WORKER) {
  const start = Number(opt("--frame-start"))
  const end = Number(opt("--frame-end"))
  const seg = opt("--seg")
  if (!Number.isInteger(start) || !Number.isInteger(end) || !seg) fail("worker needs --frame-start --frame-end --seg")

  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: ["--force-color-profile=srgb", "--hide-scrollbars", "--disable-extensions", "--mute-audio"],
  })
  let ff = null
  try {
    const { page } = await setupPage(browser)
    /* one-time readiness gate: a freshly-launched worker must not screenshot the
       embedded <video> before it has decodable data, or the first in-window
       frames of its range tear. Resolves at once when there is no video. */
    if (SEEK_WAIT) await page.evaluate(() => new Promise((res) => {
      const v = document.getElementById("demo") || document.querySelector("video")
      if (!v || !v.currentSrc || v.readyState >= 2) return res(true)
      const fin = () => res(true)
      v.addEventListener("loadeddata", fin, { once: true })
      v.addEventListener("canplay", fin, { once: true })
      setTimeout(fin, 15000)
    }))
    const seg2 = ffmpegSegment(fps, seg); ff = seg2.ff
    await renderRange(page, start, end, fps, ff.stdin)
    ff.stdin.end()
    await seg2.done
    ff = null
    console.log(`  [shard ${opt("--shard-id", "?")}] done: frames ${start}..${end - 1} -> ${seg}`)
  } finally {
    /* on the throw path ff is still live: kill it so it cannot finalize a
       truncated segment (the parent also rejects on this worker's non-zero exit) */
    if (ff && ff.exitCode === null) { try { ff.kill("SIGKILL") } catch (_) {} }
    await browser.close()
  }
  process.exit(0)
}

/* ----------------------------- PARENT MODE ----------------------------- */
let shards = opt("--shards") != null ? Number(opt("--shards")) : 4
if (!Number.isInteger(shards) || shards < 1 || shards > 16) fail(`bad --shards ${shards}`)

const t0 = Date.now()
console.log(`own-parallel: ${entry}`)

/* probe duration once */
const probe = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--mute-audio", "--hide-scrollbars"] })
let stage, scale, duration
try { ({ stage, scale, duration } = await setupPage(probe)) } finally { await probe.close() }

const totalFrames = Math.ceil(duration * fps)
if (shards > totalFrames) shards = totalFrames
console.log(`  stage=${stage.w}x${stage.h} scale=${scale}x (output ${stage.w * scale}x${stage.h * scale}) duration=${duration}s fps=${fps} frames=${totalFrames}`)
console.log(`  shards=${shards} seek-wait=${SEEK_WAIT ? "on" : "off"}`)

/* contiguous, gap-free ranges: shard k = [floor(k*T/N), floor((k+1)*T/N)) */
const outAbs = resolve(projectDir, out)
mkdirSync(dirname(outAbs), { recursive: true })
const shardDir = join(dirname(outAbs), ".shards")
rmSync(shardDir, { recursive: true, force: true })   // clear any stale segments from a prior failed run
mkdirSync(shardDir, { recursive: true })

const ranges = []
for (let k = 0; k < shards; k++) {
  const a = Math.floor((k * totalFrames) / shards)
  const b = Math.floor(((k + 1) * totalFrames) / shards)
  if (b > a) ranges.push({ k, a, b, seg: join(shardDir, `seg-${String(k).padStart(2, "0")}.mp4`) })
}

console.log(`  spawning ${ranges.length} workers...`)
const children = ranges.map(r => {
  const args = [SELF, projectDir, "--worker", "--frame-start", String(r.a), "--frame-end", String(r.b),
    "--seg", r.seg, "--fps", String(fps), "--shard-id", String(r.k)]
  if (!SEEK_WAIT) args.push("--no-seek-wait")
  return spawn("bun", args, { stdio: "inherit" })
})
const procs = children.map((p, i) => new Promise((res, rej) => {
  p.on("close", code => code === 0 ? res(ranges[i]) : rej(new Error(`shard ${ranges[i].k} exited ${code}`)))
  p.on("error", rej)
}))

try {
  await Promise.all(procs)
} catch (e) {
  /* one shard died: SIGTERM the siblings so puppeteer's default signal handler
     closes each worker's Chrome (else they orphan to launchd and pin memory) */
  for (const p of children) { if (p.exitCode === null) { try { p.kill("SIGTERM") } catch (_) {} } }
  fail(`a shard failed: ${e.message} (partial segments left in ${shardDir})`)
}

/* concat-copy the segments into the final master (each segment opens on an IDR,
   so stream-copy concat is seamless). */
const listPath = join(shardDir, "concat.txt")
/* concat-demuxer single-quote escaping: a literal ' inside a path becomes '\'' */
const ffEsc = s => s.replace(/'/g, "'\\''")
writeFileSync(listPath, ranges.map(r => `file '${ffEsc(r.seg)}'`).join("\n") + "\n")
console.log(`  concat ${ranges.length} segments -> ${outAbs}`)
const cat = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listPath,
  "-c", "copy", "-movflags", "+faststart", outAbs], { stdio: "inherit" })
if (cat.status !== 0) fail(`concat failed (status ${cat.status}); segments kept in ${shardDir}`)

rmSync(shardDir, { recursive: true, force: true })
console.log(`own-parallel: ${outAbs} · ${((Date.now() - t0) / 1000).toFixed(1)}s · completed`)
