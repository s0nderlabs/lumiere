# lumiere

Video perception for Claude Code. Point it at any video (local file or URL), get a structured analysis the model can reason about: scenes, motion windows, action attribution, transcription, and base64 frames with temporal narrative guidance.

Five MCP tools: `inspect` (cheap forecast), `analyze` (structural pass), `watch` (frames + audio), `measure` (exact token forecast via Anthropic's count_tokens), `configure` (settings).

## Install

From the s0nderlabs marketplace:

```sh
claude plugin marketplace add s0nderlabs/marketplace
claude plugin install lumiere@s0nderlabs
```

Or local development:

```sh
cd ~/Documents/s0nderlabs/lumiere
bun install
c --plugin-dir ~/Documents/s0nderlabs/lumiere
```

## Requirements

- `ffmpeg` + `ffprobe` (required)
- `yt-dlp` (URL inputs)
- `whisper-cli` from `whisper.cpp` (default audio backend) or `GEMINI_API_KEY`
- `MAX_MCP_OUTPUT_TOKENS=100000` recommended
- `LUMIERE_ANTHROPIC_API_KEY` (optional, only for the `measure` tool and `lumiere-cost` CLI)

macOS:

```sh
brew install ffmpeg yt-dlp whisper-cpp
```

## Quick start

```
/lumiere https://x.com/.../status/123
```

The skill calls `inspect` first (cost preview), `analyze` to plan, then `watch` with the appropriate tier and narrative mode. You get a narrative back.

## Tools

### `inspect`
Cheap metadata pass + per-tier context-cost preview. Always call first on a new video. Returns: duration, resolution, codec, fps, audio presence, recommended tier, autocompact warning.

### `analyze`
Structural ffmpeg pass. Returns: scene cuts, silence intervals, motion windows, subject bbox (connected-component segmentation), palette outliers (color novelty), transcription. No frames extracted. Plan chunks from this.

### `watch`
Frame extraction + audio. Returns base64 images with narrative guidance. Key params:
- `mode`: `low` (384px) | `mid` (512px) | `high` (1024px, default) | `max` (1536px)
- `narrative_mode`: temporal sequence reading instead of frame-by-frame
- `adaptive_sampling`: motion-window-aware frame allocation (70/30 motion/static split)
- `roi`: `"auto"` reads `analyze.subject_bbox`; subject gets full target resolution
- `start_time` / `end_time`: chunk a sub-segment
- `view_sample`: override the auto-budget

Auto-budget respects `MAX_MCP_OUTPUT_TOKENS`. Runtime trim drops frames if the response would exceed the cap.

### `measure` (v0.7)
Exact token forecast via Anthropic's `/v1/messages/count_tokens` (free endpoint, requires `LUMIERE_ANTHROPIC_API_KEY`). Extracts frames, builds the would-be response payload, counts tokens for the current Claude model, returns exact `conversation_tokens` + heuristic `mcp_cap_tokens`. Discards the payload. Use BEFORE a high-stakes watch call. Auto-detects the running CC model from session transcripts.

### `configure`
Set persistent server defaults:
- `default_mode` (`low` / `mid` / `high` / `max`): tier used when watch/measure omit `mode`.
- `default_narrative_mode` (`true` / `false` / `"auto"`): when true, narrative_mode defaults on for every watch/measure call that omits the param. When false, defaults off. When `"auto"` or unset, the heuristic decides per call (auto-suggest from motion / cuts / palette signals). Per-call param always wins.
- `default_adaptive_sampling` (`true` / `false` / `"auto"`): same semantics for adaptive sampling. `true` activates whenever motion_windows are cached and duration > 4s. `false` forces uniform sampling. `"auto"` or unset = heuristic (auto-enable only when narrative is also on).
- `backend` (`local` / `gemini-api` / `none`): audio transcription backend.
- `whisper_model` (`tiny` / `base` / `small` / `medium` / `large-v3-turbo` / `large-v3` / `auto`): whisper size when backend=local.
- `clear_sessions: true`: wipe cached sessions + downloads.

Precedence for narrative_mode and adaptive_sampling: explicit per-call param > auto-suggest heuristic > server default > off.

## Tier guide

| mode | px | best for |
|---|---|---|
| `low` | 384 | overview, "what's this video about" |
| `mid` | 512 | balanced reading, per-scene notes |
| `high` (default) | 1024 | UI demos, animation, anatomy / feature reads |
| `max` | 1536 | forensic detail, exact hex codes, sub-pixel events |

Higher tiers = fewer frames per call. For long action sequences at `high` or `max`, chunk by motion window.

## How adaptive sampling works (v0.6)

`watch` with `adaptive_sampling=true` reads cached `analyze.motion_windows` and splits the frame budget 70/30 between motion and static spans. Motion windows get more frames per second (weighted by duration × intensity), static spans get spread thin. Same total frame count, but temporal resolution biased toward where action is happening.

## How ROI auto-crop works (v0.5)

When the moving subject is small relative to the frame (mascot inside a brand card), the subject's pixels get averaged into uniform color blobs at typical resolutions. ROI auto-crop reads `analyze.subject_bbox` (computed via connected-component segmentation of the binary motion mask) and crops `watch` frames to it before scaling. The subject fills the target resolution. 10x+ effective pixel density on the subject.

## How narrative_mode works (v0.3+)

Frame-sampled perception has a structural failure: each frame gets interpreted in isolation, so continuous action reads as a sprite sheet of unrelated costumes. The fix is a temporal-narrative prompt:

1. ANCHORS: identify what persists across frames
2. CHANGES: identify what differs
3. RESOLVE: each change as action / transition / state change
4. NARRATE: as continuous prose

Plus priors that catch known failure modes: branded character identity is fixed (no identity-swap default), novel-color in 1-2 frames is an EVENT (laser / projectile / flash) not a body part, named feature channels (eyes / hands / mouth / headgear) tracked separately from silhouette. v0.6 adds a continuity audit pass: re-read the draft, flag any verb with multiple plausible candidate sources, double-check tight sequences.

Auto-suggested when prior `analyze` reports high motion, dense scene cuts, subject-region motion, palette outliers, or a small subject bbox.

## CLI: `lumiere-cost`

Standalone shell wrapper around the `measure` tool. Print exact tokens for a planned watch call without consuming them.

```sh
lumiere-cost /tmp/video.mp4 --mode high --end 00:00:24
lumiere-cost https://x.com/.../status/123 --mode max --start 00:00:05 --end 00:00:15
lumiere-cost video.mp4 --mode high --view-sample 50 --json
```

Requires `LUMIERE_ANTHROPIC_API_KEY` in env or keychain.

## Setting the Anthropic API key (for measure)

Pick one:

```sh
# Option A: keychain (macOS)
security add-generic-password -a lumiere -s dev.lumiere-anthropic-api-key -w 'sk-ant-...'

# Option B: env
export LUMIERE_ANTHROPIC_API_KEY='sk-ant-...'
```

The key is only used for `/v1/messages/count_tokens` (a free metering endpoint — no per-call charges).

## Pre-flight pattern

The `/lumiere` skill instructs the model to:

1. `inspect(path=URL)` first
2. Read `cost_estimate.recommended_mode` and `cost_estimate.per_tier[current]`
3. If full coverage would trigger autocompact, warn the user and offer (a) lower tier, (b) `/compact` first, (c) a sub-segment via start_time/end_time
4. `analyze` then `watch` with appropriate chunks + `narrative_mode` for action segments
5. Optionally `measure` first when the call is high-stakes (cap-tight, expensive, or budget-critical)

## What lumiere is NOT (yet)

Creation phase (scene scaffolding via HyperFrames, ElevenLabs SFX/BGM) is deferred until perception settles. Current ship is perception only.

## License

MIT
