import type { ContentClass } from "../types.js"

// Per-content-class narrative-mode prompt registry. Replaces the single
// NARRATIVE_GUIDANCE constant in watch.ts (v0.10.x) which was animation/mascot
// biased and shipped ~17K conversation tokens of irrelevant priors on every
// human-motion or UI-screen video. Each profile is curated for one content
// class. v0.11+: analyze() classifies the video, watch() picks the matching
// profile (or honors an explicit narrative_mode_profile param).

export interface NarrativeProfile {
  // Identifier matching ContentClass (or "auto" for runtime resolution).
  name: ContentClass | "auto"
  guidance: string
}

// ---------------------------------------------------------------------------
// ANIMATION: branded mascot, motion graphics, launch reels. Mascot+wordmark on
// flat bg with action beats. The original NARRATIVE_GUIDANCE prompt, kept
// verbatim — this is the calibration target for the v0.10.x perception layer.
// ---------------------------------------------------------------------------
export const ANIMATION_GUIDANCE = `## Interpretation guidance (narrative_mode: animation)

These frames are CONSECUTIVE MOMENTS IN TIME from one video. Treat them as a temporal sequence, not as independent images:

1. **ANCHORS:** identify what PERSISTS across the frames (subject, setting, camera, background). These are reference points that stay the same across time.

2. **CHANGES:** identify what DIFFERS across the frames (position, posture, attribute, state, environment, lighting, UI content). These are events.

3. **RESOLVE** each change as one of:
   - (a) an ACTION the subject performs. Pick the verb family that fits:
     - PHYSICAL: jumps, lands, leaps, runs, walks, falls, hovers, levitates, climbs
     - EMISSION: fires, emits, shoots, beams, sparks, casts, blasts, radiates
     - EQUIPMENT: puts on, equips, dons, draws, takes off, removes, sheds, drops
     - MANIPULATION: types, picks up, slices, scrolls, edits, opens, clicks, drags
   - (b) a TRANSITION in the scene (cut, fade, pan, zoom, dissolve)
   - (c) a STATE CHANGE in the world (counter advances, file changes, light turns on, level fills)

4. **NARRATE** the sequence as continuous prose using temporal connectors (then, while, after) and the verbs you identified. Do NOT list each frame independently.

### Detail bar (apply to every narrative)

Specificity is non-negotiable. The reader should be able to picture each moment without ever seeing the video.

- **Name the SPECIFIC type of every prop, garment, or object.** Not "a hat", but "a wide-brimmed pointed wizard hat in deep purple with a yellow crescent-moon decal". Not "a tool", but "a circular saw blade, raised above the head". When you cannot identify the species/type, say "X-like object" and describe its silhouette so a reader can guess.
- **Quote ALL visible text verbatim.** Wordmarks, captions, subtitles, UI labels, tooltips, code snippets, numeric values, units. Read it character-for-character. If a number changes across frames, list every value with timestamps.
- **Note color in named shades when distinguishable.** Not "blue", but "indigo / sky blue / royal blue / navy" as fits. Hex codes if the tier supports them (max=1536px).
- **Track START state and END state of each feature channel separately.** Begin: "eyes closed, no headgear, hands tucked." End: "eyes glowing red, headgear equipped, hands raised."
- **Identify LOOPS and REPEATS.** If an action cycle starts again (e.g. the mascot lands, then immediately leaps again at the end of the clip), say so explicitly with both timestamps.
- **Identify SCENE/EXAMPLE BOUNDARIES** in tutorial / multi-example videos. ("First example uses an airplane icon", "second example uses the text '47m'"). Each example is a discrete demonstration; name them separately.
- **Resist generic verbs.** Replace "moves", "does something", "appears" with specific actions: "slides 40px to the left", "fades in over 4 frames", "the blur radius increases from 0 to ~12px".

### Specific priors (apply before committing to a verb)

- **Branded character = fixed identity, BUT costumes/props ARE binary state changes.** If the subject is a branded mascot/product/character, your DEFAULT hypothesis is: this is the SAME character across all frames. Identity-swap is a last-resort interpretation. HOWEVER, costumes / accessories / held-props ARE valid state changes, track them as discrete on/off events with start and end timestamps, not as per-frame pose oscillations. A red mass that appears on top of the head and STAYS for N frames is HEADGEAR EQUIPPED, not a "windswept hair pose."

- **Mascot + wordmark + plain background is the canonical animation setup, NOT a static "title card" by default.** If the layout is mascot-above-wordmark (or wordmark-above-mascot) on a flat background, and you see ANY pose / silhouette / position difference across frames, that is an ANIMATION. The composition does not become static just because the wordmark stays put. Resist the urge to label early frames "title card" and late frames "title card" if the mascot moved between them. Read the SAME WORDMARK as background, the mascot as foreground action. Treat each motion-window frame as an action beat, not a duplicate.

- **Cape / wings / cloak detection.** If a darker / different-shade mass appears symmetrically on BOTH sides of the body silhouette (visible left-of-body AND right-of-body extending outward) and this mass was absent in earlier frames, that is a **CAPE EQUIPPED** or **WINGS DEPLOYED** state, not "wider sprite" or "different character variant." Track equip + remove timestamps. The cape may have its own shading (often darker than the body proper) so don't read the shade difference as a separate object.

- **Hover / flight detection.** If the body baseline moves UP relative to a fixed anchor (wordmark, ground, frame edge) AND a cape/wings state is active, the mascot is FLYING / HOVERING. If a particle stream (small dots, plume, beam) emerges from BELOW the body or behind it while elevated, that is THRUST / PROPULSION / DOWNWARD EMISSION. List candidate verbs in order: hovers, levitates, flies, takes off. Pick "hovers" if the elevation persists across frames; "leaps/takes off" if elevation only appears in one frame.

- **Downward streams from the eye region during hover.** If the mascot is elevated AND a vertical line / column / plume extends downward from the eye-line (or from the body during a hover pose), inspect for color match with novel-palette events. A red/orange/pink column extending DOWN through the body during a hover beat is most likely **EMISSION-FROM-EYES (downward laser/beam)** that passes the body silhouette on its way down. Compare with the silent-baseline frames: if the column color is NOT present in non-hover frames, it is an emission event, not body anatomy.

- **Dramatic outline change ≠ identity swap.** When silhouette OUTLINE changes a lot but silhouette AREA is roughly conserved between consecutive frames, that is a POSE CHANGE or a PROP EQUIPPED/REMOVED. Ask: "does the eye position stay constant?" If yes, it is the same character. Then ask: "does the new mass appear ABOVE the eye-line?" If yes, suspect HEADGEAR EQUIPPED. "Outside the body silhouette?" Suspect PROP IN HAND.

- **Novel color in 1-2 frames = EVENT, list candidate SOURCES.** If a color appears in only 1-2 frames and is absent elsewhere, that color is almost certainly a projectile, beam, particle, flash, or light effect. BEFORE committing to where it's drawn, list 2-3 candidate SOURCES on the subject and pick one:
  - eyes → laser/beam/vision ray/sight attack
  - mouth → breath/blast/sonic shout/words
  - hands → projectile/spark/blast/orb
  - body → aura/radiance/explosion/transformation
  - feet → dust puff/motion trail (only if there's also vertical translation; otherwise prefer body)
  Then TRACE the trajectory: do the novel pixels originate at one of those candidate sources and extend AWAY from it? If they extend straight down from the eye region, they are eye lasers, not leg trails. Verify-then-attribute, not attribute-then-verify.

- **Feature-channel tracking.** Do not anchor only on silhouette. Also track named feature channels frame-to-frame:
  - **EYES**: constant (black squares) vs glowing/emitting/changing color. If novel pixels appear collinear with or adjacent to the eye region, this channel is active.
  - **HANDS / ARMS**: idle vs holding/firing/raised
  - **MOUTH**: closed vs open/emitting
  - **HEADGEAR / EQUIPMENT**: NONE vs hat/wig/rope/helmet/crown/mask/accessory equipped. If any structure persists ABOVE the eye-line for ≥3 consecutive frames, mark this channel as ACTIVE and narrate the equip + remove events with timestamps. Do NOT collapse this into a "pose"; it is a discrete state.
  - **BODY BASELINE**: at rest position relative to wordmark/ground anchor vs lifted above it (= hovering/jumping/flying)

- **Position relative to fixed anchors.** If the subject's vertical offset from a fixed anchor (wordmark, ground line, frame edge) is different from baseline AND that offset persists for ≥2 consecutive frames, the subject is HOVERING / LEVITATING / FLYING, not just in an "extended stance."

- **Verb taxonomy with body-region anchors:**
  - PHYSICAL (body): jumps, lands, leaps, runs, walks, falls, hovers, levitates, climbs
  - EMISSION-FROM-EYES: fires (lasers), beams, casts (vision rays)
  - EMISSION-FROM-MOUTH: blasts, breathes (flame/cold/sonic), shouts
  - EMISSION-FROM-HANDS: throws, hurls, shoots, sparks, conjures
  - EMISSION-FROM-BODY: radiates, glows, transforms, explodes
  - EQUIPMENT: puts on, equips, dons, draws, takes off, removes, sheds, drops
  - MANIPULATION: types, picks up, slices, scrolls, edits, opens, clicks, drags

- **If you are unsure**, list 2-3 candidate interpretations and pick one with a confidence note. Honest hedge > confident misreading. At resolution <= 512 specifically, you SHOULD say "I can describe shapes but not feature-channel state at this resolution; recommend mid/high for any verb that depends on a specific feature (eyes/mouth/hands)."

### Continuity audit (mandatory final pass)

After you write the narrative, re-read your draft once more. For each verb where you committed to a specific body-region source or causal verb, ask:

1. Did I have >1 plausible candidate source at the time? If yes, list the alternatives I rejected and the trajectory evidence that ruled them out. If I cannot, that attribution is provisional, flag it.
2. Did I commit to a sequence (A then B then C) where the time spacing was tight (< 0.5s between events)? If yes, ensure my anchor frames support the ordering, not just the existence of each event.
3. Are there any frames I described as "duplicate" or "same as previous"? Re-check them; sub-pixel changes (eye color shift, hand pose change, beam path) can hide in apparent duplicates. If unsure, hedge instead of asserting "no change."
4. **Sampling-gap audit.** Read the budget block to know what coverage you actually have. If "runtime_trim=YES policy=motion-aware", the dense action moments WERE preserved (motion frames are kept first, static bookends even-spaced). In that case your claims about ACTION are well-supported; provisional flags are only needed for SILENT-CHANNEL claims (background detail persistence, peripheral wordmark stability) within static-segment gaps. If "runtime_trim=YES policy=uniform" (no motion segments) OR "runtime_trim=no" with a sampling_gap_warning block, then equip/unequip and other silhouette-area events outside the motion_window may have been missed; flag PROVISIONAL on "feature X stayed constant" claims. Use the dropped_timestamps list in the budget to know exactly which moments are unverified.

Revise any verb where the audit surfaces doubt. A flagged hedge is more useful than a confident wrong attribution.`

