import { existsSync, readFileSync, readdirSync, statSync, type Stats } from 'node:fs'
import { join } from 'node:path'
import type { CodexLocalTurn } from '../../domain/codex'
import { parseTranscript, parseTurn, type TranscriptEntry } from './transcript'

const TRANSCRIPT_EXTENSION = '.jsonl'
const LATEST_TURN = 'latest'

export interface CodexSessionStore {
  turn(threadId: string, turnId: string | null): CodexLocalTurn | null
}

export function createCodexSessionStore(sessionsRoot: string): CodexSessionStore {
  const fileByThread = new Map<string, string | null>()
  const turnCache = new Map<string, { mtimeMs: number; turn: CodexLocalTurn }>()

  function sessionFile(threadId: string): string | null {
    if (!fileByThread.has(threadId)) {
      fileByThread.set(threadId, existsSync(sessionsRoot) ? findTranscript(sessionsRoot, threadId) : null)
    }
    return fileByThread.get(threadId) ?? null
  }

  return {
    turn(threadId, turnId) {
      const file = sessionFile(threadId)
      if (!file) return null

      const mtimeMs = mtimeOf(file)
      const cacheKey = `${file}:${turnId ?? LATEST_TURN}`
      const cached = turnCache.get(cacheKey)
      if (cached?.mtimeMs === mtimeMs) return cached.turn

      const turn = parseTurn(readTranscript(file), threadId, turnId, file)
      turnCache.set(cacheKey, { mtimeMs, turn })
      return turn
    },
  }
}

function findTranscript(dir: string, threadId: string): string | null {
  const subdirs: string[] = []
  for (const name of listDir(dir)) {
    const path = join(dir, name)
    const stats = statOrNull(path)
    if (!stats) continue
    if (stats.isFile() && isTranscriptFor(name, threadId)) return path
    if (stats.isDirectory()) subdirs.push(path)
  }
  for (const subdir of subdirs.sort().reverse()) {
    const found = findTranscript(subdir, threadId)
    if (found) return found
  }
  return null
}

function isTranscriptFor(fileName: string, threadId: string): boolean {
  return fileName.includes(threadId) && fileName.endsWith(TRANSCRIPT_EXTENSION)
}

function readTranscript(path: string): TranscriptEntry[] {
  try {
    return parseTranscript(readFileSync(path, 'utf8'))
  } catch {
    return []
  }
}

function listDir(dir: string): string[] {
  try { return readdirSync(dir) } catch { return [] }
}

function statOrNull(path: string): Stats | null {
  try { return statSync(path) } catch { return null }
}

function mtimeOf(path: string): number {
  return statOrNull(path)?.mtimeMs ?? 0
}
