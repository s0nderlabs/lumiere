# RESTAGE.md - restaging canonical effects into a composition

How a `scenes[].effects[]` declaration in `launch-video.lock.json` becomes
working composition code. This is the mechanical half of the SCAFFOLD phase;
the creative half (placement, choreography between effects, bespoke detail)
is session judgment guided by the lock.

**The boundary rule (HARD):** the mechanical transform must NEVER alter an
effect's motion mechanics - the verified choreography IS the value being
transported. Restage changes placement, scale, content, and the driver, never
the move. If a scene needs different mechanics, that is a new effect or a
deliberate redesign, which routes through the rewatch-the-reference rule
(`feedback-redesigns-rewatch-the-reference` in project memory).

## What restage consumes and produces

- **Consumes**: the lock (palette/typography/motion/scenes) + the canonical
  `effects/<id>/effect.html` files it declares. The canonical file is
  self-describing: markup inside `.viewport`, CSS in `style[data-effect-css]`,
  logic in `script[data-effect-init]`, knobs in `script[data-effect-meta]`.
- **Produces**: scene blocks inside the project's root `index.html` (the
  HyperFrames-dialect composition). **v1 scaffolds keep ALL scenes in the
  root file - no sub-compositions.** Sub-comps (`data-composition-src`)
  require a disarm/seek-sync scaffold (child timelines race otherwise) and
  earn their complexity only for long videos or reused scene units. Split
  only when the root file becomes unwieldy (hyperframes lint warns
  `composition_file_too_large` around ~550 lines).

## The composition shell (per project, generated once)

Derived from the anima-launch reference (the proven dialect):

```html
<!doctype html><html lang="en"><head><style>
  /* @font-face: relative paths into assets/fonts/ (lock typography.fonts)
     :root tokens: EXACTLY the lock palette.tokens
     * { box-sizing:border-box; margin:0; padding:0 }
     html, body { width:100%; height:100% }
     body { display:flex; align-items:center; justify-content:center;
            overflow:hidden; }
     .stage { position:relative; overflow:hidden;
              width:1920px; height:1080px;   SUBSTITUTE meta.stage from the
                                             lock (1920x1080 shown); must match
                                             data-width/data-height below
              background:var(--cream);
              flex-shrink:0;   LOAD-BEARING: stops narrow viewports (the
                               dashboard preview iframe) squishing the
                               stage's LAYOUT box before scaling
              transform-origin:center center; }
     NO CSS transform:scale(min(calc(100vw/1920),...)) - scale() takes a
     NUMBER and a vw-derived calc() is a LENGTH, so that form is silently
     INVALID (transform stays none). The fit is set by fitStage() below.
     /* texture (lock.texture), then per-scene CSS blocks */
</style></head><body>
<div class="stage" data-composition-id="main" data-start="0"
     data-width="1920" data-height="1080">  <!-- meta.stage, same values as the CSS -->
  <!-- texture overlays first, then scene clips, then audio clips -->
</div>
<script src="assets/vendor/gsap.min.js"></script>
<script>
  /* preview scale-fit (contain); render engines pin viewport = stage size,
     where this resolves to scale(1). Resize-only, never timeline-coupled.
     Divisors come from data-width/data-height (NEVER hardcode 1920/1080 here:
     a non-1920 stage would CSS-shrink inside its own render viewport). */
  const stageEl = document.querySelector(".stage");
  const stageW = Number(stageEl.dataset.width), stageH = Number(stageEl.dataset.height);
  function fitStage() {
    stageEl.style.transform = "scale(" + Math.min(window.innerWidth / stageW, window.innerHeight / stageH) + ")";
  }
  window.addEventListener("resize", fitStage);
  fitStage();

  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true,
    defaults: { ease: "power3.out", lazy: false } });
  tl.set(".stage", { opacity: 1 }, 0);
  /* ... all scene animation at ABSOLUTE times ... */
  window.__timelines["main"] = tl;          // register LAST, after build
  /* standalone autoplay kicker (never fires when embedded/Studio).
     NOTE the catch returns FALSE (the reference's chosen semantics): a
     cross-origin parent that throws on .document access is treated as
     "standalone, play it", not as an embed. */
  const embedded = (() => { try { return window.parent !== window && !!window.parent.document } catch (e) { return false } })();
  if (!embedded) setTimeout(() => tl.play(0), 200);
</script></body></html>
```

