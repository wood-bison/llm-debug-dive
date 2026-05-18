import type { SpanDetail } from '@contracts/api'
import { fmtCount } from '@shared/format'
import { CopyButton } from '@web/components/CopyButton'

export function RawBody({ title, body }: { title: string; body: SpanDetail['requestBody'] }) {
  return (
    <details className="rounded-lg border border-line bg-surface">
      <summary className="flex cursor-pointer items-center gap-3 px-4 py-3 text-sm">
        <span className="font-medium">{title}</span>
        <span className="text-ink-faint">{fmtCount(body.bytes)} bytes{body.isJson ? ', JSON' : ''}</span>
      </summary>
      <div className="border-t border-line p-4">
        <div className="mb-2 flex justify-end"><CopyButton text={body.text} /></div>
        <pre className="max-h-[480px] overflow-auto font-mono text-xs leading-relaxed">{body.text}</pre>
      </div>
    </details>
  )
}
