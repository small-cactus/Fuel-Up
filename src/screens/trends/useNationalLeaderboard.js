import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useFocusEffect } from 'expo-router';
import { AppState } from 'react-native';
import { subscribeTrendCache, getTrendCacheVersion } from '../../services/fuel/trendCacheEvents';
import { isFreshReportedQuote, REPORTED_PRICE_MAX_AGE_MS } from '../../services/fuel/reportedPrices';
import {
  nationalTrendsScope, getCachedNationalTrends, prefetchNationalTrends,
  isNationalTrendsFresh, rememberNationalTrends as remember,
} from '../../services/fuel/nationalTrendsCache';

export default function useNationalLeaderboard({
  enabled,
  fuelType,
  requiresE85,
  resetToken
}) {
  useSyncExternalStore(subscribeTrendCache, getTrendCacheVersion, getTrendCacheVersion);
  const scope = nationalTrendsScope({ fuelType, requiresE85, resetToken });
  const current = useRef(scope);
  current.current = scope;
  const active = useRef(null);
  const [result, setResult] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async ({
    refreshing: showRefresh = false, force = false
  } = {}) => {
    if (!enabled || active.current) return;
    const cached = getCachedNationalTrends(scope);
    if (!force && isNationalTrendsFresh(cached)) {
      setResult(cached);
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    setRefreshing(showRefresh);
    try {
      const next = await prefetchNationalTrends({ fuelType, requiresE85, resetToken, force });
      if (next && !controller.signal.aborted && current.current === scope) setResult(next);
    } catch (error) {
      if (current.current === scope && active.current === controller) {
        setResult(previous => ({ ...(previous?.scope === scope ? previous : getCachedNationalTrends(scope)),
          scope, failedAt: Date.now(), quotes: (previous?.scope === scope ? previous.quotes : getCachedNationalTrends(scope)?.quotes) || [], error: error.message }));
      }
    } finally {
      if (active.current === controller) {
        active.current = null;
        setRefreshing(false);
      }
    }
  }, [enabled, fuelType, requiresE85, scope]);
  useFocusEffect(useCallback(() => {
    if (!enabled) return;
    void load();
    // This cheap local check only fetches when the completed-scan cache expires.
    const interval = setInterval(load, 60000);
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') void load();
    });
    return () => {
      active.current?.abort();
      active.current = null;
      clearInterval(interval);
      subscription.remove();
    };
  }, [enabled, load]));
  const cached = getCachedNationalTrends(scope);
  const currentResult = result?.scope === scope ? result : null;
  const data = cached && (!currentResult || (enabled && cached.loadedAt >= currentResult.loadedAt))
    ? cached : currentResult;
  useEffect(() => {
    if (!enabled || !data?.quotes.length) return;
    const nextExpiry = Math.min(...data.quotes.map(q => Date.parse(q.updatedAt) + REPORTED_PRICE_MAX_AGE_MS));
    const timer = setTimeout(() => {
      const fresh = { ...data, quotes: data.quotes.filter(q => isFreshReportedQuote(q)) };
      if (!fresh.error && !fresh.historyError) remember(scope, fresh);
      setResult(previous => previous?.scope === scope ? fresh : previous);
      // Expiry hides a stale quote; it cannot produce a newer completed scan.
    }, Math.max(1, nextExpiry - Date.now() + 1));
    return () => clearTimeout(timer);
  }, [enabled, data, load, scope]);
  return {
    quotes: (data?.quotes || []).filter(q => isFreshReportedQuote(q)),
    trendData: data?.trendData || null,
    historyError: data?.historyError || null,
    loading: !data,
    refreshing,
    error: currentResult?.error && (!cached || cached.loadedAt <= currentResult.failedAt) ? currentResult.error : null,
    onRefresh: () => load({
      refreshing: true, force: true
    })
  };
}
