import type { CodexTelemetry } from '../../application/ports'
import type { CodexSessionStore } from './sessionStore'
import { eventType, extractCodexIds, extractCodexTelemetryTools, turnStats } from './telemetryEvents'

export function createCodexTelemetry(sessions: CodexSessionStore): CodexTelemetry {
  return {
    eventType,
    turnStats,
    reportedTools: extractCodexTelemetryTools,
    localTurn(requestBody) {
      const { threadId, turnId } = extractCodexIds(requestBody)
      return threadId ? sessions.turn(threadId, turnId) : null
    },
  }
}
