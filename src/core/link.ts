/**
 * Handoff link codec.
 *
 * Format: handoff://<workerHost>/<id>#<password>
 *
 *   - workerHost: the Cloudflare Worker host (no scheme), e.g.
 *     "handoff.myname.workers.dev". https is always assumed.
 *   - id:         the KV record id returned by the worker on upload.
 *   - password:   the symmetric password in the URL fragment. The fragment
 *     never leaves the local machine when fetching (it is client-side only),
 *     keeping the transport zero-knowledge.
 */

export interface HandoffLink {
  workerHost: string;
  id: string;
  /** Empty when the link omits the fragment; the receiver is then prompted. */
  password: string;
}

const LINK_RE = /^handoff:\/\/([^/]+)\/([^#]+)(?:#(.*))?$/;

export function encodeLink(link: HandoffLink): string {
  const { workerHost, id, password } = link;
  if (!workerHost || !id || !password) {
    throw new Error("encodeLink: workerHost, id and password are all required.");
  }
  return `handoff://${stripScheme(workerHost)}/${encodeURIComponent(id)}#${encodeURIComponent(password)}`;
}

export function decodeLink(raw: string): HandoffLink {
  const match = LINK_RE.exec(raw.trim());
  if (!match) {
    throw new Error(
      "Invalid handoff link. Expected: handoff://<host>/<id>#<password>",
    );
  }
  const [, workerHost, id, password] = match;
  return {
    workerHost: stripScheme(workerHost),
    id: decodeURIComponent(id),
    password: password ? decodeURIComponent(password) : "",
  };
}

/** Build the https base URL for the worker from a stored host. */
export function workerBaseUrl(workerHost: string): string {
  return `https://${stripScheme(workerHost)}`;
}

function stripScheme(host: string): string {
  return host.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}
