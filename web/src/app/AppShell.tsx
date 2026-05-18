import { useLayoutEffect } from 'react'
import brandIcon from '../../../public/favicon.svg'
import { NavLink, Outlet, useLocation } from 'react-router'
import { ThemeToggle } from './ThemeToggle'

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-full px-3 py-1.5 text-sm transition-colors ${isActive ? 'bg-ink text-surface' : 'text-ink-soft hover:bg-sunken hover:text-ink'}`

export function AppShell() {
  const { pathname } = useLocation()
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  }, [pathname])
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 navigation-glass border-b border-line">
        <div className="mx-auto flex max-w-[1440px] items-center gap-3 px-4 py-3 sm:gap-6 sm:px-8">
          <NavLink to="/" aria-label="LLM Debug Dive" className="flex shrink-0 items-center gap-2.5 whitespace-nowrap font-semibold tracking-tight">
            <img src={brandIcon} width="32" height="32" alt="" className="shrink-0" />
            <span className="hidden min-[360px]:inline">LLM Debug Dive</span>
          </NavLink>
          <nav className="flex items-center gap-1" aria-label="Main">
            <NavLink to="/" end className={navLinkClass}>Runs</NavLink>
            <NavLink to="/guide" className={navLinkClass}>Guide</NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-4">
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1440px] px-4 pb-24 pt-8 sm:px-8">
        <Outlet />
      </main>
    </div>
  )
}
