-- EPF-KIN 110e edition, saison 2026-2027.
-- Run this migration in the Supabase SQL Editor to create the EPF-KIN
-- tables and seed the 1re journée shown in the supplied schedules.

begin;

create table if not exists public.epf_kin_clubs (
  id uuid primary key default gen_random_uuid(),
  nom text not null unique,
  serie text not null check (serie in ('A', 'B', 'C')),
  logo_url text,
  created_at timestamptz not null default now()
);

alter table public.epf_kin_clubs
  add column if not exists logo_url text;

create table if not exists public.epf_kin_matches (
  id uuid primary key default gen_random_uuid(),
  saison text not null,
  journee integer not null check (journee > 0),
  serie text not null check (serie in ('A', 'B', 'C')),
  club_domicile_id uuid not null
    constraint epf_kin_matches_club_domicile_id_fkey
    references public.epf_kin_clubs(id) on delete restrict,
  club_visiteur_id uuid not null
    constraint epf_kin_matches_club_visiteur_id_fkey
    references public.epf_kin_clubs(id) on delete restrict,
  date_match timestamptz not null,
  stade text,
  score_domicile integer check (score_domicile is null or score_domicile >= 0),
  score_visiteur integer check (score_visiteur is null or score_visiteur >= 0),
  statut text not null default 'upcoming'
    check (statut in ('upcoming', 'live', 'finished', 'paused')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint epf_kin_matches_clubs_different check (club_domicile_id <> club_visiteur_id),
  constraint epf_kin_matches_fixture_unique
    unique (saison, journee, serie, club_domicile_id, club_visiteur_id)
);

create index if not exists epf_kin_matches_schedule_idx
  on public.epf_kin_matches (saison, serie, date_match);

alter table public.epf_kin_clubs enable row level security;
alter table public.epf_kin_matches enable row level security;

revoke all on public.epf_kin_clubs, public.epf_kin_matches from public, anon, authenticated;
grant select on public.epf_kin_clubs, public.epf_kin_matches to anon, authenticated;

drop policy if exists "Public can read EPF-KIN clubs" on public.epf_kin_clubs;
create policy "Public can read EPF-KIN clubs"
  on public.epf_kin_clubs for select to anon, authenticated using (true);

drop policy if exists "Public can read EPF-KIN matches" on public.epf_kin_matches;
create policy "Public can read EPF-KIN matches"
  on public.epf_kin_matches for select to anon, authenticated using (true);

insert into public.epf_kin_clubs (nom, serie) values
  ('ARSENAL BB', 'A'),
  ('FC FONAK', 'A'),
  ('ELK 47 FC', 'A'),
  ('AC FIBO', 'A'),
  ('AFEDICK FC', 'A'),
  ('FC UNION FORCE', 'A'),
  ('AC KRATOS', 'A'),
  ('ACI AMISPORT', 'A'),
  ('AJ VAINQUEURS', 'A'),
  ('IC KALAMU', 'A'),
  ('RCK', 'A'),
  ('JMK', 'A'),
  ('AC NORMANDS', 'A'),
  ('NEW US KINTAMBO', 'A'),
  ('AS KORA', 'A'),
  ('KONGO SC', 'A'),
  ('FC FENELINE', 'B'),
  ('RC IMPACT', 'B'),
  ('EL17 LEVONS-NOUS', 'B'),
  ('SFC LIMETE', 'B'),
  ('AS MIEL SPORT', 'B'),
  ('FC TRINITE', 'B'),
  ('TP LES CROYANTS', 'B'),
  ('RC BAKI', 'B'),
  ('AS PJSK', 'B'),
  ('OC DUMEZ', 'B'),
  ('AS EJEUNA', 'B'),
  ('AS MARYVAN', 'B'),
  ('CS GOEWA', 'B'),
  ('FC NKOY FARDC', 'B'),
  ('JS WANGATA', 'B'),
  ('FC KALONJI', 'B'),
  ('TP LES ANGES', 'C'),
  ('AS DRAGONS', 'C'),
  ('AF ST CHRISTIAN', 'C'),
  ('CELESTE AFC', 'C'),
  ('YML SPORT FC', 'C'),
  ('AS BOL''S', 'C'),
  ('FC AIGLE ROYAL', 'C'),
  ('FC MWEKA', 'C'),
  ('AC IBB', 'C'),
  ('FC SALVADOR', 'C'),
  ('AS BANA DORA', 'C'),
  ('TP BELPRO', 'C'),
  ('FC NEW CANON DE NDJILI', 'C'),
  ('RC PROMESSE', 'C')
on conflict (nom) do update
set serie = excluded.serie;

with fixtures (serie, domicile, visiteur, date_locale, stade) as (
  values
    ('A', 'ARSENAL BB', 'AS KORA', '2026-11-02 09:00', 'MARTYRS'),
    ('A', 'FC FONAK', 'NEW US KINTAMBO', '2026-11-02 14:00', 'STR'),
    ('A', 'ELK 47 FC', 'AC NORMANDS', '2026-11-02 13:00', 'ACADEMIE'),
    ('A', 'AC FIBO', 'JMK', '2026-11-02 10:00', 'STR'),
    ('A', 'AFEDICK FC', 'RCK', '2026-11-02 11:00', 'UPN'),
    ('A', 'FC UNION FORCE', 'IC KALAMU', '2026-11-02 11:00', 'ACADEMIE'),
    ('A', 'AC KRATOS', 'AJ VAINQUEURS', '2026-11-02 16:00', 'STR'),
    ('A', 'ACI AMISPORT', 'KONGO SC', '2026-11-02 09:00', 'ACADEMIE'),
    ('B', 'FC FENELINE', 'JS WANGATA', '2026-11-03 16:00', 'STR'),
    ('B', 'RC IMPACT', 'FC NKOY FARDC', '2026-11-03 15:00', 'ACADEMIE'),
    ('B', 'EL17 LEVONS-NOUS', 'AS EJEUNA', '2026-11-03 09:00', 'ACADEMIE'),
    ('B', 'SFC LIMETE', 'CS GOEWA', '2026-11-03 13:00', 'ACADEMIE'),
    ('B', 'AS MIEL SPORT', 'AS MARYVAN', '2026-11-03 14:00', 'STR'),
    ('B', 'FC TRINITE', 'OC DUMEZ', '2026-11-03 10:00', 'STR'),
    ('B', 'TP LES CROYANTS', 'AS PJSK', '2026-11-03 11:00', 'ACADEMIE'),
    ('B', 'RC BAKI', 'FC KALONJI', '2026-11-02 13:00', 'MARTYRS'),
    ('C', 'TP LES ANGES', 'FC NEW CANON DE NDJILI', '2026-11-02 15:00', 'MARTYRS'),
    ('C', 'AS DRAGONS', 'TP BELPRO', '2026-11-02 13:00', 'UPN'),
    ('C', 'AF ST CHRISTIAN', 'AS BANA DORA', '2026-11-02 12:00', 'STR'),
    ('C', 'CELESTE AFC', 'FC SALVADOR', '2026-11-03 12:00', 'STR'),
    ('C', 'YML SPORT FC', 'AC IBB', '2026-11-02 11:00', 'MARTYRS'),
    ('C', 'AS BOL''S', 'FC MWEKA', '2026-11-02 15:00', 'ACADEMIE'),
    ('C', 'FC AIGLE ROYAL', 'RC PROMESSE', '2026-11-03 09:00', 'MARTYRS')
)
insert into public.epf_kin_matches (
  saison, journee, serie, club_domicile_id, club_visiteur_id, date_match, stade, statut
)
select
  '2026-2027',
  1,
  f.serie,
  home.id,
  away.id,
  f.date_locale::timestamp at time zone 'Africa/Kinshasa',
  f.stade,
  'upcoming'
from fixtures f
join public.epf_kin_clubs home on home.nom = f.domicile and home.serie = f.serie
join public.epf_kin_clubs away on away.nom = f.visiteur and away.serie = f.serie
on conflict (saison, journee, serie, club_domicile_id, club_visiteur_id)
do update set
  date_match = excluded.date_match,
  stade = excluded.stade;

commit;
