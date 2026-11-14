import { resolveQuotePriceForFuelGrade } from './fuelGrade.js';

// All station-derived values rendered by the native card are primitive values.
// Keep action data separate: a Go press always resolves the latest raw station.
export function createStationCardPresentation(station, fuelGrade, now, { distanceText, relativeTime }) {
    return {
        id: station?.id ?? null,
        hasStation: Boolean(station),
        name: station?.name || null,
        address: station?.address || null,
        price: resolveQuotePriceForFuelGrade(station, fuelGrade),
        rating: Number.isFinite(station?.rating) ? station.rating.toFixed(1) : null,
        details: [distanceText(station?.distanceMiles), station?.updatedAt ? relativeTime(station.updatedAt, now) : null].filter(Boolean).join(' · '),
        canNavigate: Number.isFinite(station?.latitude) && Math.abs(station.latitude) <= 90 &&
            Number.isFinite(station?.longitude) && Math.abs(station.longitude) <= 180,
        hasDualPrices: Boolean(station?.dualPrices),
        dualPrimaryLabel: station?.dualPrices?.primaryLabel ?? null,
        dualPrimaryPrice: station?.dualPrices?.primaryPrice ?? null,
        dualE85Price: station?.dualPrices?.e85Price ?? null,
    };
}

export function reuseStationCardPresentation(previous, next) {
    return previous && Object.keys(next).every(key => Object.is(previous[key], next[key])) ? previous : next;
}
