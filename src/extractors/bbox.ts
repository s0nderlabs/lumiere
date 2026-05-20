import { execFile } from "child_process"
import { promisify } from "util"
import { readFileSync, readdirSync, mkdirSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import type { SubjectBbox } from "../types.js"

const execFileAsync = promisify(execFile)

export type { SubjectBbox }

interface BlobInfo {
  area: number
  minX: number
  maxX: number
  minY: number
  maxY: number
}

// PGM (binary, P5) header parser. Returns { width, height, pixels } or null on bad data.
function parsePgm(buf: Buffer): { width: number; height: number; pixels: Uint8Array } | null {
  const head = buf.toString("ascii", 0, Math.min(buf.length, 256))
  if (!head.startsWith("P5")) return null
  const tokens: string[] = []
  let pos = 2
  while (tokens.length < 3 && pos < head.length) {
    while (pos < head.length && /\s/.test(head[pos])) pos++
    if (pos < head.length && head[pos] === "#") {
      while (pos < head.length && head[pos] !== "\n") pos++
      continue
    }
    let end = pos
    while (end < head.length && !/\s/.test(head[end])) end++
    if (end > pos) tokens.push(head.slice(pos, end))
    pos = end
  }
  if (tokens.length < 3) return null
  const width = parseInt(tokens[0], 10)
  const height = parseInt(tokens[1], 10)
  while (pos < head.length && /\s/.test(head[pos])) pos++
  if (buf.length < pos + width * height) return null
  return { width, height, pixels: new Uint8Array(buf.buffer, buf.byteOffset + pos, width * height) }
}

function labelConnectedBlobs(mask: Uint8Array, width: number, height: number): BlobInfo[] {
  const visited = new Uint8Array(mask.length)
  const blobs: BlobInfo[] = []
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === 0 || visited[i] === 1) continue
    let area = 0
    let minX = width, maxX = 0, minY = height, maxY = 0
    const stack: number[] = [i]
    visited[i] = 1
    while (stack.length > 0) {
      const idx = stack.pop()!
      const x = idx % width
      const y = (idx - x) / width
      area++
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      if (x > 0) {
        const n = idx - 1
        if (mask[n] === 1 && visited[n] === 0) { visited[n] = 1; stack.push(n) }
      }
      if (x < width - 1) {
        const n = idx + 1
        if (mask[n] === 1 && visited[n] === 0) { visited[n] = 1; stack.push(n) }
      }
      if (y > 0) {
        const n = idx - width
        if (mask[n] === 1 && visited[n] === 0) { visited[n] = 1; stack.push(n) }
      }
      if (y < height - 1) {
        const n = idx + width
        if (mask[n] === 1 && visited[n] === 0) { visited[n] = 1; stack.push(n) }
      }
    }
    blobs.push({ area, minX, maxX, minY, maxY })
  }
  return blobs
}

function dilateOnce(mask: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(mask.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x
      if (mask[idx] === 1) { out[idx] = 1; continue }
      let hit = false
      for (let dy = -1; dy <= 1 && !hit; dy++) {
        for (let dx = -1; dx <= 1 && !hit; dx++) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx, ny = y + dy
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
          if (mask[ny * width + nx] === 1) hit = true
        }
      }
      if (hit) out[idx] = 1
    }
  }
  return out
}

