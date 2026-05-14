# llm-debug-dive

Local dashboard for understanding AI agent runs from Codex, Claude Code, and other API-compatible agents: what you asked, what the agent did, which tools ran, how many tokens moved, where work repeated, and how to make the next prompt cheaper.

It is built for daily Codex/Claude debugging, not for production observability.

## What you get

- Live dashboard at `http://127.0.0.1:8787/dashboard`
- Built-in guide/glossary at `http://127.0.0.1:8787/dashboard/guide`
- Trace replay per user prompt
- Tool timeline and repeated-work signals
- Token load, cache hit, latency, estimated cost when pricing is known
- Prompt Coach with evidence, impact, and cheaper next prompt
- Optional local Ollama second opinion, so prompt critique does not spend cloud tokens

## Requirements

Install these first:

- [Bun](https://bun.sh)
- Docker Desktop, for local Postgres
- Codex CLI or Codex app, for `codex-debug`
- Claude Code, for `claude-debug`
- Ollama, optional, for local model review

Check the basics:

```bash
bun --version
docker --version
codex --version
```

## Install wrappers

Clone the repo and enter it:

```bash
git clone git@github.com:wood-bison/llm-debug-dive.git
cd llm-debug-dive
```

Install the launcher scripts:

```bash
mkdir -p ~/.local/bin
ln -sf "$PWD/scripts/codex-debug" ~/.local/bin/codex-debug
ln -sf "$PWD/scripts/claude-debug" ~/.local/bin/claude-debug
```

Make sure `~/.local/bin` is in your shell path:

```bash
echo $PATH
```

If it is missing, add this to `~/.zshrc`:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

Then restart the terminal.

## Run an agent through the debugger

Go to any project you want to work on:

```bash
cd /path/to/your/project
codex-debug
```

Or with Claude Code:

```bash
cd /path/to/your/project
claude-debug
```

This starts everything needed:

1. local Postgres in Docker on `:55432`
2. Bun proxy on `:8787`
3. dashboard at `http://127.0.0.1:8787/dashboard`
4. Codex or Claude connected through the proxy

For one-shot runs:

```bash
codex-debug exec "explain this repo structure"
claude-debug -p "explain this repo structure"
```

Without opening the browser:

```bash
codex-debug --no-open
claude-debug --no-open
```

## Optional: Ollama review

If Ollama is running, trace pages show a local model review button.

Example models:

```bash
ollama list
ollama pull qwen3.6:27b
ollama pull gemma4:26b
```

Use this for cheap prompt scoring, skill critique, and repeated-tool diagnosis.

## Manual development mode

For hacking on the dashboard itself:

```bash
cd llm-debug-dive
bun install
docker compose up -d postgres
bun run build
bun run start
```

Open:

```text
http://127.0.0.1:8787/dashboard
```

## Verify

With the proxy running:

```bash
bun run verify
```

Build check:

```bash
bunx tsc --noEmit
bun run build
```

## Useful commands

```bash
# show proxy log
tail -f /tmp/llm-debug-proxy.log

# stop local Postgres
docker compose down

# delete local Postgres data
docker compose down -v

# seed demo traces
bun run demo:seed
```

## Notes

- External labs like Langfuse and Phoenix are intentionally not required.
- The source of truth is local Postgres plus the LLM Debug Dive UI.
- `codex-debug` and `claude-debug` are the normal entry points.
- If port `8787` is busy, the wrapper tries fallback ports.
