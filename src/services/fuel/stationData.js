const { PROVIDER_LABELS, calculateDistanceMiles, pickFirstDefined } = require('./core');
const { buildValidationState, normalizePrice, processValidationRows, validateAndChoosePrice } = require('./priceValidation');
const AREA_HISTORY_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_AREA_HISTORY_ROWS = 1500;
const PRICE_VALIDATION_VERSION = 2;
const STANDARD_FUEL_TYPES = ['regular', 'midgrade', 'premium', 'diesel'];
function buildQuoteIdentity(quote) {
    if (!quote) {
        return '';
    }

    const providerId = String(quote.providerId || 'unknown');
    const stationId = quote.stationId ? String(quote.stationId) : '';

    if (stationId) {
        return `${providerId}:${stationId}`;
    }

    const latitude = Number(quote.latitude);
    const longitude = Number(quote.longitude);

    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
        return `${providerId}:coord:${latitude.toFixed(5)},${longitude.toFixed(5)}`;
    }

    return `${providerId}:${String(quote.stationName || 'station')}:${String(quote.address || 'address')}`;
}

function toPositiveNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function pickPreferredStoredPrice(entry) {
    if (entry === null || entry === undefined) {
        return null;
    }

    if (typeof entry === 'number' || typeof entry === 'string') {
        return toPositiveNumber(entry);
    }

    if (typeof entry !== 'object') {
        return null;
    }

    const creditPrice = toPositiveNumber(entry.credit);
    if (creditPrice !== null) {
        return creditPrice;
    }

    const cashPrice = toPositiveNumber(entry.cash);
    if (cashPrice !== null) {
        return cashPrice;
    }

    const directPrice = toPositiveNumber(entry.price);
    if (directPrice !== null) {
        return directPrice;
    }

    const valuePrice = toPositiveNumber(entry.value);
    if (valuePrice !== null) {
        return valuePrice;
    }

    return toPositiveNumber(entry.amount);
}

function resolveStoredFuelPrice({ allPrices, fuelType }) {
    if (!allPrices || typeof allPrices !== 'object') {
        return null;
    }

    const normalizedFuelType = String(fuelType || '').toLowerCase();
    const aliasesByFuelType = {
        regular: ['regular', 'regular_gas'],
        midgrade: ['midgrade', 'midgrade_gas'],
        premium: ['premium', 'premium_gas'],
        diesel: ['diesel'],
    };

    const aliases = aliasesByFuelType[normalizedFuelType] || [normalizedFuelType];
    const paymentMap = allPrices._payment && typeof allPrices._payment === 'object'
        ? allPrices._payment
        : {};

    for (const alias of aliases) {
        const paymentPrice = pickPreferredStoredPrice(paymentMap[alias]);
        if (paymentPrice !== null) {
            return paymentPrice;
        }
    }

    for (const alias of aliases) {
        const directPrice = pickPreferredStoredPrice(allPrices[alias]);
        if (directPrice !== null) {
            return directPrice;
        }
    }

    return null;
}

function normalizeStoredAllPrices(allPrices) {
    const normalized = {};

    for (const fuelType of STANDARD_FUEL_TYPES) {
        const resolved = resolveStoredFuelPrice({ allPrices, fuelType });
        if (resolved !== null) {
            normalized[fuelType] = resolved;
        }
    }

    return normalized;
}

function cloneQuotePayload(value) {
    if (!value || typeof value !== 'object') {
        return {};
    }

    return JSON.parse(JSON.stringify(value));
}

function normalizeFuelTypeName(value) {
    const normalizedFuelType = String(value || '').trim().toLowerCase();
    return STANDARD_FUEL_TYPES.includes(normalizedFuelType) ? normalizedFuelType : 'regular';
}

function extractStandardFuelPrices(allPrices) {
    if (!allPrices || typeof allPrices !== 'object') {
        return [];
    }

    return STANDARD_FUEL_TYPES
        .map(fuelType => ({
            fuelType,
            price: toPositiveNumber(allPrices[fuelType]),
        }))
        .filter(entry => entry.price !== null);
}

