const { selectPreferredQuote } = require('./core');

const REPORTED_PRICE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function isFreshReportedPrice(price, postedAt, now = Date.now()) {
    const posted = Date.parse(postedAt || '');
    return Number.isFinite(price) && price > 0 && Number.isFinite(posted) &&
        posted <= now && now - posted <= REPORTED_PRICE_MAX_AGE_MS;
}

// Apply age independently to each grade/payment quote before credit-first
// selection. A fresh regular quote cannot refresh an old premium quote.
function freshReportedStation(station, now = Date.now()) {
    // Product presence is availability evidence, even when its quote is absent/old.
    // Preserve the independent DB flag when an hourly response omits a product.
    const offersE85 = station.offersE85 === true || (station.prices || []).some(entry => entry.fuelProduct === 'e85');
    return { ...station, offersE85, prices: (station.prices || []).map(entry => {
        const fresh = payment => isFreshReportedPrice(payment?.price, payment?.postedTime, now) ? payment : null;
        return { ...entry, credit: fresh(entry.credit), cash: fresh(entry.cash) };
    }).filter(entry => entry.credit || entry.cash) };
}

function isFreshReportedQuote(quote, now = Date.now()) {
    return quote?.providerTier === 'station' && !quote.isEstimated &&
        !quote.validation?.usedPrediction && !quote.validationByFuelType?.[quote.fuelType]?.usedPrediction &&
        isFreshReportedPrice(quote.price, quote.updatedAt, now);
}

// Recheck on cache reads: a recent DB fetch does not extend the price's age.
// Re-select the cheapest if the former winner expired while stored locally.
function filterReportedSnapshot(snapshot, now = Date.now()) {
    if (!snapshot) return snapshot;
    const topStations = (snapshot.topStations || []).filter(quote => isFreshReportedQuote(quote, now));
    const candidates = [...topStations, snapshot.quote].filter(quote => isFreshReportedQuote(quote, now));
    return { ...snapshot, quote: selectPreferredQuote(candidates), topStations, regionalQuotes: [] };
}

module.exports = { REPORTED_PRICE_MAX_AGE_MS, isFreshReportedPrice, freshReportedStation, isFreshReportedQuote, filterReportedSnapshot };
