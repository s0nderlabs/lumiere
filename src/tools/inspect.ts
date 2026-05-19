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
  // If the current default fits without triggering autocompact, recommend it.
  if (!tiers[current].will_trigger_autocompact) {
    return { recommended_mode: current, reason: `current default \`${current}\` fits without autocompact (${tiers[current].pct_of_1m_window}% of 1M window for full coverage)` }
  }
  // Otherwise, walk down tiers until we find one that fits.
  const order: WatchMode[] = ["max", "high", "mid", "low"]
  for (const m of order) {
    if (!tiers[m].will_trigger_autocompact) {
      return { recommended_mode: m, reason: `current default \`${current}\` would trigger autocompact (${tiers[current].pct_of_1m_window}% of 1M); \`${m}\` fits (${tiers[m].pct_of_1m_window}%)` }
    }
  }
  return { recommended_mode: "low", reason: "even \`low\` tier exceeds autocompact threshold; consider analyzing only a portion of the video or running /compact before watch" }
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
        note: "Estimated context burn for `watch()` per tier, for a full-video coverage pass (multiple chunks at the cap). Per-call cost is `est_tokens_per_call`; multiply by `chunks_for_full_coverage` for the total in `est_total_tokens_full_coverage`. Values are token approximations from 2026-05-19 empirical calibration. `pct_of_1m_window` is what fraction of a fresh 1M-context CC session this pass would consume.",
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
