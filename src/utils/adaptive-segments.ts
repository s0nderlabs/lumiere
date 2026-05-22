import { formatHMSPrecise, parseHMS } from "./timestamps.js"

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
  // "motion" = derived from a motion_window; "static" = inter-window gap or
  // pure-static (no motion windows); "uniform" = uniform-fallback micro-segment
  // emitted when motion_windows are too sparse to trust under tight budgets.
  // Downstream filters that look for "motion" frames must continue to ignore
  // both "static" and "uniform" — they don't carry intensity weighting.
  kind: "motion" | "static" | "uniform"
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

// Gates for the uniform-fallback branch. See shouldUseUniformFallback() doc.
const UNIFORM_FALLBACK_MAX_MOTION_SHARE = 0.08
const UNIFORM_FALLBACK_MAX_BUDGET = 6
// Density warning thresholds (consumed via computeMaxSampleGap downstream).
const DENSITY_GAP_CAP_SEC = 5.0
const DENSITY_GAP_SPAN_FRACTION = 0.3
const DENSITY_GAP_MIN_SPAN_SEC = 4
// Density floor divisor used by applyProbeDensityFloor() — 1 frame per 5s.
const PROBE_DENSITY_DIVISOR_SEC = 5
// Half-window around each uniform-fallback midpoint (caps single-frame
// extraction at a ±0.5s box; ffmpeg seeks to extractStart and emits at the
// seek frame, which puts the actual sample near the requested midpoint).
const UNIFORM_FALLBACK_HALF_WINDOW_SEC = 0.5

export const DENSITY_WARNING_THRESHOLDS = {
  gapCapSec: DENSITY_GAP_CAP_SEC,
  spanFraction: DENSITY_GAP_SPAN_FRACTION,
  minSpanSec: DENSITY_GAP_MIN_SPAN_SEC,
} as const

// HMS bound for segment extraction. Sub-second precision matters for short
// uniform-fallback micro-segments: at budget=4 over 18s, micro-spans are 4.5s
// wide and successive midpoints are ~4.5s apart — adjacent rounded HMS strings
// would still differ, but at budget=8 over 8s (1s subSpan), rounding collapses
// adjacent micro-segments into duplicate "00:00:0X" strings. Use millisecond
// precision so the downstream extractor sees distinct seek points.
function formatSegmentBound(seconds: number): string {
  return formatHMSPrecise(Math.max(0, seconds), 3)
}

// Pixel-art mascot on slowly-rotating globe (Claude AI conference promo)
// surfaced this bug: motion_windows fired on background animation (city-pin
// labels) instead of subject state changes (headphone equip/unequip). With
// view_sample=2 after probe_calibration, adaptive concentrated 1 frame on
// 0.6s of city-pin motion and gave the rest 1 frame at t=0 — leaving the
// 8s tail (t=10-18) with zero coverage where the unequip event happened.
//
// Trigger gates (all required, kept narrow to avoid regressing the common
// case where motion_windows ARE the action):
//   - motion_windows cover < 8% of active span (very sparse coverage,
//     usually background-only motion or a tiny subject-state event)
//   - totalBudget < 6 (small budget, can't afford to lose any frame to
//     background concentration)
//   - motionTotalDur > 0 (skip the existing "no motion windows" path which
//     already goes pure-static)
//
// On trigger: spread budget evenly across the active span via N micro-
// segments, each emitting 1 frame at its sub-span midpoint. Same total
// frame count; placement guarantees max gap = activeDur / totalBudget.
// For 18s/2-frame Claude conference case: 4.5s gap vs current 18s gap.
function shouldUseUniformFallback(opts: {
  motionTotalDur: number
  activeDur: number
  totalBudget: number
}): boolean {
  if (opts.activeDur <= 0 || opts.totalBudget <= 0) return false
  if (opts.motionTotalDur <= 0) return false
  if (opts.totalBudget >= UNIFORM_FALLBACK_MAX_BUDGET) return false
  const motionShare = opts.motionTotalDur / opts.activeDur
  return motionShare < UNIFORM_FALLBACK_MAX_MOTION_SHARE
}

