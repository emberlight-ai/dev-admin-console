'use client';

import * as React from 'react';
import {
  Activity,
  BookOpen,
  Camera,
  Flame,
  Loader2,
  Moon,
  Newspaper,
  Play,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Target,
} from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

type RosterDh = {
  userid: string;
  username: string;
  age: number | null;
  personality: string | null;
  profession: string | null;
  avatar: string | null;
  whitelisted: boolean;
  dh_engine: 'v1' | 'l5';
  has_persona: boolean;
  last_debrief_day: string | null;
};

type Persona = {
  tastes: Record<string, unknown>;
  texting_style: Record<string, unknown>;
  schedule: Record<string, unknown>;
  okr: Record<string, unknown>;
  notes: string | null;
  updated_at?: string;
};

type Debrief = {
  day: string;
  metrics: Record<string, unknown>;
  notes: { worked?: string[]; flopped?: string[]; experiments?: string[] };
  prompt_addendum: string | null;
};

type Diary = {
  day: string;
  mood: string | null;
  events: string[];
  talking_points: string[];
};

type DhImage = {
  id: string;
  public_url: string;
  ordinal: number;
  image_tier: string;
  caption: string | null;
  active: boolean;
};

type Detail = {
  profile: RosterDh & { bio: string | null; storyline: string | null };
  persona: Persona | null;
  debriefs: Debrief[];
  diaries: Diary[];
  images: DhImage[];
  metrics24h: {
    messages_sent: number;
    messages_received: number;
    total_matches: number;
    matches_warming: number;
    avg_intimacy: number | null;
  };
};

const PERSONA_TEMPLATES: Record<string, Record<string, unknown>> = {
  tastes: {
    loves: ['cozy bookshops', 'iced matcha', 'cosplay craftsmanship'],
    hates: ['being rushed', 'gym-bro energy'],
    opinions: ['pineapple belongs on pizza and I will die on this hill'],
    boundaries: ['never shares address', 'deflects video-call asks with humor'],
    humor: 'dry, teasing, uses lowercase for sarcasm',
  },
  texting_style: {
    avg_words_per_bubble: 9,
    bubbles_per_turn: '1-3',
    emoji_policy: 'rare, only 😭 and 🙄',
    punctuation: 'lowercase, skips periods, double-texts when excited',
    typo_rate: 'occasional, never corrects them',
  },
  schedule: {
    timezone: 'America/Los_Angeles',
    fast_reply_hours: '19-24',
    slow_reply_hours: '9-17 (at work, replies short + delayed)',
    offline_hours: '1-8',
  },
  okr: {
    conversations_per_day: 5,
    reply_rate_target: 0.6,
    avg_intimacy_target: 55,
    north_star: 'users feel genuinely seen — enough to eventually tip',
  },
};

function glass(cls?: string) {
  return cn(
    'min-w-0 rounded-2xl border border-border/60 bg-card/75 backdrop-blur-xl',
    'shadow-[0_0_50px_-18px] shadow-violet-500/25',
    cls
  );
}

function initials(name: string) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function EngineBadge({ engine }: { engine: 'v1' | 'l5' }) {
  if (engine === 'l5') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-violet-500 via-fuchsia-500 to-amber-400 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white shadow-[0_0_14px] shadow-fuchsia-500/40">
        <Sparkles className="h-3 w-3" /> L5
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
      v1
    </span>
  );
}

function StatPill({ label, value, accent }: { label: string; value: React.ReactNode; accent?: boolean }) {
  return (
    <div className={glass('px-4 py-3')}>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn('mt-1 text-2xl font-semibold tabular-nums', accent && 'bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent')}>
        {value}
      </div>
    </div>
  );
}

