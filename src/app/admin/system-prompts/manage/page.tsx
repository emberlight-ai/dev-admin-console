'use client'

import * as React from "react"
import { Suspense } from "react"
import { useSearchParams } from "next/navigation"

import { SystemPromptForm } from "./_components/system-prompt-form"

function ManagePromptPageContent() {
  const searchParams = useSearchParams()
  const editGender = searchParams.get("gender")
  const editPersonality = searchParams.get("personality")

  const isEdit = !!(editGender && editPersonality)

  return (
    <SystemPromptManagePage gender={editGender ?? ""} personality={editPersonality ?? ""} isEdit={isEdit} />
  )
}

function SystemPromptManagePage({ gender, personality, isEdit }: { gender: string; personality: string; isEdit: boolean }) {
  return (
    <SystemPromptForm
      initialGender={gender || "Female"}
      initialPersonality={personality || ""}
      disableKeyEdit={isEdit}
      variant="page"
    />
  )
}

export default function ManagePromptPage() {
  return (
    <Suspense fallback={<div className="p-10 text-center">Loading...</div>}>
      <ManagePromptPageContent />
    </Suspense>
  )
}

