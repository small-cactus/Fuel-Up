const MARKET_TIERS = [
    { maxMiles: 4, maxAgeHours: 72, distanceDecay: 2, timeDecay: 24, minStations: 3 },
    { maxMiles: 8, maxAgeHours: 144, distanceDecay: 4, timeDecay: 36, minStations: 3 },
    { maxMiles: 20, maxAgeHours: 168, distanceDecay: 8, timeDecay: 48, minStations: 2 },
];
const MAX_RAW_STATION_HISTORY = 6;

function toFiniteNumber(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : null;
}

function normalizePrice(value) {
    const numericValue = toFiniteNumber(value);

    if (numericValue === null) {
        return null;
    }

    return Number(numericValue.toFixed(3));
}

function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}

function median(numbers) {
    if (!Array.isArray(numbers) || numbers.length === 0) {
        return null;
    }

    const sorted = [...numbers]
        .map(toFiniteNumber)
        .filter(value => value !== null)
        .sort((left, right) => left - right);

    if (sorted.length === 0) {
        return null;
    }

    const middleIndex = Math.floor(sorted.length / 2);

    return sorted.length % 2 === 1
        ? sorted[middleIndex]
        : (sorted[middleIndex - 1] + sorted[middleIndex]) / 2;
}

function mad(numbers) {
    const center = median(numbers);

    if (center === null) {
        return null;
    }

    return median(
        numbers
            .map(toFiniteNumber)
            .filter(value => value !== null)
            .map(value => Math.abs(value - center))
    );
}

function haversineMiles(lat1, lon1, lat2, lon2) {
    const points = [lat1, lon1, lat2, lon2].map(toFiniteNumber);

    if (points.some(value => value === null)) {
        return Number.POSITIVE_INFINITY;
    }

    const [normalizedLat1, normalizedLon1, normalizedLat2, normalizedLon2] = points;
    const toRadians = degrees => (degrees * Math.PI) / 180;
    const earthRadiusMiles = 3958.8;
    const latitudeDelta = toRadians(normalizedLat2 - normalizedLat1);
    const longitudeDelta = toRadians(normalizedLon2 - normalizedLon1);
    const haversine = (
        Math.sin(latitudeDelta / 2) ** 2 +
        Math.cos(toRadians(normalizedLat1)) *
        Math.cos(toRadians(normalizedLat2)) *
        Math.sin(longitudeDelta / 2) ** 2
    );

    return 2 * earthRadiusMiles * Math.asin(Math.sqrt(haversine));
}

function weightedMedian(values) {
    const candidates = (values || [])
        .filter(value => (
            value &&
            toFiniteNumber(value.value) !== null &&
            toFiniteNumber(value.weight) !== null &&
            value.weight > 0
        ))
        .sort((left, right) => left.value - right.value);

    if (candidates.length === 0) {
        return null;
    }

    const totalWeight = candidates.reduce((sum, candidate) => sum + candidate.weight, 0);
    let runningWeight = 0;

    for (const candidate of candidates) {
        runningWeight += candidate.weight;

        if (runningWeight >= totalWeight / 2) {
            return candidate.value;
        }
    }

    return candidates[candidates.length - 1].value;
}

function sortRowsAscending(rows) {
    return [...(rows || [])].sort((left, right) => {
        if (left.timestampMs !== right.timestampMs) {
            return left.timestampMs - right.timestampMs;
        }

        const stationComparison = String(left.stationId || '').localeCompare(String(right.stationId || ''));
        if (stationComparison !== 0) {
            return stationComparison;
        }

        return String(left.fuelType || '').localeCompare(String(right.fuelType || ''));
    });
}

function groupRowsByTimestamp(rows) {
    const groups = [];

    for (const row of rows || []) {
        const lastGroup = groups[groups.length - 1];

        if (!lastGroup || lastGroup.timestampMs !== row.timestampMs) {
            groups.push({
                timestampMs: row.timestampMs,
                rows: [row],
            });
            continue;
        }

        lastGroup.rows.push(row);
    }

    return groups;
}

function cloneRow(row) {
    return {
        ...row,
        price: normalizePrice(row?.price),
        marketPrice: normalizePrice(row?.marketPrice),
    };
}

function createFuelState() {
    return {
        latestTrustedByStation: new Map(),
        trustedByStation: new Map(),
        residualsByStation: new Map(),
        rawByStation: new Map(),
    };
}

