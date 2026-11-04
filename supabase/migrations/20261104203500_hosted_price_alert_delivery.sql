-- The hosted sender shares claims with the local APNs sender. Both use the
-- same cooldown and duplicate guard. Only the service role can call either RPC.
create function public.claim_hosted_price_alert() returns jsonb
language sql security definer set search_path='' as $$ select fuel_app_private.claim_price_alert() $$;
create function public.finish_hosted_price_alert(p_id uuid,p_status text,p_reason text) returns void
language sql security definer set search_path='' as $$
 update fuel_app_private.price_alert_deliveries set status=p_status,reason=nullif(left(p_reason,80),'')
 where id=p_id and status='sending' and p_status in('accepted','rejected','unknown')
$$;
revoke all on function public.claim_hosted_price_alert(), public.finish_hosted_price_alert(uuid,text,text) from public,anon,authenticated;
grant execute on function public.claim_hosted_price_alert(), public.finish_hosted_price_alert(uuid,text,text) to service_role;

create function fuel_app_private.dispatch_hosted_price_alerts() returns void language plpgsql set search_path='' as $$
declare runner_secret text;
begin
 if not exists(select from fuel_app_private.price_watches where refreshed_at>now()-interval '7 days') then return; end if;
 select decrypted_secret into runner_secret from vault.decrypted_secrets where name='fuel_price_alert_runner';
 if runner_secret is null then return; end if;
 perform net.http_post(url:='https://vjindchxfebaltbslqwc.supabase.co/functions/v1/fuel-price-alerts',
  headers:=jsonb_build_object('Content-Type','application/json','x-price-runner',runner_secret),
  body:='{}'::jsonb,timeout_milliseconds:=55000);
end $$;
revoke all on function fuel_app_private.dispatch_hosted_price_alerts() from public,anon,authenticated,service_role;
select cron.schedule('fuel-price-alert-delivery','9,29,49 * * * *','select fuel_app_private.dispatch_hosted_price_alerts()');