Shell rules (each one is load-bearing, learned from the working reference):

0. **Stage dimensions come from the lock's `meta.stage`**, substituted in BOTH
   the `.stage` CSS and the `data-width`/`data-height` attributes (they must
   agree; fitStage and the render engines read the data attributes). The
   template shows 1920x1080 because that is the default lock value, not a
   constant. The hero scale factor in step 3 below scales with it too
   (stageHeight / 240).
1. `paused: true` + `defaults.lazy: false` are MANDATORY. `lazy:false` makes
   onUpdate/eases fire on every scrub position; without it the render skips
   frames.
2. Register on `window.__timelines["main"]` LAST, after the full build. This
   registration is the SINGLE contract that makes a composition both previewable
   (dashboard Preview pane) AND renderable (both engines) - they seek the same
   `__timelines.main`. A composition that does not register it is neither. So
   every scaffold is previewable by construction; surface its `index.html` path
   in the Preview pane as the review step (mp4 export comes after).
3. **gsap is vendored** at `assets/vendor/gsap.min.js` (copy from
   `effects/_vendor/`). This is a deliberate upgrade over the reference
   (anima ships a CDN tag, which `hyperframes render` inlines fine): a CDN
   tag is silently blocked on file:// in qutebrowser, which would kill the
   dashboard preview pane. Vendored works everywhere. Same for fonts: vendor
   the woff2 under `assets/fonts/`. NOTE: the `hyperframes render` compiler
   ALSO fetches its own Google Fonts faces at render time even when you have
   vendored them. That double-fetch is harmless and expected, do NOT remove
   the vendored fonts to "dedupe" it - the vendored copies are what make the
   file:// Preview pane render correctly (the compiler fetch is render-only).
4. **No `requestAnimationFrame` anywhere in the file.** hyperframes lint
   flags it and the renderer downgrades to screenshot-capture mode and cuts
   workers (anima's 4k render: 4 -> 2 workers, cost multiplier 2, for ONE
   rAF loop). The reference itself violates this rule (its sub-comp sync
   poll) and paid that penalty - it is the cautionary example here, not the
   model. v1 root-only scaffolds have no sub-comps and need no rAF at all;
   one-shot layout measures run synchronously inside
   `document.fonts.ready.then(...)` instead.
5. **Determinism**: no wall-clock, no raw randomness, no network. Seeded rng
   only. The reference's shell rng is a mulberry32-style integer hash:
   `function rng(seed) { let t = (seed + 0x6D2B79F5) | 0; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }`.
   The lumiere effects library internally uses a sin-hash
   (`Math.sin(seed * 99.13 + 4.7) * 43758.5453`, fract) - when restaging an
   effect that carries one, keep ITS rng byte-identical (boundary rule);
   for new shell-level randomness use the mulberry32. SVG noise via fixed
   `seed=` in feTurbulence.

## The six mechanical steps (per scene effect)

### 1. Extract

Lift from the canonical file: the markup inside `.viewport`, every rule in
`style[data-effect-css]`, the init logic from `script[data-effect-init]`
(including module-scope helpers like `spanChars`), and `meta.variables`
defaults.

### 2. Translate the driver

The effect's `replay()` schedule becomes master-timeline animation at
ABSOLUTE composition time. The lock's `scenes[].start` is the single source
of truth, with the two derived layers playing different roles: the clip's
`data-start`/`data-duration` are the ENVELOPE (it must comfortably ENCLOSE
every tween targeting the scene, and may pad past the lock duration for a
transition), while reveal/motion tweens sit at chosen offsets INSIDE it.
They are not supposed to be byte-equal (the reference deliberately reveals
terminal-scene 1.2s after its envelope opens). The silent failure mode is a
tween that lands OUTSIDE its clip's envelope window.

Per effect class (see the translation table below for the full inventory;
counts re-verified against all 79 effects on 2026-06-06):

