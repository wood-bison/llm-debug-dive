import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router'
import { Skeleton } from '@web/components/Skeleton'
import { DashboardPage } from '@web/features/dashboard/DashboardPage'
import { AppProviders } from './AppProviders'
import { AppShell } from './AppShell'
import { NotFound } from './NotFound'

const ROUTER_BASENAME = '/dashboard'
const TracePage = lazy(() => import('@web/features/trace/TracePage').then((module) => ({ default: module.TracePage })))
const GuidePage = lazy(() => import('@web/features/guide/GuidePage').then((module) => ({ default: module.GuidePage })))

export function App() {
  return (
    <AppProviders>
      <BrowserRouter basename={ROUTER_BASENAME}>
        <Suspense fallback={<Skeleton className="m-8 h-96" />}>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<DashboardPage />} />
              <Route path="trace/:traceId" element={<TracePage />} />
              <Route path="guide" element={<GuidePage />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AppProviders>
  )
}
