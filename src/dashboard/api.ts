/**
 * Dashboard API handlers — return small HTML fragments that htmx swaps into
 * the page. Each handler is pure: parse query params → run query → format.
 */

import { Hono } from 'hono'
import {
  clearTelemetry,
  extractConversation,
  queryByModel,
  queryCacheBuckets,
  queryModelUsageSince,
  queryRecentSpans,
  queryRecentTraces,
  querySkillAgg,
  querySpanById,
  querySpanCostFields,
  queryStats,
  querySpansByTraceId,
  queryToolAgg,
  queryToolFootprints,
  queryToolsForSpan,
  queryToolsForTrace,
  queryTraceById,
} from '../db'
import { costUSD } from '../prices'
import { summarizeCodexTurnFromRequestBody } from '../codexSession'
import {
  buildEfficiencyBadges,
  buildVerdict,
  commandFromTool,
  median,
  repeatedTools,
  summarizeSkills,
  toolPreview,
  type EfficiencyBadge,
  type Verdict,
} from '../analysis'
import { renderConversationMessage } from './conversation'
import {
  cacheHitRate,
  callsClass,
  costClass,
  durationClass,
  escapeHtml,
  fmtCost,
  fmtCount,
  fmtDuration,
  fmtTokens,
  parseTimespan,
  statusClass,
  timeAgo,
  tryPrettyJson,
} from './render'

export const api = new Hono()

api.post('/api/admin/clear', async (c) => {
  await clearTelemetry()
  return c.json({ ok: true })
})

type ToolGroup = {
  key: string
  label: string
  count: number
  intent: string
  items: Array<{ name: string; label: string; input: string | null; preview: string }>
}

function groupCodexTools(tools: Array<{ name: string; label: string; input: string | null }>): ToolGroup[] {
  return summarizeSkills(tools).map((skill) => ({
    key: skill.key,
    label: skill.label,
    intent: skill.intent,
    count: skill.count,
    items: skill.tools.map((tool) => ({
      name: tool.name,
      label: tool.label,
      input: tool.input,
      preview: tool.preview,
    })),
  }))
}

function renderToolGroups(tools: Array<{ name: string; label: string; input: string | null }>, limitPerGroup = 5): string {
  const groups = groupCodexTools(tools)
  if (groups.length === 0) return ''
  return `<div class="tool-groups">
    ${groups.map((g) => `<div class="tool-group tool-group-${g.key}">
      <div class="tool-group-head">
        <span title="${escapeHtml(g.intent)}">${escapeHtml(g.label)}</span>
        <strong>${g.count}</strong>
      </div>
      <div class="tool-group-items">
        ${g.items.slice(0, limitPerGroup).map((t) => `<details class="codex-tool">
          <summary><span class="pill" style="background:var(--olive-soft);color:var(--olive)">${escapeHtml(t.name)}</span> ${escapeHtml(t.preview)}</summary>
          ${t.input ? `<pre>${escapeHtml(t.input)}</pre>` : ''}
        </details>`).join('')}
        ${g.items.length > limitPerGroup ? `<div class="tool-more">+${g.items.length - limitPerGroup} more in this group</div>` : ''}
      </div>
    </div>`).join('')}
  </div>`
}

function renderWorkflow(notes: string[], tools: Array<{ name: string; label: string; input: string | null }>): string {
  const groups = groupCodexTools(tools)
  const steps = [
    ...notes.slice(0, 3).map((n) => ({ label: 'Agent note', text: n })),
    ...groups.map((g) => ({ label: g.label, text: `${g.count} ${g.count === 1 ? 'tool call' : 'tool calls'}` })),
  ].slice(0, 8)
  if (steps.length === 0) return ''
  return `<div class="workflow-strip">
    ${steps.map((s, i) => `<div class="workflow-step">
      <span class="workflow-index">${i + 1}</span>
      <div>
        <div class="workflow-label">${escapeHtml(s.label)}</div>
        <div class="workflow-text">${escapeHtml(s.text.length > 140 ? s.text.slice(0, 140) + '...' : s.text)}</div>
      </div>
    </div>`).join('')}
  </div>`
}

function answerPreview(answer: string): string {
  return answer.length > 1800 ? answer.slice(0, 1800) + '\n\n... answer continues in session log' : answer
}

function renderEfficiencyBadges(badges: EfficiencyBadge[]): string {
  if (badges.length === 0) return ''
  return `<div class="eff-badges">
    ${badges.map((b) => `<span class="eff-badge eff-${b.tone}" title="${escapeHtml(b.title)}">${escapeHtml(b.label)}</span>`).join('')}
  </div>`
}

function renderVerdict(verdict: Verdict): string {
  return `<div class="verdict-card verdict-${verdict.tone}">
    <div class="verdict-kicker">Verdict</div>
    <div class="verdict-title">${escapeHtml(verdict.title)}</div>
    <div class="verdict-summary">${escapeHtml(verdict.summary)}</div>
    <div class="verdict-compare">${escapeHtml(verdict.compare)}</div>
  </div>`
}

function concretePromptSuggestion(tools: Array<{ name: string; label: string; input: string | null }>, totalLoad: number): string {
  const skills = summarizeSkills(tools)
  if (skills.some((s) => s.key === 'code')) {
    return 'Ask for a closed loop: "Make the smallest patch, then run the nearest typecheck/test and report failures only."'
  }
  if (skills.some((s) => s.key === 'mcp')) {
    return 'Instead of repeating discovery, ask: "Use the already discovered MCP list; only verify whether the needed server is connected."'
  }
  if (skills.some((s) => s.key === 'browser')) {
    return 'Ask for a browser QA target: "Open this exact URL, check these 3 states, and report only failures with screenshots."'
  }
  if (skills.some((s) => s.key === 'research')) {
    return 'Constrain research: "Search only these files/directories first; stop after the first matching implementation path."'
  }
  if (totalLoad > 30_000) {
    return 'Ask for evidence explicitly: "Inspect the exact files needed before answering; do not infer from broad context."'
  }
  return 'Keep this prompt shape; compare the next run against this trace before changing workflow.'
}