- **TL-RETURN** (38 effects, 4 of which return INFINITE timelines): rebuild
  the effect's timeline with a local
  factory (the same code replay() runs), then `tl.add(effectTl, sceneStart)`.
  gsap nests timelines natively; the child seeks with the parent.
- **GSAP-NO-RETURN** (34 effects): the tweens are already gsap; re-anchor
  each as `tl.to(target, {...}, sceneStart + localOffset)` where localOffset
  is the tween's delay/position in the original replay. Rest-state
  `gsap.set(...)` calls become `tl.set(..., sceneStart)` (or inline styles).
- **TIMER / MIXED / RAF** (7 effects): de-timer per the recipes below.

Replace `delay:` properties with timeline positions while translating: a
bare `gsap.to(x, {delay: 0.25, ...})` becomes `tl.to(x, {...}, start + 0.25)`.
Keep every duration/ease/stagger value byte-identical.

Two pieces of canonical replay code are RUNTIME PLUMBING, not motion, and
are dropped at restage: (a) the `gsap.killTweensOf(...)` / kill-previous-
timeline guards at the top of replay (re-run safety the composition never
needs), and (b) trailing rest-reset `.set()` calls that restore the idle
state after the motion completes (dashboard loop hygiene). Scenes hold
their final state instead.

### 3. Place and rescale

The effect was authored on a 360x240 stage; the scene is a region of the
lock's stage (1920x1080 in the examples below). Two placement modes:

- **Hero (full-frame)**: the effect IS the scene. Scale factor
  stageHeight/240 (1080/240 = 4.5x for the default stage): multiply px font
  sizes, paddings, fixed widths. Vector/text effects
  scale cleanly (a stated design goal of the canonical stage); after
  multiplying, eyeball borders/blurs/shadows, they often want less than 4.5x.
- **Element (region)**: the effect is one element among several. Keep values
  near-canonical and position its wrapper absolutely in the frame
  (`position:absolute` + explicit placement). Negative space is the default;
  a 1920x1080 frame holding a 400px-wide element is a composition choice,
  not a bug.

Scene wrappers follow the dialect: `position:absolute; inset:0` containers,
flex for centering, explicit `z-index` where layers stack.

### 4. Re-token

Map effect colors/fonts to the lock: hardcoded hex from the canonical CSS →
the lock's `palette.tokens` custom properties; font families → the lock's
`typography.roles`. The canonical library uses the anima token family
(`effects/_base.css`), so s0nderlabs projects mostly re-point names. Bans
(`palette.bans`, `typography.banned`) are checked here.

### 5. Bind vars

`scenes[].effects[].vars` values are BAKED into the restaged code as
resolved literals (the per-use override made permanent in the artifact).
Annotate with a comment trail: `/* vars: text="make me a launch video" */`.
Defaults not overridden come from `meta.variables`.

### 6. De-timer (only the 7 listed below)

Wall-clock timers cannot be frame-seeked: under seek-based rendering a
`setInterval` effect is a frozen frame. Convert the timer schedule into
timeline keyframes; same visuals, frame-exact.

## Hard rules for the generated composition

- **IDs on everything timed**: every clip, every animated element a tween
  targets, and EVERY `<audio>` element (lint `media_missing_id`: an audio
  clip without an id renders SILENT, and the error does not block render).
- **Visibility is timeline-driven.** Root-level scene blocks carry
  `class="clip" data-start data-duration data-track-index` for the
  envelope, AND inline `opacity:0` with explicit `tl.to(scene, {opacity:1},
  start)` / `tl.to(scene, {opacity:0}, end - fade)` reveals - this is the
  reference's own root-scene pattern (all anima root scenes do both). The
  clip envelope alone sticks on scrub (HyperFrames Studio caches it at
  load); master-driven opacity is the cross-environment truth. EXCEPTION:
  when sub-composition WRAPPERS arrive (v2+), they DROP the `clip` class
  entirely and run on master-driven opacity alone - the reference's tg-wrap
  fix, because the envelope tracker left iframe-loaded wrappers stuck at
  visibility:hidden.
