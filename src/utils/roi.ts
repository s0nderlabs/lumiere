import type { SessionManifest } from "../types.js"

export interface RoiCrop {
  x: number
  y: number
  w: number
  h: number
}

// Resolve the `roi` param against the cached subject bbox or an explicit
// "x,y,w,h" string. Returns { x, y, w, h } or null if there's no usable crop.
// Shared between watch and measure so both apply the same crop logic.
export function resolveRoi(
  roi: string | undefined,
  manifest: SessionManifest | null,
): RoiCrop | null {
  if (!roi) return null
  if (roi === "auto") {
    const bbox = manifest?.analysis?.subject_bbox
    if (!bbox) return null
    return { x: bbox.x, y: bbox.y, w: bbox.w, h: bbox.h }
  }
  const m = /^(\d+),(\d+),(\d+),(\d+)$/.exec(roi)
  if (!m) return null
  return { x: parseInt(m[1], 10), y: parseInt(m[2], 10), w: parseInt(m[3], 10), h: parseInt(m[4], 10) }
}
