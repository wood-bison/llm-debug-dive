import type { CodexLocalTool } from '../domain/codex'
import { tokenLoad } from '../domain/metrics'
import { costOf } from '../domain/pricing'
import { summarizeSkills } from '../domain/skills'
import { totalsOf, type TokenTotals, type Turn } from '../domain/telemetry'
import { buildEfficiencyBadges, type EfficiencyBadge } from '../domain/verdict'
import { groupBy, sumBy } from '../shared/collections'
import type { QueryFilters, SkillUsage, StatsTotals, TelemetryReader, ToolUsage } from './ports'
import type { TurnQueries } from './turns'

export const TRACE_LIST_LIMIT = 50

export interface DashboardStats {
  totals: StatsTotals
  tokens: TokenTotals
  totalCost: number
  costPerCall: number
}

export interface ToolTally {
  toolName: string
  count: number | null
}

export interface TraceListItem {
  turn: Turn
  cost: number
  tokenLoad: number
  durationMs: number
  tools: ToolTally[]
  badges: EfficiencyBadge[]
}

export interface TraceListPage {
  items: TraceListItem[]
  olderTraceCount: number
}

export interface SkillReport {
  stored: Array<SkillUsage & { cost: number }>
  local: Array<{ label: string; count: number; intent: string }>
}

export function createDashboardQueries(deps: { reader: TelemetryReader; turns: TurnQueries }) {
  const { reader, turns } = deps

  async function stats(f: QueryFilters): Promise<DashboardStats> {
    const totals = await reader.stats(f)
    const byModel = await reader.usageByModel(f)
    const totalCost = sumBy(byModel, (r) => costOf(r.model, r.usage))
    const tokens = totalsOf(totals.usage)

    return {
      totals,
      tokens,
      totalCost,
      costPerCall: totals.spans > 0 ? totalCost / totals.spans : 0,
    }
  }

  async function traceList(f: QueryFilters): Promise<TraceListPage> {
    const items = await traceListItems(f)
    const olderTraceCount = items.length === 0 ? await reader.countTracesBefore(f) : 0
    return { items, olderTraceCount }
  }

  async function traceListItems(f: QueryFilters): Promise<TraceListItem[]> {
    const rows = await turns.listTurns(f, TRACE_LIST_LIMIT)
    if (rows.length === 0) return []

    const ids = rows.map((r) => r.id)
    const [footprints, spanCosts] = await Promise.all([reader.toolFootprints(ids), reader.spanCosts(ids)])
    const toolsByTrace = groupBy(footprints, (f) => f.traceId)

    return rows.map((turn) => {
      const cost = sumBy(spanCosts.get(turn.id) ?? [], (s) => costOf(s.model, s.tokens))
      const stored = toolsByTrace.get(turn.id)?.map(({ toolName, count }) => ({ toolName, count }))
      const tools = stored ?? turn.codexTools.map((label) => ({ toolName: label, count: null }))
      return {
        turn,
        cost,
        tokenLoad: tokenLoad(turn.totals),
        durationMs: turn.endedAt - turn.startedAt,
        tools,
        badges: buildEfficiencyBadges({
          tokens: turn.totals,
          spanCount: turn.spanCount,
          cost,
          tools: tools.map(asAnalyzableTool),
          status: turn.lastStatus,
        }),
      }
    })
  }

  async function skills(f: QueryFilters): Promise<SkillReport> {
    const stored = (await reader.skillUsage(f)).map((usage) => ({
      ...usage,
      cost: costOf(usage.models[0] ?? null, usage.usage),
    }))
    return { stored, local: await localSkills(f) }
  }

  async function localSkills(f: QueryFilters): Promise<SkillReport['local']> {
    const tally = new Map<string, { label: string; count: number; intent: string }>()
    for (const turn of await turns.listTurns(f, TRACE_LIST_LIMIT)) {
      const localTurn = turns.localTurn(await reader.spansByTrace(turn.id))
      for (const skill of summarizeSkills(localTurn?.tools ?? [])) {
        const entry = tally.get(skill.key) ?? { label: skill.label, count: 0, intent: skill.intent }
        entry.count += skill.count
        tally.set(skill.key, entry)
      }
    }
    return [...tally.values()].sort((a, b) => b.count - a.count)
  }

  async function tools(f: QueryFilters): Promise<ToolUsage[]> {
    return reader.toolUsage(f)
  }

  return { stats, traceList, skills, tools }
}

export type DashboardQueries = ReturnType<typeof createDashboardQueries>

function asAnalyzableTool(tally: ToolTally): CodexLocalTool {
  return { name: tally.toolName, label: tally.toolName, input: null }
}
