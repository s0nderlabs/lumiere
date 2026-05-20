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
import { parseHMS, shiftAudioResult, formatHMSPrecise } from "../utils/timestamps.js"
import {
  buildCaptionAudioResult,
  getCaptionFallbackReason,
  resolveVideoInputDetailed,
} from "../utils/video-source.js"
import { loadManifest, saveManifest, computeVideoHash } from "../session/manager.js"
import {
  createManifest,
  frameCacheKey,
  mergeFrames,
  sampleFrameIndices,
} from "../session/manifest.js"
import {
  buildAdaptiveSegments,
  formatAdaptiveSummary,
  type AdaptiveSegment,
} from "../utils/adaptive-segments.js"
import { resolveRoi } from "../utils/roi.js"
import {
  decideAdaptive,
  decideNarrative,
  describeAdaptiveSource,
  describeNarrative,
  shouldAutoSuggestNarrative,
} from "../utils/decisions.js"
import type { AudioResult, Frame, Segment, SessionManifest, SegmentFrame } from "../types.js"

const HMS_REGEX = /^\d{2}:\d{2}:\d{2}$/

// Narrative-pass guidance prompt. Injected when narrative_mode is requested or
// auto-suggested. Asks the model to treat frames as a temporal sequence and
// gives anatomy/source-attribution priors so novel colors map to emission
// events, not body parts.
const NARRATIVE_GUIDANCE = `## Interpretation guidance (narrative_mode)

These frames are CONSECUTIVE MOMENTS IN TIME from one video. Treat them as a temporal sequence, not as independent images:

1. **ANCHORS:** identify what PERSISTS across the frames (subject, setting, camera, background). These are reference points that stay the same across time.

2. **CHANGES:** identify what DIFFERS across the frames (position, posture, attribute, state, environment, lighting, UI content). These are events.

3. **RESOLVE** each change as one of:
   - (a) an ACTION the subject performs. Pick the verb family that fits:
     - PHYSICAL: jumps, lands, leaps, runs, walks, falls, hovers, levitates, climbs
     - EMISSION: fires, emits, shoots, beams, sparks, casts, blasts, radiates
     - EQUIPMENT: puts on, equips, dons, draws, takes off, removes, sheds, drops
     - MANIPULATION: types, picks up, slices, scrolls, edits, opens, clicks, drags
   - (b) a TRANSITION in the scene (cut, fade, pan, zoom, dissolve)
   - (c) a STATE CHANGE in the world (counter advances, file changes, light turns on, level fills)

4. **NARRATE** the sequence as continuous prose using temporal connectors (then, while, after) and the verbs you identified. Do NOT list each frame independently.

### Specific priors (apply before committing to a verb)

- **Branded character = fixed identity, BUT costumes/props ARE binary state changes.** If the subject is a branded mascot/product/character, your DEFAULT hypothesis is: this is the SAME character across all frames. Identity-swap is a last-resort interpretation. HOWEVER, costumes / accessories / held-props ARE valid state changes, track them as discrete on/off events with start and end timestamps, not as per-frame pose oscillations. A red mass that appears on top of the head and STAYS for N frames is HEADGEAR EQUIPPED, not a "windswept hair pose."

- **Dramatic outline change ≠ identity swap.** When silhouette OUTLINE changes a lot but silhouette AREA is roughly conserved between consecutive frames, that is a POSE CHANGE or a PROP EQUIPPED/REMOVED. Ask: "does the eye position stay constant?" If yes, it is the same character. Then ask: "does the new mass appear ABOVE the eye-line?" If yes, suspect HEADGEAR EQUIPPED. "Outside the body silhouette?" Suspect PROP IN HAND.

- **Novel color in 1-2 frames = EVENT, list candidate SOURCES.** If a color appears in only 1-2 frames and is absent elsewhere, that color is almost certainly a projectile, beam, particle, flash, or light effect. BEFORE committing to where it's drawn, list 2-3 candidate SOURCES on the subject and pick one:
  - eyes → laser/beam/vision ray/sight attack
  - mouth → breath/blast/sonic shout/words
  - hands → projectile/spark/blast/orb
  - body → aura/radiance/explosion/transformation
  - feet → dust puff/motion trail (only if there's also vertical translation; otherwise prefer body)
  Then TRACE the trajectory: do the novel pixels originate at one of those candidate sources and extend AWAY from it? If they extend straight down from the eye region, they are eye lasers, not leg trails. Verify-then-attribute, not attribute-then-verify.

- **Feature-channel tracking.** Do not anchor only on silhouette. Also track named feature channels frame-to-frame:
  - **EYES**: constant (black squares) vs glowing/emitting/changing color. If novel pixels appear collinear with or adjacent to the eye region, this channel is active.
  - **HANDS / ARMS**: idle vs holding/firing/raised
  - **MOUTH**: closed vs open/emitting
  - **HEADGEAR / EQUIPMENT**: NONE vs hat/wig/rope/helmet/crown/mask/accessory equipped. If any structure persists ABOVE the eye-line for ≥3 consecutive frames, mark this channel as ACTIVE and narrate the equip + remove events with timestamps. Do NOT collapse this into a "pose"; it is a discrete state.
  - **BODY BASELINE**: at rest position relative to wordmark/ground anchor vs lifted above it (= hovering/jumping/flying)

- **Position relative to fixed anchors.** If the subject's vertical offset from a fixed anchor (wordmark, ground line, frame edge) is different from baseline AND that offset persists for ≥2 consecutive frames, the subject is HOVERING / LEVITATING / FLYING, not just in an "extended stance."

- **Verb taxonomy with body-region anchors:**
  - PHYSICAL (body): jumps, lands, leaps, runs, walks, falls, hovers, levitates, climbs
  - EMISSION-FROM-EYES: fires (lasers), beams, casts (vision rays)
  - EMISSION-FROM-MOUTH: blasts, breathes (flame/cold/sonic), shouts
  - EMISSION-FROM-HANDS: throws, hurls, shoots, sparks, conjures
  - EMISSION-FROM-BODY: radiates, glows, transforms, explodes
  - EQUIPMENT: puts on, equips, dons, draws, takes off, removes, sheds, drops
  - MANIPULATION: types, picks up, slices, scrolls, edits, opens, clicks, drags

- **If you are unsure**, list 2-3 candidate interpretations and pick one with a confidence note. Honest hedge > confident misreading. At resolution <= 512 specifically, you SHOULD say "I can describe shapes but not feature-channel state at this resolution; recommend mid/high for any verb that depends on a specific feature (eyes/mouth/hands)."

### Continuity audit (mandatory final pass)

After you write the narrative, re-read your draft once more. For each verb where you committed to a specific body-region source or causal verb, ask:

1. Did I have >1 plausible candidate source at the time? If yes, list the alternatives I rejected and the trajectory evidence that ruled them out. If I cannot, that attribution is provisional, flag it.
2. Did I commit to a sequence (A then B then C) where the time spacing was tight (< 0.5s between events)? If yes, ensure my anchor frames support the ordering, not just the existence of each event.
3. Are there any frames I described as "duplicate" or "same as previous"? Re-check them; sub-pixel changes (eye color shift, hand pose change, beam path) can hide in apparent duplicates. If unsure, hedge instead of asserting "no change."

Revise any verb where the audit surfaces doubt. A flagged hedge is more useful than a confident wrong attribution.

The subject can be anything: a person, animation, UI element, product, animal, sports moment, cooking step. Adapt your verbs to what is actually happening. Your job is to recover the temporal narrative, not catalog the frames.`

