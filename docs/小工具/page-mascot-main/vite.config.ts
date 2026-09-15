import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  // The demo is served from koboyo.com/page-mascot.
  base: '/page-mascot/',
  plugins: [react(), tailwindcss()],
  // dist/ is the published component, so the demo builds somewhere else.
  build: { outDir: 'site-build/page-mascot' },
})
