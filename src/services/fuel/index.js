const {
    PROVIDER_LABELS,
    buildBarchartUrl,
    buildCacheKey,
    buildCardogUrl,
    buildGasBuddyGraphQLRequest,
    buildGoogleNearbySearchRequest,
    calculateDistanceMiles,
    buildTomTomFuelPriceUrl,
    buildTomTomPlaceUrl,
    buildTomTomSearchUrl,
    getFuelFailureMessage,
    isCacheEntryFresh,
    normalizeBarchartResponse,
    normalizeBlsResponse,
    normalizeCardogResponse,
    normalizeEiaResponse,
    normalizeFredResponse,
    normalizeGasBuddyResponse,
    normalizeGooglePlacesResponse,
    normalizeTomTomStationBundle,
    pickFirstDefined,
    selectPreferredQuote,
} = require('./core');
const { BLS_SERIES_BY_FUEL, EIA_PRODUCT_BY_FUEL, FRED_SERIES_BY_FUEL, getFuelServiceConfig } = require('./config');
const {
    clearCachedEntries,
    getCachedEntry,
    listSpatialCacheEntries,
    removeCachedEntry,
    setCachedEntry,
} = require('./cacheStore');
const {
    buildValidationState,
    normalizePrice,
    processValidationRows,
    validateAndChoosePrice,
} = require('./priceValidation');
const {
    annotateStationWithRouteContext,
    isTrajectoryRouteUnavailableError,
    resolveTrajectoryFetchPlanAsync,
} = require('../../lib/trajectoryFuelFetch');

const inflightRequests = new Map();
const inflightTrajectoryRequests = new Map();
const AREA_HISTORY_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_AREA_HISTORY_ROWS = 1500;
const PRICE_VALIDATION_VERSION = 2;
const TRAJECTORY_CACHE_PREFIX = 'fuel-trajectory:';
const FUEL_CACHE_RESET_ERROR_CODE = 'FUEL_CACHE_RESET';
const STANDARD_FUEL_TYPES = ['regular', 'midgrade', 'premium', 'diesel'];
let fuelCacheGeneration = 0;

function createFuelCacheResetError() {
    const error = new Error('Fuel cache reset invalidated the in-flight request.');
    error.code = FUEL_CACHE_RESET_ERROR_CODE;
    return error;
}

function isFuelCacheResetError(error) {
    return error?.code === FUEL_CACHE_RESET_ERROR_CODE;
}

function redactUrl(url) {
    return String(url || '').replace(/([?&](?:key|apikey|api_key)=)[^&]+/gi, '$1REDACTED');
}

function createDebugEntry(providerId, providerTier, enabled) {
    return {
        providerId,
        providerTier,
        enabled,
        failureCategory: null,
        quoteReturned: false,
        requests: [],
        summary: {},
        error: null,
    };
}

function createDebugRequest({ step, url, status, output, error }) {
    return {
        step,
        url: redactUrl(url),
        status: status || null,
        output: output ?? null,
        error: error || null,
    };
}

function describeFetchError(error) {
    if (typeof error?.payload === 'string') {
        return error.payload;
    }

    if (error?.payload) {
        try {
            return JSON.stringify(error.payload);
        } catch (stringifyError) {
            return error.message || 'Request failed';
        }
    }

    return error?.message || 'Request failed';
}

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
        .gte('created_at', lookbackStartIso)
        .order('created_at', { ascending: true })
        .limit(MAX_AREA_HISTORY_ROWS);

    return {
        data: Array.isArray(data) ? data : [],
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

function buildBlsUrl({ fuelType }) {
    const seriesId = BLS_SERIES_BY_FUEL[fuelType] || BLS_SERIES_BY_FUEL.regular;
    return `https://api.bls.gov/publicAPI/v2/timeseries/data/${seriesId}?latest=true`;
}

function buildEiaUrl({ apiKey, fuelType }) {
    const params = new URLSearchParams();
    params.set('api_key', apiKey);
    params.set('frequency', 'weekly');
    params.set('data[0]', 'value');
    params.set('facets[product][]', EIA_PRODUCT_BY_FUEL[fuelType] || EIA_PRODUCT_BY_FUEL.regular);
    params.set('facets[duoarea][]', 'NUS');
    params.set('sort[0][column]', 'period');
    params.set('sort[0][direction]', 'desc');
    params.set('offset', '0');
    params.set('length', '1');

    return `https://api.eia.gov/v2/petroleum/pri/gnd/data/?${params.toString()}`;
}

function buildFredUrl({ apiKey, fuelType }) {
    const params = new URLSearchParams({
        series_id: FRED_SERIES_BY_FUEL[fuelType] || FRED_SERIES_BY_FUEL.regular,
        api_key: apiKey,
        file_type: 'json',
        sort_order: 'desc',
        limit: '1',
    });

    return `https://api.stlouisfed.org/fred/series/observations?${params.toString()}`;
}

async function fetchJson(url, options = {}) {
    const normalizedOptions = typeof options === 'number' ? { timeoutMs: options } : options;
    const {
        body,
        headers = {},
        method = 'GET',
        timeoutMs,
    } = normalizedOptions;
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            body: body ? JSON.stringify(body) : undefined,
            headers: {
                Accept: 'application/json',
                ...headers,
            },
            method,
            signal: controller.signal,
        });
        const rawBody = await response.text();
        let payload = null;

        try {
            payload = rawBody ? JSON.parse(rawBody) : null;
        } catch (error) {
            payload = rawBody || null;
        }

        if (!response.ok) {
            const requestError = new Error(`HTTP ${response.status}`);
            requestError.status = response.status;
            requestError.payload = payload;
            throw requestError;
        }

        return {
            payload,
            status: response.status,
        };
    } finally {
        clearTimeout(timeoutHandle);
    }
}

