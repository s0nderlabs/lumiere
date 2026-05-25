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
// Budget block (~2K), NARRATIVE_GUIDANCE (~1K), per-frame timestamp headers
// (~50 bytes/frame), audio block (~3K), manifest summary (~1K). Empirically
// calibrated against the 2026-05-19 4-tier blind retest where a 4000-byte
// estimate undercounted by 25-30% and truncated every tier.
export const STATIC_TOKENS_PER_CALL = 8000
export const COST_ESTIMATE_SAFETY_MARGIN = 1.25  // 25% above raw token count

// Reference: Claude Code 1M context auto-compacts around ~813K (~81%).
// Callers should warn the user before submitting a watch plan that exceeds this.
export const AUTOCOMPACT_THRESHOLD = 813000

// Per-tier temporal density for thorough coverage. Higher tier = more calls.
// Max matches high's fps (6.0) at higher resolution (1536 vs 1024).
//   low  (cap=25) = 1.5 fps, chunk ~17s,  ~2 calls for 24s
//   mid  (cap=17) = 3.0 fps, chunk ~6s,   ~5 calls for 24s
//   high (cap=4)  = 6.0 fps, chunk ~0.7s, ~37 calls for 24s
//   max  (cap=2)  = 6.0 fps, chunk ~0.3s, ~73 calls for 24s
export function targetFpsThorough(resolution: number): number {
  if (resolution <= 384) return 1.5
  if (resolution <= 512) return 3.0
  return 6.0
}

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

// Anthropic image visual tokens for a scaled frame. ceil(w*h/750) per the
// docs; matches Opus 4.7's tokenizer within ~5% across 384-1536 px square
// content (validated 2026-05-21 against count_tokens). The 1568 "cap" cited
// in older docs only kicks in for images above the model's max processable
// resolution (~8000x8000); our tier outputs are well below that and the cap
// would under-predict. When count_tokens runs over a real frame we use that
// exact value instead; this is the fallback when no key is set.
const IMAGE_TOKEN_DIVISOR = 750

export function conversationTokensPerFrame(opts: {
  resolution: number
  videoWidth?: number
  videoHeight?: number
}): number {
  const scaledW = opts.resolution
  let scaledH: number
  if (opts.videoWidth && opts.videoHeight && opts.videoWidth > 0) {
    scaledH = Math.round(opts.resolution * (opts.videoHeight / opts.videoWidth))
  } else {
    // 16:9 default; the only consumer without metadata is "custom" mode in
    // direct estimateWatchCost calls.
    scaledH = Math.round(opts.resolution * 9 / 16)
  }
  return Math.ceil((scaledW * scaledH) / IMAGE_TOKEN_DIVISOR)
}

export type ConversationTokensSource = "heuristic_image_formula" | "exact_count_tokens"

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
  // MCP transport (chars/3.5) — predicts per-call truncation against the
  // MAX_MCP_OUTPUT_TOKENS cap. Distinct from conversation tokens; never
  // compared against the 813K autocompact threshold.
  mcp_tokens_per_frame: number
  mcp_tokens_per_call: number
  exceeds_mcp_cap_per_call: boolean
  // Conversation tokens — what Claude actually sees as input. Drives the
  // pct_of_1m_window + autocompact projection. Either the Anthropic image
  // formula (cheap heuristic) or an exact count_tokens probe per tier.
  conversation_tokens_per_frame: number
  conversation_tokens_per_call: number
  conversation_tokens_source: ConversationTokensSource
  // Thorough coverage: full-video coverage at per-tier fps so each tier
  // delivers its spatial density x temporal density. Higher tier = more
  // chunks because view_sample_cap shrinks with resolution.
  target_fps_thorough: number
  chunk_duration_thorough_seconds: number
  chunks_for_full_coverage_thorough: number
  mcp_total_tokens_thorough: number
  conversation_total_tokens_thorough: number
  pct_of_1m_window_thorough: number
  will_trigger_autocompact_thorough: boolean
}

