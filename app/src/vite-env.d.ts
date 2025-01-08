/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_URL: string
  readonly VITE_API_URL: string
  readonly VITE_CONNECT_SRC: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}