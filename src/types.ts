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
  // Mirror of the segment's crop so cache buckets can be tagged per-frame.
  crop?: { x: number; y: number; w: number; h: number }
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

export type LoudnessScale = "dbfs" | "lufs"

// Single loudness reading with its measurement scale. Replaces the parallel
// mean_dbfs?/mean_lufs? pair (v0.10.3) so downstream code can branch on the
// scale instead of guessing which field is set. dBFS is from ffmpeg
// volumedetect (per-chunk fallback); LUFS is K-weighted from ebur128 in
// analyze.loudness_summary (reused by watch via cachedMeanLufs).
export interface LoudnessReading {
  value: number
  scale: LoudnessScale
}

export interface AudioResult {
  backend: Backend | "youtube-captions"
  transcription: TranscriptionSegment[]
  audio_tags: AudioTag[]
  full_analysis: string | null
  transcription_source?: string
  transcription_source_detail?: string
  transcription_fallback_reason?: string
  transcription_skipped_reason?: string
  loudness?: LoudnessReading
  low_confidence?: boolean
  transcription_low_confidence_reasons?: string[]
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

// Single source of truth for the detected subject bbox. Produced by the
// connected-component detector (extractors/bbox.ts), the multi-region siti grid
// fallback (extractors/analyzers.ts), or the cropdetect parser when both fail.
// The `confidence` field lets callers decide whether to trust roi=auto: 1.0 means
// a tight, dominant single blob; 0.0 means no signal (cropdetect-fallback returning
// full-frame). Stored under analysis.subject_bbox.
export interface SubjectBbox {
  x: number
  y: number
  w: number
  h: number
  frame_w: number
  frame_h: number
  area_pct: number
  method?: "cc" | "multi-region" | "center-prior" | "cropdetect" | "cropdetect-fallback"
  confidence?: number
}

// Content-class detector output. Drives narrative-profile selection in watch(),
// per-class TPF overrides, and motion-detection algorithm choice. Computed in
// analyze() from existing signals (motion summary, scenes, palette, subject_bbox)
// so adding it costs no new ffmpeg passes.
export type ContentClass =
  | "animation"      // mascot, branded character, motion graphics, launch reels
  | "ui-screen"      // terminal, IDE, code editor, dashboard, agentic UI
  | "human-motion"   // sports, fitness, dance, gymnastics
  | "talking-head"   // single human, mostly face, podcast/interview/reaction
  | "real-world"     // dashcam, POV, drone, varied subject
  | "nature"         // landscape, slow camera, no clear subject
  | "generic"        // fallback when signals don't fit a specific class

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
  // v0.10.1: propagated from AudioResult when the VAD pre-gate suppressed
  // whisper. Lets analyze callers see "whisper was skipped because audio is
  // silent" without re-checking AudioResult separately.
  transcription_skipped_reason?: string
  audio_warnings?: ChunkWarning[]
  content_profile: string
  // Structured content classification. Drives narrative profile selection,
  // per-class TPF overrides, and motion detection algorithm preference.
  // content_profile remains as the human-readable label for backward compat.
  content_class?: ContentClass
  // Why the detector picked that class. Useful for debugging misclassification
  // and for callers that want to log the signal trail.
  content_class_reasons?: string[]
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
  motion_windows?: Array<{ start: string; end: string; intensity: number; coverage_score?: number }>
  // Per-motion-window subject bboxes (cc-segmentation per window range).
  // Powers watch's roi="per-window" so a traveling subject stays tight.
  // Null entries: detection found no usable blob in that window.
  window_bboxes?: Array<SubjectBbox | null>
  // Warning when global motion_windows are unreliable (cluster at boundaries
  // only, or subject_motion >> global motion). Lets callers know that
  // adaptive_sampling may bias toward the wrong segments.
  motion_detection_warning?: string
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
  // Per-segment crop applied before scaling; lets roi=per-window vary bbox per motion window.
  crop?: { x: number; y: number; w: number; h: number }
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
