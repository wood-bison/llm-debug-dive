import { formatCompact } from '../../shared/format'
import { hasSkill, toolPreview } from '../skills'
import { isFailure } from '../metrics'
import { TOKEN_LOAD, TOOL_CALLS } from '../thresholds'
import type { CoachContext, CoachRule, RuleResult } from './types'

export const PENALTY = {
  missingTarget: 18,
  noBoundary: 12,
  looseOutputContract: 4,
  noOutputContract: 10,
  tooManyJobs: 16,
  extremeContext: 22,
  heavyContext: 14,
  toolHeavy: 14,
  costlyWithoutTools: 10,
  perRepeatedRun: 3,
  maxRepeatedWork: 16,
  editsWithoutVerification: 18,
  failedSpan: 24,
} as const

export const RULES: CoachRule[] = [
  scopeAnchorRule,
  scopeLimitRule,
  outputContractRule,
  multiIntentRule,
  tokenLoadRule,
  toolVolumeRule,
  repeatedWorkRule,
  verificationRule,
  failureRule,
]

function scopeAnchorRule({ flags, targets }: CoachContext): RuleResult | null {
  if (flags.hasExactTarget) {
    return {
      issue: {
        tone: 'good',
        title: 'Scope anchor present',
        body: targets.length > 0 ? `Found target: ${targets[0]}` : 'The prompt names a concrete project target.',
        source: 'prompt',
        evidence: targets.length > 0 ? `Detected ${targets.length} target${targets.length === 1 ? '' : 's'}: ${targets.slice(0, 3).join(', ')}` : 'The prompt contains a file/path-like target.',
        impact: 'The agent had a concrete starting point, so the run did not begin completely blind.',
        fix: 'Keep the target, then add inspect-only boundaries and the exact files to read first.',
      },
    }
  }
  return {
    penalty: PENALTY.missingTarget,
    issue: {
      tone: 'warn',
      title: 'Missing exact target',
      body: 'No clear file, URL, command, or subsystem was detected.',
      source: 'prompt',
      evidence: 'The prompt did not match a path, URL, config file, command, or named subsystem pattern.',
      impact: 'The agent has to discover where to start, which usually burns file-search spans.',
      fix: 'Name the repo path plus 1-3 target files, URLs, or commands before asking for analysis.',
    },
  }
}

function scopeLimitRule({ flags }: CoachContext): RuleResult | null {
  if (flags.hasScopeLimit) {
    return {
      issue: {
        tone: 'good',
        title: 'Scope limit present',
        body: 'A boundary such as only, exact, or do-not-touch was detected.',
        source: 'prompt',
        evidence: 'The prompt includes wording that limits the agent scope.',
        impact: 'This lowers the chance of broad repo exploration or unrelated edits.',
        fix: 'Make the boundary stricter when the task is diagnostic: read-only, exact targets, stop after evidence.',
      },
    }
  }
  return {
    penalty: PENALTY.noBoundary,
    issue: {
      tone: 'warn',
      title: 'No explicit boundary',
      body: 'No inspect-only, no-edit, or stop condition was detected.',
      source: 'prompt',
      evidence: 'The prompt does not say what the agent should avoid touching.',
      impact: 'The agent can expand from diagnosis into broad discovery, edits, or oversized verification.',
      fix: 'Add: “Read-only diagnosis. Inspect only these targets. Do not edit. Stop after the smallest evidence set.”',
    },
  }
}

