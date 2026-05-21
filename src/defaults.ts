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

// Per-resolution view_sample cap. Keeps predicted (frames * TPF + overhead) *
// SAFETY_MARGIN under 100K and actual response under the 88K runtime safety
// threshold for the worst per-frame content density seen on dense
// terminal-UI videos.
//   384:  25 * 2700  + 8000 = 75.5K, * 1.25 = 94.4K
//   512:  17 * 3800  + 8000 = 72.6K, * 1.25 = 90.8K
//   768:  8  * 7000  + 8000 = 64K,   * 1.25 = 80K
//   1024: 4  * 11000 + 8000 = 52K,   * 1.25 = 65K
//   1536: 2  * 21000 + 8000 = 50K,   * 1.25 = 62.5K
const SAFE_AT_100K: Record<number, number> = {
  384: 25,
  512: 17,
  768: 8,
  1024: 4,
  1536: 2,
}

// Per-frame token cost (chars/3.5 metric for MCP transport cap). Recalibrated
// 2026-05-20 against actual_est_tokens values from the v0.10.1 fps calibration
// test on V2 (ClaudeDevs /goal, terminal UI + mascot, 24.1s).
//
// Measured per-frame chars/3.5 from post-trim watch responses:
//   low (384px):  ~2345 → 2700 with safety margin
//   mid (512px):  ~3331 → 3800
//   high (1024px): ~9775 → 11000
//   max (1536px): ~18800 → 21000
//
// Higher resolutions are more underestimated because dense UI text + sharp
// edges defeat JPEG compression efficiency. The numbers now exceed what
// runtime_trim measures, so trim becomes a true safety net (rarely fires).
export const TOKENS_PER_FRAME: Record<number, number> = {
  384: 2700,
  512: 3800,
  768: 7000,
  1024: 11000,
  1536: 21000,
}

// Static per-call overhead (tool invocation, metadata blocks, audio analysis).
// When adaptive_sampling + narrative_mode + roi=auto stack, the response
// carries: budget block with per-segment summary (~2K), NARRATIVE_GUIDANCE
// (~4K), palette outlier hint (~1K), continuity audit block (~1K), per-frame
// timestamp headers (~50 bytes/frame), audio block (~3K), manifest summary
// (~1K). Empirically calibrated against the 2026-05-19 4-tier blind retest
// where a 4000-byte estimate undercounted by 25-30% and truncated every tier.
export const STATIC_TOKENS_PER_CALL = 8000
export const COST_ESTIMATE_SAFETY_MARGIN = 1.25  // 25% above raw token count

// Reference: Claude Code 1M context auto-compacts around ~813K (~81%).
// Callers should warn the user before submitting a watch plan that exceeds this.
export const AUTOCOMPACT_THRESHOLD = 813000

// Target temporal density (frames per second of video) for thorough coverage.
// Anchored to the temporal density `low` tier naturally achieves on a 24s clip
// (38 frames / 24s ≈ 1.58fps). For thorough coverage at higher tiers, more
// chunks are needed because their view_sample cap is smaller. This is the
// "higher tier = more chunks = more burn = more captured" rule, validated
// 2026-05-19 against the 4-way ClaudeDevs /goal blind test:
//   low (cap=38) on 24s: 1 chunk × 100K = 100K total
//   mid (cap=27) on 24s: 1 chunk × 110K = 110K total
//   high (cap=11) on 24s: ~2-3 chunks × 95K = ~200K total
//   max (cap=6) on 24s: ~4-5 chunks × 92K = ~460K total
export const TARGET_FPS_THOROUGH = 1.0

// Tier-aware EXTRACTION fps (controls ffmpeg sampling density, distinct from
// delivered fps which is gated by view_sample). Higher tiers extract denser
// pools so adaptive_sampling has rich material to weight by motion windows.
// Anchored against the 2026-05-19 max-tier test: fps=12.5 extraction produced
// the 7-mascot-state + 13-hex-code recovery on V2 (ClaudeDevs /goal). Lower
// tiers scale geometrically (half the fps per step down) since they trade
// temporal density for cheaper per-frame cost.
//
// Note: extraction fps != delivered fps. With view_sample=6 at max on 24s,
// ffmpeg pulls 12.5 * 24 = 300 frames, view_sample subsamples to 6 evenly OR
// adaptive_sampling picks 6 weighted by motion windows. The dense pool is
// what makes adaptive_sampling's selection meaningful.
export function targetExtractionFps(resolution: number): number {
  if (resolution <= 384) return 1.5
  if (resolution <= 512) return 3.0
  if (resolution <= 1024) return 6.0
  return 12.5
}

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

