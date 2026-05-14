import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

export interface CodexLocalTool {
  name: string
  label: string
  input: string | null
}

export interface CodexTelemetryToolInvocation {
  tool_name: string
  tool_input_preview: string | null
  skill_name: string | null
}

export interface CodexLocalTurn {
  threadId: string | null
  turnId: string | null
  sessionFile: string | null
  cwd: string | null
  prompt: string | null
  assistant: string | null
  commentary: string[]
  tools: CodexLocalTool[]
}

const sessionFileCache = new Map<string, string | null>()
const turnCache = new Map<string, { mtimeMs: number; turn: CodexLocalTurn }>()

export function summarizeCodexTurnFromRequestBody(requestBody: string | null | undefined): CodexLocalTurn | null {
  const ids = extractCodexIds(requestBody)
  if (!ids.threadId) return null
  return summarizeCodexTurn(ids.threadId, ids.turnId)
}

export function extractCodexIds(requestBody: string | null | undefined): { threadId: string | null; turnId: string | null } {
  if (!requestBody) return { threadId: null, turnId: null }
  try {
    const body = JSON.parse(requestBody)
    const event = Array.isArray(body.events) ? body.events[0] : null
    const params = event?.event_params ?? {}
    if (event?.event_type !== 'codex_turn_event') return { threadId: null, turnId: null }
    return {
      threadId: typeof params.thread_id === 'string' ? params.thread_id : null,
      turnId: typeof params.turn_id === 'string' ? params.turn_id : null,
    }
  } catch {
    return { threadId: null, turnId: null }
  }
}

export function extractCodexTelemetryTools(requestBody: string | null | undefined): CodexTelemetryToolInvocation[] {
  if (!requestBody) return []
  try {
    const body = JSON.parse(requestBody)
    const events = Array.isArray(body.events) ? body.events : []
    const tools: CodexTelemetryToolInvocation[] = []
    for (const event of events) {
      if (event?.event_type !== 'codex_mcp_tool_call_event') continue
      const params = event.event_params ?? {}
      const toolName = typeof params.tool_name === 'string'
        ? params.tool_name
        : typeof params.mcp_tool_name === 'string'
          ? params.mcp_tool_name
          : null
      if (!toolName) continue
      const server = typeof params.mcp_server_name === 'string' ? params.mcp_server_name : null
      const duration = typeof params.duration_ms === 'number' ? `${params.duration_ms}ms` : null
      const status = typeof params.terminal_status === 'string' ? params.terminal_status : null
      const previewParts = [server ? `server=${server}` : null, status, duration].filter(Boolean)
      tools.push({
        tool_name: toolName,
        tool_input_preview: previewParts.length > 0 ? previewParts.join(' · ') : null,
        skill_name: server,
      })
    }
    return tools
  } catch {
    return []
  }
}

export function summarizeCodexTurn(threadId: string, turnId: string | null): CodexLocalTurn | null {
  const sessionFile = findSessionFile(threadId)
  if (!sessionFile) return null

  const mtimeMs = safeMtime(sessionFile)
  const cacheKey = `${sessionFile}:${turnId ?? 'latest'}`
  const cached = turnCache.get(cacheKey)
  if (cached && cached.mtimeMs === mtimeMs) return cached.turn

  const entries = readJsonl(sessionFile)
  const meta = entries.find((e) => e?.type === 'session_meta')?.payload ?? {}
  const end = findTurnEnd(entries, turnId)
  const start = findTurnStart(entries, end, turnId)
  const slice = entries.slice(start, end + 1)

  const prompt = lastNonEmpty(slice.map(extractUserText))
  const assistantMessages = slice.map(extractAssistantText).filter(Boolean) as string[]
  const commentary = slice.map(extractCommentaryText).filter(Boolean) as string[]
  const tools = slice.map(extractTool).filter(Boolean) as CodexLocalTool[]

  const turn: CodexLocalTurn = {
    threadId,
    turnId,
    sessionFile,
    cwd: typeof meta.cwd === 'string' ? meta.cwd : null,
    prompt,
    assistant: lastNonEmpty(assistantMessages),
    commentary,
    tools,
  }
  turnCache.set(cacheKey, { mtimeMs, turn })
  return turn
}

