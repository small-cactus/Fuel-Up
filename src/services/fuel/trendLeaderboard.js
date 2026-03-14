function buildTrendLeaderboard({ rankedLatestQuotes, stationHistoryById, limit = 5 }) {
    const rankedQuotes = Array.isArray(rankedLatestQuotes)
        ? rankedLatestQuotes.filter(Boolean)
        : [];
    const historyMap = stationHistoryById instanceof Map
        ? stationHistoryById
        : new Map();
    const eligibleHistory = rankedQuotes
        .map(quote => historyMap.get(String(quote?.stationId || '').trim()))
        .filter(Boolean);
    const earliestRankByStationId = new Map(
        eligibleHistory
            .slice()
            .sort((left, right) => (
                Number(left.earliestPrice) - Number(right.earliestPrice) ||
                String(left.stationId || '').localeCompare(String(right.stationId || ''))
            ))
            .map((station, index) => [String(station.stationId || '').trim(), index])
    );

    return rankedQuotes.slice(0, limit).map((quote, index) => {
        const stationId = String(quote?.stationId || '').trim();
        const history = historyMap.get(stationId) || {};
        const earliestRank = earliestRankByStationId.get(stationId) ?? index;

        return {
            stationId,
            name: quote?.stationName || history.name || 'Unknown Station',
            address: quote?.address || history.address || '',
            latitude: Number.isFinite(Number(quote?.latitude)) ? Number(quote.latitude) : Number(history.latitude),
            longitude: Number.isFinite(Number(quote?.longitude)) ? Number(quote.longitude) : Number(history.longitude),
            distanceMiles: Number.isFinite(Number(quote?.distanceMiles))
                ? Number(quote.distanceMiles)
                : (Number.isFinite(Number(history.distanceMiles)) ? Number(history.distanceMiles) : null),
            latestPrice: Number(quote?.price),
            earliestPrice: Number.isFinite(Number(history.earliestPrice))
                ? Number(history.earliestPrice)
                : Number(quote?.price),
            earliestRank,
            latestRank: index,
            rankShift: earliestRank - index,
        };
    });
}

module.exports = {
    buildTrendLeaderboard,
};
