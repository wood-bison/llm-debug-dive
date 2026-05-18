import { truncate } from '../shared/format'
import { isRecord } from '../shared/guards'
import { parseJson } from '../shared/json'
import type { AnalyzableTool, CodexLocalTool } from './codex'
import { REPEATED_TOOL_MIN_RUNS } from './thresholds'

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

const TOOL_PREVIEW_CHARS = 110

const READ_COMMAND_RE = /^(rg|grep|find|sed|cat|ls|jq|awk|pwd|wc|nl|tail|head)\b/
const GIT_COMMAND_RE = /^(git|gh)\b/
const VERIFY_COMMAND_RE = /\b(test|mvn|gradle|bun|npm|pnpm|yarn|tsc|checkstyle|eslint|prettier|typecheck)\b/

const FILE_WRITE_PATTERNS: readonly RegExp[] = [
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
]

interface ToolSignature {
  name: string
  command: string
}

const CLASSIFICATION_RULES: ReadonlyArray<readonly [SkillKey, (t: ToolSignature) => boolean]> = [
  ['agents', (t) => t.name.includes('agent')],
  ['browser', (t) => t.name.includes('browser') || t.name.includes('playwright') || t.command.includes('playwright')],
  ['mcp', (t) => t.name.includes('mcp') || t.name.startsWith('list_mcp_') || t.command.includes('mcp__')],
  ['git', (t) => GIT_COMMAND_RE.test(t.command)],
  ['research', (t) => READ_COMMAND_RE.test(t.command)],
  ['verify', (t) => VERIFY_COMMAND_RE.test(t.command)],
  ['code', (t) => isCodeEdit(t)],
  ['shell', (t) => t.name.includes('exec') || t.name.includes('command')],
]

const COMMAND_FAMILIES: ReadonlyMap<string, string> = new Map([
  ['rg', 'rg'],
  ['grep', 'grep'],
  ['sed', 'file-read'],
  ['cat', 'file-read'],
  ['nl', 'file-read'],
  ['tail', 'file-read'],
  ['head', 'file-read'],
  ['ls', 'file-discovery'],
  ['find', 'file-discovery'],
])

const SUBCOMMAND_TOOLS = new Set(['bun', 'npm', 'pnpm', 'yarn', 'mvn', 'gradle', 'git'])

export function commandFromTool(tool: AnalyzableTool): string {
  const parsed = parseJson(tool.input)
  if (isRecord(parsed) && typeof parsed.cmd === 'string') return parsed.cmd
  return tool.label || tool.name
}

export function classifyTool(tool: AnalyzableTool): SkillInfo {
  const signature: ToolSignature = {
    name: tool.name.toLowerCase(),
    command: commandFromTool(tool).trim().toLowerCase(),
  }
  const match = CLASSIFICATION_RULES.find(([, matches]) => matches(signature))
  return SKILLS[match ? match[0] : 'other']
}

function isCodeEdit({ name, command }: ToolSignature): boolean {
  if (name.includes('apply_patch') || /\bapply_patch\b/.test(command)) return true
  return FILE_WRITE_PATTERNS.some((pattern) => pattern.test(command))
}

export function enrichTools(tools: CodexLocalTool[]): ToolWithSkill[] {
  return tools.map((tool) => ({ ...tool, skill: classifyTool(tool), preview: toolPreview(tool) }))
}

export function summarizeSkills(tools: CodexLocalTool[]): SkillSummary[] {
  const summaries = new Map<SkillKey, SkillSummary>()
  for (const tool of enrichTools(tools)) {
    const { key, label, intent } = tool.skill
    const summary = summaries.get(key) ?? { key, label, intent, count: 0, tools: [] }
    summary.count += 1
    summary.tools.push(tool)
    summaries.set(key, summary)
  }
  return [...summaries.values()].sort((a, b) => SKILL_ORDER.indexOf(a.key) - SKILL_ORDER.indexOf(b.key))
}

export function hasSkill(skills: SkillSummary[], key: SkillKey): boolean {
  return skills.some((s) => s.key === key)
}

export function repeatedTools(tools: CodexLocalTool[], minRuns = REPEATED_TOOL_MIN_RUNS): RepeatedTool[] {
  const counts = new Map<string, { count: number; skill: SkillInfo }>()
  for (const tool of tools) {
    const family = commandFamily(tool)
    const entry = counts.get(family) ?? { count: 0, skill: classifyTool(tool) }
    entry.count += 1
    counts.set(family, entry)
  }
  return [...counts.entries()]
    .filter(([, entry]) => entry.count >= minRuns)
    .map(([command, entry]) => ({ command, count: entry.count, skill: entry.skill }))
    .sort((a, b) => b.count - a.count)
}

export function toolPreview(tool: AnalyzableTool, ellipsis = '...'): string {
  return truncate(commandFromTool(tool), TOOL_PREVIEW_CHARS, ellipsis)
}

export function commandFamily(tool: AnalyzableTool): string {
  const parts = commandFromTool(tool).trim().split(/\s+/).filter(Boolean)
  const program = parts[0] ?? tool.name
  const family = COMMAND_FAMILIES.get(program)
  if (family) return family
  if (SUBCOMMAND_TOOLS.has(program)) return parts.slice(0, 2).join(' ')
  return tool.name
}
