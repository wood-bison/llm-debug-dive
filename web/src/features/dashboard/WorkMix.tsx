import type { Overview } from '@contracts/api'
import { BarList } from '@web/charts/BarList'
import { Panel } from '@web/components/Panel'
import { plural } from '@shared/collections'

const MAX_TOOLS = 10
const callsLabel = (value: number) => `${value} ${plural(value, 'call')}`

export function WorkMix({ overview }: { overview: Overview }) {
  const skills = overview.skills.map((skill) => ({
    key: `${skill.source}-${skill.key}`,
    label: skill.label,
    value: skill.count,
    detail: skill.source === 'transcript' ? 'from Codex transcript' : undefined,
    hint: skill.intent || undefined,
  }))
  const tools = overview.tools.slice(0, MAX_TOOLS).map((tool) => ({
    key: tool.name,
    label: tool.name,
    value: tool.count,
  }))

  return (
    <div className="grid gap-6">
      <Panel title="Kind of work" description="Tool calls grouped into what the agent was doing">
        {skills.length > 0 ? <BarList items={skills} valueLabel={callsLabel} /> : <p className="text-sm text-ink-soft">Groups appear once an agent runs local tools.</p>}
      </Panel>
      <Panel title="Most used tools" description="Raw commands, MCP and browser operations">
        {tools.length > 0 ? <BarList items={tools} valueLabel={callsLabel} /> : <p className="text-sm text-ink-soft">No tool calls captured in this range.</p>}
      </Panel>
    </div>
  )
}
