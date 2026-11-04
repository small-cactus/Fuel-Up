-- Keep the released RPC signature. Only its narrow, read-only implementation
-- needs elevated access to the station inventory.
create schema fuel_app_private;
revoke all on schema fuel_app_private from public;
grant usage on schema fuel_app_private to anon, authenticated, service_role;

alter function public.fuel_memberships_for_state(text) set schema fuel_app_private;
create function public.fuel_memberships_for_state(p_state text) returns jsonb
language sql stable security invoker set search_path = ''
as $$ select fuel_app_private.fuel_memberships_for_state(p_state) $$;
revoke all on function public.fuel_memberships_for_state(text) from public;
grant execute on function public.fuel_memberships_for_state(text) to anon, authenticated, service_role;

alter function public.e85_brand_key(text) set search_path = pg_catalog, pg_temp;

-- Older installations may still have the original token-only schema.
alter table public.push_tokens add column if not exists environment text;
do $$
begin
  if not exists (select from pg_constraint where conrelid = 'public.push_tokens'::regclass
                 and conname = 'push_tokens_environment_check') then
    alter table public.push_tokens add constraint push_tokens_environment_check
      check (environment in ('sandbox', 'production'));
  end if;
end $$;

-- Shipped clients POST ...?on_conflict=token with return=minimal. Accept that
-- exact write without giving the caller visibility into the conflicting row.
create function fuel_app_private.register_push_token() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.push_tokens as saved (token, environment)
    values (new.token, new.environment)
    on conflict (token) do update set environment = excluded.environment
      where excluded.environment is not null
        and saved.environment is distinct from excluded.environment;
  return null;
end $$;
revoke all on function fuel_app_private.register_push_token() from public, anon, authenticated;

create trigger register_client_push_token before insert on public.push_tokens
  for each row when (current_user in ('anon', 'authenticated'))
  execute function fuel_app_private.register_push_token();

alter table public.push_tokens enable row level security;
revoke all on table public.push_tokens from public, anon, authenticated;
-- Column grants enable the legacy UPSERT syntax and HEAD probe. No client
-- row is selectable or directly updatable. Service-role sending bypasses RLS.
grant select (token, environment), insert (token, environment), update (token, environment)
  on public.push_tokens to anon, authenticated;
create policy push_token_client_read on public.push_tokens
  for select to anon, authenticated using (false);

notify pgrst, 'reload schema';
