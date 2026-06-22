/**
 * ctx-handoff link codec.
 *
 * Format: ctx-handoff://<workerHost>/<id>
 *
 *   - workerHost: the worker host (no scheme), e.g.
 *     "ctx-handoff.example.deno.net". https is always assumed.
 *   - id:         the KV record id returned by the worker on upload.
 *
 * The password is never part of the link — the sender shares it out of band and
 * the receiver is prompted for it, keeping the transport zero-knowledge.
 */

export interface HandoffLink {
  workerHost: string;
  id: string;
}

const LINK_RE = /^ctx-handoff:\/\/([^/]+)\/([^#]+)$/;

export function encodeLink(link: HandoffLink): string {
  const { workerHost, id } = link;
  if (!workerHost || !id) {
    throw new Error("encodeLink: workerHost and id are required.");
  }
  return `ctx-handoff://${stripScheme(workerHost)}/${encodeURIComponent(id)}`;
}

export function decodeLink(raw: string): HandoffLink {
  const match = LINK_RE.exec(raw.trim());
  if (!match) {
    throw new Error("Invalid ctx-handoff link. Expected: ctx-handoff://<host>/<id>");
  }
  const [, workerHost, id] = match;
  return {
    workerHost: stripScheme(workerHost),
    id: decodeURIComponent(id),
  };
}

/** Build the https base URL for the worker from a stored host. */
export function workerBaseUrl(workerHost: string): string {
  return `https://${stripScheme(workerHost)}`;
}

function stripScheme(host: string): string {
  return host.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}
