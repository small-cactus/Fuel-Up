-- Operator-only, one APNs attempt per durable sync request. Unknown transport
-- outcomes remain claimed; retrying the CLI cannot duplicate a push.
alter table public.driving_research_sync_requests
  add column push_status text not null default 'pending' check(push_status in ('pending','sending','accepted','rejected','unknown')),
  add column push_reason text,
  add column push_attempted_at timestamptz;

create function public.prepare_driving_research_sync_push(p_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare request_id uuid; request public.driving_research_sync_requests; device public.driving_research_push_devices;
begin
  request_id:=public.request_driving_research_sync(p_id);
  select * into request from public.driving_research_sync_requests where id=request_id for update;
  if request.push_status<>'pending' then
    return jsonb_build_object('claimed',false,'requestId',request_id,'pushStatus',request.push_status);
  end if;
  select * into device from public.driving_research_push_devices where participant_id=p_id;
  if not found then
    return jsonb_build_object('claimed',false,'requestId',request_id,'pushStatus','no_device');
  end if;
  -- Bound background wake frequency even when previous requests finish quickly.
  if exists(select 1 from public.driving_research_sync_requests where participant_id=p_id
    and push_attempted_at>now()-interval '30 minutes') then
    return jsonb_build_object('claimed',false,'requestId',request_id,'pushStatus','throttled');
  end if;
  update public.driving_research_sync_requests set push_status='sending',push_attempted_at=now() where id=request_id;
  return jsonb_build_object('claimed',true,'requestId',request_id,'deviceToken',device.device_token,
    'environment',device.environment,'expiresAt',extract(epoch from now()+interval '1 hour'));
end $$;
revoke all on function public.prepare_driving_research_sync_push(uuid) from public,anon,authenticated;
grant execute on function public.prepare_driving_research_sync_push(uuid) to service_role;
