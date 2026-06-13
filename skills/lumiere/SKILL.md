---
name: lumiere
description: "Launch-video work mode. Load whenever the user wants to MAKE / CREATE / BUILD / generate a launch video (storyboard, lock file, scenes, render, 'multiple versions') OR to analyze/watch/study a reference video. The phrase 'make/build/create a launch video' (or 'use lumiere' on such a task) ALWAYS routes here, never reverse-engineer capability from the MCP tool list (those tools are only the perception half; creation is this skill). Triggered by explicit launch-video or reference-video intent, NOT by every URL mention."
user-invocable: true
argument-hint: "[dashboard] | [mode <low|mid|high|max>] | [create | <storyboard>.md | <lock>.json] | [video URL] | (none for interactive)"
---

# /lumiere: video perception + creation

You are now in lumiere video work mode. The user wants to do something with a video: analyze a reference, watch it, copy beats from it, study what effects it uses, or build a launch video of their own.

## DEFAULT for "make / create / build a launch video" requests (read first)

lumiere CREATES launch videos; it is not only a perception tool. If the request
is to make/build/generate a launch video (one or several versions), the canonical
shape is **author → review in the dashboard Preview → export to mp4**, in that
order. Concretely:

1. **The deliverable is a previewable composition, never a bare mp4.** A
   composition is "previewable" iff its `index.html` registers
   `window.__timelines = { main: <masterTimeline> }` (the restage process
   guarantees this). The dashboard Preview and the renderer seek the SAME
   registry, so previewable == renderable.
