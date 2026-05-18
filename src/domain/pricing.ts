import { totalsOf, type TokenTotals, type Usage } from './telemetry'

export interface Price {
  input: number
  output: number
  cacheRead?: number
  cacheWrite?: number
}

export const PRICES: Readonly<Record<string, Price>> = {
  'claude-opus-4-7':            { input: 15.00, output: 75.00, cacheRead: 1.50, cacheWrite: 18.75 },
  'claude-sonnet-4-6':          { input: 3.00,  output: 15.00, cacheRead: 0.30, cacheWrite: 3.75 },
  'claude-haiku-4-5-20251001':  { input: 0.80,  output: 4.00,  cacheRead: 0.08, cacheWrite: 1.00 },

  'gpt-5.5':     { input: 5.00,  output: 30.00,  cacheRead: 0.50 },
  'gpt-5.5-pro': { input: 30.00, output: 180.00 },
  'gpt-5.4':     { input: 2.50,  output: 15.00,  cacheRead: 0.25 },
  'gpt-4o':       { input: 2.50,  output: 10.00, cacheRead: 1.25 },
  'gpt-4o-mini':  { input: 0.15,  output: 0.60,  cacheRead: 0.075 },
  'gpt-5':        { input: 5.00,  output: 20.00, cacheRead: 2.50 },
  'gpt-5-mini':   { input: 0.50,  output: 2.00,  cacheRead: 0.25 },

  'gemini-2.5-pro':        { input: 1.25, output: 10.00, cacheRead: 0.125 },
  'gemini-2.5-flash':      { input: 0.30, output: 2.50,  cacheRead: 0.03 },
  'gemini-2.5-flash-lite': { input: 0.10, output: 0.40,  cacheRead: 0.01 },
}

export type ModelVendor = 'anthropic' | 'openai' | 'google' | 'unknown'

export function providerOfModel(model: string | null): ModelVendor {
  if (!model) return 'unknown'
  if (model.startsWith('claude-')) return 'anthropic'
  if (model.startsWith('gpt-') || model.startsWith('o1') || model.startsWith('o3')) return 'openai'
  if (model.startsWith('gemini-')) return 'google'
  return 'unknown'
}

function priceForModel(model: string): Price | undefined {
  if (Object.hasOwn(PRICES, model)) return PRICES[model]
  return priceOfBaseModel(model)
}

function priceOfBaseModel(model: string): Price | undefined {
  const base = Object.keys(PRICES)
    .filter((name) => model === name || model.startsWith(`${name}-`))
    .sort((a, b) => b.length - a.length)[0]
  return base ? PRICES[base] : undefined
}

const TOKENS_PER_PRICE_UNIT = 1_000_000

const usdFor = (tokens: number, pricePerMillion = 0) => (tokens * pricePerMillion) / TOKENS_PER_PRICE_UNIT

function inputCountsCacheReads(model: string): boolean {
  return providerOfModel(model) !== 'anthropic'
}

export function costOf(model: string | null, usage: Usage | TokenTotals): number {
  const price = model ? priceForModel(model) : undefined
  if (!model || !price) return 0
  const { input, output, cacheRead, cacheCreation } = totalsOf(usage)
  const freshInput = inputCountsCacheReads(model) ? Math.max(0, input - cacheRead) : input
  return usdFor(freshInput, price.input) + usdFor(output, price.output) + usdFor(cacheRead, price.cacheRead) + usdFor(cacheCreation, price.cacheWrite)
}

export function spanCost(span: { model: string | null; usage: Usage }): number {
  return costOf(span.model, span.usage)
}
