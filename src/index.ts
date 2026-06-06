#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"

import { checkDependencies, depErrorMessage } from "./deps.js"
import { checkCommand } from "./utils/platform.js"
import { loadConfig, saveConfig, SESSIONS_DIR } from "./config.js"
import { DEFAULTS } from "./defaults.js"
import { cleanExpiredSessions } from "./session/manager.js"
import { cleanExpiredDownloads } from "./utils/video-source.js"
import { credGet } from "./auth.js"

import { registerInspect } from "./tools/inspect.js"
import { registerAnalyze } from "./tools/analyze.js"
import { registerWatch } from "./tools/watch.js"
import { registerMeasure } from "./tools/measure.js"
import { registerConfigure } from "./tools/configure.js"

process.on("unhandledRejection", err => {
  process.stderr.write(`lumiere: unhandled rejection: ${err}\n`)
})
process.on("uncaughtException", err => {
  process.stderr.write(`lumiere: uncaught exception: ${err}\n`)
})

// 1. Required dependency check (inb0x pattern: refuse to start if broken)
const deps = await checkDependencies()
if (!deps.ok) {
  process.stderr.write(depErrorMessage(deps.missing) + "\n")
  process.exit(1)
}
if (deps.warnings.length > 0) {
  process.stderr.write(`lumiere: optional tools not found: ${deps.warnings.join(", ")} (some features may be unavailable)\n`)
}

// 2. Resolve audio backend with auto-selection
const config = loadConfig()
const hasGeminiKey = !!(credGet("dev.lumiere-gemini-api-key") || process.env.GEMINI_API_KEY)
const hasWhisperCli = await checkCommand("whisper-cli")

let effectiveBackend = config.backend
if (effectiveBackend === "local" && !hasWhisperCli) {
  if (hasGeminiKey) {
    process.stderr.write("lumiere: whisper-cli missing, falling back to gemini-api (GEMINI_API_KEY found)\n")
    effectiveBackend = "gemini-api"
  } else {
    process.stderr.write("lumiere: WARNING: whisper-cli not found and no GEMINI_API_KEY set. Transcription will return empty.\n")
    process.stderr.write("  Install whisper-cli: brew install whisper-cpp\n")
    process.stderr.write("  Or set GEMINI_API_KEY env var (free tier: 1500 req/day)\n")
    effectiveBackend = "none"
  }
}
if (effectiveBackend === "gemini-api" && !hasGeminiKey) {
  process.stderr.write("lumiere: gemini-api selected but no GEMINI_API_KEY set. Falling back to local.\n")
  effectiveBackend = "local"
}

if (effectiveBackend !== config.backend) {
  saveConfig({ ...config, backend: effectiveBackend })
}

process.stderr.write(`lumiere: backend=${effectiveBackend} whisper_model=${config.whisper_model} mcp_cap=${process.env.MAX_MCP_OUTPUT_TOKENS ?? "50000(default)"}\n`)

// 3. Cache hygiene
cleanExpiredSessions(SESSIONS_DIR, DEFAULTS.session_max_age_days)
cleanExpiredDownloads(DEFAULTS.downloads_max_age_days)

// 4. Build server + register tools
const server = new McpServer({ name: "lumiere", version: "0.17.0" })
registerInspect(server)
registerAnalyze(server)
registerWatch(server)
registerMeasure(server)
registerConfigure(server)

// 5. Connect via stdio
const transport = new StdioServerTransport()
await server.connect(transport)
process.stderr.write("lumiere: mcp connected (5 tools: inspect, analyze, watch, measure, configure)\n")
