-- Linafoot schema migration. This extends the existing Live Center tables
-- without removing their legacy columns or breaking international match data.

create table if not exists public.clubs (
  id uuid primary key default gen_random_uuid(),
  nom text not null unique,
  sigle text,
  logo_url text,
  ligue text not null check (ligue in ('L1', 'L2')),
  groupe text not null check (
    groupe in ('A', 'B') or (groupe = 'C' and ligue = 'L2')
  ),
  created_at timestamptz not null default now()
);

alter table public.clubs
  drop constraint if exists clubs_groupe_check,
  drop constraint if exists clubs_groupe_ligue_check;
alter table public.clubs
  add constraint clubs_groupe_ligue_check
    check (groupe in ('A', 'B') or (groupe = 'C' and ligue = 'L2'));

alter table public.matchs
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists ligue text,
  add column if not exists groupe text,
  add column if not exists journee integer,
  add column if not exists stade text,
  add column if not exists club_domicile_id uuid,
  add column if not exists club_visiteur_id uuid;

alter table public.matchs
  drop constraint if exists matchs_statut_check;
alter table public.matchs
  drop constraint if exists matchs_ligue_check,
  drop constraint if exists matchs_groupe_check,
  drop constraint if exists matchs_journee_check,
  drop constraint if exists matchs_club_domicile_id_fkey,
  drop constraint if exists matchs_club_visiteur_id_fkey;

alter table public.matchs
  add constraint matchs_statut_check
    check (statut in ('upcoming', 'live', 'finished', 'paused', 'Programmé', 'En cours', 'Terminé', 'Reporté')),
  add constraint matchs_ligue_check
    check (ligue is null or ligue in ('L1', 'L2')),
  add constraint matchs_groupe_check
    check (
      groupe is null
      or groupe in ('A', 'B')
      or (groupe = 'C' and ligue = 'L2')
    ),
  add constraint matchs_journee_check
    check (journee is null or journee > 0);

alter table public.matchs
  add constraint matchs_club_domicile_id_fkey
    foreign key (club_domicile_id) references public.clubs(id) on delete restrict,
  add constraint matchs_club_visiteur_id_fkey
    foreign key (club_visiteur_id) references public.clubs(id) on delete restrict;

alter table public.classements
  add column if not exists club_id uuid,
  add column if not exists ligue text,
  add column if not exists gagnes integer not null default 0,
  add column if not exists buts_pour integer not null default 0,
  add column if not exists buts_contre integer not null default 0,
  add column if not exists difference_buts integer not null default 0;

alter table public.classements
  drop constraint if exists classements_ligue_check,
  drop constraint if exists classements_club_id_fkey;

alter table public.classements
  add constraint classements_ligue_check
    check (ligue is null or ligue in ('L1', 'L2'));

alter table public.classements
  add constraint classements_club_id_fkey
    foreign key (club_id) references public.clubs(id) on delete cascade;

create unique index if not exists classements_club_id_unique
  on public.classements (club_id)
  where club_id is not null;