function renderTraceInsights(args: {
  totalInput: number
  totalOutput: number
  cacheRead: number
  cacheWrite: number
  hit: number
  spanCount: number
  duration: number
  totalCost: number
  localTools: Array<{ name: string; label: string; input: string | null }>
  localNotes: number
  maxContextIn: number
}): string {
  const totalSeenInput = args.totalInput + args.cacheRead
  const items: Array<{ tone: 'good' | 'warn' | 'bad' | 'neutral'; title: string; body: string }> = []
  const skills = summarizeSkills(args.localTools)

  if (args.totalCost > 0) {
    const tone = args.totalCost >= 0.5 ? 'bad' : args.totalCost >= 0.1 ? 'warn' : 'good'
    items.push({
      tone,
      title: `${fmtCost(args.totalCost)} estimated spend`,
      body: tone === 'good'
        ? 'This trace looks cheap by known model pricing.'
        : 'Worth opening the call list below and checking the largest cost driver.',
    })
  } else if (totalSeenInput > 0 || args.totalOutput > 0) {
    const tokenLoad = totalSeenInput + args.totalOutput
    items.push({
      tone: tokenLoad >= 200_000 ? 'bad' : tokenLoad >= 50_000 ? 'warn' : 'neutral',
      title: `${fmtTokens(tokenLoad)} total token load`,
      body: 'Price is unknown for this model here, so token load is the best cost proxy.',
    })
  }

  if (args.cacheRead > 0) {
    items.push({
      tone: args.hit >= 60 ? 'good' : 'warn',
      title: `${args.hit}% cache hit`,
      body: args.hit >= 60
        ? `${fmtTokens(args.cacheRead)} input tokens were reused instead of sent fresh.`
        : 'Some context was reused, but most input was still fresh.',
    })
  } else if (args.totalInput > 10_000) {
    items.push({
      tone: 'warn',
      title: 'No cache benefit',
      body: `${fmtTokens(args.totalInput)} fresh input tokens went through without cache reads.`,
    })
  }

  if (args.localTools.length > 0) {
    const tokensPerTool = Math.round((totalSeenInput + args.totalOutput) / args.localTools.length)
    const topSkill = skills[0]
    items.push({
      tone: tokensPerTool > 80_000 ? 'warn' : 'neutral',
      title: `${args.localTools.length} tool ${args.localTools.length === 1 ? 'call' : 'calls'}`,
      body: `${fmtTokens(tokensPerTool)} tokens per tool call${topSkill ? `; dominant skill: ${topSkill.label}.` : '.'}`,
    })
  } else {
    items.push({
      tone: args.spanCount > 1 ? 'warn' : 'neutral',
      title: 'No local tools detected',
      body: args.spanCount > 1
        ? 'Network calls happened, but no local Codex tools were found in the session transcript.'
        : 'This was mostly model reasoning from existing context, not an active tool workflow.',
    })
  }

  if (args.maxContextIn >= 500_000) {
    items.push({
      tone: 'bad',
      title: `${fmtTokens(args.maxContextIn)} context peak`,
      body: 'Very large context. This is where prompt trimming and smaller task scope matter most.',
    })
  } else if (args.maxContextIn >= 100_000) {
    items.push({
      tone: 'warn',
      title: `${fmtTokens(args.maxContextIn)} context peak`,
      body: 'Large enough to watch. Repeated broad file reads can make this climb quickly.',
    })
  }

  if (args.localNotes > 0) {
    items.push({
      tone: 'neutral',
      title: `${args.localNotes} progress notes`,
      body: 'The workflow strip below shows how the agent explained its steps while working.',
    })
  }

  if (skills.some((s) => s.key === 'verify')) {
    items.push({
      tone: 'good',
      title: 'Verified workflow',
      body: 'Checks/tests/build steps appeared in the local tool sequence.',
    })
  } else if (skills.some((s) => s.key === 'code')) {
    items.push({
      tone: 'warn',
      title: 'Edits without visible verification',
      body: 'Code-edit tools appeared, but no verification skill was detected in this turn.',
    })
  }

  const unique = items.slice(0, 5)
  return `<div class="insight-grid">
    ${unique.map((item) => `<div class="insight-card insight-${item.tone}">
      <div class="insight-title">${escapeHtml(item.title)}</div>
      <div class="insight-body">${escapeHtml(item.body)}</div>
    </div>`).join('')}
  </div>`
}

