import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import path from 'node:path'

const srcPath = new URL('./src', import.meta.url).pathname
const packageJsonPath = new URL('./package.json', import.meta.url).pathname

export default defineConfig({
  root: '.',
  clearScreen: false,
  server: {
    port: 5174,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**']
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'esnext',
    chunkSizeWarningLimit: 3000,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          // Mermaid core (~5-10MB uncompressed) — do NOT capture internal diagram sub-modules
          if (id.includes('node_modules/mermaid') && !id.includes('diagram')) return 'vendor-mermaid'
          // Recharts (~800KB)
          if (id.includes('recharts')) return 'vendor-recharts'
          // xterm + addons (~400KB)
          if (id.includes('@xterm')) return 'vendor-xterm'
          // Tauri IPC
          if (id.includes('@tauri-apps')) return 'vendor-tauri'
          // React core
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) return 'vendor-react'
          // Radix UI primitives
          if (id.includes('@radix-ui')) return 'vendor-radix'
          // Syntax highlighters & diff view
          if (id.includes('react-syntax-highlighter') || id.includes('@git-diff-view')) return 'vendor-syntax'
          // React ecosystem: state, i18n, markdown, animations
          if (id.includes('zustand') || id.includes('immer') || id.includes('i18next')
              || id.includes('react-markdown') || id.includes('remark-') || id.includes('rehype-')
              || id.includes('katex') || id.includes('motion') || id.includes('sonner'))
            return 'vendor-ecosystem'
          // Shared UI utilities
          if (id.includes('lucide-react') || id.includes('clsx') || id.includes('class-variance-authority')
              || id.includes('tailwind-merge') || id.includes('cmdk') || id.includes('nanoid')
              || id.includes('gpt-tokenizer') || id.includes('partial-json') || id.includes('defuddle')
              || id.includes('node_modules/diff/'))
            return 'vendor-ui'
        }
      }
    }
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'i18next',
      'react-i18next',
      'zustand',
      'immer',
      'clsx',
      'lucide-react',
      'sonner',
      'cmdk',
      'gpt-tokenizer',
      'nanoid',
      'class-variance-authority',
      'mermaid',
      'partial-json',
      'motion'
    ]
  },
  resolve: {
    alias: {
      '@': srcPath,
      '@flint/plugin-sdk': path.resolve(__dirname, 'packages/flint-plugin-sdk'),
      '@package': packageJsonPath
    }
  },
  plugins: [react(), tailwindcss()]
})