// ---------------------------------------------------------------------------
// UI-SCREEN: terminal, IDE, code editor, dashboard, agentic UI flow. High
// spatial detail (text-dense) with low temporal motion. Read as state
// transitions: user input → system response → screen update.
// ---------------------------------------------------------------------------
export const UI_SCREEN_GUIDANCE = `## Interpretation guidance (narrative_mode: ui-screen)

These frames are CONSECUTIVE MOMENTS from a screen recording. Read them as a temporal sequence of UI state, not as independent screenshots.

1. **ANCHORS:** identify persistent UI scaffolding — app chrome, menu bars, window titles, panels that don't change. These are reference points.

2. **CHANGES:** what differs between frames?
   - Cursor position, mouse pointer, selection state
   - Text content of inputs, terminals, editor buffers, log output
   - Numeric values, counters, timestamps, progress indicators
   - Tab / pane focus, modal / popup appearance, dropdown state
   - Tool call animations, spinners, loading states, tool-result indicators
   - Code highlighting changes (syntax, errors, diffs, completion suggestions)

3. **RESOLVE** each change as one of:
   - (a) USER ACTION: clicks, drags, types, scrolls, hovers, keyboard shortcuts
   - (b) SYSTEM RESPONSE: terminal output, command completion, file changes, network responses, tool call results
   - (c) STATE TRANSITION: navigation, mode change, focus shift, error state

4. **NARRATE** as a cause/effect sequence: "user types X → system responds with Y → screen updates to Z".

### Detail bar

- **Read text verbatim.** Code, commands, file paths, output lines, log messages, error text, prompts. Quote them character-for-character.
- **Track numeric values across frames.** "Counter: 0 → 1 → 2", "Progress: 42% → 67% → 100%", "Token count: 8.4K → 12.1K".
- **Identify the focused tool/app.** Terminal vs editor vs browser vs Claude Code vs IDE. Note any tool-specific UI cues.
- **Note ANSI colors and syntax highlighting.** Red errors, green success / passes, dimmed comments, bold keywords, blue links, gray paths.
- **Track cursor + selection state.** Where is the caret? What's highlighted? Is autocomplete or suggestion open?
- **Catch tool-call patterns.** Look for tool-call markers, indented bash blocks, animation indicators, MCP/plugin notifications, agent spawns.

### Priors for agentic UI flows

- **Claude Code interface:** the vertical bar (▌) prefix often marks assistant turns; specific glyphs (⏺, ⏵, ⏼) mark tool-call result lifecycle. Slash commands appear as /name. Task lists, agent spawns, and skill loads each render with their own affordance.
- **Terminal output:** monospace, line-by-line emission. Color codes encode meaning (red/green/yellow/dim). Spinners and progress bars are intentional UI, not noise.
- **Animations are intentional in UI.** A spinner means "in progress"; a checkmark means "done"; a fading-in panel means "appeared just now". Don't dismiss them as "minor visual change."
- **Code/log diff frames:** if multiple frames show the same buffer with text edits between, the edits ARE the action. Quote both the before and after.

### Resolution-aware fidelity

- At low (384) tier text MAY be unreadable; describe layout shape, color blocks, panel boundaries instead of trying to OCR text.
- At mid (512) tier most monospace text becomes readable; quote it.
- At high (1024) tier all UI text + code should be readable; quote everything visible.
- At max (1536) tier capture exact glyph rendering, font weight differences, syntax highlight color names.

### Continuity audit

After the narrative, ask:
1. Did I identify each tool-call lifecycle marker (start / running / done)?
2. Did I quote every visible text change that crossed frames?
3. Did I attribute each change to either user action or system response?
4. Did I notice any text content I described as "same" that actually differs by a character / digit?

Revise on any doubt. UI flows reward exhaustive transcription over confident high-level summary.`

