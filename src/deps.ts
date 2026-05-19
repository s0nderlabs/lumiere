import { checkCommand } from "./utils/platform.js"

export interface DepCheckResult {
  ok: boolean
  missing: string[]
  warnings: string[]
}

export async function checkDependencies(): Promise<DepCheckResult> {
  const required = ["ffmpeg", "ffprobe"]
  const optional = ["yt-dlp", "whisper-cli"]

  const missing: string[] = []
  const warnings: string[] = []

  for (const cmd of required) {
    if (!(await checkCommand(cmd))) missing.push(cmd)
  }
  for (const cmd of optional) {
    if (!(await checkCommand(cmd))) warnings.push(cmd)
  }
  return { ok: missing.length === 0, missing, warnings }
}

export function depErrorMessage(missing: string[]): string {
  const lines = [
    "lumiere: required dependencies missing:",
    ...missing.map(m => `  - ${m}`),
    "",
    "macOS install (Homebrew):",
    `  brew install ${missing.join(" ")}`,
    "",
    "Then restart the Claude Code session.",
  ]
  return lines.join("\n")
}
