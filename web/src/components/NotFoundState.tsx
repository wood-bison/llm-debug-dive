import { Link } from 'react-router'

interface NotFoundStateProps {
  title?: string
  description?: string
  action?: string
}

export function NotFoundState({
  title = 'This page does not exist',
  description = 'Open the run list to pick a trace.',
  action = 'Open runs',
}: NotFoundStateProps) {
  return (
    <div className="py-24 text-center">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-2 text-ink-soft">{description}</p>
      <Link to="/" className="mt-6 inline-block rounded-md bg-ink px-4 py-2 text-sm text-surface">{action}</Link>
    </div>
  )
}
