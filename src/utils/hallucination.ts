import type { TranscriptionSegment } from "../types.js"
import { parseHMS } from "./timestamps.js"

// Known whisper.cpp credits-style hallucinations on near-silent / music audio.
// These appear verbatim (or close to verbatim) when the audio has no actual speech.
const HALLUCINATION_PHRASES = [
  /thank you( for watching| for listening|\.|$)/i,
  /subtitles by/i,
  /tanya cushman reviewer/i,
  /teksting av/i,                // Norwegian credits ("subtitles by")
  /undertekster av/i,
  /tradução[: ]/i,
  /^\s*\(?(upbeat|gentle|calm|inspiring|dramatic|soft|sad|happy|cheerful)\s+(music|musik|piano|guitar|sound)\)?\s*$/i,
  /^\s*\(?(applause|laughter|silence|music)\)?\s*$/i,
  /^\s*\.+\s*$/,                 // sometimes whisper outputs just periods
  /^\s*you\s*\.?\s*$/i,          // single-word "you" hallucination
  /^\s*woo!?\s*$/i,              // "Woo!" repeats observed on Anthropic launch
  /www\.[a-z]+\.(com|org|net)/i,
]

export interface LowConfidenceCheck {
  flagged: boolean
  reasons: string[]
}

export function detectLowConfidenceTranscript(
  segments: TranscriptionSegment[] | undefined,
  durationSeconds: number,
  meanLufs: number | undefined,
): LowConfidenceCheck {
  const reasons: string[] = []
  if (!segments || segments.length === 0) return { flagged: false, reasons }

  // Signal 1: low loudness AND any transcript present
  if (meanLufs !== undefined && meanLufs < -28) {
    reasons.push(`loudness ${meanLufs.toFixed(1)} LUFS suggests low speech presence`)
  }

  // Signal 2: identical text repeated 3+ times (the credits-loop pattern)
  const textCounts = new Map<string, number>()
  for (const s of segments) {
    const norm = s.text.trim().toLowerCase()
    textCounts.set(norm, (textCounts.get(norm) ?? 0) + 1)
  }
  const dominantRepeat = [...textCounts.entries()].find(([_, n]) => n >= 3)
  if (dominantRepeat) {
    const totalCount = segments.length
    if (dominantRepeat[1] / totalCount >= 0.5) {
      reasons.push(`"${dominantRepeat[0].slice(0, 40)}" repeated ${dominantRepeat[1]}/${totalCount} times (likely whisper hallucination)`)
    }
  }

  // Signal 3: any segment matches the known hallucination phrases
  let hallucinationHits = 0
  for (const s of segments) {
    if (HALLUCINATION_PHRASES.some(re => re.test(s.text))) hallucinationHits++
  }
  if (hallucinationHits > 0 && hallucinationHits / segments.length >= 0.5) {
    reasons.push(`${hallucinationHits}/${segments.length} segments match known whisper-on-music hallucination phrases`)
  }

  // Signal 4: transcript spans wildly outside the video duration
  // (catches the F3 bug where 81s video produced timestamps at 2:56-4:07)
  if (durationSeconds > 0 && segments.length > 0) {
    try {
      const lastEnd = parseHMS(segments[segments.length - 1].end)
      if (lastEnd > durationSeconds + 30) {
        reasons.push(`transcript end ${segments[segments.length - 1].end} exceeds video duration ${Math.round(durationSeconds)}s by ${Math.round(lastEnd - durationSeconds)}s — likely parser/offset bug`)
      }
    } catch {}
  }

  return { flagged: reasons.length > 0, reasons }
}
