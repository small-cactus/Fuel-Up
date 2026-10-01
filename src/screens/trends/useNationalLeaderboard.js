import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { AppState } from 'react-native';
import { fetchNationalTrends } from '../../services/fuel/nationalLeaderboard';
import { isFreshReportedQuote, REPORTED_PRICE_MAX_AGE_MS } from '../../services/fuel/reportedPrices';
const CACHE_TTL_MS = 60 * 60000;
// Ten grade/filter combinations. Cache only successful responses, keyed by reset
// generation too, so returning to a recently viewed scope needs no network wait.
const cache = new Map();
function remember(scope, result) {
  cache.delete(scope);
  cache.set(scope, result);
  if (cache.size > 20) cache.delete(cache.keys().next().value);
}

export default function useNationalLeaderboard({
  enabled,
  fuelType,
  requiresE85,
  resetToken
}) {
  const scope = JSON.stringify([fuelType, requiresE85, resetToken]);
  const current = useRef(scope);
  current.current = scope;
  const active = useRef(null);
  const [result, setResult] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async ({
    refreshing: showRefresh = false, force = false
  } = {}) => {
    if (!enabled || active.current) return;
    const cached = cache.get(scope);
    if (!force && cached && Date.now() >= cached.loadedAt && Date.now() < Math.min(cached.loadedAt + CACHE_TTL_MS, Date.parse(cached.refreshAfter) || Infinity)) {
      setResult(cached);
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    setRefreshing(showRefresh);
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetchNationalTrends({
        fuelType,
        requiresE85,
        signal: controller.signal
      });
      if (!controller.signal.aborted && current.current === scope) {
        const next = { scope, ...response, loadedAt: Date.now(), error: null };
        if (!response.historyError) remember(scope, next);
        setResult(next);
      }
    } catch (error) {
      if (current.current === scope && active.current === controller) {
        setResult(previous => ({ ...(previous?.scope === scope ? previous : cache.get(scope)),
          scope, quotes: (previous?.scope === scope ? previous.quotes : cache.get(scope)?.quotes) || [], error: error.message }));
      }
    } finally {
      clearTimeout(timeout);
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
  const data = result?.scope === scope ? result : cache.get(scope) || null;
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
    error: data?.error,
    onRefresh: () => load({
      refreshing: true, force: true
    })
  };
}
