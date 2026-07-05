import { redirect } from 'next/navigation';

// Green mode now lives on the config page (Matching tab) — see
// src/app/admin/config/green-mode-section.tsx. Old bookmarks land there.
export default function MatchingGreenModePage() {
  redirect('/admin/config');
}
