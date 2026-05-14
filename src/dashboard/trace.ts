/**
 * Harness-style trace replay view.
 *
 * This page is intentionally denser than the live dashboard: it should feel
 * like opening one agent run and seeing exactly what happened.
 */

import { Hono } from 'hono'
import {
  extractConversation,
  queryRecentTraces,
  queryToolEventsForTrace,
  queryToolsForTrace,
  queryTraceById,
  queryLatestTraceReview,
  querySpansByTraceId,
  insertTraceReview,
  type SpanRow,
  type TraceReviewRow,
} from '../db'
import {
  buildVerdict,
  classifyTool,
  commandFromTool,
  repeatedTools,
  summarizeSkills,
  toolPreview,
} from '../analysis'
import { summarizeCodexTurnFromRequestBody } from '../codexSession'
import { buildPromptCoach, type PromptCoachInput, type PromptCoachResult } from '../promptCoach'
import { costUSD } from '../prices'
import {
  cacheHitRate,
  escapeHtml,
  fmtCost,
  fmtDuration,
  fmtTokens,
  statusClass,
  timeAgo,
} from './render'
import { tracePageShell } from './templates'

export const trace = new Hono()

type ReplayTool = {
  name: string
  label: string
  input: string | null
}

type ToolEventView = {
  tool_name: string
  skill_name: string | null
  tool_input_preview: string | null
  invoked_at: number
}

