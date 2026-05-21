import { join } from "path"
import type { AnalysisFilters, SceneChange, Interval, SubjectBbox } from "../types.js"
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
  // ffmpeg metadata=mode=print emits per-frame blocks starting with either
  // "# frame:" or bare "frame:" depending on the build. Match both: earlier
  // versions of this parser only matched the "#" form and silently dropped
  // all output on builds (incl. the bun-bundled macOS ffmpeg) that emit the
  // bare form. Same root cause as parseSignalstatsOutput / parseMotionWindowsFromMetaFile.
  const blocks = content.split(/(?:^|\n)#?\s*frame:/).slice(1)
  for (const block of blocks) {
    const t = /pts_time:([\d.]+)/.exec(block)
    const b = /lavfi\.blur=([\d.]+)/.exec(block)
    if (t && b) out.push({ timestamp: formatHMSPrecise(parseFloat(t[1])), blur: parseFloat(b[1]) })
  }
  return out
}

// Exposes u_chroma, v_chroma (raw U-128, V-128) so palette outlier detection
// can use hue (atan2) novelty in addition to saturation magnitude. Hue-only
// novelty catches cases where a brand color has similar saturation to the
// dominant palette but a different hue (e.g. pale-pink vs orange).
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

// Subject-region motion. The default siti filter measures whole-frame motion
// and underweights small-subject high-motion (e.g. a 90px mascot inside a
// 1400px static card). This crops to the center 50% before running siti so
// subject-only motion is no longer averaged-out by the static surround.
export function buildCentralMotionCommand(videoPath: string): { args: string[] } {
  return {
    args: ["-i", videoPath, "-y", "-vf", "crop=iw/2:ih/2,siti=print_summary=1", "-f", "null", "-"],
  }
}

// Motion verdict: combines whole-frame and subject-region ti into a single
// "is this video motion-y enough to warrant narrative_mode auto-suggest"
// boolean. siti's ti (temporal information) is the load-bearing metric;
// high ti means large frame-to-frame pixel deltas. Thresholds calibrated
// against the 2026-05-19 test set where global ti < 10 (looks static) but
// central-crop ti > 25 (subject is moving fast).
export function hasMotion(
  globalSiti: { siAvg?: number; tiAvg?: number },
  subjectSiti: { siAvg?: number; tiAvg?: number },
): boolean {
  if (globalSiti.tiAvg !== undefined && globalSiti.tiAvg > 20) return true
  if (subjectSiti.tiAvg !== undefined && subjectSiti.tiAvg > 15) return true
  return false
}

// Palette novelty detection. From per-frame signalstats (UAVG/VAVG chroma),
// identify frames whose chroma vector is statistically far from the median.
// Catches one-off color events (laser beams, projectile flashes, brand-color
// highlights) that lower tiers can pattern-match to body parts or dust.
//
// Algorithm: measure both (a) hue angle (atan2(V-128, U-128)) and (b)
// saturation magnitude, separately. A frame is flagged if EITHER axis is far
// from the median (1.8 MAD threshold). Pure magnitude novelty misses brand
// colors that have similar saturation to the dominant palette but a different
// hue (e.g. pale-pink vs orange).
export interface PaletteOutlier {
  timestamp: string
  chroma_distance: number
  brightness?: number
  saturation?: number
}

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

    // Outlier on either axis; 1.8 MAD threshold tuned to surface lasers
    // without over-firing on routine palette shifts.
    if (distMag > 1.8 || distHue > 2.0) {
      outliers.push({
        timestamp: f.timestamp,
        chroma_distance: Math.round(Math.max(distMag, distHue) * 10) / 10,
        brightness: f.brightness,
        saturation: f.saturation,
      })
    }
  }
  // Keep the STRONGEST outliers, not the first N chronologically: a 24s clip
  // at 30fps yields ~720 frames and a chronological slice of N covers only the
  // opening seconds, so a laser event late in the clip can be saturated out by
  // earlier (unrelated) high-distance frames. Sort by chroma_distance desc,
  // take top 50, then re-sort by timestamp for display.
  outliers.sort((a, b) => b.chroma_distance - a.chroma_distance)
  const top = outliers.slice(0, 50)
  top.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  return top
}

// Subject bbox detection (cropdetect fallback path). The matching ffmpeg run
// uses tblend=all_mode=difference to produce a motion-diff stream where static
// background pixels diff to ~0 (black) and moving subject pixels diff > 0
// (bright); cropdetect finds the smallest bbox containing non-black content.
// Returns null if no motion, ffmpeg error, or the bbox covers the entire frame.
// SubjectBbox is defined in types.ts (shared with extractors/bbox.ts).
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

// Motion windows: contiguous time intervals where temporal motion (siti ti)
// is statistically above the video's median. Drives watch's adaptive sampling
// (more frames to action moments, fewer to static spans).
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

// Motion-windows ffmpeg command. Optional crop scopes siti to a sub-region of
// the frame — used by analyze.ts to re-derive motion windows on the subject
// bbox when global windows cluster at boundaries (typical for small off-center
// subjects in busy backgrounds like fitness/sports on fixed-camera setups).
export function buildMotionWindowsCommand(
  videoPath: string,
  metaFile: string,
  crop?: { x: number; y: number; w: number; h: number },
): { args: string[] } {
  const filter = crop
    ? `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y},fps=10,siti,metadata=mode=print:file=${metaFile}`
    : `fps=10,siti,metadata=mode=print:file=${metaFile}`
  return {
    args: ["-i", videoPath, "-y", "-vf", filter, "-an", "-f", "null", "-"],
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

  // Drop windows shorter than 0.4s (likely noise). v0.11: clamp window end to
  // durationSec - 0.5 to avoid the EOF-adjacent ffmpeg crash (extractFrames
  // with -ss too close to EOF returns 0 frames). 0.5s headroom is enough for
  // the densest fps tier (12.5fps = 80ms per frame; 0.5s fits 6 frames safely).
  const EOF_HEADROOM = 0.5
  const safeEndCap = Math.max(0, durationSec - EOF_HEADROOM)
  const out: MotionWindow[] = []
  for (const w of merged) {
    const dur = smoothed[w.endIdx].time - smoothed[w.startIdx].time
    if (dur < 0.4) continue
    const slice = smoothed.slice(w.startIdx, w.endIdx + 1)
    const intensity = slice.reduce((a, b) => a + b.ti, 0) / slice.length
    const winStart = Math.max(0, smoothed[w.startIdx].time - 0.1)
    const winEnd = Math.min(safeEndCap, smoothed[w.endIdx].time + 0.1)
    // After clamping, window must still satisfy minimum duration
    if (winEnd - winStart < 0.4) continue
    out.push({
      start: formatHMSPrecise(winStart, 3),
      end: formatHMSPrecise(winEnd, 3),
      intensity: Math.round(intensity * 10) / 10,
    })
  }
  return out
}

export function buildSubjectBboxCommand(videoPath: string): { args: string[] } {
  // Why a hard binary mask: a plain tblend then cropdetect emits soft diff
  // frames with near-zero values everywhere on subtle motion, so cropdetect
  // returns negative widths. Steps:
  // 1. tblend computes frame-to-frame difference (motion = bright, static = black)
  // 2. lutyuv thresholds: pixels with luma > 10 become FULL bright (255), else black
  //    (this turns the soft diff into a hard binary motion mask)
  // 3. cropdetect finds the bbox of bright (motion) regions
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
