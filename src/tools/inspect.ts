import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { getVideoMetadata } from "../extractors/frames.js"
import { resolveVideoInputDetailed } from "../utils/video-source.js"
import { loadConfig } from "../config.js"
import {
  AUTOCOMPACT_THRESHOLD,
  currentMcpCap,
  estimateAllTiers,
  type CostEstimate,
} from "../defaults.js"
import type { WatchMode } from "../types.js"

function pickRecommendation(tiers: Record<WatchMode, CostEstimate>, current: WatchMode): {
  recommended_mode: WatchMode
  reason: string
} {
  // Recommendation considers thorough coverage (the skill's default workflow),
  // not the legacy single-call view. If thorough-coverage at current tier fits
  // under autocompact, recommend the current tier.
  if (!tiers[current].will_trigger_autocompact_thorough) {
    return {
      recommended_mode: current,
      reason: `current default \`${current}\` fits without autocompact at thorough coverage (${tiers[current].chunks_for_full_coverage_thorough} chunks, ${tiers[current].pct_of_1m_window_thorough}% of 1M window)`,
    }
  }
  // Otherwise, walk down tiers until we find one that fits at thorough coverage.
  const order: WatchMode[] = ["max", "high", "mid", "low"]
  for (const m of order) {
    if (!tiers[m].will_trigger_autocompact_thorough) {
      return {
        recommended_mode: m,
        reason: `current default \`${current}\` thorough coverage would trigger autocompact (${tiers[current].chunks_for_full_coverage_thorough} chunks × ${tiers[current].est_tokens_per_call} = ${tiers[current].pct_of_1m_window_thorough}% of 1M); \`${m}\` fits (${tiers[m].chunks_for_full_coverage_thorough} chunks, ${tiers[m].pct_of_1m_window_thorough}%)`,
      }
    }
  }
  return {
    recommended_mode: "low",
    reason: "even `low` tier thorough coverage exceeds autocompact threshold; analyze only a portion of the video (start_time/end_time) or run /compact before watch",
  }
}

export function registerInspect(server: McpServer): void {
  server.tool(
    "inspect",
    "Get metadata about a video (local file path or URL: YouTube, X/Twitter, Vimeo, direct mp4, etc.) without processing it. Returns duration, resolution, codec, fps, audio presence. Also returns per-tier context-cost estimate so the caller knows how much context the next watch() call will burn, plus a recommended tier and an autocompact warning if applicable. Routes through yt-dlp for URLs.",
    { path: z.string().describe("Local path or any URL supported by yt-dlp") },
    async ({ path }) => {
      const resolved = await resolveVideoInputDetailed(path)
      const metadata = await getVideoMetadata(resolved.path)
      const config = loadConfig()
      const tiers = estimateAllTiers(metadata.duration_seconds)
      const { recommended_mode, reason } = pickRecommendation(tiers, config.default_mode)
      const cost_estimate = {
        note: "Per-tier context-burn forecast for `watch()`. Reads: (a) `view_sample_cap` = frames per chunk at this tier. (b) `chunks_for_full_coverage_thorough` = sequential chunks needed for full-video coverage at target_fps=1.0. (c) `est_total_tokens_thorough` = total burn across all chunks. (d) `pct_of_1m_window_thorough` = share of the 1M context window. (e) `will_trigger_autocompact_thorough` = whether full thorough coverage exceeds the 813K autocompact threshold. Higher tier = more chunks = more burn = more captured. For exact, model-aware token counts on a specific watch call, use `measure()`. v0.10.2 removed the legacy single-call fields (chunks_for_full_coverage / est_total_tokens_full_coverage / pct_of_1m_window) which were misleading after tier-aware extraction fps shipped.",
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
