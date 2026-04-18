<div align="center">

# 🔐 Zone New Checker v3.1

**Professional IPTV Credential Validator with Smart Base64 Decoding**

[![Version](https://img.shields.io/badge/version-3.1.0-blue.svg)](./CHANGELOG.md)
[![Next.js](https://img.shields.io/badge/Next.js-14.2-000000?logo=next.js)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-18.3-61DAFB?logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?logo=typescript)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

</div>

---

## 📋 Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Quick Start](#quick-start)
- [Installation](#installation)
- [Configuration](#configuration)
- [Deployment](#deployment)
- [Security](#security)
- [API Reference](#api-reference)
- [Project Structure](#project-structure)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)

---

## 🎯 Overview

Zone New Checker is a professional-grade IPTV credential validation tool with advanced Base64 decoding capabilities and Reddit integration. Built with Next.js and React, it provides a secure, performant interface for validating Xtream Codes and Stalker/MAG portal credentials.

### What It Does

- ✅ Validates **Xtream Codes** credentials (`URL + username + password`)
- ✅ Validates **Stalker/MAG** portals (`Portal URL + MAC address`)
- ✅ **Base64 decoding** with URL extraction from decoded content
- ✅ **Smart Base64 decoding** - auto-detects valid Base64 with visual feedback
- ✅ Displays safe metadata only (no playback/streaming)
- ✅ Human verification via Cloudflare Turnstile

### Displayed Information

| Portal Type | Available Data |
|------------|----------------|
| **Xtream** | Expiry date, max connections, active connections, real URL, port, timezone |
| **Stalker** | Expiry date, portal IP, channels count, timezone |
| **Base64** | Decoded content, extracted URLs, smart validation |

---

## ✨ Features

### 🎮 Single Mode

- **One-click credential validation**
- **Playlist viewer** with:
  - Xtream categories + live channels
  - Stalker genres + channels (auto-pagination)
  - Fast search with debounced input
  - Sorting and filtering

### 📊 Bulk Mode

- **Concurrency-limited runner** (prevents portal overload)
- **Real-time progress tracking**
- **Abort support** - stop anytime with AbortController
- **Copy results** to clipboard

### 🔐 Security Features

- **Cloudflare Turnstile** human verification
- **Signed HttpOnly cookies** (5-minute validity)
- **Per-IP rate limiting** (in-memory)
- **SSRF protections** on `/api/image` endpoint
- **No credential storage** - server-side stateless

### 🔧 Base64 Decoder

- **Smart detection** of Base64 in messy input
- **Smart validation** - color-coded feedback (green/yellow/red)
- **URL detection** - suggests correct mode for URLs
- **URL-safe Base64** support
- **Automatic URL extraction** from decoded content

---

## 🚀 Quick Start

```bash
# 1. Clone repository
git clone https://github.com/kidpoleon/zone-new-checker.git
cd zone-new-checker

# 2. Install dependencies
npm install

# 3. Copy environment template
cp .env.example .env.local

# 4. Edit .env.local with your Cloudflare Turnstile keys

# 5. Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## 📦 Installation

### Requirements

- **Node.js** >= 18.0.0 LTS
- **npm** >= 9.0.0 (or pnpm/yarn)

### Optional

- **Docker** Desktop / Docker Engine + Compose v2

---

## ⚙️ Configuration

### Required Environment Variables

| Variable | Description | Source |
|----------|-------------|--------|
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Cloudflare Turnstile site key (public) | [Cloudflare Dashboard](https://dash.cloudflare.com/turnstile) |
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile secret (server-only) | [Cloudflare Dashboard](https://dash.cloudflare.com/turnstile) |
| `HUMAN_COOKIE_SECRET` | Random secret for signing cookies (≥32 chars) | Generate: `openssl rand -base64 32` |

### Optional Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `TURNSTILE_ALLOWED_HOSTNAMES` | Comma-separated allowed domains | All domains |
| `NEXT_PUBLIC_ENABLE_VERCEL_ANALYTICS` | Enable Vercel Web Analytics | `0` |
| `NEXT_PUBLIC_ENABLE_VERCEL_SPEED_INSIGHTS` | Enable Vercel Speed Insights | `0` |

### Environment Files

```bash
.env.example       # Template (committed)
.env.local         # Local development (gitignored)
.env.production    # Production (gitignored)
```

---

## 🌐 Deployment

### Vercel (Recommended)

1. Push to GitHub/GitLab
2. Import in [Vercel Dashboard](https://vercel.com)
3. Add environment variables in Project Settings
4. Deploy automatically on push

**Build Settings:**
- Framework: Next.js
- Build Command: `npm run build`
- Output: Static (if configured) or Server

### Docker

```bash
# Using Docker Compose (recommended)
docker compose up -d --build

# Access at http://localhost:3000

# Stop
docker compose down
```

### Self-Hosted

```bash
# Build
npm run build

# Start production server
npm run start
```

---

## 🔒 Security

### Secret Management

⚠️ **CRITICAL**: Never commit environment files containing secrets.

```bash
# Verify before committing
git status

# Ensure these are NOT staged:
# - .env.local
# - .env
# - .env.*.local
```

### Verification Flow

```
User Request → Turnstile Check → Cookie Validation → API Access
     ↓              ↓                    ↓               ↓
   Initial      Cloudflare         Signed           Protected
   Load          Widget           Cookie            Routes
```

### Rate Limiting

- **Per-IP limits**: In-memory tracking
- **Time window**: 60 seconds
- **Max requests**: 120 per window (image API), 10 per minute (Reddit API)

### Protected Endpoints

| Endpoint | Protection |
|----------|------------|
| `/api/check/*` | Turnstile + Cookie + Rate Limit |
| `/api/playlist/*` | Turnstile + Cookie + Rate Limit |
| `/api/fetch-reddit` | Turnstile + Cookie + Rate Limit |
| `/api/image` | Client header + Rate Limit |

---

## 📚 API Reference

### Response Format

All API routes return JSON:

```json
{
  "requestId": "uuid",
  "ok": true,
  "error": "string?",
  "data": {}
}
```

### Required Headers

All POST routes require:

```
Content-Type: application/json
X-ZoneNew-Client: 1
```

### Available Routes

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/api/check/xtream` | Validate Xtream credentials |
| `POST` | `/api/check/stalker` | Validate Stalker MAC |
| `POST` | `/api/playlist/xtream` | Fetch Xtream categories/channels |
| `POST` | `/api/playlist/stalker` | Fetch Stalker genres/channels |
| `POST` | `/api/verify-human` | Verify Turnstile token |
| `GET`  | `/api/image?url=...` | Proxy image with SSRF protection |

---

## 📁 Project Structure

```
zone-new-checker/
├── app/                          # Next.js App Router
│   ├── api/                      # API Routes
│   │   ├── check/               # Credential validation
│   │   │   ├── xtream/
│   │   │   └── stalker/
│   │   ├── fetch-reddit/        # Reddit integration
│   │   ├── image/               # Image proxy
│   │   ├── playlist/            # Playlist APIs
│   │   │   ├── xtream/
│   │   │   └── stalker/
│   │   └── verify-human/        # Turnstile verification
│   ├── verify/                  # Verification page
│   ├── globals.css              # Global styles
│   ├── layout.tsx               # Root layout
│   └── page.tsx                 # Main application
├── lib/                         # Shared utilities
│   ├── http.ts                  # HTTP helpers
│   ├── humanVerification.ts     # Turnstile verification
│   ├── rateLimit.ts             # Rate limiting
│   ├── types.ts                 # TypeScript types
│   └── validation.ts            # Input validation
├── src/                         # Future modular components
│   ├── components/              # React components
│   ├── hooks/                   # Custom React hooks
│   ├── utils/                   # Utility functions
│   └── types/                   # Extended types
├── tests/                       # Test files
├── docs/                        # Documentation
├── scripts/                     # Build/utility scripts
├── .env.example                 # Environment template
├── .gitignore                   # Git exclusions
├── .dockerignore                # Docker exclusions
├── docker-compose.yml           # Docker orchestration
├── Dockerfile                   # Container definition
├── next.config.mjs              # Next.js configuration
├── package.json                 # Dependencies & scripts
├── README.md                    # This file
├── CHANGELOG.md                 # Version history
├── CONTRIBUTING.md              # Contribution guide
├── CODE_OF_CONDUCT.md          # Community guidelines
├── SECURITY.md                  # Security policy
└── LICENSE                      # MIT License
```

---

## 🔧 Troubleshooting

### "Server not configured" on Verify Page

| Cause | Solution |
|-------|----------|
| Missing site key | Set `NEXT_PUBLIC_TURNSTILE_SITE_KEY` in `.env.local` |
| Cache issue | Restart dev server after editing env |
| Build not refreshed | Run `npm run build` again |

### Verification Fails

1. Verify `TURNSTILE_SECRET_KEY` is correct
2. Check domain is allowed in Cloudflare Turnstile settings
3. Ensure system time is accurate (affects token validation)

### Vercel Deployment Issues

| Symptom | Cause | Solution |
|---------|-------|----------|
| Timeouts | Portal blocks DC IPs | Reduce concurrency, add delays |
| 500 errors | Missing env vars | Check Vercel environment settings |
| Verification loop | Cookie issues | Check `HUMAN_COOKIE_SECRET` length |

### Development Issues

```bash
# Clear all caches
npm run clean
rm -rf .next node_modules
npm install

# Type check
npm run typecheck

# Lint check
npm run lint
```

---

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

### Quick Steps

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

---

## 📄 Documentation

- [Changelog](./CHANGELOG.md) - Version history
- [Contributing](./CONTRIBUTING.md) - Contribution guidelines
- [Code of Conduct](./CODE_OF_CONDUCT.md) - Community standards
- [Security Policy](./SECURITY.md) - Reporting vulnerabilities

---

## 📜 License

[MIT License](./LICENSE) © kidpoleon <kidpoleon@proton.me>

---

<div align="center">

**[⬆ Back to Top](#zone-new-checker-v30)**

Built with ❤️ using Next.js, React & TypeScript

</div>