// Tier-gated hedge hint. At <=512 px, ambiguous silhouettes can lead the model to
// commit to a confident-but-wrong action verb. Empirically observed during the
// 2026-05-19 narrative-pass dispatch test: mid (512) hallucinated a "barbell workout"
// for a sequence that was actually "rope-on + jump + eye-laser + land". The fix is
// to explicitly ask for hedging at this tier.
const LOW_TIER_HEDGE_HINT = `### Confidence note (resolution <= 512)

At this resolution, silhouettes may be AMBIGUOUS between actions. When you are inferring a verb from a silhouette rather than reading it directly, FLAG it: write "looks like X" or "could be X or Y" instead of asserting X. Prefer honest uncertainty over confident misreading. If a frame's content is unclear at this tier, say so and recommend a higher tier (mode=high or mode=max) for that segment.`

function tsFilename(ts: string, ext: string): string {
  return `${ts.replace(/:/g, "-")}.${ext}`
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
): ViewableFrame[] {
  const out: ViewableFrame[] = []
  for (const ts of timestamps) {
    let bestRes = -1
    let bestFile: string | null = null
    for (const [key, data] of Object.entries(manifest.resolutions)) {
      const [resStr, fmt = "jpeg"] = key.split("/")
      if (fmt !== format) continue
      const res = parseInt(resStr, 10)
      const entry = data.frames.find(f => f.timestamp === ts)
      if (entry && res > bestRes) {
        bestRes = res
        bestFile = entry.file
      }
    }
    if (bestFile !== null) {
      try {
        const data = readFileSync(bestFile)
        out.push({ timestamp: ts, image: data.toString("base64"), mimeType: mimeFromFile(bestFile) })
      } catch {
        out.push({ timestamp: ts })
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
}): number {
  const usingSegments = p.segments && p.segments.length > 0
  if (p.fps === "auto") {
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
      view: z.array(z.string().regex(HMS_REGEX)).optional().describe("Look up specific timestamps from session cache (requires enable_index=true and at least one prior watch/analyze call). Bypasses extraction."),
      narrative_mode: z.boolean().optional().describe("Inject temporal-narrative guidance into the response so Claude reads frames as a continuous action sequence (anchors/changes/actions) rather than as independent images. Recommended for action/motion-heavy segments. Auto-suggested when analyze() reports high motion or dense scene cuts."),
      roi: z.union([z.literal("auto"), z.string().regex(/^\d+,\d+,\d+,\d+$/)]).optional().describe("Crop frames to a region of interest before scaling. 'auto' uses analyze().subject_bbox (must have run analyze with motion=true first). 'x,y,w,h' is an explicit pixel bbox. ROI crop gives the subject the full target resolution instead of being averaged out by background pixels - critical for small-subject videos (mascot < 15% of frame)."),
      adaptive_sampling: z.boolean().optional().describe("Motion-adaptive frame allocation. When true (or auto-enabled because narrative_mode is on AND analyze().motion_windows is cached AND duration > 4s), the per-call frame budget is split non-uniformly: 70% to motion-dense windows (weighted by duration * intensity), 30% to static spans. Same total frame count, but temporal resolution biased toward where action is happening. Pass false to force uniform sampling. Ignored if `segments` is given."),
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

      // Session setup
      const useSession = DEFAULTS.enable_index
      let sessionDir: string | null = null
      let manifest: SessionManifest | null = null
      if (useSession) {
        // Hash the video ONCE and derive sessionDir from it; the previous form
        // computed the hash twice (once inside getSessionDir, once for the
        // fallback createManifest path), re-reading the head of the file twice
        // on every cache miss.
        const videoHash = computeVideoHash(safePath)
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
        const frames = lookupTimestampsInManifest(manifest, params.view, frameFormat)
        const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = []
        if (resolved.source && !params.skip_metadata) content.push({ type: "text", text: `## Source\n${JSON.stringify(resolved.source, null, 2)}` })
        content.push({ type: "text", text: `## Cache lookup: ${frames.length}/${params.view.length} timestamps found` })
        if (params.narrative_mode) {
          content.push({ type: "text", text: NARRATIVE_GUIDANCE })
          if (resolution <= 512) content.push({ type: "text", text: LOW_TIER_HEDGE_HINT })
        }
        for (const f of frames) {
          content.push({ type: "text", text: `### Frame at ${f.timestamp}` })
          if (f.image) content.push({ type: "image", data: f.image, mimeType: f.mimeType ?? frameMime })
        }
        return { content: content as any }
      }

      const metadata = await getVideoMetadata(safePath)

      // Auto-budget: apply safe view_sample if caller omitted and not using segments
      let effectiveViewSample = params.view_sample
      if (!effectiveViewSample && !params.segments) {
        effectiveViewSample = autoBudgetViewSample(resolution)
      }

      const fps = deriveFps({
        fps: params.fps,
        view_sample: effectiveViewSample,
        start_time: params.start_time,
        end_time: params.end_time,
        segments: params.segments,
        duration_seconds: metadata.duration_seconds,
      })

      const workDir = join(tmpdir(), `lumiere-${Date.now()}`)
      mkdirSync(workDir, { recursive: true })

      const roiCrop = resolveRoi(params.roi, manifest)

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
      }

      let framesPromise: Promise<Frame[]>
      if (params.segments && params.segments.length > 0) {
        const extractDir = useSession ? join(sessionDir!, "frames", frameFormat) : join(workDir, "frames")
        framesPromise = extractFramesBySegments(safePath, params.segments as Segment[], extractDir, frameFormat, roiCrop ?? undefined)
          .then((sf: SegmentFrame[]) => {
            if (useSession && manifest && !params.skip_cached) {
              for (const f of sf) {
                if (!f.sourcePath) continue
                const cacheKey = frameCacheKey(String(f.resolution), frameFormat)
                manifest = mergeFrames(manifest!, cacheKey, [{ timestamp: f.timestamp, file: f.sourcePath }])
              }
            }
            return sf
          })
      } else if (adaptiveSegs.length > 0) {
        // Route adaptive segments through the existing segments extraction path.
        const extractDir = useSession ? join(sessionDir!, "frames", frameFormat) : join(workDir, "frames")
        const segs: Segment[] = adaptiveSegs.map(s => ({
          start: s.start,
          end: s.end,
          fps: s.fps,
          resolution,
        }))
        framesPromise = extractFramesBySegments(safePath, segs, extractDir, frameFormat, roiCrop ?? undefined)
          .then((sf: SegmentFrame[]) => {
            if (useSession && manifest && !params.skip_cached) {
              for (const f of sf) {
                if (!f.sourcePath) continue
                const cacheKey = frameCacheKey(String(f.resolution), frameFormat)
                manifest = mergeFrames(manifest!, cacheKey, [{ timestamp: f.timestamp, file: f.sourcePath }])
              }
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
            const cacheKey = frameCacheKey(resolution, frameFormat)
            const resDir = join(sessionDir, "frames", frameFormat, String(resolution))
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
        const audioDir = join(workDir, "audio")
        audioPromise = extractAudio(safePath, audioDir, {
          startTime: params.start_time, endTime: params.end_time,
        }).then(wav => transcribeWithWhisper(wav, config.whisper_model))
      } else {
        audioPromise = Promise.resolve({ backend: "none" as const, transcription: [], audio_tags: [], full_analysis: null })
      }

      let [frames, rawAudio] = await Promise.all([framesPromise, audioPromise])

      if (fallback !== null && rawAudio.backend !== "youtube-captions" && rawAudio.backend !== "none") {
        rawAudio = { ...rawAudio, transcription_fallback_reason: fallback }
      }

      const offset = params.start_time ? parseHMS(params.start_time) : 0
      const audio = shiftAudioResult(rawAudio, offset)

      // Apply view_sample (auto-budget or user-supplied)
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
      let runtimeTrimmed = 0
      let runtimeTokensEst = 0
      if (frames.length > 2) {
        const RUNTIME_CAP = 88000
        const PER_FRAME_OVERHEAD = 50  // text headers per frame
        const TEXT_OVERHEAD_BUDGET = 12000  // metadata + manifest + guidance + audio
        let totalImageChars = 0
        for (const f of frames) {
          if (f.image) totalImageChars += f.image.length
        }
        const estimateTokens = (charsBase64: number, frameCount: number) =>
          Math.ceil(charsBase64 / 3.5) + frameCount * PER_FRAME_OVERHEAD + TEXT_OVERHEAD_BUDGET
        runtimeTokensEst = estimateTokens(totalImageChars, frames.length)
        if (runtimeTokensEst > RUNTIME_CAP) {
          // Find how many frames we can keep. Average char count per frame so we
          // can solve for keep_count where avg_chars * keep_count / 3.5 + keep_count * 50 + 12000 < 88000
          const avgChars = totalImageChars / frames.length
          const charsPerToken = 3.5
          const denom = (avgChars / charsPerToken) + PER_FRAME_OVERHEAD
          const keepCount = Math.max(2, Math.floor((RUNTIME_CAP - TEXT_OVERHEAD_BUDGET) / denom))
          if (keepCount < frames.length) {
            const idx = sampleFrameIndices(frames.length, keepCount)
            const kept = idx.map(i => frames[i])
            runtimeTrimmed = frames.length - kept.length
            frames = kept
            // recompute estimate post-trim
            let postChars = 0
            for (const f of frames) if (f.image) postChars += f.image.length
            runtimeTokensEst = estimateTokens(postChars, frames.length)
          }
        }
      }

      if (useSession && manifest && sessionDir) saveManifest(sessionDir, manifest)
      if (!useSession) rmSync(workDir, { recursive: true, force: true })

      const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = []

      // Skip the metadata block by default when narrative_mode is on; the
      // narrative pass benefits from clean frame data more than from the
      // manifest dump (which can eat 30K+ tokens at high fps). Caller can pass
      // skip_metadata=false explicitly to keep it.
      const effectiveSkipMetadata = params.skip_metadata === true
        || (useNarrative && params.skip_metadata === false ? false : useNarrative)

      if (!effectiveSkipMetadata) {
        if (resolved.source) content.push({ type: "text", text: `## Source\n${JSON.stringify(resolved.source, null, 2)}` })
        if (manifest) {
          const summary = summarizeManifest(manifest)
          content.push({ type: "text", text: `## Session Manifest\n${JSON.stringify(summary, null, 2)}` })
        }
        const cost = estimateWatchCost({
          resolution,
          fps,
          view_sample: effectiveViewSample,
          duration_seconds: metadata.duration_seconds,
        })
        const narrativeDesc = describeNarrative(narrativeReason)
        const roiDesc = roiCrop
          ? `${roiCrop.x},${roiCrop.y},${roiCrop.w}x${roiCrop.h} (${params.roi === "auto" ? "auto from analyze.subject_bbox" : "explicit"})`
          : "none (full frame)"
        const adaptiveDesc = adaptiveSegs.length > 0
          ? `on (${describeAdaptiveSource(adaptiveReason)})\n${formatAdaptiveSummary(adaptiveSegs)}`
          : describeAdaptiveSource(adaptiveReason)
        const fpsDesc = adaptiveSegs.length > 0
          ? `varies per segment (${Math.min(...adaptiveSegs.map(s => s.fps)).toFixed(2)}-${Math.max(...adaptiveSegs.map(s => s.fps)).toFixed(2)}fps)`
          : String(fps)
        const runtimeTrimDesc = runtimeTrimmed > 0
          ? `\nruntime_trim=YES dropped ${runtimeTrimmed} frame(s) to keep response under ~88K (content was denser than estimator expected). actual_est_tokens=${runtimeTokensEst}`
          : `\nruntime_trim=no actual_est_tokens=${runtimeTokensEst}`
        content.push({
          type: "text",
          text: `## Video Metadata\n${JSON.stringify(metadata, null, 2)}\n\n## Audio Analysis\n${JSON.stringify(audio, null, 2)}\n\n## Budget\nview_sample_applied=${effectiveViewSample ?? "n/a"} fps=${fpsDesc} resolution=${resolution} frame_format=${frameFormat}\nest_tokens_this_call=${cost.est_tokens_per_call} (~${cost.pct_of_1m_window}% of 1M)\nfull_coverage_chunks_needed=${cost.chunks_for_full_coverage} (~${(cost.est_total_tokens_full_coverage / 1000).toFixed(0)}K total tokens)\nautocompact_warning=${cost.will_trigger_autocompact ? "YES - full coverage would exceed " + AUTOCOMPACT_THRESHOLD + " tokens" : "no"}\nnarrative_mode=${narrativeDesc}\nroi=${roiDesc}\nadaptive_sampling=${adaptiveDesc}${runtimeTrimDesc}`,
        })
      }

      // Truncation auto-suggest: when fewer frames came back than requested,
      // the MCP cap killed the response mid-stream. Tell the caller exactly
      // where to resume at the same fps.
      if (effectiveViewSample && frames.length < effectiveViewSample && frames.length > 0) {
        const lastTs = frames[frames.length - 1].timestamp
        const coveredSec = parseHMS(lastTs)
        const requestedEndSec = params.end_time ? parseHMS(params.end_time) : metadata.duration_seconds
        const nextStartHms = formatHMSPrecise(coveredSec, 3)
        const remainingSec = requestedEndSec - coveredSec
        content.push({
          type: "text",
          text: `## Truncation hint\nReceived ${frames.length}/${effectiveViewSample} frames; output hit the MCP per-call cap mid-stream at timestamp ${lastTs}. To cover the remaining ${remainingSec.toFixed(2)}s at the SAME fps (preserving temporal resolution), retry with start_time=${nextStartHms} end_time=${params.end_time ?? "[original end]"}. DO NOT drop to a coarser fps; narrow the window instead.`,
        })
      }

      if (useNarrative) {
        content.push({ type: "text", text: NARRATIVE_GUIDANCE })
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