function getDuplicateGradePriceIssue(allPrices) {
    const standardFuelPrices = extractStandardFuelPrices(allPrices);

    if (standardFuelPrices.length < 2) {
        return null;
    }

    const firstFuelTypeByPrice = new Map();
    const visibleFuelTypes = [];
    const suppressedFuelTypes = [];

    for (const { fuelType, price } of standardFuelPrices) {
        const priceKey = Number(price).toFixed(3);

        if (firstFuelTypeByPrice.has(priceKey)) {
            suppressedFuelTypes.push(fuelType);
            continue;
        }

        firstFuelTypeByPrice.set(priceKey, fuelType);
        visibleFuelTypes.push(fuelType);
    }

    if (suppressedFuelTypes.length === 0) {
        return null;
    }

    return {
        visibleFuelTypes,
        suppressedFuelTypes,
        isUniform: visibleFuelTypes.length === 1,
        regularPrice: standardFuelPrices.find(entry => entry.fuelType === 'regular')?.price ?? null,
    };
}

function buildRegularOnlyAllPrices(allPrices, regularPrice) {
    const normalizedRegularPrice = toPositiveNumber(regularPrice);

    if (normalizedRegularPrice === null) {
        return {};
    }

    const nextAllPrices = {
        regular: normalizedRegularPrice,
    };
    const regularPayment = allPrices?._payment?.regular;

    if (regularPayment && typeof regularPayment === 'object') {
        const credit = toPositiveNumber(regularPayment.credit);
        const cash = toPositiveNumber(regularPayment.cash);

        if (credit !== null || cash !== null) {
            const selected = regularPayment.selected === 'cash'
                ? 'cash'
                : regularPayment.selected === 'credit'
                    ? 'credit'
                    : credit !== null
                        ? 'credit'
                        : 'cash';
            nextAllPrices._payment = {
                regular: {
                    credit,
                    cash,
                    selected,
                },
            };
        }
    }

    return nextAllPrices;
}

function buildVisibleGradeAllPrices(allPrices, visibleFuelTypes) {
    const visibleFuelTypeSet = new Set(visibleFuelTypes || []);
    const nextAllPrices = {};

    for (const fuelType of STANDARD_FUEL_TYPES) {
        if (!visibleFuelTypeSet.has(fuelType)) {
            continue;
        }

        const normalizedPrice = toPositiveNumber(allPrices?.[fuelType]);

        if (normalizedPrice !== null) {
            nextAllPrices[fuelType] = normalizedPrice;
        }
    }

    const paymentMap = allPrices?._payment && typeof allPrices._payment === 'object'
        ? allPrices._payment
        : null;

    if (paymentMap) {
        const nextPaymentMap = {};

        for (const fuelType of STANDARD_FUEL_TYPES) {
            if (!visibleFuelTypeSet.has(fuelType) || !paymentMap[fuelType]) {
                continue;
            }

            nextPaymentMap[fuelType] = cloneQuotePayload(paymentMap[fuelType]);
        }

        if (Object.keys(nextPaymentMap).length > 0) {
            nextAllPrices._payment = nextPaymentMap;
        }
    }

    return nextAllPrices;
}

function filterValidationByFuelType(validationByFuelType, visibleFuelTypes) {
    if (!validationByFuelType || typeof validationByFuelType !== 'object') {
        return {};
    }

    const nextValidationByFuelType = {};

    for (const fuelType of visibleFuelTypes || []) {
        if (validationByFuelType[fuelType]) {
            nextValidationByFuelType[fuelType] = validationByFuelType[fuelType];
        }
    }

    return nextValidationByFuelType;
}

