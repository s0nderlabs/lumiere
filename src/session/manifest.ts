import type { SessionManifest } from "../types.js"

type ManifestFrame = { timestamp: string; file: string }

// Cache key for a (resolution, format, roiBucket) tuple. roiBucket="" means
// the full frame; otherwise a canonical "roi=x,y,wxh" string keeps roi-cropped
// frames in their own bucket so `view=` lookups never silently return the wrong
// crop for a request expecting full-frame (or vice versa).
export function frameCacheKey(
  resolution: string | number,
  format = "jpeg",
  roiBucket = "",
): string {
  return roiBucket ? `${resolution}/${format}/${roiBucket}` : `${resolution}/${format}`
}

// Parse a cache key back into its parts so lookups can filter by roiBucket.
export function parseFrameCacheKey(key: string): { resolution: number; format: string; roiBucket: string } | null {
  const parts = key.split("/")
  if (parts.length < 2) return null
  const resolution = parseInt(parts[0], 10)
  if (!Number.isFinite(resolution)) return null
  const format = parts[1]
  const roiBucket = parts.slice(2).join("/")
  return { resolution, format, roiBucket }
}

export function createManifest(videoHash: string, videoPath: string): SessionManifest {
  return {
    video_hash: videoHash,
    video_path: videoPath,
    created_at: new Date().toISOString(),
    resolutions: {},
  }
}

export function mergeFrames(manifest: SessionManifest, resolution: string, frames: ManifestFrame[]): SessionManifest {
  const existing = manifest.resolutions[resolution]?.frames ?? []
  const seen = new Set(existing.map(f => f.timestamp))
  const out = [...existing]
  for (const f of frames) {
    if (!seen.has(f.timestamp)) {
      out.push(f)
      seen.add(f.timestamp)
    }
  }
  out.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  return { ...manifest, resolutions: { ...manifest.resolutions, [resolution]: { frames: out } } }
}

export function sampleFrameIndices(total: number, count: number): number[] {
  if (total === 0) return []
  if (count >= total) return Array.from({ length: total }, (_, i) => i)
  if (count === 1) return [0]
  const idx: number[] = []
  for (let i = 0; i < count; i++) idx.push(Math.round((i * (total - 1)) / (count - 1)))
  return idx
}
