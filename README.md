
# ZONE NEW CHECKER (IPTV Checker) — v2.0.0

IPTV checker UI for **Xtream Codes API** and **Stalker/MAG portals**.

This app validates credentials and displays **safe metadata only** (no playback / no streaming). It also includes a **free Cloudflare Turnstile** human verification gate to reduce abuse on public deployments.

## Table of contents

- What this does / does not do
- Features
- Requirements
- Quick start (local dev)
- Production run (local)
- Deploy to Vercel
- Run with Docker
- Environment variables
- Security model (anti-abuse + anti-tamper)
- Project structure
- API routes
- Troubleshooting

---

## What this does

Validates IPTV credentials and shows metadata:

- **Xtream**: `URL + username + password`
- **Stalker (MAC)**: `Portal URL + MAC address`

Shows (best-effort, depends on portal):

- expiry date
- max connections (Xtream)
- real URL / port / timezone
- portal IP (Stalker)
- channels count (Stalker, best-effort)

## What this does NOT do

- no playback
- no streaming
- no M3U export
- no server-side storage of credentials

---

## Features

### Single mode

- One-click check
- Playlist viewer
  - Xtream categories + channels
  - Stalker genres + channels (server paginates for you)
  - fast search + sorting

### Bulk mode

- concurrency-limited runner
- stop button (AbortController)
- copy results

### Abuse protection (free)

- Turnstile verification gate for expensive APIs
- 5-minute signed HttpOnly cookie (aligned with Turnstile token lifetime)
- per-IP in-memory rate limiting
- `/api/image` SSRF protections

---

## Requirements

- Node.js LTS (recommended)
- npm

Optional:

- Docker Desktop / Docker Engine + Docker Compose v2

---

## Quick start (local dev)

1) Install dependencies:

```bash
npm install
```

2) Create `.env.local` (gitignored):

```env
# Turnstile (public)
NEXT_PUBLIC_TURNSTILE_SITE_KEY=...

# Turnstile (server-only)
TURNSTILE_SECRET_KEY=...

# random secret for signing the 5-minute verification cookie
HUMAN_COOKIE_SECRET=...

# optional allowlist (comma-separated)
# TURNSTILE_ALLOWED_HOSTNAMES=localhost,zone-new-checker.vercel.app

# optional: Vercel metrics (works on Vercel)
# NEXT_PUBLIC_ENABLE_VERCEL_ANALYTICS=1
# NEXT_PUBLIC_ENABLE_VERCEL_SPEED_INSIGHTS=1
```

3) Run dev server:

```bash
npm run dev
```

Open:

- http://localhost:3000

---

## Production run (local)

```bash
npm run build
npm run start
```

---

## Deploy to Vercel (recommended)

1) Push repo to GitHub/GitLab
2) Import into Vercel
3) Vercel builds and hosts it

Build settings:

- framework: Next.js (auto)
- build command: `npm run build`
- output: auto

### Environment variables (Vercel)

Set these in **Project → Settings → Environment Variables**:

- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
- `TURNSTILE_SECRET_KEY`
- `HUMAN_COOKIE_SECRET`

Optional:

- `TURNSTILE_ALLOWED_HOSTNAMES` (comma-separated)

- `NEXT_PUBLIC_ENABLE_VERCEL_ANALYTICS=1`
- `NEXT_PUBLIC_ENABLE_VERCEL_SPEED_INSIGHTS=1`

---

## Run with Docker

### Option A: Docker Compose (recommended)

1) Create `.env` next to `docker-compose.yml` (gitignored):

```env
NEXT_PUBLIC_TURNSTILE_SITE_KEY=...
TURNSTILE_SECRET_KEY=...
HUMAN_COOKIE_SECRET=...

# optional
# NEXT_PUBLIC_ENABLE_VERCEL_ANALYTICS=1
# NEXT_PUBLIC_ENABLE_VERCEL_SPEED_INSIGHTS=1
```

2) Start:

```bash
docker compose up -d --build
```

Open:

- http://localhost:3000

Stop:

```bash
docker compose down
```

---

## Security model (important)

### Secrets safety (DO NOT LEAK)

- Never commit `.env.local`, `.env`, or any `TURNSTILE_*` keys.
- This repo’s `.gitignore` already ignores:
  - `.env`
  - `.env.local`
  - `.env.*.local`

Before pushing:

```bash
git status
```

Confirm no env files are staged.

### Human verification gate

- Protected endpoints: `/api/check/*` and `/api/playlist/*`
- When not verified, APIs return `403` with `code: human_verification_required`
- UI redirects to `/verify`
- After success, server sets a **signed HttpOnly cookie** valid for **5 minutes**

### Rate limiting

- In-memory per-IP limits are used (works well for single-instance/self-host)
- On serverless (Vercel), limits are best-effort per instance

---

## Project structure

```text
app/
  page.tsx
  verify/
    page.tsx
    VerifyClient.tsx
  api/
    check/
    playlist/
    verify-human/
    image/
lib/
  http.ts
  humanVerification.ts
  rateLimit.ts
  types.ts
  validation.ts
```

---

## API routes

All routes return JSON:

- `requestId`
- `ok`
- `error?`

All POST routes require:

- `Content-Type: application/json`
- `X-ZoneNew-Client: 1`

Routes:

- `POST /api/check/xtream`
- `POST /api/check/stalker`
- `POST /api/playlist/xtream`
- `POST /api/playlist/stalker`
- `POST /api/verify-human`
- `GET /api/image?url=...`

---

## Troubleshooting

### Verify page says “Server not configured”

- Ensure `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is set.
- Restart dev server after editing `.env.local`.

### Verification fails

- Ensure `TURNSTILE_SECRET_KEY` is correct.
- Confirm your Turnstile widget allows your domain.

### Vercel build works locally but fails on Vercel

- Some IPTV portals block data center IPs.
- Tighten client concurrency or expect more timeouts.

---

## License / Docs

- License: `LICENSE`
- Changelog: `CHANGELOG.md`
- Security policy: `SECURITY.md`