function renderNextCheaperRun(args: {
  totalInput: number
  cacheRead: number
  output: number
  hit: number
  tools: Array<{ name: string; label: string; input: string | null }>
  spanCount: number
}): string {
  const tips: string[] = []
  const totalLoad = args.totalInput + args.cacheRead + args.output
  const skills = summarizeSkills(args.tools)
  const repeated = repeatedTools(args.tools)
  const hasCode = skills.some((s) => s.key === 'code')
  const hasVerify = skills.some((s) => s.key === 'verify')

  if (totalLoad >= 50_000) {
    tips.push(`Narrow the prompt because this turn loaded ${fmtTokens(totalLoad)} tokens. Name the exact files, command, or subsystem before asking for analysis.`)
  }
  if (args.hit < 30 && args.totalInput > 10_000) {
    tips.push(`Cache was cold at ${args.hit}%. Keep related work in the same thread or avoid restarting with broad context.`)
  }
  if (repeated.length > 0) {
    const top = repeated[0]
    tips.push(`${top.command} ran ${top.count} times. That can mean broad search or repeated file reads; ask the agent to stop after the first implementation path.`)
  }
  if (hasCode && !hasVerify) {
    tips.push('Code was changed without visible verification. Add the nearest check, for example typecheck/build for TS or browser QA for UI.')
  } else if (skills.some((s) => s.key === 'research') && !hasVerify) {
    tips.push('Research happened without verification. Ask for one focused check after analysis so the run ends with evidence, not just reading.')
  }
  if (args.tools.length === 0 && totalLoad >= 30_000) {
    tips.push(`No tools were used despite ${fmtTokens(totalLoad)} token load. If you expect code evidence, ask the agent to inspect named files before answering.`)
  }
  if (args.spanCount >= 8) {
    tips.push('Many captured calls: check whether retries, failed calls, or broad exploration created extra work.')
  }
  if (skills.some((s) => s.key === 'mcp')) {
    tips.push('MCP calls were useful for capability discovery; after setup, avoid repeating discovery unless tools changed.')
  }
  tips.push(concretePromptSuggestion(args.tools, totalLoad))
  if (tips.length === 0) {
    tips.push('This trace looks reasonably focused. Keep the prompt shape and compare future traces against it.')
  }

  return `<ol class="recommendation-list">
    ${tips.slice(0, 4).map((tip) => `<li>${escapeHtml(tip)}</li>`).join('')}
  </ol>`
}

api.get('/api/stats', async (c) => {
  const range = c.req.query('range') ?? '1h'
  const provider = c.req.query('provider') || null
  const since = Date.now() - parseTimespan(range)
  const filters = { since, provider }

  const totals = await queryStats(filters)
  const traceCount = (await queryRecentTraces(filters, 500)).length
  const byModel = await queryByModel(filters)
  const totalCost = byModel.reduce(
    (a, r) => a + costUSD(r.model, r.in_t ?? 0, r.out_t ?? 0, r.cache_t ?? 0, r.cache_create_t ?? 0),
    0,
  )

  const inT = totals?.in_t ?? 0
  const outT = totals?.out_t ?? 0
  const cacheT = totals?.cache_t ?? 0
  const hit = cacheHitRate(inT, cacheT)

  // Average cost per trace — much more meaningful than 24h projection.
  const costPerTrace = traceCount > 0 ? totalCost / traceCount : 0

  // Sparkline: cache hit % per 10-min bucket over last hour.
  const bucketCount = 12
  const bucketMs = (60 * 60 * 1000) / bucketCount
  const sparkSince = Date.now() - 60 * 60 * 1000
  const sparkPoints: string[] = []
  let bucketsWithData = 0
  const buckets = await queryCacheBuckets(sparkSince, bucketMs, bucketCount)
  for (let i = 0; i < bucketCount; i++) {
    const row = buckets[i]
    const rate = cacheHitRate(row.in_t ?? 0, row.cache_t ?? 0)
    if ((row.in_t ?? 0) > 0 || (row.cache_t ?? 0) > 0) bucketsWithData++
    const x = (i / (bucketCount - 1)) * 100
    const y = 100 - rate
    sparkPoints.push(`${x.toFixed(1)},${y.toFixed(1)}`)
  }
  const sparkline = bucketsWithData >= 2
    ? `<svg viewBox="0 0 100 100" preserveAspectRatio="none" class="sparkline" aria-hidden="true">
         <polyline fill="none" stroke="var(--olive)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" points="${sparkPoints.join(' ')}"/>
       </svg>`
    : ''

  // Burn rate: cost over the last hour at current pace.
  const sinceBurn = Date.now() - 60 * 60 * 1000
  const burnParts = await Promise.all(byModel.map(async (r) => {
    const hr = await queryModelUsageSince(sinceBurn, r.model)
    return costUSD(r.model, hr.in_t, hr.out_t, hr.cache_t, hr.cache_create_t)
  }))
  const burnHour = burnParts.reduce((a, b) => a + b, 0)

  const stat = (label: string, value: string, sub = '', extra = '') =>
    `<div class="stat">
       <div class="stat-label">${label}</div>
       <div class="stat-value ${value.length > 10 ? 'stat-value-compact' : ''}">${value}</div>
       ${sub ? `<div class="stat-sub">${sub}</div>` : ''}
       ${extra}
     </div>`

  return c.html(
    stat(
      'turns · ' + range,
      fmtCount(traceCount),
      `${fmtCount(totals?.spans ?? 0)} captured calls · ${totals?.avg_ms ? fmtDuration(Math.round(totals.avg_ms)) + ' avg' : '—'}`,
    ) +
    stat(
      'tokens out / in',
      `${fmtTokens(outT)} / ${fmtTokens(inT + cacheT)}`,
      `${fmtTokens(cacheT)} were cache reads`,
    ) +
    stat(
      'cache hit',
      `${hit}%`,
      bucketsWithData >= 2 ? 'last hour trend' : `${fmtTokens(cacheT)} cached tokens`,
      sparkline,
    ) +
    stat(
      'cost signal · ' + range,
      traceCount === 0 ? 'no data yet' : totalCost > 0 ? fmtCost(totalCost) : 'price unknown',
      traceCount > 0
        ? totalCost > 0
          ? `${fmtCost(costPerTrace)} avg per trace · ${fmtCost(burnHour)}/h pace`
          : 'using token load until model price is configured'
        : 'run codex-debug or claude-debug to capture traffic',
    ),
  )
})