// Shared fps derivation: watch.ts uses this at runtime and estimateWatchCost
// uses it at preview time so the two never diverge. Earlier versions diverged:
// inspect's preview called calculateAutoFps in isolation (fps=2 for short
// videos) while watch used the view_sample-driven path (fps = view_sample /
// duration). For a 24s clip at the `low` tier that was a 12.5x undercount.
//
// Rule (matches deriveFps in watch.ts):
//   - fps is explicit                              -> fps stays
//   - resolution known                             -> targetExtractionFps(resolution)
//   - view_sample set                              -> view_sample / duration (legacy)
//   - else                                         -> calculateAutoFps(duration)
// v0.10.1+: tier-aware extraction fps is the primary path so higher tiers get
// a rich extraction pool for adaptive_sampling selection.
export function deriveFpsForBudget(opts: {
  fps?: number
  view_sample: number | undefined
  duration_seconds: number
  resolution?: number
}): number {
  if (opts.fps !== undefined) return opts.fps
  if (opts.resolution !== undefined) {
    return targetExtractionFps(opts.resolution)
  }
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
  // Extraction fps (ffmpeg sampling rate). For non-segments calls this is the
  // tier-aware default from targetExtractionFps. The delivered fps after
  // view_sample subsampling is target_fps_thorough.
  fps: number
  view_sample_cap: number
  duration_seconds: number
  ffmpeg_frames_extracted: number
  frames_returned_per_chunk: number
  est_tokens_per_frame: number
  est_tokens_per_call: number
  exceeds_mcp_cap_per_call: boolean
  // Thorough coverage: full-video coverage at TARGET_FPS_THOROUGH so each tier
  // delivers its tier-specific spatial density × temporal density. Higher tier
  // = more chunks because view_sample_cap shrinks with resolution. This is the
  // canonical cost view; the v0.10.0-era "legacy single-call" fields were
  // removed in v0.10.2 because they were misleading after the tier-aware
  // extraction fps change.
  target_fps_thorough: number
  chunk_duration_thorough_seconds: number
  chunks_for_full_coverage_thorough: number
  est_total_tokens_thorough: number
  pct_of_1m_window_thorough: number
  will_trigger_autocompact_thorough: boolean
}

// Pure cost estimator. Uses the SAME fps derivation as watch.ts (via
// deriveFpsForBudget) so inspect's preview matches what watch will actually
// do at runtime. Also reports exceeds_mcp_cap_per_call so callers see when a
// single chunk would truncate, even if duration-based chunk math says "1 chunk".
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
    resolution,
  })
  const ffmpeg_frames = Math.max(1, Math.round(fps * opts.duration_seconds))
  const frames_returned = Math.min(ffmpeg_frames, view_sample_cap)
  const tpf = tokensPerFrame(resolution)
  // Safety margin accounts for unpredictable overhead variance per call.
  const est_per_call = Math.round((frames_returned * tpf + STATIC_TOKENS_PER_CALL) * COST_ESTIMATE_SAFETY_MARGIN)

  const exceeds_cap = est_per_call > CAP

  // Thorough coverage: anchored at TARGET_FPS_THOROUGH so each tier's chunks
  // cover view_sample_cap / TARGET_FPS_THOROUGH seconds of video at the tier's
  // spatial resolution. Higher tier = smaller chunks = more total burn.
  const chunk_duration_thorough = view_sample_cap / TARGET_FPS_THOROUGH
  const chunks_thorough = Math.max(1, Math.ceil(opts.duration_seconds / chunk_duration_thorough))
  const total_tokens_thorough = est_per_call * chunks_thorough
  const pct_thorough = (total_tokens_thorough / 1_000_000) * 100

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
    target_fps_thorough: TARGET_FPS_THOROUGH,
    chunk_duration_thorough_seconds: Math.round(chunk_duration_thorough * 10) / 10,
    chunks_for_full_coverage_thorough: chunks_thorough,
    est_total_tokens_thorough: total_tokens_thorough,
    pct_of_1m_window_thorough: Math.round(pct_thorough * 10) / 10,
    will_trigger_autocompact_thorough: total_tokens_thorough >= AUTOCOMPACT_THRESHOLD,
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
