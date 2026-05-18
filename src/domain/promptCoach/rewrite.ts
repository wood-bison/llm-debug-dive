import type { CodexLocalTool } from '../codex'
import { commandFromTool, type RepeatedTool } from '../skills'
import { extractTargets } from './promptSignals'
import type { PromptCoachInput, PromptFlags } from './types'

const DISCOVERY_FAMILIES = new Set(['file-discovery', 'rg', 'grep'])
const DIRECT_READ_TARGET_RE = /\.mcp\.json|SKILL\.md|settings\.local\.json/
const FILE_READ_COMMAND_RE = /sed|cat|nl|head/
const MAX_HINT_CHARS = 180
const MAX_HINTS = 4

export function rewritePrompt(input: PromptCoachInput, flags: PromptFlags & { repeated: RepeatedTool[] }): string {
  const prompt = input.prompt.trim()
  const targets = extractTargets(prompt)
  const toolHints = extractToolHints(input.tools)
  const repeatedDiscovery = flags.repeated.some((r) => DISCOVERY_FAMILIES.has(r.command))
  const lines = [
    `Goal: ${prompt || 'Complete the requested task.'}`,
    'Preserve the original goal and every constraint in the request.',
    flags.hasScopeLimit
      ? `Respect the original scope limits${targets.length > 0 ? ` and start with these targets:\n${targets.map((target) => `- ${target}`).join('\n')}` : '.'}`
      : 'Identify the smallest scope that can complete the requested goal.',
    'Boundaries:',
    repeatedDiscovery
      ? '- Reuse existing discovery and avoid repeating broad searches unless new evidence requires them.'
      : '- Expand discovery only when evidence shows it is needed.',
    '- Stop after the smallest evidence set that proves the answer.',
    toolHints.length > 0
      ? `Relevant observed reads:\n${toolHints.map((hint) => `- ${hint}`).join('\n')}`
      : '',
    flags.hasVerificationIntent
      ? 'Verification: run the smallest relevant requested check and report its actual result.'
      : 'Choose the smallest relevant check for any change and report its actual result; do not claim unrun checks.',
    'Return exactly:',
    '1. result or finding',
    '2. relevant evidence',
    '3. verification result',
    '4. remaining risks or missing information',
  ].filter(Boolean)

  return lines.join('\n')
}

function extractToolHints(tools: CodexLocalTool[]): string[] {
  const hints = new Set<string>()
  for (const tool of tools) {
    const cmd = commandFromTool(tool)
    if (FILE_READ_COMMAND_RE.test(cmd) && DIRECT_READ_TARGET_RE.test(cmd)) {
      hints.add(`read directly: ${cmd.slice(0, MAX_HINT_CHARS)}`)
    }
  }
  return [...hints].slice(0, MAX_HINTS)
}
