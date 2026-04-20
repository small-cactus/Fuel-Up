alter table public.push_tokens
add column if not exists environment text;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'push_tokens_environment_check'
    ) then
        alter table public.push_tokens
        add constraint push_tokens_environment_check
        check (environment in ('sandbox', 'production'));
    end if;
end
$$;

comment on column public.push_tokens.environment is
'APNs environment for this raw device token. Null means not reconciled yet.';
