const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Installation credentials cannot enroll research or authorize sensor collection.
// APNs addresses are private control data, never analytics payloads.
export function installationSyncCall(body,hash) {
    if (!uuid.test(body?.installationId||'')) throw Error('invalid_installation');
    const args={p_id:body.installationId,p_hash:hash};
    if (body.action==='registerPush') {
        if (!/^[a-f0-9]{32,512}$/.test(body.deviceToken||'') || !['sandbox','production'].includes(body.environment)) throw Error('invalid_address');
        return {name:'register_installation_push',args:{...args,p_token:body.deviceToken,p_environment:body.environment}};
    }
    if (body.action==='control') {
        if (body.requestId!=null && !uuid.test(body.requestId)) throw Error('invalid_request');
        return {name:'installation_sync_control',args:{...args,p_request:body.requestId||null}};
    }
    if (body.action==='completeSync' && uuid.test(body.requestId||'')) {
        return {name:'complete_installation_sync',args:{...args,p_request:body.requestId}};
    }
    throw Error('invalid_action');
}
