/**
 * Frontend image utilities:
 * - SHA-256 hashing via Web Crypto API
 * - File → ImageAttachment (base64)
 * - Upload queue with concurrency control
 * - R2 / dev-server image API helpers
 */

import type { ImageAttachment } from "../types";
import { DEFAULT_SERVER_URL, IMAGE_URL } from "../config";

// ============================================================
// SHA-256 hashing (browser-native, no dependency)
// ============================================================

/**
 * Compute SHA-256 hex digest of raw bytes.
 * Requires secure context (localhost or HTTPS) — throws otherwise.
 */
export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  if (!crypto?.subtle?.digest) {
    throw new Error("Web Crypto API unavailable — requires secure context");
  }
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ============================================================
// Base64 encoding (chunked to avoid stack overflow on large files)
// ============================================================

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000; // 32KB
  let result = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const chunk = bytes.subarray(i, i + CHUNK);
    result += String.fromCharCode(...chunk);
  }
  return btoa(result);
}

export function decodeBase64ToArrayBuffer(base64: string): ArrayBuffer {
  // Accept both "data:image/png;base64,…" and raw base64
  const raw = base64.includes(",") ? base64.split(",")[1] : base64;
  const binary = atob(raw);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// ============================================================
// File → ImageAttachment
// ============================================================

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

/** Validate that a File looks like an image and isn't too big. */
function validateImageFile(file: File): void {
  if (!file.type.startsWith("image/")) {
    throw new Error(
      `File "${file.name}" is not an image (${file.type || "unknown type"})`,
    );
  }
  if (file.size > MAX_FILE_SIZE) {
    const sizeMB = (file.size / 1024 / 1024).toFixed(1);
    throw new Error(`Image "${file.name}" is too large (${sizeMB}MB, max 5MB)`);
  }
}

/** Convert a File to an ImageAttachment with SHA-256 hash and base64 data. */
export async function fileToImageAttachment(
  file: File,
): Promise<ImageAttachment> {
  validateImageFile(file);
  const buffer = await file.arrayBuffer();
  const hash = await sha256Hex(buffer);
  const base64 = arrayBufferToBase64(buffer);
  return {
    hash,
    filename: file.name,
    mimeType: file.type || "image/png",
    data: base64,
  };
}

// ============================================================
// Upload status types
// ============================================================

export type UploadStatus = "pending" | "uploading" | "done" | "error";

export interface UploadStatusInfo {
  status: UploadStatus;
  error?: string;
}

// ============================================================
// Server URL normalization
// ============================================================

/** Resolve the image API base URL from server URL and optional env override. */
export function getImageBaseUrl(serverUrl?: string): string {
  if (IMAGE_URL) return IMAGE_URL.replace(/\/+$/, "");
  if (serverUrl) return getBaseUrl(serverUrl);
  return getBaseUrl(DEFAULT_SERVER_URL);
}

/** Normalize a PartyKit server URL to a fetch-able HTTP base URL. */
export function getBaseUrl(serverUrl: string): string {
  let url = serverUrl.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(url)) {
    url = `http://${url}`;
  }
  return url;
}

// ============================================================
// Single-image upload
// ============================================================

