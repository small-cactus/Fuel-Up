const test = require('node:test');
const assert = require('node:assert/strict');

test('anonymous first-launch local history reads archived observations for the exact area and grade', async () => {
  const { getLocalTrends } = await import('../supabase/functions/_shared/localTrends.mjs');
  const rows = [{ station_id: 'near', price: 3.11 }];
  const input = { latitude: 27.95, longitude: -82.45, radiusMiles: 6, fuelType: 'premium' };
  const result = await getLocalTrends({ input, db: { rpc: async (name, args) => {
    assert.equal(name, 'local_fuel_trend_rows');
    assert.deepEqual(args, { p_latitude: 27.95, p_longitude: -82.45, p_radius_miles: 6, p_fuel_type: 'premium' });
    return { data: rows };
  } } });
  assert.equal(result.scope, 'local-history');
  assert.deepEqual(result.rows, rows);
  await assert.rejects(getLocalTrends({ input, db: { rpc: async () => ({ error: {} }) } }), /LOCAL_HISTORY_UNAVAILABLE/);
  await assert.rejects(getLocalTrends({ input: { ...input, radiusMiles: 101 }, db: { rpc: () => assert.fail('invalid input queried') } }), /INVALID_INPUT/);
});
