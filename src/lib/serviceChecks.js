// Every outage row has a bounded, read-only check even before its screen is used.
// HEAD checks execute the real database query without downloading private rows.
function createServiceChecks({ url, key, monitor, transport }) {
    const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
    const check = (serviceId, path, init = {}) => () => monitor.fetch(`${url}${path}`,
        { ...init, headers }, transport, { serviceId, healthCheck: true });
    return {
        prices: check('prices', '/functions/v1/gas-prices', {
            method: 'POST', body: JSON.stringify({ scope: 'national', fuelType: 'regular' }),
        }),
        history: check('history', '/rest/v1/station_prices?select=station_id&limit=1', { method: 'HEAD' }),
        memberships: check('memberships', '/rest/v1/rpc/fuel_memberships_for_state', {
            method: 'POST', body: JSON.stringify({ p_state: 'FL' }),
        }),
        notifications: check('notifications', '/rest/v1/push_tokens?select=token&limit=1', { method: 'HEAD' }),
        research: check('research', '/functions/v1/driving-research/health'),
        account: check('account', '/auth/v1/health'),
    };
}
module.exports = { createServiceChecks };
