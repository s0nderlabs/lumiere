import { execFile } from "child_process"
import { promisify } from "util"
import { existsSync, mkdirSync, createReadStream } from "fs"
import { createHash } from "crypto"
import { dirname } from "path"
import { pipeline } from "stream/promises"
import { detectPlatform, recommendWhisperModel } from "../utils/platform.js"
import { formatHMS } from "../utils/timestamps.js"
import type { AudioResult, TranscriptionSegment, WhisperModel } from "../types.js"
import { MODELS_DIR } from "../config.js"

const execFileAsync = promisify(execFile)

const KNOWN_CHECKSUMS: Record<string, string> = {
  "tiny":            "be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21",
  "tiny.en":         "921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f",
  "base":            "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe",
  "base.en":         "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002",
  "small":           "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b",
  "small.en":        "c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d",
  "medium":          "6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208",
  "medium.en":       "cc37e93478338ec7700281a7ac30a10128929eb8f427dda2e865faa8f6da4356",
  "large-v1":        "7d99f41a10525d0206bddadd86760181fa920438b6b33237e3118ff6c83bb53d",
  "large-v2":        "9a423fe4d40c82774b6af34115b8b935f34152246eb19e80e376071d3f999487",
  "large-v3":        "64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2",
  "large-v3-turbo":  "1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69",
}

function resolveModel(m: WhisperModel): string {
  if (m === "auto") return recommendWhisperModel(detectPlatform().ram_gb)
  return m
}

export async function transcribeWithWhisper(wavPath: string, model: WhisperModel): Promise<AudioResult> {
  const resolved = resolveModel(model)
  const modelPath = `${MODELS_DIR}/ggml-${resolved}.bin`

  if (!existsSync(modelPath)) {
    if (!existsSync(MODELS_DIR)) mkdirSync(MODELS_DIR, { recursive: true })
    const url = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${resolved}.bin`
    process.stderr.write(`lumiere: downloading whisper model ggml-${resolved}.bin...\n`)
    await execFileAsync("curl", ["-L", "-o", modelPath, url], { timeout: 600_000 })

    const expected = KNOWN_CHECKSUMS[resolved]
    if (expected) {
      const hash = createHash("sha256")
      await pipeline(createReadStream(modelPath), hash)
      const actual = hash.digest("hex")
      if (actual !== expected) {
        throw new Error(`Model checksum mismatch for ggml-${resolved}.bin: expected ${expected}, got ${actual}`)
      }
      process.stderr.write(`lumiere: checksum verified for ggml-${resolved}.bin\n`)
    }
  }

  const { stdout } = await execFileAsync("whisper-cli", [
    "--model", modelPath,
    "--file", wavPath,
    "--output-json",
    "--language", "auto",
  ], { timeout: 600_000, maxBuffer: 50 * 1024 * 1024 })

  return parseWhisperOutput(stdout)
}

function parseWhisperOutput(output: string): AudioResult {
  const transcription: TranscriptionSegment[] = []

  try {
    const parsed = JSON.parse(output)
    const segments = parsed.segments || parsed.transcription || []
    for (const seg of segments) {
      transcription.push({
        start: formatHMS(seg.start ?? seg.from ?? 0),
        end: formatHMS(seg.end ?? seg.to ?? 0),
        text: (seg.text || "").trim(),
      })
    }
  } catch {
    // Fallback: whisper-cli outputs structured timestamps within text body.
    // Parse [HH:MM:SS.mmm --> HH:MM:SS.mmm] prefix lines (T4 finding).
    const lines = output.split("\n").filter(l => l.trim())
    for (const line of lines) {
      const m = line.match(/^\[([\d:.]+)\s*-->\s*([\d:.]+)\]\s*(.*)/)
      if (m) {
        transcription.push({
          start: stripMs(m[1]),
          end: stripMs(m[2]),
          text: m[3].trim(),
        })
      }
    }
    if (transcription.length === 0 && output.trim()) {
      transcription.push({ start: "00:00:00", end: "00:00:00", text: output.trim() })
    }
  }

  return {
    backend: "local",
    transcription,
    audio_tags: [],
    full_analysis: null,
  }
}

function stripMs(ts: string): string {
  return ts.replace(/\.\d+$/, "").padStart(8, "0")
}
