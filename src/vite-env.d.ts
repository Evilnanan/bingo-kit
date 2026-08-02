/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** WebSocket server host (PartyServer). Empty → localhost:1999. */
  readonly VITE_PARTY_HOST?: string;
  /** Image API URL override. Empty → reuse VITE_PARTY_HOST. */
  readonly VITE_IMAGE_URL?: string;
}
