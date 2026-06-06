# lumiere effect format - `effects/<id>/effect.html`

One effect = one standalone, self-describing HTML file. This file is the
SINGLE SOURCE OF TRUTH for the effect: the dashboard previews it (iframe),
verification harnesses scrub it, and the creation pipeline (storyboard →
scaffold → render) references it by path. There is no second copy.

## Directory layout

```
effects/
├── FORMAT.md              this spec
├── _base.css              shared tokens + stage chrome (verbatim dashboard palette)
├── _runtime.js            shared mount/replay/scrub/postMessage runtime
├── _vendor/gsap.min.js    vendored GSAP (file:// safe, no CDN)
├── _fonts/                vendored fonts: vendored.css (Outfit 200-700var +
│                          Geist Mono 400/500, OFL) + CalSans + the woff2 files.
│                          NEVER use the Google Fonts CDN link: qutebrowser
│                          silently blocks it on file://
└── <effect-id>/
    └── effect.html        the effect (this spec)
```

`_`-prefixed entries are infrastructure, not effects. Tools that enumerate
effects must skip them.

## Anatomy of effect.html

```html
<!doctype html>
<html lang="en" class="theme-light">
<head>
<meta charset="utf-8"/>
<title>{Display Name} · lumiere effect</title>
<link rel="stylesheet" href="../_fonts/vendored.css">
<link rel="stylesheet" href="../_base.css">
<style data-effect-css>
/* this effect's CSS - every rule whose selector touches the effect's
   class names, including html.theme-dark overrides and @keyframes */
</style>
</head>
<body>
<div id="fit">
  <div id="card" class="card-sim"
       data-composition-id="{effect-id}"
       data-stage-width="360" data-stage-height="240">
    <div class="viewport"><!-- effect markup --></div>
  </div>
</div>
<script src="../_vendor/gsap.min.js"></script>
<script data-effect-meta type="application/json">
{
  "id": "{effect-id}",
  "display": "{Display Name}",
  "cat": "{Category}",
  "isNew": true,
  "source": ["{provenance-slug}"],
  "desc": "{one-paragraph description}",
  "stage": { "width": 360, "height": 240 },
  "scrubbable": true,
  "variables": {}
}
</script>
<script data-effect-init>
window.LUMIERE_INIT = function init(card) {
  /* read knobs from window.LUMIERE_VARS (see "Variables" below);
     effect setup: build DOM state, set contentful REST state,
     return replay() which returns a gsap timeline */
}
</script>
<script src="../_runtime.js"></script>
</body>
</html>
```

Script order is load-bearing: gsap → meta → init → runtime.

## The init contract (identical to the dashboard's)

- `LUMIERE_INIT(card)` receives the `#card` element; the effect markup
  lives inside `card.querySelector(".viewport")`. All queries are
  card-scoped (`card.querySelector(...)`) - never `document.querySelector`.
- On mount, init establishes the **contentful rest state** (what a static
  card shows). The runtime does NOT auto-play; this matches the dashboard,
  where animation first fires on scroll-into-view.
- init returns a `replay()` function. `replay()` must:
  - be safe to call repeatedly (kill its own tweens first:
    `gsap.killTweensOf(...)` + kill the previous timeline),
  - rebuild its start state with `gsap.set` (NEVER `gsap.from` - 1-frame
    flash, see feedback-gsap-from-causes-flash),
  - return the `gsap.timeline()` it builds (enables scrubbing). Effects
    that animate via setInterval/CSS animations return undefined and set
    `"scrubbable": false` in meta.
- Determinism: no `Date.now()`, no raw `Math.random()` (use a seeded rng
  as confetti-burst does), no network fetches. HyperFrames renders by
  seeking - nondeterminism breaks frame-exact rendering.
- Never `gsap.set(el, { clearProps: "all" })` on elements with inline
  style positioning (see feedback-clearprops-wipes-inline-positioning).

## Variables (per-use parametrization)

`meta.variables` declares the effect's knobs with their DEFAULT values.
Before init runs, the runtime resolves
`window.LUMIERE_VARS = { ...meta.variables, ...?vars overrides }`.
The merge is shallow at the TOP-LEVEL KEY only: omitted knobs keep their
defaults, but an overridden knob is replaced atomically - an
object/array-valued knob (like a `data` array) is swapped wholesale,
never deep-merged, so an override must restate the full collection.
Malformed `?vars` JSON is dropped with a console error and the effect
renders with pure defaults. Init reads its knobs from there:

```js
window.LUMIERE_INIT = function init(card) {
  const V = window.LUMIERE_VARS
  el.textContent = V.text
  ...
}
```

Rules:

1. **Defaults reproduce the reference render, exactly.** Every default is
   the literal that was previously hardcoded in the effect. Loading
   `effect.html` with no `?vars=` must render identically to the
   unparametrized file - this invariant is what keeps the canonical
   library a quality anchor.
2. **Expose few knobs, deliberately.** Only what a composer plausibly
   tweaks per-use: content (`text`, `data`), the `speed` knob,
   occasionally one key visual scalar. Not every literal is a variable;
   knobs are added when a real use needs them, not speculatively.