trace.get('/dashboard/trace/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return c.text('invalid id', 400)

  const t = await queryTraceById(id)
  if (!t) return c.text('trace not found', 404)

  const [spans, persistedToolEvents, toolAgg, recent, savedReview] = await Promise.all([
    querySpansByTraceId(id),
    queryToolEventsForTrace(id),
    queryToolsForTrace(id),
    queryRecentTraces({ since: Date.now() - 24 * 60 * 60 * 1000 }, 24),
    queryLatestTraceReview(id),
  ])

  const localCodex = spans
    .map((s) => summarizeCodexTurnFromRequestBody(s.request_body))
    .find((turn) => turn && (turn.tools.length > 0 || turn.prompt || turn.assistant))
  const toolEvents = persistedToolEvents.length > 0
    ? persistedToolEvents
    : localCodex?.tools.map((tool, index) => {
      const step = durationPoint(index, localCodex.tools.length, t.started_at, Math.max(1, t.ended_at - t.started_at))
      return {
        tool_name: tool.name,
        skill_name: classifyTool(tool).label,
        tool_input_preview: commandFromTool(tool),
        invoked_at: step,
      }
    }) ?? []
  const replayTools = toolEvents.map(toReplayTool)
  const totalCost = spans.reduce(
    (a, s) => a + spanCost(s),
    0,
  )
  const totalTokenLoad = t.total_input_tokens + t.total_output_tokens + t.total_cache_read_tokens
  const hit = cacheHitRate(t.total_input_tokens, t.total_cache_read_tokens)
  const duration = Math.max(1, t.ended_at - t.started_at)
  const lastStatus = spans.reduce((s, row) => Math.max(s, row.status), 0)
  const verdict = buildVerdict({
    input: t.total_input_tokens,
    output: t.total_output_tokens,
    cacheRead: t.total_cache_read_tokens,
    spanCount: t.span_count,
    cost: totalCost,
    status: lastStatus,
    tools: replayTools,
  }, null)
  const activeRecent = recent.find((r) => r.id === t.id)
  const firstPrompt = findFirstPrompt(spans) ?? localCodex?.prompt ?? activeRecent?.first_prompt ?? '(prompt not captured)'
  const finalAnswer = findLastAssistantText(spans) ?? localCodex?.assistant
  const repeated = repeatedTools(replayTools)
  const skills = summarizeSkills(replayTools)
  const t0 = t.started_at
  const coachInput = buildCoachInput({
    prompt: firstPrompt,
    assistant: finalAnswer ?? null,
    tools: replayTools,
    trace: t,
    spans,
    totalCost,
    cacheHit: hit,
  })
  const coach = buildPromptCoach(coachInput)
  const ollamaModels = await listOllamaModels()

  const body = `
  <div class="replay-shell">
    <aside class="run-rail">
      <a href="/dashboard" class="back">← live feed</a>
      <div class="rail-brand">LLM Debug Dive</div>
      <div class="rail-title">Runs</div>
      <div class="run-list">
        ${recent.map((r) => {
          const active = r.id === t.id ? 'active' : ''
          const cost = costUSD(r.models[0] ?? null, r.total_input_tokens, r.total_output_tokens, r.total_cache_read_tokens, r.total_cache_creation_tokens)
          const prompt = r.first_prompt || r.external_id || '(no prompt)'
          return `<a class="run-item ${active}" href="/dashboard/trace/${r.id}">
            <div class="run-item-top">
              <span>#${r.id}</span>
              <span>${timeAgo(r.started_at)}</span>
            </div>
            <div class="run-prompt">${escapeHtml(prompt)}</div>
            <div class="run-meta">
              <span class="pill pill-${r.provider}">${escapeHtml(r.provider)}</span>
              <span>${fmtTokens(r.total_input_tokens + r.total_cache_read_tokens + r.total_output_tokens)}</span>
              <span>${cost > 0 ? fmtCost(cost) : '—'}</span>
            </div>
          </a>`
        }).join('')}
      </div>
    </aside>

    <main class="replay-main">
      <div class="replay-header">
        <div>
          <div class="eyebrow">Trace replay</div>
          <h1>Trace #${t.id}</h1>
          <div class="detail-meta">${escapeHtml(t.external_id ?? '(no external id)')} · ${escapeHtml(t.provider)} · ${new Date(t.started_at).toLocaleString()}</div>
        </div>
        <div class="replay-cost">
          <div class="replay-cost-label">estimated cost</div>
          <div class="replay-cost-value">${totalCost > 0 ? fmtCost(totalCost) : 'price unknown'}</div>
        </div>
      </div>

      <section class="prompt-panel">
        <div class="step-kicker">User prompt</div>
        <div class="prompt-text">${escapeHtml(firstPrompt)}</div>
      </section>

      ${renderPromptCoach(t.id, coach, ollamaModels, savedReview)}

      <section class="timeline-panel">
        <div class="section-head">
          <div>
            <div class="step-kicker">Execution timeline</div>
            <h2>${spans.length + toolEvents.length} observed steps</h2>
          </div>
          <span class="mono">${fmtDuration(duration)}</span>
        </div>
        <div class="replay-steps">
          ${renderReplaySteps(spans, toolEvents, t0, duration)}
        </div>
      </section>

      ${toolEvents.length > 0 ? `<section class="tool-card-grid">
        <div class="section-head full">
          <div>
            <div class="step-kicker">Tool cards</div>
            <h2>${toolEvents.length} local tool calls</h2>
          </div>
        </div>
        ${toolEvents.map((tool, index) => renderToolCard(tool, index + 1)).join('')}
      </section>` : ''}

      ${finalAnswer ? `<section class="answer-panel">
        <div class="step-kicker">Assistant answer</div>
        <div class="answer-text answer-markdown">${renderAssistantMarkdown(finalAnswer)}</div>
      </section>` : ''}
    </main>

    <aside class="replay-inspector">
      <div class="inspector-card verdict-${verdict.tone}">
        <div class="step-kicker">Verdict</div>
        <div class="inspector-title">${escapeHtml(verdict.title)}</div>
        <p>${escapeHtml(verdict.summary)}</p>
      </div>

      <div class="inspector-card">
        <div class="step-kicker">Cost signal</div>
        <div class="kv compact">
          <div class="k">fresh input</div><div class="v">${fmtTokens(t.total_input_tokens)}</div>
          <div class="k">cache read</div><div class="v">${fmtTokens(t.total_cache_read_tokens)}</div>
          <div class="k">output</div><div class="v">${fmtTokens(t.total_output_tokens)}</div>
          <div class="k">cache hit</div><div class="v">${hit}%</div>
          <div class="k">token load</div><div class="v">${fmtTokens(totalTokenLoad)}</div>
        </div>
      </div>

      <div class="inspector-card">
        <div class="step-kicker">Signals</div>
        <div class="signal-list">
          ${signalRows({ repeated, replayTools, t, totalCost, hit, lastStatus })}
        </div>
      </div>

      <div class="inspector-card">
        <div class="step-kicker">Skills</div>
        <div class="skill-stack">
          ${skills.length > 0 ? skills.map((s) => `<div class="skill-row">
            <span>${escapeHtml(s.label)}</span>
            <strong>${s.count}</strong>
          </div>`).join('') : '<div class="muted-dim">No tools captured</div>'}
        </div>
      </div>

      ${toolAgg.length > 0 ? `<div class="inspector-card">
        <div class="step-kicker">Tool totals</div>
        <div class="tool-total-list">
          ${toolAgg.map((tg) => `<div class="tool-total">
            <span>${escapeHtml(tg.tool_name)}</span>
            <strong>${tg.n}</strong>
          </div>`).join('')}
        </div>
      </div>` : ''}
    </aside>
  </div>`

  return c.html(tracePageShell(`Trace #${t.id} — LLM Debug Dive`, body, 'trace-page'))
})

