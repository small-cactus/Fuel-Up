import { filterStationQuotesForHome } from './homeState.js';
import { rankQuotesForFuelGrade } from './fuelGrade.js';
import { stationOffersE85 } from './stationPreferences.js';
import { isFreshReportedQuote } from '../services/fuel/reportedPrices.js';

// Keep station identity and all quote metadata outside the rendered carousel.
export function buildVisibleStations(snapshot, { origin, radiusMiles, minimumRating = 0, fuelGrade, requiresE85 = false, now = Date.now() } = {}) {
    let quotes = [...(snapshot?.topStations || [])];
    if (snapshot?.quote) quotes.unshift(snapshot.quote);
    quotes = filterStationQuotesForHome({ quotes, origin, radiusMiles, minimumRating });
    if (fuelGrade) quotes = rankQuotesForFuelGrade(quotes, fuelGrade);
    if (requiresE85) quotes = quotes.filter(stationOffersE85);
    const byId = new Map();
    for (const quote of quotes) {
        if (!isFreshReportedQuote(quote, now)) continue;
        if (quote.providerTier !== 'station' || quote.isEstimated || quote.stationId == null ||
            !Number.isFinite(quote.latitude) || !Number.isFinite(quote.longitude) ||
            Math.abs(quote.latitude) > 90 || Math.abs(quote.longitude) > 180 ||
            !Number.isFinite(quote.price) || quote.price <= 0) continue;
        const id = String(quote.stationId);
        if (!id) continue;
        byId.set(id, { ...quote, id, name: quote.stationName || quote.name || 'Gas station' });
    }
    // Match Swift's global cheapest/tie ordering, regardless of input order.
    return [...byId.values()].sort((a, b) => a.price - b.price || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

