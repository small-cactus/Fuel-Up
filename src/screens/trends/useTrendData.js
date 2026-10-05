import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useFocusEffect } from 'expo-router';
import { isFreshReportedPrice, REPORTED_PRICE_MAX_AGE_MS } from '../../services/fuel/reportedPrices';
import * as Location from 'expo-location';
import { AppState } from 'react-native';
import { subscribeTrendCache, getTrendCacheVersion } from '../../services/fuel/trendCacheEvents';
import {
    buildTrendRequestKey,
    captureTrendCacheGeneration,
    clearTrendDataCache,
    getCachedTrendData,
    getLastResolvedTrendData,
    isTrendCacheGenerationCurrent,
    prefetchTrendData,
} from '../../services/fuel/trends';

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

// Each result belongs to one location, grade, radius and cache generation. An older
// request may finish, but it cannot replace a newer selection or resurrect a reset.
export default function useTrendData({
    enabled = true,
    currentRequestKey,
    origin,
    fuelGrade,
    radiusMiles,
    preferredProvider,
    minimumRating,
    preferredBrands,
    fuelMemberships,
    requiresE85,
    resetToken,
    commitOrigin,
}) {
    useSyncExternalStore(subscribeTrendCache, getTrendCacheVersion, getTrendCacheVersion);
    const scope = JSON.stringify([currentRequestKey, fuelGrade, radiusMiles, preferredProvider, minimumRating, preferredBrands, fuelMemberships, requiresE85, resetToken]);
    const scopeRef = useRef(scope);
    scopeRef.current = scope;
    const mounted = useRef(false);
    const activeRequest = useRef(null);
    const previousReset = useRef(resetToken);
    const [freshnessTick, setFreshnessTick] = useState(0);
    const [result, setResult] = useState(null);
    const [refreshingScope, setRefreshingScope] = useState(null);

    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            activeRequest.current = null;
        };
    }, []);

    useEffect(() => {
        if (previousReset.current === resetToken) return;
        previousReset.current = resetToken;
        clearTrendDataCache();
        activeRequest.current = null;
        setResult(null);
        setRefreshingScope(null);
    }, [resetToken]);

    const load = useCallback(({ refreshing = false } = {}) => {
        if (!enabled) return Promise.resolve();
        if (activeRequest.current?.scope === scope) return activeRequest.current.promise;
        const request = { scope, promise: null };
        const generation = captureTrendCacheGeneration();
        activeRequest.current = request;
        if (refreshing) setRefreshingScope(scope);
        const isCurrent = () => mounted.current && scopeRef.current === scope &&
            activeRequest.current === request && isTrendCacheGenerationCurrent(generation);

        request.promise = (async () => {
            let resolvedOrigin = origin;
            try {
                if (!resolvedOrigin) {
                    const permission = await Location.getForegroundPermissionsAsync();
                    if (!isCurrent()) return;
                    if (permission.status !== 'granted') {
                        throw new Error('Allow location in Settings to see fuel trends near you.');
                    }
                    const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
                    if (!isCurrent()) return;
                    if (!Number.isFinite(fix?.coords?.latitude) || !Number.isFinite(fix?.coords?.longitude)) {
                        throw new Error('Your location is unavailable. Pull to refresh to try again.');
                    }
                    resolvedOrigin = { ...fix.coords, locationSource: 'device' };
                }
                if (!isCurrent()) return;
                const requestKey = buildTrendRequestKey({
                    latitude: resolvedOrigin.latitude,
                    longitude: resolvedOrigin.longitude,
                    fuelType: fuelGrade,
                    radiusMiles,
                    preferredProvider,
                    minimumRating,
                    preferredBrands,
                    fuelMemberships,
                    requiresE85,
                });
                const data = await prefetchTrendData({
                    latitude: resolvedOrigin.latitude,
                    longitude: resolvedOrigin.longitude,
                    fuelType: fuelGrade,
                    radiusMiles,
                    preferredProvider,
                    minimumRating,
                    preferredBrands,
                    fuelMemberships,
                    requiresE85,
                    requestKey,
                    maxAgeMs: refreshing ? 0 : 2000,
                });
                if (!isCurrent()) return;
                setResult({ scope, requestKey, data, generation, resetToken, error: null });
                // Publish only a current fix. A late GPS result must never undo a
                // manual location or fuel-grade change made while it was resolving.
                if (!origin) commitOrigin(resolvedOrigin, resolvedOrigin.locationSource);
                return data;
            } catch (error) {
                if (isCurrent()) {
                    setResult({ scope, requestKey: currentRequestKey, data: null, generation, resetToken,
                        error: origin ? 'Unable to refresh local trends. Pull to refresh to try again.' :
                            (error?.message || 'Your location is unavailable. Pull to refresh to try again.') });
                }
            } finally {
                if (mounted.current && scopeRef.current === scope && activeRequest.current === request) {
                    setRefreshingScope(null);
                }
                if (activeRequest.current === request) activeRequest.current = null;
            }
        })();
        return request.promise;
    }, [enabled, scope, origin, fuelGrade, radiusMiles, preferredProvider, minimumRating, preferredBrands, fuelMemberships, requiresE85, currentRequestKey, commitOrigin, resetToken]);

    useFocusEffect(useCallback(() => {
        if (!enabled) return;
        // Reconcile with Home's shared station cache on every visit. The
        // previous result stays visible while raw history refreshes.
        void load();
        const interval = setInterval(() => void load(), REFRESH_INTERVAL_MS);
        const subscription = AppState.addEventListener('change', state => {
            if (state === 'active') void load();
        });
        return () => { clearInterval(interval); subscription.remove(); };
    }, [enabled, load]));

    const onPullToRefresh = useCallback(() => load({ refreshing: true }), [load]);
    const currentResult = result && isTrendCacheGenerationCurrent(result.generation) && result.resetToken === resetToken &&
        (result.scope === scope || (currentRequestKey && result.requestKey === currentRequestKey)) ? result : null;
    const cached = currentRequestKey ? getCachedTrendData(currentRequestKey) || getLastResolvedTrendData(currentRequestKey) : null;
    const data = cached || currentResult?.data || null;
    const freshData = useMemo(() => data?.leaderboard ? {
        ...data,
        leaderboard: data.leaderboard.filter(station => isFreshReportedPrice(station.latestPrice, station.updatedAt)),
    } : data, [data, freshnessTick, enabled]);
    useEffect(() => {
        if (!enabled || !data?.leaderboard?.length) return;
        const expiries = data.leaderboard.map(station => Date.parse(station.updatedAt) + REPORTED_PRICE_MAX_AGE_MS)
            .filter(expiry => Number.isFinite(expiry) && expiry >= Date.now());
        if (!expiries.length) return;
        const timer = setTimeout(() => {
            setFreshnessTick(tick => tick + 1);
            void load();
        }, Math.max(1, Math.min(...expiries) - Date.now() + 1));
        return () => clearTimeout(timer);
    }, [enabled, data, load, freshnessTick]);
    return {
        data: freshData,
        loading: !cached && !currentResult,
        refreshing: refreshingScope === scope,
        error: currentResult?.error || null,
        onPullToRefresh,
    };
}