trace.post('/api/trace/:id/ollama-coach', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return c.text('invalid trace id', 400)

  const body = await c.req.parseBody()
  const model = String(body.model ?? '').trim()
  if (!model) return c.html('<div class="ollama-error">Choose an Ollama model first.</div>', 400)

  const t = await queryTraceById(id)
  if (!t) return c.html('<div class="ollama-error">Trace not found.</div>', 404)

  const spans = await querySpansByTraceId(id)
  const localCodex = spans
    .map((s) => summarizeCodexTurnFromRequestBody(s.request_body))
    .find((turn) => turn && (turn.tools.length > 0 || turn.prompt || turn.assistant))
  const toolEvents = localCodex?.tools.map((tool) => ({
    name: tool.name,
    label: tool.label,
    input: tool.input,
  })) ?? []
  const firstPrompt = findFirstPrompt(spans) ?? localCodex?.prompt ?? '(prompt not captured)'
  const finalAnswer = findLastAssistantText(spans) ?? localCodex?.assistant ?? null
  const totalCost = spans.reduce((a, s) => a + spanCost(s), 0)
  const hit = cacheHitRate(t.total_input_tokens, t.total_cache_read_tokens)
  const coach = buildPromptCoach(buildCoachInput({
    prompt: firstPrompt,
    assistant: finalAnswer,
    tools: toolEvents,
    trace: t,
    spans,
    totalCost,
    cacheHit: hit,
  }))

  try {
    const review = await askOllama(model, coach.ollamaBrief)
    const createdAt = Date.now()
    await insertTraceReview({
      traceId: id,
      reviewer: 'ollama',
      model,
      createdAt,
      prompt: coach.ollamaBrief,
      response: review.response || null,
      thinking: review.thinking || null,
      score: coach.score,
      verdict: coach.verdict,
    })
    return c.html(renderOllamaReview({ model, review, createdAt, persisted: true }))
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return c.html(`<div class="ollama-error">Ollama review failed: ${escapeHtml(message)}</div>`, 502)
  }
})

function spanCost(s: SpanRow): number {
  return costUSD(s.model, s.input_tokens ?? 0, s.output_tokens ?? 0, s.cache_read_tokens ?? 0, s.cache_creation_tokens ?? 0)
}

function buildCoachInput(args: {
  prompt: string
  assistant: string | null
  tools: ReplayTool[]
  trace: {
    total_input_tokens: number
    total_output_tokens: number
    total_cache_read_tokens: number
    span_count: number
    ended_at: number
    started_at: number
  }
  spans: SpanRow[]
  totalCost: number
  cacheHit: number
}): PromptCoachInput {
  const status = args.spans.some((s) => s.status >= 400) ? Math.max(...args.spans.map((s) => s.status)) : 200
  return {
    prompt: args.prompt,
    assistant: args.assistant,
    tools: args.tools,
    inputTokens: args.trace.total_input_tokens,
    outputTokens: args.trace.total_output_tokens,
    cacheReadTokens: args.trace.total_cache_read_tokens,
    spanCount: args.trace.span_count,
    durationMs: Math.max(1, args.trace.ended_at - args.trace.started_at),
    costUsd: args.totalCost,
    cacheHit: args.cacheHit,
    status,
  }
}

