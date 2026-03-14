const { createClient } = require('@supabase/supabase-js');

const app = require('./loadAppConfig.cjs');
const {
    buildValidationState,
    validateAndChoosePrice,
} = require('../src/services/fuel/priceValidation');

const FUEL_TYPES = ['regular', 'midgrade', 'premium', 'diesel'];

function toFiniteNumber(value) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : null;
}

function roundPrice(value) {
    const numericValue = toFiniteNumber(value);
    return numericValue === null ? null : Number(numericValue.toFixed(3));
}

function getStoredFuelPrice(allPrices, fuelType) {
    if (!allPrices || typeof allPrices !== 'object') {
        return null;
    }

    const paymentEntry = allPrices._payment?.[fuelType];
    const candidates = [
        paymentEntry?.selected === 'credit' ? paymentEntry?.credit : null,
        paymentEntry?.selected === 'cash' ? paymentEntry?.cash : null,
        paymentEntry?.credit,
        paymentEntry?.cash,
        allPrices[fuelType],
    ];

    for (const candidate of candidates) {
        const numericValue = roundPrice(candidate);
        if (numericValue !== null && numericValue > 0) {
            return numericValue;
        }
    }

    return null;
}

async function fetchAllStationPriceRows(supabase) {
    const rows = [];
    const pageSize = 1000;

    for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase
            .from('station_prices')
            .select('station_id, station_name, latitude, longitude, created_at, updated_at_source, all_prices, price, fuel_type')
            .order('created_at', { ascending: true })
            .range(from, from + pageSize - 1);

        if (error) {
            throw error;
        }

        rows.push(...(data || []));

        if (!data || data.length < pageSize) {
            break;
        }
    }

    return rows;
}

function buildUniqueSourceEvents(rows) {
    const eventMap = new Map();

    for (const row of rows) {
        const sourceUpdatedAtMs = Date.parse(row.updated_at_source || row.created_at || '');
        if (!Number.isFinite(sourceUpdatedAtMs)) {
            continue;
        }

        const allPrices = row.all_prices && typeof row.all_prices === 'object'
            ? row.all_prices
            : { [row.fuel_type]: row.price };

        for (const fuelType of FUEL_TYPES) {
            const price = getStoredFuelPrice(allPrices, fuelType);
            if (!(price > 0)) {
                continue;
            }

            const key = [
                row.station_id || row.station_name,
                fuelType,
                sourceUpdatedAtMs,
                price,
            ].join('|');

            if (eventMap.has(key)) {
                continue;
            }

            eventMap.set(key, {
                stationId: String(row.station_id || row.station_name),
                stationName: row.station_name,
                fuelType,
                price,
                observedAtMs: sourceUpdatedAtMs,
                sourceUpdatedAtMs,
                timestampMs: sourceUpdatedAtMs,
                lat: toFiniteNumber(row.latitude),
                lon: toFiniteNumber(row.longitude),
            });
        }
    }

    return [...eventMap.values()].sort((left, right) => (
        left.observedAtMs - right.observedAtMs ||
        String(left.stationId || '').localeCompare(String(right.stationId || '')) ||
        String(left.fuelType || '').localeCompare(String(right.fuelType || ''))
    ));
}

function createMetricBucket() {
    return {
        count: 0,
        mae: 0,
        rmse: 0,
        within5: 0,
        within10: 0,
        usedPrediction: 0,
        wins: 0,
        byFuel: {},
    };
}

function addMetric(bucket, sample) {
    const absoluteError = Math.abs(sample.error);
    bucket.count += 1;
    bucket.mae += absoluteError;
    bucket.rmse += absoluteError ** 2;
    bucket.usedPrediction += sample.usedPrediction ? 1 : 0;
    bucket.wins += sample.improved ? 1 : 0;

    if (absoluteError <= 0.05) {
        bucket.within5 += 1;
    }

    if (absoluteError <= 0.10) {
        bucket.within10 += 1;
    }

    if (!bucket.byFuel[sample.fuelType]) {
        bucket.byFuel[sample.fuelType] = createMetricBucket();
    }

    const fuelBucket = bucket.byFuel[sample.fuelType];
    fuelBucket.count += 1;
    fuelBucket.mae += absoluteError;
    fuelBucket.rmse += absoluteError ** 2;
    fuelBucket.usedPrediction += sample.usedPrediction ? 1 : 0;
    fuelBucket.wins += sample.improved ? 1 : 0;

    if (absoluteError <= 0.05) {
        fuelBucket.within5 += 1;
    }

    if (absoluteError <= 0.10) {
        fuelBucket.within10 += 1;
    }
}

