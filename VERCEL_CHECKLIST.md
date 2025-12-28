# Vercel Production Checklist (Zone New Checker)

## Edge/WAF protections (recommended)
- Enable Vercel WAF on the project.
- Add rate limiting rules for:
  - `/api/check/*`
  - `/api/playlist/*`
  - `/api/image`
- Prefer per-IP + per-path rules.
- Block/limit obvious bot traffic.

## Bot protection
- If available on your plan, enable bot protection (managed rules / bot detection) for:
  - `/api/check/*`
  - `/api/playlist/*`

## Caching rules
- Credential-related endpoints must never be cached.
  - Confirm `Cache-Control: no-store` is present on all `/api/check/*` and `/api/playlist/*` responses.
- `/api/image` may be cached.
  - Confirm it returns `Cache-Control: public, max-age=86400` on success.
  - Confirm errors are `Cache-Control: no-store`.

## Observability
- Monitor:
  - 429 rate-limit events
  - upstream 502s
  - timeout errors
- If you see frequent timeouts, reduce client concurrency and/or reduce upstream timeouts.
