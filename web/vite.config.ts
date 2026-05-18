import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url))
const API_TARGET = process.env.LLM_DEBUG_API ?? 'http://127.0.0.1:8787'

export default defineConfig(({ command }) => ({
  root: fromRoot('.'),
  base: command === 'serve' ? '/' : '/app/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@web': fromRoot('./src'),
      '@contracts': fromRoot('../src/contracts'),
      '@shared': fromRoot('../src/shared'),
    },
  },
  build: { outDir: fromRoot('../dist/web'), emptyOutDir: true },
  server: {
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
        configure(proxy) {
          proxy.on('proxyReq', (outgoing, incoming) => {
            if (incoming.headers.origin === `http://${incoming.headers.host}`) {
              outgoing.setHeader('origin', new URL(API_TARGET).origin)
            }
          })
        },
      },
    },
  },
}))
