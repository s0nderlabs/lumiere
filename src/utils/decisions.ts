import type { SessionManifest } from "../types.js"

// Single source of truth for the narrative_mode / adaptive_sampling precedence.
// Both watch.ts (at request time) and measure.ts (predicting watch's behaviour)
// call these so the two tools never drift. Precedence is:
//   1. explicit per-call param (true or false) wins
//   2. heuristic auto-suggest fires
//   3. server default in config (true / false)
//   4. off

export type NarrativeReason =
  | { on: true; source: "explicit" }
  | { on: true; source: "auto" }
  | { on: true; source: "config" }
  | { on: false; source: "explicit" }
  | { on: false; source: "default" }

export function decideNarrative(opts: {
  param: boolean | undefined
  autoSuggest: boolean
  configDefault: boolean | undefined
}): NarrativeReason {
  if (opts.param === true) return { on: true, source: "explicit" }
  if (opts.param === false) return { on: false, source: "explicit" }
  if (opts.autoSuggest) return { on: true, source: "auto" }
  if (opts.configDefault === true) return { on: true, source: "config" }
  return { on: false, source: "default" }
}

export type AdaptiveReason =
  | { on: true; source: "explicit" }
  | { on: true; source: "auto" }
  | { on: true; source: "config" }
  | { on: false; source: "explicit" }
  | { on: false; source: "default" }

export function decideAdaptive(opts: {
  param: boolean | undefined
  narrativeOn: boolean
  motionWindowCount: number
  durationSec: number
  hasSegments: boolean
  configDefault: boolean | undefined
}): AdaptiveReason {
  if (opts.hasSegments) return { on: false, source: "default" }
  const motionPreconditions = opts.motionWindowCount >= 1 && opts.durationSec > 4
  if (opts.param === true) return { on: true, source: "explicit" }
  if (opts.param === false) return { on: false, source: "explicit" }
  if (opts.narrativeOn && motionPreconditions) return { on: true, source: "auto" }
  if (opts.configDefault === true && motionPreconditions) return { on: true, source: "config" }
  return { on: false, source: "default" }
}

// Decide whether to auto-suggest narrative_mode. Looks at five signals on the
// cached analysis:
//   1. content_profile contains "high motion" / "action" / "dynamic"
//   2. scene cuts density > 0.3/sec
//   3. has_motion verdict (global + subject-region siti)
//   4. palette_outliers non-empty (one-off color events / emissions)
//   5. subject_bbox area_pct < 30% (small subject in static composition; global
//      motion looks low but the subject is animating fast)
export function shouldAutoSuggestNarrative(
  manifest: SessionManifest | null,
  durationSec: number,
): boolean {
  const a = manifest?.analysis
  if (!a) return false
  if (a.content_profile && /high\s*motion|action|dynamic/i.test(a.content_profile)) return true
  const cutsPerSec = (a.scenes?.length ?? 0) / Math.max(1, durationSec)
  if (cutsPerSec > 0.3) return true
  if (a.has_motion === true) return true
  if (a.palette_outliers && a.palette_outliers.length > 0) return true
  if (a.subject_bbox && a.subject_bbox.area_pct < 30) return true
  return false
}

// Render a NarrativeReason as a short string for the budget block in watch().
export function describeNarrative(reason: NarrativeReason): string {
  if (reason.on) {
    if (reason.source === "explicit") return "explicit (narrative_mode=true)"
    if (reason.source === "auto") return "auto-suggested (analyze data indicates high motion or dense scene cuts)"
    return "server default (configure.default_narrative_mode=true)"
  }
  if (reason.source === "explicit") return "off (explicit narrative_mode=false)"
  return "off"
}

export function describeAdaptiveSource(reason: AdaptiveReason): string {
  if (!reason.on) {
    if (reason.source === "explicit") return "off (explicitly disabled)"
    return "off (no motion_windows or duration <= 4s)"
  }
  if (reason.source === "explicit") return "explicit"
  if (reason.source === "auto") return "auto-enabled (narrative_mode + motion_windows cached)"
  return "server default (configure.default_adaptive_sampling=true)"
}
