// Protected operator export. Never write participant dossiers into the repository.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const args=process.argv.slice(2),out=args[args.indexOf('--out')+1];
if(!args.includes('--out') || !out) throw Error('Use --out /absolute/private/directory');
const directory=path.resolve(out),root=fs.realpathSync(process.cwd());
fs.mkdirSync(directory,{recursive:true,mode:0o700});
const real=fs.realpathSync(directory);
if(real===root || real.startsWith(root+path.sep)) throw Error('Dossiers must stay outside the repository');
const query=sql=>JSON.parse(execFileSync('npx',['--no-install','supabase@2.118.0','db','query','--linked','--project-ref','vjindchxfebaltbslqwc',sql,'--output','json'],{encoding:'utf8',maxBuffer:64*1024*1024})).rows;
const profiles=query('select id,first_received_at,last_received_at,profile,highest_onboarding_step,onboarding_completed,event_count from app_installations order by first_received_at');
let count=0;
for(const profile of profiles) {
 if(!/^[0-9a-f-]{36}$/i.test(profile.id)) throw Error('Invalid installation ID');
 const timeline=[];
 let cursor=null;
 for(;;) {
  const after=cursor ? `and (occurred_at,id) > ('${cursor.occurred_at}'::timestamptz,'${cursor.id}'::uuid)` : '';
  const batch=query(`select id,kind,occurred_at,received_at,payload from app_installation_events where installation_id='${profile.id}' ${after} order by occurred_at,id limit 1000`);
  timeline.push(...batch);if(batch.length<1000) break;cursor=batch.at(-1);
 }
 fs.writeFileSync(path.join(real,profile.id+'.json'),JSON.stringify({exportedAt:new Date().toISOString(),installation:profile,timeline},null,2),{mode:0o600});count++;
}
console.log(JSON.stringify({exportedInstallations:count,directory:real}));
