import type { CoachIssue } from '@contracts/api'
import { ToneMark } from '@web/components/StatusLabel'

export function CoachIssueList({ issues }: { issues: CoachIssue[] }) {
  return (
    <ul className="grid min-w-0 grid-cols-1 gap-2 [&>*]:min-w-0">
      {issues.map((issue) => (
        <li key={issue.title}>
          <details className="group rounded-lg border border-line open:bg-sunken/60">
            <summary className="flex cursor-pointer list-none items-center gap-2.5 px-3 py-2.5 text-sm">
              <ToneMark tone={issue.tone} />
              <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{issue.title}</span>
              <span className="min-w-0 flex-1 truncate text-ink-soft">{issue.body}</span>
              <span className="tabular ml-auto shrink-0 text-xs text-ink-faint">{issue.penalty > 0 ? `−${issue.penalty} points` : 'no penalty'}</span>
            </summary>
            <dl className="grid min-w-0 gap-2 px-3 pb-3 pl-10 text-sm [overflow-wrap:anywhere]">
              {[['Evidence', issue.evidence], ['Why it matters', issue.impact], ['Fix', issue.fix]].map(([label, value]) =>
                value ? (
                  <div key={label}>
                    <dt className="text-xs text-ink-faint">{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ) : null,
              )}
            </dl>
          </details>
        </li>
      ))}
    </ul>
  )
}