function renderPromptCoach(traceId: number, coach: PromptCoachResult, ollamaModels: string[], savedReview?: TraceReviewRow): string {
  const scoreClass = coach.score >= 82 ? 'good' : coach.score >= 62 ? 'warn' : coach.score >= 40 ? 'bad' : 'critical'
  return `<section class="coach-panel">
    <div class="coach-head">
      <div>
        <div class="step-kicker">Prompt Coach</div>
        <h2>${escapeHtml(coach.verdict)}</h2>
        <p>${escapeHtml(coach.summary)}</p>
      </div>
      <div class="coach-score coach-score-${scoreClass}" title="Local rule-based signal from prompt boundaries, output contract, token load, tool count, repeated work, verification, and failures. Not a model truth score.">
        <div class="coach-score-label">heuristic</div>
        <strong>${coach.score}</strong>
        <span>/100</span>
      </div>
    </div>
    <div class="coach-disclaimer">
      Rule-based signal, not a ground-truth quality score. It starts at 100 and subtracts for missing boundaries, weak output contract, high token load, many tools, repeated work, failures, and edits without verification.
    </div>
    <div class="coach-grid">
      <div class="coach-card">
        <div class="coach-card-title">Why this prompt behaved this way</div>
        <div class="coach-issues">
          ${coach.issues.map(renderCoachIssue).join('')}
        </div>
      </div>
      <div class="coach-card">
        <div class="coach-card-title">Cheaper next prompt</div>
        <pre class="coach-rewrite">${escapeHtml(coach.rewrite)}</pre>
      </div>
    </div>
    <div class="ollama-coach" data-trace-id="${traceId}">
      <div class="ollama-copy">
        <strong>Local model second opinion</strong>
        <span>Runs on Ollama, so it does not spend cloud tokens. Use it for prompt scoring, skill usefulness, repeated-tool diagnosis, and agent workflow critique.</span>
      </div>
      <div class="ollama-form" data-ollama-form>
        <select name="model" ${ollamaModels.length === 0 ? 'disabled' : ''}>
          ${ollamaModels.length > 0
            ? ollamaModels.map((model) => `<option value="${escapeHtml(model)}">${escapeHtml(model)}</option>`).join('')
            : '<option value="">Ollama unavailable</option>'}
        </select>
        <button type="button" data-ollama-button ${ollamaModels.length === 0 ? 'disabled' : ''}>Ask Ollama</button>
      </div>
      <div class="ollama-output" data-ollama-output>
        ${savedReview ? renderSavedTraceReview(savedReview) : ''}
      </div>
    </div>
  </section>`
}

function renderCoachIssue(issue: PromptCoachResult['issues'][number]): string {
  return `<div class="coach-issue coach-issue-${issue.tone}">
    <div class="coach-issue-top">
      <strong>${escapeHtml(issue.title)}</strong>
      ${issue.source ? `<span class="coach-source">${escapeHtml(issue.source)}</span>` : ''}
    </div>
    <div class="coach-issue-summary">${escapeHtml(issue.body)}</div>
    <div class="coach-issue-facts">
      ${renderCoachFact('Evidence', issue.evidence)}
      ${renderCoachFact('Impact', issue.impact)}
      ${renderCoachFact('Fix', issue.fix)}
    </div>
  </div>`
}

function renderCoachFact(label: string, value?: string): string {
  if (!value) return ''
  return `<div class="coach-fact">
    <b>${escapeHtml(label)}</b>
    <span>${escapeHtml(value)}</span>
  </div>`
}

function renderSavedTraceReview(review: TraceReviewRow): string {
  return renderOllamaReview({
    model: review.model,
    review: {
      response: review.response ?? '',
      thinking: review.thinking ?? '',
    },
    createdAt: review.created_at,
    persisted: true,
  })
}

