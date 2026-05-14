# Harness-Style Debugger Blueprint

## What The Reference Gets Right

The useful pattern is not the dark visual style. The useful pattern is a replayable agent run:

- Left rail: runs/sessions with cost, duration, model, status.
- Main pane: one trace as a chronological transcript.
- Tool cards: each tool has command/input, result, exit status, duration, and token impact.
- Cost strip: model, input, cached input, output, estimated dollars.
- Assistant answer stays next to the tool evidence that produced it.

This is closer to an agent harness debugger than a generic observability dashboard.

## Terms We Should Model

- Agent: program that loops over model calls and tools.
- Run / Trace: one user task.
- Step / Span: one model call, tool call, or local event inside a trace.
- Tool card: command/input/output/status for one tool invocation.
- Signals: token load, cache hit, repeated work, failures, missing verification.
- Score: verdict computed from signals.
- Eval: repeatable prompt/workflow check.
- Monitor: saved rule that warns about loops, high cost, failures, or missing verification.

## Data We Need Per Tool

Current tool rows are enough for summaries, but not enough for great debugging. Add:

- `tool_kind`: search, read, edit, verify, browser, mcp, git, subagent.
- `command`: normalized command family, for example `rg`, `file-read`, `typecheck`.
- `input_full`: exact command or structured input.
- `output_preview`: first useful lines, not full spam.
- `output_bytes`: size of raw output.
- `exit_code`: null for non-shell tools.
- `duration_ms`: tool runtime.
- `repeated_key`: stable grouping key, for example `rg:dashboard`.
- `verification_role`: none, precheck, postcheck, final evidence.

## Screens To Build

### 1. Live Dashboard

Purpose: answer "what is happening right now?"

- Cost / token / cache / failure cards.
- Recent traces.
- Top tools and skills.
- Runtime filters: Codex, Claude, OpenAI API, Google, local.

### 2. Trace Replay

Purpose: answer "what exactly happened in this run?"

- Header: prompt, model, runtime, status, duration, estimated cost.
- Cost bar: fresh input, cache read, output, reasoning if available.
- Timeline: model call, tool call, tool result, assistant note.
- Tool cards with command/result.
- Final answer.

### 3. Efficiency Report

Purpose: answer "why did tokens move?"

- Repeated search/read loops.
- Cold cache.
- High tokens per tool.
- Tool failure/retry.
- Edit without verification.
- Browser check missing for UI changes.
- Subagent overhead.

### 4. Prompt/Eval Lab

Purpose: compare two prompt shapes.

- Run A vs Run B.
- Cost delta.
- Tool count delta.
- Verification present/missing.
- Final verdict.

### 5. Monitors

Purpose: catch bad behavior automatically.

- More than N repeated `rg` calls.
- Edit without test/build/browser verification.
- Failed tool call.
- Cache hit below threshold.
- Context over threshold.
- Cost above budget.

## First Implementation Slice

1. Rename full-page `/dashboard/trace/:id` into the primary replay view.
2. Add full tool cards below the timeline.
3. Persist tool output preview, exit code, and duration when available.
4. Add price cards for known models.
5. Add score reasons as first-class rows, not only prose.
6. Add demo traces for repeated search, edit-without-verify, failed tool, verified UI run.

## Design Direction

Keep the current warm theme for the live dashboard, but make the replay view denser and more technical:

- left run rail;
- center transcript;
- right sticky inspector with cost/signals;
- monospace command cards;
- colored state labels: success, failed, repeated, verified, missing check.

This gives the product the same debugging power as the reference while staying readable for daily use.
