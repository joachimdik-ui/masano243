-- EPF-KIN scorer ranking and match goal events.
-- Run after supabase_epf_kin.sql in the Supabase SQL Editor.

begin;

create table if not exists public.epf_kin_scorers (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  club_id uuid not null
    constraint epf_kin_scorers_club_id_fkey
    references public.epf_kin_clubs(id) on delete restrict,
  saison text not null,
  matches_joues integer not null default 0 check (matches_joues >= 0),
  buts integer not null default 0 check (buts >= 0),
  penaltys integer not null default 0 check (penaltys >= 0 and penaltys <= buts),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint epf_kin_scorers_unique_player unique (nom, club_id, saison)
);

create table if not exists public.epf_kin_match_events (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null
    constraint epf_kin_match_events_match_id_fkey
    references public.epf_kin_matches(id) on delete cascade,
  club_id uuid not null
    constraint epf_kin_match_events_club_id_fkey
    references public.epf_kin_clubs(id) on delete restrict,
  buteur_id uuid not null
    constraint epf_kin_match_events_buteur_id_fkey
    references public.epf_kin_scorers(id) on delete restrict,
  type text not null check (type in ('goal', 'penalty', 'own_goal')),
  minute integer check (minute is null or minute between 0 and 150),
  minute_additionnelle integer check (
    minute_additionnelle is null or minute_additionnelle between 0 and 30
  ),
  joueur text,
  ordre integer not null default 0,
  stats_comptees boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists epf_kin_scorers_ranking_idx
  on public.epf_kin_scorers (saison, club_id, buts desc, penaltys asc);
create index if not exists epf_kin_match_events_match_order_idx
  on public.epf_kin_match_events (
    match_id, minute, minute_additionnelle, ordre
  );
create index if not exists epf_kin_match_events_scorer_idx
  on public.epf_kin_match_events (buteur_id);

create or replace function public.epf_kin_prepare_scorer_event()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  scorer public.epf_kin_scorers%rowtype;
  fixture public.epf_kin_matches%rowtype;
begin
  select * into scorer
  from public.epf_kin_scorers
  where id = new.buteur_id;

  if not found then
    raise exception 'Le buteur indiqué n’existe pas dans public.epf_kin_scorers.';
  end if;

  select * into fixture
  from public.epf_kin_matches
  where id = new.match_id;

  if not found then
    raise exception 'Le match indiqué n’existe pas dans public.epf_kin_matches.';
  end if;

  if new.club_id not in (fixture.club_domicile_id, fixture.club_visiteur_id) then
    raise exception 'Le club de l’événement ne participe pas à ce match.';
  end if;

  if scorer.club_id <> new.club_id then
    raise exception 'Le buteur doit appartenir au club associé à l’événement.';
  end if;

  if scorer.saison <> fixture.saison then
    raise exception 'La saison du buteur doit correspondre à celle du match.';
  end if;

  new.joueur := scorer.nom;
  new.stats_comptees := new.type in ('goal', 'penalty');
  return new;
end;
$$;
revoke all on function public.epf_kin_prepare_scorer_event()
  from public, anon, authenticated;

drop trigger if exists epf_kin_match_events_prepare_scorer
  on public.epf_kin_match_events;
create trigger epf_kin_match_events_prepare_scorer
  before insert or update of match_id, club_id, buteur_id, type
  on public.epf_kin_match_events
  for each row
  execute function public.epf_kin_prepare_scorer_event();

create or replace function public.epf_kin_sync_scorer_totals()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op <> 'INSERT'
    and old.stats_comptees
    and old.type in ('goal', 'penalty') then
    update public.epf_kin_scorers
    set
      buts = greatest(0, buts - 1),
      penaltys = greatest(
        0,
        penaltys - case when old.type = 'penalty' then 1 else 0 end
      ),
      updated_at = now()
    where id = old.buteur_id;
  end if;

  if tg_op <> 'DELETE'
    and new.stats_comptees
    and new.type in ('goal', 'penalty') then
    update public.epf_kin_scorers
    set
      buts = buts + 1,
      penaltys = penaltys + case when new.type = 'penalty' then 1 else 0 end,
      updated_at = now()
    where id = new.buteur_id;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;
revoke all on function public.epf_kin_sync_scorer_totals()
  from public, anon, authenticated;

drop trigger if exists epf_kin_match_events_sync_scorer_totals
  on public.epf_kin_match_events;
create trigger epf_kin_match_events_sync_scorer_totals
  after insert or update of buteur_id, type or delete
  on public.epf_kin_match_events
  for each row
  execute function public.epf_kin_sync_scorer_totals();

alter table public.epf_kin_scorers enable row level security;
alter table public.epf_kin_match_events enable row level security;

revoke all on public.epf_kin_scorers, public.epf_kin_match_events
  from public, anon, authenticated;
grant select on public.epf_kin_scorers, public.epf_kin_match_events
  to anon, authenticated;

drop policy if exists "Public can read EPF-KIN scorers"
  on public.epf_kin_scorers;
create policy "Public can read EPF-KIN scorers"
  on public.epf_kin_scorers for select to anon, authenticated using (true);

drop policy if exists "Public can read EPF-KIN match events"
  on public.epf_kin_match_events;
create policy "Public can read EPF-KIN match events"
  on public.epf_kin_match_events for select to anon, authenticated using (true);

do $$
begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'epf_kin_scorers'
    ) then
      alter publication supabase_realtime add table public.epf_kin_scorers;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'epf_kin_match_events'
    ) then
      alter publication supabase_realtime add table public.epf_kin_match_events;
    end if;
  end if;
end;
$$;

commit;
