import { join } from "path"
import type { AnalysisFilters, SceneChange, Interval } from "../types.js"
import { formatHMSPrecise } from "../utils/timestamps.js"

export interface AnalysisCommandResult {
  args: string[]
  videoMetaFile: string
}

export function buildAnalysisCommand(videoPath: string, filters: AnalysisFilters, workDir: string): AnalysisCommandResult | null {
  const videoMetaFile = join(workDir, "video_meta.txt")
  const videoFilters: string[] = []

  if (filters.scene_changes) videoFilters.push("scdet=threshold=10")
  if (filters.black_intervals) videoFilters.push("blackdetect=d=0.1:pic_th=0.98:pix_th=0.10")
  if (filters.freeze) videoFilters.push("freezedetect=n=-60dB:d=2")
  if (filters.motion) videoFilters.push("siti=print_summary=1")
  if (filters.blur) videoFilters.push("blurdetect")
  if (filters.exposure) videoFilters.push("signalstats")
  if (videoFilters.length > 0) videoFilters.push(`metadata=mode=print:file=${videoMetaFile}`)

  const audioFilters: string[] = []
  if (filters.silence) audioFilters.push("silencedetect=n=-40dB:d=0.5")
  if (filters.loudness) audioFilters.push("ebur128=metadata=1")

  if (videoFilters.length === 0 && audioFilters.length === 0) return null

  const args: string[] = ["-i", videoPath, "-y"]
  if (videoFilters.length > 0) args.push("-vf", videoFilters.join(","))
  if (audioFilters.length > 0) args.push("-af", audioFilters.join(","))
  args.push("-f", "null", "-")
  return { args, videoMetaFile }
}

export function parseScdetOutput(stderr: string): SceneChange[] {
  const raw: { tSec: number; score: number }[] = []
  const re = /lavfi\.scd\.score=([\d.]+)\s+lavfi\.scd\.time=([\d.]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(stderr)) !== null) {
    raw.push({ tSec: parseFloat(m[2]), score: parseFloat(m[1]) })
  }
  return collapseSceneClusters(raw)
}

export function parseScdetFromMetaFile(content: string, threshold = 2): SceneChange[] {
  const raw: { tSec: number; score: number }[] = []
  let pts: number | null = null
  for (const line of content.split("\n")) {
    const p = line.match(/pts_time:([\d.]+)/)
    if (p) pts = parseFloat(p[1])
    const s = line.match(/lavfi\.scd\.score=([\d.]+)/)
    if (s && pts !== null) {
      const score = parseFloat(s[1])
      if (score >= threshold) raw.push({ tSec: pts, score })
    }
  }
  return collapseSceneClusters(raw)
}

// scdet emits a score CURVE per visual transition (often 5-20 frames of climbing score
// across a single cut). The agent expects ONE entry per actual cut. We collapse any
// run of detections within ≤0.5s into a single scene, keeping the highest-scoring frame.
export function collapseSceneClusters(raw: { tSec: number; score: number }[], windowSec = 0.5): SceneChange[] {
  if (raw.length === 0) return []
  raw.sort((a, b) => a.tSec - b.tSec)
  const out: SceneChange[] = []
  let cluster: { tSec: number; score: number }[] = [raw[0]]
  for (let i = 1; i < raw.length; i++) {
    const last = cluster[cluster.length - 1]
    if (raw[i].tSec - last.tSec <= windowSec) {
      cluster.push(raw[i])
    } else {
      const best = cluster.reduce((a, b) => (b.score > a.score ? b : a))
      out.push({ time: formatHMSPrecise(best.tSec, 3), score: best.score })
      cluster = [raw[i]]
    }
  }
  const last = cluster.reduce((a, b) => (b.score > a.score ? b : a))
  out.push({ time: formatHMSPrecise(last.tSec, 3), score: last.score })
  return out
}

export function parseBlackdetectOutput(stderr: string): Interval[] {
  const out: Interval[] = []
  const re = /black_start:([\d.]+)\s+black_end:([\d.]+)\s+black_duration:([\d.]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(stderr)) !== null) {
    out.push({ start: formatHMSPrecise(parseFloat(m[1])), end: formatHMSPrecise(parseFloat(m[2])), duration: parseFloat(m[3]) })
  }
  return out
}

