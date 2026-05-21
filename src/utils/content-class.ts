import type { ContentClass } from "../types.js"

// Inputs for content-class classification. All values derived from analyze()
// signals already extracted — no extra ffmpeg passes. Optional fields tolerate
// partial analyze() runs (e.g., motion-only filter set).
export interface ClassifyInputs {
  motion_summary?: { siAvg?: number; tiAvg?: number }
  subject_motion?: { siAvg?: number; tiAvg?: number }
  scenes_count: number
  duration_seconds: number
  palette_outliers_count: number
  subject_bbox_method?: string
  subject_bbox_area_pct?: number
  subject_bbox_confidence?: number
  loudness_lufs?: number
  transcription_low_confidence?: boolean
  // Most motion concentrated near video boundaries (entry/exit) instead of
  // distributed across the middle. Strong signal for human-motion in busy bg
  // where subject's walk-in/walk-out registers as global motion but the actual
  // action (subject in middle) is below threshold.
  motion_clusters_at_boundaries?: boolean
}

export interface ClassifyResult {
  content_class: ContentClass
  reasons: string[]
}

// Bucket thresholds calibrated against:
//   - V2 ClaudeDevs /goal (animation, ti~50-90, palette outliers, bbox CC ok)
//   - IMG_6444 deadlift (human-motion, ti=44, si=202, bbox fail, no LC speech)
//   - Generic UI/terminal/code screen recordings (si>180, ti<25)
// Thresholds may need retuning per test cycle.

// "Bbox unreliable" = detector(s) could not isolate a dominant subject blob.
// Three failure shapes:
//   - cropdetect-fallback at full-frame (v0.10 behavior; no detector succeeded)
//   - center-prior (v0.11; both CC and cropdetect gave up, fell back to heuristic)
//   - low confidence (< 0.3) from any method (CC found something but it's likely noise)
// All three signal "subject can't be isolated in a busy scene", which is a
// strong human-motion / real-world signal.
function bboxUnreliable(opts: ClassifyInputs): boolean {
  if (opts.subject_bbox_method === "cropdetect-fallback" && (opts.subject_bbox_area_pct ?? 100) >= 90) return true
  if (opts.subject_bbox_method === "center-prior") return true
  if ((opts.subject_bbox_confidence ?? 1) < 0.3) return true
  return false
}

