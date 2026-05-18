import { createApp } from './app'
import { loadConfig } from './config'
import { connectDatabase } from './infrastructure/postgres/client'

const BUN_MAX_IDLE_TIMEOUT_SECONDS = 255
const SHUTDOWN_DRAIN_MS = 5000
const SHUTDOWN_SIGNALS = ['SIGINT', 'SIGTERM'] as const

function exitAfterDrainingStreams(): void {
  for (const signal of SHUTDOWN_SIGNALS) {
    process.on(signal, () => {
      console.log(`\n[${signal}] received, draining for up to ${SHUTDOWN_DRAIN_MS / 1000}s…`)
      setTimeout(() => {
        console.log('[shutdown] forced exit')
        process.exit(0)
      }, SHUTDOWN_DRAIN_MS)
    })
  }
}

const config = loadConfig()
const app = createApp(config, await connectDatabase(config.databaseUrl))

exitAfterDrainingStreams()
Bun.serve({
  hostname: config.hostname,
  port: config.port,
  idleTimeout: BUN_MAX_IDLE_TIMEOUT_SECONDS,
  fetch: app.fetch,
})
console.log(`llm-debug-dive proxy on http://${config.hostname}:${config.port} · dashboard at /dashboard`)
