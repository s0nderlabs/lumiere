import { createHash } from "crypto"
import { readFileSync, existsSync, readdirSync, rmSync, statSync, openSync, readSync, closeSync, writeFileSync, mkdirSync } from "fs"
import { join } from "path"
import type { SessionManifest } from "../types.js"

// Hash on first 256KB + size + optional duration. The smaller 64KB+size combo
// collided in practice when re-downloaded streams shared the same MP4 header
// prefix and file size despite different content; duration disambiguates.
export function computeVideoHash(videoPath: string, options?: { duration?: number }): string {
  const fd = openSync(videoPath, "r")
  const buf = Buffer.alloc(256 * 1024)
  const n = readSync(fd, buf, 0, buf.length, 0)
  closeSync(fd)
  const size = statSync(videoPath).size
  const h = createHash("sha256")
  h.update(buf.subarray(0, n))
  h.update(String(size))
  if (options?.duration !== undefined && Number.isFinite(options.duration)) {
    h.update(String(Math.round(options.duration * 1000)))
  }
  return h.digest("hex").slice(0, 12)
}

export function getSessionDir(sessionsRoot: string, videoPath: string, options?: { duration?: number }): string {
  return join(sessionsRoot, computeVideoHash(videoPath, options))
}

export function loadManifest(sessionDir: string): SessionManifest | null {
  const p = join(sessionDir, "manifest.json")
  if (!existsSync(p)) return null
  return JSON.parse(readFileSync(p, "utf-8"))
}

export function saveManifest(sessionDir: string, manifest: SessionManifest): void {
  if (!existsSync(sessionDir)) mkdirSync(sessionDir, { recursive: true })
  writeFileSync(join(sessionDir, "manifest.json"), JSON.stringify(manifest, null, 2))
}

export function cleanExpiredSessions(sessionsRoot: string, maxAgeDays: number): void {
  if (!existsSync(sessionsRoot)) return
  const cutoff = Date.now() - maxAgeDays * 86400_000
  for (const entry of readdirSync(sessionsRoot)) {
    const dir = join(sessionsRoot, entry)
    const mp = join(dir, "manifest.json")
    if (!existsSync(mp)) continue
    try {
      const m: SessionManifest = JSON.parse(readFileSync(mp, "utf-8"))
      const created = new Date(m.created_at).getTime()
      if (created < cutoff) rmSync(dir, { recursive: true, force: true })
    } catch {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}
