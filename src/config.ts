import { join } from 'node:path'
import { z } from 'zod'
import type { AppConfig } from './application/config'

const PROJECT_ROOT = join(import.meta.dir, '..')

const DEFAULTS = {
  databaseUrl: 'postgres://llm_debug:llm_debug@127.0.0.1:55432/llm_debug',
  port: 8787,
  hostname: '127.0.0.1',
  ollamaUrl: 'http://127.0.0.1:11434',
  liveRefreshMs: 3000,
} as const

const Env = z.object({
  DATABASE_URL: z.string().default(DEFAULTS.databaseUrl),
  PROXY_PORT: z.coerce.number().int().positive().default(DEFAULTS.port),
  PROXY_HOSTNAME: z.string().default(DEFAULTS.hostname),
  OLLAMA_URL: z.string().default(DEFAULTS.ollamaUrl),
  CODEX_SESSIONS_DIR: z.string().optional(),
  WEB_DIST_DIR: z.string().optional(),
  PUBLIC_DIR: z.string().optional(),
  LIVE_REFRESH_MS: z.coerce.number().int().positive().default(DEFAULTS.liveRefreshMs),
  HOME: z.string().default(''),
})

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = Env.parse(env)
  return {
    databaseUrl: parsed.DATABASE_URL,
    port: parsed.PROXY_PORT,
    hostname: parsed.PROXY_HOSTNAME,
    ollamaUrl: parsed.OLLAMA_URL,
    codexSessionsDir: parsed.CODEX_SESSIONS_DIR ?? join(parsed.HOME, '.codex', 'sessions'),
    databaseLabel: describeDatabase(parsed.DATABASE_URL),
    liveRefreshMs: parsed.LIVE_REFRESH_MS,
    webDistDir: parsed.WEB_DIST_DIR ?? join(PROJECT_ROOT, 'dist', 'web'),
    publicDir: parsed.PUBLIC_DIR ?? join(PROJECT_ROOT, 'public'),
  }
}

function describeDatabase(url: string): string {
  try {
    const { hostname, port, pathname } = new URL(url)
    return `${hostname}:${port}${pathname}`
  } catch {
    return 'custom DATABASE_URL'
  }
}
