export type InMemoryRateLimiter = {
  allow: (key: string) => boolean;
};

export const RATE_WINDOW_MS = 60_000;

export const RATE_MAX_CHECK_PER_WINDOW = 30;
export const RATE_MAX_PLAYLIST_PER_WINDOW = 20;

export function createInMemoryRateLimiter(windowMs: number, max: number): InMemoryRateLimiter {
  const state = new Map<string, { resetAt: number; count: number }>();

  return {
    allow(key: string) {
      const now = Date.now();
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
