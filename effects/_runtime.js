/* ============================================================
   lumiere effects - standalone runtime
   Mounts one effect.html either standalone (file:// or http)
   or inside the dashboard as an iframe. See effects/FORMAT.md.

   URL params:
     ?theme=light|dark   color scheme            (default light)
     ?chrome=card|flat   rounded preview vs video frame (default card)
     ?fit=scale|native   scale stage to window vs 1:1   (default scale)
     ?autoplay=1         run replay() once on mount      (default off)
     ?vars=<json>        variable overrides (future parametrization)

   Window API (for harnesses + dashboard direct access):
     LUMIERE_META      parsed meta object
     LUMIERE_VARS      resolved variables (defaults <- ?vars overrides)
     LUMIERE_READY     true once mounted in rest state
     LUMIERE_REPLAY()  restart animation; returns gsap timeline or undefined
     LUMIERE_PREPARE() replay + pause(0) + register window.__timelines[id];
                       returns {duration, scrubbable} (HyperFrames-style
                       paused-timeline registration, done lazily so the
                       default mount keeps the contentful REST state)

   postMessage protocol (portable fallback when the parent cannot
   reach contentWindow directly):
     in : {type:"lumiere", cmd:"replay"}
     in : {type:"lumiere", cmd:"theme", value:"light"|"dark"}
     in : {type:"lumiere", cmd:"prepare"}
     in : {type:"lumiere", cmd:"seek", t:<seconds>}
     out: {type:"lumiere", event:"ready",    id}
     out: {type:"lumiere", event:"prepared", id, duration, scrubbable}
   (a "rest" command existed briefly; removed - re-running init leaks
   timer/RAF loops in timer-driven effects, and nothing used it)
   ============================================================ */
(function () {
  const qs = new URLSearchParams(location.search)

  const card = document.getElementById("card")
  const viewport = card ? card.querySelector(".viewport") : null
  const metaEl = document.querySelector("script[data-effect-meta]")
  let META = {}
  try { META = metaEl ? JSON.parse(metaEl.textContent) : {} } catch (e) { console.error("lumiere: bad meta JSON", e) }
  window.LUMIERE_META = META

  /* theme */
  function setTheme(t) {
    document.documentElement.classList.remove("theme-light", "theme-dark")
    document.documentElement.classList.add(t === "dark" ? "theme-dark" : "theme-light")
  }
  setTheme(qs.get("theme") || "light")

  /* embedded (dashboard iframe): the stage fills the iframe NATIVELY,
     reproducing the old dashboard's fluid full-bleed viewport (no scaling,
     no letterbox; window-relative layout behaves identically to a card) */
  let embedded = false
  try { embedded = window.parent !== window } catch (e) {}
  if (embedded) document.documentElement.classList.add("embedded")

  /* chrome */
  if (qs.get("chrome") === "flat") card.classList.add("chrome-flat")

  /* stage size from data attributes (standalone); fluid when embedded */
  const W = Number(card.dataset.stageWidth || 360)
  const H = Number(card.dataset.stageHeight || 240)
  if (!embedded) {
    viewport.style.width = W + "px"
    viewport.style.height = H + "px"
  }

  /* fit: scale to window (contain), centered - standalone only */
  function fit() {
    if (embedded || qs.get("fit") === "native") return
    const s = Math.min(window.innerWidth / W, window.innerHeight / H)
    document.getElementById("fit").style.transform = "scale(" + s + ")"
  }
  window.addEventListener("resize", fit)

  /* variables (defaults from meta, overridable via ?vars=) */
  const vars = Object.assign({}, META.variables || {})
  try { if (qs.get("vars")) Object.assign(vars, JSON.parse(qs.get("vars"))) } catch (e) { console.error("lumiere: bad ?vars JSON", e) }
  window.LUMIERE_VARS = vars

  /* mount */
  let replay = null
  let lastTl = null

  window.LUMIERE_REPLAY = function () {
    if (!replay) return undefined
    const tl = replay()
    if (tl && typeof tl.pause === "function") lastTl = tl
    return tl
  }

  window.LUMIERE_PREPARE = function () {
    const tl = window.LUMIERE_REPLAY()
    const scrubbable = !!(tl && typeof tl.pause === "function")
    let duration = 0
    if (scrubbable) {
      tl.pause(0)
      duration = tl.duration()
      window.__timelines = window.__timelines || {}
      window.__timelines[META.id] = tl
    }
    return { duration: duration, scrubbable: scrubbable }
  }

  function mount() {
    if (typeof window.LUMIERE_INIT !== "function") {
      console.error("lumiere: LUMIERE_INIT missing in " + location.pathname)
      return
    }
    /* isolate init errors (the old dashboard's per-card try/catch): a broken
       effect still reaches READY + posts ready so the parent never wedges */
    try {
      const fn = window.LUMIERE_INIT(card)
      if (typeof fn === "function") replay = fn
    } catch (err) {
      console.error("lumiere: init failed for " + META.id, err)
    }
    fit()
    window.LUMIERE_READY = true
    if (qs.get("autoplay") === "1") window.LUMIERE_REPLAY()
    try {
      if (window.parent !== window) window.parent.postMessage({ type: "lumiere", event: "ready", id: META.id }, "*")
    } catch (e) {}
  }

  /* postMessage bridge */
  window.addEventListener("message", function (e) {
    const m = e.data
    if (!m || m.type !== "lumiere") return
    if (m.cmd === "replay") window.LUMIERE_REPLAY()
    else if (m.cmd === "theme") setTheme(m.value)
    else if (m.cmd === "prepare") {
      const r = window.LUMIERE_PREPARE()
      try { e.source.postMessage({ type: "lumiere", event: "prepared", id: META.id, duration: r.duration, scrubbable: r.scrubbable }, "*") } catch (err) {}
    }
    else if (m.cmd === "seek") {
      if (lastTl) lastTl.time(Number(m.t) || 0)
    }
  })

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount)
  else mount()
})()
