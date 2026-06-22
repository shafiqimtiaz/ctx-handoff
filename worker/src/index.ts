/**
 * Handoff transport worker.
 *
 * Zero-knowledge: it only ever sees already-encrypted {salt, iv, ciphertext}
 * blobs. Records expire after 24h.
 *
 *   POST /upload         body: {salt, iv, ciphertext}  -> {id}
 *   GET  /download/:id                                 -> {salt, iv, ciphertext}
 */

export interface Env {
  HANDOFF_KV: KVNamespace;
}

const MAX_BYTES = 1_000_000; // ~1MB
const TTL_SECONDS = 60 * 60 * 24; // 24h
const ID_BYTES = 16;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/upload") {
      return handleUpload(request, env);
    }
    if (request.method === "GET" && url.pathname.startsWith("/download/")) {
      const id = url.pathname.slice("/download/".length);
      return handleDownload(id, env);
    }
    return json({ error: "Not found" }, 404);
  },
};

async function handleUpload(request: Request, env: Env): Promise<Response> {
  const raw = await request.text();
  if (raw.length > MAX_BYTES) {
    return json({ error: "Payload too large" }, 413);
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  if (!isPayload(body)) {
    return json({ error: "Expected {salt, iv, ciphertext}" }, 400);
  }

  const id = randomId();
  await env.HANDOFF_KV.put(id, raw, { expirationTtl: TTL_SECONDS });
  return json({ id }, 201);
}

async function handleDownload(id: string, env: Env): Promise<Response> {
  if (!id) return json({ error: "Missing id" }, 400);
  const value = await env.HANDOFF_KV.get(id);
  if (value === null) {
    return json({ error: "Not found or expired" }, 404);
  }
  return new Response(value, {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function isPayload(x: unknown): boolean {
  return (
    typeof x === "object" &&
    x !== null &&
    typeof (x as Record<string, unknown>).salt === "string" &&
    typeof (x as Record<string, unknown>).iv === "string" &&
    typeof (x as Record<string, unknown>).ciphertext === "string"
  );
}

function randomId(): string {
  const bytes = new Uint8Array(ID_BYTES);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
