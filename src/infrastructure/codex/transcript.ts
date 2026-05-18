import { z } from 'zod'
import type { CodexLocalTool, CodexLocalTurn } from '../../domain/codex'
import { isRecord } from '../../shared/guards'
import { parseJson } from '../../shared/json'
import { lenient, optString, optValue, parseAs, parseEach, wireObject } from '../wire/schema'

const Payload = wireObject({
  type: optString,
  turn_id: optString,
  role: optString,
  phase: optString,
  message: optString,
  name: optString,
  arguments: optString,
  cwd: optString,
  content: optValue,
})

const Entry = wireObject({
  type: optString,
  payload: lenient(Payload),
})

export type TranscriptEntry = z.output<typeof Entry>
type EntryPayload = z.output<typeof Payload>

const TextBlock = wireObject({ text: optString })

const TOOL_LABEL_WORDS = 4
const FINAL_ANSWER = 'final_answer'

export function parseTranscript(jsonl: string): TranscriptEntry[] {
  return jsonl
    .split('\n')
    .filter(Boolean)
    .map(parseJson)
    .filter(Boolean)
    .map((value) => parseAs(Entry, value) ?? {})
}

export function parseTurn(entries: TranscriptEntry[], threadId: string, turnId: string | null, sessionFile: string | null): CodexLocalTurn {
  const end = findTurnEnd(entries, turnId)
  const turn = entries.slice(findTurnStart(entries, end, turnId), end + 1)
  return {
    threadId,
    turnId,
    sessionFile,
    cwd: entries.find((e) => e.type === 'session_meta')?.payload?.cwd ?? null,
    prompt: lastNonEmpty(turn.map(userText)),
    assistant: lastNonEmpty(turn.map(assistantText)),
    commentary: collect(turn, commentaryText),
    tools: collect(turn, toolCall),
  }
}

function payloadOf(entry: TranscriptEntry, entryType: string, payloadType: string): EntryPayload | null {
  return entry.type === entryType && entry.payload?.type === payloadType ? entry.payload : null
}

const eventMessage = (entry: TranscriptEntry, payloadType: string) => payloadOf(entry, 'event_msg', payloadType)
const responseItem = (entry: TranscriptEntry, payloadType: string) => payloadOf(entry, 'response_item', payloadType)

function findTaskEvent(entries: TranscriptEntry[], payloadType: string, turnId: string): number {
  return entries.findIndex((e) => eventMessage(e, payloadType)?.turn_id === turnId)
}

function findTurnEnd(entries: TranscriptEntry[], turnId: string | null): number {
  const completed = turnId ? findTaskEvent(entries, 'task_complete', turnId) : -1
  return completed >= 0 ? completed : Math.max(0, entries.length - 1)
}

function findTurnStart(entries: TranscriptEntry[], end: number, turnId: string | null): number {
  const started = turnId ? findTaskEvent(entries, 'task_started', turnId) : -1
  if (started >= 0 && started <= end) return started
  for (let i = end; i >= 0; i--) {
    if (userText(entries[i])) return i
  }
  return 0
}

function userText(entry: TranscriptEntry | undefined): string | null {
  if (!entry) return null
  const typed = eventMessage(entry, 'user_message')?.message
  if (typed !== undefined) return typed
  const message = responseItem(entry, 'message')
  return message?.role === 'user' ? textFromContent(message.content) : null
}

function assistantText(entry: TranscriptEntry): string | null {
  const message = responseItem(entry, 'message')
  if (message?.role === 'assistant') return textFromContent(message.content)
  const agent = eventMessage(entry, 'agent_message')
  return agent?.phase === FINAL_ANSWER ? agent.message ?? null : null
}

function commentaryText(entry: TranscriptEntry): string | null {
  const agent = eventMessage(entry, 'agent_message')
  return agent && agent.phase !== FINAL_ANSWER ? agent.message ?? null : null
}

function toolCall(entry: TranscriptEntry): CodexLocalTool | null {
  const call = responseItem(entry, 'function_call')
  if (call?.name === undefined) return null
  const input = call.arguments ?? null
  const command = shellCommandOf(input)
  const label = command ? command.split(/\s+/).slice(0, TOOL_LABEL_WORDS).join(' ') : call.name
  return { name: call.name, label, input }
}

function shellCommandOf(input: string | null): string | null {
  const parsed = input ? parseJson(input) : null
  return isRecord(parsed) && typeof parsed.cmd === 'string' ? parsed.cmd : null
}

function textFromContent(content: unknown): string | null {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return null
  const texts = parseEach(TextBlock, content).flatMap((block) => (block.text !== undefined ? [block.text] : []))
  return texts.length > 0 ? texts.join('\n') : null
}

function collect<T>(entries: TranscriptEntry[], pick: (entry: TranscriptEntry) => T | null): T[] {
  return entries.flatMap((entry) => {
    const value = pick(entry)
    return value ? [value] : []
  })
}

function lastNonEmpty(values: Array<string | null>): string | null {
  for (let i = values.length - 1; i >= 0; i--) {
    const value = values[i]?.trim()
    if (value) return value
  }
  return null
}
