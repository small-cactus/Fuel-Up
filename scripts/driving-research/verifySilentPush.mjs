import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
// --with-migration validates the migration and behavior in a rollback transaction.
const migration=process.argv.includes('--with-migration') ? fs.readFileSync('supabase/migrations/20261012170000_driving_research_silent_push.sql','utf8') : '';
const assertions=`
do $$ declare p uuid:=gen_random_uuid(); first_claim jsonb; second_claim jsonb; begin
 insert into driving_research_participants(id,token_hash,consent_version) values(p,'synthetic',1);
 first_claim:=prepare_driving_research_sync_push(p);
 assert first_claim->>'pushStatus'='no_device';
 insert into driving_research_push_devices(participant_id,device_token,environment) values(p,repeat('a',64),'sandbox');
 first_claim:=prepare_driving_research_sync_push(p);
 assert (first_claim->>'claimed')::boolean;
 second_claim:=prepare_driving_research_sync_push(p);
 assert not (second_claim->>'claimed')::boolean;
 assert second_claim->>'requestId'=first_claim->>'requestId';
 update driving_research_sync_requests set completed_at=now() where participant_id=p;
 second_claim:=prepare_driving_research_sync_push(p);
 assert second_claim->>'pushStatus'='throttled';
 assert not has_function_privilege('anon','public.prepare_driving_research_sync_push(uuid)','execute');
 assert not has_function_privilege('authenticated','public.prepare_driving_research_sync_push(uuid)','execute');
 update driving_research_participants set revoked_at=now() where id=p;
 begin perform prepare_driving_research_sync_push(p); raise exception 'revoked was allowed';
 exception when others then if SQLERRM<>'Participant not enrolled' then raise; end if; end;
end $$;`;
const sql='begin;\n'+migration+'\n'+assertions+'\nrollback;';
execFileSync('npx',['--no-install','supabase@2.118.0','db','query','--linked','--project-ref','vjindchxfebaltbslqwc',sql,'--output','json'],{stdio:'inherit'});
console.log('PASS: rolled-back migration, no-device, duplicate claim, throttle, access control, revocation');