2. **Review happens in the dashboard Preview**, not by shipping a file. When a
   scaffold is done, surface the absolute `index.html` path(s) and tell the user
   to load them in Preview (see the creation flow's Review step). mp4 render is
   the FINAL EXPORT step, done only once a version is chosen.
3. **Compose in the dashboard when a browser is available** (agent-browser /
   Chrome). The composer is the user's own surface; driving it there means the
   storyboard he sees is the one you built. Hand-authoring the storyboard/lock as
   a file is the fallback when no browser is reachable, not the headline path.
4. **"Multiple versions" / "your creativity" / "without guiding me" = autonomous
   multi-version mode.** Generate N DISTINCT creative directions yourself, scaffold
   each, surface all N in Preview; do not stop to ask which effects to use. See
   the creation flow.

Never conclude "lumiere can't generate" from the MCP tool list (inspect/analyze/
watch/measure/configure are the perception half only). Creation is THIS skill.

## Argument routing (first thing to check)

The user may have invoked this skill with an argument (`$ARGUMENTS`). Parse it FIRST:

- `$ARGUMENTS` starts with `mode ` (e.g. `mode max`, `mode high`, `mode mid`, `mode low`): **dispatch to set-default-mode flow.** Call `configure(default_mode=<value>)` then confirm by reading back the saved config. Do not enter full video work mode.
- `$ARGUMENTS` is `dashboard`, `library`, `motion-library`, or any of those phrases (e.g. `open dashboard`, `open the dashboard`, `show me the library`): **dispatch to open-dashboard flow** below. Do not enter full video work mode.
- `$ARGUMENTS` is or STARTS WITH `create`, `creation`, `scaffold` (the dashboard composer's copy-command emits `create` followed by a `Storyboard:` block, all of which is the brief), OR is a path to a storyboard `.md` / a `launch-video.lock.json`: **dispatch to creation flow** below. Do not enter perception work mode. (This bullet matches BEFORE the URL bullet so storyboard/lock paths are never misread as videos.)
- `$ARGUMENTS` is a URL (http://, https://, x.com/, youtube.com, youtu.be, vimeo.com, or a local VIDEO file path like .mp4/.mov/.webm/.mkv): **dispatch to "user shared a reference video URL" flow** below with that URL.
- `$ARGUMENTS` is empty or anything else: enter interactive mode and ask what the user wants to do.

## Tools available

- **inspect**: cheap metadata pass (duration, resolution, codec, fps, audio) PLUS per-tier context-cost estimate. Use FIRST when handed a new video. The cost block tells you how much context each tier will burn so you can pick (or warn the user) before calling watch.
- **analyze**: structural pass via ffmpeg filters. Returns scene cuts, silence intervals, loudness, transcription, motion profile, motion_windows, subject_bbox (cc-segmentation), window_bboxes (per-motion-window bboxes, v0.8), palette_outliers. Use BEFORE `watch` on any video > 30s to plan segments. The motion profile also drives auto-suggestion of narrative_mode in watch.
- **watch**: frame extraction + audio. The workhorse. Returns base64 images plus interpretation guidance so you can SEE the video. Has an AUTO-BUDGET that prevents MCP cap truncation; just call without view_sample and a safe default is applied per resolution. Pass `narrative_mode=true` for action-heavy segments to recover temporal action sequences instead of frame-by-frame state catalogs. v0.6 added `adaptive_sampling` (motion-window-weighted frame allocation) and `roi=auto` (ROI auto-crop from analyze.subject_bbox). v0.8 added `roi=per-window` (each motion window gets its OWN bbox so a traveling subject stays tight in every crop, requires adaptive_sampling + prior analyze with motion=true) and roi-aware `view=` cache lookups (separate bucket per crop so cached frames are never mis-served across roi modes).
- **measure** (v0.7): exact token forecast for a planned watch call via Anthropic's free count_tokens endpoint. Use BEFORE high-stakes watch calls when you need to know exact conversation tokens (image visual tokens for the current model). Returns conversation_tokens (exact for the model) + mcp_cap_tokens (heuristic estimate). Requires `LUMIERE_ANTHROPIC_API_KEY` (keychain or env). Model auto-detected from the current CC session.
- **configure**: set default_mode (low/mid/high/max), backend, whisper_model, or clear_sessions. Most other defaults are hardcoded from empirical testing.

## Workflows

### Pre-flight (mandatory for every new video)

1. Call `inspect(path=URL)`. Read the returned `cost_estimate` block.
2. Look at `cost_estimate.per_tier[<current_default_mode>]`. The thorough-coverage fields are what the watch workflow uses below:
   - `chunks_for_full_coverage_thorough` — how many sequential watch calls to issue
   - `chunk_duration_thorough_seconds` — how many seconds each chunk covers
   - `est_total_tokens_thorough` / `pct_of_1m_window_thorough` — projected burn for the full pass
   - `will_trigger_autocompact_thorough` — pre-flight gate
3. Pre-flight gate:
   - If `will_trigger_autocompact_thorough === false`, proceed to chunked watch.
   - If `will_trigger_autocompact_thorough === true`, warn the user: "Thorough coverage at `<mode>` tier on this `<duration>s` video would burn ~`<pct_thorough>`% of 1M context (~`<N>` chunks). This will trigger autocompact. Options: (a) accept and proceed (you picked the tier for a reason), (b) drop to `<recommended_mode>` tier, (c) run /compact first, (d) analyze a sub-segment only with start_time/end_time."
4. If the user accepts or chose a smaller tier, continue with chunked watch.

### Open-dashboard flow

When the user asks to open the dashboard / library / motion library:

1. **Resolve the dashboard path.** Try `$CLAUDE_PLUGIN_ROOT/dashboard/index.html` first (the installed plugin path). If that variable is unset or the file is missing, fall back to the repo path the current session was launched with (the `--plugin-dir` argument). The file MUST exist before you proceed; if missing, report which paths you tried and ask the user to verify the plugin install.
2. **Open in the user's browser.** Check `$LUMIERE_BROWSER`:
   - If set (e.g. `qutebrowser`), run: `$LUMIERE_BROWSER "file://<resolved_path>"`
   - If unset, use the system default: `open "file://<resolved_path>"` (macOS) or `xdg-open` (Linux)
3. **Confirm briefly** which file was opened. Do not enter full video work mode after; the user invoked the dashboard, not perception work.

The dashboard is pure HTML and bundles GSAP + fonts locally, so no dev server is needed and no network requests are required to render. It only persists state via `localStorage` (theme preference, favourited effects).

### When the user shares a reference video URL

1. Pre-flight (above). Capture the thorough-coverage plan from inspect.
2. Call `analyze(path, filters={scene_changes: true, silence: true, loudness: true, motion: true, transcription: true})` for a structural map.
3. Read scene cuts + silence intervals + motion_windows.
4. **Thorough-coverage chunking (HARD RULE, NO EXCEPTIONS).** Read the chunk plan from `cost_estimate.per_tier[<configured>]`:
   - N = `chunks_for_full_coverage_thorough`
   - chunk_duration = `chunk_duration_thorough_seconds`
   - You MUST make EXACTLY N watch() calls. Do NOT merge chunks, skip chunks, or reduce N for any reason. If N feels large, that is by design. The user chose this tier knowing the cost. If you are concerned about context consumption, ask the user before deviating. Never silently reduce N on your own judgment.
5. Issue EXACTLY N watch() calls with uniform chunk boundaries:
   - For i in 0..N-1: `watch(path, start_time=hms(i * chunk_duration), end_time=hms(min((i+1) * chunk_duration, duration)), mode=<configured>, narrative_mode=true)`
   - Do NOT batch or parallelize more than 6 calls at once (MCP concurrency limit).
   - Do NOT adjust chunk boundaries based on content. Use the uniform grid from inspect.
6. Synthesize narrative across ALL N chunks. Cite timestamps from each.

### When the user wants to copy 1:1 from a reference

1. Pre-flight, then analyze.
2. `watch` each scene of interest at the CONFIGURED tier (per "RESPECT THE CONFIGURED DEFAULT TIER" below). Pixel-perfect 1:1 recreation is forensic work where `max` genuinely helps, so if the configured tier is below `max` you MAY recommend `max` in your narrative and let the user opt in, but do not silently escalate, that is the documented tier-respect exception. Pass `narrative_mode=false` (explicit) if the segment is static; otherwise leave default.
3. Cross-reference against the canonical effects library (`$CLAUDE_PLUGIN_ROOT/effects/index.json` for ids; per-effect meta inside each `effects/<id>/effect.html`) and emit a beat sheet: `{start, end, effects: [name1, name2], content}`.

### When the user mentions [effect-name] tokens

The `[effect-name]` syntax refers to a named effect in the canonical library (`effects/index.json`). When the user says "Scene 1 uses [typewriter] [asymmetric-scatter]", treat those as references to the effect manifest, not free-text descriptions.

### When the user wants to set the default tier

Common phrasings: "set lumiere to max", "/lumiere mode high", "default to mid", "make default low".

Action: call `configure(default_mode="<low|mid|high|max>")`. Confirm by reading back the saved config.

| mode | resolution | best for |
|---|---|---|
| `low` | 384px | cheap overview / "what's this video about" / scanning long videos |
| `mid` | 512px | balanced reading; per-scene notes for design lock |
| `high` (default) | 1024px | UI demo perception, mascot topology, animation cadence, body-text crisp |
| `max` | 1536px | forensic recreation, exact hex codes, sub-frame phenomena |

### When the user has not specified what to do

Ask: "Do you want to (a) analyze it for structure, (b) watch specific moments, or (c) copy beats from it to build something?"

## Operational rules

- **PRE-FLIGHT ALWAYS:** call inspect first. The cost preview is what stops a session from wandering into autocompact territory. v0.4: the estimator now matches the watch tool's actual fps logic, so the prediction is accurate.
- **RESPECT THE CONFIGURED DEFAULT TIER (HARD RULE).** Read `cost_estimate.current_default_mode` from the `inspect` response and use that as the `mode` for `watch` and `measure`. Do NOT escalate to a higher tier on your own judgment even if you think the content "needs" more detail (e.g. "text legibility requires high", "mascots need 1024"). The operator picked their tier for a reason: cost budget, parallel-test rigor, scanning workflow. If the configured tier is insufficient for the user's question, REPORT the limitation in your narrative (e.g. "at the configured mid tier the wordmark glyphs are below legibility threshold; recommend re-running with mode=max if you need exact letterforms") and let the user decide. The only exception is when the user explicitly asks for a different tier in their prompt ("zoom into this at max", "give me a cheap overview").
- **FULL-VIDEO COVERAGE IS THE DEFAULT.** Every tier chunks the video per `chunks_for_full_coverage_thorough` from inspect. The number of chunks scales with tier (v0.10.2: low ~25s/chunk, mid ~17s, high ~5s, max ~2s). Scene cuts from `analyze` can override the uniform chunk boundaries if a scene cut falls awkwardly mid-chunk.
- **FOR CHEAP OVERVIEW**, use `mode=low` (cheapest) or `mid`. Use this for scanning a long video to find interesting beats, then re-chunk those beats at `high` or `max`.
- **NARRATIVE_MODE for any moving subject.** If the video has continuous action (animation, sports, cooking, UI demos with autonomous loops, agent screen recordings), pass `narrative_mode=true`. Without it, Claude reads consecutive action frames as separate "sprite-sheet" entries and misses the temporal structure.
- **AUTO-SUGGEST is broader in v0.4.** `narrative_mode` now auto-enables when (a) global motion is high, (b) scene cuts are dense (>0.3/sec), (c) subject-region motion is high (catches animated mascots inside locked compositions), OR (d) `analyze()` flagged palette outliers (one-off colors that may be emissions). The blind-test bug where the V1 mascot animation didn't auto-arm is fixed.
- **DO NOT skip the auto-budget.** Calling `watch` without view_sample on a long high-fps video triggers MCP cap truncation. The auto-budget table is safe; raise it only if you've measured.
- **DO NOT use webp** (many ffmpeg builds lack libwebp). Stick to jpeg.
- **DO NOT use fps=60 on a 30fps source** (just duplicates frames; view_sample caps output anyway).
- **For brand/mascot identification** specifically: high (1024) or max (1536) is needed. At 512 pixel-art mascots compress below the recognizable-species threshold.

## Reading the budget block (v0.10.2)

Every `watch()` call returns a `## Budget` block in the metadata pass. Six fields determine whether the call was healthy:

- `view_sample_applied=N` — frames this chunk will deliver. Should match `view_sample_cap` from inspect for the tier (25 / 17 / 4 / 2 for low / mid / high / max).
- `extraction_fps=X` — ffmpeg sampling rate. Tier defaults: 1.5 / 3.0 / 6.0 / 12.5.
- `effective_fps=Y` — post-adaptive_sampling per-segment rate. Useful for understanding the actual sampling density per motion vs static segment.
- `proactive_sizing=YES|no` — `no` is the healthy case (content matched TPF estimate). `YES X→Y` means the proactive safety net measured denser-than-predicted frames and lowered view_sample from X to Y BEFORE delivering. The user still gets `view_sample_applied=Y` frames consistently; there is no post-hoc drop. Treat this as a content-density signal, not a bug.
- `runtime_trim=no|YES` — `no` is the healthy case. `YES` is the last-resort safety net firing after view_sample subsampling; should be rare on v0.10.2-calibrated content. If it fires, follow the trim hint (narrow window OR raise fps, never drop view_sample).
- `out_of_range_dropped=0 (filter active)` — `0` is healthy; non-zero means the cache/extraction returned frames past video duration (yt-dlp boundary glitch or stale cache from cross-video collision). The frames were dropped; investigate if seen repeatedly.

If all six gates are green, the chunk delivered exactly what was promised. v0.10.2 production calibration achieves green across all tiers on V2-class content (zero proactive_sizing, zero runtime_trim).

## On truncation: narrow the window, do not drop fps (HARD RULE)

If a `watch()` response returns FEWER frames than your view_sample request (because the MCP 100K per-call cap stopped delivery mid-stream), the correct response is to **narrow the time window at the SAME fps**, not to drop to a coarser fps that throws away the detail in the segment where the action lives.

Example. You called `watch(0:00, 0:24, fps=25, view_sample=600)` and got 240 frames covering 0:00-0:10 before truncation. WRONG move: re-call with `view_sample=120` (you lose half the temporal density). RIGHT move: call two windows, `watch(0:00, 0:08)` and `watch(0:08, 0:16)` and `watch(0:16, 0:24)` at the same fps, so each chunk fits under the cap with full temporal resolution preserved.

Why: temporal resolution is what catches fast actions (laser fires, particle bursts, sub-second transitions). Resolution drops mean missing those events entirely.

## Creation flow (build a launch video)

When routed here (argument `create`, a storyboard `.md`, or a lock file path).
The flow is **author → review in Preview → export to mp4**; do not collapse it to
"render an mp4 and hand it over" (see the DEFAULT section above).

0. **Resolve the project directory.** A launch video lives in its OWN project dir, by s0nderlabs convention `~/Documents/s0nderlabs/<product>-launch/` (e.g. `anima-launch/`, `remit-launch/`), NOT inside the lumiere repo. If the user named a product and the dir does not exist, create it (confirm the path first). The lock, `index.html`, `assets/`, and any `vN/` version dirs all live under it. (See LOCK.md "How it gets filled".)
1. **Resolve the creation docs.** Try `$CLAUDE_PLUGIN_ROOT/creation/` first (installed plugin); if the variable is unset or the dir is missing, fall back to the repo path the session was launched with (`--plugin-dir`). `LOCK.md` and `RESTAGE.md` MUST exist there; if not, report which paths you tried and stop.
2. **Get the storyboard.** Two ways in:
   - **From the dashboard composer (preferred when a browser is reachable).** Open the dashboard, go to Composer, set the storyboard prose (effect tokens are `<effect-id>`; a parenthetical right after a token, e.g. `<wordmark-rise>(text="remit", speed=1.5)`, is a per-use override). With agent-browser/Chrome you can drive it yourself: set `#storyboardInput`'s value + dispatch an `input` event, then read the resolved command from `buildCommand()` (it expands `<token>` to absolute `effects/<id>/effect.html` paths). `buildCommand()` returns `{ cmd, unknown }`: CHECK `unknown` (tokens not in `effects/index.json`) is empty before handing off, a non-empty `unknown` means a typo'd/missing effect id that would ship an unresolved `<bad-token>`. Driving the composer means the user sees the exact storyboard you built and can tweak it.
   - **As a file (fallback / no browser).** Author the storyboard prose directly. EITHER WAY, also write the composer-format `storyboard.md` next to the project so the user can reopen and tweak it in the composer later.
   A composer-emitted storyboard references effects as absolute `effects/<id>/effect.html` paths inline; the `<id>` directory name is the canonical ref. Record each override `key=value` as that scene's `effects[].vars` in the lock (`(duration=X)` translates to `speed = natural_duration / X` per the effect's FORMAT.md contract).
3. **Establish the lock.** If the target project already has a `launch-video.lock.json`, validate it: `bun <creation>/_tools/validate-lock.mjs <lock-path>`. If there is no lock yet, Read `creation/LOCK.md` and fill one from the storyboard/brief (when the user wants to be guided: 5-8 turns of decisions on palette, typography, motion, beats; when the user said "your creativity / don't guide me", decide them yourself), then validate.
4. **Scaffold.** Read `creation/RESTAGE.md` and follow it scene by scene: restage each `scenes[].effects[]` declaration into the project's root `index.html`. Canonical effects live at `$CLAUDE_PLUGIN_ROOT/effects/<id>/effect.html` (same fallback rule). Two non-negotiables: (a) the composition MUST register `window.__timelines = { main: <masterTimeline> }` (RESTAGE guarantees this) or it is neither previewable nor renderable; (b) VENDOR gsap + fonts locally into the project (`assets/vendor/gsap.min.js` from `effects/_vendor/`, fonts from `effects/_fonts/`), never a CDN tag, a CDN `<script>` is silently blocked on `file://` in qutebrowser so the composition lints and renders fine but shows a BLANK Preview pane (RESTAGE rule 3, the #1 silent failure).
5. **Lint gate.** `npx --yes hyperframes@0.6.7 lint` clean of ERRORs before any scene is called done. (`hyperframes inspect` is BEST-EFFORT only: it currently crashes with a `totalDuration` error on both 0.6.7 and 0.6.75 even on known-good projects, so a crash there is tool breakage, NOT a gate failure; lint + render + lumiere-watch carry the gate, per RESTAGE.md.)
6. **Review in the dashboard Preview (this is the review surface, not an mp4).** Open the dashboard (use the Open-dashboard flow above so it lands in the user's `$LUMIERE_BROWSER`, never `open`/Chrome), go to Preview, and either paste the absolute `index.html` path into the path box + Load, or (for multiple versions) point the folder box at the parent dir and Load versions (see "Surfacing N versions" below). The Preview pane loads the composition in an iframe, finds `window.__timelines.main`, and gives a frame-exact scrub bar + play/pause, the same registry the renderer drives. Tell the user the exact path(s) to load. Pre-fill for the user when a dashboard tab is reachable: `localStorage["lumiere-preview-dir"]` = the versions folder AUTO-LOADS the switcher when they open Preview; `localStorage["lumiere-preview-path"]` = a single composition only PRE-FILLS the box (they still click Load). If Preview shows an error: "No window.__timelines registry" = the composition never registered `main` (step 4a); "duration is not finite" = a `repeat:-1` infinite loop reached the registry (give `main` a finite duration); blank cream pane = CDN gsap (step 4b).
7. **Export to mp4 (final step, only once a version is chosen).** Render via the stable entry point: `bun $CLAUDE_PLUGIN_ROOT/bin/lumiere-render.mjs <project-dir>`. Report the exact command first. Output lands at the lock's `meta.render.output` else `renders/<project>.mp4`; fps from `meta.render.fps` else 30; override with `--out <file>` / `--fps <n>`. ENGINE CHOICE: `hyperframes` (DEFAULT) mixes the lock's audio into the mp4; `--engine own` is lumiere's frame-exact pipeline but is VIDEO-ONLY (no audio mix in v3.0), so a lock with `status:locked` audio MUST render with the hyperframes engine or it ships a silent mp4. The Preview pane's "Copy render command" button emits this for the loaded composition.

### Autonomous multi-version mode ("multiple versions" / "your creativity" / "without guiding me")

Honor an explicit count if the user gave one ("3 versions"); otherwise default to
**3**. Generate them as DISTINCT creative DIRECTIONS, not parameter tweaks of one
idea (e.g. a type-forward cut, a product-UI cut, a narrative/mascot cut). For each:
scaffold into its own sibling dir `<project>/v1/`, `v2/`, ... each with an
`index.html` registering `window.__timelines.main`; lint clean; lumiere-watch the
render against the reference bar if you have one. Do NOT pre-render every version
to mp4 (export comes after the user picks a winner in Preview) and do NOT stop
mid-flow to ask which effects to use, the whole point is autonomous output the user
reviews in Preview. Write the `versions.json` manifest (below) and surface all N at
once via the switcher.

### Surfacing N versions in Preview (the version switcher)

Write a `versions.json` in the PARENT dir enumerating the set (the static page
cannot list a directory, so the manifest is the explicit enumeration):

```json
{ "versions": [ { "dir": "v1", "label": "Blueprint" }, { "dir": "v2", "label": "Live-Product" } ] }
```

`dir` required (relative to the manifest), `label` optional (defaults to `dir`),
`file` optional (defaults `index.html`); composition path = `<parent>/<dir>/<file>`.
Then tell the user to open Preview and point the folder box at the parent dir, or
pre-fill `localStorage["lumiere-preview-dir"]` with the absolute parent path so the
switcher loads unprompted. The Preview switcher reads the manifest and gives
prev/next across the set, each loading frame-exactly.

All procedural depth lives in the two creation docs; read them on demand, never from memory of this summary.

## Auxiliary references

- Effects library: `$CLAUDE_PLUGIN_ROOT/effects/index.json` + `effects/<id>/effect.html` (load on demand, not eagerly)
- Creation playbooks: `$CLAUDE_PLUGIN_ROOT/creation/LOCK.md` (the design-lock spec + schema) and `$CLAUDE_PLUGIN_ROOT/creation/RESTAGE.md` (effect -> composition restage procedure). Read inside the creation flow, not eagerly.
- HyperFrames pattern: `~/Documents/s0nderlabs/anima-launch/CLAUDE.md`
- Cost model + tier comparison: see memory file `cost-model-100k-cap.md`
- Narrative-coherence bug + v0.3 fix: see memory `perception-bug-narrative-coherence.md`

Out of scope today: generative SFX/BGM (e.g. ElevenLabs). Audio that is already a file can be mixed by the hyperframes render engine (the own engine is video-only, see creation flow step 7).
