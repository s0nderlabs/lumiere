import { z } from "zod"
import { join, extname } from "path"
import { copyFileSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from "fs"
import { tmpdir } from "os"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { loadConfig, SESSIONS_DIR } from "../config.js"
import {
  DEFAULTS,
  autoBudgetViewSample,
  calculateAutoFps,
  MODE_RESOLUTION,
  estimateWatchCost,
  AUTOCOMPACT_THRESHOLD,
  targetExtractionFps,
} from "../defaults.js"
import {
  getVideoMetadata,
  extractFrames,
  extractFramesBySegments,
  frameFormatExtension,
  frameFormatMimeType,
} from "../extractors/frames.js"
import { extractAudio } from "../extractors/audio.js"
import { transcribeWithWhisper } from "../backends/local.js"
import { analyzeWithGeminiApi } from "../backends/gemini.js"
import { parseHMS, shiftAudioResult, formatHMSPrecise, HMS_REGEX as TIMESTAMP_HMS_REGEX } from "../utils/timestamps.js"
import {
  buildCaptionAudioResult,
  getCaptionFallbackReason,
  resolveVideoInputDetailed,
} from "../utils/video-source.js"
import { loadManifest, saveManifest, computeVideoHash } from "../session/manager.js"
import {
  createManifest,
  frameCacheKey,
  parseFrameCacheKey,
  mergeFrames,
  sampleFrameIndices,
} from "../session/manifest.js"
import {
  buildAdaptiveSegments,
  formatAdaptiveSummary,
  type AdaptiveSegment,
} from "../utils/adaptive-segments.js"
import {
  resolveRoi,
  roiBucketKey,
  assignPerWindowCrops,
  formatRoiCrop,
  ROI_AUTO,
  ROI_PER_WINDOW,
} from "../utils/roi.js"
import {
  decideAdaptive,
  decideNarrative,
  describeAdaptiveSource,
  describeNarrative,
  shouldAutoSuggestNarrative,
} from "../utils/decisions.js"
import { applyHallucinationGate } from "../utils/hallucination.js"
import { resolveNarrativeProfile } from "../prompts/narrative-profiles.js"
import type { AudioResult, ContentClass, Frame, Segment, SessionManifest, SegmentFrame } from "../types.js"

const HMS_REGEX = TIMESTAMP_HMS_REGEX
// lookupTimestamps normalizes numerically so format mismatches with cached
// ints still match within MATCH_EPSILON (tighter than 100ms so two adjacent
// frames in a dense adaptive segment don't collide).
const HMS_VIEW_REGEX = TIMESTAMP_HMS_REGEX
const MATCH_EPSILON = 0.05

// Sampling-gap-warning thresholds (empirically tuned 2026-05-20 on the Claude
// conference promo: adaptive_sampling put 64% of budget into 3% of timeline
// and missed two headphone equip/unequip events outside the motion window).
const GAP_WARN_BUDGET_RATIO = 0.6
const GAP_WARN_DURATION_RATIO = 0.3

// MCP response sizing constants. RUNTIME_CAP is the per-call budget that
// keeps the response under the 100K MAX_MCP_OUTPUT_TOKENS truncation point
// with a 12K cushion. PER_FRAME_OVERHEAD is the per-frame text wrapper
// ("### Frame at HH:MM:SS\n"). TEXT_OVERHEAD_BUDGET is non-frame text
// (metadata, manifest summary, narrative guidance, audio block).
const RUNTIME_CAP = 88000
const PER_FRAME_OVERHEAD = 50
const TEXT_OVERHEAD_BUDGET = 12000

function estimateResponseTokens(charsBase64: number, frameCount: number): number {
  return Math.ceil(charsBase64 / 3.5) + frameCount * PER_FRAME_OVERHEAD + TEXT_OVERHEAD_BUDGET
}

// How many of these frames fit under RUNTIME_CAP at their measured avg size?
// Returns null when there's nothing to measure (no images present).
function fitFramesForRuntimeCap(frames: { image?: string }[]): number | null {
  let totalChars = 0
  for (const f of frames) if (f.image) totalChars += f.image.length
  if (totalChars === 0) return null
  const avgChars = totalChars / frames.length
  const perFrameTokens = (avgChars / 3.5) + PER_FRAME_OVERHEAD
  return Math.max(2, Math.floor((RUNTIME_CAP - TEXT_OVERHEAD_BUDGET) / perFrameTokens))
}

// v0.11: Narrative guidance now lives in src/prompts/narrative-profiles.ts as
// a per-content-class registry. resolveNarrativeProfile() picks the right
// profile based on analyze().content_class or the explicit
// narrative_mode_profile param.

// Tier-gated hedge hint. At <=512 px, ambiguous silhouettes can lead the model to
// commit to a confident-but-wrong action verb. Empirically observed during the
// 2026-05-19 narrative-pass dispatch test: mid (512) hallucinated a "barbell workout"
// for a sequence that was actually "rope-on + jump + eye-laser + land". The fix is
// to explicitly ask for hedging at this tier.
const LOW_TIER_HEDGE_HINT = `### Confidence note (resolution <= 512)

At this resolution, silhouettes may be AMBIGUOUS between actions. When you are inferring a verb from a silhouette rather than reading it directly, FLAG it: write "looks like X" or "could be X or Y" instead of asserting X. Prefer honest uncertainty over confident misreading. If a frame's content is unclear at this tier, say so and recommend a higher tier (mode=high or mode=max) for that segment.`

function samplingGapWarning(concentrationPct: number, windowPct: number): string {
  return `## Sampling gap warning
adaptive_sampling concentrated ${concentrationPct}% of frames into ${windowPct}% of the active duration (motion_windows). The remaining ${100 - windowPct}% of the timeline was sampled sparsely, typically just bookend anchors.

What this misses: silhouette-area-changing events (equip/unequip, costume on/off, prop in-hand, headgear changes) that don't cross the motion_window intensity threshold. If your interpretation rests on "feature X is constant across the video", you have NOT verified that channel in the unsampled gaps.

To verify before locking interpretation, run a follow-up uniform scan:
  watch(path, mode=mid, adaptive_sampling=false, fps=2, narrative_mode=true)
The mid-tier uniform pass catches discrete on/off events the motion_window-weighted pass missed.`
}

function trimHintRuntimeMiddleDrop(args: {
  delivered: number
  requested: number
  firstTs: string
  lastTs: string
  gapStart: string
  gapEnd: string
  gapSec: number
  policy: "motion-aware" | "uniform"
}): string {
  const policyLine = args.policy === "motion-aware"
    ? "Frames were preserved with motion-aware policy: motion-window frames were kept first, then static bookends even-spaced against the remaining budget. The dense action moments are present; the gaps are between static frames."
    : "Frames were dropped with even-spaced subsample policy (no motion segments to prioritize). Middle frames may have been dropped."
  return `## Trim hint (runtime_trim middle-drop)
Delivered ${args.delivered}/${args.requested} frames across [${args.firstTs}, ${args.lastTs}]. Frame content was denser than the cost estimator predicted, so middle frames were dropped to keep the response under the MCP cap. THIS IS NOT a trailing MCP truncation, narrowing the tail will NOT recover dropped frames.

${policyLine}

Largest temporal gap: ${args.gapStart} -> ${args.gapEnd} (${args.gapSec.toFixed(2)}s). To recover frames in that gap, narrow the window directly:
  watch(path, start_time=${args.gapStart}, end_time=${args.gapEnd}, mode=<your mode>, fps=<original>)

DO NOT widen to a coarser fps; that loses the dense moments runtime_trim already paid for. To recover ALL dropped frames, walk the dropped_timestamps list in the budget block segment-by-segment.`
}

function truncationHintMcpCap(args: {
  delivered: number
  requested: number
  lastTs: string
  remainingSec: number
  nextStartHms: string
  endLabel: string
}): string {
  return `## Truncation hint (MCP cap mid-stream)
Received ${args.delivered}/${args.requested} frames; output hit the MCP per-call cap mid-stream at timestamp ${args.lastTs}. To cover the remaining ${args.remainingSec.toFixed(2)}s at the SAME fps (preserving temporal resolution), retry with start_time=${args.nextStartHms} end_time=${args.endLabel}. DO NOT drop to a coarser fps; narrow the window instead.`
}

// Sub-second tail short of the next fps step. Not an MCP-cap event: ffmpeg
// produced every frame that fits at the requested fps, the requested
// view_sample was just larger than what the duration could fit. Telling the
// caller to "retry the remaining tail" would only yield an empty extract.
function truncationHintFpsQuantization(args: {
  delivered: number
  requested: number
  lastTs: string
  remainingSec: number
  fps: number
}): string {
  return `## Sampling note (fps quantization tail)
Received ${args.delivered}/${args.requested} frames. The remaining ${args.remainingSec.toFixed(3)}s after the last frame is shorter than the inter-frame interval at fps=${args.fps} (1/fps=${(1 / args.fps).toFixed(3)}s), so no further frame fits at this fps. This is NOT a trailing MCP-cap truncation. To pull a tail frame at a higher rate, retry that segment with a denser fps, e.g. watch(path, start_time=${args.lastTs}, end_time=[end], fps=${Math.ceil(args.fps * 2)}).`
}

function tsFilename(ts: string, ext: string): string {
  return `${ts.replace(/:/g, "-")}.${ext}`
}

// Copy extracted segment frames out of the per-call workdir into the session
// cache and stitch them into the manifest. Using a per-call workdir during
// extraction (instead of writing directly into sessionDir's per-index
// subdirs) is what prevents the v0.10.3 cross-chunk frame-collision bug:
// segment index N from one chunk used to write into `s${N}/` and a different
// chunk's segment N would overwrite some files there, leaving stale frames
// behind that extractFrames then mis-labeled by index.
async function persistSegmentFramesToSession(opts: {
  frames: SegmentFrame[]
  sessionDir: string
  frameFormat: import("../types.js").FrameFormat
  frameExt: string
  getBucket: (f: SegmentFrame) => string
  mergeInto: (cacheKey: string, entries: { timestamp: string; file: string }[]) => void
}): Promise<void> {
  type EntryGroup = { resDir: string; cacheKey: string; entries: { timestamp: string; file: string }[] }
  const grouped = new Map<string, EntryGroup>()
  for (const f of opts.frames) {
    if (!f.sourcePath) continue
    const bucket = opts.getBucket(f)
    const cacheKey = frameCacheKey(String(f.resolution), opts.frameFormat, bucket)
    const bucketDir = bucket || "full"
    const resDir = join(opts.sessionDir, "frames", opts.frameFormat, String(f.resolution), bucketDir)
    let group = grouped.get(cacheKey)
    if (!group) {
      group = { resDir, cacheKey, entries: [] }
      grouped.set(cacheKey, group)
    }
    if (!existsSync(group.resDir)) mkdirSync(group.resDir, { recursive: true })
    const dest = join(group.resDir, tsFilename(f.timestamp, opts.frameExt))
    if (!existsSync(dest)) copyFileSync(f.sourcePath, dest)
    group.entries.push({ timestamp: f.timestamp, file: dest })
  }
  for (const g of grouped.values()) opts.mergeInto(g.cacheKey, g.entries)
}

function mimeFromFile(file: string): string {
  const e = extname(file).toLowerCase()
  if (e === ".png") return "image/png"
  if (e === ".webp") return "image/webp"
  return "image/jpeg"
}

interface ViewableFrame { timestamp: string; image?: string; mimeType?: string }

function lookupTimestampsInManifest(
  manifest: SessionManifest,
  timestamps: string[],
  format: string,
  roiBucket: string,
): ViewableFrame[] {
  const out: ViewableFrame[] = []
  for (const ts of timestamps) {
    const tsSec = parseHMS(ts)
    let bestRes = -1
    let bestFile: string | null = null
    let bestCachedTs = ts
    for (const [key, data] of Object.entries(manifest.resolutions)) {
      const parsed = parseFrameCacheKey(key)
      if (!parsed) continue
      if (parsed.format !== format) continue
      if (parsed.roiBucket !== roiBucket) continue
      let entry = data.frames.find(f => f.timestamp === ts)
      if (!entry) {
        let bestDelta = Infinity
        for (const f of data.frames) {
          const d = Math.abs(parseHMS(f.timestamp) - tsSec)
          if (d < bestDelta && d <= MATCH_EPSILON) {
            bestDelta = d
            entry = f
          }
        }
      }
      if (entry && parsed.resolution > bestRes) {
        bestRes = parsed.resolution
        bestFile = entry.file
        bestCachedTs = entry.timestamp
      }
    }
    if (bestFile !== null) {
      try {
        const data = readFileSync(bestFile)
        out.push({ timestamp: bestCachedTs, image: data.toString("base64"), mimeType: mimeFromFile(bestFile) })
      } catch {
        out.push({ timestamp: bestCachedTs })
      }
    }
  }
  return out
}

export function deriveFps(p: {
  fps: number | "auto"
  view_sample?: number
  start_time?: string
  end_time?: string
  segments?: { start: string; end: string }[]
  duration_seconds: number
  resolution?: number
}): number {
  const usingSegments = p.segments && p.segments.length > 0
  if (p.fps === "auto") {
    // v0.10.1+: tier-aware extraction fps is the primary path. Higher tiers get
    // dense pools so view_sample subsampling (or adaptive_sampling) has rich
    // material. Segments override (per-segment fps wins).
    if (!usingSegments && p.resolution !== undefined) {
      return targetExtractionFps(p.resolution)
    }
    if (p.view_sample && !usingSegments) {
      const s = p.start_time ? parseHMS(p.start_time) : 0
      const e = p.end_time ? parseHMS(p.end_time) : p.duration_seconds
      const active = Math.max(1, e - s)
      return p.view_sample / active
    }
    return calculateAutoFps(p.duration_seconds)
  }
  return p.fps
}

// Collapse manifest summary when many cached timestamps exist. A manifest with
// hundreds of sub-second entries dumps the full array which can eat 30K+ tokens;
// over 50 entries we emit count + first/last instead.
function summarizeManifest(manifest: SessionManifest) {
  const resolutions: Record<string, unknown> = {}
  for (const [r, d] of Object.entries(manifest.resolutions)) {
    const count = d.frames.length
    if (count > 50) {
      // Avoid allocating the full timestamp array just to drop it; only the
      // first and last entries get used in the collapsed summary.
      resolutions[r] = {
        frame_count: count,
        first_timestamp: d.frames[0]?.timestamp,
        last_timestamp: d.frames[count - 1]?.timestamp,
        timestamps_summary: `${count} cached frames (omitted to save tokens; use view= to fetch specific ones)`,
      }
    } else {
      resolutions[r] = { frame_count: count, timestamps: d.frames.map(f => f.timestamp) }
    }
  }
  return { video_hash: manifest.video_hash, resolutions }
}

// When narrative_mode is active and analyze() flagged palette outliers, surface
// them so the model treats novel colors as emission events instead of body parts.
function paletteOutlierHint(manifest: SessionManifest | null): string | null {
  if (!manifest?.analysis?.palette_outliers || manifest.analysis.palette_outliers.length === 0) return null
  const outs = manifest.analysis.palette_outliers
  const list = outs.slice(0, 8).map(o => `${o.timestamp} (dist=${o.chroma_distance})`).join(", ")
  return `### Palette-novelty alert

Prior \`analyze()\` flagged ${outs.length} frame(s) with color/brightness statistically far from the median: ${list}. These frames likely contain EMISSION events (laser, projectile, flash, particle effect) emanating FROM the subject rather than body parts OF the subject. When narrating these timestamps, prefer emission verbs (fires, emits, beams, casts) over physical/anatomy descriptors (legs, dust, particles).`
}

export function registerWatch(server: McpServer): void {
  server.tool(
    "watch",
    [
      "Extract frames + transcribe audio. Returns frames as base64 images plus transcription + audio analysis so Claude can SEE the video.",
      "PRESET MODES (preferred over raw resolution): low=cheap overview/scanning, mid=balanced, high=DEFAULT (body text readable, mascot anatomy crisp), max=pixel-perfect surgical.",
      "  mode=low → 384px res, 600 frames/call. ~85K tokens/call.",
      "  mode=mid → 512px res, 350 frames/call. ~70K tokens/call.",
      "  mode=high (default) → 1024px res, 120 frames/call. ~90K tokens/call. Body text + mascot detail readable.",
      "  mode=max → 1536px res, 50 frames/call. ~60K tokens/call. Exact hex colors, pixel-art identity, sub-frame marks.",
      "Server default mode is set via `configure`; override per-call with `mode` param. Raw `resolution` param overrides mode.",
      "FOR FULL-VIDEO COVERAGE: chunk into multiple sequential calls of ~5-10s each. Call `analyze` first on videos > 30s to plan chunk boundaries from scene cuts.",
      "NARRATIVE MODE: pass `narrative_mode=true` for action-heavy/motion-heavy segments. Injects guidance that re-reads frames as a temporal sequence (anchors/changes/actions/transitions/state changes) rather than as independent images. Recommended for video segments where the same subject moves continuously (animation, cooking, sports, agentic UI flows). Auto-suggested when prior analyze() reports high motion or dense scene cuts.",
      "Absorbs upstream `video_detail` capabilities: `view` (cache timestamps), `skip_metadata`, `skip_cached`.",
    ].join(" "),
    {
      path: z.string().describe("Local path or any URL supported by yt-dlp"),
      mode: z.enum(["low", "mid", "high", "max"]).optional().describe("Preset tier: low=overview/384, mid=balanced/512, high=default/1024, max=surgical/1536. Server default applies if omitted. Raw `resolution` overrides this."),
      fps: z.union([z.coerce.number().positive(), z.literal("auto")]).default("auto").describe("Frames per second to extract"),
      resolution: z.coerce.number().min(128).max(2048).optional().describe("Frame width in px (overrides mode). Maintains aspect ratio."),
      frame_format: z.enum(["jpeg", "png"]).optional().describe("Frame image format (webp NOT recommended; many ffmpeg builds lack libwebp)"),
      start_time: z.string().regex(HMS_REGEX).optional().describe("Start time HH:MM:SS"),
      end_time: z.string().regex(HMS_REGEX).optional().describe("End time HH:MM:SS (interpreted as wall-clock end, NOT duration: lumiere computes the difference and uses -t internally to avoid the upstream end_time bug)"),
      skip_audio: z.boolean().default(false).describe("Skip audio extraction + transcription, frames only"),
      skip_metadata: z.boolean().default(false).describe("Omit metadata + manifest summary blocks from the response"),
      skip_cached: z.boolean().default(false).describe("Force re-extraction, bypass session cache"),
      segments: z.array(z.object({
        start: z.string().regex(HMS_REGEX),
        end: z.string().regex(HMS_REGEX),
        fps: z.number().positive(),
        resolution: z.number().min(128).max(2048).optional(),
      })).optional().describe("Variable FPS/resolution segments (overrides global fps/start_time/end_time)"),
      view_sample: z.number().min(1).optional().describe("Return N evenly spaced frames (omit to use auto-budget default by resolution)"),
      view: z.array(z.string().regex(HMS_VIEW_REGEX)).optional().describe("Look up specific timestamps from session cache (requires enable_index=true and at least one prior watch/analyze call). Accepts HH:MM:SS or HH:MM:SS.fff (matches the sub-second precision the manifest emits). Bypasses extraction."),
      narrative_mode: z.boolean().optional().describe("Inject temporal-narrative guidance into the response so Claude reads frames as a continuous action sequence (anchors/changes/actions) rather than as independent images. Recommended for action/motion-heavy segments. Auto-suggested when analyze() reports high motion or dense scene cuts."),
      roi: z.union([z.literal(ROI_AUTO), z.literal(ROI_PER_WINDOW), z.string().regex(/^\d+,\d+,\d+,\d+$/)]).optional().describe("Crop frames to a region of interest before scaling. 'auto' uses a single global analyze().subject_bbox. 'per-window' assigns each motion-window's frames its OWN bbox from analyze().window_bboxes - tracks a traveling subject so each window's pixels land tight on the subject even when the subject moves across the frame (requires adaptive_sampling and prior analyze with motion=true). 'x,y,w,h' is an explicit pixel bbox. ROI crop gives the subject the full target resolution instead of being averaged out by background pixels."),
      adaptive_sampling: z.boolean().optional().describe("Motion-adaptive frame allocation. When true (or auto-enabled because narrative_mode is on AND analyze().motion_windows is cached AND duration > 4s), the per-call frame budget is split non-uniformly: 70% to motion-dense windows (weighted by duration * intensity), 30% to static spans. Same total frame count, but temporal resolution biased toward where action is happening. Pass false to force uniform sampling. Ignored if `segments` is given."),
      probe_calibration: z.boolean().optional().describe("Per-video view_sample calibration. Extracts one probe frame at the target resolution + crop BEFORE the main pool, measures its base64 chars, and derives a per-video view_sample from chars/3.5 instead of the static SAFE_AT_100K table. v0.11+: defaults to ON (the static table is calibrated against animation/UI content and biased for real-world video). Set `LUMIERE_PROBE_CALIBRATION=0` to disable globally. Ignored when `segments`, `view`, or explicit `view_sample` is given."),
      narrative_mode_profile: z.enum(["auto", "animation", "ui-screen", "human-motion", "talking-head", "real-world", "nature", "generic"]).optional().describe("Per-content-class narrative-mode prompt selection. 'auto' (default) reads analyze().content_class and routes to the matching profile. Explicit values force a specific profile regardless of cached content_class. Use 'generic' when content type is ambiguous and you want minimal domain priors."),
    },
    async (params) => {
      const config = loadConfig()
      // Resolution resolution order: explicit `resolution` > explicit `mode` > configured default_mode > DEFAULTS.frame_resolution.
      const resolution = params.resolution
        ?? (params.mode ? MODE_RESOLUTION[params.mode] : undefined)
        ?? MODE_RESOLUTION[config.default_mode]
        ?? DEFAULTS.frame_resolution
      const frameFormat = params.frame_format ?? DEFAULTS.frame_format
      const frameExt = frameFormatExtension(frameFormat)
      const frameMime = frameFormatMimeType(frameFormat)

      const resolved = await resolveVideoInputDetailed(params.path)
      const safePath = resolved.path

      // Probe metadata first so the session hash (v0.10.1) can include
      // duration; the previous 64KB+size hash collided in practice when stream
      // re-downloads shared the same MP4 header prefix and file size.
      const metadata = await getVideoMetadata(safePath)

      // Session setup
      const useSession = DEFAULTS.enable_index
      let sessionDir: string | null = null
      let manifest: SessionManifest | null = null
      if (useSession) {
        // Hash the video ONCE and derive sessionDir from it; the previous form
        // computed the hash twice (once inside getSessionDir, once for the
        // fallback createManifest path), re-reading the head of the file twice
        // on every cache miss.
        const videoHash = computeVideoHash(safePath, { duration: metadata.duration_seconds })
        sessionDir = join(SESSIONS_DIR, videoHash)
        manifest = loadManifest(sessionDir) ?? createManifest(videoHash, safePath)
      }

      // Cache lookup short-circuit (the absorbed video_detail `view` path)
      if (params.view && params.view.length > 0) {
        if (!manifest) {
          return {
            content: [{ type: "text", text: "## Error\n`view` requires session indexing, but no manifest exists. Call `watch` or `analyze` first to populate the cache." }],
          }
        }
        if (params.roi === ROI_PER_WINDOW) {
          return {
            content: [{ type: "text", text: "## Error\n`view` does not support `roi=per-window`. Use `roi=auto` or omit `roi` to look up cached timestamps." }],
          }
        }
        const viewRoi = resolveRoi(params.roi, manifest)
        const viewBucket = roiBucketKey(viewRoi)
        const frames = lookupTimestampsInManifest(manifest, params.view, frameFormat, viewBucket)
        const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = []
        if (resolved.source && !params.skip_metadata) content.push({ type: "text", text: `## Source\n${JSON.stringify(resolved.source, null, 2)}` })
        const bucketLabel = viewBucket || "full-frame"
        content.push({ type: "text", text: `## Cache lookup: ${frames.length}/${params.view.length} timestamps found (bucket=${bucketLabel})` })
        if (params.narrative_mode) {
          const cachedClass = manifest?.analysis?.content_class as ContentClass | undefined
          const profile = resolveNarrativeProfile(params.narrative_mode_profile, cachedClass)
          content.push({ type: "text", text: profile.guidance })
          if (resolution <= 512) content.push({ type: "text", text: LOW_TIER_HEDGE_HINT })
        }
        for (const f of frames) {
          content.push({ type: "text", text: `### Frame at ${f.timestamp}` })
          if (f.image) content.push({ type: "image", data: f.image, mimeType: f.mimeType ?? frameMime })
        }
        return { content: content as any }
      }

      // Auto-budget: apply safe view_sample if caller omitted and not using segments
      let effectiveViewSample = params.view_sample
      if (!effectiveViewSample && !params.segments) {
        effectiveViewSample = autoBudgetViewSample(resolution)
      }

      const workDir = join(tmpdir(), `lumiere-${Date.now()}`)
      mkdirSync(workDir, { recursive: true })

      const roiCrop = resolveRoi(params.roi, manifest)

      // Per-video view_sample calibration via one probe frame. Replaces the
      // static SAFE_AT_100K with a measurement taken on THIS video at THIS
      // resolution + crop. Costs one extra ffmpeg extraction (~150-300ms) but
      // lets very dense (busy real-world JPEG) or very sparse (flat animation)
      // content stop relying on the table average.
      //
      // v0.11: default ON. The static TPF table is calibrated against animation/
      // UI content and is 2-3.5x pessimistic for animation but accurate for
      // real-world video. Probing per-call eliminates the calibration bias
      // entirely; only opt out for latency-sensitive paths.
      const probeOptInExplicit = process.env.LUMIERE_PROBE_CALIBRATION === "0"
        || process.env.LUMIERE_PROBE_CALIBRATION === "false"
      const probeEnabled = params.probe_calibration === true
        || (params.probe_calibration === undefined
            && !params.view_sample
            && !params.segments
            && !probeOptInExplicit)
      let probeChars: number | null = null
      let probeCalibratedFrom: number | null = null
      let probeError: string | null = null
      if (probeEnabled && effectiveViewSample) {
        const probeDir = join(tmpdir(), `lumiere-probe-${Date.now()}`)
        mkdirSync(probeDir, { recursive: true })
        try {
          const windowStart = params.start_time ? parseHMS(params.start_time) : 0
          const windowEnd = params.end_time ? parseHMS(params.end_time) : metadata.duration_seconds
          const probeAt = Math.max(windowStart, Math.min(windowEnd - 0.01, (windowStart + windowEnd) / 2))
          const probeStartHms = formatHMSPrecise(probeAt, 3)
          const probeEndHms = formatHMSPrecise(Math.min(probeAt + 1, metadata.duration_seconds), 3)
          const probeFrames = await extractFrames(safePath, {
            fps: 1,
            resolution,
            outputDir: probeDir,
            format: frameFormat,
            startTime: probeStartHms,
            endTime: probeEndHms,
            maxFrames: 1,
            crop: roiCrop ?? undefined,
          })
          const derived = fitFramesForRuntimeCap(probeFrames)
          if (derived !== null && probeFrames[0]?.image) {
            probeChars = probeFrames[0].image.length
            probeCalibratedFrom = effectiveViewSample
            effectiveViewSample = derived
          } else {
            probeError = "no frame extracted"
          }
        } catch (err) {
          probeError = err instanceof Error ? err.message : String(err)
        } finally {
          rmSync(probeDir, { recursive: true, force: true })
        }
      }

      const fps = deriveFps({
        fps: params.fps,
        view_sample: effectiveViewSample,
        start_time: params.start_time,
        end_time: params.end_time,
        segments: params.segments,
        duration_seconds: metadata.duration_seconds,
        resolution,
      })

      // Decide narrative + adaptive once, up front. Both watch and measure call
      // into utils/decisions.ts so the same precedence applies to predictions
      // and execution.
      const narrativeReason = decideNarrative({
        param: params.narrative_mode,
        autoSuggest: shouldAutoSuggestNarrative(manifest, metadata.duration_seconds),
        configDefault: config.default_narrative_mode,
      })
      const useNarrative = narrativeReason.on

      const motionWindows = manifest?.analysis?.motion_windows ?? []
      const adaptiveReason = decideAdaptive({
        param: params.adaptive_sampling,
        narrativeOn: useNarrative,
        motionWindowCount: motionWindows.length,
        durationSec: metadata.duration_seconds,
        hasSegments: !!params.segments,
        configDefault: config.default_adaptive_sampling,
      })
      const useAdaptiveSampling = adaptiveReason.on

      let adaptiveSegs: AdaptiveSegment[] = []
      if (useAdaptiveSampling && motionWindows.length > 0) {
        const startSec = params.start_time ? parseHMS(params.start_time) : 0
        const endSec = params.end_time ? parseHMS(params.end_time) : metadata.duration_seconds
        const totalBudget = effectiveViewSample ?? Math.max(20, Math.round(fps * (endSec - startSec)))
        adaptiveSegs = buildAdaptiveSegments({
          motionWindows,
          startSec,
          endSec,
          totalBudget,
        })

        // roi="per-window" tracks a traveling subject (e.g. mascot top-left in
        // window 1, bottom-right in window 3) instead of a video-wide union bbox.
        if (params.roi === ROI_PER_WINDOW && manifest?.analysis?.window_bboxes?.length) {
          assignPerWindowCrops(
            adaptiveSegs,
            motionWindows,
            manifest.analysis.window_bboxes,
            manifest.analysis.subject_bbox,
          )
        }
      }

      const globalRoiBucket = roiBucketKey(roiCrop)

      let framesPromise: Promise<Frame[]>
      if (params.segments && params.segments.length > 0) {
        const extractDir = join(workDir, "frames")
        framesPromise = extractFramesBySegments(safePath, params.segments as Segment[], extractDir, frameFormat, roiCrop ?? undefined)
          .then(async (sf: SegmentFrame[]) => {
            if (useSession && manifest && sessionDir && !params.skip_cached) {
              await persistSegmentFramesToSession({
                frames: sf,
                sessionDir,
                frameFormat,
                frameExt,
                getBucket: () => globalRoiBucket,
                mergeInto: (cacheKey, entries) => { manifest = mergeFrames(manifest!, cacheKey, entries) },
              })
            }
            return sf
          })
      } else if (adaptiveSegs.length > 0) {
        const extractDir = join(workDir, "frames")
        const segs: Segment[] = adaptiveSegs.map(s => ({
          start: s.start,
          end: s.end,
          fps: s.fps,
          resolution,
          crop: s.crop,
        }))
        framesPromise = extractFramesBySegments(safePath, segs, extractDir, frameFormat, roiCrop ?? undefined)
          .then(async (sf: SegmentFrame[]) => {
            if (useSession && manifest && sessionDir && !params.skip_cached) {
              await persistSegmentFramesToSession({
                frames: sf,
                sessionDir,
                frameFormat,
                frameExt,
                getBucket: (f) => f.crop ? roiBucketKey(f.crop) : globalRoiBucket,
                mergeInto: (cacheKey, entries) => { manifest = mergeFrames(manifest!, cacheKey, entries) },
              })
            }
            return sf
          })
      } else {
        framesPromise = extractFrames(safePath, {
          fps,
          resolution,
          outputDir: join(workDir, "frames"),
          format: frameFormat,
          startTime: params.start_time,
          endTime: params.end_time,
          maxFrames: DEFAULTS.max_frames,
          crop: roiCrop ?? undefined,
        }).then(async ext => {
          if (useSession && manifest && sessionDir && !params.skip_cached) {
            const cacheKey = frameCacheKey(resolution, frameFormat, globalRoiBucket)
            const bucketDir = globalRoiBucket || "full"
            const resDir = join(sessionDir, "frames", frameFormat, String(resolution), bucketDir)
            mkdirSync(resDir, { recursive: true })
            const entries: { timestamp: string; file: string }[] = []
            for (const f of ext) {
              if (!f.sourcePath) continue
              const dest = join(resDir, tsFilename(f.timestamp, frameExt))
              if (!existsSync(dest)) copyFileSync(f.sourcePath, dest)
              entries.push({ timestamp: f.timestamp, file: dest })
            }
            manifest = mergeFrames(manifest, cacheKey, entries)
          }
          return ext
        })
      }

      let audioPromise: Promise<AudioResult>
      const fallback = resolved.source ? getCaptionFallbackReason(resolved.captions, metadata.duration_seconds) : null

      if (params.skip_audio || !metadata.has_audio) {
        audioPromise = Promise.resolve({ backend: "none" as const, transcription: [], audio_tags: [], full_analysis: null })
      } else if (fallback === null && resolved.captions) {
        audioPromise = Promise.resolve(buildCaptionAudioResult(resolved.captions, {
          startTime: params.start_time, endTime: params.end_time,
        }))
      } else if (config.backend === "gemini-api") {
        audioPromise = analyzeWithGeminiApi(safePath, { startTime: params.start_time, endTime: params.end_time })
      } else if (config.backend === "local") {
        // v0.11: cache-aware audio. If analyze() already flagged this video's
        // transcription as low-confidence (whisper hallucinated on quiet/music
        // audio), skip the whisper pass entirely. Pre-v0.11 watch() ignored the
        // cached flag and re-ran whisper, leaking the same hallucinations into
        // every chunk. Confirmed bug on real fitness/gym footage where ambient
        // gym audio passed the loudness VAD but hallucinated tourist content.
        const cachedLufs = manifest?.analysis?.loudness_summary?.mean_lufs
        if (manifest?.analysis?.transcription_low_confidence === true) {
          const reasons = manifest.analysis.transcription_low_confidence_reasons?.join("; ") ?? "analyze() flagged low confidence"
          audioPromise = Promise.resolve({
            backend: "local" as const,
            transcription: [],
            audio_tags: [],
            full_analysis: null,
            transcription_skipped_reason: `analyze() flagged transcription as low-confidence (${reasons}); whisper re-run suppressed to avoid hallucination`,
            loudness: cachedLufs !== undefined ? { value: cachedLufs, scale: "lufs" as const } : undefined,
          })
        } else {
          const audioDir = join(workDir, "audio")
          audioPromise = extractAudio(safePath, audioDir, {
            startTime: params.start_time, endTime: params.end_time,
          }).then(wav => transcribeWithWhisper(wav, config.whisper_model, { cachedMeanLufs: cachedLufs }))
        }
      } else {
        audioPromise = Promise.resolve({ backend: "none" as const, transcription: [], audio_tags: [], full_analysis: null })
      }

      let [frames, rawAudio] = await Promise.all([framesPromise, audioPromise])

      // Drop frames whose timestamp exceeds the video duration. Catches
      // yt-dlp buffer overflow and stale cache entries from cross-video hash
      // collisions. ffmpeg emits frames in order so the last-frame check
      // short-circuits the healthy case (0 out-of-range) with one parseHMS.
      const durationCap = metadata.duration_seconds + 0.1
      let outOfRangeDropped: string[] = []
      if (frames.length > 0 && parseHMS(frames[frames.length - 1].timestamp) > durationCap) {
        const inRange: typeof frames = []
        for (const f of frames) {
          if (parseHMS(f.timestamp) <= durationCap) inRange.push(f)
          else outOfRangeDropped.push(f.timestamp)
        }
        frames = inRange
      }

      if (fallback !== null && (rawAudio.backend === "local" || rawAudio.backend === "gemini-api")) {
        rawAudio = { ...rawAudio, transcription_fallback_reason: fallback }
      }

      // Borderline-quiet music can pass the VAD gate and still leak credits-
      // style hallucinations ("Teksting av...", "[Music]"). Run the same
      // multi-signal heuristic as analyze on the live transcription. Loudness
      // (LUFS-cached or dBFS-fallback) is read off the AudioResult's
      // discriminated union; gate handles the scale internally.
      rawAudio = applyHallucinationGate(rawAudio, metadata.duration_seconds)

      const offset = params.start_time ? parseHMS(params.start_time) : 0
      const audio = shiftAudioResult(rawAudio, offset)

      // Proactive sizing: measure actual chars/frame BEFORE applying
      // view_sample, lower effectiveViewSample if content is denser than the
      // static TPF table predicted. Avoids the post-extraction runtime_trim
      // firing on terminal-UI density. runtime_trim below remains as last-
      // resort safety for pools too small to estimate.
      let proactiveSizedFrom: number | null = null
      if (effectiveViewSample && effectiveViewSample > 2 && frames.length > 0) {
        const fitCount = fitFramesForRuntimeCap(frames)
        if (fitCount !== null && effectiveViewSample > fitCount) {
          proactiveSizedFrom = effectiveViewSample
          effectiveViewSample = fitCount
        }
      }

      // Apply view_sample (auto-budget or user-supplied, possibly tightened
      // by proactive sizing above)
      if (effectiveViewSample && frames.length > effectiveViewSample) {
        const idx = sampleFrameIndices(frames.length, effectiveViewSample)
        frames = idx.map(i => frames[i])
      }

      // Runtime trim safety net. Per-frame token cost is content-dependent
      // (action frames at 1024 ROI can be 5-7x the cost of static UI frames at
      // the same resolution). The cost estimator uses pessimistic-typical TPF
      // but a long burst of dense action frames can still overshoot. Measure
      // actual base64 size, estimate total tokens, and drop evenly-spaced
      // frames if the projection exceeds ~88K (12K headroom under the 100K cap).
      //
      // Motion-aware policy (v0.9+): when adaptive_sampling produced motion-tagged
      // segments, preserve those frames BEFORE evening out the static bookends.
      // The 2026-05-20 Claude conference promo failure case proved the old policy
      // killed exactly the temporal-density frames adaptive_sampling had spent
      // 70% of its budget acquiring. New policy: motion frames are last to die.
      let runtimeTrimmed = 0
      let runtimeTokensEst = 0
      let runtimeTrimDropped: string[] = []
      let runtimeTrimPolicy: "motion-aware" | "uniform" | "none" = "none"
      const sumChars = (fs: typeof frames): number => {
        let chars = 0
        for (const f of fs) if (f.image) chars += f.image.length
        return chars
      }
      if (frames.length > 2) {
        const totalImageChars = sumChars(frames)
        runtimeTokensEst = estimateResponseTokens(totalImageChars, frames.length)
        if (runtimeTokensEst > RUNTIME_CAP) {
          const keepCount = fitFramesForRuntimeCap(frames) ?? Math.max(2, frames.length - 1)
          if (keepCount < frames.length) {
            const preTrimTimestamps = frames.map(f => f.timestamp)
            const motionSegs = adaptiveSegs.filter(s => s.kind === "motion")
            let kept: typeof frames
            if (motionSegs.length > 0) {
              runtimeTrimPolicy = "motion-aware"
              const isMotionFrame = (f: (typeof frames)[number]): boolean => {
                const ts = parseHMS(f.timestamp)
                return motionSegs.some(s => ts >= s.startSec && ts <= s.endSec)
              }
              const motionFrames = frames.filter(isMotionFrame)
              const staticFrames = frames.filter(f => !isMotionFrame(f))
              if (motionFrames.length >= keepCount) {
                const idx = sampleFrameIndices(motionFrames.length, keepCount)
                kept = idx.map(i => motionFrames[i])
              } else {
                const staticBudget = Math.max(0, keepCount - motionFrames.length)
                const staticIdx = staticBudget > 0 && staticFrames.length > 0
                  ? sampleFrameIndices(staticFrames.length, Math.min(staticBudget, staticFrames.length))
                  : []
                kept = [...motionFrames, ...staticIdx.map(i => staticFrames[i])]
                  .sort((a, b) => parseHMS(a.timestamp) - parseHMS(b.timestamp))
              }
            } else {
              runtimeTrimPolicy = "uniform"
              const idx = sampleFrameIndices(frames.length, keepCount)
              kept = idx.map(i => frames[i])
            }
            // Motion frames may average larger than static bookends; re-measure
            // and drop further if the keepCount derived from the global average
            // overshoots.
            while (estimateResponseTokens(sumChars(kept), kept.length) > RUNTIME_CAP && kept.length > 2) {
              const idx = sampleFrameIndices(kept.length, kept.length - 1)
              kept = idx.map(i => kept[i])
            }
            const keptSet = new Set(kept.map(f => f.timestamp))
            runtimeTrimDropped = preTrimTimestamps.filter(t => !keptSet.has(t))
            runtimeTrimmed = frames.length - kept.length
            frames = kept
            runtimeTokensEst = estimateResponseTokens(sumChars(frames), frames.length)
          }
        }
      }

      if (useSession && manifest && sessionDir) saveManifest(sessionDir, manifest)
      // workDir holds the per-call extraction (kept off the session cache to
      // avoid the cross-chunk index-collision bug). Always rmSync — frames the
      // session needs have already been copied into sessionDir by
      // persistSegmentFramesToSession. Pre-v0.10.3 this only cleaned up when
      // !useSession, which leaked ~20-50MB JPEGs per call on the default path.
      rmSync(workDir, { recursive: true, force: true })

      const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = []

      // Source/Manifest/Video/Audio dumps are large; suppress them by default
      // when narrative_mode is on. The Budget block is small + structured and
      // is required for the gate-verification protocol, so it ALWAYS renders
      // regardless of skip_metadata. Callers wanting full silence pass
      // skip_metadata=true AND consume only the frames.
      const skipVerboseBlocks = params.skip_metadata === true
        || (useNarrative && params.skip_metadata === false ? false : useNarrative)

      if (!skipVerboseBlocks) {
        if (resolved.source) content.push({ type: "text", text: `## Source\n${JSON.stringify(resolved.source, null, 2)}` })
        if (manifest) {
          const summary = summarizeManifest(manifest)
          content.push({ type: "text", text: `## Session Manifest\n${JSON.stringify(summary, null, 2)}` })
        }
        content.push({
          type: "text",
          text: `## Video Metadata\n${JSON.stringify(metadata, null, 2)}\n\n## Audio Analysis\n${JSON.stringify(audio, null, 2)}`,
        })
      }

      // Budget block: always emitted. Even on skip_metadata=true the gate
      // verification protocol depends on these six fields being present per
      // chunk (view_sample_applied, extraction_fps, proactive_sizing,
      // runtime_trim, out_of_range_dropped, frames delivered).
      {
        const cost = estimateWatchCost({
          resolution,
          fps,
          view_sample: effectiveViewSample,
          duration_seconds: metadata.duration_seconds,
          video_width: metadata.width,
          video_height: metadata.height,
        })
        const narrativeDesc = describeNarrative(narrativeReason)
        let roiDesc: string
        if (params.roi === ROI_PER_WINDOW) {
          const segsWithCrop = adaptiveSegs.filter(s => s.crop).length
          if (segsWithCrop > 0) {
            const uniqueCrops = new Set(adaptiveSegs.filter(s => s.crop).map(s => formatRoiCrop(s.crop!)))
            roiDesc = `per-window: ${segsWithCrop}/${adaptiveSegs.length} segments cropped, ${uniqueCrops.size} unique bboxes (from analyze.window_bboxes)`
          } else {
            roiDesc = "per-window requested but analyze.window_bboxes missing or empty; ran un-cropped (call analyze with motion=true first to populate)"
          }
        } else if (roiCrop) {
          roiDesc = `${formatRoiCrop(roiCrop)} (${params.roi === ROI_AUTO ? "auto from analyze.subject_bbox" : "explicit"})`
        } else {
          roiDesc = "none (full frame)"
        }
        const adaptiveDesc = adaptiveSegs.length > 0
          ? `on (${describeAdaptiveSource(adaptiveReason)})\n${formatAdaptiveSummary(adaptiveSegs)}`
          : describeAdaptiveSource(adaptiveReason)
        const effectiveFpsDesc = adaptiveSegs.length > 0
          ? `varies per segment (${Math.min(...adaptiveSegs.map(s => s.fps)).toFixed(2)}-${Math.max(...adaptiveSegs.map(s => s.fps)).toFixed(2)}fps post-adaptive_sampling)`
          : `${fps}`
        const keptListing = runtimeTrimmed > 0
          ? `\n  policy=${runtimeTrimPolicy} (${runtimeTrimPolicy === "motion-aware" ? "preserved motion-window frames first, even-spaced static bookends against remaining budget" : "even-spaced over all frames; no motion segments available to prioritize"})\n  kept_timestamps=${JSON.stringify(frames.map(f => f.timestamp))}\n  dropped_timestamps=${JSON.stringify(runtimeTrimDropped)}`
          : ""
        const runtimeTrimDesc = runtimeTrimmed > 0
          ? `\nruntime_trim=YES dropped ${runtimeTrimmed} frame(s) (NOT a trailing MCP-cap drop) to keep response under ~88K. actual_est_tokens=${runtimeTokensEst}${keptListing}`
          : `\nruntime_trim=no actual_est_tokens=${runtimeTokensEst}`
        const outOfRangeDesc = outOfRangeDropped.length > 0
          ? `\nout_of_range_dropped=${outOfRangeDropped.length} frame(s) past video duration (${metadata.duration_seconds}s); timestamps=${JSON.stringify(outOfRangeDropped)}`
          : `\nout_of_range_dropped=0 (filter active)`
        const proactiveDesc = proactiveSizedFrom !== null
          ? `\nproactive_sizing=YES view_sample lowered ${proactiveSizedFrom}→${effectiveViewSample} (content denser than TPF predicted; runtime_trim avoided)`
          : `\nproactive_sizing=no (content matched TPF estimate)`
        let probeDesc = ""
        if (probeEnabled) {
          if (probeCalibratedFrom !== null) {
            probeDesc = `\nprobe_calibration=YES view_sample retuned ${probeCalibratedFrom}→${effectiveViewSample} (probe_chars=${probeChars})`
          } else if (probeError) {
            probeDesc = `\nprobe_calibration=enabled but probe failed (${probeError}); fallback to table`
          } else {
            probeDesc = `\nprobe_calibration=enabled (no override applied)`
          }
        }
        // v0.11: surface content_class + bbox.confidence + motion_warning so
        // callers can see what classification and signal trail drove this call.
        const cachedClass = manifest?.analysis?.content_class
        const cachedBboxConf = manifest?.analysis?.subject_bbox?.confidence
        const cachedBboxMethod = manifest?.analysis?.subject_bbox?.method
        const motionWarning = manifest?.analysis?.motion_detection_warning
        const classDesc = cachedClass
          ? `${cachedClass}${cachedBboxConf !== undefined ? ` (bbox=${cachedBboxMethod}, conf=${cachedBboxConf.toFixed(2)})` : ""}`
          : "n/a (run analyze with motion=true to classify)"
        const motionWarningLine = motionWarning ? `\nmotion_detection_warning=${motionWarning}` : ""
        content.push({
          type: "text",
          text: `## Budget\nview_sample_applied=${effectiveViewSample ?? "n/a"} extraction_fps=${fps} effective_fps=${effectiveFpsDesc} resolution=${resolution} frame_format=${frameFormat}\nmcp_tokens_this_call=${cost.mcp_tokens_per_call} (chars/3.5; governs per-call truncation)\nconversation_tokens_this_call=${cost.conversation_tokens_per_call} (~${cost.pct_of_1m_window_thorough}% of 1M when fully covered)\nthorough_coverage_chunks_needed=${cost.chunks_for_full_coverage_thorough} (~${(cost.conversation_total_tokens_thorough / 1000).toFixed(0)}K conversation tokens at target_fps=${cost.target_fps_thorough})\nautocompact_warning=${cost.will_trigger_autocompact_thorough ? "YES - thorough coverage would exceed " + AUTOCOMPACT_THRESHOLD + " conversation tokens" : "no"}\ncontent_class=${classDesc}\nnarrative_mode=${narrativeDesc}\nroi=${roiDesc}\nadaptive_sampling=${adaptiveDesc}${probeDesc}${proactiveDesc}${runtimeTrimDesc}${outOfRangeDesc}${motionWarningLine}`,
        })
      }

      // Adaptive-cluster gap warning. When motion-window sampling clusters most
      // of the budget into a tiny slice of the active duration, the LLM gets
      // dense coverage of one moment and bookend anchors elsewhere. Equip/
      // unequip events that don't pop the motion threshold fall into the gap.
      // Empirically observed 2026-05-20: Claude conference promo put 64% of
      // frames into 3% of the timeline and missed two headphone equip/unequip
      // events because the only motion_window was a 0.6s pin-label transit.
      if (adaptiveSegs.length > 0) {
        let totalBudget = 0
        let motionBudget = 0
        let activeDur = 0
        let motionDur = 0
        for (const s of adaptiveSegs) {
          const dur = s.endSec - s.startSec
          totalBudget += s.budgetFrames
          activeDur += dur
          if (s.kind === "motion") {
            motionBudget += s.budgetFrames
            motionDur += dur
          }
        }
        const budgetRatio = totalBudget > 0 ? motionBudget / totalBudget : 0
        const durRatio = activeDur > 0 ? motionDur / activeDur : 0
        if (budgetRatio > GAP_WARN_BUDGET_RATIO && durRatio < GAP_WARN_DURATION_RATIO && motionDur > 0) {
          content.push({
            type: "text",
            text: samplingGapWarning(Math.round(budgetRatio * 100), Math.round(durRatio * 100)),
          })
        }
      }

      // Truncation / trim hint. Two distinct causes produce frames.length <
      // effectiveViewSample: (A) MCP per-call cap killed the response after
      // some prefix delivered, leaving a trailing tail uncovered; (B) runtime
      // trim deliberately dropped evenly-spaced middle frames because content
      // was denser than the cost estimator predicted. Case A wants
      // "retry from last delivered to the end at same fps"; case B wants
      // "retry the widest internal gap directly". Emitting the same hint for
      // both used to send callers chasing the wrong window.
      if (effectiveViewSample && frames.length < effectiveViewSample && frames.length > 0) {
        if (runtimeTrimmed > 0) {
          let largestGap = -1
          let gapStart = frames[0].timestamp
          let gapEnd = frames[0].timestamp
          for (let i = 1; i < frames.length; i++) {
            const gap = parseHMS(frames[i].timestamp) - parseHMS(frames[i - 1].timestamp)
            if (gap > largestGap) {
              largestGap = gap
              gapStart = frames[i - 1].timestamp
              gapEnd = frames[i].timestamp
            }
          }
          content.push({
            type: "text",
            text: trimHintRuntimeMiddleDrop({
              delivered: frames.length,
              requested: effectiveViewSample,
              firstTs: frames[0].timestamp,
              lastTs: frames[frames.length - 1].timestamp,
              gapStart,
              gapEnd,
              gapSec: Math.max(0, largestGap),
              policy: runtimeTrimPolicy === "motion-aware" ? "motion-aware" : "uniform",
            }),
          })
        } else {
          const lastTs = frames[frames.length - 1].timestamp
          const coveredSec = parseHMS(lastTs)
          const requestedEndSec = params.end_time ? parseHMS(params.end_time) : metadata.duration_seconds
          const remainingSec = requestedEndSec - coveredSec
          // fps quantization tail: when the remaining slack is smaller than
          // a single inter-frame interval at this fps, no further frame is
          // possible. Suggesting "retry the remaining window" would extract
          // nothing. The denser-fps hint is the actionable advice instead.
          const isFpsQuantizationTail = remainingSec > 0 && remainingSec < (1 / fps + 0.005)
          content.push({
            type: "text",
            text: isFpsQuantizationTail
              ? truncationHintFpsQuantization({
                  delivered: frames.length,
                  requested: effectiveViewSample,
                  lastTs,
                  remainingSec,
                  fps,
                })
              : truncationHintMcpCap({
                  delivered: frames.length,
                  requested: effectiveViewSample,
                  lastTs,
                  remainingSec,
                  nextStartHms: formatHMSPrecise(coveredSec, 3),
                  endLabel: params.end_time ?? "[original end]",
                }),
          })
        }
      }

      if (useNarrative) {
        const cachedClass = manifest?.analysis?.content_class as ContentClass | undefined
        const profile = resolveNarrativeProfile(params.narrative_mode_profile, cachedClass)
        content.push({ type: "text", text: profile.guidance })
        if (resolution <= 512) content.push({ type: "text", text: LOW_TIER_HEDGE_HINT })
        const paletteHint = paletteOutlierHint(manifest)
        if (paletteHint) content.push({ type: "text", text: paletteHint })
      }

      for (const f of frames) {
        content.push({ type: "text", text: `### Frame at ${f.timestamp}` })
        if (f.image) content.push({ type: "image", data: f.image, mimeType: frameMime })
      }
      return { content: content as any }
    },
  )
}