async function listOllamaModels(): Promise<string[]> {
  try {
    const res = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(350) })
    if (!res.ok) return []
    const body = await res.json() as { models?: Array<{ name?: string }> }
    return (body.models ?? [])
      .map((model) => model.name)
      .filter((name): name is string => Boolean(name && !name.includes('embed')))
      .slice(0, 6)
  } catch {
    return []
  }
}

type OllamaReview = {
  response: string
  thinking: string
}

async function askOllama(model: string, prompt: string): Promise<OllamaReview> {
  const res = await fetch('http://127.0.0.1:11434/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      options: {
        temperature: 0.2,
        num_ctx: 8192,
        num_predict: 1200,
      },
    }),
    signal: AbortSignal.timeout(300_000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const body = await res.json() as { response?: string; thinking?: string; error?: string }
  if (body.error) throw new Error(body.error)
  return {
    response: body.response?.trim() ?? '',
    thinking: body.thinking?.trim() ?? '',
  }
}

function renderOllamaReview(args: { model: string; review: OllamaReview; createdAt?: number; persisted?: boolean }): string {
  const { model, review } = args
  const final = review.response || extractVerdictFromThinking(review.thinking)
  const reasoningOnly = !review.response && review.thinking
  const empty = !final && !review.thinking

  return `<div class="ollama-result">
    <div class="ollama-result-head">
      <span class="badge badge-pass">local</span>
      <strong>${escapeHtml(model)}</strong>
      ${args.persisted ? '<span class="badge badge-info">saved</span>' : ''}
      ${reasoningOnly ? '<span class="badge badge-warn">reasoning-only</span>' : ''}
      ${args.createdAt ? `<span class="ollama-saved-at">${new Date(args.createdAt).toLocaleString()}</span>` : ''}
    </div>
    ${empty ? `<div class="ollama-empty">Ollama returned an empty answer. Try the other local model or press Ask Ollama again.</div>` : ''}
    ${final ? `<div class="ollama-final">
      <div class="ollama-section-title">Final verdict</div>
      <div class="answer-markdown">${renderAssistantMarkdown(final)}</div>
    </div>` : ''}
    ${review.thinking ? `<details class="ollama-reasoning" ${reasoningOnly ? 'open' : ''}>
      <summary>Debug reasoning ${reasoningOnly ? '· model did not emit a clean final answer' : ''}</summary>
      ${renderThinkingSections(review.thinking)}
    </details>` : ''}
  </div>`
}

function extractVerdictFromThinking(thinking: string): string {
  if (!thinking) return ''
  const draft = thinking.match(/Draft[^:]*:\s*([\s\S]*?)(?:\n\s*\d+\.\s+\*\*Check|\n\s*Check Constraints|\n\s*All constraints|$)/i)
  const source = (draft?.[1] ?? thinking).replace(/\s*\*Bullet\s+\d+:\s*/gi, '\n- ')
  const bulletLines = source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .slice(0, 8)
  if (bulletLines.length > 0) {
    return bulletLines.map((line) => {
      const text = line.replace(/^[-*]\s*/, '').trim()
      return `- ${normalizeVerdictBullet(text)}`
    }).join('\n')
  }
  const sentences = source
    .replace(/\*\*/g, '')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 4)
  return sentences.length > 0 ? sentences.map((s) => `- ${s}`).join('\n') : ''
}

function normalizeVerdictBullet(text: string): string {
  return text
    .replace(/^\*([^*:\n]{2,80}):\*\s*/i, '**$1:** ')
    .replace(/^([^*:\n]{2,80})\*\s+/i, '**$1:** ')
    .replace(/^([^:.\n]{2,80}):\s+/i, '**$1:** ')
}

function renderThinkingSections(thinking: string): string {
  const sections = splitThinkingSections(thinking)
  if (sections.length === 0) {
    return `<pre class="ollama-thinking-raw">${escapeHtml(thinking)}</pre>`
  }
  return `<div class="ollama-thinking-sections">
    ${sections.map((section) => `<section class="ollama-thinking-section">
      <div class="ollama-section-title">${escapeHtml(section.title)}</div>
      <div class="answer-markdown">${renderAssistantMarkdown(section.body)}</div>
    </section>`).join('')}
  </div>`
}

