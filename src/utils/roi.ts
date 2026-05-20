import type { SessionManifest, SubjectBbox } from "../types.js"
import type { AdaptiveSegment } from "./adaptive-segments.js"
import { parseHMS } from "./timestamps.js"

export interface RoiCrop {
  x: number
  y: number
  w: number
  h: number
}

export const ROI_AUTO = "auto"
export const ROI_PER_WINDOW = "per-window"

// Shared between watch and measure so both apply the same crop logic.
export function resolveRoi(
  roi: string | undefined,
  manifest: SessionManifest | null,
): RoiCrop | null {
  if (!roi) return null
  if (roi === ROI_AUTO) {
    const bbox = manifest?.analysis?.subject_bbox
    if (!bbox) return null
    return { x: bbox.x, y: bbox.y, w: bbox.w, h: bbox.h }
  }
  // per-window is applied per-segment by assignPerWindowCrops, not globally.
  if (roi === ROI_PER_WINDOW) return null
  const m = /^(\d+),(\d+),(\d+),(\d+)$/.exec(roi)
  if (!m) return null
  return { x: parseInt(m[1], 10), y: parseInt(m[2], 10), w: parseInt(m[3], 10), h: parseInt(m[4], 10) }
}

// Canonical human-readable form for a crop. Single source so the cache key,
// the metadata-block label, and the measure JSON output never drift.
export function formatRoiCrop(crop: RoiCrop): string {
  return `${crop.x},${crop.y},${crop.w}x${crop.h}`
}

// Stable cache bucket; "" means full frame.
export function roiBucketKey(crop: RoiCrop | null | undefined): string {
  return crop ? `roi=${formatRoiCrop(crop)}` : ""
}

// Per-window crop assignment. Mutates each AdaptiveSegment: motion segments get
// their overlapping motion_window's bbox; static segments fall back to the
// global subject_bbox so they stay coherent with the moving subject.
export function assignPerWindowCrops(
  adaptiveSegs: AdaptiveSegment[],
  motionWindows: Array<{ start: string; end: string }>,
  windowBboxes: Array<SubjectBbox | null>,
  fallbackBbox: SubjectBbox | undefined,
): void {
  const windowRanges = motionWindows.map(w => [parseHMS(w.start), parseHMS(w.end)] as const)
  const fb = fallbackBbox ? { x: fallbackBbox.x, y: fallbackBbox.y, w: fallbackBbox.w, h: fallbackBbox.h } : null
  for (const seg of adaptiveSegs) {
    if (seg.kind === "motion") {
      for (let i = 0; i < windowRanges.length; i++) {
        const [wStart, wEnd] = windowRanges[i]
        if (seg.startSec < wEnd && seg.endSec > wStart && windowBboxes[i]) {
          const wb = windowBboxes[i]!
          seg.crop = { x: wb.x, y: wb.y, w: wb.w, h: wb.h }
          break
        }
      }
      if (!seg.crop && fb) seg.crop = { ...fb }
    } else if (fb) {
      seg.crop = { ...fb }
    }
  }
}
