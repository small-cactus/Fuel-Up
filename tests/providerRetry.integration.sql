begin;
delete from fuel_national_events where code in ('UPSTREAM_HTTP_429','DISCOVERY_UPSTREAM_HTTP_429');
do $$ begin
 if fuel_provider_retry_seconds('UPSTREAM_HTTP_429',60)<>60 then raise exception 'Provider 60-second interval not honored'; end if;
 if fuel_provider_retry_seconds('UPSTREAM_HTTP_429',0)<>60 then raise exception 'Missing header fallback is not 60'; end if;
 insert into fuel_national_events(code,created_at) values('UPSTREAM_HTTP_429',now());
 if fuel_provider_retry_seconds('UPSTREAM_HTTP_429',0)<>120 then raise exception 'Repeated denial does not back off'; end if;
 if fuel_provider_retry_seconds('UPSTREAM_HTTP_429',7200)<>7200 then raise exception 'Retry-After shortened'; end if;
end $$;

rollback;