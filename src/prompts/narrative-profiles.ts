// Universal narrative guidance. No content-class routing, no domain-specific
// priors. The model determines what it's looking at and describes it accurately.
// v0.12: stripped all 7 per-class profiles down to one clean temporal-sequence
// framing. The model is Opus 4.7 with excellent vision; it does not need us to
// explain what eye lasers or cape equipment look like.

export const NARRATIVE_GUIDANCE = `## Interpretation guidance

These frames are CONSECUTIVE MOMENTS IN TIME from one video. Treat them as a temporal sequence, not as independent images.

1. **ANCHORS:** identify what PERSISTS across the frames (subject, setting, camera, background).
2. **CHANGES:** identify what DIFFERS across the frames (position, posture, attribute, state, environment, lighting, text content).
3. **RESOLVE** each change as an action, a scene transition, or a state change.
4. **NARRATE** the sequence as continuous prose using temporal connectors (then, while, after).

### Detail bar

- Name specific objects, props, characters, and UI elements when identifiable.
- Quote ALL visible text verbatim (labels, code, captions, values, numbers).
- Note color in named shades when distinguishable. Hex codes at high/max resolution.
- Track start state and end state separately for any feature that changes.
- Identify loops, repeats, and scene boundaries.
- Resist generic verbs. "Slides 40px left" beats "moves." "Fades in over 3 frames" beats "appears."
- At resolution <= 512, hedge when detail is ambiguous: "looks like X" over asserting X.`