api.get('/api/traces', async (c) => {
  const range = c.req.query('range') ?? '1h'
  const provider = c.req.query('provider') || null
  const since = Date.now() - parseTimespan(range)
  const rows = await queryRecentTraces({ since, provider }, 50)

  if (rows.length === 0) {
    return c.html(`<tr><td colspan="9">
      <div class="empty-state">
        <h2>No traffic yet</h2>
        <p>Start an agent through the debugger and the first trace will appear here.</p>
        <div class="empty-commands">
          <code>codex-debug exec "hi"</code>
          <code>claude-debug -p "hi"</code>
        </div>
      </div>
    </td></tr>`)
  }

  // Pre-fetch tool footprint and per-span cost details in two queries (no N+1).
  const traceIds = rows.map((r) => r.id)
  const toolsMap = new Map<number, string[]>()
  if (traceIds.length > 0) {
    const rs = await queryToolFootprints(traceIds)
    for (const r of rs) {
      const arr = toolsMap.get(r.trace_id) ?? []
      arr.push(`${r.tool_name}×${r.n}`)
      toolsMap.set(r.trace_id, arr)
    }
  }
  const spanCostMap = await querySpanCostFields(traceIds)

  const html = rows.map((r) => {
    // Correct cost: sum costUSD over every span, using its own model.
    const spans = spanCostMap.get(r.id) ?? []
    const cost = spans.reduce(
      (acc, s) => acc + costUSD(s.model, s.in_t, s.out_t, s.cache_t, s.cache_create_t),
      0,
    )
    const tokenLoad = (r.total_input_tokens ?? 0) + (r.total_output_tokens ?? 0) + (r.total_cache_read_tokens ?? 0)
    const costText = cost > 0 ? fmtCost(cost) : tokenLoad > 0 ? 'unknown' : '—'
    const duration = r.ended_at - r.started_at
    const prompt = r.first_prompt
      ? (r.first_prompt.length > 75 ? r.first_prompt.slice(0, 75) + '…' : r.first_prompt)
      : '(no prompt)'
    const tools = (toolsMap.get(r.id) ?? r.codex_tools ?? [])
    const badgeTools = tools.map((tool) => {
      const name = tool.replace(/×\d+$/, '')
      return { name, label: name, input: null }
    })
    const badges = buildEfficiencyBadges({
      input: r.total_input_tokens ?? 0,
      output: r.total_output_tokens ?? 0,
      cacheRead: r.total_cache_read_tokens ?? 0,
      spanCount: r.span_count,
      durationMs: duration,
      cost,
      tools: badgeTools,
      status: r.last_status,
    })
    const toolFootprint = tools.length > 0
      ? tools.slice(0, 4).map((t) => `<span class="tool-mini">${escapeHtml(t)}</span>`).join(' ')
      + (tools.length > 4 ? `<span class="tool-mini-more">+${tools.length - 4}</span>` : '')
      : '<span class="muted-dim">—</span>'

    const callsClassname = callsClass(r.span_count)
    const costClassname = costClass(cost)
    const durClassname = durationClass(duration)
    const statusBadge = r.last_status >= 400
      ? `<span class="badge ${statusClass(r.last_status)}" title="last status: ${r.last_status}">${r.last_status}</span>`
      : ''
    const internalTag = r.is_internal
      ? `<span class="internal-tag" title="auto-generated by client (${escapeHtml(r.internal_reason ?? '')})">internal</span>`
      : ''

    const rowClass = r.is_internal ? 'trace-row trace-internal' : 'trace-row'

    return `<tr class="${rowClass}"
      data-trace-url="/dashboard/trace/${r.id}"
      title="Open full trace replay">
      <td class="mono dim">#${r.id}</td>
      <td class="mono dim">${timeAgo(r.started_at)}</td>
      <td>
        <span class="pill pill-${r.provider}">${r.provider}</span>
        ${statusBadge}
        ${internalTag}
      </td>
      <td class="prompt-cell" title="${escapeHtml(r.first_prompt ?? '')}">
        <div class="prompt-main">${escapeHtml(prompt)}</div>
        ${renderEfficiencyBadges(badges)}
      </td>
      <td class="r"><span class="calls-pill ${callsClassname}">${r.span_count}</span></td>
      <td class="r tokens-cell">${fmtTokens(r.total_input_tokens ?? 0)}<span class="sep">·</span>${fmtTokens(r.total_output_tokens ?? 0)}${r.total_cache_read_tokens ? `<span class="sep">·</span><span class="cache">${fmtTokens(r.total_cache_read_tokens)}</span>` : ''}</td>
      <td class="tools-cell">${toolFootprint}</td>
      <td class="r mono ${durClassname}">${fmtDuration(duration)}</td>
      <td class="r mono cost-cell ${costClassname}" title="${cost > 0 ? '' : 'Model price is not configured; use token load as the cost signal.'}">${costText}</td>
    </tr>`
  }).join('')

  return c.html(html)
})