function outputContractRule({ flags }: CoachContext): RuleResult | null {
  if (flags.hasStructuredOutput) {
    return {
      issue: {
        tone: 'good',
        title: 'Output contract present',
        body: 'The prompt asks for a structured answer shape.',
        source: 'prompt',
        evidence: 'Detected return/steps/bullets/table/checklist/evidence-style output instructions.',
        impact: 'A clear answer shape reduces wandering and makes the final result easier to evaluate.',
        fix: 'Keep using explicit sections: findings, evidence, cheapest fix, risks.',
      },
    }
  }
  if (flags.hasOutputContract) {
    return {
      penalty: PENALTY.looseOutputContract,
      issue: {
        tone: 'warn',
        title: 'Output contract is loose',
        body: 'The prompt asks for an answer, but not an exact shape.',
        source: 'prompt',
        evidence: 'Detected a broad verb like explain/show/list, but no strict format.',
        impact: 'The agent may answer correctly but spend extra tokens deciding the structure.',
        fix: 'Ask for exactly 4-5 sections, for example: current wiring, how to run, what to verify, risks.',
      },
    }
  }
  return {
    penalty: PENALTY.noOutputContract,
    issue: {
      tone: 'warn',
      title: 'Weak output contract',
      body: 'No answer format was detected.',
      source: 'prompt',
      evidence: 'The prompt does not specify steps, commands, risks, evidence, or pass/fail output.',
      impact: 'Without a finish line, the agent may over-explain or inspect more context than needed.',
      fix: 'Define the final shape before the task: “Return exactly: 1. finding 2. evidence 3. fix 4. risk.”',
    },
  }
}

function multiIntentRule({ flags }: CoachContext): RuleResult | null {
  if (!flags.asksTooManyThings) return null
  return {
    penalty: PENALTY.tooManyJobs,
    issue: {
      tone: 'bad',
      title: 'Too many jobs in one prompt',
      body: 'Several task verbs were detected in one turn.',
      source: 'workflow',
      evidence: 'The prompt mixes multiple intents such as audit, fix, test, design, explain, compare, delete, or commit.',
      impact: 'Multi-phase prompts increase context load and make scoring harder because the trace has several jobs inside one run.',
      fix: 'Split into turns: diagnosis first, then fix, then verification, then commit.',
    },
  }
}

function tokenLoadRule({ tokenLoad, input }: CoachContext): RuleResult | null {
  const breakdown = `fresh ${formatCompact(input.tokens.input)} + cache ${formatCompact(input.tokens.cacheRead)} + cache writes ${formatCompact(input.tokens.cacheCreation ?? 0)} + output ${formatCompact(input.tokens.output)} tokens.`
  if (tokenLoad >= TOKEN_LOAD.extreme) {
    return {
      penalty: PENALTY.extremeContext,
      issue: {
        tone: 'bad',
        title: 'Very heavy context',
        body: `${formatCompact(tokenLoad)} token load.`,
        source: 'tokens',
        evidence: breakdown,
        impact: 'This is useful for demo analysis, but too expensive as a default daily debugging pattern.',
        fix: 'Start with exact files and direct reads; only widen search if those files do not prove the answer.',
      },
    }
  }
  if (tokenLoad >= TOKEN_LOAD.coachHeavy) {
    return {
      penalty: PENALTY.heavyContext,
      issue: {
        tone: 'warn',
        title: 'Context-heavy',
        body: `${formatCompact(tokenLoad)} token load.`,
        source: 'tokens',
        evidence: breakdown,
        impact: 'The run is not extreme, but narrowing the first inspection pass would make it cheaper.',
        fix: 'Ask for a narrow diagnosis before requesting implementation.',
      },
    }
  }
  if (tokenLoad < TOKEN_LOAD.heavy) {
    return {
      issue: {
        tone: 'good',
        title: 'Light token load',
        body: `${formatCompact(tokenLoad)} token load.`,
        source: 'tokens',
        evidence: `Total token load stayed below 50k; cache hit was ${input.cacheHit}%.`,
        impact: 'This is healthy for a focused trace.',
        fix: 'Use this as a baseline for similar small diagnostic prompts.',
      },
    }
  }
  return null
}

