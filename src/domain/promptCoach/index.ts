import { formatCompact } from '../../shared/format'
import { byThreshold, type ThresholdScale } from '../../shared/thresholdScale'
import { tokenLoad } from '../metrics'
import { repeatedTools, summarizeSkills, type RepeatedTool } from '../skills'
import { buildOllamaBrief } from './brief'
import { detectPromptFlags, extractTargets } from './promptSignals'
import { rewritePrompt } from './rewrite'
import { RULES } from './rules'
import type { CoachContext, PromptCoachInput, PromptCoachIssue, PromptCoachResult } from './types'

export type { PromptCoachInput, PromptCoachIssue, PromptCoachResult } from './types'

const MAX_SCORE = 100
const MIN_SCORE = 0
const MAX_ISSUES = 8

export type ScoreGrade = 'good' | 'warn' | 'bad' | 'critical'

interface ScoreBand { grade: ScoreGrade; verdict: string }

export const COACH_MAX_SCORE = 100

export function scoreBands(): Array<{ min: number } & ScoreBand> {
  return [...SCORE_BANDS.map(([min, band]) => ({ min, ...band })), { min: MIN_SCORE, ...LOWEST_BAND }]
}

const SCORE_BANDS: ThresholdScale<ScoreBand> = [
  [82, { grade: 'good', verdict: 'Efficient prompt' }],
  [62, { grade: 'warn', verdict: 'Usable but tune it' }],
  [40, { grade: 'bad', verdict: 'Expensive or underspecified' }],
]
const LOWEST_BAND: ScoreBand = { grade: 'critical', verdict: 'Needs rewrite' }

export function scoreBand(score: number): ScoreBand {
  return byThreshold(score, SCORE_BANDS, LOWEST_BAND)
}

export function buildPromptCoach(input: PromptCoachInput): PromptCoachResult {
  const prompt = input.prompt.trim()
  const ctx: CoachContext = {
    input,
    prompt,
    tokenLoad: tokenLoad(input.tokens),
    targets: extractTargets(prompt),
    skills: summarizeSkills(input.tools),
    repeated: repeatedTools(input.tools),
    flags: detectPromptFlags(prompt),
  }

  const issues: PromptCoachIssue[] = []
  let score = MAX_SCORE
  for (const rule of RULES) {
    const result = rule(ctx)
    if (!result) continue
    score -= result.penalty ?? 0
    issues.push({ ...result.issue, penalty: result.penalty ?? 0 })
  }

  score = Math.max(MIN_SCORE, Math.min(MAX_SCORE, Math.round(score)))
  const { verdict } = scoreBand(score)
  const summary = buildSummary(score, ctx.tokenLoad, input.tools.length, ctx.repeated)
  const rewrite = rewritePrompt(input, { ...ctx.flags, repeated: ctx.repeated })
  const ollamaBrief = buildOllamaBrief(input, issues, ctx.repeated, rewrite, score, verdict)

  return { score, verdict, summary, issues: issues.slice(0, MAX_ISSUES), rewrite, ollamaBrief }
}

function buildSummary(score: number, tokenLoad: number, tools: number, repeated: RepeatedTool[]): string {
  const parts = [`heuristic score ${score}/100`, `${formatCompact(tokenLoad)} token load`, `${tools} tool calls`]
  const [mostRepeated] = repeated
  if (mostRepeated) parts.push(`repeated ${mostRepeated.command}`)
  return parts.join(' · ')
}