async function fetchTomTomQuote({ latitude, longitude, radiusMiles, fuelType, config }) {
    const debugEntry = createDebugEntry('tomtom', 'station', Boolean(config.tomTomApiKey));

    if (!config.tomTomApiKey) {
        debugEntry.error = 'TomTom API key is not configured.';
        debugEntry.failureCategory = 'config';
        return { debugEntry, quote: null };
    }

    const searchUrl = buildTomTomSearchUrl({
        apiKey: config.tomTomApiKey,
        latitude,
        longitude,
        radiusMiles,
        limit: config.defaultLimit,
    });

    try {
        const searchResponse = await fetchJson(searchUrl, config.requestTimeoutMs);

        const { incrementApiStat } = require('../../lib/devCounter');
        incrementApiStat('tomtom');

        debugEntry.requests.push(
            createDebugRequest({
                step: 'categorySearch',
                url: searchUrl,
                status: searchResponse.status,
                output: searchResponse.payload,
            })
        );

        const stationResults = Array.isArray(searchResponse.payload?.results)
            ? searchResponse.payload.results.slice(0, config.defaultLimit)
            : [];

        debugEntry.summary.searchResultCount = stationResults.length;

        if (!stationResults.length) {
            debugEntry.error = 'The search request returned no nearby stations.';
            debugEntry.failureCategory = 'location';
            return { debugEntry, quote: null };
        }

        const quotes = await Promise.all(
            stationResults.map(async stationResult => {
                const entityId = stationResult?.id;

                if (!entityId) {
                    return null;
                }

                const placeUrl = buildTomTomPlaceUrl({
                    apiKey: config.tomTomApiKey,
                    entityId,
                });

                try {
                    const placeResponse = await fetchJson(placeUrl, config.requestTimeoutMs);
                    debugEntry.requests.push(
                        createDebugRequest({
                            step: `place:${entityId}`,
                            url: placeUrl,
                            status: placeResponse.status,
                            output: placeResponse.payload,
                        })
                    );

                    const placeResult = Array.isArray(placeResponse.payload?.results)
                        ? placeResponse.payload.results[0] || null
                        : placeResponse.payload;
                    const fuelPriceId = pickFirstDefined([
                        placeResult?.dataSources?.fuelPrice?.id,
                        placeResult?.poi?.fuelPrice?.id,
                        placeResult?.fuelPrice?.id,
                    ]);

                    if (!fuelPriceId) {
                        return null;
                    }

                    const fuelPriceUrl = buildTomTomFuelPriceUrl({
                        apiKey: config.tomTomApiKey,
                        fuelPriceId,
                    });

                    try {
                        const fuelPriceResponse = await fetchJson(fuelPriceUrl, config.requestTimeoutMs);
                        debugEntry.requests.push(
                            createDebugRequest({
                                step: `fuelPrice:${fuelPriceId}`,
                                url: fuelPriceUrl,
                                status: fuelPriceResponse.status,
                                output: fuelPriceResponse.payload,
                            })
                        );

                        return normalizeTomTomStationBundle({
                            origin: {
                                latitude,
                                longitude,
                            },
                            fuelType,
                            searchResult: stationResult,
                            placeResult,
                            fuelPriceResult: fuelPriceResponse.payload,
                        });
                    } catch (error) {
                        debugEntry.requests.push(
                            createDebugRequest({
                                step: `fuelPrice:${fuelPriceId}`,
                                url: fuelPriceUrl,
                                status: error?.status,
                                output: error?.payload || null,
                                error: error?.message || 'Fuel price request failed',
                            })
                        );
                        return null;
                    }
                } catch (error) {
                    debugEntry.requests.push(
                        createDebugRequest({
                            step: `place:${entityId}`,
                            url: placeUrl,
                            status: error?.status,
                            output: error?.payload || null,
                            error: error?.message || 'Place request failed',
                        })
                    );
                    return null;
                }
            })
        );

        const resolvedQuotes = quotes.filter(Boolean);
        const bestQuote = selectPreferredQuote(resolvedQuotes);

        debugEntry.summary.quoteCount = resolvedQuotes.length;
        debugEntry.quoteReturned = Boolean(bestQuote);

        if (!bestQuote) {
            debugEntry.error = 'No station returned a usable fuel price.';
            debugEntry.failureCategory = 'price';
        }

        return { debugEntry, quote: bestQuote };
    } catch (error) {
        debugEntry.error = describeFetchError(error);
        debugEntry.failureCategory = 'network';
        debugEntry.requests.push(
            createDebugRequest({
                step: 'categorySearch',
                url: searchUrl,
                status: error?.status,
                output: error?.payload || null,
                error: error?.message || 'Category search request failed',
            })
        );
        return { debugEntry, quote: null };
    }
}

async function fetchBarchartQuote({ latitude, longitude, zipCode, radiusMiles, fuelType, config }) {
    const debugEntry = createDebugEntry('barchart', 'station', Boolean(config.barchartApiKey));

    if (!config.barchartApiKey) {
        debugEntry.error = 'Barchart API key is not configured.';
        debugEntry.failureCategory = 'config';
        return { debugEntry, quote: null };
    }

    const requestUrl = buildBarchartUrl({
        apiKey: config.barchartApiKey,
        latitude,
        longitude,
        zipCode,
        radiusMiles,
        fuelType,
    });

    try {
        const response = await fetchJson(requestUrl, config.requestTimeoutMs);

        const { incrementApiStat } = require('../../lib/devCounter');
        incrementApiStat('barchart');

        const quotes = normalizeBarchartResponse({
            origin: {
                latitude,
                longitude,
            },
            fuelType,
            payload: response.payload,
        });

        debugEntry.requests.push(
            createDebugRequest({
                step: 'getFuelPrices',
                url: requestUrl,
                status: response.status,
                output: response.payload,
            })
        );
        debugEntry.summary.resultCount = Array.isArray(response.payload?.results) ? response.payload.results.length : 0;
        debugEntry.quoteReturned = Boolean(quotes && quotes.length > 0);

        if (!quotes || quotes.length === 0) {
            debugEntry.error = debugEntry.summary.resultCount === 0
                ? 'The search request returned no nearby stations.'
                : 'No station returned a usable fuel price.';
            debugEntry.failureCategory = debugEntry.summary.resultCount === 0 ? 'location' : 'price';
        }

        return { debugEntry, quotes };
    } catch (error) {
        debugEntry.error = describeFetchError(error);
        debugEntry.failureCategory = 'network';
        debugEntry.requests.push(
            createDebugRequest({
                step: 'getFuelPrices',
                url: requestUrl,
                status: error?.status,
                output: error?.payload || null,
                error: error?.message || 'Barchart request failed',
            })
        );
        return { debugEntry, quote: null };
    }
}

async function fetchGoogleQuote({ latitude, longitude, radiusMiles, fuelType, config }) {
    const debugEntry = createDebugEntry('google', 'station', Boolean(config.googleMapsApiKey));

    if (!config.googleMapsApiKey) {
        debugEntry.error = 'Google Maps API key is not configured.';
        debugEntry.failureCategory = 'config';
        return { debugEntry, quote: null };
    }

    const requestConfig = buildGoogleNearbySearchRequest({
        latitude,
        longitude,
        radiusMiles,
    });

    try {
        const response = await fetchJson(requestConfig.url, {
            body: requestConfig.body,
            headers: {
                'Content-Type': 'application/json',
                'X-Goog-Api-Key': config.googleMapsApiKey,
                'X-Goog-FieldMask': requestConfig.fieldMask,
            },
            method: 'POST',
            timeoutMs: config.requestTimeoutMs,
        });

        const { incrementApiStat } = require('../../lib/devCounter');
        incrementApiStat('google');

        const quotes = normalizeGooglePlacesResponse({
            origin: {
                latitude,
                longitude,
            },
            fuelType,
            payload: response.payload,
        });

        debugEntry.requests.push(
            createDebugRequest({
                step: 'searchNearby',
                url: requestConfig.url,
                status: response.status,
                output: response.payload,
            })
        );
        debugEntry.summary.resultCount = Array.isArray(response.payload?.places) ? response.payload.places.length : 0;
        debugEntry.quoteReturned = Boolean(quotes && quotes.length > 0);

        if (!quotes || quotes.length === 0) {
            debugEntry.error = debugEntry.summary.resultCount === 0
                ? 'The search request returned no nearby stations.'
                : 'No station returned a usable fuel price.';
            debugEntry.failureCategory = debugEntry.summary.resultCount === 0 ? 'location' : 'price';
        }

        return { debugEntry, quotes };
    } catch (error) {
        debugEntry.error = describeFetchError(error);
        debugEntry.failureCategory = 'network';
        debugEntry.requests.push(
            createDebugRequest({
                step: 'searchNearby',
                url: requestConfig.url,
                status: error?.status,
                output: error?.payload || null,
                error: error?.message || 'Google Places request failed',
            })
        );
        return { debugEntry, quote: null };
    }
}

