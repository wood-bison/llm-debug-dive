import {
  commandFromTool,
  repeatedTools,
  summarizeSkills,
  type RepeatedTool,
} from './analysis'
import type { CodexLocalTool } from './codexSession'

export interface PromptCoachInput {
  prompt: string
  assistant: string | null
  tools: CodexLocalTool[]
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  spanCount: number
  durationMs: number
  costUsd: number
  cacheHit: number
  status: number
}

export interface PromptCoachIssue {
  tone: 'good' | 'warn' | 'bad' | 'neutral'
  title: string
  body: string
  source?: 'prompt' | 'tokens' | 'tools' | 'verification' | 'failure' | 'workflow'
  evidence?: string
  impact?: string
  fix?: string
}

export interface PromptCoachResult {
  score: number
  verdict: string
  summary: string
  issues: PromptCoachIssue[]
  rewrite: string
  ollamaBrief: string
}

const EXACT_FILE_RE = /(?:^|\s)(?:\.{0,2}\/|~\/|\/Users\/|[A-Za-z0-9_.-]+\/)[^\s`'")]+/

export function buildPromptCoach(input: PromptCoachInput): PromptCoachResult {
  const tokenLoad = input.inputTokens + input.outputTokens + input.cacheReadTokens
  const prompt = input.prompt.trim()
  const tools = input.tools
  const skills = summarizeSkills(tools)
  const repeated = repeatedTools(tools)
  const targets = extractTargets(prompt)
  const issues: PromptCoachIssue[] = []
  let score = 100

  const hasExactTarget = EXACT_FILE_RE.test(prompt)
  const hasOutputContract = /\b(return|answer|output|explain|summari[sz]e|give|show|list)\b/i.test(prompt)
  const hasStructuredOutput = /\b(return exactly|return:|bullets?|table|json|checklist|steps?|risks?|commands?|pass\/fail|evidence)\b|(?:^|\n)\s*1[.)]/i.test(prompt)
  const hasScopeLimit = /\b(only|do not|don't|no edit|without editing|inspect only|limit|scope|exact)\b/i.test(prompt)
  const hasVerificationIntent = /\b(test|verify|check|build|run|screenshot|browser|playwright)\b/i.test(prompt)
  const asksTooManyThings = countPromptIntents(prompt) >= 4

  if (hasExactTarget) {
    issues.push({
      tone: 'good',
      title: 'Scope anchor present',
      body: targets.length > 0 ? `Found target: ${targets[0]}` : 'The prompt names a concrete project target.',
      source: 'prompt',
      evidence: targets.length > 0 ? `Detected ${targets.length} target${targets.length === 1 ? '' : 's'}: ${targets.slice(0, 3).join(', ')}` : 'The prompt contains a file/path-like target.',
      impact: 'The agent had a concrete starting point, so the run did not begin completely blind.',
      fix: 'Keep the target, then add inspect-only boundaries and the exact files to read first.',
    })
  } else {
    score -= 18
    issues.push({
      tone: 'warn',
      title: 'Missing exact target',
      body: 'No clear file, URL, command, or subsystem was detected.',
      source: 'prompt',
      evidence: 'The prompt did not match a path, URL, config file, command, or named subsystem pattern.',
      impact: 'The agent has to discover where to start, which usually burns file-search spans.',
      fix: 'Name the repo path plus 1-3 target files, URLs, or commands before asking for analysis.',
    })
  }

  if (hasScopeLimit) {
    issues.push({
      tone: 'good',
      title: 'Scope limit present',
      body: 'A boundary such as only, exact, or do-not-touch was detected.',
      source: 'prompt',
      evidence: 'The prompt includes wording that limits the agent scope.',
      impact: 'This lowers the chance of broad repo exploration or unrelated edits.',
      fix: 'Make the boundary stricter when the task is diagnostic: read-only, exact targets, stop after evidence.',
    })
  } else {
    score -= 12
    issues.push({
      tone: 'warn',
      title: 'No explicit boundary',
      body: 'No inspect-only, no-edit, or stop condition was detected.',
      source: 'prompt',
      evidence: 'The prompt does not say what the agent should avoid touching.',
      impact: 'The agent can expand from diagnosis into broad discovery, edits, or oversized verification.',
      fix: 'Add: “Read-only diagnosis. Inspect only these targets. Do not edit. Stop after the smallest evidence set.”',
    })
  }

  if (hasStructuredOutput) {
    issues.push({
      tone: 'good',
      title: 'Output contract present',
      body: 'The prompt asks for a structured answer shape.',
      source: 'prompt',
      evidence: 'Detected return/steps/bullets/table/checklist/evidence-style output instructions.',
      impact: 'A clear answer shape reduces wandering and makes the final result easier to evaluate.',
      fix: 'Keep using explicit sections: findings, evidence, cheapest fix, risks.',
    })
  } else if (hasOutputContract) {
    score -= 4
    issues.push({
      tone: 'warn',
      title: 'Output contract is loose',
      body: 'The prompt asks for an answer, but not an exact shape.',
      source: 'prompt',
      evidence: 'Detected a broad verb like explain/show/list, but no strict format.',
      impact: 'The agent may answer correctly but spend extra tokens deciding the structure.',
      fix: 'Ask for exactly 4-5 sections, for example: current wiring, how to run, what to verify, risks.',
    })
  } else {
    score -= 10
    issues.push({
      tone: 'warn',
      title: 'Weak output contract',
      body: 'No answer format was detected.',
      source: 'prompt',
      evidence: 'The prompt does not specify steps, commands, risks, evidence, or pass/fail output.',
      impact: 'Without a finish line, the agent may over-explain or inspect more context than needed.',
      fix: 'Define the final shape before the task: “Return exactly: 1. finding 2. evidence 3. fix 4. risk.”',
    })
  }

  if (asksTooManyThings) {
    score -= 16
    issues.push({
      tone: 'bad',
      title: 'Too many jobs in one prompt',
      body: 'Several task verbs were detected in one turn.',
      source: 'workflow',
      evidence: 'The prompt mixes multiple intents such as audit, fix, test, design, explain, compare, delete, or commit.',
      impact: 'Multi-phase prompts increase context load and make scoring harder because the trace has several jobs inside one run.',
      fix: 'Split into turns: diagnosis first, then fix, then verification, then commit.',
    })
  }

  if (tokenLoad >= 500_000) {
    score -= 22
    issues.push({
      tone: 'bad',
      title: 'Very heavy context',
      body: `${formatCompact(tokenLoad)} token load.`,
      source: 'tokens',
      evidence: `fresh ${formatCompact(input.inputTokens)} + cache ${formatCompact(input.cacheReadTokens)} + output ${formatCompact(input.outputTokens)} tokens.`,
      impact: 'This is useful for demo analysis, but too expensive as a default daily debugging pattern.',
      fix: 'Start with exact files and direct reads; only widen search if those files do not prove the answer.',
    })
  } else if (tokenLoad >= 150_000) {
    score -= 14
    issues.push({
      tone: 'warn',
      title: 'Context-heavy',
      body: `${formatCompact(tokenLoad)} token load.`,
      source: 'tokens',
      evidence: `fresh ${formatCompact(input.inputTokens)} + cache ${formatCompact(input.cacheReadTokens)} + output ${formatCompact(input.outputTokens)} tokens.`,
      impact: 'The run is not extreme, but narrowing the first inspection pass would make it cheaper.',
      fix: 'Ask for a narrow diagnosis before requesting implementation.',
    })
  } else if (tokenLoad < 50_000) {
    issues.push({
      tone: 'good',
      title: 'Light token load',
      body: `${formatCompact(tokenLoad)} token load.`,
      source: 'tokens',
      evidence: `Total token load stayed below 50k; cache hit was ${input.cacheHit}%.`,
      impact: 'This is healthy for a focused trace.',
      fix: 'Use this as a baseline for similar small diagnostic prompts.',
    })
  }

  if (tools.length >= 20) {
    score -= 14
    issues.push({
      tone: 'warn',
      title: 'Tool-heavy run',
      body: `${tools.length} tool calls across ${input.spanCount} spans.`,
      source: 'tools',
      evidence: `Captured ${tools.length} local tool calls; top command preview: ${tools[0] ? commandFromTool(tools[0]).slice(0, 110) : 'none'}.`,
      impact: 'Tool use can be good evidence, but high counts should be justified by task complexity.',
      fix: 'For diagnostic prompts, provide a search recipe and a stop rule to avoid extra discovery loops.',
    })
  } else if (tools.length > 0) {
    issues.push({
      tone: 'good',
      title: 'Tool evidence captured',
      body: `${tools.length} tool calls give evidence for the answer.`,
      source: 'tools',
      evidence: `The trace includes local tool spans rather than only model reasoning.`,
      impact: 'This makes the answer easier to trust and audit.',
      fix: 'Keep tools targeted: direct file reads first, narrow searches second.',
    })
  } else if (tokenLoad > 30_000) {
    score -= 10
    issues.push({
      tone: 'warn',
      title: 'No tools for a costly answer',
      body: 'No local tool evidence was captured.',
      source: 'tools',
      evidence: `${formatCompact(tokenLoad)} tokens moved, but tool count is zero.`,
      impact: 'A costly answer without local tools usually means reasoning from existing context, not fresh evidence.',
      fix: 'If you expect code evidence, ask the agent to inspect the exact files and report the proof.',
    })
  }

  if (repeated.length > 0) {
    const top = repeated[0]
    score -= Math.min(16, top.count * 3)
    issues.push({
      tone: 'warn',
      title: 'Repeated work signal',
      body: `${top.command} ran ${top.count} times.`,
      source: 'tools',
      evidence: repeated.slice(0, 3).map((r) => `${r.command} x${r.count}`).join(' · '),
      impact: 'Repeated discovery is the clearest signal that the prompt or skill did not converge quickly.',
      fix: 'Pre-bake direct paths into the skill, or put the exact search recipe in the next prompt.',
    })
  }

  const hasVerifyTool = skills.some((s) => s.key === 'verify' || s.key === 'browser')
  const hasCodeTool = skills.some((s) => s.key === 'code')
  if (hasCodeTool && !hasVerifyTool) {
    score -= 18
    issues.push({
      tone: 'bad',
      title: 'Edits without verification',
      body: 'Code edits were detected without a matching check.',
      source: 'verification',
      evidence: 'The trace contains code-edit tools, but no test/build/browser verification skill was detected.',
      impact: 'This lowers confidence because the trace cannot prove the change works.',
      fix: 'Ask for the smallest relevant verification after edits and require the result in the final answer.',
    })
  } else if (hasVerificationIntent || hasVerifyTool) {
    issues.push({
      tone: 'good',
      title: 'Verification mindset',
      body: hasVerifyTool ? 'The trace includes checks or browser QA.' : 'The prompt asks for verification.',
      source: 'verification',
      evidence: hasVerifyTool ? 'Detected check/browser-style tool usage in the trace.' : 'Prompt wording includes test, verify, check, build, browser, or Playwright.',
      impact: 'Verification gives the run a pass/fail signal instead of only an explanation.',
      fix: 'Keep verification small and explicit: one command, one browser check, or one screenshot target.',
    })
  }

  if (input.status >= 400) {
    score -= 24
    issues.push({
      tone: 'bad',
      title: 'Failed span captured',
      body: `HTTP/status ${input.status} appeared in the trace.`,
      source: 'failure',
      evidence: `Highest captured status was ${input.status}.`,
      impact: 'Failure spans can distort cost and tool analysis because the agent may retry or fall back.',
      fix: 'Fix the transport/auth/runtime failure before optimizing prompt wording.',
    })
  }

  score = Math.max(0, Math.min(100, Math.round(score)))
  const verdict = score >= 82 ? 'Efficient prompt' : score >= 62 ? 'Usable but tune it' : score >= 40 ? 'Expensive or underspecified' : 'Needs rewrite'
  const summary = buildSummary(score, tokenLoad, tools.length, repeated)
  const rewrite = rewritePrompt(input, { hasExactTarget, hasScopeLimit, hasOutputContract, hasVerificationIntent, repeated })
  const ollamaBrief = buildOllamaBrief(input, issues, repeated, rewrite, score, verdict)

  return { score, verdict, summary, issues: issues.slice(0, 8), rewrite, ollamaBrief }
}

function buildSummary(score: number, tokenLoad: number, tools: number, repeated: RepeatedTool[]): string {
  const parts = [`heuristic score ${score}/100`, `${formatCompact(tokenLoad)} token load`, `${tools} tool calls`]
  if (repeated.length > 0) parts.push(`repeated ${repeated[0].command}`)
  return parts.join(' · ')
}

function rewritePrompt(input: PromptCoachInput, flags: {
  hasExactTarget: boolean
  hasScopeLimit: boolean
  hasOutputContract: boolean
  hasVerificationIntent: boolean
  repeated: RepeatedTool[]
}): string {
  const prompt = input.prompt.trim()
  const targets = extractTargets(prompt)
  const toolHints = extractToolHints(input.tools)
  const repeatedDiscovery = flags.repeated.some((r) => ['file-discovery', 'rg', 'grep'].includes(r.command))
  const lines = [
    'Goal: explain the exact run path and verification steps for the existing MCP/skill wiring.',
    targets.length > 0
      ? `Inspect only these targets:\n${targets.map((target) => `- ${target}`).join('\n')}`
      : 'Inspect only these targets:\n- <exact repo path>\n- <exact config or skill file>',
    'Boundaries:',
    '- Read-only diagnosis. Do not edit files.',
    repeatedDiscovery
      ? '- Do not do broad repository discovery; avoid find/ls loops unless a listed target is missing.'
      : '- Avoid broad repository discovery unless a listed target is missing.',
    '- Stop after the smallest evidence set that proves the answer.',
    'Use this search recipe:',
    toolHints.length > 0
      ? toolHints.map((hint) => `- ${hint}`).join('\n')
      : '- open the named config/skill files directly\n- run one narrow search only if the direct files are missing',
    flags.hasVerificationIntent
      ? 'Verification: run the smallest relevant command/check and report exactly what should appear.'
      : 'Verification: suggest the smallest command/check; do not run broad test suites.',
    'Return exactly:',
    '1. current wiring',
    '2. how to run it',
    '3. what to check in the client UI',
    '4. cheapest next fix if it is not visible',
    '5. risks or missing setup',
  ]

  return lines.join('\n')
}

function extractTargets(prompt: string): string[] {
  const found = new Set<string>()
  const patterns = [
    /\/Users\/[^\s`'")]+/g,
    /(?:^|\s)(?:\.{1,2}\/)?[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+/g,
    /\b[A-Za-z0-9_.-]+\.(?:json|md|ts|js|tsx|jsx|toml|yaml|yml)\b/g,
    /\b[A-Za-z0-9_-]+(?:-[A-Za-z0-9_-]+){2,}\b/g,
    /https?:\/\/[^\s`'")]+/g,
  ]
  for (const pattern of patterns) {
    for (const match of prompt.matchAll(pattern)) {
      const value = match[0].trim()
      if (value.length >= 4 && !value.includes('<')) found.add(value)
    }
  }
  return [...found].slice(0, 8)
}

function extractToolHints(tools: CodexLocalTool[]): string[] {
  const hints = new Set<string>()
  for (const tool of tools) {
    const cmd = commandFromTool(tool)
    if (/sed|cat|nl|head/.test(cmd) && /\.mcp\.json|SKILL\.md|settings\.local\.json/.test(cmd)) {
      hints.add(`read directly: ${cmd.slice(0, 180)}`)
    }
  }
  return [...hints].slice(0, 4)
}

function buildOllamaBrief(
  input: PromptCoachInput,
  issues: PromptCoachIssue[],
  repeated: RepeatedTool[],
  rewrite: string,
  score: number,
  verdict: string,
): string {
  const topTools = input.tools.slice(0, 8).map((tool) => commandFromTool(tool).slice(0, 160)).join('\n')
  return [
    '/no_think',
    '',
    'You are reviewing one AI agent trace for developer productivity.',
    'Explain whether the original user prompt was efficient, where tokens/tools were wasted, and how to improve the next prompt or skill.',
    '',
    `Heuristic score: ${score}/100 (${verdict})`,
    `Tokens: fresh_input=${input.inputTokens}, cache_read=${input.cacheReadTokens}, output=${input.outputTokens}`,
    `Tool calls: ${input.tools.length}, spans=${input.spanCount}, duration_ms=${input.durationMs}, cost_usd=${input.costUsd.toFixed(4)}, cache_hit=${input.cacheHit}%`,
    `Prompt: ${input.prompt.slice(0, 1200)}`,
    '',
    `Detected issues:\n${issues.map((i) => `- ${i.title}: ${i.body}`).join('\n')}`,
    repeated.length > 0 ? `\nRepeated tools:\n${repeated.slice(0, 5).map((r) => `- ${r.command}: ${r.count}`).join('\n')}` : '',
    topTools ? `\nTop tool commands:\n${topTools}` : '',
    `\nSuggested rewrite:\n${rewrite}`,
    '',
    'Answer in concise English. Maximum 8 bullets. Do not show chain-of-thought. Use production terms naturally: trace, span, scoring, evals, signals, monitors, agent.',
  ].join('\n')
}

function countPromptIntents(prompt: string): number {
  const matches = prompt.match(/\b(analy[sz]e|audit|fix|implement|refactor|test|verify|design|explain|compare|delete|commit|run|debug|research|write)\b/gi)
  return new Set(matches?.map((m) => m.toLowerCase()) ?? []).size
}

function formatCompact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(Math.round(value))
}
