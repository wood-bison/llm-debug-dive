import { useTheme } from '@web/hooks/useTheme'

export function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const next = theme === 'dark' ? 'light' : 'dark'
  return (
    <button
      type="button"
      onClick={toggle}
      className="rounded-md border border-line px-2.5 py-1.5 text-xs text-ink-soft hover:border-line-strong hover:text-ink"
      aria-label={`Switch to ${next} theme`}
    >
      {theme === 'dark' ? 'Dark mode' : 'Light mode'}
    </button>
  )
}
