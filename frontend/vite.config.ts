import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  build: {
    chunkSizeWarningLimit: 1000,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'vendor',
              test: /[\\/]node_modules[\\/](react[\\/]|react-dom[\\/]|framer-motion[\\/]|react-router-dom[\\/]|lucide-react[\\/])/,
            },
            {
              name: 'markdown',
              test: /[\\/]node_modules[\\/](react-markdown[\\/]|remark-|rehype-|unified[\\/]|hast-|mdast-|micromark|property-information|space-separated-tokens|comma-separated-tokens|vfile|bail|trough|trim-lines|decode-named-character-reference|character-entities|ccount|escape-string-regexp|unist-|devlop|extend|zwitch|html-void-elements)/,
            },
          ],
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8010',
        changeOrigin: true,
      },
      // 生成的藏书票图片
      '/static': {
        target: 'http://localhost:8010',
        changeOrigin: true,
      },
    },
  },
})
