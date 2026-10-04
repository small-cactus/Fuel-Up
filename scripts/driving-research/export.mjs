// Protected research export. Never commit its output; it contains precise routes.
// Usage: node scripts/driving-research/export.mjs PARTICIPANT_UUID /private/tmp/output.jsonl
import {execFileSync} from 'node:child_process';
import {openSync,writeSync,closeSync} from 'node:fs';
import {resolve} from 'node:path';
const [participant,output]=process.argv.slice(2);
if(!/^[0-9a-f-]{36}$/i.test(participant||'')||!output) throw Error('Provide participant UUID and a private output path');
const destination=resolve(output);
if(destination.startsWith(resolve('.')+'/')) throw Error('Export sensitive research data outside the repository');
const fd=openSync(destination,'wx',0o600);let count=0,after='00000000-0000-0000-0000-000000000000';
try {
 for(;;) {
  const sql=`select id,received_at,event from driving_research_events where participant_id='${participant}'::uuid and id>'${after}'::uuid order by id limit 200`;
  const rows=JSON.parse(execFileSync('npx',['--no-install','supabase@2.118.0','db','query','--linked','--project-ref','vjindchxfebaltbslqwc',sql,'--output','json'],{encoding:'utf8',maxBuffer:10*1024*1024,stdio:['ignore','pipe','inherit']})).rows;
  if(!rows.length) break;
  for(const row of rows) {writeSync(fd,JSON.stringify({participantId:participant,receivedAt:row.received_at,...row.event,payload:JSON.parse(row.event.payload)})+'\n');count++}
  after=rows.at(-1).id;
 }
}finally{closeSync(fd)}
console.log(JSON.stringify({events:count,path:destination,order:'event UUID; sort by payload.timestamp for sensor chronology',snapshot:false}));
