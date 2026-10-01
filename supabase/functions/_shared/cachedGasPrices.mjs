import { normalizeGasBuddyResponse, calculateDistanceMiles } from './core.mjs';
import { applyValidationToStationQuotes, fetchAreaHistoryRows, sanitizeStationQuotesForFuelType } from './stationData.mjs';
import { ServiceError, validateInput } from './gasPrices.mjs';

// No provider transport, refresh lease or provider fallback. forceRefresh only
// means a fresh database read, never an upstream request.
export async function getCachedGasPrices({ input: rawInput, db }) {
  const input = validateInput(rawInput);
  const { data: rows, error } = await db.rpc('nearby_fuel_station_cache', {
    p_latitude: input.latitude, p_longitude: input.longitude, p_radius_miles: input.radiusMiles,
  });
  if (error || !Array.isArray(rows)) throw new ServiceError('CACHE_UNAVAILABLE', 503);
  const observed = new Map(rows.map(row => [String(row.station.id), row.observedAt]));
  const normalized = normalizeGasBuddyResponse({ origin: input, fuelType: input.fuelType,
    payload: { data: { locationBySearchTerm: { stations: { results: rows.map(row => row.station) } } } },
  }) || [];
  // Keep the existing validation rules. Predictions never overwrite raw data.
  const { data: history, error: historyError } = normalized.length ? await fetchAreaHistoryRows({
    supabase: db, searchLat: Math.round(input.latitude * 10) / 10,
    searchLng: Math.round(input.longitude * 10) / 10, fuelType: input.fuelType,
  }) : { data: [] };
  const validated = applyValidationToStationQuotes({ stationQuotes: normalized,
    historyRows: (history || []).filter(row => row.provider_id === 'gasbuddy'), origin: input });
  const quotes = sanitizeStationQuotesForFuelType(validated, input.fuelType)
    .map(quote => ({ ...quote, observedAt: observed.get(quote.stationId),
      distanceMiles: calculateDistanceMiles(input, quote) }))
    .filter(quote => quote.distanceMiles <= input.radiusMiles &&
      (!input.requiresE85 || Number(quote.allPrices?.e85 ?? quote.allPrices?.e_85) > 0));
  const times = rows.map(row => row.observedAt).filter(Boolean).sort();
  return { version: 1, source: 'national-cache', quotes, summary: {
    stationCount: rows.length, quoteCount: quotes.length,
    oldestObservedAt: times[0] || null, newestObservedAt: times.at(-1) || null,
    ...(historyError ? { historyUnavailable: true } : {}),
  } };
}
