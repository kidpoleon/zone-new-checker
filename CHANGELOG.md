# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [3.1.2] - 2026-04-18

### Changed

**UI Cleanup:**
- **Removed Empty State Section**: Eliminated the "Ready for input" placeholder that created excessive vertical gap
- **Cleaner Layout**: Reduced visual clutter in Base64 mode
- **Better Space Efficiency**: More compact UI without the empty state banner

## [3.1.1] - 2026-04-18

### Changed

**UI/UX Polish:**
- **Sleeker Empty State**: Removed emoji, replaced with minimalist "Ready for input" text
- **Cleaner Visual Design**: Dashed border separator, uppercase typography, reduced padding
- **Consistent Styling**: Unified spacing and color scheme

**Documentation & Attribution:**
- **Updated Author**: Changed from "Zone New Team" to "kidpoleon <kidpoleon@proton.me>"
- **Updated LICENSE**: Copyright now reads "kidpoleon (kidpoleon@proton.me)"
- **README Updates**: 
  - Version bump to v3.1
  - Removed Reddit integration references
  - Updated feature descriptions to match current functionality
  - Fixed license attribution

**Vercel Analytics & Speed Insights:**
- **Enabled by Default**: Analytics and Speed Insights now active unless explicitly disabled
- **Opt-out Model**: Set `NEXT_PUBLIC_ENABLE_VERCEL_ANALYTICS=0` or `NEXT_PUBLIC_ENABLE_VERCEL_SPEED_INSIGHTS=0` to disable
- **Updated .env.example**: Documentation reflects new default behavior
- **Updated layout.tsx**: Changed logic from opt-in to opt-out

### Technical

- Updated `package.json` author field
- Updated `.env.example` header to v3.1
- Updated `layout.tsx` metadata and analytics logic
- Cleaned empty state component (removed emoji, streamlined design)

## [3.1.0] - 2026-04-18

### Added

**Smart Base64 Decoder with Full UX Enhancements:**

- **Smart Paste Detection**: Automatically detects if clipboard contains URLs vs Base64
- **URL Type Detection**: Recognizes Xtream/Stalker URLs and suggests correct mode switch
- **Auto-Trim Whitespace**: Automatically removes extra spaces and newlines from pasted text
- **Color-Coded Validation**: Real-time visual feedback (green=valid, yellow=partial, red=invalid)
- **Validation Status Indicator**: Text feedback showing "Valid Base64 - ready to decode" etc.
- **First-Time User Onboarding**: Helpful hint tooltip for new users with dismiss button
- **Empty State Illustration**: Visual guidance when no input is present
- **Full ARIA Support**: Complete accessibility labels, roles, and live regions
- **Enhanced Focus Indicators**: Color-coded focus rings matching validation state
- **Keyboard Shortcuts**: Ctrl+Enter to decode with visible hint

### Technical

- Added state: `validationStatus`, `detectedType`, `isFirstTimeUser`, `showHint`
- Added effects: first-time detection, smart validation
- CSS animations: `fadeInSlide`, color-coded focus states
- localStorage: `zone_checker_base64_used` for first-time tracking

## [3.0.5] - 2026-04-18

### Changed

**Schneidermann's Golden Rules of Interface Design Implementation:**

1. **Consistency** - Unified button styling and behavior patterns
2. **Shortcuts** - Added Ctrl+Enter keyboard shortcut for power users
3. **Feedback** - Enhanced toast notifications for all user actions
4. **Closure** - Visual feedback when decode completes successfully
5. **Error Handling** - Clear, actionable error messages with recovery options
6. **Reversal** - Clear button provides easy reset with confirmation toast
7. **Control** - Users have explicit control via keyboard and mouse
8. **Memory Load** - Dynamic button reduces cognitive load ( Paste → Decode )

**UI Improvements:**
- **Dynamic Primary Button**: Shows "Paste" when empty, "Decode" when filled
- **Removed Redundant Decode Button**: Single primary action reduces confusion
- **Keyboard Shortcuts**: Ctrl+Enter to decode (power user feature)
- **Auto-focus**: Input field auto-focused on Base64 mode selection
- **Tooltips**: Added title attributes for accessibility and guidance
- **Clear Button**: Only enabled when there's content to clear

### Technical

- Updated `smartPasteAndDecode()` to set `hasInput` state
- Added `onKeyDown` handler for Ctrl+Enter shortcut
- Simplified button layout (2 buttons instead of 3)
- Enhanced toast feedback for all actions

## [3.0.4] - 2026-04-18

### Removed

- **Reddit Integration Removed**: Completely removed "Fetch from Reddit" and "Open Reddit" functionality
- Reddit API access is permanently blocked by Reddit's anti-bot measures
- All Reddit-related state variables, functions, and UI elements removed

### Changed

- **Simplified Base64 Decoder UI**: Cleaner interface with only essential buttons
- **Smart "Paste & Decode" Button**: New primary action that pastes from clipboard and auto-decodes if valid Base64
- **Updated Placeholder**: Simple, clear instruction "Paste Base64 string here (starts with aHR0, ends with =)"
- **Cleaner Output**: Removed Reddit metadata display from decoded output

### Technical

- Removed: `fetchRedditPost()`, `openRedditForManualCopy()`, `hasRedditUrl`, `redditBase64List`, `redditMeta`, `fetchingReddit`
- Added: `smartPasteAndDecode()` for combined paste+decode action
- Simplified Base64 mode state management

## [3.0.3] - 2026-04-18

### Changed

- **Reddit Fetch Fallback**: When Reddit API is blocked, app now offers to open the post in a new tab
- **Manual Copy Helper**: Added "Open Reddit ↗" button for easy access to manually copy Base64 text
- **Improved UX**: Clear instructions shown when automatic fetching fails
- **Better Error Messages**: Step-by-step guide for manual Base64 extraction

### Technical

- Added `openRedditForManualCopy()` helper function
- Updated Fetch button to detect API failures and offer manual fallback
- Added confirmation dialog before opening external link
- Maintains API attempt first (in case Reddit unblocks in future)

## [3.0.2] - 2026-04-18

### Fixed

- **Reddit API 403 Error**: Resolved "Access denied" error when fetching Reddit posts
- **Old Reddit Domain**: Automatically converts URLs to `old.reddit.com` for better API access
- **Enhanced Headers**: Added browser-like headers (Accept-Language, Referer, Origin, Sec-Fetch, etc.) to bypass Reddit's blocking
- **Fallback Logic**: If old.reddit.com fails, automatically tries www.reddit.com as backup
- **Better Error Messages**: More descriptive errors explaining Reddit's API restrictions and suggesting alternative approaches

### Technical

- Added `fetchRedditJson()` helper with realistic browser headers
- Updated `cleanRedditUrl()` to convert domains to old.reddit.com
- Implemented try/catch with fallback between old and www domains
- Added proper timeout handling for both fetch attempts

## [3.0.1] - 2026-04-18

### Changed

- **Proactive Verification**: Turnstile widget now appears immediately on page load when verification is required, instead of redirecting to a separate verify page
- Improved UX flow - users can see verification status before attempting to use features
- Reduced friction - no jarring redirects between pages

### Added

- New `/api/check-verification` endpoint for checking verification status on mount
- Inline verification banner with Turnstile widget integrated directly into main UI
- CSS styling for verification banner (mobile-responsive)
- Real-time verification feedback with success toast notification

### Technical

- Moved from redirect-based to inline verification pattern
- Added verification state management in main page component
- Turnstile callbacks now handled via window object for inline widget

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
