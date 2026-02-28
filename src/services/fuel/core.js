const MILES_TO_METERS = 1609.344;
const GALLON = 'gallon';
const USD = 'USD';

const PROVIDER_LABELS = {
    tomtom: 'TomTom Fuel Prices',
    barchart: 'Barchart OnDemand',
    bls: 'BLS Average Price Data',
    eia: 'EIA Retail Gasoline',
    fred: 'FRED Retail Gasoline',
};

const FUEL_NAME_MAP = {
    regular: ['regular', 'unleaded', 'all grades', 'all types'],
    midgrade: ['midgrade', 'plus'],
    premium: ['premium', 'super'],
    diesel: ['diesel'],
};

function toFiniteNumber(value) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : null;
}

function normalizeFuelTypeName(fuelType) {
    return String(fuelType || 'regular').trim().toLowerCase();
}

function formatFuelProductName(fuelType) {
    const normalizedFuelType = normalizeFuelTypeName(fuelType);
    return normalizedFuelType === 'midgrade' ? 'midgrade' : normalizedFuelType;
}

function normalizeCoordinate(value) {
    return Number(value).toFixed(2);
}

function buildCacheKey({ latitude, longitude, radiusMiles, fuelType }) {
    return [
        'fuel',
        normalizeFuelTypeName(fuelType),
        Math.max(1, Math.round(toFiniteNumber(radiusMiles) || 10)),
        normalizeCoordinate(latitude),
        normalizeCoordinate(longitude),
    ].join(':');
}

function isCacheEntryFresh(entry, ttlMs, now = new Date().toISOString()) {
    if (!entry?.fetchedAt) {
        return false;
    }

    const fetchedAt = new Date(entry.fetchedAt).getTime();
    const currentTime = new Date(now).getTime();

    if (!Number.isFinite(fetchedAt) || !Number.isFinite(currentTime)) {
        return false;
    }

    return currentTime - fetchedAt <= ttlMs;
}

function milesToMeters(radiusMiles) {
    return Math.round((toFiniteNumber(radiusMiles) || 10) * MILES_TO_METERS);
}

function buildTomTomSearchUrl({ apiKey, latitude, longitude, radiusMiles = 10, limit = 8 }) {
    const params = new URLSearchParams({
        key: apiKey,
        lat: String(latitude),
        lon: String(longitude),
        radius: String(milesToMeters(radiusMiles)),
        limit: String(Math.max(1, Math.round(limit))),
    });

    return `https://api.tomtom.com/search/2/categorySearch/${encodeURIComponent('gas station')}.json?${params.toString()}`;
}

function buildTomTomPlaceUrl({ apiKey, entityId }) {
    const params = new URLSearchParams({
        entityId,
        key: apiKey,
    });

    return `https://api.tomtom.com/search/2/place.json?${params.toString()}`;
}

function buildTomTomFuelPriceUrl({ apiKey, fuelPriceId }) {
    const params = new URLSearchParams({
        key: apiKey,
        fuelPrice: fuelPriceId,
    });

    return `https://api.tomtom.com/search/2/fuelPrice.json?${params.toString()}`;
}

function buildBarchartUrl({
    apiKey,
    latitude,
    longitude,
    zipCode,
    radiusMiles = 10,
    fuelType = 'regular',
    page = 1,
}) {
    const params = new URLSearchParams({
        apikey: apiKey,
        maxDistance: String(Math.max(1, Math.round(toFiniteNumber(radiusMiles) || 10))),
        productName: formatFuelProductName(fuelType),
        page: String(page),
    });

    if (zipCode) {
        params.set('zipCode', String(zipCode));
    }

    if (toFiniteNumber(latitude) !== null && toFiniteNumber(longitude) !== null) {
        params.set('latitude', String(latitude));
        params.set('longitude', String(longitude));
    }

    return `https://ondemand.websol.barchart.com/getFuelPrices.json?${params.toString()}`;
}

function toRadians(value) {
    return (value * Math.PI) / 180;
}

function calculateDistanceMiles(origin, target) {
    if (!origin || !target) {
        return 0;
    }

    const originLatitude = toFiniteNumber(origin.latitude);
    const originLongitude = toFiniteNumber(origin.longitude);
    const targetLatitude = toFiniteNumber(target.latitude);
    const targetLongitude = toFiniteNumber(target.longitude);

    if ([originLatitude, originLongitude, targetLatitude, targetLongitude].some(value => value === null)) {
        return 0;
    }

    const earthRadiusMiles = 3958.7613;
    const latitudeDelta = toRadians(targetLatitude - originLatitude);
    const longitudeDelta = toRadians(targetLongitude - originLongitude);
    const latitudeA = toRadians(originLatitude);
    const latitudeB = toRadians(targetLatitude);
    const haversine =
        Math.sin(latitudeDelta / 2) * Math.sin(latitudeDelta / 2) +
        Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(longitudeDelta / 2) * Math.sin(longitudeDelta / 2);

    return Number((2 * earthRadiusMiles * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))).toFixed(2));
}

