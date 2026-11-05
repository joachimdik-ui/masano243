-- EPF-KIN standings and top-scorer views by series.
-- Run after supabase_epf_kin.sql and supabase_epf_kin_scorers.sql.

begin;

alter table public.epf_kin_clubs
  add column if not exists logo_url text;

create or replace view public.epf_kin_standings as
with team_totals as (
  select
    '2026-2027'::text as saison,
    c.serie,
    c.id as club_id,
    c.nom,
    count(m.id) filter (
      where m.statut = 'finished'
        and m.score_domicile is not null
        and m.score_visiteur is not null
    )::integer as joues,
    count(m.id) filter (
      where m.statut = 'finished'
        and m.score_domicile is not null
        and m.score_visiteur is not null
        and (
          (m.club_domicile_id = c.id and m.score_domicile > m.score_visiteur)
          or (m.club_visiteur_id = c.id and m.score_visiteur > m.score_domicile)
        )
    )::integer as victoires,
    count(m.id) filter (
      where m.statut = 'finished'
        and m.score_domicile is not null
        and m.score_visiteur is not null
        and m.score_domicile = m.score_visiteur
    )::integer as nuls,
    count(m.id) filter (
      where m.statut = 'finished'
        and m.score_domicile is not null
        and m.score_visiteur is not null
        and (
          (m.club_domicile_id = c.id and m.score_domicile < m.score_visiteur)
          or (m.club_visiteur_id = c.id and m.score_visiteur < m.score_domicile)
        )
    )::integer as defaites,
    coalesce(sum(
      case
        when m.club_domicile_id = c.id then m.score_domicile
        when m.club_visiteur_id = c.id then m.score_visiteur
      end
    ) filter (
      where m.statut = 'finished'
        and m.score_domicile is not null
        and m.score_visiteur is not null
    ), 0)::integer as buts_pour,
    coalesce(sum(
      case
        when m.club_domicile_id = c.id then m.score_visiteur
        when m.club_visiteur_id = c.id then m.score_domicile
      end
    ) filter (
      where m.statut = 'finished'
        and m.score_domicile is not null
        and m.score_visiteur is not null
    ), 0)::integer as buts_contre
  from public.epf_kin_clubs c
  left join public.epf_kin_matches m
    on m.saison = '2026-2027'
   and m.serie = c.serie
   and (m.club_domicile_id = c.id or m.club_visiteur_id = c.id)
  group by c.serie, c.id, c.nom
),
with_points as (
  select
    team_totals.*,
    buts_pour - buts_contre as difference_buts,
    victoires * 3 + nuls as points
  from team_totals
)
select
  with_points.saison,
  with_points.serie,
  with_points.club_id,
  with_points.nom,
  with_points.joues,
  with_points.victoires,
  with_points.nuls,
  with_points.defaites,
  with_points.buts_pour,
  with_points.buts_contre,
  with_points.difference_buts,
  with_points.points,
  row_number() over (
    partition by with_points.saison, with_points.serie
    order by with_points.points desc, with_points.difference_buts desc, with_points.buts_pour desc, with_points.nom asc
  )::integer as position,
  c.logo_url
from with_points
join public.epf_kin_clubs c on c.id = with_points.club_id;

create or replace view public.epf_kin_top_scorers as
select
  s.id,
  s.nom,
  s.club_id,
  c.nom as club,
  c.logo_url,
  s.saison,
  c.serie,
  s.matches_joues,
  s.buts,
  s.penaltys
from public.epf_kin_scorers s
join public.epf_kin_clubs c on c.id = s.club_id;

grant select on public.epf_kin_standings, public.epf_kin_top_scorers
  to anon, authenticated;

commit;
