// Keep station identity and all quote metadata outside the rendered carousel.
export function buildLabStations(snapshot) {
    const quotes = [...(snapshot?.topStations || [])];
    if (snapshot?.quote) quotes.push(snapshot.quote);
    const byId = new Map();
    for (const quote of quotes) {
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

export function stationAge(updatedAt, now = Date.now()) {
    const date = new Date(updatedAt).getTime();
    if (!updatedAt || !Number.isFinite(date)) return null;
    const minutes = Math.max(0, Math.floor((now - date) / 60000));
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
    return `${Math.floor(minutes / 1440)}d ago`;
}

export function stationDistance(miles) {
    if (!Number.isFinite(miles) || miles < 0) return null;
    return miles < 0.1 ? 'Right here' : `${miles.toFixed(1)} mi away`;
}

export function pageFromOffset(offset, width, count) {
    if (!Number.isFinite(offset) || width <= 0 || count < 1) return null;
    return Math.min(count - 1, Math.max(0, Math.round(offset / width)));
}
