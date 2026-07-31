/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** WebSocket server host (PartyKit). Empty → localhost:1999. */
  readonly VITE_PARTYKIT_HOST?: string;
  /** Image API URL override. Empty → reuse VITE_PARTYKIT_HOST. */
  readonly VITE_IMAGE_URL?: string;
}