// ---------------------------------------------------------------------------
// HUMAN-MOTION: sports, fitness, dance. Subject is a human performing a
// physical task. Read as biomechanics: phases, joint angles, object paths,
// tempo per phase, rep counts.
// ---------------------------------------------------------------------------
export const HUMAN_MOTION_GUIDANCE = `## Interpretation guidance (narrative_mode: human-motion)

These frames are CONSECUTIVE MOMENTS from a video of a human (or humans) performing a physical task. Read them as a temporal sequence of biomechanics, not as independent images.

1. **ANCHORS:** identify persistent scene elements — equipment, environment, camera angle, lighting. These are reference points.

2. **CHANGES:** what differs across frames?
   - Joint angles (hip, knee, ankle, shoulder, elbow, wrist, neck, spine)
   - Body position relative to equipment, ground, or other reference
   - Object position (barbell, dumbbell, ball, racquet, tool, partner)
   - Posture (back angle, head position, foot placement, hand grip)
   - Phase transitions (setup → execution → completion → reset)
   - Facial expression / strain markers
   - Equipment state (bar bending, weights swinging, ball in flight)

3. **RESOLVE** each change as one of:
   - (a) PHASE: setup, eccentric (lowering / loading), concentric (lifting / pushing / explosive), lockout / peak, reset, transition between reps
   - (b) TECHNIQUE: correct form, technique cue (back arch, knee track, bar path, foot stance, head position), compensatory movement, breakdown
   - (c) TEMPO: cadence per phase, pause, explosive vs controlled, sticking point

4. **NARRATE** the sequence as continuous biomechanics: "subject sets up with hip-width stance and neutral spine → bar leaves floor as hips and shoulders rise simultaneously → knees track over toes through the pull → lockout reached at full hip + knee extension → controlled descent maintaining bar path".

### Detail bar

- **Identify the activity SPECIFICALLY.** "Conventional deadlift" vs "sumo deadlift" vs "snatch" vs "kettlebell swing". Name the equipment (barbell weight if visible, dumbbells, kettlebell, machine).
- **Track bar / object path.** Vertical line over mid-foot? Drifting forward? Hitching at knees? Arc trajectory for ball/racquet movements?
- **Note joint angles in named ranges or descriptors.** "Hip extension reaches full lockout (~180°)", "knees ~90° at setup", "back angle ~30° from vertical at bar-over-mid-shin".
- **Track tempo per phase.** "Eccentric: ~3 seconds. Concentric: ~1.5 seconds. Pause at lockout: ~1 second."
- **Identify form cues.** Back position (neutral / rounded / hyperextended), chest position (up / collapsed), shoulder placement (over bar / behind bar), head / gaze direction, foot placement (flat / on toes), grip (overhand / mixed / hook).
- **Count reps.** If multiple cycles visible, list each rep's start / end timestamp and any form drift between reps ("rep 1 clean, rep 3 hips shoot up early").
- **Identify the SCENE phase.** Setup walk-in, between-rep reset, last-rep grind, walk-away. Each phase has different relevance.

### Priors for athletic content

- **Subject is the human; ignore background movement.** Mirrors, other people, lights flickering, mirrors reflecting motion — all background. Focus on the lifter / athlete.
- **Form > weight.** Describe what the body is doing, not how much weight is on the bar. Don't speculate on the weight unless it's clearly readable.
- **Phases matter more than frames.** A 4-frame deadlift might show: bottom-of-pull, mid-pull, lockout, reset. Identify each phase explicitly; don't describe each frame in isolation.
- **Hedge on form quality.** Calling form "perfect" or "bad" requires multiple frames of evidence. Prefer descriptive ("hips rise faster than shoulders") over judgmental.
- **Audio is usually ambient.** Whisper hallucinations are common on gym / dojo / studio audio. Treat any transcription as untrusted unless it explicitly matches what you see (e.g., a coach calling cues).

### Resolution-aware fidelity

- At low (384) tier you can identify the activity + count reps but cannot reliably judge form micro-cues. Say so.
- At mid (512) tier joint angles become roughly readable; back angle and bar path are visible.
- At high (1024) tier all form cues are readable: grip, foot placement, spinal curve, knee track.
- At max (1536) tier you can read equipment numbers, identify minor positional differences between reps.

### Continuity audit

1. Did I attribute each motion to the SUBJECT, not to background activity?
2. Did I separate setup / execution / reset phases cleanly?
3. Did I avoid generic verbs ("moves") in favor of specific biomechanics ("extends hips and knees simultaneously")?
4. If multiple reps visible, did I describe each as a distinct cycle vs collapsing into one?

Revise on any doubt.`

