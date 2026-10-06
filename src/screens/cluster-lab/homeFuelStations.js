import { buildVisibleStations } from '../../lib/visibleStations.js';
import { stationOffersE85 } from '../../lib/stationPreferences.js';
import { getFuelGradeMeta } from '../../lib/fuelGrade.js';

// Each grade has its own reported timestamp. Never borrow the gasoline quote's
// age for E85, or compare an E85 price against gasoline to choose a winner.
export function buildHomeFuelStations(primary, e85, options) {
    const main = buildVisibleStations(primary, { ...options, requiresE85: false });
    const extra = options.requiresE85 && options.fuelGrade !== 'e85'
        ? buildVisibleStations(e85, { ...options, fuelGrade: 'e85', requiresE85: false }) : [];
    const ethanol = new Map(extra.map(station => [station.id, station]));
    const mainIDs = new Set(main.map(station => station.id));
    return [...main, ...extra.filter(station => !mainIDs.has(station.id))].map((station, index) => {
        const secondary = ethanol.get(station.id);
        const dual = options.requiresE85 && options.fuelGrade !== 'e85' && (stationOffersE85(station) || secondary);
        const mainPrice = station.fuelType === 'e85' ? null : station.price;
        const e85Price = secondary?.price ?? null;
        const grade = getFuelGradeMeta(options.fuelGrade).octane;
        return { ...station, isRecommended: index === 0,
            comparisonPrice: station.fuelType === options.fuelGrade ? station.price : null,
            offersE85: stationOffersE85(station) || Boolean(secondary),
            offersDiesel: station.offersDiesel === true || station.fuelType === 'diesel' ||
                station.availableFuelGrades?.includes('diesel') || Number(station.allPrices?.diesel) > 0,
            chipPrices: dual ? `${grade} ${mainPrice == null ? '—' : mainPrice.toFixed(2)}\nE85 ${e85Price == null ? '—' : e85Price.toFixed(2)}` : null,
            secondaryUpdatedAt: secondary?.updatedAt ?? null,
        };
    });
}
