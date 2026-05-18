import { useState } from 'react'
import type { LocalReview, TraceDetail } from '@contracts/api'
import { useLocalReview } from '@web/api/queries'
import { Markdown } from '@web/components/Markdown'
import { Panel } from '@web/components/Panel'

export function LocalReviewPanel({ trace }: { trace: TraceDetail }) {
  const { models, saved } = trace.review
  const [model, setModel] = useState(models[0] ?? '')
  const review = useLocalReview(trace.id)
  const result = review.data
  const latest = result?.kind === 'reviewed' ? result.review : saved
  const selectedModel = models.includes(model) ? model : models[0] ?? ''

  return (
    <Panel title="Second opinion" description="A local Ollama model reviews this run without spending cloud tokens">
      <div className="grid gap-4">
        {models.length === 0 ? (
          <p className="text-sm text-ink-soft">Start Ollama (<code className="font-mono">ollama serve</code>) and pull a model to enable reviews.</p>
        ) : (
          <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => { event.preventDefault(); review.mutate(selectedModel) }}>
            <label className="sr-only" htmlFor="review-model">Local model</label>
            <select id="review-model" value={selectedModel} onChange={(event) => setModel(event.target.value)} className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm">
              {models.map((name) => <option key={name}>{name}</option>)}
            </select>
            <button type="submit" disabled={review.isPending} className="rounded-md bg-ink px-3 py-1.5 text-sm text-surface disabled:opacity-60">
              {review.isPending ? 'Reviewing…' : 'Review this run'}
            </button>
          </form>
        )}
        {review.error && <p role="alert" className="text-sm text-critical">{review.error.message}</p>}
        {result?.kind === 'not-found' && <p role="alert" className="text-sm text-critical">This run could not be found for local review.</p>}
        {result?.kind === 'failed' && <p role="alert" className="text-sm text-critical">The review failed: {result.message}</p>}
        {latest && <ReviewResultView review={latest} />}
      </div>
    </Panel>
  )
}

function ReviewResultView({ review }: { review: LocalReview }) {
  return (
    <article className="grid gap-3 rounded-lg border border-line p-4">
      <p className="text-xs text-ink-faint">{review.model}, {new Date(review.createdAt).toLocaleString('en-US')}</p>
      {review.response ? <Markdown>{review.response}</Markdown> : <p className="text-sm text-ink-soft">The model returned reasoning only. Open it below.</p>}
      {review.thinking && (
        <details className="text-sm">
          <summary className="cursor-pointer text-ink-soft">Model reasoning</summary>
          <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-sunken p-3 font-mono text-xs">{review.thinking}</pre>
        </details>
      )}
    </article>
  )
}
