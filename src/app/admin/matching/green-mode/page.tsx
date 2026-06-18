'use client';

import * as React from 'react';
import { Check, Leaf, Loader2, Plus, X } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type GreenModeResponse = {
  data?: {
    personalities?: string[];
    availablePersonalities?: string[];
  };
  error?: string;
};

function normalizePersonality(value: string) {
  return value.trim();
}

export default function MatchingGreenModePage() {
  const [personalities, setPersonalities] = React.useState<string[]>([]);
  const [savedPersonalities, setSavedPersonalities] = React.useState<string[]>([]);
  const [availablePersonalities, setAvailablePersonalities] = React.useState<string[]>([]);
  const [inputValue, setInputValue] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  const selectedKeys = React.useMemo(
    () => new Set(personalities.map((p) => p.toLowerCase())),
    [personalities]
  );
  const isDirty = React.useMemo(
    () => JSON.stringify(personalities) !== JSON.stringify(savedPersonalities),
    [personalities, savedPersonalities]
  );

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/matching/green-mode');
      const json = (await res.json()) as GreenModeResponse;
      if (!res.ok) throw new Error(json.error || 'Failed to load green mode');
      const nextPersonalities = json.data?.personalities ?? [];
      setPersonalities(nextPersonalities);
      setSavedPersonalities(nextPersonalities);
      setAvailablePersonalities(json.data?.availablePersonalities ?? []);
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Failed to load green mode');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const addPersonality = (raw: string) => {
    const personality = normalizePersonality(raw);
    if (!personality) return;
    const key = personality.toLowerCase();
    setPersonalities((prev) => {
      if (prev.some((p) => p.toLowerCase() === key)) return prev;
      return [...prev, personality].sort((a, b) => a.localeCompare(b));
    });
    setInputValue('');
  };

  const removePersonality = (personality: string) => {
    const key = personality.toLowerCase();
    setPersonalities((prev) => prev.filter((p) => p.toLowerCase() !== key));
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/matching/green-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personalities }),
      });
      const json = (await res.json()) as GreenModeResponse;
      if (!res.ok) throw new Error(json.error || 'Failed to save green mode');
      const nextPersonalities = json.data?.personalities ?? personalities;
      setPersonalities(nextPersonalities);
      setSavedPersonalities(nextPersonalities);
      toast.success('Green mode saved');
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Failed to save green mode');
    } finally {
      setSaving(false);
    }
  };

  const filteredSuggestions = React.useMemo(() => {
    const q = inputValue.trim().toLowerCase();
    return availablePersonalities
      .filter((p) => !selectedKeys.has(p.toLowerCase()))
      .filter((p) => !q || p.toLowerCase().includes(q))
      .slice(0, 12);
  }, [availablePersonalities, inputValue, selectedKeys]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Leaf className="h-5 w-5 text-emerald-500" />
          Green Mode
        </h1>
        <p className="text-sm text-muted-foreground">
          When this set is non-empty, every matching feed only returns users with these
          personalities.
        </p>
      </div>

      <div className="rounded-lg border bg-card">
        <div className="flex items-center justify-between gap-3 border-b bg-muted/20 px-4 py-3">
          <div>
            <div className="text-sm font-medium">
              {loading ? 'Loading...' : `${personalities.length} personalities selected`}
            </div>
            <div className="text-xs text-muted-foreground">
              Empty set means normal matching behavior.
            </div>
          </div>
          <Button onClick={save} disabled={loading || saving || !isDirty} className="gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Save
          </Button>
        </div>

        <div className="space-y-5 p-4">
          <div className="flex gap-2">
            <Input
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addPersonality(inputValue);
                }
              }}
              placeholder="Add personality..."
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => addPersonality(inputValue)}
              disabled={!inputValue.trim()}
              className="gap-2"
            >
              <Plus className="h-4 w-4" />
              Add
            </Button>
          </div>

          {filteredSuggestions.length > 0 ? (
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase text-muted-foreground">
                Existing personalities
              </div>
              <div className="flex flex-wrap gap-2">
                {filteredSuggestions.map((personality) => (
                  <Button
                    key={personality}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => addPersonality(personality)}
                    className="h-8 gap-2"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {personality}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="space-y-2">
            <div className="text-xs font-medium uppercase text-muted-foreground">
              Active set
            </div>
            {personalities.length === 0 ? (
              <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                No personalities selected.
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {personalities.map((personality) => (
                  <Badge key={personality} variant="secondary" className="gap-1.5 py-1.5 pl-2.5">
                    {personality}
                    <button
                      type="button"
                      onClick={() => removePersonality(personality)}
                      className="rounded-sm p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
                      aria-label={`Remove ${personality}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
