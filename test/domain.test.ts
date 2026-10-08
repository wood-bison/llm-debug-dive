import { describe, expect, test } from 'bun:test'
import { cacheHitRate, cacheHitShare, freshInputTokens, tokenLoad, worstFailureOrOk, highestStatus, median } from '../src/domain/metrics'
import { costOf, spanCost } from '../src/domain/pricing'
import { buildPromptCoach, type PromptCoachInput } from '../src/domain/promptCoach'
import { classifyTool, repeatedTools } from '../src/domain/skills'
import { describeTurn } from '../src/domain/turnClassification'
import { parseTurnRequest } from '../src/infrastructure/providers/turnRequest'
import { buildVerdict } from '../src/domain/verdict'

const tool = (cmd: string, name = 'exec_command') => ({ name, label: cmd, input: JSON.stringify({ cmd }) })

describe('metrics', () => {
  test('cache hit rate uses normalized fresh and cached input counts', () => {
    expect(cacheHitRate(100, 50)).toBe(33)
    expect(cacheHitShare({ input: 100, cacheRead: 50 })).toBe(33)
    expect(cacheHitRate(10, 90)).toBe(90)
    expect(cacheHitShare({ input: 10, cacheRead: 90 })).toBe(90)
    expect(cacheHitRate(0, 0)).toBe(0)
    expect(freshInputTokens('openai', 150, 50)).toBe(100)
    expect(freshInputTokens('google', 150, 50)).toBe(100)
    expect(freshInputTokens('chatgpt', 150, 50)).toBe(100)
    expect(freshInputTokens('chatgpt', 150, 50, 20)).toBe(80)
    expect(freshInputTokens('anthropic', 100, 50)).toBe(100)
    expect(cacheHitShare({ input: 100, cacheRead: 50, cacheCreation: 50 })).toBe(25)
    expect(tokenLoad({ input: 100, output: 10, cacheRead: 20, cacheCreation: 5 })).toBe(135)
  })

  test('worstFailureOrOk defaults to 200, highestStatus to 0', () => {
    expect(worstFailureOrOk([{ status: 200 }, { status: 201 }])).toBe(200)
    expect(worstFailureOrOk([{ status: 200 }, { status: 502 }])).toBe(502)
    expect(highestStatus([])).toBe(0)
    expect(highestStatus([{ status: 201 }, { status: 200 }])).toBe(201)
  })

  test('median rounds even-sized samples', () => {
    expect(median([])).toBe(0)
    expect(median([3, 1, 2])).toBe(2)
    expect(median([1, 2])).toBe(2)
  })
})

describe('pricing', () => {
  test('anthropic input is fresh-only; openai input includes cache', () => {
    const tokens = { input: 100_000, output: 0, cacheRead: 100_000, cacheCreation: 0 }
    expect(costOf('claude-sonnet-4-6', tokens)).toBeCloseTo(0.3 + 0.03)
    expect(costOf('gpt-6.1-sol', tokens)).toBeCloseTo(0.01)
  })

  test('exact verified dated model ids are supported; unverified suffixes cost 0', () => {
    expect(costOf('claude-haiku-4-5-20251001', { input: 1_000_000, output: 0, cacheRead: 0, cacheCreation: 0 })).toBeCloseTo(1)
    expect(costOf('gpt-4o-mini-2024-07-18', { input: 1_000_000, output: 0, cacheRead: 0, cacheCreation: 0 })).toBe(0)
    expect(costOf('mystery', { input: 1_000_000, output: 1_000_000, cacheRead: 0, cacheCreation: 0 })).toBe(0)
    expect(costOf('constructor', { input: 1, output: 1, cacheRead: 0, cacheCreation: 0 })).toBe(0)
    expect(spanCost({ model: null, usage: { input: 5, output: 5, cacheRead: null, cacheCreation: null } })).toBe(0)
  })
})

describe('skills', () => {
  test('classifies shell commands into skills', () => {
    expect(classifyTool(tool('rg -n foo src')).key).toBe('research')
    expect(classifyTool(tool('perl -pi -e s/a/b/ x.ts')).key).toBe('code')
    expect(classifyTool(tool('bunx tsc --noEmit')).key).toBe('verify')
    expect(classifyTool(tool('git status')).key).toBe('git')
    expect(classifyTool({ name: 'mcp__playwright__browser_snapshot', label: '', input: null }).key).toBe('browser')
  })

  test('repeatedTools groups by command family', () => {
    const repeated = repeatedTools([tool('sed -n 1,5p a'), tool('cat b'), tool('rg x')])
    expect(repeated).toHaveLength(1)
    expect(repeated[0]).toMatchObject({ command: 'file-read', count: 2 })
  })
})

