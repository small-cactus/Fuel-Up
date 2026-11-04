import {createClient} from 'npm:@supabase/supabase-js@2.98.0';
import {applePriceAlert,deliverWithRetry} from '../_shared/priceAlertPayload.mjs';
import {signAppleToken} from '../_shared/appleProviderToken.mjs';

const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  {auth:{persistSession:false,autoRefreshToken:false}});
let cachedToken='', signedAt=0;
Deno.serve(async req=>{
  const key=Deno.env.get('FUEL_PRICE_RUNNER_SECRET');
  if(req.method!=='POST' || !key || req.headers.get('x-price-runner')!==key) return new Response(null,{status:401});
  try {
    const now=Math.floor(Date.now()/1000);
    if(!cachedToken || now-signedAt>=2400) {
      cachedToken=await signAppleToken(Deno.env.get('FUEL_PRICE_APNS_KEY_ID'),Deno.env.get('FUEL_PRICE_APNS_TEAM_ID'),Deno.env.get('FUEL_PRICE_APNS_PKCS8'),now);
      signedAt=now;
    }
    let attempted=0;
    for(;attempted<20;attempted++) {
      const {data:claim,error}=await db.rpc('claim_hosted_price_alert');
      if(error) throw Error('Claim failed');
      if(!claim) break;
      const {host,path,headers,payload}=applePriceAlert(claim);
      const {status,reason}=await deliverWithRetry(async ()=>{
        try {
          const reply=await fetch(host+path,{method:'POST',headers:{...headers,authorization:'bearer '+cachedToken},
            body:payload,signal:AbortSignal.timeout(8000),redirect:'error'});
          if(reply.status===200) return {status:'accepted',reason:''};
          const details=await reply.json().catch(()=>({}));
          return {status:'rejected',reason:String(details.reason || 'HTTP'+reply.status).slice(0,80)};
        } catch { return {status:'unknown',reason:'TransportError'}; }
      },claim.expiresAt);
      const saved=await db.rpc('finish_hosted_price_alert',{p_id:claim.id,p_status:status,p_reason:reason});
      if(saved.error) throw Error('Result update failed');
      if(status!=='accepted') break;
    }
    return Response.json({attempted});
  } catch { return Response.json({error:'delivery_unavailable'},{status:503}); }
});