function pickFirstDefined(values) {
    return values.find(value => value !== undefined && value !== null && value !== '');
}

function pickArrayValue(payload, path) {
    let currentValue = payload;

    for (const part of path) {
        currentValue = currentValue?.[part];
    }

    return Array.isArray(currentValue) ? currentValue : [];
}

function doesFuelNameMatch(fuelType, candidateName) {
    if (!candidateName) {
        return false;
    }

    const normalizedFuelType = normalizeFuelTypeName(fuelType);
    const normalizedCandidate = String(candidateName).trim().toLowerCase();
    const aliases = FUEL_NAME_MAP[normalizedFuelType] || [normalizedFuelType];

    return aliases.some(alias => normalizedCandidate.includes(alias));
}

function extractFuelEntries(payload) {
    const collections = [
        pickArrayValue(payload, ['fuelPrices']),
        pickArrayValue(payload, ['results']),
        pickArrayValue(payload, ['data']),
        pickArrayValue(payload, ['response', 'data']),
        pickArrayValue(payload, ['fuel', 'prices']),
        pickArrayValue(payload, ['fuelPrice', 'prices']),
    ];

    return collections.find(collection => collection.length > 0) || [];
}

function pickFuelEntry(payload, fuelType) {
    const entries = extractFuelEntries(payload);

    if (!entries.length) {
        const directPrice = pickFirstDefined([payload?.price, payload?.amount, payload?.value]);

        if (toFiniteNumber(directPrice) === null) {
            return null;
        }

        return payload;
    }

    const matchingEntry = entries.find(entry =>
        doesFuelNameMatch(
            fuelType,
            pickFirstDefined([entry?.fuelType, entry?.productName, entry?.name, entry?.type, entry?.grade])
        )
    );

    return matchingEntry || entries.find(entry => toFiniteNumber(pickFirstDefined([entry?.price, entry?.amount, entry?.value])) !== null) || null;
}

function normalizePriceEntry(entry) {
    if (!entry) {
        return null;
    }

    const price = toFiniteNumber(pickFirstDefined([entry.price, entry.amount, entry.value, entry.retailPrice]));

    if (price === null) {
        return null;
    }

    return {
        price,
        currency: pickFirstDefined([entry.currency, entry.currencyCode, USD]) || USD,
        updatedAt: pickFirstDefined([
            entry.lastUpdated,
            entry.updated,
            entry.updatedAt,
            entry.updateTime,
            entry.effectiveDate,
            entry.date,
        ]),
    };
}

function createQuote({
    providerId,
    providerTier,
    stationId = null,
    stationName,
    address,
    latitude,
    longitude,
    fuelType,
    price,
    updatedAt = null,
    currency = USD,
    isEstimated,
    sourceLabel,
    origin,
}) {
    return {
        providerId,
        providerTier,
        stationId,
        stationName,
        address,
        latitude: toFiniteNumber(latitude),
        longitude: toFiniteNumber(longitude),
        fuelType: normalizeFuelTypeName(fuelType),
        price: Number(Number(price).toFixed(3)),
        currency: currency || USD,
        priceUnit: GALLON,
        distanceMiles: calculateDistanceMiles(origin, { latitude, longitude }),
        fetchedAt: new Date().toISOString(),
        updatedAt: updatedAt || null,
        isEstimated: Boolean(isEstimated),
        sourceLabel,
    };
}

function normalizeTomTomStationBundle({ origin, fuelType, searchResult, placeResult, fuelPriceResult }) {
    const coordinates = {
        latitude: pickFirstDefined([searchResult?.position?.lat, placeResult?.position?.lat]),
        longitude: pickFirstDefined([searchResult?.position?.lon, placeResult?.position?.lon]),
    };
    const priceEntry = normalizePriceEntry(pickFuelEntry(fuelPriceResult, fuelType));

    if (!priceEntry) {
        return null;
    }

    return createQuote({
        providerId: 'tomtom',
        providerTier: 'station',
        stationId: pickFirstDefined([searchResult?.id, placeResult?.id]),
        stationName: pickFirstDefined([searchResult?.poi?.name, placeResult?.poi?.name, 'Gas station']),
        address: pickFirstDefined([
            placeResult?.address?.freeformAddress,
            searchResult?.address?.freeformAddress,
            'Nearby fuel station',
        ]),
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        fuelType,
        price: priceEntry.price,
        updatedAt: priceEntry.updatedAt,
        currency: priceEntry.currency,
        isEstimated: false,
        sourceLabel: PROVIDER_LABELS.tomtom,
        origin,
    });
}

