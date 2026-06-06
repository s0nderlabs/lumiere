#!/usr/bin/env bun
/* lumiere own render pipeline (studio v3).
   Frame-exact renderer for HyperFrames-dialect compositions: drives the
   registered paused timeline (window.__timelines) by seeking t = frame/fps,
   screenshots each frame via system Chrome (puppeteer-core), and pipes the
   PNG stream into ffmpeg for H.264 encode.

   Requirements (all guaranteed by creation/RESTAGE.md for lumiere scaffolds):
   - ALL motion lives on the registered master timeline (no wall-clock timers,
     no rAF loops, no CSS infinite animations, no unanchored ambient tweens)
   - deterministic logic (seeded rng only, no network)
   Audio is NOT mixed by this engine yet (use --engine hyperframes for
   compositions with locked audio tracks).

   Usage: bun render/own-renderer.mjs <project-dir> [--fps N] [--out file] */
import puppeteer from "puppeteer-core"
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { resolve, join, dirname } from "node:path"

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

function fail(msg) {
  console.error("own-renderer: " + msg)
  process.exit(2)
}

const argv = process.argv.slice(2)
if (!argv.length || argv[0].startsWith("--")) fail("usage: bun render/own-renderer.mjs <project-dir> [--fps N] [--out file]")
const projectDir = resolve(argv[0])
const entry = join(projectDir, "index.html")
if (!existsSync(entry)) fail(`no index.html in ${projectDir}`)
if (!existsSync(CHROME)) fail(`Chrome not found at ${CHROME}`)

let fps = null
let out = null
for (let i = 1; i < argv.length; i++) {
  const a = argv[i]
  if (a === "--fps") fps = Number(argv[++i])
  else if (a === "--out") out = argv[++i]
  else fail(`unknown option ${a}`)
}

/* lock-driven defaults, same precedence as bin/lumiere-render.mjs (flags win),
   so direct invocation and the wrapper agree on fps/output */
const lockPath = join(projectDir, "launch-video.lock.json")
let lock = null
if (existsSync(lockPath)) {
  try { lock = JSON.parse(readFileSync(lockPath, "utf8")) } catch (e) { fail(`unreadable lock: ${e.message}`) }
}
const lockRender = lock && lock.meta && lock.meta.render
if (fps == null && lockRender && lockRender.fps) fps = lockRender.fps
if (out == null && lockRender && lockRender.output) out = lockRender.output
if (fps == null) fps = 30
if (out == null) out = "renders/own.mp4"
if (!Number.isFinite(fps) || fps <= 0 || fps > 240) fail(`bad fps ${fps}`)
const outAbs = resolve(projectDir, out)
mkdirSync(dirname(outAbs), { recursive: true })

const t0 = Date.now()
console.log(`own-renderer: ${entry}`)

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--force-color-profile=srgb", "--hide-scrollbars", "--disable-extensions", "--mute-audio"],
})