create table if not exists public.buteurs (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  club_id uuid not null constraint buteurs_club_id_fkey
    references public.clubs(id) on delete cascade,
  ligue text not null default 'L1' constraint buteurs_ligue_check check (ligue in ('L1', 'L2')),
  matches_joues integer not null default 0 check (matches_joues >= 0),
  buts integer not null default 0 check (buts >= 0),
  penaltys integer not null default 0 check (penaltys >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint unique_joueur_par_club unique (nom, club_id)
);

alter table public.buteurs
  add column if not exists penaltys integer not null default 0 check (penaltys >= 0);

create index if not exists idx_buteurs_ligue_classement
  on public.buteurs (ligue, buts desc, penaltys asc);

create or replace function public.buteurs_set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.buteurs_set_updated_at() from public, anon, authenticated;

drop trigger if exists buteurs_set_updated_at on public.buteurs;
create trigger buteurs_set_updated_at
  before update on public.buteurs
  for each row execute function public.buteurs_set_updated_at();

create index if not exists matchs_linafoot_filter_idx
  on public.matchs (ligue, groupe, date_match desc);

create or replace function public.preparer_match_linafoot()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  domicile public.clubs%rowtype;
  visiteur public.clubs%rowtype;
begin
  if new.club_domicile_id is null and new.club_visiteur_id is null then
    return new;
  end if;
  if new.club_domicile_id is null or new.club_visiteur_id is null then
    raise exception 'Un match Linafoot doit avoir deux clubs associés.';
  end if;

  select * into domicile from public.clubs where id = new.club_domicile_id;
  select * into visiteur from public.clubs where id = new.club_visiteur_id;
  if domicile.id is null or visiteur.id is null then
    raise exception 'Les deux clubs du match doivent exister.';
  end if;
  if domicile.ligue <> visiteur.ligue or domicile.groupe <> visiteur.groupe then
    raise exception 'Les clubs doivent appartenir à la même ligue et au même groupe.';
  end if;
  if new.ligue is not null and new.ligue <> domicile.ligue then
    raise exception 'La ligue du match doit correspondre à celle des clubs.';
  end if;
  if new.groupe is not null and new.groupe <> domicile.groupe then
    raise exception 'Le groupe du match doit correspondre à celui des clubs.';
  end if;

  new.ligue := domicile.ligue;
  new.groupe := domicile.groupe;
  new.equipe_domicile := domicile.nom;
  new.equipe_visiteur := visiteur.nom;
  new.competition := case when domicile.ligue = 'L1' then 'Linafoot Ligue 1' else 'Linafoot Ligue 2' end;
  return new;
end;
$$;
revoke all on function public.preparer_match_linafoot() from public, anon, authenticated;

drop trigger if exists matchs_preparer_linafoot on public.matchs;
create trigger matchs_preparer_linafoot
  before insert or update of club_domicile_id, club_visiteur_id, ligue, groupe
  on public.matchs
  for each row execute function public.preparer_match_linafoot();

create or replace function public.recalculer_classements()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  with bilan as (
    select
      c.id as club_id,
      c.nom as equipe,
      c.ligue,
      c.groupe,
      count(m.id) filter (where m.id is not null)::integer as joues,
      count(m.id) filter (
        where (m.club_domicile_id = c.id and m.score_domicile > m.score_visiteur)
           or (m.club_visiteur_id = c.id and m.score_visiteur > m.score_domicile)
      )::integer as gagnes,
      count(m.id) filter (
        where m.id is not null and m.score_domicile = m.score_visiteur
      )::integer as nuls,
      count(m.id) filter (
        where (m.club_domicile_id = c.id and m.score_domicile < m.score_visiteur)
           or (m.club_visiteur_id = c.id and m.score_visiteur < m.score_domicile)
      )::integer as defaites,
      coalesce(sum(
        case when m.club_domicile_id = c.id then m.score_domicile
             when m.club_visiteur_id = c.id then m.score_visiteur end
      ), 0)::integer as buts_pour,
      coalesce(sum(
        case when m.club_domicile_id = c.id then m.score_visiteur
             when m.club_visiteur_id = c.id then m.score_domicile end
      ), 0)::integer as buts_contre
    from public.clubs c
    left join public.matchs m
      on (m.club_domicile_id = c.id or m.club_visiteur_id = c.id)
     and m.ligue = c.ligue
     and m.groupe = c.groupe
     and m.statut in ('finished', 'Terminé')
     and m.score_domicile is not null
     and m.score_visiteur is not null
    group by c.id, c.nom, c.ligue, c.groupe
  ),
  classe as (
    select
      bilan.*,
      buts_pour - buts_contre as difference_buts,
      gagnes * 3 + nuls as points,
      row_number() over (
        partition by ligue, groupe
        order by gagnes * 3 + nuls desc,
                 buts_pour - buts_contre desc,
                 buts_pour desc,
                 equipe asc
      )::integer as position
    from bilan
  )
  insert into public.classements (
    club_id, ligue, groupe, competition, position, equipe,
    joues, victoires, gagnes, nuls, defaites,
    buts_pour, buts_contre, difference_buts, points, updated_at
  )
  select
    club_id, ligue, groupe,
    case when ligue = 'L1' then 'Linafoot Ligue 1' else 'Linafoot Ligue 2' end,
    position, equipe,
    joues, gagnes, gagnes, nuls, defaites,
    buts_pour, buts_contre, difference_buts, points, now()
  from classe
  on conflict (club_id) where club_id is not null
  do update set
    ligue = excluded.ligue,
    groupe = excluded.groupe,
    competition = excluded.competition,
    position = excluded.position,
    equipe = excluded.equipe,
    joues = excluded.joues,
    victoires = excluded.victoires,
    gagnes = excluded.gagnes,
    nuls = excluded.nuls,
    defaites = excluded.defaites,
    buts_pour = excluded.buts_pour,
    buts_contre = excluded.buts_contre,
    difference_buts = excluded.difference_buts,
    points = excluded.points,
    updated_at = excluded.updated_at;

  return null;
end;
$$;
revoke all on function public.recalculer_classements() from public, anon, authenticated;

drop trigger if exists matchs_recalculer_classements on public.matchs;
create trigger matchs_recalculer_classements
  after insert or update or delete on public.matchs
  for each statement execute function public.recalculer_classements();

drop trigger if exists clubs_recalculer_classements on public.clubs;
create trigger clubs_recalculer_classements
  after insert or update or delete on public.clubs
  for each statement execute function public.recalculer_classements();

alter table public.clubs enable row level security;
alter table public.matchs enable row level security;
alter table public.classements enable row level security;
alter table public.buteurs enable row level security;

grant select on public.clubs, public.matchs, public.classements to anon, authenticated;
grant select on public.buteurs to anon, authenticated;
revoke insert, update, delete on public.clubs, public.matchs, public.classements from anon, authenticated;
revoke insert, update, delete on public.buteurs from anon, authenticated;

drop policy if exists "Public can read clubs" on public.clubs;
create policy "Public can read clubs"
  on public.clubs for select to anon, authenticated using (true);
drop policy if exists "Authenticated users can manage clubs" on public.clubs;

drop policy if exists "Public can read matches" on public.matchs;
create policy "Public can read matches"
  on public.matchs for select to anon, authenticated using (true);
drop policy if exists "Authenticated users can manage matches" on public.matchs;

drop policy if exists "Public can read standings" on public.classements;
create policy "Public can read standings"
  on public.classements for select to anon, authenticated using (true);
drop policy if exists "Authenticated users can manage standings" on public.classements;

drop policy if exists "Public can read top scorers" on public.buteurs;
create policy "Public can read top scorers"
  on public.buteurs for select to anon, authenticated using (true);
drop policy if exists "Authenticated users can manage top scorers" on public.buteurs;

do $$
declare
  table_name text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach table_name in array array['matchs', 'classements', 'buteurs']
    loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = table_name
      ) then
        execute format('alter publication supabase_realtime add table public.%I', table_name);
      end if;
    end loop;
  end if;
end;
$$;