function finalizeMetricBucket(bucket) {
    return {
        count: bucket.count,
        mae: roundPrice(bucket.mae / Math.max(1, bucket.count)),
        rmse: roundPrice(Math.sqrt(bucket.rmse / Math.max(1, bucket.count))),
        within5: roundPrice(bucket.within5 / Math.max(1, bucket.count)),
        within10: roundPrice(bucket.within10 / Math.max(1, bucket.count)),
        usedPredictionRate: roundPrice(bucket.usedPrediction / Math.max(1, bucket.count)),
        winRate: roundPrice(bucket.wins / Math.max(1, bucket.count)),
        byFuel: Object.fromEntries(
            Object.entries(bucket.byFuel).map(([fuelType, fuelBucket]) => [
                fuelType,
                finalizeMetricBucket({ ...fuelBucket, byFuel: {} }),
            ])
        ),
    };
}

function evaluateReplayBacktest(events) {
    const history = [];
    const previousByStationFuel = new Map();
    const rawMetrics = createMetricBucket();
    const algorithmMetrics = createMetricBucket();
    const replayRows = [];

    for (const event of events) {
        const stationFuelKey = `${event.stationId}|${event.fuelType}`;
        const previousEvent = previousByStationFuel.get(stationFuelKey);

        if (previousEvent && history.length >= 25) {
            const replayRow = {
                ...previousEvent,
                observedAtMs: event.observedAtMs,
                timestampMs: event.observedAtMs,
                sourceUpdatedAtMs: previousEvent.sourceUpdatedAtMs,
                price: previousEvent.price,
            };
            const state = buildValidationState(history);
            const result = validateAndChoosePrice(replayRow, state.context, state.rawApiHistory);
            const rawError = roundPrice(replayRow.price - event.price);
            const algorithmError = roundPrice(result.finalDisplayedPrice - event.price);
            const changed = Math.abs(rawError) >= 0.01;

            addMetric(rawMetrics, {
                fuelType: event.fuelType,
                error: rawError,
                usedPrediction: false,
                improved: false,
            });
            addMetric(algorithmMetrics, {
                fuelType: event.fuelType,
                error: algorithmError,
                usedPrediction: result.usedPrediction,
                improved: Math.abs(algorithmError) < Math.abs(rawError),
            });

            replayRows.push({
                stationId: event.stationId,
                stationName: event.stationName,
                fuelType: event.fuelType,
                stalePrice: replayRow.price,
                actualPrice: event.price,
                rawError,
                algorithmError,
                changed,
                usedPrediction: result.usedPrediction,
                decision: result.decision,
                sourceAgeHours: result.prediction?.sourceAgeHours ?? 0,
            });
        }

        history.push(event);
        previousByStationFuel.set(stationFuelKey, event);
    }

    return {
        replayRows,
        baselineRaw: finalizeMetricBucket(rawMetrics),
        currentAlgorithm: finalizeMetricBucket(algorithmMetrics),
    };
}

function summarizeSubset(rows) {
    const rawMetrics = createMetricBucket();
    const algorithmMetrics = createMetricBucket();

    for (const row of rows) {
        addMetric(rawMetrics, {
            fuelType: row.fuelType,
            error: row.rawError,
            usedPrediction: false,
            improved: false,
        });
        addMetric(algorithmMetrics, {
            fuelType: row.fuelType,
            error: row.algorithmError,
            usedPrediction: row.usedPrediction,
            improved: Math.abs(row.algorithmError) < Math.abs(row.rawError),
        });
    }

    return {
        baselineRaw: finalizeMetricBucket(rawMetrics),
        currentAlgorithm: finalizeMetricBucket(algorithmMetrics),
    };
}

async function main() {
    const supabase = createClient(
        app.expo.extra.supabase.url,
        app.expo.extra.supabase.key
    );
    const rows = await fetchAllStationPriceRows(supabase);
    const events = buildUniqueSourceEvents(rows);
    const evaluation = evaluateReplayBacktest(events);
    const replayRows = evaluation.replayRows;
    const lowReplayRegularChanged = replayRows.filter(row => (
        row.fuelType === 'regular' &&
        row.stalePrice < 3.39 &&
        row.sourceAgeHours >= 6 &&
        row.changed
    ));

    const output = {
        totals: {
            storedRows: rows.length,
            uniqueSourceEvents: events.length,
            replayEvaluations: replayRows.length,
        },
        replayBacktest: {
            baselineRaw: evaluation.baselineRaw,
            currentAlgorithm: evaluation.currentAlgorithm,
        },
        focusedLowReplayRegularChanged: summarizeSubset(lowReplayRegularChanged),
        examples: replayRows
            .filter(row => (
                row.fuelType === 'regular' &&
                row.sourceAgeHours >= 6 &&
                Math.abs(row.rawError) >= 0.25
            ))
            .slice(0, 8),
    };

    console.log(JSON.stringify(output, null, 2));
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
