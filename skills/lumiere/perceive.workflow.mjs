export const meta = {
  name: 'lumiere-perceive',
  description: 'Watch a reference video via fan-out subagents (scout-spine -> per-segment deep watch -> merge), returning a structured beat sheet while keeping the caller context clean',
  phases: [
    { title: 'Scout', detail: 'inspect + analyze + low-tier skim -> narrative spine + coverage plan' },
    { title: 'Watch', detail: 'one subagent per segment deep-watches its window at the configured tier' },
    { title: 'Merge', detail: 'concatenate + time-sort beats, synthesize the final summary' },
  ],
}

/* ------------------------------------------------------------------ *
 * lumiere perceive workflow
 *
 * Why this exists: watching a reference video thoroughly burns enormous
 * context because every watch() call returns inline base64 frames. Done
 * inline, "watch thoroughly" and "save context" fight each other. This
 * workflow does the watching in throwaway subagents (frames live + die
 * there) and returns only a small structured beat sheet to the caller.
 *
 * It honors the biblical thorough-coverage rule: the total number of
 * frame-coverage subchunks watched across all segments equals the tier's
 * chunks_for_full_coverage_thorough (N) from inspect. The fan-out just
 * groups those N subchunks into M parallel segments and isolates the
 * frame cost per segment.
 *
 * Narrative coherence is preserved by the scout pass: a cheap low-tier
 * skim of the WHOLE video produces a narrative spine that every segment
 * worker is handed, so a segment is never read blind (the v0.3 coherence
 * bug). Coarse-to-fine: skim the whole thing, then scrutinize each slice.
 *
 * args:
 *   path           (required) local path or URL of the reference video
 *   mode           detail tier for the deep pass (low|mid|high|max); default high
 *   effect_catalog optional array of canonical effect ids (effects/index.json)
 *                  so workers tag beats with real ids instead of inventing them
 * ------------------------------------------------------------------ */

/* args may arrive as an object or as a JSON-encoded string depending on caller */
let A = args
if (typeof A === 'string') {
  try { A = JSON.parse(A) } catch (e) { A = { path: args } } // bare path string fallback
}
A = A || {}
const path = A.path
const mode = A.mode || 'high'
const effectCatalog = Array.isArray(A.effect_catalog) ? A.effect_catalog : []
if (!path) throw new Error(`lumiere-perceive: args.path (video path/URL) is required; received args of type ${typeof args}: ${JSON.stringify(args).slice(0, 200)}`)

const CATS = ['Camera', 'Chat', 'Data Viz', 'Layer', 'Motion', 'Reveal', 'Text', 'UI']
const LUMIERE_TOOLS = 'mcp__plugin_lumiere_lumiere__inspect,mcp__plugin_lumiere_lumiere__analyze,mcp__plugin_lumiere_lumiere__watch'

