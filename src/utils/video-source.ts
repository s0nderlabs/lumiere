import { execFile } from "child_process"
import { createHash } from "crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "fs"
import { tmpdir } from "os"
import { resolve, join } from "path"
import { promisify } from "util"
import type { AudioResult, TranscriptionSegment } from "../types.js"
import { formatHMS, parseHMS } from "./timestamps.js"
import { DOWNLOADS_DIR } from "../config.js"

const execFileAsync = promisify(execFile)
const MAX_DESCRIPTION_CHARS = 4000

const YOUTUBE_HOSTS = new Set([
  "youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be",
])

export interface VideoSourceMetadata {
  type: string                  // extractor name from yt-dlp (e.g. "youtube", "twitter", "vimeo")
  url: string
  title?: string
  channel?: string
  uploader?: string
  duration?: string
  upload_date?: string
  view_count?: number
  description?: string
  caption_track?: CaptionTrackMetadata
}

export interface CaptionTrackMetadata {
  source: "subtitles" | "automatic_captions"
  language: string
}

export interface CaptionResult extends CaptionTrackMetadata {
  transcription: TranscriptionSegment[]
  coverage_seconds: number
}

export interface ResolvedVideoInput {
  path: string
  source?: VideoSourceMetadata
  captions?: CaptionResult
}

export function isUrl(input: string): boolean {
  try {
    const u = new URL(input)
    return u.protocol === "http:" || u.protocol === "https:"
  } catch { return false }
}

export function isYouTubeUrl(input: string): boolean {
  try {
    const url = new URL(input)
    return (url.protocol === "http:" || url.protocol === "https:") && YOUTUBE_HOSTS.has(url.hostname)
  } catch { return false }
}

function validateRegularFile(filePath: string): string {
  if (!existsSync(filePath)) throw new Error(`File not found: ${filePath}`)
  const stat = statSync(filePath)
  if (!stat.isFile()) throw new Error(`Path is not a regular file: ${filePath}`)
  return filePath
}

export function validateVideoPath(inputPath: string): string {
  return validateRegularFile(resolve(inputPath))
}

function cachePrefixForUrl(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 12)
}

function truncateDescription(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  if (value.length <= MAX_DESCRIPTION_CHARS) return value
  return `${value.slice(0, MAX_DESCRIPTION_CHARS)}\n\n[description truncated]`
}

function findDownloadedPath(stdout: string): string | null {
  const lines = stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (existsSync(line) && statSync(line).isFile()) return line
  }
  return null
}

function isSslHandshakeError(err: any): boolean {
  const text = ((err?.stderr || "") + " " + (err?.message || "")).toString()
  return /SSLV3_ALERT_HANDSHAKE_FAILURE|SSL: HANDSHAKE_FAILURE|tlsv1|EOF occurred in violation/i.test(text)
}

function isTwitterHost(url: string): boolean {
  try {
    const u = new URL(url)
    return /(^|\.)(x\.com|twitter\.com|t\.co)$/i.test(u.hostname)
  } catch { return false }
}

async function tryDownload(url: string, baseArgs: string[], extraArgs: string[] = []): Promise<string> {
  const { stdout } = await execFileAsync("yt-dlp", [...baseArgs, ...extraArgs, url], {
    timeout: 20 * 60 * 1000,
    maxBuffer: 10 * 1024 * 1024,
    encoding: "utf-8",
  })
  const downloadedPath = findDownloadedPath(stdout)
  if (!downloadedPath) throw new Error("yt-dlp completed but did not report a downloaded file path")
  return validateRegularFile(downloadedPath)
}

