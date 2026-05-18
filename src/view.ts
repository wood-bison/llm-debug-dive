import { loadConfig } from './config'
import { connectDatabase } from './infrastructure/postgres/client'
import { PostgresTelemetryRepository } from './infrastructure/postgres/telemetryRepository'
import { renderRecentSpans, renderSummary } from './presentation/cli/usageReport'
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
const repository = new PostgresTelemetryRepository(await connectDatabase(loadConfig().databaseUrl))
const since = sinceFor(last, Date.now())

console.log(mode === 'summary'
  ? renderSummary(await repository.usageByProviderModel(since), await repository.traceTotals(since), last)
  : renderRecentSpans(await repository.recentSpans({ since }, RECENT_SPANS), last))
