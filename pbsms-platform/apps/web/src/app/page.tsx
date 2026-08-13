/**
 * page.tsx
 *
 * Placeholder root page — proves the app boots. The real application shell
 * (SRS Chapter 34.1: header with tenant/school branding, context switcher,
 * permission-generated sidebar, breadcrumbs) is a Phase 1/2 build item.
 *
 * Two things worth building early precisely because they are hard to
 * retrofit (per the Version 1.0 gap analysis):
 *   1. Offline/PWA shell (Chapter 34.3) — start from a service-worker-aware
 *      layout, not a plain SPA, from the first commit.
 *   2. Tenant branding (Chapter 6, Volume 0) — resolve tenant theme (logo,
 *      colour) at the layout root, not deep in individual pages, so no
 *      screen is ever built assuming there is only one brand.
 */
export default function HomePage() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
      <h1>PBSMS</h1>
      <p>
        Frontend scaffold — see <code>apps/web/README.md</code> and SRS v2.1 Chapter 34 before
        building real screens here.
      </p>
    </main>
  );
}