// Connected-component subject bbox detection. Dumps a small stack of binary
// motion masks (tblend+lutyuv threshold), accumulates motion energy per pixel,
// thresholds, labels blobs by BFS, and returns the bbox of the largest blob.
// When multiple comparable blobs exist (within 2x area of the largest),
// returns their combined envelope so multi-subject videos still get a useful
// crop instead of the union-of-all-motion that plain cropdetect produces.
// Returns null on no usable blob; callers should fall back to the cropdetect path.
export async function detectSubjectBboxViaCC(
  videoPath: string,
  frameW: number,
  frameH: number,
  workDirRoot?: string,
): Promise<SubjectBbox | null> {
  if (!frameW || !frameH) return null

  const workDir = join(workDirRoot ?? tmpdir(), `lumiere-bbox-cc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(workDir, { recursive: true })

  try {
    const scaledW = 160
    const scaledH = Math.max(40, Math.round(frameH * (scaledW / frameW) / 2) * 2)

    const filter = `tblend=all_mode=difference,lutyuv=y=if(gt(val\\,10)\\,255\\,0),fps=2,scale=${scaledW}:${scaledH},format=gray`

    const args = [
      "-i", videoPath, "-y",
      "-vf", filter,
      "-frames:v", "24",
      join(workDir, "mask_%04d.pgm"),
    ]

    try {
      await execFileAsync("ffmpeg", args, { timeout: 60_000, maxBuffer: 50 * 1024 * 1024 })
    } catch {
      // tolerate; sometimes ffmpeg returns non-zero but still emits enough frames
    }

    const files = readdirSync(workDir).filter(f => f.startsWith("mask_") && f.endsWith(".pgm")).sort()
    if (files.length < 2) return null

    const energy = new Int32Array(scaledW * scaledH)
    let usableFrames = 0
    let actualW = scaledW
    let actualH = scaledH
    for (const file of files) {
      const buf = readFileSync(join(workDir, file))
      const pgm = parsePgm(buf)
      if (!pgm) continue
      actualW = pgm.width
      actualH = pgm.height
      if (pgm.pixels.length !== actualW * actualH) continue
      let nonZero = 0
      for (let i = 0; i < pgm.pixels.length && i < energy.length; i++) {
        if (pgm.pixels[i] > 0) { energy[i]++; nonZero++ }
      }
      if (nonZero > 0) usableFrames++
    }
    if (usableFrames < 2) return null

    // Motion masks are sparse (tblend yields edge-only pixels, typically 0.5-2%
    // of frame area per mask) and a moving subject's pixels shift between
    // consecutive frames so cross-frame intersection is near-zero. Take the
    // UNION (any frame with non-zero) and dilate twice to coalesce the dominant
    // moving region into a single connected blob.
    const mask = new Uint8Array(actualW * actualH)
    for (let i = 0; i < mask.length; i++) {
      mask[i] = energy[i] > 0 ? 1 : 0
    }

    let dilated = dilateOnce(mask, actualW, actualH)
    dilated = dilateOnce(dilated, actualW, actualH)
    const blobs = labelConnectedBlobs(dilated, actualW, actualH)
    if (blobs.length === 0) return null
    blobs.sort((a, b) => b.area - a.area)

    const largest = blobs[0]
    const minBlobArea = Math.max(20, actualW * actualH * 0.002)
    if (largest.area < minBlobArea) return null
    if (largest.area > actualW * actualH * 0.85) return null

    let minX = largest.minX, maxX = largest.maxX, minY = largest.minY, maxY = largest.maxY
    for (let i = 1; i < blobs.length; i++) {
      if (blobs[i].area < largest.area * 0.5) break
      if (blobs[i].minX < minX) minX = blobs[i].minX
      if (blobs[i].maxX > maxX) maxX = blobs[i].maxX
      if (blobs[i].minY < minY) minY = blobs[i].minY
      if (blobs[i].maxY > maxY) maxY = blobs[i].maxY
    }

    const sx = frameW / actualW
    const sy = frameH / actualH
    let x = Math.max(0, Math.floor(minX * sx))
    let y = Math.max(0, Math.floor(minY * sy))
    let w = Math.min(frameW - x, Math.ceil((maxX - minX + 1) * sx))
    let h = Math.min(frameH - y, Math.ceil((maxY - minY + 1) * sy))

    const padX = Math.floor(w * 0.06)
    const padY = Math.floor(h * 0.06)
    const padXLeft = Math.min(padX, x)
    const padYTop = Math.min(padY, y)
    x = x - padXLeft
    y = y - padYTop
    w = Math.min(frameW - x, w + padXLeft + padX)
    h = Math.min(frameH - y, h + padYTop + padY)

    w = w - (w % 2)
    h = h - (h % 2)
    if (w < 20 || h < 20) return null

    const area_pct = (w * h) / (frameW * frameH) * 100
    return {
      x, y, w, h,
      frame_w: frameW, frame_h: frameH,
      area_pct: Math.round(area_pct * 10) / 10,
      method: "cc",
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}
