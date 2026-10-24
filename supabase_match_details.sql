-- Linafoot match detail tables.
-- Run after supabase_resultats.sql and schema.sql in the Supabase SQL Editor.

alter table public.matchs
  add column if not exists arbitre text,
  add column if not exists resume_video_url text,
  add column if not exists resume_video_thumbnail text;

create table if not exists public.match_events (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matchs(id) on delete cascade,
  club_id uuid,
  type text not null check (
    type in ('goal', 'but', 'penalty', 'own_goal', 'but_contre', 'booking', 'card', 'substitution', 'subst', 'red_card', 'yellow_card', 'other')
  ),
  minute integer check (minute is null or minute between 0 and 150),
  minute_additionnelle integer check (minute_additionnelle is null or minute_additionnelle between 0 and 30),
  joueur text,
  passeur text,
  detail text,
  ordre integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint match_events_club_id_fkey
    foreign key (club_id) references public.clubs(id) on delete set null
);

create table if not exists public.match_lineups (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matchs(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade,
  formation text,
  entraineur text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint match_lineups_match_club_unique unique (match_id, club_id)
);

create table if not exists public.match_lineup_players (
  id uuid primary key default gen_random_uuid(),
  lineup_id uuid not null references public.match_lineups(id) on delete cascade,
  nom text not null,
  numero integer check (numero is null or numero between 1 and 99),
  position text,
  est_remplacant boolean not null default false,
  ordre integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists match_events_match_order_idx
  on public.match_events (match_id, minute, minute_additionnelle, ordre);
create index if not exists match_lineups_match_idx
  on public.match_lineups (match_id);
create index if not exists match_lineup_players_lineup_order_idx
  on public.match_lineup_players (lineup_id, est_remplacant, ordre);
create index if not exists matchs_head_to_head_idx
  on public.matchs (club_domicile_id, club_visiteur_id, date_match desc);

create or replace function public.match_details_set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.match_details_set_updated_at() from public, anon, authenticated;

drop trigger if exists match_events_set_updated_at on public.match_events;
create trigger match_events_set_updated_at
  before update on public.match_events
  for each row execute function public.match_details_set_updated_at();

drop trigger if exists match_lineups_set_updated_at on public.match_lineups;
create trigger match_lineups_set_updated_at
  before update on public.match_lineups
  for each row execute function public.match_details_set_updated_at();

drop trigger if exists match_lineup_players_set_updated_at on public.match_lineup_players;
create trigger match_lineup_players_set_updated_at
  before update on public.match_lineup_players
  for each row execute function public.match_details_set_updated_at();

alter table public.match_events enable row level security;
alter table public.match_lineups enable row level security;
alter table public.match_lineup_players enable row level security;

revoke all on public.match_events, public.match_lineups, public.match_lineup_players from public, anon, authenticated;
grant select on public.match_events, public.match_lineups, public.match_lineup_players to anon, authenticated;

drop policy if exists "Public can read match events" on public.match_events;
create policy "Public can read match events"
  on public.match_events for select to anon, authenticated using (true);

drop policy if exists "Public can read match lineups" on public.match_lineups;
create policy "Public can read match lineups"
  on public.match_lineups for select to anon, authenticated using (true);

drop policy if exists "Public can read match lineup players" on public.match_lineup_players;
create policy "Public can read match lineup players"
  on public.match_lineup_players for select to anon, authenticated using (true);