/** Upload a single image (raw bytes) to the image API. Returns success/failure. */
export async function uploadSingleImage(
  att: ImageAttachment,
  baseUrl: string,
): Promise<{ success: boolean; error?: string }> {
  if (!att.data) return { success: true };
  try {
    const body = decodeBase64ToArrayBuffer(att.data);
    const resp = await fetch(`${baseUrl}/images/${att.hash}`, {
      method: "PUT",
      body,
      headers: { "Content-Type": "application/octet-stream" },
    });
    if (!resp.ok) {
      return {
        success: false,
        error: `HTTP ${resp.status}: ${resp.statusText}`,
      };
    }
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Check whether an image already exists on the server. */
export async function checkImageExists(
  hash: string,
  baseUrl: string,
): Promise<boolean> {
  try {
    const resp = await fetch(`${baseUrl}/images/${hash}`, { method: "HEAD" });
    return resp.ok || resp.status === 304;
  } catch {
    return false;
  }
}

/** Get the display source for an image attachment. */
export function getImageSrc(att: ImageAttachment, serverUrl?: string): string {
  if (att.data) {
    return `data:${att.mimeType};base64,${att.data}`;
  }
  const baseUrl = serverUrl ? getImageBaseUrl(serverUrl) : getImageBaseUrl();
  return `${baseUrl}/images/${att.hash}`;
}

// ============================================================
// Upload queue — manages concurrency and status
// ============================================================

type StatusCallback = (hash: string, info: UploadStatusInfo) => void;

export class ImageUploadQueue {
  private queue: ImageAttachment[] = [];
  private statuses = new Map<string, UploadStatusInfo>();
  private snapshot: Map<string, UploadStatusInfo> | null = null;
  private listeners = new Set<StatusCallback>();
  private active = 0;
  private maxConcurrent: number;
  private baseUrl: string;
  private aborted = false;

  constructor(serverUrl: string, maxConcurrent = 2, imageHost?: string) {
    this.baseUrl = (imageHost || getImageBaseUrl(serverUrl)).replace(
      /\/+$/,
      "",
    );
    if (!/^https?:\/\//i.test(this.baseUrl)) {
      this.baseUrl = `http://${this.baseUrl}`;
    }
    this.maxConcurrent = maxConcurrent;
  }

  private notify(hash: string): void {
    this.snapshot = null;
    const info = this.statuses.get(hash);
    if (!info) return;
    for (const cb of this.listeners) {
      cb(hash, info);
    }
  }

  enqueue(att: ImageAttachment): void {
    if (this.aborted) return;
    // Dedup: if already in queue or uploaded, skip
    const existing = this.statuses.get(att.hash);
    if (existing?.status === "done" || existing?.status === "uploading") return;
    if (existing?.status === "pending") return; // already queued

    this.statuses.set(att.hash, { status: "pending" });
    this.queue.push(att);
    this.notify(att.hash);
    this.drain();
  }

  private drain(): void {
    while (this.active < this.maxConcurrent && this.queue.length > 0) {
      const att = this.queue.shift()!;
      this.active++;
      this.uploadOne(att);
    }
  }

  private async uploadOne(att: ImageAttachment): Promise<void> {
    this.statuses.set(att.hash, { status: "uploading" });
    this.notify(att.hash);

    if (!att.data) {
      this.statuses.set(att.hash, { status: "done" });
      this.notify(att.hash);
      this.active = Math.max(0, this.active - 1);
      this.drain();
      return;
    }

    const result = await uploadSingleImage(att, this.baseUrl);
    this.statuses.set(att.hash, {
      status: result.success ? "done" : "error",
      error: result.error,
    });
    this.notify(att.hash);

    this.active = Math.max(0, this.active - 1);
    this.drain();
  }

  onStatusChange(cb: StatusCallback): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /**
   * Stable snapshot of all statuses — reference is only replaced when a
   * status changes, so it can be used with useSyncExternalStore.
   */
  getSnapshot(): Map<string, UploadStatusInfo> {
    if (!this.snapshot) this.snapshot = new Map(this.statuses);
    return this.snapshot;
  }

  getStatus(hash: string): UploadStatusInfo {
    return this.statuses.get(hash) ?? { status: "pending" };
  }

  /** Retry a failed upload. */
  retry(hash: string): void {
    const info = this.statuses.get(hash);
    if (info?.status !== "error") return;
    // Find the original attachment data — we need to re-enqueue it
    // The caller must provide the data via re-enqueue, or we store attachments.
    // For simplicity, clear the status so a fresh enqueue works.
    this.statuses.delete(hash);
    this.snapshot = null;
  }

  /** Wait for all queued and active uploads to complete. */
  async waitForAll(): Promise<void> {
    // Poll with a short delay until queue is empty and nothing is active
    while (this.queue.length > 0 || this.active > 0) {
      await new Promise((r) => setTimeout(r, 150));
      // Also drain anything that arrived while waiting
      this.drain();
    }
  }

  /** Check if any uploads are in error state. */
  get hasErrors(): boolean {
    for (const [, info] of this.statuses) {
      if (info.status === "error") return true;
    }
    return false;
  }

  /** Stop all pending uploads. Active ones will still complete. */
  abort(): void {
    this.aborted = true;
    this.queue.length = 0;
  }
}
