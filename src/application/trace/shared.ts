import type { CodexLocalTool, CodexLocalTurn } from '../../domain/codex'
import { worstFailureOrOk } from '../../domain/metrics'
import { buildPromptCoach, type PromptCoachResult } from '../../domain/promptCoach'
import { classifyTool, commandFromTool } from '../../domain/skills'
import type { Span, ToolEvent, ToolInvocation, Trace } from '../../domain/telemetry'

export const DAY_MS = 24 * 60 * 60 * 1000
export const PROMPT_NOT_CAPTURED = '(prompt not captured)'

export function traceDurationMs(trace: Trace): number {
  return Math.max(1, trace.endedAt - trace.startedAt)
}

export function coachFor(
  trace: Trace,
  spans: Span[],
  run: { prompt: string; tools: CodexLocalTool[]; totalCost: number; hit: number },
): PromptCoachResult {
  return buildPromptCoach({
    prompt: run.prompt,
    tools: run.tools,
    tokens: trace.totals,
    spanCount: trace.spanCount,
    durationMs: traceDurationMs(trace),
    costUsd: run.totalCost,
    cacheHit: run.hit,
    status: worstFailureOrOk(spans),
  })
}

export function synthesizeToolEvents(localTurn: CodexLocalTurn | undefined, trace: Trace): ToolEvent[] {
  if (!localTurn) return []
  const duration = traceDurationMs(trace)
  const slots = localTurn.tools.length + 1
  return localTurn.tools.map((tool, index) => ({
    toolName: tool.name,
    skillName: classifyTool(tool).label,
    inputPreview: commandFromTool(tool),
    invokedAt: trace.startedAt + Math.round(((index + 1) / slots) * duration),
  }))
}

export function toReplayTool(tool: ToolInvocation): CodexLocalTool {
  return { name: tool.toolName, label: tool.inputPreview ?? tool.toolName, input: tool.inputPreview }
}
