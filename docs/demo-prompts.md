# LLM Debug Dive Demo Prompts

Goal: prove that the dashboard explains why an agent spent tokens, not only how many tokens were spent.

## Demo Data

Seed controlled traces:

```bash
bun run demo:seed
```

Then open:

```bash
http://127.0.0.1:8787/dashboard?range=1h
```

Expected seeded scenarios:

- `demo:research-loop`: broad prompt, high token load, repeated `rg`, repeated file reads, no verification.
- `demo:verified-browser-qa`: browser QA plus typecheck/build, good verification flow.
- `demo:failed-tool`: failed browser/MCP style run, useful for error and monitor display.
- `demo:edit-without-verify`: code edit was made, but no typecheck or browser verification followed.

## Real Prompts To Run Through `codex-debug`

### 1. Broad Research Loop

```text
Analyze this whole repo and tell me everything that can be improved in the dashboard.
```

Expected signal:

- High fresh input.
- Many search/read tools.
- Verdict should explain that the prompt is too broad.
- Next cheaper run should say which scope to name, for example exact files or subsystem.

### 2. Targeted Research

```text
Inspect only public/styles.css and src/dashboard/api.ts. Find why the trace table overflows and propose the smallest fix. Do not edit files yet.
```

Expected signal:

- Fewer tools than broad research.
- Lower token load.
- Research skill should be useful, not noisy.
- Verdict should not ask for a narrower prompt if evidence is focused.

### 3. Edit Without Verification

```text
Fix the dashboard trace table overflow in public/styles.css. Keep the change small.
```

Expected signal:

- Code edit skill appears.
- If no test/browser check follows, Next cheaper run should explicitly say verification is missing.

### 4. Verified UI Fix

```text
Fix the dashboard trace table overflow in public/styles.css, then verify in the browser at http://127.0.0.1:8787/dashboard and run the TypeScript check.
```

Expected signal:

- Code edit plus Browser QA plus Checks.
- Verdict should mark this as a stronger workflow than edit-only.
- Tools should show the verification path, not just the patch.

### 5. Repeated Search Detection

```text
Find where the dashboard renders trace details. Search first, then explain which files own the UI and API rendering.
```

Expected signal:

- If `rg` or file reads repeat many times, Next cheaper run should name that directly, for example `rg ran 4 times`.
- The dashboard should explain why that matters: repeated search usually means the prompt did not name the owner files or subsystem clearly enough.

### 6. MCP Discovery

```text
Which MCP tools are currently available? Check once, summarize what actually works, and do not inspect unrelated files.
```

Expected signal:

- MCP skill appears.
- If the same discovery runs repeatedly in one trace, the dashboard should suggest reusing the first discovery result.

## What A Good Trace Should Answer

- What did I ask?
- What did the agent do?
- Which tools ran?
- Which skills were useful?
- Which step was wasteful or missing?
- Was the token load high because of fresh context, cache miss, repeated search, or long reasoning?
- What exact prompt would make the next run cheaper?

## Product Terms We Keep

- Agent: the program using an LLM plus tools.
- Trace: one user task or run.
- Span: one model call, tool call, or observed step inside the trace.
- Signals: facts extracted from the trace, such as token load, cache rate, repeated tools, failures, and verification.
- Scoring: turning signals into a verdict.
- Evals: repeatable tests for prompt and workflow quality.
- Monitors: production checks that watch cost, failures, latency, and regressions over time.
