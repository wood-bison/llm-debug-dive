import { CODEX_TURN_EVENT } from '../../domain/codex'
import type { TurnMessage, TurnRequest } from '../../domain/turnClassification'
import { mapLazy } from '../../shared/iterables'
import { firstEvent } from '../codex/telemetryEvents'
import { optNumber, optValue, parseEach, parseJsonAs, wireObject } from '../wire/schema'
import { ChatMessage, ContentBlock, messageList } from './shared'

const ClassifiableRequest = wireObject({
  system: optValue,
  max_tokens: optNumber,
  events: optValue,
  messages: optValue,
  input: optValue,
  contents: optValue,
})

const SystemBlock = wireObject({ text: optValue })
const GoogleContent = wireObject({ role: optValue, parts: optValue })
const GoogleTextPart = wireObject({ text: optValue })

const UNKNOWN_STATUS = 'unknown'

export function parseTurnRequest(body: string | null): TurnRequest | null {
  const request = parseJsonAs(ClassifiableRequest, body)
  if (!request) return null
  const list = Array.isArray(request.contents) ? request.contents : messageList(request)
  return {
    codexTurn: codexTurnFacts(body),
    hasEvents: Boolean(request.events),
    messages: list ? mapLazy(list, toTurnMessage) : null,
    systemText: systemText(request.system),
    maxTokens: request.max_tokens ?? null,
  }
}

function codexTurnFacts(body: string | null): TurnRequest['codexTurn'] {
  const event = firstEvent(body)
  if (event?.event_type !== CODEX_TURN_EVENT) return null
  return {
    status: event.event_params?.status ?? UNKNOWN_STATUS,
    toolCalls: event.event_params?.total_tool_call_count ?? 0,
  }
}

function toTurnMessage(item: unknown): TurnMessage {
  const googleContent = GoogleContent.safeParse(item)
  if (googleContent.success && Array.isArray(googleContent.data.parts)) {
    const role = googleContent.data.role
    const content = parseEach(GoogleTextPart, googleContent.data.parts)
      .flatMap((part) => (typeof part.text === 'string' ? [part.text] : []))
    return { role: role === 'model' ? 'assistant' : typeof role === 'string' ? role : null, content }
  }

  const message = ChatMessage.safeParse(item)
  if (!message.success) return { role: null, content: null }
  const { role, content } = message.data
  return { role: role ?? null, content: messageContent(content) }
}

function messageContent(content: unknown): TurnMessage['content'] {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return null
  return parseEach(ContentBlock, content)
    .filter((block) => block.type === 'text' && block.text !== undefined)
    .map((block) => block.text ?? '')
}

function systemText(system: unknown): string {
  if (typeof system === 'string') return system
  if (!Array.isArray(system)) return ''
  return parseEach(SystemBlock, system)
    .flatMap((block) => (typeof block.text === 'string' ? [block.text] : []))
    .join('\n')
}
