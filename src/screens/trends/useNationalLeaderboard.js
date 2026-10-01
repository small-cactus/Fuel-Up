import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { AppState } from 'react-native';
import { fetchNationalLeaderboard } from '../../services/fuel/nationalLeaderboard';
import { isFreshReportedQuote, REPORTED_PRICE_MAX_AGE_MS } from '../../services/fuel/reportedPrices';
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
    refreshing: showRefresh = false
  } = {}) => {
    if (!enabled || active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setRefreshing(showRefresh);
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const quotes = await fetchNationalLeaderboard({
        fuelType,
        requiresE85,
        signal: controller.signal
      });
      if (!controller.signal.aborted && current.current === scope) setResult({
        scope,
        quotes,
        error: null
      });
    } catch (error) {
      if (current.current === scope && active.current === controller) setResult({
        scope,
        quotes: [],
        error: error.message
      });
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
    const interval = setInterval(load, 5 * 60000);
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
  const data = result?.scope === scope ? result : null;
  useEffect(() => {
    if (!enabled || !data?.quotes.length) return;
    const nextExpiry = Math.min(...data.quotes.map(q => Date.parse(q.updatedAt) + REPORTED_PRICE_MAX_AGE_MS));
    const timer = setTimeout(() => {
      setResult(previous => previous?.scope === scope ? {
        ...previous,
        quotes: previous.quotes.filter(q => isFreshReportedQuote(q))
      } : previous);
      void load();
    }, Math.max(1, nextExpiry - Date.now() + 1));
    return () => clearTimeout(timer);
  }, [enabled, data, load, scope]);
  return {
    quotes: (data?.quotes || []).filter(q => isFreshReportedQuote(q)),
    loading: !data,
    refreshing,
    error: data?.error,
    onRefresh: () => load({
      refreshing: true
    })
  };
}
