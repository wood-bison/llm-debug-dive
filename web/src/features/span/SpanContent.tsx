import type { SpanDetail } from '@contracts/api'
import { fmtCost, fmtDuration, fmtTokens } from '@shared/format'
import { CodexTurnFacts } from './CodexTurnFacts'
import { MessageList } from './MessageList'
import { RawBody } from './RawBody'

export function SpanContent({ span }: { span: SpanDetail }) {
  const facts = [
    ['Model', span.model ?? 'Unknown'],
    ['Status', String(span.status)],
    ['Duration', fmtDuration(span.durationMs)],
    ['Cost', span.costUsd > 0 ? fmtCost(span.costUsd) : 'Unknown'],
    ['Fresh input', fmtTokens(span.usage.input)],
    ['Cache reads', `${fmtTokens(span.usage.cacheRead)} (${span.cacheHitPct}%)`],
    ['Output', fmtTokens(span.usage.output)],
    ['Transport', span.isStream ? 'Streaming' : 'Single response'],
  ] as const

  return (
    <div className="grid min-w-0 gap-8 [&>*]:min-w-0">
      <p className="font-mono text-xs text-ink-soft">{span.method} {span.path}</p>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-ink-faint">{label}</dt>
            <dd className="tabular text-sm font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      {span.codexTurn && <CodexTurnFacts turn={span.codexTurn} />}
      <MessageList messages={span.messages} />
      {span.tools.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold">Tools called</h3>
          <ul className="grid gap-2">
            {span.tools.map((tool, index) => (
              <li key={`${tool.name}-${index}`} className="rounded-lg border border-line bg-surface p-3 text-sm">
                <span className="font-medium">{tool.name}</span>{tool.skill && <span className="text-ink-soft">, skill {tool.skill}</span>}
                {tool.input && <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-xs text-ink-soft">{tool.input}</pre>}
              </li>
            ))}
          </ul>
        </section>
      )}
      <RawBody title="Raw request" body={span.requestBody} />
      <RawBody title="Raw response" body={span.responseBody} />
    </div>
  )
}