function JsonSection({
  title,
  icon: Icon,
  value,
  onChange,
  templateKey,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  value: string;
  onChange: (v: string) => void;
  templateKey: string;
}) {
  const [invalid, setInvalid] = React.useState(false);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          <Icon className="h-3.5 w-3.5 text-violet-400" /> {title}
          {invalid && <span className="text-destructive normal-case">— invalid JSON</span>}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[11px] text-muted-foreground"
          onClick={() => onChange(JSON.stringify(PERSONA_TEMPLATES[templateKey], null, 2))}
        >
          Use template
        </Button>
      </div>
      <Textarea
        value={value}
        spellCheck={false}
        onChange={(e) => {
          onChange(e.target.value);
          try {
            JSON.parse(e.target.value || '{}');
            setInvalid(false);
          } catch {
            setInvalid(true);
          }
        }}
        className={cn(
          // Pin the height: the shadcn textarea has field-sizing:content, which
          // balloons to fit the whole JSON. Fixed height + resize-y + scroll.
          'h-[170px] min-h-[120px] max-h-[320px] resize-y overflow-auto [field-sizing:fixed]',
          'font-mono text-xs leading-relaxed rounded-xl bg-background/50',
          invalid && 'border-destructive focus-visible:ring-destructive'
        )}
      />
    </div>
  );
}

