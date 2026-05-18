import { loadConfig } from '../src/config'
import type { ProviderName, ToolInvocation } from '../src/domain/telemetry'
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
    model: 'gpt-4o-mini',
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
    model: 'gpt-4o-mini',
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
]

try {
  await sql`DELETE FROM traces WHERE external_id LIKE 'demo:%'`

  for (const [i, demo] of demos.entries()) {
    const started = now - (demos.length - i) * 60_000
    const traceId = await repository.getOrCreateTrace(demo.id, demo.provider, started)
    const requestBody = requestFor(demo)
    const responseBody = responseFor(demo)
    const spanId = await repository.insertSpan({
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
    })
    if (demo.tools?.length) {
      await repository.insertToolInvocations(spanId, traceId, started + demo.durationMs, demo.tools)
    }
  }
  console.log(`Seeded ${demos.length} demo traces. Open http://${config.hostname}:${config.port}/dashboard?range=1h`)
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
        choices: [{ message: { role: 'assistant', content: demo.answer } }],
        usage: {
          prompt_tokens: input,
          completion_tokens: demo.output,
          prompt_tokens_details: { cached_tokens: demo.cacheRead },
        },
      })
  }
}

function reportedInput(demo: DemoTrace): number {
  return demo.provider === 'anthropic' ? demo.input : demo.input + demo.cacheRead
}
