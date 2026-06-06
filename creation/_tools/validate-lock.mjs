#!/usr/bin/env bun
/* Validate a launch-video.lock.json against the lumiere lock schema.
   Usage: bun creation/_tools/validate-lock.mjs <path/to/launch-video.lock.json>
   Exit 0 = valid, 1 = invalid (errors printed), 2 = usage/load error.
   Beyond JSON Schema, also checks cross-field timing invariants the schema
   cannot express (scene ordering, overlap, duration fit). */
import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import Ajv2020 from "ajv/dist/2020.js"
import addFormats from "ajv-formats"

const here = dirname(fileURLToPath(import.meta.url))
const schemaPath = resolve(here, "..", "launch-video.lock.schema.json")

const target = process.argv[2]
if (!target) {
  console.error("usage: bun creation/_tools/validate-lock.mjs <launch-video.lock.json>")
  process.exit(2)
}

let schema, lock
try {
  schema = JSON.parse(readFileSync(schemaPath, "utf8"))
} catch (e) {
  console.error(`failed to load schema at ${schemaPath}: ${e.message}`)
  process.exit(2)
}
try {
  lock = JSON.parse(readFileSync(resolve(target), "utf8"))
} catch (e) {
  console.error(`failed to load lock at ${target}: ${e.message}`)
  process.exit(2)
}

const ajv = new Ajv2020({ allErrors: true, strict: true })
addFormats(ajv)
const validate = ajv.compile(schema)

const errors = []
if (!validate(lock)) {
  for (const err of validate.errors) {
    errors.push(`schema: ${err.instancePath || "/"} ${err.message}${err.params ? " " + JSON.stringify(err.params) : ""}`)
  }
}

/* cross-field invariants */
if (Array.isArray(lock.scenes)) {
  const scenes = lock.scenes
  const ids = new Set()
  let prevEnd = 0
  const first = scenes[0]
  if (first && typeof first.start === "number" && first.start > 1e-9) {
    errors.push(`scenes[0] "${first.id}": starts at ${first.start}s, not 0 (leading dead air - black frames at the head of the video)`)
  }
  scenes.forEach((s, i) => {
    if (typeof s !== "object" || s === null) return
    if (ids.has(s.id)) errors.push(`scenes[${i}]: duplicate scene id "${s.id}"`)
    ids.add(s.id)
    if (typeof s.start === "number" && typeof s.duration === "number") {
      /* an overlap is intentional when the previous scene declares a
         non-cut transitionOut (crossfade, dissolve, dolly-dive, ...) */
      const prev = i > 0 ? scenes[i - 1] : null
      const intentionalOverlap = prev && typeof prev.transitionOut === "string" && prev.transitionOut.length > 0 && prev.transitionOut !== "cut"
      if (i > 0 && s.start < prevEnd - 1e-9 && !intentionalOverlap) {
        errors.push(`scenes[${i}] "${s.id}": starts at ${s.start}s before previous scene ends at ${prevEnd}s (overlap; set the previous scene's transitionOut to mark an intentional crossfade)`)
      }
      if (i > 0 && s.start > prevEnd + 1e-9) {
        errors.push(`scenes[${i}] "${s.id}": gap of ${(s.start - prevEnd).toFixed(3)}s after previous scene (dead air on the master timeline)`)
      }
      prevEnd = Math.max(prevEnd, s.start + s.duration)
    }
  })
  const total = lock.meta && lock.meta.targetDurationSeconds
  if (typeof total === "number" && Math.abs(prevEnd - total) > 0.25) {
    errors.push(`timing: scenes end at ${prevEnd.toFixed(3)}s but meta.targetDurationSeconds is ${total}s (drift > 0.25s)`)
  }
}

if (errors.length) {
  console.error(`INVALID: ${target}`)
  for (const e of errors) console.error("  - " + e)
  process.exit(1)
}
console.log(`VALID: ${target} (${lock.scenes.length} scenes, ${lock.meta.targetDurationSeconds}s target)`)
