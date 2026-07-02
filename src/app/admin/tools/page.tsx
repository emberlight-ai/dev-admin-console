'use client';

/**
 * Agent Tools — the registry of things digital humans can look up.
 *
 * HCI intent: a tool is only trustworthy if you can RUN it, so every surface
 * leads to execution — cards run in one click, and the Add dialog won't feel
 * done until you've seen a live result ("test before save"). The result panel
 * is framed as "what the digital human reads", because that's the contract.
 */

import * as React from 'react';
import {
  Check,
  ChevronRight,
  Loader2,
  Play,
  Plus,
  Sparkles,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

type ParamSpec = { name: string; type?: string; description?: string; example?: string; required?: boolean };
type Tool = {
  id: string;
  name: string;
  description: string;
  input_schema: ParamSpec[];
  kind: 'builtin' | 'http' | 'js';
  config: Record<string, unknown>;
  enabled: boolean;
};
type RunResult = { ok: boolean; result?: unknown; error?: string; ms: number };

const KIND_META: Record<Tool['kind'], { label: string; cls: string }> = {
  builtin: { label: 'built-in', cls: 'bg-blue-500/10 text-blue-500 border-blue-500/30' },
  http: { label: 'HTTP', cls: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30' },
  js: { label: 'JS', cls: 'bg-amber-500/10 text-amber-600 border-amber-500/30' },
};

function KindBadge({ kind }: { kind: Tool['kind'] }) {
  const m = KIND_META[kind];
  return (
    <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider', m.cls)}>
      {m.label}
    </span>
  );
}

// ── Param form (shared by test drawer + dialog test) ─────────────────────────

function ParamForm({
  schema, values, onChange, onSubmit,
}: {
  schema: ParamSpec[];
  values: Record<string, string>;
  onChange: (name: string, v: string) => void;
  onSubmit: () => void;
}) {
  if (schema.length === 0) {
    return <p className="text-xs text-muted-foreground">This tool takes no inputs.</p>;
  }
  return (
    <div className="space-y-3">
      {schema.map((p) => (
        <div key={p.name} className="space-y-1">
          <label className="flex items-baseline gap-2 text-xs font-medium">
            <code className="rounded bg-muted px-1.5 py-0.5">{p.name}</code>
            {p.required && <span className="text-destructive">*</span>}
            {p.description && <span className="font-normal text-muted-foreground">{p.description}</span>}
          </label>
          <Input
            value={values[p.name] ?? ''}
            placeholder={p.example ? `e.g. ${p.example}` : p.type ?? 'value'}
            onChange={(e) => onChange(p.name, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSubmit();
            }}
          />
        </div>
      ))}
    </div>
  );
}

function ResultPanel({ run }: { run: RunResult | null }) {
  if (!run) return null;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs">
        {run.ok ? (
          <span className="flex items-center gap-1 font-medium text-emerald-600"><Check className="h-3.5 w-3.5" /> OK</span>
        ) : (
          <span className="flex items-center gap-1 font-medium text-destructive"><X className="h-3.5 w-3.5" /> Failed</span>
        )}
        <span className="text-muted-foreground">{run.ms}ms</span>
        <span className="ml-auto text-[11px] text-muted-foreground">this is exactly what the digital human reads</span>
      </div>
      <pre className="max-h-[340px] overflow-auto rounded-xl border bg-muted/40 p-3 text-[11px] leading-relaxed">
        {run.ok ? JSON.stringify(run.result, null, 2) : run.error}
      </pre>
    </div>
  );
}

// ── Add Tool dialog ───────────────────────────────────────────────────────────

const EMPTY_DRAFT = {
  name: '',
  description: '',
  kind: 'http' as 'http' | 'js',
  input_schema: [] as ParamSpec[],
  url_template: '',
  method: 'GET',
  code: "// body of: async (params, ctx) => { ... }\n// ctx.fetch is available; return a small JSON object.\nconst res = await ctx.fetch('https://example.com/api?q=' + encodeURIComponent(params.query));\nreturn await res.json();",
};

function AddToolDialog({
  open, onOpenChange, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const [tab, setTab] = React.useState<'describe' | 'build'>('describe');
  const [describeText, setDescribeText] = React.useState('');
  const [drafting, setDrafting] = React.useState(false);

  const [d, setD] = React.useState(EMPTY_DRAFT);
  const [testParams, setTestParams] = React.useState<Record<string, string>>({});
  const [testRun, setTestRun] = React.useState<RunResult | null>(null);
  const [testing, setTesting] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [hasTested, setHasTested] = React.useState(false);

  const reset = () => {
    setTab('describe'); setDescribeText(''); setD(EMPTY_DRAFT);
    setTestParams({}); setTestRun(null); setHasTested(false);
  };

  const draftTool = (): { name: string; description: string; kind: string; input_schema: ParamSpec[]; config: Record<string, unknown> } => ({
    name: d.name.trim(),
    description: d.description.trim(),
    kind: d.kind,
    input_schema: d.input_schema.filter((p) => p.name.trim()),
    config: d.kind === 'http' ? { url_template: d.url_template.trim(), method: d.method } : { code: d.code },
  });

  const askAI = async () => {
    if (!describeText.trim()) return;
    setDrafting(true);
    try {
      const res = await fetch('/api/admin/tools/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: describeText }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Draft failed');
      const dr = json.draft ?? {};
      const cfg = (dr.config ?? {}) as Record<string, unknown>;
      setD({
        name: String(dr.name ?? ''),
        description: String(dr.description ?? ''),
        kind: dr.kind === 'js' ? 'js' : 'http',
        input_schema: Array.isArray(dr.input_schema) ? dr.input_schema : [],
        url_template: String(cfg.url_template ?? ''),
        method: String(cfg.method ?? 'GET'),
        code: String(cfg.code ?? EMPTY_DRAFT.code),
      });
      setTestRun(null);
      setHasTested(false);
      setTab('build');
      toast.success('Draft ready — review it, test it, then save');
      if (dr.note) toast.info(String(dr.note), { duration: 9000 });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Draft failed');
    } finally {
      setDrafting(false);
    }
  };

  const runTest = async () => {
    setTesting(true);
    setTestRun(null);
    try {
      const res = await fetch('/api/admin/tools/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: draftTool(), params: testParams }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Run failed');
      setTestRun(json);
      setHasTested(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Run failed');
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draftTool()),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Save failed');
      toast.success(`Tool "${json.tool.name}" saved`);
      reset();
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const setParam = (i: number, patch: Partial<ParamSpec>) => {
    setD((prev) => ({
      ...prev,
      input_schema: prev.input_schema.map((p, idx) => (idx === i ? { ...p, ...patch } : p)),
    }));
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="h-4 w-4" /> Add a tool
          </DialogTitle>
        </DialogHeader>

        {/* House convention: DialogContent is p-0; the body pads itself. */}
        <div className="p-4 pt-0">
        <Tabs value={tab} onValueChange={(v) => setTab(v as 'describe' | 'build')}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="describe" className="gap-1.5"><Sparkles className="h-3.5 w-3.5" /> Describe it</TabsTrigger>
            <TabsTrigger value="build">Build it</TabsTrigger>
          </TabsList>

          {/* Path 1: describe in plain language, AI drafts the definition */}
          <TabsContent value="describe" className="space-y-3 pt-3">
            <p className="text-sm text-muted-foreground">
              Describe the tool like you would brief an engineer — what goes in, what should come out.
              The draft lands in <span className="font-medium text-foreground">Build it</span> for review; nothing is saved until you say so.
            </p>
            <Textarea
              value={describeText}
              onChange={(e) => setDescribeText(e.target.value)}
              placeholder={'e.g. "Get upcoming movies in theaters this week so she can suggest one — no API key services preferred"'}
              className="min-h-[110px]"
            />
            <Button onClick={askAI} disabled={drafting || !describeText.trim()} className="w-full">
              {drafting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              {drafting ? 'Drafting…' : 'Draft it with AI'}
            </Button>
          </TabsContent>

          {/* Path 2: build/edit the definition directly */}
          <TabsContent value="build" className="space-y-4 pt-3">
            <div className="grid grid-cols-[1fr_auto] gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Name (snake_case)</label>
                <Input value={d.name} placeholder="get_movie_showtimes"
                  onChange={(e) => setD({ ...d, name: e.target.value })} className="font-mono text-sm" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Kind</label>
                <div className="flex rounded-lg border p-0.5">
                  {(['http', 'js'] as const).map((k) => (
                    <button key={k} type="button"
                      onClick={() => setD({ ...d, kind: k })}
                      className={cn('rounded-md px-3 py-1.5 text-xs font-semibold uppercase',
                        d.kind === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}>
                      {k}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Description <span className="font-normal">— the digital human reads this to decide when to use it</span>
              </label>
              <Textarea value={d.description} className="min-h-[56px]"
                placeholder="Movies in theaters near a city this week. Use when suggesting a date idea."
                onChange={(e) => setD({ ...d, description: e.target.value })} />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground">Inputs</label>
                <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs"
                  onClick={() => setD({ ...d, input_schema: [...d.input_schema, { name: '', required: true }] })}>
                  <Plus className="mr-1 h-3 w-3" /> Add input
                </Button>
              </div>
              {d.input_schema.length === 0 ? (
                <p className="text-xs text-muted-foreground">No inputs — the tool runs as-is.</p>
              ) : (
                d.input_schema.map((p, i) => (
                  <div key={i} className="grid grid-cols-[130px_1fr_120px_auto] items-center gap-2">
                    <Input value={p.name} placeholder="name" className="font-mono text-xs"
                      onChange={(e) => setParam(i, { name: e.target.value })} />
                    <Input value={p.description ?? ''} placeholder="what it means"
                      className="text-xs" onChange={(e) => setParam(i, { description: e.target.value })} />
                    <Input value={p.example ?? ''} placeholder="example" className="text-xs"
                      onChange={(e) => setParam(i, { example: e.target.value })} />
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground"
                      onClick={() => setD({ ...d, input_schema: d.input_schema.filter((_, idx) => idx !== i) })}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))
              )}
            </div>

            {d.kind === 'http' ? (
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  URL template <span className="font-normal">— {'{input}'} placeholders are URL-encoded automatically</span>
                </label>
                <Input value={d.url_template} className="font-mono text-xs"
                  placeholder="https://api.example.com/search?q={query}"
                  onChange={(e) => setD({ ...d, url_template: e.target.value })} />
              </div>
            ) : (
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Code <span className="font-normal">— body of async (params, ctx) =&gt; {'{...}'}; ctx.fetch available</span>
                </label>
                <Textarea value={d.code} spellCheck={false}
                  className="min-h-[160px] max-h-[280px] resize-y overflow-auto [field-sizing:fixed] font-mono text-xs"
                  onChange={(e) => setD({ ...d, code: e.target.value })} />
              </div>
            )}

            {/* Test-before-save: the dialog's center of gravity */}
            <div className="space-y-3 rounded-xl border bg-muted/20 p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Try it now</span>
                <Button type="button" size="sm" variant="outline" onClick={runTest}
                  disabled={testing || !d.name.trim()}>
                  {testing ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1 h-3.5 w-3.5" />}
                  Test run
                </Button>
              </div>
              <ParamForm
                schema={d.input_schema.filter((p) => p.name.trim())}
                values={testParams}
                onChange={(name, v) => setTestParams((prev) => ({ ...prev, [name]: v }))}
                onSubmit={runTest}
              />
              <ResultPanel run={testRun} />
            </div>

            <div className="flex items-center justify-end gap-2">
              {!hasTested && (
                <span className="mr-auto text-[11px] text-muted-foreground">
                  Tip: run a test first — you are about to hand this to the digital humans.
                </span>
              )}
              <Button onClick={save} disabled={saving || !d.name.trim() || !d.description.trim()}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                Save tool
              </Button>
            </div>
          </TabsContent>
        </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ToolsPage() {
  const [tools, setTools] = React.useState<Tool[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [addOpen, setAddOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState<Tool | null>(null);

  // Test drawer state
  const [testTool, setTestTool] = React.useState<Tool | null>(null);
  const [testParams, setTestParams] = React.useState<Record<string, string>>({});
  const [testRun, setTestRun] = React.useState<RunResult | null>(null);
  const [testing, setTesting] = React.useState(false);

  const fetchTools = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/tools');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load tools');
      setTools(json.tools ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load tools');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { void fetchTools(); }, [fetchTools]);

  const openTest = (tool: Tool) => {
    setTestTool(tool);
    const seed: Record<string, string> = {};
    for (const p of tool.input_schema) if (p.example) seed[p.name] = p.example;
    setTestParams(seed);
    setTestRun(null);
  };

  const runTest = async () => {
    if (!testTool) return;
    setTesting(true);
    setTestRun(null);
    try {
      const res = await fetch('/api/admin/tools/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: testTool.name, params: testParams }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Run failed');
      setTestRun(json);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Run failed');
    } finally {
      setTesting(false);
    }
  };

  const toggleEnabled = async (tool: Tool) => {
    const next = !tool.enabled;
    setTools((prev) => prev.map((t) => (t.id === tool.id ? { ...t, enabled: next } : t)));
    const res = await fetch(`/api/admin/tools/${tool.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: next }),
    });
    if (!res.ok) {
      setTools((prev) => prev.map((t) => (t.id === tool.id ? { ...t, enabled: !next } : t)));
      toast.error('Could not update tool');
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    const res = await fetch(`/api/admin/tools/${deleting.id}`, { method: 'DELETE' });
    if (res.ok) {
      toast.success(`Deleted "${deleting.name}"`);
      setTools((prev) => prev.filter((t) => t.id !== deleting.id));
    } else {
      toast.error('Delete failed');
    }
    setDeleting(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Wrench className="h-6 w-6" /> Tools
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            What your digital humans can look up — news, weather, profiles, anything you add.
            Agents call these through <code className="rounded bg-muted px-1 py-0.5 text-xs">/api/tools/execute</code>.
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> Add tool
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : tools.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-10 text-center">
          <Wrench className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No tools yet. Add the first one — describe it in plain language and let AI draft it.</p>
          <Button onClick={() => setAddOpen(true)}><Plus className="mr-1.5 h-4 w-4" /> Add tool</Button>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {tools.map((tool) => (
            <Card key={tool.id} className={cn('flex flex-col gap-2.5 p-4', !tool.enabled && 'opacity-55')}>
              <div className="flex items-center gap-2">
                <code className="truncate text-sm font-semibold">{tool.name}</code>
                <KindBadge kind={tool.kind} />
                <button
                  type="button"
                  onClick={() => toggleEnabled(tool)}
                  title={tool.enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}
                  className={cn(
                    'ml-auto h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors',
                    tool.enabled ? 'bg-emerald-500' : 'bg-muted-foreground/30'
                  )}
                >
                  <span className={cn('block h-4 w-4 rounded-full bg-white transition-transform', tool.enabled && 'translate-x-4')} />
                </button>
              </div>
              <p className="line-clamp-3 flex-1 text-sm text-muted-foreground">{tool.description}</p>
              <div className="flex flex-wrap gap-1.5">
                {tool.input_schema.map((p) => (
                  <Badge key={p.name} variant="outline" className="font-mono text-[10px]">{p.name}</Badge>
                ))}
              </div>
              <div className="flex items-center justify-between border-t pt-2.5">
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground"
                  onClick={() => setDeleting(tool)}>
                  <Trash2 className="mr-1 h-3 w-3" /> Remove
                </Button>
                <Button size="sm" variant="outline" className="h-7" onClick={() => openTest(tool)}>
                  <Play className="mr-1 h-3 w-3" /> Run
                  <ChevronRight className="ml-0.5 h-3 w-3" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Test drawer */}
      <Sheet open={!!testTool} onOpenChange={(v) => { if (!v) setTestTool(null); }}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          {testTool && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <code className="text-base">{testTool.name}</code>
                  <KindBadge kind={testTool.kind} />
                </SheetTitle>
              </SheetHeader>
              {/* House convention: SheetContent is unpadded; SheetHeader carries
                  p-4, the body pads itself. */}
              <div className="space-y-4 px-4 pb-6">
                <p className="text-sm text-muted-foreground">{testTool.description}</p>
                <ParamForm
                  schema={testTool.input_schema}
                  values={testParams}
                  onChange={(name, v) => setTestParams((prev) => ({ ...prev, [name]: v }))}
                  onSubmit={runTest}
                />
                <Button onClick={runTest} disabled={testing} className="w-full">
                  {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                  Run tool <span className="ml-2 text-[10px] opacity-70">⌘↩</span>
                </Button>
                <ResultPanel run={testRun} />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Delete confirm */}
      <AlertDialog open={!!deleting} onOpenChange={(v) => { if (!v) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove “{deleting?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Digital humans will no longer be able to call it. {deleting?.kind === 'builtin'
                ? 'The built-in implementation stays in code, so re-adding it later is instant.'
                : 'This deletes its definition permanently.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AddToolDialog open={addOpen} onOpenChange={setAddOpen} onSaved={fetchTools} />
    </div>
  );
}