function hms(sec) {
  // round to integer ms FIRST, then split, so a value like 59.9995 carries into
  // the minute instead of emitting an invalid "00:00:60.000" (toFixed rounds up
  // but Math.floor on the unrounded value would not have carried).
  let ms = Math.round(Math.max(0, sec) * 1000)
  const hh = Math.floor(ms / 3600000); ms -= hh * 3600000
  const mm = Math.floor(ms / 60000); ms -= mm * 60000
  const ss = ms / 1000
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${ss.toFixed(3).padStart(6, '0')}`
}

/* Defensive: models sometimes serialize a multi-field StructuredOutput as
   pseudo-XML inside the first string field (e.g. narrative_summary ends with
   "</narrative_summary><parameter name=\"continuity_notes\">[...]"), leaving the
   real array field empty. Strip the leak from the prose and recover the array. */
function sanitizeSynth(s) {
  if (!s) return { narrative_summary: '', continuity_notes: [] }
  let ns = typeof s.narrative_summary === 'string' ? s.narrative_summary : ''
  let cn = Array.isArray(s.continuity_notes) ? s.continuity_notes : []
  // anchor to the actual leak shape (a closing tag for one of THIS schema's fields,
  // or a <parameter ...>), so ordinary prose containing "</x" is not truncated.
  const cut = ns.search(/<\/(narrative_summary|continuity_notes)\b|<parameter\b/)
  let leaked = ''
  if (cut >= 0) { leaked = ns.slice(cut); ns = ns.slice(0, cut).trim() }
  if (cn.length === 0 && leaked) {
    const m = leaked.match(/\[[\s\S]*\]/)
    if (m) { try { const arr = JSON.parse(m[0]); if (Array.isArray(arr)) cn = arr } catch (e) { /* leave empty */ } }
  }
  return { narrative_summary: ns, continuity_notes: cn }
}

/* ---------------- schemas (force structured returns) ---------------- */

const SCOUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['duration_seconds', 'chunk_count', 'chunk_duration_seconds', 'spine'],
  properties: {
    duration_seconds: { type: 'number', description: 'metadata.duration_seconds from inspect' },
    has_audio: { type: 'boolean' },
    original_fps: { type: 'number' },
    resolution: { type: 'string', description: 'e.g. 3840x2160' },
    chunk_count: { type: 'integer', minimum: 1, description: 'cost_estimate.per_tier[<mode>].chunks_for_full_coverage_thorough (N)' },
    chunk_duration_seconds: { type: 'number', description: 'cost_estimate.per_tier[<mode>].chunk_duration_thorough_seconds' },
    scene_cuts_seconds: { type: 'array', items: { type: 'number' }, description: 'hard-cut timestamps in seconds, ascending' },
    has_speech: { type: 'boolean' },
    audio_summary: { type: 'string', description: 'transcription gist or sound-design notes; empty if silent' },
    spine: { type: 'string', minLength: 1, description: '2-4 sentence narrative arc of the WHOLE video from the low-tier skim: what it is, the product, the arc' },
  },
}

const SEGMENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['narrative_summary', 'beats', 'subchunks_watched'],
  properties: {
    narrative_summary: { type: 'string', description: 'what happens in THIS window only (do not re-describe the whole video)' },
    subchunks_watched: { type: 'integer', minimum: 0, description: 'number of watch() calls you successfully made for this window' },
    palette_hex: { type: 'array', items: { type: 'string' }, description: 'notable colors in this window as hex' },
    beats: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['timestamp_seconds', 'duration_seconds', 'description'],
        properties: {
          timestamp_seconds: { type: 'number', minimum: 0 },
          duration_seconds: { type: 'number', exclusiveMinimum: 0 },
          description: { type: 'string', minLength: 1 },
          energy: { type: 'string', description: 'rising | settle | focused | building | reset | peak | resolve | steady' },
          effect_category_tags: { type: 'array', items: { enum: CATS } },
          effect_ids: { type: 'array', items: { type: 'string' }, description: 'canonical ids from the provided catalog only; empty if unsure' },
          motion_notes: { type: 'string' },
          text_on_screen: { type: 'string', description: 'verbatim on-screen copy' },
        },
      },
    },
  },
}

const SYNTH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['narrative_summary'],
  properties: {
    narrative_summary: { type: 'string', minLength: 1, description: 'refined whole-video narrative after detailed watching' },
    continuity_notes: { type: 'array', items: { type: 'string' }, description: 'effects/motifs spanning segment boundaries, bookends, or likely duplicate beats' },
  },
}

/* ---------------- prompts ---------------- */

function scoutPrompt() {
  return [
    `You are a video perception SCOUT for lumiere. Video: ${path}. Detail tier for the later deep pass: ${mode}.`,
    `Goal: produce the coverage plan + a narrative spine. Do NOT do the detailed watching here; that is a later phase.`,
    ``,
    `Steps:`,
    `1. Load lumiere tools: call ToolSearch with query "select:${LUMIERE_TOOLS}".`,
    `2. inspect(path="${path}"). From the result read: metadata.duration_seconds, metadata.has_audio, metadata.original_fps, metadata.resolution, and cost_estimate.per_tier["${mode}"].chunks_for_full_coverage_thorough (this is chunk_count N) and .chunk_duration_thorough_seconds.`,
    `3. analyze(path="${path}", filters={scene_changes:true, silence:true, loudness:true, motion:true, transcription:true}). Read the scene-cut timestamps (seconds) and any transcription.`,
    `4. Skim the WHOLE video cheaply at low tier to understand the arc: watch(path="${path}", mode="low", narrative_mode=true). If inspect's low tier needs more than one chunk to cover the duration, make that many low watch() calls covering [0..duration]. LOOK at the frames.`,
    `5. Return the scout object. spine = 2-4 sentences capturing the WHOLE video's arc: what it is, the product/subject, the beginning-to-end story. scene_cuts_seconds sorted ascending. audio_summary = transcription gist (empty string if silent).`,
    ``,
    `Your return value is DATA for the orchestrator, not a message to a human.`,
  ].join('\n')
}

