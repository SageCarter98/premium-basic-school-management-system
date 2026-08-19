import { Card } from '@/components/Card/Card';
import { EmptyState } from '@/components/states/EmptyState';

/**
 * Every nav item Stage 2 ships routes here instead of a broken 404 or a
 * screen pretending to exist — real screens start Stage 4 (per §13 Build
 * Order). Reuses Stage 1's EmptyState rather than a one-off "coming soon"
 * page, since that's exactly what it's for.
 */
export function StubPage({ label, stageNote }: { label: string; stageNote: string }) {
  return (
    <Card>
      <EmptyState
        title={label}
        message={`This screen hasn't been built yet — it arrives in ${stageNote} of the frontend build order. You can see it in the navigation because your role has permission to reach it once it exists.`}
      />
    </Card>
  );
}
