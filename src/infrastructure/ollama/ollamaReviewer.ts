import { z } from 'zod'
import type { LocalReview, LocalReviewer } from '../../application/ports'

const LIST_TIMEOUT_MS = 350
const REVIEW_TIMEOUT_MS = 300_000
const MAX_MODELS = 6
const EMBEDDING_MODEL_MARKER = 'embed'
const GENERATION_OPTIONS = { temperature: 0.2, num_ctx: 8192, num_predict: 1200 } as const

const TagsResponse = z.object({
  models: z.array(z.object({ name: z.string().optional() })).optional(),
})

const GenerateResponse = z.object({
  response: z.string().optional(),
  thinking: z.string().optional(),
  error: z.string().optional(),
})

export function createOllamaReviewer(baseUrl: string): LocalReviewer {
  return {
    async listModels() {
      try {
        const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(LIST_TIMEOUT_MS) })
        if (!res.ok) return []
        const { models = [] } = TagsResponse.parse(await res.json())
        return models
          .map((model) => model.name)
          .filter((name): name is string => isChatModel(name))
          .slice(0, MAX_MODELS)
      } catch {
        return []
      }
    },

    async review(model: string, prompt: string): Promise<LocalReview> {
      const res = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, prompt, stream: false, options: GENERATION_OPTIONS }),
        signal: AbortSignal.timeout(REVIEW_TIMEOUT_MS),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = GenerateResponse.parse(await res.json())
      if (body.error) throw new Error(body.error)
      return { response: body.response?.trim() ?? '', thinking: body.thinking?.trim() ?? '' }
    },
  }
}

function isChatModel(name: string | undefined): boolean {
  return Boolean(name && !name.includes(EMBEDDING_MODEL_MARKER))
}
