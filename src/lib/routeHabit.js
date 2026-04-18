function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function computeRecencyFactor(timestampMs, nowMs) {
  const now = Number(nowMs) || Date.now();
  const recencyDays = Math.max(0, (now - (Number(timestampMs) || now)) / 86_400_000);
  return Math.exp(-recencyDays / 28);
}

function computeRouteHabitShareForKeys(routeStationHabits, routeHabitKeys, stationId, nowMs = null) {
  if (!routeStationHabits || typeof routeStationHabits !== 'object') return 0;
  if (!Array.isArray(routeHabitKeys) || routeHabitKeys.length === 0) return 0;
  if (!stationId) return 0;

  const now = Number(nowMs) || Date.now();
  const shares = routeHabitKeys.map(habitKey => {
    const habitMap = routeStationHabits[habitKey];
    if (!habitMap || typeof habitMap !== 'object') return 0;
    const entries = Object.entries(habitMap);
    if (!entries.length) return 0;
    const total = entries.reduce((sum, [, entry]) => sum + (Number(entry?.count) || 0), 0);
    if (total <= 0) return 0;
    const stationEntry = habitMap[stationId];
    if (!stationEntry) return 0;
    const recencyFactor = computeRecencyFactor(stationEntry.lastVisitMs, now);
    return clamp(((Number(stationEntry.count) || 0) / total) * recencyFactor, 0, 1);
  });

  if (!shares.length) return 0;

  // Use cross-key agreement, not the single strongest bucket. This avoids
  // over-crediting a station because it dominated only one narrow template
  // history while broader purpose-level behavior stayed diffuse.
  const averageShare = shares.reduce((sum, share) => sum + share, 0) / shares.length;
  return clamp(averageShare, 0, 1);
}

function computeRouteStationObservedMetricsForKeys(
  routeStationHabits,
  routeStationExposures,
  routeHabitKeys,
  stationId,
  nowMs = null,
) {
  if (!Array.isArray(routeHabitKeys) || routeHabitKeys.length === 0 || !stationId) {
    return {
      conversionRate: 0,
      exposureShare: 0,
      skipScore: 0,
      reliability: 0,
      exposureCount: 0,
      visitCount: 0,
    };
  }

  const now = Number(nowMs) || Date.now();
  const perKeyMetrics = routeHabitKeys.map(habitKey => {
    const exposureMap = routeStationExposures?.[habitKey];
    if (!exposureMap || typeof exposureMap !== 'object') {
      return {
        conversionRate: 0,
        exposureShare: 0,
        skipScore: 0,
        reliability: 0,
        exposureCount: 0,
        visitCount: 0,
      };
    }

    const exposureEntries = Object.entries(exposureMap);
    if (!exposureEntries.length) {
      return {
        conversionRate: 0,
        exposureShare: 0,
        skipScore: 0,
        reliability: 0,
        exposureCount: 0,
        visitCount: 0,
      };
    }

    const totalExposure = exposureEntries.reduce((sum, [, entry]) => sum + (Number(entry?.count) || 0), 0);
    if (totalExposure <= 0) {
      return {
        conversionRate: 0,
        exposureShare: 0,
        skipScore: 0,
        reliability: 0,
        exposureCount: 0,
        visitCount: 0,
      };
    }

    const exposureEntry = exposureMap[stationId];
    const exposureCount = Math.max(0, Number(exposureEntry?.count) || 0);
    if (exposureCount <= 0) {
      return {
        conversionRate: 0,
        exposureShare: 0,
        skipScore: 0,
        reliability: 0,
        exposureCount: 0,
        visitCount: 0,
      };
    }

    const visitEntry = routeStationHabits?.[habitKey]?.[stationId];
    const visitCount = Math.max(0, Number(visitEntry?.count) || 0);
    const exposureRecency = computeRecencyFactor(exposureEntry.lastExposureMs, now);
    const visitRecency = computeRecencyFactor(visitEntry?.lastVisitMs, now);
    const reliability = clamp(exposureCount / 6, 0, 1);
    const rawConversionRate = visitCount / Math.max(1, exposureCount);
    const conversionRate = clamp(
      rawConversionRate * (0.70 + (visitRecency * 0.30)),
      0,
      1,
    );
    const exposureShare = clamp((exposureCount / totalExposure) * exposureRecency, 0, 1);
    const skipScore = clamp(
      exposureShare * (1 - conversionRate) * (0.45 + (reliability * 0.55)),
      0,
      1,
    );

    return {
      conversionRate,
      exposureShare,
      skipScore,
      reliability,
      exposureCount,
      visitCount,
    };
  });

  const average = key => clamp(
    perKeyMetrics.reduce((sum, entry) => sum + (Number(entry?.[key]) || 0), 0) / routeHabitKeys.length,
    0,
    key === 'exposureCount' || key === 'visitCount' ? Number.MAX_SAFE_INTEGER : 1,
  );

  return {
    conversionRate: average('conversionRate'),
    exposureShare: average('exposureShare'),
    skipScore: average('skipScore'),
    reliability: average('reliability'),
    exposureCount: perKeyMetrics.reduce((sum, entry) => sum + (Number(entry?.exposureCount) || 0), 0),
    visitCount: perKeyMetrics.reduce((sum, entry) => sum + (Number(entry?.visitCount) || 0), 0),
  };
}

module.exports = {
  computeRouteHabitShareForKeys,
  computeRouteStationObservedMetricsForKeys,
};
