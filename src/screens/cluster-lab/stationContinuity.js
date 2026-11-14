import { calculateDistanceMiles } from '../../lib/homeState.js';
import { REPORTED_PRICE_MAX_AGE_MS } from '../../services/fuel/reportedPrices.js';

// Only GPS movement may reuse a search's raw quotes. Explicit search changes
// and manual locations are separate sessions, even when their regions overlap.
export function stationContinuityKey({ criteria, manualLocation, locationSource, latitude, longitude }) {
    const followsDevice = !manualLocation && (!locationSource || locationSource === 'device');
    return JSON.stringify([criteria, followsDevice ? 'device' : ['fixed', latitude, longitude]]);
}

export function localizeStationSnapshot(snapshot, origin) {
    const rebase = quote => quote && Number.isFinite(quote.latitude) && Number.isFinite(quote.longitude)
        ? { ...quote, distanceMiles: calculateDistanceMiles(origin, quote) } : quote;
    return { ...snapshot, quote: rebase(snapshot?.quote), topStations: snapshot?.topStations?.map(rebase) };
}

export function stationExpiryDelay(stations, now = Date.now()) {
    const expirations = stations.flatMap(station => [station.updatedAt, station.secondaryUpdatedAt]
        .map(date => Date.parse(date) + REPORTED_PRICE_MAX_AGE_MS))
        .filter(expiry => Number.isFinite(expiry) && expiry >= now);
    return expirations.length ? Math.max(1, Math.min(...expirations) - now + 1) : null;
}
