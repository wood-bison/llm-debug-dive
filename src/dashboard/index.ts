/**
 * Entry point for the dashboard sub-module.
 *
 * Mounts:
 *   GET  /dashboard               → live feed page
 *   GET  /dashboard/trace/:id     → trace conversation view
 *   GET  /api/stats, /api/spans, /api/span/:id, /api/skills, /api/tools
 *   GET  /static/*                → public/ files (CSS, JS)
 */

import { Hono } from 'hono'
import { serveStatic } from 'hono/bun'
import { api } from './api'
import { DASHBOARD_PAGE, GUIDE_PAGE } from './templates'
import { trace } from './trace'

export const dashboard = new Hono()

// Static assets (CSS, JS)
dashboard.use('/static/*', serveStatic({
  root: './public',
  rewriteRequestPath: (path) => path.replace(/^\/static/, ''),
}))

// Pages
dashboard.get('/dashboard', (c) => c.html(DASHBOARD_PAGE))
dashboard.get('/dashboard/guide', (c) => c.html(GUIDE_PAGE))
dashboard.route('/', trace)

// API
dashboard.route('/', api)
