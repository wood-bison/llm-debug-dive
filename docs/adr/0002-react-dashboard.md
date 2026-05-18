# ADR 0002: React dashboard and API contracts

Replace server-generated HTML and HTMX with a React dashboard backed by `/api/v1` JSON contracts validated by Zod on both sides. TanStack Query owns server state, React Router owns navigation, and Tailwind consumes semantic light/dark tokens. This introduces a frontend build step, but separates view interactions from backend use cases and shares one contract between them; Bun serves the built assets under `/app` and browser routes under `/dashboard`.

Components use the [React component/state model](https://react.dev/learn/thinking-in-react): feature components compose reusable controls, query hooks own remote data, and local state owns transient interactions. ESLint enforces TypeScript and React Hook rules; strict TypeScript and import-boundary tests guard the layers.
