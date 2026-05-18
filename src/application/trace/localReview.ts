import { cacheHitRate } from '../../domain/metrics'
import { spanCost } from '../../domain/pricing'
import { sumBy } from '../../shared/collections'
import { errorMessage } from '../../shared/format'
import type { LocalReview, LocalReviewer, ReviewStore, TelemetryReader } from '../ports'
import type { TurnQueries } from '../turns'
import { PROMPT_NOT_CAPTURED, coachFor } from './shared'

const REVIEWER = 'ollama'

export type LocalReviewOutcome =
  | { kind: 'not-found' }
  | { kind: 'reviewed'; model: string; review: LocalReview; createdAt: number }
  | { kind: 'failed'; message: string }

export interface LocalReviewDeps {
  reader: TelemetryReader
  reviews: ReviewStore
  reviewer: LocalReviewer
  turns: TurnQueries
  now?: () => number
}

export function createLocalReviewCommand(deps: LocalReviewDeps) {
  const { reader, reviews, reviewer, turns } = deps
  const now = deps.now ?? Date.now

  return async function reviewLocally(traceId: number, model: string): Promise<LocalReviewOutcome> {
    const trace = await reader.traceById(traceId)
    if (!trace) return { kind: 'not-found' }

    const spans = await reader.spansByTrace(traceId)
    const localTurn = turns.meaningfulLocalTurn(spans)
    const coach = coachFor(trace, spans, {
      prompt: turns.firstPrompt(spans) ?? localTurn?.prompt ?? PROMPT_NOT_CAPTURED,
      tools: localTurn?.tools ?? [],
      totalCost: sumBy(spans, spanCost),
      hit: cacheHitRate(trace.totals.input, trace.totals.cacheRead, trace.totals.cacheCreation),
    })

    try {
      const review = await reviewer.review(model, coach.ollamaBrief)
      const createdAt = now()
      await reviews.insertReview({
        traceId,
        reviewer: REVIEWER,
        model,
        createdAt,
        prompt: coach.ollamaBrief,
        response: review.response || null,
        thinking: review.thinking || null,
        score: coach.score,
        verdict: coach.verdict,
      })
      return { kind: 'reviewed', model, review, createdAt }
    } catch (err: unknown) {
      return { kind: 'failed', message: errorMessage(err) }
    }
  }
}