3. **`speed` convention**: rate multiplier, default `1`. Must be a finite
   number `> 0` (`0` freezes timelines / never fires tweens; divides go to
   Infinity). The runtime (`_runtime.js`) ENFORCES this: an invalid `speed`
   override is dropped with a console error and the effect's default
   applies, so effects may assume `> 0`. The lock schema also types
   `vars.speed` with `exclusiveMinimum: 0`. Pick ONE
   mechanism: if all of replay's timing lives in a single timeline,
   apply `tl.timeScale(V.speed)`; otherwise divide every duration/
   delay/stagger/interval literal by `V.speed`. Never mix the two in
   one effect - timeScale only reaches the timeline and leaves bare
   tweens at speed 1, desyncing the motion. A storyboard-level
   `(duration=X)` override is translated by the scaffold step:
   `speed = natural_duration / X`.
4. **Values are JSON** (string / number / boolean, arrays / objects of
   those). Keys are camelCase. No functions, no element refs.
5. **Knobs must degrade gracefully** under reasonable overrides inside
   the fixed stage: longer text may truncate/overflow per the effect's
   existing CSS, data arrays may change length, but nothing should
   throw or collapse the layout.

Override channels (same values, different transports):

- standalone / dashboard preview: `?vars=<URL-encoded JSON>`, e.g.
  `effect.html?vars=%7B%22text%22%3A%22pragma%22%7D`
- creation pipeline: HyperFrames `data-variable-values` per scene (the
  scaffold step re-stages the effect and binds the per-use overrides).
  The two attribute names are deliberately distinct: defaults live in
  `data-composition-variables`, per-scene overrides in
  `data-variable-values`.

## Meta block (`script[data-effect-meta]`)

Machine-readable without executing JS (DOMParser + JSON.parse). Fields
mirror the legacy `LUMIERE_EFFECTS` entries: `id`, `display`, `cat`,
`isNew` (optional), `source` (array of provenance slugs, optional),
`desc`, plus:

- `stage` - logical design size in px. Converted effects keep `360x240`
  (the verified dashboard card geometry; vector content scales cleanly).
  New video-first effects may use larger stages.
- `scrubbable` - whether replay() returns a seekable timeline.
- `variables` - the effect's knobs + defaults (HyperFrames
  `data-composition-variables` analog). See "Variables (per-use
  parametrization)" above. Effects without knobs ship `{}`.

## Runtime API + URL params

See the header comment in `_runtime.js` for the full contract:
`?theme/chrome/fit/autoplay/vars` params; `LUMIERE_META/VARS/READY`,
`LUMIERE_REPLAY()`, `LUMIERE_PREPARE()` (lazy HyperFrames-style
paused-timeline registration on `window.__timelines[id]`), and the
postMessage bridge (replay/theme/prepare/seek) for parents without
contentWindow access.

## HyperFrames mapping

- `data-composition-id` on `#card` ↔ composition id.
- `LUMIERE_PREPARE()` registers the paused timeline on
  `window.__timelines[id]` (HyperFrames key rule #3). It is lazy so the
  default mount shows the rest state, not frame 0.
- `meta.variables` ↔ HyperFrames' variables system, conceptually:
  HyperFrames declares defaults as a JSON ARRAY of `{id, type, label,
  default}` on `<html data-composition-variables>` and overrides as an
  OBJECT on the mount (`data-variable-values`); lumiere keeps the simpler
  object-of-defaults form and BAKES resolved values at restage time.
- Scaffolding into an actual video composition (the creation pipeline)
  re-stages the effect inside the target project per
  `../creation/RESTAGE.md`; this file is the canonical reference
  implementation it copies from. The lock file that drives scaffolding is
  specified in `../creation/LOCK.md`.

## Conversion rules (legacy `dashboard/effects.js` → this format)

1. **Verbatim extraction, zero drift.** `html` template, `init` body, and
   the effect's CSS block from `dashboard/index.html` are copied
   byte-for-byte. Only four changes are allowed: indentation normalization;
   replacing emdash characters with `-` in CODE COMMENTS only (house rule);
   CSS comments interleaved between rules are not carried over (rules only);
   invisible characters (NBSP) in JS strings may be rewritten as explicit
   escapes (`" "`), runtime-identical and editor-safe. Emdashes inside
   rendered strings/markup stay untouched (changing visible text = drift).
   No refactors, no "improvements", no renamed classes during conversion.
   Module-scope helpers from effects.js (`spanChars`, `splitWords`,
   `BRAILLE`) must be carried INTO the init script of any effect using them.
2. **CSS completeness**: collect every class the effect uses (from its
   html template AND classes created in init JS, e.g.
   `p.className = "cfb-piece"`), then copy every rule in the dashboard
   stylesheet whose selector mentions any of them - including
   `html.theme-dark` variants, media queries, and any `@keyframes`
   referenced by their `animation` properties.
3. **Flag, don't fix**: anything beyond card-scoped DOM + gsap (document
   queries, window listeners, timers) gets reported in the conversion
   notes, not silently changed.
4. Meta fields copied from the `LUMIERE_EFFECTS` entry verbatim;
   `scrubbable:false` iff replay returns no timeline.

## Verification protocol (every conversion)

Render OLD (dashboard card via the `_audit.html` harness) and NEW
(`effect.html?fit=native&chrome=card`) at identical timeline times,
crop to the 360x240 viewport, pixel-diff (ImageMagick). Drift gate:
near-zero diff at rest + every sampled time. Non-scrubbable effects:
wall-clock captures + eyeball + `lumiere watch` on rendered mp4s.
Serial through the ONE qutebrowser instance - never parallel renders.
