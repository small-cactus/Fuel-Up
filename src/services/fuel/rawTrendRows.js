const { isFreshReportedPrice } = require('./reportedPrices');

// Legacy history's displayed price may have been adjusted. Its payment payload
// was stored before validation and is the only trustworthy raw-price source.
// Do not fall back to row.price or all_prices[grade], even for missing metadata.
function buildRawTrendRows(rows, fuelType) {
    return (rows || []).flatMap(row => {
        if (row.provider_id !== 'gasbuddy' || row.fuel_type !== fuelType) return [];
        const payment = row.all_prices?._payment?.[fuelType];
        const price = Number(payment?.credit) > 0 ? Number(payment.credit) : Number(payment?.cash);
        const timestampMs = Date.parse(row.created_at || '');
        if (!Number.isFinite(timestampMs) || timestampMs > Date.now() ||
            !isFreshReportedPrice(price, row.updated_at_source, timestampMs)) return [];
        return [{ ...row, timestampMs, price }];
    });
}

module.exports = { buildRawTrendRows };
