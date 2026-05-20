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
import type { AudioResult, Frame, Segment, SessionManifest, SegmentFrame } from "../types.js"

const HMS_REGEX = /^\d{2}:\d{2}:\d{2}$/
// view= accepts the sub-second timestamps that the session manifest emits
// (e.g. 00:00:09.343 from adaptive_sampling motion windows). lookupTimestamps
// normalizes numerically so format mismatches with cached ints still match
// within MATCH_EPSILON (tighter than 100ms so two adjacent frames in a dense
// adaptive segment don't collide; loose enough to bridge HH:MM:SS vs .000).
const HMS_VIEW_REGEX = /^\d{2}:\d{2}:\d{2}(\.\d+)?$/
const MATCH_EPSILON = 0.05

// Sampling-gap-warning thresholds (empirically tuned 2026-05-20 on the Claude
// conference promo: adaptive_sampling put 64% of budget into 3% of timeline
// and missed two headphone equip/unequip events outside the motion window).
const GAP_WARN_BUDGET_RATIO = 0.6
const GAP_WARN_DURATION_RATIO = 0.3

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

### Detail bar (apply to every narrative)

Specificity is non-negotiable. The reader should be able to picture each moment without ever seeing the video.

- **Name the SPECIFIC type of every prop, garment, or object.** Not "a hat", but "a wide-brimmed pointed wizard hat in deep purple with a yellow crescent-moon decal". Not "a tool", but "a circular saw blade, raised above the head". When you cannot identify the species/type, say "X-like object" and describe its silhouette so a reader can guess.
- **Quote ALL visible text verbatim.** Wordmarks, captions, subtitles, UI labels, tooltips, code snippets, numeric values, units. Read it character-for-character. If a number changes across frames, list every value with timestamps.
- **Note color in named shades when distinguishable.** Not "blue", but "indigo / sky blue / royal blue / navy" as fits. Hex codes if the tier supports them (max=1536px).
- **Track START state and END state of each feature channel separately.** Begin: "eyes closed, no headgear, hands tucked." End: "eyes glowing red, headgear equipped, hands raised."
- **Identify LOOPS and REPEATS.** If an action cycle starts again (e.g. the mascot lands, then immediately leaps again at the end of the clip), say so explicitly with both timestamps.
- **Identify SCENE/EXAMPLE BOUNDARIES** in tutorial / multi-example videos. ("First example uses an airplane icon", "second example uses the text '47m'"). Each example is a discrete demonstration; name them separately.
- **Resist generic verbs.** Replace "moves", "does something", "appears" with specific actions: "slides 40px to the left", "fades in over 4 frames", "the blur radius increases from 0 to ~12px".

### Specific priors (apply before committing to a verb)

- **Branded character = fixed identity, BUT costumes/props ARE binary state changes.** If the subject is a branded mascot/product/character, your DEFAULT hypothesis is: this is the SAME character across all frames. Identity-swap is a last-resort interpretation. HOWEVER, costumes / accessories / held-props ARE valid state changes, track them as discrete on/off events with start and end timestamps, not as per-frame pose oscillations. A red mass that appears on top of the head and STAYS for N frames is HEADGEAR EQUIPPED, not a "windswept hair pose."

- **Mascot + wordmark + plain background is the canonical animation setup, NOT a static "title card" by default.** If the layout is mascot-above-wordmark (or wordmark-above-mascot) on a flat background, and you see ANY pose / silhouette / position difference across frames, that is an ANIMATION. The composition does not become static just because the wordmark stays put. Resist the urge to label early frames "title card" and late frames "title card" if the mascot moved between them. Read the SAME WORDMARK as background, the mascot as foreground action. Treat each motion-window frame as an action beat, not a duplicate.

- **Cape / wings / cloak detection.** If a darker / different-shade mass appears symmetrically on BOTH sides of the body silhouette (visible left-of-body AND right-of-body extending outward) and this mass was absent in earlier frames, that is a **CAPE EQUIPPED** or **WINGS DEPLOYED** state, not "wider sprite" or "different character variant." Track equip + remove timestamps. The cape may have its own shading (often darker than the body proper) so don't read the shade difference as a separate object.