function segPrompt(seg, spine) {
  const list = seg.subchunks.map((c, k) => `   ${k + 1}. watch(path="${path}", mode="${mode}", start_time="${c.start_hms}", end_time="${c.end_hms}", narrative_mode=true, skip_cached=true)`).join('\n')
  const cat = effectCatalog.length ? `\nCanonical effect ids you may tag from (use ONLY these, never invent one; leave effect_ids empty if unsure):\n${effectCatalog.join(', ')}` : ''
  return [
    `You are a video perception WORKER for lumiere. Video: ${path}.`,
    `You cover ONLY your assigned window: segment ${seg.index}, ${seg.start_hms} -> ${seg.end_hms} (${seg.subchunks.length} subchunks).`,
    ``,
    `Whole-video context (the arc, so you read your slice in context; do NOT re-describe the whole video): ${spine}`,
    ``,
    `Steps:`,
    `1. Load the watch tool: call ToolSearch with query "select:mcp__plugin_lumiere_lumiere__watch".`,
    `2. Watch EVERY subchunk below, in order. Each is one watch() call. LOOK carefully at the frames:`,
    list,
    `3. Identify every distinct BEAT in your window. A beat is a coherent visual moment: a reveal, a UI action, a camera move, a transition, a hold. For each beat record: timestamp_seconds (absolute, on the full-video timeline), duration_seconds, description (what happens, in prose), energy, effect_category_tags (subset of: ${CATS.join(', ')}), effect_ids (best-guess canonical ids; empty if unsure), motion_notes (ease/stagger/direction/timing you actually observe), text_on_screen (verbatim copy).`,
    `4. Record palette_hex (notable colors as hex) for your window, and set subchunks_watched to the number of watch() calls you successfully made (should be ${seg.subchunks.length}).`,
    cat,
    ``,
    `Be exhaustive: surface every text-on-screen string and every effect, even subtle ones. Your return value is DATA, not a message. Do NOT return or generically describe the frames; return the structured beats.`,
  ].join('\n')
}

function synthPrompt(spine, watched, beats) {
  const segSummaries = watched.map(s => `- segment ${s.segment_index} (${s.subchunks_watched} subchunks): ${s.narrative_summary}`).join('\n')
  const beatLines = beats.map(b => `  ${b.timestamp_seconds.toFixed(2)}s (${b.duration_seconds.toFixed(2)}s) [${(b.effect_category_tags || []).join(',')}] ${b.description}`).join('\n')
  return [
    `You are the SYNTHESIS step of a lumiere perception pass. The video was watched in parallel segments; here is what each surfaced.`,
    ``,
    `Pre-watch spine (hypothesis): ${spine}`,
    ``,
    `Per-segment summaries:`,
    segSummaries,
    ``,
    `Merged beats (time-sorted):`,
    beatLines,
    ``,
    `Return:`,
    `- narrative_summary: the refined 3-5 sentence whole-video narrative AFTER the detailed pass (supersedes the spine). What the video is, its arc, the product, and the house-style read.`,
    `- continuity_notes: any effects/motifs that span a segment boundary, bookend motifs (open/close rhyme), or beats that look like duplicates from adjacent segments. Empty array if none.`,
    ``,
    `You are reading text only (no frames). Your return value is DATA, not a message.`,
  ].join('\n')
}

/* ---------------- phase 1: scout ---------------- */

phase('Scout')
const scout = await agent(scoutPrompt(), { schema: SCOUT_SCHEMA, label: 'scout' })
if (!scout) throw new Error('lumiere-perceive: scout phase failed (no plan)')

const duration = scout.duration_seconds
if (!(duration > 0)) throw new Error(`lumiere-perceive: scout returned a non-positive duration (${duration}); cannot plan coverage`)
const N = Math.max(1, scout.chunk_count)
const cd = duration / N // exact edge-to-edge tiling into N subchunks

