-- Execute this script in the Supabase SQL Editor.
-- `photos` is retained for compatibility with articles created before photo_1..photo_5.

create table if not exists public.articles (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  titre text not null,
  chapeau text,
  contenu text not null,
  photo_1 text,
  photo_2 text,
  photo_3 text,
  photo_4 text,
  photo_5 text,
  categorie text,
  publie_par text,
  photos jsonb not null default '[]'::jsonb
);

-- Add the requested fields when upgrading an older articles table.
alter table public.articles
  add column if not exists created_at timestamptz default now(),
  add column if not exists titre text,
  add column if not exists chapeau text,
  add column if not exists contenu text,
  add column if not exists photo_1 text,
  add column if not exists photo_2 text,
  add column if not exists photo_3 text,
  add column if not exists photo_4 text,
  add column if not exists photo_5 text,
  add column if not exists categorie text,
  add column if not exists publie_par text,
  add column if not exists photos jsonb not null default '[]'::jsonb;

-- Preserve the common English-column values from the site's previous schema.
update public.articles as article
set
  titre = coalesce(nullif(article.titre, ''), nullif(to_jsonb(article)->>'title', ''), ''),
  chapeau = coalesce(nullif(article.chapeau, ''), nullif(to_jsonb(article)->>'excerpt', ''), nullif(to_jsonb(article)->>'summary', '')),
  contenu = coalesce(nullif(article.contenu, ''), nullif(to_jsonb(article)->>'content', ''), nullif(to_jsonb(article)->>'body', ''), ''),
  categorie = coalesce(article.categorie, to_jsonb(article)->>'category'),
  publie_par = coalesce(article.publie_par, to_jsonb(article)->>'author'),
  photo_1 = coalesce(article.photo_1, to_jsonb(article)->>'image', to_jsonb(article)->>'image_url'),
  photos = coalesce(article.photos, '[]'::jsonb),
  created_at = coalesce(article.created_at, now());

do $$
begin
  if exists (
    select 1
    from public.articles
    where titre is null or btrim(titre) = ''
       or contenu is null or btrim(contenu) = ''
  ) then
    raise exception 'Remplissez titre et contenu pour chaque article existant avant de rendre ces colonnes obligatoires.';
  end if;
end $$;

alter table public.articles
  alter column created_at set default now(),
  alter column created_at set not null,
  alter column titre set not null,
  alter column contenu set not null,
  alter column photos set default '[]'::jsonb,
  alter column photos set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'articles_photos_is_array'
      and conrelid = 'public.articles'::regclass
  ) then
    alter table public.articles
      add constraint articles_photos_is_array
      check (jsonb_typeof(photos) = 'array');
  end if;
end $$;

alter table public.articles enable row level security;

grant select on public.articles to anon, authenticated;
grant insert, update, delete on public.articles to authenticated;

drop policy if exists "Public can read articles" on public.articles;
create policy "Public can read articles"
  on public.articles for select
  to public
  using (true);

drop policy if exists "Authenticated users can create articles" on public.articles;
create policy "Authenticated users can create articles"
  on public.articles for insert
  to authenticated
  with check (true);

drop policy if exists "Authenticated users can update articles" on public.articles;
create policy "Authenticated users can update articles"
  on public.articles for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "Authenticated users can delete articles" on public.articles;
create policy "Authenticated users can delete articles"
  on public.articles for delete
  to authenticated
  using (true);
