import '../styles/globals.css';
import { ServiceWorkerInit } from '@/components/shell/ServiceWorkerInit';

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
  return (
    <html lang="en">
      <body>
        <ServiceWorkerInit />
        {children}
      </body>
    </html>
  );
}
