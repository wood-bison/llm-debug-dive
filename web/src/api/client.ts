import type { z } from 'zod'
import { ApiError } from '@contracts/api'

const API_BASE = '/api/v1'

export class ApiRequestError extends Error {
  constructor(message: string, readonly status: number, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ApiRequestError'
  }
}

async function parseResponse<T extends z.ZodType>(response: Response, schema: T): Promise<z.output<T>> {
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const problem = ApiError.safeParse(payload)
    throw new ApiRequestError(problem.success ? problem.data.error : `Request failed with ${response.status}.`, response.status)
  }
  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    throw new ApiRequestError('The server returned data in an unexpected format.', response.status)
  }
  return parsed.data
}

export async function getJson<T extends z.ZodType>(path: string, schema: T, signal?: AbortSignal): Promise<z.output<T>> {
  try {
    return await parseResponse(await fetch(`${API_BASE}${path}`, { signal }), schema)
  } catch (error) {
    if (error instanceof ApiRequestError || signal?.aborted) throw error
    throw new ApiRequestError('Could not reach the server. Check that the proxy is running.', 0, { cause: error })
  }
}

export async function postJson<T extends z.ZodType>(path: string, body: unknown, schema: T): Promise<z.output<T>> {
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return await parseResponse(response, schema)
  } catch (error) {
    if (error instanceof ApiRequestError) throw error
    throw new ApiRequestError('Could not reach the server. Check that the proxy is running.', 0, { cause: error })
  }
}
