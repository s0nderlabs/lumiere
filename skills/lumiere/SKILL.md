---
name: lumiere
description: "Video work mode. Load when the user wants to analyze a reference video, watch a video URL, study effects from a launch video, or work on a launch-video project. Triggered by explicit video intent only (e.g., 'analyze this trailer', 'watch this video', 'study the X launch video'), NOT by every URL mention."
user-invocable: true
argument-hint: "[dashboard] | [mode <low|mid|high|max>] | [video URL] | (none for interactive)"
---

# /lumiere: video perception (creation deferred)

You are now in lumiere video work mode. The user wants to do something with a video reference: analyze it, watch it, copy beats from it, or study what effects it uses.

## Argument routing (first thing to check)

The user may have invoked this skill with an argument (`$ARGUMENTS`). Parse it FIRST:

- `$ARGUMENTS` starts with `mode ` (e.g. `mode max`, `mode high`, `mode mid`, `mode low`): **dispatch to set-default-mode flow.** Call `configure(default_mode=<value>)` then confirm by reading back the saved config. Do not enter full video work mode.
- `$ARGUMENTS` is `dashboard`, `library`, `motion-library`, or any of those phrases (e.g. `open dashboard`, `open the dashboard`, `show me the library`): **dispatch to open-dashboard flow** below. Do not enter full video work mode.
- `$ARGUMENTS` is a URL (http://, https://, x.com/, youtube.com, youtu.be, vimeo.com, or a local path): **dispatch to "user shared a reference video URL" flow** below with that URL.
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
2. `watch(path, mode="max")` on each scene of interest for pixel-perfect inspection. Pass `narrative_mode=false` (explicit) if the segment is static; otherwise leave default.
3. Cross-reference against the effects vocabulary (load `data/effects.json` if needed) and emit a beat sheet: `{start, end, effects: [name1, name2], content}`.

### When the user mentions [effect-name] tokens

The `[effect-name]` syntax refers to a named effect in `data/effects.json`. When the user says "Scene 1 uses [typewriter] [asymmetric-scatter]", treat those as references to the effect manifest, not free-text descriptions.

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

## Creation phase

Creation (scene scaffolding, HyperFrames render) is NOT in this skill yet. It will land in a follow-up release after the perception layer settles.

## Auxiliary references

- Effects vocabulary: `data/effects.json` (load on demand, not eagerly)
- HyperFrames pattern: `~/Documents/s0nderlabs/anima-launch/CLAUDE.md`
- Cost model + tier comparison: see memory file `cost-model-100k-cap.md`
- Narrative-coherence bug + v0.3 fix: see memory `perception-bug-narrative-coherence.md`

Out of scope today: ElevenLabs SFX/BGM generation (deferred until perception ships).
