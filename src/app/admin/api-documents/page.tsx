import { ApiDocsExplorer } from '@/app/admin/api-documents/_components/api-docs-explorer';
import { discoverApiRoutes } from '@/lib/api-route-discovery';
import { apiCatalog } from './api-catalog';
import { iosApiCatalog } from './ios-catalog';

export default async function ApiDocumentsPage() {
  const discovered = await discoverApiRoutes();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">API Documents</h1>
        <p className="text-sm text-muted-foreground">
          iOS-friendly API reference with copy/paste snippets and a Try-It panel.
        </p>
      </div>

      <ApiDocsExplorer catalog={[...apiCatalog, ...iosApiCatalog]} discovered={discovered} />
    </div>
  );
}


