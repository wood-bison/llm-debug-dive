import type { ProviderProtocol, ProviderRegistry, ProviderRoute } from '../../application/ports'
import { anthropicProtocol } from './anthropic'
import { chatgptProtocol } from './chatgpt'
import { googleProtocol } from './google'
import { openaiProtocol } from './openai'

const MOST_SPECIFIC_FIRST: ProviderProtocol[] = [chatgptProtocol, googleProtocol, anthropicProtocol, openaiProtocol]

export function createProviderRegistry(
  protocols: ProviderProtocol[] = MOST_SPECIFIC_FIRST,
  fallback: ProviderProtocol = openaiProtocol,
): ProviderRegistry {
  const byName = new Map(protocols.map((p) => [p.name as string, p]))
  return {
    route(path: string): ProviderRoute {
      for (const protocol of protocols) {
        const route = protocol.matchPath(path)
        if (route) return route
      }
      return { provider: fallback.name, base: fallback.baseUrl, upstreamPath: path }
    },
    get(provider: string): ProviderProtocol {
      return byName.get(provider) ?? fallback
    },
    list(): ProviderProtocol[] {
      return [...protocols]
    },
  }
}
