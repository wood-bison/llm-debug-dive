import { describe, expect, test } from 'bun:test'
import { createProviderRegistry } from '../src/infrastructure/providers/registry'

const providers = createProviderRegistry()
const sse = (events: unknown[]) => events.map((e) => `data: ${JSON.stringify(e)}\n`).join('\n')

describe('provider registry', () => {
  test('specific protocols win over the OpenAI catch-all', () => {
    expect(providers.route('/v1/messages').provider).toBe('anthropic')
    expect(providers.route('/v1/chat/completions').provider).toBe('openai')
    expect(providers.route('/backend-api/codex/x')).toEqual({ provider: 'chatgpt', base: 'https://chatgpt.com', upstreamPath: '/backend-api/codex/x' })
    expect(providers.route('/google/v1beta/models/x')).toMatchObject({ provider: 'google', upstreamPath: '/v1beta/models/x' })
    expect(providers.route('/unknown').provider).toBe('openai')
    expect(providers.get('nope').name).toBe('openai')
  })
})

describe('anthropic', () => {
  const anthropic = providers.get('anthropic')
  const stream = sse([
    { type: 'message_start', message: { usage: { input_tokens: 10, cache_read_input_tokens: 90, output_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't1', name: 'Skill', input: {} } },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"command":' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '"review"}' } },
    { type: 'message_delta', usage: { output_tokens: 42 } },
  ])

  test('streamed usage keeps the latest value per field', () => {
    expect(anthropic.usageStream(stream)).toEqual({ input: 10, output: 42, cacheRead: 90, cacheCreation: null })
  })

  test('streamed tool_use input is reassembled; Skill calls record the skill name', () => {
    expect(anthropic.toolInvocations(stream, true)).toEqual([
      { toolName: 'Skill', inputPreview: '{"command":"review"}', skillName: 'review' },
    ])
  })

  test('trace id falls back to the billing header session', () => {
    const headers = new Headers({ 'x-anthropic-billing-header': 'cch=abc123;' })
    expect(anthropic.traceExternalId(headers, '{"messages":[]}')).toBe('cch:abc123')
  })
})

describe('openai', () => {
  const openai = providers.get('openai')

  test('chat completions usage counts cached tokens as cache reads', () => {
    const body = JSON.stringify({ usage: { prompt_tokens: 100, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 40, cache_write_tokens: 10 } } })
    expect(openai.usageNonStream(body)).toEqual({ input: 100, output: 5, cacheRead: 40, cacheCreation: 10 })
  })

  test('streamed tool-call deltas are joined per call id', () => {
    const body = sse([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'grep', arguments: '{"q":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { arguments: '"x"}' } }] } }] },
    ])
    expect(openai.toolInvocations(body, true)).toEqual([{ toolName: 'grep', inputPreview: '{"q":"x"}', skillName: null }])
  })
})

describe('chatgpt', () => {
  test('finds usage nested anywhere in camelCase or snake_case', () => {
    const body = JSON.stringify({ a: { b: [{ usage: { inputTokens: 7, cached_input_tokens: 3 } }] } })
    expect(providers.get('chatgpt').usageNonStream(body)).toEqual({ input: 7, output: null, cacheRead: 3, cacheCreation: null })
  })
})

describe('google', () => {
  test('normalizes billed thinking tokens into output usage', () => {
    const body = JSON.stringify({ usageMetadata: { promptTokenCount: 12, cachedContentTokenCount: 2, candidatesTokenCount: 5, thoughtsTokenCount: 7, totalTokenCount: 24 } })
    expect(providers.get('google').usageNonStream(body)).toEqual({ input: 12, output: 12, cacheRead: 2, cacheCreation: null })
  })
})

describe('lenient wire parsing', () => {
  test('a wrong-typed field is ignored instead of failing the payload', () => {
    const body = JSON.stringify({ usage: { input_tokens: 'many', output_tokens: 7 } })
    expect(providers.get('anthropic').usageNonStream(body)).toEqual({ input: null, output: 7, cacheRead: null, cacheCreation: null })
  })

  test('malformed list items are skipped, valid ones kept', () => {
    const body = JSON.stringify({ content: [null, 'x', { type: 'tool_use', name: 'Read', input: { path: 'a' } }] })
    expect(providers.get('anthropic').toolInvocations(body, false)).toEqual([{ toolName: 'Read', inputPreview: '{"path":"a"}', skillName: null }])
  })
})
