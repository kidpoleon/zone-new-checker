# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [3.0.0] - 2026-04-18

### 🎉 Major Release - Professional Edition

### Added

#### Base64 Decoder & Reddit Integration
- **Smart Base64 extraction** from messy/encoded input
- **Reddit API integration** - fetch and decode credentials directly from Reddit posts
- **Metadata extraction** - display Reddit post author (`u/username`) and timestamp
- **Short link support** - resolves `reddit.com/r/*/s/*` and `redd.it/*` URLs
- **Multiple Base64 detection** - handles posts with multiple encoded strings
- **URL extraction** from decoded Base64 content
- **paste.sh integration** - direct link opening from decoded URLs

#### UI/UX Improvements
- **Toast notification system** with 4 types: success, error, warning, info
- **Mobile-first responsive design** - improved touch targets and layouts
- **Loading states** - spinner animations for async operations
- **Paste button** - direct clipboard access for quick input
- **Conditional Fetch button** - appears only when Reddit URL detected
- **Professional color-coded feedback** - green/red/yellow/blue toast states

#### API Enhancements
- **`/api/fetch-reddit`** endpoint with:
  - Rate limiting (10 requests/minute per IP)
  - Short link resolution
  - Comprehensive error handling with specific HTTP status messages
  - Author and timestamp metadata extraction
- **Improved error messages** for all API routes
- **Better timeout handling** with AbortController

#### Developer Experience
- **Comprehensive `.gitignore`** with IDE, OS, and tool patterns
- **Professional `.dockerignore`** optimized for build context
- **`.env.example`** template with detailed documentation
- **New npm scripts**: `typecheck`, `clean`
- **Enhanced package.json** with metadata, engines, and keywords
- **Professional folder structure** with `src/`, `tests/`, `docs/`, `scripts/`

### Changed

- **README.md** completely rewritten with:
  - Professional badge headers
  - Table-based documentation
  - Flow diagrams
  - Better navigation and structure
  - Comprehensive troubleshooting guide
- Updated all documentation files for v3.0 branding

### Security

- Enhanced rate limiting across all protected endpoints
- Improved error handling to prevent information leakage
- SSRF protection verification on all external fetch operations

## [2.0.0] - 2026-01-17

### Added

- Cloudflare Turnstile human verification gate for `/api/check/*` and `/api/playlist/*`
- `/verify` page and `/api/verify-human` endpoint
- Signed HttpOnly "human verified" cookie (5 minute TTL) to reduce abuse
- Turnstile callbacks for error/expired/timeout UX
- Additional hardening on verification endpoint (rate limit + client header gate)
- Docker Compose support
- SSRF/rate-limit hardening for `/api/image`
- In-memory per-IP rate limiting for `/api/check/*` and `/api/playlist/*`
- Bulk sorting improvements using `expiryTs`

### Changed

- Improved verify flow UX (centered, themed UI) and abort in-flight bulk requests when verification is required
- Vercel Analytics and Speed Insights are now opt-in via `NEXT_PUBLIC_ENABLE_VERCEL_ANALYTICS=1` and `NEXT_PUBLIC_ENABLE_VERCEL_SPEED_INSIGHTS=1`
- Stalker expiry date output is now stable and sortable

## [1.0.0] - 2025-12-29

### Added

- Initial public release with Xtream Codes and Stalker/MAG portal support
- Single and bulk credential validation modes
- Playlist viewer with categories and channels
- Basic UI with credential input and results display
