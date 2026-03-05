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

export function resolveQuotePriceForFuelGrade(
    quote,
    fuelGrade,
    { allowFallbackToQuotePrice = true } = {}
) {
    if (!quote) {
        return null;
    }

    const normalizedFuelGrade = normalizeFuelGrade(fuelGrade);
    const allPricesValue = resolvePriceFromAllPrices(quote.allPrices, normalizedFuelGrade);
    if (allPricesValue !== null) {
        return allPricesValue;
    }

    if (normalizeFuelGrade(quote.fuelType) === normalizedFuelGrade) {
        const quotePrice = toPositiveNumber(quote.price);
        if (quotePrice !== null) {
            return quotePrice;
        }
    }

    if (!allowFallbackToQuotePrice) {
        return null;
    }

    return toPositiveNumber(quote.price);
}

export function applyFuelGradeToQuote(quote, fuelGrade) {
    if (!quote) {
        return null;
    }

    const normalizedFuelGrade = normalizeFuelGrade(fuelGrade);
    const resolvedPrice = resolveQuotePriceForFuelGrade(quote, normalizedFuelGrade);

    if (resolvedPrice === null) {
        return null;
    }

    return {
        ...quote,
        fuelType: normalizedFuelGrade,
        price: resolvedPrice,
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
