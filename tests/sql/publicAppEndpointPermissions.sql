-- Run as postgres inside a transaction and roll back. Fixtures never leave
-- the transaction. The registered token is synthetic and cannot receive pushes.
select set_config('test.push_token', 'test-registration-' || gen_random_uuid(), true);

set local role anon;
insert into public.push_tokens (token) values (current_setting('test.push_token'))
  on conflict (token) do update set token = excluded.token;
insert into public.push_tokens (token,environment) values (current_setting('test.push_token'),'sandbox')
  on conflict (token) do update set token=excluded.token, environment=excluded.environment;
do $$
begin
  if exists(select token from public.push_tokens) then raise exception 'Anonymous read leaked tokens'; end if;
  update public.push_tokens set environment='production' where token=current_setting('test.push_token');
  if found then raise exception 'Direct token update allowed'; end if;
  if has_table_privilege(current_user,'public.push_tokens','delete')
     or has_table_privilege(current_user,'public.push_tokens','truncate')
     or has_table_privilege(current_user,'public.fuel_station_latest','select') then
    raise exception 'Unexpected client privilege';
  end if;
end $$;
reset role;

set local role service_role;
do $$
begin
  if (select environment from public.push_tokens where token=current_setting('test.push_token'))
      is distinct from 'sandbox' then raise exception 'Anonymous registration failed'; end if;
end $$;
reset role;

set local role authenticated;
insert into public.push_tokens (token) values (current_setting('test.push_token'))
  on conflict (token) do update set token=excluded.token;
do $$
begin
  if exists(select token from public.push_tokens) then raise exception 'Signed-in read leaked tokens'; end if;
  if has_table_privilege(current_user,'public.push_tokens','delete')
     or has_table_privilege(current_user,'public.push_tokens','truncate') then
    raise exception 'Unexpected signed-in privilege';
  end if;
end $$;
reset role;
set local role service_role;
do $$
begin
  if (select environment from public.push_tokens where token=current_setting('test.push_token'))
     is distinct from 'sandbox' then raise exception 'Token-only retry lost environment'; end if;
  update public.push_tokens set environment='production' where token=current_setting('test.push_token');
  if not found then raise exception 'Sender cannot reconcile environment'; end if;
end $$;
reset role;