const subchunks = []
for (let i = 0; i < N; i++) {
  const s = i * cd
  const e = Math.min((i + 1) * cd, duration)
  subchunks.push({ start: s, end: e, start_hms: hms(s), end_hms: hms(e) })
}

/* group the N subchunks into M contiguous, near-equal parallel segments */
const TARGET_PER_SEG = 4
const M = Math.min(12, Math.max(1, Math.ceil(N / TARGET_PER_SEG)))
const segments = []
const base = Math.floor(N / M)
const rem = N % M
let idx = 0
for (let m = 0; m < M; m++) {
  const count = base + (m < rem ? 1 : 0)
  const group = subchunks.slice(idx, idx + count)
  idx += count
  if (group.length === 0) continue
  segments.push({
    index: segments.length,
    start: group[0].start,
    end: group[group.length - 1].end,
    start_hms: group[0].start_hms,
    end_hms: group[group.length - 1].end_hms,
    subchunks: group,
  })
}
log(`scout: ${duration.toFixed(1)}s, N=${N} subchunks (${cd.toFixed(2)}s each) -> ${segments.length} parallel segments @ ${mode}`)

/* ---------------- phase 2: per-segment deep watch ---------------- */

phase('Watch')
const segResults = await parallel(segments.map(seg => () =>
  agent(segPrompt(seg, scout.spine), { schema: SEGMENT_SCHEMA, phase: 'Watch', label: `watch:seg${seg.index}` })
))

const watched = []
let subchunksWatched = 0
segResults.forEach((r, i) => {
  if (!r) {
    log(`WARNING: segment ${segments[i].index} (${segments[i].start_hms}-${segments[i].end_hms}) returned nothing; ${segments[i].subchunks.length} subchunks uncovered`)
    return
  }
  watched.push({ ...r, segment_index: segments[i].index })
  subchunksWatched += segments[i].subchunks.length // assigned == watched on a healthy return
  if (typeof r.subchunks_watched === 'number' && r.subchunks_watched !== segments[i].subchunks.length) {
    log(`note: segment ${segments[i].index} self-reported ${r.subchunks_watched}/${segments[i].subchunks.length} subchunks watched`)
  }
})

const beats = []
for (const s of watched) {
  for (const b of (s.beats || [])) beats.push({ ...b, segment_index: s.segment_index })
}
beats.sort((a, b) => a.timestamp_seconds - b.timestamp_seconds)
// keep only well-formed hex (the beat-sheet schema enforces this pattern); a worker
// emitting a color word ("cream") or rgb() must not sink an otherwise-valid sheet.
const HEX = /^#?[0-9a-fA-F]{3,8}$/
const palette = Array.from(new Set(
  watched.flatMap(s => (s.palette_hex || [])
    .filter(h => typeof h === 'string' && HEX.test(h.trim()))
    .map(h => h.trim()))
))

/* ---------------- phase 3: merge + synthesize ---------------- */

phase('Merge')
const synthRaw = beats.length
  ? await agent(synthPrompt(scout.spine, watched, beats), { schema: SYNTH_SCHEMA, label: 'synth' })
  : null
const synth = sanitizeSynth(synthRaw)

const sheet = {
  source: {
    path,
    duration_seconds: duration,
    watched_at_tier: mode,
    has_audio: !!scout.has_audio,
    ...(typeof scout.original_fps === 'number' ? { original_fps: scout.original_fps } : {}),
    ...(scout.resolution ? { resolution: scout.resolution } : {}),
  },
  spine: scout.spine,
  narrative_summary: (synth && synth.narrative_summary) || scout.spine,
  coverage: {
    tier: mode,
    chunk_count: N,
    chunk_duration_seconds: cd,
    segments_covered: segments.length,
    subchunks_watched: subchunksWatched,
  },
  palette_hex: palette,
  scene_cuts_seconds: (scout.scene_cuts_seconds || []).slice().sort((a, b) => a - b),
  audio: { has_speech: !!scout.has_speech, summary: scout.audio_summary || '' },
  beats,
  continuity_notes: (synth && synth.continuity_notes) || [],
}

log(`beat sheet ready: ${beats.length} beats, ${subchunksWatched}/${N} subchunks across ${segments.length} segments`)
return sheet
