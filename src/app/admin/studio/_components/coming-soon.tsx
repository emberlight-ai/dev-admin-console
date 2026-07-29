"use client"

import Link from "next/link"

import { StudioHeader } from "./studio-shell"

/**
 * Placeholder for studio nav entries that exist to make the platform read as a
 * complete product but have no demo content behind them. Better than a 404 if
 * someone clicks one mid-pitch.
 */
export function ComingSoon({
  title,
  subtitle,
  blurb,
}: {
  title: string
  subtitle?: string
  blurb: string
}) {
  return (
    <>
      <StudioHeader title={title} subtitle={subtitle} />
      <div className="mx-auto flex max-w-md flex-col items-center px-8 py-32 text-center">
        <div className="mb-5 h-12 w-12 rounded-2xl bg-gradient-to-br from-emerald-400/30 to-teal-500/30" />
        <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>
        <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">{blurb}</p>
        <Link
          href="/admin/studio/dashboard"
          className="mt-6 rounded-full border px-4 py-2 text-[13px] font-medium transition-colors hover:bg-muted"
        >
          Back to overview
        </Link>
      </div>
    </>
  )
}
