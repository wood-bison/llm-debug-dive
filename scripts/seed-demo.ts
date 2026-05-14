import {
  getOrCreateTrace,
  insertSpan,
  insertToolInvocations,
  sql,
  type ToolInvocation,
} from '../src/db'

type DemoTrace = {
  id: string
  provider: string
  model: string
  prompt: string
  answer: string
  input: number
  output: number
  cacheRead: number
  cacheCreation?: number
  durationMs: number
  status?: number
  tools?: ToolInvocation[]
}

const now = Date.now()

const demos: DemoTrace[] = [
  {
    id: 'demo:research-loop',
    provider: 'openai',
    model: 'gpt-demo',
    prompt: 'Find why the dashboard is slow. Search the whole repo and explain what to improve.',
    answer: 'The agent searched broadly and found several possible paths, but did not verify with a targeted test.',
    input: 164_000,
    output: 1_200,
    cacheRead: 8_000,
    durationMs: 42_000,
    tools: [
      tool('rg', 'rg -n "dashboard|trace|span" .', 'Read & search'),
      tool('rg', 'rg -n "dashboard|trace|span" src', 'Read & search'),
      tool('rg', 'rg -n "queryRecentTraces|queryStats" src', 'Read & search'),
      tool('rg', 'rg -n "htmx|filter-chip" public src', 'Read & search'),
      tool('sed', "sed -n '1,220p' src/dashboard/api.ts", 'Read & search'),
      tool('sed', "sed -n '220,520p' src/dashboard/api.ts", 'Read & search'),
      tool('sed', "sed -n '1,260p' public/styles.css", 'Read & search'),
      tool('sed', "sed -n '260,620p' public/styles.css", 'Read & search'),
    ],
  },
  {
    id: 'demo:verified-browser-qa',
    provider: 'google',
    model: 'gemini-demo',
    prompt: 'Open the dashboard, verify the trace detail layout, then run the typecheck.',
    answer: 'The UI was checked in browser and the typecheck passed.',
    input: 18_000,
    output: 900,
    cacheRead: 62_000,
    durationMs: 18_500,
    tools: [
      tool('browser_navigate', 'browser_navigate http://127.0.0.1:8787/dashboard', 'Browser QA'),
      tool('browser_snapshot', 'browser_snapshot #detail-pane', 'Browser QA'),
      tool('bun', 'bunx tsc --noEmit', 'Checks'),
      tool('bun', 'bun run build', 'Checks'),
    ],
  },
  {
    id: 'demo:failed-tool',
    provider: 'anthropic',
    model: 'claude-demo',
    prompt: 'Use Playwright MCP to inspect localhost and tell me if the button works.',
    answer: 'The run failed before useful evidence was collected because the tool target was unavailable.',
    input: 42_000,
    output: 300,
    cacheRead: 0,
    durationMs: 9_200,
    status: 502,
    tools: [
      tool('mcp__playwright__browser_navigate', 'navigate http://127.0.0.1:9999', 'Browser QA'),
      tool('mcp__playwright__browser_snapshot', 'snapshot after failed navigation', 'Browser QA'),
    ],
  },
  {
    id: 'demo:edit-without-verify',
    provider: 'openai',
    model: 'gpt-demo',
    prompt: 'Fix the CSS overflow in the trace table.',
    answer: 'The agent edited CSS but did not run a browser or typecheck verification.',
    input: 54_000,
    output: 1_600,
    cacheRead: 22_000,
    durationMs: 25_000,
    tools: [
      tool('rg', 'rg -n "tools-cell|table-layout" public/styles.css', 'Read & search'),
      tool('apply_patch', 'apply_patch public/styles.css', 'Code edits'),
    ],
  },
]

await sql`DELETE FROM traces WHERE external_id LIKE 'demo:%'`

for (const [i, demo] of demos.entries()) {
  const started = now - (demos.length - i) * 60_000
  const traceId = await getOrCreateTrace(demo.id, demo.provider, started)
  const spanId = await insertSpan({
    trace_id: traceId,
    provider: demo.provider,
    path: '/demo/agent-run',
    method: 'POST',
    model: demo.model,
    started_at: started,
    ended_at: started + demo.durationMs,
    duration_ms: demo.durationMs,
    status: demo.status ?? 200,
    is_stream: 0,
    input_tokens: demo.input,
    output_tokens: demo.output,
    cache_read_tokens: demo.cacheRead,
    cache_creation_tokens: demo.cacheCreation ?? 0,
    request_body: JSON.stringify({
      model: demo.model,
      messages: [{ role: 'user', content: demo.prompt }],
    }),
    response_body: JSON.stringify({
      output: [{ role: 'assistant', content: [{ type: 'output_text', text: demo.answer }] }],
      usage: {
        input_tokens: demo.input,
        output_tokens: demo.output,
        input_token_details: { cached_tokens: demo.cacheRead },
      },
    }),
  })
  if (demo.tools?.length) {
    await insertToolInvocations(spanId, traceId, started + demo.durationMs, demo.tools)
  }
}

console.log(`Seeded ${demos.length} demo traces. Open http://127.0.0.1:8787/dashboard?range=1h`)

function tool(name: string, preview: string, skill: string): ToolInvocation {
  return { tool_name: name, tool_input_preview: preview, skill_name: skill }
}
