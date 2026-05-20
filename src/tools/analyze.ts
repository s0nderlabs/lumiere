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
import { detectSubjectBboxViaCC } from "../extractors/bbox.js"
import { loadManifest, saveManifest, computeVideoHash } from "../session/manager.js"
import { createManifest } from "../session/manifest.js"
import { detectLowConfidenceTranscript } from "../utils/hallucination.js"
import { parseHMS } from "../utils/timestamps.js"
import { mapWithConcurrency } from "../utils/concurrency.js"
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
        const ffFilters: AnalysisFilters = { ...filters, transcription: false }
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
          if (filters.exposure && metaContent !== null) {
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
        if (filters.exposure && analysis.frame_stats.length >= 8) {
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
            const ccBbox = await detectSubjectBboxViaCC(safePath, metadata.width, metadata.height, workDir)
            if (ccBbox) return ccBbox
            const bboxCmd = buildSubjectBboxCommand(safePath)
            try {
              const r = await execFileAsync("ffmpeg", bboxCmd.args, { timeout: 600_000, maxBuffer: 100 * 1024 * 1024 })
              const bbox = parseCropdetectOutput(r.stderr, metadata.width, metadata.height)
              return bbox ? { ...bbox, method: "cropdetect-fallback" as const } : null
            } catch (err: any) {
              const bbox = parseCropdetectOutput(err.stderr || "", metadata.width, metadata.height)
              return bbox ? { ...bbox, method: "cropdetect-fallback" as const } : null
            }
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
            ar = await transcribeWithWhisper(wav, config.whisper_model)
          } else {
            ar = { backend: "none", transcription: [], audio_tags: [], full_analysis: null }
          }

          if (fallback !== null && ar.backend !== "youtube-captions" && ar.backend !== "none") {
            ar = { ...ar, transcription_fallback_reason: fallback }
          }

          analysis.transcription = ar.transcription
          analysis.transcription_backend = ar.backend

          // T4/T12 mitigation: flag low-confidence transcripts via multi-signal heuristic.
          const check = detectLowConfidenceTranscript(
            ar.transcription,
            metadata.duration_seconds,
            analysis.loudness_summary?.mean_lufs,
          )
          if (check.flagged) {
            analysis.transcription_low_confidence = true
            analysis.transcription_low_confidence_reasons = check.reasons
            // Suppress the hallucinated text entirely. Otherwise whisper's
            // music-on-silence credits ("ご視聴ありがとうございました" and
            // friends) leak through even with low_confidence set, and a caller
            // could mistake them for real audio.
            const span = ar.transcription.length > 0 ? {
              start: ar.transcription[0].start,
              end: ar.transcription[ar.transcription.length - 1].end,
            } : { start: "00:00:00", end: "00:00:00" }
            analysis.transcription = [{
              start: span.start,
              end: span.end,
              text: "[low confidence: likely silent / music-only audio; whisper output suppressed]",
            }]
          }

          if (ar.warnings?.length) analysis.audio_warnings = ar.warnings
        }

        if (!filters.motion) analysis.content_profile = "unknown (motion filter not enabled)"

        if (DEFAULTS.enable_index) {
          // Compute the video hash once and reuse it for both sessionDir
          // resolution and manifest creation. getSessionDir + createManifest
          // previously each re-opened and re-hashed the file (one disk read +
          // 64 KiB scan apiece).
          const videoHash = computeVideoHash(safePath)
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
