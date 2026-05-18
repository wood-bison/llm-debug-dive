import { formatCompact } from '../shared/format'
import type { CodexLocalTool } from './codex'
import { cacheHitShare, isFailure, tokenLoad } from './metrics'
import { hasSkill, summarizeSkills, type SkillSummary } from './skills'
import type { TokenTotals } from './telemetry'
import {
  CACHE_HIT_PCT,
  MIN_FRESH_INPUT_FOR_CACHE_SIGNALS,
  SPAN_COUNT,
  TOKEN_LOAD,
  TOOL_CALLS,
  TRACE_COST_USD,
} from './thresholds'

export type Tone = 'good' | 'neutral' | 'warn' | 'bad'

export interface EfficiencyBadge {
  tone: Tone
  label: string
  title: string
}

export interface TurnMetrics {
  tokens: Pick<TokenTotals, 'input' | 'output' | 'cacheRead'> & Partial<Pick<TokenTotals, 'cacheCreation'>>
  spanCount: number
  cost: number
  status: number
  tools: CodexLocalTool[]
}

export interface BaselineMetrics {
  medianTokenLoad: number
  medianCacheHit: number
  sampleSize: number
}

export interface Verdict {
  tone: Tone
  title: string
  summary: string
  compare: string
}

const MAX_BADGES = 4
const MIN_BASELINE_SAMPLES = 2
const BASELINE_RATIO = { above: 1.25, below: 0.75 } as const
const MIN_BASELINE_RATIO = 0.01
const BASELINE_CACHE_TOLERANCE_PTS = 10

const DEFAULT_TITLE = 'Mostly efficient'

interface TurnFacts {
  load: number
  cacheHit: number
  coldCache: boolean
  hasInput: boolean
  skills: SkillSummary[]
}

function factsOf(m: TurnMetrics): TurnFacts {
  const cacheHit = cacheHitShare(m.tokens)
  const hasInput = m.tokens.input + m.tokens.cacheRead + (m.tokens.cacheCreation ?? 0) > 0
  return {
    load: tokenLoad(m.tokens),
    cacheHit,
    hasInput,
    coldCache: hasInput && cacheHit < CACHE_HIT_PCT.cold && m.tokens.input > MIN_FRESH_INPUT_FOR_CACHE_SIGNALS,
    skills: summarizeSkills(m.tools),
  }
}

export function buildEfficiencyBadges(m: TurnMetrics): EfficiencyBadge[] {
  const facts = factsOf(m)
  const badges = [
    failureBadge(m),
    loadBadge(m, facts),
    cacheBadge(facts),
    ...toolBadges(m, facts),
    verifiedBadge(facts),
    callCountBadge(m),
  ]
  return badges.filter((b): b is EfficiencyBadge => b != null).slice(0, MAX_BADGES)
}

function failureBadge(m: TurnMetrics): EfficiencyBadge | null {
  return isFailure(m.status) ? { tone: 'bad', label: 'failed call', title: `Last captured status was ${m.status}.` } : null
}

function loadBadge(m: TurnMetrics, { load }: TurnFacts): EfficiencyBadge {
  if (m.cost >= TRACE_COST_USD.expensive) return { tone: 'bad', label: 'expensive', title: 'Estimated spend is high for one trace.' }
  if (load >= TOKEN_LOAD.huge) return { tone: 'bad', label: 'huge context', title: 'Very high token load.' }
  if (load >= TOKEN_LOAD.heavy) return { tone: 'warn', label: 'context-heavy', title: 'Large token load; check whether the prompt could be narrower.' }
  return { tone: 'good', label: 'light trace', title: 'Token load is modest.' }
}

function cacheBadge({ hasInput, cacheHit, coldCache }: TurnFacts): EfficiencyBadge | null {
  if (hasInput && cacheHit >= CACHE_HIT_PCT.helped) return { tone: 'good', label: 'cache helped', title: `${cacheHit}% of input context came from cache.` }
  if (coldCache) return { tone: 'warn', label: 'cold cache', title: `${cacheHit}% cache hit; most input was fresh.` }
  return null
}

