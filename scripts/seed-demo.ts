import { loadConfig } from '../src/config'
import { estimateSpanCost } from '../src/infrastructure/providers/costInputs'
import type { NewSpan, ProviderName, ToolInvocation } from '../src/domain/telemetry'
import { connectDatabase } from '../src/infrastructure/postgres/client'
import { PostgresTelemetryRepository } from '../src/infrastructure/postgres/telemetryRepository'
import { HTTP_STATUS } from '../src/shared/httpStatus'

const config = loadConfig()
const sql = await connectDatabase(config.databaseUrl)
const repository = new PostgresTelemetryRepository(sql)

type DemoTrace = {
  id: string
  provider: ProviderName
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
    model: 'gpt-6.1-sol',
    prompt: 'Find why the dashboard is slow. Search the whole repo and explain what to improve.',
    answer: 'The agent searched broadly and found several possible paths, but did not verify with a targeted test.',
    input: 164_000,
    output: 1_200,
    cacheRead: 8_000,
    durationMs: 42_000,
    tools: [
      tool('rg', 'rg -n "dashboard|trace|span" web/src', 'Read & search'),
      tool('rg', 'rg -n "useOverview|traceList|tracePanel" src web/src', 'Read & search'),
      tool('rg', 'rg -n "overview|traces|spans" src/presentation/http/v1 web/src/api', 'Read & search'),
      tool('rg', 'rg -n "RunRow|TokenBreakdown|TraceTimeline" web/src', 'Read & search'),
      tool('sed', "sed -n '1,220p' web/src/features/dashboard/DashboardPage.tsx", 'Read & search'),
      tool('sed', "sed -n '1,220p' web/src/features/dashboard/RunsTable.tsx", 'Read & search'),
      tool('sed', "sed -n '1,260p' web/src/styles/index.css", 'Read & search'),
      tool('sed', "sed -n '1,220p' web/src/charts/TokenBreakdown.tsx", 'Read & search'),
    ],
  },
  {
    id: 'demo:verified-browser-qa',
    provider: 'google',
    model: 'gemini-2.5-flash',
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
    model: 'claude-sonnet-4-6',
    prompt: 'Use Playwright MCP to inspect localhost and tell me if the button works.',
    answer: 'The run failed before useful evidence was collected because the tool target was unavailable.',
    input: 42_000,
    output: 300,
    cacheRead: 0,
    durationMs: 9_200,
    status: HTTP_STATUS.badGateway,
    tools: [
      tool('mcp__playwright__browser_navigate', 'navigate http://127.0.0.1:9999', 'Browser QA'),
      tool('mcp__playwright__browser_snapshot', 'snapshot after failed navigation', 'Browser QA'),
    ],
  },
  {
    id: 'demo:edit-without-verify',
    provider: 'openai',
    model: 'gpt-6.1-sol',
    prompt: 'Fix the CSS overflow in the trace table.',
    answer: 'The agent edited CSS but did not run a browser or typecheck verification.',
    input: 54_000,
    output: 1_600,
    cacheRead: 22_000,
    durationMs: 25_000,
    tools: [
      tool('rg', 'rg -n "overflow|table-layout|grid-template" web/src', 'Read & search'),
      tool('apply_patch', 'apply_patch web/src/features/dashboard/RunsTable.tsx', 'Code edits'),
    ],
  },
  ...[0, 1, 2].map((step): DemoTrace => ({
    id: 'demo:cost-explorer',
    provider: 'openai',
    model: 'gpt-6.1-sol',
    prompt: ['Inspect the targeted module.', 'Apply the small refactor using the cached context.', 'Verify the updated module.'][step] ?? '',
    answer: ['Module inspected.', 'Refactor applied.', 'Verification recorded.'][step] ?? '',
    input: 20_000,
    output: 2_000,
    cacheRead: step === 0 ? 0 : 80_000,
    cacheCreation: step === 0 ? 80_000 : 0,
    durationMs: 12_000,
    tools: [tool(step === 2 ? 'bun' : 'rg', step === 2 ? 'bun run typecheck' : 'rg -n "cost" src/domain', step === 2 ? 'Checks' : 'Read & search')],
  })),
  {
    id: 'demo:unknown-tariff',
    provider: 'openai',
    model: 'custom-local-model',
    prompt: 'Inspect a call whose tariff is outside the pricing catalog.',
    answer: 'Usage is available, but a verified tariff is not.',
    input: 2_000,
    output: 500,
    cacheRead: 0,
    durationMs: 3_000,
  },
]

