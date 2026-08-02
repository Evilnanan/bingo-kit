/**
 * Centralized environment configuration.
 * Env values are resolved once at module load — consumers import these
 * constants instead of reading `import.meta.env` directly.
 */

/** Main server host: env override, falling back to the local dev server. */
export const DEFAULT_SERVER_URL =
  import.meta.env.VITE_PARTY_HOST || "localhost:1999";

/**
 * Optional image API URL override.
 * `undefined` means "reuse the main server" (dev-server serves images too).
 */
export const IMAGE_URL: string | undefined = import.meta.env.VITE_IMAGE_URL;
