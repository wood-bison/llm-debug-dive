import { compact, plural } from '../shared/collections'
import { fmtCost, fmtTokens } from '../shared/format'
import type { CodexLocalTool } from './codex'
import { isFailure, tokenLoad } from './metrics'
import { hasSkill, repeatedTools, summarizeSkills, type RepeatedTool, type SkillSummary } from './skills'
import type { TokenTotals } from './telemetry'
import {
  CACHE_HIT_PCT,
  CONTEXT_PEAK_TOKENS,
  MIN_FRESH_INPUT_FOR_CACHE_SIGNALS,
  SPAN_COUNT,
  TOKEN_LOAD,
  TOKENS_PER_TOOL_CALL_WARN,
  TRACE_COST_USD,
} from './thresholds'
import type { Tone } from './verdict'

export interface Insight {
  tone: Tone
  title: string
  body: string
}

export interface Signal {
  tone: Tone
  label: string
  body: string
}

const MAX_INSIGHTS = 5
const MAX_TIPS = 4

export interface TraceInsightInput {
  tokens: TokenTotals
  hit: number
  spanCount: number
  totalCost: number
  localTools: CodexLocalTool[]
  localNotes: number
  maxContextIn: number
}

export function traceInsights(args: TraceInsightInput): Insight[] {
  const skills = summarizeSkills(args.localTools)
  return compact([
    spendInsight(args),
    cacheInsight(args),
    toolInsight(args, skills),
    contextPeakInsight(args.maxContextIn),
    notesInsight(args.localNotes),
    verificationInsight(skills),
  ]).slice(0, MAX_INSIGHTS)
}

function spendInsight({ totalCost, tokens }: TraceInsightInput): Insight | null {
  if (totalCost > 0) {
    const tone = totalCost >= TRACE_COST_USD.expensive ? 'bad' : totalCost >= TRACE_COST_USD.notable ? 'warn' : 'good'
    return {
      tone,
      title: `${fmtCost(totalCost)} estimated spend`,
      body: tone === 'good'
        ? 'This trace looks cheap by known model pricing.'
        : 'Worth opening the call list below and checking the largest cost driver.',
    }
  }
  const load = tokenLoad(tokens)
  if (load === 0) return null
  return {
    tone: load >= TOKEN_LOAD.huge ? 'bad' : load >= TOKEN_LOAD.heavy ? 'warn' : 'neutral',
    title: `${fmtTokens(load)} total token load`,
    body: 'Price is unknown for this model here, so token load is the best cost proxy.',
  }
}

function cacheInsight({ tokens, hit }: TraceInsightInput): Insight | null {
  if (tokens.cacheRead > 0) {
    const reused = hit >= CACHE_HIT_PCT.good
    return {
      tone: reused ? 'good' : 'warn',
      title: `${hit}% cache hit`,
      body: reused
        ? `${fmtTokens(tokens.cacheRead)} input tokens were reused instead of sent fresh.`
        : 'Some context was reused, but most input was still fresh.',
    }
  }
  if (tokens.input > MIN_FRESH_INPUT_FOR_CACHE_SIGNALS) {
    return { tone: 'warn', title: 'No cache benefit', body: `${fmtTokens(tokens.input)} fresh input tokens went through without cache reads.` }
  }
  return null
}

function toolInsight({ tokens, localTools, spanCount }: TraceInsightInput, skills: SkillSummary[]): Insight {
  if (localTools.length > 0) {
    const tokensPerTool = Math.round(tokenLoad(tokens) / localTools.length)
    const topSkill = skills[0]
    return {
      tone: tokensPerTool > TOKENS_PER_TOOL_CALL_WARN ? 'warn' : 'neutral',
      title: `${localTools.length} tool ${plural(localTools.length, 'call')}`,
      body: `${fmtTokens(tokensPerTool)} tokens per tool call${topSkill ? `; dominant skill: ${topSkill.label}.` : '.'}`,
    }
  }
  const madeSeveralCalls = spanCount > 1
  return {
    tone: madeSeveralCalls ? 'warn' : 'neutral',
    title: 'No local tools detected',
    body: madeSeveralCalls
      ? 'Network calls happened, but no local Codex tools were found in the session transcript.'
      : 'This was mostly model reasoning from existing context, not an active tool workflow.',
  }
}

function contextPeakInsight(peak: number): Insight | null {
  if (peak >= CONTEXT_PEAK_TOKENS.veryLarge) {
    return { tone: 'bad', title: `${fmtTokens(peak)} context peak`, body: 'Very large context. This is where prompt trimming and smaller task scope matter most.' }
  }
  if (peak >= CONTEXT_PEAK_TOKENS.large) {
    return { tone: 'warn', title: `${fmtTokens(peak)} context peak`, body: 'Large enough to watch. Repeated broad file reads can make this climb quickly.' }
  }
  return null
}

function notesInsight(notes: number): Insight | null {
  if (notes === 0) return null
  return { tone: 'neutral', title: `${notes} progress notes`, body: 'The workflow strip below shows how the agent explained its steps while working.' }
}