function splitThinkingSections(thinking: string): Array<{ title: string; body: string }> {
  const lines = thinking.replace(/\r\n/g, '\n').split('\n')
  const sections: Array<{ title: string; body: string[] }> = []
  let current: { title: string; body: string[] } | null = null

  for (const raw of lines) {
    const line = raw.trim()
    const numbered = line.match(/^\d+\.\s+\*\*([^*]+)\*\*:?\s*$/)
    const plain = line.match(/^(Analyze User Input|Identify Key Requirements|Draft[^:]*|Check Constraints|Mental Refinement|Input Data):?\s*$/i)
    if (numbered || plain) {
      if (current) sections.push(current)
      current = { title: numbered?.[1] ?? plain?.[1] ?? 'Reasoning', body: [] }
      continue
    }
    if (!current) current = { title: 'Reasoning', body: [] }
    current.body.push(raw)
  }
  if (current) sections.push(current)

  return sections
    .map((section) => ({ title: section.title.trim(), body: section.body.join('\n').trim() }))
    .filter((section) => section.body)
}

function durationPoint(index: number, count: number, startedAt: number, duration: number): number {
  return startedAt + Math.round(((index + 1) / (count + 1)) * duration)
}

function toReplayTool(tool: ToolEventView): ReplayTool {
  return {
    name: tool.tool_name,
    label: tool.tool_input_preview ?? tool.tool_name,
    input: tool.tool_input_preview,
  }
}

function findFirstPrompt(spans: SpanRow[]): string | null {
  for (const span of spans) {
    const conv = extractConversation(span.provider, span.request_body, span.response_body)
    const user = conv.messages.find((m) => m.role === 'user' && m.text.trim())
    if (user) return user.text.trim()
  }
  return null
}

function findLastAssistantText(spans: SpanRow[]): string | null {
  const candidates: Array<{ text: string; provider: string }> = []
  for (const span of [...spans].reverse()) {
    const conv = extractConversation(span.provider, span.request_body, span.response_body)
    const assistant = [...conv.messages].reverse().find((m) => m.role === 'assistant' && m.text.trim())
    if (assistant) candidates.push({ text: assistant.text.trim(), provider: span.provider })
  }
  if (candidates.length === 0) return null

  const first = candidates[0]
  if (isClaudeTerminalRecap(first.text) && candidates.length > 1) {
    const richer = candidates.find((candidate) => candidate.text.length >= 800 && !isClaudeTerminalRecap(candidate.text))
    if (richer) return richer.text
  }
  return first.text
}

function isClaudeTerminalRecap(text: string): boolean {
  const normalized = text.trim()
  if (normalized.length > 700) return false
  return /^(Verified|Recap|Summary|Implemented|Fixed|Updated)\b/i.test(normalized)
    && /\b(found|against|fixed|updated|implemented|must-fix|summary|recap)\b/i.test(normalized)
}

function renderAssistantMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const html: string[] = []
  let paragraph: string[] = []
  let list: { type: 'ul' | 'ol'; items: string[] } | null = null
  let code: { lang: string; lines: string[] } | null = null

  const flushParagraph = () => {
    if (paragraph.length === 0) return
    html.push(`<p>${renderInlineMarkdown(paragraph.join(' '))}</p>`)
    paragraph = []
  }
  const flushList = () => {
    if (!list) return
    html.push(`<${list.type}>${list.items.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join('')}</${list.type}>`)
    list = null
  }
  const closeBlocks = () => {
    flushParagraph()
    flushList()
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fence = line.match(/^```([A-Za-z0-9_-]*)\s*$/)
    if (fence) {
      if (code) {
        html.push(`<pre class="md-code"><code>${escapeHtml(code.lines.join('\n'))}</code></pre>`)
        code = null
      } else {
        closeBlocks()
        code = { lang: fence[1] ?? '', lines: [] }
      }
      continue
    }
    if (code) {
      code.lines.push(line)
      continue
    }

    const trimmed = line.trim()
    if (!trimmed) {
      closeBlocks()
      continue
    }

    if (isMarkdownTableRow(trimmed) && isMarkdownTableDivider(lines[i + 1]?.trim() ?? '')) {
      closeBlocks()
      const tableLines = [trimmed, lines[i + 1].trim()]
      i += 2
      while (i < lines.length && isMarkdownTableRow(lines[i].trim())) {
        tableLines.push(lines[i].trim())
        i++
      }
      i--
      html.push(renderMarkdownTable(tableLines))
      continue
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/)
    if (heading) {
      closeBlocks()
      const level = heading[1].length + 2
      html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`)
      continue
    }

    const bullet = trimmed.match(/^[-*]\s+(.+)$/)
    if (bullet) {
      flushParagraph()
      if (!list || list.type !== 'ul') {
        flushList()
        list = { type: 'ul', items: [] }
      }
      list.items.push(bullet[1])
      continue
    }

    const ordered = trimmed.match(/^\d+\.\s+(.+)$/)
    if (ordered) {
      flushParagraph()
      if (!list || list.type !== 'ol') {
        flushList()
        list = { type: 'ol', items: [] }
      }
      list.items.push(ordered[1])
      continue
    }

    flushList()
    paragraph.push(trimmed)
  }

  if (code) html.push(`<pre class="md-code"><code>${escapeHtml(code.lines.join('\n'))}</code></pre>`)
  closeBlocks()
  return html.join('')
}

function isMarkdownTableRow(line: string): boolean {
  return line.startsWith('|') && line.endsWith('|') && line.split('|').length >= 4
}

function isMarkdownTableDivider(line: string): boolean {
  if (!isMarkdownTableRow(line)) return false
  return splitMarkdownTableRow(line).every((cell) => /^:?-{3,}:?$/.test(cell.trim()))
}

function splitMarkdownTableRow(line: string): string[] {
  return line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim())
}