function buildUniformFallbackSegments(
  startSec: number,
  endSec: number,
  totalBudget: number,
): AdaptiveSegment[] {
  const activeDur = endSec - startSec
  if (activeDur <= 0 || totalBudget <= 0) return []
  const subSpan = activeDur / totalBudget
  // ffmpeg's -ss seeks to the requested input timestamp and the fps filter
  // emits at the seek point, so the actual sampled frame lands at the
  // extractStart (i.e. midpoint - halfWindow). The half-window is small
  // enough that this still concentrates near the sub-span center.
  const halfWindow = Math.min(UNIFORM_FALLBACK_HALF_WINDOW_SEC, subSpan / 2)
  return Array.from({ length: totalBudget }, (_, i) => {
    const midpoint = startSec + (i + 0.5) * subSpan
    const extractStart = Math.max(startSec, midpoint - halfWindow)
    const extractEnd = Math.min(endSec, midpoint + halfWindow)
    return {
      start: formatSegmentBound(extractStart),
      end: formatSegmentBound(extractEnd),
      startSec: extractStart,
      endSec: extractEnd,
      fps: 1,
      budgetFrames: 1,
      kind: "uniform" as const,
    }
  })
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

  // Uniform fallback: motion windows cover too little of the timeline AND the
  // budget is too small to afford adaptive concentration. See gate doc above.
  if (shouldUseUniformFallback({ motionTotalDur, activeDur: endSec - startSec, totalBudget })) {
    return buildUniformFallbackSegments(startSec, endSec, totalBudget)
  }

  let motionBudget: number, staticBudget: number
  if (motionTotalDur === 0) { motionBudget = 0; staticBudget = totalBudget }
  else if (staticTotalDur === 0) { motionBudget = totalBudget; staticBudget = 0 }
  else { motionBudget = Math.floor(totalBudget * 0.7); staticBudget = totalBudget - motionBudget }

  const segs: AdaptiveSegment[] = []

  // Largest-remainder distribution. Each segment gets its share of the budget,
  // rounded so the integer total equals the budget exactly. When floors push
  // the sum above the budget (the chunk-3 max-tier over-allocation case where
  // 2 motion + 1 static segments tried to claim 3 frames against a 2-frame
  // budget), distributeIntegerBudget shrinks segments greedily by weight.
  if (motionBudget > 0 && merged.length > 0) {
    const weights = merged.map(w => (w.endSec - w.startSec) * Math.max(1, w.intensity))
    const motionAllocation = distributeIntegerBudget(weights, motionBudget, 1)
    for (let i = 0; i < merged.length; i++) {
      const frames = motionAllocation[i]
      if (frames <= 0) continue
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
    const weights = staticSpans.map(s => s.endSec - s.startSec)
    const staticAllocation = distributeIntegerBudget(weights, staticBudget, 1)
    for (let i = 0; i < staticSpans.length; i++) {
      const frames = staticAllocation[i]
      if (frames <= 0) continue
      const s = staticSpans[i]
      const dur = s.endSec - s.startSec
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

// Largest-remainder method with per-segment floor honored only when budget
// allows. When floor*N > totalBudget, the floor is dropped and budget is
// distributed greedily to the highest-weight segments. Guarantees sum ==
// totalBudget and no entry is negative.
function distributeIntegerBudget(weights: number[], totalBudget: number, floor: number): number[] {
  const n = weights.length
  const result = new Array<number>(n).fill(0)
  if (totalBudget <= 0 || n === 0) return result

  const totalWeight = weights.reduce((a, b) => a + b, 0)

  // Tight-budget case: floors alone would exceed the budget. Drop the floor
  // and assign whole frames greedily by weight (descending).
  if (floor * n > totalBudget) {
    const order = weights.map((_, i) => i).sort((a, b) => weights[b] - weights[a])
    for (let i = 0; i < totalBudget; i++) result[order[i % n]]++
    return result
  }

  // Standard case: seed every segment with the floor, distribute remainder
  // proportionally, hand out leftover frames by largest fractional remainder.
  for (let i = 0; i < n; i++) result[i] = floor
  let remaining = totalBudget - floor * n
  if (remaining === 0) return result

  const fractional = new Array<number>(n).fill(0)
  for (let i = 0; i < n; i++) {
    const share = totalWeight > 0 ? (weights[i] / totalWeight) * remaining : remaining / n
    const whole = Math.floor(share)
    result[i] += whole
    fractional[i] = share - whole
  }
  const used = result.reduce((a, b) => a + b, 0)
  let leftover = totalBudget - used
  if (leftover > 0) {
    const order = fractional.map((f, i) => ({ f, i })).sort((a, b) => b.f - a.f)
    for (let i = 0; leftover > 0 && i < n; i++, leftover--) result[order[i].i]++
  }
  return result
}

// Estimates the LARGEST contiguous unsampled span in seconds across an
// active window covered by adaptive segments. Used by the sampling-gap
// warning to detect "huge timeline gaps even with small budgets" — a case
// the original budget-concentration check (60%/30%) misses because at
// budget=2, motionBudget/totalBudget can't exceed 0.5.
//
// Approximation: each segment's frames are placed evenly across its span,
// so the in-segment gap is segDur / segFrames. Between segments, the gap
// is the time from the end of one to the start of the next. At span
// boundaries, the gap from start_time to first frame placement or from
// last frame placement to end_time also counts.
export function computeMaxSampleGap(
  segs: AdaptiveSegment[],
  startSec: number,
  endSec: number,
): number {
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) return 0
  if (segs.length === 0) return endSec - startSec
  // Segments come in sorted by startSec from buildAdaptiveSegments (and the
  // uniform-fallback path emits them monotonically). Sample timestamps within
  // each segment are also monotonic, so the concatenated stream is already
  // sorted — no need to re-sort.
  const sorted = [...segs].sort((a, b) => a.startSec - b.startSec)
  const samples: number[] = []
  for (const s of sorted) {
    const dur = s.endSec - s.startSec
    const interval = dur / Math.max(1, s.budgetFrames)
    for (let i = 0; i < s.budgetFrames; i++) {
      samples.push(s.startSec + (i + 0.5) * interval)
    }
  }
  if (samples.length === 0) return endSec - startSec
  let maxGap = samples[0] - startSec
  for (let i = 1; i < samples.length; i++) {
    const g = samples[i] - samples[i - 1]
    if (g > maxGap) maxGap = g
  }
  const tailGap = endSec - samples[samples.length - 1]
  if (tailGap > maxGap) maxGap = tailGap
  return maxGap
}

// Density floor for probe_calibration's view_sample retune. probe_calibration
// extracts ONE frame from the middle of the active window and extrapolates
// total chars; for high-entropy content (pixel-art, dense UI textures) the
// middle probe is often 2-4x larger than off-center frames, so derived
// view_sample can collapse to 1-2 even when the real budget would fit 4-6.
//
// Floor = max(2, ceil(activeDurationSec / PROBE_DENSITY_DIVISOR_SEC)) —
// guarantees ≥1 frame per 5s of timeline. Capped at the original auto-budget
// so probe never ADDS frames beyond what we'd have used pre-probe (preserves
// the MCP-cap protection purpose of probe_calibration for cases where probe
// is correctly aggressive).
//
// Returns the final view_sample after applying the floor.
export function applyProbeDensityFloor(args: {
  derived: number
  originalViewSample: number
  activeDurationSec: number
}): number {
  const densityFloor = Math.max(2, Math.ceil(args.activeDurationSec / PROBE_DENSITY_DIVISOR_SEC))
  const cappedFloor = Math.min(densityFloor, args.originalViewSample)
  return Math.max(args.derived, cappedFloor)
}

export function formatAdaptiveSummary(segs: AdaptiveSegment[]): string {
  const lines = segs.map(s => {
    const tag = s.kind === "motion"
      ? `motion (intensity=${s.intensity ?? "?"})`
      : s.kind === "uniform" ? "uniform (fallback)" : "static"
    return `  ${s.start}-${s.end} ${tag}: ${s.budgetFrames} frames @ ${s.fps.toFixed(2)}fps`
  })
  const total = segs.reduce((a, s) => a + s.budgetFrames, 0)
  return [`segments=${segs.length} total_frames=${total}`, ...lines].join("\n")
}
