'use client';

import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { DiscoveredApiRoute } from '@/lib/api-route-discovery';
import type { ApiEndpointDoc } from '../api-catalog';
import { Copy, KeyRound, Search, Terminal } from 'lucide-react';

type CatalogItem = ApiEndpointDoc;

type Props = {
  catalog: CatalogItem[];
  discovered: DiscoveredApiRoute[];
};

type EffectiveEndpoint = {
  key: string;
  audience: 'admin' | 'ios';
  method: CatalogItem['method'];
  path: string;
  summary: string;
  description?: string;
  authType?: 'none' | 'cookie' | 'bearer';
  authNotes?: string;
  params?: CatalogItem['params'];
  baseUrlOverride?: string;
  defaultHeaders?: Record<string, string>;
  requestExample?: unknown;
  responseExample?: unknown;
  notes?: string[];
  discoveredOnly?: boolean;
};

const DEFAULT_USER_ID = 'b94909be-f006-4789-a43a-13e110ab0724';

function normKey(method: string, path: string) {
  return `${method.toUpperCase()} ${path}`;
}

function prettyJson(v: unknown): string {
  try {
    if (typeof v === 'string') return v;
    return JSON.stringify(v, null, 2) || '';
  } catch {
    return String(v);
  }
}

function safeParseJsonObject(text: string): Record<string, unknown> {
  try {
    const v = JSON.parse(text || '{}') as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    return v as Record<string, unknown>;
  } catch {
    return {};
  }
}

function escapeSwiftString(s: string) {
  return s.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function toSwiftAnyLiteral(v: unknown): string {
  if (v === null || v === undefined) return 'NSNull()';
  if (typeof v === 'string') return `"${escapeSwiftString(v)}"`;
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '0';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return `[${v.map(toSwiftAnyLiteral).join(', ')}]`;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const entries = Object.entries(o);
    if (entries.length === 0) return '[:]';
    return `[${entries
      .map(([k, vv]) => `"${escapeSwiftString(k)}": ${toSwiftAnyLiteral(vv)}`)
      .join(', ')}]`;
  }
  return '""';
}

function toSwiftParametersLiteral(obj: Record<string, unknown>): string {
  const entries = Object.entries(obj);
  if (entries.length === 0) return '[:]';
  return `[${entries
    .map(([k, v]) => `"${escapeSwiftString(k)}": ${toSwiftAnyLiteral(v)}`)
    .join(', ')}]`;
}

function buildCurl(baseUrl: string, method: string, path: string, headers: Record<string, string>, bodyText: string) {
  const url = `${baseUrl.replace(/\/$/, '')}${path.startsWith('/') ? '' : '/'}${path}`;
  const parts: string[] = [`curl -i -X ${method.toUpperCase()} '${url}'`];
  for (const [k, v] of Object.entries(headers)) {
    if (!v) continue;
    parts.push(`  -H '${k}: ${v.replaceAll("'", "\\'")}'`);
  }
  if (bodyText.trim() && method.toUpperCase() !== 'GET') {
    parts.push(`  --data '${bodyText.replaceAll("'", "\\'")}'`);
  }
  return parts.join(' \\\n');
}

