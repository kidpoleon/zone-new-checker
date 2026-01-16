export type InMemoryRateLimiter = {
  allow: (key: string) => boolean;
};

export const RATE_WINDOW_MS = 60_000;

export const RATE_MAX_CHECK_PER_WINDOW = 30;
export const RATE_MAX_PLAYLIST_PER_WINDOW = 20;

export function createInMemoryRateLimiter(windowMs: number, max: number, maxEntries = 10_000): InMemoryRateLimiter {
  const state = new Map<string, { resetAt: number; count: number }>();
  let op = 0;

  function prune(now: number) {
    for (const [k, v] of state) {
      if (now >= v.resetAt) state.delete(k);
    }
    if (state.size <= maxEntries) return;
    const entries = Array.from(state.entries()).sort((a, b) => a[1].resetAt - b[1].resetAt);
    const remove = state.size - maxEntries;
    for (let i = 0; i < remove; i++) state.delete(entries[i]![0]);
  }

  return {
    allow(key: string) {
      const now = Date.now();
      op = (op + 1) % 250;
      if (op === 0 || state.size > maxEntries * 1.1) prune(now);
      const cur = state.get(key);
      if (!cur || now >= cur.resetAt) {
        state.set(key, { resetAt: now + windowMs, count: 1 });
        return true;
      }
      cur.count += 1;
      return cur.count <= max;
    },
  };
}

export function getClientIp(req: Request): string {
  const xf = req.headers.get("x-forwarded-for") || "";
  const first = xf.split(",")[0]?.trim();
  return first || "unknown";
}