async function downloadFromUrl(url: string): Promise<string> {
  mkdirSync(DOWNLOADS_DIR, { recursive: true })
  const prefix = cachePrefixForUrl(url)
  const outputTemplate = `${prefix}-%(id)s.%(ext)s`

  const baseArgs = [
    "--no-playlist",
    "--no-warnings",
    "--restrict-filenames",
    "--merge-output-format", "mp4",
    "-f", "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b",
    "--paths", DOWNLOADS_DIR,
    "-o", outputTemplate,
    "--print", "after_move:filepath",
  ]

  // v0.6: SSL fallback chain. Twitter/X CDN intermittently returns SSL handshake
  // failures via the default extractor; the syndication extractor goes through a
  // different endpoint and works around it.
  const fallbacks: Array<{ label: string; args: string[]; whenAllowed: (url: string, err: any) => boolean }> = [
    {
      label: "twitter:api=syndication",
      args: ["--extractor-args", "twitter:api=syndication"],
      whenAllowed: (u, err) => isTwitterHost(u) && isSslHandshakeError(err),
    },
    {
      label: "force-ipv4",
      args: ["--force-ipv4"],
      whenAllowed: (_u, err) => isSslHandshakeError(err),
    },
  ]

  let lastErr: any = null
  try {
    return await tryDownload(url, baseArgs)
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      throw new Error("yt-dlp is required for URL inputs but was not found. Install with: brew install yt-dlp (or pipx install yt-dlp)")
    }
    lastErr = err
  }

  for (const fb of fallbacks) {
    if (!fb.whenAllowed(url, lastErr)) continue
    try {
      return await tryDownload(url, baseArgs, fb.args)
    } catch (err: any) {
      if (err?.code === "ENOENT") {
        throw new Error("yt-dlp is required for URL inputs but was not found. Install with: brew install yt-dlp (or pipx install yt-dlp)")
      }
      lastErr = err
    }
  }

  const detail = lastErr?.stderr || lastErr?.message || String(lastErr)
  throw new Error(`yt-dlp failed to download ${url}: ${detail}`)
}

async function fetchUrlInfo(url: string): Promise<{ source: VideoSourceMetadata; captionTrack: CaptionTrackMetadata | null }> {
  try {
    const { stdout } = await execFileAsync("yt-dlp", [
      "--skip-download", "--no-playlist", "--dump-single-json", url,
    ], { timeout: 30_000, maxBuffer: 25 * 1024 * 1024, encoding: "utf-8" })

    const data = JSON.parse(stdout) as Record<string, unknown>
    const extractor = (typeof data.extractor === "string" ? data.extractor : "url").toLowerCase()
    const captionTrack = isYouTubeUrl(url) ? chooseCaptionTrack(data) : null
    return {
      source: {
        type: extractor,
        url,
        title: typeof data.title === "string" ? data.title : undefined,
        channel: typeof data.channel === "string" ? data.channel : undefined,
        uploader: typeof data.uploader === "string" ? data.uploader : undefined,
        duration: typeof data.duration_string === "string" ? data.duration_string : undefined,
        upload_date: typeof data.upload_date === "string" ? data.upload_date : undefined,
        view_count: typeof data.view_count === "number" ? data.view_count : undefined,
        description: truncateDescription(data.description),
        caption_track: captionTrack ?? undefined,
      },
      captionTrack,
    }
  } catch {
    return { source: { type: "url", url }, captionTrack: null }
  }
}

function chooseCaptionTrack(data: Record<string, unknown>): CaptionTrackMetadata | null {
  const subtitles = data.subtitles as Record<string, unknown> | undefined
  const automaticCaptions = data.automatic_captions as Record<string, unknown> | undefined
  const preferred = ["en", "en-orig", "en-US", "en-GB"]

  for (const lang of preferred) {
    if (subtitles?.[lang]) return { source: "subtitles", language: lang }
  }
  for (const lang of Object.keys(subtitles ?? {})) {
    if (lang.startsWith("en")) return { source: "subtitles", language: lang }
  }
  for (const lang of preferred) {
    if (automaticCaptions?.[lang]) return { source: "automatic_captions", language: lang }
  }
  for (const lang of Object.keys(automaticCaptions ?? {})) {
    if (lang.startsWith("en")) return { source: "automatic_captions", language: lang }
  }
  return null
}

function parseSubtitleTimestamp(raw: string): number {
  const m = raw.trim().match(/(?:(\d+):)?(\d{2}):(\d{2})[,.](\d{3})/)
  if (!m) return 0
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000
}

function decodeSubtitleText(text: string): string {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ").trim()
}

export function parseSubtitleContent(raw: string): TranscriptionSegment[] {
  const blocks = raw.replace(/\r/g, "").split(/\n{2,}/)
  const out: TranscriptionSegment[] = []
  for (const block of blocks) {
    const lines = block.split("\n").map(l => l.trim()).filter(Boolean)
    const i = lines.findIndex(l => l.includes("-->"))
    if (i === -1) continue
    const [s, e] = lines[i].split("-->").map(p => p.trim())
    if (!s || !e) continue
    const text = decodeSubtitleText(lines.slice(i + 1).join(" "))
    if (!text) continue
    out.push({
      start: formatHMS(parseSubtitleTimestamp(s)),
      end: formatHMS(parseSubtitleTimestamp(e)),
      text,
    })
  }
  return out
}

