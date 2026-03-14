const FUEL_GRADE_ORDER = ['regular', 'midgrade', 'premium', 'diesel'];

const FUEL_GRADE_META = {
    regular: { key: 'regular', label: 'Regular', shortLabel: 'Reg', octane: '87' },
    midgrade: { key: 'midgrade', label: 'Midgrade', shortLabel: 'Mid', octane: '89' },
    premium: { key: 'premium', label: 'Premium', shortLabel: 'Prem', octane: '93' },
    diesel: { key: 'diesel', label: 'Diesel', shortLabel: 'Dsl', octane: 'D' },
};

const FUEL_GRADE_ALIASES = {
    regular: ['regular', 'regular_gas'],
    midgrade: ['midgrade', 'midgrade_gas'],
    premium: ['premium', 'premium_gas'],
    diesel: ['diesel'],
};

function toPositiveNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

export function normalizeFuelGrade(fuelGrade) {
    const normalized = String(fuelGrade || '').trim().toLowerCase();
    return FUEL_GRADE_META[normalized] ? normalized : 'regular';
}

function resolvePriceFromAllPrices(allPrices, fuelGrade) {
    if (!allPrices || typeof allPrices !== 'object') {
        return null;
    }

    const aliases = FUEL_GRADE_ALIASES[fuelGrade] || [fuelGrade];

    for (const alias of aliases) {
        const aliasValue = toPositiveNumber(allPrices[alias]);
        if (aliasValue !== null) {
            return aliasValue;
        }
    }

    return null;
}

function resolveValidatedPriceForFuelGrade(quote, fuelGrade) {
    const validation = quote?.validationByFuelType?.[fuelGrade] || quote?.validation || null;
    const finalPrice = toPositiveNumber(validation?.finalPrice);
    return finalPrice !== null ? finalPrice : null;
}

function hasExplicitAvailabilityForFuelGrade(quote, fuelGrade) {
    if (!Array.isArray(quote?.availableFuelGrades) || quote.availableFuelGrades.length === 0) {
        return false;
    }

    return quote.availableFuelGrades
        .map(grade => normalizeFuelGrade(grade))
        .includes(fuelGrade);
}

function resolveBaseQuotePriceForFuelGrade(
    quote,
    fuelGrade,
    { allowFallbackToQuotePrice = true } = {}
) {
    const normalizedFuelGrade = normalizeFuelGrade(fuelGrade);
    const validatedPrice = resolveValidatedPriceForFuelGrade(quote, normalizedFuelGrade);
    if (validatedPrice !== null) {
        return validatedPrice;
    }

    const allPricesValue = resolvePriceFromAllPrices(quote?.allPrices, normalizedFuelGrade);
    if (allPricesValue !== null) {
        return allPricesValue;
    }

    if (normalizeFuelGrade(quote?.fuelType) === normalizedFuelGrade) {
        const quotePrice = toPositiveNumber(quote?.price);
        if (quotePrice !== null) {
            return quotePrice;
        }
    }

    if (!allowFallbackToQuotePrice) {
        return null;
    }

    return toPositiveNumber(quote?.price);
}

function shouldSuppressDuplicatePriceGrade(quote, fuelGrade) {
    const normalizedFuelGrade = normalizeFuelGrade(fuelGrade);
    const fuelGradeIndex = FUEL_GRADE_ORDER.indexOf(normalizedFuelGrade);

    if (fuelGradeIndex <= 0) {
        return false;
    }

    const resolvedPrice = resolveBaseQuotePriceForFuelGrade(
        quote,
        normalizedFuelGrade,
        { allowFallbackToQuotePrice: false }
    );

    if (resolvedPrice === null) {
        return false;
    }

    const resolvedPriceKey = resolvedPrice.toFixed(3);

    for (const cheaperGrade of FUEL_GRADE_ORDER.slice(0, fuelGradeIndex)) {
        if (
            Array.isArray(quote?.availableFuelGrades) &&
            !hasExplicitAvailabilityForFuelGrade(quote, cheaperGrade)
        ) {
            continue;
        }

        const cheaperGradePrice = resolveBaseQuotePriceForFuelGrade(
            quote,
            cheaperGrade,
            { allowFallbackToQuotePrice: false }
        );

        if (cheaperGradePrice !== null && cheaperGradePrice.toFixed(3) === resolvedPriceKey) {
            return true;
        }
    }

    return false;
}

export function resolveQuotePriceForFuelGrade(
    quote,
    fuelGrade,
    { allowFallbackToQuotePrice = true } = {}
) {
    if (!quote) {
        return null;
    }

    const normalizedFuelGrade = normalizeFuelGrade(fuelGrade);
    if (Array.isArray(quote?.availableFuelGrades) && !hasExplicitAvailabilityForFuelGrade(quote, normalizedFuelGrade)) {
        return null;
    }

    if (shouldSuppressDuplicatePriceGrade(quote, normalizedFuelGrade)) {
        return null;
    }

    return resolveBaseQuotePriceForFuelGrade(
        quote,
        normalizedFuelGrade,
        { allowFallbackToQuotePrice }
    );
}

export function applyFuelGradeToQuote(quote, fuelGrade) {
    if (!quote) {
        return null;
    }

    const normalizedFuelGrade = normalizeFuelGrade(fuelGrade);
    const resolvedPrice = resolveQuotePriceForFuelGrade(quote, normalizedFuelGrade);
    const validationForGrade = quote.validationByFuelType?.[normalizedFuelGrade] || quote.validation || null;

    if (resolvedPrice === null) {
        return null;
    }

    return {
        ...quote,
        fuelType: normalizedFuelGrade,
        price: resolvedPrice,
        validation: validationForGrade,
    };
}

export function rankQuotesForFuelGrade(quotes, fuelGrade) {
    return (quotes || [])
        .map(quote => applyFuelGradeToQuote(quote, fuelGrade))
        .filter(Boolean)
        .sort((left, right) => {
            const leftDistance = Number.isFinite(left.distanceMiles) ? left.distanceMiles : Number.POSITIVE_INFINITY;
            const rightDistance = Number.isFinite(right.distanceMiles) ? right.distanceMiles : Number.POSITIVE_INFINITY;
            const leftStationId = String(left.stationId || '');
            const rightStationId = String(right.stationId || '');

            return left.price - right.price ||
                leftDistance - rightDistance ||
                leftStationId.localeCompare(rightStationId);
        });
}

export function getFuelGradeMeta(fuelGrade) {
    return FUEL_GRADE_META[normalizeFuelGrade(fuelGrade)] || FUEL_GRADE_META.regular;
}

export { FUEL_GRADE_ORDER };
