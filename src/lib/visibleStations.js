import { canUseFuelStation } from './fuelMemberships.js';
import { filterStationQuotesForHome } from './homeState.js';
import { rankQuotesForFuelGrade } from './fuelGrade.js';
import { rankStationQuotes, stationOffersE85 } from './stationPreferences.js';
import { visibleReportedQuote, isE85AvailabilityQuote } from '../services/fuel/reportedPrices.js';

// Keep station identity and all quote metadata outside the rendered carousel.
export function buildVisibleStations(snapshot, { origin, radiusMiles, minimumRating = 0, fuelGrade, requiresE85 = false, preferredBrands = [], fuelMemberships = [], now = Date.now() } = {}) {
    let quotes = [...(snapshot?.topStations || [])];
    if (snapshot?.quote) quotes.unshift(snapshot.quote);
    quotes = filterStationQuotesForHome({ quotes, origin, radiusMiles, minimumRating });
    if (fuelGrade) quotes = rankQuotesForFuelGrade(quotes, fuelGrade);
    if (requiresE85) quotes = quotes.filter(stationOffersE85);
    const byId = new Map();
    for (const candidate of quotes) {
        const quote = visibleReportedQuote(candidate, now);
        if (!quote || !canUseFuelStation(quote, fuelMemberships)) continue;
        if (quote.providerTier !== 'station' || quote.isEstimated || quote.stationId == null ||
            !Number.isFinite(quote.latitude) || !Number.isFinite(quote.longitude) ||
            Math.abs(quote.latitude) > 90 || Math.abs(quote.longitude) > 180 ||
            (!isE85AvailabilityQuote(quote) && (!Number.isFinite(quote.price) || quote.price <= 0))) continue;
        const id = String(quote.stationId);
        if (!id) continue;
        byId.set(id, { ...quote, id, name: quote.stationName || quote.name || 'Gas station' });
    }
    // Preference affects order only. Swift still colors the actual lowest raw price.
    return rankStationQuotes([...byId.values()], { preferredBrands });
}