export function parseSilenceOutput(stderr: string): Interval[] {
  const out: Interval[] = []
  const startRe = /silence_start:\s*([\d.]+)/g
  const endRe = /silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/g
  const starts: number[] = []
  const ends: { t: number; d: number }[] = []
  let m: RegExpExecArray | null
  while ((m = startRe.exec(stderr)) !== null) starts.push(parseFloat(m[1]))
  while ((m = endRe.exec(stderr)) !== null) ends.push({ t: parseFloat(m[1]), d: parseFloat(m[2]) })
  const n = Math.min(starts.length, ends.length)
  for (let i = 0; i < n; i++) {
    out.push({ start: formatHMSPrecise(starts[i], 3), end: formatHMSPrecise(ends[i].t, 3), duration: ends[i].d })
  }
  if (starts.length > ends.length) {
    for (let i = ends.length; i < starts.length; i++) {
      out.push({ start: formatHMSPrecise(starts[i], 3), end: formatHMSPrecise(starts[i], 3), duration: 0 })
    }
  }
  return out
}

export function parseFreezeOutput(stderr: string): Interval[] {
  const out: Interval[] = []
  const sRe = /freeze_start:\s*([\d.]+)/g
  const eRe = /freeze_end:\s*([\d.]+)/g
  const dRe = /freeze_duration:\s*([\d.]+)/g
  const starts: number[] = []
  const ends: number[] = []
  const durs: number[] = []
  let m: RegExpExecArray | null
  while ((m = sRe.exec(stderr)) !== null) starts.push(parseFloat(m[1]))
  while ((m = eRe.exec(stderr)) !== null) ends.push(parseFloat(m[1]))
  while ((m = dRe.exec(stderr)) !== null) durs.push(parseFloat(m[1]))
  for (let i = 0; i < starts.length; i++) {
    out.push({
      start: formatHMSPrecise(starts[i], 3),
      end: formatHMSPrecise(ends[i] ?? starts[i] + (durs[i] ?? 0), 3),
      duration: durs[i] ?? 0,
    })
  }
  return out
}

export function parseSitiOutput(stderr: string): { siAvg?: number; tiAvg?: number } {
  const si = stderr.match(/Spatial Information:\s*\n\s*Average:\s*([\d.]+)/)
  const ti = stderr.match(/Temporal Information:\s*\n\s*Average:\s*([\d.]+)/)
  if (si || ti) return { siAvg: si ? parseFloat(si[1]) : undefined, tiAvg: ti ? parseFloat(ti[1]) : undefined }

  const siVals: number[] = []
  const tiVals: number[] = []
  const siRe = /lavfi\.siti\.si=([\d.]+)/g
  const tiRe = /lavfi\.siti\.ti=([\d.]+)/g
  let m: RegExpExecArray | null
  while ((m = siRe.exec(stderr)) !== null) siVals.push(parseFloat(m[1]))
  while ((m = tiRe.exec(stderr)) !== null) tiVals.push(parseFloat(m[1]))
  const avg = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : undefined
  return { siAvg: avg(siVals), tiAvg: avg(tiVals) }
}