try {
  const page = await browser.newPage()

  /* probe stage dimensions first at a neutral viewport */
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 })
  await page.goto("file://" + entry, { waitUntil: "load", timeout: 60000 })
  await page.evaluate(() => document.fonts.ready.then(() => true))

  const stage = await page.evaluate(() => {
    const s = document.querySelector("[data-composition-id]")
    if (!s) return null
    return { w: Number(s.dataset.width || 1920), h: Number(s.dataset.height || 1080) }
  })
  if (!stage) fail("no [data-composition-id] stage element found")

  /* delivery resolution: when the project lock asks for an INTEGER multiple
     of the stage (e.g. 4k from a 1080 stage), upscale via deviceScaleFactor -
     the same mechanism the hyperframes renderer uses. Non-integer ratios are
     a loud error, never a silent stage-res render. */
  let scale = 1
  if (lockRender && lockRender.width && lockRender.height) {
    const k = lockRender.width / stage.w
    if (k !== lockRender.height / stage.h || !Number.isInteger(k) || k < 1) {
      fail(`lock render ${lockRender.width}x${lockRender.height} is not an integer multiple of stage ${stage.w}x${stage.h} (use --engine hyperframes or fix the lock)`)
    }
    scale = k
  }
  if (stage.w !== 1920 || stage.h !== 1080 || scale !== 1) {
    await page.setViewport({ width: stage.w, height: stage.h, deviceScaleFactor: scale })
  }
  /* neutralize the shell's preview scale-fit: with viewport pinned to stage
     size a spec-conformant fitStage resolves to scale(1), but older shells
     hardcode 1920/1080 divisors and would CSS-shrink a non-1920 stage inside
     its own viewport. Forcing transform none is exact for every stage size
     (no further resizes occur after this point). */
  await page.evaluate(() => {
    const s = document.querySelector("[data-composition-id]")
    if (s) s.style.transform = "none"
  })

  /* wait for the timeline registry (registered LAST in the composition script),
     then take exclusive control: pause, rewind, and DISARM play so the
     composition's standalone autoplay kicker can never race the seek loop
     (the same disarm pattern the anima reference uses for sub-comps) */
  let info = null
  for (let tries = 0; tries < 50 && !info; tries++) {
    info = await page.evaluate(() => {
      const reg = window.__timelines
      if (!reg) return null
      const tl = reg.main || Object.values(reg)[0]
      if (!tl) return null
      window.__renderTl = tl
      tl.pause()
      tl.time(0)
      tl.play = function () { return this }
      tl.resume = function () { return this }
      tl.restart = function () { return this }
      const d = tl.duration()
      return Number.isFinite(d) && d > 0 ? { duration: d } : { bad: true }
    })
    if (info && info.bad) fail("registered timeline has a non-finite duration (infinite repeat reached the master?)")
    if (!info) await new Promise(r => setTimeout(r, 100))
  }
  if (!info) fail("no window.__timelines registry appeared within 5s")

  const duration = info.duration
  /* exact hyperframes@0.6.7 frame count: ceil(duration * fps), exclusive loop
     seeking t = f/fps (it never seeks t = duration). A +1 "inclusive" count
     would run one frame long on any integer-frame duration. */
  const totalFrames = Math.ceil(duration * fps)
  console.log(`  stage=${stage.w}x${stage.h} scale=${scale}x (output ${stage.w * scale}x${stage.h * scale}) duration=${duration}s fps=${fps} frames=${totalFrames}`)

  /* ffmpeg encode via image2pipe */
  const ff = spawn("ffmpeg", [
    "-y", "-loglevel", "error",
    "-f", "image2pipe", "-framerate", String(fps), "-i", "-",
    "-c:v", "libx264", "-preset", "medium", "-crf", "18",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    outAbs,
  ], { stdio: ["pipe", "inherit", "inherit"] })

  const ffDone = new Promise((res, rej) => {
    ff.on("close", code => code === 0 ? res() : rej(new Error("ffmpeg exited " + code)))
    ff.on("error", rej)
  })

  const writeFrame = buf => new Promise((res, rej) => {
    const ok = ff.stdin.write(buf, err => err && rej(err))
    if (ok) res()
    else ff.stdin.once("drain", res)
  })

  for (let f = 0; f < totalFrames; f++) {
    const t = f / fps
    await page.evaluate(tt => { window.__renderTl.pause(); window.__renderTl.time(tt, false) }, t)
    const png = await page.screenshot({ type: "png" })
    await writeFrame(png)
    if (f % 120 === 0 || f === totalFrames - 1) {
      console.log(`  frame ${f + 1}/${totalFrames} (${((f + 1) / totalFrames * 100).toFixed(0)}%)`)
    }
  }

  ff.stdin.end()
  await ffDone
  console.log(`own-renderer: ${outAbs} · ${((Date.now() - t0) / 1000).toFixed(1)}s · completed`)
} finally {
  await browser.close()
}
