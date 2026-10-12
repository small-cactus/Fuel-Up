const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const installationKinds = new Set(['app_launch','app_foreground','app_background','screen_view','screen_exit','screen_heartbeat',
    'onboarding_step','onboarding_action','onboarding_complete','onboarding_error','permission_request','permission_snapshot',
    'research_consent','ui_action','preferences_changed']);
const profileKeys = new Set(['schemaVersion','deviceModel','osVersion','appVersion','build','screenWidthPoints','screenHeightPoints',
    'screenWidthPixels','screenHeightPixels','scale','nativeScale','idiom','contentSizeCategory','locale','timeZone','firstOpenedAt',
    'isSimulator','telemetryVersion','releaseChannel']);
// No coordinate/search text/contact/advertising identifiers in installation analytics.
const payloadKeys = new Set(['schemaVersion','sessionId','screenSegmentId','build','screen','previousScreen','durationSeconds','durationIsObserved','observedAt',
    'step','previousStep','action','phase','permission','status','previousStatus','location','precise','motion','notifications',
    'alertSetting','soundSetting','backgroundRefresh','locationServicesEnabled','researchEnabled','researchConsented',
    'stationId','fuelGrade','displayedRank','surface','gesture','skippedPreferences','errorCode','radiusMiles','requiresE85',
    'selectedBrandCount','membershipCount','clientOccurredAt','reason','lowPowerMode','thermalState']);
export function validateInstallationBatch(body, now=Date.now()/1000) {
    if (!body || !uuid.test(body.installationId || '') || !Array.isArray(body.events) || body.events.length<1 || body.events.length>50) throw Error('invalid_batch');
    const clean = (value, keys) => {
        if (!value || Array.isArray(value) || typeof value !== 'object') throw Error('invalid_object');
        const out={};
        for (const [key,item] of Object.entries(value)) {
            if (!keys.has(key)) throw Error('unsupported_field');
            if (!(item===null || typeof item==='boolean' || typeof item==='string' && item.length<=240 || typeof item==='number' && Number.isFinite(item))) throw Error('invalid_value');
            out[key]=item;
        }
        return out;
    };
    const profile=clean(body.profile,profileKeys), seen=new Set();
    const events=body.events.map(event=>{
        if (!uuid.test(event.id || '') || seen.has(event.id) || !installationKinds.has(event.kind) || !Number.isFinite(event.recordedAt) || event.recordedAt<0 || event.recordedAt>now+300) throw Error('invalid_event');
        seen.add(event.id);
        const payload=clean(typeof event.payload==='string' ? JSON.parse(event.payload) : event.payload,payloadKeys);
        if (JSON.stringify(payload).length>4096) throw Error('event_too_large');
        return {id:event.id,kind:event.kind,recordedAt:event.recordedAt,payload};
    });
    return {installationId:body.installationId,profile,events};
}
export function createInstallationTelemetryHandler({db}) {
    return async request=>{
        const response=(status,value)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
        if(request.method!=='POST') return response(405,{error:'method_not_allowed'});
        const token=request.headers.get('x-installation-token') || '';
        if(!/^[0-9a-f]{64}$/.test(token)) return response(401,{error:'unauthorized'});
        try {
            const text=await request.text(); if(text.length>250000) return response(413,{error:'batch_too_large'});
            let batch; try {batch=validateInstallationBatch(JSON.parse(text));} catch {return response(400,{error:'invalid_batch'});}
            const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
            const hash=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
            const {data,error}=await db.rpc('ingest_installation_telemetry',{p_id:batch.installationId,p_hash:hash,p_profile:batch.profile,p_events:batch.events});
            if(error) return response(error.message?.includes('unauthorized')?401:error.message?.includes('rate_limited')?429:503,{error:'upload_unavailable'});
            return response(200,data);
        } catch {return response(503,{error:'upload_unavailable'});}
    };
}
