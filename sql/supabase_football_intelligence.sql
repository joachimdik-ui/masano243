-- Private ingestion and provenance tables for AI Football Intelligence.
-- Run in Supabase SQL Editor before enabling /api/football-sync.

begin;

create table if not exists public.football_sources (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique,
  name text not null,
  source_type text not null check (
    source_type in ('sports_api', 'official_site', 'media', 'web_search', 'data_archive')
  ),
  base_url text not null,
  trust_tier text not null default 'unclassified'
    check (trust_tier in ('official', 'recognized_media', 'secondary', 'unclassified')),
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.football_sync_logs (
  id uuid primary key default gen_random_uuid(),
  trigger_type text not null check (trigger_type in ('cron', 'manual', 'system')),
  status text not null default 'running'
    check (status in ('running', 'succeeded', 'partial', 'failed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  source_results jsonb not null default '{}'::jsonb,
  items_fetched integer not null default 0 check (items_fetched >= 0),
  items_inserted integer not null default 0 check (items_inserted >= 0),
  error text,
  created_at timestamptz not null default now()
);

create table if not exists public.football_monitoring_targets (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('national_team', 'club', 'competition')),
  target_key text not null unique,
  display_name text not null,
  country_code text,
  age_group text,
  season text,
  provider_key text,
  external_id text,
  enabled boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.football_data_cache (
  cache_key text primary key,
  source_id uuid not null references public.football_sources(id) on delete restrict,
  payload jsonb not null,
  fetched_at timestamptz not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  constraint football_data_cache_expiry_check check (expires_at >= fetched_at)
);

create table if not exists public.football_observations (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.football_sources(id) on delete restrict,
  sync_run_id uuid not null references public.football_sync_logs(id) on delete restrict,
  entity_type text not null check (
    entity_type in ('match', 'standings', 'team', 'competition', 'news', 'head_to_head')
  ),
  entity_key text not null,
  external_id text,
  source_url text not null,
  collected_at timestamptz not null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  constraint football_observations_source_version_unique
    unique (source_id, entity_type, entity_key, content_hash)
);

create table if not exists public.football_data_verifications (
  id uuid primary key default gen_random_uuid(),
  observation_id uuid not null references public.football_observations(id) on delete restrict,
  verification_status text not null default 'pending'
    check (verification_status in ('pending', 'verified', 'conflict', 'stale', 'rejected')),
  method text check (method in ('rules', 'cross_source', 'manual', 'ai_assisted')),
  confidence_score numeric(4, 3)
    check (confidence_score is null or confidence_score between 0 and 1),
  independent_source_count integer not null default 1 check (independent_source_count > 0),
  notes text,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create or replace function public.football_queue_observation_verification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.football_data_verifications (
    observation_id,
    verification_status,
    independent_source_count,
    notes
  ) values (
    new.id,
    'pending',
    1,
    'Observation collectée ; aucune vérification indépendante n''a encore été effectuée.'
  );
  return new;
end;
$$;
revoke all on function public.football_queue_observation_verification()
  from public, anon, authenticated;

drop trigger if exists football_observation_queue_verification
  on public.football_observations;
create trigger football_observation_queue_verification
  after insert on public.football_observations
  for each row execute function public.football_queue_observation_verification();

create index if not exists football_sync_logs_started_at_idx
  on public.football_sync_logs (started_at desc);
create index if not exists football_observations_entity_collected_idx
  on public.football_observations (entity_type, entity_key, collected_at desc);
create index if not exists football_observations_sync_run_idx
  on public.football_observations (sync_run_id);
create index if not exists football_verifications_status_idx
  on public.football_data_verifications (verification_status, created_at desc);
create index if not exists football_monitoring_targets_enabled_idx
  on public.football_monitoring_targets (target_type, enabled);

alter table public.football_sources enable row level security;
alter table public.football_sync_logs enable row level security;
alter table public.football_monitoring_targets enable row level security;
alter table public.football_data_cache enable row level security;
alter table public.football_observations enable row level security;
alter table public.football_data_verifications enable row level security;

revoke all on public.football_sources, public.football_sync_logs,
  public.football_monitoring_targets, public.football_data_cache,
  public.football_observations, public.football_data_verifications
  from public, anon, authenticated;
grant all on public.football_sources, public.football_sync_logs,
  public.football_monitoring_targets, public.football_data_cache,
  public.football_observations, public.football_data_verifications
  to service_role;

commit;