- **Hover / flight detection.** If the body baseline moves UP relative to a fixed anchor (wordmark, ground, frame edge) AND a cape/wings state is active, the mascot is FLYING / HOVERING. If a particle stream (small dots, plume, beam) emerges from BELOW the body or behind it while elevated, that is THRUST / PROPULSION / DOWNWARD EMISSION. List candidate verbs in order: hovers, levitates, flies, takes off. Pick "hovers" if the elevation persists across frames; "leaps/takes off" if elevation only appears in one frame.

- **Downward streams from the eye region during hover.** If the mascot is elevated AND a vertical line / column / plume extends downward from the eye-line (or from the body during a hover pose), inspect for color match with novel-palette events. A red/orange/pink column extending DOWN through the body during a hover beat is most likely **EMISSION-FROM-EYES (downward laser/beam)** that passes the body silhouette on its way down. Compare with the silent-baseline frames: if the column color is NOT present in non-hover frames, it is an emission event, not body anatomy.

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
4. **Sampling-gap audit.** Read the budget block to know what coverage you actually have. If "runtime_trim=YES policy=motion-aware", the dense action moments WERE preserved (motion frames are kept first, static bookends even-spaced). In that case your claims about ACTION are well-supported; provisional flags are only needed for SILENT-CHANNEL claims (background detail persistence, peripheral wordmark stability) within static-segment gaps. If "runtime_trim=YES policy=uniform" (no motion segments) OR "runtime_trim=no" with a sampling_gap_warning block, then equip/unequip and other silhouette-area events outside the motion_window may have been missed; flag PROVISIONAL on "feature X stayed constant" claims. Use the dropped_timestamps list in the budget to know exactly which moments are unverified.

Revise any verb where the audit surfaces doubt. A flagged hedge is more useful than a confident wrong attribution.

