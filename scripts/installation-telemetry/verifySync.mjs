import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const migration=process.argv.includes('--with-migration') ? fs.readFileSync('supabase/migrations/20261012203000_installation_silent_sync.sql','utf8') : '';
const assertions=`
do $$ declare i uuid:=gen_random_uuid(); j uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); c jsonb; d jsonb; address text:=replace(gen_random_uuid()::text,'-',''); begin
 perform register_installation_push(i,repeat('1',64),address,'sandbox');
 assert (select event_count=0 from app_installations where id=i);
 begin perform register_installation_push(i,repeat('2',64),address,'sandbox');raise exception 'wrong credential accepted';
 exception when others then if SQLERRM<>'unauthorized' then raise; end if; end;
 insert into app_installations(id,token_hash) values(j,repeat('2',64));
 c:=prepare_installation_sync_push(j);assert c->>'pushStatus'='no_device';
 c:=prepare_installation_sync_push(i);assert (c->>'claimed')::boolean;
 d:=prepare_installation_sync_push(i);assert not (d->>'claimed')::boolean;assert c->>'requestId'=d->>'requestId';
 d:=complete_installation_sync(i,repeat('1',64),(c->>'requestId')::uuid);assert not (d->>'completed')::boolean;
 d:=installation_sync_control(j,repeat('2',64),(c->>'requestId')::uuid);assert d->>'requestId' is null;
 d:=complete_installation_sync(j,repeat('2',64),(c->>'requestId')::uuid);assert not (d->>'completed')::boolean;
 begin perform installation_sync_control(i,repeat('2',64),null);raise exception 'wrong credential accepted';
 exception when others then if SQLERRM<>'unauthorized' then raise; end if; end;
 d:=installation_sync_control(i,repeat('1',64),null);assert d->>'requestId'=c->>'requestId';
 d:=complete_installation_sync(i,repeat('1',64),(c->>'requestId')::uuid);assert (d->>'completed')::boolean;
 d:=complete_installation_sync(i,repeat('1',64),(c->>'requestId')::uuid);assert (d->>'completed')::boolean;
 d:=prepare_installation_sync_push(i);assert d->>'pushStatus'='throttled';
 -- A research identity sharing the same APNs device must respect usage cooldown.
 insert into driving_research_participants(id,token_hash,consent_version) values(p,'synthetic',1);
 insert into driving_research_push_devices(participant_id,device_token,environment) values(p,address,'sandbox');
 d:=prepare_driving_research_sync_push(p);assert d->>'pushStatus'='throttled';
 update app_installation_sync_requests set push_attempted_at=now()-interval '31 minutes' where installation_id=i;
 d:=prepare_driving_research_sync_push(p);assert (d->>'claimed')::boolean;
 d:=prepare_installation_sync_push(i);assert d->>'pushStatus'='throttled';
 -- Research revocation does not block usage transport or re-enroll research.
 update driving_research_participants set revoked_at=now() where id=p;
 begin perform prepare_driving_research_sync_push(p);raise exception 'revoked allowed';
 exception when others then if SQLERRM<>'Participant not enrolled' then raise; end if; end;
 update driving_research_sync_requests set push_attempted_at=now()-interval '31 minutes' where participant_id=p;
 d:=prepare_installation_sync_push(i);assert (d->>'claimed')::boolean;
 assert (select revoked_at is not null from driving_research_participants where id=p);
 perform register_installation_push(i,repeat('1',64),address||'aa','sandbox');
 assert (select device_token=address||'aa' from app_installation_push_devices where installation_id=i);
 assert not has_function_privilege('anon','public.prepare_installation_sync_push(uuid)','execute');
 assert not has_function_privilege('service_role','public.prepare_installation_sync_push(uuid)','execute');
 assert not has_function_privilege('authenticated','public.register_installation_push(uuid,text,text,text)','execute');
 assert not has_table_privilege('anon','public.app_installation_push_devices','select');
 assert not has_table_privilege('service_role','public.app_installation_push_devices','select');
end $$;`;
execFileSync('npx',['--no-install','supabase@2.118.0','db','query','--linked','--project-ref','vjindchxfebaltbslqwc','begin;\n'+migration+'\n'+assertions+'\nrollback;','--output','json'],{stdio:'inherit'});
console.log('PASS: rollback-only registration, credential and command isolation, completion, rotation, research consent, shared cooldown in both directions and access control');
