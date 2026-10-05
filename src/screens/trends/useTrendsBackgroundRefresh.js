import { useEffect, useRef } from 'react';
import { normalizeFuelSearchPreferences } from '../../lib/fuelSearchState';
import { buildTrendRequestKey, clearTrendDataCache, restoreTrendData, prefetchTrendData } from '../../services/fuel/trends';
import { clearNationalTrendsCache, restoreNationalTrends, prefetchNationalTrends } from '../../services/fuel/nationalTrendsCache';

export default function useTrendsBackgroundRefresh({ enabled, origin, preferences, resetToken }) {
    const previousReset = useRef(resetToken);
    useEffect(() => {
        if (previousReset.current === resetToken) return;
        previousReset.current = resetToken;
        clearTrendDataCache();
        clearNationalTrendsCache();
    }, [resetToken]);
    const { preferredOctane: fuelType, searchRadiusMiles: radiusMiles, ...filters } = normalizeFuelSearchPreferences(preferences);
    const nationalSignature = JSON.stringify({ fuelType, requiresE85: filters.requiresE85, resetToken });
    const localSignature = Number.isFinite(origin?.latitude) && Number.isFinite(origin?.longitude)
        ? JSON.stringify({ latitude: origin.latitude, longitude: origin.longitude, fuelType, radiusMiles, ...filters }) : null;
    useEffect(() => {
        if (!enabled) return;
        let cancelled = false;
        // Let cache reset effects finish first. Neither disk hydration nor the
        // network is part of Home's readiness or splash animation.
        void Promise.resolve().then(() => {
            if (cancelled) return;
            const options = JSON.parse(nationalSignature);
            void restoreNationalTrends(options);
            void prefetchNationalTrends({ ...options, force: true, maxAgeMs: 2000 }).catch(() => {});
        });
        return () => { cancelled = true; };
    }, [enabled, nationalSignature]);
    useEffect(() => {
        if (!enabled || !localSignature) return;
        let cancelled = false;
        void Promise.resolve().then(() => {
            if (cancelled) return;
            const params = JSON.parse(localSignature);
            void restoreTrendData(buildTrendRequestKey(params));
            void prefetchTrendData({ ...params, maxAgeMs: 2000 }).catch(() => {});
        });
        return () => { cancelled = true; };
    }, [enabled, localSignature, resetToken]);
}
