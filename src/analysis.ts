import type { CodexLocalTool } from './codexSession'

export type SkillKey =
  | 'research'
  | 'git'
  | 'code'
  | 'verify'
  | 'browser'
  | 'mcp'
  | 'agents'
  | 'shell'
  | 'other'

export interface SkillInfo {
  key: SkillKey
  label: string
  intent: string
}

export interface ToolWithSkill extends CodexLocalTool {
  skill: SkillInfo
  preview: string
}

export interface SkillSummary {
  key: SkillKey
  label: string
  count: number
  intent: string
  tools: ToolWithSkill[]
}

export interface EfficiencyBadge {
  tone: 'good' | 'warn' | 'bad' | 'neutral'
  label: string
  title: string
}

export interface TurnMetrics {
  input: number
  output: number
  cacheRead: number
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
  tone: 'good' | 'warn' | 'bad' | 'neutral'
  title: string
  summary: string
  compare: string
}

export interface RepeatedTool {
  command: string
  count: number
  skill: SkillInfo
}

const SKILLS: Record<SkillKey, SkillInfo> = {
  research: { key: 'research', label: 'Read & search', intent: 'Gather codebase context.' },
  git: { key: 'git', label: 'Git history', intent: 'Understand branch, commits, and diffs.' },
  code: { key: 'code', label: 'Code edits', intent: 'Change files or run code transforms.' },
  verify: { key: 'verify', label: 'Checks', intent: 'Run tests, builds, type checks, or linters.' },
  browser: { key: 'browser', label: 'Browser QA', intent: 'Inspect and validate UI behavior.' },
  mcp: { key: 'mcp', label: 'MCP / apps', intent: 'Call connected tools and app integrations.' },
  agents: { key: 'agents', label: 'Sub-agents', intent: 'Delegate side work to another agent.' },
  shell: { key: 'shell', label: 'Shell ops', intent: 'Run operational commands.' },
  other: { key: 'other', label: 'Other', intent: 'Unclassified work.' },
}

const SKILL_ORDER: SkillKey[] = ['research', 'code', 'verify', 'browser', 'mcp', 'git', 'agents', 'shell', 'other']

export function commandFromTool(tool: Pick<CodexLocalTool, 'name' | 'label' | 'input'>): string {
  const parsed = parseJson(tool.input)
  if (parsed && typeof parsed.cmd === 'string') return parsed.cmd
  return tool.label || tool.name
}

export function classifyTool(tool: Pick<CodexLocalTool, 'name' | 'label' | 'input'>): SkillInfo {
  const name = tool.name.toLowerCase()
  const cmd = commandFromTool(tool).trim()
  const lower = cmd.toLowerCase()

  if (name.includes('agent')) return SKILLS.agents
  if (name.includes('browser') || name.includes('playwright') || lower.includes('playwright')) return SKILLS.browser
  if (name.includes('mcp') || /^list_mcp_/.test(name) || lower.includes('mcp__')) return SKILLS.mcp
  if (/^(git|gh)\b/.test(lower)) return SKILLS.git
  if (/^(rg|grep|find|sed|cat|ls|jq|awk|pwd|wc|nl|tail|head)\b/.test(lower)) return SKILLS.research
  if (/\b(test|mvn|gradle|bun|npm|pnpm|yarn|tsc|checkstyle|eslint|prettier|typecheck)\b/.test(lower)) return SKILLS.verify
  if (isCodeEditCommand(name, lower)) return SKILLS.code
  if (name.includes('exec') || name.includes('command')) return SKILLS.shell
  return SKILLS.other
}

export function enrichTools(tools: CodexLocalTool[]): ToolWithSkill[] {
  return tools.map((tool) => {
    const preview = toolPreview(tool)
    return { ...tool, skill: classifyTool(tool), preview }
  })
}

export function summarizeSkills(tools: CodexLocalTool[]): SkillSummary[] {
  const map = new Map<SkillKey, SkillSummary>()
  for (const tool of enrichTools(tools)) {
    const cur = map.get(tool.skill.key) ?? {
      key: tool.skill.key,
      label: tool.skill.label,
      count: 0,
      intent: tool.skill.intent,
      tools: [],
    }
    cur.count += 1
    cur.tools.push(tool)
    map.set(tool.skill.key, cur)
  }
  return [...map.values()].sort((a, b) => SKILL_ORDER.indexOf(a.key) - SKILL_ORDER.indexOf(b.key))
}

