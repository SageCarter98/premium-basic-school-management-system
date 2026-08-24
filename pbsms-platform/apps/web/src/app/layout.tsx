import '../styles/globals.css';
import { ServiceWorkerInit } from '@/components/shell/ServiceWorkerInit';
import { THEME_INIT_SCRIPT } from '@/lib/use-theme';

export const metadata = {
  title: 'PBSMS',
  description: 'Premium Basic School Management System — multi-tenant platform',
  manifest: '/manifest.json',
};

export const viewport = {
  themeColor: '#0B4F4A', // --pb-teal-900, spec §9.2's manifest theme_color
};

/**
 * layout.tsx
 *
 * Root layout. Per the note in page.tsx, this is the correct place to
 * eventually resolve tenant branding (Volume 0, Chapter 6) once auth and a
 * tenant-aware data fetch exist — every page renders inside this layout, so
 * branding resolved here applies everywhere for free, rather than being
 * bolted onto each screen individually later.
 *
 * Design tokens/base styles (Stage 1) are imported here so every route,
 * including future ones, inherits them automatically.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  // suppressHydrationWarning below is scoped to this element only (React
  // does not propagate it to children) — needed because THEME_INIT_SCRIPT
  // sets data-theme on this exact tag before React hydrates, which would
  // otherwise make every single page log a false-positive hydration-
  // mismatch warning, the standard tradeoff every dark-mode-via-inline-
  // script approach (including next-themes) makes.
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* eslint-disable-next-line react/no-danger -- must run before first paint, see use-theme.ts */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <ServiceWorkerInit />
        {children}
      </body>
    </html>
  );
}
