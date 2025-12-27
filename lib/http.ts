export async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit & { timeoutMs?: number } = {}) {
  // Wrapper around fetch() that aborts the request after timeoutMs.
  // This keeps Vercel serverless functions from hanging on slow IPTV portals.
  const { timeoutMs = 20000, ...rest } = init;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Use no-store so we don't accidentally cache credential-bound responses.
    const res = await fetch(input, { ...rest, signal: controller.signal, cache: "no-store" });
    return res;
  } finally {
    clearTimeout(timeout);
  }
}

export async function safeJson(res: Response): Promise<unknown> {
  // Some IPTV portals return HTML error pages while still responding with HTTP 200.
  // We surface a short snippet to make debugging easier.
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    const snippet = text.slice(0, 250);
    throw new Error(`Server returned non-JSON response. Snippet: ${snippet}`);
  }
}