// Pure cost estimator. Uses the SAME fps derivation as watch.ts (via
// deriveFpsForBudget) so inspect's preview matches what watch will actually
// do at runtime. Reports MCP-cap and conversation-token metrics separately
// since they track different limits (per-call MCP truncation vs whole-
// transcript autocompact).
export function estimateWatchCost(opts: {
  mode?: WatchMode
  resolution?: number
  fps?: number
  view_sample?: number
  duration_seconds: number
  video_width?: number
  video_height?: number
  exact_conversation_tokens_per_frame?: number
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
  const tpf_mcp = tokensPerFrame(resolution)
  const mcp_per_call = Math.round((frames_returned * tpf_mcp + STATIC_TOKENS_PER_CALL) * COST_ESTIMATE_SAFETY_MARGIN)

  const conversation_source: ConversationTokensSource = opts.exact_conversation_tokens_per_frame !== undefined
    ? "exact_count_tokens"
    : "heuristic_image_formula"
  const tpf_conversation = opts.exact_conversation_tokens_per_frame ?? conversationTokensPerFrame({
    resolution,
    videoWidth: opts.video_width,
    videoHeight: opts.video_height,
  })
  // Static per-call conversation overhead: the budget block + narrative
  // guidance + manifest summary + audio block + per-frame headers add ~3K
  // conversation tokens on top of image tokens. Calibrated against measure()
  // text-only count_tokens results from v0.10.2 testing.
  const STATIC_CONVERSATION_TOKENS = 3000
  const conv_per_call = frames_returned * tpf_conversation + STATIC_CONVERSATION_TOKENS

  const exceeds_cap = mcp_per_call > CAP

  const target_fps = targetFpsThorough(resolution)
  const chunk_duration_thorough = view_sample_cap / target_fps
  const chunks_thorough = Math.max(1, Math.ceil(opts.duration_seconds / chunk_duration_thorough))
  const mcp_total_thorough = mcp_per_call * chunks_thorough
  const conv_total_thorough = conv_per_call * chunks_thorough
  const pct_thorough = (conv_total_thorough / 1_000_000) * 100

  return {
    mode: opts.mode ?? "custom",
    resolution,
    fps,
    view_sample_cap,
    duration_seconds: opts.duration_seconds,
    ffmpeg_frames_extracted: ffmpeg_frames,
    frames_returned_per_chunk: frames_returned,
    mcp_tokens_per_frame: tpf_mcp,
    mcp_tokens_per_call: mcp_per_call,
    exceeds_mcp_cap_per_call: exceeds_cap,
    conversation_tokens_per_frame: tpf_conversation,
    conversation_tokens_per_call: conv_per_call,
    conversation_tokens_source: conversation_source,
    target_fps_thorough: target_fps,
    chunk_duration_thorough_seconds: Math.round(chunk_duration_thorough * 10) / 10,
    chunks_for_full_coverage_thorough: chunks_thorough,
    mcp_total_tokens_thorough: mcp_total_thorough,
    conversation_total_tokens_thorough: conv_total_thorough,
    pct_of_1m_window_thorough: Math.round(pct_thorough * 10) / 10,
    will_trigger_autocompact_thorough: conv_total_thorough >= AUTOCOMPACT_THRESHOLD,
  }
}

// Convenience: estimate all 4 preset tiers in one shot. Optionally takes
// metadata (for heuristic image-token sizing) and per-tier exact conversation
// tokens (when inspect calls count_tokens). inspect() returns this so the
// caller can compare tiers and choose without doing arithmetic.
export function estimateAllTiers(
  duration_seconds: number,
  opts?: {
    video_width?: number
    video_height?: number
    exact_conversation_tokens_per_frame?: Partial<Record<WatchMode, number>>
  },
): Record<WatchMode, CostEstimate> {
  const result = {} as Record<WatchMode, CostEstimate>
  for (const mode of ["low", "mid", "high", "max"] as WatchMode[]) {
    result[mode] = estimateWatchCost({
      mode,
      duration_seconds,
      video_width: opts?.video_width,
      video_height: opts?.video_height,
      exact_conversation_tokens_per_frame: opts?.exact_conversation_tokens_per_frame?.[mode],
    })
  }
  return result
}
