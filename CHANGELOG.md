# Changelog

All notable changes to lumiere. Format follows [Keep a Changelog](https://keepachangelog.com/) and the project adheres to [Semantic Versioning](https://semver.org/).

## [0.18.0] - 2026-06-13

### Added

- **Dashboard Preview version switcher**: point the Preview folder box at a directory holding a `versions.json` manifest (`{ versions: [{ dir, label?, file? }] }`) and arrow prev/next across the set, each composition loaded frame-exactly. Built for autonomous multi-version output (e.g. v1/v2/v3 launch-video directions) reviewed in one place. The skill writes `localStorage["lumiere-preview-dir"]` after a build so the switcher auto-loads when the user opens Preview (once per session; a bad manifest no longer sticks or retries forever).
- **MCP server `instructions` field**: states lumiere's two halves (perception MCP tools + creation skill flow) so a session can no longer reverse-engineer "lumiere can't generate" from the perception-only tool list. `inspect`'s description carries the same pointer.

### Changed

- **Creation flow reframed as author -> review-in-Preview -> export** (`skills/lumiere/SKILL.md`): a top-of-skill default-entry rule, a step-0 project-dir convention, headless composer-driving when a browser is reachable, a `storyboard.md` round-trip artifact, the `window.__timelines.main` previewable-by-construction contract, the `versions.json` schema, autonomous multi-version mode (default 3 distinct directions, no mp4 until a winner is picked), and an explicit Review step (Preview is the review surface; mp4 render is the final export). Export step now documents the audio caveat (hyperframes mixes audio; the own engine is video-only), the output/fps defaults, and the Preview error-to-cause map.
- Hand-edited locks demoted to an escape hatch in `creation/LOCK.md` (the canonical path is author -> Preview -> export); `creation/RESTAGE.md` documents the previewable/renderable `__timelines` contract and the harmless render-time font double-fetch.

## [0.17.1] - 2026-06-06

### Fixed

- **Whisper hallucination denylist hardened for punctuation variants**: the Spanish entry now tolerates leading inverted punctuation (`¡Gracias!`, `¿Gracias?`, doubled `¡¡Gracias!!`) and the German/French/Italian thanks entries accept trailing `!`/`?` and spaced punctuation (`Grazie!`, `Merci !`) instead of only a period. Previously `¡Gracias!` (observed verbatim on silent gym audio) slipped past transcript suppression.

### Added

- Unit suite for the hallucination denylist (`src/utils/hallucination.test.ts`): 34 cases anchoring suppressed phrases, the deliberate multi-word non-suppression boundary (`muchas gracias` stays), and Signal 3 flagging both ways.

## [0.17.0] - 2026-06-06

### Added

- **Composer hover spotlight**: hovering an effect row floats a 420x280 live preview that trails the cursor on a lerp spring (side-flip with viewport clamping on both axes, shimmer while the effect mounts with a load fallback, replay on re-hover). One iframe alive at a time; torn down on view switch; hides on token insert and revives on the next mouse move.
- **Composer category chips**: All / Camera / Reveal / Text / Data Viz / Chat / Motion / Layer / UI with counts, built from the effect metas, ANDed with the text search; re-tapping the active chip resets to All.

### Changed

- **Composer is now a viewport-pinned workbench**: compact tool header (one-line lede), storyboard textarea absorbs the vertical slack, both panes share top and bottom edges, the rail and command preview scroll internally, no page scroll.
- Scrollbars are hidden dashboard-wide (panes still scroll via wheel/trackpad/keys).
- Picker rows carry their category on `dataset.cat` (filtering is O(rows) per keystroke instead of O(rows x effects)).

## [0.16.0] - 2026-06-06

### Added

- **Creation pipeline** (`creation/`): the SCAFFOLD phase ships. `LOCK.md` + `launch-video.lock.schema.json` (strict JSON Schema 2020-12) define the machine-readable design lock; `_tools/validate-lock.mjs` (bun + Ajv) checks schema plus cross-field timing invariants (leading dead air, gaps, overlaps with a `transitionOut` crossfade escape hatch, duplicate ids, duration drift); `RESTAGE.md` is the canonical effect-to-composition procedure (composition shell template with stage dims derived from the lock, six mechanical steps, de-timer recipes for the 7 wall-clock effects, hard rules, verification protocol).
- **Skill creation route**: `/lumiere create` (or a storyboard `.md` / lock path) dispatches to a 5-step creation flow: resolve docs, read the storyboard (composer paren-overrides map to `effects[].vars`), establish + validate the lock, restage scene by scene, gate on lint (hyperframes `inspect` documented BEST-EFFORT: it crashes upstream on 0.6.7/0.6.75).
- **Studio dashboard** (`dashboard/index.html`): three views. Library (the 79-effect grid), Composer (freeform-prose storyboard + token picker with per-effect knob hints from `meta.variables`, draft persistence, copy-command resolving `<effect-id>` tokens to canonical paths), Preview (loads any composition, scrubs the registered `window.__timelines` master frame-exactly, play/pause, copy-render-command).
- **Stable render entry** (`bin/lumiere-render.mjs`): `--engine hyperframes|own`, lock-driven defaults (fps, output, resolution preset derivation), loud failure when the hyperframes engine cannot honor the lock's render dims (never a silent stage-resolution render).
- **Own render pipeline** (`render/own-renderer.mjs`, studio v3): frame-exact renderer driving the registered paused timeline per frame via puppeteer-core + system Chrome + ffmpeg image2pipe. Lock-driven integer-multiple upscaling via deviceScaleFactor, autoplay disarm, fitStage neutralization, exact hyperframes frame-count parity (`ceil(duration * fps)`, verified empirically against the CLI).
- **Per-use variables contract** (`effects/FORMAT.md` "Variables"): `meta.variables` defaults with `?vars=<json>` shallow atomic overrides; `speed` knob convention (timeScale XOR divide, never mix). Piloted on `wordmark-rise`, `dolly-zoom`, `donut-chart-fill`, `chat-input-typing`.

### Fixed

- `effects/_runtime.js` now enforces the `speed > 0` contract (invalid overrides drop to the effect default with a console error); the lock schema types `vars.speed` with `exclusiveMinimum: 0`.
- `donut-chart-fill` legend is built with DOM APIs instead of `innerHTML` (closes an XSS sink reachable from URL-controlled `?vars` data).
- `ajv`, `ajv-formats`, `puppeteer-core` moved from devDependencies to dependencies (the validator and own renderer import them at runtime from the installed plugin).
- Render spawn failures (`npx`/`bun` missing) now surface the underlying error instead of a bare exit code.

## [0.15.0] - 2026-06-05

### Added

- **Canonical effect library** (`effects/<id>/effect.html`): every one of the 79 effects is now a standalone, self-describing, video-ready file carrying its own meta JSON, verbatim CSS, and init code. One source of truth: the dashboard previews these exact files, verification harnesses scrub them, and the creation pipeline references them by path. Spec at `effects/FORMAT.md`; ordered manifest at `effects/index.json`.
- **Shared effect runtime** (`effects/_runtime.js`): contentful rest-state mount, `LUMIERE_REPLAY`/`LUMIERE_PREPARE` (lazy HyperFrames-style `window.__timelines` registration), a portable postMessage bridge (replay/theme/prepare/seek), per-card init-error isolation, and an embedded full-bleed mode so dashboard iframes behave exactly like the old fluid card viewports.
- **Vendored fonts** (`effects/_fonts/vendored.css`, OFL): Outfit 200-700 variable + Geist Mono 400/500 woff2, replacing the Google Fonts CDN link that qutebrowser silently blocks on `file://`.

### Changed

- **Dashboard cards are now iframes of the canonical effect files.** Metas are parsed from each file at boot, iframe srcs are cache-busted per load (manual `?v=` bumps gone), the theme toggle broadcasts into every frame, and cards lazy-load. Conversion verified zero-drift: a 79-agent code audit plus a frame-by-frame pixel pipeline (74/79 bit-identical; 5 documented benign artifacts), plus lumiere motion checks.
- **`composer-commit` rebuilt faithful to its ChatGPT reference**: a centered composer holds, the commit is a hard swap, and the finished bubble rises into the top-right corner. Replaces the invented flight-morph.
- **`chat-input-typing`**: the input bar is now fixed-width with text typing inside it (previously grew with the text).
- Dashboard `index.html` slimmed from 3,082 to ~960 lines; per-effect CSS lives in the effect files.

### Fixed

- `morphing-node-graph` and `chat-conversation`: raw randomness replaced with the house seeded rng, restoring the determinism contract scrubbed rendering depends on.
- Dashboard hardening from the seal review: meta strings escaped before card markup, boot failures and partially-failed effect loads surface visibly instead of silently, a replay double-fire race fixed, the postMessage handler only trusts the dashboard's own frames, and stale hardcoded sidebar counts removed.

### Removed

- `dashboard/effects.js` (5,134 lines) and `dashboard/vendor/gsap.min.js`, superseded by the canonical effect files and `effects/_vendor/`.

## [0.14.1] - 2026-06-02

### Changed

- **Mascot unification**: every mascot-bearing effect now uses one canonical sharp-pixel sprite (coral body, lit top stripe, dark limb-nubs and eyes). `pixel-mascot-idle-bob`, `wand-sparkle-burst`, `mascot-prop-equip`, `mascot-celebration-hop`, `lightbulb-idea-pop`, and the `lasso-twirl-throw-capture` cowboy were re-skinned to match `mascot-pose-turn`, replacing the prior mix of rounded-blob and flat critters.
- **`lasso-twirl-throw-capture` rebuilt**: the broken orthogonal-staircase rope is gone. A pixel cowboy now twirls a gold loop overhead, throws it to ring a floating session card, and reels the catch into a "captured" list, settling on a populated rest state.
- **`globe-rotate-flightpaths` rebuilt** to read as a true 3D sphere: radial shading, an edge vignette, latitude rings, and a sweeping meridian wireframe (rotation), with drifting continents under the city chips and flight arcs.
- **`tab-switch-bodyswap`**: body content now cross-fades with a micro-slide instead of a hard cut.

### Fixed

- `confetti-burst` erupted above the frame and skewed right; it now bursts from the success check, fans symmetrically in-frame, and rains down over the modal.
- `status-badge-resolve` (Queued-to-Resolved): the status glyph no longer overlaps the COMPLETE / NEEDS-REVIEW labels (dot is the queued indicator, glyph the resolved one).
- `waterfall-bridge-chart`: decrease-bar connectors now carry the running total (no longer float above the next bar), and the chart uses a zoomed baseline so the small deltas read as proper steps instead of slivers.
- `card-tilt-disperse`: dispersed cards stay fully in-frame; replay no longer leaks the live-counter tween.
- `focus-band-carousel`: removed the stray full-width line and replaced the stepped dimming with a smooth color gradient.
- `split-screen-diptych`: the phone notification is no longer cut off (widened phone, full two-line message).
- `source-citation-popover`: dropped the orphaned trailing period; filename + page stay on one chip.
- `tab-switch-bodyswap` underline now sits exactly under the active tab (removed a CSS/translate double-offset).
- `mascot-pose-turn` / `hand-drawn-stroke-construct`: replay-safety (kill the prior timeline; reset the drawing nib's scale).
- `playful-spinner-verb`: the leading glyph is now a coral spark that spins continuously (previously a static dot at rest).

### Removed

- `spark-mark-bloom` (the Claude spark-mark bloom) removed; library 80 -> 79 effects.

## [0.14.0] - 2026-05-31

### Added

- **33 new dashboard effects** extracted from 8 Claude/Anthropic reference videos (Claude Code Fast mode, /goal, agent view, push notifications, /ultrareview, session recaps, the Code w/ Claude conference, and Claude for Financial Services), taking the library from 47 to 80 primitives. Highlights: the parametric pixel-mascot set (`pixel-mascot-idle-bob`, `mascot-prop-equip`, `mascot-celebration-hop`, `mascot-pose-turn`), data-viz (`waterfall-bridge-chart`, `morphing-node-graph`, `session-dashboard-list`, `agent-to-agent-pipe`, `globe-rotate-flightpaths`, `status-badge-resolve`), UI motifs (`toggle-flip-on`, `status-bullet-flip-green`, `ios-notification-banner`, `focus-band-carousel`, `workflow-stepper-progress`, `playful-spinner-verb`, `goal-active-timer-badge`), and reveal/camera/layer/chat effects (`spark-mark-bloom`, `hand-drawn-stroke-construct`, `source-citation-popover`, `perspective-tilt-settle`, `split-screen-diptych`, `focus-pull-dim`, `lasso-twirl-throw-capture`, `confetti-burst`, and more).
- **Source-provenance filter**: a new "Sources" sidebar section tags every effect (all 80, new and existing) with the reference video(s) it came from and filters the grid by source. Effects reused across multiple videos appear under each one.

### Fixed

- All 33 new effects validated at the live ~360x240 card size. `morphing-node-graph` edges now render (a CSS `stroke-opacity:0` was overriding the JS-set attribute, leaving only the nodes); status-badge label spacing tightened.
- Code-review hardening: `playful-spinner-verb` no longer accumulates `setTimeout` handles across its idle-loop cycles; `goal-active-timer-badge` replay now kills its prior `repeat:-1` timeline (no text-reset race on rapid re-hover); `focus-band-carousel` caches its chip-dot lookups out of the per-frame path; the filter-chip handler clears stale empty-state notes.
- Dashboard `effects.js` cache-buster bumped so reloads pick up the new build.

## [0.13.0] - 2026-05-30

### Added

- **5 new dashboard effects** from the ChatGPT personal-finance rewatch: `headline-type-on` (chrome-less centered headline that auto-fits and types in), `meter-rows` (icon + label + inline fill-bar + value rows), `composer-commit` (composer pill lifts and anchors as a sent user bubble top-right), `status-cycle` (Thinking/Querying/Received/Thought-for reasoning indicator with shimmer), `logo-mark-signoff` (wordmark crossfades to a monoline mark that scales + strokes in).
- **Newest-first ordering** in the dashboard "New" filter view (latest additions float to the top).

### Changed

- **Rebuilt `inline-word-stream`** to match the reference opening title: "With" reveals centered, the whole wordmark glides left on one continuous eased settle while "Chat" reveals as a word and "GPT" types per-character. No reflow jitter, no blur.
- Refined `donut-chart-fill` description to note the light-blue cash wedge alongside the green-gradient palette.

### Fixed

- **Full 1:1 audit of all 17 ChatGPT-sourced dashboard effects** against the reference video, fixing 6 that were sized for the 640x360 build preview rather than the live ~360x240 card: `headline-type-on` (font auto-fit so the full sentence no longer clips), `meter-rows` (reworked from a fixed 560px card so all 6 rows + fill-bars fit), `spinner-to-dot` (added Fidelity + Robinhood for the full 6-account top-to-bottom sync), `composer-commit` (measures the live stage so the bubble anchors top-right at any card size instead of flying off-screen), `inline-card-render` (added the Crypto holding + "5 holdings across 3 accounts" subtitle), `chat-conversation` (added the end-of-message action-icon row and fixed a re-trigger stream race).
- Dashboard `effects.js` cache-buster bumped so reloads pick up the latest build.

## [0.12.2] - 2026-05-25

### Fixed

- **Multilingual Whisper hallucination detection.** Added 13 phrase patterns covering Indonesian, German, Spanish, French, Italian, Chinese, Russian, Portuguese, and English filler hallucinations observed on gym ambient audio.
- **Short-chunk hallucination signal (Signal 5).** Single segment with <= 4 words on a sub-5s chunk is now flagged as likely hallucination. Catches novel single-phrase outputs that don't match the known-phrase list.
- **Chunk-duration passed to hallucination gate.** `applyHallucinationGate` in watch now receives the actual chunk duration (from start_time/end_time) instead of the full video duration, so the short-chunk signal fires correctly on per-chunk watch calls.

## [0.12.1] - 2026-05-25

### Fixed

- Add `dashboard` to `/lumiere` skill argument-hint so it shows as a prefilled option.

## [0.12.0] - 2026-05-25

v0.12 strips the content-class narrative routing system and replaces it with one universal guidance prompt. The model determines what it's looking at from the frames alone, no domain-specific priors. Also ships the effects dashboard and per-tier temporal density (fps).

### Added

- **Effects dashboard** (`dashboard/`). Pure HTML gallery of all lumiere effects with GSAP animations. Opens via `/lumiere dashboard`. Uses `$LUMIERE_BROWSER` env var (falls back to system default).
- **Per-tier `targetFpsThorough()`**. Replaces flat 1.0 fps constant. low=1.5, mid=3.0, high/max=6.0. Higher tiers now produce more chunks with finer temporal resolution.

### Changed

- **Universal `NARRATIVE_GUIDANCE`** replaces 7 per-content-class profiles (animation, ui-screen, human-motion, talking-head, real-world, nature, generic). One clean temporal-sequence prompt for all video types.
- **SKILL.md chunk enforcement** tightened: "EXACTLY N chunks, no merging. If N feels large, ask user instead of silently reducing."
- **`adaptive_sampling`** no longer auto-enables when `narrative_mode` is on. Opt-in only (explicit param or server config default).

### Removed

- `narrative_mode_profile` parameter from watch tool (breaking: callers passing this get zod rejection).
- `resolveNarrativeProfile()`, `NarrativeProfile` interface, `NARRATIVE_PROFILES` registry.
- `paletteOutlierHint()` injection (model sees colors without being told what to interpret).
- `LOW_TIER_HEDGE_HINT` constant (universal guidance includes resolution-aware hedge).
- `content_class`, `bbox`, `motion_detection_warning` from Budget block output.

## [0.11.5] - 2026-05-22

Adaptive sampling could leave huge unsampled gaps when motion_windows fired on background animation (e.g. the Claude AI conference promo where a 0.6s city-pin transit was the only window in an 18s pixel-art mascot clip). After `probe_calibration` aggressively retuned view_sample to 2 against a dense middle probe, the remaining ~16s of timeline got zero coverage past the bookends, including the actual headphone equip/unequip events. The original concentration-based gap warning couldn't fire at small budgets either (budget ratio caps at 0.5 with 2 frames). v0.11.5 adds three layered fixes so frames spread across the timeline whenever motion signals are too sparse to trust.

### Added

- **Uniform-fallback path in `buildAdaptiveSegments`**. When motion windows cover <8% of the active span AND total budget <6 frames, the planner emits N micro-segments at sub-span midpoints (one frame each) instead of concentrating 70% of the budget into the tiny motion window. Same total frame count, but max gap = activeDur/totalBudget seconds instead of activeDur (the original placement).
- **`applyProbeDensityFloor`** floors `probe_calibration`'s view_sample retune at `max(2, ceil(activeDur/5))`, capped at the original auto-budget. Guarantees ≥1 frame per 5s of timeline without ever exceeding what the auto-budget would have given pre-probe (so the MCP-cap protection role of probe_calibration is preserved for cases where the probe is correctly aggressive).
- **Density-based sampling warning** (`samplingDensityWarning`). The original gap warning required >60% of budget concentrated in <30% of timeline, which can't fire at small budgets. The new path fires whenever the largest contiguous unsampled span exceeds `min(5s, 30% of timeline)`. Surfaces the gap, names what events it might miss (equip/unequip, costume swap, prop in-hand), and prescribes concrete follow-ups (chunk the call, drop tier, pin a segment).
- **`"uniform"` kind** added to the `AdaptiveSegment.kind` union so the budget block honestly labels fallback micro-segments as "uniform (fallback)" instead of misreporting them as "static".

### Changed

- `formatSegmentBound` now emits sub-second HMS precision (`00:00:04.125`) instead of rounded whole seconds. Prevents adjacent uniform-fallback micro-segments from collapsing into duplicate HMS strings at sub-second spans.



`has_speech` v0.11.3 was over-permissive: any non-empty transcript counted as speech, so a music marker ("🎵") in a waterfall timelapse + single-word whisper hallucinations ("Våldskapitalet") on near-silent astronaut footage both triggered the instructor human-motion rule.

### Fixed

- **Tightened `has_speech` to require ≥3 alphabetic words AND ≥15 alphabetic chars** in the transcription. Single-word hallucinations and emoji-only music markers no longer count as real speech. Restores nature/real-world classification for silent / music-only / hallucinated-on-quiet content.

## [0.11.3] - 2026-05-21

Disambiguating the "speech present" signal in `content_class` rules. The v0.11.0-0.11.2 classifier used `transcription_low_confidence !== true` as a proxy for "speech is present", but `undefined` matched both "clean speech detected" AND "no audio / VAD-suppressed". This caused waterfall + astronaut POV (silent content) to false-flag as human-motion under the v0.11.1 instructor rule. Also adds a palette-free animation path for cinematic motion-graphics teasers.

### Fixed

- **`has_speech` boolean signal added to classifier inputs**. Computed in `analyze.ts` from `analysis.transcription`: true only when transcription has real segments (not the LC-suppression sentinel, not VAD-suppressed). The human-motion instructor rule now requires `has_speech === true` so silent timelapses / POV cameras don't mis-fire.
- **Animation rule for palette-less cinematic teasers**. After v0.11.2 added the strong-palette filter (cd > 25), the Apple Vision Pro film montage produced palette_count=0 even though it IS animation. Added a fourth animation branch: `ms < 35 && mt < 15 && cuts ∈ (0.2, 0.6) && lc !== true` → animation. The very low spatial complexity (< 35) distinguishes flat cinematic film palettes from edited talking-head studio detail (ms typically > 50).

## [0.11.2] - 2026-05-21

`palette_outliers` count was meaningless: `detectPaletteOutliers` caps output at top-50 by chroma_distance, so EVERY video with `exposure` enabled gets ~50 outliers regardless of whether the events are real emission/projectile flashes or just brightness ramps from natural footage. v0.11.1 auto-enabled exposure (good for the palette signal), but the classifier was reading the saturated count as "this is animation".

### Fixed

- **palette signal denoising**: `content_class` classifier in `analyze` now counts only "strong" palette outliers (chroma_distance > 25) instead of the raw cap-limited array length. Filters out brightness/saturation noise (cd ~5-15) and keeps genuine color novelty events (cd > 25 for emission flashes, projectile bursts, animation color shifts). Restores correct classification for gymnastics tutorials (now → human-motion), kitchen footage (→ generic acceptable), waterfall timelapses (→ nature), and astronaut POV (→ real-world) — all four had been mis-routed to animation by the saturated palette count post-v0.11.1.

## [0.11.1] - 2026-05-21

Classifier rigor patches surfaced by a 5-fresh-video live test post-v0.11.0 ship (4/5 false-flags on gymnastics tutorial, cooking onion, waterfall timelapse, Apple Vision Pro teaser, astronaut ISS POV). 57-case test suite (17 real-signal smoke + 40 fuzz cases covering boundaries, adversarial, conflicts, missing-signals, weird-content) now all green.

### Fixed

- **`palette_outliers` was silently absent when callers passed `motion: true` without `exposure: true`**. The animation classifier rule (palette ≥ 3) needs this signal to fire; without it, motion-graphic content (Apple Vision Pro film-clip montage with palette shifts) fell through to talking-head. `analyze.ts` now auto-enables `exposure` whenever `motion` is requested. Cheap: adds ~50ms of already-parsed signalstats data.
- **Nature timelapse mis-classified as real-world** when scdet false-positives on timelapse frame transitions push `cuts/s` above the 0.1 nature gate (waterfall: cuts/s=0.28). Added a second nature branch: moderate ti (15-35) + low spatial complexity (si < 60) + no palette + no subject dominance + no speech → timelapse / continuous-flow nature. Distinguishes from drone-over-terrain (si > 60).
- **Real-world rule now requires `si > 60`** (varied terrain detail) OR strong subject dominance. Pure uniform-color nature scenes (waterfall, clouds, wildlife) with bbox-fail + moderate ti no longer mis-fire as dashcam/POV.
- **Gymnastics-style instructor content** (athlete small in busy background, subject ti barely above global, narrator present) fell through to `generic`. Added human-motion instructor rule: `bboxFail && mt > 18 && cuts < 0.4 && lc===false && st > 18` → human-motion. Catches gymnastics tutorials, yoga instruction, fitness explainers.
- **Cinematic animation montage** (Apple Vision Pro teaser: ti=9.4, palette=6, cuts=0.37, si=29) was routed to talking-head because the original palette animation rule required `cuts < 0.3 OR lc===true`. Added third animation branch: `palette ≥ 5 && mt < 15 && cuts > 0.2 && si < 50` → animation. The `si < 50` gate distinguishes flat cinematic colors (Apple film montage) from edited talking-head with colorful B-roll (42 Berlin: si=75 with palette=50).

### Internal

- Test suite expansion: `/tmp/lumiere-smoke-classify.ts` now covers 17 real-signal cases including 5 fresh-video signals from the v0.11.0 rigor live test. `/tmp/lumiere-classifier-rigor.ts` adds 40 fuzz cases across boundaries, adversarial, multi-rule conflicts, missing-signals, long-duration, weird/extreme content. 57/57 pass.

## [0.11.0] - 2026-05-21

Universal-quality release. Lumiere now classifies videos into seven content classes (animation, ui-screen, human-motion, talking-head, real-world, nature, generic) and routes each to a dedicated narrative-mode prompt + dedicated motion-detection strategy. The five issues surfaced on real-world human-motion content (fitness footage) are all closed; the perception layer is no longer animation-biased.

Validated across five rounds of 4-way parallel tmux testing covering deadlift footage, animation reels, edited talking-head shorts (MKBHD), sports highlights (NBA dunk), terminal UI demos (Claude Code /goal), 42 Berlin terminal short, and dashcam content. 12/12 smoke cases pass; all 4 tiers PASS on the deadlift anchor with the synthetic-middle motion-window fallback firing correctly.

### Added

- **`analyze.content_class`**: structured 7-way classification (`animation` | `ui-screen` | `human-motion` | `talking-head` | `real-world` | `nature` | `generic`). Drives narrative-profile routing in watch() and is surfaced in the watch budget block as `content_class=<class> (bbox=<method>, conf=<n>)`. Computed in `src/utils/content-class.ts` from existing analyze signals; no extra ffmpeg passes.
- **`analyze.content_class_reasons`**: ordered array of signal explanations the classifier emitted. Useful for debugging mis-classification and for callers that want to log the signal trail.
- **`analyze.motion_detection_warning`**: surfaces when motion-windows are unreliable. Fires when global windows cluster at boundaries (entry/exit detected, not subject action) AND subject-region siti also finds no peaks; in that case the synthetic-middle fallback emits a single middle-60% best-guess window and the warning explains why.
- **`SubjectBbox.confidence` (0.0-1.0)**: lets callers decide whether to trust `roi=auto`. `cc` method with reasonable area_pct → 0.9; partial/edge → 0.4-0.6; center-prior heuristic → 0.2; cropdetect-fallback at full-frame → unreliable.
- **`watch.narrative_mode_profile`**: explicit per-content-class profile selector (`auto` | `animation` | `ui-screen` | `human-motion` | `talking-head` | `real-world` | `nature` | `generic`). Default `auto` reads `analyze.content_class`. Forces a specific profile when content is ambiguous.
- **Per-class narrative-mode prompts**: `src/prompts/narrative-profiles.ts` ships 7 curated guidance prompts. Animation keeps the v0.10 cape/eye-laser/mascot priors. ui-screen handles terminal/code/agentic UI. human-motion covers biomechanics / lift phases / rep counts. talking-head, real-world, nature, and generic round out the registry.
- **`bbox.centerPriorBbox`**: deterministic 60% center crop used as final fallback when CC + cropdetect both fail to find a tight subject. Better than `cropdetect-fallback` at full-frame (which defeats roi=auto entirely) for off-center subjects in busy backgrounds.

### Changed

- **`probe_calibration` defaults to ON** (was opt-in via `LUMIERE_PROBE_CALIBRATION=1`). Empirical: the static TPF table over-predicts for animation/UI content (probe lowers view_sample) and under-predicts for real-world content (probe also lowers view_sample, avoiding runtime_trim). Set `LUMIERE_PROBE_CALIBRATION=0` to disable globally. Adds ~150-300ms per watch() call.
- **`watch` audio path: cache-aware**. When `analyze.transcription_low_confidence=true` is cached in the session manifest, `watch()` skips the whisper re-run and emits the same skipped-reason text. Closes the issue 3 leak where every chunk got fresh whisper hallucinations ("OLD COMPTON STREET", "BATEMAN STREET") on ambient gym audio despite the analyze pass already flagging the audio as unreliable.
- **`buildMotionWindowsCommand` accepts optional `crop`**. Subject-region siti is the same code path as global siti, just with a `crop=W:H:X:Y,` prefix in the filter chain. Subsumes the v0.11-internal `buildSubjectMotionWindowsCommand`.
- **Bbox detector cascade**: `analyze.subject_bbox` now tries 3 tiers — CC segmentation (0.9 confidence when tight) → cropdetect (0.5 confidence when area_pct < 85) → center-prior heuristic (0.2 confidence). The pre-v0.11 path either returned a clean CC bbox or fell back to `cropdetect-fallback` at area_pct=100, which made `roi=auto` useless on busy-background content.
- **`shouldAutoSuggestNarrative`** (in `src/utils/decisions.ts`): primary signal is now `content_class`. Every class except `nature` and `generic` auto-fires narrative_mode.
- **Static motion-window end clamping**: `parseMotionWindowsFromMetaFile` now clamps window end to `durationSec - 0.5` to avoid the EOF-adjacent ffmpeg crash when extractFrames is asked to read past the file end at high fps.

### Fixed

- **content_class detector**: bbox-unreliable check now recognizes `center-prior` and any confidence < 0.3 as "subject can't be isolated", not just the v0.10 `cropdetect-fallback at area_pct=100` shape. Closes the deadlift mis-classification that made `human-motion` fall through to `generic`.
- **Motion-windows on slow continuous action**: when global windows cluster at boundaries AND subject-region siti also returns no peaked windows (typical for slow continuous motion like a deadlift / yoga / plank), the synthetic-middle fallback synthesizes a single middle-60% action window (intensity = `subject_motion.tiAvg`) so adaptive_sampling biases toward the action span instead of boundary noise. Surfaces the heuristic via `motion_detection_warning`.
- **Talking-head classifier with edited B-roll**: high-cut + high-spatial-detail + clean-speech content (MKBHD-style podcast shorts, 42 Berlin terminal short with presenter + caption overlays) now routes to `talking-head`, not `animation` or `human-motion`. New rule order: talking-head specialist fires BEFORE human-motion edited-sports rule when ms > 70 + cuts > 0.4 + speech is present.
- **Animation rule false-positives**: `palette_outliers >= 3` no longer dominates on edited talking-head content with colorful backdrops. The animation path now requires either (a) continuous shot (cuts < 0.3) OR (b) no clean speech (lc === true). Prevents 42 Berlin's 50-palette-outlier unicorn backdrop from triggering animation.
- **UI-screen classifier**: third detection branch added for sparse static-frame UI demos with near-zero ti + zero cuts + bbox detected (catches Claude Code TUI demos with mostly-blank cream backgrounds + small terminal text that the existing `ms > 180` and `ms > 100 + mt < 15` branches missed).
- **Nature classifier**: now requires `cuts/s < 0.1` in addition to low ti. Edited content with cuts (talking-head explainers, sports highlights) can no longer be mis-classified as nature even when motion is low.

### Removed

- **Dead code**: `NARRATIVE_GUIDANCE_LEGACY_ANIMATION_FALLBACK` (replaced by profile registry), `tokensPerFrameForClass` (probe_calibration supersedes static per-class TPF tables), `describeContentClass` (uncalled).

### Internal

- `src/utils/content-class.ts`: signal-based classifier (decision-tree of 11 rules over si/ti/cuts/palette/bbox/transcription signals). Smoke-tested against 12 real-signal cases from rounds 3-5 across all 7 content classes.
- `src/prompts/narrative-profiles.ts`: profile registry + per-class guidance prompts (~3-11K chars each, total ~50K chars). `resolveNarrativeProfile(explicit, cachedClass)` picks the right one.
- `src/extractors/bbox.ts`: confidence scoring per-method + `centerPriorBbox` fallback helper.
- `src/tools/analyze.ts`: 3-tier motion-window cascade (subject-region siti → synthetic-middle / tier-3 warning). Same control flow as the bbox cascade.
- `src/tools/watch.ts`: cache-aware audio path + `narrative_mode_profile` zod param + budget-block `content_class` + `motion_detection_warning` surfacing.

## [0.10.3] - 2026-05-21

Closes the eight v0.10.2 deferred backlog items + fixes one cross-chunk frame-collision bug surfaced during v0.10.3 validation. Round-2 retest across all four tiers green: probe_calibration respects start_time/end_time, no out-of-range frames, no duplicate timestamps, no runtime_trim activations.

### Added

- **`inspect.exact_tokens`**: opt-in flag. When `true` and `LUMIERE_ANTHROPIC_API_KEY` is set, inspect extracts one probe frame per tier and calls Anthropic's `/v1/messages/count_tokens` for exact per-frame conversation-token counts. Replaces the heuristic `min(1568, w*h/750)` image formula. Adds ~1-2s. Fallback heuristic is used when the key is missing or the param is unset. `cost_estimate.conversation_tokens_source` surfaces which path ran.
- **`watch.probe_calibration`**: opt-in flag (`LUMIERE_PROBE_CALIBRATION=1` env enables globally). Extracts one probe frame at the target resolution + crop BEFORE the main pool, measures actual chars/3.5, and re-tunes `view_sample` per-video. Lets outlier content (very dense terminal UI, very sparse flat colors) escape the static `SAFE_AT_100K` table. Budget block surfaces `probe_calibration=YES view_sample retuned X→Y (probe_chars=N)` or the disabled/failed states.
- **`CostEstimate.mcp_tokens_per_*` + `conversation_tokens_per_*`**: separates the chars/3.5 MCP transport metric (governs per-call truncation) from Anthropic image visual tokens (governs autocompact threshold). The v0.10.2 conflation made `pct_of_1m_window_thorough` over-warn autocompact at high resolution (max-tier on 24s reported 81%; actual conversation-token cost is ~8%).
- **`watch` Budget block**: now always emitted, even when `skip_metadata=true`. Splits the verbose Source / Manifest / Video / Audio dumps from the structured Budget block so the gate-verification protocol (the six green-line check) stays usable in narrative_mode and skip-metadata flows.

### Changed

- **`AudioResult.loudness`** discriminated union: `{ value: number; scale: "dbfs" | "lufs" }` replaces the parallel `mean_dbfs?` + `mean_lufs?` fields. Lets callers branch on the measurement scale instead of guessing which field is set. `hallucination.applyHallucinationGate` no longer takes an explicit loudness param; reads it off `audio.loudness`.
- **Anthropic image-token formula**: removed the `1568` cap from `conversationTokensPerFrame`. Validated 2026-05-21 against Opus 4.7 count_tokens that the cap doesn't apply at our tier resolutions; max-tier frames cost ~3028 tokens, not the 1568 the cap predicted. The bare `ceil(w*h/750)` formula matches within ~5%.
- **`inspect.cost_estimate` recommendation logic**: walks DOWN from the current tier (not up from max) when current overflows autocompact. The previous order recommended denser tiers as "fits better" which is wrong — higher tiers chunk more and burn more total.
- **`inspect` HMS construction**: probe-frame timestamps use `formatHMSPrecise` (was a hand-rolled `\`00:00:${probeAt.toFixed(3)}\`` that broke for videos > 60s).
- **Sub-second extraction timestamp threshold**: switched from `fps >= 2` to `Number.isInteger(1/fps) === false`. Low tier (extraction fps 1.5) now emits sub-second timestamps (`00:00:00.000`, `00:00:00.667`, `00:00:01.333`, ...) instead of integer-second duplicates (`00:00:00`, `00:00:00`, `00:00:01`).

### Fixed

- **Cross-chunk frame collision in `extractFramesBySegments`**: each watch() call's segments were written to `sessionDir/frames/<format>/<res>/s${i}/`. Different chunks of the same video used the same indices (s0, s1, ...) for different time ranges. ffmpeg overwrote leading `frame_NNNN.jpg` filenames but left trailing files from prior chunks behind, and `extractFrames` then mis-assigned timestamps to those stale files via `offset + i/fps`. Surfaced as `out_of_range_dropped > 0` and phantom frames past requested `end_time` on the v0.10.3 mid-tier probe retest. Fixed by writing to a per-call workdir, then copying into the session cache by timestamp (matches the regular extractFrames path). Helper `persistSegmentFramesToSession` consolidates the copy logic.
- **`workDir` leak on the session-enabled path**: `rmSync(workDir)` only fired when `!useSession`. With sessions enabled by default, every watch() call leaked ~20-50 MB of JPEGs into `/tmp/lumiere-<ts>/` until reboot. Now cleaned unconditionally after frames are copied to sessionDir.
- **Adaptive sampling per-segment cap**: `Math.max(2, ...)` floors in `buildAdaptiveSegments` could push the total above `totalBudget` when motion windows are short (max-tier chunk-3 V2 anomaly: 2 motion + 1 static segments tried to claim 3 frames against a 2-frame budget). New `distributeIntegerBudget` largest-remainder allocator honors the floor only when budget allows, then drops to greedy-by-weight when the floor would exceed total. Guarantees `sum == totalBudget`.
- **Truncation hint at sub-second tail**: distinguished `## Truncation hint (MCP cap mid-stream)` from `## Sampling note (fps quantization tail)`. When the remaining slack after the last frame is shorter than `1/fps`, no further frame is possible at the current rate — recommending "retry the remaining window at the same fps" would extract nothing. New hint recommends a higher fps for the tail.

### Internal

- `LoudnessReading` type added to `src/types.ts`; consumed by `backends/local.ts`, `tools/watch.ts`, `tools/analyze.ts`, `utils/hallucination.ts`.
- `distributeIntegerBudget` in `src/utils/adaptive-segments.ts`: largest-remainder integer allocator with optional floor. File-private.
- `conversationTokensPerFrame` in `src/defaults.ts`: shared Anthropic image-token formula used by both inspect's per-tier estimate and watch's budget block.
- `persistSegmentFramesToSession` in `src/tools/watch.ts`: shared between the segments and adaptive-segments extraction branches. Per-call workdir + copy-by-timestamp pattern matches the regular extractFrames path.
- `fitFramesForRuntimeCap` now reused by the probe-calibration block (was duplicating the chars/3.5 + overhead math).
- `estimateWatchCost` accepts `video_width` + `video_height` for accurate Anthropic image-token sizing per video; `exact_conversation_tokens_per_frame` lets the caller inject count_tokens results.

## [0.10.2] - 2026-05-21

Comprehensive cost-model overhaul plus four observability/consistency fixes. Subsumes the in-development v0.10.1 (never published) so this is the first public release after v0.10.0 with the full set of perception-pipeline corrections.

### Added (cost-model + extraction)

- **Tier-aware extraction fps** (`targetExtractionFps` in `defaults.ts`): low=1.5, mid=3.0, high=6.0, max=12.5. When `fps='auto'` and a resolution is known, `deriveFps` returns these values so higher tiers get a rich extraction pool for adaptive_sampling selection. Anchored to the 2026-05-19 max@12.5 test that produced the 7-mascot-state + 13-hex-code recovery on V2. Both `watch` and `measure` use it so predictions match runtime.
- **Proactive dynamic view_sample sizing** in `watch.ts`: before applying view_sample subsample, measures actual chars/frame from the extracted pool and lowers `effectiveViewSample` if content is denser than the static `TOKENS_PER_FRAME` table predicted. Prevents the post-extraction `runtime_trim` from firing on dense terminal-UI content. Surfaced as `proactive_sizing=YES|no (...)` in the budget block.
- **`out_of_range_dropped` always surfaced** in budget block (was hidden when count=0). Includes the dropped timestamps when non-empty; prints `out_of_range_dropped=0 (filter active)` otherwise. Lets callers confirm the filter ran.
- **`extraction_fps`, `effective_fps`, `proactive_sizing`** new fields in budget block alongside the existing `view_sample_applied`, `runtime_trim`, `out_of_range_dropped`. Full observability of every sizing decision.
- **AudioResult.transcription_skipped_reason + mean_dbfs + mean_lufs** fields on `AudioResult`. `mean_dbfs` is the volumedetect VAD measurement (fallback). `mean_lufs` is the ebur128 measurement reused from analyze when present. `transcription_skipped_reason` carries the gate's decision text.
- **VideoAnalysis.transcription_skipped_reason** propagated from AudioResult so analyze callers see the gate decision without re-checking AudioResult separately.
- **`HMS_REGEX` accepts sub-second times** on `watch` and `measure` start_time / end_time / segments fields (`^\d{2}:\d{2}:\d{2}(\.\d+)?$`). Lets callers target the sub-second tail of a video (e.g. `00:00:24.1` on a 24.107s clip) without ffmpeg aborting on a degenerate zero-length window.

### Fixed (cost-model calibration)

- **`TOKENS_PER_FRAME` recalibrated** against measured V2 content density: low 1900→2700, mid 2600→3800, high 6200→11000, max 11000→21000. The v0.9 values were calibrated on sparse-content videos; dense UI text + sharp edges in V2 produced systematic per-frame undercounting (max was 71% off). New values match observed `actual_est_tokens` across the v0.10.1 round-2 fps calibration test.
- **`SAFE_AT_100K` tightened** so view_sample_cap fits the new TPF with enough headroom that proactive_sizing stays silent on V2-class content: 384 38→25, 512 27→17, 768 16→8, 1024 11→4, 1536 6→2. Round-3 verification: 21 chunks executed across 4 tiers on V2, zero runtime_trim AND zero proactive_sizing activations, every chunk delivers exactly `view_sample_applied` frames.
- **Cache hash discrimination** (`computeVideoHash` in `session/manager.ts`): reads first 256KB (was 64KB) and includes video duration (rounded to ms). Eliminates the cross-video collision class where re-downloaded streams shared the same MP4 header prefix and file size despite different content (observed across V1 max, V2 mx-def/hi-def/mx-max/hi-max test cycles on 2026-05-20). Existing session caches invalidate on upgrade.
- **Whisper hallucination on silent/music-only audio**: VAD pre-gate via ffmpeg `volumedetect` (dBFS) or cached ebur128 (LUFS) measurement. Below threshold (-33 dBFS / -30 LUFS), whisper is skipped entirely with `transcription_skipped_reason='audio_too_quiet (...)'`. Catches the "Teksting av Nicolai Winther" / "ご視聴ありがとうございました" / applause-music-credits hallucination class observed across V2 V3 V4 test runs. Validated on 11 watch calls across 3 rounds without a single hallucination.
- **Out-of-range frame filter** in `watch.ts`: drops frames whose timestamp exceeds `metadata.duration_seconds + 0.1s`. Catches yt-dlp buffer overflow boundaries (e.g. V2 low-tier session manifest showing `last_timestamp=00:00:36` for a 24.1s video) and stale cache entries from the cross-video collision class. Dropped timestamps appear in the budget block.
- **Watch's `mean_lufs` → `mean_dbfs` rename**: watch measures dBFS via volumedetect, not LUFS via ebur128. Field name now matches the actual measurement scale (analyze keeps `mean_lufs` for its ebur128 measurement). Both can coexist on AudioResult when the cached-LUFS path is used.
- **Unified whisper hallucination detector** across `watch` and `analyze`: both call `detectLowConfidenceTranscript` (`utils/hallucination.ts`) and suppress flagged transcripts with `[low confidence: likely silent / music-only audio; whisper output suppressed]`. Previously only analyze ran the detector; watch could leak hallucinated text past the VAD gate on borderline-loud music.
- **LUFS caching from analyze** in `transcribeWithWhisper`: when analyze has already computed `loudness_summary.mean_lufs` for the full video, watch passes it as `cachedMeanLufs` to skip the per-chunk volumedetect call and unify the VAD scale. Saves ~150ms per chunk on chunked max-tier runs.

### Changed (cost_estimate shape — minor breaking)

- **Removed legacy fields** from `CostEstimate`: `chunks_for_full_coverage`, `est_total_tokens_full_coverage`, `pct_of_1m_window`, `will_trigger_autocompact`. These predated tier-aware extraction fps and produced misleading values (e.g. 51 chunks for max because the math assumed deliver-every-extracted-frame at 12.5fps). The `_thorough` variants remain as the canonical view. inspect's recommendation logic and watch's budget block already used the `_thorough` fields exclusively.
- **`inspect.cost_estimate.note`** rewritten to document the simplified field shape and direct callers to `measure()` for exact, model-aware token counts.

### Internal

- `deriveFps` (watch.ts) and `deriveFpsForBudget` (defaults.ts) take an optional `resolution` parameter; when set, consult `targetExtractionFps` first. Legacy `view_sample / duration` path retained as fallback.
- `computeVideoHash(videoPath, { duration })` is the canonical signature; callers in `watch.ts`, `analyze.ts`, `measure.ts` pass `metadata.duration_seconds` from the ffprobe step.
- `watch.ts` reorders so `getVideoMetadata` runs before session-dir derivation. The `view=` cache-lookup path also picks up the duration-aware hash.
- `transcribeWithWhisper(wavPath, model, { cachedMeanLufs? })` — new opts param; backward compatible when omitted.

## [0.10.1] - 2026-05-20

Four defensive fixes surfaced by the v0.10.0 retest cycle. Together they close the cache contamination, whisper hallucination, and tier-flat extraction gaps that polluted multiple test runs across V1 / V2 / V3 / V4 on 2026-05-20.

### Added

- **Tier-aware extraction fps** (`targetExtractionFps` in `defaults.ts`): when `fps='auto'` and a resolution is known, deriveFps now returns 1.5 fps (low), 3.0 fps (mid), 6.0 fps (high), 12.5 fps (max). Anchored to the 2026-05-19 max@12.5 test that produced the 7-mascot-state + 13-hex-code recovery on V2. Lower tiers scale geometrically (half the fps per step down). Both `watch` and `measure` use it so predictions match runtime; segments still override (per-segment fps wins).
- **`AudioResult.transcription_skipped_reason` + `mean_lufs` fields**: surface VAD pre-gate decisions and measured loudness so callers know when whisper was suppressed vs ran-and-returned-empty.
- **`Budget.out_of_range_dropped` block**: when ffmpeg / yt-dlp boundary cases emit frames past the video duration, the budget block lists the dropped timestamps so callers see the cleanup happened.

### Fixed

- **Cache contamination (`session/manager.ts`)**: `computeVideoHash` now reads first 256KB (4x more discriminating than 64KB) and includes the video duration (rounded to ms) in the hash. Closes the recurring "598 cached frames spanning 4:38 hash-bucketed into the new 24s V2 video" class of pollution observed across V1 max, V2 mx-def/hi-def/mx-max/hi-max test cycles on 2026-05-20. Existing session caches invalidate on upgrade (acceptable; the bug warrants fresh state).
- **Whisper hallucination on silent/music-only audio (`backends/local.ts`)**: VAD pre-gate via ffmpeg `volumedetect` runs before whisper-cli invocation. When mean loudness < -33 dBFS the audio is treated as silent and whisper is skipped entirely with `transcription_skipped_reason='audio_too_quiet (...)'`. Catches the "Teksting av Nicolai Winther" (Norwegian) / "ご視聴ありがとうございました" (Japanese) / "Tanya Cushman" / applause-music-credits class observed in V2 V3 V4 test runs.
- **Out-of-range frame filter (`tools/watch.ts`)**: after extraction, frames whose timestamp exceeds `metadata.duration_seconds + 0.1s` are dropped. Catches yt-dlp buffer overflow boundaries (e.g. V2 low-tier session manifest showing `last_timestamp=00:00:36` for a 24.1s video) and stale cache entries from the cross-video collision class. Dropped timestamps appear in the budget block.

### Internal

- `deriveFpsForBudget` (defaults.ts) and `deriveFps` (watch.ts) take an optional `resolution` parameter and consult `targetExtractionFps` first. Legacy `view_sample/duration` path retained as fallback when resolution is not known.
- `computeVideoHash(videoPath, { duration })` is now the canonical signature; callers in `watch.ts`, `analyze.ts`, `measure.ts` pass `metadata.duration_seconds` from the ffprobe step. `getSessionDir` gained the same options shape.
- `watch.ts` reorders: `getVideoMetadata` runs before session-dir derivation so the duration is available for the hash. The `view=` cache-lookup path now also picks up the new hash.
- `transcribeWithWhisper` calls `measureMeanDbfs` (volumedetect filter, ~150ms) before invoking whisper-cli. The threshold (-33 dBFS) sits between the V2 V3 V4 silent-audio floor (-36 to -42) and the loudest music-only segments observed in the test corpus.

## [0.10.0] - 2026-05-20

Codifies thorough-coverage multi-chunk default at every tier. Closes the v0.9 regression where only max tier (via memory file) was doing the multi-chunk pass while low/mid/high were stuck on single-call discipline. The tier-flattening behavior the 2026-05-19 4-way test exposed (all tiers ~92K) is now corrected in the skill workflow itself, not via memory hedge.

### Added

- **`cost_estimate.per_tier.*` thorough-coverage fields**: every per-tier entry now reports `target_fps_thorough` (1.0), `chunk_duration_thorough_seconds`, `chunks_for_full_coverage_thorough`, `est_total_tokens_thorough`, `pct_of_1m_window_thorough`, `will_trigger_autocompact_thorough`. The legacy single-call fields stay for backwards compatibility but the skill workflow consumes the thorough ones.
- **`TARGET_FPS_THOROUGH = 1.0`** constant in `defaults.ts` anchored to the temporal density the `low` tier naturally achieves (38 frames / 24s ≈ 1.58fps). The formula `chunks_needed = ceil(duration / (view_sample_cap / TARGET_FPS_THOROUGH))` produces tier-monotonic chunk counts: low 1 chunk per 38s, mid 1 per 27s, high 1 per 11s, max 1 per 6s.

### Changed

- **`/lumiere` skill workflow: thorough-coverage chunking is now a HARD RULE for ALL tiers.** Replaced v0.9's "motion-window drill HARD RULE for high/max" + low/mid skip with a uniform "N sequential watch() calls per `chunks_for_full_coverage_thorough`". Every tier covers the full video at its tier's spatial × temporal density. The motion-window drill becomes additive (only when a chunk's density was insufficient for an animation event), not a substitute for full coverage.
- **`inspect` recommendation logic** now considers the thorough-coverage total, not the legacy single-call total. If `will_trigger_autocompact_thorough` is true at the current tier, the recommendation walks down tiers until thorough coverage fits. Pre-flight gate phrasing in the skill aligned to this.
- **Pre-flight gate phrasing** in the skill: surfaces chunk count + projected pct of 1M context for the full thorough pass, offers (a) accept (b) drop tier (c) /compact (d) sub-segment. Default is (a) because the operator picked the tier.

### Internal

- `CostEstimate` interface extended with the six thorough fields without breaking the legacy fields.
- `estimateWatchCost` computes thorough chunk count = `ceil(duration / (view_sample_cap / TARGET_FPS_THOROUGH))` and total tokens = chunks × est_tokens_per_call.
- `inspect`'s `cost_estimate.note` rewritten to document both views (legacy single-call vs thorough) so consumers know which fields to read.

## [0.9.0] - 2026-05-20

Default-behavior overhaul to close the gap between rigorous test methodology and live use. Driven by the 2026-05-20 Claude /goal launch-video case: at the configured high/max tier the global watch call sampled too sparsely (11/6 frames over 24s) and missed the opening + closing mascot animation (cape equip, hover, downward emission, landing). v0.9 makes every tier produce the extreme-detail read this video deserves.

### Added

- **Motion-aware `runtime_trim`**: when the safety net must drop frames, motion-window frames are preserved first; only static bookends get even-spaced subsampling against the remaining budget. Solves the 2026-05-20 Claude conference promo case where the old policy threw away the 7 dense motion frames adaptive_sampling had carefully allocated. Surfaced in the budget block as `policy=motion-aware`.
- **`LUMIERE_DEFAULT_MODE` env var override**: parallel test sessions can pin distinct tiers without racing each other on the shared config file. Validated against `["low","mid","high","max"]`; invalid values emit a console warning instead of silently falling back so ghost-failed test sessions surface immediately. Per-call `mode=` still wins over env over file over `DEFAULT_CONFIG`.
- **`analyze.frame_stats` decimation**: at high-fps sources (60fps × 20s+ = 1200+ entries) the per-frame stats overflowed the MCP cap and broke the analyze response. The decimated response now caps at 60 entries with a `frame_stats_decimated` summary block reporting the original count and sampling step. The full per-frame data still lives in the saved session manifest for internal use.

### Changed

- **`/lumiere` skill: configured-tier respect is now a HARD RULE.** The previous skill text said "DEFAULT TIER IS high" which Claude applied as a hint even when the user/env set a different tier. The new rule explicitly tells Claude to read `cost_estimate.current_default_mode` from inspect and use it, never to escalate based on its own content judgment ("text needs high", "mascots need 1024"). If the configured tier is insufficient, report the limitation in the narrative instead of silently changing.
- **`/lumiere` skill: motion-window drill rule for high/max tiers.** After the global watch call, the skill now issues a follow-up watch zoomed into the densest motion_window at the highest fps that fits one call. Closes the temporal-density gap that makes high/max miss fast animations (cape equip, hover, eye-laser, land) even though their per-frame detail is superior. The mid/low tiers skip the drill because their global call already has enough frames (27/38) to catch fast motion.
- **Narrative_mode prior, expanded animation-detection block:**
  - "Detail bar" section pushes specificity: name the SPECIFIC type of every prop, quote ALL visible text verbatim, name colors in specific shades, track start + end state of each feature channel, identify LOOPS and REPEATS, identify SCENE/EXAMPLE BOUNDARIES in tutorial videos, resist generic verbs.
  - "Mascot + wordmark + plain background is the canonical animation setup, NOT a static title card by default" prior pushes Claude past the title-card interpretation default when poses differ across frames.
  - "Cape / wings / cloak detection" prior names the symmetric-darker-mass-on-both-sides signal as cape equipped (vs the reading as "wider sprite" or "different variant").
  - "Hover / flight detection" prior with explicit baseline-displacement + propulsion rules.
  - "Downward streams from the eye region during hover" prior covers eye-laser emission events that pass through the cape silhouette on their way down.
- **Trim hint payload reflects `runtime_trim` policy:** when motion-aware, the hint tells the caller the dense action moments WERE preserved (so the gaps are between static frames). When uniform (no motion segments), original wording stands.

### Fixed

- **Skill-text "default tier high" hard-coded the wrong baseline.** Sessions launched with `LUMIERE_DEFAULT_MODE=max` or `=mid` were silently escalated to high by the skill's own text. Behavior now respects the configured tier per the HARD RULE above.
- **Analyze response no longer overflows on high-fps sources.** Pre-v0.9 the 60fps source case produced a ~180KB analyze response that exceeded the 100K MCP cap and broke downstream tool calls.

### Internal

- `loadConfig` now reads `process.env.LUMIERE_DEFAULT_MODE` as the env-layer override before returning. Per-call `mode=` still has the final word.
- `runtimeTrimPolicy: "motion-aware" | "uniform" | "none"` tri-state tracks which path the safety net took. Surfaced in the budget block and consumed by the trim hint formatter.
- `analyze.ts` adds a soft-cap `FRAME_STATS_SOFT_CAP=60` for the MCP response payload only; the full per-frame stats are still computed and saved to the session manifest for internal palette_outliers detection.
- Pre-existing emdashes in `skills/lumiere/SKILL.md` swept to colons / commas to comply with the global no-emdash rule.

## [0.8.1] - 2026-05-20

Five watch-tool fixes surfaced by testing the Claude conference promo video: a v0.8 perception gap where `adaptive_sampling=true` clustered all frames on a 0.6s pin-label motion_window and missed two headphone equip/unequip events outside it. elpabl0 caught the miss by direct question. The patch makes the gap visible in the response and gives the caller the right recovery hint when runtime_trim drops middle frames.

### Added

- **`## Sampling gap warning` block in `watch` responses**: emitted when adaptive_sampling concentrates >60% of frame budget into <30% of active duration. Names the missed channels (equip/unequip, costume on/off, prop in-hand, headgear changes) and tells the caller to run a uniform mid-tier scan to verify "feature X is constant" claims before locking interpretation.
- **`## Trim hint (runtime_trim middle-drop)` as a distinct hint branch**: when `runtime_trim` deliberately dropped evenly-spaced middle frames (denser content than the cost estimator predicted), the response identifies the largest temporal gap between delivered frames and recommends narrowing the window to that gap. Replaces the misleading "retry from last delivered" tail-truncation advice that was wrong for middle-drop cases.
- **`kept_timestamps` and `dropped_timestamps` in the budget block**: when runtime_trim activates, the budget block now lists exactly which frames survived and which were dropped, so the caller can walk the drop list segment-by-segment to recover them without inspecting the manifest separately.
- **Sampling-gap audit subsection in the narrative_mode continuity audit**: the prior now explicitly tells the model that anchor + cluster + anchor sampling has NOT verified the equip/unequip channel and that "feature X is constant" claims under those conditions must be flagged PROVISIONAL until a uniform scan confirms.

### Fixed

- **`view=` zod regex now accepts sub-second timestamps**. The session manifest emits sub-second timestamps (e.g. `00:00:09.343` from adaptive_sampling motion windows) but `view=` rejected anything that didn't match `^\d{2}:\d{2}:\d{2}$`, forcing a wasted re-extract instead of a cache hit. New regex: `^\d{2}:\d{2}:\d{2}(\.\d+)?$`.
- **`lookupTimestampsInManifest` gained a nearest-by-seconds fallback within 50ms**. When exact string match fails (e.g. caller passes `00:00:09` and cache has `00:00:09.000` or vice versa), the lookup now matches the nearest cached frame within `MATCH_EPSILON=0.05s` and returns the cached timestamp string so the response is internally consistent.
- **Truncation hint mislabeled middle-drops as MCP-cap truncations**. The old hint always said "output hit the MCP per-call cap mid-stream at timestamp X" even when `runtime_trim` had deliberately dropped middle frames (frames 0 and 14 delivered, 1..13 dropped). Callers chased the wrong window. Now differentiated.

### Internal

- Three new module-scope template helpers (`samplingGapWarning`, `trimHintRuntimeMiddleDrop`, `truncationHintMcpCap`) so the multi-paragraph prose lives at top of file alongside `NARRATIVE_GUIDANCE` and `LOW_TIER_HEDGE_HINT`, matching the existing convention.
- Two new module-scope constants (`GAP_WARN_BUDGET_RATIO`, `GAP_WARN_DURATION_RATIO`) so the empirically-tuned 0.6 / 0.3 thresholds are greppable.
- Gap-warning aggregation collapsed from four `.filter().reduce()` passes to a single loop.

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