function sanitizeStationGradeQuoteForFuelType(quote, requestedFuelType) {
    if (!quote || quote.providerTier !== 'station' || quote.isEstimated) {
        return quote;
    }

    const normalizedRequestedFuelType = normalizeFuelTypeName(requestedFuelType || quote.fuelType);
    const duplicateGradePriceIssue = getDuplicateGradePriceIssue(quote.allPrices);

    if (!duplicateGradePriceIssue) {
        return quote;
    }

    if (!duplicateGradePriceIssue.visibleFuelTypes.includes(normalizedRequestedFuelType)) {
        return null;
    }

    if (duplicateGradePriceIssue.isUniform && normalizedRequestedFuelType === 'regular' && duplicateGradePriceIssue.regularPrice !== null) {
        return {
            ...quote,
            fuelType: 'regular',
            price: duplicateGradePriceIssue.regularPrice,
            allPrices: buildRegularOnlyAllPrices(quote.allPrices, duplicateGradePriceIssue.regularPrice),
            validation: quote.validationByFuelType?.regular || (
                String(quote.validation?.fuelType || '').toLowerCase() === 'regular'
                    ? quote.validation
                    : null
            ),
            validationByFuelType: quote.validationByFuelType?.regular
                ? { regular: quote.validationByFuelType.regular }
                : {},
            availableFuelGrades: ['regular'],
            hasUniformGradePriceIssue: true,
            hasDuplicateGradePriceIssue: true,
            suppressedDuplicateFuelGrades: duplicateGradePriceIssue.suppressedFuelTypes,
        };
    }

    const nextAllPrices = buildVisibleGradeAllPrices(
        quote.allPrices,
        duplicateGradePriceIssue.visibleFuelTypes
    );
    const nextValidationByFuelType = filterValidationByFuelType(
        quote.validationByFuelType,
        duplicateGradePriceIssue.visibleFuelTypes
    );
    const nextPrice = toPositiveNumber(nextAllPrices[normalizedRequestedFuelType]) ?? (
        normalizeFuelTypeName(quote.fuelType) === normalizedRequestedFuelType
            ? toPositiveNumber(quote.price)
            : null
    );

    if (nextPrice === null) {
        return null;
    }

    return {
        ...quote,
        fuelType: normalizedRequestedFuelType,
        price: nextPrice,
        allPrices: nextAllPrices,
        validation: nextValidationByFuelType[normalizedRequestedFuelType] || (
            String(quote.validation?.fuelType || '').toLowerCase() === normalizedRequestedFuelType
                ? quote.validation
                : null
        ),
        validationByFuelType: nextValidationByFuelType,
        availableFuelGrades: duplicateGradePriceIssue.visibleFuelTypes,
        hasUniformGradePriceIssue: false,
        hasDuplicateGradePriceIssue: true,
        suppressedDuplicateFuelGrades: duplicateGradePriceIssue.suppressedFuelTypes,
    };
}

function sanitizeStationQuotesForFuelType(quotes, requestedFuelType) {
    return (quotes || [])
        .map(quote => sanitizeStationGradeQuoteForFuelType(quote, requestedFuelType))
        .filter(Boolean);
}

function sanitizeSnapshotForFuelType(snapshot, requestedFuelType) {
    if (!snapshot || typeof snapshot !== 'object') {
        return snapshot;
    }

    return {
        ...snapshot,
        quote: sanitizeStationGradeQuoteForFuelType(snapshot.quote, requestedFuelType),
        topStations: sanitizeStationQuotesForFuelType(snapshot.topStations, requestedFuelType),
    };
}

function toTimestampMs(value) {
    const timestampMs = Date.parse(value || '');
    return Number.isFinite(timestampMs) ? timestampMs : null;
}

function buildValidationStationId({ stationId, fallbackIdentity }) {
    const normalizedStationId = String(stationId || '').trim();
    return normalizedStationId || fallbackIdentity;
}

function buildValidationRowFromStoredRow({ row, origin, fallbackSourceLabel }) {
    const quote = mapStationPriceRowToQuote({ row, origin, fallbackSourceLabel });

    if (!quote) {
        return [];
    }

    const quoteIdentity = buildQuoteIdentity(quote);
    const observedAtMs = (
        toTimestampMs(row.created_at) ??
        toTimestampMs(row.updated_at_source) ??
        Date.now()
    );
    const sourceUpdatedAtMs = (
        toTimestampMs(row.updated_at_source) ??
        observedAtMs
    );
    const stationId = buildValidationStationId({
        stationId: row.station_id,
        fallbackIdentity: quoteIdentity,
    });
    const normalizedPrices = quote.allPrices && typeof quote.allPrices === 'object'
        ? quote.allPrices
        : { [quote.fuelType]: quote.price };

    return Object.entries(normalizedPrices)
        .filter(([fuelTypeKey, price]) => fuelTypeKey !== '_payment' && toPositiveNumber(price) !== null)
        .map(([fuelTypeKey, price]) => ({
            stationId,
            fuelType: String(fuelTypeKey || quote.fuelType || 'regular').toLowerCase(),
            price: toPositiveNumber(price),
            observedAtMs,
            sourceUpdatedAtMs,
            timestampMs: observedAtMs,
            lat: quote.latitude,
            lon: quote.longitude,
            quoteIdentity,
            originalRow: row,
            originalQuote: quote,
            baseFuelType: String(quote.fuelType || row.fuel_type || 'regular').toLowerCase(),
        }));
}

