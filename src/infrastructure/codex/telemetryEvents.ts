import { z } from 'zod'
import { CODEX_TURN_EVENT, type CodexTurnStats } from '../../domain/codex'
import type { ToolInvocation } from '../../domain/telemetry'
import { isNonEmpty } from '../../shared/guards'
import { lenient, optList, optNumber, optString, parseAs, parseEach, parseJsonAs, wireObject } from '../wire/schema'

const MCP_TOOL_CALL_EVENT = 'codex_mcp_tool_call_event'

export const EventParams = wireObject({
  thread_id: optString,
  turn_id: optString,
  status: optString,
  model: optString,
  reasoning_effort: optString,
  total_tool_call_count: optNumber,
  shell_command_count: optNumber,
  file_change_count: optNumber,
  duration_ms: optNumber,
  tool_name: optString,
  mcp_tool_name: optString,
  mcp_server_name: optString,
  terminal_status: optString,
})

export const AnalyticsEvent = wireObject({
  event_type: optString,
  event_params: lenient(EventParams),
})
type AnalyticsEvent = z.output<typeof AnalyticsEvent>

const EventBatch = wireObject({ events: optList })

export function eventsOf(requestBody: string | null | undefined): AnalyticsEvent[] {
  return parseEach(AnalyticsEvent, parseJsonAs(EventBatch, requestBody)?.events)
}

export function firstEvent(requestBody: string | null | undefined): AnalyticsEvent | null {
  return parseAs(AnalyticsEvent, parseJsonAs(EventBatch, requestBody)?.events?.[0])
}

export function eventType(requestBody: string | null | undefined): string | null {
  return firstEvent(requestBody)?.event_type ?? null
}

function turnEventParams(requestBody: string | null | undefined) {
  const event = firstEvent(requestBody)
  return event?.event_type === CODEX_TURN_EVENT ? event.event_params ?? {} : null
}

export function extractCodexIds(requestBody: string | null | undefined): { threadId: string | null; turnId: string | null } {
  const params = turnEventParams(requestBody)
  return { threadId: params?.thread_id ?? null, turnId: params?.turn_id ?? null }
}

export function turnStats(requestBody: string | null | undefined): CodexTurnStats | null {
  const params = turnEventParams(requestBody)
  if (!params) return null
  return {
    status: params.status ?? null,
    model: params.model ?? null,
    reasoningEffort: params.reasoning_effort ?? null,
    toolCalls: params.total_tool_call_count ?? null,
    shellCommands: params.shell_command_count ?? null,
    fileChanges: params.file_change_count ?? null,
    durationMs: params.duration_ms ?? null,
    threadId: params.thread_id ?? null,
  }
}

export function extractCodexTelemetryTools(requestBody: string | null | undefined): ToolInvocation[] {
  return eventsOf(requestBody)
    .filter((event) => event.event_type === MCP_TOOL_CALL_EVENT)
    .flatMap((event) => {
      const params = event.event_params ?? {}
      const toolName = params.tool_name ?? params.mcp_tool_name
      return toolName ? [mcpToolInvocation(toolName, params)] : []
    })
}

function mcpToolInvocation(toolName: string, params: z.output<typeof EventParams>): ToolInvocation {
  const server = params.mcp_server_name ?? null
  const preview = [
    server && `server=${server}`,
    params.terminal_status,
    params.duration_ms !== undefined && `${params.duration_ms}ms`,
  ].filter(isNonEmpty)
  return { toolName, inputPreview: preview.length > 0 ? preview.join(' · ') : null, skillName: server }
}
