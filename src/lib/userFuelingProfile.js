// User behavior archetypes
const PROFILE_PRESETS = {
  cheapest: {
    id: 'cheapest',
    name: 'Price Hunter',
    description: 'Always seeks the lowest price',
    brandLoyalty: 0.0,       // no brand preference
    distanceWeight: 0.2,     // willing to drive further for price
    priceWeight: 0.8,        // heavily weights price
    preferredBrands: [],
    preferredGrade: 'regular',
    visitHistory: [],         // { stationId, visitCount, lastVisitMs }
    fillUpHistory: [],        // { timestamp, odometer, gallons, pricePerGallon }
    typicalFillUpIntervalMiles: 280,
    rushHourPatterns: { morningPeak: false, eveningPeak: false },
  },
  nearest: {
    id: 'nearest',
    name: 'Convenience Seeker',
    description: 'Always goes to the nearest station',
    brandLoyalty: 0.1,
    distanceWeight: 0.8,
    priceWeight: 0.2,
    preferredBrands: [],
    preferredGrade: 'regular',
    visitHistory: [],
    fillUpHistory: [],
    typicalFillUpIntervalMiles: 250,
    rushHourPatterns: { morningPeak: true, eveningPeak: true },
  },
  brand_loyal: {
    id: 'brand_loyal',
    name: 'Brand Loyal',
    description: 'Prefers Shell; will pass cheaper stations',
    brandLoyalty: 0.9,
    distanceWeight: 0.3,
    priceWeight: 0.1,
    preferredBrands: ['Shell', 'Chevron'],
    preferredGrade: 'premium',
    visitHistory: [
      { stationId: 'den-downing-shell', visitCount: 24, lastVisitMs: Date.now() - 3 * 24 * 3600 * 1000 },
    ],
    fillUpHistory: [],
    typicalFillUpIntervalMiles: 220,
    rushHourPatterns: { morningPeak: false, eveningPeak: true },
  },
  balanced: {
    id: 'balanced',
    name: 'Balanced',
    description: 'No strong preference — default behavior',
    brandLoyalty: 0.3,
    distanceWeight: 0.5,
    priceWeight: 0.5,
    preferredBrands: [],
    preferredGrade: 'regular',
    visitHistory: [],
    fillUpHistory: [],
    typicalFillUpIntervalMiles: 300,
    rushHourPatterns: { morningPeak: false, eveningPeak: false },
  },
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Compute a profile-based bonus score (0–0.25) for a station.
 * Higher score = user more likely to choose this station based on history/preference.
 *
 * @param {Object} station - { stationId, brand, price, distanceMiles }
 * @param {Object} profile - user profile object
 * @param {Object[]} allStations - all candidate stations (for price ranking)
 * @returns {number} bonus score 0–0.25
 */
function computeProfileBonus(station, profile, allStations) {
  if (!profile) return 0;

  let bonus = 0;

  // Brand loyalty bonus (up to 0.10)
  if (profile.preferredBrands && profile.preferredBrands.length > 0) {
    const isFavoriteBrand = profile.preferredBrands.some(
      b => (station.brand || '').toLowerCase().includes(b.toLowerCase())
    );
    if (isFavoriteBrand) bonus += 0.10 * profile.brandLoyalty;
  }

  // Visit history bonus (up to 0.08)
  const historyEntry = (profile.visitHistory || []).find(h => h.stationId === station.stationId);
  if (historyEntry) {
    // Decay over time: full bonus if visited in last week, half if last month
    const daysSinceVisit = (Date.now() - historyEntry.lastVisitMs) / (1000 * 86400);
    const recencyFactor = Math.max(0, 1 - daysSinceVisit / 30);
    const frequencyFactor = Math.min(1, historyEntry.visitCount / 10);
    bonus += 0.08 * recencyFactor * frequencyFactor;
  }

  // Price rank bonus (up to 0.05)
  if (allStations && allStations.length > 1 && profile.priceWeight > 0.5) {
    const prices = allStations.map(s => s.price).filter(Boolean).sort((a, b) => a - b);
    const rank = prices.indexOf(station.price);
    if (rank >= 0) {
      const priceBonus = (1 - rank / prices.length) * 0.05 * profile.priceWeight;
      bonus += priceBonus;
    }
  }

  // Distance bonus (up to 0.02) — nearest station gets small bonus
  if (profile.distanceWeight > 0.6 && station.distanceMiles > 0) {
    const allDists = allStations.map(s => s.distanceMiles).filter(Boolean).sort((a, b) => a - b);
    const distRank = allDists.indexOf(station.distanceMiles);
    if (distRank === 0) bonus += 0.02; // nearest station
  }

  return Math.min(0.25, bonus);
}

/**
 * Compute a profile-based penalty score (0–0.40) for a station the user is
 * unlikely to choose. This is the symmetric counterpart to computeProfileBonus
 * and helps suppress false positives for known "driver is not stopping here"
 * cases — e.g. a price-sensitive user passing an expensive station when a
 * cheaper one is nearby, or a brand-loyal user passing a non-preferred brand.
 *
 * Only active when there is a CLEARLY better alternative in the candidate set.
 *
 * @param {Object} station - { stationId, brand, price, distanceMiles }
 * @param {Object} profile - user profile object
 * @param {Object[]} allStations - all candidate stations (for comparison)
 * @returns {number} penalty score 0–0.40
 */
function computeProfilePenalty(station, profile, allStations) {
  if (!profile) return 0;
  if (!allStations || allStations.length < 2) return 0;

  let penalty = 0;

  // Price hunter penalty: user strongly prefers low prices and this station
  // is above the median AND a noticeably cheaper alternative exists nearby.
  if (profile.priceWeight && profile.priceWeight > 0.6) {
    const pricedStations = allStations.filter(s => typeof s.price === 'number' && s.price > 0);
    if (pricedStations.length >= 2 && typeof station.price === 'number') {
      const sortedPrices = pricedStations.map(s => s.price).sort((a, b) => a - b);
      const mid = Math.floor(sortedPrices.length / 2);
      const medianPrice = sortedPrices.length % 2 === 0
        ? (sortedPrices[mid - 1] + sortedPrices[mid]) / 2
        : sortedPrices[mid];
      const cheapestPrice = sortedPrices[0];
      const priceGapToCheapest = station.price - cheapestPrice;
      if (station.price >= medianPrice && priceGapToCheapest > 0.10) {
        // Scale penalty by how far above the cheapest this station is.
        // 10¢ gap → 0.10, 30¢+ gap → 0.30 (plus priceWeight multiplier).
        const penaltyStrength = Math.min(0.30, priceGapToCheapest / 1.0);
        penalty += penaltyStrength * profile.priceWeight;
      }
    }
  }

  // Brand-loyal penalty: user has a preferred brand list, a preferred-brand
  // station is in the candidate set, and this station's brand does not match.
  if (profile.preferredBrands && profile.preferredBrands.length > 0 && profile.brandLoyalty > 0.5) {
    const stationBrand = (station.brand || '').toLowerCase();
    const isPreferredBrand = profile.preferredBrands.some(b => stationBrand.includes(b.toLowerCase()));
    if (!isPreferredBrand) {
      const anyPreferredNearby = allStations.some(s => {
        if (s.stationId === station.stationId) return false;
        const sb = (s.brand || '').toLowerCase();
        return profile.preferredBrands.some(b => sb.includes(b.toLowerCase()));
      });
      if (anyPreferredNearby) {
        penalty += 0.10 * profile.brandLoyalty;
      }
    }
  }

  return Math.min(0.40, penalty);
}

/**
 * Compute a long-range "visit history" score for a station. Based purely on
 * frequency + recency of actual past visits — no future information, just
 * what the device could persist from prior app sessions.
 *
 * Returns 0–1 where 1 means "user visits this station very frequently and
 * recently".
 */
function computeHistoryScore(station, profile, nowMs) {
  if (!profile || !profile.visitHistory || profile.visitHistory.length === 0) return 0;
  const now = nowMs || Date.now();
  const entry = profile.visitHistory.find(h => h.stationId === station.stationId);
  if (!entry) return 0;

  const daysSinceLast = (now - entry.lastVisitMs) / (86400 * 1000);
  // Exponential decay with ~14 day half-life. At day 0 → 1, day 14 → 0.5, day 30 → 0.23.
  const recency = Math.exp(-daysSinceLast / 14);
  // Frequency: saturates at 8 visits. 1 visit → 0.12, 4 → 0.5, 8+ → 1.
  const frequency = Math.min(1, entry.visitCount / 8);
  return Math.min(1, recency * frequency);
}

function classifyVisitDaypart(hour) {
  const normalizedHour = Number.isFinite(Number(hour)) ? Number(hour) : 12;
  if (normalizedHour < 6) return 'night';
  if (normalizedHour < 11) return 'morning';
  if (normalizedHour < 16) return 'midday';
  if (normalizedHour < 21) return 'evening';
  return 'night';
}

function inferContextCounts(entry = {}) {
  const inferred = {
    total: Number(entry.visitCount) || 0,
    highway: 0,
    suburban: 0,
    city: 0,
    city_grid: 0,
    weekday: 0,
    weekend: 0,
    morning: 0,
    midday: 0,
    evening: 0,
    night: 0,
  };
  const timestamps = Array.isArray(entry.visitTimestamps) ? entry.visitTimestamps : [];
  if (!timestamps.length) {
    return inferred;
  }
  inferred.total = Math.max(inferred.total, timestamps.length);
  for (const timestamp of timestamps) {
    const date = new Date(timestamp);
    const isWeekend = date.getDay() === 0 || date.getDay() === 6;
    inferred[isWeekend ? 'weekend' : 'weekday'] += 1;
    inferred[classifyVisitDaypart(date.getHours())] += 1;
  }
  return inferred;
}

function getEntryContextCounts(entry = {}) {
  const stored = entry.contextCounts && typeof entry.contextCounts === 'object'
    ? entry.contextCounts
    : null;
  if (!stored) {
    return inferContextCounts(entry);
  }
  const inferred = inferContextCounts(entry);
  return {
    total: Math.max(Number(stored.total) || 0, inferred.total),
    highway: Number(stored.highway) || 0,
    suburban: Number(stored.suburban) || 0,
    city: Number(stored.city) || 0,
    city_grid: Number(stored.city_grid) || 0,
    weekday: Math.max(Number(stored.weekday) || 0, inferred.weekday),
    weekend: Math.max(Number(stored.weekend) || 0, inferred.weekend),
    morning: Math.max(Number(stored.morning) || 0, inferred.morning),
    midday: Math.max(Number(stored.midday) || 0, inferred.midday),
    evening: Math.max(Number(stored.evening) || 0, inferred.evening),
    night: Math.max(Number(stored.night) || 0, inferred.night),
  };
}

function computeContextMatchFromCounts(counts = {}, nowMs, context = {}) {
  const totalVisits = Math.max(
    1,
    Number(counts.total) ||
    Number(counts.exposureCount) ||
    Number(counts.visitCount) ||
    0
  );
  const date = new Date(nowMs || Date.now());
  const isWeekend = date.getDay() === 0 || date.getDay() === 6;
  const weekdayMatch = (counts[isWeekend ? 'weekend' : 'weekday'] || 0) / totalVisits;
  const daypartMatch = (counts[classifyVisitDaypart(date.getHours())] || 0) / totalVisits;
  const driveContextKey = inferDriveContextKey(context);
  const driveContextMatch = (counts[driveContextKey] || 0) / totalVisits;
  return Math.max(
    0,
    Math.min(
      1,
      (weekdayMatch * 0.28) +
      (daypartMatch * 0.34) +
      (driveContextMatch * 0.38)
    )
  );
}

function inferDriveContextKey(context = {}) {
  if (context.scenarioHint === 'highway' || context.isHighwayCruise) return 'highway';
  if (context.scenarioHint === 'city_grid' || context.isCityGridLike) return 'city_grid';
  const meanSpeedMps = Number(context.meanSpeedMps) || 0;
  if (meanSpeedMps >= 20) return 'highway';
  if (meanSpeedMps >= 11) return 'suburban';
  return 'city';
}

function computeContextualHistoryScore(station, profile, nowMs, context = {}) {
  if (!profile || !Array.isArray(profile.visitHistory) || profile.visitHistory.length === 0) {
    return 0;
  }
  const entry = profile.visitHistory.find(h => h.stationId === station.stationId);
  if (!entry) return 0;

  const baseHistory = computeHistoryScore(station, profile, nowMs);
  const counts = getEntryContextCounts(entry);
  const contextMatch = computeContextMatchFromCounts(counts, nowMs, context);

  return Math.min(1, baseHistory * (0.30 + (contextMatch * 0.70)));
}

function computeHistoryContextMatch(station, profile, nowMs, context = {}) {
  const baseHistory = computeHistoryScore(station, profile, nowMs);
  if (baseHistory <= 0) return 0;
  return Math.max(0, Math.min(1, computeContextualHistoryScore(station, profile, nowMs, context) / baseHistory));
}

function computeVisitShare(station, profile) {
  if (!profile || !Array.isArray(profile.visitHistory) || profile.visitHistory.length === 0) return 0;
  const totalVisits = profile.visitHistory.reduce((sum, entry) => sum + (Number(entry?.visitCount) || 0), 0);
  if (totalVisits <= 0) return 0;
  const entry = profile.visitHistory.find(historyEntry => historyEntry.stationId === station.stationId);
  return entry ? Math.min(1, (Number(entry.visitCount) || 0) / totalVisits) : 0;
}

function computeProfileHistoryConcentration(profile) {
  if (!profile || !Array.isArray(profile.visitHistory) || profile.visitHistory.length === 0) return 0;
  const totalVisits = profile.visitHistory.reduce((sum, entry) => sum + (Number(entry?.visitCount) || 0), 0);
  if (totalVisits <= 0) return 0;
  const maxVisits = profile.visitHistory.reduce(
    (currentMax, entry) => Math.max(currentMax, Number(entry?.visitCount) || 0),
    0
  );
  return Math.min(1, maxVisits / totalVisits);
}

function getExposureEntry(station, profile) {
  if (!station || !profile || !Array.isArray(profile.exposureHistory)) return null;
  return profile.exposureHistory.find(entry => entry.stationId === station.stationId) || null;
}

function computeObservedConversionRate(station, profile) {
  if (!station || !profile) return 0;
  const exposureEntry = getExposureEntry(station, profile);
  if (!exposureEntry) return 0;
  const exposureCount = Math.max(
    0,
    Number(exposureEntry.exposureCount) ||
    Number(exposureEntry?.contextCounts?.total) ||
    0
  );
  if (exposureCount <= 0) return 0;
  const visitEntry = Array.isArray(profile.visitHistory)
    ? profile.visitHistory.find(entry => entry.stationId === station.stationId)
    : null;
  const visitCount = Math.max(0, Number(visitEntry?.visitCount) || 0);
  return Math.max(0, Math.min(1, visitCount / exposureCount));
}

function computeExposureContextMatch(station, profile, nowMs, context = {}) {
  const exposureEntry = getExposureEntry(station, profile);
  if (!exposureEntry) return 0;
  const counts = getEntryContextCounts({
    contextCounts: exposureEntry.contextCounts,
    visitCount: exposureEntry.exposureCount,
  });
  return computeContextMatchFromCounts(counts, nowMs, context);
}

function computeContextualObservedConversionRate(station, profile, nowMs, context = {}) {
  const overallConversionRate = computeObservedConversionRate(station, profile);
  if (overallConversionRate <= 0) return 0;
  const fillContextMatch = computeHistoryContextMatch(station, profile, nowMs, context);
  const exposureContextMatch = computeExposureContextMatch(station, profile, nowMs, context);
  if (exposureContextMatch <= 0.05) {
    return overallConversionRate * (0.25 + (fillContextMatch * 0.35));
  }
  const contextualLift = clamp(
    fillContextMatch / Math.max(0.15, exposureContextMatch),
    0,
    1.4
  );
  return clamp(
    overallConversionRate * (0.35 + (contextualLift * 0.65)),
    0,
    1
  );
}

function computeObservedSkipScore(station, profile, nowMs, context = {}) {
  const overallConversionRate = computeObservedConversionRate(station, profile);
  const contextualConversionRate = computeContextualObservedConversionRate(station, profile, nowMs, context);
  const exposureContextMatch = computeExposureContextMatch(station, profile, nowMs, context);
  if (exposureContextMatch <= 0) return 0;
  return clamp(
    (exposureContextMatch * (1 - contextualConversionRate)) *
    (0.55 + ((1 - overallConversionRate) * 0.45)),
    0,
    1
  );
}

/**
 * Compute a time-of-day / day-of-week pattern match score for a station.
 * If the user has visited this station several times at a similar hour and
 * day-of-week type (weekday vs weekend), return a high score — this is the
 * "usual commute pattern" signal.
 *
 * Requires `visitTimestamps` on the visit history entry. If absent, returns 0.
 */
function computeTimePatternScore(station, profile, nowMs) {
  if (!profile || !profile.visitHistory || profile.visitHistory.length === 0) return 0;
  const entry = profile.visitHistory.find(h => h.stationId === station.stationId);
  if (!entry || !entry.visitTimestamps || entry.visitTimestamps.length < 2) return 0;

  const now = new Date(nowMs || Date.now());
  const nowHour = now.getHours();
  const nowIsWeekend = now.getDay() === 0 || now.getDay() === 6;

  let matchingVisits = 0;
  let closeVisits = 0; // within ±2 hours
  for (const ts of entry.visitTimestamps) {
    const d = new Date(ts);
    const hour = d.getHours();
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
    if (isWeekend !== nowIsWeekend) continue;
    const hourDelta = Math.abs(hour - nowHour);
    if (hourDelta <= 1) matchingVisits++;
    if (hourDelta <= 2) closeVisits++;
  }

  // Return a score: perfect match (many close visits) → 1.
  // 3+ close matches → near 1, 1 match → ~0.3.
  const score = Math.min(1, (matchingVisits * 0.25) + (closeVisits * 0.12));
  return score;
}

/**
 * Check if current time falls in rush hour for this profile.
 * Rush hour: 7–9am or 5–7pm on weekdays.
 */
function isRushHour(profile, timestampMs) {
  const date = new Date(timestampMs || Date.now());
  const hour = date.getHours();
  const dow = date.getDay(); // 0=Sun, 6=Sat
  const isWeekday = dow >= 1 && dow <= 5;
  if (!isWeekday) return false;
  const isMorning = hour >= 7 && hour < 9;
  const isEvening = hour >= 17 && hour < 19;
  return (isMorning && profile?.rushHourPatterns?.morningPeak) ||
         (isEvening && profile?.rushHourPatterns?.eveningPeak);
}

module.exports = {
  PROFILE_PRESETS,
  computeProfileBonus,
  computeProfilePenalty,
  computeHistoryScore,
  computeContextualHistoryScore,
  computeHistoryContextMatch,
  computeVisitShare,
  computeProfileHistoryConcentration,
  computeObservedConversionRate,
  computeContextualObservedConversionRate,
  computeExposureContextMatch,
  computeObservedSkipScore,
  computeTimePatternScore,
  isRushHour,
};
