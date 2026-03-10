function toFiniteNumber(value) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : null;
}

function toPositiveNumber(value) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : null;
}

function getStationIdentity(quote) {
    if (!quote) {
        return '';
    }

    const stationId = String(quote.stationId || '').trim();
    if (stationId) {
        return stationId;
    }

    const providerId = String(quote.providerId || 'station');
    const latitude = toFiniteNumber(quote.latitude);
    const longitude = toFiniteNumber(quote.longitude);

    if (latitude !== null && longitude !== null) {
        return `${providerId}:${latitude.toFixed(5)}:${longitude.toFixed(5)}`;
    }

    return `${providerId}:${String(quote.stationName || 'unknown')}`;
}

function degreesToRadians(value) {
    return value * (Math.PI / 180);
}

export function calculateDistanceMiles(origin, destination) {
    const originLatitude = toFiniteNumber(origin?.latitude);
    const originLongitude = toFiniteNumber(origin?.longitude);
    const destinationLatitude = toFiniteNumber(destination?.latitude);
    const destinationLongitude = toFiniteNumber(destination?.longitude);

    if (
        originLatitude === null ||
        originLongitude === null ||
        destinationLatitude === null ||
        destinationLongitude === null
    ) {
        return null;
    }

    const earthRadiusMiles = 3958.7613;
    const deltaLatitude = degreesToRadians(destinationLatitude - originLatitude);
    const deltaLongitude = degreesToRadians(destinationLongitude - originLongitude);
    const originLatitudeRadians = degreesToRadians(originLatitude);
    const destinationLatitudeRadians = degreesToRadians(destinationLatitude);
    const a = (
        Math.sin(deltaLatitude / 2) * Math.sin(deltaLatitude / 2) +
        Math.cos(originLatitudeRadians) *
        Math.cos(destinationLatitudeRadians) *
        Math.sin(deltaLongitude / 2) *
        Math.sin(deltaLongitude / 2)
    );
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return earthRadiusMiles * c;
}

function normalizeStationQuoteForHome(quote, origin) {
    if (!quote || quote.providerTier !== 'station' || quote.isEstimated) {
        return null;
    }

    const fallbackDistanceMiles = calculateDistanceMiles(origin, quote);
    const resolvedDistanceMiles = toPositiveNumber(quote.distanceMiles) ?? fallbackDistanceMiles;

    return {
        ...quote,
        distanceMiles: resolvedDistanceMiles,
    };
}

function shouldReplaceExistingStationQuote(existingQuote, candidateQuote) {
    if (!existingQuote) {
        return true;
    }

    const existingPrice = toPositiveNumber(existingQuote.price) ?? Number.POSITIVE_INFINITY;
    const candidatePrice = toPositiveNumber(candidateQuote.price) ?? Number.POSITIVE_INFINITY;

    if (candidatePrice !== existingPrice) {
        return candidatePrice < existingPrice;
    }

    const existingDistance = toPositiveNumber(existingQuote.distanceMiles) ?? Number.POSITIVE_INFINITY;
    const candidateDistance = toPositiveNumber(candidateQuote.distanceMiles) ?? Number.POSITIVE_INFINITY;

    return candidateDistance < existingDistance;
}

export function filterStationQuotesForHome({
    quotes,
    origin,
    radiusMiles,
    minimumRating = 0,
}) {
    const normalizedRadiusMiles = toPositiveNumber(radiusMiles);
    const normalizedMinimumRating = Math.max(0, toFiniteNumber(minimumRating) ?? 0);
    const dedupedQuotesByStation = new Map();

    (quotes || [])
        .map(quote => normalizeStationQuoteForHome(quote, origin))
        .filter(Boolean)
        .forEach(quote => {
            if (
                normalizedMinimumRating > 0 &&
                (!Number.isFinite(quote.rating) || Number(quote.rating) < normalizedMinimumRating)
            ) {
                return;
            }

            if (
                normalizedRadiusMiles !== null &&
                Number.isFinite(quote.distanceMiles) &&
                quote.distanceMiles > normalizedRadiusMiles
            ) {
                return;
            }

            const identity = getStationIdentity(quote);
            const existingQuote = dedupedQuotesByStation.get(identity);

            if (shouldReplaceExistingStationQuote(existingQuote, quote)) {
                dedupedQuotesByStation.set(identity, quote);
            }
        });

    return Array.from(dedupedQuotesByStation.values())
        .sort((left, right) => {
            const leftPrice = toPositiveNumber(left.price) ?? Number.POSITIVE_INFINITY;
            const rightPrice = toPositiveNumber(right.price) ?? Number.POSITIVE_INFINITY;
            const leftDistance = toPositiveNumber(left.distanceMiles) ?? Number.POSITIVE_INFINITY;
            const rightDistance = toPositiveNumber(right.distanceMiles) ?? Number.POSITIVE_INFINITY;

            return leftPrice - rightPrice ||
                leftDistance - rightDistance ||
                getStationIdentity(left).localeCompare(getStationIdentity(right));
        });
}

export function buildHomeQuerySignature({
    origin,
    radiusMiles,
    fuelGrade,
    preferredProvider,
}) {
    const latitude = toFiniteNumber(origin?.latitude);
    const longitude = toFiniteNumber(origin?.longitude);
    const locationBucket = (
        latitude !== null &&
        longitude !== null
    )
        ? `${latitude.toFixed(2)}:${longitude.toFixed(2)}`
        : 'unresolved';

    return [
        locationBucket,
        String(fuelGrade || 'regular').toLowerCase(),
        Math.max(1, Math.round(toPositiveNumber(radiusMiles) || 10)),
        String(preferredProvider || 'gasbuddy').toLowerCase(),
    ].join('|');
}

export function buildVisibleSuppressedStationIds({
    suppressedStationIds,
    activeStationId = null,
    allowActiveReveal = false,
}) {
    const nextSuppressedIds = new Set(suppressedStationIds || []);

    if (allowActiveReveal && activeStationId != null) {
        nextSuppressedIds.delete(String(activeStationId));
    }

    return nextSuppressedIds;
}

export function shouldAutoFitHomeMap({
    isFocused,
    isNewData,
}) {
    return Boolean(isFocused && isNewData);
}
