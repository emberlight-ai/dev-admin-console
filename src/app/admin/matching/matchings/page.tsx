'use client';

import { RelationshipGraph } from '@/components/matching/relationship-graph';
import { Card } from '@/components/ui/card';

export default function MatchingGraphPage() {
  return (
    <div className="space-y-6">
      <div>
        <div className="text-2xl font-semibold tracking-tight">Matchings</div>
        <div className="mt-1 text-sm text-muted-foreground">
          Relationship graph centered on a selected user (direct matches, invites, blocks).
        </div>
      </div>

      <Card className="p-4">
        <RelationshipGraph showPicker />
      </Card>
    </div>
  );
}

 