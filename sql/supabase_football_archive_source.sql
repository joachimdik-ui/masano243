-- Allow the private football-data JSON archive as an ingestion source.
-- Run in Supabase SQL Editor before deploying the archive sync integration.

begin;

alter table public.football_sources
  drop constraint if exists football_sources_source_type_check;
alter table public.football_sources
  add constraint football_sources_source_type_check
  check (source_type in (
    'sports_api',
    'official_site',
    'media',
    'web_search',
    'data_archive'
  ));

alter table public.football_observations
  drop constraint if exists football_observations_entity_type_check;
alter table public.football_observations
  add constraint football_observations_entity_type_check
  check (entity_type in (
    'match',
    'standings',
    'team',
    'competition',
    'news',
    'head_to_head'
  ));

commit;