try {
  await sql`DELETE FROM traces WHERE external_id LIKE 'demo:%'`

  for (const [i, demo] of demos.entries()) {
    const started = now - (demos.length - i) * 60_000
    const traceId = await repository.getOrCreateTrace(demo.id, demo.provider, started)
    const requestBody = requestFor(demo)
    const responseBody = responseFor(demo)
    const span: NewSpan = {
      traceId,
      provider: demo.provider,
      path: '/demo/agent-run',
      method: 'POST',
      model: demo.model,
      startedAt: started,
      endedAt: started + demo.durationMs,
      durationMs: demo.durationMs,
      status: demo.status ?? HTTP_STATUS.ok,
      isStream: false,
      usage: { input: reportedInput(demo), output: demo.output, cacheRead: demo.cacheRead, cacheCreation: demo.cacheCreation ?? 0 },
      requestBody,
      responseBody,
    }
    const spanId = await repository.insertSpan({ ...span, costQuote: estimateSpanCost(span) })
    if (demo.tools?.length) {
      await repository.insertToolInvocations(spanId, traceId, started + demo.durationMs, demo.tools)
    }
  }
  console.log(`Seeded ${new Set(demos.map((demo) => demo.id)).size} demo traces. Open http://${config.hostname}:${config.port}/dashboard?range=1h`)
} finally {
  await sql.close()
}

function tool(name: string, preview: string, skill: string): ToolInvocation {
  return { toolName: name, inputPreview: preview, skillName: skill }
}

function requestFor(demo: DemoTrace): string {
  const base = { model: demo.model }
  switch (demo.provider) {
    case 'google':
      return JSON.stringify({ ...base, contents: [{ role: 'user', parts: [{ text: demo.prompt }] }] })
    case 'anthropic':
      return JSON.stringify({ ...base, messages: [{ role: 'user', content: demo.prompt }] })
    default:
      return JSON.stringify({ ...base, messages: [{ role: 'user', content: demo.prompt }] })
  }
}

function responseFor(demo: DemoTrace): string {
  const input = reportedInput(demo)
  switch (demo.provider) {
    case 'google':
      return JSON.stringify({
        candidates: [{ content: { role: 'model', parts: [{ text: demo.answer }] } }],
        usageMetadata: { promptTokenCount: input, candidatesTokenCount: demo.output, cachedContentTokenCount: demo.cacheRead },
      })
    case 'anthropic':
      return JSON.stringify({
        content: [{ type: 'text', text: demo.answer }],
        usage: { input_tokens: demo.input, output_tokens: demo.output, cache_read_input_tokens: demo.cacheRead, cache_creation_input_tokens: demo.cacheCreation ?? 0 },
      })
    default:
      return JSON.stringify({
        model: demo.model,
        service_tier: 'default',
        choices: [{ message: { role: 'assistant', content: demo.answer } }],
        usage: {
          prompt_tokens: input,
          completion_tokens: demo.output,
          prompt_tokens_details: { cached_tokens: demo.cacheRead, cache_write_tokens: demo.cacheCreation ?? 0 },
        },
      })
  }
}

function reportedInput(demo: DemoTrace): number {
  return demo.provider === 'anthropic' ? demo.input : demo.input + demo.cacheRead + (demo.cacheCreation ?? 0)
}