async function fetchCardogQuote({ latitude, longitude, fuelType, config }) {
    const debugEntry = createDebugEntry('cardog', 'area', Boolean(config.cardogApiKey));

    if (!config.cardogApiKey) {
        debugEntry.error = 'Cardog API key is not configured.';
        debugEntry.failureCategory = 'config';
        return { debugEntry, quote: null };
    }

    const requestUrl = buildCardogUrl({
        latitude,
        longitude,
        fuelType,
    });

    try {
        const response = await fetchJson(requestUrl, {
            headers: {
                'x-api-key': config.cardogApiKey,
            },
            timeoutMs: config.requestTimeoutMs,
        });
        const quote = normalizeCardogResponse({
            origin: {
                latitude,
                longitude,
            },
            fuelType,
            payload: response.payload,
        });

        debugEntry.requests.push(
            createDebugRequest({
                step: 'gasPrices',
                url: requestUrl,
                status: response.status,
                output: response.payload,
            })
        );
        debugEntry.quoteReturned = Boolean(quote);

        if (!quote) {
            debugEntry.error = 'No usable area price returned.';
            debugEntry.failureCategory = 'price';
        }

        return { debugEntry, quote };
    } catch (error) {
        debugEntry.error = describeFetchError(error);
        debugEntry.failureCategory = 'network';
        debugEntry.requests.push(
            createDebugRequest({
                step: 'gasPrices',
                url: requestUrl,
                status: error?.status,
                output: error?.payload || null,
                error: error?.message || 'Cardog request failed',
            })
        );
        return { debugEntry, quote: null };
    }
}

async function fetchBlsQuote({ latitude, longitude, fuelType, config }) {
    const debugEntry = createDebugEntry('bls', 'area', true);
    const requestUrl = buildBlsUrl({ fuelType });

    try {
        const response = await fetchJson(requestUrl, config.requestTimeoutMs);
        const quote = normalizeBlsResponse({
            origin: {
                latitude,
                longitude,
            },
            fuelType,
            payload: response.payload,
        });

        debugEntry.requests.push(
            createDebugRequest({
                step: 'timeseries',
                url: requestUrl,
                status: response.status,
                output: response.payload,
            })
        );
        debugEntry.quoteReturned = Boolean(quote);

        if (!quote) {
            debugEntry.error = 'No usable area price returned.';
            debugEntry.failureCategory = 'price';
        }

        return { debugEntry, quote };
    } catch (error) {
        debugEntry.error = describeFetchError(error);
        debugEntry.failureCategory = 'network';
        debugEntry.requests.push(
            createDebugRequest({
                step: 'timeseries',
                url: requestUrl,
                status: error?.status,
                output: error?.payload || null,
                error: error?.message || 'BLS request failed',
            })
        );
        return { debugEntry, quote: null };
    }
}

async function fetchEiaQuote({ latitude, longitude, fuelType, config }) {
    const debugEntry = createDebugEntry('eia', 'area', Boolean(config.eiaApiKey));

    if (!config.eiaApiKey) {
        debugEntry.error = 'EIA API key is not configured.';
        debugEntry.failureCategory = 'config';
        return { debugEntry, quote: null };
    }

    const requestUrl = buildEiaUrl({
        apiKey: config.eiaApiKey,
        fuelType,
    });

    try {
        const response = await fetchJson(requestUrl, config.requestTimeoutMs);
        const quote = normalizeEiaResponse({
            origin: {
                latitude,
                longitude,
            },
            fuelType,
            payload: response.payload,
        });

        debugEntry.requests.push(
            createDebugRequest({
                step: 'data',
                url: requestUrl,
                status: response.status,
                output: response.payload,
            })
        );
        debugEntry.quoteReturned = Boolean(quote);

        if (!quote) {
            debugEntry.error = 'No usable area price returned.';
            debugEntry.failureCategory = 'price';
        }

        return { debugEntry, quote };
    } catch (error) {
        debugEntry.error = describeFetchError(error);
        debugEntry.failureCategory = 'network';
        debugEntry.requests.push(
            createDebugRequest({
                step: 'data',
                url: requestUrl,
                status: error?.status,
                output: error?.payload || null,
                error: error?.message || 'EIA request failed',
            })
        );
        return { debugEntry, quote: null };
    }
}

async function fetchFredQuote({ latitude, longitude, fuelType, config }) {
    const debugEntry = createDebugEntry('fred', 'area', Boolean(config.fredApiKey));

    if (!config.fredApiKey) {
        debugEntry.error = 'FRED API key is not configured.';
        debugEntry.failureCategory = 'config';
        return { debugEntry, quote: null };
    }

    const requestUrl = buildFredUrl({
        apiKey: config.fredApiKey,
        fuelType,
    });

    try {
        const response = await fetchJson(requestUrl, config.requestTimeoutMs);
        const quote = normalizeFredResponse({
            origin: {
                latitude,
                longitude,
            },
            fuelType,
            payload: response.payload,
        });

        debugEntry.requests.push(
            createDebugRequest({
                step: 'observations',
                url: requestUrl,
                status: response.status,
                output: response.payload,
            })
        );
        debugEntry.quoteReturned = Boolean(quote);

        if (!quote) {
            debugEntry.error = 'No usable area price returned.';
            debugEntry.failureCategory = 'price';
        }

        return { debugEntry, quote };
    } catch (error) {
        debugEntry.error = describeFetchError(error);
        debugEntry.failureCategory = 'network';
        debugEntry.requests.push(
            createDebugRequest({
                step: 'observations',
                url: requestUrl,
                status: error?.status,
                output: error?.payload || null,
                error: error?.message || 'FRED request failed',
            })
        );
        return { debugEntry, quote: null };
    }
}