function createValidationContext() {
    return {
        __validationContext: true,
        rawApiHistory: [],
        trustedRows: [],
        outputs: [],
        fuelStates: new Map(),
    };
}

function getFuelState(context, fuelType) {
    const normalizedFuelType = String(fuelType || 'regular').toLowerCase();

    if (!context.fuelStates.has(normalizedFuelType)) {
        context.fuelStates.set(normalizedFuelType, createFuelState());
    }

    return context.fuelStates.get(normalizedFuelType);
}

function getStationTrustedHistory(fuelState, stationId) {
    return fuelState.trustedByStation.get(String(stationId || '')) || [];
}

function getStationResiduals(fuelState, stationId) {
    return fuelState.residualsByStation.get(String(stationId || '')) || [];
}

function getStationRawHistory(fuelState, stationId) {
    return fuelState.rawByStation.get(String(stationId || '')) || [];
}

function estimateLocalMarketFromContext(row, context) {
    const fuelState = getFuelState(context, row.fuelType);
    const latestTrustedRows = Array.from(fuelState.latestTrustedByStation.values());

    for (const tier of MARKET_TIERS) {
        const neighbors = [];

        for (const candidate of latestTrustedRows) {
            if (String(candidate.stationId || '') === String(row.stationId || '')) {
                continue;
            }

            const distanceMiles = haversineMiles(row.lat, row.lon, candidate.lat, candidate.lon);
            const ageHours = (row.timestampMs - candidate.timestampMs) / (1000 * 60 * 60);

            if (!Number.isFinite(distanceMiles) || distanceMiles > tier.maxMiles || ageHours > tier.maxAgeHours) {
                continue;
            }

            const weight = Math.exp(-distanceMiles / tier.distanceDecay) * Math.exp(-ageHours / tier.timeDecay);

            neighbors.push({
                stationId: candidate.stationId,
                price: candidate.price,
                ageHours,
                distanceMiles,
                weight,
            });
        }

        if (neighbors.length >= tier.minStations) {
            return {
                price: normalizePrice(weightedMedian(neighbors.map(neighbor => ({
                    value: neighbor.price,
                    weight: neighbor.weight,
                })))),
                neighborCount: neighbors.length,
                neighbors,
            };
        }
    }

    return {
        price: null,
        neighborCount: 0,
        neighbors: [],
    };
}

function estimateStationOffsetFromContext(row, context) {
    const fuelState = getFuelState(context, row.fuelType);
    const residuals = getStationResiduals(fuelState, row.stationId);
    const rawOffset = median(residuals) ?? 0;
    const sampleCount = residuals.length;
    const shrinkFactor = Math.min(1, sampleCount / 5);

    return {
        offset: normalizePrice(rawOffset * shrinkFactor) ?? 0,
        sampleCount,
        stationHistoryCount: getStationTrustedHistory(fuelState, row.stationId).length,
    };
}

function estimateCarryForwardFromContext(row, context, marketNow) {
    const fuelState = getFuelState(context, row.fuelType);
    const stationRows = getStationTrustedHistory(fuelState, row.stationId);

    if (stationRows.length === 0) {
        return {
            price: null,
            ageHours: null,
            stationHistoryCount: 0,
        };
    }

    const lastTrustedRow = stationRows[stationRows.length - 1];
    const ageHours = (row.timestampMs - lastTrustedRow.timestampMs) / (1000 * 60 * 60);

    if (marketNow === null || lastTrustedRow.marketPrice === null) {
        return {
            price: lastTrustedRow.price,
            ageHours,
            stationHistoryCount: stationRows.length,
        };
    }

    return {
        price: normalizePrice(lastTrustedRow.price + (marketNow - lastTrustedRow.marketPrice)),
        ageHours,
        stationHistoryCount: stationRows.length,
    };
}

