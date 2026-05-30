/* ============================================================
   lumiere · motion library — effect registry
   ------------------------------------------------------------
   Conventions:
   - Each effect's init(card) is called ONCE during render. It must
     leave the card in a CONTENTFUL resting state (no blank cards).
   - init returns replay() which animates from rest → motion → rest.
     For one-shot patterns, replay leaves the card in the natural end
     state (which IS the resting state).
   - Demos use contextual scenes, not "scene A / row 1" placeholders.
   ============================================================ */

const BRAILLE = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"]

function spanChars(el) {
  const text = el.textContent
  el.innerHTML = ""
  const spans = []
  for (const ch of text) {
    const s = document.createElement("span")
    s.className = "char"
    s.textContent = ch === " " ? " " : ch
    s.style.display = "inline-block"
    el.appendChild(s)
    spans.push(s)
  }
  return spans
}

function splitWords(el) {
  const text = el.textContent
  el.innerHTML = text
    .split(" ")
    .map(w => `<span class="bl-word" style="display:inline-block;margin-right:.25em">${w}</span>`)
    .join(" ")
  return el.querySelectorAll(".bl-word")
}

window.LUMIERE_EFFECTS = [

  /* ============================================================
     CAMERA / SPATIAL (5)
     ============================================================ */

  {
    id: "dolly-zoom", cat: "Camera", display: "Dolly Zoom",
    source: ["claude-code-agent-view","claude-code-push-notifications"],
    desc: "Camera dives through the wordmark's focal letter; the next scene emerges from the cream tunnel inside. Anima PRAGMA-style transition: scale 1 → 80 over 2.0s power4.inOut, transform-origin computed at runtime from the m letter's left-bowl bbox.",
    html: `<div class='vp-stage dz-stage'>
      <div class='dz-terminal' data-dz='terminal' aria-hidden='true'>
        <div class='dz-term-chrome'>
          <span class='dz-tl r'></span>
          <span class='dz-tl y'></span>
          <span class='dz-tl g'></span>
        </div>
        <div class='dz-term-body'>
          <div class='dz-term-line'>
            <span class='dz-prompt'>$</span>
            <span class='dz-cmd'>lumiere</span>
            <span class='dz-arg'>ready</span>
            <span class='dz-ok'>&#10003;</span>
          </div>
          <div class='dz-term-line dz-dim'>
            <span class='dz-bullet'>&#9655;</span>
            <span>v0.11.5  &middot;  37 effects loaded</span>
          </div>
          <div class='dz-term-line dz-faint'>
            <span class='dz-bullet'>&#9655;</span>
            <span>cache hit  &middot;  ~/.lumiere/sessions</span>
          </div>
        </div>
      </div>
      <div class='dz-mark' data-dz='mark'>
        <div class='dz-word' data-dz='word'>
          <span class='dz-ch'>l</span><span class='dz-ch'>u</span><span class='dz-ch dz-m' data-dz='m'>m</span><span class='dz-ch'>i</span><span class='dz-ch'>e</span><span class='dz-ch'>r</span><span class='dz-ch'>e</span>
        </div>
        <div class='dz-tagline' data-dz='tagline'>ships today.</div>
      </div>
    </div>`,
    init(card) {
      const mark     = card.querySelector('[data-dz="mark"]')
      const word     = card.querySelector('[data-dz="word"]')
      const mLetter  = card.querySelector('[data-dz="m"]')
      const tagline  = card.querySelector('[data-dz="tagline"]')
      const terminal = card.querySelector('[data-dz="terminal"]')

      let computedOrigin = '38% 58%'

      function recomputeOrigin() {
        const wb = word.getBoundingClientRect()
        const mb = mLetter.getBoundingClientRect()
        if (wb.width === 0 || mb.width === 0) return
        const cx = (mb.left + mb.width * 0.28 - wb.left) / wb.width
        const cy = (mb.top  + mb.height * 0.62 - wb.top)  / wb.height
        computedOrigin = (cx * 100).toFixed(2) + '% ' + (cy * 100).toFixed(2) + '%'
      }

      function applyIdle() {
        gsap.set(mark,     { opacity: 1 })
        gsap.set(word,     { scale: 1, transformOrigin: computedOrigin, force3D: true })
        gsap.set(tagline,  { opacity: 1, y: 0 })
        gsap.set(terminal, { opacity: 0, xPercent: -50, yPercent: -50, scale: 0.94 })
      }
      applyIdle()
      requestAnimationFrame(() => { recomputeOrigin(); applyIdle() })
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => { recomputeOrigin(); applyIdle() })
      }

      let tl = null

      return function replay() {
        if (tl) { tl.kill(); tl = null }
        recomputeOrigin()
        applyIdle()

        tl = gsap.timeline({ defaults: { lazy: false, force3D: true } })
        tl.from(tagline, { opacity: 0, y: 4, duration: 0.4, ease: 'power2.out' }, 0.05)
        tl.to(word,    { scale: 80, duration: 2.0, ease: 'power4.inOut' }, 0.45)
        tl.to(tagline, { opacity: 0, y: -6, duration: 0.45, ease: 'power2.in' }, 0.45)
        tl.to(mark,    { opacity: 0, duration: 0.5, ease: 'power2.in' }, 1.7)
        tl.to(terminal, { opacity: 1, duration: 0.5, ease: 'power2.out' }, 1.7)
          .to(terminal, { scale: 1.0, duration: 0.6, ease: 'power3.out' }, 1.7)
        tl.to({}, { duration: 1.1 }, 2.3)
        tl.set(terminal, { opacity: 0, scale: 0.94, xPercent: -50, yPercent: -50 }, 3.5)
        tl.set(word,     { scale: 1, transformOrigin: computedOrigin }, 3.5)
        tl.set(mark,     { opacity: 1 }, 3.5)
        tl.set(tagline,  { opacity: 1, y: 0 }, 3.5)
      }
    }
  },

  {
    id: "cross-dissolve", cat: "Camera", display: "Cross Dissolve",
    source: ["claude-code-goal","claude-code-ultrareview","claude-financial-services"],
    desc: "Two scenes overlap with opposite opacity tweens. Soft transition between equal-weight beats.",
    html: `<div class='vp-stage'>
      <div style='position:relative;width:80%;height:170px'>
        <div data-a class='scene-mock scene-a'>
          <div class='scene-tag'>scene 01</div>
          <div class='scene-body'>› terminal awaits input</div>
        </div>
        <div data-b class='scene-mock scene-b' style='opacity:0'>
          <div class='scene-tag'>scene 02</div>
          <div class='scene-body'>↳ dashboard reveal</div>
        </div>
      </div>
    </div>`,
    init(card) {
      const a = card.querySelector("[data-a]")
      const b = card.querySelector("[data-b]")
      gsap.set(a, { opacity: 1 })
      gsap.set(b, { opacity: 0 })
      return () => {
        gsap.killTweensOf([a, b])
        gsap.set(a, { opacity: 1 })
        gsap.set(b, { opacity: 0 })
        const tl = gsap.timeline()
        /* slow the overlap so the cross IS the moment, not a quick swap */
        tl.to(a, { opacity: 0, duration: 0.7, ease: "sine.inOut" }, 0.7)
        tl.to(b, { opacity: 1, duration: 0.7, ease: "sine.inOut" }, 0.7)
        tl.to(b, { opacity: 0, duration: 0.7, ease: "sine.inOut" }, "+=1.5")
        tl.to(a, { opacity: 1, duration: 0.7, ease: "sine.inOut" }, "<")
      }
    }
  },

  {
    id: "lift-and-scale", cat: "Camera", display: "Lift and Scale",
    source: ["claude-code-fast-mode","claude-code-goal","claude-code-agent-view","claude-code-ultrareview","claude-financial-services"],
    desc: "Default entrance for any panel, card, or modal. Y-lift from below plus a subtle scale-up. Weighty enough to feel intentional, not just a fade.",
    html: `<div class='vp-stage'><div class='receipt' data-lift>
      <div class='receipt-label'>proof</div>
      <div class='receipt-hash'>0xa7c2…34af</div>
      <div class='receipt-row'>
        <span class='receipt-k'>block</span>
        <span class='receipt-v'>18,433,221</span>
      </div>
    </div></div>`,
    init(card) {
      const t = card.querySelector("[data-lift]")
      gsap.set(t, { opacity: 1, y: 0, scale: 1 })
      return () => {
        gsap.killTweensOf(t)
        gsap.fromTo(
          t,
          { opacity: 0, y: 56, scale: 0.9, transformOrigin: "50% 100%" },
          { opacity: 1, y: 0, scale: 1, duration: 0.95, ease: "expo.out", delay: 0.2, immediateRender: false }
        )
      }
    }
  },

  {
    id: "auto-scroll-to-fit", cat: "Camera", display: "Auto-Scroll to Fit",
    source: ["claude-code-session-recaps"],
    desc: "Container scrolls so newest line stays in frame. Uses offsetTop so parent transforms can't corrupt it.",
    html: `<div class='vp-stage'><div class='scroll-frame'>
      <div data-scroll class='scroll-inner'>
        <div class='row-line'><span class='dotcol'></span>@init · ok</div>
        <div class='row-line'><span class='dotcol'></span>@brain · loaded</div>
        <div class='row-line'><span class='dotcol'></span>@ledger · synced</div>
        <div class='row-line'><span class='dotcol'></span>@sigs · ok</div>
        <div class='row-line'><span class='dotcol'></span>@subname · resolved</div>
        <div class='row-line'><span class='dotcol'></span>@mint · ready</div>
        <div class='row-line'><span class='dotcol'></span>@verify · pass</div>
        <div class='row-line'><span class='dotcol'></span>@publish · ok</div>
        <div class='row-line now'><span class='dotcol'></span>→ ready</div>
      </div>
    </div></div>`,
    init(card) {
      const s = card.querySelector("[data-scroll]")
      gsap.set(s, { y: -78 })
      return () => {
        gsap.killTweensOf(s)
        gsap.set(s, { y: 0 })
        gsap.to(s, { y: -78, duration: 1.2, ease: "power2.out", delay: 0.3 })
      }
    }
  },

  {
    id: "smash-cut", cat: "Camera", display: "Smash Cut",
    source: ["claude-code-fast-mode","claude-code-agent-view","claude-financial-services"],
    desc: "Hard transition with a single-frame flash to land the impact. Beats fall before and after the cut, never during.",
    html: `<div class='vp-stage'>
      <div style='position:relative;width:80%;height:170px'>
        <div data-old class='scene-mock scene-a'>
          <div class='scene-tag'>before</div>
          <div class='scene-body'>$ analyzing reference…</div>
        </div>
        <div data-new class='scene-mock scene-warm' style='opacity:0'>
          <div class='scene-tag'>after</div>
          <div class='scene-body'>✓ 0xa7…34af · proof landed</div>
        </div>
        <div data-flash class='cut-flash'></div>
      </div>
    </div>`,
    init(card) {
      const o = card.querySelector("[data-old]")
      const n = card.querySelector("[data-new]")
      const f = card.querySelector("[data-flash]")
      gsap.set(o, { opacity: 1 })
      gsap.set(n, { opacity: 0 })
      gsap.set(f, { opacity: 0 })
      return () => {
        gsap.killTweensOf([o, n, f])
        gsap.set(o, { opacity: 1 })
        gsap.set(n, { opacity: 0 })
        gsap.set(f, { opacity: 0 })
        const tl = gsap.timeline({ delay: 0.7 })
        /* A → flash → B */
        tl.to(f, { opacity: 0.85, duration: 0.05, ease: "none" })
        tl.set(o, { opacity: 0 })
        tl.set(n, { opacity: 1 })
        tl.to(f, { opacity: 0, duration: 0.18, ease: "power2.out" })
        /* hold B, then B → flash → A */
        tl.to(f, { opacity: 0.85, duration: 0.05, ease: "none" }, "+=1.4")
        tl.set(n, { opacity: 0 })
        tl.set(o, { opacity: 1 })
        tl.to(f, { opacity: 0, duration: 0.18, ease: "power2.out" })
      }
    }
  },

  /* ============================================================
     REVEAL PATTERNS (3)
     ============================================================ */

  {
    id: "decelerated-stream", cat: "Reveal", display: "Decelerated Stream",
    source: ["anima-launch"],
    desc: "Lines blast in at high cadence then decelerate to a steady finish. Reads as load + settle.",
    html: `<div class='vp-stage'><div data-stream class='stream-frame'></div></div>`,
    init(card) {
      const cont = card.querySelector("[data-stream]")
      const lines = [
        "@clack:0 init",
        "@clack:1 brain · ok",
        "@clack:2 ledger · ok",
        "@clack:3 sigs · ok",
        "@clack:4 subname · ok",
        "@clack:5 mint · ok",
        "@clack:6 cache · ok",
        "@clack:7 wallet · ok",
        "@clack:8 manifest · ok",
        "@clack:9 verify · ok",
        "@clack:10 publish · ok",
        "@clack:11 → ready ✓"
      ]
      cont.innerHTML = lines.map(t => `<div class='sline'>${t}</div>`).join("")
      const els = cont.querySelectorAll(".sline")
      /* idle: all visible (end state of the stream) */
      gsap.set(els, { opacity: 1, y: 0 })
      return () => {
        gsap.killTweensOf(els)
        /* start hidden — stream them IN one by one */
        gsap.set(els, { opacity: 0, y: 4 })
        const tl = gsap.timeline()
        els.forEach((el, i) => {
          /* first 9 lines blast in fast (0.06s gaps), last 3 decelerate (0.22s gaps) */
          const t = i < 9 ? i * 0.06 : 0.54 + (i - 9) * 0.22
          tl.to(el, { opacity: 1, y: 0, duration: 0.18, ease: "power2.out" }, t)
        })
      }
    }
  },

  {
    id: "asymmetric-scatter", cat: "Reveal", display: "Asymmetric Scatter",
    source: ["anima-launch"],
    desc: "Multiple elements emerge with individual rotation and stagger. Hand-arranged composition, never a grid.",
    html: `<div class='stack'>
      <div class='mini-card' data-c='0' style='left:6%;top:14%'><span class='lbl'>identity</span><span class='val'>anima.id</span></div>
      <div class='mini-card' data-c='1' style='left:50%;top:8%'><span class='lbl'>brain</span><span class='val'>memory</span></div>
      <div class='mini-card' data-c='2' style='left:2%;top:58%'><span class='lbl'>balance</span><span class='val'>$0.62</span></div>
      <div class='mini-card' data-c='3' style='left:34%;top:64%'><span class='lbl'>signal</span><span class='val'>3 channels</span></div>
      <div class='mini-card' data-c='4' style='left:62%;top:44%'><span class='lbl'>sandbox</span><span class='val'>vm-warm</span></div>
    </div>`,
    init(card) {
      const cards = card.querySelectorAll("[data-c]")
      const stack = card.querySelector(".stack")
      const rots = [+2, -2, +3, -3, -2]
      const settle = () => cards.forEach((c, i) => gsap.set(c, { x: 0, y: 0, scale: 0.92, rotation: rots[i], opacity: 1 }))
      settle()
      return () => {
        gsap.killTweensOf(cards)
        /* compute center offset per card so they spawn FROM center */
        const sr = stack.getBoundingClientRect()
        const cx = sr.width / 2, cy = sr.height / 2
        cards.forEach((c, i) => {
          const cr = c.getBoundingClientRect()
          const dx = cx - (cr.left - sr.left + cr.width / 2)
          const dy = cy - (cr.top - sr.top + cr.height / 2)
          gsap.fromTo(c,
            { x: dx, y: dy, scale: 0.92 * 0.5, opacity: 0, rotation: rots[i] - 8 },
            { x: 0, y: 0, scale: 0.92, opacity: 1, rotation: rots[i],
              duration: 0.78, ease: "back.out(1.55)", delay: i * 0.17 }
          )
        })
      }
    }
  },

  {
    id: "vortex-collapse", cat: "Reveal", display: "Vortex Collapse",
    source: ["anima-launch"],
    desc: "All elements drift toward a shared origin and fade. Sweep N elements out before a hard scene change.",
    html: `<div class='stack'>
      <div class='mini-card' data-v='0' style='left:6%;top:14%'><span class='lbl'>identity</span><span class='val'>anima.id</span></div>
      <div class='mini-card' data-v='1' style='left:50%;top:8%'><span class='lbl'>brain</span><span class='val'>memory</span></div>
      <div class='mini-card' data-v='2' style='left:2%;top:58%'><span class='lbl'>balance</span><span class='val'>$0.62</span></div>
      <div class='mini-card' data-v='3' style='left:34%;top:64%'><span class='lbl'>signal</span><span class='val'>3 channels</span></div>
      <div class='mini-card' data-v='4' style='left:62%;top:44%'><span class='lbl'>sandbox</span><span class='val'>vm-warm</span></div>
    </div>`,
    init(card) {
      const cards = card.querySelectorAll("[data-v]")
      const drifts = [{ dx: 80, dy: 50 }, { dx: -20, dy: 60 }, { dx: 90, dy: -20 }, { dx: -15, dy: -25 }, { dx: -50, dy: -10 }]
      const rots = [+2, -2, +3, -3, -2]
      const settle = () => cards.forEach((c, i) => gsap.set(c, { x: 0, y: 0, scale: 0.92, rotation: rots[i], opacity: 1 }))
      settle()
      return () => {
        gsap.killTweensOf(cards)
        settle()
        const tl = gsap.timeline()
        cards.forEach((c, i) => {
          tl.to(c, { x: drifts[i].dx, y: drifts[i].dy, scale: 0.18, opacity: 0, duration: 1.05, ease: "power3.in" }, 0.4)
        })
        tl.call(() => settle(), null, "+=0.5")
      }
    }
  },

  /* ============================================================
     TEXT-SPECIFIC (7)
     ============================================================ */

  {
    id: "char-cascade", cat: "Text", display: "Character Cascade",
    source: ["anima-launch"],
    desc: "Per-character rise with linear stagger. Signature opening for any display headline.",
    html: `<div class='vp-stage'><div class='text-l char-span' data-cc>Introducing.</div></div>`,
    init(card) {
      const el = card.querySelector("[data-cc]")
      const spans = spanChars(el)
      gsap.set(spans, { opacity: 1, y: 0 })
      return () => {
        gsap.killTweensOf(spans)
        gsap.set(spans, { opacity: 0, y: 22 })
        gsap.to(spans, { opacity: 1, y: 0, duration: 0.4, ease: "expo.out", stagger: 0.035, delay: 0.25 })
      }
    }
  },

  {
    id: "wordmark-rise", cat: "Text", display: "Wordmark Rise",
    source: ["claude-code-agent-view","claude-code-push-notifications"],
    desc: "Per-character rise with larger y-distance and slower stagger. For brand moments that need weight.",
    html: `<div class='vp-stage'><div class='wm-mid char-span' data-wm>lumiere</div></div>`,
    init(card) {
      const el = card.querySelector("[data-wm]")
      const spans = spanChars(el)
      gsap.set(spans, { opacity: 1, y: 0 })
      return () => {
        gsap.killTweensOf(spans)
        gsap.set(spans, { opacity: 0, y: 60 })
        gsap.to(spans, { opacity: 1, y: 0, duration: 0.7, ease: "expo.out", stagger: 0.07, delay: 0.25 })
      }
    }
  },

  {
    id: "typewriter-flip", cat: "Text", display: "Typewriter Flip",
    source: ["claude-code-agent-view","claude-code-push-notifications"],
    desc: "Per-character display flip from none to inline-block. Reverse-scrub safe. Best for CLI, code, anywhere layout stability matters. Real terminal scene with traffic lights + zsh title.",
    html: `<div class='tf-stage'>
      <div class='tf-terminal' data-tf-root>
        <div class='tf-chrome'>
          <span class='tf-light tf-red'></span>
          <span class='tf-light tf-yellow'></span>
          <span class='tf-light tf-green'></span>
          <span class='tf-title'>~/lumiere &middot; zsh</span>
        </div>
        <div class='tf-body'>
          <div class='tf-line'>
            <span class='tf-prompt'>&gt;</span><span class='tf-cmd' data-tf-cmd></span><span class='tf-caret' data-tf-caret></span>
          </div>
          <div class='tf-line tf-meta' data-tf-meta>~ lumiere &middot; ready</div>
        </div>
      </div>
    </div>`,
    init(card) {
      const cmd   = card.querySelector('[data-tf-cmd]')
      const caret = card.querySelector('[data-tf-caret]')
      const meta  = card.querySelector('[data-tf-meta]')
      const TEXT  = 'bun add @s0nderlabs/lumiere'
      const STEP  = 0.085

      if (!cmd.dataset.split) {
        cmd.innerHTML = TEXT.split('').map(c =>
          `<span class="tf-char">${c === ' ' ? '&nbsp;' : c}</span>`
        ).join('')
        cmd.dataset.split = '1'
      }
      const chars = cmd.querySelectorAll('.tf-char')

      chars.forEach(c => gsap.set(c, { display: 'inline-block' }))
      gsap.set(caret, { opacity: 1 })
      gsap.set(meta,  { opacity: 1 })

      let tl = null
      return function replay() {
        if (tl) { tl.kill(); tl = null }

        chars.forEach(c => gsap.set(c, { display: 'none' }))
        gsap.set(caret, { opacity: 1 })
        gsap.set(meta,  { opacity: 0 })

        const start = 0.18
        tl = gsap.timeline()
        chars.forEach((c, i) => {
          tl.set(c, { display: 'inline-block' }, start + i * STEP)
        })
        const done = start + chars.length * STEP + 0.18
        tl.to(caret, { opacity: 0, duration: 0.22, ease: 'power1.out' }, done)
        tl.to(meta,  { opacity: 1, duration: 0.35, ease: 'power2.out' }, done + 0.10)
        tl.set(caret, { opacity: 1 }, done + 0.22 + 0.55)
      }
    }
  },

  {
    id: "word-rise", cat: "Text", display: "Word-by-Word Rise",
    source: ["claude-financial-services"],
    desc: "Per-word lift with longer stagger. Each word lands as its own beat.",
    html: `<div class='vp-stage'><div class='bridge-line' data-wr>everything is happening on chain.</div></div>`,
    init(card) {
      const el = card.querySelector("[data-wr]")
      const words = splitWords(el)
      gsap.set(words, { opacity: 1, y: 0 })
      return () => {
        gsap.killTweensOf(words)
        gsap.set(words, { opacity: 0, y: 22 })
        gsap.to(words, { opacity: 1, y: 0, duration: 0.55, ease: "expo.out", stagger: 0.25, delay: 0.2 })
      }
    }
  },

  {
    id: "kinetic-swap", cat: "Text", display: "Kinetic Swap",
    source: ["anima-launch"],
    desc: "Three phrases stack at one anchor and swap with blur-clear rise. Bridge sequence between scenes; final phrase HOLDS as the end state. Mirrors anima-launch's revealLine (lines 2547-2592) with identical constants.",
    html: `<div class='vp-stage ks-stage'>
      <div class='ks-anchor'>
        <div class='ks-line' data-ks='1'>
          <span class='ks-word'>scaffolding</span><span class='ks-word'>&nbsp;takes</span><span class='ks-word'>&nbsp;weeks.</span>
        </div>
        <div class='ks-line' data-ks='2'>
          <span class='ks-word'>lumiere</span><span class='ks-word'>&nbsp;collapses</span><span class='ks-word'>&nbsp;the</span><span class='ks-word'>&nbsp;loop.</span>
        </div>
        <div class='ks-line' data-ks='3'>
          <span class='ks-word'>ship</span><span class='ks-word'>&nbsp;a</span><span class='ks-word'>&nbsp;launch</span><span class='ks-word'>&nbsp;video</span><span class='ks-word'>&nbsp;today.</span>
        </div>
      </div>
    </div>`,
    init(card) {
      const stage = card.querySelector('.ks-stage')
      const lines = stage.querySelectorAll('.ks-line')
      const wordsOf = (i) => stage.querySelectorAll(`.ks-line[data-ks="${i}"] .ks-word`)

      const ENTER_DUR = 0.5
      const STAGGER = 0.055
      const EXIT_DUR = 0.4
      const HOLD_PREMISE = 0.85
      const HOLD_PUNCH = 1.30
      const GAP = 0.05

      let tl

      const setIdle = () => {
        gsap.set(lines[0], { opacity: 1, y: 0 })
        gsap.set(wordsOf(1), { opacity: 1, y: 0, filter: 'blur(0px)' })
        for (let i = 1; i < lines.length; i++) {
          gsap.set(lines[i], { opacity: 0, y: 0 })
          gsap.set(wordsOf(i + 1), { opacity: 0, y: 32, filter: 'blur(8px)' })
        }
      }
      setIdle()

      const revealLine = (timeline, idx, t, holdDur) => {
        const lineEl = lines[idx - 1]
        const words = wordsOf(idx)
        timeline.set(lineEl, { opacity: 1, y: 0 }, t)
        timeline.fromTo(words,
          { opacity: 0, y: 32, filter: 'blur(8px)' },
          { opacity: 1, y: 0, filter: 'blur(0px)',
            duration: ENTER_DUR, ease: 'expo.out', stagger: STAGGER },
          t)
        const enterEnd = t + ENTER_DUR + STAGGER * (words.length - 1)
        const exitAt = enterEnd + holdDur
        timeline.to(lineEl, { opacity: 0, y: -36, duration: EXIT_DUR, ease: 'power2.in' }, exitAt)
        return exitAt + EXIT_DUR
      }

      const revealFinal = (timeline, idx, t, holdDur) => {
        /* punchline: same enter, NO exit — anima ends the bridge here */
        const lineEl = lines[idx - 1]
        const words = wordsOf(idx)
        timeline.set(lineEl, { opacity: 1, y: 0 }, t)
        timeline.fromTo(words,
          { opacity: 0, y: 32, filter: 'blur(8px)' },
          { opacity: 1, y: 0, filter: 'blur(0px)',
            duration: ENTER_DUR, ease: 'expo.out', stagger: STAGGER },
          t)
        const enterEnd = t + ENTER_DUR + STAGGER * (words.length - 1)
        return enterEnd + holdDur
      }

      return function play() {
        if (tl) { tl.kill(); tl = null }
        gsap.set(lines[0], { opacity: 1, y: 0 })
        gsap.set(wordsOf(1), { opacity: 0, y: 32, filter: 'blur(8px)' })
        for (let i = 1; i < lines.length; i++) {
          gsap.set(lines[i], { opacity: 0, y: 0 })
          gsap.set(wordsOf(i + 1), { opacity: 0, y: 32, filter: 'blur(8px)' })
        }

        tl = gsap.timeline()
        const t0 = 0.15
        const line1End = revealLine(tl, 1, t0, HOLD_PREMISE)
        const line2End = revealLine(tl, 2, line1End + GAP, HOLD_PREMISE)
        revealFinal(tl, 3, line2End + GAP, HOLD_PUNCH)
      }
    }
  },

  {
    id: "blur-clear-rise", cat: "Text", display: "Blur-Clear Rise",
    source: ["claude-code-agent-view"],
    desc: "Multi-line text clears from 8px blur as it lifts. Manifesto pacing, longer rest between lines.",
    html: `<div class='vp-stage'><div class='manifesto-stack'>
      <div class='manifesto-line bl-line'>writing the brief is the hard part.</div>
      <div class='manifesto-line bl-line'>scaffolding is the easy part.</div>
      <div class='manifesto-line bl-line emph'>that's where the time goes.</div>
    </div></div>`,
    init(card) {
      const lines = card.querySelectorAll(".bl-line")
      gsap.set(lines, { opacity: 1, y: 0, filter: "blur(0px)" })
      return () => {
        gsap.killTweensOf(lines)
        gsap.set(lines, { opacity: 0, y: 32, filter: "blur(8px)" })
        gsap.to(lines, { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.75, ease: "expo.out", stagger: 0.55, delay: 0.2 })
      }
    }
  },

  {
    id: "bookend-rhyme", cat: "Text", display: "Bookend Rhyme",
    source: ["claude-code-goal","claude-code-ultrareview","claude-financial-services","code-w-claude-conf"],
    desc: "Opening and closing beats share the same per-char rise treatment with a slower closing stagger. Different content; matched motion makes the close feel like a return to the open.",
    html: `<div class='vp-stage' style='flex-direction:column;gap:22px;align-items:center'>
      <div class='wm-sm char-span' data-be-in>lumiere.</div>
      <div class='be-divider'></div>
      <div class='be-close' data-be-out>ships today.</div>
    </div>`,
    init(card) {
      const a = card.querySelector("[data-be-in]")
      const b = card.querySelector("[data-be-out]")
      const div = card.querySelector(".be-divider")
      const aS = spanChars(a)
      const bW = splitWords(b)
      /* idle: everything visible, divider at full wordmark width */
      gsap.set(aS, { opacity: 1, y: 0 })
      gsap.set(bW, { opacity: 1, y: 0 })
      const wmWidth = () => a.offsetWidth || 160
      gsap.set(div, { width: wmWidth() })
      return () => {
        gsap.killTweensOf([...aS, ...bW, div])
        gsap.set(aS, { opacity: 0, y: 60 })
        gsap.set(bW, { opacity: 0, y: 30 })
        gsap.set(div, { width: 0 })
        /* OPEN: wordmark rises per-char */
        gsap.to(aS, { opacity: 1, y: 0, duration: 0.7, ease: "expo.out", stagger: 0.07, delay: 0.25 })
        /* divider draws out to underline the wordmark after it lands */
        gsap.to(div, { width: wmWidth(), duration: 0.6, ease: "power3.out", delay: 1.1 })
        /* CLOSE: tagline rises per-word */
        gsap.to(bW, { opacity: 1, y: 0, duration: 0.9, ease: "expo.out", stagger: 0.22, delay: 1.85 })
      }
    }
  },

  /* ============================================================
     MOTION TREATMENTS (1)
     ============================================================ */

  {
    id: "per-char-event-emit", cat: "Motion", display: "Per-Char Event Emit",
    source: ["anima-launch"],
    desc: "Each typed character fires a discrete event indicator. Pair with audio clicks, glow flashes, or tick marks. Events LATCH so the cumulative event trail is visible at end. Mirrors anima's per-char emitClickAudio pattern (line 1928).",
    html: `<div class='vp-stage pce-stage'>
      <div class='pce-label'>events</div>
      <div class='pce-tracker'>
        <span class='pce-word' data-pce-word></span>
      </div>
      <div class='pce-track' data-pce-track></div>
      <div class='pce-counter'>
        <span class='pce-counter-v' data-pce-count>0</span><span class='pce-counter-l'>/12 fired</span>
      </div>
    </div>`,
    init(card) {
      const TEXT = "analyze beats"
      const STEP = 0.105
      const PRE_DELAY = 0.45

      const wordEl   = card.querySelector("[data-pce-word]")
      const trackEl  = card.querySelector("[data-pce-track]")
      const countEl  = card.querySelector("[data-pce-count]")

      wordEl.innerHTML = [...TEXT]
        .map(ch => `<span class="pce-ch" data-space="${ch === " " ? 1 : 0}">${ch === " " ? "&nbsp;" : ch}</span>`)
        .join("")
      trackEl.innerHTML = [...TEXT]
        .map(ch => `<span class="pce-tick" data-space="${ch === " " ? 1 : 0}"></span>`)
        .join("")

      const chars = wordEl.querySelectorAll(".pce-ch")
      const ticks = trackEl.querySelectorAll(".pce-tick")
      const nonSpaceCount = [...TEXT].filter(c => c !== " ").length

      const setIdle = () => {
        chars.forEach(c => c.classList.add("on"))
        ticks.forEach((t, i) => {
          if (TEXT[i] !== " ") t.classList.add("fire")
          else t.classList.remove("fire")
        })
        countEl.textContent = String(nonSpaceCount)
      }
      const clearAll = () => {
        chars.forEach(c => c.classList.remove("on"))
        ticks.forEach(t => t.classList.remove("fire"))
        countEl.textContent = "0"
      }
      setIdle()

      let tl = null
      const buildTimeline = () => {
        if (tl) { tl.kill(); tl = null }
        const t = gsap.timeline({ paused: true })
        let fired = 0
        ;[...TEXT].forEach((ch, i) => {
          const at = PRE_DELAY + i * STEP
          const charEl = chars[i]
          const tickEl = ticks[i]
          t.call(() => {
            charEl.classList.add("on")
            if (ch !== " ") {
              tickEl.classList.add("fire")
              fired += 1
              countEl.textContent = String(fired)
            }
          }, [], at)
        })
        return t
      }

      return function replay() {
        clearAll()
        tl = buildTimeline()
        tl.play(0)
      }
    }
  },

  /* ============================================================
     CARD / LAYER REVEALS (2)
     ============================================================ */

  {
    id: "flip-relocate", cat: "Layer", display: "FLIP Relocate",
    source: ["claude-code-agent-view"],
    desc: "Element morphs position, scale and rotation between two pre-defined slots. Same DOM node, new layout. Preserves identity across cuts (FLIP technique). Mirrors anima chainscan card morph (lines 2453-2456).",
    html: `<div class='vp-stage'>
      <div class='fr-stage'>
        <div class='fr-slot fr-slot-a' data-slot='a'></div>
        <div class='fr-slot fr-slot-b' data-slot='b'></div>
        <div class='fr-card' data-morph>
          <span class='fr-lbl'>proof</span>
          <span class='fr-val'>0xa7c2&hellip;34af</span>
          <span class='fr-meta'>block 4&middot;482&middot;117</span>
        </div>
      </div>
    </div>`,
    init(card) {
      const m  = card.querySelector("[data-morph]")
      const sa = card.querySelector(".fr-slot-a")
      const sb = card.querySelector(".fr-slot-b")

      gsap.set(m,  { x: 0, y: 0, scale: 1, rotation: 0 })
      gsap.set(sa, { opacity: 0.7 })
      gsap.set(sb, { opacity: 0.5 })

      return () => {
        gsap.killTweensOf([m, sa, sb])
        gsap.set(m,  { x: 0, y: 0, scale: 1, rotation: 0 })
        gsap.set(sa, { opacity: 0.7 })
        gsap.set(sb, { opacity: 0.5 })

        const tl = gsap.timeline()
        tl.to(sb, { opacity: 0.8, duration: 0.30, ease: "power2.out" }, 0.40)
        tl.to(m, { x: 140, y: 100, scale: 0.6, rotation: -3,
                   duration: 1.05, ease: "power3.inOut" }, 0.70)
        tl.to(sa, { opacity: 0.3, duration: 0.40, ease: "power2.out" }, 1.40)
        tl.to(sa, { opacity: 0.7, duration: 0.30, ease: "power2.out" }, 3.10)
        tl.to(sb, { opacity: 0.35, duration: 0.30, ease: "power2.out" }, 3.10)
        tl.to(m, { x: 0, y: 0, scale: 1, rotation: 0,
                   duration: 1.05, ease: "power3.inOut" }, 3.40)
        tl.to([sa, sb], { opacity: 0.7, duration: 0.30, ease: "power2.out" }, 4.60)
      }
    }
  },

  {
    id: "row-fade-stagger", cat: "Layer", display: "Row Fade Stagger",
    source: ["claude-code-agent-view","claude-financial-services"],
    desc: "Light per-row lift with linear stagger. Subtler than character cascade; for lists and tables.",
    html: `<div class='vp-stage'><div class='row-list'>
      <div class='row-line trow'><span class='dotcol'></span>specter · 0xa7…</div>
      <div class='row-line trow'><span class='dotcol'></span>auditor · 0xb3…</div>
      <div class='row-line trow'><span class='dotcol'></span>scout · 0xc1…</div>
      <div class='row-line trow'><span class='dotcol'></span>oracle · 0xd9…</div>
      <div class='row-line trow now'><span class='dotcol'></span>anima · 0xe5…</div>
    </div></div>`,
    init(card) {
      const rows = card.querySelectorAll(".trow")
      gsap.set(rows, { opacity: 1, y: 0 })
      return () => {
        gsap.killTweensOf(rows)
        gsap.set(rows, { opacity: 1, y: 0 })
        gsap.set(rows, { opacity: 0, y: 6 })
        gsap.to(rows, { opacity: 1, y: 0, duration: 0.4, ease: "expo.out", stagger: 0.12, delay: 0.2 })
      }
    }
  },

  /* ============================================================
     UI / INTERACTION (13)
     ============================================================ */

  {
    id: "braille-spinner", cat: "UI", display: "Braille Spinner",
    source: ["claude-code-goal","claude-code-agent-view","claude-code-push-notifications"],
    desc: "Ten-frame braille cycle with elapsed integer counter. Always-on indicator that scrubs cleanly.",
    html: `<div class='vp-stage' style='flex-direction:column;gap:14px'>
      <div class='term-pill'>
        <span class='spinner' data-sp>⠋</span>
        <span class='term-label'>auditing contract</span>
        <span class='spinner-elapsed' data-el>3s</span>
      </div>
      <div class='spinner-trace'>● tool: solidity.parse → 12 findings</div>
    </div>`,
    init(card) {
      const sp = card.querySelector("[data-sp]")
      const el = card.querySelector("[data-el]")
      let raf, start = performance.now()
      const loop = (now) => {
        const dt = (now - start) % 8000
        sp.textContent = BRAILLE[Math.floor(dt / 80) % 10]
        el.textContent = Math.floor(dt / 1000) + "s"
        raf = requestAnimationFrame(loop)
      }
      raf = requestAnimationFrame(loop)
      return () => {
        if (raf) cancelAnimationFrame(raf)
        start = performance.now()
        raf = requestAnimationFrame(loop)
      }
    }
  },

  {
    id: "tool-cascade", cat: "UI", display: "Tool-Call Cascade",
    source: ["claude-code-goal","claude-code-agent-view","claude-code-push-notifications","claude-code-ultrareview","claude-code-session-recaps","claude-financial-services"],
    desc: "Per-block staggered lift for agent logs, command output, anything emitting block-by-block.",
    html: `<div class='vp-stage'><div class='tool-pane'>
      <div class='tool-row'><span class='glyph'>●</span> <span class='name'>web.search</span><span class='args'>("eip-7702")</span></div>
      <div class='tool-row res'>└ 12 results</div>
      <div class='tool-row'><span class='glyph'>●</span> <span class='name'>fetch</span><span class='args'>("ethereum.org")</span></div>
      <div class='tool-row res'>└ 3.4 kb · cached</div>
      <div class='tool-row'><span class='glyph'>●</span> <span class='name'>summarize</span><span class='args'>(tokens=420)</span></div>
      <div class='tool-row res'>└ ok</div>
    </div></div>`,
    init(card) {
      const rows = card.querySelectorAll(".tool-row")
      gsap.set(rows, { opacity: 1, y: 0 })
      return () => {
        gsap.killTweensOf(rows)
        gsap.set(rows, { opacity: 1, y: 0 })
        gsap.set(rows, { opacity: 0, y: 4 })
        gsap.to(rows, { opacity: 1, y: 0, duration: 0.3, ease: "power2.out", stagger: 0.22, delay: 0.2 })
      }
    }
  },

  {
    id: "cursor-glide", cat: "UI", display: "Cursor Glide",
    source: ["claude-code-fast-mode","claude-financial-services"],
    desc: "Cursor glides from rest to a named anchor element with power3.inOut weight, then returns. Target resolved at tween start so layout shifts don't break it.",
    html: `<div class='vp-stage'><div class='cursor-stage' data-vpcur>
      <div class='cursor-target' data-target>0xa7c2…34af</div>
      <svg class='cursor-svg cursor-glide' viewBox='0 0 56 64' data-cur>
        <path d='M 6 4 C 7 2.6, 9.5 2.4, 10.8 3.6 L 41.5 28 C 43.4 29.5, 43 32.5, 40.6 33.3 L 27.3 37.5 C 26.2 37.85, 25.4 38.7, 25.1 39.8 L 21.2 50.4 C 20.3 53, 16.5 53.1, 15.5 50.5 L 5 8.8 C 4.6 7.3, 5 5.4, 6 4 Z'/>
      </svg>
    </div></div>`,
    init(card) {
      const cur = card.querySelector("[data-cur]")
      const t = card.querySelector("[data-target]")
      gsap.set(cur, { opacity: 1, left: "8%", top: "12%" })
      return () => {
        gsap.killTweensOf(cur)
        gsap.set(cur, { opacity: 1, left: "8%", top: "12%" })
        gsap.delayedCall(0.3, () => {
          const targetX = t.offsetLeft + t.offsetWidth * 0.2
          const targetY = t.offsetTop + t.offsetHeight * 0.4
          gsap.to(cur, { left: targetX + "px", top: targetY + "px", duration: 1.15, ease: "power3.inOut",
            onComplete() {
              gsap.to(cur, { left: "8%", top: "12%", duration: 0.8, ease: "power2.inOut", delay: 0.4 })
            }
          })
        })
      }
    }
  },

  {
    id: "click-press", cat: "UI", display: "Click Press",
    source: ["claude-financial-services"],
    desc: "Cursor scales down quickly then recovers. Physical-click feedback.",
    html: `<div class='vp-stage' style='flex-direction:column;gap:14px;align-items:center'>
      <svg class='cursor-svg cursor-press' viewBox='0 0 56 64' data-pc>
        <path d='M 6 4 C 7 2.6, 9.5 2.4, 10.8 3.6 L 41.5 28 C 43.4 29.5, 43 32.5, 40.6 33.3 L 27.3 37.5 C 26.2 37.85, 25.4 38.7, 25.1 39.8 L 21.2 50.4 C 20.3 53, 16.5 53.1, 15.5 50.5 L 5 8.8 C 4.6 7.3, 5 5.4, 6 4 Z'/>
      </svg>
      <div class='press-label'>tap</div>
    </div>`,
    init(card) {
      const c = card.querySelector("[data-pc]")
      gsap.set(c, { scale: 1, transformOrigin: "50% 50%" })
      return () => {
        gsap.killTweensOf(c)
        gsap.set(c, { scale: 1 })
        const tl = gsap.timeline({ delay: 0.4 })
        tl.to(c, { scale: 0.82, duration: 0.1, ease: "power2.in" })
        tl.to(c, { scale: 1, duration: 0.18, ease: "power3.out" })
      }
    }
  },

  {
    id: "click-ripple", cat: "UI", display: "Click Ripple",
    source: ["claude-code-fast-mode"],
    desc: "Cursor glides to target, clicks (scale press), radial ring expands and fades at impact. Full click sequence.",
    html: `<div class='vp-stage'><div class='ripple-host'>
      <div class='click-target'>tap</div>
      <svg class='cursor-svg' viewBox='0 0 56 64' data-rip-cur style='position:absolute;width:34px;height:38px;left:15%;top:18%;opacity:1'>
        <path d='M 6 4 C 7 2.6, 9.5 2.4, 10.8 3.6 L 41.5 28 C 43.4 29.5, 43 32.5, 40.6 33.3 L 27.3 37.5 C 26.2 37.85, 25.4 38.7, 25.1 39.8 L 21.2 50.4 C 20.3 53, 16.5 53.1, 15.5 50.5 L 5 8.8 C 4.6 7.3, 5 5.4, 6 4 Z'/>
      </svg>
      <div class='cursor-ripple' data-rip></div>
    </div></div>`,
    init(card) {
      const r = card.querySelector("[data-rip]")
      const cur = card.querySelector("[data-rip-cur]")
      const tgt = card.querySelector(".click-target")
      gsap.set(r, { opacity: 0, scale: 1 })
      gsap.set(cur, { left: "15%", top: "18%", scale: 1 })
      return () => {
        gsap.killTweensOf([r, cur])
        gsap.set(r, { opacity: 0, scale: 0.4 })
        gsap.set(cur, { left: "15%", top: "18%", scale: 1 })
        const tl = gsap.timeline()
        /* cursor glides to target center */
        tl.to(cur, { left: "42%", top: "38%", duration: 0.8, ease: "power3.inOut" }, 0.2)
        /* click press */
        tl.to(cur, { scale: 0.82, duration: 0.08, ease: "power2.in" }, 1.05)
        tl.to(cur, { scale: 1, duration: 0.15, ease: "power3.out" }, 1.13)
        /* ripple fires on click */
        tl.fromTo(r, { scale: 0.4, opacity: 0.9 }, { scale: 3.2, opacity: 0, duration: 0.5, ease: "power2.out" }, 1.08)
        /* cursor returns */
        tl.to(cur, { left: "15%", top: "18%", duration: 0.7, ease: "power2.inOut" }, 1.9)
      }
    }
  },

  {
    id: "caret-typing", cat: "UI", display: "Caret + Typing",
    source: ["claude-code-goal","claude-code-agent-view","claude-code-ultrareview","claude-code-fast-mode"],
    desc: "Per-char display flip in a search pill. Same stable-layout technique as typewriter-flip but in a search/prompt context.",
    html: `<div class='vp-stage'><div class='search-pill'>
      <svg class='search-ic' viewBox='0 0 16 16' fill='none' stroke='currentColor' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'>
        <circle cx='7' cy='7' r='4.6'/><path d='M10.4 10.4l3.4 3.4'/>
      </svg>
      <span class='typed' data-ct-cmd>audit the storage proof contract</span>
      <span class='caret-block' data-ct-caret></span>
    </div></div>`,
    init(card) {
      const cmd = card.querySelector("[data-ct-cmd]")
      const caret = card.querySelector("[data-ct-caret]")
      const TEXT = cmd.textContent
      const STEP = 0.065

      /* split into per-char spans once (same pattern as typewriter-flip) */
      cmd.innerHTML = ""
      TEXT.split("").forEach(c => {
        const s = document.createElement("span")
        s.className = "ct-ch"
        s.textContent = c === " " ? " " : c
        s.style.display = "inline-block"
        cmd.appendChild(s)
      })
      const chars = cmd.querySelectorAll(".ct-ch")

      /* idle: all chars visible + caret */
      chars.forEach(c => gsap.set(c, { display: "inline-block" }))
      gsap.set(caret, { opacity: 0.7 })

      let tl = null
      return function replay() {
        if (tl) { tl.kill(); tl = null }
        chars.forEach(c => gsap.set(c, { display: "none" }))
        gsap.set(caret, { opacity: 0.7 })

        tl = gsap.timeline({ delay: 0.3 })
        chars.forEach((c, i) => {
          tl.set(c, { display: "inline-block" }, 0.15 + i * STEP)
        })
        const done = 0.15 + chars.length * STEP + 0.2
        tl.to(caret, { opacity: 0, duration: 0.25, ease: "power1.out" }, done)
        tl.set(caret, { opacity: 0.7 }, done + 0.7)
      }
    }
  },

  {
    id: "row-highlight", cat: "UI", display: "Row Highlight",
    source: ["claude-code-agent-view","claude-financial-services"],
    desc: "Background tint plus left border for selection feedback. Brief over-shoot lands the impact; then it settles to a steady-state tint.",
    html: `<div class='vp-stage'><div class='choices'>
      <div data-rrh class='choice winner'>specter · score 0.92</div>
      <div class='choice'>auditor · score 0.81</div>
      <div class='choice'>scout · score 0.75</div>
    </div></div>`,
    init(card) {
      const el = card.querySelector("[data-rrh]")
      const restColor = "rgba(46,155,102,0.10)"
      const peakColor = "rgba(46,155,102,0.20)"
      gsap.set(el, { backgroundColor: restColor, borderLeftColor: "#2e9b66" })
      return () => {
        gsap.killTweensOf(el)
        gsap.set(el, { backgroundColor: "transparent", borderLeftColor: "transparent" })
        const tl = gsap.timeline({ delay: 0.5 })
        tl.to(el, { borderLeftColor: "#2e9b66", duration: 0.3, ease: "power2.out" })
        tl.to(el, { backgroundColor: peakColor, duration: 0.4, ease: "sine.out" }, "<+0.1")
        tl.to(el, { backgroundColor: restColor, duration: 0.6, ease: "sine.inOut" }, "+=0.3")
      }
    }
  },

  {
    id: "value-flip", cat: "UI", display: "Value Flip",
    source: ["claude-code-goal","claude-code-agent-view","claude-code-ultrareview","claude-financial-services"],
    desc: "Values swap in place with a proof-green row flash that settles back to neutral. Use for statusline updates, ticker rolls, or any numeric that proves something changed.",
    html: `<div class='vp-stage' style='flex-direction:column;gap:8px'>
      <div class='status-line'><span class='status-k'>balance · A</span><span class='v' data-sa>12.50</span></div>
      <div class='status-line'><span class='status-k'>compute · A</span><span class='v' data-sc>14.20</span></div>
      <div class='status-line'><span class='status-k'>balance · B</span><span class='v' data-aa>3.10</span></div>
      <div class='status-line'><span class='status-k'>compute · B</span><span class='v' data-ac>8.10</span></div>
    </div>`,
    init(card) {
      const sa = card.querySelector("[data-sa]")
      const sc = card.querySelector("[data-sc]")
      const aa = card.querySelector("[data-aa]")
      const ac = card.querySelector("[data-ac]")
      const initial = ["12.50", "14.20", "3.10", "8.10"]
      const after   = ["7.50",  "13.55", "8.10", "7.30"]
      const els = [sa, sc, aa, ac]
      const rows = els.map(el => el.parentElement)
      function apply(vals) { els.forEach((el, i) => el.textContent = vals[i]) }
      function flashRow(row) {
        row.classList.add("flash")
        setTimeout(() => row.classList.remove("flash"), 650)
      }
      apply(initial)
      let timers = []
      return () => {
        timers.forEach(t => clearTimeout(t))
        timers = []
        rows.forEach(r => r.classList.remove("flash"))
        apply(initial)
        /* stagger: rows flip one at a time in varied (non-sequential) order */
        const order1 = [2, 0, 3, 1]
        const order2 = [1, 3, 0, 2]
        const GAP = 380
        order1.forEach((idx, step) => {
          timers.push(setTimeout(() => {
            els[idx].textContent = after[idx]
            flashRow(rows[idx])
          }, 800 + step * GAP))
        })
        order2.forEach((idx, step) => {
          timers.push(setTimeout(() => {
            els[idx].textContent = initial[idx]
            flashRow(rows[idx])
          }, 3400 + step * GAP))
        })
      }
    }
  },

  {
    id: "pop-entry", cat: "UI", display: "Pop Entry",
    source: ["claude-code-goal"],
    desc: "Y-lift from below with quick opacity-in. For small elements arriving in sequence (chat bubbles, toasts).",
    html: `<div class='vp-stage'>
      <div style='display:flex;flex-direction:column;gap:8px;width:65%'>
        <div class='bub theirs' data-pop>need a quick audit</div>
        <div class='bub mine' data-pop>on it</div>
        <div class='bub theirs' data-pop>3 findings · 1 critical</div>
        <div class='bub mine' data-pop>send the proof</div>
      </div>
    </div>`,
    init(card) {
      const bubs = card.querySelectorAll("[data-pop]")
      gsap.set(bubs, { opacity: 1, y: 0, scale: 1 })
      return () => {
        gsap.killTweensOf(bubs)
        gsap.set(bubs, { opacity: 0, y: 14, scale: 0.92 })
        gsap.to(bubs, {
          opacity: 1, y: 0, scale: 1,
          duration: 0.42, ease: "back.out(1.6)",
          stagger: 0.42, delay: 0.3
        })
      }
    }
  },

  {
    id: "dot-bounce", cat: "UI", display: "Dot Bounce",
    source: ["anima-launch"],
    desc: "Three dots yoyo with stagger. Standard in-progress indicator. Steady cadence so the rhythm reads at a glance.",
    html: `<div class='vp-stage' style='flex-direction:column;gap:14px;align-items:center'>
      <div class='dots' data-host>
        <span class='dot' data-td='0'></span>
        <span class='dot' data-td='1'></span>
        <span class='dot' data-td='2'></span>
      </div>
      <div class='dots-label'>typing</div>
    </div>`,
    init(card) {
      const dots = card.querySelectorAll("[data-td]")
      const animate = () => {
        gsap.killTweensOf(dots)
        gsap.set(dots, { y: 0 })
        dots.forEach((d, i) => gsap.to(d, {
          y: -4, duration: 0.4, ease: "sine.inOut",
          repeat: -1, yoyo: true, delay: i * 0.15
        }))
      }
      animate() /* idle = continuous bounce */
      return animate
    }
  },

  {
    id: "color-text-swap", cat: "UI", display: "Color + Text Swap",
    source: ["claude-financial-services"],
    desc: "Dot and text color tween smoothly between states. Text label swaps at the midpoint. Use for presence pills, state badges.",
    html: `<div class='vp-stage'><div class='presence' data-pr>
      <span class='pres-dot' data-pd></span>
      <span data-pt>ready</span>
    </div></div>`,
    init(card) {
      const dot = card.querySelector("[data-pd]")
      const txt = card.querySelector("[data-pt]")
      const colorOf = name => getComputedStyle(document.documentElement)
        .getPropertyValue("--" + name).trim()
      const set = (label, varName) => {
        txt.textContent = label
        const c = colorOf(varName)
        gsap.to(dot, { backgroundColor: c, duration: 0.35, ease: "sine.inOut" })
        gsap.to(txt, { color: c, duration: 0.35, ease: "sine.inOut" })
      }
      txt.textContent = "ready"
      const gc = colorOf("proof-green")
      dot.style.backgroundColor = gc
      txt.style.color = gc
      let timers = []
      return () => {
        timers.forEach(t => clearTimeout(t))
        timers = []
        gsap.killTweensOf([dot, txt])
        txt.textContent = "ready"
        const g = colorOf("proof-green")
        dot.style.backgroundColor = g
        txt.style.color = g
        const seq = [
          { label: "working", v: "signal-blue",  at: 900 },
          { label: "ready",   v: "proof-green",  at: 2600 },
          { label: "working", v: "signal-blue",  at: 4300 },
          { label: "ready",   v: "proof-green",  at: 6000 }
        ]
        seq.forEach(s => timers.push(setTimeout(() => set(s.label, s.v), s.at)))
      }
    }
  },

  {
    id: "height-collapse-exit", cat: "UI", display: "Swipe-to-Dismiss",
    source: ["claude-code-agent-view"],
    desc: "Row swipes right to exit, then the column collapses the gap. iOS-style list removal. Use for dismissable items, notification clearing, queue management.",
    html: `<div class='vp-stage'>
      <div style='display:flex;flex-direction:column;gap:8px;width:75%;max-width:250px;overflow:hidden'>
        <div class='status-line' style='border-radius:10px;padding:10px 14px'><span class='status-k'>specter</span><span class='v' style='color:var(--proof-green)'>deployed</span></div>
        <div data-hc style='overflow:hidden'>
          <div class='status-line' data-hc-inner style='border-radius:10px;padding:10px 14px'><span class='status-k'>auditor</span><span class='v' style='color:var(--signal-blue)'>syncing</span></div>
        </div>
        <div class='status-line' style='border-radius:10px;padding:10px 14px'><span class='status-k'>scout</span><span class='v'>queued</span></div>
        <div class='status-line' style='border-radius:10px;padding:10px 14px'><span class='status-k'>oracle</span><span class='v'>queued</span></div>
      </div>
    </div>`,
    init(card) {
      const wrap = card.querySelector("[data-hc]")
      const inner = card.querySelector("[data-hc-inner]")
      const ROW_H = 38
      const restore = () => {
        gsap.set(inner, { x: 0, opacity: 1 })
        gsap.set(wrap, { height: ROW_H, marginBottom: 0 })
      }
      restore()
      return () => {
        gsap.killTweensOf([inner, wrap])
        restore()
        const tl = gsap.timeline({ delay: 1.2 })
        /* swipe the row right + fade */
        tl.to(inner, { x: 300, opacity: 0, duration: 0.4, ease: "power3.in" })
        /* collapse the wrapper height so rows below slide up */
        tl.to(wrap, { height: 0, marginBottom: -8, duration: 0.35, ease: "power2.inOut" }, "-=0.1")
        /* restore: expand wrapper, slide row back from left */
        tl.set(inner, { x: -60, opacity: 0 }, "+=1.6")
        tl.to(wrap, { height: ROW_H, marginBottom: 0, duration: 0.3, ease: "power2.out" })
        tl.to(inner, { x: 0, opacity: 1, duration: 0.35, ease: "power2.out" }, "<+0.1")
      }
    }
  },

  /* ============================================================
     DATA VIZ (6) — from ChatGPT personal-finance reference
     ============================================================ */

  {
    id: "inline-word-stream", isNew: true, cat: "Text", display: "Inline Word Stream",
    source: ["claude-code-fast-mode","chatgpt-personal-finance"],
    desc: "\"With\" reveals centered, then the whole wordmark glides left on one eased settle while \"Chat\" reveals as a whole word and \"GPT\" types in per-character. Continuous decelerating motion, no jitter. ChatGPT finance video opening title.",
    html: `<div class='iws-stage'><div class='iws-phrase' data-iws-phrase><span class='iws-w' data-iws-with>With</span><span class='iws-chat' data-iws-chat>Chat</span><span class='iws-gpt'><span class='iws-c'>G</span><span class='iws-c'>P</span><span class='iws-c'>T</span></span></div></div>`,
    init(card) {
      const stage = card.querySelector(".iws-stage")
      const phrase = card.querySelector("[data-iws-phrase]")
      const withEl = card.querySelector("[data-iws-with]")
      const chatEl = card.querySelector("[data-iws-chat]")
      const gptChars = Array.from(card.querySelectorAll(".iws-gpt .iws-c"))

      // Every glyph sits in the FINAL layout at all times; reveals are opacity and the
      // whole phrase glides on one eased transform, so there is never a reflow
      // (no jitter) and the motion is a single continuous decelerating settle.
      // startX = shift the phrase right so "With" alone reads centred.
      let startX = 0
      function measure() {
        const prevX = Number(gsap.getProperty(phrase, "x")) || 0
        gsap.set(phrase, { x: 0 })
        const sr = stage.getBoundingClientRect()
        const wr = withEl.getBoundingClientRect()
        if (sr.width === 0 || wr.width === 0) { gsap.set(phrase, { x: prevX }); return }
        startX = (sr.left + sr.width / 2) - (wr.left + wr.width / 2)
        gsap.set(phrase, { x: prevX })
      }
      function applyIdle() {
        gsap.set(phrase, { x: 0 })
        gsap.set([withEl, chatEl, ...gptChars], { opacity: 1 })
      }
      measure(); applyIdle()
      requestAnimationFrame(() => { measure(); applyIdle() })
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { measure(); applyIdle() })

      let tl = null
      return function replay() {
        if (tl) { tl.kill(); tl = null }
        measure()
        gsap.set(withEl, { opacity: 0 })
        gsap.set([chatEl, ...gptChars], { opacity: 0 })
        gsap.set(phrase, { x: startX })

        tl = gsap.timeline()
        // "With" reveals, centred, holds a beat
        tl.to(withEl, { opacity: 1, duration: 0.22, ease: "power2.out" }, 0.06)
        // ONE continuous decelerating glide from With-centred to final-centred
        tl.to(phrase, { x: 0, duration: 0.72, ease: "power3.out" }, 0.46)
        // reveals layered along the glide: "Chat" whole, then "GPT" per character
        tl.to(chatEl, { opacity: 1, duration: 0.16, ease: "power2.out" }, 0.52)
        tl.to(gptChars[0], { opacity: 1, duration: 0.1, ease: "power2.out" }, 0.7)
        tl.to(gptChars[1], { opacity: 1, duration: 0.1, ease: "power2.out" }, 0.82)
        tl.to(gptChars[2], { opacity: 1, duration: 0.1, ease: "power2.out" }, 0.94)
        // hold the settled wordmark, then return to rest
        tl.to({}, { duration: 1.0 }, 1.7)
        tl.add(applyIdle, 2.7)
        return tl
      }
    }
  },

  {
    id: "parallax-card-collage", isNew: true, cat: "Reveal", display: "Parallax Card Collage",
    source: ["claude-code-agent-view","claude-code-push-notifications","chatgpt-personal-finance"],
    desc: "Multiple UI cards enter from different directions at different speeds, creating a layered depth composition. ChatGPT intro-style multi-layer entrance.",
    html: `<div class='pcc-stage'>
      <div class='pcc-card' data-pcc='a' style='width:90px;top:18%;left:8%'><div class='pcc-label'>Stocks</div><div class='pcc-val'>$48,512</div></div>
      <div class='pcc-card' data-pcc='b' style='width:70px;top:12%;right:18%'><div class='pcc-donut'></div></div>
      <div class='pcc-card pcc-accent' data-pcc='c' style='background:#d4f0c0;top:42%;left:22%;padding:10px 18px'>you</div>
      <div class='pcc-card pcc-accent' data-pcc='d' style='background:#f5e86c;top:34%;right:10%;padding:10px 18px'>can</div>
      <div class='pcc-card' data-pcc='e' style='width:110px;bottom:12%;left:6%'><div class='pcc-label'>YTD</div><div class='pcc-val' style='color:#2e9b66'>+2.73%</div></div>
      <div class='pcc-card' data-pcc='f' style='width:95px;bottom:8%;right:8%'><div class='pcc-label'>Spending</div><div class='pcc-val'>$4,325</div></div>
    </div>`,
    init(card) {
      const cards = card.querySelectorAll("[data-pcc]")
      const dirs = [
        { x: -60, y: 30, r: -5 },
        { x: 50, y: -40, r: 3 },
        { x: -30, y: -50, r: 8 },
        { x: 60, y: -20, r: -4 },
        { x: -50, y: 40, r: 6 },
        { x: 40, y: 50, r: -7 }
      ]
      gsap.set(cards, { opacity: 1, x: 0, y: 0, rotation: 0, scale: 1 })
      return () => {
        gsap.killTweensOf(cards)
        cards.forEach((c, i) => {
          const d = dirs[i]
          gsap.set(c, { opacity: 0, x: d.x, y: d.y, rotation: d.r, scale: 0.88 })
          gsap.to(c, {
            opacity: 1, x: 0, y: 0, rotation: 0, scale: 1,
            duration: 0.85, ease: "expo.out", delay: 0.4 + i * 0.09
          })
        })
      }
    }
  },

  {
    id: "color-block-word", isNew: true, cat: "Reveal", display: "Color Block Word",
    source: ["chatgpt-personal-finance"],
    desc: "Large colored panels slide in from different edges carrying single bold words, overlapping in layers. ChatGPT 'now you can' collage pattern.",
    html: `<div class='cbw-stage'>
      <div class='cbw-block' data-cbw='now'>now</div>
      <div class='cbw-block' data-cbw='you'>you</div>
      <div class='cbw-block' data-cbw='can'>can</div>
    </div>`,
    init(card) {
      const now = card.querySelector("[data-cbw='now']")
      const you = card.querySelector("[data-cbw='you']")
      const can = card.querySelector("[data-cbw='can']")
      const all = [now, you, can]
      gsap.set(all, { opacity: 1, x: 0, y: 0, rotation: 0 })
      return () => {
        gsap.killTweensOf(all)
        gsap.set(now, { opacity: 0, x: -140, y: 20, rotation: -3 })
        gsap.set(you, { opacity: 0, x: 0, y: 100, rotation: 2 })
        gsap.set(can, { opacity: 0, x: 100, y: -80, rotation: 4 })
        gsap.to(now, { opacity: 1, x: 0, y: 0, rotation: 0, duration: 0.75, ease: "expo.out", delay: 0.3 })
        gsap.to(you, { opacity: 1, x: 0, y: 0, rotation: 0, duration: 0.75, ease: "expo.out", delay: 0.5 })
        gsap.to(can, { opacity: 1, x: 0, y: 0, rotation: 0, duration: 0.75, ease: "expo.out", delay: 0.7 })
      }
    }
  },

  {
    id: "donut-chart-fill", isNew: true, cat: "Data Viz", display: "Donut Chart Fill",
    source: ["chatgpt-personal-finance"],
    desc: "Donut chart segments animate arcs from 0 to their value, with a green-gradient palette plus a light-blue cash wedge. ChatGPT portfolio distribution.",
    html: `<div class='dcf-stage'>
      <div class='dcf-wrap'>
        <svg class='dcf-svg' viewBox='0 0 100 100' data-dcf-svg>
          <circle cx='50' cy='50' r='35' fill='none' stroke='#eee' stroke-width='14'/>
        </svg>
        <div class='dcf-legend' data-dcf-legend></div>
      </div>
    </div>`,
    init(card) {
      const svg = card.querySelector("[data-dcf-svg]")
      const legend = card.querySelector("[data-dcf-legend]")
      const data = [
        { label: "Stocks", pct: 47, color: "#1a5e3a", val: "$48,512" },
        { label: "ETFs", pct: 19, color: "#2e9b66", val: "$19,134" },
        { label: "Bonds", pct: 18, color: "#5fcc88", val: "$18,354" },
        { label: "Crypto", pct: 10, color: "#a8e6cf", val: "$10,736" },
        { label: "Cash", pct: 6, color: "#87ceeb", val: "$6,200" }
      ]
      const R = 35, C = 2 * Math.PI * R
      let offset = 0
      const arcs = []
      data.forEach(d => {
        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle")
        circle.setAttribute("cx", "50")
        circle.setAttribute("cy", "50")
        circle.setAttribute("r", String(R))
        circle.setAttribute("fill", "none")
        circle.setAttribute("stroke", d.color)
        circle.setAttribute("stroke-width", "14")
        circle.setAttribute("stroke-dasharray", `${(d.pct / 100) * C} ${C}`)
        circle.setAttribute("stroke-dashoffset", String(-offset))
        circle.setAttribute("transform", "rotate(-90 50 50)")
        svg.appendChild(circle)
        arcs.push({ el: circle, len: (d.pct / 100) * C })
        offset += (d.pct / 100) * C
      })
      legend.innerHTML = data.map(d =>
        `<div class='dcf-legend-row'><span class='dcf-dot' style='background:${d.color}'></span>${d.label}<span class='dcf-legend-val'>${d.val}</span></div>`
      ).join("")
      const legendRows = legend.querySelectorAll(".dcf-legend-row")
      gsap.set(arcs.map(a => a.el), { opacity: 1 })
      gsap.set(legendRows, { opacity: 1, x: 0 })
      return () => {
        gsap.killTweensOf(arcs.map(a => a.el))
        gsap.killTweensOf(legendRows)
        arcs.forEach(a => {
          gsap.set(a.el, { attr: { "stroke-dasharray": `0 ${C}` }, opacity: 1 })
        })
        gsap.set(legendRows, { opacity: 0, x: 10 })
        arcs.forEach((a, i) => {
          gsap.to(a.el, {
            attr: { "stroke-dasharray": `${a.len} ${C}` },
            duration: 0.6, ease: "power2.inOut", delay: 0.5 + i * 0.12
          })
        })
        legendRows.forEach((r, i) => {
          gsap.to(r, { opacity: 1, x: 0, duration: 0.3, ease: "power2.out", delay: 0.7 + i * 0.08 })
        })
      }
    }
  },

  {
    id: "stacked-bar-fill", isNew: true, cat: "Data Viz", display: "Stacked Bar Fill",
    source: ["chatgpt-personal-finance"],
    desc: "Horizontal bar segments animate their widths sequentially with a green-to-blue color ramp. ChatGPT spending breakdown.",
    html: `<div class='sbf-stage'>
      <div style='font-family:Outfit,sans-serif;font-size:11px;font-weight:600;color:#222;width:85%;display:flex;justify-content:space-between'><span>Spending</span><span style='font-size:14px;font-weight:700'>$4,325</span></div>
      <div class='sbf-bar-wrap' data-sbf-bar></div>
      <div class='sbf-legend' data-sbf-legend></div>
    </div>`,
    init(card) {
      const bar = card.querySelector("[data-sbf-bar]")
      const legend = card.querySelector("[data-sbf-legend]")
      const data = [
        { label: "Rent", pct: 47, color: "#1a5e3a" },
        { label: "Groceries", pct: 18, color: "#2e9b66" },
        { label: "Subs", pct: 13, color: "#5fcc88" },
        { label: "Medical", pct: 4, color: "#a8e6cf" },
        { label: "Misc", pct: 3, color: "#b0d4f1" },
        { label: "Transit", pct: 9, color: "#4a90d9" },
        { label: "Other", pct: 6, color: "#2563a0" }
      ]
      bar.innerHTML = data.map(d =>
        `<div class='sbf-seg' data-sbf-seg style='background:${d.color}'></div>`
      ).join("")
      legend.innerHTML = data.map(d =>
        `<div class='sbf-legend-item'><span class='sbf-legend-dot' style='background:${d.color}'></span>${d.label}</div>`
      ).join("")
      const segs = bar.querySelectorAll("[data-sbf-seg]")
      gsap.set(segs, (i) => ({ width: data[i].pct + "%" }))
      return () => {
        gsap.killTweensOf(segs)
        gsap.set(segs, { width: "0%" })
        segs.forEach((s, i) => {
          gsap.to(s, { width: data[i].pct + "%", duration: 0.5, ease: "power2.out", delay: 0.4 + i * 0.08 })
        })
      }
    }
  },

  {
    id: "line-chart-draw", isNew: true, cat: "Data Viz", display: "Line Chart Draw",
    source: ["chatgpt-personal-finance"],
    desc: "SVG line chart draws left-to-right with gradient fill following. ChatGPT investment performance card.",
    html: `<div class='lcd-stage'>
      <div class='lcd-card'>
        <div class='lcd-header'><span class='lcd-title'>Investment performance</span><span class='lcd-val'>$53,399</span></div>
        <div class='lcd-gain'>+$487.23 (+2.73%) YTD</div>
        <div class='lcd-tabs'><span class='lcd-tab'>1D</span><span class='lcd-tab'>1W</span><span class='lcd-tab'>1M</span><span class='lcd-tab'>3M</span><span class='lcd-tab'>6M</span><span class='lcd-tab active'>YTD</span><span class='lcd-tab'>1Y</span></div>
        <svg class='lcd-svg' viewBox='0 0 200 60' preserveAspectRatio='none' data-lcd-svg>
          <defs><linearGradient id='lcd-grad' x1='0' y1='0' x2='0' y2='1'><stop offset='0%' stop-color='#2e9b66' stop-opacity='0.3'/><stop offset='100%' stop-color='#2e9b66' stop-opacity='0'/></linearGradient></defs>
          <path class='lcd-fill' data-lcd-fill d='M0,45 10,42 25,48 40,50 55,46 70,44 85,38 100,40 115,35 130,30 145,28 160,25 175,18 190,20 200,15 200,60 0,60Z'/>
          <path class='lcd-line' data-lcd-line d='M0,45 10,42 25,48 40,50 55,46 70,44 85,38 100,40 115,35 130,30 145,28 160,25 175,18 190,20 200,15'/>
        </svg>
      </div>
    </div>`,
    init(card) {
      const line = card.querySelector("[data-lcd-line]")
      const fill = card.querySelector("[data-lcd-fill]")
      const len = line.getTotalLength ? line.getTotalLength() : 400
      gsap.set(line, { strokeDasharray: len, strokeDashoffset: 0 })
      gsap.set(fill, { opacity: 0.3 })
      return () => {
        gsap.killTweensOf([line, fill])
        gsap.set(line, { strokeDasharray: len, strokeDashoffset: len })
        gsap.set(fill, { opacity: 0, clipPath: "inset(0 100% 0 0)" })
        gsap.to(line, { strokeDashoffset: 0, duration: 1.2, ease: "power2.inOut", delay: 0.5 })
        gsap.to(fill, { opacity: 0.3, clipPath: "inset(0 0% 0 0)", duration: 1.2, ease: "power2.inOut", delay: 0.5 })
      }
    }
  },

  /* ============================================================
     CHAT PATTERNS (6) — from ChatGPT personal-finance reference
     ============================================================ */

  {
    id: "card-float-in", isNew: true, cat: "UI", display: "Card Float-In",
    source: ["claude-financial-services","chatgpt-personal-finance"],
    desc: "White rounded card gently floats upward with fade + subtle scale. ChatGPT-style data card entrance.",
    html: `<div class='cfi-stage'>
      <div class='cfi-card' data-cfi>
        <div class='cfi-header'><span class='cfi-title'>Upcoming payments</span></div>
        <div class='cfi-sub'>Next 10 days</div>
        <div class='cfi-row'><div class='cfi-icon' style='background:#3a7ad0'>D</div><div class='cfi-row-name'>Dahl Bank</div><div class='cfi-row-val'>$1,354</div></div>
        <div class='cfi-row'><div class='cfi-icon' style='background:#8b6c4a'>R</div><div class='cfi-row-name'>Rice Flower Co-op</div><div class='cfi-row-val'>$99.99</div></div>
        <div class='cfi-row'><div class='cfi-icon' style='background:#e8a0b0'>Y</div><div class='cfi-row-name'>Go-Go Yoga</div><div class='cfi-row-val'>$65.00</div></div>
      </div>
    </div>`,
    init(card) {
      const c = card.querySelector("[data-cfi]")
      const rows = c.querySelectorAll(".cfi-row")
      gsap.set(c, { opacity: 1, y: 0, scale: 1 })
      gsap.set(rows, { opacity: 1, x: 0 })
      return () => {
        gsap.killTweensOf([c, ...rows])
        gsap.set(c, { opacity: 0, y: 24, scale: 0.97 })
        gsap.set(rows, { opacity: 0, y: 8 })
        gsap.to(c, { opacity: 1, y: 0, scale: 1, duration: 0.65, ease: "expo.out", delay: 0.5 })
        rows.forEach((r, i) => {
          gsap.to(r, { opacity: 1, y: 0, duration: 0.35, ease: "power2.out", delay: 0.85 + i * 0.12 })
        })
      }
    }
  },

  {
    id: "spinner-to-dot", isNew: true, cat: "UI", display: "Spinner to Dot",
    source: ["chatgpt-personal-finance"],
    desc: "Accounts sync one by one: spinning arc becomes a green dot on completion. ChatGPT Plaid connection flow.",
    html: `<div class='std-stage'>
      <div class='std-header'><div class='std-header-icon'><svg viewBox='0 0 12 12'><rect x='2' y='2' width='3' height='3' rx='0.5'/><rect x='7' y='2' width='3' height='3' rx='0.5'/><rect x='2' y='7' width='3' height='3' rx='0.5'/><rect x='7' y='7' width='3' height='3' rx='0.5'/></svg></div>Connecting with Plaid</div>
      <div class='std-list'>
        <div class='std-item' data-std><div class='std-item-icon' style='background:#016fd0'>AE</div><div class='std-item-name'>American Express<div class='std-item-sub'>1 account</div></div><div class='std-status' data-std-status><span class='std-spinner' data-std-spin style='animation:std-spin 0.7s linear infinite'></span>Syncing</div></div>
        <div class='std-item' data-std><div class='std-item-icon' style='background:#c41230'>BA</div><div class='std-item-name'>Bank of America<div class='std-item-sub'>2 accounts</div></div><div class='std-status' data-std-status><span class='std-spinner' data-std-spin style='animation:std-spin 0.7s linear infinite'></span>Syncing</div></div>
        <div class='std-item' data-std><div class='std-item-icon' style='background:#00a3de'>CS</div><div class='std-item-name'>Charles Schwab<div class='std-item-sub'>1 account</div></div><div class='std-status' data-std-status><span class='std-spinner' data-std-spin style='animation:std-spin 0.7s linear infinite'></span>Syncing</div></div>
        <div class='std-item' data-std><div class='std-item-icon' style='background:#6b3fa0'>ET</div><div class='std-item-name'>Etrade<div class='std-item-sub'>1 account</div></div><div class='std-status' data-std-status><span class='std-spinner' data-std-spin style='animation:std-spin 0.7s linear infinite'></span>Syncing</div></div>
        <div class='std-item' data-std><div class='std-item-icon' style='background:#368727'>FI</div><div class='std-item-name'>Fidelity<div class='std-item-sub'>1 account</div></div><div class='std-status' data-std-status><span class='std-spinner' data-std-spin style='animation:std-spin 0.7s linear infinite'></span>Syncing</div></div>
        <div class='std-item' data-std><div class='std-item-icon' style='background:#00c805'>RH</div><div class='std-item-name'>Robinhood<div class='std-item-sub'>1 account</div></div><div class='std-status' data-std-status><span class='std-spinner' data-std-spin style='animation:std-spin 0.7s linear infinite'></span>Syncing</div></div>
      </div>
    </div>`,
    init(card) {
      const items = card.querySelectorAll("[data-std]")
      const statuses = card.querySelectorAll("[data-std-status]")
      const spinners = card.querySelectorAll("[data-std-spin]")
      let timers = []
      const restore = () => {
        statuses.forEach(s => { s.innerHTML = "<span class='std-spinner' data-std-spin style='animation:std-spin 0.7s linear infinite'></span>Syncing" })
        gsap.set(items, { opacity: 1, x: 0 })
      }
      restore()
      items.forEach(item => { gsap.set(item, { opacity: 1 }) })
      return () => {
        timers.forEach(t => clearTimeout(t))
        timers = []
        gsap.killTweensOf(items)
        gsap.set(items, { opacity: 0, x: 20 })
        restore()
        items.forEach((item, i) => {
          gsap.to(item, { opacity: 1, x: 0, duration: 0.3, ease: "power2.out", delay: 0.3 + i * 0.15 })
          const status = item.querySelector("[data-std-status]")
          timers.push(setTimeout(() => {
            status.innerHTML = "<span class='std-check'></span><span style='color:#2e9b66;font-weight:600'>Synced</span>"
          }, 1200 + i * 400))
        })
      }
    }
  },

  {
    id: "chat-input-typing", isNew: true, cat: "Chat", display: "Chat Input Typing",
    source: ["claude-code-agent-view","chatgpt-personal-finance"],
    desc: "ChatGPT composer input bar with text typing character-by-character, bar width growing to accommodate. Send button right, plus button left.",
    html: `<div class='cit-stage'>
      <div class='cit-plus'>+</div>
      <div class='cit-bar' data-cit-bar>
        <div class='cit-text' data-cit-text></div>
        <div class='cit-send'><svg viewBox='0 0 16 16'><path d='M8 12V4M8 4L4 8M8 4l4 4'/></svg></div>
      </div>
    </div>`,
    init(card) {
      const bar = card.querySelector("[data-cit-bar]")
      const text = card.querySelector("[data-cit-text]")
      const msg = "Am I paying for subscriptions I don't need?"
      let timer = null
      text.textContent = msg
      return () => {
        if (timer) clearInterval(timer)
        text.textContent = ""
        let idx = 0
        timer = setInterval(() => {
          if (idx < msg.length) {
            text.textContent = msg.slice(0, idx + 1)
            idx++
          } else {
            clearInterval(timer)
            timer = null
          }
        }, 45)
      }
    }
  },

  {
    id: "chat-conversation", isNew: true, cat: "Chat", display: "Chat Conversation",
    source: ["claude-code-agent-view","chatgpt-personal-finance"],
    desc: "User bubble + streaming assistant response with tool-use indicator. ChatGPT conversation flow.",
    html: `<div class='ccv-stage'>
      <div class='ccv-user' data-ccv-user>Am I paying for subscriptions I don't need?</div>
      <div class='ccv-tool' data-ccv-tool>Querying financial data</div>
      <div class='ccv-response' data-ccv-resp></div>
      <div class='ccv-actions' data-ccv-actions>
        <svg class='ccv-act' viewBox='0 0 16 16'><rect x='5.5' y='5.5' width='7.5' height='7.5' rx='1.5'/><path d='M3 10.5V4.2A1.2 1.2 0 0 1 4.2 3h6.3'/></svg>
        <svg class='ccv-act' viewBox='0 0 16 16'><path d='M3.5 6.2v3.6h2L8.5 12V4L5.5 6.2h-2z'/><path d='M11 5.5a3.5 3.5 0 0 1 0 5'/></svg>
        <svg class='ccv-act' viewBox='0 0 16 16'><path d='M4.5 7.5v5.5M4.5 7.5l2.4-4.3a1.3 1.3 0 0 1 1.7 1.6l-.8 2.2h3.6a1 1 0 0 1 1 1.25l-.95 3.7a1.2 1.2 0 0 1-1.15.95H4.5'/></svg>
        <svg class='ccv-act' viewBox='0 0 16 16'><path d='M11.5 8.5V3M11.5 8.5l-2.4 4.3a1.3 1.3 0 0 1-1.7-1.6l.8-2.2H4.6a1 1 0 0 1-1-1.25l.95-3.7A1.2 1.2 0 0 1 5.7 2H11.5'/></svg>
        <svg class='ccv-act' viewBox='0 0 16 16'><path d='M12.5 8a4.5 4.5 0 1 1-1.4-3.25M12.5 2.5v3h-3'/></svg>
        <svg class='ccv-act' viewBox='0 0 16 16'><path d='M8 10.2V3.2M8 3.2 5.5 5.7M8 3.2l2.5 2.5M3.8 9v3.2a1 1 0 0 0 1 1h6.4a1 1 0 0 0 1-1V9'/></svg>
      </div>
    </div>`,
    init(card) {
      const user = card.querySelector("[data-ccv-user]")
      const tool = card.querySelector("[data-ccv-tool]")
      const resp = card.querySelector("[data-ccv-resp]")
      const actions = card.querySelector("[data-ccv-actions]")
      const fullResp = `I can see you're paying for <span class='ccv-bold'>4 fitness memberships.</span> Since your new job has you back in the office, you might consider only taking classes at your local gym. Canceling would save <span class='ccv-bold'>$329/month.</span>`
      const plain = "I can see you're paying for 4 fitness memberships. Since your new job has you back in the office, you might consider only taking classes at your local gym. Canceling would save $329/month."
      const startDelay = 1200
      resp.innerHTML = fullResp
      gsap.set(user, { opacity: 1, y: 0 })
      gsap.set(tool, { opacity: 0.5 })
      gsap.set(actions, { opacity: 1, y: 0 })
      let timer = null, iv = null
      return () => {
        // clear any in-flight stream so a re-trigger (hover) never races two streams
        if (timer) { clearTimeout(timer); timer = null }
        if (iv) { clearInterval(iv); iv = null }
        gsap.killTweensOf([user, tool, resp, actions])
        gsap.set(user, { opacity: 0, y: 10 })
        gsap.set(tool, { opacity: 0 })
        gsap.set(actions, { opacity: 0, y: 4 })
        resp.innerHTML = ""
        gsap.to(user, { opacity: 1, y: 0, duration: 0.3, ease: "power2.out", delay: 0.3 })
        gsap.to(tool, { opacity: 0.5, duration: 0.3, delay: 0.8 })
        timer = setTimeout(() => {
          gsap.to(tool, { opacity: 0, duration: 0.2 })
          let ci = 0
          iv = setInterval(() => {
            if (ci < plain.length) {
              const partial = plain.slice(0, ci + 1)
              resp.innerHTML = partial
                .replace(/4 fitness memberships\./g, "<span class='ccv-bold'>4 fitness memberships.</span>")
                .replace(/\$329\/month\./g, "<span class='ccv-bold'>$329/month.</span>")
              ci += 1 + Math.floor(Math.random() * 2)
            } else {
              resp.innerHTML = fullResp
              clearInterval(iv); iv = null
              gsap.to(actions, { opacity: 1, y: 0, duration: 0.3, ease: "power2.out" })
            }
          }, 25)
        }, startDelay)
      }
    }
  },

  {
    id: "inline-card-render", isNew: true, cat: "Chat", display: "Inline Card Render",
    source: ["chatgpt-personal-finance"],
    desc: "A rich card with chart data materializes inside a text response. ChatGPT portfolio distribution in-context.",
    html: `<div class='icr-stage'>
      <div class='icr-prose' data-icr-prose>Your portfolio may be <span class='icr-bold'>less balanced than it looks.</span></div>
      <div class='icr-card' data-icr-card>
        <div class='icr-card-title'>Portfolio distribution</div>
        <div class='icr-card-val'>$102,938</div>
        <div class='icr-card-sub'>5 holdings across 3 accounts</div>
        <div class='icr-card-row'><span class='icr-card-dot' style='background:#1a5e3a'></span>Stocks<div class='icr-card-bar'><div class='icr-card-bar-fill' data-icr-fill style='background:#1a5e3a;width:47%'></div></div><span class='icr-card-amt'>$48,512</span></div>
        <div class='icr-card-row'><span class='icr-card-dot' style='background:#2e9b66'></span>ETFs<div class='icr-card-bar'><div class='icr-card-bar-fill' data-icr-fill style='background:#2e9b66;width:19%'></div></div><span class='icr-card-amt'>$19,134</span></div>
        <div class='icr-card-row'><span class='icr-card-dot' style='background:#5fcc88'></span>Bonds<div class='icr-card-bar'><div class='icr-card-bar-fill' data-icr-fill style='background:#5fcc88;width:18%'></div></div><span class='icr-card-amt'>$18,354</span></div>
        <div class='icr-card-row'><span class='icr-card-dot' style='background:#a8e6cf'></span>Crypto<div class='icr-card-bar'><div class='icr-card-bar-fill' data-icr-fill style='background:#a8e6cf;width:10%'></div></div><span class='icr-card-amt'>$10,736</span></div>
        <div class='icr-card-row'><span class='icr-card-dot' style='background:#87ceeb'></span>Cash<div class='icr-card-bar'><div class='icr-card-bar-fill' data-icr-fill style='background:#87ceeb;width:6%'></div></div><span class='icr-card-amt'>$6,200</span></div>
      </div>
    </div>`,
    init(card) {
      const prose = card.querySelector("[data-icr-prose]")
      const crd = card.querySelector("[data-icr-card]")
      const fills = card.querySelectorAll("[data-icr-fill]")
      const rows = crd.querySelectorAll(".icr-card-row")
      const widths = ["47%", "19%", "18%", "10%", "6%"]
      gsap.set(prose, { opacity: 1 })
      gsap.set(crd, { opacity: 1, y: 0, scale: 1 })
      gsap.set(rows, { opacity: 1, x: 0 })
      fills.forEach((f, i) => { f.style.width = widths[i] })
      return () => {
        gsap.killTweensOf([prose, crd, ...rows, ...fills])
        gsap.set(prose, { opacity: 0, y: 6 })
        gsap.set(crd, { opacity: 0, y: 16, scale: 0.95 })
        gsap.set(rows, { opacity: 0, x: 10 })
        fills.forEach(f => { f.style.width = "0%" })
        gsap.to(prose, { opacity: 1, y: 0, duration: 0.35, ease: "power2.out", delay: 0.3 })
        gsap.to(crd, { opacity: 1, y: 0, scale: 1, duration: 0.45, ease: "power3.out", delay: 0.8 })
        rows.forEach((r, i) => {
          gsap.to(r, { opacity: 1, x: 0, duration: 0.3, ease: "power2.out", delay: 1.0 + i * 0.1 })
        })
        fills.forEach((f, i) => {
          gsap.to(f, { width: widths[i], duration: 0.5, ease: "power2.out", delay: 1.1 + i * 0.1 })
        })
      }
    }
  },

  {
    id: "scroll-reveal", isNew: true, cat: "Chat", display: "Scroll Reveal",
    source: ["claude-code-agent-view","chatgpt-personal-finance"],
    desc: "Viewport pans vertically to reveal off-screen content below the fold. ChatGPT long-response auto-scroll.",
    html: `<div class='srv-stage'>
      <div class='srv-inner' data-srv>
        <div class='srv-heading'>Where you stand today</div>
        <div class='srv-para'>You've got about <b>$143K cash</b>, or <b>$128K</b> after paying off credit cards. Your take-home income is roughly <b>$11.4K/month</b>.</div>
        <div class='srv-para'>Mortgage rates remain high, around the <b>mid-6% range</b>. Chicago home prices are way more reasonable than in coastal markets.</div>
        <div class='srv-heading' style='margin-top:6px'>Phase 1: savings buckets</div>
        <table class='srv-table'>
          <tr><th>Bucket</th><th class='srv-val'>Target</th></tr>
          <tr><td>Emergency fund</td><td class='srv-val'>$45K</td></tr>
          <tr><td>Down payment</td><td class='srv-val'>$80K-$140K</td></tr>
          <tr><td>Closing/repairs</td><td class='srv-val'>~$20K</td></tr>
        </table>
        <div class='srv-heading' style='margin-top:8px'>Phase 2: Next 3-6 months</div>
        <div class='srv-para'>Choose your buying lane based on your risk tolerance and timeline.</div>
      </div>
    </div>`,
    init(card) {
      const inner = card.querySelector("[data-srv]")
      gsap.set(inner, { y: 0 })
      return () => {
        gsap.killTweensOf(inner)
        gsap.set(inner, { y: 0 })
        const tl = gsap.timeline({ delay: 0.8 })
        tl.to(inner, { y: -60, duration: 1.5, ease: "power1.inOut" })
        tl.to(inner, { y: -130, duration: 1.5, ease: "power1.inOut" }, "+=0.6")
        tl.to(inner, { y: 0, duration: 0.8, ease: "power2.out" }, "+=1.2")
      }
    }
  },

  /* ============================================================
     NEW (2026-05-30) — from ChatGPT personal-finance rewatch
     ============================================================ */

  {
    id: "headline-type-on", isNew: true, cat: "Text", display: "Headline Type-On",
    source: ["chatgpt-personal-finance"],
    desc: "Large centered display headline types in character by character on a clean cream surface. No chrome around it. ChatGPT finance video uses this 4x as connective tissue between demo beats.",
    html: `<div class='vp-stage hto-stage'>
  <div class='hto-line'>
    <span class='hto-headline' data-headline></span>
  </div>
</div>`,
    init(card) {
      const headline = card.querySelector('[data-headline]')
      const TEXT = 'see where your money is going'

      // Build per-character spans plus a trailing caret span (the caret lives INSIDE
      // the headline so it always follows the last typed char and the whole unit
      // stays centered). Spaces use a literal space inside .hto-char (white-space:pre).
      if (!headline.dataset.split) {
        const charsHtml = TEXT.split('').map(c =>
          `<span class="hto-char">${c === ' ' ? ' ' : c}</span>`
        ).join('')
        headline.innerHTML = charsHtml + '<span class="hto-caret" data-caret></span>'
        headline.dataset.split = '1'
      }
      const chars = Array.from(headline.querySelectorAll('.hto-char'))
      const caret = headline.querySelector('[data-caret]')
      const N = chars.length
      const line = card.querySelector('.hto-line')

      // Fit the headline to the card: the full sentence stays on one line (as the
      // reference does) but must not clip. Scale the font down from the CSS size only
      // when the typed-out line is wider than the available width. Re-fit after the
      // web font loads (metrics change). Measured with all chars shown.

      // Reveal up to `count` chars by toggling the display class. Driven by an
      // onUpdate so it is fully deterministic under frame-by-frame timeline scrubbing
      // (callbacks can be skipped on time() jumps; onUpdate fires every tick).
      function reveal(count) {
        const k = Math.max(0, Math.min(N, Math.floor(count)))
        for (let i = 0; i < N; i++) {
          if (i < k) chars[i].classList.add('is-on')
          else chars[i].classList.remove('is-on')
        }
      }

      function fit() {
        headline.style.fontSize = ""           // reset to the CSS size, then measure
        reveal(N)
        gsap.set(caret, { opacity: 1 })
        const avail = (line ? line.clientWidth : 0) - 6
        const w = headline.scrollWidth
        if (avail > 0 && w > avail) {
          const base = parseFloat(getComputedStyle(headline).fontSize) || 46
          headline.style.fontSize = (base * avail / w).toFixed(2) + "px"
        }
      }

      // Idle / resting state: full sentence visible, fitted, caret resting. This is what
      // the card shows before replay is triggered.
      fit()
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit)

      let tl = null
      return function replay() {
        if (tl) { tl.kill(); tl = null }

        // Reset to hidden: zero chars shown, caret on (the blinking cursor).
        reveal(0)
        gsap.set(caret, { opacity: 1 })

        const start = 0.35
        const perChar = 0.05               // ~20 chars/sec cadence, clearly legible
        const typeDur = N * perChar
        const typedDone = start + typeDur
        const counter = { v: 0 }
        tl = gsap.timeline()

        // Type each character on, one at a time, left to right (scrub-safe onUpdate).
        tl.to(counter, {
          v: N,
          duration: typeDur,
          ease: 'none',
          onUpdate: () => reveal(counter.v)
        }, start)

        // Caret blink during typing for texture (does not gate the type-on).
        tl.to(caret, {
          opacity: 0,
          duration: 0.001,
          repeat: Math.max(1, Math.floor(typedDone / 0.45)),
          yoyo: true,
          repeatDelay: 0.45,
          ease: 'none'
        }, start)

        // Settle caret on, hold the full sentence ~1.3s, then fade caret out.
        tl.set(caret, { opacity: 1 }, typedDone)
        tl.to(caret, { opacity: 0, duration: 0.35, ease: 'power1.out' }, typedDone + 1.3)

        // Return to idle resting state (full sentence visible, caret on).
        tl.call(() => reveal(N), [], typedDone + 1.8)
        tl.set(caret, { opacity: 1 }, typedDone + 1.8)
        return tl
      }
    }
  },

  {
    id: "meter-rows", isNew: true, cat: "Data Viz", display: "Meter Rows",
    source: ["chatgpt-personal-finance"],
    desc: "List of category rows, each row pairs an icon + label + thin inline fill-bar + right-aligned value. Rows stagger in top to bottom; each fill-bar animates 0 to width after its row lifts. ChatGPT finance video uses this for spending categories and portfolio holdings.",
    html: `<div class='vp-stage'>
  <div class='mr-card' data-mr-card>
    <div class='mr-head'>
      <span class='mr-title'>Spending by category</span>
      <span class='mr-sub'>this month</span>
    </div>
    <div class='mr-rows' data-mr-rows></div>
  </div>
</div>`,
    init(card) {
      const rowsWrap = card.querySelector("[data-mr-rows]")

      // Spending list from the ChatGPT finance video (14.7 to 16.1).
      // Bars are proportional to the largest value (Rent at 100%).
      const data = [
        { label: "Rent",          value: "$1,850", pct: 100 },
        { label: "Subscriptions", value: "$630",   pct: 34 },
        { label: "Groceries",     value: "$620",   pct: 34 },
        { label: "Miscellaneous", value: "$580",   pct: 31 },
        { label: "Medical",       value: "$410",   pct: 22 },
        { label: "Transit",       value: "$215",   pct: 12 }
      ]

      rowsWrap.innerHTML = data.map(d => (
        "<div class='mr-row' data-mr-row>" +
          "<span class='mr-icon'></span>" +
          "<span class='mr-label'>" + d.label + "</span>" +
          "<span class='mr-bar'><span class='mr-fill' data-mr-fill></span></span>" +
          "<span class='mr-value'>" + d.value + "</span>" +
        "</div>"
      )).join("")

      const rows = rowsWrap.querySelectorAll("[data-mr-row]")
      const fills = rowsWrap.querySelectorAll("[data-mr-fill]")

      // Idle resting state: rows visible, bars filled to their target width.
      gsap.set(rows, { opacity: 1, y: 0 })
      fills.forEach((f, i) => gsap.set(f, { width: data[i].pct + "%" }))

      let tl = null

      return function replay() {
        if (tl) { tl.kill(); tl = null }

        // Hidden start: rows lifted + faded, bars empty.
        gsap.set(rows, { opacity: 0, y: 14 })
        gsap.set(fills, { width: "0%" })

        tl = gsap.timeline()

        rows.forEach((row, i) => {
          const at = i * 0.12
          // Row lifts in.
          tl.to(row, { opacity: 1, y: 0, duration: 0.34, ease: "power2.out" }, at)
          // Fill animates 0 to its width just after the row settles.
          tl.to(fills[i], { width: data[i].pct + "%", duration: 0.42, ease: "power2.out" }, at + 0.18)
        })

        // Hold the final state so the data is readable (~1.6s).
        tl.to({}, { duration: 1.6 })

        return tl
      }
    }
  },

  {
    id: "composer-commit", isNew: true, cat: "Chat", display: "Composer Commit",
    source: ["claude-code-agent-view","chatgpt-personal-finance"],
    desc: "Chat composer input pill lifts from bottom-center and anchors as a sent user bubble top-right; the + and send icons drop away as it travels. Bridges chat-input-typing to chat-conversation. ChatGPT finance video, 3 question commits.",
    html: `<div class='vp-stage'>
  <div class='cc-scene'>
    <!-- target slot where the sent bubble anchors (top-right) -->
    <div class='cc-slot' data-cc-slot></div>

    <!-- the composer pill: idle state shows full chrome with text already typed -->
    <div class='cc-pill' data-cc-pill>
      <div class='cc-plus' data-cc-plus>+</div>
      <div class='cc-text' data-cc-text>Am I paying for subscriptions I don't need?</div>
      <div class='cc-send' data-cc-send>
        <svg viewBox='0 0 16 16'><path d='M8 12V4M8 4L4 8M8 4l4 4'/></svg>
      </div>
    </div>
  </div>
</div>`,
    init(card) {
      const pill = card.querySelector("[data-cc-pill]")
      const plus = card.querySelector("[data-cc-plus]")
      const send = card.querySelector("[data-cc-send]")
      const text = card.querySelector("[data-cc-text]")

      const scene = card.querySelector(".cc-scene")
      const idleWidthPct = 80           // matches css .cc-pill width
      const bubbleWidthPct = 58         // ~27% narrower on arrival
      const MARGIN = 22                 // gap from the top/right walls the bubble anchors to

      // Travel is MEASURED from the live stage so it tracks any card size (the dashboard
      // viewport is ~360x240, not the 640x360 build preview, where a hardcoded -226 lift
      // flung the bubble off the top). gsap x/y are ADDITIONAL offsets on the pill's
      // translateX(-50%) / bottom:30px baseline.
      let travelX = 0, travelY = 0
      function computeTravel() {
        const sr = scene.getBoundingClientRect()
        const pr = pill.getBoundingClientRect()   // measured at idle (width 80%, bottom-centre)
        if (sr.width === 0 || pr.height === 0) return
        const bubbleW = sr.width * bubbleWidthPct / 100
        // horizontal: idle centre is the stage centre; target centre sits so the bubble's
        // right edge is MARGIN from the right wall.
        travelX = (sr.width - MARGIN - bubbleW / 2) - sr.width / 2
        // vertical: idle centre = height - 30 - pillH/2; target centre = MARGIN + pillH/2.
        travelY = (MARGIN + pr.height / 2) - (sr.height - 30 - pr.height / 2)
      }

      function setIdle() {
        pill.classList.remove("cc-bubble")
        gsap.set(pill, { x: 0, y: 0, width: idleWidthPct + "%", opacity: 1 })
        gsap.set([plus, send], { opacity: 1, scale: 1 })
        gsap.set(text, { opacity: 1 })
      }

      setIdle()

      let tl = null
      return function replay() {
        if (tl) { tl.kill(); tl = null }
        setIdle()
        computeTravel()   // measure against the current stage size before animating

        // Timeline is paced for perception: a clear hold on the bottom-center composer,
        // a long visible TRAVEL up to the top-right, then a long hold on the settled
        // user bubble. Frame samplers must catch all three phases.
        tl = gsap.timeline({ defaults: { ease: "power2.inOut" } })

        // 0.0 to 0.7s: HOLD. Idle composer pill at bottom-center, full chrome visible.
        tl.to(pill, { x: 0, duration: 0.7 }, 0)

        // 0.7s: the "+" and send chrome cross-fade out as the lift begins (first ~30%
        // of the travel), so the input chrome visibly drops away while the pill moves.
        tl.to([plus, send], {
          opacity: 0,
          scale: 0.5,
          duration: 0.34,
          ease: "power1.in"
        }, 0.7)

        // 0.78 to 1.98s: the pill TRAVELS. A single long eased x/y/width tween reads as
        // a smooth arc lifting from the bottom and flying to the upper-right, shrinking
        // in width as it goes. 1.2s of motion so mid-flight frames get sampled.
        tl.to(pill, {
          x: travelX,
          y: travelY,
          width: bubbleWidthPct + "%",
          duration: 1.2,
          ease: "power2.inOut"
        }, 0.78)

        // ~1.75s: reshape into the user message bubble as it nears the slot. The radius
        // and darker fill snap reads as "this is now a sent message".
        tl.add(() => { pill.classList.add("cc-bubble") }, 1.62)

        // 1.98s: small settle so the bubble feels anchored, not floating.
        tl.to(pill, { y: travelY + 5, duration: 0.16, ease: "power2.out" }, 1.98)
        tl.to(pill, { y: travelY,     duration: 0.20, ease: "power1.inOut" }, 2.14)

        // 2.34 to 4.0s: HOLD. The bubble stays anchored top-right. Final state IS the
        // resting state, no snap back to the bottom.
        tl.to(pill, { y: travelY, duration: 1.66 }, 2.34)

        return tl
      }
    }
  },

  {
    id: "status-cycle", isNew: true, cat: "Chat", display: "Status Cycle",
    source: ["chatgpt-personal-finance"],
    desc: "Inline gray status line cycles Thinking, Querying, Received, Thought for Ns with a left-to-right shimmer band over the active labels. Final settled state is the collapsible Thought-for chevron. ChatGPT finance video reasoning indicator.",
    html: `<div class='vp-stage'>
  <div class='sc-wrap'>
    <div class='sc-bubble'>
      <div class='sc-userline'>Am I paying for subscriptions I don't need?</div>
    </div>
    <div class='sc-statusrow'>
      <span class='sc-dot' data-sc-dot></span>
      <span class='sc-line' data-sc-line>
        <span class='sc-label' data-sc-label>Thought for 7s</span>
        <span class='sc-chev' data-sc-chev>&rsaquo;</span>
        <span class='sc-shimmer' data-sc-shimmer></span>
      </span>
    </div>
    <div class='sc-resp' data-sc-resp>Here is a breakdown of your recurring charges.</div>
  </div>
</div>`,
    init(card) {
      const line = card.querySelector("[data-sc-line]")
      const label = card.querySelector("[data-sc-label]")
      const chev = card.querySelector("[data-sc-chev]")
      const shimmer = card.querySelector("[data-sc-shimmer]")
      const dot = card.querySelector("[data-sc-dot]")
      const resp = card.querySelector("[data-sc-resp]")

      // The label sequence. The first three are transient reasoning states;
      // the last is the final settled, collapsible "Thought for Ns" state.
      // active=true means the shimmer band sweeps across the text while it shows.
      const states = [
        { text: "Thinking",                 chev: false, active: true,  hold: 0.7 },
        { text: "Querying financial data",  chev: false, active: true,  hold: 0.9 },
        { text: "Received financial data",  chev: false, active: false, hold: 0.7 },
        { text: "Thought for 7s",           chev: true,  active: false, hold: 0.0 }
      ]
      const finalState = states[states.length - 1]

      let tl = null
      let shimmerTween = null
      let dotTween = null

      function stopShimmer() {
        if (shimmerTween) { shimmerTween.kill(); shimmerTween = null }
        gsap.set(shimmer, { opacity: 0, xPercent: 0 })
      }
      function startShimmer() {
        stopShimmer()
        // sweep the highlight band from off the left edge to off the right edge,
        // looping forever while the active state is held.
        gsap.set(shimmer, { opacity: 1, xPercent: -100 })
        shimmerTween = gsap.to(shimmer, {
          xPercent: 230,
          duration: 0.9,
          ease: "power1.inOut",
          repeat: -1
        })
      }
      function stopDot() {
        if (dotTween) { dotTween.kill(); dotTween = null }
      }
      function startDotPulse() {
        stopDot()
        gsap.set(dot, { opacity: 1, scale: 1 })
        dotTween = gsap.to(dot, {
          opacity: 0.35,
          scale: 0.7,
          duration: 0.55,
          ease: "sine.inOut",
          repeat: -1,
          yoyo: true
        })
      }

      function applySettled() {
        // resting state shown on first render and at end of replay
        stopShimmer()
        stopDot()
        label.textContent = finalState.text
        gsap.set(label, { opacity: 1 })
        gsap.set(chev, { opacity: 1, display: "inline-block" })
        gsap.set(dot, { opacity: 0, scale: 1 })
        gsap.set(line, { opacity: 1 })
        gsap.set(resp, { opacity: 1, y: 0 })
      }

      // IDLE: final settled "Thought for 7s >" state
      applySettled()

      return function replay() {
        if (tl) { tl.kill(); tl = null }
        stopShimmer()
        stopDot()

        // reset to the very first reasoning state, response hidden
        label.textContent = states[0].text
        gsap.set(label, { opacity: 1 })
        gsap.set(chev, { opacity: 0, display: "none" })
        gsap.set(dot, { opacity: 1, scale: 1 })
        gsap.set(line, { opacity: 0 })
        gsap.set(resp, { opacity: 0, y: 6 })
        gsap.set(shimmer, { opacity: 0, xPercent: -100 })

        tl = gsap.timeline()

        // line + dot fade in
        tl.to(line, { opacity: 1, duration: 0.25, ease: "power2.out" }, 0)
        tl.call(startDotPulse, null, 0)

        let t = 0.25
        states.forEach((st, i) => {
          const isLast = i === states.length - 1
          // when entering a new state (after the first), fade out old text, swap, fade in
          if (i > 0) {
            tl.to(label, { opacity: 0, duration: 0.15, ease: "power1.in" }, t)
            tl.call(() => {
              label.textContent = st.text
              if (st.chev) { gsap.set(chev, { display: "inline-block", opacity: 0 }) }
            }, null, t + 0.15)
            tl.to(label, { opacity: 1, duration: 0.15, ease: "power1.out" }, t + 0.15)
            if (st.chev) tl.to(chev, { opacity: 1, duration: 0.2, ease: "power2.out" }, t + 0.15)
            t += 0.3
          }
          // toggle shimmer for this state
          tl.call(st.active ? startShimmer : stopShimmer, null, t)
          if (isLast) {
            // settle: dot fades away, response appears
            tl.call(stopDot, null, t)
            tl.to(dot, { opacity: 0, duration: 0.3, ease: "power1.out" }, t)
            tl.to(resp, { opacity: 1, y: 0, duration: 0.35, ease: "power2.out" }, t + 0.1)
          }
          t += st.hold
        })

        return tl
      }
    }
  },

  {
    id: "logo-mark-signoff", isNew: true, cat: "Camera", display: "Logo Mark Signoff",
    source: ["claude-code-fast-mode","claude-code-agent-view","claude-financial-services","chatgpt-personal-finance"],
    desc: "Brand sign-off: wordmark crossfades to a monoline geometric mark that scales up and strokes in, with a fixed disclaimer line held beneath. Used as the outro pattern in the ChatGPT finance video.",
    html: `<div class='vp-stage lms-stage'>
  <div class='lms-frame'>
    <div class='lms-slot'>
      <div class='lms-wm' data-wm>lumiere</div>
      <svg class='lms-mark' data-mark viewBox='0 0 100 100' width='112' height='112' fill='none' aria-hidden='true'>
        <g data-mark-paths stroke='var(--ink)' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'>
          <circle class='lms-arc' data-arc cx='50' cy='50' r='30'></circle>
          <circle class='lms-arc' data-arc cx='50' cy='50' r='20'></circle>
          <circle class='lms-arc' data-arc cx='50' cy='50' r='10'></circle>
          <line class='lms-arc' data-arc x1='50' y1='8' x2='50' y2='92'></line>
          <line class='lms-arc' data-arc x1='8' y1='50' x2='92' y2='50'></line>
        </g>
      </svg>
    </div>
    <div class='lms-disclaimer' data-disclaimer>Not a replacement for professional advice.</div>
  </div>
</div>`,
    init(card) {
      const wordmark   = card.querySelector('[data-wm]')
      const mark       = card.querySelector('[data-mark]')
      const disclaimer = card.querySelector('[data-disclaimer]')
      const arcs       = Array.from(card.querySelectorAll('[data-arc]'))

      // measure each stroke path length for the dasharray draw-in
      const lengths = arcs.map(a => {
        const len = (typeof a.getTotalLength === 'function') ? a.getTotalLength() : 220
        return (len && isFinite(len) && len > 0) ? len : 220
      })

      function setStrokeDrawn() {
        // mark fully strokes-in (visible final state)
        arcs.forEach((a, i) => {
          gsap.set(a, { strokeDasharray: lengths[i], strokeDashoffset: 0 })
        })
      }
      function setStrokeHidden() {
        // mark hidden behind its own dash gap, ready to draw in
        arcs.forEach((a, i) => {
          gsap.set(a, { strokeDasharray: lengths[i], strokeDashoffset: lengths[i] })
        })
      }

      // IDLE = final state: wordmark gone, mark fully visible + strokes drawn, disclaimer held
      function applyIdle() {
        gsap.set(wordmark,   { opacity: 0 })
        gsap.set(mark,       { opacity: 1, scale: 1, transformOrigin: '50% 50%' })
        gsap.set(disclaimer, { opacity: 1 })
        setStrokeDrawn()
      }
      applyIdle()

      let tl = null

      return function replay() {
        if (tl) { tl.kill(); tl = null }

        // rest the scene to its START state (wordmark visible, mark hidden + un-drawn)
        gsap.set(wordmark,   { opacity: 1 })
        gsap.set(mark,       { opacity: 0, scale: 0.6, transformOrigin: '50% 50%' })
        gsap.set(disclaimer, { opacity: 1 }) // disclaimer holds the ENTIRE time
        setStrokeHidden()

        tl = gsap.timeline()

        // hold the wordmark so the viewer reads it
        tl.to(wordmark, { opacity: 1, duration: 0.5, ease: 'none' }, 0)

        // SIMULTANEOUS crossfade: wordmark fades out while mark fades + scales in
        tl.to(wordmark, { opacity: 0, duration: 0.6, ease: 'power2.in' }, 0.5)
        tl.to(mark,     { opacity: 1, duration: 0.6, ease: 'power3.out' }, 0.5)
        tl.to(mark,     { scale: 1, duration: 0.6, ease: 'power3.out' }, 0.5)

        // stroke-in: each concentric arc draws from gap to full, slightly staggered
        arcs.forEach((a, i) => {
          tl.to(a, { strokeDashoffset: 0, duration: 0.7, ease: 'power2.out' }, 0.55 + i * 0.07)
        })

        // hold the final state ~1.5s
        tl.to({}, { duration: 1.5 }, 1.45)

        // reset back to idle (final mark state) at the end
        tl.add(applyIdle, 3.1)
        return tl
      }
    }
  },

  {
    id: "pixel-mascot-idle-bob", isNew: true, cat: "Motion", display: "Pixel Mascot Idle Bob",
    source: ["claude-code-fast-mode", "claude-code-goal", "claude-code-agent-view", "claude-code-push-notifications", "claude-code-ultrareview", "claude-code-session-recaps", "code-w-claude-conf"],
    desc: "The terracotta pixel-art Claude critter idles: a continuous low-amplitude sine bob with feet anchored, discrete eye blinks, and occasional eye-look glances. The always-on liveliness sprite every other mascot effect layers onto, from the Claude Code launch clips.",
    html: `<div class='vp-stage pmb-stage'>
      <div class='pmb-mascot'>
        <svg class='pmb-svg' viewBox='0 0 32 30' aria-hidden='true'>
          <!-- ground shadow (static, anchors the feet) -->
          <ellipse class='pmb-shadow' cx='16' cy='28.2' rx='9' ry='1.6'></ellipse>
          <!-- legs (static, never bob) -->
          <g class='pmb-legs'>
            <rect x='10' y='24' width='3' height='3.4' rx='0.6'></rect>
            <rect x='19' y='24' width='3' height='3.4' rx='0.6'></rect>
          </g>
          <!-- bobbing group: body + arms + eyes -->
          <g class='pmb-bob' data-pmb-bob>
            <!-- arm nubs -->
            <rect class='pmb-arm' x='3.4' y='14' width='3.2' height='4.4' rx='1.4'></rect>
            <rect class='pmb-arm' x='25.4' y='14' width='3.2' height='4.4' rx='1.4'></rect>
            <!-- body -->
            <rect class='pmb-body' x='6' y='4' width='20' height='22' rx='5.5'></rect>
            <!-- top-left highlight band -->
            <rect class='pmb-hl' x='8.5' y='6.5' width='9' height='3' rx='1.5'></rect>
            <!-- eyes open (two square pixels) -->
            <g class='pmb-eyes-open' data-pmb-open>
              <rect class='pmb-eye' x='10.5' y='12.5' width='3.4' height='3.6' rx='0.5'></rect>
              <rect class='pmb-eye' x='18.1' y='12.5' width='3.4' height='3.6' rx='0.5'></rect>
            </g>
            <!-- eyes closed (thin slits, hidden at rest) -->
            <g class='pmb-eyes-closed' data-pmb-closed>
              <rect class='pmb-slit' x='10.5' y='14.4' width='3.4' height='1' rx='0.5'></rect>
              <rect class='pmb-slit' x='18.1' y='14.4' width='3.4' height='1' rx='0.5'></rect>
            </g>
          </g>
        </svg>
      </div>
    </div>`,
    init(card) {
      const bob    = card.querySelector("[data-pmb-bob]")
      const open   = card.querySelector("[data-pmb-open]")
      const closed = card.querySelector("[data-pmb-closed]")

      // discrete eye-state swaps (never smooth-tweened): blink = slits, open = squares
      function setOpen() {
        gsap.set(open,   { autoAlpha: 1 })
        gsap.set(closed, { autoAlpha: 0 })
      }
      // discrete look glance: shift the open-eye pixels left/right, snap (no smooth tween)
      function look(dx) {
        gsap.set(open, { x: dx })
      }

      // RESTING STATE: mascot fully visible, eyes open + centered, body at neutral.
      // This effect is an always-on liveliness layer, so init also starts the loop
      // so the card is never inert. The loop is a single scrubbable repeat:-1 timeline.
      gsap.set(bob, { y: 0, transformOrigin: "50% 100%" })
      setOpen()
      look(0)

      let tl = null

      function build() {
        if (tl) { tl.kill(); tl = null }
        gsap.killTweensOf([bob, open, closed])
        gsap.set(bob, { y: 0, transformOrigin: "50% 100%" })
        setOpen()
        look(0)

        // master loop: ~3.0s cycle, repeats forever. Bob is the only interpolated
        // channel; blink + eye-look are discrete zero-duration tl.set() children so
        // they SNAP (no smooth tween) per the mechanics AND reconstruct deterministically
        // at any tl.time(t) (tl.set is scrubbable; tl.call callbacks are not).
        tl = gsap.timeline({ repeat: -1 })

        // continuous sine bob: down-then-up across the cycle, feet anchored
        tl.to(bob, { y: -3, duration: 1.5, ease: "sine.inOut" }, 0)
        tl.to(bob, { y: 0,  duration: 1.5, ease: "sine.inOut" }, 1.5)

        // eye-look glance: drift right at top of the bob, hold, snap back to center
        tl.set(open, { x: 1.4 }, 0.85)
        tl.set(open, { x: 0   }, 1.65)

        // blink #1 -- slits collapse for ~0.1s then reopen (snap swaps)
        tl.set(open,   { autoAlpha: 0 }, 1.15)
        tl.set(closed, { autoAlpha: 1 }, 1.15)
        tl.set(open,   { autoAlpha: 1 }, 1.25)
        tl.set(closed, { autoAlpha: 0 }, 1.25)

        // blink #2 -- a second, later glance to the left + blink to feel alive
        tl.set(open,   { x: -1.4 },      2.15)
        tl.set(open,   { autoAlpha: 0 }, 2.45)
        tl.set(closed, { autoAlpha: 1 }, 2.45)
        tl.set(open,   { autoAlpha: 1 }, 2.55)
        tl.set(closed, { autoAlpha: 0 }, 2.55)
        tl.set(open,   { x: 0 },         2.85)

        return tl
      }

      // kick off the idle loop immediately so the resting card is already alive
      tl = build()

      return function replay() {
        return build()
      }
    }
  },

  {
    id: "mascot-prop-equip", isNew: true, cat: "Motion", display: "Mascot Prop Equip (swing/drop-on)",
    source: ["claude-code-fast-mode", "claude-code-ultrareview", "claude-code-agent-view", "code-w-claude-conf"],
    desc: "The pixel Claude critter gets kitted out: headphones swing onto its crown pivoting at the left earcup, then a detective magnifier tumbles down and seats with an overshoot and a one-frame body squash. From the Claude Code launch clips.",
    html: `<div class='vp-stage mpe-stage'>
      <div class='mpe-floor'>
        <svg class='mpe-mascot' data-mpe-mascot viewBox='0 0 100 100' width='118' height='118' aria-hidden='true' shape-rendering='crispEdges'>
          <!-- ground shadow -->
          <ellipse class='mpe-shadow' data-mpe-shadow cx='50' cy='90' rx='26' ry='5'></ellipse>

          <!-- BODY (terracotta critter) -->
          <g class='mpe-body' data-mpe-body>
            <!-- legs -->
            <rect x='38' y='78' width='8' height='10' rx='1.5' fill='#a8523c'></rect>
            <rect x='54' y='78' width='8' height='10' rx='1.5' fill='#a8523c'></rect>
            <!-- arm nubs -->
            <rect class='mpe-arm mpe-arm-l' x='17' y='52' width='10' height='9' rx='3' fill='#b85a44'></rect>
            <rect class='mpe-arm mpe-arm-r' data-mpe-arm-r x='73' y='52' width='10' height='9' rx='3' fill='#b85a44'></rect>
            <!-- torso -->
            <rect x='26' y='30' width='48' height='52' rx='11' fill='#c8674f'></rect>
            <rect x='30' y='33' width='40' height='20' rx='9' fill='#d96a4a' opacity='0.55'></rect>
            <!-- eyes -->
            <rect class='mpe-eye' x='38' y='50' width='8' height='9' rx='1.5' fill='#1a1714'></rect>
            <rect class='mpe-eye' x='54' y='50' width='8' height='9' rx='1.5' fill='#1a1714'></rect>
          </g>

          <!-- HEADPHONES (swing on, pivots near left cup) -->
          <g class='mpe-phones' data-mpe-phones>
            <!-- band arc over the crown -->
            <path class='mpe-band' d='M22 38 Q50 6 78 38' fill='none' stroke='#2d5b8e' stroke-width='6' stroke-linecap='round'></path>
            <!-- earcups -->
            <rect x='17' y='34' width='13' height='17' rx='4' fill='#244c77'></rect>
            <rect x='17' y='34' width='13' height='6' rx='3' fill='#3a6ea0' opacity='0.6'></rect>
            <rect x='70' y='34' width='13' height='17' rx='4' fill='#244c77'></rect>
            <rect x='70' y='34' width='13' height='6' rx='3' fill='#3a6ea0' opacity='0.6'></rect>
          </g>

          <!-- MAGNIFIER (drops on, into right hand) -->
          <g class='mpe-glass' data-mpe-glass>
            <!-- handle -->
            <rect x='86' y='66' width='6' height='20' rx='3' fill='#2B2722' transform='rotate(38 89 76)'></rect>
            <!-- lens rim -->
            <circle cx='80' cy='58' r='13' fill='none' stroke='#4B3A9E' stroke-width='5'></circle>
            <!-- glass -->
            <circle cx='80' cy='58' r='10' fill='#6B5FD6' opacity='0.18'></circle>
            <!-- glint -->
            <rect x='74' y='51' width='6' height='3' rx='1.5' fill='#efefe5' opacity='0.7' transform='rotate(-38 77 52.5)'></rect>
          </g>
        </svg>
        <div class='mpe-label'>equipped</div>
      </div>
    </div>`,
    init(card) {
      const mascot = card.querySelector("[data-mpe-mascot]")
      const body   = card.querySelector("[data-mpe-body]")
      const phones = card.querySelector("[data-mpe-phones]")
      const glass  = card.querySelector("[data-mpe-glass]")
      const shadow = card.querySelector("[data-mpe-shadow]")
      const armR   = card.querySelector("[data-mpe-arm-r]")

      // SVG groups need fill-box so percentage / local transform-origins resolve to the group's own bounds
      gsap.set([phones, glass, body], { transformBox: "fill-box" })

      // contentful rest: fully kitted out, props seated, idle bob neutral
      const applyRest = () => {
        gsap.set(mascot, { y: 0 })
        gsap.set(body,   { scaleX: 1, scaleY: 1, transformOrigin: "50% 100%" })
        gsap.set(phones, { autoAlpha: 1, rotation: 0, transformOrigin: "22% 70%" })
        gsap.set(glass,  { autoAlpha: 1, y: 0, rotation: 0, transformOrigin: "50% 0%" })
        gsap.set(armR,   { y: 0 })
        gsap.set(shadow, { scaleX: 1, transformOrigin: "50% 50%" })
      }
      applyRest()

      return function replay() {
        gsap.killTweensOf([mascot, body, phones, glass, armR, shadow])

        // pre-entrance: bare mascot, props off
        gsap.set(mascot, { y: 0 })
        gsap.set(body,   { scaleX: 1, scaleY: 1, transformOrigin: "50% 100%" })
        gsap.set(armR,   { y: 0 })
        gsap.set(shadow, { scaleX: 1, transformOrigin: "50% 50%" })
        gsap.set(phones, { autoAlpha: 0, rotation: -110, transformOrigin: "22% 70%" })
        gsap.set(glass,  { autoAlpha: 0, y: -52, rotation: -40, transformOrigin: "50% 0%" })

        const tl = gsap.timeline({ defaults: { ease: "none" } })

        // (1) SWING-ON: headphones rotate onto the crown, pivoting near the left earcup, settle with overshoot
        tl.to(phones, { autoAlpha: 1, duration: 0.04 }, 0.35)
        tl.to(phones, { rotation: 0, duration: 0.26, ease: "back.out(1.6)" }, 0.39)
        // little head dip as the band seats
        tl.to(mascot, { y: 1.5, duration: 0.08, ease: "sine.out" }, 0.5)
        tl.to(mascot, { y: 0, duration: 0.18, ease: "sine.inOut" }, 0.58)

        // (2) DROP-ON: magnifier tumbles in from above, overshoots, settles into the right hand
        tl.to(glass, { autoAlpha: 1, duration: 0.04 }, 0.82)
        tl.to(glass, { y: 0, rotation: 0, duration: 0.32, ease: "back.out(2.2)" }, 0.86)
        // right arm reaches up to catch it, then lowers
        tl.to(armR,  { y: -4, duration: 0.14, ease: "power2.out" }, 0.86)
        tl.to(armR,  { y: 0, duration: 0.22, ease: "power2.inOut" }, 1.04)

        // one-frame body squash on the magnifier's impact (props squash with the body)
        tl.to(body,   { scaleY: 0.9, scaleX: 1.09, duration: 0.07, ease: "power2.out" }, 1.12)
        tl.to(shadow, { scaleX: 1.16, duration: 0.07, ease: "power2.out" }, 1.12)
        tl.to(body,   { scaleY: 1, scaleX: 1, duration: 0.22, ease: "back.out(2)" }, 1.19)
        tl.to(shadow, { scaleX: 1, duration: 0.22, ease: "back.out(2)" }, 1.19)

        // settle the whole rig with a tiny breath
        tl.to(mascot, { y: -1.5, duration: 0.32, ease: "sine.inOut" }, 1.42)
        tl.to(mascot, { y: 0, duration: 0.32, ease: "sine.inOut" }, 1.74)

        return tl
      }
    }
  },

  {
  id: "wand-sparkle-burst", isNew: true, cat: "Motion", display: "Wand Sparkle Burst",
  source: ["claude-code-fast-mode"],
  desc: "Gold pixel particles burst radially from a mascot's wand tip in discrete loose-cadence pops, each pulsing dot to fuller star to bright 4-point sparkle before fading. From the Claude Code Fast mode launch.",
  html: `<div class='vp-stage wsb-stage'>
    <div class='wsb-scene'>
      <div class='wsb-mascot'>
        <div class='wsb-body'>
          <span class='wsb-eye wsb-eye-l'></span>
          <span class='wsb-eye wsb-eye-r'></span>
        </div>
        <div class='wsb-arm'></div>
        <div class='wsb-wand'>
          <span class='wsb-wand-stick'></span>
          <span class='wsb-emitter' data-wsb-emit>
            <span class='wsb-spark' data-wsb-spark></span>
            <span class='wsb-spark' data-wsb-spark></span>
            <span class='wsb-spark' data-wsb-spark></span>
            <span class='wsb-spark' data-wsb-spark></span>
            <span class='wsb-spark' data-wsb-spark></span>
            <span class='wsb-spark' data-wsb-spark></span>
            <span class='wsb-spark' data-wsb-spark></span>
            <span class='wsb-spark' data-wsb-spark></span>
            <span class='wsb-spark' data-wsb-spark></span>
            <span class='wsb-spark' data-wsb-spark></span>
            <span class='wsb-spark' data-wsb-spark></span>
            <span class='wsb-spark' data-wsb-spark></span>
            <span class='wsb-big' data-wsb-big>
              <span class='wsb-big-h'></span><span class='wsb-big-v'></span>
            </span>
            <span class='wsb-rest' data-wsb-rest>
              <span class='wsb-big-h'></span><span class='wsb-big-v'></span>
            </span>
          </span>
        </div>
      </div>
    </div>
  </div>`,
  init(card) {
    const sparks = card.querySelectorAll("[data-wsb-spark]")
    const big    = card.querySelector("[data-wsb-big]")
    const rest   = card.querySelector("[data-wsb-rest]")

    // Deterministic per-spark scatter so scrubbing the returned timeline is
    // stable across replays (no Math.random re-rolling on each play).
    const specs = [...sparks].map((s, i) => {
      // golden-angle distribution gives an even radial fan that reads as a burst
      const ang  = i * 2.39996 + (i % 3) * 0.5
      const dist = 12 + ((i * 7) % 9)            // 12-20px drift
      const dur  = 0.24 + ((i * 5) % 7) / 100    // 0.24-0.30s life
      const sc   = 1.0 + ((i * 3) % 6) / 10      // 1.0-1.5 end scale
      const dly  = ((i * 11) % 6) / 100          // tiny per-particle stagger
      return {
        el: s,
        dx: Math.cos(ang) * dist,
        dy: Math.sin(ang) * dist,
        dur, sc, dly
      }
    })

    // CONTENTFUL REST: one faint settled sparkle glints at the wand tip so the
    // card never reads empty between bursts.
    const setRest = () => {
      gsap.set(sparks, { x: 0, y: 0, scale: 0.4, autoAlpha: 0 })
      gsap.set(big,  { scale: 0, autoAlpha: 0 })
      gsap.set(rest, { scale: 0.85, autoAlpha: 0.6 })
    }
    setRest()

    // one discrete burst added to the timeline at absolute time `at`
    const addBurst = (tl, at, bright) => {
      tl.to(rest, { autoAlpha: 0, duration: 0.08 }, at)
      specs.forEach((p) => {
        const t0 = at + p.dly
        tl.set(p.el, { x: 0, y: 0, scale: 0.4, autoAlpha: 1 }, t0)
        // dot -> fuller star: scale up partway as it launches
        tl.to(p.el, {
          x: p.dx, y: p.dy, scale: p.sc, autoAlpha: 0,
          duration: p.dur, ease: "power2.out"
        }, t0)
      })
      if (bright) {
        // 4-point sparkle glyph flashes on the brightest beat
        tl.set(big, { scale: 0, autoAlpha: 1 }, at)
        tl.to(big, { scale: 1.15, autoAlpha: 0, duration: 0.25, ease: "power3.out" }, at)
      }
    }

    return function replay() {
      gsap.killTweensOf([...sparks, big, rest])
      setRest()

      const tl = gsap.timeline()
      tl.to(rest, { autoAlpha: 0, duration: 0.12 }, 0)
      // three discrete bursts on a loose ~0.55s cadence; middle beat is brightest
      addBurst(tl, 0.30, true)
      addBurst(tl, 0.85, false)
      addBurst(tl, 1.42, true)
      // settle back to the faint resting glint
      tl.to(rest, { scale: 0.85, autoAlpha: 0.6, duration: 0.3, ease: "sine.inOut" }, 1.95)
      return tl
    }
  }
},

  {
  id: "toggle-flip-on", isNew: true, cat: "UI", display: "Toggle Switch Flip-On",
  source: ["claude-code-fast-mode"],
  desc: "iOS pill toggle flips OFF to ON: a click-ripple pulses, the knob slides across the track, and the track recolors gray to blue. Claude Code Fast mode settings switch.",
  html: `<div class='tfo-stage'>
    <div class='tfo-row'>
      <div class='tfo-meta'>
        <div class='tfo-title'>Fast mode</div>
        <div class='tfo-sub'>Opus 4.7 · 1M default</div>
      </div>
      <div class='tfo-toggle' data-tfo-toggle>
        <div class='tfo-ripple' data-tfo-ripple></div>
        <div class='tfo-track' data-tfo-track></div>
        <div class='tfo-knob' data-tfo-knob></div>
      </div>
    </div>
  </div>`,
  init(card) {
    const track = card.querySelector("[data-tfo-track]")
    const knob = card.querySelector("[data-tfo-knob]")
    const ripple = card.querySelector("[data-tfo-ripple]")
    const OFF = "#9a9aa0"
    const ON = "#3b9eff"
    /* knob is 22px in a 48px track, left:3px at rest; x:20 lands a symmetric 3px right inset (matches build_spec x:20) */
    const KNOB_X = 20
    /* contentful rest: switched ON (track blue, knob right) */
    gsap.set(track, { backgroundColor: ON })
    gsap.set(knob, { x: KNOB_X })
    gsap.set(ripple, { scale: 0.3, autoAlpha: 0 })
    return function replay() {
      gsap.killTweensOf([track, knob, ripple])
      /* reset to OFF */
      gsap.set(track, { backgroundColor: OFF })
      gsap.set(knob, { x: 0 })
      gsap.set(ripple, { scale: 0.3, autoAlpha: 0 })
      const tl = gsap.timeline({ delay: 0.45 })
      /* click-ripple impact feedback */
      tl.to(ripple, { scale: 1.9, autoAlpha: 0.45, duration: 0.12, ease: "power2.out" })
      tl.to(ripple, { autoAlpha: 0, duration: 0.22, ease: "power1.out" }, ">-0.02")
      /* knob slide + track recolor, fired on the click beat */
      tl.to(knob, { x: KNOB_X, duration: 0.17, ease: "power2.out" }, "<")
      tl.to(track, { backgroundColor: ON, duration: 0.2, ease: "none" }, "<")
      return tl
    }
  }
},

  {
  id: "inline-label-word-insert", isNew: true, cat: "Text", display: "Inline Label Word-Insert",
  source: ["claude-code-fast-mode"],
  desc: "A live setting writes itself into a label: the \"Fast\" chip expands open between two existing tokens of \"Opus 4.7 / 1M Default\" while the trailing token reflows right to make room. Claude Code Fast-mode launch, frame-synced to the toggle flipping on.",
  html: `<div class='ilw-stage'>
    <div class='ilw-phrase' data-ilw-phrase>
      <span class='ilw-tok'>Opus 4.7</span>
      <span class='ilw-clip' data-ilw-clip><span class='ilw-chip' data-ilw-chip>Fast</span></span>
      <span class='ilw-tok ilw-tail' data-ilw-tail>1M Default</span>
    </div>
  </div>`,
  init(card) {
    const clip = card.querySelector("[data-ilw-clip]")
    const chip = card.querySelector("[data-ilw-chip]")
    const tail = card.querySelector("[data-ilw-tail]")

    // The chip lives inside a clip element whose width tweens 0 -> targetW so the
    // trailing token reflows right via flex (no jitter, numeric target = scrubbable).
    // targetW is the chip's natural width incl. its own padding/margins. Measured with
    // the clip in its open auto-width state, then re-measured after the font loads.
    let targetW = 0
    function measure() {
      const prev = clip.style.width
      clip.style.width = "auto"
      const w = clip.getBoundingClientRect().width
      if (w > 0) targetW = w
      clip.style.width = prev
    }
    function applyIdle() {
      gsap.set(clip, { width: "auto" })
      gsap.set(chip, { opacity: 1, scale: 1, x: 0 })
      gsap.set(tail, { x: 0 })
    }
    // Contentful resting state: full phrase with "Fast" inserted and visible.
    measure(); applyIdle()
    requestAnimationFrame(() => { measure(); applyIdle() })
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { measure(); applyIdle() })

    let tl = null
    return function replay() {
      if (tl) { tl.kill(); tl = null }
      measure()
      // Defensive: if the card is measured at zero width (not yet laid out / hidden),
      // never collapse the clip to 0 (the chip would vanish inside overflow:hidden).
      // Fall back to the contentful rest state and skip the reflow animation.
      if (!(targetW > 0)) { applyIdle(); return null }
      gsap.set(clip, { width: 0 })
      gsap.set(chip, { opacity: 0, scale: 0.7, x: -3 })
      gsap.set(tail, { x: 0 })

      tl = gsap.timeline()
      // hold the collapsed phrase a beat (the setting is about to be written)
      tl.to({}, { duration: 0.45 })
      // the slot opens: clip width 0 -> target, the tail reflows right with it
      tl.to(clip, { width: targetW, duration: 0.2, ease: "power2.out" }, ">")
      // the inserted word writes in just behind the opening edge
      tl.to(chip, { opacity: 1, scale: 1, x: 0, duration: 0.16, ease: "back.out(2.4)" }, "<0.05")
      // settle, hold the written-in label, then return to the contentful rest state
      tl.to({}, { duration: 1.0 })
      tl.add(applyIdle, ">")
      return tl
    }
  }
},

  {
    id: "mascot-celebration-hop", isNew: true, cat: "Motion", display: "Mascot Celebration Hop",
    source: ["claude-code-fast-mode", "claude-code-goal", "claude-code-agent-view", "claude-code-push-notifications"],
    desc: "The pixel Claude critter springs up with an anticipation squash, flashes a golden outline glow at the apex while its eyes pinch to happy arcs, then lands with a bounce squash-settle. The success payoff beat from the Claude Code launch spots.",
    html: `<div class='vp-stage mch-stage'>
      <div class='mch-floor'>
        <div class='mch-shadow' data-mch-shadow></div>
        <div class='mch-figure' data-mch-figure>
          <svg class='mch-sprite' viewBox='0 0 64 64' width='84' height='84' shape-rendering='crispEdges' aria-hidden='true'>
            <g class='mch-glow' data-mch-glow>
              <rect x='14' y='16' width='36' height='34' rx='6' fill='#C9785C'></rect>
            </g>
            <g class='mch-arms' data-mch-arms>
              <rect class='mch-arm-l' data-mch-arm-l x='8'  y='40' width='6' height='8' rx='2' fill='#B25E44'></rect>
              <rect class='mch-arm-r' data-mch-arm-r x='50' y='40' width='6' height='8' rx='2' fill='#B25E44'></rect>
            </g>
            <g class='mch-prop' data-mch-prop>
              <path d='M16 18 L48 18 L40 4 Q32 -2 24 4 Z' fill='#4B3A9E'></path>
              <rect x='12' y='17' width='40' height='5' rx='2' fill='#6B5FD6'></rect>
              <circle cx='37' cy='9' r='2.4' fill='#F2D469'></circle>
            </g>
            <rect class='mch-body' x='14' y='16' width='36' height='34' rx='6' fill='#C9785C'></rect>
            <g class='mch-eyes-open' data-mch-open>
              <rect x='23' y='28' width='6' height='8' rx='1.5' fill='#1A1714'></rect>
              <rect x='35' y='28' width='6' height='8' rx='1.5' fill='#1A1714'></rect>
            </g>
            <g class='mch-eyes-happy' data-mch-happy>
              <path d='M22 33 Q26 27 30 33' stroke='#1A1714' stroke-width='2.6' fill='none' stroke-linecap='round'></path>
              <path d='M34 33 Q38 27 42 33' stroke='#1A1714' stroke-width='2.6' fill='none' stroke-linecap='round'></path>
            </g>
            <g class='mch-legs'>
              <rect x='22' y='49' width='7' height='6' rx='2' fill='#A8543C'></rect>
              <rect x='35' y='49' width='7' height='6' rx='2' fill='#A8543C'></rect>
            </g>
          </svg>
        </div>
      </div>
    </div>`,
    init(card) {
      const figure = card.querySelector("[data-mch-figure]")
      const shadow = card.querySelector("[data-mch-shadow]")
      const glow   = card.querySelector("[data-mch-glow]")
      const armL   = card.querySelector("[data-mch-arm-l]")
      const armR   = card.querySelector("[data-mch-arm-r]")
      const open   = card.querySelector("[data-mch-open]")
      const happy  = card.querySelector("[data-mch-happy]")

      const applyRest = () => {
        gsap.set(figure, { y: 0, scaleX: 1, scaleY: 1, transformOrigin: "50% 100%" })
        gsap.set(glow,   { autoAlpha: 0 })
        gsap.set(shadow, { scaleX: 1, autoAlpha: 0.5 })
        gsap.set(armL,   { y: 0, rotation: 0, transformOrigin: "50% 0%" })
        gsap.set(armR,   { y: 0, rotation: 0, transformOrigin: "50% 0%" })
        gsap.set(open,   { autoAlpha: 1 })
        gsap.set(happy,  { autoAlpha: 0 })
      }
      applyRest()

      let tl = null

      return function replay() {
        if (tl) { tl.kill(); tl = null }
        gsap.killTweensOf([figure, shadow, glow, armL, armR, open, happy])
        applyRest()

        tl = gsap.timeline({ delay: 0.35 })

        /* anticipation squash: load the spring at the feet */
        tl.to(figure, { scaleY: 0.85, scaleX: 1.1, duration: 0.08, ease: "power2.out" }, 0)
        tl.to(shadow, { scaleX: 1.12, autoAlpha: 0.55, duration: 0.08, ease: "power2.out" }, 0)

        /* launch: rise + stretch, feet leave the surface, arms fling up */
        tl.to(figure, { y: -22, scaleY: 1.12, scaleX: 0.94, duration: 0.22, ease: "back.out(1.4)" }, 0.08)
        tl.to(shadow, { scaleX: 0.62, autoAlpha: 0.22, duration: 0.22, ease: "power2.out" }, 0.08)
        tl.to(armL,   { y: -3, rotation: -34, duration: 0.2, ease: "back.out(2)" }, 0.08)
        tl.to(armR,   { y: -3, rotation: 34, duration: 0.2, ease: "back.out(2)" }, 0.08)

        /* apex: golden outline glow + discrete eye swap to happy arcs */
        tl.to(glow, { autoAlpha: 1, duration: 0.08, ease: "power2.out" }, 0.24)
        tl.set(open,  { autoAlpha: 0 }, 0.26)
        tl.set(happy, { autoAlpha: 1 }, 0.26)
        tl.to(glow, { autoAlpha: 0, duration: 0.22, ease: "power2.in" }, 0.4)

        /* land: bounce squash-settle back onto the surface */
        tl.to(figure, { y: 0, scaleY: 1, scaleX: 1, duration: 0.34, ease: "bounce.out" }, 0.36)
        tl.to(shadow, { scaleX: 1, autoAlpha: 0.5, duration: 0.34, ease: "bounce.out" }, 0.36)
        tl.to(armL,   { y: 0, rotation: 0, duration: 0.28, ease: "power3.out" }, 0.42)
        tl.to(armR,   { y: 0, rotation: 0, duration: 0.28, ease: "power3.out" }, 0.42)

        /* hold the joyful landing, then ease eyes back open at rest */
        tl.set(happy, { autoAlpha: 0 }, 1.15)
        tl.set(open,  { autoAlpha: 1 }, 1.15)
        tl.to({}, { duration: 0.4 }, 1.15)
        return tl
      }
    }
  },

  {
  id: "spark-mark-bloom", isNew: true, cat: "Reveal", display: "Claude Spark-Mark Bloom",
  source: ["claude-code-fast-mode", "claude-code-agent-view", "claude-financial-services"],
  desc: "The Claude brand spark constructs itself spoke-by-spoke from a seed dot, each tapered ray drawing outward as the whole mark scales and rotates to settle. The brand-mark formation moment from the Claude Code launch + financial-services videos.",
  html: `<div class='smb-stage'>
    <div class='smb-glow' data-smb-glow></div>
    <svg class='smb-mark' data-smb-mark viewBox='0 0 100 100' width='150' height='150' aria-hidden='true'>
      <g class='smb-spark' data-smb-spark>
        <path class='smb-spoke' data-smb-spoke d='M50 50 L47 31 L50 11 L53 31 Z'></path>
        <path class='smb-spoke' data-smb-spoke d='M50 50 L47 31 L50 11 L53 31 Z'></path>
        <path class='smb-spoke' data-smb-spoke d='M50 50 L47 31 L50 11 L53 31 Z'></path>
        <path class='smb-spoke' data-smb-spoke d='M50 50 L47 31 L50 11 L53 31 Z'></path>
        <path class='smb-spoke' data-smb-spoke d='M50 50 L47 31 L50 11 L53 31 Z'></path>
        <path class='smb-spoke' data-smb-spoke d='M50 50 L47 31 L50 11 L53 31 Z'></path>
        <path class='smb-spoke' data-smb-spoke d='M50 50 L47 31 L50 11 L53 31 Z'></path>
        <path class='smb-spoke' data-smb-spoke d='M50 50 L47 31 L50 11 L53 31 Z'></path>
        <path class='smb-spoke' data-smb-spoke d='M50 50 L47 31 L50 11 L53 31 Z'></path>
        <path class='smb-spoke' data-smb-spoke d='M50 50 L47 31 L50 11 L53 31 Z'></path>
        <path class='smb-spoke' data-smb-spoke d='M50 50 L47 31 L50 11 L53 31 Z'></path>
        <path class='smb-spoke' data-smb-spoke d='M50 50 L47 31 L50 11 L53 31 Z'></path>
        <circle class='smb-seed' data-smb-seed cx='50' cy='50' r='6'></circle>
      </g>
    </svg>
  </div>`,
  init(card) {
    const spark = card.querySelector("[data-smb-spark]")
    const seed  = card.querySelector("[data-smb-seed]")
    const glow  = card.querySelector("[data-smb-glow]")
    const spokes = Array.from(card.querySelectorAll("[data-smb-spoke]"))

    /* bake each spoke's radial angle (30deg fan) + a sub-degree hand-drawn wobble,
       rotated about the seed center via svgOrigin so all spokes share one pivot */
    const angles = spokes.map((sp, i) => {
      const wobble = (i % 2 ? 0.6 : -0.6) + (i % 3 - 1) * 0.35
      const ang = i * 30 + wobble
      gsap.set(sp, { svgOrigin: "50 50", rotation: ang })
      return ang
    })

    /* IDLE = fully bloomed mark: spokes drawn, seed settled, group at rest */
    function applyIdle() {
      gsap.set(spark, { svgOrigin: "50 50", scale: 1, rotation: 0 })
      spokes.forEach((sp, i) => gsap.set(sp, { svgOrigin: "50 50", scaleY: 1, autoAlpha: 1, rotation: angles[i] }))
      gsap.set(seed, { svgOrigin: "50 50", scale: 0.55, autoAlpha: 1 })
      gsap.set(glow, { autoAlpha: 0.5, scale: 1 })
    }
    applyIdle()

    let tl = null
    return function replay() {
      if (tl) { tl.kill(); tl = null }
      gsap.killTweensOf([spark, seed, glow, ...spokes])

      /* START: just the seed dot, spokes collapsed into the center, group small + pre-rotated */
      gsap.set(spark, { svgOrigin: "50 50", scale: 0.6, rotation: -12 })
      spokes.forEach((sp, i) => gsap.set(sp, { svgOrigin: "50 50", scaleY: 0, autoAlpha: 0, rotation: angles[i] }))
      gsap.set(seed, { svgOrigin: "50 50", scale: 1, autoAlpha: 1 })
      gsap.set(glow, { autoAlpha: 0, scale: 0.5 })

      tl = gsap.timeline()
      /* seed shrinks as the spokes take over the mark */
      tl.to(seed, { scale: 0.55, duration: 0.34, ease: "power2.out" }, 0.04)
      /* spokes draw OUTWARD from the seed, random-stagger bloom */
      tl.to(spokes, {
        scaleY: 1, autoAlpha: 1, duration: 0.42, ease: "expo.out",
        stagger: { each: 0.018, from: "random" }
      }, 0)
      /* whole mark scales up + counter-rotates to settle, concurrently */
      tl.to(spark, { scale: 1, rotation: 0, duration: 0.5, ease: "power3.out" }, 0)
      /* a soft brand glow blooms behind, then eases to its resting level */
      tl.to(glow, { autoAlpha: 0.7, scale: 1.08, duration: 0.4, ease: "power3.out" }, 0.05)
      tl.to(glow, { autoAlpha: 0.5, scale: 1, duration: 0.5, ease: "sine.inOut" }, 0.45)

      /* hold the formed mark, then snap back to the idle (bloomed) resting state */
      tl.add(applyIdle, 1.6)
      return tl
    }
  }
},

  {
  id: "goal-active-timer-badge", isNew: true, cat: "UI", display: "Accelerated Live Timer Badge",
  source: ["claude-code-goal"],
  desc: "Claude Code /goal status badge whose parenthesized timer climbs on an ease-in curve (seconds tick slow then race), switches Ns->Nm past a minute, then vanishes the instant the goal completes.",
  html: `<div class='gtb-stage'>
    <div class='gtb-pane'>
      <div class='gtb-line'><span class='gtb-dot'></span>working on goal</div>
      <div class='gtb-line gtb-sub'>auditing contract surface</div>
      <div class='gtb-done' data-gtb-done><span class='gtb-tick'></span>goal achieved</div>
    </div>
    <div class='gtb-badge' data-gtb-badge>
      <span class='gtb-glyph'><span class='gtb-ring'></span><span class='gtb-ring2'></span><span class='gtb-bull'></span></span>
      <span class='gtb-label'>/goal active <span class='gtb-paren'>(<span class='gtb-t' data-gtb-t>0s</span>)</span></span>
    </div>
  </div>`,
  init(card) {
    const badge = card.querySelector("[data-gtb-badge]")
    const done = card.querySelector("[data-gtb-done]")
    const t = card.querySelector("[data-gtb-t]")
    const fmt = (v) => v < 60 ? Math.floor(v) + "s" : (v / 60).toFixed(0) + "m"
    const proxy = { s: 0 }
    // contentful resting state: badge mid-count, goal not yet achieved
    proxy.s = 96
    t.innerText = fmt(proxy.s)
    gsap.set(badge, { autoAlpha: 1, scale: 1, y: 0 })
    gsap.set(done, { autoAlpha: 0, y: 6 })
    let tl = null
    return () => {
      if (tl) { tl.kill(); tl = null }
      gsap.killTweensOf([proxy, badge, done])
      proxy.s = 0
      t.innerText = fmt(proxy.s)
      gsap.set(badge, { autoAlpha: 1, scale: 1, y: 0 })
      gsap.set(done, { autoAlpha: 0, y: 6 })
      tl = gsap.timeline({ repeat: -1, repeatDelay: 0.9 })
      // accelerating clock: power2.in makes early seconds crawl, later seconds race
      tl.to(proxy, { s: 240, duration: 5.2, ease: "power2.in", onUpdate() { t.innerText = fmt(proxy.s) } }, 0.35)
      // goal completes: badge pops slightly then is removed
      tl.to(badge, { scale: 1.06, duration: 0.12, ease: "power2.out" })
      tl.to(badge, { autoAlpha: 0, scale: 0.9, y: 4, duration: 0.2, ease: "power2.in" })
      tl.to(done, { autoAlpha: 1, y: 0, duration: 0.4, ease: "expo.out" }, "-=0.08")
      // reset for next loop cycle
      tl.set(proxy, { s: 0 })
      tl.set(t, { innerText: "0s" })
      tl.to(done, { autoAlpha: 0, y: 6, duration: 0.25, ease: "power2.in" }, "+=0.5")
      tl.set(badge, { autoAlpha: 1, scale: 1, y: 0 })
      return tl
    }
  }
},

  {
  id: "agent-selfcheck-line", isNew: true, cat: "Chat", display: "Agent Self-Check Line",
  source: ["claude-code-goal"],
  desc: "A de-emphasized hollow-bullet inner-monologue row ('Goal not yet met... continuing') lifts in between bold tool-call cards, codifying the agentic-loop thinking beat. Claude Code /goal feature.",
  html: `<div class='vp-stage ascl-stage'>
    <div class='ascl-pane'>
      <div class='ascl-row ascl-tool' data-ascl>
        <span class='ascl-glyph'>●</span><span class='ascl-name'>Bash</span><span class='ascl-args'>(bun test)</span>
      </div>
      <div class='ascl-row ascl-res' data-ascl>└ 3 failing</div>
      <div class='ascl-row ascl-check' data-ascl>
        <span class='ascl-hollow'>○</span><span class='ascl-think'>Goal not yet met… continuing</span>
      </div>
      <div class='ascl-row ascl-tool' data-ascl>
        <span class='ascl-glyph'>●</span><span class='ascl-name'>Edit</span><span class='ascl-args'>(parser.ts)</span>
      </div>
      <div class='ascl-row ascl-res' data-ascl>└ patched assertion</div>
      <div class='ascl-row ascl-check' data-ascl>
        <span class='ascl-hollow'>○</span><span class='ascl-think'>Goal not yet met… continuing</span>
      </div>
      <div class='ascl-row ascl-tool' data-ascl>
        <span class='ascl-glyph'>●</span><span class='ascl-name'>Bash</span><span class='ascl-args'>(bun test)</span>
      </div>
      <div class='ascl-row ascl-res ascl-pass' data-ascl>└ all passing · goal achieved</div>
    </div>
  </div>`,
  init(card) {
    const rows = card.querySelectorAll("[data-ascl]")
    const restOpacity = i => card.querySelectorAll("[data-ascl]")[i].classList.contains("ascl-check") ? 0.8 : 1
    rows.forEach((r, i) => gsap.set(r, { opacity: restOpacity(i), y: 0 }))
    return () => {
      gsap.killTweensOf(rows)
      const tl = gsap.timeline({ delay: 0.25 })
      rows.forEach((r, i) => {
        const target = r.classList.contains("ascl-check") ? 0.8 : 1
        gsap.set(r, { opacity: 0, y: 8 })
        tl.to(r, { opacity: target, y: 0, duration: 0.25, ease: "power2.out" }, i === 0 ? 0 : "+=0.18")
      })
      return tl
    }
  }
},

  {
  id: "dot-grid-surface", isNew: true, cat: "Layer", display: "Dot / Hatch Brand Surface",
  source: ["claude-code-goal", "claude-code-push-notifications", "claude-code-ultrareview", "claude-code-session-recaps", "code-w-claude-conf"],
  desc: "The canonical s0nderlabs/Claude resting bed: a low-contrast dot-grid paper field with a 45deg riso line-hatch region and a rounded inner frame; replay blooms the textures in. From the Claude Code feature reels + Code w/ Claude conference poster.",
  html: `<div class='dgs-stage' data-dgs='stage'>
    <div class='dgs-field' data-dgs='field'></div>
    <div class='dgs-dots' data-dgs='dots'></div>
    <div class='dgs-hatch' data-dgs='hatch'></div>
    <div class='dgs-frame' data-dgs='frame'></div>
    <span class='dgs-corner dgs-c-tl'></span>
    <span class='dgs-corner dgs-c-tr'></span>
    <span class='dgs-corner dgs-c-bl'></span>
    <span class='dgs-corner dgs-c-br'></span>
    <div class='dgs-cap' data-dgs='cap'>
      <span class='dgs-dot-mark'></span>
      <span class='dgs-cap-txt'>surface · dot 18 · hatch 45&deg;</span>
    </div>
  </div>`,
  init(card) {
    const stage = card.querySelector('[data-dgs="stage"]')
    const field = card.querySelector('[data-dgs="field"]')
    const dots  = card.querySelector('[data-dgs="dots"]')
    const hatch = card.querySelector('[data-dgs="hatch"]')
    const frame = card.querySelector('[data-dgs="frame"]')
    const cap   = card.querySelector('[data-dgs="cap"]')
    const corners = card.querySelectorAll('.dgs-corner')

    function rest() {
      gsap.set(field, { opacity: 1 })
      gsap.set(dots,  { opacity: 1, backgroundSize: "18px 18px" })
      gsap.set(hatch, { opacity: 1, clipPath: "polygon(0 100%, 100% 100%, 100% 0, 0 0)" })
      gsap.set(frame, { opacity: 1, scale: 1 })
      gsap.set(corners, { opacity: 0.7, scale: 1 })
      gsap.set(cap,   { opacity: 1, y: 0 })
    }
    rest()

    return () => {
      gsap.killTweensOf([field, dots, hatch, frame, cap, ...corners])
      // hidden start
      gsap.set(field, { opacity: 0 })
      gsap.set(dots,  { opacity: 0, backgroundSize: "30px 30px" })
      gsap.set(hatch, { opacity: 0, clipPath: "polygon(0 100%, 0 100%, 0 100%, 0 100%)" })
      gsap.set(frame, { opacity: 0, scale: 1.04 })
      gsap.set(corners, { opacity: 0, scale: 0.4 })
      gsap.set(cap,   { opacity: 0, y: 6 })

      const tl = gsap.timeline({ defaults: { ease: "power3.out" } })
      tl.to(field, { opacity: 1, duration: 0.5 }, 0.15)
      tl.to(dots,  { opacity: 1, backgroundSize: "18px 18px", duration: 0.9, ease: "expo.out" }, 0.25)
      tl.to(hatch, { opacity: 1, clipPath: "polygon(0 100%, 100% 100%, 100% 0, 0 0)", duration: 0.85, ease: "power4.inOut" }, 0.45)
      tl.to(frame, { opacity: 1, scale: 1, duration: 0.7, ease: "power3.out" }, 0.55)
      tl.to(corners, { opacity: 0.7, scale: 1, duration: 0.45, ease: "back.out(2.2)", stagger: 0.07 }, 0.75)
      tl.to(cap, { opacity: 1, y: 0, duration: 0.5, ease: "expo.out" }, 1.0)
      return tl
    }
  }
},

  {
    id: "lasso-twirl-throw-capture", isNew: true, cat: "Motion", display: "Lasso Twirl, Throw & Capture",
    source: ["claude-code-agent-view"],
    desc: "The cowboy mascot twirls a gold pixel rope, throws it as an orthogonal staircase line, and drags each scattered card across the canvas to dock onto a dashboard slot as a list row. From the Claude Code agent-view lasso set-piece.",
    html: `<div class='vp-stage ltt-stage'>
      <svg class='ltt-svg' viewBox='0 0 360 240' preserveAspectRatio='none' data-ltt-svg aria-hidden='true'>
        <polyline class='ltt-rope' data-ltt-rope points='80,86 80,86' />
        <ellipse class='ltt-loop' data-ltt-loop cx='88' cy='40' rx='22' ry='13' />
      </svg>
      <div class='ltt-mascot' data-ltt-mascot aria-hidden='true'>
        <div class='ltt-hat'></div>
        <div class='ltt-brim'></div>
        <div class='ltt-body'>
          <div class='ltt-eye l'></div>
          <div class='ltt-eye r'></div>
        </div>
        <div class='ltt-arm' data-ltt-arm></div>
        <div class='ltt-foot l'></div>
        <div class='ltt-foot r'></div>
      </div>
      <div class='ltt-dash' data-ltt-dash>
        <div class='ltt-dash-hd'><span class='ltt-dash-glyph'>&#9678;</span> sessions</div>
        <div class='ltt-slots'>
          <div class='ltt-slot' data-ltt-slot='0'></div>
          <div class='ltt-slot' data-ltt-slot='1'></div>
        </div>
      </div>
      <div class='ltt-card' data-ltt-card='0' style='left:205px;top:62px'>
        <span class='ltt-dot'></span><span class='ltt-c-name'>auth-refactor</span><span class='ltt-c-el'>3m</span>
      </div>
      <div class='ltt-card' data-ltt-card='1' style='left:205px;top:92px'>
        <span class='ltt-dot'></span><span class='ltt-c-name'>flaky-test</span><span class='ltt-c-el'>12s</span>
      </div>
    </div>`,
    init(card) {
      const loop  = card.querySelector("[data-ltt-loop]")
      const rope  = card.querySelector("[data-ltt-rope]")
      const arm   = card.querySelector("[data-ltt-arm]")
      const cards = [card.querySelector("[data-ltt-card='0']"), card.querySelector("[data-ltt-card='1']")]
      const slots = [card.querySelector("[data-ltt-slot='0']"), card.querySelector("[data-ltt-slot='1']")]

      // arm-tip emission point in SVG coords (above the raised arm)
      const ARM = { x: 80, y: 86 }
      // SCATTER = translate offset FROM each card's docked slot home OUT to its scattered
      // launch spot on the canvas. Docked rest = translate (0,0) sitting over the slot.
      const SCATTER = [
        { x: -55, y: -22, rot: 7,  sx: 1 },
        { x: -87, y: 58,  rot: -9, sx: 1 }
      ]
      // dock targets (where the rope lands) in SVG coords: the scattered card centers
      const TGT = [ { x: 212, y: 52 }, { x: 180, y: 162 } ]

      // build an orthogonal pixel-staircase polyline from arm tip to a target
      const staircase = (t) => {
        const midX = ARM.x + (t.x - ARM.x) * 0.55
        return `${ARM.x},${ARM.y} ${midX},${ARM.y} ${midX},${t.y} ${t.x},${t.y}`
      }
      const ropeLen = () => (rope.getTotalLength ? rope.getTotalLength() : 320)

      const applyIdle = () => {
        // CONTENTFUL REST: both cards docked onto their dashboard slots as rows,
        // slots filled, loop coiled twirling at the arm. Never blank.
        cards.forEach((c) => {
          c.classList.add("docked")
          gsap.set(c, { x: 0, y: 0, rotation: 0, scale: 1, autoAlpha: 1, transformOrigin: "50% 50%" })
        })
        slots.forEach(s => s.classList.add("filled"))
        gsap.set(rope, { autoAlpha: 0, strokeDasharray: 600, strokeDashoffset: 600 })
        gsap.set(loop, { autoAlpha: 1, rotation: 0, scaleX: 1, scaleY: 1, transformOrigin: "88px 78px" })
        gsap.set(arm, { rotation: -22, transformOrigin: "20% 90%" })
      }
      applyIdle()

      let tl = null
      return function replay() {
        if (tl) { tl.kill(); tl = null }
        gsap.killTweensOf([loop, rope, arm, ...cards])

        // START state: cards scattered (un-docked) across the canvas, loop twirling, dash empty
        cards.forEach((c, i) => {
          c.classList.remove("docked")
          gsap.set(c, { x: SCATTER[i].x, y: SCATTER[i].y, rotation: SCATTER[i].rot, scale: SCATTER[i].sx, autoAlpha: 1, transformOrigin: "50% 50%" })
        })
        slots.forEach(s => s.classList.remove("filled"))
        gsap.set(rope, { autoAlpha: 0 })
        gsap.set(loop, { autoAlpha: 1, rotation: 0, scaleX: 1, scaleY: 1, transformOrigin: "88px 78px" })
        gsap.set(arm, { rotation: -22, transformOrigin: "20% 90%" })

        tl = gsap.timeline()

        // segment helper: twirl (squashing revolutions to read as a side-on rope loop)
        const lassoTwirl = (at, revs) => {
          // orbit + a scaleX squash to a thin side-on line, twice per rev
          tl.to(loop, { rotation: "+=" + (360 * revs), duration: 0.7 * revs, ease: "none" }, at)
          tl.to(loop, { scaleX: 0.18, scaleY: 1.12, duration: 0.35, ease: "sine.inOut", yoyo: true, repeat: (revs * 2) - 1 }, at)
        }

        const throwAndCapture = (at, i) => {
          const t = TGT[i]
          // un-loop: loop fades as the rope un-coils
          tl.to(loop, { autoAlpha: 0, scaleX: 0.4, duration: 0.12, ease: "power2.in" }, at)
          // THROW: redraw the staircase to this target, then draw the line out
          tl.add(() => {
            rope.setAttribute("points", staircase(t))
            const L = ropeLen()
            gsap.set(rope, { autoAlpha: 1, strokeDasharray: L, strokeDashoffset: L })
            gsap.to(rope, { strokeDashoffset: 0, duration: 0.3, ease: "power3.out" })
          }, at + 0.08)
          // DWELL on the captured card (tiny tug)
          tl.to(cards[i], { rotation: SCATTER[i].rot * 0.4, duration: 0.1, ease: "power1.out" }, at + 0.42)
          // PULL: rope retracts (re-draw offset) while the card drags to its docked slot home, shrinking + de-rotating
          tl.add(() => {
            const L = ropeLen()
            gsap.to(rope, { strokeDashoffset: L, duration: 0.6, ease: "power2.inOut" })
          }, at + 0.52)
          tl.to(cards[i], { x: 0, y: 0, rotation: 0, scale: 1, duration: 0.6, ease: "power2.inOut" }, at + 0.52)
          // on dock: latch the row + tick the slot fill
          tl.add(() => { cards[i].classList.add("docked"); slots[i].classList.add("filled") }, at + 1.08)
          // re-coil the loop for the next throw
          tl.set(loop, { autoAlpha: 1, scaleX: 1, scaleY: 1 }, at + 1.14)
        }

        lassoTwirl(0.2, 2)        // 0.2 -> 1.6
        throwAndCapture(1.7, 0)   // 1.7 -> ~2.84
        lassoTwirl(2.95, 1)       // brief re-twirl
        throwAndCapture(3.75, 1)  // 3.75 -> ~4.89
        // settle into the resting twirl, then re-arm idle
        lassoTwirl(5.0, 1)
        tl.add(applyIdle, 5.75)
        return tl
      }
    }
  },

  {
    id: "card-tilt-disperse", isNew: true, cat: "Layer", display: "Card Tilt Disperse",
    source: ["claude-code-agent-view"],
    desc: "An overlapping collage of tilted cards slides outward to the frame edges with depth-weighted parallax (foreground travels farther, gains more spin) while live counters keep ticking, clearing center stage. Inverse of parallax-card-collage from the Claude Code agent-view trailer.",
    html: `<div class='ctd-stage'>
      <div class='ctd-card' data-ctd data-depth='1' style='left:32%;top:34%;width:96px;z-index:6'>
        <div class='ctd-lbl'>Sessions</div><div class='ctd-val ctd-up'>1,284</div>
      </div>
      <div class='ctd-card' data-ctd data-depth='1' style='left:44%;top:48%;width:104px;z-index:5'>
        <div class='ctd-lbl'>Throughput</div><div class='ctd-val ctd-pct'>+2.7%</div>
      </div>
      <div class='ctd-card' data-ctd data-depth='2' style='left:30%;top:50%;width:84px;z-index:4'>
        <div class='ctd-lbl'>Queue</div><div class='ctd-val'>17</div>
      </div>
      <div class='ctd-card' data-ctd data-depth='2' style='left:50%;top:32%;width:80px;z-index:3'>
        <div class='ctd-lbl'>Agents</div><div class='ctd-val'>6</div>
      </div>
      <div class='ctd-card' data-ctd data-depth='3' style='left:40%;top:40%;width:76px;z-index:2'>
        <div class='ctd-lbl'>Tokens</div><div class='ctd-val'>48k</div>
      </div>
    </div>`,
    init(card) {
      const cards = card.querySelectorAll("[data-ctd]")
      const upEl = card.querySelector(".ctd-up")
      const pctEl = card.querySelector(".ctd-pct")
      // direction unit vectors point from center toward each card's nearest edge
      const dirs = [
        { x: -1.0, y: -0.55, r: -11 },
        { x:  1.0, y:  0.45, r:  9 },
        { x: -0.9, y:  0.7,  r: -7 },
        { x:  0.85, y: -0.8, r:  8 },
        { x:  0.2, y:  1.0,  r: -5 }
      ]
      const reach = { 1: 132, 2: 88, 3: 52 }
      const tilt = [-3, 4, -2, 3, -1]
      // dispersed (resting) state: cards parked at the edges framing an empty center
      const place = () => cards.forEach((c, i) => {
        const d = dirs[i], depth = +c.dataset.depth, dist = reach[depth]
        gsap.set(c, {
          x: d.x * dist, y: d.y * dist,
          rotation: d.r, scale: depth === 1 ? 1 : depth === 2 ? 0.9 : 0.8,
          opacity: depth === 3 ? 0.72 : 1
        })
      })
      const setUp = (v) => { if (upEl) upEl.textContent = Math.round(v).toLocaleString("en-US") }
      const setPct = (v) => { if (pctEl) pctEl.textContent = "+" + v.toFixed(1) + "%" }
      place(); setUp(1284); setPct(2.7)
      return () => {
        gsap.killTweensOf(cards)
        const ctr = { up: 1180, pct: 1.9 }
        // collapse to an overlapping center collage, then disperse outward with parallax
        cards.forEach((c, i) => gsap.set(c, {
          x: 0, y: 0, rotation: tilt[i],
          scale: +c.dataset.depth === 1 ? 0.98 : 0.92, opacity: 1
        }))
        gsap.set(ctr, { up: 1180, pct: 1.9 })
        setUp(1180); setPct(1.9)
        const tl = gsap.timeline()
        cards.forEach((c, i) => {
          const d = dirs[i], depth = +c.dataset.depth, dist = reach[depth]
          tl.to(c, {
            x: d.x * dist, y: d.y * dist,
            rotation: d.r,
            scale: depth === 1 ? 1 : depth === 2 ? 0.9 : 0.8,
            opacity: depth === 3 ? 0.72 : 1,
            duration: 1.5 - depth * 0.12,
            ease: "power2.inOut"
          }, 0.4 + i * 0.05)
        })
        // live counters keep ticking through the disperse (scrub-safe via onUpdate)
        tl.to(ctr, {
          up: 1284, pct: 2.7, duration: 1.4, ease: "power1.out",
          onUpdate: () => { setUp(ctr.up); setPct(ctr.pct) }
        }, 0.4)
        return tl
      }
    }
  },

  {
  id: "session-dashboard-list", isNew: true, cat: "Data Viz", display: "Live Session Dashboard List",
  source: ["claude-code-agent-view"],
  desc: "Grouped status list (Needs input / Working / Completed) where rows latch in then live-reorder between groups -- one promotes up to needs-input, the rest drain green to completed -- with a header tally ticking in lockstep. Claude Code agent-view session board.",
  html: `<div class='vp-stage'>
    <div class='sdl-board' data-sdl-board>
      <div class='sdl-head'>
        <span class='sdl-board-title'>Sessions</span>
        <span class='sdl-tally'>
          <span class='sdl-pill sdl-pill-need'><i class='sdl-dot'></i><b data-sdl-c-need>0</b></span>
          <span class='sdl-pill sdl-pill-work'><i class='sdl-dot'></i><b data-sdl-c-work>5</b></span>
          <span class='sdl-pill sdl-pill-done'><i class='sdl-dot'></i><b data-sdl-c-done>0</b></span>
        </span>
      </div>
      <div class='sdl-canvas' data-sdl-canvas></div>
    </div>
  </div>`,
  init(card) {
    const canvas = card.querySelector("[data-sdl-canvas]")
    const cNeed = card.querySelector("[data-sdl-c-need]")
    const cWork = card.querySelector("[data-sdl-c-work]")
    const cDone = card.querySelector("[data-sdl-c-done]")

    // Group geometry within the canvas (px). Three stacked sections.
    // Scaled to fit the live ~360x240 card (vp-stage inner height ~196px).
    const GROUPS = ["need", "work", "done"]
    const GLABEL = { need: "Needs input", work: "Working", done: "Completed" }
    const ROW_H = 18       // row pitch
    const HDR_H = 13       // group-label band height
    const GAP   = 4        // gap above each group label

    // Five sessions. start: every row begins in "work".
    const data = [
      { name: "auth-refactor",  sum: "running tests",      el: "2m" },
      { name: "payments-sync",  sum: "needs a decision",   el: "3m" },
      { name: "docs-pass",      sum: "writing changelog",  el: "1m" },
      { name: "lint-sweep",     sum: "fixing failures",    el: "4m" },
      { name: "deploy-stage",   sum: "verifying build",    el: "6m" }
    ]

    // Build group-label bands + rows once.
    canvas.innerHTML = ""
    const labelEls = {}
    GROUPS.forEach(g => {
      const lab = document.createElement("div")
      lab.className = "sdl-glabel sdl-glabel-" + g
      lab.innerHTML = "<i class='sdl-dot'></i><span>" + GLABEL[g] + "</span>"
      canvas.appendChild(lab)
      labelEls[g] = lab
    })
    const rowEls = data.map((d) => {
      const r = document.createElement("div")
      r.className = "sdl-row"
      r.innerHTML =
        "<span class='sdl-glyph'></span>" +
        "<span class='sdl-name'>" + d.name + "</span>" +
        "<span class='sdl-sum'>" + d.sum + "</span>" +
        "<span class='sdl-el'>" + d.el + "</span>"
      canvas.appendChild(r)
      return r
    })

    // ---- state model: which group each row is in + render order ----
    function emptyState() { return { need: [], work: [0, 1, 2, 3, 4], done: [] } }
    function snapState(s) { return { need: s.need.slice(), work: s.work.slice(), done: s.done.slice() } }

    // Compute each element's absolute `top` from a group->row-index map.
    function layout(state, apply) {
      const tops = { rows: {}, labels: {} }
      let y = 0
      GROUPS.forEach(g => {
        const ids = state[g]
        tops.labels[g] = y + GAP
        y += GAP + HDR_H
        ids.forEach(id => { tops.rows[id] = y; y += ROW_H })
        y += 2
      })
      if (apply) {
        GROUPS.forEach(g => gsap.set(labelEls[g], { top: tops.labels[g] }))
        rowEls.forEach((r, id) => gsap.set(r, { top: tops.rows[id] }))
      }
      return tops
    }

    // group membership -> glyph color class on each row
    function paint(state) {
      const grpOf = {}
      GROUPS.forEach(g => state[g].forEach(id => { grpOf[id] = g }))
      rowEls.forEach((r, id) => {
        r.classList.remove("is-need", "is-work", "is-done")
        r.classList.add("is-" + grpOf[id])
      })
    }
    function setTally(state) {
      cNeed.textContent = String(state.need.length)
      cWork.textContent = String(state.work.length)
      cDone.textContent = String(state.done.length)
    }

    // ---- RESTING STATE: the drained board, mostly green ----
    const restState = { need: [1], work: [], done: [0, 2, 3, 4] }
    layout(restState, true)
    paint(restState)
    setTally(restState)
    gsap.set(rowEls, { opacity: 1, x: 0 })
    GROUPS.forEach(g => gsap.set(labelEls[g], { opacity: 1 }))

    let tl = null

    return function replay() {
      if (tl) { tl.kill(); tl = null }
      gsap.killTweensOf(rowEls)
      gsap.killTweensOf(Object.values(labelEls))

      // 1) Reset to the opening state: everyone Working, rows hidden.
      const state = emptyState()
      layout(state, true)
      paint(state)
      setTally(state)
      gsap.set(rowEls, { opacity: 0, x: -10 })
      GROUPS.forEach(g => gsap.set(labelEls[g], { opacity: g === "work" ? 1 : 0.32 }))

      tl = gsap.timeline()

      // 2) Rows latch in, top -> bottom.
      rowEls.forEach((r, i) => {
        tl.to(r, { opacity: 1, x: 0, duration: 0.34, ease: "power2.out" }, 0.15 + i * 0.11)
      })

      // Helper: move one row to a new group and re-flow neighbours (FLIP via top tween).
      function reflow(at, mutate, dur) {
        // capture current tops, mutate state, compute next tops, tween the deltas
        const before = layout(state, false)
        mutate(state)
        const after = layout(state, false)
        // snapshot the post-mutation membership so the deferred paint/tally
        // call fires THIS step's values (not the final state) when the
        // timeline reaches `at` -- keeps the tally ticking in lockstep and
        // stays correct on reverse-scrub.
        const snap = snapState(state)
        // labels
        GROUPS.forEach(g => {
          if (before.labels[g] !== after.labels[g])
            tl.to(labelEls[g], { top: after.labels[g], duration: dur, ease: "power2.inOut" }, at)
          tl.to(labelEls[g], { opacity: state[g].length ? 1 : 0.32, duration: 0.25 }, at)
        })
        // rows
        rowEls.forEach((r, id) => {
          if (before.rows[id] !== after.rows[id])
            tl.to(r, { top: after.rows[id], duration: dur, ease: "power2.inOut" }, at)
        })
        tl.call(() => { paint(snap); setTally(snap) }, null, at + dur * 0.45)
      }

      // 3) payments-sync PROMOTES up into Needs-input (magenta glyph).
      reflow(1.05, s => {
        s.work = s.work.filter(id => id !== 1)
        s.need.unshift(1)
      }, 0.42)
      // accent flash on the promoted row's glyph (already-visible element)
      tl.fromTo(rowEls[1].querySelector(".sdl-glyph"),
        { scale: 1 }, { scale: 1.5, duration: 0.16, ease: "back.out(3)", yoyo: true, repeat: 1 }, 1.30)

      // 4) DRAIN cascade: remaining Working rows demote to Completed (turn green), staggered.
      const drainOrder = [0, 2, 3, 4]
      drainOrder.forEach((id, k) => {
        reflow(1.75 + k * 0.45, s => {
          s.work = s.work.filter(x => x !== id)
          s.done.push(id)
        }, 0.40)
      })

      // 5) settle hold so the drained board is readable.
      tl.to({}, { duration: 1.4 })

      return tl
    }
  }
},

  {
  id: "inline-reply-composer-expand", isNew: true, cat: "Chat", display: "Inline Reply Composer Expand",
  source: ["claude-code-agent-view"],
  desc: "An inline reply panel expands below a selected agent-queue row, drawing a magenta accent and revealing the agent's pending question, then the user types the answer character-by-character into a > reply field. Claude Code agent-view.",
  html: `<div class='rxp-stage'>
    <div class='rxp-row' data-rxp-row>
      <span class='rxp-glyph'></span>
      <span class='rxp-name'>auth-refactor</span>
      <span class='rxp-tag' data-rxp-tag>3m</span>
    </div>
    <div class='rxp-panel' data-rxp-panel>
      <span class='rxp-accent' data-rxp-accent></span>
      <div class='rxp-q' data-rxp-q>Two migration paths exist. Which should I take?</div>
      <div class='rxp-field'>
        <span class='rxp-caretmark'>&gt;</span>
        <span class='rxp-typed' data-rxp-typed></span><span class='rxp-caret' data-rxp-caret></span>
      </div>
    </div>
  </div>`,
  init(card) {
    const panel  = card.querySelector("[data-rxp-panel]")
    const accent = card.querySelector("[data-rxp-accent]")
    const q      = card.querySelector("[data-rxp-q]")
    const typed  = card.querySelector("[data-rxp-typed]")
    const caret  = card.querySelector("[data-rxp-caret]")
    const REPLY  = "go with the additive backfill"

    // Build per-character spans once. Spaces use a literal space (white-space:pre on .rxp-typed).
    if (!typed.dataset.split) {
      typed.innerHTML = REPLY.split("").map(c =>
        `<span class="rxp-ch">${c === " " ? " " : c}</span>`
      ).join("")
      typed.dataset.split = "1"
    }
    const chars = Array.from(typed.querySelectorAll(".rxp-ch"))
    const N = chars.length

    // Reveal up to `count` chars by toggling a prefixed class. Driven by onUpdate so it is
    // fully deterministic under frame-by-frame timeline scrubbing (callbacks can be skipped
    // on time() jumps; onUpdate fires every tick).
    function reveal(count) {
      const k = Math.max(0, Math.min(N, Math.floor(count)))
      for (let i = 0; i < N; i++) chars[i].classList.toggle("rxp-on", i < k)
    }

    // Resting / idle state: panel open, accent drawn, question + full reply visible, caret on.
    // This is the most contentful frame, so the card never reads empty before replay.
    gsap.set(panel,  { height: "auto", autoAlpha: 1 })
    gsap.set(accent, { scaleY: 1 })
    gsap.set(q,      { autoAlpha: 1, y: 0 })
    gsap.set(caret,  { autoAlpha: 1 })
    reveal(N)

    let tl = null
    return function replay() {
      if (tl) { tl.kill(); tl = null }
      gsap.killTweensOf([panel, accent, q, caret])

      // Measure the open height against the LIVE stage (tracks any card size) before
      // collapsing, so the expand tweens to a real pixel height (scrub-safe, unlike "auto").
      gsap.set(panel, { height: "auto" })
      const openH = panel.offsetHeight

      // Collapse to the closed/hidden start state.
      gsap.set(panel,  { height: 0, autoAlpha: 1 })
      gsap.set(accent, { scaleY: 0 })
      gsap.set(q,      { autoAlpha: 0, y: 6 })
      gsap.set(caret,  { autoAlpha: 1 })
      reveal(0)

      const counter = { v: 0 }
      const perChar = 0.055              // ~18 chars/sec, clearly legible typewriter cadence
      const typeDur = N * perChar
      tl = gsap.timeline()

      // EXPAND: panel height grows while the magenta accent bar draws downward.
      tl.to(panel,  { height: openH, duration: 0.32, ease: "power3.out" }, 0.25)
      tl.to(accent, { scaleY: 1, duration: 0.30, ease: "power2.out" }, 0.25)

      // The agent's pending question lifts + fades in once there is room for it.
      tl.to(q, { autoAlpha: 1, y: 0, duration: 0.26, ease: "power2.out" }, 0.42)

      // TYPE the reply character-by-character (scrub-safe onUpdate, intentional linear cadence).
      const typeStart = 0.85
      tl.to(counter, {
        v: N,
        duration: typeDur,
        ease: "none",
        onUpdate: () => reveal(counter.v)
      }, typeStart)

      // Block caret blink during typing: a nested, finite, visible-dominant blink. The caret
      // rests ON (autoAlpha 1) and dips OFF for a short beat each cycle, so it reads as a real
      // text caret rather than a mostly-hidden flicker. Nested timeline stays fully scrubbable.
      const blinkCycles = Math.max(1, Math.ceil(typeDur / 0.55))
      const blink = gsap.timeline()
      for (let i = 0; i < blinkCycles; i++) {
        // visible hold, then a brief off-flash, then back on -> caret is ON most of each 0.55s.
        blink.set(caret, { autoAlpha: 1 }, i * 0.55)
        blink.set(caret, { autoAlpha: 0 }, i * 0.55 + 0.42)
        blink.set(caret, { autoAlpha: 1 }, i * 0.55 + 0.52)
      }
      tl.add(blink, typeStart)

      // Settle: full reply held with the caret resting on (the resting state).
      const typedDone = typeStart + typeDur
      tl.set(caret, { autoAlpha: 1 }, typedDone)
      tl.to({}, { duration: 1.2 }, typedDone)   // dwell on the answered panel
      return tl
    }
  }
},

  {
  id: "playful-spinner-verb", isNew: true, cat: "UI", display: "Playful Spinner + Verb",
  source: ["claude-code-push-notifications", "claude-code-goal", "claude-code-agent-view"],
  desc: "Claude Code's whimsical active-task tell: a leading glyph sparkles through ·✛✳✶ beside a bold mono verb with live counters, then snaps to a green result line. From the Code push/goal/agent-view clips.",
  html: `<div class='psv-stage'>
    <div class='psv-block'>
      <div class='psv-line' data-psv-line>
        <span class='psv-g' data-psv-g>·</span><span class='psv-verb' data-psv-verb>Julienning…</span>
        <span class='psv-meta' data-psv-meta>(4s · ↑2.1k tokens)</span>
      </div>
      <div class='psv-result' data-psv-result>
        <span class='psv-check'></span><span class='psv-result-text'>Goal achieved</span>
        <span class='psv-result-meta'>· 7s · 4.9k tokens</span>
      </div>
    </div>
  </div>`,
  init(card) {
    const line = card.querySelector("[data-psv-line]")
    const result = card.querySelector("[data-psv-result]")
    const g = card.querySelector("[data-psv-g]")
    const meta = card.querySelector("[data-psv-meta]")
    const glyphs = ["·", "✛", "✳", "✶"]
    let glyphTl = null
    const counter = { s: 0, tok: 0 }
    let timers = []
    const renderMeta = () => {
      meta.textContent = "(" + Math.round(counter.s) + "s · ↑" + (counter.tok / 1000).toFixed(1) + "k tokens)"
    }
    /* contentful resting state: mid-spin look */
    const restMid = () => {
      gsap.set(line, { autoAlpha: 1 })
      gsap.set(result, { autoAlpha: 0, y: 4 })
      g.textContent = glyphs[1]
      g.style.color = "#c8674f"
      counter.s = 4; counter.tok = 2100; renderMeta()
    }
    restMid()
    const stopAll = () => {
      if (glyphTl) { glyphTl.kill(); glyphTl = null }
      gsap.killTweensOf([counter, g, line, result])
      timers.forEach(t => clearTimeout(t)); timers = []
    }
    const runCycle = () => {
      /* self-clean each cycle so setTimeout handles + tweens never accumulate (re-replay + idle-loop safe) */
      timers.forEach(t => clearTimeout(t)); timers = []
      if (glyphTl) { glyphTl.kill(); glyphTl = null }
      gsap.killTweensOf(counter)
      /* reset to fresh spin */
      gsap.set(line, { autoAlpha: 1 })
      gsap.set(result, { autoAlpha: 0, y: 4 })
      counter.s = 0; counter.tok = 0; renderMeta()
      let gi = 0
      g.textContent = glyphs[0]; g.style.color = "#c8674f"
      /* instant glyph swap on each repeat + subtle terracotta shimmer */
      glyphTl = gsap.timeline({ repeat: -1, repeatDelay: 0 })
      glyphTl.to({}, {
        duration: 0.16, ease: "none",
        onRepeat() {
          gi = (gi + 1) % glyphs.length
          g.textContent = glyphs[gi]
          gsap.fromTo(g, { color: "#d96a4a" }, { color: "#c8674f", duration: 0.16, ease: "sine.out" })
        }
      })
      /* live counters climb linearly while active */
      gsap.to(counter, { s: 7, tok: 4900, duration: 3.4, ease: "none", onUpdate: renderMeta })
      /* instant completion swap: spinner line out, result line in */
      timers.push(setTimeout(() => {
        if (glyphTl) { glyphTl.kill(); glyphTl = null }
        renderMeta()
        gsap.set(line, { autoAlpha: 0 })
        gsap.fromTo(result, { autoAlpha: 0, y: 6 }, { autoAlpha: 1, y: 0, duration: 0.42, ease: "back.out(1.7)" })
      }, 3500))
      /* hold the result, then loop back into a fresh spin */
      timers.push(setTimeout(runCycle, 5200))
    }
    return () => {
      stopAll()
      restMid()
      timers.push(setTimeout(runCycle, 350))
    }
  }
},

  {
  id: "status-bullet-flip-green", isNew: true, cat: "UI", display: "Status Bullet Flip to Green",
  source: ["claude-code-push-notifications", "claude-code-goal", "claude-financial-services"],
  desc: "Tool-step bullets flip from a dim hollow dot to a solid green dot with a back.out pop, the line steps to forest green, and a '└ passed' result latches in. Claude Code's per-step success tell.",
  html: `<div class='sbg-stage'>
    <div class='sbg-log'>
      <div class='sbg-step' data-sbg>
        <div class='sbg-line'><span class='sbg-bullet' data-sbg-b></span><span class='sbg-label' data-sbg-l>Bash</span><span class='sbg-args'>(bun test)</span></div>
        <div class='sbg-result' data-sbg-r>└ 24 passed · 0 failed</div>
      </div>
      <div class='sbg-step' data-sbg>
        <div class='sbg-line'><span class='sbg-bullet' data-sbg-b></span><span class='sbg-label' data-sbg-l>PushNotification</span><span class='sbg-args'>(build ok)</span></div>
        <div class='sbg-result' data-sbg-r>└ delivered to device</div>
      </div>
      <div class='sbg-step' data-sbg>
        <div class='sbg-line'><span class='sbg-bullet' data-sbg-b></span><span class='sbg-label' data-sbg-l>Goal</span><span class='sbg-args'>(/goal active)</span></div>
        <div class='sbg-result' data-sbg-r>└ goal achieved</div>
      </div>
    </div>
  </div>`,
  init(card) {
    const steps   = card.querySelectorAll("[data-sbg]")
    const bullets = card.querySelectorAll("[data-sbg-b]")
    const labels  = card.querySelectorAll("[data-sbg-l]")
    const results = card.querySelectorAll("[data-sbg-r]")
    const GRAY = "#8a8378", GREEN = "#5ec27a"
    /* resting (contentful): all steps latched green, results revealed */
    gsap.set(bullets, { backgroundColor: GREEN, borderColor: GREEN, scale: 1 })
    gsap.set(labels,  { color: GREEN })
    gsap.set(results, { autoAlpha: 1, y: 0 })
    return () => {
      gsap.killTweensOf([...bullets, ...labels, ...results])
      /* reset to pending: hollow gray bullets, neutral labels, hidden results */
      gsap.set(bullets, { backgroundColor: "rgba(0,0,0,0)", borderColor: GRAY, scale: 1 })
      gsap.set(labels,  { color: "#3a352c" })
      gsap.set(results, { autoAlpha: 0, y: 6 })
      const tl = gsap.timeline({ delay: 0.4 })
      steps.forEach((s, i) => {
        const at = i * 0.7
        tl.to(bullets[i], { backgroundColor: GREEN, borderColor: GREEN, scale: 1.28, duration: 0.12, ease: "back.out(2)" }, at)
          .to(bullets[i], { scale: 1, duration: 0.1, ease: "power2.out" }, at + 0.12)
          .to(labels[i],  { color: GREEN, duration: 0.18, ease: "power1.out" }, at)
          .to(results[i], { autoAlpha: 1, y: 0, duration: 0.25, ease: "power2.out" }, at + 0.14)
      })
      return tl
    }
  }
},

  {
  id: "ios-notification-banner", isNew: true, cat: "UI", display: "iOS Notification Banner Slide-Up",
  source: ["claude-code-push-notifications"],
  desc: "A frosted-glass iOS lock-screen banner with a terracotta Claude app icon decelerates up from below into rest, the product-payoff arrival from the Claude Code push-notifications launch.",
  html: `<div class='inb-stage'>
    <div class='inb-cam' data-inb-cam>
      <div class='inb-clock'>
        <div class='inb-time'>9:41</div>
        <div class='inb-date'>Tuesday, January 14</div>
      </div>
      <div class='inb-banner' data-inb-banner>
        <div class='inb-icon'>
          <svg viewBox='0 0 24 24' aria-hidden='true'>
            <g stroke='#fff' stroke-width='2.4' stroke-linecap='round'>
              <line x1='12' y1='3.5' x2='12' y2='20.5'></line>
              <line x1='3.5' y1='12' x2='20.5' y2='12'></line>
              <line x1='6' y1='6' x2='18' y2='18'></line>
              <line x1='18' y1='6' x2='6' y2='18'></line>
            </g>
          </svg>
        </div>
        <div class='inb-text'>
          <div class='inb-title'>Claude Code</div>
          <div class='inb-sub'>Tests passing. Ready for your review.</div>
        </div>
        <div class='inb-ts'>now</div>
      </div>
    </div>
  </div>`,
  init(card) {
    const cam    = card.querySelector("[data-inb-cam]")
    const banner = card.querySelector("[data-inb-banner]")
    // IDLE = contentful rest: banner seated, fully visible, camera neutral
    gsap.set(cam,    { scale: 1, y: 0, transformOrigin: "50% 62%" })
    gsap.set(banner, { y: 0, autoAlpha: 1, scale: 1 })
    let tl = null
    return function replay() {
      if (tl) { tl.kill(); tl = null }
      gsap.killTweensOf([cam, banner])
      // START: banner below + hidden, camera pulled back slightly for the punch-in
      gsap.set(cam,    { scale: 0.98, y: 0, transformOrigin: "50% 62%" })
      gsap.set(banner, { y: 52, autoAlpha: 0, scale: 0.96 })
      tl = gsap.timeline()
      // camera punch-in toward the lower banner, synced to the arrival
      tl.to(cam, { scale: 1.04, duration: 0.7, ease: "power2.inOut" }, 0)
      // decelerated slide-up + fade-in, the load-bearing motion (ends at 0.54)
      tl.to(banner, { y: 0, autoAlpha: 1, scale: 1, duration: 0.42, ease: "power3.out" }, 0.12)
      // tiny landing settle so it seats with weight (starts AT slide-end 0.54 so no concurrent y-writes)
      tl.to(banner, { y: 1.5, duration: 0.12, ease: "sine.inOut", yoyo: true, repeat: 1 }, 0.54)
      // hold the seated state, then ease the camera back to neutral rest
      tl.to(cam, { scale: 1, duration: 0.6, ease: "power2.inOut" }, 1.5)
      return tl
    }
  }
},

  {
  id: "split-screen-diptych", isNew: true, cat: "Layer", display: "Cause/Effect Split-Screen Diptych",
  source: ["claude-code-push-notifications"],
  desc: "Two co-present panels (terminal where work happens, phone where the result lands) slide inward, then the camera travels right to punch in on the notification instead of cutting. From the Claude Code push-notifications launch clip.",
  html: `<div class='ssd-frame'>
    <div class='ssd-stage' data-ssd='stage'>
      <div class='ssd-grid' aria-hidden='true'></div>
      <div class='ssd-mascot' data-ssd='mascot' aria-hidden='true'><span class='ssd-star'>&#10022;</span></div>
      <div class='ssd-deck'>
        <div class='ssd-panel ssd-left' data-ssd='left'>
          <div class='ssd-term-chrome'><span class='ssd-tl r'></span><span class='ssd-tl y'></span><span class='ssd-tl g'></span></div>
          <div class='ssd-term-body'>
            <div class='ssd-tline'><span class='ssd-prompt'>$</span><span class='ssd-cmd'>claude</span><span class='ssd-arg'>deploy</span></div>
            <div class='ssd-tline ssd-dim'><span class='ssd-bullet'>&#9655;</span><span>build complete</span></div>
            <div class='ssd-tline ssd-dim'><span class='ssd-bullet'>&#9655;</span><span>pushing &hellip;</span><span class='ssd-ok'>&#10003;</span></div>
          </div>
        </div>
        <div class='ssd-panel ssd-right' data-ssd='right'>
          <div class='ssd-phone'>
            <div class='ssd-notch'></div>
            <div class='ssd-screen'>
              <div class='ssd-time'>9:41</div>
              <div class='ssd-banner' data-ssd='banner'>
                <div class='ssd-app'><span class='ssd-app-glyph'>&#10022;</span></div>
                <div class='ssd-banner-body'>
                  <div class='ssd-banner-title'>Claude Code</div>
                  <div class='ssd-banner-msg'>Deploy finished &middot; tests green</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>`,
  init(card) {
    const stage  = card.querySelector('[data-ssd="stage"]')
    const left   = card.querySelector('[data-ssd="left"]')
    const right  = card.querySelector('[data-ssd="right"]')
    const banner = card.querySelector('[data-ssd="banner"]')
    const mascot = card.querySelector('[data-ssd="mascot"]')

    // IDLE = both panels seated, camera wide, banner landed, mascot idling (contentful rest)
    function applyIdle() {
      gsap.set(stage,  { scale: 1, x: 0, transformOrigin: "70% 48%", force3D: true })
      gsap.set([left, right], { x: 0, autoAlpha: 1 })
      gsap.set(banner, { y: 0, autoAlpha: 1, scale: 1 })
      gsap.set(mascot, { y: 0, rotation: 0, autoAlpha: 1 })
    }
    applyIdle()

    let tl = null

    return function replay() {
      if (tl) { tl.kill(); tl = null }
      gsap.killTweensOf([stage, left, right, banner, mascot])

      // START state: camera wide, panels off-screen inward, banner not yet landed
      gsap.set(stage,  { scale: 1, x: 0, transformOrigin: "70% 48%", force3D: true })
      gsap.set(left,   { x: -200, autoAlpha: 0 })
      gsap.set(right,  { x: 200,  autoAlpha: 0 })
      gsap.set(banner, { y: -22, autoAlpha: 0, scale: 0.94 })
      gsap.set(mascot, { y: 0, rotation: 0, autoAlpha: 0 })

      tl = gsap.timeline({ defaults: { force3D: true } })

      // dual-slide entrance: both panels seat to center simultaneously
      tl.to([left, right], { x: 0, autoAlpha: 1, duration: 0.28, ease: "power3.out" }, 0.25)
      tl.to(mascot, { autoAlpha: 1, duration: 0.4, ease: "power2.out" }, 0.30)

      // camera travels right + punches in on the phone (no cut)
      tl.to(stage, { scale: 1.6, x: -60, duration: 0.6, ease: "power2.inOut" }, 0.85)

      // the result lands: notification banner drops in during the hold
      tl.to(banner, { y: 0, autoAlpha: 1, scale: 1, duration: 0.5, ease: "back.out(1.6)" }, 1.15)
      // mascot idle nudge (the bridge element, alive but quiet)
      tl.to(mascot, { y: -3, rotation: 8, duration: 0.5, ease: "sine.inOut" }, 1.2)
      tl.to(mascot, { y: 0, rotation: 0, duration: 0.6, ease: "sine.inOut" }, 1.7)

      // hold on the landed result
      tl.to({}, { duration: 1.4 }, 1.7)

      // camera pulls back to the full diptych
      tl.to(stage, { scale: 1, x: 0, duration: 0.8, ease: "power2.inOut" }, 3.1)

      return tl
    }
  }
},

  {
  id: "mascot-pose-turn", isNew: true, cat: "Motion", display: "Mascot Sprite Pose-Turn",
  source: ["claude-code-session-recaps", "claude-code-ultrareview", "code-w-claude-conf"],
  desc: "The pixel Claude critter hard-swaps between distinct poses (front -> right-profile -> left-peer) frame-by-frame instead of rotating, raises an arm and pops an idea bulb as an insight lands. Discrete sprite re-draws over a continuous idle bob. From Claude Code session recaps / ultrareview.",
  html: `<div class='vp-stage mpt-stage'>
    <div class='mpt-floor'></div>
    <div class='mpt-rig' data-mpt-rig>
      <div class='mpt-body' data-mpt-body>
        <svg class='mpt-svg' viewBox='0 0 64 64' shape-rendering='crispEdges' xmlns='http://www.w3.org/2000/svg'>
          <!-- idea bulb, parented to the rig so it bobs with the head -->
          <g class='mpt-bulb' data-mpt-bulb>
            <rect x='28' y='2'  width='8' height='8' fill='#F5C84B'/>
            <rect x='27' y='4'  width='1' height='4' fill='#F5C84B'/>
            <rect x='36' y='4'  width='1' height='4' fill='#F5C84B'/>
            <rect x='30' y='3'  width='2' height='2' fill='#FCE38A'/>
            <rect x='29' y='10' width='6' height='2' fill='#B8B0A5'/>
            <rect x='30' y='12' width='4' height='1' fill='#8f887d'/>
          </g>

          <!-- FRONT pose: square critter, two eyes centered, two arm-nubs, two legs -->
          <g class='mpt-pose mpt-front' data-mpt-pose='front'>
            <rect x='18' y='24' width='28' height='24' fill='#C15B3C'/>
            <rect x='18' y='24' width='28' height='3'  fill='#cf6a48'/>
            <rect x='13' y='30' width='5'  height='9'  fill='#A84C30'/>
            <rect x='46' y='30' width='5'  height='9'  fill='#A84C30'/>
            <rect x='22' y='48' width='6'  height='4'  fill='#A84C30'/>
            <rect x='36' y='48' width='6'  height='4'  fill='#A84C30'/>
            <g class='mpt-eyes-front'>
              <rect x='25' y='32' width='5' height='6' fill='#1A1A1A'/>
              <rect x='34' y='32' width='5' height='6' fill='#1A1A1A'/>
            </g>
            <g class='mpt-sleepy-front'>
              <rect x='25' y='36' width='5' height='2' fill='#1A1A1A'/>
              <rect x='34' y='36' width='5' height='2' fill='#1A1A1A'/>
            </g>
          </g>

          <!-- MID pose: transitional 3/4 turn, body narrows, eyes drift right -->
          <g class='mpt-pose mpt-mid' data-mpt-pose='mid'>
            <rect x='20' y='24' width='24' height='24' fill='#C15B3C'/>
            <rect x='20' y='24' width='24' height='3'  fill='#cf6a48'/>
            <rect x='44' y='30' width='4'  height='8'  fill='#A84C30'/>
            <rect x='23' y='48' width='6'  height='4'  fill='#A84C30'/>
            <rect x='35' y='48' width='6'  height='4'  fill='#A84C30'/>
            <rect x='30' y='32' width='5' height='6' fill='#1A1A1A'/>
            <rect x='37' y='32' width='4' height='6' fill='#1A1A1A'/>
          </g>

          <!-- PROFILE pose: right-facing "dog", snout extends right, one eye, raised arm -->
          <g class='mpt-pose mpt-profile' data-mpt-pose='profile'>
            <rect x='20' y='24' width='22' height='24' fill='#C15B3C'/>
            <rect x='20' y='24' width='22' height='3'  fill='#cf6a48'/>
            <rect x='42' y='30' width='8'  height='7'  fill='#C15B3C'/>
            <rect x='50' y='32' width='3'  height='4'  fill='#A84C30'/>
            <rect x='24' y='48' width='6'  height='4'  fill='#A84C30'/>
            <rect x='34' y='48' width='6'  height='4'  fill='#A84C30'/>
            <rect class='mpt-arm' data-mpt-arm x='17' y='30' width='5' height='9' fill='#A84C30'/>
            <rect x='40' y='31' width='5' height='6' fill='#1A1A1A'/>
          </g>

          <!-- PEER pose: leaning left, one enlarged eye behind a lens ring -->
          <g class='mpt-pose mpt-peer' data-mpt-pose='peer'>
            <rect x='22' y='24' width='24' height='24' fill='#C15B3C'/>
            <rect x='22' y='24' width='24' height='3'  fill='#cf6a48'/>
            <rect x='46' y='30' width='4'  height='8'  fill='#A84C30'/>
            <rect x='26' y='48' width='6'  height='4'  fill='#A84C30'/>
            <rect x='38' y='48' width='6'  height='4'  fill='#A84C30'/>
            <rect x='29' y='31' width='6' height='7' fill='#1A1A1A'/>
            <rect x='37' y='33' width='3' height='4' fill='#1A1A1A'/>
            <g class='mpt-lens' fill='none' stroke='#3a352c' stroke-width='2'>
              <rect x='25' y='28' width='14' height='13' rx='1'/>
            </g>
            <rect x='12' y='40' width='10' height='2' fill='#6f6c65' transform='rotate(28 22 41)'/>
          </g>
        </svg>
      </div>
    </div>
  </div>`,
  init(card) {
    const rig   = card.querySelector("[data-mpt-rig]")
    const body  = card.querySelector("[data-mpt-body]")
    const bulb  = card.querySelector("[data-mpt-bulb]")
    const arm   = card.querySelector("[data-mpt-arm]")
    const poses = ["front", "mid", "profile", "peer"]
    const poseEls = {}
    poses.forEach(p => { poseEls[p] = card.querySelector(`[data-mpt-pose='${p}']`) })

    const setPose = (name) => {
      poses.forEach(p => gsap.set(poseEls[p], { autoAlpha: p === name ? 1 : 0 }))
    }

    // contentful resting state: turned to the profile "idea" pose, bulb lit, arm raised
    gsap.set(rig,  { y: 0 })
    gsap.set(body, { y: 0 })
    setPose("profile")
    gsap.set(arm,  { y: -4, rotation: -18, transformOrigin: "50% 100%" })
    gsap.set(bulb, { transformOrigin: "32px 56px", scale: 1, autoAlpha: 1 })

    // continuous idle bob for the pre-first-replay rest state. Infinite repeat is fine
    // here because this is a STANDALONE tween, NOT a child of the returned timeline.
    const bob = gsap.to(body, {
      y: -3, duration: 0.75, ease: "sine.inOut", yoyo: true, repeat: -1
    })

    return function replay() {
      gsap.killTweensOf([rig, body, arm, bulb])
      bob.kill()

      // start from rest: front-facing, no bulb, arm down
      gsap.set(body, { y: 0 })
      gsap.set(arm,  { y: 0, rotation: 0, transformOrigin: "50% 100%" })
      gsap.set(bulb, { transformOrigin: "32px 56px", scale: 0, autoAlpha: 0 })
      setPose("front")

      const tl = gsap.timeline()

      // idle bob lives inside the replay so the audit harness scrubs it too.
      // FINITE repeat (6 half-cycles * 0.75s = 4.5s) spans the whole content so the
      // returned timeline keeps a FINITE duration() and stays deterministically scrubbable.
      // A repeat:-1 here would make tl.duration() === Infinity and break the scrub harness.
      tl.to(body, { y: -3, duration: 0.75, ease: "sine.inOut", yoyo: true, repeat: 5 }, 0)

      // a blink before the turn (discrete: eyes -> sleepy slits and back, no tween)
      tl.set(card.querySelector(".mpt-eyes-front"),   { autoAlpha: 0 }, 0.55)
      tl.set(card.querySelector(".mpt-sleepy-front"), { autoAlpha: 1 }, 0.55)
      tl.set(card.querySelector(".mpt-sleepy-front"), { autoAlpha: 0 }, 0.66)
      tl.set(card.querySelector(".mpt-eyes-front"),   { autoAlpha: 1 }, 0.66)

      // discrete pose re-draw across an intermediate sprite (steps, not interpolation)
      tl.call(() => setPose("mid"),     [], 0.95)
      tl.call(() => setPose("profile"), [], 1.12)

      // arm raises as the critter "turns to look" (the one eased sub-motion)
      tl.to(arm, { y: -4, rotation: -18, duration: 0.16, ease: "power2.out" }, 1.18)

      // idea bulb pops above the head on the insight beat (overshoot then settle)
      tl.to(bulb, { scale: 1, autoAlpha: 1, duration: 0.2, ease: "back.out(3)" }, 1.3)

      // hold the lit idea pose, then a second beat: peer-left through a lens
      tl.to(bulb, { scale: 0, autoAlpha: 0, duration: 0.14, ease: "power2.in" }, 2.5)
      tl.to(arm,  { y: 0, rotation: 0, duration: 0.14, ease: "power2.in" }, 2.5)
      tl.call(() => setPose("mid"),  [], 2.66)
      tl.call(() => setPose("peer"), [], 2.82)

      // settle back to the resting profile "idea" pose for a contentful end state
      tl.call(() => setPose("mid"),     [], 3.85)
      tl.call(() => setPose("profile"), [], 4.0)
      tl.to(arm,  { y: -4, rotation: -18, duration: 0.16, ease: "power2.out" }, 4.05)
      tl.to(bulb, { scale: 1, autoAlpha: 1, duration: 0.2, ease: "back.out(3)" }, 4.18)

      return tl
    }
  }
},

  {
  id: "lightbulb-idea-pop", isNew: true, cat: "Reveal", display: "Lightbulb Idea Pop",
  source: ["claude-code-session-recaps"],
  desc: "A pixel-art lightbulb pops above the idle-bobbing Claude mascot with an overshoot, glows, then keys off and re-pops. Claude Code session-recaps aha beat.",
  html: `<div class='lbp-stage'>
    <div class='lbp-scene'>
      <svg class='lbp-bulb' viewBox='0 0 12 16' shape-rendering='crispEdges' aria-hidden='true'>
        <circle class='lbp-halo' cx='6' cy='6' r='8'/>
        <rect x='3' y='1' width='6' height='2' fill='#F5C84B'/>
        <rect x='2' y='2' width='8' height='6' fill='#F5C84B'/>
        <rect x='3' y='8' width='6' height='2' fill='#F5C84B'/>
        <rect x='3' y='2' width='2' height='3' fill='#FCE38A'/>
        <rect x='4' y='10' width='4' height='1' fill='#B8B0A5'/>
        <rect x='4' y='11' width='4' height='1' fill='#9A938A'/>
        <rect x='4' y='12' width='4' height='1' fill='#B8B0A5'/>
        <rect x='5' y='13' width='2' height='1' fill='#9A938A'/>
      </svg>
      <svg class='lbp-mascot' viewBox='0 0 16 16' shape-rendering='crispEdges' aria-hidden='true'>
        <rect class='lbp-arm lbp-arm-l' x='1' y='8' width='2' height='3' fill='#A84C30'/>
        <rect class='lbp-arm lbp-arm-r' x='13' y='8' width='2' height='3' fill='#A84C30'/>
        <rect x='3' y='4' width='10' height='9' rx='2' fill='#C9785C'/>
        <rect x='3' y='3' width='10' height='3' rx='1' fill='#D38A6B'/>
        <g class='lbp-eyes'>
          <rect x='5' y='6' width='2' height='2' fill='#1A1A1A'/>
          <rect x='9' y='6' width='2' height='2' fill='#1A1A1A'/>
        </g>
        <rect x='5' y='13' width='2' height='2' fill='#A84C30'/>
        <rect x='9' y='13' width='2' height='2' fill='#A84C30'/>
      </svg>
    </div>
  </div>`,
  init(card) {
    const bulb = card.querySelector(".lbp-bulb")
    const halo = card.querySelector(".lbp-halo")
    const mascot = card.querySelector(".lbp-mascot")
    const eyes = card.querySelector(".lbp-eyes")
    const arms = card.querySelectorAll(".lbp-arm")
    /* contentful rest: bulb lit + visible above a settled, looking-up mascot */
    gsap.set(mascot, { y: 0, transformOrigin: "50% 100%" })
    gsap.set(eyes, { y: -0.6 })
    gsap.set(arms, { y: 0, rotation: 0 })
    gsap.set(bulb, { scale: 1, autoAlpha: 1, transformOrigin: "50% 100%" })
    gsap.set(halo, { opacity: 0.85, transformOrigin: "50% 50%" })
    return () => {
      gsap.killTweensOf([mascot, eyes, ...arms, bulb, halo])
      gsap.set(mascot, { y: 0, transformOrigin: "50% 100%" })
      gsap.set(eyes, { y: 0 })
      gsap.set(arms, { y: 0, rotation: 0 })
      gsap.set(bulb, { scale: 0, autoAlpha: 0, transformOrigin: "50% 100%" })
      gsap.set(halo, { opacity: 0, transformOrigin: "50% 50%" })
      const tl = gsap.timeline()
      /* continuous head bob; bulb gets an identical synced bob so it rides the head in lockstep.
         repeat:3 = 4 even iterations -> span 2.8s, lands back at y:0 (rest), no dead tail */
      tl.to(mascot, { y: -2.4, duration: 0.7, ease: "sine.inOut", yoyo: true, repeat: 3 }, 0)
      tl.to(bulb, { y: -2.4, duration: 0.7, ease: "sine.inOut", yoyo: true, repeat: 3 }, 0)
      /* POP IN with overshoot + eyes glance up at the idea */
      tl.to(bulb, { scale: 1, autoAlpha: 1, duration: 0.18, ease: "back.out(3)" }, 0.45)
      tl.to(halo, { opacity: 0.85, duration: 0.22, ease: "power2.out" }, 0.45)
      tl.to(eyes, { y: -0.6, duration: 0.16, ease: "power2.out" }, 0.42)
      /* glow breathe while lit */
      tl.to(halo, { opacity: 0.45, duration: 0.5, ease: "sine.inOut", yoyo: true, repeat: 1 }, 0.7)
      /* mascot turns front -> idea keys OFF */
      tl.to(eyes, { y: 0, duration: 0.16, ease: "power2.in" }, 1.9)
      tl.to(bulb, { scale: 0, autoAlpha: 0, duration: 0.14, ease: "power2.in" }, 1.9)
      tl.to(halo, { opacity: 0, duration: 0.14, ease: "power2.in" }, 1.9)
      /* returns to thinking pose -> RE-POP, lands lit (rest state) */
      tl.to(eyes, { y: -0.6, duration: 0.16, ease: "power2.out" }, 2.45)
      tl.to(bulb, { scale: 1, autoAlpha: 1, duration: 0.18, ease: "back.out(3)" }, 2.5)
      tl.to(halo, { opacity: 0.85, duration: 0.22, ease: "power2.out" }, 2.5)
      return tl
    }
  }
},

  {
  id: "focus-pull-dim", isNew: true, cat: "Layer", display: "Focus-Pull History Dim",
  source: ["claude-code-session-recaps"],
  desc: "Resolved log history dims to ~0.35 with its accent bullets desaturating to pale salmon, in lockstep with a fresh recap line arriving at full opacity to own the focus. Claude Code session-recap emphasis beat.",
  html: `<div class='fpd-stage'>
    <div class='fpd-log'>
      <div class='fpd-history' data-fpd-hist>
        <div class='fpd-row'><span class='fpd-dot'></span><span class='fpd-txt'>read auth.ts · 142 lines</span><span class='fpd-tag'>4m</span></div>
        <div class='fpd-row'><span class='fpd-dot'></span><span class='fpd-txt'>edit token refresh guard</span><span class='fpd-tag'>3m</span></div>
        <div class='fpd-row'><span class='fpd-dot'></span><span class='fpd-txt'>run vitest · 57 passed</span><span class='fpd-tag'>2m</span></div>
        <div class='fpd-row'><span class='fpd-dot'></span><span class='fpd-txt'>commit · fix session expiry</span><span class='fpd-tag'>1m</span></div>
      </div>
      <div class='fpd-focus' data-fpd-focus>
        <span class='fpd-spark'>✳</span>
        <span class='fpd-line'>Recap: hardened the refresh path and locked the regression behind a test.</span>
      </div>
    </div>
  </div>`,
  init(card) {
    const hist  = card.querySelector("[data-fpd-hist]")
    const dots  = card.querySelectorAll(".fpd-dot")
    const focus = card.querySelector("[data-fpd-focus]")
    const DIM = 0.35
    const PALE = "saturate(0.4) brightness(1.35)"
    // contentful rest: history already dimmed + desaturated, recap line crisp
    gsap.set(hist,  { opacity: DIM })
    gsap.set(dots,  { filter: PALE })
    gsap.set(focus, { opacity: 1, y: 0 })
    return () => {
      gsap.killTweensOf([hist, ...dots, focus])
      // reset to pre-pull: full-contrast history, recap not yet arrived
      gsap.set(hist,  { opacity: 1 })
      gsap.set(dots,  { filter: "saturate(1) brightness(1)" })
      gsap.set(focus, { opacity: 0, y: 8 })
      const tl = gsap.timeline({ defaults: { ease: "power2.out" } })
      // focus-pull: history recedes in lockstep with the recap line landing
      tl.to(hist,  { opacity: DIM, duration: 0.4 }, 0.5)
      tl.to(dots,  { filter: PALE, duration: 0.4 }, "<")
      tl.to(focus, { opacity: 1, y: 0, duration: 0.45 }, "<")
      return tl
    }
  }
},

  {
  id: "tab-switch-bodyswap", isNew: true, cat: "UI", display: "Tab Switch Body-Swap",
  source: ["claude-code-session-recaps"],
  desc: "Two session tabs cross-fade fill and weight, a terracotta underline slides under the newly active tab, and the whole body hard-swaps to the new conversation behind the crossfade. Claude Code session recaps multi-session window.",
  html: `<div class='tsb-stage'>
    <div class='tsb-window' data-tsb-window>
      <div class='tsb-bar'>
        <div class='tsb-tabs'>
          <div class='tsb-tab' data-tsb-tab-a><span class='tsb-glyph'>#</span>auth-refactor</div>
          <div class='tsb-tab' data-tsb-tab-b><span class='tsb-glyph'>#</span>db-migrate</div>
        </div>
        <div class='tsb-underline' data-tsb-underline></div>
      </div>
      <div class='tsb-body'>
        <div class='tsb-page' data-tsb-body-a>
          <div class='tsb-row tsb-you'><span class='tsb-mark'>&gt;</span>refactor the token guard</div>
          <div class='tsb-row'><span class='tsb-dot'></span>patched auth.ts <span class='tsb-meta'>+18 -6</span></div>
          <div class='tsb-row tsb-res'>└ 3 tests pass</div>
        </div>
        <div class='tsb-page' data-tsb-body-b>
          <div class='tsb-row tsb-you'><span class='tsb-mark'>&gt;</span>run the pending migration</div>
          <div class='tsb-row'><span class='tsb-dot'></span>applied 0042_add_index <span class='tsb-meta'>1.2s</span></div>
          <div class='tsb-row tsb-res'>└ schema in sync</div>
        </div>
      </div>
    </div>
  </div>`,
  init(card) {
    const tabA = card.querySelector("[data-tsb-tab-a]")
    const tabB = card.querySelector("[data-tsb-tab-b]")
    const underline = card.querySelector("[data-tsb-underline]")
    const bodyA = card.querySelector("[data-tsb-body-a]")
    const bodyB = card.querySelector("[data-tsb-body-b]")

    // active = white fill, bold ink label; inactive = warm-gray fill, dim label.
    const ACTIVE_BG = "#FFFFFF", INACTIVE_BG = "#EDE9E1"
    const ACTIVE_INK = "#1A1A1A", DIM_INK = "#A8A39A"
    const ACCENT = "#C15B3C"

    // underline rides under whichever tab is active; measured from tab offsets so it
    // tracks layout at the live ~360x240 card size.
    function placeUnderline(tabEl) {
      gsap.set(underline, { x: tabEl.offsetLeft, width: tabEl.offsetWidth, backgroundColor: ACCENT })
    }
    function activate(active, inactive) {
      gsap.set(active, { backgroundColor: ACTIVE_BG, color: ACTIVE_INK, fontWeight: 700 })
      gsap.set(inactive, { backgroundColor: INACTIVE_BG, color: DIM_INK, fontWeight: 400 })
      placeUnderline(active)
    }
    function rest() {
      // resting state: tab B active, body B visible (per build_spec)
      activate(tabB, tabA)
      gsap.set(bodyA, { autoAlpha: 0 })
      gsap.set(bodyB, { autoAlpha: 1 })
    }
    rest()
    // re-place once layout settles / fonts load so the underline lands exactly
    requestAnimationFrame(() => { if (Number(gsap.getProperty(tabB, "fontWeight")) >= 700) placeUnderline(tabB) })
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => placeUnderline(tabB))

    let tl = null
    return function replay() {
      if (tl) { tl.kill(); tl = null }
      gsap.killTweensOf([tabA, tabB, underline, bodyA, bodyB])
      // reset to the OTHER tab (A) active so the switch to B is the visible beat
      activate(tabA, tabB)
      gsap.set(bodyA, { autoAlpha: 1 })
      gsap.set(bodyB, { autoAlpha: 0 })

      tl = gsap.timeline({ defaults: { ease: "power2.out" } })
      // hold on session A so the viewer registers it
      tl.to({}, { duration: 0.7 })
      // tab color/weight crossfade — old dims, new brightens
      tl.to(tabA, { backgroundColor: INACTIVE_BG, color: DIM_INK, fontWeight: 400, duration: 0.15 }, "switch")
      tl.to(tabB, { backgroundColor: ACTIVE_BG, color: ACTIVE_INK, fontWeight: 700, duration: 0.15 }, "switch")
      // accent underline slides under the newly active tab
      tl.to(underline, { x: tabB.offsetLeft, width: tabB.offsetWidth, duration: 0.16, ease: "power2.inOut" }, "switch")
      // body hard-swaps instantly mid-crossfade — the tab transition masks the replace
      tl.set(bodyA, { autoAlpha: 0 }, "switch+=0.07")
      tl.set(bodyB, { autoAlpha: 1 }, "switch+=0.07")
      // rest on session B
      tl.to({}, { duration: 0.5 })
      return tl
    }
  }
},

  {
  id: "globe-rotate-flightpaths", isNew: true, cat: "Data Viz", display: "Dotted Globe with Flight-Path Arcs",
  source: ["code-w-claude-conf"],
  desc: "A stipple globe rotates inside a circular clip over a diagonal-hatch ocean while terracotta great-circle arcs draw between pinned city chips that drop in pin-first. From the Code w/ Claude conference poster.",
  html: `<div class='grf-stage'>
    <div class='grf-frame'>
      <svg class='grf-svg' viewBox='0 0 200 200' data-grf-svg>
        <defs>
          <clipPath id='grf-disc'><circle cx='100' cy='100' r='82'/></clipPath>
          <pattern id='grf-hatch' width='7' height='7' patternUnits='userSpaceOnUse' patternTransform='rotate(45)'>
            <line x1='0' y1='0' x2='0' y2='7' stroke='#2d2a22' stroke-width='0.7' stroke-opacity='0.32'/>
          </pattern>
        </defs>
        <g clip-path='url(#grf-disc)'>
          <rect x='18' y='18' width='164' height='164' fill='#dcdcc9'/>
          <rect x='18' y='18' width='164' height='164' fill='url(#grf-hatch)'/>
          <g class='grf-land' data-grf-land></g>
        </g>
        <circle class='grf-rim' cx='100' cy='100' r='82'/>
        <g class='grf-arcs' data-grf-arcs>
          <path class='grf-arc' data-grf-arc d='M 58 118 Q 100 36 150 92'/>
          <path class='grf-arc' data-grf-arc d='M 150 92 Q 132 138 92 142'/>
        </g>
        <g class='grf-cities' data-grf-cities>
          <g class='grf-city' data-grf-city style='--gx:58px;--gy:118px'>
            <line class='grf-drop' x1='58' y1='118' x2='58' y2='100'/>
            <rect class='grf-pin' x='55.5' y='115.5' width='5' height='5' rx='1'/>
          </g>
          <g class='grf-city' data-grf-city style='--gx:150px;--gy:92px'>
            <line class='grf-drop' x1='150' y1='92' x2='150' y2='74'/>
            <rect class='grf-pin' x='147.5' y='89.5' width='5' height='5' rx='1'/>
          </g>
          <g class='grf-city' data-grf-city style='--gx:92px;--gy:142px'>
            <line class='grf-drop' x1='92' y1='142' x2='92' y2='124'/>
            <rect class='grf-pin' x='89.5' y='139.5' width='5' height='5' rx='1'/>
          </g>
        </g>
      </svg>
      <div class='grf-chip' data-grf-chip style='left:51px;top:88px'>SF</div>
      <div class='grf-chip' data-grf-chip style='left:152px;top:60px'>LDN</div>
      <div class='grf-chip' data-grf-chip style='left:84px;top:114px'>TYO</div>
    </div>
  </div>`,
  init(card) {
    const NS = "http://www.w3.org/2000/svg"
    const landG = card.querySelector("[data-grf-land]")
    const arcs = Array.from(card.querySelectorAll("[data-grf-arc]"))
    const pins = Array.from(card.querySelectorAll(".grf-pin"))
    const drops = Array.from(card.querySelectorAll(".grf-drop"))
    const chips = Array.from(card.querySelectorAll("[data-grf-chip]"))

    // Build a 200-wide stipple tile of landmass-ish dot clusters, duplicated at +200 for a seamless scroll loop.
    if (!landG.childNodes.length) {
      const TILE = 200
      // pseudo-random but deterministic dot field across the tile band (y 22..178)
      let seed = 7
      const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280 }
      const dots = []
      for (let i = 0; i < 130; i++) {
        // bias dots into a few horizontal landmass bands so it reads as continents, not noise
        const band = [44, 72, 100, 128, 156][Math.floor(rnd() * 5)]
        const x = rnd() * TILE
        const y = band + (rnd() - 0.5) * 30
        if (y < 24 || y > 176) continue
        dots.push({ x, y, r: 1.1 + rnd() * 0.7 })
      }
      const paint = (xOff) => {
        dots.forEach(d => {
          const c = document.createElementNS(NS, "circle")
          c.setAttribute("cx", String(d.x + xOff))
          c.setAttribute("cy", String(d.y))
          c.setAttribute("r", String(d.r))
          c.setAttribute("fill", "#2d2a22")
          c.setAttribute("fill-opacity", "0.82")
          landG.appendChild(c)
        })
      }
      paint(0); paint(200)
    }

    const arcLens = arcs.map(a => (a.getTotalLength ? a.getTotalLength() : 120))

    // Resting state: globe mid-rotation, arcs drawn, pins seated, chips placed.
    gsap.set(landG, { x: 0 })
    arcs.forEach((a, i) => gsap.set(a, { strokeDasharray: arcLens[i], strokeDashoffset: 0, autoAlpha: 1 }))
    gsap.set(pins, { y: 0, autoAlpha: 1 })
    gsap.set(drops, { autoAlpha: 0.55, scaleY: 1, transformOrigin: "top" })
    gsap.set(chips, { autoAlpha: 1, y: 0, scale: 1 })

    // Ambient, always-on globe rotation (linear, seamless). Kept alive across replays.
    let spin = null
    const startSpin = () => {
      if (spin) spin.kill()
      gsap.set(landG, { x: 0 })
      spin = gsap.to(landG, { x: -200, duration: 16, ease: "none", repeat: -1 })
    }
    startSpin()

    let tl = null
    return function replay() {
      if (tl) { tl.kill(); tl = null }
      gsap.killTweensOf([...arcs, ...pins, ...drops, ...chips])
      startSpin()

      // Hidden start: arcs undrawn, pins above + invisible, chips tucked + hidden.
      arcs.forEach((a, i) => gsap.set(a, { strokeDasharray: arcLens[i], strokeDashoffset: arcLens[i], autoAlpha: 1 }))
      gsap.set(pins, { y: -11, autoAlpha: 0 })
      gsap.set(drops, { autoAlpha: 0, scaleY: 0, transformOrigin: "top" })
      gsap.set(chips, { autoAlpha: 0, y: -8, scale: 0.85 })

      tl = gsap.timeline()
      // Pins drop in, city by city, with a slight overshoot.
      pins.forEach((pin, i) => {
        const at = 0.35 + i * 0.3
        tl.to(pin, { y: 0, autoAlpha: 1, duration: 0.32, ease: "back.out(1.6)" }, at)
        tl.to(drops[i], { scaleY: 1, autoAlpha: 0.55, duration: 0.22, ease: "power2.out" }, at + 0.12)
        tl.to(chips[i], { y: 0, scale: 1, autoAlpha: 1, duration: 0.34, ease: "back.out(1.5)" }, at + 0.16)
      })
      // Great-circle arcs draw between the seated cities, bowing upward.
      arcs.forEach((a, i) => {
        tl.to(a, { strokeDashoffset: 0, duration: 0.55, ease: "power2.out" }, 0.95 + i * 0.4)
      })
      return tl
    }
  }
},

  {
    id: "morphing-node-graph", isNew: true, cat: "Motion", display: "Morphing Node Graph",
    source: ["claude-financial-services"],
    desc: "A coral node network continuously re-forms between mesh, hex wheel, cube wireframe and scatter topologies, edges stretching to follow with a hand-drawn wobble. Claude for Financial Services agent-template motif.",
    html: `<div class='mng-stage'>
      <svg class='mng-svg' viewBox='0 0 200 130' preserveAspectRatio='xMidYMid meet' data-mng-svg aria-hidden='true'>
        <g class='mng-edges' data-mng-edges></g>
        <g class='mng-nodes' data-mng-nodes></g>
      </svg>
    </div>`,
    init(card) {
      const NS = "http://www.w3.org/2000/svg"
      const svg = card.querySelector("[data-mng-svg]")
      const edgeG = card.querySelector("[data-mng-edges]")
      const nodeG = card.querySelector("[data-mng-nodes]")
      const N = 7, CX = 100, CY = 65

      // 4 topologies, each 7 {x,y} (viewBox 200x130, centered ~100,65)
      const mesh = [
        { x: 100, y: 22 }, { x: 50, y: 52 }, { x: 150, y: 52 },
        { x: 38, y: 100 }, { x: 100, y: 84 }, { x: 162, y: 100 }, { x: 100, y: 116 }
      ]
      const hex = [
        { x: 100, y: 65 }, { x: 100, y: 22 }, { x: 152, y: 44 },
        { x: 152, y: 86 }, { x: 100, y: 108 }, { x: 48, y: 86 }, { x: 48, y: 44 }
      ]
      const cube = [
        { x: 58, y: 36 }, { x: 130, y: 30 }, { x: 142, y: 96 },
        { x: 70, y: 102 }, { x: 92, y: 56 }, { x: 152, y: 52 }, { x: 98, y: 112 }
      ]
      const scatter = [
        { x: 32, y: 30 }, { x: 168, y: 24 }, { x: 176, y: 92 },
        { x: 24, y: 104 }, { x: 96, y: 62 }, { x: 120, y: 110 }, { x: 60, y: 70 }
      ]
      const LAYOUTS = [mesh, hex, cube, scatter]

      // connectivity per topology (node-index pairs)
      const C_MESH = [[0,1],[0,2],[1,2],[1,4],[2,4],[1,3],[3,4],[4,5],[2,5],[4,6],[3,6],[5,6]]
      const C_HEX  = [[0,1],[0,2],[0,3],[0,4],[0,5],[0,6],[1,2],[2,3],[3,4],[4,5],[5,6],[6,1]]
      const C_CUBE = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,2],[2,6],[6,3],[0,4],[1,5],[5,6],[4,6]]
      const C_SCAT = [[4,6],[6,0],[4,1],[4,5],[2,5],[0,3],[1,2]]
      const CONN = [C_MESH, C_HEX, C_CUBE, C_SCAT]

      // union of all edges => fixed DOM pool, toggled per topology
      const key = (a, b) => a < b ? a + "-" + b : b + "-" + a
      const union = new Map()
      CONN.forEach(set => set.forEach(([a, b]) => union.set(key(a, b), [a, b])))
      const edgeDefs = [...union.values()]

      // build node state objects (base position + wobble offset)
      const nodes = []
      for (let i = 0; i < N; i++) {
        const c = document.createElementNS(NS, "circle")
        c.setAttribute("class", "mng-node")
        c.setAttribute("r", i === 4 ? "6.2" : "5")
        nodeG.appendChild(c)
        nodes.push({ el: c, x: mesh[i].x, y: mesh[i].y, wx: 0, wy: 0 })
      }
      // build edge pool
      const edges = edgeDefs.map(([a, b]) => {
        const l = document.createElementNS(NS, "line")
        l.setAttribute("class", "mng-edge")
        edgeG.appendChild(l)
        return { el: l, a, b, on: 0 }
      })
      const activeSet = (topoIdx) => {
        const s = new Set(CONN[topoIdx].map(([a, b]) => key(a, b)))
        return s
      }

      // single render: writes final cx/cy (base + wobble) to nodes, then edge endpoints
      const render = () => {
        for (const n of nodes) {
          n.el.setAttribute("cx", (n.x + n.wx).toFixed(2))
          n.el.setAttribute("cy", (n.y + n.wy).toFixed(2))
        }
        for (const e of edges) {
          const na = nodes[e.a], nb = nodes[e.b]
          e.el.setAttribute("x1", (na.x + na.wx).toFixed(2))
          e.el.setAttribute("y1", (na.y + na.wy).toFixed(2))
          e.el.setAttribute("x2", (nb.x + nb.wx).toFixed(2))
          e.el.setAttribute("y2", (nb.y + nb.wy).toFixed(2))
          e.el.setAttribute("stroke-opacity", e.on.toFixed(3))
        }
      }

      let master = null
      const wobbles = []
      const seedTopology = (idx) => {
        const L = LAYOUTS[idx]
        nodes.forEach((n, i) => { n.x = L[i].x; n.y = L[i].y; n.wx = 0; n.wy = 0 })
        const set = activeSet(idx)
        edges.forEach(e => { e.on = set.has(key(e.a, e.b)) ? 1 : 0 })
        render()
      }

      // contentful resting state: settled mesh
      seedTopology(0)

      return function replay() {
        if (master) { master.kill(); master = null }
        wobbles.forEach(w => w.kill())
        wobbles.length = 0
        gsap.killTweensOf(nodes)
        gsap.killTweensOf(edges)

        seedTopology(0)

        // continuous hand-drawn wobble, random phase per node
        nodes.forEach((n, i) => {
          n.wx = 0; n.wy = 0
          wobbles.push(gsap.to(n, {
            wx: 1.2, wy: 1.0, duration: 0.6 + Math.random() * 0.25,
            yoyo: true, repeat: -1, ease: "sine.inOut",
            delay: Math.random() * 0.6
          }))
        })

        // master morph loop; onUpdate drives the single render every tick
        master = gsap.timeline({ repeat: -1, onUpdate: render })
        const order = [1, 2, 3, 0] // hex -> cube -> scatter -> back to mesh
        const HOLD = 0.18
        order.forEach((idx, step) => {
          const L = LAYOUTS[idx]
          const set = activeSet(idx)
          // morph node base positions to the new topology
          master.to(nodes, {
            x: (i) => L[i].x, y: (i) => L[i].y,
            duration: 0.85, ease: "power1.inOut", stagger: 0.02
          }, step === 0 ? 0.35 : "+=" + HOLD)
          // cross-fade edge connectivity in parallel
          master.to(edges, {
            on: (i) => set.has(key(edges[i].a, edges[i].b)) ? 1 : 0,
            duration: 0.6, ease: "power1.inOut"
          }, "<0.1")
        })
        return master
      }
    }
  },

  {
  id: "hand-drawn-stroke-construct", isNew: true, cat: "Reveal", display: "Hand-Drawn Stroke Construct",
  source: ["claude-financial-services"],
  desc: "A coral jewel dot lands first, then a variable-width calligraphic brush stroke inks itself on like ink from a nib. Claude for Financial Services opening squiggle.",
  html: `<div class='hsc-stage'>
    <div class='hsc-paper'>
      <svg class='hsc-svg' viewBox='0 0 240 120' fill='none' aria-hidden='true'>
        <!-- coral jewel tittle, lands first above the stroke -->
        <circle class='hsc-jewel' data-hsc-jewel cx='176' cy='30' r='8'></circle>
        <!-- ink body: a wide tapered calligraphic squiggle, drawn via dashoffset -->
        <path class='hsc-ink' data-hsc-ink d='M28,86 C40,52 58,40 70,58 C80,72 70,92 58,86 C46,80 56,52 78,50 C104,48 110,84 128,84 C146,84 150,52 166,52 C178,52 182,70 178,86 C176,96 168,98 166,90'></path>
        <!-- crisp nib guide riding on top of the ink body for the wet-edge feel -->
        <path class='hsc-guide' data-hsc-guide d='M28,86 C40,52 58,40 70,58 C80,72 70,92 58,86 C46,80 56,52 78,50 C104,48 110,84 128,84 C146,84 150,52 166,52 C178,52 182,70 178,86 C176,96 168,98 166,90'></path>
        <!-- the nib tip that leads the draw -->
        <circle class='hsc-nib' data-hsc-nib cx='28' cy='86' r='4.5'></circle>
      </svg>
    </div>
  </div>`,
  init(card) {
    const jewel = card.querySelector('[data-hsc-jewel]')
    const ink   = card.querySelector('[data-hsc-ink]')
    const guide = card.querySelector('[data-hsc-guide]')
    const nib   = card.querySelector('[data-hsc-nib]')

    const inkLen = (typeof ink.getTotalLength === 'function')
      ? (ink.getTotalLength() || 560) : 560
    const len = (inkLen && isFinite(inkLen) && inkLen > 0) ? inkLen : 560

    // nib rides the leading edge of the stroke as it draws
    function nibAt(progress) {
      const p = (typeof ink.getPointAtLength === 'function')
        ? ink.getPointAtLength(Math.min(len, Math.max(0, progress)) ) : null
      if (p) gsap.set(nib, { attr: { cx: p.x, cy: p.y } })
    }

    function applyDrawn() {
      // resting state: full squiggle + jewel inked on cream, nib parked at the end
      gsap.set(jewel, { scale: 1, autoAlpha: 1, transformOrigin: '50% 50%' })
      gsap.set(ink,   { strokeDasharray: len, strokeDashoffset: 0 })
      gsap.set(guide, { strokeDasharray: len, strokeDashoffset: 0 })
      gsap.set(nib,   { autoAlpha: 0 })
      nibAt(len)
    }
    applyDrawn()

    let tl = null
    return function replay() {
      if (tl) { tl.kill(); tl = null }
      gsap.killTweensOf([jewel, ink, guide, nib])

      // rest to START: jewel small/hidden, stroke un-drawn, nib at the origin
      gsap.set(jewel, { scale: 0, autoAlpha: 0, transformOrigin: '50% 50%' })
      gsap.set(ink,   { strokeDasharray: len, strokeDashoffset: len })
      gsap.set(guide, { strokeDasharray: len, strokeDashoffset: len })
      gsap.set(nib,   { autoAlpha: 0 })
      nibAt(0)

      const prog = { v: 0 }
      tl = gsap.timeline()
      // 1) coral jewel tittle lands first with a small overshoot
      tl.to(jewel, { scale: 1, autoAlpha: 1, duration: 0.18, ease: 'back.out(2.4)' }, 0.25)
      // 2) the brush inks on like a nib; ink body + crisp guide draw together
      tl.set(nib, { autoAlpha: 1 }, 0.46)
      tl.to(prog, {
        v: len, duration: 0.82, ease: 'power2.out',
        onUpdate: () => {
          gsap.set(ink,   { strokeDashoffset: len - prog.v })
          gsap.set(guide, { strokeDashoffset: len - prog.v })
          nibAt(prog.v)
        }
      }, 0.46)
      // 3) lift the nib off the page on the final dab, leaving the ink settled
      tl.to(nib, { autoAlpha: 0, scale: 1.6, duration: 0.18, ease: 'power2.in', transformOrigin: '50% 50%' }, '>-0.04')
      // hold the inked result, then reset to the resting drawn state
      tl.to({}, { duration: 1.1 })
      tl.add(applyDrawn)
      return tl
    }
  }
},

  {
  id: "focus-band-carousel", isNew: true, cat: "UI", display: "Focus-Band Chip Carousel",
  source: ["claude-financial-services"],
  desc: "A column of rounded pill chips scrolls steadily upward through a fixed central focus band that darkens, scales up and outlines whichever chip is centered while the rest fade gray (Claude for Financial Services template menu).",
  html: `<div class='fbc-stage'>
    <div class='fbc-viewport' data-fbc-vp>
      <div class='fbc-track' data-fbc-track></div>
      <div class='fbc-band' data-fbc-band aria-hidden='true'></div>
      <div class='fbc-fade fbc-fade-top' aria-hidden='true'></div>
      <div class='fbc-fade fbc-fade-bot' aria-hidden='true'></div>
    </div>
  </div>`,
  init(card) {
    const track = card.querySelector("[data-fbc-track]")

    // Agent-template menu items, from the Claude for Financial Services reference
    // (the vertical pill column that scrolls through the focus band, 0:11.3-0:14.5).
    const items = [
      "Earnings call summary",
      "DCF valuation model",
      "10-K risk extraction",
      "Comp set screener",
      "Portfolio rebalance",
      "Credit memo draft",
      "M&A target scan",
      "Covenant compliance"
    ]
    const N = items.length

    // Geometry (px). The track is duplicated (2 sets) for a seamless loop; the
    // focus band sits at the viewport vertical centre.
    const STRIDE = 30           // chip height + gap, one step of travel
    const VP_H = 240            // viewport height (full card)
    const CENTER = VP_H / 2     // focus-band centre line
    const FOCUS_R = STRIDE * 1.05   // distance from centre at which a chip is "fully out of focus"

    // Build two identical chip sets back-to-back so the loop wraps invisibly.
    track.innerHTML = ([...items, ...items]).map((label, i) =>
      "<div class='fbc-chip' data-fbc-chip><span class='fbc-chip-dot'></span>" +
      "<span class='fbc-chip-label'>" + label + "</span></div>"
    ).join("")
    const chips = track.querySelectorAll("[data-fbc-chip]")
    const dots = Array.from(chips, c => c.querySelector(".fbc-chip-dot"))  // cache once; style() runs per animation tick

    // The track's natural layout places chip k's centre at (k*STRIDE + STRIDE/2)
    // measured from the track top. We translate the track so that, at scroll s,
    // chip k's centre lands at: chipTop(k) - s. BASE biases the column up by half
    // its set so the viewport is FULL above AND below the band at rest (not a
    // half-empty bottom-anchored column), with chip floor(N/2) centred and lit.
    const SET_H = N * STRIDE
    const BASE = CENTER - STRIDE / 2 - (Math.floor(N / 2) * STRIDE)

    const lerp = (a, b, t) => a + (b - a) * t

    // Deterministic per-frame styling: derive everything from the scroll value `s`
    // so the effect is fully scrub-safe under timeline.time(t).
    function style(s) {
      // wrap scroll into one set so the duplicated chips cover the gap seamlessly
      const wrapped = ((s % SET_H) + SET_H) % SET_H
      track.style.transform = "translate3d(0," + (BASE - wrapped) + "px,0)"
      for (let i = 0; i < chips.length; i++) {
        const c = chips[i]
        const centreY = (i * STRIDE + STRIDE / 2) + (BASE - wrapped)
        const dist = Math.abs(centreY - CENTER)
        // t: 0 at band centre, 1 at the focus radius and beyond
        const t = Math.min(1, dist / FOCUS_R)
        const scale = lerp(1.0, 0.86, t)
        const opacity = lerp(1.0, 0.34, t)
        // colour: dark ink in focus -> muted gray at the edges
        const bg = t < 0.5 ? "#E8C7BC" : "#F0E0D8"
        c.style.opacity = opacity
        c.style.transform = "scale(" + scale.toFixed(3) + ")"
        c.style.background = bg
        c.style.color = t < 0.45 ? "#15140F" : "#9C968B"
        c.style.borderColor = t < 0.4 ? "rgba(21,20,15,0.28)" : "rgba(21,20,15,0)"
        c.style.fontWeight = t < 0.4 ? 600 : 500
        dots[i].style.background = t < 0.45 ? "#CF6F57" : "#C9C2B8"
      }
    }

    // Idle / resting state: column fills the viewport with one chip centred and lit.
    style(0)

    let tl = null
    return function replay() {
      if (tl) { tl.kill(); tl = null }
      const proxy = { v: 0 }
      tl = gsap.timeline({ repeat: -1 })
      // Steady upward marquee: advance exactly one full set per cycle so it loops
      // seamlessly. Linear cadence is intentional (a continuous scroll, not a move).
      tl.to(proxy, {
        v: SET_H,
        duration: N * 0.45,   // ~0.45s per chip advance
        ease: "none",
        onUpdate: () => style(proxy.v)
      })
      return tl
    }
  }
},

  {
  id: "perspective-tilt-settle", isNew: true, cat: "Camera", display: "3D Perspective Tilt-Settle",
  source: ["claude-financial-services"],
  desc: "Signature page-to-page transition from Claude for Financial Services: an incoming agent-template page enters rotated in 3D with a directional motion-blur smear, eases flat and crisp on power4.out, then the outgoing page whips off left with a skewed blur on power2.in.",
  html: `<div class='pts-stage'>
    <div class='pts-deck'>
      <div class='pts-page pts-out' data-pts='out'>
        <div class='pts-head'>
          <span class='pts-dot'></span>
          <span class='pts-ttl'>Cash Flow Agent</span>
          <span class='pts-tag'>active</span>
        </div>
        <div class='pts-row'><span class='pts-k'>liquidity</span><span class='pts-v'>$2.4M</span></div>
        <div class='pts-bars'><i style='height:42%'></i><i style='height:68%'></i><i style='height:55%'></i><i style='height:81%'></i><i style='height:63%'></i></div>
        <div class='pts-foot'>reconciled · 14:02</div>
      </div>
      <div class='pts-page pts-in' data-pts='in'>
        <div class='pts-head'>
          <span class='pts-dot'></span>
          <span class='pts-ttl'>Risk Review Agent</span>
          <span class='pts-tag'>ready</span>
        </div>
        <div class='pts-row'><span class='pts-k'>exposure</span><span class='pts-v'>0.18%</span></div>
        <div class='pts-bars'><i style='height:58%'></i><i style='height:39%'></i><i style='height:72%'></i><i style='height:46%'></i><i style='height:88%'></i></div>
        <div class='pts-foot'>scenario set · 12 holdings</div>
      </div>
    </div>
  </div>`,
  init(card) {
    const pageOut = card.querySelector('[data-pts="out"]')
    const pageIn  = card.querySelector('[data-pts="in"]')

    // contentful resting state: the incoming page sits flat, crisp, facing the viewer
    function applyIdle() {
      gsap.set(pageOut, { autoAlpha: 0, x: -120, skewX: 8, filter: 'blur(0px)' })
      gsap.set(pageIn,  { autoAlpha: 1, rotationY: 0, rotationX: 0, scale: 1, x: 0, skewX: 0, filter: 'blur(0px)', transformOrigin: 'center', force3D: true })
    }
    applyIdle()

    let tl = null

    return function replay() {
      if (tl) { tl.kill(); tl = null }

      // START: outgoing page is present + flat; incoming page is rotated back in 3D, smeared
      gsap.set(pageOut, { autoAlpha: 1, x: 0, skewX: 0, filter: 'blur(0px)', force3D: true })
      gsap.set(pageIn,  { autoAlpha: 0, rotationY: 14, rotationX: 6, scale: 0.94, x: 0, skewX: 0, transformOrigin: 'center', filter: 'blur(6px)', force3D: true })

      tl = gsap.timeline({ defaults: { lazy: false, force3D: true } })

      // hold the outgoing page so the viewer reads context
      tl.to({}, { duration: 0.45 }, 0)

      // EXIT WHIP: outgoing page skews + smears off to the left, power2.in
      tl.to(pageOut, { x: -120, skewX: 8, filter: 'blur(10px)', autoAlpha: 0, duration: 0.3, ease: 'power2.in' }, 0.45)

      // INCOMING: fade up fast, then the 3D tilt eases flat as the blur resolves crisp, power4.out
      tl.to(pageIn, { autoAlpha: 1, duration: 0.15, ease: 'sine.out' }, 0.6)
      tl.to(pageIn, { rotationY: 0, rotationX: 0, scale: 1, filter: 'blur(0px)', duration: 0.65, ease: 'power4.out' }, 0.6)

      // hold settled, then reset to idle (incoming page flat + crisp at rest)
      tl.to({}, { duration: 1.1 }, 1.25)
      tl.add(applyIdle, 2.35)
      return tl
    }
  }
},

  {
  id: "agent-to-agent-pipe", isNew: true, cat: "Data Viz", display: "Agent-to-Agent Message Pipe",
  source: ["claude-financial-services"],
  desc: "Two labeled agent chips bookend a horizontal rail that draws open; coral packets stream sender-to-receiver while a quoted dispatch surfaces beneath. Claude for Financial Services agent handoff.",
  html: `<div class='vp-stage'>
    <div class='a2a-wrap' data-a2a>
      <div class='a2a-pipe'>
        <div class='a2a-chip a2a-sender' data-a2a-chip>
          <span class='a2a-mark'>✳</span><span class='a2a-name'>Research Agent</span>
        </div>
        <div class='a2a-rail' data-a2a-rail>
          <span class='a2a-track'></span>
          <span class='a2a-packet' data-a2a-packet></span>
          <span class='a2a-packet' data-a2a-packet></span>
          <span class='a2a-packet' data-a2a-packet></span>
        </div>
        <div class='a2a-chip a2a-receiver' data-a2a-chip>
          <span class='a2a-mark'>✳</span><span class='a2a-name'>Analyst Agent</span>
        </div>
      </div>
      <div class='a2a-quote' data-a2a-quote>
        <span class='a2a-q-mark'>&ldquo;</span><span class='a2a-q-text'>Reconcile Q1 EBITDA against the source filing.</span>
      </div>
    </div>
  </div>`,
  init(card) {
    const wrap = card.querySelector("[data-a2a]")
    const chips = card.querySelectorAll("[data-a2a-chip]")
    const rail = card.querySelector("[data-a2a-rail]")
    const packets = card.querySelectorAll("[data-a2a-packet]")
    const quote = card.querySelector("[data-a2a-quote]")

    // travel distance for a packet across the rail (rail width minus a small inset)
    const railSpan = () => Math.max(0, rail.offsetWidth - 14)

    let loop = null
    let tl = null

    // start the perpetual packet stream; packets march sender -> receiver, restaggered
    function startLoop() {
      if (loop) { loop.kill(); loop = null }
      const span = railSpan()
      loop = gsap.timeline({ repeat: -1 })
      packets.forEach((p, i) => {
        gsap.set(p, { x: 0, autoAlpha: 0, scale: 0.8 })
        // each packet owns a 1.1s flight, offset so the rail always carries one in motion
        loop.to(p, { autoAlpha: 1, scale: 1, duration: 0.12, ease: "power2.out" }, i * 0.42)
        loop.to(p, { x: span, duration: 1.0, ease: "none" }, i * 0.42 + 0.04)
        loop.to(p, { autoAlpha: 0, scale: 0.8, duration: 0.16, ease: "power1.in" }, i * 0.42 + 0.92)
      })
      loop.to({}, { duration: 0.42 }) // pad so the cadence stays even across the wrap
    }

    // resting state: chips seated, rail open, quote visible, stream alive (contentful)
    gsap.set(chips, { autoAlpha: 1, x: 0, scale: 1 })
    gsap.set(rail, { scaleX: 1, transformOrigin: "left center" })
    gsap.set(quote, { autoAlpha: 1, y: 0 })
    startLoop()

    return function replay() {
      if (tl) { tl.kill(); tl = null }
      if (loop) { loop.kill(); loop = null }
      gsap.killTweensOf([...chips, rail, quote, ...packets])

      // hidden start
      gsap.set(chips, { autoAlpha: 0, scale: 0.86 })
      gsap.set(chips[0], { x: 14 })   // sender drifts in from the right
      gsap.set(chips[1], { x: -14 })  // receiver drifts in from the left
      gsap.set(rail, { scaleX: 0, transformOrigin: "left center" })
      gsap.set(quote, { autoAlpha: 0, y: 8 })
      gsap.set(packets, { autoAlpha: 0, x: 0, scale: 0.8 })

      tl = gsap.timeline()
      // chips converge onto the rail
      tl.to(chips, { autoAlpha: 1, x: 0, scale: 1, duration: 0.3, ease: "back.out(1.5)", stagger: 0.1 }, 0.15)
      // rail draws open left -> right
      tl.to(rail, { scaleX: 1, duration: 0.4, ease: "power2.out" }, "-=0.18")
      // quoted dispatch rises beneath
      tl.to(quote, { autoAlpha: 1, y: 0, duration: 0.28, ease: "power2.out" }, "-=0.1")
      // kick the perpetual packet stream once the rail is established
      tl.add(() => startLoop(), ">-0.05")
      // hold so the pipe reads as live
      tl.to({}, { duration: 1.6 })

      return tl
    }
  }
},

  {
  id: "source-citation-popover", isNew: true, cat: "UI", display: "Source-Trace Citation Popover",
  source: ["claude-financial-services"],
  desc: "Hovering an inline file citation highlights it pink and pops a source-trace card with a mini table where the cited row glows in the brand accent. Claude for Financial Services provenance/grounding moment.",
  html: `<div class='stc-stage'>
    <div class='stc-prose'>Q1 EBITDA rose to <span class='stc-val'>$4.1M</span>, per <span class='stc-cite' data-stc-cite>fy25-q1.pdf p.6</span>.</div>
    <div class='stc-pop' data-stc-pop>
      <div class='stc-pop-head'>
        <span class='stc-doc-ic'><svg viewBox='0 0 12 14'><path d='M2 0.5h5L10.5 4v9a0.5 0.5 0 0 1-0.5 0.5H2a0.5 0.5 0 0 1-0.5-0.5V1a0.5 0.5 0 0 1 0.5-0.5z'/><path d='M7 0.5V4h3.5'/></svg></span>
        <span class='stc-fname'>fy25-q1.pdf</span>
        <span class='stc-page'>Page 6</span>
      </div>
      <div class='stc-table'>
        <div class='stc-trow'><span class='stc-tk'>Revenue</span><span class='stc-tv'>$18.4M</span></div>
        <div class='stc-trow'><span class='stc-tk'>Op. expenses</span><span class='stc-tv'>$14.3M</span></div>
        <div class='stc-trow stc-cited' data-stc-cited><span class='stc-tk'>EBITDA</span><span class='stc-tv'>$4.1M</span></div>
        <div class='stc-trow'><span class='stc-tk'>Margin</span><span class='stc-tv'>22.3%</span></div>
      </div>
      <div class='stc-pop-foot'>Extracted by Agent · 14:02:38</div>
    </div>
  </div>`,
  init(card) {
    const cite = card.querySelector("[data-stc-cite]")
    const pop = card.querySelector("[data-stc-pop]")
    const cited = card.querySelector("[data-stc-cited]")
    /* contentful resting state: citation highlighted, popover open, cited row glowing */
    gsap.set(cite, { backgroundColor: "#F8E3DC", color: "#CF6F57" })
    gsap.set(pop, { scale: 1, autoAlpha: 1, transformOrigin: "top left" })
    gsap.set(cited, { backgroundColor: "#F8E3DC" })
    return () => {
      gsap.killTweensOf([cite, pop, cited])
      /* reset to pre-hover */
      gsap.set(cite, { backgroundColor: "rgba(0,0,0,0)", color: "#9C968B" })
      gsap.set(pop, { scale: 0.85, autoAlpha: 0, transformOrigin: "top left" })
      gsap.set(cited, { backgroundColor: "rgba(248,227,220,0)" })
      const tl = gsap.timeline({ delay: 0.45 })
      /* 1 — citation highlight pill */
      tl.to(cite, { backgroundColor: "#F8E3DC", color: "#CF6F57", duration: 0.15, ease: "power2.out" })
      /* 2 — popover materializes from the anchor */
      tl.to(pop, { scale: 1, autoAlpha: 1, duration: 0.3, ease: "power3.out" }, "-=0.02")
      /* 3 — cited row glows in, then settles to its resting tint */
      tl.to(cited, { backgroundColor: "#FBD3C8", duration: 0.18, ease: "power2.out" }, "-=0.1")
      tl.to(cited, { backgroundColor: "#F8E3DC", duration: 0.32, ease: "sine.inOut" })
      return tl
    }
  }
},

  {
    id: "waterfall-bridge-chart", isNew: true, cat: "Data Viz", display: "Waterfall Bridge Chart",
    source: ["claude-financial-services"],
    desc: "EBITDA bridge that draws bar-by-bar: a dark anchor, floating green gains and coral losses on running connectors, landing on the end anchor with values counting in. Claude for Financial Services agent templates.",
    html: `<div class='vp-stage'>
  <div class='wbc-card' data-wbc-card>
    <div class='wbc-head'>
      <span class='wbc-title'>EBITDA bridge</span>
      <span class='wbc-sub'>Q4 &rarr; Q1 &middot; $M</span>
    </div>
    <div class='wbc-plot' data-wbc-plot></div>
    <div class='wbc-axis' data-wbc-axis></div>
  </div>
</div>`,
    init(card) {
      const plot = card.querySelector("[data-wbc-plot]")
      const axis = card.querySelector("[data-wbc-axis]")

      // EBITDA bridge Q4 -> Q1: anchor, +gains, -losses, final anchor.
      // 8.2 + 1.9 + 0.8 - 0.6 - 0.4 = 9.9
      const data = [
        { label: "Q4",   type: "anchor", lo: 0,    hi: 8.2,  val: 8.2 },
        { label: "Rev",  type: "inc",    lo: 8.2,  hi: 10.1, val: 1.9 },
        { label: "Save", type: "inc",    lo: 10.1, hi: 10.9, val: 0.8 },
        { label: "Opex", type: "dec",    lo: 10.3, hi: 10.9, val: -0.6 },
        { label: "FX",   type: "dec",    lo: 9.9,  hi: 10.3, val: -0.4 },
        { label: "Q1",   type: "anchor", lo: 0,    hi: 9.9,  val: 9.9 }
      ]

      const PH = 112          // plot height in px (baseline at bottom)
      const MAXV = 12         // value -> px scale headroom (10.9 max running top)
      const k = PH / MAXV
      const n = data.length

      // Build bars + value labels + connectors as absolutely-positioned nodes.
      let barsHTML = ""
      data.forEach((d, i) => {
        const leftPct = (i + 0.5) / n * 100
        const bottomPx = d.lo * k
        const hPx = Math.max((d.hi - d.lo) * k, 2)
        const cls = "wbc-bar wbc-" + d.type
        const sign = d.type === "inc" ? "+" : (d.type === "dec" ? "−" : "")
        const absv = Math.abs(d.val).toFixed(1)
        const lbl = d.type === "anchor" ? absv : sign + absv
        barsHTML +=
          "<div class='" + cls + "' data-wbc-bar style='left:" + leftPct + "%;bottom:" + bottomPx + "px;height:" + hPx + "px'>" +
            "<span class='wbc-val' data-wbc-val style='bottom:" + (hPx + 3) + "px'>" + lbl + "</span>" +
          "</div>"
      })

      // Connectors: thin dashed line at each running-total level between bar i and i+1.
      let connHTML = ""
      for (let i = 0; i < n - 1; i++) {
        const level = data[i].hi              // running total after bar i
        const lA = (i + 0.5) / n * 100
        const lB = (i + 1.5) / n * 100
        const widthPct = lB - lA
        connHTML +=
          "<div class='wbc-conn' data-wbc-conn style='left:" + lA + "%;width:" + widthPct + "%;bottom:" + (level * k) + "px'></div>"
      }

      plot.style.height = PH + "px"
      plot.innerHTML = connHTML + barsHTML
      axis.innerHTML = data.map(d => "<span class='wbc-tick'>" + d.label + "</span>").join("")

      const bars = plot.querySelectorAll("[data-wbc-bar]")
      const vals = plot.querySelectorAll("[data-wbc-val]")
      const conns = plot.querySelectorAll("[data-wbc-conn]")

      // Resting state: fully drawn bridge, all labels + connectors visible.
      gsap.set(bars, { scaleY: 1, autoAlpha: 1, transformOrigin: "bottom" })
      gsap.set(vals, { autoAlpha: 1, y: 0 })
      gsap.set(conns, { autoAlpha: 0.55, scaleX: 1, transformOrigin: "left" })

      let tl = null
      return function replay() {
        if (tl) { tl.kill(); tl = null }
        gsap.killTweensOf([...bars, ...vals, ...conns])

        // Hidden start: bars collapsed to baseline, labels + connectors gone.
        gsap.set(bars, { scaleY: 0, autoAlpha: 1, transformOrigin: "bottom" })
        gsap.set(vals, { autoAlpha: 0, y: 4 })
        gsap.set(conns, { autoAlpha: 0, scaleX: 0, transformOrigin: "left" })

        tl = gsap.timeline({ delay: 0.35 })
        bars.forEach((bar, i) => {
          const at = i * 0.16
          tl.to(bar, { scaleY: 1, duration: 0.32, ease: "power2.out" }, at)
          tl.to(vals[i], { autoAlpha: 1, y: 0, duration: 0.2, ease: "power2.out" }, at + 0.18)
          // Connector from this bar to the next draws as the bar finishes.
          if (i < conns.length) {
            tl.to(conns[i], { autoAlpha: 0.55, scaleX: 1, duration: 0.22, ease: "power2.out" }, at + 0.2)
          }
        })
        // Hold the completed bridge so it reads.
        tl.to({}, { duration: 1.4 })
        return tl
      }
    }
  },

  {
  id: "workflow-stepper-progress", isNew: true, cat: "UI", display: "Workflow Stepper Progress",
  source: ["claude-financial-services"],
  desc: "A horizontal 1-2-3-4 pipeline rail advances: completed steps pop their chip to a green check and tint the connector, the active step fills coral, future steps stay gray. Claude for Financial Services agent templates.",
  html: `<div class='wsp-stage'>
    <div class='wsp-head'>Pipeline progress</div>
    <div class='wsp-rail'>
      <div class='wsp-step' data-wsp-step>
        <div class='wsp-chip' data-wsp-chip><span class='wsp-num' data-wsp-num>1</span><span class='wsp-check' data-wsp-check>&#10003;</span></div>
        <div class='wsp-lbl' data-wsp-lbl>Ingest</div>
      </div>
      <div class='wsp-conn' data-wsp-conn></div>
      <div class='wsp-step' data-wsp-step>
        <div class='wsp-chip' data-wsp-chip><span class='wsp-num' data-wsp-num>2</span><span class='wsp-check' data-wsp-check>&#10003;</span></div>
        <div class='wsp-lbl' data-wsp-lbl>Value</div>
      </div>
      <div class='wsp-conn' data-wsp-conn></div>
      <div class='wsp-step' data-wsp-step>
        <div class='wsp-chip' data-wsp-chip><span class='wsp-num' data-wsp-num>3</span><span class='wsp-check' data-wsp-check>&#10003;</span></div>
        <div class='wsp-lbl' data-wsp-lbl>Review</div>
      </div>
      <div class='wsp-conn' data-wsp-conn></div>
      <div class='wsp-step' data-wsp-step>
        <div class='wsp-chip' data-wsp-chip><span class='wsp-num' data-wsp-num>4</span><span class='wsp-check' data-wsp-check>&#10003;</span></div>
        <div class='wsp-lbl' data-wsp-lbl>Distribute</div>
      </div>
    </div>
  </div>`,
  init(card) {
    const GREEN = "#73D9AA", CORAL = "#CF6F57", GRAY = "#C9C4BC", INK = "#15140F"
    const chips = card.querySelectorAll("[data-wsp-chip]")
    const nums = card.querySelectorAll("[data-wsp-num]")
    const checks = card.querySelectorAll("[data-wsp-check]")
    const conns = card.querySelectorAll("[data-wsp-conn]")
    const lbls = card.querySelectorAll("[data-wsp-lbl]")
    const all = [...chips, ...nums, ...checks, ...conns, ...lbls]
    // done = steps that finish as green checks; active = current coral step; future = gray
    const done = [0, 1], active = 2
    // gray pending baseline for one step
    const pend = (i) => {
      gsap.set(chips[i], { backgroundColor: GRAY, borderColor: GRAY, scale: 1 })
      gsap.set(nums[i], { autoAlpha: 1, color: "#fff" })
      gsap.set(checks[i], { autoAlpha: 0 })
      gsap.set(lbls[i], { color: "#9b968d" })
    }
    const rest = () => {
      done.forEach(i => {
        gsap.set(chips[i], { backgroundColor: GREEN, borderColor: GREEN, scale: 1 })
        gsap.set(nums[i], { autoAlpha: 0, color: "#fff" })
        gsap.set(checks[i], { autoAlpha: 1 })
        gsap.set(lbls[i], { color: INK })
      })
      gsap.set(chips[active], { backgroundColor: CORAL, borderColor: CORAL, scale: 1 })
      gsap.set(nums[active], { autoAlpha: 1, color: "#fff" })
      gsap.set(checks[active], { autoAlpha: 0 })
      gsap.set(lbls[active], { color: INK })
      for (let i = active + 1; i < chips.length; i++) pend(i)
      conns.forEach((cn, i) => gsap.set(cn, { backgroundColor: i < active ? GREEN : GRAY }))
    }
    rest()
    return () => {
      gsap.killTweensOf(all)
      // pending baseline: every step gray, every connector gray
      chips.forEach((_, i) => pend(i))
      conns.forEach(cn => gsap.set(cn, { backgroundColor: GRAY }))
      const tl = gsap.timeline({ defaults: { ease: "power2.out" } })
      tl.to({}, { duration: 0.35 })
      // complete each done step in sequence: pop chip green, cross number -> check, tint incoming connector
      done.forEach((i, k) => {
        const at = k * 0.42
        if (i > 0) tl.to(conns[i - 1], { backgroundColor: GREEN, duration: 0.2, ease: "sine.inOut" }, at)
        tl.to(chips[i], { backgroundColor: GREEN, borderColor: GREEN, duration: 0.12, ease: "power1.out" }, at + 0.05)
        tl.to(chips[i], { scale: 1.15, duration: 0.12, ease: "back.out(2)" }, at + 0.05)
        tl.to(nums[i], { autoAlpha: 0, duration: 0.08 }, at + 0.07)
        tl.to(checks[i], { autoAlpha: 1, duration: 0.1 }, at + 0.1)
        tl.to(chips[i], { scale: 1, duration: 0.1, ease: "power2.inOut" }, at + 0.17)
      })
      // tint the connector leading into the active step, then fill it coral
      const aAt = done.length * 0.42
      tl.to(conns[active - 1], { backgroundColor: GREEN, duration: 0.2, ease: "sine.inOut" }, aAt)
      tl.to(chips[active], { backgroundColor: CORAL, borderColor: CORAL, duration: 0.15, ease: "sine.inOut" }, aAt + 0.12)
      tl.to(chips[active], { scale: 1.1, duration: 0.14, ease: "back.out(2)" }, aAt + 0.12)
      tl.to(chips[active], { scale: 1, duration: 0.12, ease: "power2.inOut" }, aAt + 0.26)
      tl.to(lbls[active], { color: INK, duration: 0.2 }, aAt + 0.12)
      return tl
    }
  }
},

  {
  id: "status-badge-resolve", isNew: true, cat: "Data Viz", display: "Queued-to-Resolved Badge Grid",
  source: ["claude-financial-services"],
  desc: "A grid of QUEUED task cards resolves in a stagger to green COMPLETE checks or an orange NEEDS-REVIEW alert, with metrics fading in and the flagged card gaining a coral outline. Claude for Financial Services agent templates.",
  html: `<div class='qrb-stage'>
    <div class='qrb-head'>Reconciliation queue<span class='qrb-head-count' data-qrb-count>4 items</span></div>
    <div class='qrb-grid' data-qrb-grid>
      <div class='qrb-card' data-qrb-card data-qrb-out='ok'>
        <div class='qrb-card-top'><span class='qrb-name'>Acme Corp</span>
          <span class='qrb-badge' data-qrb-badge>
            <span class='qrb-bdot'></span>
            <span class='qrb-blabel qrb-bq' data-qrb-q>QUEUED</span>
            <span class='qrb-blabel qrb-br' data-qrb-r><span class='qrb-glyph'>&#10003;</span>COMPLETE</span>
          </span>
        </div>
        <div class='qrb-metrics' data-qrb-metrics><span class='qrb-mval'>$48,512</span><span class='qrb-mdelta qrb-up'>matched</span></div>
        <div class='qrb-alert' data-qrb-alert>Variance over threshold<a class='qrb-open' data-qrb-open>Open &#8594;</a></div>
      </div>
      <div class='qrb-card' data-qrb-card data-qrb-out='ok'>
        <div class='qrb-card-top'><span class='qrb-name'>Northwind</span>
          <span class='qrb-badge' data-qrb-badge>
            <span class='qrb-bdot'></span>
            <span class='qrb-blabel qrb-bq' data-qrb-q>QUEUED</span>
            <span class='qrb-blabel qrb-br' data-qrb-r><span class='qrb-glyph'>&#10003;</span>COMPLETE</span>
          </span>
        </div>
        <div class='qrb-metrics' data-qrb-metrics><span class='qrb-mval'>$12,940</span><span class='qrb-mdelta qrb-up'>matched</span></div>
        <div class='qrb-alert' data-qrb-alert>Variance over threshold<a class='qrb-open' data-qrb-open>Open &#8594;</a></div>
      </div>
      <div class='qrb-card' data-qrb-card data-qrb-out='flag'>
        <div class='qrb-card-top'><span class='qrb-name'>Globex Ltd</span>
          <span class='qrb-badge' data-qrb-badge>
            <span class='qrb-bdot'></span>
            <span class='qrb-blabel qrb-bq' data-qrb-q>QUEUED</span>
            <span class='qrb-blabel qrb-rf' data-qrb-f><span class='qrb-glyph'>!</span>NEEDS REVIEW</span>
          </span>
        </div>
        <div class='qrb-metrics' data-qrb-metrics><span class='qrb-mval'>$7,108</span><span class='qrb-mdelta qrb-dn'>&minus;$842</span></div>
        <div class='qrb-alert' data-qrb-alert>Variance over threshold<a class='qrb-open' data-qrb-open>Open &#8594;</a></div>
      </div>
      <div class='qrb-card' data-qrb-card data-qrb-out='ok'>
        <div class='qrb-card-top'><span class='qrb-name'>Initech</span>
          <span class='qrb-badge' data-qrb-badge>
            <span class='qrb-bdot'></span>
            <span class='qrb-blabel qrb-bq' data-qrb-q>QUEUED</span>
            <span class='qrb-blabel qrb-br' data-qrb-r><span class='qrb-glyph'>&#10003;</span>COMPLETE</span>
          </span>
        </div>
        <div class='qrb-metrics' data-qrb-metrics><span class='qrb-mval'>$31,205</span><span class='qrb-mdelta qrb-up'>matched</span></div>
        <div class='qrb-alert' data-qrb-alert>Variance over threshold<a class='qrb-open' data-qrb-open>Open &#8594;</a></div>
      </div>
    </div>
  </div>`,
  init(card) {
    const cards = Array.from(card.querySelectorAll("[data-qrb-card]"))
    const items = cards.map(c => ({
      card: c,
      flagged: c.getAttribute("data-qrb-out") === "flag",
      badge: c.querySelector("[data-qrb-badge]"),
      dot: c.querySelector(".qrb-bdot"),
      q: c.querySelector("[data-qrb-q]"),
      r: c.querySelector("[data-qrb-q] ~ .qrb-br") || c.querySelector("[data-qrb-r]"),
      f: c.querySelector("[data-qrb-f]"),
      metrics: c.querySelector("[data-qrb-metrics]"),
      alert: c.querySelector("[data-qrb-alert]"),
      open: c.querySelector("[data-qrb-open]")
    }))
    const GREEN = "#73D9AA", CORAL = "#CF6F57", MUTED = "#9C968B"

    // resting / resolved state (contentful): everything resolved
    const applyResolved = () => {
      items.forEach(it => {
        gsap.set(it.q, { autoAlpha: 0 })
        gsap.set([it.r, it.f].filter(Boolean), { autoAlpha: 1 })
        gsap.set(it.badge, { scale: 1 })
        gsap.set(it.dot, { backgroundColor: it.flagged ? CORAL : GREEN })
        gsap.set(it.metrics, { autoAlpha: 1, y: 0 })
        if (it.flagged) {
          gsap.set(it.card, { boxShadow: "0 0 0 1.5px " + CORAL, borderColor: CORAL })
          gsap.set([it.alert, it.open], { autoAlpha: 1, y: 0 })
        } else {
          gsap.set(it.card, { boxShadow: "0 0 0 0px rgba(207,111,87,0)", borderColor: "rgba(21,20,15,0.08)" })
          gsap.set([it.alert, it.open], { autoAlpha: 0, y: 4 })
        }
      })
    }
    applyResolved()

    return () => {
      gsap.killTweensOf(items.flatMap(it => [it.card, it.badge, it.dot, it.q, it.r, it.f, it.metrics, it.alert, it.open].filter(Boolean)))
      // reset to QUEUED
      items.forEach(it => {
        gsap.set(it.q, { autoAlpha: 1 })
        gsap.set([it.r, it.f].filter(Boolean), { autoAlpha: 0 })
        gsap.set(it.badge, { scale: 1 })
        gsap.set(it.dot, { backgroundColor: MUTED })
        gsap.set(it.metrics, { autoAlpha: 0, y: 4 })
        gsap.set(it.card, { boxShadow: "0 0 0 0px rgba(207,111,87,0)", borderColor: "rgba(21,20,15,0.08)" })
        gsap.set([it.alert, it.open], { autoAlpha: 0, y: 4 })
      })
      const tl = gsap.timeline({ defaults: { ease: "power2.out" } })
      items.forEach((it, i) => {
        const t = 0.5 + i * 0.15
        // badge pop + recolor
        tl.to(it.badge, { scale: 1.12, duration: 0.12, ease: "back.out(3)" }, t)
        tl.to(it.dot, { backgroundColor: it.flagged ? CORAL : GREEN, duration: 0.12 }, t)
        // label crossfade QUEUED -> resolved
        tl.to(it.q, { autoAlpha: 0, duration: 0.1 }, t)
        tl.to(it.flagged ? it.f : it.r, { autoAlpha: 1, duration: 0.16 }, t + 0.04)
        tl.to(it.badge, { scale: 1, duration: 0.14, ease: "power2.out" }, t + 0.12)
        // metrics fade in
        tl.to(it.metrics, { autoAlpha: 1, y: 0, duration: 0.22 }, t + 0.06)
        // flagged: coral outline + alert line + open link
        if (it.flagged) {
          tl.to(it.card, { boxShadow: "0 0 0 1.5px " + CORAL, borderColor: CORAL, duration: 0.24, ease: "power2.out" }, t + 0.04)
          tl.to([it.alert, it.open], { autoAlpha: 1, y: 0, duration: 0.26, ease: "power2.out" }, t + 0.14)
        }
      })
      tl.to({}, { duration: 0.8 }) // hold resolved state
      return tl
    }
  }
},

  {
  id: "confetti-burst", isNew: true, cat: "Motion", display: "Confetti Success Burst",
  source: ["claude-financial-services"],
  desc: "Brand-colored confetti erupts from top-center with launch-then-gravity physics and per-piece tumble, synced to a success modal. Claude for Financial Services payoff beat.",
  html: `<div class='cfb-stage'>
    <div class='cfb-confetti' data-cfb-layer></div>
    <div class='cfb-modal' data-cfb-modal>
      <div class='cfb-check'>
        <svg viewBox='0 0 24 24' width='22' height='22' aria-hidden='true'>
          <path d='M5 12.5 L10 17.5 L19 7' fill='none' stroke='#fff' stroke-width='2.6' stroke-linecap='round' stroke-linejoin='round'/>
        </svg>
      </div>
      <div class='cfb-title'>Filing complete</div>
      <div class='cfb-sub'>10-K packaged &middot; 0 exceptions</div>
    </div>
  </div>`,
  init(card) {
    const layer = card.querySelector("[data-cfb-layer]")
    const modal = card.querySelector("[data-cfb-modal]")
    const COLORS = ["#CF6F57", "#73D9AA", "#15140F"]
    const N = 42

    // deterministic pseudo-random so scrubbing is stable across replays
    const rng = (seed) => { const x = Math.sin(seed * 99.13 + 4.7) * 43758.5453; return x - Math.floor(x) }
    const lerp = (a, b, t) => a + (b - a) * t

    // build the piece pool once
    layer.innerHTML = ""
    const pieces = []
    for (let i = 0; i < N; i++) {
      const p = document.createElement("div")
      p.className = "cfb-piece"
      const r1 = rng(i + 1), r2 = rng(i + 11), r3 = rng(i + 23)
      const tall = r3 > 0.5
      p.style.width = (tall ? 4 : 7) + "px"
      p.style.height = (tall ? 7 : 4) + "px"
      p.style.background = COLORS[i % COLORS.length]
      layer.appendChild(p)
      pieces.push({
        el: p,
        seedX: i,
        // spread biased so center is dense, tails reach the card edges
        launchX: lerp(-150, 150, r1) * (0.5 + r1 * 0.5),
        launchY: lerp(-118, -42, r2),
        fall: lerp(210, 280, r3),
        spin0: lerp(0, 360, r1),
        spinDrift: (r2 > 0.5 ? 1 : -1) * lerp(160, 420, r3),
        sway: (r1 > 0.5 ? 1 : -1) * lerp(14, 46, r2),
        riseDur: lerp(0.42, 0.56, r3),
        delay: r2 * 0.09
      })
    }
    const els = pieces.map(p => p.el)

    const restPieces = () => { gsap.set(els, { x: 0, y: 0, rotation: 0, autoAlpha: 0 }) }
    const restModal  = () => { gsap.set(modal, { autoAlpha: 1, y: 0, scale: 1 }) }

    // contentful rest: success modal visible, confetti cleared
    restPieces()
    restModal()

    return function replay() {
      gsap.killTweensOf(els)
      gsap.killTweensOf(modal)
      restPieces()
      gsap.set(modal, { autoAlpha: 0, y: 14, scale: 0.9 })

      const tl = gsap.timeline()
      // modal lands first
      tl.to(modal, { autoAlpha: 1, y: 0, scale: 1, duration: 0.42, ease: "back.out(1.7)" }, 0.1)

      // burst keyed to the modal settle — densest at t0
      const t0 = 0.42
      pieces.forEach((p) => {
        const a = t0 + p.delay
        // phase 1: launch up + outward
        tl.to(p.el, { autoAlpha: 1, duration: 0.01 }, a)
        tl.to(p.el, {
          x: p.launchX, y: p.launchY, rotation: p.spin0,
          duration: p.riseDur, ease: "power2.out"
        }, a)
        // phase 2: gravity fall + tumble + sway + fade (overlaps the rise apex)
        tl.to(p.el, {
          x: p.launchX + p.sway,
          y: p.launchY + p.fall,
          rotation: p.spin0 + p.spinDrift,
          autoAlpha: 0,
          duration: 1.15, ease: "power1.in"
        }, a + p.riseDur - 0.08)
      })

      // ensure a clean cleared rest at the end
      tl.add(restPieces)
      return tl
    }
  }
},

]
