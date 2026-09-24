import { Agent } from "undici";

const NODE_MAJOR = Number(process.versions.node.split(".")[0]);

let http1Fetch: typeof fetch | undefined;

/**
 * The fetch for calls to outside services (Anthropic, Resend). From Node 25 the built-in fetch
 * negotiates HTTP/2, and on Node 26 an HTTP/2 connection to api.anthropic.com was seen stuck at
 * 100% CPU, its write buffer growing until the process ran out of memory. HTTP/1.1 avoids that
 * code path. Node 24 (what Vercel runs; see "engines") already uses HTTP/1.1, so it keeps the
 * built-in fetch.
 */
export function outboundFetch(): typeof fetch {
  if (NODE_MAJOR < 25) return fetch;
  if (!http1Fetch) {
    // The built-in fetch (looked up per call, so test stubs still apply) with an HTTP/1.1-only
    // connection pool. `dispatcher` is undici's extension to fetch's options.
    const dispatcher = new Agent({ allowH2: false });
    http1Fetch = (input, init) => globalThis.fetch(input, { ...init, dispatcher } as RequestInit);
  }
  return http1Fetch;
}