function normalizeBarchartResponse({ origin, fuelType, payload }) {
    const entries = extractFuelEntries(payload);

    if (!entries.length) {
        return null;
    }

    const matchingEntries = entries.filter(entry =>
        doesFuelNameMatch(
            fuelType,
            pickFirstDefined([entry?.productName, entry?.fuelType, entry?.grade, entry?.name])
        )
    );
    const candidateEntries = matchingEntries.length ? matchingEntries : entries;

    const normalizedEntries = candidateEntries
        .map(entry => {
            const priceEntry = normalizePriceEntry(entry);

            if (!priceEntry) {
                return null;
            }

            return createQuote({
                providerId: 'barchart',
                providerTier: 'station',
                stationId: pickFirstDefined([entry.stationId, entry.id, entry.symbol]),
                stationName: pickFirstDefined([entry.stationName, entry.name, 'Gas station']),
                address: pickFirstDefined([entry.address, entry.location, 'Nearby fuel station']),
                latitude: pickFirstDefined([entry.latitude, entry.lat]),
                longitude: pickFirstDefined([entry.longitude, entry.lon, entry.lng]),
                fuelType,
                price: priceEntry.price,
                updatedAt: priceEntry.updatedAt,
                currency: priceEntry.currency,
                isEstimated: false,
                sourceLabel: PROVIDER_LABELS.barchart,
                origin,
            });
        })
        .filter(Boolean);

    return selectLowestPricedQuote(normalizedEntries);
}

function createAreaQuote({ origin, providerId, fuelType, price, updatedAt, stationName, address }) {
    if (toFiniteNumber(price) === null) {
        return null;
    }

    return createQuote({
        providerId,
        providerTier: 'area',
        stationId: null,
        stationName,
        address,
        latitude: origin?.latitude,
        longitude: origin?.longitude,
        fuelType,
        price,
        updatedAt,
        currency: USD,
        isEstimated: true,
        sourceLabel: PROVIDER_LABELS[providerId],
        origin,
    });
}

function normalizeBlsResponse({ origin, fuelType, payload }) {
    const datum = payload?.Results?.series?.[0]?.data?.[0];

    return createAreaQuote({
        origin,
        providerId: 'bls',
        fuelType,
        price: datum?.value,
        updatedAt:
            datum?.year && datum?.period
                ? `${datum.year}-${String(datum.period).replace('M', '').padStart(2, '0')}-01T00:00:00.000Z`
                : null,
        stationName: 'National average',
        address: 'United States',
    });
}

function normalizeEiaResponse({ origin, fuelType, payload }) {
    const datum = payload?.response?.data?.[0];

    return createAreaQuote({
        origin,
        providerId: 'eia',
        fuelType,
        price: datum?.value,
        updatedAt: datum?.period ? `${datum.period}T00:00:00.000Z` : null,
        stationName: 'Weekly national average',
        address: 'United States',
    });
}

function normalizeFredResponse({ origin, fuelType, payload }) {
    const datum = (payload?.observations || []).find(entry => toFiniteNumber(entry?.value) !== null);

    return createAreaQuote({
        origin,
        providerId: 'fred',
        fuelType,
        price: datum?.value,
        updatedAt: datum?.date ? `${datum.date}T00:00:00.000Z` : null,
        stationName: 'Retail benchmark',
        address: 'United States',
    });
}

function selectLowestPricedQuote(quotes) {
    return (quotes || [])
        .filter(quote => quote && toFiniteNumber(quote.price) !== null)
        .sort((left, right) => left.price - right.price || left.distanceMiles - right.distanceMiles)[0] || null;
}

function selectPreferredQuote(quotes) {
    const validQuotes = (quotes || []).filter(quote => quote && toFiniteNumber(quote.price) !== null);
    const stationQuotes = validQuotes.filter(quote => quote.providerTier === 'station' && !quote.isEstimated);

    if (stationQuotes.length) {
        return selectLowestPricedQuote(stationQuotes);
    }

    return null;
}

module.exports = {
    PROVIDER_LABELS,
    buildBarchartUrl,
    buildCacheKey,
    buildTomTomFuelPriceUrl,
    buildTomTomPlaceUrl,
    buildTomTomSearchUrl,
    calculateDistanceMiles,
    doesFuelNameMatch,
    formatFuelProductName,
    isCacheEntryFresh,
    normalizeBarchartResponse,
    normalizeBlsResponse,
    normalizeEiaResponse,
    normalizeFredResponse,
    normalizeTomTomStationBundle,
    pickFirstDefined,
    selectLowestPricedQuote,
    selectPreferredQuote,
};