api.get('/api/trace/:id/expanded', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return c.html('<div class="detail-empty">invalid id</div>')
  const trace = await queryTraceById(id)
  if (!trace) return c.html('<div class="detail-empty">trace not found</div>')

  const spans = await querySpansByTraceId(id)
  const localTraceCodex = spans
    .map((s) => summarizeCodexTurnFromRequestBody(s.request_body))
    .find(Boolean)
  const persistedToolRows = await queryToolsForTrace(id)
  const persistedTools = persistedToolRows.flatMap((row) =>
    Array.from({ length: Math.max(1, row.n) }, () => ({ name: row.tool_name, label: row.tool_name, input: null }))
  )
  const analysisTools = localTraceCodex?.tools.length ? localTraceCodex.tools : persistedTools
  const totalCost = spans.reduce(
    (a, s) => a + costUSD(s.model, s.input_tokens ?? 0, s.output_tokens ?? 0, s.cache_read_tokens ?? 0, s.cache_creation_tokens ?? 0),
    0,
  )
  const totalTokenLoadForCost = (trace.total_input_tokens ?? 0) + (trace.total_output_tokens ?? 0) + (trace.total_cache_read_tokens ?? 0)
  const costDisplay = totalCost > 0 ? fmtCost(totalCost) : totalTokenLoadForCost > 0 ? 'price unknown' : '—'
  const totalIn = (trace.total_input_tokens ?? 0) + (trace.total_cache_read_tokens ?? 0)
  const hit = totalIn > 0 ? Math.round(((trace.total_cache_read_tokens ?? 0) / totalIn) * 100) : 0
  const duration = trace.ended_at - trace.started_at

  // Derived metrics
  const totalOut = trace.total_output_tokens ?? 0
  const tokensPerSec = duration > 0 ? Math.round((totalOut / duration) * 1000) : 0

  // Largest single span (cost-driver)
  let mostExpensive = spans[0] ?? null
  let mostExpensiveCost = 0
  for (const s of spans) {
    const c = costUSD(s.model, s.input_tokens ?? 0, s.output_tokens ?? 0, s.cache_read_tokens ?? 0, s.cache_creation_tokens ?? 0)
    if (c > mostExpensiveCost) { mostExpensive = s; mostExpensiveCost = c }
  }

  // Max input observed (closest to context-window limit)
  const maxContextIn = spans.reduce(
    (a, s) => Math.max(a, (s.input_tokens ?? 0) + (s.cache_read_tokens ?? 0)),
    0,
  )
  // Anthropic Opus 4.7 = 1M context. Most models: 200k. Use larger of the two as denominator.
  const contextWindow = 1_000_000
  const contextUtil = Math.round((maxContextIn / contextWindow) * 100)

  const spanRows = spans.map((s) => {
    const cost = costUSD(s.model, s.input_tokens ?? 0, s.output_tokens ?? 0, s.cache_read_tokens ?? 0, s.cache_creation_tokens ?? 0)
    const widthPct = totalCost > 0 ? Math.max(2, (cost / totalCost) * 100) : 0
    return `<div class="span-mini"
      hx-get="/api/span/${s.id}"
      hx-target="#detail-pane"
      hx-swap="innerHTML">
      <div class="span-mini-head">
        <span class="mono">#${s.id}</span>
        <span class="mono" style="color:var(--muted);flex:1">${escapeHtml(s.model ?? '—')}</span>
        ${s.is_stream ? '<span class="pill pill-stream" style="font-size:9px">SSE</span>' : ''}
        <span class="badge ${statusClass(s.status)}" style="font-size:9px">${s.status}</span>
      </div>
      <div class="span-mini-meta">
        ${fmtDuration(s.duration_ms)} ·
        in=${fmtTokens(s.input_tokens)} ·
        out=${fmtTokens(s.output_tokens)}${s.cache_read_tokens ? ` · <span style="color:var(--olive)">cache=${fmtTokens(s.cache_read_tokens)}</span>` : ''}${s.cache_creation_tokens ? ` · <span style="color:var(--brown)">cw=${fmtTokens(s.cache_creation_tokens)}</span>` : ''} ·
        <strong>${fmtCost(cost)}</strong>
      </div>
      <div class="cost-bar" title="${(cost / Math.max(totalCost, 0.0001) * 100).toFixed(1)}% of trace cost">
        <div class="cost-bar-fill" style="width:${widthPct.toFixed(1)}%"></div>
      </div>
    </div>`
  }).join('')

  const modelsLine = (() => {
    const set = new Set(spans.map((s) => s.model).filter(Boolean) as string[])
    if (set.size === 0) return ''
    return [...set].join(', ')
  })()
  const baselineTurns = await queryRecentTraces({ since: trace.started_at - 24 * 60 * 60 * 1000, provider: trace.provider }, 50)
  const baselineRows = baselineTurns.filter((r) => r.id !== trace.id)
  const baseline = baselineRows.length >= 2
    ? {
        sampleSize: baselineRows.length,
        medianTokenLoad: median(baselineRows.map((r) => (r.total_input_tokens ?? 0) + (r.total_output_tokens ?? 0) + (r.total_cache_read_tokens ?? 0))),
        medianCacheHit: median(baselineRows.map((r) => {
          const denom = (r.total_input_tokens ?? 0) + (r.total_cache_read_tokens ?? 0)
          return denom > 0 ? Math.round(((r.total_cache_read_tokens ?? 0) / denom) * 100) : 0
        })),
      }
    : null
  const verdict = buildVerdict({
    input: trace.total_input_tokens ?? 0,
    output: totalOut,
    cacheRead: trace.total_cache_read_tokens ?? 0,
    spanCount: trace.span_count,
    cost: totalCost,
    status: spans.some((s) => s.status >= 400) ? Math.max(...spans.map((s) => s.status)) : 200,
    tools: analysisTools,
  }, baseline)

  return c.html(`
<div class="detail-header">
  <div class="detail-h1">Trace #${trace.id}</div>
  <div class="detail-meta">${escapeHtml(trace.external_id ?? '(no external id)')} · runtime ${trace.provider}</div>
  <div class="detail-pills">
    <span class="metric-pill"><strong>${trace.span_count}</strong> ${trace.span_count === 1 ? 'call' : 'calls'}</span>
    <span class="metric-pill">${fmtDuration(duration)}</span>
    <span class="metric-pill cost-pill"><strong>${costDisplay}</strong></span>
  </div>
</div>

<div class="detail-section">
  ${renderVerdict(verdict)}
</div>

<div class="detail-section">
  <h3>Token economics</h3>
  <div class="kv">
    <div class="k">output</div><div class="v">${fmtCount(totalOut)}</div>
    <div class="k">fresh input</div><div class="v">${fmtCount(trace.total_input_tokens)}</div>
    <div class="k">cache reads</div><div class="v" style="color:var(--olive)">${fmtCount(trace.total_cache_read_tokens)}</div>
    ${trace.total_cache_creation_tokens ? `<div class="k">cache writes</div><div class="v" style="color:var(--brown)">${fmtCount(trace.total_cache_creation_tokens)}</div>` : ''}
    <div class="k">cache hit</div><div class="v">${hit}% <span class="muted-dim" style="margin-left:6px">${hit >= 90 ? 'excellent' : hit >= 60 ? 'good' : hit >= 20 ? 'cold' : 'no cache'}</span></div>
    <div class="k">throughput</div><div class="v">${tokensPerSec} tokens/s output</div>
    <div class="k">context peak</div><div class="v">${fmtTokens(maxContextIn)} <span class="muted-dim">(${contextUtil}% of 1M)</span></div>
  </div>
</div>

<div class="detail-section">
  <h3>Why tokens moved</h3>
  ${renderTraceInsights({
    totalInput: trace.total_input_tokens ?? 0,
    totalOutput: totalOut,
    cacheRead: trace.total_cache_read_tokens ?? 0,
    cacheWrite: trace.total_cache_creation_tokens ?? 0,
    hit,
    spanCount: trace.span_count,
    duration,
    totalCost,
    localTools: analysisTools,
    localNotes: localTraceCodex?.commentary.length ?? 0,
    maxContextIn,
  })}
</div>

<div class="detail-section">
  <h3>Next cheaper run</h3>
  ${renderNextCheaperRun({
    totalInput: trace.total_input_tokens ?? 0,
    cacheRead: trace.total_cache_read_tokens ?? 0,
    output: totalOut,
    hit,
    tools: analysisTools,
    spanCount: trace.span_count,
  })}
</div>

${localTraceCodex ? `
<div class="detail-section codex-transcript">
  <h3>Codex transcript</h3>
  ${renderWorkflow(localTraceCodex.commentary, localTraceCodex.tools)}
  ${localTraceCodex.prompt ? `
    <div class="codex-msg codex-user">
      <div class="codex-msg-label">user prompt</div>
      <pre>${escapeHtml(localTraceCodex.prompt)}</pre>
    </div>
  ` : ''}
  ${localTraceCodex.tools.length > 0 ? `
    <div class="codex-msg">
      <div class="codex-msg-label">tool work (${localTraceCodex.tools.length})</div>
      ${renderToolGroups(localTraceCodex.tools, 4)}
    </div>
  ` : ''}
  ${localTraceCodex.assistant ? `
    <div class="codex-msg codex-assistant">
      <div class="codex-msg-label">assistant answer</div>
      <pre>${escapeHtml(answerPreview(localTraceCodex.assistant))}</pre>
    </div>
  ` : ''}
</div>
` : ''}

${mostExpensive && totalCost > 0.005 ? `
<div class="detail-section">
  <h3>Biggest cost driver</h3>
  <div class="muted-dim" style="margin-bottom:6px">
    Span <a href="javascript:void(0)" hx-get="/api/span/${mostExpensive.id}" hx-target="#detail-pane" hx-swap="innerHTML" style="color:var(--brown);text-decoration:underline">#${mostExpensive.id}</a>
    ate <strong>${fmtCost(mostExpensiveCost)}</strong>
    (${Math.round((mostExpensiveCost / totalCost) * 100)}% of this trace).
  </div>
</div>
` : ''}

<div class="detail-section">
  <h3>LLM calls · ordered by time · bar = % of trace cost</h3>
  <div class="span-mini-list">
    ${spanRows}
  </div>
</div>

<div class="detail-section">
  <h3>Models used</h3>
  <div class="muted-dim" style="font-family:var(--font-mono);font-size:12px">${escapeHtml(modelsLine || '—')}</div>
</div>

<div class="detail-section">
  <h3>Open in full page</h3>
  <a href="/dashboard/trace/${trace.id}" style="color:var(--brown);font-family:var(--font-mono);font-size:13px">
    → /dashboard/trace/${trace.id}
  </a>
</div>
`)
})