- **Track allocation**: track-index is BOTH z-order (higher composites on
  top) and a temporal-exclusivity lane (same-track temporal overlap is a
  lint ERROR causing render conflicts). Allocate: content scenes on tracks
  0..N in order; overlapping/crossfading scenes on different tracks;
  connective bridges on their own lane; audio on high lanes (anima: bed=9,
  one-shots=7, blips=8).
- **No infinite repeats reachable from the master timeline.** A nested
  `repeat:-1` makes `duration()` Infinity and breaks scrub/render math.
  Ambient loops become FINITE repeats covering their scene window:
  `repeat: Math.ceil(sceneDuration / loopDuration)`, added at the scene
  start. (This also replaces CSS infinite animations: a CSS `animation:
  spin 0.7s infinite` becomes a finite `tl.to(el, {rotation: 360 * n,
  duration: 0.7 * n, ease: "none"}, start)`.)
- **Scenes hold their final state** until their clip window ends; no exit
  animations except the final scene (unless the lock's motion principles say
  otherwise).
- **Audio**: only `status: "locked"` tracks from the lock are wired, as
  `<audio class="clip" id="...">` with `src`, `data-start`, `data-duration`,
  `data-track-index`, `data-volume`. tbd tracks render silent by design.
- **Embedded `<video>` driven by the timeline** (a full-bleed product-demo
  cut, not an effect): seek its `currentTime` from the master playhead inside
  an `onUpdate` (`tl.to(proxy,{t:dur,ease:"none",onUpdate(){ if(!PREVIEW)
  video.currentTime=proxy.t }},start)`), gated on `!PREVIEW` - in the dashboard
  iframe play the video natively + drift-correct instead, because seeking it
  60x/s lags the live Preview. Such a composition MUST render with
  `--engine own-parallel`: it loads the page over `file://` (same-origin to a
  `file://` video src, which hyperframes' http server would BLOCK) and waits
  for each frame's `seeked` before capturing (hyperframes has no seeked-wait
  and tears the video). The own engines are video-only, so mux the locked
  audio after (SKILL.md creation step 7).

## De-timer recipes (the 7 wall-clock effects)

From the full-library motion inventory (2026-06-06). Each conversion
preserves the exact visual schedule.

