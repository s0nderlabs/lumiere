import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs"
import { dirname, join } from "path"
import { homedir } from "os"
import type { Config } from "./types.js"
import { DEFAULT_CONFIG } from "./defaults.js"

export const CONFIG_PATH = join(homedir(), ".lumiere", "config.json")
export const SESSIONS_DIR = join(homedir(), ".lumiere", "sessions")
export const DOWNLOADS_DIR = join(homedir(), ".lumiere", "downloads")
export const MODELS_DIR = join(homedir(), ".lumiere", "models")

export function loadConfig(): Config {
  const base: Config = !existsSync(CONFIG_PATH)
    ? { ...DEFAULT_CONFIG }
    : (() => {
        try {
          const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"))
          return { ...DEFAULT_CONFIG, ...raw }
        } catch {
          return { ...DEFAULT_CONFIG }
        }
      })()
  // Env var overrides let parallel test sessions pin distinct defaults without
  // racing each other on the shared config file. Per-call params (mode= on
  // watch/measure) still win over env over file over DEFAULT_CONFIG.
  const envMode = process.env.LUMIERE_DEFAULT_MODE
  if (envMode !== undefined && envMode !== "") {
    const VALID_MODES: Config["default_mode"][] = ["low", "mid", "high", "max"]
    if ((VALID_MODES as string[]).includes(envMode)) {
      base.default_mode = envMode as Config["default_mode"]
    } else {
      // Surface bad overrides instead of silently ignoring; parallel test
      // sessions otherwise ghost-fail when a typo demotes them to the file
      // default.
      console.warn(`[lumiere] ignoring invalid LUMIERE_DEFAULT_MODE=${envMode} (expected one of: ${VALID_MODES.join(", ")})`)
    }
  }
  return base
}

export function saveConfig(config: Config): void {
  const dir = dirname(CONFIG_PATH)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
}
