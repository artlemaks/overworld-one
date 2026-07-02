/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** WebSocket URL of the authoritative server (OOM-32). Unset → offline P0 mock arena. */
  readonly VITE_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