1. **chat-input-typing** (setInterval 45ms/speed char reveal): per char i,
   `tl.set(textEl, {textContent: msg.slice(0, i + 1)}, start + (i + 1) * 0.045 / speed)`.
   Note the `(i + 1)`: setInterval fires its FIRST callback after one full
   interval, so char 0 lands at 45ms, not 0. Keep the `/speed` divide (the
   effect's documented speed mechanism).
2. **chat-conversation** (setTimeout 1200ms + setInterval 25ms jittered
   streaming): the char-step jitter is already a deterministic seeded hash,
   so precompute the chunk schedule and emit
   `tl.set(resp, {innerHTML: partial(n)}, streamStart + cumTime)` per chunk;
   the existing gsap fades fold in at their delays.
3. **value-flip** (setTimeout staggered text swaps + flash class): TWO
   waves, each with its own non-sequential row order. Wave 1 (order
   [2,0,3,1]) swaps initial -> after at `0.8 + step * 0.38`; wave 2 (order
   [1,3,0,2]) REVERTS after -> initial at `3.4 + step * 0.38`. Per swap,
   `tl.set(el, {textContent: value}, t)` and the flash as a real tween
   (`tl.fromTo(row, {...flash-on...}, {...flash-off..., duration: 0.65}, t)`)
   instead of class toggles. Dropping the revert wave loses half the effect.
4. **color-text-swap** (4 setTimeout steps at 0.9/2.6/4.3/6.0s): each step's
   color tweens are already gsap, anchor them at those positions; text via
   `tl.set`. ALSO: it reads CSS vars off `document.documentElement`; resolve
   the two colors into locals at build time (the host composition's :root
   differs from the dashboard's).
5. **spinner-to-dot** (setTimeout status swaps + CSS infinite spinner): row
   entrances are already gsap (keep); each status swap becomes
   `tl.set(status, {innerHTML: ...}, 1.2 + i * 0.4)`; the CSS spinner
   becomes a finite rotation tween ending exactly at its swap time.
6. **playful-spinner-verb** (gsap counter + setTimeout cycle loop): the
   counter tween folds in as-is, but note the canonical replay shows a
   350ms resting-state preroll (the stale 4s/2.1k meta) before the counter
   resets and climbs - keep it. The line→result swap anchors at +3.5s; the
   ambient spark spin becomes a finite repeat covering the scene window;
   drop the 5.2s re-cycle (a scene plays one cycle unless the storyboard
   says loop).
7. **braille-spinner** (RAF loop on performance.now - the library's one hard
   determinism violation): 8s cycle as keyframes: braille glyph
   `tl.set(sp, {textContent: BRAILLE[f % 10]}, start + f * 0.08)` for
   f = 0..N over the scene window, plus per-second counter sets. (Flagged
   for a canonical-library fix too; until then restage owns it.)

Also: `tl.call()` callbacks fire on forward playback only and are unreliable
under reverse-seek scrub. Anything visible a `.call()` would do becomes a
`tl.set()` keyframe (known case: per-char-event-emit's counter).

## Translation table notes (per-effect gotchas)

- 4 effects return INFINITE timelines (pixel-mascot-idle-bob,
  goal-active-timer-badge, morphing-node-graph, focus-band-carousel):
  rebuild with finite repeat counts at restage (mascot-pose-turn's separate-
  ambient pattern is the model, but in compositions even the ambient becomes
  a finite repeat). morphing-node-graph ADDITIONALLY keeps repeat:-1 wobble
  tweens outside its returned tl - both layers need the finite conversion.
- auto-scroll-to-fit is flagged `scrubbable: true` but its replay returns
  NO TIMELINE - the motion is real (a bare `gsap.to(s, {y: -78, duration:
  1.2, delay: 0.3})`), it just is not returned. Translate it via the
  GSAP-NO-RETURN route. General rule: trust the actual return statement
  over the meta flag when picking the translation route.
- dolly-zoom's one-shot rAF origin-measure must become a synchronous measure
  inside `document.fonts.ready.then(...)` (no rAF rule).
- Effects with `repeat:-1` ambients kept OUTSIDE their returned tl
  (status-cycle, lasso-twirl-throw-capture, globe-rotate-flightpaths,
  agent-to-agent-pipe, mascot-pose-turn): in a composition those ambients
  join the master as finite repeats. status-cycle ARMS its ambients via
  `tl.call(startShimmer/...)` - apply BOTH conversions there (finite repeat
  AND call-to-keyframe), or the ambients vanish under scrub.

## Verification per restage (every scene, no exceptions)

1. `npx --yes hyperframes@0.6.7 lint` clean of ERRORs (warnings reviewed).
2. `npx --yes hyperframes@0.6.7 inspect` for overflow issues - BEST EFFORT:
   as of 2026-06-06 inspect crashes with `Cannot read properties of
   undefined (reading 'totalDuration')` on BOTH 0.6.7 and 0.6.75, including
   on the proven anima-launch project, so a crash there is tool breakage,
   not a composition defect. Lint + render + lumiere-watch carry the gate.
3. Visual: preview the composition (preview server or dashboard preview
   pane), eyeball each scene at 2-3 scrub positions. NOTE: the dashboard
   preview pane and lumiere's own renderer drive `__timelines.main` only;
   sub-composition children would need the disarm/sync scaffold (v2+).
4. Motion fidelity: render via the stable entry point
   (`bun <lumiere>/bin/lumiere-render.mjs <project-dir>`, engine
   `hyperframes` by default, `--engine own` for lumiere's pipeline) and
   `lumiere watch` the result with judge criteria derived from the canonical
   effect's behavior (lumiere watching lumiere). For reference-derived
   effects the criteria come from the OG beat sheet.

## Related

- [`LOCK.md`](./LOCK.md) - the lock file that declares what to restage
- [`../effects/FORMAT.md`](../effects/FORMAT.md) - the canonical effect
  format being consumed
- anima-launch (`~/Documents/s0nderlabs/anima-launch/`) - the proven dialect
  reference this template derives from
