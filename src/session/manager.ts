import { createHash } from "crypto"
import { readFileSync, existsSync, readdirSync, rmSync, statSync, openSync, readSync, closeSync, writeFileSync, mkdirSync } from "fs"
import { join } from "path"
import type { SessionManifest } from "../types.js"

export function computeVideoHash(videoPath: string): string {
  const fd = openSync(videoPath, "r")
  const buf = Buffer.alloc(64 * 1024)
  const n = readSync(fd, buf, 0, buf.length, 0)
  closeSync(fd)
  const size = statSync(videoPath).size
  const h = createHash("sha256")
  h.update(buf.subarray(0, n))
  h.update(String(size))
  return h.digest("hex").slice(0, 12)
}

export function getSessionDir(sessionsRoot: string, videoPath: string): string {
  return join(sessionsRoot, computeVideoHash(videoPath))
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
