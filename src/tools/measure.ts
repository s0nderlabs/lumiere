import { z } from "zod"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import {
  DEFAULTS,
  autoBudgetViewSample,
  MODE_RESOLUTION,
} from "../defaults.js"
import { loadConfig, SESSIONS_DIR } from "../config.js"
import {
  getVideoMetadata,
  extractFrames,
  extractFramesBySegments,
  frameFormatMimeType,
} from "../extractors/frames.js"
import { resolveVideoInputDetailed } from "../utils/video-source.js"
import { getSessionDir, loadManifest } from "../session/manager.js"
import {
  countTokens,
  hasAnthropicKey,
  estimateMcpCapTokens,
  detectCurrentModel,
  type ContentBlock,
} from "../utils/count-tokens.js"
import { parseHMS } from "../utils/timestamps.js"
import {
  buildAdaptiveSegments,
  type AdaptiveSegment,
} from "../utils/adaptive-segments.js"
import { resolveRoi } from "../utils/roi.js"
import {
  decideAdaptive,
  decideNarrative,
  shouldAutoSuggestNarrative,
} from "../utils/decisions.js"
import type { SessionManifest, Segment, Frame } from "../types.js"

const HMS_REGEX = /^\d{2}:\d{2}:\d{2}$/

export function registerMeasure(server: McpServer): void {
  server.tool(
    "measure",
    "Measure the EXACT context-burn and MCP-cap impact of a `watch` call without actually delivering frames. Extracts frames, builds the would-be response, counts tokens via Anthropic's /v1/messages/count_tokens (free endpoint, requires LUMIERE_ANTHROPIC_API_KEY or keychain). Returns: conversation_tokens (what Claude will see as input tokens, exact for the chosen model), mcp_cap_tokens (heuristic estimate of CC's MCP per-call cap usage), frames_proposed, image_tokens, text_tokens, fits_in_mcp_cap, fits_in_context_window. Use BEFORE a high-stakes watch() call to know the exact cost. Same args as watch.",
    {
      path: z.string().describe("Local path or any URL supported by yt-dlp"),
      mode: z.enum(["low", "mid", "high", "max"]).optional(),
      resolution: z.coerce.number().min(128).max(2048).optional(),
      view_sample: z.number().min(1).optional(),
      start_time: z.string().regex(HMS_REGEX).optional(),
      end_time: z.string().regex(HMS_REGEX).optional(),
      narrative_mode: z.boolean().optional(),
      adaptive_sampling: z.boolean().optional(),
      roi: z.union([z.literal("auto"), z.string().regex(/^\d+,\d+,\d+,\d+$/)]).optional(),
      model: z.string().optional().describe("Anthropic model id for token counting. Defaults to auto-detect from the current CC session (reads CLAUDE_CODE_SESSION_ID transcript). Fallback claude-opus-4-7. Override per-call to compare tokenizers (e.g. claude-opus-4-6)."),
    },
    async (params) => {
      if (!hasAnthropicKey()) {
        return {
          content: [{
            type: "text",
            text: "## Error\nmeasure requires LUMIERE_ANTHROPIC_API_KEY. Set it via:\n```\nsecurity add-generic-password -a lumiere -s dev.lumiere-anthropic-api-key -w 'sk-ant-...'\n```\nOr export `LUMIERE_ANTHROPIC_API_KEY` in your shell. The key is only used for the free `/v1/messages/count_tokens` endpoint, no per-call charges.",
          }],
        }
      }

      const config = loadConfig()
      const resolution = params.resolution
        ?? (params.mode ? MODE_RESOLUTION[params.mode] : undefined)
        ?? MODE_RESOLUTION[config.default_mode]
        ?? DEFAULTS.frame_resolution

      const resolved = await resolveVideoInputDetailed(params.path)
      const safePath = resolved.path
      const metadata = await getVideoMetadata(safePath)

      const sessionDir = getSessionDir(SESSIONS_DIR, safePath)
      const manifest: SessionManifest | null = loadManifest(sessionDir)

      const effectiveViewSample = params.view_sample ?? autoBudgetViewSample(resolution)
      const roiCrop = resolveRoi(params.roi, manifest)

      // Precedence is shared with watch.ts via utils/decisions.ts so measure's
      // prediction matches what watch will actually do.
      const motionWindows = manifest?.analysis?.motion_windows ?? []
      const narrativeDecision = decideNarrative({
        param: params.narrative_mode,
        autoSuggest: shouldAutoSuggestNarrative(manifest, metadata.duration_seconds),
        configDefault: config.default_narrative_mode,
      })
      const useAdaptive = decideAdaptive({
        param: params.adaptive_sampling,
        narrativeOn: narrativeDecision.on,
        motionWindowCount: motionWindows.length,
        durationSec: metadata.duration_seconds,
        hasSegments: false,
        configDefault: config.default_adaptive_sampling,
      }).on

      const startSec = params.start_time ? parseHMS(params.start_time) : 0
      const endSec = params.end_time ? parseHMS(params.end_time) : metadata.duration_seconds
      const activeDur = Math.max(0.5, endSec - startSec)

      const workDir = join(tmpdir(), `lumiere-measure-${Date.now()}`)
      mkdirSync(workDir, { recursive: true })
      let extractedFrames: Frame[] = []
      let extractMode = "uniform"
      let adaptiveSegs: AdaptiveSegment[] = []
      try {
        if (useAdaptive && motionWindows.length > 0) {
          adaptiveSegs = buildAdaptiveSegments({
            motionWindows,
            startSec,
            endSec,
            totalBudget: effectiveViewSample,
          })
          extractMode = "adaptive"
          const segs: Segment[] = adaptiveSegs.map(s => ({ start: s.start, end: s.end, fps: s.fps, resolution }))
          extractedFrames = await extractFramesBySegments(safePath, segs, workDir, DEFAULTS.frame_format, roiCrop ?? undefined)
        } else {
          const fps = effectiveViewSample / activeDur
          extractedFrames = await extractFrames(safePath, {
            fps,
            resolution,
            outputDir: workDir,
            format: DEFAULTS.frame_format,
            startTime: params.start_time,
            endTime: params.end_time,
            maxFrames: DEFAULTS.max_frames,
            crop: roiCrop ?? undefined,
          })
        }

        // Limit to view_sample
        if (extractedFrames.length > effectiveViewSample) {
          const step = extractedFrames.length / effectiveViewSample
          const sampled: Frame[] = []
          for (let i = 0; i < effectiveViewSample; i++) {
            sampled.push(extractedFrames[Math.floor(i * step)])
          }
          extractedFrames = sampled
        }

        // Build text-only blocks once and reuse them as the basis for the
        // full (text+image) block array, avoiding a double iteration over frames.
        const textOnlyContent: ContentBlock[] = []
        for (const f of extractedFrames) {
          textOnlyContent.push({ type: "text", text: `### Frame at ${f.timestamp}` })
        }
        const mediaType = frameFormatMimeType(DEFAULTS.frame_format)
        const content: ContentBlock[] = []
        for (let i = 0; i < extractedFrames.length; i++) {
          content.push(textOnlyContent[i])
          const f = extractedFrames[i]
          if (f.image) {
            content.push({ type: "image", source: { type: "base64", media_type: mediaType, data: f.image } })
          }
        }

        const imageChars = extractedFrames.reduce((a, f) => a + (f.image?.length ?? 0), 0)
        // Typical caller-visible non-frame text: budget block + narrative
        // guidance + manifest + audio. Estimator is heuristic so this is
        // a calibrated constant, not a measurement.
        const textOverheadChars = 15000
        const mcpCapTokens = estimateMcpCapTokens({
          imageChars,
          frameCount: extractedFrames.length,
          textOverheadChars,
        })

        const MCP_CAP = parseInt(process.env.MAX_MCP_OUTPUT_TOKENS ?? "100000", 10)
        const CONTEXT_WINDOW = 1_000_000
        const AUTOCOMPACT_PCT = 81

        // Two count_tokens calls in parallel: full content for the exact total,
        // text-only so we can derive the image/text split (the endpoint gives
        // no breakdown).
        const [ct, textOnlyCt] = await Promise.all([
          countTokens(content, { model: params.model }),
          countTokens(textOnlyContent, { model: params.model }),
        ])
        const imageTokens = ct.input_tokens - textOnlyCt.input_tokens
        const textTokens = textOnlyCt.input_tokens

        const output = {
          ...(resolved.source ? { source: resolved.source } : {}),
          measurement: {
            model: params.model ?? detectCurrentModel(),
            method: extractMode,
            mode: params.mode ?? config.default_mode,
            resolution,
            roi: roiCrop ? `${roiCrop.x},${roiCrop.y},${roiCrop.w}x${roiCrop.h}` : "none",
            adaptive_segments: adaptiveSegs.length > 0 ? adaptiveSegs.map(s => ({
              range: `${s.start}-${s.end}`,
              kind: s.kind,
              intensity: s.intensity,
              budget_frames: s.budgetFrames,
              fps: Number(s.fps.toFixed(2)),
            })) : undefined,
            frames_proposed: extractedFrames.length,
            image_chars_total: imageChars,
            conversation_tokens_exact: ct.input_tokens,
            conversation_image_tokens: imageTokens,
            conversation_text_tokens: textTokens,
            avg_image_tokens_per_frame: extractedFrames.length > 0 ? Math.round(imageTokens / extractedFrames.length) : 0,
            mcp_cap_tokens_estimate: mcpCapTokens,
            mcp_cap_limit: MCP_CAP,
            fits_in_mcp_cap: mcpCapTokens < MCP_CAP,
            fits_in_context_window: ct.input_tokens < CONTEXT_WINDOW,
            pct_of_1m_window: Number(((ct.input_tokens / CONTEXT_WINDOW) * 100).toFixed(2)),
            would_trigger_autocompact: (ct.input_tokens / CONTEXT_WINDOW) * 100 >= AUTOCOMPACT_PCT,
          },
        }

        return { content: [{ type: "text", text: JSON.stringify(output, null, 2) }] }
      } finally {
        rmSync(workDir, { recursive: true, force: true })
      }
    },
  )
}