export default function L5PersonaPage() {
  const [roster, setRoster] = React.useState<RosterDh[]>([]);
  const [rosterLoading, setRosterLoading] = React.useState(true);
  const [query, setQuery] = React.useState('');
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const [detail, setDetail] = React.useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = React.useState(false);

  const [tastes, setTastes] = React.useState('{}');
  const [texting, setTexting] = React.useState('{}');
  const [schedule, setSchedule] = React.useState('{}');
  const [okr, setOkr] = React.useState('{}');
  const [notes, setNotes] = React.useState('');

  const [saving, setSaving] = React.useState(false);
  const [togglingEngine, setTogglingEngine] = React.useState(false);
  const [debriefing, setDebriefing] = React.useState(false);

  const fetchRoster = React.useCallback(async () => {
    setRosterLoading(true);
    try {
      const res = await fetch('/api/admin/l5/dhs');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load roster');
      const dhs: RosterDh[] = json.dhs ?? [];
      setRoster(dhs);
      setSelectedId((prev) => prev ?? dhs.find((d) => d.dh_engine === 'l5')?.userid ?? dhs[0]?.userid ?? null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load roster');
    } finally {
      setRosterLoading(false);
    }
  }, []);

  const fetchDetail = React.useCallback(async (dhid: string) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/admin/l5/${dhid}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load DH');
      const d: Detail = json;
      setDetail(d);
      setTastes(JSON.stringify(d.persona?.tastes ?? {}, null, 2));
      setTexting(JSON.stringify(d.persona?.texting_style ?? {}, null, 2));
      setSchedule(JSON.stringify(d.persona?.schedule ?? {}, null, 2));
      setOkr(JSON.stringify(d.persona?.okr ?? {}, null, 2));
      setNotes(d.persona?.notes ?? '');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load DH');
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void fetchRoster();
  }, [fetchRoster]);

  React.useEffect(() => {
    if (selectedId) void fetchDetail(selectedId);
  }, [selectedId, fetchDetail]);

  const savePersona = async () => {
    if (!selectedId) return;
    let parsed: Record<string, unknown>;
    try {
      parsed = {
        tastes: JSON.parse(tastes || '{}'),
        texting_style: JSON.parse(texting || '{}'),
        schedule: JSON.parse(schedule || '{}'),
        okr: JSON.parse(okr || '{}'),
        notes: notes || null,
      };
    } catch {
      toast.error('Fix the invalid JSON section before saving');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/l5/${selectedId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ persona: parsed }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Save failed');
      toast.success('Persona kernel saved');
      await fetchRoster();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const toggleEngine = async () => {
    if (!selectedId || !detail) return;
    const next = detail.profile.dh_engine === 'l5' ? 'v1' : 'l5';
    setTogglingEngine(true);
    try {
      const res = await fetch(`/api/admin/l5/${selectedId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engine: next }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Engine change failed');
      toast.success(next === 'l5' ? 'Promoted to L5 engine' : 'Reverted to v1 engine');
      await Promise.all([fetchDetail(selectedId), fetchRoster()]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Engine change failed');
    } finally {
      setTogglingEngine(false);
    }
  };

  const runDebrief = async () => {
    if (!selectedId) return;
    setDebriefing(true);
    try {
      const res = await fetch(`/api/admin/l5/${selectedId}/debrief-now`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Debrief failed');
      toast.success('Debrief complete — timeline updated');
      await fetchDetail(selectedId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Debrief failed');
    } finally {
      setDebriefing(false);
    }
  };

  const filtered = roster
    .filter((d) => (d.username || '').toLowerCase().includes(query.trim().toLowerCase()))
    // L5 engine DHs float to the top; alphabetical within each engine tier.
    .sort((a, b) => {
      if (a.dh_engine !== b.dh_engine) return a.dh_engine === 'l5' ? -1 : 1;
      return (a.username || '').localeCompare(b.username || '');
    });
  const l5Count = roster.filter((d) => d.dh_engine === 'l5').length;

  const timeline: Array<{ kind: 'debrief'; day: string; d: Debrief } | { kind: 'diary'; day: string; d: Diary }> =
    React.useMemo(() => {
      if (!detail) return [];
      const items = [
        ...detail.debriefs.map((d) => ({ kind: 'debrief' as const, day: d.day, d })),
        ...detail.diaries.map((d) => ({ kind: 'diary' as const, day: d.day, d })),
      ];
      return items.sort((a, b) => (a.day < b.day ? 1 : -1)).slice(0, 20);
    }, [detail]);

  return (
    <div className="relative overflow-x-clip">
      {/* Ambient gradient glow — the page's signature look. inset-x + margin
          auto keeps it inside the content box at every viewport width. */}
      <div className="pointer-events-none absolute -top-24 inset-x-0 mx-auto h-72 w-full max-w-[42rem] rounded-full bg-gradient-to-r from-violet-600/20 via-fuchsia-500/15 to-amber-400/10 blur-3xl" />

      <div className="relative space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="h-6 w-6 text-fuchsia-400" />
              <h1 className="text-2xl font-semibold tracking-tight">
                L5 Persona{' '}
                <span className="bg-gradient-to-r from-violet-400 via-fuchsia-400 to-amber-300 bg-clip-text text-transparent">
                  Lab
                </span>
              </h1>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Level-5 digital humans: persona kernels, living timelines, nightly debriefs and OKRs.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 animate-pulse rounded-full bg-fuchsia-400" />
              {l5Count} on L5
            </span>
            <span>·</span>
            <span>{roster.length - l5Count} on v1</span>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => void fetchRoster()}>
              <RefreshCw className={cn('h-3.5 w-3.5', rosterLoading && 'animate-spin')} />
            </Button>
          </div>
        </div>

        <div className="grid min-w-0 gap-4 lg:grid-cols-[290px_minmax(0,1fr)]">
          {/* Roster */}
          <div className={glass('p-3 lg:sticky lg:top-[4.5rem] lg:self-start')}>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search digital humans…"
                className="h-9 rounded-xl pl-8 text-sm"
              />
            </div>
            {/* Plain overflow div on purpose: Radix ScrollArea's inner
                display:table wrapper sizes children to max-content, which pushed
                the engine badges out of the clip box. */}
            <div className="mt-3 h-[calc(100dvh-11rem)] min-h-[320px] overflow-y-auto">
              <div className="space-y-1 pr-2">
                {rosterLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  filtered.map((dh) => (
                    <button
                      key={dh.userid}
                      type="button"
                      onClick={() => setSelectedId(dh.userid)}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-all',
                        selectedId === dh.userid
                          ? 'bg-gradient-to-r from-violet-500/15 to-fuchsia-500/10 ring-1 ring-fuchsia-500/30'
                          : 'hover:bg-accent/50'
                      )}
                    >
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={dh.avatar ?? undefined} alt={dh.username} />
                        <AvatarFallback className="text-xs">{initials(dh.username)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-medium">{dh.username}</span>
                          {dh.whitelisted && <span className="text-[10px] text-amber-400">★</span>}
                        </div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          {dh.personality ?? '—'}
                          {dh.last_debrief_day ? ` · debriefed ${dh.last_debrief_day}` : ''}
                        </div>
                      </div>
                      <span className="shrink-0">
                        <EngineBadge engine={dh.dh_engine} />
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Detail */}
          <div className="min-w-0 space-y-4">
            {detailLoading || !detail ? (
              <div className={glass('flex h-64 items-center justify-center')}>
                {detailLoading ? (
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                ) : (
                  <span className="text-sm text-muted-foreground">Select a digital human</span>
                )}
              </div>
            ) : (
              <>
                {/* Hero */}
                <div className={glass('p-5')}>
                  <div className="flex flex-wrap items-center gap-4">
                    <Avatar className="h-16 w-16 ring-2 ring-fuchsia-500/40 ring-offset-2 ring-offset-background">
                      <AvatarImage src={detail.profile.avatar ?? undefined} alt={detail.profile.username} />
                      <AvatarFallback>{initials(detail.profile.username)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-xl font-semibold tracking-tight">{detail.profile.username}</h2>
                        <EngineBadge engine={detail.profile.dh_engine} />
                        {detail.profile.whitelisted && (
                          <Badge variant="outline" className="border-amber-400/40 text-amber-400">whitelisted</Badge>
                        )}
                      </div>
                      <div className="mt-0.5 text-sm text-muted-foreground">
                        {[detail.profile.age && `${detail.profile.age}`, detail.profile.profession, detail.profile.personality]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="rounded-xl"
                        disabled={debriefing || detail.profile.dh_engine !== 'l5'}
                        title={detail.profile.dh_engine === 'l5' ? 'Run tonight’s debrief right now' : 'Promote to L5 first'}
                        onClick={() => void runDebrief()}
                      >
                        {debriefing ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1 h-3.5 w-3.5" />}
                        Run debrief now
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={togglingEngine}
                        onClick={() => void toggleEngine()}
                        className={cn(
                          'rounded-xl',
                          detail.profile.dh_engine !== 'l5' &&
                            'bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white hover:from-violet-600 hover:to-fuchsia-600'
                        )}
                        variant={detail.profile.dh_engine === 'l5' ? 'outline' : 'default'}
                      >
                        {togglingEngine ? (
                          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Sparkles className="mr-1 h-3.5 w-3.5" />
                        )}
                        {detail.profile.dh_engine === 'l5' ? 'Revert to v1' : 'Promote to L5'}
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Pulse */}
                <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                  <StatPill label="Msgs sent · 24h" value={detail.metrics24h.messages_sent} />
                  <StatPill label="Msgs received · 24h" value={detail.metrics24h.messages_received} />
                  <StatPill label="Warming matches" value={<span className="inline-flex items-center gap-1"><Flame className="h-4 w-4 text-amber-400" />{detail.metrics24h.matches_warming}</span>} />
                  <StatPill label="Avg intimacy" value={detail.metrics24h.avg_intimacy ?? '—'} accent />
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                  {/* Persona kernel */}
                  <div className={glass('space-y-4 p-5')}>
                    <div className="flex items-center justify-between">
                      <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                        <Target className="h-4 w-4 text-violet-400" /> Persona kernel
                      </h3>
                      <Button
                        type="button"
                        size="sm"
                        className="rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white hover:from-violet-600 hover:to-fuchsia-600"
                        disabled={saving}
                        onClick={() => void savePersona()}
                      >
                        {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1 h-3.5 w-3.5" />}
                        Save kernel
                      </Button>
                    </div>
                    <JsonSection title="Tastes & boundaries" icon={Flame} value={tastes} onChange={setTastes} templateKey="tastes" />
                    <JsonSection title="Texting fingerprint" icon={Activity} value={texting} onChange={setTexting} templateKey="texting_style" />
                    <JsonSection title="Schedule" icon={Moon} value={schedule} onChange={setSchedule} templateKey="schedule" />
                    <JsonSection title="OKR" icon={Target} value={okr} onChange={setOkr} templateKey="okr" />
                    <div className="space-y-1.5">
                      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Character notes</div>
                      <Textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Free-form directives, voice notes, no-go topics…"
                        className="h-[90px] max-h-[220px] min-h-[70px] resize-y overflow-auto [field-sizing:fixed] rounded-xl bg-background/50 text-sm"
                      />
                    </div>
                  </div>

                  {/* Timeline */}
                  <div className={glass('p-5')}>
                    <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                      <BookOpen className="h-4 w-4 text-fuchsia-400" /> Living timeline
                    </h3>
                    {/* No inner-scroll cap: a fixed max-height nested a scroll
                        region whose lower half fell below the fold, clipping
                        entries mid-text. Let the timeline flow so the page owns
                        the scroll and nothing is cut off. */}
                    <div className="mt-3">
                      {timeline.length === 0 ? (
                        <div className="py-10 text-center text-sm text-muted-foreground">
                          No debriefs or diary entries yet — promote to L5 and run a debrief.
                        </div>
                      ) : (
                        <div className="relative ml-2 space-y-5 border-l border-border/60 pl-5 pr-3">
                          {timeline.map((item, idx) => (
                            <div key={`${item.kind}-${item.day}-${idx}`} className="relative">
                              <span
                                className={cn(
                                  'absolute -left-[27px] top-1 h-3 w-3 rounded-full ring-4 ring-background',
                                  item.kind === 'debrief'
                                    ? 'bg-gradient-to-r from-violet-500 to-fuchsia-500'
                                    : 'bg-amber-400'
                                )}
                              />
                              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <span className="font-medium text-foreground">{item.day}</span>
                                {item.kind === 'debrief' ? (
                                  <Badge variant="outline" className="border-fuchsia-500/40 text-fuchsia-400">nightly debrief</Badge>
                                ) : (
                                  <Badge variant="outline" className="border-amber-400/40 text-amber-400">diary</Badge>
                                )}
                              </div>
                              {item.kind === 'debrief' ? (
                                <div className="mt-1.5 space-y-1.5 text-sm">
                                  {(item.d.notes?.worked ?? []).length > 0 && (
                                    <div>
                                      <span className="text-emerald-400">worked:</span>{' '}
                                      {(item.d.notes.worked ?? []).join(' · ')}
                                    </div>
                                  )}
                                  {(item.d.notes?.flopped ?? []).length > 0 && (
                                    <div>
                                      <span className="text-rose-400">flopped:</span>{' '}
                                      {(item.d.notes.flopped ?? []).join(' · ')}
                                    </div>
                                  )}
                                  {(item.d.notes?.experiments ?? []).length > 0 && (
                                    <div>
                                      <span className="text-sky-400">tomorrow:</span>{' '}
                                      {(item.d.notes.experiments ?? []).join(' · ')}
                                    </div>
                                  )}
                                  {item.d.prompt_addendum && (
                                    <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 px-3 py-2 text-xs text-muted-foreground">
                                      <span className="font-medium text-violet-400">coach notes → </span>
                                      {item.d.prompt_addendum}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <div className="mt-1.5 space-y-1 text-sm">
                                  {item.d.mood && <div className="text-muted-foreground">mood: {item.d.mood}</div>}
                                  {(item.d.events ?? []).map((e, i) => (
                                    <div key={i}>• {e}</div>
                                  ))}
                                  {(item.d.talking_points ?? []).length > 0 && (
                                    <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
                                      <Newspaper className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                      {(item.d.talking_points ?? []).join(' · ')}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Images */}
                <div className={glass('p-5')}>
                  <div className="flex items-center justify-between">
                    <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                      <Camera className="h-4 w-4 text-amber-400" /> Image inventory
                      <span className="normal-case text-xs">
                        ({detail.images.filter((i) => i.active).length} active — released casual → tease → reward as intimacy grows)
                      </span>
                    </h3>
                    <Button asChild variant="ghost" size="sm" className="h-7 rounded-xl text-xs">
                      <a href={`/admin/digital-humans/${detail.profile.userid}`}>Manage uploads →</a>
                    </Button>
                  </div>
                  {detail.images.length === 0 ? (
                    <div className="mt-3 rounded-xl border border-dashed border-border/60 px-4 py-6 text-center text-sm text-muted-foreground">
                      No images — she will deflect photo requests in-character. Upload some on her Digital Humans page.
                    </div>
                  ) : (
                    <div className="mt-3 flex gap-3 overflow-x-auto pb-1">
                      {detail.images.map((img) => (
                        <div key={img.id} className="w-28 shrink-0">
                          <div className="relative overflow-hidden rounded-xl border border-border/60">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={img.public_url} alt={img.caption ?? `pic ${img.ordinal}`} className={cn('h-36 w-28 object-cover', !img.active && 'opacity-40 grayscale')} />
                            <span
                              className={cn(
                                'absolute left-1 top-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white',
                                img.image_tier === 'reward'
                                  ? 'bg-gradient-to-r from-rose-500 to-fuchsia-500'
                                  : img.image_tier === 'tease'
                                    ? 'bg-gradient-to-r from-violet-500 to-fuchsia-500'
                                    : img.image_tier === 'casual'
                                      ? 'bg-emerald-500/90'
                                      : 'bg-zinc-500/90'
                              )}
                            >
                              {img.image_tier}
                            </span>
                          </div>
                          <div className="mt-1 truncate text-[10px] text-muted-foreground" title={img.caption ?? ''}>
                            #{img.ordinal} {img.caption ?? ''}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
