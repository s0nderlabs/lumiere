# launch-video.lock.json - the structured design lock

One lock per launch-video project, at the TARGET project's root (e.g.
`~/Documents/s0nderlabs/pragma-launch/launch-video.lock.json`). It is the
machine-readable successor of anima-launch's prose `design.md`: every design
decision a session needs lives here as data, not paragraphs.

Schema: [`launch-video.lock.schema.json`](./launch-video.lock.schema.json)
(JSON Schema 2020-12). Validate with:

```bash
bun creation/_tools/validate-lock.mjs <path/to/launch-video.lock.json>
```

## Contract

1. **Locked values are non-negotiable.** Any session scaffolding, editing, or
   re-rendering scenes treats palette/typography/motion/bans as law. Changing
   a locked value is a USER decision, recorded by editing the lock, never an
   in-flight improvisation. This is the "quality anchor across sessions and
   models" mechanism, the same reasoning that locked prebuilt parametric
   effects.
2. **The lock is human-editable** (the no-black-box mission constraint). It is
   plain JSON; the user can change a hex or a scene duration in any editor and
   re-run scaffold.
3. **`design.md` is optional, generated prose.** If a project wants a readable
   narrative, generate it FROM the lock. Never maintain both by hand.
4. **Bans are data.** `palette.bans`, `typography.banned`, `outOfScope` exist
   so review passes can enforce them mechanically ("zero blue" is checkable;
   a vibe in prose is not).

## How it gets filled

- **INTERVIEW phase** (formalized after the pilot): a 5-8 turn guided
  conversation walks the user through identity → references → beat budget →
  effect picks, writing fields as they lock.
- **Hand-written** is always valid: the pipeline treats a hand-edited lock
  identically (each phase is independently invokable).
- **Reference-driven**: a perception beat sheet (REFERENCE phase) can prefill
  `scenes[]` (start/duration/effects from the analyzed video), then the
  interview refines.

## Field guide

The schema is authoritative for shapes; this is what the fields MEAN.

- **`meta`**: project slug (becomes the root composition id), title, optional
  `tagline` (the VIDEO's one-line voice - distinct from any scene-level
  `content.tagline` copy), target duration, `stage` = the logical size scenes
  are authored at (1920x1080 unless decided otherwise), `render` = final
  output (anima shipped 3840x2160 @ 60).
- **`palette.tokens`**: CSS custom properties every scene file declares in its
  `:root`. Scenes use tokens, never raw hex; that is what makes a palette swap
  a one-file edit.
- **`typography.roles`**: the role vocabulary scenes style against (display,
  body, mono-kicker, wordmark...). `banned` is enforced at review.
- **`heroElements`**: motifs that persist across scenes (anima's cursor with
  its locked SVG path + 4 container sizes; a mascot sprite). Locking geometry
  here is what keeps the motif identical in scene 1 and scene 9.
- **`texture`**: global surface treatment (anima's paper-noise SVG multiplied
  at 42%). Applied by every scene, so it lives once, here.
