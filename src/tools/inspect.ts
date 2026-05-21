import { z } from "zod"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { extractFrames, getVideoMetadata, frameFormatMimeType } from "../extractors/frames.js"
import { resolveVideoInputDetailed } from "../utils/video-source.js"
import { formatHMSPrecise } from "../utils/timestamps.js"
import { loadConfig } from "../config.js"
import {
  AUTOCOMPACT_THRESHOLD,
  currentMcpCap,
  estimateAllTiers,
  MODE_RESOLUTION,
  type CostEstimate,
} from "../defaults.js"
import type { WatchMode } from "../types.js"
import { countTokens, hasAnthropicKey, detectCurrentModel, type ContentBlock } from "../utils/count-tokens.js"

function pickRecommendation(tiers: Record<WatchMode, CostEstimate>, current: WatchMode): {
  recommended_mode: WatchMode
  reason: string
} {
  if (!tiers[current].will_trigger_autocompact_thorough) {
    return {
      recommended_mode: current,
      reason: `current default \`${current}\` fits without autocompact at thorough coverage (${tiers[current].chunks_for_full_coverage_thorough} chunks, ${tiers[current].pct_of_1m_window_thorough}% of 1M window)`,
    }
  }
  // When current overflows, walk DOWN from current (not from max). Max has the
  // densest per-frame cost AND the most chunks (highest tier = more chunks per
  // the tier-chunking rule), so it's strictly heavier than current — never the
  // right downgrade. The order below is current → cheaper tiers, low last.
  const downgradePath: Record<WatchMode, WatchMode[]> = {
    max: ["high", "mid", "low"],
    high: ["mid", "low"],
    mid: ["low"],
    low: [],
  }
  for (const m of downgradePath[current]) {
    if (!tiers[m].will_trigger_autocompact_thorough) {
      return {
        recommended_mode: m,
        reason: `current default \`${current}\` thorough coverage would trigger autocompact (${tiers[current].chunks_for_full_coverage_thorough} chunks × ${tiers[current].conversation_tokens_per_call} conv tokens = ${tiers[current].pct_of_1m_window_thorough}% of 1M); \`${m}\` fits (${tiers[m].chunks_for_full_coverage_thorough} chunks, ${tiers[m].pct_of_1m_window_thorough}%)`,
      }
    }
  }
  return {
    recommended_mode: "low",
    reason: "even `low` tier thorough coverage exceeds autocompact threshold; analyze only a portion of the video (start_time/end_time) or run /compact before watch",
  }
}

// Probe one frame per tier and call /v1/messages/count_tokens to get the
// exact per-tier conversation tokens. Falls back silently on any error so
// inspect always returns a usable result. ~150-300ms × 4 = 1-2s added when
// the key is set and exact_tokens=true.
async function probeExactConversationTokensPerTier(
  videoPath: string,
  durationSeconds: number,
  model?: string,
): Promise<Partial<Record<WatchMode, number>>> {
  const result: Partial<Record<WatchMode, number>> = {}
  const probeAt = Math.max(0.0, Math.min(durationSeconds - 0.05, durationSeconds / 2))
  const probeStartHms = formatHMSPrecise(probeAt, 3)
  const probeEndHms = formatHMSPrecise(Math.min(durationSeconds, probeAt + 1), 3)

  await Promise.all((Object.keys(MODE_RESOLUTION) as WatchMode[]).map(async (mode) => {
    const dir = join(tmpdir(), `lumiere-inspect-probe-${mode}-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    try {
      const frames = await extractFrames(videoPath, {
        fps: 1,
        resolution: MODE_RESOLUTION[mode],
        outputDir: dir,
        format: "jpeg",
        startTime: probeStartHms,
        endTime: probeEndHms,
        maxFrames: 1,
      })
      if (frames.length === 0 || !frames[0].image) return
      const mediaType = frameFormatMimeType("jpeg")
      const fullContent: ContentBlock[] = [
        { type: "text", text: `### Frame at ${frames[0].timestamp}` },
        { type: "image", source: { type: "base64", media_type: mediaType, data: frames[0].image } },
      ]
      const textOnlyContent: ContentBlock[] = [{ type: "text", text: `### Frame at ${frames[0].timestamp}` }]
      const [full, textOnly] = await Promise.all([
        countTokens(fullContent, { model }),
        countTokens(textOnlyContent, { model }),
      ])
      result[mode] = Math.max(1, full.input_tokens - textOnly.input_tokens)
    } catch {
      // probe failure is non-fatal; this tier just keeps the heuristic value
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }))

  return result
}

