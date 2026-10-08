import { loadConfig } from './config'
import { connectDatabase } from './infrastructure/postgres/client'
import { PostgresTelemetryRepository } from './infrastructure/postgres/telemetryRepository'
import { estimateSpanCost } from './infrastructure/providers/costInputs'
import { summarizeCosts } from './domain/costs'
import { groupBy } from './shared/collections'
import { modelCostKey, renderRecentSpans, renderSummary } from './presentation/cli/usageReport'
import { sinceFor } from './shared/timespan'

const RECENT_SPANS = 20

function parseArgs(argv: string[]): { last: string; mode: 'summary' | 'list' } {
  let last = '24h'
  let mode: 'summary' | 'list' = 'summary'
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--last') last = argv[++i] ?? last
    else if (argv[i] === '--list') mode = 'list'
  }
  return { last, mode }
}

const { last, mode } = parseArgs(process.argv.slice(2))
const sql = await connectDatabase(loadConfig().databaseUrl)
const repository = new PostgresTelemetryRepository(sql)
const since = sinceFor(last, Date.now())

try {
  if (mode === 'list') {
    console.log(renderRecentSpans(await repository.recentSpans({ since }, RECENT_SPANS), last, estimateSpanCost))
  } else {
    const spans = await repository.costSpans({ since })
    const groups = groupBy(spans, (span) => modelCostKey(span.provider, span.model))
    const costs = new Map([...groups].map(([key, calls]) => [key, summarizeCosts(calls.map(estimateSpanCost))]))
    console.log(renderSummary(await repository.usageByProviderModel(since), await repository.traceTotals(since), last, costs))
  }
} finally {
  await sql.close()
}
