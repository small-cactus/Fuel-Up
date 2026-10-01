import { normalizeGasBuddyResponse } from './core.mjs';
import { freshReportedStation, isFreshReportedQuote } from './reportedPrices.mjs';
import { sanitizeStationQuotesForFuelType } from './stationData.mjs';
import { ServiceError } from './gasPrices.mjs';
export async function getNationalLeaderboard({
  input,
  db
}) {
  const fuelType = input.fuelType || 'regular';
  if (!['regular', 'midgrade', 'premium', 'diesel', 'e85'].includes(fuelType) || input.requiresE85 != null && typeof input.requiresE85 !== 'boolean') throw new ServiceError('INVALID_INPUT', 400);
  const {
    data: rows,
    error
  } = await db.rpc('national_fuel_station_cache', {
    p_fuel_type: fuelType,
    p_requires_e85: input.requiresE85 === true
  });
  if (error || !Array.isArray(rows)) throw new ServiceError('CACHE_UNAVAILABLE', 503);
  const now = Date.now();
  const quotes = sanitizeStationQuotesForFuelType(normalizeGasBuddyResponse({
    origin: {
      latitude: 0,
      longitude: 0
    },
    fuelType,
    payload: {
      data: {
        locationBySearchTerm: {
          stations: {
            results: rows.map(r => freshReportedStation(r.station, now))
          }
        }
      }
    }
  }) || [], fuelType).filter(q => isFreshReportedQuote(q, now)).sort((a, b) => a.price - b.price || a.stationId.localeCompare(b.stationId)).slice(0, 5).map(({
    distanceMiles,
    ...q
  }) => ({
    ...q,
    observedAt: rows.find(r => String(r.station.id) === q.stationId)?.observedAt
  }));
  const { data: history, error: historyError } = await db.rpc('national_fuel_trend_history', {
    p_fuel_type: fuelType,
    p_requires_e85: input.requiresE85 === true
  });
  return {
    version: 1,
    history: historyError || !Array.isArray(history) ? [] : history,
    historyError: historyError ? 'Unable to load national price history.' : null,
    source: 'national-cache',
    scope: 'national',
    quotes,
    summary: {
      pricePolicy: 'reported-last-24-hours'
    }
  };
}
