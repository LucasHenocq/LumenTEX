/// <reference types="vite/client" />
import type { Api } from '../../preload/index'

declare global {
  const __APP_VERSION__: string
  interface Window {
    api: Api
  }
}

declare module 'pdfjs-dist/build/pdf.worker.min.mjs?url' {
  const url: string
  export default url
}