describe('verdict', () => {
  test('failed and expensive turns are bad; edits without checks warn', () => {
    const base = { tokens: { input: 1000, output: 100, cacheRead: 0 }, spanCount: 1, cost: 0, status: 200, tools: [] }
    expect(buildVerdict(base, null).tone).toBe('good')
    expect(buildVerdict({ ...base, status: 500 }, null).title).toBe('Failed work')
    expect(buildVerdict({ ...base, tokens: { ...base.tokens, input: 300_000 } }, null).title).toBe('Expensive turn')
    expect(buildVerdict({ ...base, tools: [tool('apply_patch x', 'apply_patch')] }, null)).toMatchObject({ tone: 'warn' })
  })
})

describe('prompt coach', () => {
  const input = (prompt: string, extra: Partial<PromptCoachInput> = {}): PromptCoachInput => ({
    prompt, tools: [], tokens: { input: 1000, output: 100, cacheRead: 0 },
    spanCount: 1, durationMs: 1000, costUsd: 0, cacheHit: 0, status: 200, ...extra,
  })

  test('a focused, bounded prompt keeps a perfect score', () => {
    const coach = buildPromptCoach(input('Read-only: inspect only src/app.ts. Return exactly: 1. flow 2. risks'))
    expect(coach.score).toBe(100)
    expect(coach.verdict).toBe('Efficient prompt')
  })

  test('rewrites preserve the task instead of inventing MCP and skill work', () => {
    const css = buildPromptCoach(input('Fix CSS overflow in web/src/features/dashboard/RunsTable.tsx. Return the verification result.')).rewrite
    const mcp = buildPromptCoach(input('Explain the existing MCP configuration in src/mcp/config.ts.')).rewrite

    expect(css).toContain('Goal: Fix CSS overflow in web/src/features/dashboard/RunsTable.tsx.')
    expect(css).toContain('web/src/features/dashboard/RunsTable.tsx')
    expect(css).not.toContain('MCP/skill wiring')
    expect(mcp).toContain('Goal: Explain the existing MCP configuration in src/mcp/config.ts.')
  })

  test('rules subtract penalties and the score never goes below 0', () => {
    const vague = buildPromptCoach(input('hi'))
    expect(vague.score).toBe(100 - 18 - 12 - 10)
    const awful = buildPromptCoach(input('audit fix test design explain commit', { status: 500, tokens: { input: 900_000, output: 0, cacheRead: 0 }, tools: Array(25).fill(tool('rg x')) }))
    expect(awful.score).toBe(0)
    expect(awful.issues.length).toBeLessThanOrEqual(8)
  })
})

describe('turn classification', () => {
  test('skips injected context and picks the real user text', () => {
    const body = JSON.stringify({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Fix the flaky test please' }, { type: 'text', text: '<system-reminder>x</system-reminder>' }] }],
    })
    expect(describeTurn(parseTurnRequest(body), false, null)).toEqual({ firstPrompt: 'Fix the flaky test please', isInternal: false, internalReason: null })
  })

  test('flags client noise as internal', () => {
    const title = JSON.stringify({ max_tokens: 32, system: 'Write a title', messages: [{ role: 'user', content: 'Fix the flaky test please' }] })
    expect(describeTurn(parseTurnRequest(title), false, null).internalReason).toBe('title generation')
    expect(describeTurn(parseTurnRequest(JSON.stringify({ events: [{ event_type: 'x' }] })), false, null).internalReason).toBe('codex telemetry')
    expect(describeTurn(null, false, null).internalReason).toBe('no user text')
  })

  test('Google contents requests retain user prompts for dashboard runs', () => {
    const request = parseTurnRequest(JSON.stringify({
      model: 'gemini-demo',
      contents: [{ role: 'user', parts: [{ text: 'Inspect the dashboard trace timeline.' }] }],
    }))

    expect(describeTurn(request, false, null)).toMatchObject({
      firstPrompt: 'Inspect the dashboard trace timeline.',
      isInternal: false,
      internalReason: null,
    })
  })
})
