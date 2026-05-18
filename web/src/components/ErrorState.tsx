export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-xl border border-critical/40 bg-surface p-6">
      <h2 className="font-semibold text-critical">Could not load data</h2>
      <p className="mt-1 text-sm text-ink-soft">{error.message}</p>
      {onRetry && <button type="button" onClick={onRetry} className="mt-4 rounded-md bg-ink px-3 py-1.5 text-sm text-surface">Try again</button>}
    </div>
  )
}
