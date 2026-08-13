# apps/web

Next.js frontend shell. This is intentionally a near-empty scaffold, not a
built UI — see the root `README.md` for why the code scaffold prioritized
`apps/api` and `infra/` (the tenancy architecture) over frontend screens.

Before building real screens, read SRS v2.1:

- **Chapter 34** — application shell, design system, and the offline/PWA
  strategy (FR-UX-010..040). Build the offline-capable shell before you
  build individual pages; retrofitting offline support after 20 screens
  exist is exactly the kind of expensive rework this document tries to
  avoid.
- **Chapter 42** — WCAG 2.1 AA is the binding accessibility target, with a
  CI-enforced automated check (NFR-ACC-020). Wire up `axe-core` (or
  equivalent) in this app's CI job before the component library grows past
  a handful of components, not after.

## Setup (not run in this sandbox — no network access)

```bash
npm install
npm run dev
```
