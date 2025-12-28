# Contributing

## Quick start

1) Fork the repo
2) Create a feature branch
3) Install dependencies:

```bash
npm install
```

4) Run locally:

```bash
npm run dev
```

## Guidelines

- Keep changes small and focused.
- Prefer TypeScript types over `any`.
- Don’t add logging that could capture credentials.
- Don’t introduce new network fetches without strict timeouts.
- Keep API routes non-cacheable when they handle credentials.

## Pull requests

Please include:

- What changed and why
- Screenshots for UI changes
- Steps to test

## Security

If you find a security issue, please follow the instructions in `SECURITY.md`.
