# 🤝 Contributing to Zone New Checker

Thank you for your interest in contributing! This document provides guidelines for contributing to the project.

## 📋 Table of Contents

- [Quick Start](#quick-start)
- [Development Setup](#development-setup)
- [Contribution Guidelines](#contribution-guidelines)
- [Pull Request Process](#pull-request-process)
- [Code Style](#code-style)
- [Testing](#testing)
- [Security](#security)

---

## 🚀 Quick Start

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/zone-new-checker.git
   cd zone-new-checker
   ```
3. **Create a feature branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```
4. **Install dependencies**:
   ```bash
   npm install
   ```
5. **Set up environment**:
   ```bash
   cp .env.example .env.local
   # Edit .env.local with your configuration
   ```
6. **Start development server**:
   ```bash
   npm run dev
   ```

---

## 🛠️ Development Setup

### Requirements

- Node.js >= 18.0.0
- npm >= 9.0.0

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Run TypeScript compiler check |
| `npm run clean` | Clean build artifacts |

---

## 📐 Contribution Guidelines

### What We're Looking For

- ✨ New features that align with project goals
- 🐛 Bug fixes with clear reproduction steps
- 📚 Documentation improvements
- 🎨 UI/UX enhancements with before/after screenshots
- ⚡ Performance optimizations

### What to Avoid

- ❌ Breaking changes without migration path
- ❌ New dependencies without justification
- ❌ Credential logging or sensitive data exposure
- ❌ Network requests without timeout handling
- ❌ Cacheable API routes for credential endpoints

### Code Standards

#### TypeScript

```typescript
// ✅ Good - Explicit types
function validateUrl(url: string): Result {
  // implementation
}

// ❌ Bad - Avoid 'any'
function validateUrl(url: any): any {
  // implementation
}
```

#### React Components

```typescript
// ✅ Good - Destructured props with types
interface ButtonProps {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

export function Button({ label, onClick, disabled }: ButtonProps) {
  return <button onClick={onClick} disabled={disabled}>{label}</button>;
}
```

#### Error Handling

```typescript
// ✅ Good - Specific error handling
try {
  const result = await fetchData();
} catch (e: unknown) {
  const error = e instanceof Error ? e.message : 'Unknown error';
  // Handle appropriately
}
```

---

## 📤 Pull Request Process

### Before Submitting

1. **Run quality checks**:
   ```bash
   npm run typecheck
   npm run lint
   npm run build
   ```

2. **Update documentation** if needed:
   - README.md for user-facing changes
   - CHANGELOG.md under `[Unreleased]`
   - API docs for endpoint changes

3. **Test your changes**:
   - Manual testing for UI changes
   - Verify no console errors
   - Check mobile responsiveness

### PR Template

When opening a pull request, please include:

```markdown
## Description
Brief description of what changed and why.

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Documentation update
- [ ] Performance improvement
- [ ] Code refactoring

## Screenshots (if applicable)
Before/after screenshots for UI changes.

## Testing
Steps to test the changes:
1. Step one
2. Step two
3. Expected result

## Checklist
- [ ] Code follows style guidelines
- [ ] Self-review completed
- [ ] Documentation updated
- [ ] No new warnings
```

### Review Process

1. Maintainers will review within 48-72 hours
2. Address review feedback promptly
3. PRs require approval from at least one maintainer
4. Squash commits before merge

---

## 🧪 Testing

### Manual Testing Checklist

- [ ] Feature works in development mode
- [ ] Feature works in production build
- [ ] Mobile responsive (test at 375px width)
- [ ] No console errors or warnings
- [ ] Accessibility (keyboard navigation, screen readers)

### API Testing

For API changes, test with:

```bash
# Example curl test
curl -X POST http://localhost:3000/api/check/xtream \
  -H "Content-Type: application/json" \
  -H "X-ZoneNew-Client: 1" \
  -d '{"url":"...","username":"...","password":"..."}'
```

---

## 🔒 Security

### Reporting Security Issues

**DO NOT** open public issues for security vulnerabilities.

Instead:
1. Email security@zone-new.com (example)
2. Include detailed reproduction steps
3. Allow 30 days for response before public disclosure

### Security Best Practices

When contributing:

- Never log credentials or tokens
- Validate all user inputs
- Use proper error handling (don't leak stack traces)
- Add rate limiting for new endpoints
- Follow SSRF protection patterns

---

## 📞 Getting Help

- 💬 **Discussions**: Use GitHub Discussions for questions
- 🐛 **Issues**: Report bugs with reproduction steps
- 📧 **Email**: For private inquiries

---

## 🙏 Recognition

Contributors will be:
- Listed in README.md contributors section
- Mentioned in release notes for significant contributions
- Given credit in commit messages (Co-authored-by)

Thank you for making Zone New Checker better! 🎉
