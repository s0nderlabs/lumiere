import { z } from "zod"
import { rmSync, existsSync } from "fs"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { loadConfig, saveConfig, SESSIONS_DIR, DOWNLOADS_DIR } from "../config.js"

export function registerConfigure(server: McpServer): void {
  server.tool(
    "configure",
    "Update lumiere preferences. User-facing fields: backend, whisper_model, default_mode, default_narrative_mode, default_adaptive_sampling, clear_sessions. Everything else (format, fps ladder, cache TTL, audio chunking) is hardcoded with empirically validated defaults.",
    {
      backend: z.enum(["local", "gemini-api", "none"]).optional().describe("Audio transcription backend"),
      whisper_model: z.enum(["tiny", "base", "small", "medium", "large-v3-turbo", "large-v3", "auto"]).optional().describe("Whisper model when backend=local. 'auto' picks based on system RAM."),
      default_mode: z.enum(["low", "mid", "high", "max"]).optional().describe("Default `watch` tier when no per-call mode/resolution given. low=384/overview, mid=512/balanced, high=1024/default, max=1536/surgical."),
      default_narrative_mode: z.union([z.boolean(), z.literal("auto")]).optional().describe("Server default for narrative_mode when watch/measure omit the param. 'auto' (or unset) = use heuristics (auto-suggest from motion/cuts/palette). true = always on. false = always off. Per-call param still wins."),
      default_adaptive_sampling: z.union([z.boolean(), z.literal("auto")]).optional().describe("Server default for adaptive_sampling when watch/measure omit the param. 'auto' (or unset) = use heuristics (auto-enable when narrative_mode is on + motion_windows cached + duration > 4s). true = always on. false = always off. Per-call param still wins."),
      clear_sessions: z.boolean().optional().describe("Delete all cached sessions + downloads"),
    },
    async (params) => {
      if (params.clear_sessions) {
        if (existsSync(SESSIONS_DIR)) rmSync(SESSIONS_DIR, { recursive: true, force: true })
        if (existsSync(DOWNLOADS_DIR)) rmSync(DOWNLOADS_DIR, { recursive: true, force: true })
      }

      const current = loadConfig()
      const updated = { ...current }
      if (params.backend !== undefined) updated.backend = params.backend
      if (params.whisper_model !== undefined) updated.whisper_model = params.whisper_model
      if (params.default_mode !== undefined) updated.default_mode = params.default_mode
      if (params.default_narrative_mode !== undefined) {
        updated.default_narrative_mode = params.default_narrative_mode === "auto" ? undefined : params.default_narrative_mode
      }
      if (params.default_adaptive_sampling !== undefined) {
        updated.default_adaptive_sampling = params.default_adaptive_sampling === "auto" ? undefined : params.default_adaptive_sampling
      }
      saveConfig(updated)

      const lines = [`Configuration saved:`, JSON.stringify(updated, null, 2)]
      if (params.clear_sessions) lines.push("\nAll sessions + downloads cleared.")
      return { content: [{ type: "text", text: lines.join("\n") }] }
    },
  )
}
