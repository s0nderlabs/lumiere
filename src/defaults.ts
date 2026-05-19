import type { Config, FrameFormat, WatchMode } from "./types.js"

// Mode preset → resolution mapping. Auto-budget picks view_sample from resolution.
// At 100K MCP cap: low=600 frames, mid=350, high=120, max=50.
export const MODE_RESOLUTION: Record<WatchMode, number> = {
  low: 384,
  mid: 512,
  high: 1024,
  max: 1536,
}

// Empirically validated defaults from May 18-19 2026 testing rounds.
// See ~/.claude/projects/-Users-alkautsar-Documents-s0nderlabs-lumiere/memory/perception-redesign.md
// Default resolution promoted to 1024 ("maximum tier") on 2026-05-19 after blind perception test
// proved 1024 surgical detail is what callers actually want by default.
// At 1024 auto-budget caps view_sample at 30; for full-video coverage chunk into multiple calls.
export const DEFAULTS = {
  frame_resolution: 1024,
  frame_format: "jpeg" as FrameFormat,
  whisper_engine: "cpp" as const,
  whisper_at: false,
  enable_index: true,
  max_frames: 1000,
  session_max_age_days: 7,
  downloads_max_age_days: 7,
  audio_chunk_trigger_seconds: 1200,
  audio_chunk_size_seconds: 600,
  audio_chunk_overlap_seconds: 0,
  audio_max_output_tokens: 65536,
  audio_model: "gemini-3-flash-preview",
  low_confidence_lufs_threshold: -30,
}

export const DEFAULT_CONFIG: Config = {
  backend: "local",
  whisper_model: "auto",
  default_mode: "high",
}

// Safe view_sample table by resolution. Two empirical tables (per MAX_MCP_OUTPUT_TOKENS).
// 50K table from T8 testing (May 18 2026). 100K table from push-bisect testing (May 19 2026).
// For other caps, scale linearly off the 50K table with the same conservative margin.
const SAFE_AT_50K: Record<number, number> = {
  384: 200,
  512: 150,
  768: 75,
  1024: 30,
  1536: 20,
}

// v0.6 calibration against empirical 4-tier MCP test (2026-05-19). Budget is
// view_sample such that (view_sample * TPF + 8000) * 1.25 stays under 100K
// (so cost_estimate predicts under cap before runtime trim activates).
//   384: 38 * 1900 + 8000 = 80.2K, * 1.25 = 100K (at the wire)
//   512: 28 * 2600 + 8000 = 80.8K, * 1.25 = 101K (close, dropped to 27)
//   768: 17 * 4200 + 8000 = 79.4K, * 1.25 = 99.25K
//   1024: 12 * 6200 + 8000 = 82.4K, * 1.25 = 103K (dropped to 11)
//   1536: 7 * 11000 + 8000 = 85K, * 1.25 = 106K (dropped to 6)
const SAFE_AT_100K: Record<number, number> = {
  384: 38,
  512: 27,
  768: 16,
  1024: 11,
  1536: 6,
}

// Per-frame token cost. Calibrated 2026-05-19 against actual MCP responses
// from a 4-tier verification harness against /tmp/lumiere-low/source.mp4
// (V1 ClaudeDevs /goal, 24s, action-heavy first 5s, static UI 5-20, action
// 20-24). Numbers below match observed image_chars / 3.5 per delivered frame
// after the runtime trim. The runtime trim is the actual safety net; this
// table is the forecast inspect() shows.
export const TOKENS_PER_FRAME: Record<number, number> = {
  384: 1900,
  512: 2600,
  768: 4200,
  1024: 6200,
  1536: 11000,
}

// Static per-call overhead (tool invocation, metadata blocks, audio analysis).
// v0.6 bump: when adaptive_sampling + narrative_mode + roi=auto stack, the
// response carries: budget block with per-segment summary (~2K), NARRATIVE_GUIDANCE
// (~4K), palette outlier hint (~1K), continuity audit block (~1K), per-frame
// timestamp headers (~50 bytes/frame), audio block (~3K), manifest summary (~1K).
// v0.5 set this to 4000 which still undercounted by 25-30% in 4-tier blind retest
// (low/mid/high/max ALL truncated mid-stream). v0.6 bumps to 8000 + safety margin
// to 1.25 (was 1.15) so the estimator's "fits" verdict actually fits.
export const STATIC_TOKENS_PER_CALL = 8000
export const COST_ESTIMATE_SAFETY_MARGIN = 1.25  // 25% above raw token count

// Reference: Claude Code 1M context auto-compacts around ~813K (~81%).
// Callers should warn the user before submitting a watch plan that exceeds this.
export const AUTOCOMPACT_THRESHOLD = 813000

function envCap(): number {
  const raw = process.env.MAX_MCP_OUTPUT_TOKENS
  if (!raw) return 50000
  const n = parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0) return 50000
  return n
}

const CAP = envCap()

function pickFromTable(table: Record<number, number>, resolution: number): number {
  if (resolution <= 384) return table[384]
  if (resolution <= 512) return table[512]
  if (resolution <= 768) return table[768]
  if (resolution <= 1024) return table[1024]
  return table[1536]
}

export function autoBudgetViewSample(resolution: number): number {
  if (CAP >= 100000) return pickFromTable(SAFE_AT_100K, resolution)
  if (CAP === 50000) return pickFromTable(SAFE_AT_50K, resolution)
  // Other caps: scale from 50K table linearly with conservative floor.
  const base = pickFromTable(SAFE_AT_50K, resolution)
  return Math.max(1, Math.floor(base * (CAP / 50000)))
}

