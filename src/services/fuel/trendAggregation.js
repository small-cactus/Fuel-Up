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

function resolveSnapshotObservedAtMs(latestQuotes, fallbackNowMs) {
    const observedAtCandidates = (latestQuotes || [])
        .map(quote => (
            Date.parse(quote?.updatedAt || '') ||
            Date.parse(quote?.fetchedAt || '')
        ))
        .filter(timestampMs => Number.isFinite(timestampMs));

    if (observedAtCandidates.length > 0) {
        return Math.max(...observedAtCandidates);
    }

    return fallbackNowMs;
}

function buildCurrentAverageSnapshotSeries(latestQuotes, options = {}) {
    const {
        nowMs = Date.now(),
        fallbackWindowMs = 60 * 60 * 1000,
    } = options;
    const currentPrices = (latestQuotes || [])
        .map(quote => Number(quote?.price))
        .filter(price => Number.isFinite(price) && price > 0);

    if (currentPrices.length === 0) {
        return [];
    }

    const averageCurrentPrice = currentPrices.reduce((sum, price) => sum + price, 0) / currentPrices.length;
    const observedAtMs = resolveSnapshotObservedAtMs(latestQuotes, nowMs);
    const startTimestampMs = Math.max(0, observedAtMs - fallbackWindowMs);

    return [
        {
            date: new Date(startTimestampMs).toISOString(),
            price: averageCurrentPrice,
        },
        {
            date: new Date(observedAtMs).toISOString(),
            price: averageCurrentPrice,
        },
    ];
}

function buildAveragePriceTrendSeries(rows, options = {}) {
    const {
        fallbackLatestQuotes = [],
        nowMs = Date.now(),
    } = options;
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

    if (averagePricesByDay.length >= 2) {
        return averagePricesByDay;
    }

    const currentAverageSnapshotSeries = buildCurrentAverageSnapshotSeries(fallbackLatestQuotes, {
        nowMs,
    });

    if (currentAverageSnapshotSeries.length >= 2) {
        return currentAverageSnapshotSeries;
    }

    return averagePricesByDay;
}

module.exports = {
    buildAveragePriceTrendSeries,
    buildCurrentAverageSnapshotSeries,
};
