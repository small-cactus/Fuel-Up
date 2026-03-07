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

function getPriorRows(allRows, nowMs, fuelType) {
    return (allRows || []).filter(row => (
        row &&
        row.timestampMs < nowMs &&
        row.fuelType === fuelType
    ));
}

function latestPriorPerStation(rows, nowMs) {
    const latestByStation = new Map();

    for (const row of rows || []) {
        if (!row || row.timestampMs >= nowMs) {
            continue;
        }

        const stationKey = String(row.stationId || '');
        const previousRow = latestByStation.get(stationKey);

        if (!previousRow || row.timestampMs > previousRow.timestampMs) {
            latestByStation.set(stationKey, row);
        }
    }

    return latestByStation;
}

function weightedMedian(values) {
    const candidates = (values || [])
        .filter(value => value && toFiniteNumber(value.value) !== null && toFiniteNumber(value.weight) !== null && value.weight > 0)
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

function estimateLocalMarket(row, trustedRows) {
    const priorRows = getPriorRows(trustedRows, row.timestampMs, row.fuelType);
    const latestByStation = latestPriorPerStation(priorRows, row.timestampMs);
    const tiers = [
        { maxMiles: 4, maxAgeHours: 72, distanceDecay: 2, timeDecay: 24, minStations: 3 },
        { maxMiles: 8, maxAgeHours: 144, distanceDecay: 4, timeDecay: 36, minStations: 3 },
        { maxMiles: 20, maxAgeHours: 168, distanceDecay: 8, timeDecay: 48, minStations: 2 },
    ];

    for (const tier of tiers) {
        const neighbors = [];

        for (const [, candidate] of latestByStation) {
            if (String(candidate.stationId || '') === String(row.stationId || '')) {
                continue;
            }

            const distanceMiles = haversineMiles(row.lat, row.lon, candidate.lat, candidate.lon);
            const ageHours = (row.timestampMs - candidate.timestampMs) / (1000 * 60 * 60);

            if (!Number.isFinite(distanceMiles) || distanceMiles > tier.maxMiles || ageHours > tier.maxAgeHours) {
                continue;
            }

            const distanceWeight = Math.exp(-distanceMiles / tier.distanceDecay);
            const timeWeight = Math.exp(-ageHours / tier.timeDecay);
            const weight = distanceWeight * timeWeight;

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
                price: normalizePrice(
                    weightedMedian(neighbors.map(neighbor => ({
                        value: neighbor.price,
                        weight: neighbor.weight,
                    })))
                ),
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

function estimateStationOffset(row, trustedRows) {
    const stationRows = (trustedRows || [])
        .filter(candidate => (
            candidate &&
            candidate.stationId === row.stationId &&
            candidate.fuelType === row.fuelType &&
            candidate.timestampMs < row.timestampMs
        ))
        .sort((left, right) => left.timestampMs - right.timestampMs);
    const residuals = [];

    for (const candidate of stationRows) {
        const historicalMarket = estimateLocalMarket(
            candidate,
            trustedRows.filter(trustedRow => trustedRow.timestampMs < candidate.timestampMs)
        ).price;

        if (historicalMarket === null) {
            continue;
        }

        residuals.push(candidate.price - historicalMarket);
    }

    const rawOffset = median(residuals) ?? 0;
    const sampleCount = residuals.length;
    const shrinkFactor = Math.min(1, sampleCount / 5);

    return {
        offset: normalizePrice(rawOffset * shrinkFactor) ?? 0,
        sampleCount,
        stationHistoryCount: stationRows.length,
    };
}

function estimateCarryForward(row, trustedRows) {
    const stationRows = (trustedRows || [])
        .filter(candidate => (
            candidate &&
            candidate.stationId === row.stationId &&
            candidate.fuelType === row.fuelType &&
            candidate.timestampMs < row.timestampMs
        ))
        .sort((left, right) => right.timestampMs - left.timestampMs);

    if (stationRows.length === 0) {
        return {
            price: null,
            ageHours: null,
            stationHistoryCount: 0,
        };
    }

    const lastTrustedRow = stationRows[0];
    const ageHours = (row.timestampMs - lastTrustedRow.timestampMs) / (1000 * 60 * 60);
    const marketNow = estimateLocalMarket(row, trustedRows).price;

    if (marketNow === null) {
        return {
            price: lastTrustedRow.price,
            ageHours,
            stationHistoryCount: stationRows.length,
        };
    }

    const marketThen = estimateLocalMarket(
        lastTrustedRow,
        trustedRows.filter(candidate => candidate.timestampMs < lastTrustedRow.timestampMs)
    ).price;

    if (marketThen === null) {
        return {
            price: lastTrustedRow.price,
            ageHours,
            stationHistoryCount: stationRows.length,
        };
    }

    return {
        price: normalizePrice(lastTrustedRow.price + (marketNow - marketThen)),
        ageHours,
        stationHistoryCount: stationRows.length,
    };
}

function predictStationPrice(row, trustedRows) {
    const marketEstimate = estimateLocalMarket(row, trustedRows);
    const offsetResult = estimateStationOffset(row, trustedRows);
    const carryResult = estimateCarryForward(row, trustedRows);
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
        directPrice,
        carryPrice,
        stationOffset: offsetResult.offset,
        carryAgeHours: carryResult.ageHours,
        stationOffsetSampleCount: offsetResult.sampleCount,
        stationHistoryCount: Math.max(offsetResult.stationHistoryCount, carryResult.stationHistoryCount || 0),
    };
}

function estimateRobustSigma(row, trustedRows) {
    const marketEstimate = estimateLocalMarket(row, trustedRows);
    const nearbyPrices = marketEstimate.neighbors.map(neighbor => neighbor.price);
    const nearbyMad = mad(nearbyPrices);
    const stationRows = (trustedRows || []).filter(candidate => (
        candidate &&
        candidate.stationId === row.stationId &&
        candidate.fuelType === row.fuelType &&
        candidate.timestampMs < row.timestampMs
    ));
    const stationResiduals = [];

    for (const candidate of stationRows) {
        const historicalMarket = estimateLocalMarket(
            candidate,
            trustedRows.filter(trustedRow => trustedRow.timestampMs < candidate.timestampMs)
        ).price;

        if (historicalMarket !== null) {
            stationResiduals.push(candidate.price - historicalMarket);
        }
    }

    const stationMad = mad(stationResiduals);

    return Math.max(
        0.08,
        toFiniteNumber(nearbyMad) || 0,
        toFiniteNumber(stationMad) || 0
    );
}

function staleMatchScore(row, trustedRows, predictedPrice) {
    if (predictedPrice === null) {
        return 0;
    }

    const stationRows = (trustedRows || []).filter(candidate => (
        candidate &&
        candidate.stationId === row.stationId &&
        candidate.fuelType === row.fuelType &&
        candidate.timestampMs < row.timestampMs
    ));
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

function plateauScore(row, rawApiHistory, predictedPrice) {
    if (predictedPrice === null) {
        return 0;
    }

    const stationRows = (rawApiHistory || [])
        .filter(candidate => (
            candidate &&
            candidate.stationId === row.stationId &&
            candidate.fuelType === row.fuelType &&
            candidate.timestampMs < row.timestampMs
        ))
        .sort((left, right) => right.timestampMs - left.timestampMs)
        .slice(0, 3);

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

function jumpScore(row, trustedRows, prediction, sigma) {
    const stationRows = (trustedRows || [])
        .filter(candidate => (
            candidate &&
            candidate.stationId === row.stationId &&
            candidate.fuelType === row.fuelType &&
            candidate.timestampMs < row.timestampMs
        ))
        .sort((left, right) => right.timestampMs - left.timestampMs);

    if (stationRows.length === 0 || prediction.localMarketPrice === null) {
        return 0;
    }

    const lastTrustedRow = stationRows[0];
    const marketThen = estimateLocalMarket(
        lastTrustedRow,
        trustedRows.filter(candidate => candidate.timestampMs < lastTrustedRow.timestampMs)
    ).price;

    if (marketThen === null) {
        return 0;
    }

    const stationMove = row.price - lastTrustedRow.price;
    const marketMove = prediction.localMarketPrice - marketThen;
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

function scoreApiPrice(row, prediction, trustedRows, rawApiHistory) {
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

    const sigma = estimateRobustSigma(row, trustedRows);
    const basicAnomalies = anomalyScores(row.price, predictedPrice, sigma);
    const stale = staleMatchScore(row, trustedRows, predictedPrice);
    const plateau = plateauScore(row, rawApiHistory, predictedPrice);
    const jump = jumpScore(row, trustedRows, prediction, sigma);
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

function validateAndChoosePrice(row, trustedRows, rawApiHistory) {
    const prediction = predictStationPrice(row, trustedRows);
    const score = scoreApiPrice(row, prediction, trustedRows, rawApiHistory);
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
        : row.price;

    return {
        finalDisplayedPrice: normalizePrice(finalDisplayedPrice),
        usedPrediction: shouldUsePrediction,
        predictedPrice: normalizePrice(score.predictedPrice),
        apiPrice: normalizePrice(row.price),
        decision: resolvedDecision,
        validity: score.validity,
        risk: score.risk,
        isColdStart,
        prediction,
        features: score.features,
    };
}

function sortRowsAscending(rows) {
    return [...(rows || [])].sort((left, right) => {
        if (left.timestampMs !== right.timestampMs) {
            return left.timestampMs - right.timestampMs;
        }

        return String(left.stationId || '').localeCompare(String(right.stationId || ''));
    });
}

function buildValidationState(rows) {
    const sortedRows = sortRowsAscending(rows);
    const rawApiHistory = [];
    const trustedRows = [];
    const outputs = [];

    for (const row of sortedRows) {
        const result = validateAndChoosePrice(row, trustedRows, rawApiHistory);

        outputs.push({
            row,
            result,
        });

        rawApiHistory.push(row);

        if (result.decision === 'accept') {
            trustedRows.push({
                ...row,
                source: 'api',
            });
        }
    }

    return {
        rawApiHistory,
        trustedRows,
        outputs,
    };
}

module.exports = {
    buildValidationState,
    clamp01,
    estimateLocalMarket,
    haversineMiles,
    normalizePrice,
    predictStationPrice,
    scoreApiPrice,
    validateAndChoosePrice,
};