export function currentMcpCap(): number {
  return CAP
}

// Auto-fps ladder for long videos with no view_sample given. Returns conservative
// fps for the duration tier so the watch call doesn't extract more frames than the
// view_sample cap will keep.
export function calculateAutoFps(durationSeconds: number): number {
  if (durationSeconds < 60) return 2
  if (durationSeconds < 300) return 1
  if (durationSeconds < 900) return 0.5
  if (durationSeconds < 3600) return 0.2
  return 0.1
}

// SHARED fps derivation logic. Both watch.ts (at runtime) and estimateWatchCost (at
// preview time) call this. Before v0.4 these diverged: inspect's cost preview used
// calculateAutoFps in isolation (fps=2 for short videos) while watch used the
// view_sample-driven path (fps = view_sample / duration). For a 24s clip at low,
// that's a 12.5x undercount. v0.4 unifies them.
//
// Rule (matches deriveFps in watch.ts):
//   - If view_sample is set AND fps is "auto"/undefined → fps = view_sample / duration
//   - If fps is explicit → fps stays
//   - Else → calculateAutoFps(duration)
export function deriveFpsForBudget(opts: {
  fps?: number
  view_sample: number | undefined
  duration_seconds: number
}): number {
  if (opts.fps !== undefined) return opts.fps
  if (opts.view_sample && opts.duration_seconds > 0) {
    return opts.view_sample / opts.duration_seconds
  }
  return calculateAutoFps(opts.duration_seconds)
}

function tokensPerFrame(resolution: number): number {
  return pickFromTable(TOKENS_PER_FRAME, resolution)
}

export interface CostEstimate {
  mode: WatchMode | "custom"
  resolution: number
  fps: number
  view_sample_cap: number
  duration_seconds: number
  ffmpeg_frames_extracted: number
  frames_returned_per_chunk: number
  est_tokens_per_frame: number
  est_tokens_per_call: number
  exceeds_mcp_cap_per_call: boolean
  chunks_for_full_coverage: number
  est_total_tokens_full_coverage: number
  pct_of_1m_window: number
  will_trigger_autocompact: boolean
}

// Pure cost estimator. v0.4 parity fix: uses the SAME fps derivation as watch.ts so
// inspect's preview matches what the watch tool actually does at runtime. Also
// reports exceeds_mcp_cap_per_call so callers can see when a single chunk would
// truncate, even if duration-based chunk math says "1 chunk."
export function estimateWatchCost(opts: {
  mode?: WatchMode
  resolution?: number
  fps?: number
  view_sample?: number
  duration_seconds: number
}): CostEstimate {
  const resolution = opts.resolution ?? (opts.mode ? MODE_RESOLUTION[opts.mode] : MODE_RESOLUTION.high)
  const view_sample_cap = opts.view_sample ?? autoBudgetViewSample(resolution)
  const fps = deriveFpsForBudget({
    fps: opts.fps,
    view_sample: view_sample_cap,
    duration_seconds: opts.duration_seconds,
  })
  const ffmpeg_frames = Math.max(1, Math.round(fps * opts.duration_seconds))
  const frames_returned = Math.min(ffmpeg_frames, view_sample_cap)
  const tpf = tokensPerFrame(resolution)
  // v0.5: apply safety margin to account for unpredictable overhead variance.
  const est_per_call = Math.round((frames_returned * tpf + STATIC_TOKENS_PER_CALL) * COST_ESTIMATE_SAFETY_MARGIN)

  // If a single chunk exceeds the MCP per-call cap, we need to split by TIME so each
  // chunk's response stays under the cap. Otherwise the time-based chunking is:
  // chunk_duration = view_sample_cap / fps, then ceil(duration / chunk_duration).
  const exceeds_cap = est_per_call > CAP
  let chunks_needed: number
  if (exceeds_cap) {
    chunks_needed = Math.max(1, Math.ceil(est_per_call / CAP))
  } else {
    const chunk_seconds = view_sample_cap / fps
    chunks_needed = Math.max(1, Math.ceil(opts.duration_seconds / chunk_seconds))
  }
  const total_tokens = est_per_call * chunks_needed
  const pct = (total_tokens / 1_000_000) * 100

  return {
    mode: opts.mode ?? "custom",
    resolution,
    fps,
    view_sample_cap,
    duration_seconds: opts.duration_seconds,
    ffmpeg_frames_extracted: ffmpeg_frames,
    frames_returned_per_chunk: frames_returned,
    est_tokens_per_frame: tpf,
    est_tokens_per_call: est_per_call,
    exceeds_mcp_cap_per_call: exceeds_cap,
    chunks_for_full_coverage: chunks_needed,
    est_total_tokens_full_coverage: total_tokens,
    pct_of_1m_window: Math.round(pct * 10) / 10,
    will_trigger_autocompact: total_tokens >= AUTOCOMPACT_THRESHOLD,
  }
}

// Convenience: estimate all 4 preset tiers in one shot. inspect() returns this
// so the caller can compare tiers and choose without doing arithmetic.
export function estimateAllTiers(duration_seconds: number): Record<WatchMode, CostEstimate> {
  const result = {} as Record<WatchMode, CostEstimate>
  for (const mode of ["low", "mid", "high", "max"] as WatchMode[]) {
    result[mode] = estimateWatchCost({ mode, duration_seconds })
  }
  return result
}