function renderMarkdownTable(lines: string[]): string {
  const header = splitMarkdownTableRow(lines[0])
  const rows = lines.slice(2).map(splitMarkdownTableRow)
  return `<div class="md-table-wrap"><table class="md-table">
    <thead><tr>${header.map((cell) => `<th>${renderInlineMarkdown(cell)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((row) => `<tr>${header.map((_h, index) => `<td>${renderInlineMarkdown(row[index] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>`
}

function renderInlineMarkdown(text: string): string {
  const parts = text.split(/(`[^`]+`)/g)
  return parts.map((part) => {
    if (part.startsWith('`') && part.endsWith('`')) return `<code>${escapeHtml(part.slice(1, -1))}</code>`
    return escapeHtml(part)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, label: string, href: string) => {
        const safeHref = String(href).startsWith('javascript:') ? '#' : href
        return `<a href="${escapeHtml(safeHref)}">${label}</a>`
      })
  }).join('')
}

function renderReplaySteps(spans: SpanRow[], toolEvents: ToolEventView[], t0: number, totalMs: number): string {
  const items = [
    ...spans.map((span) => ({ kind: 'span' as const, at: span.started_at, span })),
    ...toolEvents.map((tool) => ({ kind: 'tool' as const, at: tool.invoked_at, tool })),
  ].sort((a, b) => a.at - b.at)

  if (items.length === 0) return '<div class="empty-state compact">No steps captured</div>'

  return items.map((item, index) => {
    const offset = Math.max(0, item.at - t0)
    if (item.kind === 'tool') {
      const preview = item.tool.tool_input_preview ?? item.tool.tool_name
      return `<article class="replay-step tool-step">
        <div class="step-num">${String(index + 1).padStart(2, '0')}</div>
        <div class="step-body">
          <div class="step-head">
            <span class="step-type">tool</span>
            <strong>${escapeHtml(item.tool.tool_name)}</strong>
            ${item.tool.skill_name ? `<span class="step-chip">${escapeHtml(item.tool.skill_name)}</span>` : ''}
            <span class="step-time">+${fmtDuration(offset)}</span>
          </div>
          <pre class="tool-command">${escapeHtml(preview)}</pre>
        </div>
      </article>`
    }
    const cost = spanCost(item.span)
    const pct = Math.round((item.span.duration_ms / totalMs) * 100)
    return `<article class="replay-step model-step">
      <div class="step-num">${String(index + 1).padStart(2, '0')}</div>
      <div class="step-body">
        <div class="step-head">
          <span class="step-type">model</span>
          <strong>${escapeHtml(item.span.model ?? item.span.provider)}</strong>
          <span class="badge ${statusClass(item.span.status)}">${item.span.status}</span>
          <span class="step-time">+${fmtDuration(offset)} · ${fmtDuration(item.span.duration_ms)}</span>
        </div>
        <div class="step-meter">
          <span style="width:${Math.max(4, pct)}%"></span>
        </div>
        <div class="step-metrics">
          <span>in ${fmtTokens(item.span.input_tokens)}</span>
          <span>cache ${fmtTokens(item.span.cache_read_tokens)}</span>
          <span>out ${fmtTokens(item.span.output_tokens)}</span>
          <span>${cost > 0 ? fmtCost(cost) : 'price unknown'}</span>
        </div>
      </div>
    </article>`
  }).join('')
}

function renderToolCard(tool: ToolEventView, index: number): string {
  const replayTool = toReplayTool(tool)
  const command = commandFromTool(replayTool)
  const preview = toolPreview(replayTool)
  return `<article class="harness-tool-card">
    <div class="tool-card-side">
      <div class="tool-index">${String(index).padStart(2, '0')}</div>
      <div class="tool-kind">${escapeHtml(tool.skill_name ?? 'tool')}</div>
    </div>
    <div class="tool-card-main">
      <div class="tool-card-head">
        <h3>${escapeHtml(tool.tool_name)}</h3>
        <span class="badge badge-pass">captured</span>
      </div>
      <pre class="tool-command">${escapeHtml(command)}</pre>
      ${preview !== command ? `<div class="tool-preview">${escapeHtml(preview)}</div>` : ''}
    </div>
  </article>`
}

function signalRows(args: {
  repeated: ReturnType<typeof repeatedTools>
  replayTools: ReplayTool[]
  t: { total_input_tokens: number; total_output_tokens: number; total_cache_read_tokens: number; span_count: number }
  totalCost: number
  hit: number
  lastStatus: number
}): string {
  const skills = summarizeSkills(args.replayTools)
  const hasCode = skills.some((s) => s.key === 'code')
  const hasVerify = skills.some((s) => s.key === 'verify')
  const signals: Array<{ tone: string; label: string; body: string }> = []
  const load = args.t.total_input_tokens + args.t.total_output_tokens + args.t.total_cache_read_tokens

  if (args.totalCost > 0) signals.push({ tone: 'good', label: 'priced', body: `${fmtCost(args.totalCost)} estimated from model card.` })
  else signals.push({ tone: 'neutral', label: 'unpriced', body: 'Model price is unknown; use token load.' })
  if (load >= 50_000) signals.push({ tone: 'warn', label: 'context-heavy', body: `${fmtTokens(load)} token load.` })
  if (args.hit < 30 && args.t.total_input_tokens > 10_000) signals.push({ tone: 'warn', label: 'cold cache', body: `${args.hit}% cache hit.` })
  if (args.repeated.length > 0) {
    const top = args.repeated[0]
    signals.push({ tone: 'warn', label: 'repeated work', body: `${top.command} ran ${top.count} times.` })
  }
  if (hasCode && !hasVerify) signals.push({ tone: 'warn', label: 'missing verification', body: 'Code changed, no check detected.' })
  if (hasVerify) signals.push({ tone: 'good', label: 'verified', body: 'Checks or browser QA were captured.' })
  if (args.lastStatus >= 400) signals.push({ tone: 'bad', label: 'failure', body: `Last status ${args.lastStatus}.` })

  return signals.map((s) => `<div class="signal-row signal-${s.tone}">
    <strong>${escapeHtml(s.label)}</strong>
    <span>${escapeHtml(s.body)}</span>
  </div>`).join('')
}
