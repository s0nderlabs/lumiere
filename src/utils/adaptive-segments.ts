import { parseHMS } from "./timestamps.js"

// Motion-adaptive frame allocation. Given the motion_windows surfaced by
// analyze() and a total per-call frame budget, builds a Segment[] that spends
// more frames inside motion windows (70% of budget, weighted by duration *
// intensity) and fewer in static spans (30% of budget, uniform). Same total
// frame count as a uniform call but temporal resolution biased toward where
// action is happening. Agnostic to subject or genre.
//
// Single source of truth used by both watch and measure so the two tools
// always agree on the segment plan they're predicting/executing.

export interface AdaptiveSegment {
  start: string
  end: string
  startSec: number
  endSec: number
  fps: number
  budgetFrames: number
  kind: "motion" | "static"
  intensity?: number
  // Set by assignPerWindowCrops (utils/roi.ts) when roi="per-window".
  crop?: { x: number; y: number; w: number; h: number }
}

export interface BuildAdaptiveSegmentsOpts {
  motionWindows: Array<{ start: string; end: string; intensity: number }>
  startSec: number
  endSec: number
  totalBudget: number
}

// HH:MM:SS bound (whole seconds, rounded). Matches HMS_REGEX accepted by
// extractFramesBySegments. Sub-second granularity inside a segment is handled
// by the fps choice and ffmpeg -ss / -t internally.
function formatSegmentBound(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

export function buildAdaptiveSegments(opts: BuildAdaptiveSegmentsOpts): AdaptiveSegment[] {
  const { motionWindows, startSec, endSec, totalBudget } = opts

  const clamped = motionWindows
    .map(w => ({
      startSec: Math.max(startSec, parseHMS(w.start)),
      endSec: Math.min(endSec, parseHMS(w.end)),
      intensity: w.intensity,
    }))
    .filter(w => w.endSec > w.startSec + 0.2)
    .sort((a, b) => a.startSec - b.startSec)

  // Merge any motion windows that overlap or touch after clamping
  const merged: typeof clamped = []
  for (const w of clamped) {
    const last = merged[merged.length - 1]
    if (last && w.startSec <= last.endSec) {
      last.endSec = Math.max(last.endSec, w.endSec)
      last.intensity = Math.max(last.intensity, w.intensity)
    } else {
      merged.push({ ...w })
    }
  }

  // Static spans between motion windows
  const staticSpans: Array<{ startSec: number; endSec: number }> = []
  let cursor = startSec
  for (const w of merged) {
    if (w.startSec > cursor + 0.05) staticSpans.push({ startSec: cursor, endSec: w.startSec })
    cursor = w.endSec
  }
  if (cursor < endSec - 0.05) staticSpans.push({ startSec: cursor, endSec })

  const motionTotalDur = merged.reduce((a, w) => a + (w.endSec - w.startSec), 0)
  const staticTotalDur = staticSpans.reduce((a, s) => a + (s.endSec - s.startSec), 0)

  let motionBudget: number, staticBudget: number
  if (motionTotalDur === 0) { motionBudget = 0; staticBudget = totalBudget }
  else if (staticTotalDur === 0) { motionBudget = totalBudget; staticBudget = 0 }
  else { motionBudget = Math.floor(totalBudget * 0.7); staticBudget = totalBudget - motionBudget }

  const segs: AdaptiveSegment[] = []

  if (motionBudget > 0 && merged.length > 0) {
    const weights = merged.map(w => (w.endSec - w.startSec) * Math.max(1, w.intensity))
    const totalWeight = weights.reduce((a, b) => a + b, 0)
    let allocated = 0
    for (let i = 0; i < merged.length; i++) {
      const share = totalWeight > 0 ? weights[i] / totalWeight : 1 / merged.length
      let frames = Math.max(2, Math.round(motionBudget * share))
      if (i === merged.length - 1) frames = Math.max(2, motionBudget - allocated)
      allocated += frames
      const dur = merged[i].endSec - merged[i].startSec
      const fps = Math.max(0.5, frames / dur)
      segs.push({
        start: formatSegmentBound(merged[i].startSec),
        end: formatSegmentBound(merged[i].endSec),
        startSec: merged[i].startSec,
        endSec: merged[i].endSec,
        fps,
        budgetFrames: frames,
        kind: "motion",
        intensity: merged[i].intensity,
      })
    }
  }

  if (staticBudget > 0 && staticSpans.length > 0) {
    let allocated = 0
    for (let i = 0; i < staticSpans.length; i++) {
      const s = staticSpans[i]
      const dur = s.endSec - s.startSec
      const share = staticTotalDur > 0 ? dur / staticTotalDur : 1 / staticSpans.length
      let frames = Math.max(1, Math.round(staticBudget * share))
      if (i === staticSpans.length - 1) frames = Math.max(1, staticBudget - allocated)
      allocated += frames
      const fps = Math.max(0.2, frames / dur)
      segs.push({
        start: formatSegmentBound(s.startSec),
        end: formatSegmentBound(s.endSec),
        startSec: s.startSec,
        endSec: s.endSec,
        fps,
        budgetFrames: frames,
        kind: "static",
      })
    }
  }

  segs.sort((a, b) => a.startSec - b.startSec)
  return segs
}

export function formatAdaptiveSummary(segs: AdaptiveSegment[]): string {
  const lines = segs.map(s => {
    const tag = s.kind === "motion" ? `motion (intensity=${s.intensity ?? "?"})` : "static"
    return `  ${s.start}-${s.end} ${tag}: ${s.budgetFrames} frames @ ${s.fps.toFixed(2)}fps`
  })
  const total = segs.reduce((a, s) => a + s.budgetFrames, 0)
  return [`segments=${segs.length} total_frames=${total}`, ...lines].join("\n")
}
