import {validateDrivingCrossCheck} from './drivingResearchCrossChecks.mjs';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const kinds = new Set(['consent','lifecycle','permission','location','motion','geofence','station_catalog','visit_observation','visit_candidate','visit_departure','visit_gap','visit_prompt','visit_label','visit_pedometer','system_visit','diagnostic']);
export function validateDrivingEvents(events, now = Date.now()/1000) {
  if (!Array.isArray(events) || !events.length || events.length > 1000) throw Error('INVALID_BATCH');
  const ids = new Set();
  for (const e of events) {
    if (!uuid.test(e.id) || ids.has(e.id) || !kinds.has(e.kind) || !Number.isFinite(e.recordedAt) || e.recordedAt < 0 || e.recordedAt > now+300 || typeof e.payload !== 'string' || e.payload.length > 32000) throw Error('INVALID_EVENT');
    const p=JSON.parse(e.payload);
    if (!p || Array.isArray(p) || typeof p !== 'object') throw Error('INVALID_PAYLOAD');
    if (p.testId!==undefined || p.isTest===true) throw Error('TEST_DATA_NOT_ALLOWED');
    if (e.kind==='location' && (!Number.isFinite(p.latitude) || Math.abs(p.latitude)>90 || !Number.isFinite(p.longitude) || Math.abs(p.longitude)>180 || !Number.isFinite(p.timestamp) || !Number.isFinite(p.accuracy))) throw Error('INVALID_LOCATION');
    if (e.kind==='visit_label' && (!uuid.test(p.visitId) || !['fueled','not_fueling','not_a_stop','wrong_station','unsure'].includes(p.label))) throw Error('INVALID_LABEL');
    if (e.kind==='visit_prompt' && (!uuid.test(p.visitId) || p.confirmationState!=='unconfirmed' || !['created','scheduled','permission_missing','schedule_failed','dismissed'].includes(p.status))) throw Error('INVALID_PROMPT');
    validateDrivingCrossCheck(e.kind,p,now);
    ids.add(e.id);
  }
  return events;
}
export function createDrivingResearchHandler({db}) {
  return async request => {
    const reply=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
    // No enrollment, identity, telemetry or participant data is needed to check
    // this service. Exercise its database dependency and return only availability.
    if (request.method==='GET' && new URL(request.url).pathname.endsWith('/driving-research/health')) {
      try {
        const result=await db.from('driving_research_participants').select('id',{head:true}).limit(1);
        return reply({available:!result.error},result.error?503:200);
      } catch { return reply({available:false},503); }
    }
    if (request.method!=='POST') return reply({error:'METHOD_NOT_ALLOWED'},405);
    const token=request.headers.get('x-research-token');
    if (!/^[a-f0-9]{64}$/.test(token||'')) return reply({error:'UNAUTHORIZED'},401);
    try {
      const body=await request.text(); if (body.length>1_000_000) return reply({error:'TOO_LARGE'},413);
      const input=JSON.parse(body), {action,participantId}=input;
      if (!uuid.test(participantId)||!['enroll','upload','stations','delete','control','testStatus','registerPush'].includes(action)) return reply({error:'INVALID_REQUEST'},400);
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),v=>v.toString(16).padStart(2,'0')).join('');
      const auth={p_id:participantId,p_hash:hash};
      if (action==='enroll') {
        if (input.consentVersion!==1) return reply({error:'CONSENT_REQUIRED'},400);
        const result=await db.rpc('enroll_driving_research',auth);
        return result.error||result.data!==true ? reply({error:'ENROLLMENT_UNAVAILABLE'},403):reply({enrolled:true});
      }
      // Deletion authenticates inside its transaction and is idempotent after
      // revocation, including when the first success response was lost.
      if(action==='delete') {
        const result=await db.rpc('delete_driving_research',auth);
        if (result.error) return reply({error:'DELETE_FAILED'},503);
        return result.data===true ? reply({deleted:true}) : reply({error:'UNAUTHORIZED'},403);
      }
      const access=await db.rpc('access_driving_research',auth);
      if (access.error||access.data!==true) return reply({error:'UNAUTHORIZED_OR_RATE_LIMITED'},403);
      if(action==='registerPush') {
        if (!/^[a-f0-9]{32,512}$/.test(input.deviceToken||'') || !['sandbox','production'].includes(input.environment)) return reply({error:'INVALID_PUSH_DEVICE'},400);
        const result=await db.rpc('register_driving_research_push',{...auth,p_token:input.deviceToken,p_environment:input.environment});
        return result.error?reply({error:'PUSH_REGISTRATION_UNAVAILABLE'},503):reply({registered:result.data===true});
      }
      if(action==='control') {
        const hasCounts=input.total!==undefined || input.pending!==undefined;
        if (hasCounts && (!Number.isSafeInteger(input.total)||!Number.isSafeInteger(input.pending)||input.pending<0||input.total<input.pending||input.total>100000000)) return reply({error:'INVALID_COUNTS'},400);
        if (input.completedRequestId!==undefined && !uuid.test(input.completedRequestId)) return reply({error:'INVALID_REQUEST'},400);
        const result=await db.rpc('driving_research_control',{...auth,p_total:hasCounts?input.total:null,p_pending:hasCounts?input.pending:null,p_completed:input.completedRequestId??null});
        return result.error?reply({error:'CONTROL_UNAVAILABLE'},503):reply(result.data);
      }
      if(action==='testStatus') {
        const statuses=['preparing','scheduled','permission_missing','schedule_failed','dismissed','answered'];
        const labels=['fueled','not_fueling','not_a_stop','wrong_station','unsure'];
        if (!uuid.test(input.testId)||!statuses.includes(input.status)||
            (input.status==='answered' ? !labels.includes(input.label) : input.label!==undefined)||
            (['answered','dismissed'].includes(input.status) && (!Number.isFinite(input.responseAt)||input.responseAt<0||input.responseAt>Date.now()/1000+300))) return reply({error:'INVALID_TEST_RESPONSE'},400);
        const result=await db.rpc('report_driving_research_notification_test',{...auth,p_test_id:input.testId,p_status:input.status,p_label:input.label??null,p_response_at:input.responseAt??null});
        return result.error?reply({error:'TEST_UNAVAILABLE'},503):reply({saved:result.data});
      }
      if(action==='stations') {
        if (!Number.isFinite(input.latitude)||Math.abs(input.latitude)>90||!Number.isFinite(input.longitude)||Math.abs(input.longitude)>180) return reply({error:'INVALID_COORDINATE'},400);
        const result=await db.rpc('driving_research_stations',{p_lat:input.latitude,p_lon:input.longitude});
        return result.error?reply({error:'STATIONS_UNAVAILABLE'},503):reply({stations:result.data,observedAt:new Date().toISOString()});
      }
      const events=validateDrivingEvents(input.events);
      const result=await db.rpc('ingest_driving_research',{...auth,p_events:events});
      return result.error?reply({error:'UPLOAD_FAILED'},503):reply({accepted:result.data,ids:events.map(e=>e.id)});
    } catch {return reply({error:'INVALID_REQUEST'},400);}
  };
}