export function buildEfficiencyBadges(args: {
  input: number
  output: number
  cacheRead: number
  spanCount: number
  durationMs: number
  cost: number
  tools: CodexLocalTool[]
  status: number
}): EfficiencyBadge[] {
  const total = args.input + args.output + args.cacheRead
  const cacheDenom = args.input + args.cacheRead
  const cacheHit = cacheDenom > 0 ? Math.round((args.cacheRead / cacheDenom) * 100) : 0
  const skills = summarizeSkills(args.tools)
  const badges: EfficiencyBadge[] = []

  if (args.status >= 400) {
    badges.push({ tone: 'bad', label: 'failed call', title: `Last captured status was ${args.status}.` })
  }
  if (args.cost >= 0.5) {
    badges.push({ tone: 'bad', label: 'expensive', title: 'Estimated spend is high for one trace.' })
  } else if (total >= 200_000) {
    badges.push({ tone: 'bad', label: 'huge context', title: 'Very high token load.' })
  } else if (total >= 50_000) {
    badges.push({ tone: 'warn', label: 'context-heavy', title: 'Large token load; check whether the prompt could be narrower.' })
  } else {
    badges.push({ tone: 'good', label: 'light trace', title: 'Token load is modest.' })
  }

  if (cacheDenom > 0 && cacheHit >= 70) {
    badges.push({ tone: 'good', label: 'cache helped', title: `${cacheHit}% of input context came from cache.` })
  } else if (cacheDenom > 0 && cacheHit < 30 && args.input > 10_000) {
    badges.push({ tone: 'warn', label: 'cold cache', title: `${cacheHit}% cache hit; most input was fresh.` })
  }

  if (args.tools.length === 0) {
    badges.push({ tone: 'neutral', label: 'no tools', title: 'Mostly model reasoning from existing context.' })
  } else {
    const top = skills[0]
    if (top) badges.push({ tone: 'neutral', label: top.key, title: `${top.label}: ${top.count} tool call(s).` })
    if (args.tools.length >= 12) badges.push({ tone: 'warn', label: 'tool-heavy', title: 'Many tool calls; inspect repeated work.' })
  }

  if (skills.some((s) => s.key === 'verify')) {
    badges.push({ tone: 'good', label: 'verified', title: 'The workflow included checks/tests/builds.' })
  }
  if (args.spanCount >= 8) {
    badges.push({ tone: 'warn', label: 'many calls', title: `${args.spanCount} captured calls in one turn.` })
  }

  return badges.slice(0, 4)
}

export function repeatedTools(tools: CodexLocalTool[], minCount = 2): RepeatedTool[] {
  const counts = new Map<string, { count: number; skill: SkillInfo }>()
  for (const tool of tools) {
    const key = commandFamily(tool)
    const cur = counts.get(key) ?? { count: 0, skill: classifyTool(tool) }
    cur.count += 1
    counts.set(key, cur)
  }
  return [...counts.entries()]
    .filter(([, value]) => value.count >= minCount)
    .map(([command, value]) => ({ command, count: value.count, skill: value.skill }))
    .sort((a, b) => b.count - a.count)
}

