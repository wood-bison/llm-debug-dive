export const HTTP_STATUS = {
  proxyError: 0,
  ok: 200,
  noContent: 204,
  resetContent: 205,
  notModified: 304,
  badRequest: 400,
  forbidden: 403,
  notFound: 404,
  internalServerError: 500,
  badGateway: 502,
} as const

export function isFailedStatus(status: number): boolean {
  return status === HTTP_STATUS.proxyError || status >= HTTP_STATUS.badRequest
}
