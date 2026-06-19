'use client'

import { Suspense } from "react"
import { useSearchParams } from "next/navigation"

import { SystemPromptForm } from "./_components/system-prompt-form"
import { CreatePromptWizard } from "./_components/create-prompt-wizard"

function ManagePromptPageContent() {
  const searchParams = useSearchParams()
  const editGender = searchParams.get("gender")
  const editPersonality = searchParams.get("personality")

  const isEdit = !!(editGender && editPersonality)

  // No gender/personality in the URL means we're creating a brand new personality.
  // New personalities use the guided wizard; existing ones use the React Flow editor.
  if (!isEdit) {
    return <CreatePromptWizard initialGender={editGender ?? "Female"} />
  }

  return (
    <SystemPromptForm
      initialGender={editGender ?? "Female"}
      initialPersonality={editPersonality ?? ""}
      disableKeyEdit
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

