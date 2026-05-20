import { execFileSync } from "child_process"
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from "fs"
import { join } from "path"
import { homedir, platform } from "os"

const ENV_DIR = join(homedir(), ".config", "lumiere")
const ENV_PATH = join(ENV_DIR, ".env")
const isMac = platform() === "darwin"

function envKeyFor(key: string): string {
  return `LUMIERE_${key.replace(/^dev\.lumiere-/, "").replace(/-/g, "_").toUpperCase()}`
}

export function credGet(key: string): string | null {
  const envKey = envKeyFor(key)
  if (process.env[envKey]) return process.env[envKey]!

  if (isMac) {
    try {
      const out = execFileSync("security", ["find-generic-password", "-s", key, "-w"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      })
      return out.trim()
    } catch {}
  }

  try {
    const env = readFileSync(ENV_PATH, "utf-8")
    for (const line of env.split(/\r?\n/)) {
      const m = line.match(/^([^=]+)=(.*)$/)
      if (m && m[1] === envKey) return m[2]
    }
  } catch {}

  return null
}

export function credSet(key: string, value: string): void {
  const envKey = envKeyFor(key)

  if (isMac) {
    try {
      execFileSync("security", ["delete-generic-password", "-s", key], {
        stdio: ["ignore", "ignore", "ignore"],
      })
    } catch {}
    execFileSync("security", ["add-generic-password", "-a", "lumiere", "-s", key, "-w", value], {
      stdio: ["ignore", "ignore", "pipe"],
    })
    return
  }

  mkdirSync(ENV_DIR, { recursive: true })
  let lines: string[] = []
  try { lines = readFileSync(ENV_PATH, "utf-8").split(/\r?\n/) } catch {}

  let found = false
  lines = lines.map(l => {
    if (l.startsWith(`${envKey}=`)) { found = true; return `${envKey}=${value}` }
    return l
  })
  if (!found) lines.push(`${envKey}=${value}`)
  while (lines.length && lines[lines.length - 1] === "") lines.pop()
  writeFileSync(ENV_PATH, lines.join("\n") + "\n")
  try { chmodSync(ENV_PATH, 0o600) } catch {}
}
