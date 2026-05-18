import { useState } from 'react'
import { Link } from 'react-router'
import type { TraceDetail } from '@contracts/api'

const LONG_PROMPT_CHARS = 280

export function TraceHeader({ trace, providerLabel }: { trace: TraceDetail; providerLabel: string }) {
  const [expanded, setExpanded] = useState(false)
  const started = new Date(trace.startedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
  const isLong = trace.prompt.length > LONG_PROMPT_CHARS
  return (
    <header className="grid gap-3">
      <Link to="/" className="text-sm text-ink-soft hover:text-ink">Back to runs</Link>
      <p className="text-sm text-ink-soft">Run #{trace.id} on {providerLabel}, {started}</p>
      <h1 className={`max-w-4xl whitespace-pre-wrap font-semibold leading-snug tracking-tight [overflow-wrap:anywhere] ${isLong ? 'text-xl' : 'text-[28px]'} ${isLong && !expanded ? 'line-clamp-4' : ''}`}>
        {trace.prompt}
      </h1>
      {isLong && (
        <button type="button" onClick={() => setExpanded((open) => !open)} className="justify-self-start text-sm text-focus hover:underline">
          {expanded ? 'Show less' : 'Show full prompt'}
        </button>
      )}
    </header>
  )
}
