alter table public.historical_matches enable row level security;

grant select on public.historical_matches to anon, authenticated;

drop policy if exists "Public can read historical matches" on public.historical_matches;
create policy "Public can read historical matches"
  on public.historical_matches for select to anon, authenticated using (true);
