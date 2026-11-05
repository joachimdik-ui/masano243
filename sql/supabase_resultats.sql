-- Tables used by the Results & Live Center page.
create table if not exists public.matchs (
  id uuid primary key default gen_random_uuid(),
  date_match timestamptz,
  equipe_domicile text not null,
  equipe_visiteur text not null,
  score_domicile integer,
  score_visiteur integer,
  statut text not null default 'upcoming'
    check (statut in ('upcoming', 'live', 'finished', 'paused')),
  competition text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.classements (
  id uuid primary key default gen_random_uuid(),
  competition text not null,
  groupe text,
  position integer not null,
  equipe text not null,
  joues integer not null default 0,
  victoires integer not null default 0,
  nuls integer not null default 0,
  defaites integer not null default 0,
  points integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (competition, groupe, equipe)
);

alter table public.matchs enable row level security;
alter table public.classements enable row level security;

grant select on public.matchs, public.classements to anon, authenticated;
revoke insert, update, delete on public.matchs, public.classements from anon, authenticated;

drop policy if exists "Public can read matches" on public.matchs;
create policy "Public can read matches"
  on public.matchs for select to anon, authenticated using (true);
drop policy if exists "Authenticated users can manage matches" on public.matchs;

drop policy if exists "Public can read standings" on public.classements;
create policy "Public can read standings"
  on public.classements for select to anon, authenticated using (true);
drop policy if exists "Authenticated users can manage standings" on public.classements;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'matchs'
     ) then
    alter publication supabase_realtime add table public.matchs;
  end if;
end $$;
