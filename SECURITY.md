# 🔒 Security Policy

## 📋 Table of Contents

- [Reporting Vulnerabilities](#reporting-vulnerabilities)
- [Security Measures](#security-measures)
- [Supported Versions](#supported-versions)
- [Security Best Practices](#security-best-practices)
- [Hall of Fame](#hall-of-fame)

---

## 🚨 Reporting Vulnerabilities

**DO NOT** open public issues for security vulnerabilities.

We take security seriously and appreciate your help in disclosing issues responsibly.

### How to Report

| Method | Contact |
|--------|---------|
| **Preferred** | Private GitHub Security Advisory |
| **Email** | security@zone-new.com (example) |
| **Encrypted** | PGP Key: [Download](https://zone-new.com/pgp.asc) |

### What to Include

Your report should include:

1. **Description** - Clear explanation of the vulnerability
2. **Reproduction Steps** - Detailed steps to reproduce
3. **Impact Assessment** - What could an attacker achieve?
4. **Affected Versions** - Which versions are vulnerable
5. **Suggested Fix** - Optional, but appreciated
6. **Your Contact** - How to reach you for clarifications

### Response Timeline

| Phase | Timeline |
|-------|----------|
| **Acknowledgment** | Within 48 hours |
| **Initial Assessment** | Within 7 days |
| **Fix Development** | Depends on severity (30-90 days) |
| **Public Disclosure** | After fix is deployed + 30 days |

### Disclosure Policy

We follow responsible disclosure:

- 🔒 **Private period** - Issue kept confidential during fix
- 🛠️ **Fix development** - We work on a patch
- 📢 **Public disclosure** - After 30 days from fix deployment
- 🏆 **Recognition** - Reporter credited (unless anonymous)

---

## 🛡️ Security Measures

### Current Protections

| Feature | Implementation |
|---------|---------------|
| **Human Verification** | Cloudflare Turnstile |
| **Rate Limiting** | Per-IP in-memory tracking |
| **Authentication** | Signed HttpOnly cookies |
| **SSRF Protection** | URL validation on image proxy |
| **Credential Handling** | Server-side stateless, no storage |

### Data Handling

- ✅ **No credential storage** - Credentials are never saved
- ✅ **No logging of secrets** - Logs filter sensitive data
- ✅ **Secure headers** - Security headers on all responses
- ✅ **CORS restrictions** - Proper CORS policy

---

## ✅ Supported Versions

| Version | Supported | Notes |
|---------|-----------|-------|
| **3.0.x** | ✅ Fully supported | Current stable |
| **2.0.x** | ⚠️ Best effort | Critical fixes only |
| **1.x.x** | ❌ End of life | Please upgrade |

Security patches are applied to:
- `main` branch (current development)
- Latest stable release tag

---

## 🔐 Security Best Practices

### For Users

1. **Keep dependencies updated**
   ```bash
   npm audit fix
   ```

2. **Use strong secrets**
   ```bash
   # Generate secure cookie secret
   openssl rand -base64 32
   ```

3. **Enable all protections**
   ```env
   # .env.local
   NEXT_PUBLIC_TURNSTILE_SITE_KEY=your_key
   TURNSTILE_SECRET_KEY=your_secret
   HUMAN_COOKIE_SECRET=strong_random_string
   ```

4. **Regular security audits**
   ```bash
   npm audit
   ```

### For Developers

1. **Never commit secrets** - Always use environment variables
2. **Validate all inputs** - Sanitize user data
3. **Add timeouts** - All network requests must have timeouts
4. **Error handling** - Don't leak sensitive info in errors
5. **Rate limiting** - Add limits to all endpoints

---

## 🏆 Hall of Fame

We thank the following security researchers for their responsible disclosures:

| Researcher | Finding | Date |
|------------|---------|------|
| *Your name here* | - | - |

---

## 📞 Contact

- 📧 **Security Email**: security@zone-new.com
- 🔐 **PGP Fingerprint**: `A1B2 C3D4 E5F6 7890 1234 A1B2 C3D4 E5F6 7890 1234`
- 🐛 **GitHub Security**: Use "Report a vulnerability" button

---

**Last Updated**: April 2026  
**Policy Version**: 3.0
