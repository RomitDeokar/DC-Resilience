import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Split large third-party libraries into cacheable chunks. An id-based function
// avoids the "empty chunk" produced when named chunks overlap (recharts depends
// on react, so a fixed { react: [...], charts: [...] } map hoists react away).
function manualChunks(id: string): string | undefined {
  if (!id.includes('node_modules')) return undefined
  if (id.includes('@xyflow')) return 'flow'
  if (id.includes('recharts') || id.includes('/d3-') || id.includes('victory')) return 'charts'
  return 'vendor'
}

export default defineConfig({
  plugins: [react()],
  build: { rollupOptions: { output: { manualChunks } } },
  server: { proxy: { '/api': 'http://127.0.0.1:8000', '/ws': { target: 'ws://127.0.0.1:8000', ws: true }, '/docs': 'http://127.0.0.1:8000', '/openapi.json': 'http://127.0.0.1:8000' } },
})