function predictStationPriceFromContext(row, context) {
    const marketEstimate = estimateLocalMarketFromContext(row, context);
    const offsetResult = estimateStationOffsetFromContext(row, context);
    const carryResult = estimateCarryForwardFromContext(row, context, marketEstimate.price);
    const directPrice = marketEstimate.price === null
        ? null
        : normalizePrice(marketEstimate.price + offsetResult.offset);
    const carryPrice = normalizePrice(carryResult.price);
    let predictedPrice = null;

    if (directPrice !== null && carryPrice !== null) {
        const ageHours = carryResult.ageHours ?? 999;
        let carryWeight = Math.exp(-ageHours / 48);

        if (offsetResult.sampleCount < 2 && ageHours <= 36) {
            carryWeight = Math.max(carryWeight, 0.75);
        }

        predictedPrice = normalizePrice((carryWeight * carryPrice) + ((1 - carryWeight) * directPrice));
    } else if (carryPrice !== null) {
        predictedPrice = carryPrice;
    } else if (directPrice !== null) {
        predictedPrice = directPrice;
    }

    return {
        predictedPrice,
        localMarketPrice: marketEstimate.price,
        localMarketNeighborCount: marketEstimate.neighborCount,
        localMarketNeighbors: marketEstimate.neighbors,
        directPrice,
        carryPrice,
        stationOffset: offsetResult.offset,
        carryAgeHours: carryResult.ageHours,
        stationOffsetSampleCount: offsetResult.sampleCount,
        stationHistoryCount: Math.max(offsetResult.stationHistoryCount, carryResult.stationHistoryCount || 0),
    };
}

function estimateRobustSigmaFromContext(row, context, prediction) {
    const fuelState = getFuelState(context, row.fuelType);
    const nearbyMad = mad((prediction.localMarketNeighbors || []).map(neighbor => neighbor.price));
    const stationMad = mad(getStationResiduals(fuelState, row.stationId));

    return Math.max(
        0.08,
        toFiniteNumber(nearbyMad) || 0,
        toFiniteNumber(stationMad) || 0
    );
}

function staleMatchScoreFromContext(row, context, predictedPrice) {
    if (predictedPrice === null) {
        return 0;
    }

    const fuelState = getFuelState(context, row.fuelType);
    const stationRows = getStationTrustedHistory(fuelState, row.stationId);
    let bestDifference = Number.POSITIVE_INFINITY;

    for (const candidate of stationRows) {
        const ageHours = (row.timestampMs - candidate.timestampMs) / (1000 * 60 * 60);

        if (ageHours < 36 || ageHours > 168) {
            continue;
        }

        bestDifference = Math.min(bestDifference, Math.abs(row.price - candidate.price));
    }

    const gap = predictedPrice - row.price;

    if (bestDifference <= 0.02 && gap >= 0.12) return 1;
    if (bestDifference <= 0.03 && gap >= 0.08) return 0.6;
    return 0;
}

function plateauScoreFromContext(row, context, predictedPrice) {
    if (predictedPrice === null) {
        return 0;
    }

    const fuelState = getFuelState(context, row.fuelType);
    const stationRows = getStationRawHistory(fuelState, row.stationId).slice(-3);

    if (stationRows.length < 2) {
        return 0;
    }

    const repeatedPrice = stationRows.every(candidate => Math.abs(candidate.price - row.price) <= 0.01);

    if (!repeatedPrice) {
        return 0;
    }

    const gap = predictedPrice - row.price;

    if (gap >= 0.15) return 1;
    if (gap >= 0.10) return 0.5;
    return 0;
}

function jumpScoreFromContext(row, context, prediction, sigma) {
    const fuelState = getFuelState(context, row.fuelType);
    const stationRows = getStationTrustedHistory(fuelState, row.stationId);

    if (stationRows.length === 0 || prediction.localMarketPrice === null) {
        return 0;
    }

    const lastTrustedRow = stationRows[stationRows.length - 1];

    if (lastTrustedRow.marketPrice === null) {
        return 0;
    }

    const stationMove = row.price - lastTrustedRow.price;
    const marketMove = prediction.localMarketPrice - lastTrustedRow.marketPrice;
    const residual = Math.abs(stationMove - marketMove);

    return clamp01(residual / Math.max(0.20, 1.5 * sigma));
}

function anomalyScores(apiPrice, predictedPrice, sigma) {
    if (predictedPrice === null) {
        return {
            low: 0,
            abs: 0,
        };
    }

    const lowGap = Math.max(0, predictedPrice - apiPrice);
    const absoluteGap = Math.abs(predictedPrice - apiPrice);

    return {
        low: clamp01(lowGap / (2.5 * sigma)),
        abs: clamp01(absoluteGap / (5 * sigma)),
    };
}