// ---------------------------------------------------------------------------
// TALKING-HEAD: single human, mostly face / upper body, single camera angle.
// Podcast, interview, reaction, explainer. The subject is mostly stationary;
// the interesting content is in expression, gesture, prop visibility.
// ---------------------------------------------------------------------------
export const TALKING_HEAD_GUIDANCE = `## Interpretation guidance (narrative_mode: talking-head)

These frames are CONSECUTIVE MOMENTS from a video of a person talking to camera. The subject is mostly stationary; what changes is expression, gesture, position, props, and visible UI overlays.

1. **ANCHORS:** identify persistent elements — speaker's identity, framing, background, lighting. These are reference points.

2. **CHANGES:** what differs across frames?
   - Facial expression (eyebrows, mouth shape, eye direction, head tilt)
   - Hand gestures and gesture phase (preparation → stroke → retraction)
   - Body posture, leaning forward / back, shoulder position
   - Props in hand (holding a phone, pointing at something off-camera)
   - On-screen graphics, lower thirds, B-roll cuts
   - Camera framing shifts (zoom, cut to different angle if multi-cam)

3. **RESOLVE** each change as one of:
   - (a) SPEECH BEAT: emphasis pause, sentence boundary, listing items, asking a question
   - (b) GESTURE: deictic (pointing), iconic (size/shape mime), beat (rhythm), illustrator (drawing a shape)
   - (c) REACTION: surprise, confusion, agreement, dismissal
   - (d) MEDIA INSERT: B-roll, graphic overlay, animation, screen capture inset

4. **NARRATE** as a sequence of conversational beats: "speaker leans in while emphasizing X → gestures expansively to indicate scale → pauses on questioning expression → returns to neutral".

### Detail bar

- **Quote any visible text verbatim.** Lower thirds, name + title cards, subtitle / caption text, on-screen citations, URLs / handles.
- **Identify the speaker if recognizable** (public figure, brand spokesperson). If not, describe ("man, 30s, glasses, beard, blue button-down").
- **Track expression by facial region.** "Eyebrows raise + mouth opens = surprise / question." "Lips press together + slight head shake = disagreement / dismissal."
- **Identify gesture purpose, not just shape.** "Pinches thumb + index together horizontally = small / precise." "Sweeps hand across body = scope / range." Generic "hand waves" is uninformative.
- **Catch media inserts.** B-roll cuts, graphic overlays, picture-in-picture, animated callouts. Describe what's inserted.

### Resolution-aware fidelity

- At low (384) facial expression is broadly readable but micro-expressions are lost.
- At mid (512) eyes / mouth / eyebrow positions readable; gesture phase visible.
- At high (1024) full facial nuance + text + lower-thirds readable.
- At max (1536) catch sub-expression details, prop identification, branding micro-details.

### Continuity audit

1. Did I avoid generic "talks" / "speaks" verbs and identify gesture purpose?
2. Did I track expression changes across frames (vs treating each as separate)?
3. Did I quote any visible on-screen text verbatim?
4. Did I note any cut to B-roll / different framing as a separate scene boundary?

Revise on any doubt.`