api.get('/api/spans', async (c) => {
  const range = c.req.query('range') ?? '1h'
  const provider = c.req.query('provider') || null
  const since = Date.now() - parseTimespan(range)
  const rows = await queryRecentSpans({ since, provider }, 100)

  if (rows.length === 0) {
    return c.html(`<tr><td colspan="8">
      <div class="empty-state">
        <h2>No traffic yet</h2>
        <p>Start an agent through the debugger and captured calls will appear here.</p>
        <div class="empty-commands">
          <code>codex-debug exec "hi"</code>
          <code>claude-debug -p "hi"</code>
        </div>
      </div>
    </td></tr>`)
  }

  const html = rows.map((r) => {
    const cost = costUSD(r.model, r.input_tokens ?? 0, r.output_tokens ?? 0, r.cache_read_tokens ?? 0, r.cache_creation_tokens ?? 0)
    const providerPill = `<span class="pill pill-${r.provider}">${r.provider}</span>`
    const streamBadge = r.is_stream ? ' <span class="pill pill-stream">SSE</span>' : ''
    return `<tr class="span-row"
      hx-get="/api/span/${r.id}"
      hx-target="#detail-pane"
      hx-swap="innerHTML">
      <td class="mono">#${r.id}</td>
      <td class="mono">${timeAgo(r.started_at)}</td>
      <td>${providerPill}${streamBadge}</td>
      <td class="mono">${escapeHtml(r.model ?? '—')}</td>
      <td class="r">${fmtTokens(r.input_tokens)} · ${fmtTokens(r.output_tokens)}${r.cache_read_tokens ? ` · <span style="color:var(--olive)">${fmtTokens(r.cache_read_tokens)}c</span>` : ''}${r.cache_creation_tokens ? ` · <span style="color:var(--brown)">${fmtTokens(r.cache_creation_tokens)}w</span>` : ''}</td>
      <td class="r">${r.duration_ms}</td>
      <td class="r">${fmtCost(cost)}</td>
      <td class="c"><span class="badge ${statusClass(r.status)}">${r.status}</span></td>
    </tr>`
  }).join('')

  return c.html(html)
})

