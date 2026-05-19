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
  if (!existsSync(CONFIG_PATH)) return { ...DEFAULT_CONFIG }
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"))
    return { ...DEFAULT_CONFIG, ...raw }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export function saveConfig(config: Config): void {
  const dir = dirname(CONFIG_PATH)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
}