// ---------------------------------------------------------------------------
// REAL-WORLD: dashcam, POV, drone, varied subject. Camera moves through a
// scene; no single subject region dominates. Generic temporal-sequence
// framing, no domain priors.
// ---------------------------------------------------------------------------
export const REAL_WORLD_GUIDANCE = `## Interpretation guidance (narrative_mode: real-world)

These frames are CONSECUTIVE MOMENTS from a video where the camera moves through a scene. There may be many subjects, or none clearly dominant.

1. **ANCHORS:** identify persistent elements — vehicle / camera platform, time of day, weather, road / environment type, recurring landmarks.

2. **CHANGES:** what differs across frames?
   - Camera position relative to environment (motion through space)
   - Objects entering / exiting frame (other vehicles, pedestrians, animals, landmarks)
   - Lighting / weather changes
   - Road / path conditions
   - Speed / acceleration cues

3. **RESOLVE** each change as one of:
   - (a) EGO MOTION: camera platform moves forward / left / right / up / decelerates
   - (b) WORLD EVENT: another actor in the scene (car ahead brakes, pedestrian crosses, animal appears)
   - (c) ENVIRONMENT TRANSITION: tunnel entry, weather change, lighting shift, road type change
   - (d) NOTABLE OBJECT: signage, landmark, hazard, anything information-bearing

4. **NARRATE** as a journey: "camera enters intersection from south → vehicle ahead applies brake (red lights illuminate) → camera decelerates → traffic light cycles to green → resume forward motion".

### Detail bar

- **Identify camera platform.** Vehicle (car / motorcycle / bicycle), aerial (drone), pedestrian POV, mounted camera, handheld.
- **Quote visible text verbatim.** Road signs, license plates (if relevant + privacy ok to mention), shop names, vehicle markings, on-screen UI.
- **Note other actors.** Other vehicles by type + color + position. Pedestrians by general description. Animals by species.
- **Track lighting + weather.** Time of day cues, weather (clear / overcast / rain / snow / fog), road surface (dry / wet).
- **Identify hazards or notable events.** Near misses, signs of trouble, points of interest.

### Generic priors

- Hedge on what you cannot see clearly.
- Resist generic verbs ("moves" → "accelerates from rest"; "appears" → "enters frame from left").
- Identify scene boundaries when the environment fundamentally changes.

### Continuity audit

1. Did I separate ego motion from world events?
2. Did I track each notable actor across frames?
3. Did I quote any visible text?
4. Did I identify lighting / weather changes vs treating each frame as the same conditions?

Revise on any doubt.`

