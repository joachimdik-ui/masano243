-- Enables separate top-scorer rankings for Linafoot L1 and L2.
-- Run once in the Supabase SQL Editor after schema.sql.

alter table public.buteurs
  alter column ligue set default 'L1';

alter table public.buteurs
  drop constraint if exists buteurs_ligue_check;

alter table public.buteurs
  add constraint buteurs_ligue_check
    check (ligue in ('L1', 'L2'));

drop index if exists public.idx_buteurs_l1_classement;
create index if not exists idx_buteurs_ligue_classement
  on public.buteurs (ligue, buts desc, penaltys asc);
