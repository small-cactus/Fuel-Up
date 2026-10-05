// Operator-only participant IDs, count reports and outstanding sync requests.
import {execFileSync} from 'node:child_process';
const sql=`select p.id as participant_id,c.local_total,c.pending,c.reported_at,
 (select count(*) from driving_research_events e where e.participant_id=p.id) as server_records,
 r.id as sync_request_id,r.requested_at
 from driving_research_participants p left join driving_research_device_counts c on c.participant_id=p.id
 left join driving_research_sync_requests r on r.participant_id=p.id and r.completed_at is null
 where p.revoked_at is null order by p.enrolled_at`;
const output=execFileSync('npx',['--no-install','supabase@2.118.0','db','query','--linked','--project-ref','vjindchxfebaltbslqwc',sql,'--output','json'],{encoding:'utf8'});
console.log(JSON.stringify(JSON.parse(output).rows,null,2));
