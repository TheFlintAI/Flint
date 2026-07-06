/** Lightweight interface for lazy-loadable tool modules. */
export interface ToolModule {
  register: () => void
}
