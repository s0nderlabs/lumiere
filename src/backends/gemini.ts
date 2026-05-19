import type { AudioResult, AudioTag, ChunkWarning, TranscriptionSegment } from "../types.js"
import { mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { extractAudio } from "../extractors/audio.js"
import { parseHMS, formatHMS } from "../utils/timestamps.js"
import { planChunks, type SilenceDetector } from "../extractors/audio-chunker.js"
import { getVideoMetadata } from "../extractors/frames.js"
import { DEFAULTS } from "../defaults.js"
import { credGet } from "../auth.js"

interface ParsedGeminiAudio {
  transcription: TranscriptionSegment[]
  audio_tags: AudioTag[]
}

export function parseGeminiAudioResponse(raw: string): ParsedGeminiAudio {
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch (err) {
    throw new Error(`Gemini returned non-JSON response: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (typeof parsed !== "object" || parsed === null) throw new Error("Gemini JSON is not an object")
  const obj = parsed as Record<string, unknown>
  return {
    transcription: Array.isArray(obj.transcription) ? (obj.transcription as TranscriptionSegment[]) : [],
    audio_tags: Array.isArray(obj.audio_tags) ? (obj.audio_tags as AudioTag[]) : [],
  }
}

function offsetTs(hms: string, offsetSec: number): string {
  return formatHMS(parseHMS(hms) + offsetSec)
}

interface GenAiFile { name?: string; state?: string; uri?: string; mimeType?: string }
interface GenAiClient {
  files: { get(a: { name: string }): Promise<GenAiFile>; delete(a: { name: string }): Promise<void> }
}

async function waitForFileActive(ai: GenAiClient, file: GenAiFile): Promise<GenAiFile> {
  if (!file.name) throw new Error("Cannot poll Gemini file state: missing name")
  const deadline = Date.now() + 120_000
  let current = file
  while (current.state !== "ACTIVE") {
    if (current.state === "FAILED") throw new Error(`Gemini file ${current.name} processing failed`)
    if (Date.now() > deadline) throw new Error(`Gemini file ${current.name} stuck in ${current.state}`)
    await new Promise(r => setTimeout(r, 2000))
    current = await ai.files.get({ name: current.name! })
  }
  return current
}

async function transcribeChunk(wavPath: string, offsetSec: number): Promise<{ segments: TranscriptionSegment[]; tags: AudioTag[] }> {
  const apiKey = credGet("dev.lumiere-gemini-api-key") || process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set")

  const { GoogleGenAI, createPartFromUri, createUserContent, Type } = await import("@google/genai")
  const ai = new GoogleGenAI({ apiKey })

  const uploaded = await ai.files.upload({ file: wavPath, config: { mimeType: getMimeType(wavPath) } })
  await waitForFileActive(ai as unknown as GenAiClient, uploaded)

  try {
    const response = await ai.models.generateContent({
      model: DEFAULTS.audio_model,
      contents: createUserContent([
        createPartFromUri(uploaded.uri!, uploaded.mimeType!),
        `Analyze this audio track and return structured JSON with two arrays:
1. "transcription": one entry per contiguous speech segment, with start and end timestamps as "HH:MM:SS" strings and the spoken text verbatim.
2. "audio_tags": one entry per non-speech audio event (music, sfx, ambient sounds) with start and end timestamps as "HH:MM:SS" strings and a short lowercase label.
Use "00:00:00" if you cannot determine a timestamp. Return empty arrays if no speech or no non-speech events are present.`,
      ]),
      config: {
        thinkingConfig: { thinkingBudget: 0 },
        maxOutputTokens: DEFAULTS.audio_max_output_tokens,
        responseMimeType: "application/json",
        responseJsonSchema: {
          type: Type.OBJECT,
          properties: {
            transcription: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  start: { type: Type.STRING },
                  end: { type: Type.STRING },
                  text: { type: Type.STRING },
                },
                propertyOrdering: ["start", "end", "text"],
                required: ["start", "end", "text"],
              },
            },
            audio_tags: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  start: { type: Type.STRING },
                  end: { type: Type.STRING },
                  tag: { type: Type.STRING },
                },
                propertyOrdering: ["start", "end", "tag"],
                required: ["start", "end", "tag"],
              },
            },
          },
          propertyOrdering: ["transcription", "audio_tags"],
          required: ["transcription", "audio_tags"],
        },
      },
    })

    const parsed = parseGeminiAudioResponse(response.text ?? "")
    return {
      segments: parsed.transcription.map(s => ({ ...s, start: offsetTs(s.start, offsetSec), end: offsetTs(s.end, offsetSec) })),
      tags: parsed.audio_tags.map(t => ({ ...t, start: offsetTs(t.start, offsetSec), end: offsetTs(t.end, offsetSec) })),
    }
  } finally {
    await ai.files.delete({ name: uploaded.name! }).catch(() => {})
  }
}

async function transcribeWithRetry(
  wavPath: string,
  offsetSec: number,
  retries = 1,
  onWarning?: (w: { event: "retry"; attempt: number; error: string }) => void,
): Promise<{ ok: boolean; segments?: TranscriptionSegment[]; tags?: AudioTag[]; error?: string }> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await transcribeChunk(wavPath, offsetSec)
      return { ok: true, segments: r.segments, tags: r.tags }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (attempt < retries) { onWarning?.({ event: "retry", attempt, error: msg }); continue }
      return { ok: false, error: msg }
    }
  }
  return { ok: false, error: "unreachable" }
}

export interface AudioSlice { startTime?: string; endTime?: string }

export async function analyzeWithGeminiApi(
  videoPath: string,
  slice?: AudioSlice,
  silenceDetector?: SilenceDetector,
): Promise<AudioResult> {
  const tmpDir = mkdtempSync(join(tmpdir(), "lumiere-gemini-"))
  try {
    if (slice?.startTime || slice?.endTime) {
      const wav = await extractAudio(videoPath, tmpDir, { startTime: slice.startTime, endTime: slice.endTime })
      const r = await transcribeChunk(wav, 0)
      return { backend: "gemini-api", transcription: r.segments, audio_tags: r.tags, full_analysis: null }
    }

    const meta = await getVideoMetadata(videoPath)
    if (meta.duration_seconds <= DEFAULTS.audio_chunk_trigger_seconds) {
      const wav = await extractAudio(videoPath, tmpDir)
      const r = await transcribeChunk(wav, 0)
      return { backend: "gemini-api", transcription: r.segments, audio_tags: r.tags, full_analysis: null }
    }

    const { chunks, warnings: planWarnings } = await planChunks(videoPath, meta.duration_seconds, silenceDetector)
    const wavPaths = await Promise.all(
      chunks.map(c => extractAudio(videoPath, tmpDir, {
        startTime: formatHMS(c.actual_start),
        endTime: formatHMS(c.end),
        filename: `chunk-${c.index}.wav`,
      })),
    )
    const allWarnings: ChunkWarning[] = [...planWarnings]
    const results = await Promise.all(
      chunks.map((c, i) => transcribeWithRetry(wavPaths[i], c.start, 1, w => {
        allWarnings.push({
          chunk_index: c.index, chunk_total: c.total,
          time_range: `${formatHMS(c.start)}-${formatHMS(c.end)}`,
          event: w.event, detail: w.error,
        })
      })),
    )
    const transcription: TranscriptionSegment[] = []
    const audio_tags: AudioTag[] = []
    chunks.forEach((c, i) => {
      const r = results[i]
      if (r.ok) {
        for (const s of r.segments ?? []) { const cl = clamp(s, c.start, c.end); if (cl) transcription.push(cl) }
        for (const t of r.tags ?? []) { const cl = clamp(t, c.start, c.end); if (cl) audio_tags.push(cl) }
      } else {
        transcription.push({ start: formatHMS(c.start), end: formatHMS(c.end), text: "[transcription failed for this segment after retry]" })
        allWarnings.push({
          chunk_index: c.index, chunk_total: c.total,
          time_range: `${formatHMS(c.start)}-${formatHMS(c.end)}`,
          event: "failed", detail: r.error,
        })
      }
    })
    return {
      backend: "gemini-api",
      transcription, audio_tags,
      full_analysis: null,
      warnings: allWarnings.length ? allWarnings : undefined,
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

function clamp<T extends { start: string; end: string }>(seg: T, minSec: number, maxSec: number): T | null {
  const s = Math.max(parseHMS(seg.start), minSec)
  const e = Math.min(parseHMS(seg.end), maxSec)
  if (e <= s) return null
  return { ...seg, start: formatHMS(s), end: formatHMS(e) }
}

function getMimeType(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase()
  const map: Record<string, string> = {
    wav: "audio/wav", mp3: "audio/mp3", aac: "audio/aac", flac: "audio/flac", ogg: "audio/ogg", aiff: "audio/aiff",
  }
  return map[ext || ""] || "audio/wav"
}
