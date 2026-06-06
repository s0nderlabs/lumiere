import { describe, expect, test } from "bun:test"
import { detectLowConfidenceTranscript, HALLUCINATION_PHRASES } from "./hallucination.js"

const matchesAny = (text: string) => HALLUCINATION_PHRASES.some(re => re.test(text))

// Curated denylist anchors. Every string here was either observed in the wild
// (see memory: v0.12.1 gym audio, v0.12.3 Spanish ¡) or is a punctuation
// variant of an observed phrase that the same entry must tolerate.
const SUPPRESSED = [
  // Spanish (v0.12.3: whisper emits inverted punctuation on silent audio)
  "gracias",
  "Gracias.",
  "¡Gracias!",
  "¡¡Gracias!!",
  "gracias!!",
  "¿Gracias?",
  "¡Gracias?",
  "!Gracias!",
  " ¡gracias! ",
  "Gracias !",
  "gracias!.",
  // German
  "Vielen Dank.",
  "Vielen Dank!",
  "vielen dank",
  // French (typographic spaced bang included)
  "Merci.",
  "Merci !",
  "merci",
  // Italian
  "Grazie.",
  "Grazie!",
  "grazie",
  // Regression anchors for untouched entries
  "Thank you for watching",
  "Terima kasih banyak",
  "you",
  "...",
  "Woo!",
]

// The deliberate non-suppression boundary: multi-word phrases and real speech
// stay in the transcript. Only add multi-word forms to the denylist once they
// are observed as actual whisper hallucinations.
const KEPT = [
  "muchas gracias",
  "Gracias por ver el video",
  "Gracias, amigo",
  "merci beaucoup",
  "grazie mille",
  "Vielen Dank für Ihre Aufmerksamkeit",
  "The model renders each frame exactly once.",
]

describe("HALLUCINATION_PHRASES", () => {
  for (const text of SUPPRESSED) {
    test(`suppresses ${JSON.stringify(text)}`, () => {
      expect(matchesAny(text)).toBe(true)
    })
  }
  for (const text of KEPT) {
    test(`keeps ${JSON.stringify(text)}`, () => {
      expect(matchesAny(text)).toBe(false)
    })
  }
})

describe("detectLowConfidenceTranscript Signal 3", () => {
  const seg = (text: string, start: string, end: string) => ({ start, end, text })

  test("flags when hallucination phrases dominate the segments", () => {
    const segments = [
      seg("¡Gracias!", "00:00:00", "00:00:02"),
      seg("Gracias.", "00:00:02", "00:00:04"),
      seg("¿Gracias?", "00:00:04", "00:00:06"),
      seg("real words from actual speech in this segment", "00:00:06", "00:00:08"),
    ]
    const check = detectLowConfidenceTranscript(segments, 10, undefined)
    expect(check.flagged).toBe(true)
    expect(check.reasons.some(r => r.includes("hallucination phrases"))).toBe(true)
  })

  test("does not flag genuine speech", () => {
    const segments = [
      seg("welcome back to the channel", "00:00:00", "00:00:02"),
      seg("today we are testing the new release", "00:00:02", "00:00:05"),
      seg("muchas gracias a todos por el apoyo", "00:00:05", "00:00:08"),
      seg("let's get straight into the build", "00:00:08", "00:00:10"),
    ]
    const check = detectLowConfidenceTranscript(segments, 10, undefined)
    expect(check.flagged).toBe(false)
  })
})
