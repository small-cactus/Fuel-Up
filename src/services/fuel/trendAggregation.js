function buildAggregatedAveragePrices(rows, getBucketStart) {
    const buckets = new Map();

    (rows || []).forEach(row => {
        const timestampMs = Number(row?.timestampMs ?? Date.parse(row?.created_at || ''));
        const price = Number(row?.price);

        if (!Number.isFinite(timestampMs) || !Number.isFinite(price) || price <= 0) {
            return;
        }

        const bucketStart = getBucketStart(timestampMs);
        const bucketKey = bucketStart.toISOString();
        const existingBucket = buckets.get(bucketKey) || {
            date: bucketKey,
            timestampMs: bucketStart.getTime(),
            sum: 0,
            count: 0,
        };

        existingBucket.sum += price;
        existingBucket.count += 1;
        buckets.set(bucketKey, existingBucket);
    });

    return [...buckets.values()]
        .sort((left, right) => left.timestampMs - right.timestampMs)
        .map(bucket => ({
            date: bucket.date,
            price: bucket.sum / bucket.count,
        }));
}

// A lone observation stays a lone observation. Missing buckets stay missing.
function buildAveragePriceTrendSeries(rows) {
    const daily = buildAggregatedAveragePrices(rows, timestampMs => {
        const date = new Date(timestampMs);
        date.setUTCHours(0, 0, 0, 0);
        return date;
    });
    if (daily.length >= 2) return daily;
    return buildAggregatedAveragePrices(rows, timestampMs => {
        const date = new Date(timestampMs);
        date.setUTCMinutes(0, 0, 0);
        return date;
    });
}
module.exports = { buildAveragePriceTrendSeries };
