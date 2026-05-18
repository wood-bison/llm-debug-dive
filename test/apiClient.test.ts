import { afterAll, afterEach, expect, spyOn, test } from 'bun:test'
import { z } from 'zod'
import { ApiRequestError, getJson, postJson } from '../web/src/api/client'

const fetchSpy = spyOn(globalThis, 'fetch')
const Result = z.object({ value: z.number() })

afterEach(() => fetchSpy.mockReset())
afterAll(() => fetchSpy.mockRestore())

test('browser API rejects a malformed successful response with readable contract feedback', async () => {
  fetchSpy.mockResolvedValueOnce(Response.json({ value: 'invalid' }))
  const error = await getJson('/test', Result).catch((cause: unknown) => cause)

  expect(error).toBeInstanceOf(ApiRequestError)
  expect(error).toMatchObject({ status: 200, message: 'The server returned data in an unexpected format.' })
})

test('browser API preserves server error feedback for mutations', async () => {
  fetchSpy.mockResolvedValueOnce(Response.json({ error: 'Choose a local model.' }, { status: 400 }))
  const error = await postJson('/test', {}, Result).catch((cause: unknown) => cause)

  expect(error).toMatchObject({ status: 400, message: 'Choose a local model.' })
})

test('browser API reports unreachable servers and preserves explicit cancellation', async () => {
  const networkFailure = new TypeError('Failed to fetch')
  fetchSpy.mockRejectedValueOnce(networkFailure)
  const error = await getJson('/test', Result).catch((cause: unknown) => cause)
  expect(error).toMatchObject({ status: 0, cause: networkFailure })

  const controller = new AbortController()
  controller.abort()
  const aborted = new DOMException('Cancelled', 'AbortError')
  fetchSpy.mockRejectedValueOnce(aborted)
  expect(await getJson('/test', Result, controller.signal).catch((cause: unknown) => cause)).toBe(aborted)
})
