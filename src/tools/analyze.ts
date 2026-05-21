import { execFile } from "child_process"
import { promisify } from "util"
import { z } from "zod"
import { join } from "path"
import { mkdirSync, rmSync, existsSync, readFileSync } from "fs"
import { tmpdir } from "os"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { loadConfig, SESSIONS_DIR } from "../config.js"
import { DEFAULTS } from "../defaults.js"
import {
  buildCaptionAudioResult,
  getCaptionFallbackReason,
  resolveVideoInputDetailed,
} from "../utils/video-source.js"
import { getVideoMetadata } from "../extractors/frames.js"
import { extractAudio } from "../extractors/audio.js"
import { analyzeWithGeminiApi } from "../backends/gemini.js"
import { transcribeWithWhisper } from "../backends/local.js"
import {
  buildAnalysisCommand,
  buildCentralMotionCommand,
  buildSubjectBboxCommand,
  buildMotionWindowsCommand,
  parseScdetOutput,
  parseScdetFromMetaFile,
  parseBlackdetectOutput,
  parseSilenceOutput,
  parseFreezeOutput,
  parseSitiOutput,
  parseBlurOutput,
  parseSignalstatsOutput,
  parseEbur128Output,
  parseCropdetectOutput,
  parseMotionWindowsFromMetaFile,
  deriveContentProfile,
  detectPaletteOutliers,
  hasMotion,
} from "../extractors/analyzers.js"
import { detectSubjectBboxViaCC, centerPriorBbox } from "../extractors/bbox.js"
import { loadManifest, saveManifest, computeVideoHash } from "../session/manager.js"
import { createManifest } from "../session/manifest.js"
import { applyHallucinationGateToAnalysis } from "../utils/hallucination.js"
import { parseHMS, formatHMSPrecise } from "../utils/timestamps.js"
import { mapWithConcurrency } from "../utils/concurrency.js"
import { classifyContent } from "../utils/content-class.js"
import type { AnalysisFilters, VideoAnalysis, AudioResult } from "../types.js"

const execFileAsync = promisify(execFile)

