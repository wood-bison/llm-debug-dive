import type { Logger, TelemetryWriter } from '../src/application/ports'
import type { NewSpan, ToolInvocation } from '../src/domain/telemetry'

export class MemoryWriter implements TelemetryWriter {
  traces: Array<{ externalId: string | null; provider: string }> = []
  spans: NewSpan[] = []
  tools: Array<{ spanId: number; tools: ToolInvocation[] }> = []

  async getOrCreateTrace(externalId: string | null, provider: string) {
    this.traces.push({ externalId, provider })
    return this.traces.length
  }

  async insertSpan(span: NewSpan) {
    this.spans.push(span)
    return this.spans.length
  }

  async insertToolInvocations(spanId: number, _traceId: number | null, _at: number, tools: ToolInvocation[]) {
    this.tools.push({ spanId, tools })
  }
}

export function memoryLogger(): Logger & { lines: string[] } {
  const lines: string[] = []
  return { lines, log: (m) => lines.push(m), warn: (m) => lines.push(m), error: (m) => lines.push(m) }
}
