export type Backend = "local" | "gemini-api" | "none"
export type WhisperModel = "tiny" | "base" | "small" | "medium" | "large-v3-turbo" | "large-v3" | "auto"
export type FrameFormat = "jpeg" | "png" | "webp"
export type WatchMode = "low" | "mid" | "high" | "max"

export interface Config {
  backend: Backend
  whisper_model: WhisperModel
  default_mode: WatchMode
  // v0.7.1: per-server defaults for narrative_mode and adaptive_sampling.
  // Undefined = use heuristics (auto-suggest from analyze data); true/false =
  // force on/off when the per-call param is unset. Precedence:
  //   1. explicit per-call param wins (true or false)
  //   2. auto-suggest fires (returns true based on motion/cuts/palette)
  //   3. server default_* setting (true/false)
  //   4. off
  default_narrative_mode?: boolean
  default_adaptive_sampling?: boolean
}

export interface VideoMetadata {
  duration: string
  duration_seconds: number
  resolution: string
  width: number
  height: number
  codec: string
  original_fps: number
  file_size: string
  has_audio: boolean
}

export interface Frame {
  timestamp: string
  image?: string
  format?: FrameFormat
  sourcePath?: string
}

export interface SegmentFrame extends Frame {
  resolution: number
}

export interface TranscriptionSegment {
  start: string
  end: string
  text: string
}

export interface AudioTag {
  start: string
  end: string
  tag: string
}

export interface ChunkWarning {
  chunk_index: number
  chunk_total: number
  time_range: string
  event: "retry" | "failed" | "hard_cut" | "loose_threshold"
  detail?: string
}

export interface AudioResult {
  backend: Backend | "youtube-captions"
  transcription: TranscriptionSegment[]
  audio_tags: AudioTag[]
  full_analysis: string | null
  transcription_source?: string
  transcription_source_detail?: string
  transcription_fallback_reason?: string
  low_confidence?: boolean
  warnings?: ChunkWarning[]
}

export interface SceneChange {
  time: string
  score: number
}

export interface Interval {
  start: string
  end: string
  duration: number
}

export interface FrameStats {
  timestamp: string
  si?: number
  ti?: number
  blur?: number
  brightness?: number
  saturation?: number
  u_chroma?: number  // v0.5: raw UAVG-128 chroma for hue-based novelty
  v_chroma?: number  // v0.5: raw VAVG-128 chroma
}

export interface AnalysisFilters {
  scene_changes: boolean
  black_intervals: boolean
  silence: boolean
  freeze: boolean
  motion: boolean
  blur: boolean
  exposure: boolean
  loudness: boolean
  transcription: boolean
}

export interface VideoAnalysis {
  scenes: SceneChange[]
  black_intervals: Interval[]
  silence_intervals: Interval[]
  freeze_intervals: Interval[]
  frame_stats: FrameStats[]
  loudness_summary?: { mean_lufs: number; range_lu: number }
  transcription?: TranscriptionSegment[]
  transcription_backend?: string
  transcription_low_confidence?: boolean
  transcription_low_confidence_reasons?: string[]
  audio_warnings?: ChunkWarning[]
  content_profile: string
  // v0.4: raw motion scores from siti so callers can see the numbers behind the label.
  motion_summary?: { siAvg?: number; tiAvg?: number }
  // v0.4: center-crop motion measurement that catches small-subject high-motion
  // (e.g. animated mascot inside a static card). Drives narrative_mode auto-suggest
  // when global motion is misleadingly low.
  subject_motion?: { siAvg?: number; tiAvg?: number }
  // v0.4: any-motion verdict combining global + subject-region siti. Used by
  // shouldAutoSuggestNarrative.
  has_motion?: boolean
  // v0.4: frames whose chroma/brightness is statistically far from the median.
  // Catches one-off color events (laser beams, projectiles, flashes) that lower
  // tiers can pattern-match to body parts. Empty array means no outliers detected.
  // v0.5 uses both magnitude (saturation/brightness) and hue (atan2) novelty.
  palette_outliers?: Array<{ timestamp: string; chroma_distance: number; brightness?: number; saturation?: number }>
  // v0.5: bbox of moving subject detected via tblend+cropdetect. v0.6 prefers
  // connected-component segmentation on the binary motion mask (returns the
  // tightest bbox of the dominant moving blob instead of the union-of-all-motion).
  // The `method` field indicates which detector produced the bbox.
  subject_bbox?: { x: number; y: number; w: number; h: number; frame_w: number; frame_h: number; area_pct: number; method?: "cc" | "cropdetect" | "cropdetect-fallback" }
  // v0.6: motion-dense time windows for adaptive frame sampling. Each window is
  // a contiguous interval where temporal motion (siti ti, 1s rolling mean) exceeds
  // the video's global median + 1.5 MAD. Used by watch's adaptive_sampling=true
  // mode to allocate the per-call frame budget non-uniformly: more frames inside
  // motion windows, fewer in static spans.
  motion_windows?: Array<{ start: string; end: string; intensity: number }>
}

export interface SessionManifest {
  video_hash: string
  video_path: string
  created_at: string
  resolutions: Record<string, { frames: Array<{ timestamp: string; file: string }> }>
  analysis?: VideoAnalysis
}

export interface Segment {
  start: string
  end: string
  fps: number
  resolution?: number
}

export interface ChunkPlan {
  start: number
  actual_start: number
  end: number
  index: number
  total: number
  clean_cut: boolean
}

export interface ToolResult {
  [key: string]: unknown
  content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>
  isError?: boolean
}

export function toolText(text: string): ToolResult {
  return { content: [{ type: "text", text }] }
}

export function toolError(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true }
}
