import { normalizeGasBuddyResponse, calculateDistanceMiles } from './core.mjs';
import { sanitizeStationQuotesForFuelType } from './stationData.mjs';
import { freshReportedStation, isFreshReportedQuote } from './reportedPrices.mjs';
import { ServiceError, validateInput } from './gasPrices.mjs';

// No provider transport, refresh lease or provider fallback. forceRefresh only
// means a fresh database read, never an upstream request.
export async function getCachedGasPrices({ input: rawInput, db, now = Date.now() }) {
  const input = validateInput(rawInput);
  const { data: rows, error } = await db.rpc('nearby_fuel_station_cache', {
    p_latitude: input.latitude, p_longitude: input.longitude, p_radius_miles: input.radiusMiles,
  });
  if (error || !Array.isArray(rows)) {
    // Preserve a non-sensitive backend error code for operational diagnosis.
    const diagnostic = /^[A-Z0-9_]{1,40}$/.test(error?.code || '') ? error.code : (error ? 'TRANSPORT_ERROR' : 'INVALID_RESULT');
    console.error('nearby-cache', diagnostic, error?.message);
    throw new ServiceError('CACHE_UNAVAILABLE', 503);
  }
  const observed = new Map(rows.map(row => [String(row.station.id), row.observedAt]));
  const normalized = normalizeGasBuddyResponse({ origin: input, fuelType: input.fuelType,
    payload: { data: { locationBySearchTerm: { stations: { results: rows.map(row => freshReportedStation(row.station, now)) } } } },
  }) || [];
  // Serving uses reported values only. Research models and raw history remain
  // separate; no prediction or correction runs in this path.
  const quotes = sanitizeStationQuotesForFuelType(normalized, input.fuelType)
    .map(quote => ({ ...quote, observedAt: observed.get(quote.stationId),
      distanceMiles: calculateDistanceMiles(input, quote) }))
    .filter(quote => isFreshReportedQuote(quote, now) && quote.distanceMiles <= input.radiusMiles &&
      (!input.requiresE85 || Number(quote.allPrices?.e85 ?? quote.allPrices?.e_85) > 0));
  const times = rows.map(row => row.observedAt).filter(Boolean).sort();
  return { version: 1, source: 'national-cache', quotes, summary: {
    stationCount: rows.length, quoteCount: quotes.length,
    oldestObservedAt: times[0] || null, newestObservedAt: times.at(-1) || null,
    pricePolicy: 'reported-last-24-hours',
  } };
}