The subject can be anything: a person, animation, UI element, product, animal, sports moment, cooking step. Adapt your verbs to what is actually happening. Your job is to recover the temporal narrative, not catalog the frames.`

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
      view: z.array(z.string().regex(HMS_VIEW_REGEX)).optional().describe("Look up specific timestamps from session cache (requires enable_index=true and at least one prior watch/analyze call). Accepts HH:MM:SS or HH:MM:SS.fff (matches the sub-second precision the manifest emits). Bypasses extraction."),
      narrative_mode: z.boolean().optional().describe("Inject temporal-narrative guidance into the response so Claude reads frames as a continuous action sequence (anchors/changes/actions) rather than as independent images. Recommended for action/motion-heavy segments. Auto-suggested when analyze() reports high motion or dense scene cuts."),
      roi: z.union([z.literal(ROI_AUTO), z.literal(ROI_PER_WINDOW), z.string().regex(/^\d+,\d+,\d+,\d+$/)]).optional().describe("Crop frames to a region of interest before scaling. 'auto' uses a single global analyze().subject_bbox. 'per-window' assigns each motion-window's frames its OWN bbox from analyze().window_bboxes - tracks a traveling subject so each window's pixels land tight on the subject even when the subject moves across the frame (requires adaptive_sampling and prior analyze with motion=true). 'x,y,w,h' is an explicit pixel bbox. ROI crop gives the subject the full target resolution instead of being averaged out by background pixels."),
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
        const extractDir = useSession ? join(sessionDir!, "frames", frameFormat) : join(workDir, "frames")
        framesPromise = extractFramesBySegments(safePath, params.segments as Segment[], extractDir, frameFormat, roiCrop ?? undefined)
          .then((sf: SegmentFrame[]) => {
            if (useSession && manifest && !params.skip_cached) {
              for (const f of sf) {
                if (!f.sourcePath) continue
                const cacheKey = frameCacheKey(String(f.resolution), frameFormat, globalRoiBucket)
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
          crop: s.crop,
        }))
        framesPromise = extractFramesBySegments(safePath, segs, extractDir, frameFormat, roiCrop ?? undefined)
          .then((sf: SegmentFrame[]) => {
            if (useSession && manifest && !params.skip_cached) {
              for (const f of sf) {
                if (!f.sourcePath) continue
                const segBucket = f.crop ? roiBucketKey(f.crop) : globalRoiBucket
                const cacheKey = frameCacheKey(String(f.resolution), frameFormat, segBucket)
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
          const avgChars = totalImageChars / frames.length
          const charsPerToken = 3.5
          const denom = (avgChars / charsPerToken) + PER_FRAME_OVERHEAD
          const keepCount = Math.max(2, Math.floor((RUNTIME_CAP - TEXT_OVERHEAD_BUDGET) / denom))
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
            // Second-pass safety net: motion frames may average larger than static
            // bookends, so the keepCount derived from the global average can
            // overshoot. Re-measure post-pick and drop further if still over.
            const measure = (fs: typeof frames): number => {
              let chars = 0
              for (const f of fs) if (f.image) chars += f.image.length
              return estimateTokens(chars, fs.length)
            }
            while (measure(kept) > RUNTIME_CAP && kept.length > 2) {
              const idx = sampleFrameIndices(kept.length, kept.length - 1)
              kept = idx.map(i => kept[i])
            }
            const keptSet = new Set(kept.map(f => f.timestamp))
            runtimeTrimDropped = preTrimTimestamps.filter(t => !keptSet.has(t))
            runtimeTrimmed = frames.length - kept.length
            frames = kept
            runtimeTokensEst = measure(frames)
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
        const fpsDesc = adaptiveSegs.length > 0
          ? `varies per segment (${Math.min(...adaptiveSegs.map(s => s.fps)).toFixed(2)}-${Math.max(...adaptiveSegs.map(s => s.fps)).toFixed(2)}fps)`
          : String(fps)
        const keptListing = runtimeTrimmed > 0
          ? `\n  policy=${runtimeTrimPolicy} (${runtimeTrimPolicy === "motion-aware" ? "preserved motion-window frames first, even-spaced static bookends against remaining budget" : "even-spaced over all frames; no motion segments available to prioritize"})\n  kept_timestamps=${JSON.stringify(frames.map(f => f.timestamp))}\n  dropped_timestamps=${JSON.stringify(runtimeTrimDropped)}`
          : ""
        const runtimeTrimDesc = runtimeTrimmed > 0
          ? `\nruntime_trim=YES dropped ${runtimeTrimmed} frame(s) (NOT a trailing MCP-cap drop) to keep response under ~88K. actual_est_tokens=${runtimeTokensEst}${keptListing}`
          : `\nruntime_trim=no actual_est_tokens=${runtimeTokensEst}`
        content.push({
          type: "text",
          text: `## Video Metadata\n${JSON.stringify(metadata, null, 2)}\n\n## Audio Analysis\n${JSON.stringify(audio, null, 2)}\n\n## Budget\nview_sample_applied=${effectiveViewSample ?? "n/a"} fps=${fpsDesc} resolution=${resolution} frame_format=${frameFormat}\nest_tokens_this_call=${cost.est_tokens_per_call} (~${cost.pct_of_1m_window}% of 1M)\nfull_coverage_chunks_needed=${cost.chunks_for_full_coverage} (~${(cost.est_total_tokens_full_coverage / 1000).toFixed(0)}K total tokens)\nautocompact_warning=${cost.will_trigger_autocompact ? "YES - full coverage would exceed " + AUTOCOMPACT_THRESHOLD + " tokens" : "no"}\nnarrative_mode=${narrativeDesc}\nroi=${roiDesc}\nadaptive_sampling=${adaptiveDesc}${runtimeTrimDesc}`,
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
          content.push({
            type: "text",
            text: truncationHintMcpCap({
              delivered: frames.length,
              requested: effectiveViewSample,
              lastTs,
              remainingSec: requestedEndSec - coveredSec,
              nextStartHms: formatHMSPrecise(coveredSec, 3),
              endLabel: params.end_time ?? "[original end]",
            }),
          })
        }
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
