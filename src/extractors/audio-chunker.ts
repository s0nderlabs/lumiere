import { execFile } from "child_process"
import { promisify } from "util"
import type { ChunkPlan, ChunkWarning, Interval } from "../types.js"
import { parseSilenceOutput } from "./analyzers.js"
import { parseHMS, formatHMS } from "../utils/timestamps.js"
import { DEFAULTS } from "../defaults.js"

const execFileAsync = promisify(execFile)

export type SilenceThreshold = "default" | "loose"
export type SilenceDetector = (videoPath: string, threshold: SilenceThreshold) => Promise<Interval[]>

const TOLERANCE_SECONDS = 30

const SILENCE_PARAMS: Record<SilenceThreshold, string> = {
  default: "silencedetect=n=-40dB:d=0.5",
  loose: "silencedetect=n=-30dB:d=0.2",
}

export async function detectSilencesReal(videoPath: string, threshold: SilenceThreshold): Promise<Interval[]> {
  const args = ["-i", videoPath, "-af", SILENCE_PARAMS[threshold], "-f", "null", "-"]
  let stderr = ""
  try {
    const r = await execFileAsync("ffmpeg", args, { maxBuffer: 100 * 1024 * 1024 })
    stderr = r.stderr
  } catch (err: any) {
    stderr = err.stderr || ""
  }
  return parseSilenceOutput(stderr)
}

function findNearestSilence(boundary: number, silences: Interval[]): number | null {
  let best: number | null = null
  let bestDist = Infinity
  for (const s of silences) {
    const mid = (parseHMS(s.start) + parseHMS(s.end)) / 2
    const d = Math.abs(mid - boundary)
    if (d <= TOLERANCE_SECONDS && d < bestDist) {
      bestDist = d
      best = mid
    }
  }
  return best
}

export async function planChunks(
  videoPath: string,
  durationSec: number,
  detector: SilenceDetector = detectSilencesReal,
  chunkSize = DEFAULTS.audio_chunk_size_seconds,
  overlap = DEFAULTS.audio_chunk_overlap_seconds,
): Promise<{ chunks: ChunkPlan[]; warnings: ChunkWarning[] }> {
  if (durationSec <= chunkSize) {
    return {
      chunks: [{ start: 0, actual_start: 0, end: durationSec, index: 0, total: 1, clean_cut: true }],
      warnings: [],
    }
  }

  const idealBoundaries: number[] = []
  for (let t = chunkSize; t + chunkSize <= durationSec; t += chunkSize) idealBoundaries.push(t)

  if (idealBoundaries.length === 0) {
    return {
      chunks: [{ start: 0, actual_start: 0, end: durationSec, index: 0, total: 1, clean_cut: true }],
      warnings: [],
    }
  }

  const defSilences = await detector(videoPath, "default")
  const matches = idealBoundaries.map(b => {
    const mid = findNearestSilence(b, defSilences)
    return { boundary: b, silenceMidpoint: mid, clean_cut: mid !== null, threshold: mid !== null ? "default" : null }
  })

  const unmatched = matches.filter(m => !m.clean_cut)
  if (unmatched.length > 0) {
    const loose = await detector(videoPath, "loose")
    for (const m of unmatched) {
      const mid = findNearestSilence(m.boundary, loose)
      if (mid !== null) {
        m.silenceMidpoint = mid
        m.clean_cut = true
        m.threshold = "loose"
      }
    }
  }

  const warnings: ChunkWarning[] = []
  const total = matches.length + 1
  const chunks: ChunkPlan[] = []
  let prev = 0
  matches.forEach((m, i) => {
    const end = m.silenceMidpoint ?? m.boundary
    chunks.push({
      start: prev,
      actual_start: Math.max(0, prev - overlap),
      end,
      index: i,
      total,
      clean_cut: m.clean_cut,
    })
    if (m.threshold === "loose") {
      warnings.push({
        chunk_index: i, chunk_total: total,
        time_range: `${formatHMS(prev)}-${formatHMS(end)}`,
        event: "loose_threshold",
        detail: "matched silence using loose threshold",
      })
    }
    if (!m.clean_cut) {
      warnings.push({
        chunk_index: i, chunk_total: total,
        time_range: `${formatHMS(prev)}-${formatHMS(end)}`,
        event: "hard_cut",
        detail: `no silence within ±${TOLERANCE_SECONDS}s of target boundary`,
      })
    }
    prev = end
  })
  chunks.push({
    start: prev,
    actual_start: Math.max(0, prev - overlap),
    end: durationSec,
    index: matches.length,
    total,
    clean_cut: true,
  })
  return { chunks, warnings }
}