export function parseBlurOutput(content: string): Array<{ timestamp: string; blur: number }> {
  const out: Array<{ timestamp: string; blur: number }> = []
  // v0.6: ffmpeg metadata=mode=print emits per-frame blocks starting with either
  // "# frame:" or "frame:". v0.4 parser only matched "# frame:" and silently
  // dropped all output on builds that emit the bare form. Same root cause as
  // parseSignalstatsOutput / parseMotionWindowsFromMetaFile.
  const blocks = content.split(/(?:^|\n)#?\s*frame:/).slice(1)
  for (const block of blocks) {
    const t = /pts_time:([\d.]+)/.exec(block)
    const b = /lavfi\.blur=([\d.]+)/.exec(block)
    if (t && b) out.push({ timestamp: formatHMSPrecise(parseFloat(t[1])), blur: parseFloat(b[1]) })
  }
  return out
}

// v0.5: also exposes u_chroma, v_chroma (raw U-128, V-128) so palette outlier
// detection can use hue (atan2) novelty in addition to saturation magnitude.
// Catches the V1 failure where pale-pink (#F2C9B5) had similar saturation to
// the orange dominant palette but a very different hue angle.
//
// v0.6 fix: the parser previously required "# frame:" prefix which some ffmpeg
// builds emit but others (including the bun-bundled ffmpeg on macOS) emit as
// bare "frame:". The bug silently dropped all frame_stats since v0.4, which in
// turn silently broke palette_outliers detection (the laser/projectile signal
// path lumiere's narrative_mode v0.5 priors depend on).
export function parseSignalstatsOutput(content: string): Array<{ timestamp: string; brightness?: number; saturation?: number; u_chroma?: number; v_chroma?: number }> {
  const out: Array<{ timestamp: string; brightness?: number; saturation?: number; u_chroma?: number; v_chroma?: number }> = []
  const yRe = /lavfi\.signalstats\.YAVG=([\d.]+)/
  const uRe = /lavfi\.signalstats\.UAVG=([\d.]+)/
  const vRe = /lavfi\.signalstats\.VAVG=([\d.]+)/
  const blocks = content.split(/(?:^|\n)#?\s*frame:/).slice(1)
  for (const block of blocks) {
    const t = /pts_time:([\d.]+)/.exec(block)
    if (!t) continue
    const y = block.match(yRe)
    const u = block.match(uRe)
    const v = block.match(vRe)
    const brightness = y ? parseFloat(y[1]) : undefined
    let saturation: number | undefined
    let u_chroma: number | undefined
    let v_chroma: number | undefined
    if (u && v) {
      u_chroma = parseFloat(u[1]) - 128
      v_chroma = parseFloat(v[1]) - 128
      saturation = Math.sqrt(u_chroma * u_chroma + v_chroma * v_chroma)
    }
    out.push({ timestamp: formatHMSPrecise(parseFloat(t[1])), brightness, saturation, u_chroma, v_chroma })
  }
  return out
}

export function parseEbur128Output(stderr: string): { mean_lufs: number; range_lu: number } | undefined {
  const iRe = /I:\s*([-\d.]+)\s*LUFS/i
  const rRe = /LRA:\s*([\d.]+)\s*LU/i
  const i = stderr.match(iRe)
  const r = stderr.match(rRe)
  if (!i || !r) return undefined
  return { mean_lufs: parseFloat(i[1]), range_lu: parseFloat(r[1]) }
}

// v0.4: subject-region motion. The default siti filter measures whole-frame motion
// and underweights small-subject high-motion (e.g. a 90px mascot animating inside a
// 1400px static card). The subject-region pass crops the center 50% and runs siti
// on that crop, so subject-only motion is no longer averaged-out by the static
// surround. Returns the raw siAvg/tiAvg for the central region.
export function buildCentralMotionCommand(videoPath: string): { args: string[] } {
  return {
    args: ["-i", videoPath, "-y", "-vf", "crop=iw/2:ih/2,siti=print_summary=1", "-f", "null", "-"],
  }
}

// v0.4: motion verdict. Combines whole-frame and subject-region scores into a
// single "is this video motion-y enough to warrant narrative_mode auto-suggest"
// boolean. Used by watch.ts shouldAutoSuggestNarrative.
//
// siti's ti (temporal information) is the load-bearing metric: high ti means
// large frame-to-frame pixel deltas. Empirical thresholds (May 19 2026): the V1
// ClaudeDevs /goal video (which is action-heavy in the center 90px sprite) shows
// global ti < 10 (looks static) but central-crop ti > 25 (subject is moving fast).
export function hasMotion(
  globalSiti: { siAvg?: number; tiAvg?: number },
  subjectSiti: { siAvg?: number; tiAvg?: number },
): boolean {
  if (globalSiti.tiAvg !== undefined && globalSiti.tiAvg > 20) return true
  if (subjectSiti.tiAvg !== undefined && subjectSiti.tiAvg > 15) return true
  return false
}

// v0.4: palette novelty. From per-frame signalstats (UAVG/VAVG chroma), identify
// frames whose chroma vector is statistically far from the median. Catches one-off
// color events (laser beams, projectile flashes, brand-color highlights) that
// otherwise pattern-match to body parts or dust.
//
// Algorithm: compute median (UAVG, VAVG). For each frame, compute Euclidean
// distance from the median in chroma space. Flag frames with distance > 2.5x the
// median absolute deviation. Return up to 20 outliers ordered by timestamp.
export interface PaletteOutlier {
  timestamp: string
  chroma_distance: number
  brightness?: number
  saturation?: number
}

// v0.5: hue-based palette novelty. v0.4 used saturation+brightness magnitudes,
// which missed the V1 laser case because pale-pink and dominant-orange have
// similar saturation magnitudes despite very different hues. v0.5 measures both
// (a) the hue angle (atan2(V-128, U-128)) and (b) the saturation magnitude
// separately. A frame counts as a palette outlier if EITHER its hue angle or
// its saturation magnitude is statistically far from the median, using a more
// sensitive threshold (1.8 MAD vs v0.4's 2.5).
export function detectPaletteOutliers(
  frameStats: Array<{ timestamp: string; brightness?: number; saturation?: number; u_chroma?: number; v_chroma?: number }>,
): PaletteOutlier[] {
  const valid = frameStats.filter(f =>
    f.saturation !== undefined && f.brightness !== undefined,
  )
  if (valid.length < 8) return []

  // Median + MAD for each axis
  const median = (arr: number[]) => {
    const s = [...arr].sort((a, b) => a - b)
    return s[Math.floor(s.length / 2)]
  }
  const mad = (arr: number[], med: number) => {
    const devs = arr.map(v => Math.abs(v - med)).sort((a, b) => a - b)
    return Math.max(1, devs[Math.floor(devs.length / 2)])
  }

  const sats = valid.map(f => f.saturation!)
  const brights = valid.map(f => f.brightness!)
  const medSat = median(sats)
  const medBright = median(brights)
  const madSat = mad(sats, medSat)
  const madBright = mad(brights, medBright)

  // Hue angle in [-pi, pi] from u_chroma, v_chroma when available
  const haveHue = valid.every(f => f.u_chroma !== undefined && f.v_chroma !== undefined)
  let medHue = 0
  let madHue = 1
  if (haveHue) {
    const hues = valid.map(f => Math.atan2(f.v_chroma!, f.u_chroma!))
    medHue = median(hues)
    // For circular hue, use shortest arc distance
    const hueDevs = hues.map(h => {
      const d = Math.abs(h - medHue)
      return Math.min(d, 2 * Math.PI - d)
    }).sort((a, b) => a - b)
    madHue = Math.max(0.02, hueDevs[Math.floor(hueDevs.length / 2)])
  }

  const outliers: PaletteOutlier[] = []
  for (const f of valid) {
    const dSat = (f.saturation! - medSat) / madSat
    const dBright = (f.brightness! - medBright) / madBright
    const distMag = Math.sqrt(dSat * dSat + dBright * dBright)

    let distHue = 0
    if (haveHue) {
      const hue = Math.atan2(f.v_chroma!, f.u_chroma!)
      const d = Math.abs(hue - medHue)
      const arc = Math.min(d, 2 * Math.PI - d)
      distHue = arc / madHue
    }

    // v0.5: more sensitive threshold (1.8 vs v0.4 2.5) AND outlier on either axis
    if (distMag > 1.8 || distHue > 2.0) {
      outliers.push({
        timestamp: f.timestamp,
        chroma_distance: Math.round(Math.max(distMag, distHue) * 10) / 10,
        brightness: f.brightness,
        saturation: f.saturation,
      })
    }
  }
  // v0.6: pick the STRONGEST outliers (was: first 30 chronologically). On V1
  // signalstats runs at 30fps yielding ~720 frames in 24s; 30 chronological
  // frames is all the first ~1s. The laser event (0:02.4-0:02.9) was missed
  // even though it scored distHue=4.9 (well above the 2.0 threshold), because
  // earlier rope-on frames had distHue >= 5.5 and saturated the slice. v0.6:
  // sort by chroma_distance desc, take top 50, then re-sort by timestamp for
  // display. Catches every meaningful color event, deduplicated by the model
  // when it scans the list for clusters.
  outliers.sort((a, b) => b.chroma_distance - a.chroma_distance)
  const top = outliers.slice(0, 50)
  top.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  return top
}

// v0.5: subject bbox detection. Runs ffmpeg with tblend=all_mode=difference to
// produce a motion-diff stream, then cropdetect on that to find the bbox of
// motion. Static background pixels diff to ~0 (black); moving subject pixels
// diff to >0 (bright). cropdetect then auto-finds the smallest bbox containing
// non-black content, which is the moving subject's region.
//
// Returns null if detection fails (e.g., no motion, ffmpeg error, or bbox covers
// the entire frame which means everything moved).
export interface SubjectBbox {
  x: number
  y: number
  w: number
  h: number
  frame_w: number
  frame_h: number
  area_pct: number  // fraction of frame area, 0-100
}

export function parseCropdetectOutput(stderr: string, frameW: number, frameH: number): SubjectBbox | null {
  // cropdetect emits lines like: [Parsed_cropdetect_1 @ 0x...] x1:Y1 x2:Y2 y1:Y1 y2:Y2 w:W h:H x:X y:Y pts:... crop=W:H:X:Y
  // Take the LAST emission (most stable; cropdetect tightens over time).
  const re = /crop=(\d+):(\d+):(\d+):(\d+)/g
  const matches: Array<{ w: number; h: number; x: number; y: number }> = []
  let m: RegExpExecArray | null
  while ((m = re.exec(stderr)) !== null) {
    matches.push({
      w: parseInt(m[1], 10),
      h: parseInt(m[2], 10),
      x: parseInt(m[3], 10),
      y: parseInt(m[4], 10),
    })
  }
  if (matches.length === 0) return null
  // Use the median of the last 20% of matches for stability
  const tail = matches.slice(Math.max(0, Math.floor(matches.length * 0.8)))
  const medW = tail.map(m => m.w).sort((a, b) => a - b)[Math.floor(tail.length / 2)]
  const medH = tail.map(m => m.h).sort((a, b) => a - b)[Math.floor(tail.length / 2)]
  const medX = tail.map(m => m.x).sort((a, b) => a - b)[Math.floor(tail.length / 2)]
  const medY = tail.map(m => m.y).sort((a, b) => a - b)[Math.floor(tail.length / 2)]

  // Reject if the bbox is the whole frame (means everything moved, no useful crop)
  if (medW >= frameW * 0.95 && medH >= frameH * 0.95) return null
  // Reject if the bbox is too tiny (likely noise)
  if (medW < 20 || medH < 20) return null

  const area_pct = (medW * medH) / (frameW * frameH) * 100
  return { x: medX, y: medY, w: medW, h: medH, frame_w: frameW, frame_h: frameH, area_pct: Math.round(area_pct * 10) / 10 }
}

// v0.6: motion windows. Detect contiguous time intervals where temporal motion
// (siti ti) is statistically above the video's median. Used by watch's adaptive
// sampling to allocate more frames to action moments and fewer to static ones.
// Algorithm:
//   1. ffmpeg samples siti at fps=10 with per-frame metadata
//   2. parse per-frame ti, compute median + MAD globally
//   3. smooth ti with 1-second rolling mean
//   4. threshold smoothed ti > (median + 1.5 * MAD)
//   5. extract contiguous high regions, merge any pair within 1.0s gap
//   6. attach intensity = mean smoothed ti inside each window
export interface MotionWindow {
  start: string
  end: string
  intensity: number
}

export function buildMotionWindowsCommand(videoPath: string, metaFile: string): { args: string[] } {
  return {
    args: [
      "-i", videoPath, "-y",
      "-vf", `fps=10,siti,metadata=mode=print:file=${metaFile}`,
      "-an",
      "-f", "null", "-",
    ],
  }
}

export function parseMotionWindowsFromMetaFile(content: string, durationSec: number): MotionWindow[] {
  const frames: { time: number; ti: number }[] = []
  // ffmpeg metadata=mode=print emits per-frame blocks starting with either
  // "# frame:" (some builds) or "frame:" (others). Handle both. Each frame
  // block has pts_time:<sec> followed by lavfi.siti.ti=<value> on a later line.
  const splitRe = /(?:^|\n)#?\s*frame:/
  const blocks = content.split(splitRe).slice(1)
  for (const block of blocks) {
    const tm = /pts_time:([\d.]+)/.exec(block)
    const tim = /lavfi\.siti\.ti=([\d.]+)/.exec(block)
    if (tm && tim) {
      frames.push({ time: parseFloat(tm[1]), ti: parseFloat(tim[1]) })
    }
  }
  if (frames.length < 8) return []
  frames.sort((a, b) => a.time - b.time)

  const tis = frames.map(f => f.ti).slice().sort((a, b) => a - b)
  const med = tis[Math.floor(tis.length / 2)]
  const devs = tis.map(t => Math.abs(t - med)).sort((a, b) => a - b)
  const mad = Math.max(0.5, devs[Math.floor(devs.length / 2)])

  // 1-second rolling mean
  const fpsApprox = frames.length / Math.max(1, durationSec)
  const halfWindow = Math.max(2, Math.round(fpsApprox / 2))
  const smoothed: { time: number; ti: number }[] = []
  for (let i = 0; i < frames.length; i++) {
    let sum = 0, count = 0
    for (let j = Math.max(0, i - halfWindow); j < Math.min(frames.length, i + halfWindow + 1); j++) {
      sum += frames[j].ti
      count++
    }
    smoothed.push({ time: frames[i].time, ti: sum / count })
  }

  const threshold = med + 1.5 * mad
  const highMask = smoothed.map(f => f.ti > threshold)

  const rawWindows: { startIdx: number; endIdx: number }[] = []
  let inWin = false
  let startIdx = 0
  for (let i = 0; i < highMask.length; i++) {
    if (highMask[i] && !inWin) { startIdx = i; inWin = true }
    else if (!highMask[i] && inWin) { rawWindows.push({ startIdx, endIdx: i - 1 }); inWin = false }
  }
  if (inWin) rawWindows.push({ startIdx, endIdx: highMask.length - 1 })

  // Merge adjacent windows within a 1.0s gap
  const merged: { startIdx: number; endIdx: number }[] = []
  for (const w of rawWindows) {
    const last = merged[merged.length - 1]
    if (last && smoothed[w.startIdx].time - smoothed[last.endIdx].time <= 1.0) {
      last.endIdx = w.endIdx
    } else {
      merged.push({ ...w })
    }
  }

  // Drop windows shorter than 0.4s (likely noise)
  const out: MotionWindow[] = []
  for (const w of merged) {
    const dur = smoothed[w.endIdx].time - smoothed[w.startIdx].time
    if (dur < 0.4) continue
    const slice = smoothed.slice(w.startIdx, w.endIdx + 1)
    const intensity = slice.reduce((a, b) => a + b.ti, 0) / slice.length
    out.push({
      start: formatHMSPrecise(Math.max(0, smoothed[w.startIdx].time - 0.1), 3),
      end: formatHMSPrecise(Math.min(durationSec, smoothed[w.endIdx].time + 0.1), 3),
      intensity: Math.round(intensity * 10) / 10,
    })
  }
  return out
}

export function buildSubjectBboxCommand(videoPath: string): { args: string[] } {
  // v0.5 fix: the original tblend → cropdetect approach failed on the V1 video
  // because the diff frames had subtle near-zero values everywhere and cropdetect
  // returned negative widths. v0.5.1 fix:
  // 1. tblend computes frame-to-frame difference (motion = bright, static = black)
  // 2. lutyuv thresholds: pixels with luma > 10 become FULL bright (255), else black
  //    This turns the soft diff into a hard binary motion mask
  // 3. cropdetect finds the bbox of bright (motion) regions
  //
  // Empirically (May 19 2026, V1 ClaudeDevs /goal video): returns crop=382:924:438:246
  // (18% area), tightly encompassing mascot + terminal text (the moving regions).
  return {
    args: [
      "-i", videoPath, "-y",
      "-vf", "tblend=all_mode=difference,lutyuv=y=if(gt(val\\,10)\\,255\\,0),cropdetect=limit=20:round=2:reset_count=0",
      "-f", "null", "-",
    ],
  }
}

export function deriveContentProfile(siAvg?: number, tiAvg?: number): string {
  if (siAvg === undefined && tiAvg === undefined) return "unknown (no motion analysis data)"
  const siC = siAvg === undefined ? "unknown" : siAvg > 50 ? "high" : siAvg > 25 ? "moderate" : "low"
  const tiC = tiAvg === undefined ? "unknown" : tiAvg > 30 ? "high" : tiAvg > 10 ? "moderate" : "low"
  const d: Record<string, Record<string, string>> = {
    high: {
      high: "high visual complexity, high motion (busy action scenes)",
      moderate: "high visual complexity, moderate motion (detailed moving shots)",
      low: "high visual complexity, low motion (detailed static shots)",
      unknown: "high visual complexity, unknown motion",
    },
    moderate: {
      high: "moderate visual complexity, high motion (action with mid-detail scenes)",
      moderate: "moderate visual complexity, moderate motion (typical narrative content)",
      low: "moderate visual complexity, low motion (static mid-detail shots)",
      unknown: "moderate visual complexity, unknown motion",
    },
    low: {
      high: "low visual complexity, high motion (simple fast-moving scenes or animations)",
      moderate: "low visual complexity, moderate motion (simple scenes with some movement)",
      low: "low visual complexity, low motion (simple static shots, slides, or graphics)",
      unknown: "low visual complexity, unknown motion",
    },
    unknown: {
      high: "unknown visual complexity, high motion",
      moderate: "unknown visual complexity, moderate motion",
      low: "unknown visual complexity, low motion",
      unknown: "unknown content profile",
    },
  }
  return d[siC]?.[tiC] ?? "unknown content profile"
}