export function registerInspect(server: McpServer): void {
  server.tool(
    "inspect",
    "Get metadata about a video (local file path or URL: YouTube, X/Twitter, Vimeo, direct mp4, etc.) without processing it. Returns duration, resolution, codec, fps, audio presence. Also returns per-tier context-cost estimate so the caller knows how much context the next watch() call will burn, plus a recommended tier and an autocompact warning if applicable. Routes through yt-dlp for URLs. Pass `exact_tokens=true` to extract one probe frame per tier and call Anthropic's /v1/messages/count_tokens for exact conversation-token estimates (requires LUMIERE_ANTHROPIC_API_KEY; adds ~1-2s).",
    {
      path: z.string().describe("Local path or any URL supported by yt-dlp"),
      exact_tokens: z.boolean().optional().describe("When true + LUMIERE_ANTHROPIC_API_KEY is set, probe one frame per tier and call count_tokens for exact conversation-token-per-frame estimates. Replaces the Anthropic image-formula heuristic for that call. Adds ~1-2s extraction + 4 token-count requests."),
      model: z.string().optional().describe("Anthropic model id for exact token counting (defaults to auto-detect from CC session)."),
    },
    async ({ path, exact_tokens, model }) => {
      const resolved = await resolveVideoInputDetailed(path)
      const metadata = await getVideoMetadata(resolved.path)
      const config = loadConfig()

      let exactTokensPerFrame: Partial<Record<WatchMode, number>> = {}
      let tokenSourceNote = "heuristic (Anthropic image formula min(1568, w*h/750))"
      if (exact_tokens && hasAnthropicKey()) {
        exactTokensPerFrame = await probeExactConversationTokensPerTier(resolved.path, metadata.duration_seconds, model)
        if (Object.keys(exactTokensPerFrame).length > 0) {
          tokenSourceNote = `exact (count_tokens via ${model ?? detectCurrentModel()})`
        }
      } else if (exact_tokens && !hasAnthropicKey()) {
        tokenSourceNote = "heuristic (exact_tokens requested but LUMIERE_ANTHROPIC_API_KEY not set; falling back)"
      }

      const tiers = estimateAllTiers(metadata.duration_seconds, {
        video_width: metadata.width,
        video_height: metadata.height,
        exact_conversation_tokens_per_frame: exactTokensPerFrame,
      })
      const { recommended_mode, reason } = pickRecommendation(tiers, config.default_mode)
      const cost_estimate = {
        note: "Per-tier context-burn forecast for `watch()`. (a) `view_sample_cap` = frames per chunk. (b) `mcp_tokens_per_*` (chars/3.5 transport metric) predicts per-call MCP truncation. (c) `conversation_tokens_per_*` (Anthropic image formula or exact count_tokens) predicts whole-transcript autocompact. (d) `pct_of_1m_window_thorough` + `will_trigger_autocompact_thorough` reason from conversation tokens, not MCP. (e) Higher tier = more chunks = more burn = more captured. For exact, model-aware token counts on a specific watch call, use `measure()`. v0.10.3 separates MCP cap forecasting from conversation-token forecasting (the v0.10.2 conflation over-warned autocompact at high resolution).",
        conversation_tokens_source: tokenSourceNote,
        current_default_mode: config.default_mode,
        recommended_mode,
        recommendation_reason: reason,
        mcp_output_cap_per_call: currentMcpCap(),
        autocompact_threshold_tokens: AUTOCOMPACT_THRESHOLD,
        per_tier: tiers,
      }
      const output = resolved.source
        ? { source: resolved.source, metadata, cost_estimate }
        : { metadata, cost_estimate }
      return { content: [{ type: "text", text: JSON.stringify(output, null, 2) }] }
    },
  )
}