function buildValidationRowFromQuote(quote) {
    if (!quote) {
        return [];
    }

    const quoteIdentity = buildQuoteIdentity(quote);
    const observedAtMs = (
        toTimestampMs(quote.fetchedAt) ??
        Date.now()
    );
    const sourceUpdatedAtMs = (
        toTimestampMs(quote.updatedAt) ??
        observedAtMs
    );
    const stationId = buildValidationStationId({
        stationId: quote.stationId,
        fallbackIdentity: quoteIdentity,
    });
    const normalizedPrices = quote.allPrices && typeof quote.allPrices === 'object'
        ? quote.allPrices
        : { [quote.fuelType]: quote.price };

    return Object.entries(normalizedPrices)
        .filter(([fuelTypeKey, price]) => fuelTypeKey !== '_payment' && toPositiveNumber(price) !== null)
        .map(([fuelTypeKey, price]) => ({
            stationId,
            fuelType: String(fuelTypeKey || quote.fuelType || 'regular').toLowerCase(),
            price: toPositiveNumber(price),
            observedAtMs,
            sourceUpdatedAtMs,
            timestampMs: observedAtMs,
            lat: Number(quote.latitude),
            lon: Number(quote.longitude),
            quoteIdentity,
            originalQuote: quote,
            baseFuelType: String(quote.fuelType || 'regular').toLowerCase(),
        }));
}

function applyValidatedPriceToAllPrices(allPrices, fuelType, finalPrice) {
    const normalizedPrice = normalizePrice(finalPrice);

    if (normalizedPrice === null) {
        return allPrices || {};
    }

    const nextAllPrices = cloneQuotePayload(allPrices);

    nextAllPrices[fuelType] = normalizedPrice;

    return nextAllPrices;
}

function getQuoteValidationFuelTypes(quote) {
    const allPrices = quote?.allPrices;
    const grades = allPrices && typeof allPrices === 'object'
        ? Object.keys(allPrices).filter(key => key !== '_payment')
        : [];

    if (grades.length > 0) {
        return grades;
    }

    return [String(quote?.fuelType || 'regular').toLowerCase()];
}

function quoteHasCurrentValidation(quote) {
    if (!quote || !quote.validationByFuelType || typeof quote.validationByFuelType !== 'object') {
        return false;
    }

    return getQuoteValidationFuelTypes(quote).every(fuelType => (
        quote.validationByFuelType?.[fuelType]?.validationVersion === PRICE_VALIDATION_VERSION
    ));
}

function snapshotHasCurrentValidation(snapshot) {
    if (!snapshot) {
        return false;
    }

    const stationQuotes = [
        snapshot.quote,
        ...(Array.isArray(snapshot.topStations) ? snapshot.topStations : []),
    ].filter(quote => quote?.providerTier === 'station' && !quote?.isEstimated);

    if (stationQuotes.length === 0) {
        return true;
    }

    return stationQuotes.every(quoteHasCurrentValidation);
}

function applyGradeValidationToQuote(quote, fuelType, decision) {
    if (!quote || !decision || !fuelType) {
        return quote;
    }

    const finalDisplayedPrice = normalizePrice(decision.finalDisplayedPrice) ?? quote.price;
    const normalizedFuelType = String(fuelType).toLowerCase();
    const nextAllPrices = applyValidatedPriceToAllPrices(quote.allPrices, normalizedFuelType, finalDisplayedPrice);
    const nextValidationByFuelType = {
        ...(quote.validationByFuelType || {}),
        [normalizedFuelType]: {
            apiPrice: normalizePrice(decision.apiPrice),
            predictedPrice: normalizePrice(decision.predictedPrice),
            finalPrice: finalDisplayedPrice,
            usedPrediction: Boolean(decision.usedPrediction),
            adjustedPriceSafetyBuffer: Number(decision.adjustedPriceSafetyBuffer || 0),
            decision: decision.decision,
            validity: Number(decision.validity || 0),
            risk: Number(decision.risk || 0),
            isColdStart: Boolean(decision.isColdStart),
            prediction: decision.prediction || null,
            features: decision.features || null,
            computedAt: new Date().toISOString(),
            validationVersion: PRICE_VALIDATION_VERSION,
            fuelType: normalizedFuelType,
        },
    };
    const baseFuelType = String(quote.fuelType || normalizedFuelType).toLowerCase();
    const activeValidation = nextValidationByFuelType[baseFuelType] || quote.validation || null;

    return {
        ...quote,
        price: normalizedFuelType === baseFuelType ? finalDisplayedPrice : quote.price,
        allPrices: nextAllPrices,
        validation: activeValidation,
        validationByFuelType: nextValidationByFuelType,
    };
}

