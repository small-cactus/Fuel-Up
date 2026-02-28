const MILES_TO_METERS = 1609.344;
const GALLON = 'gallon';
const USD = 'USD';
const TOMTOM_PETROL_CATEGORY_ID = '7311';

const PROVIDER_LABELS = {
    tomtom: 'TomTom Fuel Prices',
    barchart: 'Barchart OnDemand',
    google: 'Google Places Fuel Options',
    cardog: 'Cardog Gas Prices',
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
        categorySet: TOMTOM_PETROL_CATEGORY_ID,
        limit: String(Math.max(1, Math.round(limit))),
    });

    return `https://api.tomtom.com/search/2/categorySearch/${encodeURIComponent('petrol station')}.json?${params.toString()}`;
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

function buildCardogUrl({ latitude, longitude, fuelType = 'regular' }) {
    const params = new URLSearchParams({
        country: 'US',
        latitude: String(latitude),
        longitude: String(longitude),
    });

    return `https://api.cardog.io/v1/fuel/${encodeURIComponent(normalizeFuelTypeName(fuelType))}?${params.toString()}`;
}

function buildGoogleNearbySearchRequest({ latitude, longitude, radiusMiles = 10 }) {
    return {
        body: {
            includedTypes: ['gas_station'],
            rankPreference: 'DISTANCE',
            maxResultCount: 8,
            locationRestriction: {
                circle: {
                    center: {
                        latitude: Number(latitude),
                        longitude: Number(longitude),
                    },
                    radius: milesToMeters(radiusMiles),
                },
            },
        },
        fieldMask: [
            'places.id',
            'places.displayName',
            'places.formattedAddress',
            'places.location',
            'places.fuelOptions',
        ].join(','),
        url: 'https://places.googleapis.com/v1/places:searchNearby',
    };
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
    allPrices = {},
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
        allPrices,
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

    return normalizedEntries;
}

function extractGoogleMoneyValue(priceValue) {
    if (!priceValue) {
        return null;
    }

    if (toFiniteNumber(priceValue) !== null) {
        return toFiniteNumber(priceValue);
    }

    const units = toFiniteNumber(priceValue.units) || 0;
    const nanos = toFiniteNumber(priceValue.nanos) || 0;
    const combinedValue = units + nanos / 1000000000;

    return Number.isFinite(combinedValue) ? combinedValue : null;
}

function normalizeGooglePlacesResponse({ origin, fuelType, payload }) {
    const places = Array.isArray(payload?.places) ? payload.places : [];

    if (!places.length) {
        return null;
    }

    const quotes = places
        .map(place => {
            const fuelEntries = Array.isArray(place?.fuelOptions?.fuelPrices) ? place.fuelOptions.fuelPrices : [];
            const matchingEntry =
                fuelEntries.find(entry =>
                    doesFuelNameMatch(
                        fuelType,
                        pickFirstDefined([entry?.type, entry?.fuelType, entry?.name, entry?.productName])
                    )
                ) || fuelEntries[0];
            const priceValue = extractGoogleMoneyValue(pickFirstDefined([matchingEntry?.price, matchingEntry?.amount]));

            if (priceValue === null) {
                return null;
            }

            const midgradeEntry = fuelEntries.find(entry => doesFuelNameMatch('midgrade', pickFirstDefined([entry?.type, entry?.fuelType, entry?.name, entry?.productName])));
            const premiumEntry = fuelEntries.find(entry => doesFuelNameMatch('premium', pickFirstDefined([entry?.type, entry?.fuelType, entry?.name, entry?.productName])));

            const midgradePrice = extractGoogleMoneyValue(pickFirstDefined([midgradeEntry?.price, midgradeEntry?.amount]));
            const premiumPrice = extractGoogleMoneyValue(pickFirstDefined([premiumEntry?.price, premiumEntry?.amount]));

            const allPrices = {};
            if (priceValue !== null) allPrices.regular = priceValue;
            if (midgradePrice !== null) allPrices.midgrade = midgradePrice;
            if (premiumPrice !== null) allPrices.premium = premiumPrice;

            return createQuote({
                providerId: 'google',
                providerTier: 'station',
                stationId: place?.id || null,
                stationName: pickFirstDefined([place?.displayName?.text, place?.displayName, 'Gas station']),
                address: pickFirstDefined([place?.formattedAddress, 'Nearby fuel station']),
                latitude: pickFirstDefined([place?.location?.latitude, place?.location?.lat]),
                longitude: pickFirstDefined([place?.location?.longitude, place?.location?.lng]),
                fuelType,
                price: priceValue,
                allPrices,
                updatedAt: pickFirstDefined([matchingEntry?.updateTime, matchingEntry?.updatedAt]),
                currency: pickFirstDefined([matchingEntry?.price?.currencyCode, matchingEntry?.currencyCode, USD]),
                isEstimated: false,
                sourceLabel: PROVIDER_LABELS.google,
                origin,
            });
        })
        .filter(Boolean);

    return quotes;
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

function normalizeCardogResponse({ origin, fuelType, payload }) {
    const currentSection = payload?.current || payload?.data?.current || payload?.gasPrice || payload?.currentPrice || payload;
    const areaPrice = pickFirstDefined([
        currentSection?.price,
        currentSection?.regular,
        currentSection?.amount,
        payload?.average,
        payload?.averagePrice,
        payload?.regular,
        payload?.price,
    ]);
    const locationLabel = pickFirstDefined([
        payload?.location?.city,
        payload?.location?.displayName,
        payload?.city,
        payload?.state,
        'Current area average',
    ]);

    return createAreaQuote({
        origin,
        providerId: 'cardog',
        fuelType,
        price: areaPrice,
        updatedAt: pickFirstDefined([
            payload?.updatedAt,
            payload?.timestamp,
            currentSection?.updatedAt,
        ]),
        stationName: 'Cardog market price',
        address: locationLabel,
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

function getFuelFailureMessage({ reason, debugState } = {}) {
    if (reason === 'invalid-manual-location') {
        return 'The manual location is invalid. Check the latitude and longitude you entered.';
    }

    const providerStates = Array.isArray(debugState?.providers) ? debugState.providers : [];
    const stationProviders = providerStates.filter(provider => provider.providerTier === 'station');
    const enabledProviders = stationProviders.filter(provider => provider.enabled);

    if (!enabledProviders.length) {
        return 'No station price provider is configured. Add a live API key in Settings.';
    }

    const hasLocationIssue = enabledProviders.some(provider => provider.failureCategory === 'location');

    if (hasLocationIssue) {
        return 'The selected location did not return nearby gas stations. Check the coordinates being sent to the API.';
    }

    return 'No prices returned. Live station feeds did not return a usable nearby price.';
}

module.exports = {
    PROVIDER_LABELS,
    buildBarchartUrl,
    buildCacheKey,
    buildCardogUrl,
    buildGoogleNearbySearchRequest,
    buildTomTomFuelPriceUrl,
    buildTomTomPlaceUrl,
    buildTomTomSearchUrl,
    calculateDistanceMiles,
    doesFuelNameMatch,
    formatFuelProductName,
    getFuelFailureMessage,
    isCacheEntryFresh,
    normalizeBarchartResponse,
    normalizeBlsResponse,
    normalizeCardogResponse,
    normalizeEiaResponse,
    normalizeFredResponse,
    normalizeGooglePlacesResponse,
    normalizeTomTomStationBundle,
    pickFirstDefined,
    selectLowestPricedQuote,
    selectPreferredQuote,
};
