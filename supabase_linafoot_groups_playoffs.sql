-- Linafoot L2 gains group C.
-- The L1 Play Off selector is a preview calculated from groups A and B;
-- it is intentionally not stored as a club group or a match group.
-- Run in the Supabase SQL Editor after schema.sql.

begin;

alter table public.clubs
  drop constraint if exists clubs_groupe_check,
  drop constraint if exists clubs_groupe_ligue_check;

alter table public.clubs
  add constraint clubs_groupe_ligue_check
    check (groupe in ('A', 'B') or (groupe = 'C' and ligue = 'L2'));

alter table public.matchs
  drop constraint if exists matchs_groupe_check;

alter table public.matchs
  add constraint matchs_groupe_check
    check (
      groupe is null
      or groupe in ('A', 'B')
      or (groupe = 'C' and ligue = 'L2')
    );

commit;
