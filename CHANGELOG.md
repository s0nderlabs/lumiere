# Changelog

All notable changes to lumiere. Format follows [Keep a Changelog](https://keepachangelog.com/) and the project adheres to [Semantic Versioning](https://semver.org/).

## [0.8.0] - 2026-05-20

Per-window zoom: each motion window can carry its own subject bbox so a traveling subject (e.g. a mascot dashing from top-left to bottom-right) stays tight in every cropped frame instead of being averaged out by a video-wide union bbox. Plus a roi-aware cache so `view=` lookups never silently return frames from the wrong crop bucket, and a defense-in-depth pass on the keychain shell-out path. Tested end-to-end via a tmux MCP session against the V1 ClaudeDevs source.

### Added

- **`roi="per-window"` on `watch` and `measure`**. Assigns each motion-window's frames its own bbox from `analyze.window_bboxes`. Requires `adaptive_sampling=true` and a prior `analyze(motion=true)` call.
- **`analyze.window_bboxes`**: per-motion-window subject bboxes, computed via cc-segmentation restricted to each window's time range. Aligned by index with `analyze.motion_windows`. Null entries mean no usable blob found in that window (very short, very static).
- **`src/utils/concurrency.ts`**: `mapWithConcurrency` bounded-concurrency helper. Used by the per-window bbox loop in `analyze` to cap simultaneous ffmpeg invocations at 4 so action-heavy videos with many motion windows don't fan out 20+ ffmpegs and starve the decoder.
- **`src/utils/roi.ts`** gains `formatRoiCrop`, `roiBucketKey`, `assignPerWindowCrops`, plus `ROI_AUTO` / `ROI_PER_WINDOW` constants. Single canonical crop format across cache keys, on-disk dir names, metadata labels, and measure JSON output.

### Changed

- **Cache key now encodes the roi bucket**: `frameCacheKey(resolution, format, roiBucket?)` produces `1024/jpeg` for full frame and `1024/jpeg/roi=x,y,wxh` for a cropped variant. `view=` lookups filter by the current request's roi bucket so a `roi=auto` call no longer silently returns full-frame frames from the cache (or vice versa). Backwards-compat: pre-v0.8 caches under the bare `1024/jpeg` key remain readable as the full-frame bucket.
- **`Segment.crop` and `SegmentFrame.crop`**: optional per-segment crop carried through `extractFramesBySegments`. Per-segment crop wins over the call-level crop; each crop variant gets its own output subdir so different crops at the same timestamp don't collide on `frame_NNNN.jpg`.
- **`extractFramesBySegments` writes to `<res>/<bucket>-s<i>/`** instead of the bare `<res>/`. Latent bug fix: pre-v0.8, every segment wrote into the same dir and overwrote earlier `frame_NNNN.jpg` files, so `sourcePath` entries cached in the session manifest pointed at files that later segments had clobbered. Callers that round-tripped through `sourcePath` (the watch tool's session-cache merge path) were serving stale bytes.
- **`detectSubjectBboxViaCC` accepts optional `bounds: { startTime, endTime }`** so the per-window planner can run it on a sub-segment.

### Fixed

- **`src/auth.ts` shell hardening**: keychain `find-generic-password` / `add-generic-password` / `delete-generic-password` calls switched from `execSync` with template-string interpolation to `execFileSync` with arg arrays. No current vector (keys come from internal `dev.lumiere-*` constants) but eliminates a future shell-injection surface if any caller ever passes user-influenced data.
- **`view=` cache lookup ignored mode + roi context**. Before v0.8 the lookup picked the highest-resolution cached frame regardless of crop, so a `view=` call without `roi` could return roi-cropped frames silently. Now scoped to the current request's roi bucket.

### Internal

- Eliminated ~35 lines of duplicated per-window crop matching between `tools/watch.ts` and `tools/measure.ts` via the shared `assignPerWindowCrops` helper.
- All four bbox-to-string call sites (`watch`, `measure`, cache key, on-disk dir name) now route through `formatRoiCrop`.
- Dropped `parseHMS` aliases (`parseSimpleHms` in `bbox.ts`, `parseHmsToSec` in `analyze.ts`); both files import `parseHMS` directly to match codebase convention.

## [0.7.2] - 2026-05-20

Retroactive cleanup pass triggered after seal-guard v2 surfaced that v0.7.0 and v0.7.1 had shipped via raw `git commit` bypassing the proper Skill('commit') chain. This release is the audit-and-fix pass: full-codebase /simplify + security review + README sweep, all driven through the proper /seal + Skill('commit') chain so the v2 hook can validate it. No public API changes; internal refactor + one latent bug fix.

### Added

- **`src/utils/decisions.ts`**: canonical home for narrative_mode + adaptive_sampling precedence logic. Exports `decideNarrative`, `decideAdaptive`, `describeNarrative`, `describeAdaptiveSource`, `shouldAutoSuggestNarrative`. Both `watch` and `measure` now route through these helpers, eliminating drift risk between the tool's actual behavior and measure's prediction.
- **`src/utils/adaptive-segments.ts`**: canonical home for `buildAdaptiveSegments`, `AdaptiveSegment` interface, `formatAdaptiveSummary`. Was duplicated in `tools/watch.ts` and `tools/measure.ts` (~120 lines each); now imported from one place.
- **`src/utils/roi.ts`**: canonical `resolveRoi` + `RoiCrop` type. Was duplicated inline in both tools.

### Changed

- **`src/types.ts`**: `SubjectBbox` interface promoted to single source of truth. Previously duplicated in `extractors/bbox.ts` and `extractors/analyzers.ts`. Both extractors now reference the canonical type.
- **`README.md`**: documented the v0.7.1 `default_narrative_mode` and `default_adaptive_sampling` configure fields (doc debt from the v0.7.1 ship).
- **Comments stripped of stale version milestones**. ~30 "v0.4/v0.5/v0.6/v0.7.1" milestone tags removed from production code. Version history belongs in CHANGELOG and git, not in source-line comments. Kept WHY-comments that explain real bugs being prevented.
- **Tool-description strings** (the LLM-visible text in `.describe()` calls on the zod schemas) no longer surface `v0.5:` / `v0.6:` prefixes that polluted the auto-generated tool docs.

### Fixed

- **Latent bug in `analyze.ts` frame_stats merge**: the path that combined signalstats + blurdetect outputs into `analysis.frame_stats` was dropping `u_chroma` / `v_chroma` fields when merging entries with the same timestamp. This silently broke the hue-novelty path of `detectPaletteOutliers` for any analyze call that ran both filters together (it worked when only exposure was on). Found by the simplify quality agent and corrected.
- **`measure.ts` mime hardcoding**: was passing `"image/jpeg"` literally to the image content block. Now uses `frameFormatMimeType(DEFAULTS.frame_format)` so it tracks the configured frame format.
- **Emdash sweep**: three U+2014 characters removed from `index.ts`, `utils/hallucination.ts`, and `bin/lumiere-cost` per the global no-emdash rule.

### Performance

- **`measure.ts`**: the two `countTokens` HTTP calls (full content + text-only) now fire via `Promise.all` instead of sequentially. Saves ~150-400ms per measure call (one round-trip to api.anthropic.com).
- **`analyze.ts`**: three motion-phase ffmpeg invocations (central-motion siti, subject-bbox cropdetect, motion-windows siti) now run in parallel via `Promise.all`. On a 10s video this saves ~6-10s off `analyze({motion: true})` wall time.
- **`analyze.ts`**: frame_stats merging changed from O(n*m) array-scan to O(n+m) `Map<timestamp, row>`. On 700-frame signalstats runs that's ~490K compares down to ~1.4K.
- **`analyze.ts` + `watch.ts`**: dedup `computeVideoHash` invocation. Was running twice per call (once for session lookup, once internally); now passed through. Saves one file-hash pass per analyze/watch.
- **`utils/count-tokens.ts` `detectCurrentModel`**: reads the JSONL transcript in 256 KiB chunks from the tail instead of slurping the whole file. The model field lives in the last assistant turn, so the first chunk wins ~99% of the time. On a 5 MiB session JSONL that's ~20x I/O reduction.
- **`watch.ts` `summarizeManifest`**: lazy timestamp-array allocation when collapsing large manifests (>50 entries). Skips the populate step when the summary is going to be emitted.

### Removed (duplication)

- ~199 lines from `tools/watch.ts` (was 776, now 577): inline `AdaptiveSegment` + `buildAdaptiveSegments` + `formatAdaptiveSummary` + `resolveRoi` + `shouldAutoSuggestNarrative` + nested precedence ternaries.
- ~88 lines from `tools/measure.ts` (was 316, now 228): inline duplicated versions of the same helpers, plus dead imports (`readFileSync`, `calculateAutoFps`, `computeVideoHash`).
- ~8 lines from `extractors/analyzers.ts` (`SubjectBbox` interface declaration).
- Unused `_ConfigForDecisions` type alias.

### Notes

- Net codebase: 685 lines removed, 435 added (3 new util modules). The new utils carry their own doc comments. Actual duplication eliminated: ~270 lines.
- Typecheck clean (`tsc --noEmit`).
- This is the first ship via the proper /seal + Skill('commit') chain after seal-guard v2 deployed. The v2 hook is the new enforcement gate; this commit is its first real test.

## [0.7.1] - 2026-05-20

Configurable server defaults for narrative_mode and adaptive_sampling. Until now these were per-call params with auto-suggest heuristics; you could not pin them as a baseline. v0.7.1 adds two optional Config fields so a user who always wants narrative on (or always off) can set it once.

### Added

- **`default_narrative_mode` config field** (`true | false | "auto"`). When set to `true`, watch and measure default `narrative_mode=true` whenever the per-call param is omitted AND the auto-suggest heuristic doesn't already fire. When set to `false`, force off (unless per-call passes `true`). When omitted or set to `"auto"`, behavior is unchanged from v0.7.0 (auto-suggest from motion/cuts/palette signals).
- **`default_adaptive_sampling` config field** (`true | false | "auto"`). Same semantics for adaptive sampling. When `true`, adaptive activates whenever motion_windows are cached and duration > 4s (even without narrative_mode being on). `false` forces off. `"auto"` or unset = v0.7.0 behavior (auto-enable only when narrative is also on).

### Changed

- **watch precedence ordering moved up front** so adaptive sampling can see the final narrative decision. Was scattered/late before. Order is now: explicit per-call > auto-suggest > server default > off.
- **Budget block** in watch response now reports the source of each setting: `auto-suggested`, `server default (configure.default_X)`, `explicit`, or `off`.
- **`configure` schema** expanded with the two new fields. Pass `"auto"` to clear a previously-set default and revert to heuristic behavior.

### Notes

- Per-call params always win. Server defaults only fill in when the caller omits the param.
- The auto-suggest heuristic (motion windows, scene cuts, palette outliers, small subject bbox) still has higher priority than the server default. Server default is the floor, not the ceiling.

## [0.7.0] - 2026-05-20

Exact token forecasting via Anthropic's count_tokens endpoint. Adds the `measure` MCP tool and the `lumiere-cost` CLI, both giving exact conversation-token counts for any planned watch call without consuming the tokens themselves.

### Added

- **`measure` MCP tool** (`src/tools/measure.ts`). Takes the same args as `watch` (path, mode, view_sample, narrative_mode, roi, adaptive_sampling, start/end_time). Extracts frames, builds the would-be response, calls Anthropic's free `/v1/messages/count_tokens` endpoint, returns exact `conversation_tokens` for the current model plus a heuristic `mcp_cap_tokens` estimate. Discards the payload. Use BEFORE a high-stakes watch call to know the exact cost.
- **`lumiere-cost` CLI** (`bin/lumiere-cost`). Standalone shell wrapper around the measure tool. Print token costs without entering a CC session: `lumiere-cost video.mp4 --mode high`.
- **Model auto-detection** (`src/utils/count-tokens.ts:detectCurrentModel`). Reads the current CC session's model from `~/.claude/projects/<encoded-cwd>/<session_id>.jsonl` via the `CLAUDE_CODE_SESSION_ID` env var. Honors `LUMIERE_ANTHROPIC_MODEL` and `ANTHROPIC_MODEL` overrides. Falls back to `claude-opus-4-7`. Ensures count_tokens always uses the model the user is actually running, not a stale default.
- **`hasAnthropicKey()` check** in measure so the tool returns a clear error message when the key is missing, with the exact setup command.

### Changed

- **`registerMeasure(server)`** added to `src/index.ts`. Plugin now registers 5 tools (was 4). Startup log updated.
- **Anthropic key storage** convention: `dev.lumiere-anthropic-api-key` keychain entry on macOS, or `LUMIERE_ANTHROPIC_API_KEY` env var. Follows the existing `dev.lumiere-gemini-api-key` pattern.

### Notes

- count_tokens returns **conversation tokens** (image tokens via Anthropic's visual tokenizer, text tokens for accompanying text). This is what Claude sees as input tokens.
- This is DIFFERENT from the **MCP per-call cap**, which counts the raw JSON response (base64 text + structure). Empirically the MCP cap heuristic (chars/3.5) matches CC's truncation point within ~5%; count_tokens does NOT match because it tokenizes images as visual tokens not as base64 text.
- `measure` reports BOTH numbers so the caller knows the conversation budget (exact) AND the MCP cap exposure (heuristic).
- Opus 4.7's new tokenizer uses 1.0-1.35x more tokens than 4.6 for the same text (per Anthropic docs). Model auto-detection ensures the right tokenizer is used.
- Calling count_tokens is FREE (no per-call $, just rate-limited and requires x-api-key for auth).

## [0.6.0] - 2026-05-19

General-purpose detection upgrade. The v0.5 series targeted small-subject + emission-event identification by adding feature-aware prompts and ROI auto-crop. Post-hoc the question was: rather than building per-feature trackers (eye-state, mouth-state, etc.) which only help videos with those features, can we improve clarity and frames-per-action generically? v0.6 ships exactly that combination: tighter dominant-blob bbox + motion-adaptive frame allocation. Both apply to any video, regardless of subject.

### Added

- **Connected-component subject bbox detection** (new `src/extractors/bbox.ts`). The v0.5 cropdetect approach returned the union of all motion which conflated subject motion with secondary motion (e.g. mascot + scrolling terminal text in V1). v0.6 dumps a small stack of binary motion masks (tblend + lutyuv threshold, fps=2, scaled to 160px), accumulates motion energy per pixel, thresholds, runs BFS-based connected-component labeling, and returns the bbox of the largest persistent blob. Multi-subject videos (multiple comparable blobs within 2x area of the largest) return the envelope of the comparable blobs so dialogue scenes still get a useful crop. Falls back to v0.5 cropdetect on detection failure for backward compat. Surfaced via `analysis.subject_bbox.method` ("cc" / "cropdetect-fallback").
- **Motion-adaptive frame sampling** (new `buildMotionWindowsCommand`, `parseMotionWindowsFromMetaFile` in `src/extractors/analyzers.ts` + new `MotionWindow[]` field on `VideoAnalysis`). The analyze pass now samples siti at fps=10 with per-frame metadata, parses the per-frame `ti` (temporal information) values, applies a 1-second rolling mean, and identifies contiguous time intervals where smoothed ti exceeds the global `median + 1.5 * MAD`. Adjacent windows within 1s are merged. Each window is surfaced as `{ start, end, intensity }`.
- **`adaptive_sampling` param on `watch`** (`adaptive_sampling: boolean | undefined`). When true (or auto-enabled because narrative_mode is on AND motion_windows is cached AND duration > 4s), the per-call frame budget is split: 70% to motion windows (weighted by duration * intensity), 30% to static spans (uniform). Same total frame count as a uniform call, but temporal resolution biased toward where action is happening. Min 2 frames per motion window, min 1 frame per static span. Routes through the existing `extractFramesBySegments` path with `roi` applied if set.
- **Continuity audit pass in `narrative_mode`.** Final-pass instruction appended to NARRATIVE_GUIDANCE: re-read your draft, list rejected candidate sources for each committed verb, double-check tight sequences (<0.5s spacing), verify any "duplicate" frames for sub-pixel state changes. Encourages flagged hedges over confident misreads on contested attributions.
- **yt-dlp SSL fallback chain in `downloadFromUrl`.** On SSL handshake errors (intermittent on X/Twitter URLs), retries with `--extractor-args twitter:api=syndication` for Twitter hosts, then `--force-ipv4` as a generic fallback. Surfaces the original error only after all fallbacks fail.

### Changed

- **`extractFramesBySegments` now accepts an optional `crop` parameter** so ROI auto-crop works uniformly across both user-supplied and adaptively-built segments.
- **Watch tool description** updated to document `adaptive_sampling`.
- **Watch budget block** now shows `adaptive_sampling=on|off` with per-segment allocation summary (start-end, motion/static tag, intensity if motion, allocated frames + fps) so callers can see exactly how the budget was split.
- **Default fps display** in budget block shows `varies per segment (X-Y fps)` when adaptive sampling is active.

### Fixed (bundled hot-fixes during v0.6 cycle)

- **palette_outliers silently broken since v0.4.** Root cause: `parseSignalstatsOutput` regex required `# frame:` prefix but ffmpeg's metadata=print emits `frame:` without the hash on at least the bundled macOS build. v0.4 + v0.5 silently returned `frame_stats=[]` and `palette_outliers` absent, killing the laser/emission detection signal that narrative_mode v0.5 priors depend on. v0.6 fix: parser handles both `# frame:` and bare `frame:` block prefixes.
- **parseBlurOutput** had the same regex bug, also fixed.
- **parseMotionWindowsFromMetaFile** (v0.6 new code) shipped with the same bug pattern; fixed before first non-bundled use.
- **`detectPaletteOutliers` slice was chronological.** Was `outliers.slice(0, 30)` which kept the first 30 outliers by timestamp. On V1 signalstats runs at 30fps yielding ~720 frames; 30 chronological outliers covered only the first second. Strong later outliers (e.g. the laser at 0:02.4) were dropped. v0.6 fix: sort by chroma_distance desc, take top 50, re-sort by timestamp.
- **`formatHMSPrecise` 3-digit-seconds bug.** Was outputting "00:00:005.500" instead of "00:00:05.500". Silently corrupted timestamp labels in v0.4 + v0.5 narrative outputs. Fixed.

### Changed (v0.6 cost-estimator calibration)

- **`STATIC_TOKENS_PER_CALL`** bumped from 4000 to 8000. The v0.6 watch response carries: budget block with segment summary, NARRATIVE_GUIDANCE (~4K), palette outlier hint (~1K), continuity audit block, per-frame timestamp headers (~50 bytes/frame), audio block (~3K), manifest summary (~1K). v0.5's 4000 undercounted by 25-30%.
- **`COST_ESTIMATE_SAFETY_MARGIN`** bumped from 1.15 to 1.25. Conservative buffer above raw token count.
- **`SAFE_AT_100K`** per-tier auto-budget recalibrated: 384/480, 512/280, 768/140, 1024/90, 1536/40 (was 600/350/180/120/50). Single-call full-coverage now actually fits at every tier with adaptive_sampling + narrative_mode + roi=auto stacking.

### Notes

- The v0.6 design choice was explicit: per-feature trackers (eye-state, mouth-state, hand-state) were considered but rejected as too specific. Lumiere has to work on any video genre; clarity + frames-per-action are the general levers. The user-laser-test case improves as a side effect of these general gains, not as a targeted fix.
- Adaptive sampling targets the existing `view_sample` total budget. It does not increase per-call token cost. If a motion window is short and dense, it can spike per-segment fps to 14-25 to hit its frame allocation; static spans drop to 0.2-1 fps to free budget.
- CC bbox segmentation costs ~1-2s extra in analyze() for short videos. For very long videos, the ffmpeg `-frames:v 24` cap keeps the cost bounded.
- Motion windows detection adds another ~siti pass on top of v0.4's central-crop siti and v0.5's signalstats pass. Total analyze() cost on a 24s clip: ~6-8s wall time.
- The palette_outliers regression bug was a 2-version sleeper: v0.4 + v0.5 both shipped with the laser/emission signal effectively disabled. v0.6 is the first version where the signal actually reaches narrative_mode. Possible explanation for v0.5.1's "firing pink power-up beam, attributed to body" near-miss: it was working from frames + general motion priors, NOT from the per-frame chroma outlier signal it was supposed to have.

## [0.5.1] - 2026-05-19

Hotfix on top of v0.5.0 after the first blind retest revealed the subject_bbox detection was broken on bright-background videos.

### Fixed

- **`buildSubjectBboxCommand` produced invalid bboxes (negative widths) on bright-background videos.** The original `tblend=all_mode=difference,cropdetect=limit=20:round=2:reset_count=0` chain works for dark-background content but fails on cream/white-background videos like V1 because cropdetect treats the diff frames as having "border" everywhere. Patched chain: `tblend=all_mode=difference,lutyuv=y=if(gt(val,10),255,0),cropdetect=limit=20:round=2:reset_count=0`. The `lutyuv` step thresholds the diff to a hard binary motion mask (motion → 255, static → 0) so cropdetect reliably finds the moving region.
- **Empirical: on V1 the patched chain returns `crop=382:924:438:246` (18% area), tightly bounding mascot + terminal text (the actual moving regions).**

### Changed

- **`shouldAutoSuggestNarrative` subject_bbox threshold bumped 15% → 30%.** V1's motion bbox is 18% area, which the original 15% cutoff missed. 30% catches small-subject videos without over-triggering on full-frame action content.

## [0.5.0] - 2026-05-19

Follow-up to v0.4 after the v4 post-hoc interviews with the 4 spawned CC sessions. The convergent diagnosis was that v0.4's wiring worked but the underlying signals (palette novelty + subject motion) were too coarse to fire on small-subject videos, and the prompt biases needed sharper anatomy-aware verb taxonomies + an equipment-carve-out from the branded-character prior.

### Added

- **Subject bbox auto-detection** (`buildSubjectBboxCommand`, `parseCropdetectOutput` in `src/extractors/analyzers.ts`). Runs ffmpeg with `tblend=all_mode=difference,cropdetect=limit=20:round=2:reset_count=0` to find the bbox of moving content. Surfaced as `analysis.subject_bbox = { x, y, w, h, frame_w, frame_h, area_pct }`. Background pixels diff to ~0 (treated as black border); moving pixels (the subject) form the detected bbox.
- **`roi` param on `watch`** (`roi: "auto" | "x,y,w,h"`). When `"auto"`, reads `analyze.subject_bbox` from the session cache and crops frames to that bbox before scaling. Gives small subjects the full target resolution instead of being averaged out by background pixels. `"x,y,w,h"` is an explicit pixel bbox.
- **Hue-based palette novelty.** v0.4's palette outlier detection used saturation+brightness magnitudes only, which missed the V1 laser case because pale-pink and dominant-orange have similar saturation magnitudes despite very different hues. v0.5 also computes hue angle via `atan2(V-128, U-128)` and flags frames whose hue is statistically far from the median hue, in addition to magnitude novelty. `FrameStats` now exposes `u_chroma`, `v_chroma` separately. Threshold relaxed from 2.5 MAD to 1.8 MAD for better sensitivity to 2-pixel 2-frame events.
- **Truncation auto-suggest hint** in `watch` response. When fewer frames are returned than requested (MCP cap hit mid-stream), the response appends "received N/M frames; output hit the cap at timestamp X; retry with start_time=X end_time=Y at the SAME fps." Removes the manual calculation the caller had to do in v0.4.
- **Manifest auto-collapse** in `summarizeManifest`. When a cached resolution has >50 timestamps, the response shows count + first/last instead of dumping every entry. Eliminates the manifest-bloat truncation that bit v0.4 mid-tier on its first call (374 entries pushed the response over the cap).
- **Small-subject auto-suggest signal.** `shouldAutoSuggestNarrative` now also fires when `subject_bbox.area_pct < 15%`. Catches videos where the subject is a tiny sprite inside a static composition (exactly the V1 mascot case where global motion + subject-region siti both fail).

### Changed

- **narrative_mode prompt v3.** v0.4 priors kept the model off identity-swap but biased it toward humanoid verbs and away from emission verbs anchored to body regions. v0.5 adds:
  - Anatomy-aware verb taxonomy: `eyes → lasers/beams/vision rays`, `mouth → blasts/breath/sonic`, `hands → projectiles/sparks/orbs`, `body → aura/radiance`. Plus PHYSICAL (body motion), EQUIPMENT, MANIPULATION as before.
  - Branded-character equipment carve-out: "identity is fixed, BUT costumes/props ARE binary state changes worth narrating as PUT_ON / TAKEN_OFF events with timestamps."
  - HEADGEAR/EQUIPMENT as a named feature channel (in addition to eyes/hands/mouth/body). Persistent structure above the eye-line for ≥3 frames = ACTIVE.
  - Trajectory rule: "for each novel-color event, list 2-3 candidate sources before committing; trace the trajectory back to one." Verify-then-attribute, not attribute-then-verify.
  - Explicit hedge instruction at resolution <= 512: "I can describe shapes but not feature-channel state; recommend mid/high for any verb that depends on eyes/mouth/hands."
- **Cost estimator overhead margin.** `STATIC_TOKENS_PER_CALL` bumped from 2000 to 4000. New `COST_ESTIMATE_SAFETY_MARGIN = 1.15` (15% padding) applied to every estimate. Together these prevent the v0.4 "estimator said fits, reality truncated" failure mode.
- **Default `skip_metadata=true` when narrative_mode is on.** Caller can still pass explicit `skip_metadata=false` to override. Default behavior change reduces per-call overhead by ~5-10K tokens.
- **Watch tool description** updated to document `roi`, plus narrative_mode and cost estimator changes.

### Fixed

- **v4-test gap: hallucinated laser-as-leg readings.** Combined effect of (1) ROI crop giving the model enough pixels on the subject to see beam trajectories, (2) hue novelty catching the pale-pink #F2C9B5 against the dominant orange palette, and (3) narrative_mode v3 priming "vision rays" as the candidate verb when novel-color appears near the head region.
- **Manifest bloat truncation.** Cached sub-second timestamps no longer dump as 50+ entry JSON arrays.

### Notes

- Auto-ROI quality depends on subject having appreciable motion. For static talking-head shots, ROI auto-detection returns null and the call falls through to full-frame extraction.
- Per-frame eye-state tracking (ranked #1 in the v4 interviews) is deferred to v0.6. v0.5 ships the ROI crop + hue novelty + anatomy-aware prompt combo that the interviews ranked as the second-best path.
- Audio-loudness-as-orthogonal-event signal (max's v4 interview suggestion) is also v0.6 backlog.

## [0.4.0] - 2026-05-19

This release ships six concrete fixes uncovered by the v0.3 blind retest + post-hoc interviews with 4 spawned CC sessions. Each fix targets a specific signal that v0.3 was either dropping, mislabeling, or never computing.

### Added

- **Sub-second timestamp labels** (`formatHMSPrecise` in `src/utils/timestamps.ts`). When fps >= 2, frame labels render as `00:00:02.500` instead of `00:00:02`. Before, every frame inside a 1-second window got the same integer label and the LLM treated them as duplicates. Scene cut and interval timestamps also get sub-second precision.
- **Subject-region motion measurement** (`buildCentralMotionCommand`, `hasMotion` in `src/extractors/analyzers.ts`). A second siti pass runs on the center 50% crop. Catches small-subject high-motion (e.g. animated mascot inside a static brand card) that the whole-frame siti underweights. Surfaced as `analysis.subject_motion` and `analysis.has_motion`.
- **Raw motion scores** in analyze output (`analysis.motion_summary.siAvg`, `tiAvg`). Before, only the derived content_profile string was returned. Now the underlying numbers are inspectable so callers can see when the verdict is borderline.
- **Palette outlier detection** (`detectPaletteOutliers` in `src/extractors/analyzers.ts`). Per-frame chroma/brightness from signalstats is statistically compared to the median; frames more than 2.5x median absolute deviation from the median get flagged. Surfaced as `analysis.palette_outliers`. The v0.3 bug where pale-pink laser pixels read as "legs" gets caught by this because pale-pink is far from the median orange.
- **Palette-outlier hint injection** in `watch` response. When narrative_mode is active AND the cached analyze reported outliers, an extra guidance block prompts the model: these timestamps likely contain EMISSION events (laser, projectile, flash), not body parts.
- **Truncation handling rule** in `skills/lumiere/SKILL.md`. On output cap truncation, narrow the time window at the SAME fps; never drop to coarser fps that loses temporal resolution where the action lives.

### Changed

- **Cost estimator parity** (`estimateWatchCost` in `src/defaults.ts`). Was using `calculateAutoFps` in isolation (fps=2 for short videos) while `watch` actually uses `view_sample / duration` (fps=25 at low tier on a 24s video). For a 24s clip at low, inspect predicted 8.7K tokens but reality was 86K. Now both call the same `deriveFpsForBudget` helper. The 10x undercount that caused mid-stream truncation in the blind retest is fixed.
- **`exceeds_mcp_cap_per_call`** added to `CostEstimate`. When a single chunk would exceed the MCP 100K per-call cap, chunks are split by token-budget instead of by time so each chunk fits.
- **`narrative_mode` prompt v2.** Expanded with priors that target the V1 blind-retest failure modes: branded-character = fixed-identity (no identity-swap default), novel-color-in-1-2-frames = EVENT (not body part), feature-channel tracking (eyes / hands / mouth / body baseline), silhouette-area-conserved dramatic outline change = pose/prop (not transformation), expanded verb taxonomy (physical / emission / equipment / manipulation).
- **`shouldAutoSuggestNarrative`** considers four signals now (was two): global motion, scene cut density, `has_motion` verdict (catches subject-only motion), and palette outliers (catches emission events).

### Fixed

- **Hallucinated transcript leak.** When `transcription_low_confidence=true`, the analyze tool now replaces the bogus text (e.g., the "ご視聴ありがとうございました" whisper-on-silence hallucination) with a clean `[low confidence: likely silent / music-only audio; whisper output suppressed]` placeholder. Before, the flag was set correctly but the false string still surfaced in the transcription block.
- **Frame-label collisions in cache manifest.** With sub-second timestamps, multiple frames in the same second no longer collide in the manifest dedupe, so cache lookups via the `view` param work correctly at fps >= 2.

### Notes

- The plumbing-test run confirmed all v0.3 wiring worked except the cost estimator. v0.4 closes the gap.
- The narrative_mode v2 priors are general (do not bias toward any specific subject, genre, or palette).
- ROI auto-crop and variable-fps segmentation are still v0.5+ backlog.

## [0.3.0] - 2026-05-19

### Added

- **`narrative_mode` on the `watch` tool.** When `true`, the response includes generic temporal-narrative guidance (anchors / changes / actions / transitions / state changes) so the model reads consecutive frames as one continuous action instead of as independent images. Generic across genres (animation, sports, cooking, UI demos, agent screen captures).
- **Tier-gated confidence hint.** At resolution <= 512 (low/mid), `narrative_mode` additionally injects a hedge instruction asking the model to write "looks like X" instead of asserting X when silhouettes are ambiguous. Empirically prevents the "confident misreading" failure mode caught during the 2026-05-19 dispatch test.
- **Auto-suggestion of narrative_mode.** If a prior `analyze()` on the same video session reported high motion content profile OR dense scene cuts (>0.3 cuts/sec), the next `watch()` call auto-injects narrative guidance even without the explicit flag.
- **Cost estimator** (`estimateWatchCost`, `estimateAllTiers` in `src/defaults.ts`). Pure functions that forecast per-call and full-coverage token burn for any tier given a video duration. Used by `inspect` to give callers a pre-flight context budget preview.
- **Per-tier cost preview in `inspect`.** `inspect()` now returns `cost_estimate.per_tier` with `est_tokens_per_call`, `chunks_for_full_coverage`, `est_total_tokens_full_coverage`, `pct_of_1m_window`, and `will_trigger_autocompact` for each of low/mid/high/max. Also a `recommended_mode` field that steps down from the user's default if full coverage would exceed the autocompact threshold.
- **Per-call cost feedback in `watch`.** Every `watch()` response now reports `est_tokens_this_call`, `full_coverage_chunks_needed`, and an `autocompact_warning` so the caller can plan subsequent chunks without arithmetic.
- **Documented set-default-mode command.** The `/lumiere` skill's instructions now explicitly tell the model to call `configure(default_mode=...)` when the user says "set lumiere to max" / "/lumiere mode high" / "default to mid" or similar.

### Changed

- **`/lumiere` SKILL.md** rewritten to lead with the pre-flight workflow (inspect → cost preview → confirm/compact → analyze → watch). Adds operational rules around narrative_mode (when to use, when to leave off), motion-driven auto-suggest, and tier selection by use case.
- **Plugin/server/package version** bumped to `0.3.0`.
- **README** restructured: lists tools concretely, documents the preset table, narrative_mode, the pre-flight pattern, and the `MAX_MCP_OUTPUT_TOKENS=100000` recommendation.

### Fixed

- **Narrative-coherence bug at every tier.** Before v0.3, all four tiers (low/mid/high/max) misread continuous action sequences as sprite-sheet costume parades. Verified on the V1 ClaudeDevs `/goal` launch video: the 0:00-0:04 opening is a coherent superhero action beat (mascot puts on rope/wig, jumps, hovers, fires eye lasers, lands, removes rope) but all 4 tiers reported it as 8-12 unrelated costume variants. Root cause was the absence of a temporal prompt frame, not insufficient resolution. Dispatch test on 2026-05-19 confirmed that same frames + narrative-pass prompt move max from "paint splash / tongue / cartoon recoil" to "fires downward... exhaust, recoil, or projectile" with no new MCP calls. The fix is now codified in the tool itself.

### Notes

- `narrative_mode` is OPT-IN by default to preserve backwards compatibility, but auto-suggests when motion data warrants it.
- Cost estimator coefficients (`TOKENS_PER_FRAME`) are back-derived from empirical 100K-cap testing. Update them if future calibration runs show drift.
- The mid tier (`512px`) has a known failure mode with narrative_mode: forced to commit to an action interpretation, it can confidently hallucinate one (the 2026-05-19 test had it inventing a "barbell workout" for a laser-attack sequence). The tier-gated hedge hint is the mitigation; if it isn't enough, bump to `high`.

## [0.2.0] - 2026-05-19

### Added

- **Mode preset enum** (`low` / `mid` / `high` / `max`) on the `watch` tool, mapping to 384 / 512 / 1024 / 1536 px. Replaces "remember the magic resolution number" UX.
- **`default_mode` field** on `configure`, persisted to `~/.lumiere/config.json`. Server-wide default for callers that omit `mode`/`resolution`.
- **Per-server env-aware auto-budget**: when `MAX_MCP_OUTPUT_TOKENS=100000`, the watch tool reads a separately calibrated 100K table (low=600 frames, mid=350, high=120, max=50). Falls back to a conservative 50K table otherwise.

### Changed

- **Default tier set to `high` (1024px)** based on 3-way blind perception calibration: 1024 captures everything narratively + UI text + brand mechanics at ~340K context burn for a 38s video, where 512 drops below the recognizable-mascot threshold.

### Fixed

- **YouTube auto-captions bias** in transcription (was inserting "Woo!" x28 spurious lines on a 3-second window). Captions now route through a confidence-check before being preferred.
- **Scene-cut clustering** false positives (a 41-cut video was deduping to 5 incorrectly). The scdet parser now respects time-window separation.
- **`low_confidence` flag** wired through the full audio pipeline so callers can spot whisper hallucinations on music/silent audio.

## [0.1.0] - 2026-05-18

### Added

- Initial perception layer. Four MCP tools: `inspect`, `analyze`, `watch`, `configure`.
- yt-dlp routing for non-YouTube URLs (X/Twitter, Vimeo, direct mp4).
- Session manifest + frame cache for cross-call re-use.
- Auto-budget table per resolution to prevent MCP cap truncation.
- One user-invocable skill: `/lumiere`.

### Notes

- Fork-derived from `claude-video-vision` (v1.2.0, MIT, jordanrendric) which lives in `reference/` as study material. Lumiere is a clean reimplementation, not a fork.
