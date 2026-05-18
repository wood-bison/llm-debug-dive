import { Hono, type Context } from 'hono'
import { join, normalize, sep } from 'node:path'
import { HTTP_STATUS } from '../../shared/httpStatus'

const INDEX_HTML = 'index.html'
export interface WebAppPaths {
  webDistDir: string
  publicDir: string
}

function insideRoot(root: string, requested: string): string | null {
  const resolved = normalize(join(root, requested))
  return resolved.startsWith(normalize(root) + sep) ? resolved : null
}

async function serveFile(c: Context, root: string, requested: string): Promise<Response> {
  const path = insideRoot(root, requested)
  const file = path ? Bun.file(path) : null
  if (!file || !(await file.exists())) return c.notFound()
  return new Response(file)
}

export function createWebAppRoutes({ webDistDir, publicDir }: WebAppPaths): Hono {
  const routes = new Hono()
  const appShell = (c: Context) => serveFile(c, webDistDir, INDEX_HTML).then((response) =>
    response.status === HTTP_STATUS.notFound ? c.text('Dashboard is not built yet. Run `bun run build` and reload.', HTTP_STATUS.notFound) : response)

  routes.get('/app/*', (c) => serveFile(c, webDistDir, c.req.path.slice('/app/'.length)))
  routes.get('/static/*', (c) => serveFile(c, publicDir, c.req.path.slice('/static/'.length)))
  routes.get('/dashboard', appShell)
  routes.get('/dashboard/*', appShell)
  return routes
}