function findSessionFile(threadId: string): string | null {
  if (sessionFileCache.has(threadId)) return sessionFileCache.get(threadId) ?? null
  const root = join(process.env.HOME ?? '', '.codex', 'sessions')
  if (!existsSync(root)) {
    sessionFileCache.set(threadId, null)
    return null
  }
  const found = walkForSession(root, threadId)
  sessionFileCache.set(threadId, found)
  return found
}

function walkForSession(dir: string, threadId: string): string | null {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return null
  }

  const dirs: string[] = []
  for (const name of entries) {
    const path = join(dir, name)
    let st
    try {
      st = statSync(path)
    } catch {
      continue
    }
    if (st.isFile() && name.includes(threadId) && name.endsWith('.jsonl')) return path
    if (st.isDirectory()) dirs.push(path)
  }

  dirs.sort().reverse()
  for (const child of dirs) {
    const found = walkForSession(child, threadId)
    if (found) return found
  }
  return null
}

function readJsonl(path: string): any[] {
  try {
    return readFileSync(path, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line) } catch { return null }
      })
      .filter(Boolean)
  } catch {
    return []
  }
}

function findTurnEnd(entries: any[], turnId: string | null): number {
  if (turnId) {
    const idx = entries.findIndex((e) =>
      e?.type === 'event_msg' &&
      e?.payload?.type === 'task_complete' &&
      e?.payload?.turn_id === turnId
    )
    if (idx >= 0) return idx
  }
  return Math.max(0, entries.length - 1)
}

function findTurnStart(entries: any[], end: number, turnId: string | null): number {
  if (turnId) {
    const started = entries.findIndex((e) =>
      e?.type === 'event_msg' &&
      e?.payload?.type === 'task_started' &&
      e?.payload?.turn_id === turnId
    )
    if (started >= 0 && started <= end) return started
  }
  for (let i = end; i >= 0; i--) {
    if (extractUserText(entries[i])) return i
  }
  return 0
}

function extractUserText(entry: any): string | null {
  const p = entry?.payload
  if (entry?.type === 'event_msg' && p?.type === 'user_message' && typeof p.message === 'string') return p.message
  if (entry?.type === 'response_item' && p?.type === 'message' && p.role === 'user') return textFromContent(p.content)
  return null
}

function extractAssistantText(entry: any): string | null {
  const p = entry?.payload
  if (entry?.type === 'response_item' && p?.type === 'message' && p.role === 'assistant') return textFromContent(p.content)
  if (entry?.type === 'event_msg' && p?.type === 'agent_message' && p.phase === 'final_answer' && typeof p.message === 'string') return p.message
  return null
}

function extractCommentaryText(entry: any): string | null {
  const p = entry?.payload
  if (entry?.type === 'event_msg' && p?.type === 'agent_message' && p.phase !== 'final_answer' && typeof p.message === 'string') return p.message
  return null
}

function extractTool(entry: any): CodexLocalTool | null {
  const p = entry?.payload
  if (entry?.type !== 'response_item' || p?.type !== 'function_call' || typeof p.name !== 'string') return null
  const input = typeof p.arguments === 'string' ? p.arguments : null
  const parsed = input ? tryJson(input) : null
  const command = parsed && typeof parsed.cmd === 'string' ? parsed.cmd : null
  const label = command ? command.split(/\s+/).slice(0, 4).join(' ') : p.name
  return { name: p.name, label, input }
}

function textFromContent(content: unknown): string | null {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return null
  const parts: string[] = []
  for (const block of content) {
    if (block && typeof block === 'object' && 'text' in block && typeof (block as any).text === 'string') {
      parts.push((block as any).text)
    }
  }
  return parts.length > 0 ? parts.join('\n') : null
}

function lastNonEmpty(values: Array<string | null | undefined>): string | null {
  for (let i = values.length - 1; i >= 0; i--) {
    const value = values[i]?.trim()
    if (value) return value
  }
  return null
}

function tryJson(text: string): any | null {
  try { return JSON.parse(text) } catch { return null }
}

function safeMtime(path: string): number {
  try { return statSync(path).mtimeMs } catch { return 0 }
}
