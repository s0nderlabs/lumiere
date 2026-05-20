import type { AudioResult, AudioTag, TranscriptionSegment } from "../types.js"

export function parseHMS(timestamp: string): number {
  const parts = timestamp.split(":").map(Number)
  if (parts.length !== 3 || parts.some(n => Number.isNaN(n))) {
    throw new Error(`Invalid HH:MM:SS timestamp: ${timestamp}`)
  }
  const [h, m, s] = parts
  return h * 3600 + m * 60 + s
}

// Integer-second formatter. Preserves backwards compat for callers that expect HH:MM:SS.
export function formatHMS(seconds: number): string {
  const clamped = Math.max(0, seconds)
  const h = Math.floor(clamped / 3600)
  const m = Math.floor((clamped % 3600) / 60)
  const s = Math.floor(clamped % 60)
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

// Sub-second formatter. Renders HH:MM:SS.SSS. Used for frame labels at fps>=2 so
// consecutive sub-second samples are distinguishable to the LLM. Without this,
// fps=25 produces 25 frames all labeled "00:00:02" which collapses dense motion
// into apparent duplicates.
export function formatHMSPrecise(seconds: number, decimals = 3): string {
  const clamped = Math.max(0, seconds)
  const h = Math.floor(clamped / 3600)
  const m = Math.floor((clamped % 3600) / 60)
  const totalS = clamped - h * 3600 - m * 60
  // Pad seconds to 2 integer digits, then decimal point + N decimal digits.
  // For decimals=3 this yields "SS.SSS" (6 chars). Pad to 2 integer digits,
  // not 3: an earlier bug used 3 and produced invalid "00:00:005.500" that
  // broke downstream LLM parsing of consecutive frames.
  const padLen = 2 + (decimals > 0 ? decimals + 1 : 0)
  const s = totalS.toFixed(decimals).padStart(padLen, "0")
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${s}`
}

export function shiftAudioResult(result: AudioResult, offsetSeconds: number): AudioResult {
  if (offsetSeconds === 0) return result
  const shift = <T extends TranscriptionSegment | AudioTag>(e: T): T => ({
    ...e,
    start: formatHMS(parseHMS(e.start) + offsetSeconds),
    end: formatHMS(parseHMS(e.end) + offsetSeconds),
  })
  return {
    ...result,
    transcription: result.transcription.map(shift),
    audio_tags: result.audio_tags.map(shift),
  }
}
