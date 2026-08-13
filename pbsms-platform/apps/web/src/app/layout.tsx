export const metadata = {
  title: 'PBSMS',
  description: 'Premium Basic School Management System — multi-tenant platform',
};

/**
 * layout.tsx
 *
 * Root layout. Per the note in page.tsx, this is the correct place to
 * eventually resolve tenant branding (Volume 0, Chapter 6) once auth and a
 * tenant-aware data fetch exist — every page renders inside this layout, so
 * branding resolved here applies everywhere for free, rather than being
 * bolted onto each screen individually later.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