export function registerAnalyze(server: McpServer): void {
  server.tool(
    "analyze",
    "Analyze video structure with ffmpeg filters. Returns scene changes, silence intervals, motion levels, transcript, plus subject_motion (center-crop motion that catches small-subject high-motion the global siti misses), palette_outliers (one-off color events such as lasers/projectiles/flashes), and motion_windows (drives adaptive sampling in watch). Use before `watch` to plan which segments need detailed frame extraction. Does NOT extract frames. Long videos trigger audio chunking; warnings appear in analysis.audio_warnings.",
    {
      path: z.string().describe("Local path or any URL supported by yt-dlp"),
      filters: z.object({
        scene_changes: z.boolean().default(false).describe("Detect scene cuts (scdet)"),
        black_intervals: z.boolean().default(false).describe("Detect black frames/transitions (blackdetect)"),
        silence: z.boolean().default(false).describe("Detect silence intervals (silencedetect)"),
        freeze: z.boolean().default(false).describe("Detect frozen/still segments (freezedetect)"),
        motion: z.boolean().default(false).describe("Measure visual complexity + motion level (siti); also runs a center-crop pass for subject-region motion."),
        blur: z.boolean().default(false).describe("Measure blur/sharpness per frame (blurdetect)"),
        exposure: z.boolean().default(false).describe("Measure brightness + saturation per frame (signalstats); also drives palette_outliers detection."),
        loudness: z.boolean().default(false).describe("Measure audio loudness (ebur128)"),
        transcription: z.boolean().default(false).describe("Transcribe audio using configured backend"),
      }),
    },
    async (params) => {
      const config = loadConfig()
      const resolved = await resolveVideoInputDetailed(params.path)
      const safePath = resolved.path
      const filters = params.filters as AnalysisFilters
      const metadata = await getVideoMetadata(safePath)

      const workDir = join(tmpdir(), `lumiere-analyze-${Date.now()}`)
      mkdirSync(workDir, { recursive: true })

      let analysis: VideoAnalysis = {
        scenes: [], black_intervals: [], silence_intervals: [], freeze_intervals: [],
        frame_stats: [], content_profile: "unknown",
      }

      try {
        // v0.11: auto-enable exposure when motion is enabled. palette_outliers
        // (a key signal for content_class classification, esp. animation
        // detection) is gated behind the exposure filter. Without auto-enable,
        // callers that pass {motion: true} but omit exposure get no palette
        // data and animation falls through to talking-head / generic on
        // motion-graphic content. Cheap: exposure adds ~50ms of signalstats
        // parsing in the same ffmpeg pass.
        const ffFilters: AnalysisFilters = {
          ...filters,
          exposure: filters.exposure || filters.motion,
          transcription: false,
        }
        const cmd = buildAnalysisCommand(safePath, ffFilters, workDir)
        let stderr = ""

        if (cmd !== null) {
          try {
            const r = await execFileAsync("ffmpeg", cmd.args, { timeout: 600_000, maxBuffer: 100 * 1024 * 1024 })
            stderr = r.stderr
          } catch (err: any) {
            stderr = err.stderr || ""
          }

          // scene_changes, blur, exposure all parse the SAME videoMetaFile;
          // read it at most once across the three branches.
          let metaContent: string | null = null
          const needsMeta = filters.scene_changes || filters.blur || filters.exposure
          if (needsMeta && existsSync(cmd.videoMetaFile)) {
            metaContent = readFileSync(cmd.videoMetaFile, "utf-8")
          }
          if (filters.scene_changes) {
            if (metaContent !== null) {
              analysis.scenes = parseScdetFromMetaFile(metaContent)
              if (analysis.scenes.length === 0) analysis.scenes = parseScdetOutput(stderr)
            } else {
              analysis.scenes = parseScdetOutput(stderr)
            }
          }
          if (filters.black_intervals) analysis.black_intervals = parseBlackdetectOutput(stderr)
          if (filters.silence) analysis.silence_intervals = parseSilenceOutput(stderr)
          if (filters.freeze) analysis.freeze_intervals = parseFreezeOutput(stderr)
          if (filters.loudness) {
            const l = parseEbur128Output(stderr)
            if (l) analysis.loudness_summary = l
          }
          if (filters.motion) {
            const s = parseSitiOutput(stderr)
            analysis.content_profile = deriveContentProfile(s.siAvg, s.tiAvg)
            analysis.motion_summary = { siAvg: s.siAvg, tiAvg: s.tiAvg }
          }
          if (filters.blur && metaContent !== null) {
            const data = parseBlurOutput(metaContent)
            // Index frame_stats by timestamp once for O(1) merging instead of O(n*m) find.
            const byTs = new Map<string, typeof analysis.frame_stats[number]>()
            for (const fs of analysis.frame_stats) byTs.set(fs.timestamp, fs)
            for (const e of data) {
              const ex = byTs.get(e.timestamp)
              if (ex) ex.blur = e.blur
              else {
                const row = { timestamp: e.timestamp, blur: e.blur }
                analysis.frame_stats.push(row)
                byTs.set(e.timestamp, row)
              }
            }
          }
          if (ffFilters.exposure && metaContent !== null) {
            const data = parseSignalstatsOutput(metaContent)
            const byTs = new Map<string, typeof analysis.frame_stats[number]>()
            for (const fs of analysis.frame_stats) byTs.set(fs.timestamp, fs)
            for (const e of data) {
              const ex = byTs.get(e.timestamp)
              if (ex) {
                ex.brightness = e.brightness
                ex.saturation = e.saturation
                ex.u_chroma = e.u_chroma
                ex.v_chroma = e.v_chroma
              } else {
                analysis.frame_stats.push(e)
                byTs.set(e.timestamp, e)
              }
            }
          }
          analysis.frame_stats.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
        }

        // Palette novelty pass. Runs off the already-parsed signalstats data
        // (no extra ffmpeg invocation), so it does not need to be parallel
        // with the motion ffmpeg passes below.
        if (ffFilters.exposure && analysis.frame_stats.length >= 8) {
          analysis.palette_outliers = detectPaletteOutliers(analysis.frame_stats)
        }

        // The three motion-only ffmpeg passes (central motion, cc-bbox, motion
        // windows) are independent invocations against the same video. Run them
        // concurrently to cut the motion-phase wall time roughly to a third.
        if (filters.motion) {
          const subjectMotionPromise = (async () => {
            const cm = buildCentralMotionCommand(safePath)
            try {
              const r = await execFileAsync("ffmpeg", cm.args, { timeout: 600_000, maxBuffer: 100 * 1024 * 1024 })
              return parseSitiOutput(r.stderr)
            } catch (err: any) {
              const sub = parseSitiOutput(err.stderr || "")
              return (sub.siAvg !== undefined || sub.tiAvg !== undefined) ? sub : null
            }
          })()

          const bboxPromise = (async () => {
            // Tier 1: connected-component segmentation (cleanest crop, sets
            // confidence ~0.9 when a clean isolated blob exists).
            const ccBbox = await detectSubjectBboxViaCC(safePath, metadata.width, metadata.height, workDir)
            if (ccBbox) return ccBbox
            // Tier 2: cropdetect-based bbox (works when there's a consistent
            // letterbox or border; confidence 0.5 since the crop is loose).
            const bboxCmd = buildSubjectBboxCommand(safePath)
            let cropdetectBbox: ReturnType<typeof parseCropdetectOutput> | null = null
            try {
              const r = await execFileAsync("ffmpeg", bboxCmd.args, { timeout: 600_000, maxBuffer: 100 * 1024 * 1024 })
              cropdetectBbox = parseCropdetectOutput(r.stderr, metadata.width, metadata.height)
            } catch (err: any) {
              cropdetectBbox = parseCropdetectOutput(err.stderr || "", metadata.width, metadata.height)
            }
            if (cropdetectBbox) {
              const tight = cropdetectBbox.area_pct < 85
              // v0.11: full-frame "fallback" used to defeat roi=auto entirely
              // by returning area_pct=100. Now if cropdetect returns near-full-
              // frame, we fall through to the center-prior tier instead.
              if (tight) {
                return { ...cropdetectBbox, method: "cropdetect" as const, confidence: 0.5 }
              }
            }
            // Tier 3: center-weighted prior. Last-resort heuristic when no
            // detector can isolate the subject. confidence=0.2 signals to
            // callers that roi=auto on this bbox is a heuristic crop, not a
            // measured subject. Better than full-frame, which gives no zoom
            // benefit on a small off-center subject.
            return centerPriorBbox(metadata.width, metadata.height)
          })()

          const motionWindowsPromise = (async () => {
            if (metadata.duration_seconds <= 2) return null
            const motionMeta = join(workDir, "motion_windows.txt")
            const mwCmd = buildMotionWindowsCommand(safePath, motionMeta)
            try {
              await execFileAsync("ffmpeg", mwCmd.args, { timeout: 600_000, maxBuffer: 100 * 1024 * 1024 })
            } catch {
              // tolerate; ffmpeg may exit non-zero but still emit metadata
            }
            if (!existsSync(motionMeta)) return null
            try {
              const content = readFileSync(motionMeta, "utf-8")
              const windows = parseMotionWindowsFromMetaFile(content, metadata.duration_seconds)
              return windows.length > 0 ? windows : null
            } catch {
              return null
            }
          })()

          const [subjectMotion, bbox, motionWindows] = await Promise.all([
            subjectMotionPromise,
            bboxPromise,
            motionWindowsPromise,
          ])

          if (subjectMotion) analysis.subject_motion = { siAvg: subjectMotion.siAvg, tiAvg: subjectMotion.tiAvg }
          analysis.has_motion = hasMotion(
            analysis.motion_summary ?? {},
            analysis.subject_motion ?? {},
          )
          if (bbox) analysis.subject_bbox = bbox
          if (motionWindows) {
            analysis.motion_windows = motionWindows
            // Per-window bboxes power watch's roi="per-window". Concurrency
            // capped so action-heavy videos with many windows don't fan out
            // 20+ simultaneous ffmpegs and starve the decoder.
            if (motionWindows.length > 0) {
              analysis.window_bboxes = await mapWithConcurrency(motionWindows, 4, async (w) => {
                if (parseHMS(w.end) - parseHMS(w.start) < 1) return null
                try {
                  return await detectSubjectBboxViaCC(
                    safePath,
                    metadata.width,
                    metadata.height,
                    workDir,
                    { startTime: w.start, endTime: w.end },
                  )
                } catch {
                  return null
                }
              })
            }
          }

          // v0.11: subject-region motion_windows pass. When a bbox exists AND
          // the global windows look unreliable (none, OR they don't cover the
          // middle 50% of the video), re-run motion windows scoped to the bbox
          // crop. Replaces the global windows array so adaptive_sampling
          // biases toward subject activity instead of background noise.
          //
          // Why "middle not covered" instead of "all at boundaries": a video
          // can have one stray motion blip in the middle (background door
          // opening, light flicker) that defeats the strict "every window at
          // boundary" check while still leaving the actual subject action
          // unmapped. The middle-coverage test catches the deadlift failure
          // mode: subject's walk-in/walk-out registers as motion (windows at
          // boundaries) but the actual lift in the middle 60% of the video
          // is below the global threshold.
          if (bbox && (bbox.confidence ?? 0) >= 0.2 && metadata.duration_seconds > 5) {
            const globalEmpty = !motionWindows || motionWindows.length === 0
            const middleStart = metadata.duration_seconds * 0.25
            const middleEnd = metadata.duration_seconds * 0.75
            const middleCovered = motionWindows && motionWindows.length > 0
              ? motionWindows.some(w => {
                  const s = parseHMS(w.start)
                  const e = parseHMS(w.end)
                  return e > middleStart && s < middleEnd
                })
              : false
            const shouldDeriveSubjectMotion = globalEmpty || !middleCovered
            if (shouldDeriveSubjectMotion) {
              // Tier 1: subject-region siti. Works when subject motion has
              // discrete peaks (e.g., a basketball dunk, a kettlebell swing,
              // any explosive movement).
              let subjectWindows: Array<{ start: string; end: string; intensity: number; coverage_score?: number }> = []
              try {
                const subjMotionMeta = join(workDir, "subject_motion_windows.txt")
                const cmd = buildMotionWindowsCommand(safePath, subjMotionMeta, {
                  x: bbox.x, y: bbox.y, w: bbox.w, h: bbox.h,
                })
                try {
                  await execFileAsync("ffmpeg", cmd.args, { timeout: 600_000, maxBuffer: 100 * 1024 * 1024 })
                } catch {
                  // tolerate; metadata may still exist
                }
                if (existsSync(subjMotionMeta)) {
                  const content = readFileSync(subjMotionMeta, "utf-8")
                  subjectWindows = parseMotionWindowsFromMetaFile(content, metadata.duration_seconds)
                }
              } catch {
                // tier 1 failed; fall through to tier 2
              }
              if (subjectWindows.length > 0) {
                analysis.motion_windows = subjectWindows
                analysis.motion_detection_warning = `Global motion_windows did not cover the middle 50% of the video; re-derived ${subjectWindows.length} motion_windows from subject-region crop (bbox method=${bbox.method}, confidence=${bbox.confidence?.toFixed(2)}, fps=10 siti on crop) for accurate action-time detection.`
              } else if (analysis.subject_motion && (analysis.subject_motion.tiAvg ?? 0) > 15) {
                // Tier 2: siti found no peaks (slow continuous motion like a
                // deadlift, yoga flow, plank, slow camera pan). subject_motion
                // shows the subject IS moving above background, just not in
                // peak-bursty patterns. Synthesize a single "middle 60%" window
                // as best-guess action span. adaptive_sampling will bias
                // toward this window instead of the boundary noise.
                const synthStart = formatHMSPrecise(metadata.duration_seconds * 0.2, 3)
                const synthEnd = formatHMSPrecise(metadata.duration_seconds * 0.8, 3)
                analysis.motion_windows = [{
                  start: synthStart,
                  end: synthEnd,
                  intensity: analysis.subject_motion.tiAvg ?? 30,
                  coverage_score: 0.5,
                }]
                analysis.motion_detection_warning = `Global motion_windows clustered at boundaries (entry/exit registered, not subject action). Subject-region siti found no peaked windows (typical for slow continuous motion like deadlifts/yoga/plank). Synthesized a single middle-60% action window (${synthStart}-${synthEnd}, intensity=subject_ti=${(analysis.subject_motion.tiAvg ?? 0).toFixed(1)}) as best-guess action span. adaptive_sampling will bias toward this window; pass adaptive_sampling=false to opt out, or use explicit segments=[{start, end, fps}] for hand-picked time windows.`
              } else {
                // Tier 3: no signal anywhere. Keep globals; just warn the caller.
                analysis.motion_detection_warning = `Global motion_windows are boundary-clustered (entry/exit only). Subject-region siti returned no peaks AND subject_motion.tiAvg is below activity threshold. This video has no detectable subject action; adaptive_sampling will bias toward the boundary noise. Consider adaptive_sampling=false or explicit segments=[...] for hand-picked time windows.`
              }
            }
          }
        }

        if (filters.transcription && metadata.has_audio) {
          let ar: AudioResult
          const fallback = resolved.source ? getCaptionFallbackReason(resolved.captions, metadata.duration_seconds) : null

          if (fallback === null && resolved.captions) {
            ar = buildCaptionAudioResult(resolved.captions)
          } else if (config.backend === "gemini-api") {
            ar = await analyzeWithGeminiApi(safePath)
          } else if (config.backend === "local") {
            const wav = await extractAudio(safePath, join(workDir, "audio"))
            // v0.10.2: analyze has already computed loudness above. Pass it
            // as cachedMeanLufs so whisper skips the redundant volumedetect.
            ar = await transcribeWithWhisper(wav, config.whisper_model, {
              cachedMeanLufs: analysis.loudness_summary?.mean_lufs,
            })
          } else {
            ar = { backend: "none", transcription: [], audio_tags: [], full_analysis: null }
          }

          if (fallback !== null && ar.backend !== "youtube-captions" && ar.backend !== "none") {
            ar = { ...ar, transcription_fallback_reason: fallback }
          }

          analysis.transcription = ar.transcription
          analysis.transcription_backend = ar.backend
          if (ar.transcription_skipped_reason) {
            analysis.transcription_skipped_reason = ar.transcription_skipped_reason
          }

          applyHallucinationGateToAnalysis(analysis, metadata.duration_seconds)

          if (ar.warnings?.length) analysis.audio_warnings = ar.warnings
        }

        if (!filters.motion) analysis.content_profile = "unknown (motion filter not enabled)"

        // v0.11: structured content_class for narrative-profile routing + per-
        // class TPF lookups. Runs off signals already extracted (motion summary,
        // subject_motion, scenes, palette outliers, subject_bbox, transcription
        // LC); no extra ffmpeg passes. When motion filter is off we still emit
        // a "generic" class so watch() routes don't break.
        if (filters.motion) {
          const cls = classifyContent({
            motion_summary: analysis.motion_summary,
            subject_motion: analysis.subject_motion,
            scenes_count: analysis.scenes.length,
            duration_seconds: metadata.duration_seconds,
            palette_outliers_count: analysis.palette_outliers?.length ?? 0,
            subject_bbox_method: analysis.subject_bbox?.method,
            subject_bbox_area_pct: analysis.subject_bbox?.area_pct,
            subject_bbox_confidence: analysis.subject_bbox?.confidence,
            loudness_lufs: analysis.loudness_summary?.mean_lufs,
            transcription_low_confidence: analysis.transcription_low_confidence,
          })
          analysis.content_class = cls.content_class
          analysis.content_class_reasons = cls.reasons
        } else {
          analysis.content_class = "generic"
          analysis.content_class_reasons = ["motion filter not enabled; defaulting to generic class"]
        }

        // v0.11: motion_detection_warning. Surface when global motion_windows
        // cluster at video boundaries only (typical failure mode for fixed-
        // camera videos with off-center small subjects: subject's walk-in /
        // walk-out registers as motion but the actual action between does not).
        if (analysis.motion_windows && analysis.motion_windows.length > 0 && metadata.duration_seconds > 10) {
          const boundary = Math.max(5, metadata.duration_seconds * 0.15)
          const allAtBoundaries = analysis.motion_windows.every(w => {
            const s = parseHMS(w.start)
            const e = parseHMS(w.end)
            return e < boundary || s > metadata.duration_seconds - boundary
          })
          if (allAtBoundaries) {
            analysis.motion_detection_warning = `All motion_windows fall within the first/last ${boundary.toFixed(1)}s of the video. For fixed-camera footage with an off-center subject in a busy background (common in fitness/sports content), this typically means the subject's entry/exit registered as motion but the actual action did not. adaptive_sampling will bias toward the boundaries; consider adaptive_sampling=false or explicit segments for the action window.`
          }
        }

        if (DEFAULTS.enable_index) {
          // Compute the video hash once and reuse it for both sessionDir
          // resolution and manifest creation. getSessionDir + createManifest
          // previously each re-opened and re-hashed the file (one disk read +
          // 64 KiB scan apiece).
          const videoHash = computeVideoHash(safePath, { duration: metadata.duration_seconds })
          const sessionDir = join(SESSIONS_DIR, videoHash)
          let manifest = loadManifest(sessionDir)
          if (!manifest) manifest = createManifest(videoHash, safePath)
          manifest.analysis = analysis
          saveManifest(sessionDir, manifest)
        }
      } finally {
        rmSync(workDir, { recursive: true, force: true })
      }

      // Decimate frame_stats for the MCP response. At 60fps source for a 20s+
      // video the per-frame stats balloon past the 100K MCP cap (1200+ entries
      // x ~150 bytes each). Callers don't need raw per-frame; they need the
      // structural fields (motion_windows, palette_outliers, scenes,
      // silence_intervals) and a sense of the brightness/saturation curve.
      // Keep the full frame_stats in the saved manifest for internal use.
      const FRAME_STATS_SOFT_CAP = 60
      let analysisOut: VideoAnalysis = analysis
      if (analysis.frame_stats.length > FRAME_STATS_SOFT_CAP) {
        const step = Math.max(1, Math.floor(analysis.frame_stats.length / FRAME_STATS_SOFT_CAP))
        const decimated = analysis.frame_stats.filter((_, i) => i % step === 0).slice(0, FRAME_STATS_SOFT_CAP)
        analysisOut = {
          ...analysis,
          frame_stats: decimated,
          frame_stats_decimated: {
            original_count: analysis.frame_stats.length,
            kept_count: decimated.length,
            note: `frame_stats decimated for MCP response (1-in-${step} sample). Full per-frame data is in the saved session manifest.`,
          },
        } as VideoAnalysis & { frame_stats_decimated: unknown }
      }
      const output = {
        ...(resolved.source ? { source: resolved.source } : {}),
        metadata,
        analysis: analysisOut,
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }] }
    },
  )
}
