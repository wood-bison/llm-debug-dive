import type { ProviderModelUsage } from '../../application/ports'
import { isFailure } from '../../domain/metrics'
import { costOf, spanCost } from '../../domain/pricing'
import { totalsOf, type Span } from '../../domain/telemetry'
import { sumBy } from '../../shared/collections'

const ANSI_STYLE_CODE = { bold: 1, red: 31, green: 32, brown: 33, dim: 90 } as const
const ANSI_ESCAPE_CHARACTER = '\u001B'
const ANSI_RE = new RegExp(`${ANSI_ESCAPE_CHARACTER}\\[[0-9;]*m`, 'g')
const withAnsiStyle = (code: number) => (text: string) => `\x1b[${code}m${text}\x1b[0m`
const style = {
  bold: withAnsiStyle(ANSI_STYLE_CODE.bold),
  red: withAnsiStyle(ANSI_STYLE_CODE.red),
  green: withAnsiStyle(ANSI_STYLE_CODE.green),
  brown: withAnsiStyle(ANSI_STYLE_CODE.brown),
  dim: withAnsiStyle(ANSI_STYLE_CODE.dim),
}
const RULE_WIDTH = 96
const MODEL_CHARS = 30
const COST_DECIMALS = 4
const NUMBER_GAP = '  '

type Align = 'left' | 'right'
interface Column { title: string; width: number; align: Align }

const SUMMARY_COLUMNS: readonly Column[] = [
  { title: 'provider', width: 12, align: 'left' },
  { title: 'model', width: 32, align: 'left' },
  { title: 'n', width: 5, align: 'right' },
  { title: 'in', width: 10, align: 'right' },
  { title: 'out', width: 8, align: 'right' },
  { title: 'cache', width: 10, align: 'right' },
  { title: 'avg ms', width: 8, align: 'right' },
  { title: '$', width: 8, align: 'right' },
]
const LABEL_COLUMNS = 2

function visibleLength(text: string): number {
  return text.replace(ANSI_RE, '').length
}

function fit(text: string, width: number, align: Align): string {
  const padding = ' '.repeat(Math.max(0, width - visibleLength(text)))
  return align === 'left' ? text + padding : padding + text
}

function tableRow(cells: string[]): string {
  const fitted = cells.map((cell, i) => {
    const column = SUMMARY_COLUMNS[i]
    return column ? fit(cell, column.width, column.align) : cell
  })
  return fitted.slice(0, LABEL_COLUMNS).join('') + fitted.slice(LABEL_COLUMNS).join(NUMBER_GAP)
}

const SPAN_LINE = { id: 4, provider: 10, model: 30, duration: 8, tokens: 10 } as const

const usd = (amount: number) => `$${amount.toFixed(COST_DECIMALS)}`
const shortModel = (model: string) => (model.length > MODEL_CHARS ? `${model.slice(0, MODEL_CHARS - 1)}…` : model)
const rule = () => style.dim('─'.repeat(RULE_WIDTH))

export function renderSummary(rows: ProviderModelUsage[], totals: { traces: number; spans: number }, last: string): string {
  const cost = (r: ProviderModelUsage) => costOf(r.model, r.usage)
  const sum = (pick: (r: ProviderModelUsage) => number) => sumBy(rows, pick)
  const totalCost = sum(cost)

  return [
    `\n── ${style.bold('summary')} ── last ${last}\n`,
    tableRow(SUMMARY_COLUMNS.map((c) => style.dim(c.title))),
    rule(),
    ...rows.map((r) => tableRow([
      r.provider,
      shortModel(r.model),
      String(r.count),
      String(r.usage.input ?? '-'),
      String(r.usage.output ?? '-'),
      String(r.usage.cacheRead ?? '-'),
      String(Math.round(r.avgMs ?? 0)),
      style.brown(cost(r) > 0 ? usd(cost(r)) : '?'),
    ])),
    rule(),
    tableRow([
      style.bold('TOTAL'),
      '',
      style.bold(String(sum((r) => r.count))),
      style.bold(String(sum((r) => totalsOf(r.usage).input))),
      style.bold(String(sum((r) => totalsOf(r.usage).output))),
      style.bold(String(sum((r) => totalsOf(r.usage).cacheRead))),
      '',
      style.green(rows.length > 0 && rows.some((r) => cost(r) === 0) ? `${totalCost > 0 ? usd(totalCost) + ' + ' : ''}?` : usd(totalCost)),
    ]),
    '',
    style.dim(`traces: ${totals.traces}, spans: ${totals.spans}`),
    '',
  ].join('\n')
}

export function renderRecentSpans(spans: Span[], last: string): string {
  return [`\n── ${style.bold('recent spans')} ── last ${last}\n`, ...spans.map(spanLine), ''].join('\n')
}

function spanLine(span: Span): string {
  const cost = spanCost(span)
  const status = (isFailure(span.status) ? style.red : style.green)(String(span.status))
  return [
    style.dim(`#${String(span.id).padStart(SPAN_LINE.id)}`) + '  ',
    style.dim(new Date(span.startedAt).toLocaleTimeString('en-US')) + '  ',
    fit(span.provider, SPAN_LINE.provider, 'left') + ' ',
    fit(span.model ?? '-', SPAN_LINE.model, 'left') + ' ',
    status + ' ',
    fit(`${span.durationMs}ms`, SPAN_LINE.duration, 'right') + ' ',
    fit(`in=${span.usage.input ?? '-'}`, SPAN_LINE.tokens, 'right') + ' ',
    fit(`out=${span.usage.output ?? '-'}`, SPAN_LINE.tokens, 'right') + ' ',
    style.dim(span.isStream ? 'stream' : 'json  ') + '  ',
    style.brown(cost > 0 ? usd(cost) : ''),
  ].join('')
}