function verificationInsight(skills: SkillSummary[]): Insight | null {
  if (hasSkill(skills, 'verify')) {
    return { tone: 'good', title: 'Check tools observed', body: 'Check tools appeared in the sequence; inspect their output to confirm the result.' }
  }
  if (hasSkill(skills, 'code')) {
    return { tone: 'warn', title: 'Edits without visible verification', body: 'Code-edit tools appeared, but no verification skill was detected in this turn.' }
  }
  return null
}

export interface CheaperRunInput {
  tokens: TokenTotals
  hit: number
  tools: CodexLocalTool[]
  spanCount: number
}

export function nextCheaperRunTips(args: CheaperRunInput): string[] {
  const load = tokenLoad(args.tokens)
  const skills = summarizeSkills(args.tools)
  const topRepeated = repeatedTools(args.tools)[0]
  const hasVerify = hasSkill(skills, 'verify')

  return compact([
    load >= TOKEN_LOAD.heavy &&
      `Narrow the prompt because this turn loaded ${fmtTokens(load)} tokens. Name the exact files, command, or subsystem before asking for analysis.`,
    args.hit < CACHE_HIT_PCT.cold && args.tokens.input > MIN_FRESH_INPUT_FOR_CACHE_SIGNALS &&
      `Cache was cold at ${args.hit}%. Keep related work in the same thread or avoid restarting with broad context.`,
    topRepeated &&
      `${topRepeated.command} ran ${topRepeated.count} times. That can mean broad search or repeated file reads; ask the agent to stop after the first implementation path.`,
    missingVerificationTip(skills, hasVerify),
    args.tools.length === 0 && load >= TOKEN_LOAD.costlyWithoutTools &&
      `No tools were used despite ${fmtTokens(load)} token load. If you expect code evidence, ask the agent to inspect named files before answering.`,
    args.spanCount >= SPAN_COUNT.many &&
      'Many captured calls: check whether retries, failed calls, or broad exploration created extra work.',
    hasSkill(skills, 'mcp') &&
      'MCP calls were useful for capability discovery; after setup, avoid repeating discovery unless tools changed.',
    concretePromptSuggestion(skills, load),
  ]).slice(0, MAX_TIPS)
}

function missingVerificationTip(skills: SkillSummary[], hasVerify: boolean): string | null {
  if (hasVerify) return null
  if (hasSkill(skills, 'code')) {
    return 'Code was changed without visible verification. Add the nearest check, for example typecheck/build for TS or browser QA for UI.'
  }
  if (hasSkill(skills, 'research')) {
    return 'Research happened without verification. Ask for one focused check after analysis so the run ends with evidence, not just reading.'
  }
  return null
}

function concretePromptSuggestion(skills: SkillSummary[], load: number): string {
  if (hasSkill(skills, 'code')) {
    return 'Ask for a closed loop: "Make the smallest patch, then run the nearest typecheck/test and report failures only."'
  }
  if (hasSkill(skills, 'mcp')) {
    return 'Instead of repeating discovery, ask: "Use the already discovered MCP list; only verify whether the needed server is connected."'
  }
  if (hasSkill(skills, 'browser')) {
    return 'Ask for a browser QA target: "Open this exact URL, check these 3 states, and report only failures with screenshots."'
  }
  if (hasSkill(skills, 'research')) {
    return 'Constrain research: "Search only these files/directories first; stop after the first matching implementation path."'
  }
  if (load > TOKEN_LOAD.costlyWithoutTools) {
    return 'Ask for evidence explicitly: "Inspect the exact files needed before answering; do not infer from broad context."'
  }
  return 'Keep this prompt shape; compare the next run against this trace before changing workflow.'
}

export interface SignalInput {
  repeated: RepeatedTool[]
  tools: CodexLocalTool[]
  tokens: TokenTotals
  totalCost: number
  hit: number
  lastStatus: number
}

export function replaySignals(args: SignalInput): Signal[] {
  const skills = summarizeSkills(args.tools)
  const hasVerify = hasSkill(skills, 'verify')
  const load = tokenLoad(args.tokens)
  const topRepeated = args.repeated[0]

  return compact<Signal>([
    args.totalCost > 0
      ? { tone: 'good', label: 'priced', body: `${fmtCost(args.totalCost)} estimated from model card.` }
      : { tone: 'neutral', label: 'unpriced', body: 'Model price is unknown; use token load.' },
    load >= TOKEN_LOAD.heavy && { tone: 'warn', label: 'context-heavy', body: `${fmtTokens(load)} token load.` },
    args.hit < CACHE_HIT_PCT.cold && args.tokens.input > MIN_FRESH_INPUT_FOR_CACHE_SIGNALS &&
      { tone: 'warn', label: 'cold cache', body: `${args.hit}% cache hit.` },
    topRepeated && { tone: 'warn', label: 'repeated work', body: `${topRepeated.command} ran ${topRepeated.count} times.` },
    hasSkill(skills, 'code') && !hasVerify && { tone: 'warn', label: 'missing verification', body: 'Code changed, no check detected.' },
    hasVerify && { tone: 'good', label: 'checks observed', body: 'Check tools were captured; inspect their output to confirm success.' },
    isFailure(args.lastStatus) && { tone: 'bad', label: 'failure', body: `Last status ${args.lastStatus}.` },
  ])
}
