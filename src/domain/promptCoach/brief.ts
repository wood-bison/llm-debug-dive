import { commandFromTool, type RepeatedTool } from '../skills'
import type { PromptCoachInput, PromptCoachIssue } from './types'

const BRIEF_LIMITS = {
  promptChars: 1200,
  topTools: 8,
  toolCommandChars: 160,
  repeatedTools: 5,
} as const
const COST_DECIMALS = 4

export function buildOllamaBrief(
  input: PromptCoachInput,
  issues: PromptCoachIssue[],
  repeated: RepeatedTool[],
  rewrite: string,
  score: number,
  verdict: string,
): string {
  const topTools = input.tools.slice(0, BRIEF_LIMITS.topTools).map((tool) => commandFromTool(tool).slice(0, BRIEF_LIMITS.toolCommandChars)).join('\n')
  return [
    '/no_think',
    '',
    'You are reviewing one AI agent trace for developer productivity.',
    'Explain whether the original user prompt was efficient, where tokens/tools were wasted, and how to improve the next prompt or skill.',
    '',
    `Heuristic score: ${score}/100 (${verdict})`,
    `Tokens: fresh_input=${input.tokens.input}, cache_read=${input.tokens.cacheRead}, cache_write=${input.tokens.cacheCreation ?? 0}, output=${input.tokens.output}`,
    `Tool calls: ${input.tools.length}, spans=${input.spanCount}, duration_ms=${input.durationMs}, cost_usd=${input.costUsd.toFixed(COST_DECIMALS)}, cache_hit=${input.cacheHit}%`,
    `Prompt: ${input.prompt.slice(0, BRIEF_LIMITS.promptChars)}`,
    '',
    `Detected issues:\n${issues.map((i) => `- ${i.title}: ${i.body}`).join('\n')}`,
    repeated.length > 0 ? `\nRepeated tools:\n${repeated.slice(0, BRIEF_LIMITS.repeatedTools).map((r) => `- ${r.command}: ${r.count}`).join('\n')}` : '',
    topTools ? `\nTop tool commands:\n${topTools}` : '',
    `\nSuggested rewrite:\n${rewrite}`,
    '',
    'Answer in concise English. Maximum 8 bullets. Do not show chain-of-thought. Use production terms naturally: trace, span, scoring, evals, signals, monitors, agent.',
  ].join('\n')
}
