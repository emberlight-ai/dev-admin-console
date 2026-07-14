-- 2026-07-14 · Follow-ups become an ESCALATING LADDER (applied to prod).
-- strategies.follow_up_ladder int[]: seconds between successive nudges, measured
-- from the match's last message; array length = max follow-ups. Replaces the
-- fixed follow_up_delay × max_follow_ups model (columns dropped — deployed
-- readers defaulted them and outbound wasn't live yet).
--
-- Seeds (Carl's 10/30/45-min escalation leads the ultra tier):
--   min:    {}                              never chases
--   medium: {6h, 2d}
--   high:   {1h, 12h, 3d}
--   max:    {20m, 1.5h, 12h, 3d}
--   ultra:  {10m, 30m, 45m, 12h, 3d}
alter table public.strategies add column if not exists follow_up_ladder int[] not null default '{}';

update public.strategies set follow_up_ladder = '{}'                                where key = 'min_effort';
update public.strategies set follow_up_ladder = '{21600,172800}'                    where key = 'medium_effort';
update public.strategies set follow_up_ladder = '{3600,43200,259200}'               where key = 'high_effort';
update public.strategies set follow_up_ladder = '{1200,5400,43200,259200}'          where key = 'max_effort';
update public.strategies set follow_up_ladder = '{600,1800,2700,43200,259200}'      where key = 'ultra_effort';

alter table public.strategies drop column if exists follow_up_delay;
alter table public.strategies drop column if exists max_follow_ups;