function toolBadges(m: TurnMetrics, { skills }: TurnFacts): EfficiencyBadge[] {
  if (m.tools.length === 0) return [{ tone: 'neutral', label: 'no tools', title: 'Mostly model reasoning from existing context.' }]
  const badges: EfficiencyBadge[] = []
  const top = skills[0]
  if (top) badges.push({ tone: 'neutral', label: top.key, title: `${top.label}: ${top.count} tool call(s).` })
  if (m.tools.length >= TOOL_CALLS.heavy) badges.push({ tone: 'warn', label: 'tool-heavy', title: 'Many tool calls; inspect repeated work.' })
  return badges
}

function verifiedBadge({ skills }: TurnFacts): EfficiencyBadge | null {
  return hasSkill(skills, 'verify') ? { tone: 'good', label: 'checks observed', title: 'Check tools were captured; their presence does not prove they passed.' } : null
}

function callCountBadge(m: TurnMetrics): EfficiencyBadge | null {
  return m.spanCount >= SPAN_COUNT.many ? { tone: 'warn', label: 'many calls', title: `${m.spanCount} captured calls in one turn.` } : null
}

export function buildVerdict(m: TurnMetrics, baseline: BaselineMetrics | null): Verdict {
  const facts = factsOf(m)
  const hasVerify = hasSkill(facts.skills, 'verify')
  const hasCode = hasSkill(facts.skills, 'code')

  let tone: Tone = 'good'
  let title = DEFAULT_TITLE
  const reasons: string[] = []
  const warn = () => { if (tone !== 'bad') tone = 'warn' }

  if (isFailure(m.status)) {
    tone = 'bad'
    title = 'Failed work'
    reasons.push(`last captured status was ${m.status}`)
  }
  if (facts.load >= TOKEN_LOAD.huge || m.cost >= TRACE_COST_USD.expensive) {
    tone = 'bad'
    title = 'Expensive turn'
    reasons.push(`${formatCompact(facts.load)} token load`)
  } else if (facts.load >= TOKEN_LOAD.heavy) {
    warn()
    title = 'Needs narrower prompt'
    reasons.push(`${formatCompact(facts.load)} token load`)
  }
  if (facts.coldCache) {
    warn()
    if (title === DEFAULT_TITLE) title = 'Mostly efficient, but cold cache'
    reasons.push(`${facts.cacheHit}% cache hit`)
  }
  if (m.tools.length === 0 && facts.load > TOKEN_LOAD.costlyWithoutTools) {
    warn()
    reasons.push('no local tools used')
  }
  if (hasCode && !hasVerify) {
    warn()
    reasons.push('edits without visible verification')
  }
  if (hasVerify) reasons.push('verification included')
  if (reasons.length === 0) reasons.push('token load, cache, and tool use look reasonable')

  return {
    tone,
    title,
    summary: sentence(reasons),
    compare: compareToBaseline(facts.load, facts.cacheHit, baseline),
  }
}

function compareToBaseline(load: number, cacheHit: number, baseline: BaselineMetrics | null): string {
  if (!baseline || baseline.sampleSize < MIN_BASELINE_SAMPLES || baseline.medianTokenLoad <= 0) {
    return 'Need a few more turns before baseline comparison becomes useful.'
  }
  return `${tokenLine(load / baseline.medianTokenLoad)}; ${cacheLine(cacheHit - baseline.medianCacheHit)}.`
}

function tokenLine(ratio: number): string {
  if (ratio >= BASELINE_RATIO.above) return `${ratio.toFixed(1)}x above your recent median token load`
  if (ratio <= BASELINE_RATIO.below) return `${(1 / Math.max(ratio, MIN_BASELINE_RATIO)).toFixed(1)}x below your recent median token load`
  return 'near your recent median token load'
}

function cacheLine(deltaPts: number): string {
  if (Math.abs(deltaPts) < BASELINE_CACHE_TOLERANCE_PTS) return 'cache is near baseline'
  return deltaPts > 0
    ? `cache is ${deltaPts} points better than baseline`
    : `cache is ${Math.abs(deltaPts)} points worse than baseline`
}

function sentence(parts: string[]): string {
  const text = parts.join(', ')
  return text.charAt(0).toUpperCase() + text.slice(1) + '.'
}