export function buildVerdict(metrics: TurnMetrics, baseline: BaselineMetrics | null): Verdict {
  const tokenLoad = metrics.input + metrics.output + metrics.cacheRead
  const cacheDenom = metrics.input + metrics.cacheRead
  const cacheHit = cacheDenom > 0 ? Math.round((metrics.cacheRead / cacheDenom) * 100) : 0
  const skills = summarizeSkills(metrics.tools)
  const hasVerify = skills.some((s) => s.key === 'verify')
  const hasCode = skills.some((s) => s.key === 'code')

  let tone: Verdict['tone'] = 'good'
  let title = 'Mostly efficient'
  const reasons: string[] = []

  if (metrics.status >= 400) {
    tone = 'bad'
    title = 'Failed work'
    reasons.push(`last captured status was ${metrics.status}`)
  }
  if (tokenLoad >= 200_000 || metrics.cost >= 0.5) {
    tone = 'bad'
    title = 'Expensive turn'
    reasons.push(`${formatCompact(tokenLoad)} token load`)
  } else if (tokenLoad >= 50_000) {
    tone = tone === 'bad' ? tone : 'warn'
    title = 'Needs narrower prompt'
    reasons.push(`${formatCompact(tokenLoad)} token load`)
  }
  if (cacheDenom > 0 && cacheHit < 30 && metrics.input > 10_000) {
    tone = tone === 'bad' ? tone : 'warn'
    title = title === 'Mostly efficient' ? 'Mostly efficient, but cold cache' : title
    reasons.push(`${cacheHit}% cache hit`)
  }
  if (metrics.tools.length === 0 && tokenLoad > 30_000) {
    tone = tone === 'bad' ? tone : 'warn'
    reasons.push('no local tools used')
  }
  if (hasCode && !hasVerify) {
    tone = tone === 'bad' ? tone : 'warn'
    reasons.push('edits without visible verification')
  }
  if (hasVerify) {
    reasons.push('verification included')
  }
  if (reasons.length === 0) {
    reasons.push('token load, cache, and tool use look reasonable')
  }

  return {
    tone,
    title,
    summary: sentence(reasons),
    compare: compareToBaseline(tokenLoad, cacheHit, baseline),
  }
}

export function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid]
}

function compareToBaseline(tokenLoad: number, cacheHit: number, baseline: BaselineMetrics | null): string {
  if (!baseline || baseline.sampleSize < 2 || baseline.medianTokenLoad <= 0) {
    return 'Need a few more turns before baseline comparison becomes useful.'
  }
  const ratio = tokenLoad / baseline.medianTokenLoad
  const tokenLine = ratio >= 1.25
    ? `${ratio.toFixed(1)}x above your recent median token load`
    : ratio <= 0.75
      ? `${(1 / Math.max(ratio, 0.01)).toFixed(1)}x below your recent median token load`
      : 'near your recent median token load'
  const cacheDelta = cacheHit - baseline.medianCacheHit
  const cacheLine = Math.abs(cacheDelta) < 10
    ? 'cache is near baseline'
    : cacheDelta > 0
      ? `cache is ${cacheDelta} points better than baseline`
      : `cache is ${Math.abs(cacheDelta)} points worse than baseline`
  return `${tokenLine}; ${cacheLine}.`
}

function sentence(parts: string[]): string {
  const text = parts.join(', ')
  return text.charAt(0).toUpperCase() + text.slice(1) + '.'
}

function formatCompact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(Math.round(value))
}

export function toolPreview(tool: Pick<CodexLocalTool, 'name' | 'label' | 'input'>): string {
  const cmd = commandFromTool(tool)
  return cmd.length > 110 ? cmd.slice(0, 110) + '...' : cmd
}

export function commandFamily(tool: Pick<CodexLocalTool, 'name' | 'label' | 'input'>): string {
  const cmd = commandFromTool(tool).trim()
  const parts = cmd.split(/\s+/).filter(Boolean)
  const first = parts[0] ?? tool.name
  if (['rg', 'grep'].includes(first)) return first
  if (['sed', 'cat', 'nl', 'tail', 'head'].includes(first)) return 'file-read'
  if (['ls', 'find'].includes(first)) return 'file-discovery'
  if (['bun', 'npm', 'pnpm', 'yarn', 'mvn', 'gradle'].includes(first)) return parts.slice(0, 2).join(' ')
  if (first === 'git') return parts.slice(0, 2).join(' ')
  return tool.name
}

function parseJson(text: string | null): any | null {
  if (!text) return null
  try { return JSON.parse(text) } catch { return null }
}

function isCodeEditCommand(toolName: string, lowerCommand: string): boolean {
  if (toolName.includes('apply_patch') || /\bapply_patch\b/.test(lowerCommand)) return true

  return [
    /\bsed\b[^|;&]*\s-i\b/,
    /\bperl\b[^|;&]*\s-pi\b/,
    /\btee\s+-?a?\s+\S+/,
    /\bcat\s+>\s+\S+/,
    />>?\s+\S+$/,
    /\bwritefilesync\b/,
    /\bappendfilesync\b/,
    /\bwrite_text\b/,
    /\bfs\.write\b/,
    /\bopen\([^)]*['"]w['"]/,
  ].some((pattern) => pattern.test(lowerCommand))
}
