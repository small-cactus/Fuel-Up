const encode = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const json = value => encode(new TextEncoder().encode(JSON.stringify(value)));
export async function signAppleToken(keyId,teamId,base64Pkcs8,now=Math.floor(Date.now()/1000)) {
    if (![keyId,teamId].every(id=>/^[A-Z0-9]{10}$/.test(id))) throw Error('Invalid APNs configuration');
    const key=await crypto.subtle.importKey('pkcs8',Uint8Array.from(atob(base64Pkcs8),c=>c.charCodeAt(0)),
        {name:'ECDSA',namedCurve:'P-256'},false,['sign']);
    const body=json({alg:'ES256',kid:keyId})+'.'+json({iss:teamId,iat:now});
    const signature=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,new TextEncoder().encode(body));
    return body+'.'+encode(signature);
}
