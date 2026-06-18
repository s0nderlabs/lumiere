#!/usr/bin/env bun
/* Validate a perception beat sheet (the structured output of a reference-video
   watch) against the lumiere perception-beatsheet schema.
   Usage: bun creation/_tools/validate-beatsheet.mjs <path/to/beatsheet.json>
   Exit 0 = valid, 1 = invalid (errors printed), 2 = usage/load error.
   Beyond JSON Schema, also checks: effect_ids resolve to real catalog ids,
   beats are time-ordered and in range, and the biblical thorough-coverage
   invariant (subchunks_watched == chunk_count) holds. */
import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import Ajv2020 from "ajv/dist/2020.js"
import addFormats from "ajv-formats"

const here = dirname(fileURLToPath(import.meta.url))
const schemaPath = resolve(here, "..", "perception-beatsheet.schema.json")
const effectsIndexPath = resolve(here, "..", "..", "effects", "index.json")

const target = process.argv[2]
if (!target) {
  console.error("usage: bun creation/_tools/validate-beatsheet.mjs <beatsheet.json>")
  process.exit(2)
}

let schema, sheet, effectIds
try {
  schema = JSON.parse(readFileSync(schemaPath, "utf8"))
} catch (e) {
  console.error(`failed to load schema at ${schemaPath}: ${e.message}`)
  process.exit(2)
}
try {
  sheet = JSON.parse(readFileSync(resolve(target), "utf8"))
} catch (e) {
  console.error(`failed to load beat sheet at ${target}: ${e.message}`)
  process.exit(2)
}
try {
  effectIds = new Set(JSON.parse(readFileSync(effectsIndexPath, "utf8")))
} catch (e) {
  console.error(`failed to load effects index at ${effectsIndexPath}: ${e.message}`)
  process.exit(2)
}

const ajv = new Ajv2020({ allErrors: true, strict: true })
addFormats(ajv)
const validate = ajv.compile(schema)

const errors = []
const warnings = []
if (!validate(sheet)) {
  for (const err of validate.errors) {
    errors.push(`schema: ${err.instancePath || "/"} ${err.message}${err.params ? " " + JSON.stringify(err.params) : ""}`)
  }
}

/* cross-field invariants (only meaningful if the schema shape held) */
if (errors.length === 0) {
  const dur = sheet.source.duration_seconds

  /* coverage: the biblical thorough-coverage rule */
  const cov = sheet.coverage
  if (cov.subchunks_watched !== cov.chunk_count) {
    errors.push(`coverage: subchunks_watched=${cov.subchunks_watched} != chunk_count=${cov.chunk_count} (incomplete thorough coverage; the fan-out did not watch every subchunk the tier requires)`)
  }
  if (cov.segments_covered > cov.chunk_count) {
    errors.push(`coverage: segments_covered=${cov.segments_covered} > chunk_count=${cov.chunk_count} (more segments than subchunks is impossible)`)
  }

  /* beats: ordering, range, effect-id resolution */
  let prevTs = -Infinity
  sheet.beats.forEach((b, i) => {
    if (b.timestamp_seconds < prevTs - 1e-6) {
      errors.push(`beats[${i}]: timestamp ${b.timestamp_seconds}s is out of order (previous beat at ${prevTs}s); beats must be sorted ascending by timestamp_seconds`)
    }
    prevTs = b.timestamp_seconds
    if (b.timestamp_seconds > dur + 0.5) {
      errors.push(`beats[${i}]: timestamp ${b.timestamp_seconds}s is past video duration ${dur}s`)
    }
    if (b.timestamp_seconds + b.duration_seconds > dur + 0.5) {
      warnings.push(`beats[${i}]: ends at ${(b.timestamp_seconds + b.duration_seconds).toFixed(2)}s, past video duration ${dur}s (clamp duration)`)
    }
    for (const ref of b.effect_ids || []) {
      if (!effectIds.has(ref)) {
        errors.push(`beats[${i}]: effect_id "${ref}" is not in effects/index.json (invented or typo'd ref; would not resolve in a lock)`)
      }
    }
  })

  /* coverage timeline: first beat should be near 0 */
  if (sheet.beats.length && sheet.beats[0].timestamp_seconds > 1.0) {
    warnings.push(`beats[0]: first beat starts at ${sheet.beats[0].timestamp_seconds}s, not ~0 (leading content may be uncovered)`)
  }
}

if (warnings.length) {
  for (const w of warnings) console.error("  ! " + w)
}
if (errors.length) {
  console.error(`INVALID: ${target}`)
  for (const e of errors) console.error("  - " + e)
  process.exit(1)
}
console.log(`VALID: ${target} (${sheet.beats.length} beats, ${sheet.coverage.subchunks_watched}/${sheet.coverage.chunk_count} subchunks across ${sheet.coverage.segments_covered} segments, ${sheet.source.duration_seconds}s @ ${sheet.coverage.tier})`)
