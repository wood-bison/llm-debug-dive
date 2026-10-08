# LLM Debug Dive

A local debugger for AI agent runs. See prompts, model calls, tools, token usage and estimated cost in one place.

## Quick start

Requires [Bun](https://bun.sh) 1.3.14 or newer and Docker with Compose.

```sh
bun run setup
bun run start
```

Open [the dashboard](http://127.0.0.1:8787/dashboard). Select a run, follow its timeline, then open a model call to inspect the conversation and raw payloads. The in-app guide explains the metrics.

## Cost Explorer

Open a run to see token costs by category and inspect each call’s rates, source and verification date. Compare the token estimate with a without-cache scenario, or set an optional run budget to find the first call that reaches it. Budgets are saved in your browser and do not block agent requests.

New calls retain the pricing estimate captured with them. Older calls are explicitly repriced using the current catalog. Missing usage, unknown models and unsupported tariffs produce partial or unknown estimates. These are token estimates, not invoices; paid tools, cache storage, taxes and subscription billing are excluded.

## Preview

Sample data from a disposable local database:

![Runs dashboard with token load and cache usage](docs/images/dashboard.jpg)

![Run detail with token composition and a model/tool timeline](docs/images/trace.jpg)

![Cost Explorer with token rates, cache savings and a run budget](docs/images/cost-explorer.jpg)

To create sample runs, execute `bun run demo:seed`. It replaces only traces whose external ID starts with `demo:`. Use a development database.

## Capture agent runs

Install the matching agent CLI, then link the launchers:

```sh
mkdir -p ~/.local/bin
ln -sf "$PWD/scripts/codex-debug" ~/.local/bin/codex-debug
ln -sf "$PWD/scripts/claude-debug" ~/.local/bin/claude-debug
```

Add `~/.local/bin` to your PATH. Run `codex-debug` or `claude-debug` from the project you want to inspect. Each launcher builds the app, starts local services and routes its agent through the proxy. Use `--no-open` to skip the browser.

## Development

```sh
bun install --frozen-lockfile
bun run check
```

Run `bun run dev` for the server and `bun run dev:web` in a second terminal for React hot reload. Open `/dashboard` on the Vite server. Production serves the built dashboard and API from Bun; rebuild after frontend changes.

`bun run check` runs lint, strict TypeScript, regression tests and the production build. Against a running server, `bun run verify` checks local HTTP routes without paid provider calls. `bun run view` prints a terminal usage report.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `postgres://llm_debug:llm_debug@127.0.0.1:55432/llm_debug` | Postgres connection |
| `POSTGRES_PORT` | `55432` | Docker host port; match `DATABASE_URL` when changed |
| `PROXY_PORT` | `8787` | App and proxy port |
| `PROXY_HOSTNAME` | `127.0.0.1` | Bind address |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Optional local reviewer |
| `CODEX_SESSIONS_DIR` | `~/.codex/sessions` | Local agent transcripts |
| `LLM_DEBUG_API` | `http://127.0.0.1:8787` | Vite's API target |
| `PROXY_URL` | `http://127.0.0.1:8787` | HTTP verification target |

Additional server defaults are defined in [src/config.ts](src/config.ts).

Keep the app local: captured prompts and tool output may contain private data. There is no authentication or multi-user isolation. Unknown prices and heuristic signals do not establish correctness or successful verification.

## Architecture

`src/domain` holds pure analysis rules. `src/application` defines use cases and typed ports. `src/infrastructure` implements storage and provider adapters. `src/presentation` exposes HTTP and CLI interfaces. `src/contracts` validates the shared API; `web/src` contains React features and semantic Tailwind tokens. `src/app.ts` composes the dependencies.

Decisions live in [docs/adr](docs/adr): [dependency boundaries](docs/adr/0001-dependency-boundaries.md), [React and API contracts](docs/adr/0002-react-dashboard.md), [visual tokens](docs/adr/0003-visual-system.md), [cost estimates](docs/adr/0004-cost-estimates.md), [Postgres execution](docs/adr/0005-postgres-query-execution.md).
