-- Run in a transaction after the migration; roll back all fixture writes.

do $$
declare p uuid:='f1111111-1111-4111-8111-111111111111'; h text:=repeat('a',64); e jsonb; n integer;
begin
 if has_function_privilege('anon','public.ingest_driving_research(uuid,text,jsonb)','execute') or has_table_privilege('anon','public.driving_research_events','select') then raise exception 'Public research access'; end if;
 if not enroll_driving_research(p,h) then raise exception 'Enrollment failed'; end if;
 if enroll_driving_research(p,repeat('b',64)) then raise exception 'Identity takeover'; end if;
 e:=jsonb_build_array(jsonb_build_object('id','f2222222-2222-4222-8222-222222222222','kind','diagnostic','recordedAt',extract(epoch from now()),'payload','{"test":true}'));
 n:=ingest_driving_research(p,h,e); n:=ingest_driving_research(p,h,e);
 if (select count(*) from driving_research_events where participant_id=p)!=1 then raise exception 'Duplicate event'; end if;
 begin
 perform ingest_driving_research(p,h,jsonb_set(e,'{0,payload}','"changed"'::jsonb));
 raise exception 'Conflict accepted';
 exception when others then if SQLERRM='Conflict accepted' then raise; end if; end;
 if access_driving_research(p,repeat('c',64)) then raise exception 'Bad token accepted'; end if;
 if not delete_driving_research(p,h) then raise exception 'Delete failed'; end if;
 if exists(select 1 from driving_research_events where participant_id=p) or access_driving_research(p,h) then raise exception 'Revocation failed'; end if;
end $$;
