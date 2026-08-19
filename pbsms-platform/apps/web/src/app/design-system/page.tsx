import { Button } from '@/components/Button/Button';
import { Card } from '@/components/Card/Card';
import { Pill } from '@/components/Pill/Pill';
import { LoadingState } from '@/components/states/LoadingState';
import { EmptyState } from '@/components/states/EmptyState';
import { ErrorState } from '@/components/states/ErrorState';
import { OfflineState } from '@/components/states/OfflineState';
import { RestrictedState } from '@/components/states/RestrictedState';
import styles from './page.module.css';

const SWATCHES: Array<{ name: string; token: string; hex: string }> = [
  { name: 'Ink', token: '--pb-ink', hex: '#12211F' },
  { name: 'Teal 900', token: '--pb-teal-900', hex: '#0B4F4A' },
  { name: 'Teal 600', token: '--pb-teal-600', hex: '#12726B' },
  { name: 'Gold', token: '--pb-gold', hex: '#926100' },
  { name: 'Canvas', token: '--pb-canvas', hex: '#FAF7F0' },
  { name: 'Success', token: '--pb-success', hex: '#1E6B3A' },
  { name: 'Warning', token: '--pb-warning', hex: '#8A5A00' },
  { name: 'Danger', token: '--pb-danger', hex: '#A32017' },
];

/**
 * design-system/page.tsx
 *
 * Internal tooling, not a product screen. This is Stage 1's pa11y-ci crawl
 * target (see .pa11yci.json) — it exists so the accessibility baseline can
 * be checked in CI before any real screen does. Renders every component
 * this stage ships, so a regression here is caught before the component
 * library grows past a handful of components (per apps/web/README.md).
 */
export default function DesignSystemPage() {
  return (
    <main className={styles.page}>
      <div className={styles.notice}>
        Internal style guide — not a product screen. Stage 1 component
        library + CI accessibility gate target.
      </div>

      <section className={styles.section}>
        <h2>Colour</h2>
        <div className={styles.swatches}>
          {SWATCHES.map((s) => (
            <div key={s.token} className={styles.swatch}>
              <div className={styles.swatchChip} style={{ background: s.hex }} />
              <div className={styles.swatchMeta}>
                <strong>{s.name}</strong>
                <br />
                <code className="pb-mono">{s.token} · {s.hex}</code>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2>Buttons</h2>
        <div className={styles.row}>
          <Button variant="primary">Primary</Button>
          <Button variant="primary" disabled>
            Primary (disabled)
          </Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="secondary" disabled>
            Secondary (disabled)
          </Button>
        </div>
      </section>

      <section className={styles.section}>
        <h2>Card</h2>
        <Card className={styles.cardPadded}>
          <p>Card content sits on the surface token with a 1px rule border.</p>
        </Card>
      </section>

      <section className={styles.section}>
        <h2>Status — never colour alone</h2>
        <Card className={styles.cardPadded}>
          <div className={styles.row}>
            <Pill variant="success">Saved to school</Pill>
            <Pill variant="warning">On this phone</Pill>
            <Pill variant="danger">Could not save</Pill>
            <Pill variant="gold">Grade A · Excellent</Pill>
            <Pill variant="neutral">Awaiting approval</Pill>
          </div>
        </Card>
      </section>

      <section className={styles.section}>
        <h2>Required UI states (NFR-ACC-020)</h2>
        <div className={styles.stack}>
          <div>
            <h3>Loading</h3>
            <Card className={styles.cardPadded}>
              <LoadingState rows={3} />
            </Card>
          </div>

          <div>
            <h3>Empty</h3>
            <Card>
              <EmptyState
                title="No students yet"
                message="Once students are enrolled, they will appear here."
              />
            </Card>
          </div>

          <div>
            <h3>Error</h3>
            <Card>
              <ErrorState message="We could not load this page. Check your connection and try again." />
            </Card>
          </div>

          <div>
            <h3>Restricted</h3>
            <Card>
              <RestrictedState message="Ask a school administrator for access to this record." />
            </Card>
          </div>

          <div>
            <h3>Offline</h3>
            <Card>
              <OfflineState message="Working offline · 2 marks on this phone" actionLabel="View" />
            </Card>
          </div>
        </div>
      </section>
    </main>
  );
}
