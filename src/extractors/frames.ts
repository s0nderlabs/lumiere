import { execFile } from "child_process"
import { promisify } from "util"
import { readFileSync, readdirSync, mkdirSync, existsSync } from "fs"
import { join } from "path"
import type { VideoMetadata, Frame, FrameFormat, Segment, SegmentFrame } from "../types.js"
import { formatHMS, formatHMSPrecise, parseHMS } from "../utils/timestamps.js"
import { roiBucketKey } from "../utils/roi.js"

const execFileAsync = promisify(execFile)

export async function getVideoMetadata(videoPath: string): Promise<VideoMetadata> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "quiet",
    "-print_format", "json",
    "-show_format", "-show_streams",
    videoPath,
  ])
  const probe = JSON.parse(stdout)
  const vs = probe.streams.find((s: any) => s.codec_type === "video")
  const as_ = probe.streams.find((s: any) => s.codec_type === "audio")
  const format = probe.format

  const durSec = parseFloat(format.duration || vs?.duration || "0")
  const min = Math.floor(durSec / 60)
  const sec = Math.floor(durSec % 60)
  const duration = `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`

  const sizeMB = (parseInt(format.size || "0", 10) / (1024 * 1024)).toFixed(1)
  const [num, den] = (vs?.r_frame_rate || "30/1").split("/").map(Number)
  const fps = Math.round(num / (den || 1))

  return {
    duration,
    duration_seconds: durSec,
    resolution: `${vs?.width || 0}x${vs?.height || 0}`,
    width: vs?.width || 0,
    height: vs?.height || 0,
    codec: vs?.codec_name || "unknown",
    original_fps: fps,
    file_size: `${sizeMB}MB`,
    has_audio: !!as_,
  }
}

export function frameFormatExtension(f: FrameFormat): string {
  return f === "jpeg" ? "jpg" : f
}

export function frameFormatMimeType(f: FrameFormat): string {
  return `image/${f}`
}

function frameQualityArgs(f: FrameFormat): string[] {
  if (f === "jpeg") return ["-q:v", "5"]
  if (f === "webp") return ["-quality", "80"]
  return []
}

function isMissingWebpEncoderError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const m = err.message.toLowerCase()
  return m.includes("codec webp") &&
    (m.includes("encoder not found") || m.includes("error selecting an encoder") ||
     m.includes("encoder for format image2") || m.includes("disabled"))
}

export interface ExtractFramesOptions {
  fps: number
  resolution: number
  outputDir: string
  format?: FrameFormat
  startTime?: string
  endTime?: string         // INTERPRETED AS DURATION FROM start_time (FIXED end_time semantics)
  maxFrames?: number
  // Optional crop applied before scaling. When set (watch's `roi: "auto"`
  // path), the subject region gets the full target resolution instead of
  // being averaged out by background pixels.
  crop?: { x: number; y: number; w: number; h: number }
}

/**
 * Frame extraction with the end_time bug FIXED.
 *
 * Upstream uses ffmpeg `-to <endTime>`, which when combined with `-ss <start>` is interpreted as
 * an OUTPUT time, not a wall-clock end. So `start=9, end=18` extracts 9 to 9+18=27, not 9 to 18.
 * Lumiere uses `-t <duration>` which is unambiguous: extract for N seconds starting at start_time.
 *
 * If callers want "end at HH:MM:SS", compute duration = parseHMS(end) - parseHMS(start) and pass that.
 */
export async function extractFrames(videoPath: string, options: ExtractFramesOptions): Promise<Frame[]> {
  const { fps, resolution, outputDir, format = "jpeg", startTime, endTime, maxFrames = 1000, crop } = options
  const ext = frameFormatExtension(format)

  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true })

  const args: string[] = []
  if (startTime) args.push("-ss", startTime)
  args.push("-i", videoPath)
  if (endTime) {
    const duration = parseHMS(endTime) - (startTime ? parseHMS(startTime) : 0)
    if (duration > 0) args.push("-t", String(duration))
  }
  // Filter chain: fps -> crop (if present) -> scale. Crop runs before scale so
  // the crop region uses the full target resolution.
  const filterChain: string[] = [`fps=${fps}`]
  if (crop) {
    filterChain.push(`crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`)
  }
  filterChain.push(`scale=${resolution}:-1`)
  args.push(
    "-vf", filterChain.join(","),
    "-frames:v", String(maxFrames),
    ...frameQualityArgs(format),
    join(outputDir, `frame_%04d.${ext}`),
  )

  try {
    await execFileAsync("ffmpeg", args)
  } catch (err) {
    if (format === "webp" && isMissingWebpEncoderError(err)) {
      throw new Error(
        "WebP frame extraction requires an ffmpeg build with libwebp. Use frame_format='jpeg' or 'png'.",
        { cause: err },
      )
    }
    throw err
  }

  const files = readdirSync(outputDir).filter(f => f.startsWith("frame_") && f.endsWith(`.${ext}`)).sort()
  const offset = startTime ? parseHMS(startTime) : 0

  // Sub-second timestamps when fps>=2 so consecutive frames are distinguishable
  // to the LLM. With fps=25 and integer seconds, all 25 frames would share the
  // label "00:00:02" and collapse dense motion into apparent duplicates.
  const usePrecise = fps >= 2
  return files.map((file, i) => {
    const p = join(outputDir, file)
    const data = readFileSync(p)
    const t = offset + i / fps
    return {
      timestamp: usePrecise ? formatHMSPrecise(t, 3) : formatHMS(t),
      image: data.toString("base64"),
      format,
      sourcePath: p,
    }
  })
}

export function generateTimestampsForSegment(segment: Segment): string[] {
  const start = parseHMS(segment.start)
  const end = parseHMS(segment.end)
  const interval = 1 / segment.fps
  const out: string[] = []
  for (let t = start; t < end; t += interval) out.push(formatHMS(Math.round(t)))
  return out
}

export async function extractFramesBySegments(
  videoPath: string,
  segments: Segment[],
  baseOutputDir: string,
  format: FrameFormat = "jpeg",
  crop?: { x: number; y: number; w: number; h: number },
): Promise<SegmentFrame[]> {
  const out: SegmentFrame[] = []
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    const res = seg.resolution ?? 512
    // Per-segment crop wins over the global crop. Different crops produce
    // different pixel content per segment, so they need their own output
    // directory to avoid colliding on frame_NNNN.jpg names.
    const segCrop = seg.crop ?? crop
    const bucket = seg.crop ? roiBucketKey(seg.crop) : ""
    const dirSuffix = bucket ? `${bucket}-s${i}` : `s${i}`
    const dir = join(baseOutputDir, String(res), dirSuffix)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

    const frames = await extractFrames(videoPath, {
      fps: seg.fps,
      resolution: res,
      outputDir: dir,
      format,
      startTime: seg.start,
      endTime: seg.end,
      maxFrames: 1000,
      crop: segCrop,
    })
    for (const f of frames) out.push({ ...f, resolution: res, crop: seg.crop })
  }
  return out
}