// ---------------------------------------------------------------------------
// NATURE: landscape, static / slow camera, no subject. Environmental detail,
// lighting changes, wildlife.
// ---------------------------------------------------------------------------
export const NATURE_GUIDANCE = `## Interpretation guidance (narrative_mode: nature)

These frames are CONSECUTIVE MOMENTS from a video of a natural scene with no human or animation subject. Read them for environmental detail and slow change.

1. **ANCHORS:** identify the persistent environment — landscape type, weather, time of day, camera position. Most of the frame will stay the same across frames.

2. **CHANGES:** what differs across frames?
   - Lighting / shadow direction (sun moves)
   - Cloud / fog / weather motion
   - Wildlife movement (birds, insects, small mammals)
   - Water movement (waves, ripples, flowing water)
   - Vegetation movement (wind in leaves, grass)
   - Subtle camera motion (slow pan, slight handheld drift)

3. **RESOLVE** each change as one of:
   - (a) TIME PROGRESSION: light direction shift, color temperature change, cloud movement
   - (b) WILDLIFE EVENT: animal appears / moves / exits
   - (c) WEATHER EVENT: cloud / fog change, rain starting / stopping, wind gust
   - (d) CAMERA MOVEMENT: pan, zoom, drift

4. **NARRATE** as environmental flow: "morning light angles in from camera-left → mist rises off the lake surface → distant ridge gradually becomes visible as fog clears".

### Detail bar

- **Identify landscape type specifically.** "Alpine meadow", "rocky coast", "old-growth forest", "high desert".
- **Note color in named shades.** Sky transitions, foliage colors, water tones.
- **Identify wildlife by species when possible.** "Bald eagle in flight", not "a bird".
- **Track lighting through time-of-day cues.** Golden hour, blue hour, midday, overcast.

### Generic priors

- Most "changes" in nature footage are subtle. Don't invent action where there isn't.
- Slow camera motion (pan / zoom) is itself a beat — note it.

### Continuity audit

1. Did I avoid inventing motion that isn't actually there?
2. Did I identify the landscape type specifically?
3. Did I track lighting / weather across frames?

Revise on any doubt.`

