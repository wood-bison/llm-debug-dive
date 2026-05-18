import { CopyButton } from '@web/components/CopyButton'
import { CHEAP_PROMPT_TEMPLATE, GUIDE_SECTIONS } from './guideContent'
import type { GuideSection } from './guideTypes'

export function GuidePage() {
  return (
    <div className="grid min-w-0 gap-12 lg:grid-cols-[220px_minmax(0,1fr)]">
      <nav aria-label="Guide sections" className="lg:sticky lg:top-24 lg:self-start">
        <ul className="grid gap-1 text-sm">
          {GUIDE_SECTIONS.map((section) => (
            <li key={section.id}><a href={`#${section.id}`} className="block rounded-md px-3 py-1.5 text-ink-soft hover:bg-sunken hover:text-ink">{section.title}</a></li>
          ))}
          <li><a href="#prompt-template" className="block rounded-md px-3 py-1.5 text-ink-soft hover:bg-sunken hover:text-ink">Cheap prompt template</a></li>
        </ul>
      </nav>
      <div className="grid min-w-0 max-w-4xl gap-14">
        <header>
          <h1 className="text-[34px] font-semibold tracking-tight">Debugging guide</h1>
          <p className="mt-2 max-w-2xl text-ink-soft">The words this dashboard uses, and what to do when a run looks wrong.</p>
        </header>
        {GUIDE_SECTIONS.map((section) => <GuideSectionView key={section.id} section={section} />)}
        <section id="prompt-template" className="min-w-0 scroll-mt-24">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-semibold tracking-tight">Cheap prompt template</h2>
            <CopyButton text={CHEAP_PROMPT_TEMPLATE} label="Copy template" />
          </div>
          <pre className="max-w-full overflow-x-auto rounded-xl border border-line bg-surface p-5 font-mono text-[13px] leading-relaxed">{CHEAP_PROMPT_TEMPLATE}</pre>
        </section>
      </div>
    </div>
  )
}

function GuideSectionView({ section }: { section: GuideSection }) {
  return (
    <section id={section.id} className="min-w-0 scroll-mt-24">
      <h2 className="mb-5 text-xl font-semibold tracking-tight">{section.title}</h2>
      <dl className={section.kind === 'terms' ? 'grid gap-x-8 gap-y-6 sm:grid-cols-2' : 'grid gap-4'}>
        {section.items.map((item) => (
          <div key={item.name} className={section.kind === 'pairs' ? 'grid gap-1 border-t border-line pt-4 sm:grid-cols-[240px_1fr] sm:gap-6' : ''}>
            <dt className="font-semibold">{item.name}</dt>
            <dd className="text-ink-soft">
              {item.meaning}
              {item.example && <span className="mt-1 block text-sm text-ink-faint">{item.example}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
