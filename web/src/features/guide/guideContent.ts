import type { GuideSection } from './guideTypes'

export const GUIDE_SECTIONS: readonly GuideSection[] = [
  {
    id: 'core-concepts',
    title: 'Core concepts',
    kind: 'terms',
    items: [
      { name: 'Agent', meaning: 'A program that calls an LLM and can run tools.', example: 'Codex, Claude Code, your own backend agent, a LangChain/LangGraph agent.' },
      { name: 'Trace', meaning: 'One unit of work: user prompt → model calls → tools → final answer.', example: 'If you ask “review this PR”, that whole turn should become one trace.' },
      { name: 'Span', meaning: 'One operation inside a trace.', example: 'An LLM request, a shell/tool call, a browser check, a telemetry event, a failed request.' },
      { name: 'Tool', meaning: 'An action the agent takes outside the model.', example: 'read file, grep/rg, run tests, browser snapshot, apply_patch, MCP tool.' },
      { name: 'Skill', meaning: 'Instructions or a workflow that teach the agent one kind of task.', example: 'For example: a Playwright UI testing skill, a code review skill, a docs migration skill.' },
      { name: 'Run / Turn', meaning: 'One conversational step of the agent for your prompt.', example: 'In Codex this is usually one user message and the final assistant answer.' },
    ],
  },
  {
    id: 'tokens-and-cost',
    title: 'Tokens and cost',
    kind: 'terms',
    items: [
      { name: 'Input tokens', meaning: 'The context the model read.', example: 'Your prompt, the history, system instructions, files it found, and tool results.' },
      { name: 'Output tokens', meaning: 'The text the model generated.', example: 'The final answer, reasoning output, and progress messages, if the provider counts them.' },
      { name: 'Fresh input', meaning: 'New context that did not come from the cache.', example: 'Usually costs more than cache reads. A huge fresh input means the agent loaded a lot of new context.' },
      { name: 'Cache reads', meaning: 'Context that was reused.', example: 'A high cache hit is good, but a large fresh input can still be expensive.' },
      { name: 'Cache hit', meaning: 'The share of input that came from the cache.', example: 'A high cache hit does not mean “free”; it means “part of the context was reused”.' },
      { name: 'Cost signal', meaning: 'Estimated cost, or token load when the model price is unknown.', example: 'Without pricing, the app shows token load instead of a made-up exact price.' },
    ],
  },
  {
    id: 'scoring',
    title: 'Scoring, evals, signals and monitors',
    kind: 'terms',
    items: [
      { name: 'Scoring', meaning: 'A rule-based grade for a trace.', example: 'For example: lots of fresh input, 25 tools, file-discovery x11 → prompt needs rewrite. It is a signal, not the absolute truth.' },
      { name: 'Signals', meaning: 'Raw facts about how the agent behaved.', example: 'Tokens, latency, cache, failed spans, repeated tools, edits without verification.' },
      { name: 'Evals', meaning: 'Repeatable checks of agent quality.', example: 'For example: “with the MCP skill, the agent must find .mcp.json in ≤5 tool calls”.' },
      { name: 'Production monitors', meaning: 'Automatic alerts on bad signals.', example: 'Cost spike, low cache hit, repeated failures, too many tools, missing verification after edits.' },
      { name: 'Verdict', meaning: 'A human-readable reading of the signals.', example: 'Efficient prompt, usable but tune it, expensive, needs rewrite.' },
      { name: 'Baseline', meaning: 'The normal level for similar tasks.', example: 'If a usual docs lookup costs 40k tokens and this trace used 985k, the agent went too broad.' },
    ],
  },
  {
    id: 'bottlenecks',
    title: 'Finding the bottleneck',
    kind: 'pairs',
    items: [
      { name: 'Lots of fresh input', meaning: 'The agent loaded too much new context. Give exact files, forbid broad search, and ask it to stop after evidence.' },
      { name: 'The same tools over and over', meaning: 'The skill or prompt gave no good search recipe. If `file-discovery` or `grep` repeat, narrow the path.' },
      { name: 'No tools, but many tokens', meaning: 'The answer may come from old context with no fresh check. Ask it to inspect exact files and cite evidence.' },
      { name: 'Edits without verification', meaning: 'Risky. Code changes need at least one test/build/browser check with a clear result.' },
      { name: 'High cache hit, but cost is still high', meaning: 'The cache helped, but the total context load is still huge. Cut fresh input and noisy tool output.' },
      { name: 'Failed spans', meaning: 'Fix transport, auth, or runtime first. Otherwise the agent retries and burns tokens working around the error.' },
    ],
  },
  {
    id: 'other-tools',
    title: 'How this relates to other tools',
    kind: 'pairs',
    items: [
      { name: 'Google Agent SDK / ADK, OpenAI Agents SDK', meaning: 'Frameworks for building agents. They help organise tools, memory, tracing, and evals, but they do not explain your daily Codex workflow on their own.' },
      { name: 'OpenAI debugger / provider dashboards', meaning: 'Good for API-level observability: requests, latency, usage, errors. This dashboard sits closer to the developer workflow: prompt, tools, skills, replay.' },
      { name: 'LangChain / LangGraph / LangSmith', meaning: 'Great when you build your own agent app. For local Codex/Claude debugging, lightweight capture and a clear reading matter more.' },
      { name: 'Langfuse / Phoenix', meaning: 'Strong observability tools, but they need proper integration and credentials. They are optional here: a local trace should make sense on its own first.' },
    ],
  },
]

export const CHEAP_PROMPT_TEMPLATE = `Goal: <one concrete outcome>
Inspect only:
- <exact file/path/url>
- <exact config/skill>
Boundaries:
- Read-only diagnosis. Do not edit files.
- Do not do broad repo discovery unless listed targets are missing.
- Stop after the smallest evidence set.
Return exactly:
1. finding
2. evidence
3. cheapest fix
4. verification
5. risks`
