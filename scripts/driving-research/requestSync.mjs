// Operator-only queue; no participant token can request another phone's data.
// Usage: node scripts/driving-research/requestSync.mjs PARTICIPANT_UUID
import {execFileSync} from 'node:child_process';
const [participant]=process.argv.slice(2);
if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(participant||'')) throw Error('Provide an exact participant UUID');
const sql=`select public.request_driving_research_sync('${participant}'::uuid) as request_id`;
const output=execFileSync('npx',['--no-install','supabase@2.118.0','db','query','--linked','--project-ref','vjindchxfebaltbslqwc',sql,'--output','json'],{encoding:'utf8'});
console.log(JSON.stringify({participantId:participant,requestId:JSON.parse(output).rows[0].request_id,status:'queued',delivery:'Next connected native wake/control check; iOS controls background scheduling'}));