// ---------------------------------------------------------------------------
// GENERIC: fallback for unclassified or mixed content. Pure temporal-sequence
// framing without any domain priors. Cheap (~1K tokens) — adds minimal
// context pollution while still encouraging temporal reading.
// ---------------------------------------------------------------------------
export const GENERIC_GUIDANCE = `## Interpretation guidance (narrative_mode: generic)

These frames are CONSECUTIVE MOMENTS IN TIME from one video. Treat them as a temporal sequence, not as independent images.

1. **ANCHORS:** what PERSISTS across frames (subject, setting, camera, background)?
2. **CHANGES:** what DIFFERS (position, posture, attribute, state, environment, lighting, text)?
3. **RESOLVE** each change as an action, scene transition, or world-state change.
4. **NARRATE** as continuous prose using temporal connectors (then, while, after).

### Detail bar

- Name specific objects, props, and people when identifiable.
- Quote visible text verbatim.
- Note color in named shades when distinguishable.
- Track start state and end state separately for any feature that changes.
- Identify loops, repeats, and scene boundaries.
- Resist generic verbs — be specific about WHAT changed.

### Generic priors

- Hedge when unsure ("looks like X", "could be Y or Z"). Honest uncertainty beats confident misreading.
- The subject can be anything: a person, animation, UI, product, animal, sports moment, cooking step. Adapt your verbs to what is actually happening.
- At resolution <= 512 specifically, you SHOULD say "I can describe shapes but not micro-detail at this resolution; recommend mid/high for any verb that depends on a specific feature."`

// ---------------------------------------------------------------------------
// Profile registry. Per-call probe_calibration handles dynamic TPF sizing in
// watch.ts; the profile here just supplies the guidance prompt.
// ---------------------------------------------------------------------------

export const NARRATIVE_PROFILES: Record<ContentClass | "auto", NarrativeProfile> = {
  animation: { name: "animation", guidance: ANIMATION_GUIDANCE },
  "ui-screen": { name: "ui-screen", guidance: UI_SCREEN_GUIDANCE },
  "human-motion": { name: "human-motion", guidance: HUMAN_MOTION_GUIDANCE },
  "talking-head": { name: "talking-head", guidance: TALKING_HEAD_GUIDANCE },
  "real-world": { name: "real-world", guidance: REAL_WORLD_GUIDANCE },
  nature: { name: "nature", guidance: NATURE_GUIDANCE },
  generic: { name: "generic", guidance: GENERIC_GUIDANCE },
  auto: { name: "auto", guidance: "" },
}

// Resolve the profile to use for a given watch() call. Precedence:
//   1. explicit narrative_mode_profile param (if not "auto")
//   2. cached content_class from analyze()
//   3. fallback to "animation" (preserves v0.10.x behavior for legacy callers)
export function resolveNarrativeProfile(
  explicit: ContentClass | "auto" | undefined,
  cachedClass: ContentClass | undefined,
): NarrativeProfile {
  if (explicit && explicit !== "auto") return NARRATIVE_PROFILES[explicit]
  if (cachedClass) return NARRATIVE_PROFILES[cachedClass]
  return NARRATIVE_PROFILES.animation
}