async function fetchGasBuddyQuote({ latitude, longitude, fuelType, config, forceLive = false }) {
    const debugEntry = createDebugEntry('gasbuddy', 'station', true);
    const origin = { latitude, longitude };
    const searchLat = Math.round(latitude * 10) / 10;
    const searchLng = Math.round(longitude * 10) / 10;
    let cachedAreaHistoryRows = [];

    try {
        const { supabase } = require('../../lib/supabase');

        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

        const { data, error } = forceLive
            ? { data: null, error: null }
            : await supabase
                .from('station_prices')
                .select('*')
                .eq('search_latitude_rounded', searchLat)
                .eq('search_longitude_rounded', searchLng)
                .eq('fuel_type', fuelType)
                .gte('created_at', oneHourAgo);

        if (!error && data && data.length > 0) {
            const { incrementApiStat } = require('../../lib/devCounter');
            incrementApiStat('supabase');
            const { data: areaRows, error: areaRowsError } = await fetchAreaHistoryRows({
                supabase,
                searchLat,
                searchLng,
                fuelType,
            });
            cachedAreaHistoryRows = !areaRowsError && Array.isArray(areaRows) ? areaRows : [];
            const quotes = buildLatestQuotesFromRows({
                rows: cachedAreaHistoryRows.length > 0 ? cachedAreaHistoryRows : data,
                origin,
                fallbackSourceLabel: cachedAreaHistoryRows.length > 0 ? 'GasBuddy (area cache)' : undefined,
            });

            if (quotes.length > 0) {
                debugEntry.summary.resultCount = quotes.length;
                debugEntry.summary.freshCacheQuoteCount = quotes.filter(quote => {
                    const updatedAtMs = toTimestampMs(quote?.updatedAt);
                    return updatedAtMs !== null && updatedAtMs >= Date.now() - (60 * 60 * 1000);
                }).length;
                debugEntry.summary.areaCacheFallbackCount = Math.max(
                    0,
                    quotes.length - (debugEntry.summary.freshCacheQuoteCount || 0)
                );
                debugEntry.quoteReturned = true;
                debugEntry.requests.push(
                    createDebugRequest({
                        step: 'supabase_cache',
                        url: 'supabase://station_prices',
                        status: 200,
                        output: `${quotes.length} validated cached prices rebuilt from area history`,
                    })
                );

                if (__DEV__) {
                    console.log(
                        `[FuelUp][GasBuddy] cache-return: total=${quotes.length} search=${searchLat},${searchLng} fuel=${fuelType}`
                    );
                }

                return { debugEntry, quotes };
            }

            debugEntry.requests.push(
                createDebugRequest({
                    step: 'supabase_cache',
                    url: 'supabase://station_prices',
                    status: 200,
                    output: 'Cached rows found, but none had a usable price. Falling back to live fetch.',
                })
            );
        } else if (forceLive) {
            debugEntry.requests.push(
                createDebugRequest({
                    step: 'supabase_cache',
                    url: 'supabase://station_prices',
                    status: 200,
                    output: 'Cache bypassed (force live enabled).',
                })
            );
        }
    } catch (err) {
        console.error('Supabase caching check failed:', err);
    }

    // At this point the Supabase cache lookup returned no usable rows for the
    // last hour at `searchLat, searchLng` (either empty, errored, or bypassed
    // via `forceLive`). Fall through to a live GasBuddy GraphQL fetch so the
    // user sees fresh prices instead of an empty screen. This is the
    // "fallback-to-live" policy the app relies on for locations that have not
    // been seeded by a backend scraper yet.
    debugEntry.summary.liveFetchTrigger = forceLive ? 'force-live' : 'cache-miss';

    const requestConfig = buildGasBuddyGraphQLRequest({
        latitude,
        longitude,
        fuelType,
    });

    try {
        const response = await fetchJson(requestConfig.url, {
            body: requestConfig.body,
            headers: requestConfig.headers,
            method: 'POST',
            timeoutMs: config.requestTimeoutMs,
        });

        const { incrementApiStat } = require('../../lib/devCounter');
        incrementApiStat('gasbuddy');

        const liveQuotes = sanitizeStationQuotesForFuelType(normalizeGasBuddyResponse({
            origin: {
                latitude,
                longitude,
            },
            fuelType,
            payload: response.payload,
        }) || [], fuelType);

        let fallbackQuotes = [];
        let validatedLiveQuotes = liveQuotes;

        try {
            const { supabase } = require('../../lib/supabase');
            const allStations = response.payload?.data?.locationBySearchTerm?.stations?.results || [];
            const returnedStationIds = new Set(
                allStations
                    .map(station => station?.id)
                    .filter(Boolean)
                    .map(stationId => String(stationId))
            );
            const liveQuoteStationIds = new Set(
                liveQuotes
                    .map(quote => (quote?.stationId ? String(quote.stationId) : ''))
                    .filter(Boolean)
            );

            const missingPriceStationIds = Array.from(returnedStationIds)
                .filter(stationId => !liveQuoteStationIds.has(stationId));

            debugEntry.summary.missingPriceStationCount = missingPriceStationIds.length;

            const { data: areaRows, error: areaRowsError } = await fetchAreaHistoryRows({
                supabase,
                searchLat,
                searchLng,
                fuelType,
            });
            const usableAreaRows = !areaRowsError && Array.isArray(areaRows)
                ? areaRows
                : cachedAreaHistoryRows;

            if (usableAreaRows.length > 0) {
                validatedLiveQuotes = applyValidationToStationQuotes({
                    stationQuotes: liveQuotes,
                    historyRows: usableAreaRows,
                    origin,
                });

                const dedupedAreaQuotes = buildLatestQuotesFromRows({
                    rows: usableAreaRows,
                    origin,
                    fallbackSourceLabel: 'GasBuddy (area cache)',
                });

                fallbackQuotes = dedupedAreaQuotes.filter(
                    quote => !liveQuoteStationIds.has(String(quote.stationId || ''))
                );

                debugEntry.summary.areaCacheStationCount = dedupedAreaQuotes.length;
                debugEntry.summary.apiOmittedStationFallbackCount = fallbackQuotes.filter(
                    quote => !returnedStationIds.has(String(quote.stationId || ''))
                ).length;
            }
        } catch (fallbackLookupError) {
            console.error('GasBuddy fallback lookup failed:', fallbackLookupError);
        }

        validatedLiveQuotes = sanitizeStationQuotesForFuelType(validatedLiveQuotes, fuelType);
        fallbackQuotes = sanitizeStationQuotesForFuelType(fallbackQuotes, fuelType);

        const adjustedQuoteCount = validatedLiveQuotes.filter(quote => quote?.validation?.usedPrediction).length;
        const quotes = [...validatedLiveQuotes, ...fallbackQuotes];

        debugEntry.requests.push(
            createDebugRequest({
                step: 'graphql',
                url: requestConfig.url,
                status: response.status,
                output: response.payload,
            })
        );
        const stationCount = response.payload?.data?.locationBySearchTerm?.stations?.results?.length || 0;
        debugEntry.summary.resultCount = stationCount;
        debugEntry.summary.liveQuoteCount = validatedLiveQuotes.length;
        debugEntry.summary.fallbackQuoteCount = fallbackQuotes.length;
        debugEntry.summary.totalQuoteCount = quotes.length;
        debugEntry.summary.adjustedQuoteCount = adjustedQuoteCount;
        debugEntry.quoteReturned = Boolean(quotes && quotes.length > 0);

        if (__DEV__) {
            console.log(
                `[FuelUp][GasBuddy] live-return: apiStations=${stationCount} live=${validatedLiveQuotes.length} fallback=${fallbackQuotes.length} adjusted=${adjustedQuoteCount} total=${quotes.length} missingPriceStations=${debugEntry.summary.missingPriceStationCount || 0} apiOmittedFallback=${debugEntry.summary.apiOmittedStationFallbackCount || 0}`
            );
        }

        if (!quotes || quotes.length === 0) {
            debugEntry.error = stationCount === 0
                ? 'The search request returned no nearby stations.'
                : 'No station returned a usable fuel price.';
            debugEntry.failureCategory = stationCount === 0 ? 'location' : 'price';
        } else {
            try {
                const { supabase } = require('../../lib/supabase');
                const { getUserUuid } = require('../../lib/user');
                const userUuid = await getUserUuid();
                if (!supabase) {
                    debugEntry.summary.persistedLiveRowCount = 0;
                    debugEntry.summary.persistError = 'Supabase client is not configured';
                    debugEntry.requests.push(
                        createDebugRequest({
                            step: 'supabase_write',
                            url: 'supabase://station_prices',
                            status: 200,
                            output: 'Skipped: Supabase credentials are missing.',
                        })
                    );
                    return { debugEntry, quotes };
                }

                const rows = validatedLiveQuotes.map(q => ({
                    station_id: q.stationId,
                    provider_id: q.providerId,
                    fuel_type: q.fuelType,
                    all_prices: q.allPrices || {},
                    price: q.price,
                    currency: q.currency,
                    station_name: String(q.stationName).substring(0, 255),
                    address: String(q.address).substring(0, 500),
                    latitude: q.latitude,
                    longitude: q.longitude,
                    user_uuid: userUuid,
                    search_latitude_rounded: searchLat,
                    search_longitude_rounded: searchLng,
                    source_label: q.sourceLabel,
                    rating: q.rating,
                    user_rating_count: q.userRatingCount,
                    updated_at_source: q.updatedAt
                }));

                if (rows.length > 0) {
                    const { error: insertError } = await supabase.from('station_prices').insert(rows);
                    if (insertError) {
                        debugEntry.summary.persistedLiveRowCount = 0;
                        debugEntry.summary.persistError = insertError?.message || 'Insert failed';
                        debugEntry.requests.push(
                            createDebugRequest({
                                step: 'supabase_write',
                                url: 'supabase://station_prices',
                                status: 500,
                                error: insertError?.message || 'Supabase cache insert failed',
                            })
                        );
                        console.error('Supabase cache insert failed:', insertError);
                    } else {
                        debugEntry.summary.persistedLiveRowCount = rows.length;
                        debugEntry.requests.push(
                            createDebugRequest({
                                step: 'supabase_write',
                                url: 'supabase://station_prices',
                                status: 201,
                                output: `${rows.length} live rows inserted`,
                            })
                        );
                    }
                } else {
                    debugEntry.summary.persistedLiveRowCount = 0;
                    debugEntry.requests.push(
                        createDebugRequest({
                            step: 'supabase_write',
                            url: 'supabase://station_prices',
                            status: 200,
                            output: 'No live-priced rows to persist.',
                        })
                    );
                }
            } catch (err) {
                debugEntry.summary.persistedLiveRowCount = 0;
                debugEntry.summary.persistError = err?.message || 'Supabase write failed';
                debugEntry.requests.push(
                    createDebugRequest({
                        step: 'supabase_write',
                        url: 'supabase://station_prices',
                        status: 500,
                        error: err?.message || 'Supabase write failed',
                    })
                );
                console.error('Supabase trend log error:', err);
            }
        }

        return { debugEntry, quotes };
    } catch (error) {
        debugEntry.error = describeFetchError(error);
        debugEntry.failureCategory = 'network';
        debugEntry.requests.push(
            createDebugRequest({
                step: 'graphql',
                url: requestConfig.url,
                status: error?.status,
                output: error?.payload || null,
                error: error?.message || 'GasBuddy request failed',
            })
        );
        return { debugEntry, quotes: null };
    }
}

