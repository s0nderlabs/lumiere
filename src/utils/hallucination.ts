import type { AudioResult, LoudnessReading, TranscriptionSegment, VideoAnalysis } from "../types.js"
import { parseHMS } from "./timestamps.js"

export const SUPPRESSED_TRANSCRIPT_TEXT =
  "[low confidence: likely silent / music-only audio; whisper output suppressed]"

// Threshold for the "low loudness" signal in detectLowConfidenceTranscript.
// Applied to either LUFS (K-weighted) or dBFS (peak); -28 is conservative for
// both scales and is one of four fuzzy signals, so cross-scale calibration
// doesn't need to be tight.
const LOW_LOUDNESS_THRESHOLD = -28

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
  // Multilingual hallucinations observed on gym ambient audio (v0.12.1)
  /^\s*terima\s*kasih/i,                     // Indonesian "thank you"
  /^\s*vielen\s*dank\.?\s*$/i,               // German "thank you"
  /^\s*gracias\.?!?\s*$/i,                   // Spanish "thanks"
  /^\s*merci\.?\s*$/i,                       // French "thanks"
  /^\s*grazie\.?\s*$/i,                      // Italian "thanks"
  /^\s*谢谢/,                                // Chinese "thanks"
  /^\s*好\s*$/,                              // Chinese single-char filler
  /^\s*走\s*$/,                              // Chinese single-char filler
  /^\s*(yes|no|i don'?t know)\.?\s*$/i,      // English single-phrase fillers
  /^\s*we'?ll be right back\.?\s*$/i,        // English broadcast filler
  /редактор субтитров/i,                     // Russian subtitle credits
  /корректор/i,                              // Russian proofreader credits
  /para pensar\.?\s*$/i,                     // Portuguese filler
]

export interface LowConfidenceCheck {
  flagged: boolean
  reasons: string[]
}

export function detectLowConfidenceTranscript(
  segments: TranscriptionSegment[] | undefined,
  durationSeconds: number,
  loudness: LoudnessReading | undefined,
): LowConfidenceCheck {
  const reasons: string[] = []
  if (!segments || segments.length === 0) return { flagged: false, reasons }

  // Signal 1: low loudness AND any transcript present
  if (loudness !== undefined && loudness.value < LOW_LOUDNESS_THRESHOLD) {
    reasons.push(`loudness ${loudness.value.toFixed(1)} ${loudness.scale.toUpperCase()} suggests low speech presence`)
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

  // Signal 5: short chunk with minimal text. On sub-5s watch chunks, whisper
  // often emits a single short phrase ("Yes.", "好", "Vielen Dank.") that's
  // pure hallucination on ambient audio. Flag when: 1 segment, <= 4 words,
  // chunk is short (< 5s). The 50% phrase-match gate in Signal 3 can't catch
  // novel single-segment hallucinations because 1/1 = 100% only fires if the
  // phrase is in the list. This signal catches the rest.
  if (segments.length === 1 && durationSeconds < 5) {
    const wordCount = segments[0].text.trim().split(/\s+/).length
    if (wordCount <= 4) {
      reasons.push(`single segment with ${wordCount} word(s) on ${durationSeconds.toFixed(1)}s chunk (likely hallucination on ambient audio)`)
    }
  }

  // Signal 4: transcript spans wildly outside the video duration
  // (catches the F3 bug where 81s video produced timestamps at 2:56-4:07)
  if (durationSeconds > 0 && segments.length > 0) {
    try {
      const lastEnd = parseHMS(segments[segments.length - 1].end)
      if (lastEnd > durationSeconds + 30) {
        reasons.push(`transcript end ${segments[segments.length - 1].end} exceeds video duration ${Math.round(durationSeconds)}s by ${Math.round(lastEnd - durationSeconds)}s (likely parser/offset bug)`)
      }
    } catch {}
  }

  return { flagged: reasons.length > 0, reasons }
}

// Shared suppression helper. When detectLowConfidenceTranscript flags, callers
// collapse the transcription into a single sentinel segment spanning the
// original range. analyze and watch both used to inline this; centralizing
// keeps the placeholder text + span derivation in one place.
export function suppressHallucinatedTranscript(segments: TranscriptionSegment[]): TranscriptionSegment[] {
  const start = segments[0]?.start ?? "00:00:00"
  const end = segments[segments.length - 1]?.end ?? "00:00:00"
  return [{ start, end, text: SUPPRESSED_TRANSCRIPT_TEXT }]
}

// One-stop apply-if-flagged for the watch path. Reads loudness off the
// AudioResult's discriminated union, so callers no longer pluck out a raw
// number with an implicit scale.
export function applyHallucinationGate(
  audio: AudioResult,
  durationSeconds: number,
): AudioResult {
  if (!audio.transcription || audio.transcription.length === 0) return audio
  if (audio.transcription_skipped_reason) return audio
  const check = detectLowConfidenceTranscript(audio.transcription, durationSeconds, audio.loudness)
  if (!check.flagged) return audio
  return {
    ...audio,
    transcription: suppressHallucinatedTranscript(audio.transcription),
    low_confidence: true,
    transcription_low_confidence_reasons: check.reasons,
  }
}

// Applies the same gate to an in-progress VideoAnalysis. The analyze path
// always has LUFS (from ebur128) so we synthesize a LoudnessReading for the
// shared detector.
export function applyHallucinationGateToAnalysis(
  analysis: VideoAnalysis,
  durationSeconds: number,
): void {
  if (!analysis.transcription || analysis.transcription.length === 0) return
  const meanLufs = analysis.loudness_summary?.mean_lufs
  const loudness: LoudnessReading | undefined = meanLufs !== undefined
    ? { value: meanLufs, scale: "lufs" }
    : undefined
  const check = detectLowConfidenceTranscript(analysis.transcription, durationSeconds, loudness)
  if (!check.flagged) return
  analysis.transcription_low_confidence = true
  analysis.transcription_low_confidence_reasons = check.reasons
  analysis.transcription = suppressHallucinatedTranscript(analysis.transcription)
}
