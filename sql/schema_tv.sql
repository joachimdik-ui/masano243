-- Masano TV : directs (OBS / clé RTMP), recaps, résumés de matchs et émissions.
-- À exécuter une fois dans le SQL Editor de Supabase.
-- Prérequis : la fonction public.is_admin() utilisée par l'espace admin.
-- Déploiement Vercel : SUPABASE_URL, SUPABASE_ANON_KEY,
-- CLOUDFLARE_ACCOUNT_ID et CLOUDFLARE_STREAM_API_TOKEN (permission Stream Write).

create table if not exists public.tv_contenus (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('direct', 'recap', 'resume', 'emission')),
  titre text not null,
  description text,
  emission_nom text,
  sport text,
  competition text,
  statut text not null default 'termine' check (statut in ('programme', 'en_direct', 'termine')),
  debut timestamptz,
  fin timestamptz,
  video_url text,        -- Google Drive, YouTube, MP4, HLS… (recaps, résumés, émissions, direct externe)
  miniature_url text,
  live_input_id text,    -- identifiant du direct chez Cloudflare Stream (clé OBS)
  hls_url text,          -- lecture du direct (HLS)
  replay_url text,       -- enregistrement automatique du direct (HLS)
  match_id text,         -- match lié (matchs ou epf_kin_matches)
  publie boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tv_contenus_liste_idx
  on public.tv_contenus (type, publie, debut desc nulls last);
create index if not exists tv_contenus_direct_idx
  on public.tv_contenus (statut) where type = 'direct';

create or replace function public.tv_contenus_set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.tv_contenus_set_updated_at() from public, anon, authenticated;

drop trigger if exists tv_contenus_set_updated_at on public.tv_contenus;
create trigger tv_contenus_set_updated_at
  before update on public.tv_contenus
  for each row execute function public.tv_contenus_set_updated_at();

alter table public.tv_contenus enable row level security;

grant select on public.tv_contenus to anon, authenticated;
grant insert, update, delete on public.tv_contenus to authenticated;

-- Le public ne voit que les contenus publiés. La clé OBS n'est JAMAIS stockée ici :
-- elle est lue chez Cloudflare par la fonction serveur /api/tv-admin (réservée aux admins).
drop policy if exists "Public can read published tv" on public.tv_contenus;
create policy "Public can read published tv"
  on public.tv_contenus for select to anon, authenticated using (publie = true);

drop policy if exists "Admins manage tv" on public.tv_contenus;
create policy "Admins manage tv"
  on public.tv_contenus for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Temps réel : le site bascule en direct dès que le statut change.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tv_contenus'
     ) then
    alter publication supabase_realtime add table public.tv_contenus;
  end if;
end;
$$;