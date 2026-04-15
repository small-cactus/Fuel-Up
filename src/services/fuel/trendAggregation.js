function buildAggregatedAveragePrices(rows, getBucketStart) {
    const buckets = new Map();

    (rows || []).forEach(row => {
        const timestampMs = Number(row?.timestampMs ?? Date.parse(row?.created_at || ''));
        const price = Number(row?.price);

        if (!Number.isFinite(timestampMs) || !Number.isFinite(price)) {
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

function buildAveragePriceTrendSeries(rows) {
    const averagePricesByDay = buildAggregatedAveragePrices(rows, timestampMs => {
        const bucketStart = new Date(timestampMs);
        bucketStart.setUTCHours(0, 0, 0, 0);
        return bucketStart;
    });

    if (averagePricesByDay.length >= 2) {
        return averagePricesByDay;
    }

    const averagePricesByHour = buildAggregatedAveragePrices(rows, timestampMs => {
        const bucketStart = new Date(timestampMs);
        bucketStart.setUTCMinutes(0, 0, 0);
        return bucketStart;
    });

    if (averagePricesByHour.length >= 2) {
        return averagePricesByHour;
    }

    return averagePricesByDay;
}

module.exports = {
    buildAveragePriceTrendSeries,
};
