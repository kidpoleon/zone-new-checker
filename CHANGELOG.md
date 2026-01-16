# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project adheres to Semantic Versioning.

## [Unreleased]

### Added

- Docker Compose support.
- SSRF/rate-limit hardening for `/api/image`.
- In-memory per-IP rate limiting for `/api/check/*` and `/api/playlist/*`.
- Bulk sorting improvements using `expiryTs`.

### Changed

- Vercel Analytics and Speed Insights are now opt-in via `NEXT_PUBLIC_ENABLE_VERCEL_ANALYTICS=1` and `NEXT_PUBLIC_ENABLE_VERCEL_SPEED_INSIGHTS=1`.

- Stalker expiry date output is now stable and sortable.

## [1.0.0] - 2025-12-29

### Added

- Initial public release.