function scoreApiPriceFromContext(row, context, prediction) {
    const predictedPrice = prediction.predictedPrice;

    if (predictedPrice === null) {
        return {
            predictedPrice: null,
            validity: 0.5,
            risk: 0.5,
            decision: 'quarantine',
            features: {
                low: 0,
                abs: 0,
                stale: 0,
                plateau: 0,
                jump: 0,
                sigma: 0.08,
            },
        };
    }

    const sigma = estimateRobustSigmaFromContext(row, context, prediction);
    const basicAnomalies = anomalyScores(row.price, predictedPrice, sigma);
    const stale = staleMatchScoreFromContext(row, context, predictedPrice);
    const plateau = plateauScoreFromContext(row, context, predictedPrice);
    const jump = jumpScoreFromContext(row, context, prediction, sigma);
    const risk = (
        (0.42 * basicAnomalies.low) +
        (0.23 * stale) +
        (0.15 * jump) +
        (0.10 * plateau) +
        (0.10 * basicAnomalies.abs)
    );
    const validity = 1 - risk;
    let decision = 'quarantine';

    if (
        (basicAnomalies.low >= 1 && stale >= 0.6) ||
        (plateau >= 1 && (predictedPrice - row.price) >= 0.25)
    ) {
        decision = 'reject';
    } else if (validity >= 0.65) {
        decision = 'accept';
    } else if (validity < 0.40) {
        decision = 'reject';
    }

    return {
        predictedPrice,
        validity,
        risk,
        decision,
        features: {
            low: basicAnomalies.low,
            abs: basicAnomalies.abs,
            stale,
            plateau,
            jump,
            sigma,
        },
    };
}

function appendRawRowToContext(row, context) {
    context.rawApiHistory.push(cloneRow(row));

    const fuelState = getFuelState(context, row.fuelType);
    const stationKey = String(row.stationId || '');
    const rawHistory = getStationRawHistory(fuelState, stationKey).slice(-(MAX_RAW_STATION_HISTORY - 1));

    rawHistory.push(cloneRow(row));
    fuelState.rawByStation.set(stationKey, rawHistory);
}

function appendTrustedRowToContext(row, context, marketPrice) {
    const normalizedRow = {
        ...cloneRow(row),
        source: 'api',
        marketPrice: normalizePrice(marketPrice),
    };
    const fuelState = getFuelState(context, row.fuelType);
    const stationKey = String(row.stationId || '');
    const trustedHistory = getStationTrustedHistory(fuelState, stationKey).slice();
    const residuals = getStationResiduals(fuelState, stationKey).slice();

    trustedHistory.push(normalizedRow);
    fuelState.trustedByStation.set(stationKey, trustedHistory);
    fuelState.latestTrustedByStation.set(stationKey, normalizedRow);

    if (normalizedRow.marketPrice !== null) {
        residuals.push(normalizePrice(normalizedRow.price - normalizedRow.marketPrice));
        fuelState.residualsByStation.set(stationKey, residuals);
    } else if (!fuelState.residualsByStation.has(stationKey)) {
        fuelState.residualsByStation.set(stationKey, residuals);
    }

    context.trustedRows.push(normalizedRow);
}

function evaluateRowAgainstContext(row, context) {
    const normalizedRow = cloneRow(row);
    const prediction = predictStationPriceFromContext(normalizedRow, context);
    const score = scoreApiPriceFromContext(normalizedRow, context, prediction);
    const isColdStart = prediction.localMarketNeighborCount < 2 && prediction.stationHistoryCount === 0;
    const resolvedDecision = isColdStart && score.predictedPrice === null
        ? 'accept'
        : score.decision;
    const shouldUsePrediction = (
        resolvedDecision !== 'accept' &&
        score.predictedPrice !== null &&
        !(isColdStart && resolvedDecision === 'quarantine')
    );
    const finalDisplayedPrice = shouldUsePrediction
        ? score.predictedPrice
        : normalizedRow.price;

    return {
        finalDisplayedPrice: normalizePrice(finalDisplayedPrice),
        usedPrediction: shouldUsePrediction,
        predictedPrice: normalizePrice(score.predictedPrice),
        apiPrice: normalizePrice(normalizedRow.price),
        decision: resolvedDecision,
        validity: score.validity,
        risk: score.risk,
        isColdStart,
        prediction,
        features: score.features,
    };
}

function processValidationRow(row, context, { persist = true } = {}) {
    const result = evaluateRowAgainstContext(row, context);

    if (persist) {
        appendRawRowToContext(row, context);

        if (result.decision === 'accept') {
            appendTrustedRowToContext(row, context, result.prediction.localMarketPrice);
        }

        context.outputs.push({
            row,
            result,
        });
    }

    return result;
}

