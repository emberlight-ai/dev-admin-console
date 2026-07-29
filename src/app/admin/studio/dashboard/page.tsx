"use client"

import { Suspense } from "react"

import { DigitalHumanDetail } from "../../digital-humans/[id]/detail-view"
import { DEMO_EXPERT_ID, DEMO_EXPERT_NAME, StudioHeader } from "../_components/studio-shell"

/**
 * Overview — the expert's own view of their deployed agent.
 *
 * Renders the existing digital-human detail page (profile, skills, chat
 * history, tools) scoped to this studio's expert, so the creator sees exactly
 * what ops sees without a parallel implementation to keep in sync.
 *
 * The Suspense boundary is required, not cosmetic: the detail view calls
 * `useSearchParams()`, and unlike its own route (dynamic, `[id]`) this one is
 * static, so Next prerenders it and bails out of CSR without a boundary —
 * `next build` fails outright. Type-checking does not catch it.
 */
export default function StudioDashboardPage() {
  return (
    <>
      <StudioHeader
        title="Overview"
        subtitle={`${DEMO_EXPERT_NAME} · live in Discover`}
        actions={
          <a
            href="/admin/digital-humans/v2/create"
            className="rounded-full bg-foreground px-4 py-2 text-[13px] font-semibold text-background transition-opacity hover:opacity-90"
          >
            New expert
          </a>
        }
      />
      <div className="p-6">
        <Suspense fallback={<div className="text-sm text-muted-foreground">Loading…</div>}>
          <DigitalHumanDetail expertId={DEMO_EXPERT_ID} />
        </Suspense>
      </div>
    </>
  )
}