api.get('/api/skills', async (c) => {
  const range = c.req.query('range') ?? '1h'
  const provider = c.req.query('provider') || null
  const since = Date.now() - parseTimespan(range)

  const rows = await querySkillAgg({ since, provider })
  const localSkillMap = new Map<string, { label: string; n: number; intent: string }>()
  const recentTurns = await queryRecentTraces({ since, provider }, 50)
  for (const turn of recentTurns) {
    const spans = await querySpansByTraceId(turn.id)
    const local = spans.map((s) => summarizeCodexTurnFromRequestBody(s.request_body)).find(Boolean)
    if (!local) continue
    for (const skill of summarizeSkills(local.tools)) {
      const cur = localSkillMap.get(skill.key) ?? { label: skill.label, n: 0, intent: skill.intent }
      cur.n += skill.count
      localSkillMap.set(skill.key, cur)
    }
  }

  if (rows.length === 0 && localSkillMap.size === 0) {
    return c.html(`<div class="st-empty">
      <div class="st-empty-title">No workflow groups yet</div>
      <p>Skills appear after an agent uses local tools. They group raw tool calls into human-readable work like search, code edits, browser QA, or checks.</p>
    </div>`)
  }

  const dbHtml = rows.map((r) => {
    const models = (r.models ?? '').split(',').filter(Boolean)
    // Cost approximation: use first model's pricing. Multi-model traces under-report.
    const primaryModel = models[0] ?? null
    const cost = costUSD(primaryModel, r.in_t ?? 0, r.out_t ?? 0, r.cache_t ?? 0, r.cache_create_t ?? 0)
    return `<div class="st-row">
      <div class="name" title="${escapeHtml(r.skill_name)}">${escapeHtml(r.skill_name)}</div>
      <span class="n">${r.n} calls</span>
      <span class="tokens">${fmtTokens((r.in_t ?? 0) + (r.cache_t ?? 0))} in · ${fmtTokens(r.out_t ?? 0)} out</span>
      <span class="cost">${fmtCost(cost)}</span>
    </div>`
  }).join('')

  const localHtml = [...localSkillMap.values()]
    .sort((a, b) => b.n - a.n)
    .map((r) => `<div class="st-row">
      <div class="name" title="${escapeHtml(r.intent)}">${escapeHtml(r.label)}</div>
      <span class="n">${r.n} calls</span>
      <span class="tokens">local transcript</span>
      <span class="cost"></span>
    </div>`)
    .join('')

  return c.html((dbHtml + localHtml) || `<div class="st-empty">
    <div class="st-empty-title">No workflow groups yet</div>
    <p>Skills appear after local tool calls are captured.</p>
  </div>`)
})

api.get('/api/tools', async (c) => {
  const range = c.req.query('range') ?? '1h'
  const provider = c.req.query('provider') || null
  const since = Date.now() - parseTimespan(range)

  const rows = await queryToolAgg({ since, provider })

  if (rows.length === 0) {
    return c.html(`<div class="st-empty">
      <div class="st-empty-title">No raw tools yet</div>
      <p>Tools are the actual operations inside a trace: file reads, grep/rg, tests, browser snapshots, MCP calls, and patches.</p>
    </div>`)
  }

  const html = rows.map((r) => `<div class="st-row">
    <div class="name">${escapeHtml(r.tool_name)}</div>
    <span class="n">${r.n} calls</span>
    <span class="tokens">avg ${Math.round(r.avg_ms ?? 0)} ms span</span>
    <span class="cost"></span>
  </div>`).join('')

  return c.html(html)
})