function processValidationRows(rows, context, { persist = true } = {}) {
    const sortedRows = sortRowsAscending(rows);
    const timestampGroups = groupRowsByTimestamp(sortedRows);
    const results = [];

    for (const group of timestampGroups) {
        const groupResults = group.rows.map(row => ({
            row,
            result: evaluateRowAgainstContext(row, context),
        }));

        if (persist) {
            for (const entry of groupResults) {
                appendRawRowToContext(entry.row, context);
            }

            for (const entry of groupResults) {
                if (entry.result.decision === 'accept') {
                    appendTrustedRowToContext(entry.row, context, entry.result.prediction.localMarketPrice);
                }

                context.outputs.push(entry);
            }
        }

        results.push(...groupResults);
    }

    return results;
}

function buildValidationState(rows) {
    const context = createValidationContext();
    processValidationRows(rows, context, { persist: true });

    return {
        rawApiHistory: context.rawApiHistory,
        trustedRows: context.trustedRows,
        outputs: context.outputs,
        context,
    };
}

function createValidationContextFromHistories(trustedRows = [], rawApiHistory = []) {
    const context = createValidationContext();
    const sortedRawRows = sortRowsAscending(rawApiHistory);
    const sortedTrustedRows = sortRowsAscending(trustedRows);
    const trustedGroups = groupRowsByTimestamp(sortedTrustedRows);
    const rawGroups = groupRowsByTimestamp(sortedRawRows);
    let trustedIndex = 0;

    for (const group of rawGroups) {
        while (
            trustedIndex < trustedGroups.length &&
            trustedGroups[trustedIndex].timestampMs < group.timestampMs
        ) {
            for (const trustedRow of trustedGroups[trustedIndex].rows) {
                appendTrustedRowToContext(
                    trustedRow,
                    context,
                    trustedRow.marketPrice ?? estimateLocalMarketFromContext(trustedRow, context).price
                );
            }
            trustedIndex += 1;
        }

        for (const rawRow of group.rows) {
            appendRawRowToContext(rawRow, context);
        }

        while (
            trustedIndex < trustedGroups.length &&
            trustedGroups[trustedIndex].timestampMs === group.timestampMs
        ) {
            for (const trustedRow of trustedGroups[trustedIndex].rows) {
                appendTrustedRowToContext(
                    trustedRow,
                    context,
                    trustedRow.marketPrice ?? estimateLocalMarketFromContext(trustedRow, context).price
                );
            }
            trustedIndex += 1;
        }
    }

    while (trustedIndex < trustedGroups.length) {
        for (const trustedRow of trustedGroups[trustedIndex].rows) {
            appendTrustedRowToContext(
                trustedRow,
                context,
                trustedRow.marketPrice ?? estimateLocalMarketFromContext(trustedRow, context).price
            );
        }
        trustedIndex += 1;
    }

    return context;
}

function ensureValidationContext(trustedRowsOrContext, rawApiHistory = []) {
    if (trustedRowsOrContext?.__validationContext) {
        return trustedRowsOrContext;
    }

    return createValidationContextFromHistories(trustedRowsOrContext, rawApiHistory);
}

function estimateLocalMarket(row, trustedRowsOrContext) {
    const context = ensureValidationContext(trustedRowsOrContext, []);
    return estimateLocalMarketFromContext(row, context);
}

function predictStationPrice(row, trustedRowsOrContext) {
    const context = ensureValidationContext(trustedRowsOrContext, []);
    return predictStationPriceFromContext(row, context);
}

function scoreApiPrice(row, prediction, trustedRowsOrContext, rawApiHistory = []) {
    const context = ensureValidationContext(trustedRowsOrContext, rawApiHistory);
    return scoreApiPriceFromContext(row, context, prediction);
}

function validateAndChoosePrice(row, trustedRowsOrContext, rawApiHistory = []) {
    const context = ensureValidationContext(trustedRowsOrContext, rawApiHistory);
    return processValidationRow(row, context, { persist: false });
}

module.exports = {
    buildValidationState,
    clamp01,
    createValidationContext,
    estimateLocalMarket,
    haversineMiles,
    normalizePrice,
    predictStationPrice,
    processValidationRow,
    processValidationRows,
    scoreApiPrice,
    validateAndChoosePrice,
};
