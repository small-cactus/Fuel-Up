const grades = {regular_gas:'Regular',midgrade_gas:'Midgrade',premium_gas:'Premium',diesel:'Diesel',e85:'E85'};

export function applePriceAlert(claim) {
    const {id, stationId, station, product, payment, price, previous, environment, deviceToken, expiresAt} = claim;
    if (!/^[a-f0-9-]{36}$/.test(id) || !/^[a-f0-9]{32,512}$/.test(deviceToken) ||
        !['production','sandbox'].includes(environment) || !Object.hasOwn(grades, product) ||
        !['credit','cash'].includes(payment) || !(Number(previous)>Number(price) && Number(price)>0) ||
        !Number.isFinite(Number(expiresAt))) throw Error('Invalid price alert');
    const cents = Math.round((previous-price)*100);
    const saving = cents < 100 ? cents + '¢' : '$' + (cents/100).toFixed(2);
    const host = environment==='production' ? 'https://api.push.apple.com' : 'https://api.sandbox.push.apple.com';
    const path = '/3/device/'+deviceToken;
    const headers = {'apns-topic':'com.anthonyh.fuelup','apns-push-type':'alert','apns-priority':'10',
        'apns-id':id,'apns-collapse-id':'fuelup-price-drop','apns-expiration':String(Math.floor(expiresAt))};
    const payload = JSON.stringify({aps:{alert:{title:`${grades[product]} dropped ${saving} nearby`,
        body:`${String(station || 'A nearby station').slice(0,100)} reported $${Number(price).toFixed(2)}/gal (${payment}).`},
        sound:'default','thread-id':'fuelup-price-drops'}, type:'fuelup.price-drop.v1', stationId, deliveryId:id});
    return {host,path,headers,payload};
}

// A definite temporary rejection can be retried once. A transport timeout is
// ambiguous; retrying it could deliver the same alert twice.
export async function deliverWithRetry(send, expiresAt, sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))) {
    const first=await send();
    const backoff=first.reason==='TooManyRequests' ? 10000 : 3000;
    if(first.status!=='rejected' || !['TooManyRequests','ServiceUnavailable','Shutdown','InternalServerError','HTTP500','HTTP503'].includes(first.reason) ||
        Date.now()+backoff>=expiresAt*1000) return first;
    await sleep(backoff);
    return send();
}
