# ZONE NEW CHECKER (IPTV Checker)

Dark, modern IPTV checker UI for **Xtream Codes API** and **Stalker/MAG portals**.

You can run **Single** checks or **Bulk** checks, and (in Single mode) browse a **playlist viewer** (categories/genres + channel lists) with a fast, clean UI.

---

## Table of contents

- [What this does](#what-this-does)
- [What it does NOT do](#what-it-does-not-do)
- [Features](#features)
- [Quick start (Windows, ELI5)](#quick-start-windows-eli5)
- [Deploy to Vercel (recommended)](#deploy-to-vercel-recommended)
- [Project structure](#project-structure)
- [API routes (server)](#api-routes-server)
- [Security + privacy notes](#security--privacy-notes)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)

---

## What this does

Validates IPTV credentials and shows safe, non-streaming metadata:

- **Xtream**: `URL + username + password`
- **Stalker (MAC)**: `Portal URL + MAC address`

Displayed fields (depending on protocol):

- **Expiry date** (best-effort parsing; Stalker portals are inconsistent)
- **Max connections** (Xtream only; Stalker is unreliable and often omitted)
- **Real URL** (server-reported URL or portal URL)
- **Port**
- **Timezone**
- **Portal IP** (Stalker only; DNS lookup)
- **Channels count** (Stalker only; best-effort)

---

## What it does NOT do

- No playback.
- No streaming.
- No M3U exporting.
- No storing credentials server-side.

---

## Features

### Single mode

- One-click **Check** (validation + auto-load playlist)
- **Playlist Viewer**
  - Xtream categories + channels (fast)
  - Stalker genres + channels (paginated)
  - Search in categories/genres and channels
  - Remembers last selected category/genre per server (localStorage)
  - Clear selection button

### Bulk mode

- Concurrency-limited bulk runner (safer and faster)
- Inline validation + line counters
- Stop button (AbortController)
- Copy results

### Reliability

- Strict network timeouts on all portal requests
- Defensive parsing for inconsistent portals
- Image proxy route for logos (CORS/hotlink-safe)

---

## Quick start (Windows, ELI5)

### 1) Install Node.js

- Download Node.js **LTS**:
  - https://nodejs.org

### 2) Open PowerShell in the project folder

In File Explorer:

- Right-click the folder background
- Click **Open in Terminal** / **Open PowerShell window here**

### 3) Install dependencies

```bash
npm install
```

### 4) Run the dev server

```bash
npm run dev
```

### 5) Open the app

- Go to:
  - http://localhost:3000

---

## Deploy to Vercel (recommended)

Vercel is the easiest way to keep this online 24/7.

High-level idea:

1) Put your code in GitLab
2) Connect GitLab repo to Vercel
3) Vercel auto-builds and hosts it

### Build settings (Vercel)

- Framework preset: **Next.js** (auto-detected)
- Build command: `npm run build`
- Output: (auto)

No environment variables are required.

---

## Project structure

```text
app/
  page.tsx                 # UI (Single/Bulk modes + playlist viewer)
  layout.tsx               # Metadata (title/icons)
  globals.css              # Styling
  api/
    check/
      xtream/route.ts      # Xtream validation (player_api.php)
      stalker/route.ts     # Stalker validation + DNS lookup (Node runtime)
    playlist/
      xtream/route.ts      # Xtream categories/channels
      stalker/route.ts     # Stalker genres/channels (paginated)
    image/route.ts         # Logo proxy (hotlink/CORS safe)
lib/
  validation.ts            # input normalization + bulk parsing
  http.ts                  # fetchWithTimeout + safeJson
  types.ts                 # shared types
```

---

## API routes (server)

All routes return JSON with:

- `requestId` (uuid)
- `ok: boolean`
- `error?: string`

### `POST /api/check/xtream`

Validates Xtream credentials using:

- `player_api.php` with `action=get_user_info`

### `POST /api/check/stalker`

Validates Stalker portals using a handshake flow:

- Tries `portal.php` first
- Falls back to `/stalker_portal/server/load.php`

This route uses `dns/promises`, so it explicitly runs in **Node.js runtime** on Vercel.

### `POST /api/playlist/xtream`

Returns:

- categories (always)
- channels (only when `categoryId` is provided)

### `POST /api/playlist/stalker`

Returns:

- genres (always)
- channels (only when `genreId` is provided)
- pagination: `page`, `hasMore`

### `GET /api/image?url=...`

Logo proxy:

- restricts to `http/https`
- forwards an image response
- adds caching headers (`Cache-Control: public, max-age=86400`)

---

## Security + privacy notes

- This project stores your latest inputs/results in **your browser** via `localStorage`.
- The serverless API routes must forward credentials to IPTV portals (by design) to validate.
- No database is used.

If you want maximum privacy:

- self-host on your own domain
- avoid sharing deployed links publicly

---

## Troubleshooting

### “It works locally but not on Vercel”

- Some IPTV portals block datacenter/serverless IPs.
- Portals can be slow or return non-JSON HTML.

This app uses strict timeouts to avoid hanging.

### Lint/build errors

- Run:

```bash
npm install
npm run build
```

If you see ESLint/Next config conflicts, ensure `next` and `eslint-config-next` are pinned to the same version.

### Stalker portals are inconsistent

- Expiry can appear in unusual fields.
- Some portals require `/c` or other path; the app preserves Stalker URL paths.

---

## FAQ

### Does this play streams?

No.

### Does this store my credentials?

Only in your own browser (localStorage) for convenience.

### Why do logos sometimes fail?

Portals block hotlinking or have broken/relative URLs. The app proxies images via `/api/image`.