api.get('/api/span/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return c.html('<div class="detail-empty">invalid id</div>')

  const row = await querySpanById(id)
  if (!row) return c.html('<div class="detail-empty">Span not found</div>')

  const trace = row.trace_id != null ? await queryTraceById(row.trace_id) : undefined
  const cost = costUSD(row.model, row.input_tokens ?? 0, row.output_tokens ?? 0, row.cache_read_tokens ?? 0, row.cache_creation_tokens ?? 0)
  const conv = extractConversation(row.provider, row.request_body, row.response_body)
  const hit = cacheHitRate(row.input_tokens ?? 0, row.cache_read_tokens ?? 0)
  const reqJson = tryPrettyJson(row.request_body)
  const resJson = tryPrettyJson(row.response_body)
  const localCodex = summarizeCodexTurnFromRequestBody(row.request_body)

  const tools = await queryToolsForSpan(row.id)

  const codexTurn = (() => {
    if (row.provider !== 'chatgpt' || !row.request_body) return ''
    try {
      const body = JSON.parse(row.request_body)
      const event = Array.isArray(body.events) ? body.events[0] : null
      if (event?.event_type !== 'codex_turn_event') return ''
      const p = event.event_params ?? {}
      return `<div class="detail-section">
        <h3>codex turn</h3>
        <div class="kv">
          <div class="k">status</div><div class="v">${escapeHtml(String(p.status ?? '—'))}</div>
          <div class="k">model</div><div class="v">${escapeHtml(String(p.model ?? row.model ?? '—'))}</div>
          <div class="k">effort</div><div class="v">${escapeHtml(String(p.reasoning_effort ?? '—'))}</div>
          <div class="k">tools</div><div class="v">${p.total_tool_call_count ?? 0} total · ${p.shell_command_count ?? 0} shell · ${p.file_change_count ?? 0} file changes</div>
          <div class="k">duration</div><div class="v">${fmtDuration(Number(p.duration_ms ?? row.duration_ms))}</div>
          <div class="k">thread</div><div class="v">${escapeHtml(String(p.thread_id ?? '—')).slice(0, 64)}</div>
          ${localCodex?.sessionFile ? `<div class="k">session log</div><div class="v mono">${escapeHtml(localCodex.sessionFile)}</div>` : ''}
        </div>
      </div>`
    } catch {
      return ''
    }
  })()

  return c.html(`
<div class="detail-header">
  <div class="detail-h1">Span #${row.id} <span class="badge ${statusClass(row.status)}" style="font-size:10px;margin-left:6px">${row.status}</span></div>
  <div class="detail-meta">${row.method} ${row.path} · ${new Date(row.started_at).toLocaleString()}</div>
  <div style="margin-top:8px;font-size:12px;color:var(--muted)">
    <span class="pill pill-${row.provider}">${row.provider}</span>
    <span class="pill" style="background:var(--surface-2);color:var(--text)">${escapeHtml(row.model ?? '—')}</span>
    ${row.is_stream ? '<span class="pill pill-stream">SSE</span>' : ''}
    · ${row.duration_ms} ms · ${fmtCost(cost)}
  </div>
</div>

<div class="detail-section">
  <h3>tokens</h3>
  <div class="kv">
    <div class="k">input</div><div class="v">${row.input_tokens ?? '—'}</div>
    <div class="k">output</div><div class="v">${row.output_tokens ?? '—'}</div>
    <div class="k">cache read</div><div class="v" style="color:var(--olive)">${row.cache_read_tokens ?? '—'}</div>
    ${row.cache_creation_tokens ? `<div class="k">cache write</div><div class="v" style="color:var(--brown)">${row.cache_creation_tokens}</div>` : ''}
    ${hit > 0 ? `<div class="k">cache rate</div><div class="v">${hit}%</div>` : ''}
  </div>
</div>

${codexTurn}

${localCodex ? `
<div class="detail-section codex-transcript">
  <h3>codex transcript</h3>
  ${localCodex.prompt ? `
    <div class="codex-msg codex-user">
      <div class="codex-msg-label">user prompt</div>
      <pre>${escapeHtml(localCodex.prompt)}</pre>
    </div>
  ` : ''}
  ${localCodex.commentary.length > 0 ? `
    <div class="codex-msg">
      <div class="codex-msg-label">workflow</div>
      ${renderWorkflow(localCodex.commentary, localCodex.tools)}
    </div>
  ` : ''}
  ${localCodex.tools.length > 0 ? `
    <div class="codex-msg">
      <div class="codex-msg-label">tool work (${localCodex.tools.length})</div>
      ${renderToolGroups(localCodex.tools, 8)}
    </div>
  ` : ''}
  ${localCodex.assistant ? `
    <div class="codex-msg codex-assistant">
      <div class="codex-msg-label">assistant answer</div>
      <pre>${escapeHtml(answerPreview(localCodex.assistant))}</pre>
    </div>
  ` : ''}
</div>
` : conv.messages.length > 0 ? `
<div class="detail-section" style="padding-bottom:0">
  <h3>conversation</h3>
</div>
<div class="conv">
  ${conv.messages.map(renderConversationMessage).join('')}
</div>
` : `
<div class="detail-section">
  <h3>conversation</h3>
  <div style="color:var(--caption);font-size:12px">No structured messages extracted. See raw JSON below.</div>
</div>
`}

${tools.length > 0 ? `
<div class="detail-section">
  <h3>tools invoked (${tools.length})</h3>
  ${tools.map((t) => `<div style="padding:6px 0;border-bottom:1px dashed var(--border);font-size:12px">
    <div style="display:flex;justify-content:space-between;gap:8px">
      <span class="pill" style="background:var(--olive-soft);color:var(--olive)">${escapeHtml(t.tool_name)}</span>
      ${t.skill_name ? `<span class="pill" style="background:var(--brown-soft);color:var(--brown);font-family:var(--font-mono)">${escapeHtml(t.skill_name)}</span>` : ''}
    </div>
    ${t.tool_input_preview ? `<div style="margin-top:4px;font-family:var(--font-mono);font-size:11px;color:var(--muted);white-space:pre-wrap;word-break:break-all">${escapeHtml(t.tool_input_preview)}</div>` : ''}
  </div>`).join('')}
</div>
` : ''}

${trace ? `
<div class="detail-section">
  <h3>parent trace</h3>
  <div class="kv">
    <div class="k">trace id</div><div class="v"><a href="/dashboard/trace/${trace.id}" style="color:var(--brown);text-decoration:underline">#${trace.id}</a></div>
    <div class="k">external</div><div class="v">${escapeHtml(trace.external_id ?? '—')}</div>
    <div class="k">spans in trace</div><div class="v">${trace.span_count}</div>
  </div>
</div>
` : ''}

<details class="collapsible">
  <summary>Raw request (${row.request_body?.length ?? 0} bytes)</summary>
  <pre class="json" data-json="${reqJson.isJson}">${escapeHtml(reqJson.text)}</pre>
</details>

<details class="collapsible" style="margin-bottom:18px">
  <summary>Raw response${resJson.text.length > 19000 ? ' (truncated to 20KB)' : ''} (${row.response_body?.length ?? 0} bytes)</summary>
  <pre class="json" data-json="${resJson.isJson}">${escapeHtml(resJson.text)}</pre>
</details>
`)
})