function buildAlamofire(baseUrl: string, method: string, path: string, headers: Record<string, string>, queryText: string, bodyText: string) {
  const cleanedBase = baseUrl.replace(/\/$/, '');
  const fullPath = path.startsWith('/') ? path.slice(1) : path;
  const methodLower = method.toLowerCase();
  const needsBody = method.toUpperCase() !== 'GET';
  const headerLines = Object.entries(headers)
    .filter(([, v]) => Boolean(v))
    .map(([k, v]) => `  "${k}": "${String(v).replaceAll('"', '\\"')}"`)
    .join(',\n');
  const headersSnippet = headerLines
    ? `let headers: HTTPHeaders = [\n${headerLines}\n]\n`
    : `let headers: HTTPHeaders = [:]\n`;
  const queryObj = safeParseJsonObject(queryText);
  const bodyObj = safeParseJsonObject(bodyText);
  const querySnippet = `let query: Parameters = ${toSwiftParametersLiteral(queryObj)}\n`;
  const bodySnippet = needsBody
    ? `let body: Parameters = ${toSwiftParametersLiteral(bodyObj)}\n`
    : `let body: Parameters = [:]\n`;
  const encodingSnippet = method.toUpperCase() === 'GET' ? 'URLEncoding.default' : 'JSONEncoding.default';
  const paramsVar = method.toUpperCase() === 'GET' ? 'query' : 'body';

  return [
    'import Alamofire',
    '',
    `let baseURL = URL(string: "${cleanedBase}")!`,
    `let url = baseURL.appendingPathComponent("${fullPath}")`,
    '',
    headersSnippet.trimEnd(),
    querySnippet.trimEnd(),
    bodySnippet.trimEnd(),
    '',
    `AF.request(url, method: .${methodLower}, parameters: ${paramsVar}, encoding: ${encodingSnippet}, headers: headers)`,
    '  .validate()',
    '  .responseData { response in',
    '    switch response.result {',
    '    case .success(let data):',
    '      print(String(data: data, encoding: .utf8) ?? "<non-utf8>")',
    '    case .failure(let error):',
    '      print("Request failed:", error)',
    '    }',
    '  }',
  ].join('\n');
}

