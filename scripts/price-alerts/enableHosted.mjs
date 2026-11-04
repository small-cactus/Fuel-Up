// Copies the selected Apple signing credential into this project's Edge secrets.
// Run only with authorization for the chosen key and destination. Never logs keys.
import {execFileSync} from 'node:child_process';
import {createPrivateKey,randomBytes} from 'node:crypto';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {join} from 'node:path';

if (!process.argv.includes('--enable-hosted')) throw Error('Specify --enable-hosted to configure the hosted APNs sender.');
const ref='vjindchxfebaltbslqwc';
const config=JSON.parse(readFileSync(process.env.FUELUP_APNS_CONFIG || join(homedir(),'.config/fuelup/apns.json'),'utf8'));
if (![config.keyId,config.teamId].every(id=>/^[A-Z0-9]{10}$/.test(id))) throw Error('Invalid signing configuration');
const pkcs8=createPrivateKey(readFileSync(config.keyPath)).export({type:'pkcs8',format:'der'}).toString('base64');
const secret=randomBytes(32).toString('hex');
const dir=mkdtempSync(join(tmpdir(),'fuel-price-host-'));
const cli=(...args)=>execFileSync('npx',['--no-install','supabase@2.118.0',...args,'--project-ref',ref],{stdio:'ignore'});
try {
    const envFile=join(dir,'env'),sql=join(dir,'setup.sql');
    writeFileSync(envFile,`FUEL_PRICE_RUNNER_SECRET=${secret}\nFUEL_PRICE_APNS_KEY_ID=${config.keyId}\nFUEL_PRICE_APNS_TEAM_ID=${config.teamId}\nFUEL_PRICE_APNS_PKCS8=${pkcs8}\n`,{mode:0o600});
    cli('secrets','set','--env-file',envFile);
    const response=await fetch(`https://${ref}.supabase.co/functions/v1/fuel-price-alerts`,{method:'POST',
        headers:{'x-price-runner':secret,'content-type':'application/json'},body:'{}',redirect:'error',signal:AbortSignal.timeout(60000)});
    if(!response.ok) throw Error('Hosted sender preflight failed with HTTP '+response.status);
    writeFileSync(sql,`do $$ declare k uuid; begin
      select id into k from vault.secrets where name='fuel_price_alert_runner';
      if k is null then perform vault.create_secret('${secret}','fuel_price_alert_runner');
      else perform vault.update_secret(k,'${secret}'); end if; end $$;`,{mode:0o600});
    cli('db','query','--linked','-f',sql);
    console.log('Hosted sender configured and checked.');
} finally {rmSync(dir,{recursive:true,force:true});}
