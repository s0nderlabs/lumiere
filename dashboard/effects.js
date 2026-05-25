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
    desc: "First word appears instantly, then the brand name types in character-by-character after a beat. ChatGPT opening interstitial pattern.",
    html: `<div class='iws-stage'><span class='iws-word' data-iws-word>With</span><span class='iws-spacer'> </span><span class='iws-typed' data-iws-typed></span></div>`,
    init(card) {
      const wordEl = card.querySelector("[data-iws-word]")
      const typedEl = card.querySelector("[data-iws-typed]")
      const brand = "ChatGPT"
      let timer = null, timer2 = null
      gsap.set(wordEl, { opacity: 1, y: 0 })
      typedEl.textContent = brand
      return () => {
        if (timer) clearTimeout(timer)
        if (timer2) clearInterval(timer2)
        gsap.killTweensOf(wordEl)
        gsap.set(wordEl, { opacity: 0, y: 10 })
        typedEl.textContent = ""
        gsap.to(wordEl, { opacity: 1, y: 0, duration: 0.35, ease: "expo.out" })
        let idx = 0
        timer = setTimeout(() => {
          timer2 = setInterval(() => {
            if (idx < brand.length) {
              typedEl.textContent = brand.slice(0, idx + 1)
              idx++
            } else {
              clearInterval(timer2)
              timer2 = null
            }
          }, 60)
        }, 400)
      }
    }
  },

  {
    id: "parallax-card-collage", isNew: true, cat: "Reveal", display: "Parallax Card Collage",
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
    desc: "Donut chart segments animate arcs from 0 to their value, with a green gradient palette. ChatGPT portfolio distribution.",
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
    desc: "Accounts sync one by one: spinning arc becomes a green dot on completion. ChatGPT Plaid connection flow.",
    html: `<div class='std-stage'>
      <div class='std-header'><div class='std-header-icon'><svg viewBox='0 0 12 12'><rect x='2' y='2' width='3' height='3' rx='0.5'/><rect x='7' y='2' width='3' height='3' rx='0.5'/><rect x='2' y='7' width='3' height='3' rx='0.5'/><rect x='7' y='7' width='3' height='3' rx='0.5'/></svg></div>Connecting with Plaid</div>
      <div class='std-list'>
        <div class='std-item' data-std><div class='std-item-icon' style='background:#016fd0'>AE</div><div class='std-item-name'>American Express<div class='std-item-sub'>1 account</div></div><div class='std-status' data-std-status><span class='std-spinner' data-std-spin style='animation:std-spin 0.7s linear infinite'></span>Syncing</div></div>
        <div class='std-item' data-std><div class='std-item-icon' style='background:#c41230'>BA</div><div class='std-item-name'>Bank of America<div class='std-item-sub'>2 accounts</div></div><div class='std-status' data-std-status><span class='std-spinner' data-std-spin style='animation:std-spin 0.7s linear infinite'></span>Syncing</div></div>
        <div class='std-item' data-std><div class='std-item-icon' style='background:#00a3de'>CS</div><div class='std-item-name'>Charles Schwab<div class='std-item-sub'>1 account</div></div><div class='std-status' data-std-status><span class='std-spinner' data-std-spin style='animation:std-spin 0.7s linear infinite'></span>Syncing</div></div>
        <div class='std-item' data-std><div class='std-item-icon' style='background:#6b3fa0'>ET</div><div class='std-item-name'>Etrade<div class='std-item-sub'>1 account</div></div><div class='std-status' data-std-status><span class='std-spinner' data-std-spin style='animation:std-spin 0.7s linear infinite'></span>Syncing</div></div>
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
    desc: "User bubble + streaming assistant response with tool-use indicator. ChatGPT conversation flow.",
    html: `<div class='ccv-stage'>
      <div class='ccv-user' data-ccv-user>Am I paying for subscriptions I don't need?</div>
      <div class='ccv-tool' data-ccv-tool>Querying financial data</div>
      <div class='ccv-response' data-ccv-resp></div>
    </div>`,
    init(card) {
      const user = card.querySelector("[data-ccv-user]")
      const tool = card.querySelector("[data-ccv-tool]")
      const resp = card.querySelector("[data-ccv-resp]")
      const fullResp = `I can see you're paying for <span class='ccv-bold'>4 fitness memberships.</span> Since your new job has you back in the office, you might consider only taking classes at your local gym. Canceling would save <span class='ccv-bold'>$329/month.</span>`
      const words = fullResp.split(/(?=<)|(\s+)/).filter(Boolean)
      resp.innerHTML = fullResp
      gsap.set(user, { opacity: 1, y: 0 })
      gsap.set(tool, { opacity: 0.5 })
      return () => {
        gsap.killTweensOf([user, tool, resp])
        gsap.set(user, { opacity: 0, y: 10 })
        gsap.set(tool, { opacity: 0 })
        resp.innerHTML = ""
        gsap.to(user, { opacity: 1, y: 0, duration: 0.3, ease: "power2.out", delay: 0.3 })
        gsap.to(tool, { opacity: 0.5, duration: 0.3, delay: 0.8 })
        let charIdx = 0
        const plain = "I can see you're paying for 4 fitness memberships. Since your new job has you back in the office, you might consider only taking classes at your local gym. Canceling would save $329/month."
        const startDelay = 1200
        let timer = null
        timer = setTimeout(() => {
          gsap.to(tool, { opacity: 0, duration: 0.2 })
          let ci = 0
          const iv = setInterval(() => {
            if (ci < plain.length) {
              const partial = plain.slice(0, ci + 1)
              resp.innerHTML = partial
                .replace(/4 fitness memberships\./g, "<span class='ccv-bold'>4 fitness memberships.</span>")
                .replace(/\$329\/month\./g, "<span class='ccv-bold'>$329/month.</span>")
              ci += 1 + Math.floor(Math.random() * 2)
            } else {
              resp.innerHTML = fullResp
              clearInterval(iv)
            }
          }, 25)
        }, startDelay)
      }
    }
  },

  {
    id: "inline-card-render", isNew: true, cat: "Chat", display: "Inline Card Render",
    desc: "A rich card with chart data materializes inside a text response. ChatGPT portfolio distribution in-context.",
    html: `<div class='icr-stage'>
      <div class='icr-prose' data-icr-prose>Your portfolio may be <span class='icr-bold'>less balanced than it looks.</span></div>
      <div class='icr-card' data-icr-card>
        <div class='icr-card-title'>Portfolio distribution</div>
        <div class='icr-card-val'>$102,938</div>
        <div class='icr-card-row'><span class='icr-card-dot' style='background:#1a5e3a'></span>Stocks<div class='icr-card-bar'><div class='icr-card-bar-fill' data-icr-fill style='background:#1a5e3a;width:47%'></div></div><span class='icr-card-amt'>$48,512</span></div>
        <div class='icr-card-row'><span class='icr-card-dot' style='background:#2e9b66'></span>ETFs<div class='icr-card-bar'><div class='icr-card-bar-fill' data-icr-fill style='background:#2e9b66;width:19%'></div></div><span class='icr-card-amt'>$19,134</span></div>
        <div class='icr-card-row'><span class='icr-card-dot' style='background:#5fcc88'></span>Bonds<div class='icr-card-bar'><div class='icr-card-bar-fill' data-icr-fill style='background:#5fcc88;width:18%'></div></div><span class='icr-card-amt'>$18,354</span></div>
        <div class='icr-card-row'><span class='icr-card-dot' style='background:#87ceeb'></span>Cash<div class='icr-card-bar'><div class='icr-card-bar-fill' data-icr-fill style='background:#87ceeb;width:6%'></div></div><span class='icr-card-amt'>$6,200</span></div>
      </div>
    </div>`,
    init(card) {
      const prose = card.querySelector("[data-icr-prose]")
      const crd = card.querySelector("[data-icr-card]")
      const fills = card.querySelectorAll("[data-icr-fill]")
      const rows = crd.querySelectorAll(".icr-card-row")
      const widths = ["47%", "19%", "18%", "6%"]
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

]