async function fetchCaptions(url: string, track: CaptionTrackMetadata | null): Promise<CaptionResult | null> {
  if (!track) return null
  const workDir = join(tmpdir(), `lumiere-captions-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(workDir, { recursive: true })
  try {
    const args = [
      "--skip-download", "--no-playlist",
      "--sub-langs", track.language,
      "--sub-format", "srt/vtt/best",
      "-o", join(workDir, "%(id)s.%(ext)s"),
    ]
    if (track.source === "subtitles") args.push("--write-subs")
    else args.push("--write-auto-subs")
    args.push(url)
    await execFileAsync("yt-dlp", args, { timeout: 60_000, maxBuffer: 10 * 1024 * 1024, encoding: "utf-8" })

    for (const file of readdirSync(workDir)) {
      if (file.endsWith(".srt") || file.endsWith(".vtt")) {
        const transcription = parseSubtitleContent(readFileSync(join(workDir, file), "utf-8"))
        return {
          ...track,
          transcription,
          coverage_seconds: transcriptCoverage(transcription),
        }
      }
    }
    return null
  } catch {
    return null
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}

export function transcriptCoverage(t: TranscriptionSegment[]): number {
  let max = 0
  for (const s of t) {
    try { max = Math.max(max, parseHMS(s.end)) } catch {}
  }
  return max
}

export function getCaptionFallbackReason(captions: CaptionResult | undefined, durationSec: number): string | null {
  if (!captions) return "no caption track found"
  if (captions.transcription.length === 0) return "caption track was empty"
  // Only auto-use creator-uploaded subtitles. YouTube auto_captions are unreliable
  // (T-test 2026-05-19: F3 Anthropic launch returned "Woo!" x28 with timestamps at
  // 02:56-04:07 on an 81s video, wildly outside duration, useless transcript).
  if (captions.source === "automatic_captions") {
    return "auto_captions skipped (run configured backend for reliable transcript)"
  }
  const cov = durationSec > 0 ? captions.coverage_seconds / durationSec : 1
  if (durationSec >= 30 && cov < 0.5) return `captions cover only ${Math.round(cov * 100)}% of the video`
  // Sanity: caption timestamps must not significantly exceed video duration.
  if (durationSec > 0 && captions.coverage_seconds > durationSec * 1.2) {
    return `captions span ${Math.round(captions.coverage_seconds)}s but video is ${Math.round(durationSec)}s (parser bug or bad VTT)`
  }
  return null
}

export function buildCaptionAudioResult(c: CaptionResult, range?: { startTime?: string; endTime?: string }): AudioResult {
  const startSec = range?.startTime ? parseHMS(range.startTime) : 0
  const endSec = range?.endTime ? parseHMS(range.endTime) : Number.POSITIVE_INFINITY
  const transcription = c.transcription
    .map(s => {
      const ss = parseHMS(s.start)
      const se = parseHMS(s.end)
      if (se < startSec || ss > endSec) return null
      return { ...s, start: formatHMS(Math.max(0, ss - startSec)), end: formatHMS(Math.max(0, se - startSec)) }
    })
    .filter((s): s is TranscriptionSegment => s !== null)
  return {
    backend: "youtube-captions",
    transcription,
    audio_tags: [],
    full_analysis: null,
    transcription_source: c.source === "subtitles" ? "youtube_subtitles" : "youtube_auto_captions",
    transcription_source_detail: `${c.language} (${c.source})`,
  }
}

export async function resolveVideoInputDetailed(input: string): Promise<ResolvedVideoInput> {
  if (isUrl(input)) {
    const info = await fetchUrlInfo(input)
    const [path, captions] = await Promise.all([
      downloadFromUrl(input),
      fetchCaptions(input, info.captionTrack),
    ])
    return { path, source: info.source, captions: captions ?? undefined }
  }
  return { path: validateVideoPath(input) }
}

export function cleanExpiredDownloads(maxAgeDays: number): void {
  if (!existsSync(DOWNLOADS_DIR)) return
  const cutoff = Date.now() - maxAgeDays * 86400_000
  for (const entry of readdirSync(DOWNLOADS_DIR)) {
    const p = join(DOWNLOADS_DIR, entry)
    try {
      const s = statSync(p)
      if (!s.isFile()) continue
      if (s.mtimeMs < cutoff) rmSync(p, { force: true })
    } catch {
      rmSync(p, { force: true })
    }
  }
}