function buildValidatedLatestQuotesFromRows({ rows, origin, fallbackSourceLabel }) {
    if (!Array.isArray(rows) || rows.length === 0) {
        return [];
    }

    const validationRows = rows.flatMap(row => buildValidationRowFromStoredRow({ row, origin, fallbackSourceLabel }));
    const validationState = buildValidationState(validationRows);
    const latestTimestampByIdentity = new Map();
    const latestByIdentity = new Map();
    const sortedOutputs = [...validationState.outputs].sort((left, right) => (
        right.row.timestampMs - left.row.timestampMs
    ));
    const displayObservedAtMs = Date.now();

    for (const validationRow of validationRows) {
        const identity = validationRow.quoteIdentity;
        const previousTimestamp = latestTimestampByIdentity.get(identity) ?? Number.NEGATIVE_INFINITY;

        if (validationRow.timestampMs > previousTimestamp) {
            latestTimestampByIdentity.set(identity, validationRow.timestampMs);
        }
    }

    for (const output of sortedOutputs) {
        const latestTimestamp = latestTimestampByIdentity.get(output.row.quoteIdentity);

        if (latestTimestamp !== output.row.timestampMs) {
            continue;
        }

        const existingQuote = latestByIdentity.get(output.row.quoteIdentity);
        const quote = existingQuote || {
            ...output.row.originalQuote,
            allPrices: cloneQuotePayload(output.row.originalQuote?.allPrices),
            validationByFuelType: cloneQuotePayload(output.row.originalQuote?.validationByFuelType),
        };
        const identity = output.row.quoteIdentity || buildQuoteIdentity(quote);

        if (!quote || !identity) {
            continue;
        }

        const refreshedDecision = validateAndChoosePrice(
            {
                ...output.row,
                observedAtMs: displayObservedAtMs,
                timestampMs: displayObservedAtMs,
            },
            validationState.context,
            validationState.rawApiHistory
        );

        latestByIdentity.set(identity, applyGradeValidationToQuote(quote, output.row.fuelType, refreshedDecision));
    }

    return Array.from(latestByIdentity.values());
}

function applyValidationToStationQuotes({ stationQuotes, historyRows, origin }) {
    if (!Array.isArray(stationQuotes) || stationQuotes.length === 0) {
        return [];
    }

    const historyValidationRows = (historyRows || [])
        .flatMap(row => buildValidationRowFromStoredRow({ row, origin }));
    const historyState = buildValidationState(historyValidationRows);
    const validationContext = historyState.context;
    const decisionsByIdentity = new Map();
    const incomingRows = stationQuotes
        .flatMap(buildValidationRowFromQuote)
        .sort((left, right) => (
            left.timestampMs - right.timestampMs ||
            String(left.fuelType || '').localeCompare(String(right.fuelType || '')) ||
            String(left.stationId || '').localeCompare(String(right.stationId || ''))
        ));

    const processedResults = processValidationRows(incomingRows, validationContext);

    for (const { row, result } of processedResults) {
        const identity = row.quoteIdentity;
        const existingDecisions = decisionsByIdentity.get(identity) || {};

        existingDecisions[row.fuelType] = result;
        decisionsByIdentity.set(identity, existingDecisions);
    }

    return stationQuotes.map(quote => {
        if (quoteHasCurrentValidation(quote)) {
            return quote;
        }

        const identity = buildQuoteIdentity(quote);
        const decisions = decisionsByIdentity.get(identity);

        if (!decisions) {
            return quote;
        }

        return Object.entries(decisions).reduce(
            (nextQuote, [fuelType, decision]) => applyGradeValidationToQuote(nextQuote, fuelType, decision),
            {
                ...quote,
                allPrices: cloneQuotePayload(quote.allPrices),
                validationByFuelType: cloneQuotePayload(quote.validationByFuelType),
            }
        );
    });
}

