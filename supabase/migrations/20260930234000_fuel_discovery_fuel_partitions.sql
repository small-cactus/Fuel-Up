create or replace function public.enqueue_fuel_discovery(p_key text,p_descriptor jsonb) returns bigint
language plpgsql security definer set search_path=public,pg_temp as $$
declare states text[]; target text; inserted bigint;
begin
  if p_descriptor->>'kind'='states' then
    select array_agg(s) into states from jsonb_array_elements_text(p_descriptor->'states') s;
    if cardinality(states) not between 1 and 4 then raise exception 'Invalid state batch'; end if;
  elsif p_descriptor->>'kind' in ('brands','fuels','nearby') then states:=array[p_descriptor->>'state'];
  else raise exception 'Invalid discovery task'; end if;
  if exists(select 1 from unnest(states) s where not exists(select 1 from fuel_national_state_routes r where r.state_code=s))
    or (select count(distinct execution_region) from fuel_national_state_routes where state_code=any(states))<>1 then raise exception 'Invalid or mixed region'; end if;
  select execution_region into target from fuel_national_state_routes where state_code=states[1];
  insert into fuel_discovery_jobs(task_key,descriptor,execution_region) values(p_key,p_descriptor,target)
    on conflict(task_key) do nothing returning id into inserted;
  if inserted is null then
    select id into inserted from fuel_discovery_jobs where task_key=p_key and descriptor=p_descriptor;
    if inserted is null then raise exception 'Task identity conflict'; end if;
  end if;
  return inserted;
end $$;