export function classifyContent(opts: ClassifyInputs): ClassifyResult {
  const reasons: string[] = []
  const ms = opts.motion_summary?.siAvg ?? 0
  const mt = opts.motion_summary?.tiAvg ?? 0
  const ss = opts.subject_motion?.siAvg ?? 0
  const st = opts.subject_motion?.tiAvg ?? 0
  const cutsPerSec = opts.duration_seconds > 0
    ? opts.scenes_count / opts.duration_seconds
    : 0
  const poCount = opts.palette_outliers_count
  const bboxFail = bboxUnreliable(opts)
  const subjectOverGlobal = mt > 0 ? st / mt : 0

  reasons.push(`signals: si=${ms.toFixed(1)}/${ss.toFixed(1)} (global/subject), ti=${mt.toFixed(1)}/${st.toFixed(1)} (global/subject), cuts/s=${cutsPerSec.toFixed(2)}, palette_outliers=${poCount}, bbox_method=${opts.subject_bbox_method ?? "none"}, area_pct=${opts.subject_bbox_area_pct ?? "n/a"}, transcription_lc=${opts.transcription_low_confidence ?? "n/a"}`)

  // UI-screen: dense UI/text with low temporal motion. Three patterns:
  //   (a) high si (busy UI / lots of widgets) + low ti
  //   (b) moderate si (terminal with whitespace) + very low ti + no palette events
  //   (c) low si + near-zero ti + zero cuts + no palette + bbox detected
  //       (sparse static-frame UI demo like a Claude Code terminal screencap
  //        that's just text on a flat background; signals look like "nature"
  //        but the lack of cuts and presence of a detectable text region rule
  //        out outdoor content)
  //
  // Catches terminal, code editor, dashboard, Claude Code interface, browser demo.
  if (ms > 180 && mt < 25) {
    reasons.push("ui-screen: high spatial (>180) + low temporal (<25) = dense UI with static text")
    return { content_class: "ui-screen", reasons }
  }
  if (ms > 100 && mt < 15 && poCount === 0) {
    reasons.push(`ui-screen: moderate spatial (${ms.toFixed(1)}) + very low temporal (${mt.toFixed(1)}) + no palette events = sparse UI / terminal recording`)
    return { content_class: "ui-screen", reasons }
  }
  if (mt < 5 && cutsPerSec < 0.1 && poCount === 0
      && (opts.subject_bbox_method === "cc" || opts.subject_bbox_method === "cropdetect")) {
    reasons.push(`ui-screen: near-zero ti (${mt.toFixed(1)}), no cuts, no palette events, bbox detected (${opts.subject_bbox_method}) = static UI demo / screencap`)
    return { content_class: "ui-screen", reasons }
  }

  // Animation: palette outliers (emission events) — three paths:
  //   (a) palette outliers + continuous shot (low cuts) — classic emission event
  //   (b) palette outliers + no clean speech (hallucinated or silent audio) —
  //       cartoon / motion graphic with no narrator
  //   (c) palette outliers + low spatial complexity (flat cinematic colors) +
  //       low motion + dense cuts — cinematic film-clip montage / motion graphic
  //       reel (e.g., Apple Vision Pro teaser). Distinguished from edited
  //       talking-head presenters (which have higher si from face detail) by
  //       the ms < 50 gate.
  // Combined gates prevent talking-head presenters with colorful backdrops
  // (e.g., 42 Berlin terminal short with unicorn bg cuts) from triggering on
  // palette variance from the backdrop swap.
  if (poCount >= 3 && (cutsPerSec < 0.3 || opts.transcription_low_confidence === true)) {
    reasons.push(`animation: ${poCount} palette outliers (one-off colors = emission/projectile events), cuts ${cutsPerSec.toFixed(2)}/s, lc=${opts.transcription_low_confidence}`)
    return { content_class: "animation", reasons }
  }
  if (poCount >= 5 && mt < 15 && cutsPerSec > 0.2 && ms < 50) {
    reasons.push(`animation: cinematic montage — ${poCount} palette outliers + low spatial detail (ms=${ms.toFixed(1)}) + low motion (mt=${mt.toFixed(1)}) + dense cuts (${cutsPerSec.toFixed(2)}/s)`)
    return { content_class: "animation", reasons }
  }
  if (mt >= 50 && !bboxFail && opts.subject_bbox_method === "cc") {
    reasons.push(`animation: high temporal motion (${mt.toFixed(1)}) with CC bbox detection (clean single subject on flat bg)`)
    return { content_class: "animation", reasons }
  }

  // Talking-head dense-cut high-detail: high cut rate + moderate-to-high
  // spatial complexity + clean speech = MKBHD-style shorts, podcast clips with
  // B-roll cuts, vlog explainers, edited talking-head shorts. Runs BEFORE
  // human-motion to claim these explicitly so edited sports rules don't poach.
  // Thresholds: cuts > 0.4/s (multi-shot edit), ms > 70 (moderate-to-high
  // spatial detail captures presenter+text-overlay videos as well as podcast
  // close-ups).
  if (cutsPerSec > 0.4 && ms > 70 && opts.transcription_low_confidence !== true) {
    reasons.push(`talking-head: high cuts (${cutsPerSec.toFixed(2)}/s) + moderate-high spatial detail (ms=${ms.toFixed(1)}) + clean speech = edited vlog/podcast/short with B-roll`)
    return { content_class: "talking-head", reasons }
  }

  // Human-motion: bbox CC failed (busy bg / mirrors / multi-subject), subject
  // motion noticeably higher than global (subject moves more than camera/bg).
  // Catches sports, fitness, dance against busy/reflective environments.
  if (bboxFail && subjectOverGlobal > 1.1 && st > 30) {
    reasons.push(`human-motion: bbox failed (busy bg), subject ti (${st.toFixed(1)}) > global ti (${mt.toFixed(1)}) by ${(subjectOverGlobal * 100 - 100).toFixed(0)}%`)
    return { content_class: "human-motion", reasons }
  }
  // Even with bbox success, if subject ti dominates by a wide margin → human-motion
  if (subjectOverGlobal > 1.4 && st > 40 && opts.transcription_low_confidence !== false) {
    reasons.push(`human-motion: subject ti (${st.toFixed(1)}) dominates global ti (${mt.toFixed(1)}) by ${(subjectOverGlobal * 100 - 100).toFixed(0)}%, no speech detected`)
    return { content_class: "human-motion", reasons }
  }
  // Edited sports/montage: bbox unreliable AND high cut rate (dense scene cuts)
  // AND moderate global motion AND subject ti > global ti (subject IS the
  // action, not just camera-driven). The subjectOverGlobal > 1.1 filter
  // excludes real-world / dashcam content where everything moves uniformly.
  if (bboxFail && cutsPerSec > 0.3 && mt > 20 && subjectOverGlobal > 1.1) {
    reasons.push(`human-motion: edited sports/montage — bbox unreliable, high cuts (${cutsPerSec.toFixed(2)}/s), global ti ${mt.toFixed(1)}, subject ti dominates by ${(subjectOverGlobal * 100 - 100).toFixed(0)}%`)
    return { content_class: "human-motion", reasons }
  }

  // Talking-head with subject dominance: standard talking-head heuristic for
  // continuous-camera content + moderate edits. Clean speech is required.
  if (subjectOverGlobal > 1.2 && cutsPerSec < 0.6 && opts.transcription_low_confidence !== true) {
    reasons.push(`talking-head: subject ti > global ti by ${(subjectOverGlobal * 100 - 100).toFixed(0)}%, cuts ${cutsPerSec.toFixed(2)}/s, speech not flagged as hallucinated`)
    return { content_class: "talking-head", reasons }
  }
  // Talking-head edited fallback: medium-high cut rate with speech, catches
  // edited explainers / shorts that didn't hit the high-si specialist rule.
  if (cutsPerSec > 0.3 && ms > 40 && opts.transcription_low_confidence !== true) {
    reasons.push(`talking-head: edited multi-cut content (cuts ${cutsPerSec.toFixed(2)}/s, ms=${ms.toFixed(1)}) with speech present`)
    return { content_class: "talking-head", reasons }
  }

  // Human-motion slow-instructor: bbox unreliable, moderate motion that's
  // not subject-dominant (athlete small in busy bg), but speech IS present.
  // Catches gymnastics tutorials, yoga instruction, fitness instructors, dance
  // explainers where the subject is small in frame relative to a busy
  // background. The narrator-with-physical-demo signal is the key tell.
  if (bboxFail && mt > 18 && cutsPerSec < 0.4 && opts.transcription_low_confidence === false && st > 18) {
    reasons.push(`human-motion: instructor/tutorial — bbox failed (subject small in busy bg), moderate ti (${mt.toFixed(1)}/${st.toFixed(1)}), low cuts (${cutsPerSec.toFixed(2)}/s), speech present`)
    return { content_class: "human-motion", reasons }
  }

  // Nature: low motion, OR uniform-color timelapse (waterfall, clouds, plants).
  // Distinguishing from drone-over-terrain (which is real-world): nature
  // content has UNIFORM low spatial complexity (si < 60), drone has varied
  // landscape detail (si higher). Both have subject_motion ≈ global_motion,
  // both can have low/moderate ti, but drone footage shows different terrain
  // frame-to-frame while a timelapse on one scene stays uniform.
  if (mt < 15 && st < 20 && cutsPerSec < 0.1) {
    reasons.push(`nature: low ti everywhere (global ${mt.toFixed(1)}, subject ${st.toFixed(1)}), continuous shot (cuts ${cutsPerSec.toFixed(2)}/s)`)
    return { content_class: "nature", reasons }
  }
  // Moderate-motion timelapse / continuous-flow nature: water/clouds/wind.
  // Requires moderate ti (> 15 distinguishes timelapse motion from cooking-like
  // static), low spatial complexity (< 60 distinguishes from drone-over-terrain),
  // no palette outliers, no clear subject. Scene-cut tolerance bumped to 0.35
  // since scdet false-positives on timelapse frame transitions.
  if (mt > 15 && mt < 35 && cutsPerSec < 0.35 && poCount === 0 && bboxFail && ms < 60
      && Math.abs(subjectOverGlobal - 1) < 0.15
      && opts.transcription_low_confidence !== false) {
    reasons.push(`nature: timelapse / continuous-flow natural scene — moderate ti (${mt.toFixed(1)}), low spatial complexity (si=${ms.toFixed(1)}), no subject dominance (ratio ${subjectOverGlobal.toFixed(2)}), no palette, no speech`)
    return { content_class: "nature", reasons }
  }

  // Real-world / dashcam / drone POV: bbox fails AND ti > 25 AND content has
  // a "camera moves through varied scenes" signature. Distinguished from
  // timelapse-style nature scenes by spatial complexity: drone over terrain,
  // dashcam streetscapes, walking POV all have si > 60 (varied detail);
  // waterfall / cloud / wildlife timelapses have si < 60 (uniform colors).
  if (bboxFail && mt > 25 && ms > 60) {
    reasons.push(`real-world: bbox failed, global ti (${mt.toFixed(1)}) > 25, moderate spatial complexity (si=${ms.toFixed(1)}) = camera over varied scenes`)
    return { content_class: "real-world", reasons }
  }
  if (bboxFail && mt > 30 && subjectOverGlobal > 1.1) {
    reasons.push(`real-world: bbox failed, global ti (${mt.toFixed(1)}) > 30, subject motion dominates by ${(subjectOverGlobal * 100 - 100).toFixed(0)}%`)
    return { content_class: "real-world", reasons }
  }

  reasons.push("generic: signals did not match any specific class")
  return { content_class: "generic", reasons }
}

