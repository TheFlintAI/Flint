import './assets/main.css'
import { createRoot } from 'react-dom/client'
import App from './App'
import { installStreamingPerformanceMonitor } from './lib/devtools/streaming-performance'
import { flushDb } from '@/lib/db/json-store'

installStreamingPerformanceMonitor()

// Ensure pending DB writes are flushed before the window closes.
window.addEventListener('beforeunload', () => {
  flushDb()
})

// Diagnostic: verify Tauri IPC bridge is available at startup
const tauriInternals = (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
if (!tauriInternals) {
  document.body.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:system-ui;background:#0a0a0a;color:#f5f5f5">
      <div style="max-width:480px;text-align:center;padding:2rem">
        <h1 style="font-size:1.5rem;margin-bottom:1rem">Tauri IPC bridge not available</h1>
        <p style="color:#a3a3a3;margin-bottom:0.5rem">window.__TAURI_INTERNALS__ is missing.</p>
        <p style="color:#a3a3a3;margin-bottom:1.5rem">Flint must run inside a Tauri desktop window, not a regular browser.<br/>Use <code style="background:#1a1a1a;padding:0.125rem 0.375rem;border-radius:6px">bun run dev</code> to launch the desktop app.</p>
        <p style="color:#737373;font-size:0.875rem">If you already ran bun run dev, the Tauri backend may have crashed. Check the terminal for Rust compilation errors.</p>
      </div>
    </div>
  `
  throw new Error('Tauri IPC bridge not available — run inside Tauri desktop app')
}

createRoot(document.getElementById('root')!).render(<App />)
