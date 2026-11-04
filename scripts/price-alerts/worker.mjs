// This operator process uses the existing local APNs signer. Never log addresses.
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {loadCredentials, providerToken, sendPush} from '../driving-research/apns.mjs';

import {applePriceAlert,deliverWithRetry} from '../../supabase/functions/_shared/priceAlertPayload.mjs';

export function alertRequest(claim, credentials, jwt=providerToken(credentials)) {
    const {host,path,headers,payload}=applePriceAlert(claim);
    return {host,payload,headers:{...headers,':method':'POST',':path':path,authorization:'bearer '+jwt}};
}

function query(sql) {
    const args=['db','query','--linked','--project-ref','vjindchxfebaltbslqwc',sql,'--output','json'];
    const raw=execFileSync(process.env.FUEL_ALERT_SUPABASE_CLI || 'supabase',args,
        {encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:30000});
    const response=JSON.parse(raw);
    return Array.isArray(response) ? response : response.rows;
}

async function run() {
    const credentials=loadCredentials();
    const jwt=providerToken(credentials);
    let attempts=0;
    while(attempts<40) {
        const claim=query('select fuel_app_private.claim_price_alert() as claim')[0].claim;
        if (!claim) break;
        const request=alertRequest(claim,credentials,jwt);
        const result=await deliverWithRetry(()=>sendPush(request),claim.expiresAt);
        const reason=/^[A-Za-z0-9]+$/.test(result.reason || '') ? "'"+result.reason+"'" : 'null';
        if(!['accepted','unknown','rejected'].includes(result.status)) throw Error('Invalid result');
        query(`update fuel_app_private.price_alert_deliveries set status='${result.status}',reason=${reason} where id='${claim.id}' and status='sending'`);
        attempts++;
    }
    console.log(JSON.stringify({checkedAt:new Date().toISOString(),attempts}));
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
    run().catch(()=>{console.error('Price alert worker failed. Check database access and APNs configuration.');process.exitCode=1});
}
