import { execFile } from "child_process"
import { promisify } from "util"
import { mkdirSync, existsSync } from "fs"
import { join } from "path"

const execFileAsync = promisify(execFile)

export interface ExtractAudioOptions {
  startTime?: string
  endTime?: string
  filename?: string
}

export function buildExtractArgs(videoPath: string, outputPath: string, options: ExtractAudioOptions): string[] {
  const args: string[] = ["-i", videoPath]
  if (options.startTime) args.push("-ss", options.startTime)
  if (options.endTime) args.push("-to", options.endTime)
  args.push("-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", "-y", outputPath)
  return args
}

export async function extractAudio(videoPath: string, outputDir: string, options: ExtractAudioOptions = {}): Promise<string> {
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true })
  const filename = options.filename ?? "audio.wav"
  const outputPath = join(outputDir, filename)
  await execFileAsync("ffmpeg", buildExtractArgs(videoPath, outputPath, options))
  return outputPath
}