async function fetchAreaHistoryRows({ supabase, searchLat, searchLng, fuelType }) {
    const lookbackStartIso = new Date(Date.now() - AREA_HISTORY_LOOKBACK_MS).toISOString();
    const { data, error } = await supabase
        .from('station_prices')
        .select('*')
        .eq('search_latitude_rounded', searchLat)
        .eq('search_longitude_rounded', searchLng)
        .eq('fuel_type', fuelType)
        .eq('provider_id', 'gasbuddy')
        .gte('created_at', lookbackStartIso)
        .order('created_at', { ascending: false })
        .limit(MAX_AREA_HISTORY_ROWS);

    return {
        data: Array.isArray(data) ? [...data].reverse() : [],
        error,
    };
}

function buildLatestQuotesFromRows({ rows, origin, fallbackSourceLabel }) {
    return buildValidatedLatestQuotesFromRows({ rows, origin, fallbackSourceLabel });
}

function mapStationPriceRowToQuote({ row, origin, fallbackSourceLabel }) {
    if (!row) {
        return null;
    }

    const normalizedAllPrices = normalizeStoredAllPrices(row.all_prices);
    const fuelType = String(row.fuel_type || 'regular').toLowerCase();
    const parsedPrice = resolveStoredFuelPrice({ allPrices: row.all_prices, fuelType }) ?? toPositiveNumber(row.price);
    const hasValidPrice = parsedPrice !== null;

    if (!hasValidPrice) {
        return null;
    }

    const latitude = Number(row.latitude);
    const longitude = Number(row.longitude);
    const hasCoordinates = Number.isFinite(latitude) && Number.isFinite(longitude);
    const stationCoords = hasCoordinates
        ? { latitude, longitude }
        : { latitude: origin.latitude, longitude: origin.longitude };

    const quote = {
        providerId: row.provider_id || 'gasbuddy',
        providerTier: 'station',
        stationId: row.station_id ? String(row.station_id) : '',
        stationName: row.station_name,
        address: row.address,
        latitude: stationCoords.latitude,
        longitude: stationCoords.longitude,
        fuelType,
        price: parsedPrice,
        allPrices: Object.keys(normalizedAllPrices).length
            ? normalizedAllPrices
            : { [fuelType]: parsedPrice },
        currency: row.currency,
        priceUnit: 'gallon',
        distanceMiles: calculateDistanceMiles(origin, stationCoords),
        fetchedAt: new Date().toISOString(),
        updatedAt: row.updated_at_source || null,
        isEstimated: false,
        sourceLabel: fallbackSourceLabel || row.source_label || PROVIDER_LABELS.gasbuddy,
        rating: row.rating ? Number(row.rating) : null,
        userRatingCount: row.user_rating_count ? Number(row.user_rating_count) : null,
    };

    return sanitizeStationGradeQuoteForFuelType(quote, fuelType);
}


module.exports = { buildQuoteIdentity, toPositiveNumber, pickPreferredStoredPrice, resolveStoredFuelPrice, normalizeStoredAllPrices, cloneQuotePayload, normalizeFuelTypeName, extractStandardFuelPrices, getDuplicateGradePriceIssue, buildRegularOnlyAllPrices, buildVisibleGradeAllPrices, filterValidationByFuelType, sanitizeStationGradeQuoteForFuelType, sanitizeStationQuotesForFuelType, sanitizeSnapshotForFuelType, toTimestampMs, buildValidationStationId, buildValidationRowFromStoredRow, buildValidationRowFromQuote, applyValidatedPriceToAllPrices, getQuoteValidationFuelTypes, quoteHasCurrentValidation, snapshotHasCurrentValidation, applyGradeValidationToQuote, buildValidatedLatestQuotesFromRows, applyValidationToStationQuotes, fetchAreaHistoryRows, buildLatestQuotesFromRows, mapStationPriceRowToQuote, PRICE_VALIDATION_VERSION };
