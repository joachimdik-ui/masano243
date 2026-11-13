-- Monthly request guard for the Tavily search integration, including keyless requests.
-- Run in Supabase SQL Editor before enabling /api/football-sync research.

begin;

create table if not exists public.football_search_usage (
  period_month date primary key,
  credits_reserved integer not null default 0 check (credits_reserved >= 0),
  updated_at timestamptz not null default now(),
  constraint football_search_usage_month_start_check
    check (extract(day from period_month) = 1)
);

alter table public.football_search_usage enable row level security;
revoke all on public.football_search_usage from public, anon, authenticated;
grant all on public.football_search_usage to service_role;

create or replace function public.reserve_football_search_credit(
  p_period_month date,
  p_monthly_limit integer
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  reserved_credits integer;
begin
  if p_period_month <> date_trunc('month', now() at time zone 'UTC')::date
     or p_monthly_limit < 1
     or p_monthly_limit > 500 then
    raise exception 'Invalid football search credit reservation.';
  end if;

  insert into public.football_search_usage (period_month, credits_reserved)
  values (p_period_month, 1)
  on conflict (period_month) do update
    set credits_reserved = public.football_search_usage.credits_reserved + 1,
        updated_at = now()
    where public.football_search_usage.credits_reserved < p_monthly_limit
  returning credits_reserved into reserved_credits;

  return reserved_credits is not null;
end;
$$;

revoke all on function public.reserve_football_search_credit(date, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_football_search_credit(date, integer)
  to service_role;

commit;
