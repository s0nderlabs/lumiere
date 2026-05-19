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
import { getSessionDir, loadManifest, saveManifest, computeVideoHash } from "../session/manager.js"
import { createManifest } from "../session/manifest.js"
import { detectLowConfidenceTranscript } from "../utils/hallucination.js"
import type { AnalysisFilters, VideoAnalysis, AudioResult } from "../types.js"

const execFileAsync = promisify(execFile)

export function registerAnalyze(server: McpServer): void {
  server.tool(
    "analyze",
    "Analyze video structure with ffmpeg filters. Returns scene changes, silence intervals, motion levels, transcript, plus v0.4 fields: subject_motion (center-crop motion that catches small-subject high-motion the global siti misses), palette_outliers (one-off color events that catch lasers/projectiles/flashes). Use before `watch` to plan which segments need detailed frame extraction. Does NOT extract frames. Long videos trigger audio chunking; warnings (if any) appear in analysis.audio_warnings.",
    {
      path: z.string().describe("Local path or any URL supported by yt-dlp"),
      filters: z.object({
        scene_changes: z.boolean().default(false).describe("Detect scene cuts (scdet)"),
        black_intervals: z.boolean().default(false).describe("Detect black frames/transitions (blackdetect)"),
        silence: z.boolean().default(false).describe("Detect silence intervals (silencedetect)"),
        freeze: z.boolean().default(false).describe("Detect frozen/still segments (freezedetect)"),
        motion: z.boolean().default(false).describe("Measure visual complexity + motion level (siti). v0.4: also runs a center-crop pass for subject-region motion."),
        blur: z.boolean().default(false).describe("Measure blur/sharpness per frame (blurdetect)"),
        exposure: z.boolean().default(false).describe("Measure brightness + saturation per frame (signalstats). v0.4: also drives palette_outliers detection."),
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

          if (filters.scene_changes && existsSync(cmd.videoMetaFile)) {
            const c = readFileSync(cmd.videoMetaFile, "utf-8")
            analysis.scenes = parseScdetFromMetaFile(c)
            if (analysis.scenes.length === 0) analysis.scenes = parseScdetOutput(stderr)
          } else if (filters.scene_changes) {
            analysis.scenes = parseScdetOutput(stderr)
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
          if (filters.blur && existsSync(cmd.videoMetaFile)) {
            const c = readFileSync(cmd.videoMetaFile, "utf-8")
            const data = parseBlurOutput(c)
            for (const e of data) {
              const ex = analysis.frame_stats.find(f => f.timestamp === e.timestamp)
              if (ex) ex.blur = e.blur
              else analysis.frame_stats.push({ timestamp: e.timestamp, blur: e.blur })
            }
          }
          if (filters.exposure && existsSync(cmd.videoMetaFile)) {
            const c = readFileSync(cmd.videoMetaFile, "utf-8")
            const data = parseSignalstatsOutput(c)
            for (const e of data) {
              const ex = analysis.frame_stats.find(f => f.timestamp === e.timestamp)
              if (ex) { ex.brightness = e.brightness; ex.saturation = e.saturation }
              else analysis.frame_stats.push(e as any)
            }
          }
          analysis.frame_stats.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
        }

        // v0.4: subject-region motion pass. Always runs if filters.motion is true,
        // so we catch the "global motion looks low but the mascot is moving rapidly"
        // case that bit the V1 test. Cheap second ffmpeg invocation; can skip if motion
        // filter wasn't requested.
        if (filters.motion) {
          const cm = buildCentralMotionCommand(safePath)
          try {
            const r = await execFileAsync("ffmpeg", cm.args, { timeout: 600_000, maxBuffer: 100 * 1024 * 1024 })
            const sub = parseSitiOutput(r.stderr)
            analysis.subject_motion = { siAvg: sub.siAvg, tiAvg: sub.tiAvg }
          } catch (err: any) {
            // Fall through; subject_motion stays undefined. Don't fail the whole analyze.
            const sub = parseSitiOutput(err.stderr || "")
            if (sub.siAvg !== undefined || sub.tiAvg !== undefined) {
              analysis.subject_motion = { siAvg: sub.siAvg, tiAvg: sub.tiAvg }
            }
          }
          analysis.has_motion = hasMotion(
            analysis.motion_summary ?? {},
            analysis.subject_motion ?? {},
          )
        }

        // v0.4: palette novelty pass. v0.5: now uses hue-based novelty in
        // addition to magnitude novelty, catching the V1 laser case (similar
        // saturation, different hue) that v0.4 missed.
        if (filters.exposure && analysis.frame_stats.length >= 8) {
          analysis.palette_outliers = detectPaletteOutliers(analysis.frame_stats)
        }

        // v0.6: subject bbox detection prefers connected-component segmentation
        // (returns the tightest bbox of the dominant moving blob), falling back
        // to the v0.5 cropdetect approach if CC yields nothing usable. The CC
        // method handles multi-subject videos gracefully (envelope of comparable
        // blobs) and avoids the v0.5 failure mode where mascot+terminal motion
        // unioned into one huge bbox.
        if (filters.motion) {
          const ccBbox = await detectSubjectBboxViaCC(safePath, metadata.width, metadata.height, workDir)
          if (ccBbox) {
            analysis.subject_bbox = ccBbox
          } else {
            const bboxCmd = buildSubjectBboxCommand(safePath)
            try {
              const r = await execFileAsync("ffmpeg", bboxCmd.args, { timeout: 600_000, maxBuffer: 100 * 1024 * 1024 })
              const bbox = parseCropdetectOutput(r.stderr, metadata.width, metadata.height)
              if (bbox) analysis.subject_bbox = { ...bbox, method: "cropdetect-fallback" }
            } catch (err: any) {
              const bbox = parseCropdetectOutput(err.stderr || "", metadata.width, metadata.height)
              if (bbox) analysis.subject_bbox = { ...bbox, method: "cropdetect-fallback" }
            }
          }
        }

        // v0.6: motion windows for adaptive sampling. Detects time intervals
        // where temporal motion (siti ti) is above the video's global median,
        // so watch can allocate more frames to action moments and fewer to
        // static spans without changing the total frame budget.
        if (filters.motion && metadata.duration_seconds > 2) {
          const motionMeta = join(workDir, "motion_windows.txt")
          const mwCmd = buildMotionWindowsCommand(safePath, motionMeta)
          try {
            await execFileAsync("ffmpeg", mwCmd.args, { timeout: 600_000, maxBuffer: 100 * 1024 * 1024 })
          } catch {
            // tolerate; ffmpeg may exit non-zero on some inputs but still emit metadata
          }
          if (existsSync(motionMeta)) {
            try {
              const content = readFileSync(motionMeta, "utf-8")
              const windows = parseMotionWindowsFromMetaFile(content, metadata.duration_seconds)
              if (windows.length > 0) analysis.motion_windows = windows
            } catch {
              // ignore parse errors; motion_windows stays unset
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
            // v0.4: suppress the hallucinated text entirely. Before, the bogus
            // "ご視聴ありがとうございました" string leaked through even though
            // low_confidence was set. Now it's replaced with a placeholder so the
            // caller can't accidentally treat it as real audio content.
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
          const sessionDir = getSessionDir(SESSIONS_DIR, safePath)
          let manifest = loadManifest(sessionDir)
          if (!manifest) manifest = createManifest(computeVideoHash(safePath), safePath)
          manifest.analysis = analysis
          saveManifest(sessionDir, manifest)
        }
      } finally {
        rmSync(workDir, { recursive: true, force: true })
      }

      const output = {
        ...(resolved.source ? { source: resolved.source } : {}),
        metadata,
        analysis,
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }] }
    },
  )
}
