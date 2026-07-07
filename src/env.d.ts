/// <reference types="vite/client" />

declare module 'react-syntax-highlighter/dist/esm/prism-light' {
  import { ComponentType } from 'react'
  const PrismLight: ComponentType<any> & {
    registerLanguage(name: string, grammar: unknown): void
  }
  export default PrismLight
}

declare module 'react-syntax-highlighter/dist/esm/styles/prism' {
  export const oneDark: Record<string, any>
}

declare module 'react-syntax-highlighter/dist/esm/languages/prism/*' {
  const grammar: Record<string, unknown>
  export default grammar
}
