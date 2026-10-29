import { ServiceError, validateInput } from './gasPrices.mjs';

// Shared, archived station observations. No user history or provider requests.
export async function getLocalTrends({ input: rawInput, db }) {
  const input = validateInput(rawInput);
  const { data, error } = await db.rpc('local_fuel_trend_rows', {
    p_latitude: input.latitude, p_longitude: input.longitude,
    p_radius_miles: input.radiusMiles, p_fuel_type: input.fuelType,
  });
  if (error || !Array.isArray(data)) throw new ServiceError('LOCAL_HISTORY_UNAVAILABLE', 503);
  return { version: 1, scope: 'local-history', rows: data, sampling: 'first-reported-observation-per-UTC-day' };
}
