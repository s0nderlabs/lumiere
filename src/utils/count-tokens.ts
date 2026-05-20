import { credGet } from "../auth.js"
import { readdirSync, existsSync, statSync, openSync, readSync, closeSync } from "fs"
import { join } from "path"
import { homedir } from "os"

const COUNT_TOKENS_URL = "https://api.anthropic.com/v1/messages/count_tokens"
const ANTHROPIC_VERSION = "2023-06-01"
const FALLBACK_MODEL = "claude-opus-4-7"

// Read the JSONL transcript backwards in 256 KiB chunks until we find the most
// recent line containing `"model":"..."` and return that model id. Avoids
// loading the entire (potentially multi-MB) transcript when we only need the
// last few lines. Returns null if nothing found or the file errors out.
function readModelFromTail(filePath: string): string | null {
  let fd: number | null = null
  try {
    const size = statSync(filePath).size
    if (size === 0) return null
    fd = openSync(filePath, "r")
    const CHUNK = 256 * 1024
    let tailText = ""
    let remaining = size
    // Read backwards up to ~4 MiB; if we still find nothing we give up rather
    // than scanning a gigantic transcript (the field appears in every assistant
    // turn, so this would only happen for malformed files).
    const MAX_READ = 4 * 1024 * 1024
    let totalRead = 0
    while (remaining > 0 && totalRead < MAX_READ) {
      const readLen = Math.min(CHUNK, remaining)
      const buf = Buffer.alloc(readLen)
      readSync(fd, buf, 0, readLen, remaining - readLen)
      tailText = buf.toString("utf-8") + tailText
      remaining -= readLen
      totalRead += readLen
      // Process full lines we have so far. Split into lines and scan from the
      // last whole line backwards. The first chunk may not start on a line
      // boundary; skip the partial leading fragment unless we're at offset 0.
      const lines = tailText.split("\n")
      const startIdx = remaining > 0 ? 1 : 0  // skip the partial first line if more to read
      for (let i = lines.length - 1; i >= startIdx; i--) {
        const line = lines[i]
        if (!line) continue
        // Cheap pre-filter: only parse JSON if the field substring is present.
        if (line.indexOf('"model"') === -1) continue
        try {
          const entry = JSON.parse(line)
          const model = entry?.message?.model
          if (typeof model === "string" && model.length > 0) return model
        } catch { /* skip malformed line */ }
      }
    }
    return null
  } catch {
    return null
  } finally {
    if (fd !== null) {
      try { closeSync(fd) } catch { /* ignore */ }
    }
  }
}

// Auto-detect the model the user's Claude Code session is currently running.
// Order of precedence:
//   1. process.env.LUMIERE_ANTHROPIC_MODEL (manual override)
//   2. process.env.ANTHROPIC_MODEL (Anthropic SDK convention)
//   3. Look up CLAUDE_CODE_SESSION_ID in ~/.claude/projects/*/ transcripts and
//      read the most recent assistant message's `model` field.
//   4. Fallback to claude-opus-4-7 (current latest).
// Cached for the lifetime of the process.
let _detectedModel: string | null = null
let _detectionAttempted = false

export function detectCurrentModel(): string {
  if (_detectionAttempted) return _detectedModel ?? FALLBACK_MODEL
  _detectionAttempted = true

  const envOverride = process.env.LUMIERE_ANTHROPIC_MODEL || process.env.ANTHROPIC_MODEL
  if (envOverride) {
    _detectedModel = envOverride
    return envOverride
  }

  const sessionId = process.env.CLAUDE_CODE_SESSION_ID
  if (sessionId) {
    try {
      const projectsDir = join(homedir(), ".claude", "projects")
      if (existsSync(projectsDir)) {
        for (const project of readdirSync(projectsDir)) {
          const jsonl = join(projectsDir, project, `${sessionId}.jsonl`)
          if (!existsSync(jsonl)) continue
          // Read from the END of the file. The model field lives in the most
          // recent assistant entry. For multi-MB transcripts the old "read
          // whole file" approach was wasteful. We read the last 256 KiB and
          // grow if needed.
          const model = readModelFromTail(jsonl)
          if (model) {
            _detectedModel = model
            return model
          }
        }
      }
    } catch { /* fall through to default */ }
  }

  _detectedModel = FALLBACK_MODEL
  return FALLBACK_MODEL
}

export interface ImageBlock {
  type: "image"
  source: { type: "base64"; media_type: string; data: string }
}

export interface TextBlock {
  type: "text"
  text: string
}

export type ContentBlock = ImageBlock | TextBlock

export interface CountTokensResult {
  input_tokens: number
}

export function hasAnthropicKey(): boolean {
  return !!credGet("dev.lumiere-anthropic-api-key")
}

export async function countTokens(
  content: ContentBlock[],
  opts: { model?: string; signal?: AbortSignal } = {},
): Promise<CountTokensResult> {
  const key = credGet("dev.lumiere-anthropic-api-key")
  if (!key) {
    throw new Error(
      "Anthropic API key not found. Set it via:\n" +
      "  security add-generic-password -a lumiere -s dev.lumiere-anthropic-api-key -w 'sk-ant-...'\n" +
      "Or set LUMIERE_ANTHROPIC_API_KEY env var. The key is only used for the free /v1/messages/count_tokens endpoint.",
    )
  }

  const model = opts.model ?? detectCurrentModel()
  const body = JSON.stringify({
    model,
    messages: [{ role: "user", content }],
  })

  const res = await fetch(COUNT_TOKENS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "anthropic-version": ANTHROPIC_VERSION,
      "x-api-key": key,
    },
    body,
    signal: opts.signal,
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`count_tokens HTTP ${res.status}: ${text.slice(0, 300)}`)
  }

  const json = await res.json() as CountTokensResult
  if (typeof json.input_tokens !== "number") {
    throw new Error(`count_tokens returned unexpected shape: ${JSON.stringify(json).slice(0, 200)}`)
  }
  return json
}

// MCP cap heuristic. CC's MCP per-call cap counts the RAW response text tokens
// (including base64 strings of images). count_tokens with structured image
// blocks does NOT match this metric (it returns image visual tokens). This
// heuristic counts base64 chars as ~1 token per 3.5 chars + per-frame text
// overhead. Empirically calibrated to within ~25% of CC's truncation point.
export function estimateMcpCapTokens(opts: {
  imageChars: number
  frameCount: number
  textOverheadChars: number
}): number {
  const perFrameTextOverhead = 50  // "### Frame at HH:MM:SS.SSS\n" + JSON wrapping
  return Math.ceil(opts.imageChars / 3.5)
    + opts.frameCount * perFrameTextOverhead
    + Math.ceil(opts.textOverheadChars / 4)
}
