/**
 * Standalone Cloudflare Worker for goal-tooltip image storage.
 *
 * R2 bucket "bingo-kit-image" must already exist in Cloudflare.
 */

const HASH_RE = /^[a-f0-9]{64}$/;
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

interface Env {
  BINGO_IMAGES: {
    get(key: string): Promise<{
      readonly body: ReadableStream;
      readonly size: number;
      readonly httpMetadata?: { contentType?: string };
      readonly httpEtag?: string;
    } | null>;
    put(
      key: string,
      value: ArrayBuffer,
      options?: {
        httpMetadata?: { contentType?: string };
        customMetadata?: Record<string, string>;
      },
    ): Promise<void>;
  };
}

function cors(headers: Headers): Record<string, string> {
  const origin = headers.get("origin") ?? "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,PUT,HEAD,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const headers = cors(req.headers);

    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    // GET / HEAD /images/:hash
    if (
      (req.method === "GET" || req.method === "HEAD") &&
      url.pathname.startsWith("/images/")
    ) {
      const hash = url.pathname.slice("/images/".length);
      if (!HASH_RE.test(hash)) {
        return new Response("Invalid hash", { status: 400, headers });
      }

      const obj = await env.BINGO_IMAGES.get(hash);
      if (!obj) {
        return new Response("Not Found", { status: 404, headers });
      }

      const respHeaders = new Headers(headers);
      respHeaders.set(
        "Content-Type",
        obj.httpMetadata?.contentType ?? "application/octet-stream",
      );
      respHeaders.set("Cache-Control", "public, max-age=2592000");
      respHeaders.set("Content-Length", String(obj.size));
      respHeaders.set("ETag", `"${obj.httpEtag ?? hash}"`);

      if (req.method === "HEAD") {
        return new Response(null, { status: 200, headers: respHeaders });
      }
      return new Response(obj.body, { headers: respHeaders });
    }

    // PUT /images/:hash
    if (req.method === "PUT" && url.pathname.startsWith("/images/")) {
      const hash = url.pathname.slice("/images/".length);
      if (!HASH_RE.test(hash)) {
        return new Response("Invalid hash", { status: 400, headers });
      }

      const length = parseInt(req.headers.get("content-length") ?? "0", 10);
      if (length > MAX_SIZE) {
        return new Response("Image too large", { status: 413, headers });
      }

      const body = await req.arrayBuffer();
      if (body.byteLength > MAX_SIZE) {
        return new Response("Image too large", { status: 413, headers });
      }

      await env.BINGO_IMAGES.put(hash, body, {
        httpMetadata: {
          contentType: req.headers.get("content-type") ?? "application/octet-stream",
        },
        customMetadata: { uploadedAt: String(Date.now()) },
      });

      return new Response(JSON.stringify({ ok: true }), {
        status: 201,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    return new Response("Not Found", { status: 404, headers });
  },
};
