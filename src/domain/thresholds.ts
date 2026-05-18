export const TOKEN_LOAD = {
  heavy: 50_000,
  coachHeavy: 150_000,
  huge: 200_000,
  extreme: 500_000,
  costlyWithoutTools: 30_000,
} as const

export const CACHE_HIT_PCT = {
  cold: 30,
  good: 60,
  helped: 70,
} as const

export const MIN_FRESH_INPUT_FOR_CACHE_SIGNALS = 10_000

export const TRACE_COST_USD = {
  notable: 0.1,
  expensive: 0.5,
} as const

export const CONTEXT_WINDOW_TOKENS = 1_000_000

export const CONTEXT_PEAK_TOKENS = {
  large: 100_000,
  veryLarge: 500_000,
} as const

export const SPAN_COUNT = {
  many: 8,
} as const

export const TOOL_CALLS = {
  heavy: 12,
  coachHeavy: 20,
} as const

export const TOKENS_PER_TOOL_CALL_WARN = 80_000

export const REPEATED_TOOL_MIN_RUNS = 2

export const FAILURE_STATUS = 400
