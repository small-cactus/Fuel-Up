const products = {regular:'regular_gas', midgrade:'midgrade_gas', premium:'premium_gas', diesel:'diesel', e85:'e85'};

export function priceWatchProduct(grade) { return products[grade] || null; }

export function priceWatchStations(stations, grade, radius) {
    return [...new Set(stations.filter(s => s.fuelType===grade && Number.isFinite(s.price) && s.price>0 &&
        Number.isFinite(s.distanceMiles) && s.distanceMiles<=radius && !s.isEstimated && s.providerTier==='station')
        .sort((a,b)=>a.price-b.price || a.distanceMiles-b.distanceMiles)
        .map(s=>String(s.id)).filter(id=>/^[a-zA-Z0-9_-]{1,80}$/.test(id)))].slice(0,40);
}
