# HaleyH Creations CRM

Customer relationship management for HaleyH Creations, built with Next.js 16, React 19, TypeScript and Tailwind CSS 4.

## Getting started

Requires Node.js 22.22.2+, 24.15+ or 26+ (see `.nvmrc`).

```bash
npm install
cp .env.example .env.local   # then fill in values
npm run dev
```

Open http://localhost:3000.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and server |
| `npm run check` | Lint, type check and unit tests |
| `npm run test:coverage` | Unit tests with coverage |
| `npm run test:e2e` | Browser tests on phone, tablet, laptop and monitor sizes, plus security checks (needs a build first) |
| `npm run audit:prod` | Fails on high-severity vulnerabilities in production dependencies |

## CI

Every push and pull request runs lint, type checks, unit tests, a production build, Playwright tests across six screen sizes, a dependency audit, a secret scan, and CodeQL security analysis. Dependabot opens weekly update PRs.