function MethodBadge({ method }: { method: string }) {
  let colorClass = 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300';
  switch (method.toUpperCase()) {
    case 'GET': colorClass = 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'; break;
    case 'POST': colorClass = 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'; break;
    case 'PUT': colorClass = 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'; break;
    case 'PATCH': colorClass = 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'; break;
    case 'DELETE': colorClass = 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400'; break;
  }
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${colorClass}`}>
      {method}
    </span>
  );
}

function mergeCatalogAndDiscovered(catalog: CatalogItem[], discovered: DiscoveredApiRoute[]): EffectiveEndpoint[] {
  const byKey = new Map<string, EffectiveEndpoint>();
  for (const c of catalog) {
    const key = normKey(c.method, c.path);
    byKey.set(key, {
      key,
      audience: c.audience,
      method: c.method,
      path: c.path,
      summary: c.summary,
      description: c.description,
      authType: c.auth?.type,
      authNotes: c.auth?.notes,
      params: c.params,
      baseUrlOverride: c.baseUrlOverride,
      defaultHeaders: c.defaultHeaders,
      requestExample: c.requestExample,
      responseExample: c.responseExample,
      notes: c.notes,
      discoveredOnly: false,
    });
  }
  for (const d of discovered) {
    for (const m of d.methods) {
      const key = normKey(m, d.apiPath);
      if (byKey.has(key)) continue;
      byKey.set(key, {
        key,
        audience: 'admin',
        method: m,
        path: d.apiPath,
        summary: 'Undocumented endpoint',
        description: `Discovered from source: ${d.filePath}`,
        discoveredOnly: true,
      });
    }
  }
  return Array.from(byKey.values()).sort((a, b) => {
    const ap = a.path.localeCompare(b.path);
    if (ap !== 0) return ap;
    return a.method.localeCompare(b.method);
  });
}

export function ApiDocsExplorer({ catalog, discovered }: Props) {
  const endpoints = React.useMemo(() => mergeCatalogAndDiscovered(catalog, discovered), [catalog, discovered]);
  const [audienceFilter, setAudienceFilter] = React.useState<'ios' | 'admin'>('ios');
  const [filter, setFilter] = React.useState('');
  const [selectedKey, setSelectedKey] = React.useState<string>(() => endpoints.filter((e) => e.audience === audienceFilter).at(0)?.key ?? '');

  // Auth / Login state
  const [testLoginOpen, setTestLoginOpen] = React.useState(false);
  const [testEmail, setTestEmail] = React.useState('');
  const [testPassword, setTestPassword] = React.useState('');
  const [tokenResult, setTokenResult] = React.useState<string>('');
  const [tokenError, setTokenError] = React.useState<string>('');
  const [tokenLoading, setTokenLoading] = React.useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [tokenNotice, setTokenNotice] = React.useState<string>('');

  React.useEffect(() => {
    if (!selectedKey && endpoints[0]?.key) setSelectedKey(endpoints[0].key);
  }, [endpoints, selectedKey]);

  const filtered = React.useMemo(() => {
    const q = filter.trim().toLowerCase();
    const base = endpoints.filter((e) => e.audience === audienceFilter);
    if (!q) return base;
    return base.filter((e) => 
      e.key.toLowerCase().includes(q) || 
      e.summary.toLowerCase().includes(q) || 
      (e.description ?? '').toLowerCase().includes(q)
    );
  }, [endpoints, filter, audienceFilter]);

  const selected = React.useMemo(
    () => endpoints.find((e) => e.key === selectedKey) ?? filtered[0],
    [endpoints, filtered, selectedKey]
  );

  async function runTestLogin() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
    if (!supabaseUrl.trim() || !anonKey.trim()) {
      setTokenError('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.');
      return;
    }
    if (!testEmail.trim() || !testPassword) {
      setTokenError('Email and password are required.');
      return;
    }
    setTokenLoading(true);
    setTokenError('');
    setTokenNotice('');
    setTokenResult('');
    try {
      const res = await fetch(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: anonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail.trim(), password: testPassword }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error_description || json.msg || json.error || 'Login failed');
      const out = {
        access_token: json.access_token,
        refresh_token: json.refresh_token,
        token_type: json.token_type,
        expires_in: json.expires_in,
        user_id: json.user?.id,
      };
      if (typeof out.access_token === 'string') {
        localStorage.setItem('supabase_access_token', out.access_token);
      }
      setTokenResult(JSON.stringify(out, null, 2));
      setTokenNotice('Tokens fetched. Access tokens are short-lived.');
    } catch (err: unknown) {
      setTokenError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setTokenLoading(false);
    }
  }

  function copyToClipboard(text: string) {
    void navigator.clipboard.writeText(text);
    setTokenNotice('Copied to clipboard.');
  }

  function extractAccessTokenFromResult() {
    try {
      const obj = JSON.parse(tokenResult);
      return typeof obj.access_token === 'string' ? obj.access_token : '';
    } catch { return ''; }
  }

  // Request state
  const [baseUrl, setBaseUrl] = React.useState<string>('');
  React.useEffect(() => {
    if (baseUrl) return;
    if (typeof window !== 'undefined') setBaseUrl(window.location.origin);
  }, [baseUrl]);

  const [pathText, setPathText] = React.useState<string>('');
  const [queryText, setQueryText] = React.useState<string>('{}');
  const [headersText, setHeadersText] = React.useState<string>('{}');
  const [bodyText, setBodyText] = React.useState<string>('{}');

  React.useEffect(() => {
    if (!selected) return;
    setPathText(selected.path);
    setBodyText(prettyJson(selected.requestExample ?? (selected.method === 'POST' ? {} : {})));
    const pathParams = Array.from(selected.path.matchAll(/\{([^}]+)\}/g)).map((m) => m[1]);
    if (pathParams.length) {
      const q: Record<string, string> = {};
      for (const p of pathParams) q[p] = p.toLowerCase() === 'userid' ? DEFAULT_USER_ID : 'replace-me';
      // Auto-fill extra params from catalog if not in path
      if (selected.params) {
        for (const p of selected.params) {
          if (p.in === 'query' && !q[p.name]) {
            q[p.name] = p.example != null ? String(p.example) : '';
          }
        }
      }
      setQueryText(JSON.stringify(q, null, 2));
    } else {
      // Auto-fill params even if no path params
      if (selected.params) {
        const q: Record<string, string> = {};
        for (const p of selected.params) {
          if (p.in === 'query') {
            q[p.name] = p.example != null ? String(p.example) : '';
          }
        }
        setQueryText(JSON.stringify(q, null, 2));
      } else {
        setQueryText('{}');
      }
    }
    if (selected.baseUrlOverride?.trim()) setBaseUrl(selected.baseUrlOverride.trim());
    else if (typeof window !== 'undefined') setBaseUrl(window.location.origin);

    const defaults = selected.defaultHeaders ?? { 'Content-Type': 'application/json' };
    const storedToken = typeof localStorage !== 'undefined' ? localStorage.getItem('supabase_access_token') : null;
    if (storedToken && selected.authType === 'bearer') {
      defaults['Authorization'] = `Bearer ${storedToken}`;
    }
    setHeadersText(JSON.stringify(defaults, null, 2));
  }, [selected]); // simplified dependency to selected object (it changes when key changes)

  const [isSending, setIsSending] = React.useState(false);
  const [lastStatus, setLastStatus] = React.useState<number | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [lastResponseHeaders, setLastResponseHeaders] = React.useState<Record<string, string>>({});
  const [lastResponseBody, setLastResponseBody] = React.useState<string>('');
  const [lastError, setLastError] = React.useState<string>('');

  const effectiveMethod = selected?.method ?? 'GET';

  function normalizeBaseUrl(input: string) {
    const raw = (input ?? '').trim();
    if (!raw) return typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';

    // Allow relative baseUrl like "/"
    if (raw.startsWith('/')) {
      return typeof window !== 'undefined'
        ? `${window.location.origin}${raw === '/' ? '' : raw}`
        : `http://localhost:3000${raw === '/' ? '' : raw}`;
    }

    // Already absolute (http/https)
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw)) return raw;

    // Protocol-relative URL like //example.com
    if (raw.startsWith('//')) {
      const proto = typeof window !== 'undefined' ? window.location.protocol : 'http:';
      return `${proto}${raw}`;
    }

    // Host[:port] without scheme (e.g. localhost:3000, example.com)
    const proto = typeof window !== 'undefined' ? window.location.protocol : 'http:';
    return `${proto}//${raw}`;
  }

  function replacePathParams(p: string, params: Record<string, unknown>) {
    return p.replace(/\{([^}]+)\}/g, (_, name) => {
      const v = params[name];
      return encodeURIComponent(v == null ? '' : String(v));
    });
  }

  async function handleSend() {
    if (!selected) return;
    setIsSending(true);
    setLastError('');
    setLastResponseBody('');
    setLastResponseHeaders({});
    setLastStatus(null);
    try {
      const headersObj = JSON.parse(headersText || '{}');
      const queryObj = JSON.parse(queryText || '{}');
      const pathParamNames = Array.from(pathText.matchAll(/\{([^}]+)\}/g)).map((m) => m[1]);
      const resolvedPath = replacePathParams(pathText, queryObj);
      const safeBaseUrl = normalizeBaseUrl(baseUrl);
      const url = new URL(
        `${safeBaseUrl.replace(/\/$/, '')}${resolvedPath.startsWith('/') ? '' : '/'}${resolvedPath}`
      );
      for (const [k, v] of Object.entries(queryObj)) {
        if (pathParamNames.includes(k) || v == null || typeof v === 'object') continue;
        url.searchParams.set(k, String(v));
      }
      const init: RequestInit = { method: effectiveMethod, headers: headersObj };
      if (effectiveMethod !== 'GET') init.body = bodyText?.trim() ? bodyText : undefined;
      const res = await fetch(url.toString(), init);
      setLastStatus(res.status);
      const outHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => { outHeaders[k] = v; });
      setLastResponseHeaders(outHeaders);
      const text = await res.text();
      try {
        setLastResponseBody(JSON.stringify(JSON.parse(text), null, 2));
      } catch {
        setLastResponseBody(text);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setLastError(msg);
    } finally {
      setIsSending(false);
    }
  }

  // Pre-calculate snippets at top level to avoid conditional hook rules
  const curlSnippet = React.useMemo(() => {
    try {
      const h = JSON.parse(headersText || '{}');
      return buildCurl(normalizeBaseUrl(baseUrl), effectiveMethod, pathText, h, bodyText);
    } catch { return 'Invalid JSON configuration'; }
  }, [baseUrl, effectiveMethod, pathText, headersText, bodyText]);

  const alamofireSnippet = React.useMemo(() => {
    try {
      const h = JSON.parse(headersText || '{}');
      return buildAlamofire(normalizeBaseUrl(baseUrl), effectiveMethod, pathText, h, queryText, bodyText);
    } catch { return 'Invalid JSON configuration'; }
  }, [baseUrl, effectiveMethod, pathText, headersText, queryText, bodyText]);

  return (
    <div className="flex flex-col h-[calc(100svh-12rem)] border rounded-lg bg-background shadow-sm overflow-hidden">
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="w-80 flex-none border-r flex flex-col bg-muted/5 overflow-hidden">
          <div className="p-4 border-b space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-sm">Endpoints</h2>
              <Dialog open={testLoginOpen} onOpenChange={setTestLoginOpen}>
                <DialogTrigger asChild>
                  <Button size="icon" variant="ghost" className="h-6 w-6" title="Test Login">
                    <KeyRound className="h-4 w-4" />
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-2xl p-6">
                  <DialogHeader>
                    <DialogTitle>Test Login</DialogTitle>
                    <DialogDescription>Get ephemeral tokens for testing.</DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Email</Label>
                        <Input value={testEmail} onChange={(e) => setTestEmail(e.target.value)} placeholder="user@example.com" />
                      </div>
                      <div className="space-y-2">
                        <Label>Password</Label>
                        <Input type="password" value={testPassword} onChange={(e) => setTestPassword(e.target.value)} />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button onClick={runTestLogin} disabled={tokenLoading} size="sm">
                        {tokenLoading ? 'Signing in...' : 'Sign In'}
                      </Button>
                      {tokenResult && (
                        <Button variant="outline" size="sm" onClick={() => copyToClipboard(extractAccessTokenFromResult())}>
                          Copy Access Token
                        </Button>
                      )}
                    </div>
                    {tokenError && <p className="text-xs text-rose-600">{tokenError}</p>}
                    {tokenResult && (
                      <div className="relative">
                        <Textarea readOnly value={tokenResult} className="h-48 font-mono text-xs break-all whitespace-pre-wrap" />
                        <Button variant="ghost" size="icon" className="absolute top-2 right-2 h-6 w-6" onClick={() => copyToClipboard(tokenResult)}>
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                  </div>
                </DialogContent>
              </Dialog>
            </div>
            
            <Tabs value={audienceFilter} onValueChange={(v) => setAudienceFilter(v as 'ios' | 'admin')} className="w-full">
              <TabsList className="grid w-full grid-cols-2 h-8">
                <TabsTrigger value="ios" className="text-xs">iOS</TabsTrigger>
                <TabsTrigger value="admin" className="text-xs">Matrix OS</TabsTrigger>
              </TabsList>
            </Tabs>
            
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input 
                placeholder="Filter endpoints..." 
                value={filter} 
                onChange={(e) => setFilter(e.target.value)}
                className="pl-8 h-8 text-xs"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto min-h-0">
            <div className="p-2 space-y-0.5">
              {filtered.map((e) => (
                <button
                  key={e.key}
                  onClick={() => setSelectedKey(e.key)}
                  className={cn(
                    "w-full text-left px-3 py-2.5 rounded-md text-sm transition-colors hover:bg-accent hover:text-accent-foreground group",
                    selectedKey === e.key ? "bg-accent text-accent-foreground font-medium" : "text-muted-foreground"
                  )}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <MethodBadge method={e.method} />
                    {e.discoveredOnly && <span className="text-[10px] text-muted-foreground bg-muted px-1 rounded">Auto</span>}
                  </div>
                  <div className="truncate text-xs opacity-90">{e.path}</div>
                  <div className="truncate text-[10px] text-muted-foreground/70">{e.summary}</div>
                </button>
              ))}
              {filtered.length === 0 && (
                <div className="p-4 text-center text-xs text-muted-foreground">No endpoints found.</div>
              )}
            </div>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col min-w-0 bg-background overflow-hidden">
          {selected ? (
            <>
              <div className="border-b px-6 py-4 flex-none bg-card">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-3 mb-2">
                      <MethodBadge method={selected.method} />
                      <h1 className="font-semibold text-lg tracking-tight">{selected.summary}</h1>
                    </div>
                    <code className="text-xs bg-muted px-2 py-1 rounded text-muted-foreground font-mono block w-fit">
                      {selected.path}
                    </code>
                  </div>
                  {selected.authType && (
                    <Badge variant="outline" className="text-xs font-normal">
                      {selected.authType === 'none' ? 'Public' : `Auth: ${selected.authType}`}
                    </Badge>
                  )}
                </div>
                {selected.description && (
                  <p className="mt-3 text-sm text-muted-foreground max-w-3xl leading-relaxed">
                    {selected.description}
                  </p>
                )}
              </div>

              <div className="flex-1 overflow-y-auto min-h-0">
                <div className="p-6 max-w-5xl mx-auto w-full">
                  <Tabs defaultValue="try" className="w-full">
                    <TabsList className="h-9 mb-6 bg-muted/50 p-1">
                      <TabsTrigger value="try" className="text-xs">Try It</TabsTrigger>
                      <TabsTrigger value="curl" className="text-xs">cURL</TabsTrigger>
                      <TabsTrigger value="swift" className="text-xs">Alamofire (Swift)</TabsTrigger>
                      <TabsTrigger value="schema" className="text-xs">Schema</TabsTrigger>
                    </TabsList>

                    <TabsContent value="try" className="space-y-6 animate-in fade-in-50 slide-in-from-bottom-2 duration-300">
                      <div className="grid lg:grid-cols-2 gap-8">
                        {/* Request Column */}
                        <div className="space-y-6">
                          <div className="space-y-4">
                            <h3 className="text-sm font-medium flex items-center gap-2">
                              <Terminal className="h-4 w-4" /> Request
                            </h3>
                            
                            <div className="grid gap-4">
                              <div className="space-y-1.5">
                                <Label className="text-xs text-muted-foreground">Base URL</Label>
                                <Input 
                                  value={baseUrl} 
                                  onChange={(e) => setBaseUrl(e.target.value)} 
                                  className="font-mono text-xs h-8"
                                />
                              </div>
                              
                              <div className="space-y-1.5">
                                <Label className="text-xs text-muted-foreground">Path</Label>
                                <Input 
                                  value={pathText} 
                                  onChange={(e) => setPathText(e.target.value)} 
                                  className="font-mono text-xs h-8"
                                />
                              </div>

                              <div className="space-y-1.5">
                                <Label className="text-xs text-muted-foreground">Headers (JSON)</Label>
                                <Textarea 
                                  value={headersText} 
                                  onChange={(e) => setHeadersText(e.target.value)} 
                                  className="font-mono text-xs min-h-[80px] break-all whitespace-pre-wrap" 
                                />
                              </div>

                              <div className="space-y-1.5">
                                <Label className="text-xs text-muted-foreground">Query Params (JSON)</Label>
                                <Textarea 
                                  value={queryText} 
                                  onChange={(e) => setQueryText(e.target.value)} 
                                  className="font-mono text-xs min-h-[80px] break-all whitespace-pre-wrap" 
                                />
                              </div>

                              {effectiveMethod !== 'GET' && (
                                <div className="space-y-1.5">
                                  <Label className="text-xs text-muted-foreground">Body (JSON)</Label>
                                  <Textarea 
                                    value={bodyText} 
                                    onChange={(e) => setBodyText(e.target.value)} 
                                    className="font-mono text-xs min-h-[120px] break-all whitespace-pre-wrap" 
                                  />
                                </div>
                              )}
                            </div>

                            <div className="flex items-center gap-2 pt-2">
                              <Button onClick={handleSend} disabled={isSending} size="sm" className="w-24">
                                {isSending ? 'Sending...' : 'Send'}
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => {
                                setLastStatus(null);
                                setLastResponseBody('');
                                setLastError('');
                              }}>
                                Clear
                              </Button>
                            </div>
                          </div>
                        </div>

                        {/* Response Column */}
                        <div className="space-y-4 min-w-0">
                           <h3 className="text-sm font-medium">Response</h3>
                           <div className="rounded-lg border bg-muted/10 min-h-[400px] flex flex-col overflow-hidden">
                             {lastStatus !== null || lastError ? (
                               <>
                                 <div className="flex items-center justify-between border-b px-4 py-2 bg-muted/20 text-xs">
                                   <div className="flex items-center gap-3">
                                     <span className="font-medium">Status:</span>
                                     <Badge variant={lastStatus && lastStatus < 300 ? "default" : "destructive"} className="h-5 px-1.5 text-[10px]">
                                       {lastStatus ?? 'Error'}
                                     </Badge>
                                   </div>
                                   <div className="text-muted-foreground">
                                     {new Date().toLocaleTimeString()}
                                   </div>
                                 </div>
                                 <ScrollArea className="flex-1 p-4">
                                   {lastError ? (
                                     <div className="text-rose-600 text-xs font-mono">{lastError}</div>
                                   ) : (
                                     <pre className="text-xs font-mono whitespace-pre-wrap break-all text-foreground/90">
                                       {lastResponseBody || <span className="text-muted-foreground italic">No content</span>}
                                     </pre>
                                   )}
                                 </ScrollArea>
                               </>
                             ) : (
                               <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground p-8 text-center">
                                 Click Send to see the response...
                               </div>
                             )}
                           </div>
                        </div>
                      </div>
                    </TabsContent>

                    <TabsContent value="curl">
                      <div className="relative rounded-md border bg-muted/30 p-4">
                        <pre className="text-xs font-mono whitespace-pre-wrap break-all overflow-x-auto">
                          {curlSnippet}
                        </pre>
                        <Button variant="outline" size="icon" className="absolute top-2 right-2 h-6 w-6" onClick={() => copyToClipboard(curlSnippet)}>
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                    </TabsContent>
                    
                    <TabsContent value="swift">
                       <div className="relative rounded-md border bg-muted/30 p-4">
                        <pre className="text-xs font-mono whitespace-pre-wrap break-all overflow-x-auto">
                          {alamofireSnippet}
                        </pre>
                         <Button variant="outline" size="icon" className="absolute top-2 right-2 h-6 w-6" onClick={() => copyToClipboard(alamofireSnippet)}>
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                    </TabsContent>

                    <TabsContent value="schema">
                      <div className="grid lg:grid-cols-2 gap-6">
                        {!!selected.requestExample && (
                          <div className="space-y-2">
                             <Label className="text-xs text-muted-foreground">Request JSON Schema</Label>
                             <div className="rounded-md border bg-muted/5 p-4 text-xs font-mono whitespace-pre-wrap">
                               {String(prettyJson(selected.requestExample))}
                             </div>
                          </div>
                        )}
                        {!!selected.responseExample && (
                          <div className="space-y-2">
                             <Label className="text-xs text-muted-foreground">Response JSON Schema</Label>
                             <div className="rounded-md border bg-muted/5 p-4 text-xs font-mono whitespace-pre-wrap">
                               {String(prettyJson(selected.responseExample))}
                             </div>
                          </div>
                        )}
                      </div>
                    </TabsContent>
                  </Tabs>
                </div>
              </div>
            </>
          ) : (
             <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
               Select an endpoint to view documentation
             </div>
          )}
        </div>
      </div>
    </div>
  );
}