function normalizeSnapshot({ quote, topStations, regionalQuotes, cacheKey, trajectory = null }) {
    return {
        cacheKey,
        quote,
        topStations,
        regionalQuotes,
        trajectory,
        fetchedAt: quote?.fetchedAt || new Date().toISOString(),
    };
}

function buildTrajectorySnapshotCacheKey({
    latitude,
    longitude,
    radiusMiles,
    fuelType,
    preferredProvider,
    courseDegrees,
    speedMps,
    lookaheadMeters,
}) {
    return [
        TRAJECTORY_CACHE_PREFIX,
        buildCacheKey({
            latitude,
            longitude,
            radiusMiles,
            fuelType,
            preferredProvider,
        }),
        Math.round(Number(courseDegrees) || 0),
        Math.round((Number(speedMps) || 0) * 10),
        Math.round(Number(lookaheadMeters) || 0),
    ].join('');
}

function cloneSerializable(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

function rebaseQuoteToOrigin(quote, origin) {
    if (!quote) {
        return null;
    }

    const normalizedQuote = cloneSerializable(quote);
    normalizedQuote.distanceMiles = calculateDistanceMiles(origin, normalizedQuote);
    return normalizedQuote;
}

function mergeTrajectorySnapshotResults({
    origin,
    baseSnapshot,
    aheadSnapshot,
    cacheKey,
    trajectoryPlan,
}) {
    const stationQuotesByIdentity = new Map();
    const regionalQuotesByIdentity = new Map();
    const route = trajectoryPlan?.route || null;
    const allStationQuotes = [
        ...(Array.isArray(baseSnapshot?.topStations) ? baseSnapshot.topStations : []),
        ...(Array.isArray(aheadSnapshot?.topStations) ? aheadSnapshot.topStations : []),
    ]
        .map(quote => rebaseQuoteToOrigin(quote, origin))
        .map(quote => annotateStationWithRouteContext({ station: quote, route, origin }));
    const allRegionalQuotes = [
        ...(Array.isArray(baseSnapshot?.regionalQuotes) ? baseSnapshot.regionalQuotes : []),
        ...(Array.isArray(aheadSnapshot?.regionalQuotes) ? aheadSnapshot.regionalQuotes : []),
    ].map(quote => rebaseQuoteToOrigin(quote, origin));

    allStationQuotes.forEach(quote => {
        const identity = buildQuoteIdentity(quote);
        const existingQuote = stationQuotesByIdentity.get(identity);
        const quoteEffectivePrice = Number.isFinite(Number(quote?.effectivePrice))
            ? Number(quote.effectivePrice)
            : Number(quote?.price);
        const existingEffectivePrice = Number.isFinite(Number(existingQuote?.effectivePrice))
            ? Number(existingQuote.effectivePrice)
            : Number(existingQuote?.price);

        if (
            !existingQuote ||
            quoteEffectivePrice < existingEffectivePrice ||
            (
                quoteEffectivePrice === existingEffectivePrice &&
                (quote.distanceMiles || Number.POSITIVE_INFINITY) < (existingQuote.distanceMiles || Number.POSITIVE_INFINITY)
            )
        ) {
            stationQuotesByIdentity.set(identity, quote);
        }
    });

    allRegionalQuotes.forEach(quote => {
        const identity = buildQuoteIdentity(quote);
        if (!regionalQuotesByIdentity.has(identity)) {
            regionalQuotesByIdentity.set(identity, quote);
        }
    });

    const topStations = Array.from(stationQuotesByIdentity.values())
        .sort((left, right) => {
            const leftEffectivePrice = Number.isFinite(Number(left?.effectivePrice)) ? Number(left.effectivePrice) : Number(left?.price);
            const rightEffectivePrice = Number.isFinite(Number(right?.effectivePrice)) ? Number(right.effectivePrice) : Number(right?.price);
            return leftEffectivePrice - rightEffectivePrice ||
                left.distanceMiles - right.distanceMiles ||
                left.price - right.price;
        });
    const regionalQuotes = Array.from(regionalQuotesByIdentity.values())
        .sort((left, right) => left.price - right.price || left.distanceMiles - right.distanceMiles);
    const quote = topStations[0] || null;

    return normalizeSnapshot({
        cacheKey,
        quote: quote || annotateStationWithRouteContext({
            station: rebaseQuoteToOrigin(baseSnapshot?.quote, origin) || rebaseQuoteToOrigin(aheadSnapshot?.quote, origin),
            route,
            origin,
        }),
        topStations,
        regionalQuotes,
        trajectory: trajectoryPlan,
    });
}

// Default portion of a cache window we consider "safe" before triggering a
// refetch. A 0.5 buffer means we refetch when the user has moved past
// halfway out from the cached center (5 miles for a 10 mile fetch). This
// keeps a fresh roll of stations around the user as they move — waiting
// until they were near the outer ring left the home feed sparse for too
// long, because stations on the "behind" side of the original fetch kept
// getting farther from the user until the refetch finally fired.
const DEFAULT_CACHE_EDGE_BUFFER_FRACTION = 0.5;

function haversineDistanceMiles(lat1, lng1, lat2, lng2) {
    const latA = Number(lat1);
    const lngA = Number(lng1);
    const latB = Number(lat2);
    const lngB = Number(lng2);

    if (
        !Number.isFinite(latA) ||
        !Number.isFinite(lngA) ||
        !Number.isFinite(latB) ||
        !Number.isFinite(lngB)
    ) {
        return Number.POSITIVE_INFINITY;
    }

    const earthRadiusMiles = 3958.7613;
    const toRadians = (degrees) => (degrees * Math.PI) / 180;
    const deltaLat = toRadians(latB - latA);
    const deltaLng = toRadians(lngB - lngA);
    const haversineA = (
        Math.sin(deltaLat / 2) ** 2 +
        Math.cos(toRadians(latA)) *
        Math.cos(toRadians(latB)) *
        Math.sin(deltaLng / 2) ** 2
    );
    const haversineC = 2 * Math.atan2(Math.sqrt(haversineA), Math.sqrt(1 - haversineA));

    return earthRadiusMiles * haversineC;
}

/**
 * Scan the in-memory spatial cache index for an entry whose fetched window
 * still covers the requested origin. Returns the metadata for the best match
 * (closest center) or `null` if no window is usable. A match must:
 *   - target the same fuel type and preferred provider
 *   - be within `radiusMiles * (1 - edgeBufferFraction)` of the origin
 *   - still be fresh according to the TTL for station/area snapshots
 */
function findUsableCachedFuelWindow({
    latitude,
    longitude,
    fuelType,
    preferredProvider,
    radiusMiles,
    edgeBufferFraction = DEFAULT_CACHE_EDGE_BUFFER_FRACTION,
    nowMs = Date.now(),
}) {
    const latitudeNumber = Number(latitude);
    const longitudeNumber = Number(longitude);
    if (!Number.isFinite(latitudeNumber) || !Number.isFinite(longitudeNumber)) {
        return null;
    }

    const normFuelType = String(fuelType || '').trim().toLowerCase();
    const normProvider = String(preferredProvider || '').trim().toLowerCase();
    const bufferFraction = Math.max(0, Math.min(0.95, Number(edgeBufferFraction) || 0));
    const requestedRadius = Number(radiusMiles);
    const config = getFuelServiceConfig();
    const stationTtlMs = Number(config.stationCacheTtlMs) || 0;
    const areaTtlMs = Number(config.areaCacheTtlMs) || 0;
    // We cannot tell from the spatial entry alone whether the underlying
    // snapshot was a station or area fetch, so we treat any entry as usable
    // if it is still inside the more generous of the two TTLs. The downstream
    // snapshot loader re-checks the precise TTL before returning data.
    const effectiveTtlMs = Math.max(stationTtlMs, areaTtlMs);

    let bestMatch = null;

    for (const entry of listSpatialCacheEntries()) {
        if (normFuelType && entry.fuelType && entry.fuelType !== normFuelType) {
            continue;
        }
        if (normProvider && entry.preferredProvider && entry.preferredProvider !== normProvider) {
            continue;
        }

        // Only reuse a window if the cached query radius is at least as big as
        // what the caller currently wants; otherwise we could miss stations the
        // new request would have picked up on the outer ring.
        if (Number.isFinite(requestedRadius) && entry.radiusMiles < requestedRadius) {
            continue;
        }

        // Skip windows that have aged past the cache TTL. Without this, the
        // home screen tracker would happily skip refetches against stale
        // snapshots and the UI would drift out of sync with the real prices.
        if (effectiveTtlMs > 0 && entry.fetchedAt) {
            const ageMs = nowMs - entry.fetchedAt;
            if (!Number.isFinite(ageMs) || ageMs > effectiveTtlMs) {
                continue;
            }
        }

        const distanceMiles = haversineDistanceMiles(
            latitudeNumber,
            longitudeNumber,
            entry.centerLat,
            entry.centerLng
        );
        const safeRadius = entry.radiusMiles * (1 - bufferFraction);

        if (distanceMiles > safeRadius) {
            continue;
        }

        if (!bestMatch || distanceMiles < bestMatch.distanceMiles) {
            bestMatch = {
                ...entry,
                distanceMiles,
                safeRadius,
                ttlMs: effectiveTtlMs,
                isWithinWindow: true,
                nowMs,
            };
        }
    }

    return bestMatch;
}

/**
 * Locate the best cached snapshot whose fetched window still contains the
 * caller's origin, rebase the quote distances to the new origin, and tag the
 * result with `reusedWindow` metadata so the caller knows the entry was
 * served from the spatial cache instead of an exact-key lookup.
 */
async function findUsableCachedFuelSnapshot({
    latitude,
    longitude,
    radiusMiles,
    fuelType,
    preferredProvider = 'gasbuddy',
    edgeBufferFraction = DEFAULT_CACHE_EDGE_BUFFER_FRACTION,
}) {
    const window = findUsableCachedFuelWindow({
        latitude,
        longitude,
        fuelType,
        preferredProvider,
        radiusMiles,
        edgeBufferFraction,
    });

    if (!window) {
        return null;
    }

    const cacheEntry = await getCachedEntry(window.cacheKey);

    if (!cacheEntry) {
        return null;
    }

    if (!snapshotHasCurrentValidation(cacheEntry)) {
        return null;
    }

    const config = getFuelServiceConfig();
    const ttlMs = cacheEntry.quote?.isEstimated ? config.areaCacheTtlMs : config.stationCacheTtlMs;

    if (!isCacheEntryFresh(cacheEntry, ttlMs)) {
        return null;
    }

    const origin = { latitude, longitude };
    const rebasedQuote = rebaseQuoteToOrigin(cacheEntry.quote, origin);
    const rebasedTopStations = Array.isArray(cacheEntry.topStations)
        ? cacheEntry.topStations.map(quote => rebaseQuoteToOrigin(quote, origin))
        : [];
    const rebasedRegionalQuotes = Array.isArray(cacheEntry.regionalQuotes)
        ? cacheEntry.regionalQuotes.map(quote => rebaseQuoteToOrigin(quote, origin))
        : [];

    return sanitizeSnapshotForFuelType({
        ...cacheEntry,
        quote: rebasedQuote,
        topStations: rebasedTopStations,
        regionalQuotes: rebasedRegionalQuotes,
        isFresh: true,
        reusedWindow: {
            cacheKey: window.cacheKey,
            centerLat: window.centerLat,
            centerLng: window.centerLng,
            radiusMiles: window.radiusMiles,
            distanceMiles: window.distanceMiles,
            safeRadius: window.safeRadius,
            edgeBufferFraction,
            fetchedAt: window.fetchedAt,
        },
    }, fuelType);
}

async function getCachedFuelPriceSnapshot({ latitude, longitude, radiusMiles, fuelType, preferredProvider = 'gasbuddy' }) {
    // First try the spatial lookup so we can reuse an already-fetched window
    // when the user is still inside the safe portion of it. Falling back to
    // the exact cache key keeps the existing behavior intact when the spatial
    // index is cold (e.g. right after a cold launch before any new fetches).
    const spatialSnapshot = await findUsableCachedFuelSnapshot({
        latitude,
        longitude,
        radiusMiles,
        fuelType,
        preferredProvider,
    });

    if (spatialSnapshot) {
        return spatialSnapshot;
    }

    const cacheKey = buildCacheKey({
        latitude,
        longitude,
        radiusMiles,
        fuelType,
        preferredProvider,
    });
    const cacheEntry = await getCachedEntry(cacheKey);

    if (!cacheEntry) {
        return null;
    }

    if (!snapshotHasCurrentValidation(cacheEntry)) {
        return null;
    }

    return sanitizeSnapshotForFuelType({
        ...cacheEntry,
        isFresh: isCacheEntryFresh(
            cacheEntry,
            cacheEntry.quote?.isEstimated ? getFuelServiceConfig().areaCacheTtlMs : getFuelServiceConfig().stationCacheTtlMs
        ),
    }, fuelType);
}

/**
 * Decide whether the caller still has a usable cached window around `origin`
 * without fetching anything. The home screen uses this to keep cache returns
 * minimal while the user is moving — we only schedule a refetch when the
 * user passes the safe edge of the last fetched window.
 */
function hasUsableCachedFuelWindow({
    latitude,
    longitude,
    radiusMiles,
    fuelType,
    preferredProvider,
    edgeBufferFraction,
}) {
    return Boolean(findUsableCachedFuelWindow({
        latitude,
        longitude,
        radiusMiles,
        fuelType,
        preferredProvider,
        edgeBufferFraction,
    }));
}

async function refreshFuelPriceSnapshot({
    latitude,
    longitude,
    zipCode,
    radiusMiles,
    fuelType,
    preferredProvider,
    forceLiveGasBuddy = false,
    // `allowLiveGasBuddy` is accepted for backwards compatibility with the
    // dev tab and any external callers that still pass it, but it is a
    // no-op now: the cache-miss path inside `fetchGasBuddyQuote` always
    // triggers a live fetch regardless of this flag.
    // eslint-disable-next-line no-unused-vars
    allowLiveGasBuddy = false,
}) {
    const config = getFuelServiceConfig();
    const normalizedFuelType = fuelType || config.defaultFuelType;
    const normalizedRadius = radiusMiles || config.defaultRadiusMiles;
    const cacheKey = buildCacheKey({
        latitude,
        longitude,
        radiusMiles: normalizedRadius,
        fuelType: normalizedFuelType,
        preferredProvider,
    });

    if (inflightRequests.has(cacheKey)) {
        return inflightRequests.get(cacheKey);
    }

    const requestGeneration = fuelCacheGeneration;
    let request;

    request = (async () => {
        const debugState = {
            input: {
                fuelType: normalizedFuelType,
                latitude,
                longitude,
                radiusMiles: normalizedRadius,
                zipCode: zipCode || null,
            },
            providers: [],
            requestedAt: new Date().toISOString(),
        };

        const stationFetches = preferredProvider === 'gasbuddy'
            ? [
                fetchGasBuddyQuote({
                    latitude,
                    longitude,
                    fuelType: normalizedFuelType,
                    config,
                    forceLive: forceLiveGasBuddy,
                }),
            ]
            : [
                fetchTomTomQuote({
                    latitude,
                    longitude,
                    radiusMiles: normalizedRadius,
                    fuelType: normalizedFuelType,
                    config,
                }),
                fetchBarchartQuote({
                    latitude,
                    longitude,
                    zipCode,
                    radiusMiles: normalizedRadius,
                    fuelType: normalizedFuelType,
                    config,
                }),
                fetchGoogleQuote({
                    latitude,
                    longitude,
                    radiusMiles: normalizedRadius,
                    fuelType: normalizedFuelType,
                    config,
                }),
            ];

        const areaFetches = preferredProvider === 'gasbuddy'
            ? []
            : [
                fetchCardogQuote({
                    latitude,
                    longitude,
                    fuelType: normalizedFuelType,
                    config,
                }),
                fetchBlsQuote({
                    latitude,
                    longitude,
                    fuelType: normalizedFuelType,
                    config,
                }),
                fetchEiaQuote({
                    latitude,
                    longitude,
                    fuelType: normalizedFuelType,
                    config,
                }),
                fetchFredQuote({
                    latitude,
                    longitude,
                    fuelType: normalizedFuelType,
                    config,
                }),
            ];

        const providerResults = await Promise.all([...stationFetches, ...areaFetches]);

        debugState.providers = providerResults.map(result => result.debugEntry);

        let allQuotes = sanitizeStationQuotesForFuelType(
            providerResults.flatMap(result => result.quotes || result.quote || []).filter(Boolean),
            normalizedFuelType
        );
        const stationQuotesNeedingValidation = allQuotes.filter(quote => (
            quote.providerTier === 'station' &&
            !quote.isEstimated &&
            !quoteHasCurrentValidation(quote)
        ));

        if (stationQuotesNeedingValidation.length > 0) {
            try {
                const { supabase } = require('../../lib/supabase');

                if (supabase) {
                    const searchLat = Math.round(latitude * 10) / 10;
                    const searchLng = Math.round(longitude * 10) / 10;
                    const { data: areaRows, error: areaRowsError } = await fetchAreaHistoryRows({
                        supabase,
                        searchLat,
                        searchLng,
                        fuelType: normalizedFuelType,
                    });

                    if (!areaRowsError && Array.isArray(areaRows) && areaRows.length > 0) {
                        const validatedQuotes = applyValidationToStationQuotes({
                            stationQuotes: stationQuotesNeedingValidation,
                            historyRows: areaRows,
                            origin: { latitude, longitude },
                        });
                        const replacementByIdentity = new Map(
                            validatedQuotes.map(quote => [buildQuoteIdentity(quote), quote])
                        );

                        allQuotes = sanitizeStationQuotesForFuelType(
                            allQuotes.map(quote => replacementByIdentity.get(buildQuoteIdentity(quote)) || quote),
                            normalizedFuelType
                        );
                    }
                }
            } catch (validationError) {
                console.error('Station validation replay failed:', validationError);
            }
        }

        const stationQuotes = allQuotes.filter(quote => quote.providerTier === 'station' && !quote.isEstimated);

        const uniqueQuotesMap = new Map();
        stationQuotes.forEach(q => {
            const id = buildQuoteIdentity(q);

            if (!id) {
                return;
            }

            if (!uniqueQuotesMap.has(id) || q.price < uniqueQuotesMap.get(id).price) {
                uniqueQuotesMap.set(id, q);
            }
        });

        const topStations = Array.from(uniqueQuotesMap.values())
            .sort((a, b) => a.price - b.price || a.distanceMiles - b.distanceMiles);
        const dedupedStationCount = stationQuotes.length - uniqueQuotesMap.size;

        debugState.summary = {
            stationQuoteCount: stationQuotes.length,
            uniqueStationQuoteCount: uniqueQuotesMap.size,
            dedupedStationCount,
            adjustedStationQuoteCount: stationQuotes.filter(quote => quote?.validation?.usedPrediction).length,
        };

        if (__DEV__ && dedupedStationCount > 0) {
            console.log(
                `[FuelUp][Aggregation] deduped ${dedupedStationCount} station quotes (input=${stationQuotes.length}, unique=${uniqueQuotesMap.size})`
            );
        }

        const bestQuote = selectPreferredQuote(allQuotes);
        const supplementalQuotes = allQuotes.filter(quote => quote.providerTier === 'area');

        if (!bestQuote) {
            const requestError = new Error('No fuel price providers returned usable data.');
            requestError.debugState = debugState;
            requestError.userMessage = getFuelFailureMessage({ debugState });
            throw requestError;
        }

        const snapshot = sanitizeSnapshotForFuelType(normalizeSnapshot({
            cacheKey,
            quote: bestQuote,
            topStations,
            regionalQuotes: supplementalQuotes,
        }), normalizedFuelType);

        if (requestGeneration !== fuelCacheGeneration) {
            throw createFuelCacheResetError();
        }

        await setCachedEntry(cacheKey, snapshot, {
            centerLat: latitude,
            centerLng: longitude,
            radiusMiles: normalizedRadius,
            fuelType: normalizedFuelType,
            preferredProvider,
            fetchedAt: Date.now(),
        });

        if (requestGeneration !== fuelCacheGeneration) {
            await removeCachedEntry(cacheKey);
            throw createFuelCacheResetError();
        }

        return {
            debugState,
            snapshot,
        };
    })().finally(() => {
        if (inflightRequests.get(cacheKey) === request) {
            inflightRequests.delete(cacheKey);
        }
    });

    inflightRequests.set(cacheKey, request);

    return request;
}

async function refreshFuelPriceSnapshotAlongTrajectory({
    latitude,
    longitude,
    courseDegrees,
    speedMps,
    radiusMiles,
    fuelType,
    preferredProvider,
    routeProvider,
    lookaheadMeters,
    routeTargetMeters,
    forceLiveGasBuddy = false,
    allowLiveGasBuddy = false,
    snapshotFetcher = refreshFuelPriceSnapshot,
    cacheWriter = setCachedEntry,
}) {
    const normalizedFuelType = fuelType || getFuelServiceConfig().defaultFuelType;
    const normalizedRadius = radiusMiles || getFuelServiceConfig().defaultRadiusMiles;
    const trajectoryCacheKey = [
        'trajectory',
        buildCacheKey({
            latitude,
            longitude,
            radiusMiles: normalizedRadius,
            fuelType: normalizedFuelType,
            preferredProvider,
        }),
        Math.round(Number(courseDegrees) || 0),
        Math.round((Number(speedMps) || 0) * 10),
        Math.round(Number(lookaheadMeters) || 0),
    ].join(':');

    if (inflightTrajectoryRequests.has(trajectoryCacheKey)) {
        return inflightTrajectoryRequests.get(trajectoryCacheKey);
    }

    const requestGeneration = fuelCacheGeneration;
    let request;

    request = (async () => {
        const trajectoryPlan = await resolveTrajectoryFetchPlanAsync({
            latitude,
            longitude,
            courseDegrees,
            speedMps,
            lookaheadMeters,
            routeTargetMeters,
            routeProvider,
        });
        if (!trajectoryPlan?.aheadPoint) {
            throw new Error('MapKit could not build a trajectory fetch plan.');
        }

        const baseQuery = {
            latitude,
            longitude,
            radiusMiles: normalizedRadius,
            fuelType: normalizedFuelType,
            preferredProvider,
            forceLiveGasBuddy,
            allowLiveGasBuddy,
        };
        const aheadQuery = {
            ...baseQuery,
            latitude: trajectoryPlan.aheadPoint.latitude,
            longitude: trajectoryPlan.aheadPoint.longitude,
        };
        const [baseResult, aheadResult] = await Promise.all([
            snapshotFetcher(baseQuery),
            snapshotFetcher(aheadQuery),
        ]);
        const cacheKey = buildCacheKey({
            latitude,
            longitude,
            radiusMiles: normalizedRadius,
            fuelType: normalizedFuelType,
            preferredProvider,
        });
        const trajectorySnapshotCacheKey = buildTrajectorySnapshotCacheKey({
            latitude,
            longitude,
            radiusMiles: normalizedRadius,
            fuelType: normalizedFuelType,
            preferredProvider,
            courseDegrees,
            speedMps,
            lookaheadMeters: trajectoryPlan.lookaheadMeters,
        });
        const mergedSnapshot = sanitizeSnapshotForFuelType(mergeTrajectorySnapshotResults({
            origin: trajectoryPlan.origin,
            baseSnapshot: baseResult?.snapshot,
            aheadSnapshot: aheadResult?.snapshot,
            cacheKey: trajectorySnapshotCacheKey,
            trajectoryPlan: {
                aheadPoint: trajectoryPlan.aheadPoint,
                lookaheadMeters: trajectoryPlan.lookaheadMeters,
                routeDistanceMeters: trajectoryPlan.routeDistanceMeters,
                projectedDestination: trajectoryPlan.projectedDestination,
                route: trajectoryPlan.route,
                routeStepCount: Array.isArray(trajectoryPlan.route?.steps) ? trajectoryPlan.route.steps.length : 0,
            },
        }), normalizedFuelType);
        const debugState = {
            input: {
                ...baseQuery,
                courseDegrees,
                speedMps,
            },
            providers: [
                ...((baseResult?.debugState?.providers || []).map(provider => ({
                    ...provider,
                    trajectoryPoint: 'origin',
                }))),
                ...((aheadResult?.debugState?.providers || []).map(provider => ({
                    ...provider,
                    trajectoryPoint: 'ahead',
                }))),
            ],
            requestedAt: new Date().toISOString(),
            summary: {
                baseStationCount: Array.isArray(baseResult?.snapshot?.topStations) ? baseResult.snapshot.topStations.length : 0,
                aheadStationCount: Array.isArray(aheadResult?.snapshot?.topStations) ? aheadResult.snapshot.topStations.length : 0,
                mergedStationCount: Array.isArray(mergedSnapshot?.topStations) ? mergedSnapshot.topStations.length : 0,
            },
            trajectory: mergedSnapshot?.trajectory || null,
        };

        if (requestGeneration !== fuelCacheGeneration) {
            throw createFuelCacheResetError();
        }

        await cacheWriter(trajectorySnapshotCacheKey, mergedSnapshot, {
            centerLat: latitude,
            centerLng: longitude,
            radiusMiles: normalizedRadius,
            fuelType: normalizedFuelType,
            preferredProvider,
            fetchedAt: Date.now(),
        });

        if (requestGeneration !== fuelCacheGeneration) {
            await removeCachedEntry(trajectorySnapshotCacheKey);
            throw createFuelCacheResetError();
        }

        return {
            debugState,
            snapshot: mergedSnapshot,
            trajectoryPlan,
        };
    })().finally(() => {
        if (inflightTrajectoryRequests.get(trajectoryCacheKey) === request) {
            inflightTrajectoryRequests.delete(trajectoryCacheKey);
        }
    });

    inflightTrajectoryRequests.set(trajectoryCacheKey, request);
    return request;
}

async function refreshFuelPriceSnapshotWithTrajectoryFallback({
    courseDegrees,
    speedMps,
    routeProvider,
    lookaheadMeters,
    routeTargetMeters,
    fallbackSnapshotFetcher = refreshFuelPriceSnapshot,
    ...baseQuery
}) {
    try {
        return await refreshFuelPriceSnapshotAlongTrajectory({
            ...baseQuery,
            courseDegrees,
            speedMps,
            routeProvider,
            lookaheadMeters,
            routeTargetMeters,
        });
    } catch (error) {
        if (!isTrajectoryRouteUnavailableError(error)) {
            throw error;
        }

        return fallbackSnapshotFetcher(baseQuery);
    }
}

async function clearFuelPriceCache() {
    fuelCacheGeneration += 1;
    inflightRequests.clear();
    inflightTrajectoryRequests.clear();
    await clearCachedEntries('fuel:');
    return clearCachedEntries(TRAJECTORY_CACHE_PREFIX);
}

module.exports = {
    buildLatestFuelStationQuotesFromRows: buildLatestQuotesFromRows,
    clearFuelPriceCache,
    findUsableCachedFuelSnapshot,
    getFuelFailureMessage,
    getCachedFuelPriceSnapshot,
    hasUsableCachedFuelWindow,
    isFuelCacheResetError,
    refreshFuelPriceSnapshot,
    refreshFuelPriceSnapshotAlongTrajectory,
    refreshFuelPriceSnapshotWithTrajectoryFallback,
};
