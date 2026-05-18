import { useEffect, useRef, useState } from 'react'

const FEEDBACK_MS = 1500

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'error'>('idle')
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current)
  }, [])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setStatus('copied')
    } catch {
      setStatus('error')
    }
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current)
    feedbackTimer.current = setTimeout(() => setStatus('idle'), FEEDBACK_MS)
  }

  return (
    <button type="button" onClick={copy} className="rounded-md border border-line px-2.5 py-1 text-xs text-ink-soft hover:border-line-strong hover:text-ink">
      {status === 'copied' ? 'Copied' : status === 'error' ? 'Copy failed' : label}
      <span className="sr-only" aria-live="polite">{status === 'copied' ? 'Copied to clipboard' : status === 'error' ? 'Could not copy to clipboard' : ''}</span>
    </button>
  )
}