function toolVolumeRule({ input, tokenLoad }: CoachContext): RuleResult | null {
  const tools = input.tools
  if (tools.length >= TOOL_CALLS.coachHeavy) {
    return {
      penalty: PENALTY.toolHeavy,
      issue: {
        tone: 'warn',
        title: 'Tool-heavy run',
        body: `${tools.length} tool calls across ${input.spanCount} spans.`,
        source: 'tools',
        evidence: `Captured ${tools.length} local tool calls; top command preview: ${tools[0] ? toolPreview(tools[0], '') : 'none'}.`,
        impact: 'Tool use can be good evidence, but high counts should be justified by task complexity.',
        fix: 'For diagnostic prompts, provide a search recipe and a stop rule to avoid extra discovery loops.',
      },
    }
  }
  if (tools.length > 0) {
    return {
      issue: {
        tone: 'good',
        title: 'Tool evidence captured',
        body: `${tools.length} tool calls give evidence for the answer.`,
        source: 'tools',
        evidence: `The trace includes local tool spans rather than only model reasoning.`,
        impact: 'This makes the answer easier to trust and audit.',
        fix: 'Keep tools targeted: direct file reads first, narrow searches second.',
      },
    }
  }
  if (tokenLoad > TOKEN_LOAD.costlyWithoutTools) {
    return {
      penalty: PENALTY.costlyWithoutTools,
      issue: {
        tone: 'warn',
        title: 'No tools for a costly answer',
        body: 'No local tool evidence was captured.',
        source: 'tools',
        evidence: `${formatCompact(tokenLoad)} tokens moved, but tool count is zero.`,
        impact: 'A costly answer without local tools usually means reasoning from existing context, not fresh evidence.',
        fix: 'If you expect code evidence, ask the agent to inspect the exact files and report the proof.',
      },
    }
  }
  return null
}

function repeatedWorkRule({ repeated }: CoachContext): RuleResult | null {
  const [top] = repeated
  if (!top) return null
  return {
    penalty: Math.min(PENALTY.maxRepeatedWork, top.count * PENALTY.perRepeatedRun),
    issue: {
      tone: 'warn',
      title: 'Repeated work signal',
      body: `${top.command} ran ${top.count} times.`,
      source: 'tools',
      evidence: repeated.slice(0, 3).map((r) => `${r.command} x${r.count}`).join(' · '),
      impact: 'Repeated discovery is the clearest signal that the prompt or skill did not converge quickly.',
      fix: 'Pre-bake direct paths into the skill, or put the exact search recipe in the next prompt.',
    },
  }
}

function verificationRule({ skills, flags }: CoachContext): RuleResult | null {
  const hasVerifyTool = hasSkill(skills, 'verify') || hasSkill(skills, 'browser')
  const hasCodeTool = hasSkill(skills, 'code')
  if (hasCodeTool && !hasVerifyTool) {
    return {
      penalty: PENALTY.editsWithoutVerification,
      issue: {
        tone: 'bad',
        title: 'Edits without verification',
        body: 'Code edits were detected without a matching check.',
        source: 'verification',
        evidence: 'The trace contains code-edit tools, but no test/build/browser verification skill was detected.',
        impact: 'This lowers confidence because the trace cannot prove the change works.',
        fix: 'Ask for the smallest relevant verification after edits and require the result in the final answer.',
      },
    }
  }
  if (flags.hasVerificationIntent || hasVerifyTool) {
    return {
      issue: {
        tone: 'good',
        title: 'Verification mindset',
        body: hasVerifyTool ? 'The trace includes checks or browser QA.' : 'The prompt asks for verification.',
        source: 'verification',
        evidence: hasVerifyTool ? 'Detected check/browser-style tool usage in the trace.' : 'Prompt wording includes test, verify, check, build, browser, or Playwright.',
        impact: 'Verification gives the run a pass/fail signal instead of only an explanation.',
        fix: 'Keep verification small and explicit: one command, one browser check, or one screenshot target.',
      },
    }
  }
  return null
}

function failureRule({ input }: CoachContext): RuleResult | null {
  if (!isFailure(input.status)) return null
  return {
    penalty: PENALTY.failedSpan,
    issue: {
      tone: 'bad',
      title: 'Failed span captured',
      body: `HTTP/status ${input.status} appeared in the trace.`,
      source: 'failure',
      evidence: `Highest captured status was ${input.status}.`,
      impact: 'Failure spans can distort cost and tool analysis because the agent may retry or fall back.',
      fix: 'Fix the transport/auth/runtime failure before optimizing prompt wording.',
    },
  }
}
