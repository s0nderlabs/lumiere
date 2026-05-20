export type Backend = "local" | "gemini-api" | "none"
export type WhisperModel = "tiny" | "base" | "small" | "medium" | "large-v3-turbo" | "large-v3" | "auto"
export type FrameFormat = "jpeg" | "png" | "webp"
export type WatchMode = "low" | "mid" | "high" | "max"

export interface Config {
  backend: Backend
  whisper_model: WhisperModel
  default_mode: WatchMode
  // Per-server defaults for narrative_mode / adaptive_sampling. Undefined means
  // use heuristics; true/false forces on/off when the per-call param is unset.
  // Precedence: explicit per-call param > auto-suggest > server default > off.
  // See utils/decisions.ts for the canonical implementation.
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
  u_chroma?: number  // raw UAVG-128 chroma; powers hue-based palette novelty
  v_chroma?: number  // raw VAVG-128 chroma
}

// Single source of truth for the detected subject bbox. Produced by either the
// connected-component detector (extractors/bbox.ts) or the cropdetect-fallback
// parser (extractors/analyzers.ts); stored under analysis.subject_bbox.
export interface SubjectBbox {
  x: number
  y: number
  w: number
  h: number
  frame_w: number
  frame_h: number
  area_pct: number
  method?: "cc" | "cropdetect" | "cropdetect-fallback"
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
  // Raw siti scores so callers can see the numbers behind the content_profile label.
  motion_summary?: { siAvg?: number; tiAvg?: number }
  // Center-crop motion that catches small-subject high-motion (e.g. animated
  // mascot inside a static card) which the global siti underweights.
  subject_motion?: { siAvg?: number; tiAvg?: number }
  // Combined global+subject motion verdict. Drives narrative_mode auto-suggest.
  has_motion?: boolean
  // Frames whose chroma/brightness is statistically far from the median.
  // Catches one-off color events (laser beams, projectiles, flashes) that lower
  // tiers can pattern-match to body parts. Both magnitude (saturation/brightness)
  // and hue (atan2) novelty are checked; empty array means none detected.
  palette_outliers?: Array<{ timestamp: string; chroma_distance: number; brightness?: number; saturation?: number }>
  // Bbox of moving subject. Detector preference: connected-component (preferred,
  // returns tightest bbox of dominant moving blob), falling back to cropdetect on
  // the binary motion mask. The `method` field on SubjectBbox indicates which ran.
  subject_bbox?: SubjectBbox
  // Motion-dense time windows for adaptive frame sampling. Each window is a
  // contiguous interval where temporal motion (siti ti, 1s rolling mean) exceeds
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
