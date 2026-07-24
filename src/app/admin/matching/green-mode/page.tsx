import { redirect } from 'next/navigation';

// Green mode now lives on the Categories board: an internal "Green Mode"
// category with an Enabled switch on its card. Old bookmarks land there.
export default function MatchingGreenModePage() {
  redirect('/admin/categories');
}
