import type { CodexLocalTool } from '../codex'
import type { RepeatedTool, SkillSummary } from '../skills'
import type { TokenTotals } from '../telemetry'
import type { Tone } from '../verdict'

export interface PromptCoachInput {
  prompt: string
  tools: CodexLocalTool[]
  tokens: Pick<TokenTotals, 'input' | 'output' | 'cacheRead'> & Partial<Pick<TokenTotals, 'cacheCreation'>>
  spanCount: number
  durationMs: number
  costUsd: number
  cacheHit: number
  status: number
}

export type IssueSource = 'prompt' | 'tokens' | 'tools' | 'verification' | 'failure' | 'workflow'

export interface PromptCoachIssue {
  tone: Tone
  title: string
  body: string
  source?: IssueSource
  evidence?: string
  impact?: string
  fix?: string
  penalty: number
}

export interface PromptCoachResult {
  score: number
  verdict: string
  summary: string
  issues: PromptCoachIssue[]
  rewrite: string
  ollamaBrief: string
}

export interface PromptFlags {
  hasExactTarget: boolean
  hasOutputContract: boolean
  hasStructuredOutput: boolean
  hasScopeLimit: boolean
  hasVerificationIntent: boolean
  asksTooManyThings: boolean
}

export interface CoachContext {
  input: PromptCoachInput
  prompt: string
  tokenLoad: number
  targets: string[]
  skills: SkillSummary[]
  repeated: RepeatedTool[]
  flags: PromptFlags
}

export interface RuleResult {
  issue: Omit<PromptCoachIssue, 'penalty'>
  penalty?: number
}

export type CoachRule = (ctx: CoachContext) => RuleResult | null
