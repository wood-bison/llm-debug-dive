import type { PromptFlags } from './types'

const EXACT_TARGET_RE = /(?:^|\s)(?:\.{0,2}\/|~\/|\/Users\/|[A-Za-z0-9_.-]+\/)[^\s`'")]+/
const OUTPUT_VERB_RE = /\b(return|answer|output|explain|summari[sz]e|give|show|list)\b/i
const STRUCTURED_OUTPUT_RE = /\b(return exactly|return:|bullets?|table|json|checklist|steps?|risks?|commands?|pass\/fail|evidence)\b|(?:^|\n)\s*1[.)]/i
const SCOPE_LIMIT_RE = /\b(only|do not|don't|no edit|without editing|inspect only|limit|scope|exact)\b/i
const VERIFICATION_RE = /\b(test|verify|check|build|run|screenshot|browser|playwright)\b/i
const TASK_VERB_RE = /\b(analy[sz]e|audit|fix|implement|refactor|test|verify|design|explain|compare|delete|commit|run|debug|research|write)\b/gi

const TARGET_PATTERNS: readonly RegExp[] = [
  /\/Users\/[^\s`'")]+/g,
  /(?:^|\s)(?:\.{1,2}\/)?[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+/g,
  /\b[A-Za-z0-9_.-]+\.(?:json|md|ts|js|tsx|jsx|toml|yaml|yml)\b/g,
  /\b[A-Za-z0-9_-]+(?:-[A-Za-z0-9_-]+){2,}\b/g,
  /https?:\/\/[^\s`'")]+/g,
]

const TOO_MANY_INTENTS = 4
const MIN_TARGET_CHARS = 4
const MAX_TARGETS = 8
const PLACEHOLDER_MARK = '<'

export function detectPromptFlags(prompt: string): PromptFlags {
  return {
    hasExactTarget: EXACT_TARGET_RE.test(prompt),
    hasOutputContract: OUTPUT_VERB_RE.test(prompt),
    hasStructuredOutput: STRUCTURED_OUTPUT_RE.test(prompt),
    hasScopeLimit: SCOPE_LIMIT_RE.test(prompt),
    hasVerificationIntent: VERIFICATION_RE.test(prompt),
    asksTooManyThings: countTaskVerbs(prompt) >= TOO_MANY_INTENTS,
  }
}

export function extractTargets(prompt: string): string[] {
  const found = new Set<string>()
  for (const pattern of TARGET_PATTERNS) {
    for (const match of prompt.matchAll(pattern)) {
      const value = match[0].trim()
      if (value.length >= MIN_TARGET_CHARS && !value.includes(PLACEHOLDER_MARK)) found.add(value)
    }
  }
  return [...found].slice(0, MAX_TARGETS)
}

function countTaskVerbs(prompt: string): number {
  const matches = prompt.match(TASK_VERB_RE) ?? []
  return new Set(matches.map((m) => m.toLowerCase())).size
}
