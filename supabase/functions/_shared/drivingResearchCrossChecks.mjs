const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const finite=(v,min=0,max=Infinity)=>Number.isFinite(v)&&v>=min&&v<=max;
const station=id=>typeof id==='string'&&id.length>0&&id.length<=128;
const time=(v,now)=>finite(v,0,now+300);
export function validateDrivingCrossCheck(kind,p,now) {
 if(kind==='visit_pedometer') {
  if(!uuid.test(p.visitId)||!station(p.stationId)||p.source!=='apple_pedometer'||
     !['visit_departure','visit_gap'].includes(p.terminalEvent)||
     !time(p.observedStartAt,now)||!time(p.observedEndAt,now)||p.observedEndAt<p.observedStartAt||
     !['available','unavailable','not_authorized','history_expired','invalid_window','query_failed'].includes(p.status)) throw Error('INVALID_PEDOMETER');
  if(p.status!=='invalid_window' && (!time(p.startAt,now)||!time(p.endAt,now)||p.endAt<=p.startAt||p.endAt-p.startAt>1200||p.startAt<p.observedStartAt||p.endAt>p.observedEndAt||typeof p.truncated!=='boolean')) throw Error('INVALID_PEDOMETER_WINDOW');
  if(p.status==='available') {
   if(!Number.isSafeInteger(p.steps)||p.steps<0||!time(p.dataStartAt,now)||!time(p.dataEndAt,now)||p.dataEndAt<p.dataStartAt||
      (p.distanceMeters!==undefined&&!finite(p.distanceMeters))) throw Error('INVALID_PEDOMETER_RESULT');
  } else if(p.steps!==undefined||p.distanceMeters!==undefined) throw Error('UNAVAILABLE_IS_NOT_ZERO');
 }
 if(kind==='system_visit') {
  if(p.source!=='apple_visit'||p.fuelPurchaseConfirmed!==false||!finite(p.latitude,-90,90)||!finite(p.longitude,-180,180)||!finite(p.accuracy,0,100)||
     (p.arrivalAt===undefined&&p.departureAt===undefined)||
     (p.arrivalAt!==undefined&&!time(p.arrivalAt,now))||(p.departureAt!==undefined&&!time(p.departureAt,now))||
     (p.arrivalAt!==undefined&&p.departureAt!==undefined&&p.departureAt<p.arrivalAt)||
     !Array.isArray(p.stationCandidates)||!p.stationCandidates.length||p.stationCandidates.length>5||
     p.stationCandidates.some(s=>!s||!station(s.stationId)||!finite(s.distanceMeters,0,150))) throw Error('INVALID_SYSTEM_VISIT');
 }
}