- **`motion`**: the easing vocabulary (use → GSAP ease string) plus principles
  as enforceable statements. Scenes pick eases from this table. Optional
  `breatheSeconds` locks an ambient breathe-loop period when the video has a
  persistent breathing motif (anima's cursor: 2.6).
- **`audio.tracks`**: v0 policy is handoff: assets are provided externally,
  `status: "tbd"` tracks render silent. The scaffold wires `<audio>` clips
  only for `status: "locked"` tracks.
- **`scenes[]`**: the beat sheet as data, ordered by `start`. Each scene's
  `id` names its clip block in the root composition (v1 scaffolds keep all
  scenes in root `index.html`; see RESTAGE.md on why sub-compositions wait).
  Each scene:
  - `storyboard`: the freeform prose brief for the beat (the locked storyboard
    format: prose, not tables).
  - `content`: the REAL copy/data for the scene (headline strings, terminal
    lines, chart numbers). Scenes render content; storyboard guides how.
  - `effects[]`: which canonical effects are deployed, each with per-use
    `vars` (same keys as the effect's `meta.variables`, atomic per knob, see
    `effects/FORMAT.md` Variables). Restaging them into the scene file is
    specified in [`RESTAGE.md`](./RESTAGE.md).
  - `transitionOut`: handoff to the next scene; omit for a plain cut.
- **`idioms` / `outOfScope`**: inherited visual idioms and hard bans.
- **`references`**: provenance pointers (brand CSS, reference videos, the
  perception beat sheet a scene list came from).

## Annotated example

A minimal real lock (the lumiere-teaser pilot, 3 scenes, ~12s). Comments are
not valid JSON; they annotate, the actual file has none.

```jsonc
{
  "lockVersion": 1,
  "meta": {
    "project": "lumiere-teaser",
    "title": "lumiere - launch videos, compressed",
    "targetDurationSeconds": 12,
    "stage": { "width": 1920, "height": 1080 },     // authoring size
    "render": { "width": 1920, "height": 1080, "fps": 60, "output": "renders/lumiere-teaser.mp4" },   // keep outputs under renders/ (gitignored)
    "lockedOn": "2026-06-06",
    "lockedWith": "elpabl0"
  },
  "palette": {
    "tokens": [
      { "token": "--cream",      "hex": "#f9f8f6", "use": "primary background" },
      { "token": "--cream-deep", "hex": "#f2f1ee", "use": "secondary surface (input bars, chrome)" },
      { "token": "--paper",      "hex": "#fbfbf9", "use": "elevated cards/panels" },
      { "token": "--ink",        "hex": "#100f09", "use": "primary text" },
      { "token": "--ink-2",      "hex": "#525251", "use": "secondary text" },
      { "token": "--ink-3",      "hex": "#8b8b88", "use": "faint text, kickers" }
    ],
    "shadow": "rgba(60, 50, 30, 0.32)",              // warm, never pure black
    "bans": ["zero blue", "zero orange", "no invented colors"]
  },
  "typography": {
    "roles": [
      { "role": "wordmark",    "family": "CalSans",    "weight": "400", "tracking": "-0.02em", "notes": "ONLY for the literal word lumiere" },
      { "role": "display",     "family": "Outfit",     "weight": "500/600", "tracking": "-0.02em" },
      { "role": "body",        "family": "Outfit",     "weight": "400" },
      { "role": "mono-kicker", "family": "Geist Mono", "weight": "500", "tracking": "0.22em uppercase" }
    ],
    "banned": ["any serif", "italic anywhere"],
    "fonts": [
      { "family": "CalSans",    "source": "assets/fonts/CalSans-Regular.woff2" },
      { "family": "Outfit",     "source": "builtin" },
      { "family": "Geist Mono", "source": "builtin" }
    ]
  },
  "motion": {
    "eases": [
      { "use": "entrances",    "ease": "power3.out" },
      { "use": "hero reveals", "ease": "expo.out" },
      { "use": "transitions",  "ease": "power2.inOut" },
      { "use": "dive",         "ease": "power4.inOut" }
    ],
    "principles": [
      "offset first animation 0.1-0.3s after each cut",
      "no exit animations except the final scene",
      "vary at least 3 eases per scene"
    ]
  },
  "audio": { "tracks": [ { "role": "ambient", "status": "tbd" } ] },  // pilot renders silent
  "scenes": [
    {
      "id": "wordmark",
      "start": 0, "duration": 3.2, "energy": "rising",
      "storyboard": "Cold open on cream. A mono kicker 'INTRODUCING' fades in low, then the lumiere wordmark rises per-character with weight.",
      "content": { "kicker": "INTRODUCING", "wordmark": "lumiere" },
      "effects": [
        { "ref": "wordmark-rise", "vars": { "text": "lumiere" }, "role": "hero reveal" }
      ]
    },
    {
      "id": "prompt",
      "start": 3.2, "duration": 4.2, "energy": "focused",
      "storyboard": "A ChatGPT-style composer bar centered on cream. The ask types itself out, character by character.",
      "content": { "prompt": "make me a launch video" },
      "effects": [
        { "ref": "chat-input-typing", "vars": { "text": "make me a launch video" }, "role": "hero", "notes": "timer-driven canonically; restage de-timers it" }
      ]
    },
    {
      "id": "dive",
      "start": 7.4, "duration": 4.6, "energy": "peak",
      "storyboard": "The wordmark returns with the tagline, then the camera dives through the focal letter into a terminal that confirms the render.",
      "content": { "tagline": "ships today." },
      "effects": [
        { "ref": "dolly-zoom", "vars": { "tagline": "ships today." }, "role": "finale transition" }
      ],
      "transitionOut": "end on terminal"
    }
  ],
  "idioms": ["soft warm shadows on elevated surfaces", "mono kicker above headings"],
  "outOfScope": ["emojis", "3D shaders", "particle systems"],
  "references": [
    { "label": "effects library", "path": "~/Documents/s0nderlabs/lumiere/effects/" },
    { "label": "dialect reference", "path": "~/Documents/s0nderlabs/anima-launch/" }
  ]
}
```

## Related

- [`RESTAGE.md`](./RESTAGE.md) - how `scenes[].effects[]` declarations become
  composition code
- [`../effects/FORMAT.md`](../effects/FORMAT.md) - the canonical effect format
  + the Variables contract `effects[].vars` binds against
