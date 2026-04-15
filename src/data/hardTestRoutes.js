const { EXPANDED_STATIONS } = require('./expandedTestRoutes.js');

// Additional stations for long-range scenarios
const HARD_STATIONS = [
  ...EXPANDED_STATIONS,
  { stationId: 'den-i70-far-loves', stationName: "Love's Travel Stop", brand: "Love's", latitude: 39.7470, longitude: -104.7300, price: 3.45, distanceMiles: 0 },
  { stationId: 'den-evans-sinclair', stationName: 'Sinclair Evans', brand: 'Sinclair', latitude: 39.6780, longitude: -104.9600, price: 3.38, distanceMiles: 0 },
  { stationId: 'den-hampden-conoco', stationName: 'Conoco Hampden', brand: 'Conoco', latitude: 39.6540, longitude: -104.9300, price: 3.32, distanceMiles: 0 },
  { stationId: 'den-university-76', stationName: '76 University', brand: '76', latitude: 39.6960, longitude: -104.9620, price: 3.41, distanceMiles: 0 },
];

// Build a relative-time profile for realistic history
// dayOffset: days in the past (0 = today), hour: 24-hour clock, stationId
function mkVisits(visits) {
  const now = Date.now();
  return visits.map(([dayOffset, hour, stationId]) => {
    const d = new Date(now - dayOffset * 86400 * 1000);
    d.setHours(hour, Math.floor(Math.random() * 30), 0, 0);
    return { timestamp: d.getTime(), stationId };
  });
}

function visitHistoryFromVisits(visits) {
  const counts = new Map();
  const timestamps = new Map();
  for (const v of visits) {
    counts.set(v.stationId, (counts.get(v.stationId) || 0) + 1);
    if (!timestamps.has(v.stationId)) timestamps.set(v.stationId, []);
    timestamps.get(v.stationId).push(v.timestamp);
  }
  const latest = new Map();
  for (const [id, tss] of timestamps) {
    latest.set(id, Math.max(...tss));
  }
  return [...counts.entries()].map(([stationId, visitCount]) => ({
    stationId,
    visitCount,
    lastVisitMs: latest.get(stationId),
    visitTimestamps: timestamps.get(stationId),
  }));
}

// Weekday 7am commuter who stops at Shell
const WEEKDAY_MORNING_SHELL_VISITS = mkVisits([
  [1, 7, 'den-downing-shell'],  [2, 7, 'den-downing-shell'],  [3, 7, 'den-downing-shell'],
  [4, 7, 'den-downing-shell'],  [5, 7, 'den-downing-shell'],  [8, 7, 'den-downing-shell'],
  [9, 7, 'den-downing-shell'],  [10, 7, 'den-downing-shell'], [11, 7, 'den-downing-shell'],
  [12, 7, 'den-downing-shell'], [15, 7, 'den-downing-shell'], [16, 7, 'den-downing-shell'],
  [17, 7, 'den-downing-shell'], [18, 7, 'den-downing-shell'], [19, 7, 'den-downing-shell'],
]);

// Saturday morning Costco bulk trip
const WEEKEND_COSTCO_VISITS = mkVisits([
  [7, 10, 'den-belleview-costco'],  [14, 10, 'den-belleview-costco'],
  [21, 10, 'den-belleview-costco'], [28, 10, 'den-belleview-costco'],
  [35, 10, 'den-belleview-costco'], [42, 10, 'den-belleview-costco'],
]);

// Highway truck driver — Pilot stops frequent
const HIGHWAY_PILOT_VISITS = mkVisits([
  [1, 14, 'den-i70-pilot'],  [3, 14, 'den-i70-pilot'], [5, 14, 'den-i70-pilot'],
  [7, 14, 'den-i70-pilot'],  [9, 14, 'den-i70-pilot'], [11, 14, 'den-i70-pilot'],
  [13, 14, 'den-i70-pilot'], [15, 14, 'den-i70-pilot'],
]);

// Rich profile presets for the harder routes
const HARD_PROFILE_PRESETS = {
  morning_shell_commuter: {
    id: 'morning_shell_commuter',
    name: 'Weekday Shell Commuter',
    description: 'Stops at Shell every weekday morning around 7am',
    brandLoyalty: 0.6,
    distanceWeight: 0.3,
    priceWeight: 0.2,
    preferredBrands: ['Shell'],
    preferredGrade: 'regular',
    visitHistory: visitHistoryFromVisits(WEEKDAY_MORNING_SHELL_VISITS),
    fillUpHistory: Array.from({ length: 8 }, (_, i) => ({
      timestamp: Date.now() - (i + 1) * 5 * 86400 * 1000,
      odometer: 45000 - i * 110,
      gallons: 10.5,
      pricePerGallon: 3.59,
    })).reverse(),
    typicalFillUpIntervalMiles: 280,
    rushHourPatterns: { morningPeak: true, eveningPeak: false },
  },
  weekend_costco_shopper: {
    id: 'weekend_costco_shopper',
    name: 'Weekend Costco Shopper',
    description: 'Fuels at Costco during Saturday bulk trips',
    brandLoyalty: 0.7,
    distanceWeight: 0.3,
    priceWeight: 0.7,
    preferredBrands: ['Costco'],
    preferredGrade: 'regular',
    visitHistory: visitHistoryFromVisits(WEEKEND_COSTCO_VISITS),
    fillUpHistory: Array.from({ length: 6 }, (_, i) => ({
      timestamp: Date.now() - (i + 1) * 7 * 86400 * 1000,
      odometer: 55000 - i * 280,
      gallons: 14.0,
      pricePerGallon: 3.09,
    })).reverse(),
    typicalFillUpIntervalMiles: 280,
    rushHourPatterns: { morningPeak: false, eveningPeak: false },
  },
  highway_trucker: {
    id: 'highway_trucker',
    name: 'Highway Frequent Fueler',
    description: 'Stops at Pilot every other day on I-70',
    brandLoyalty: 0.5,
    distanceWeight: 0.2,
    priceWeight: 0.3,
    preferredBrands: ['Pilot'],
    preferredGrade: 'regular',
    visitHistory: visitHistoryFromVisits(HIGHWAY_PILOT_VISITS),
    fillUpHistory: Array.from({ length: 10 }, (_, i) => ({
      timestamp: Date.now() - (i + 1) * 2 * 86400 * 1000,
      odometer: 120000 - i * 320,
      gallons: 30,
      pricePerGallon: 3.49,
    })).reverse(),
    typicalFillUpIntervalMiles: 320,
    rushHourPatterns: { morningPeak: false, eveningPeak: false },
  },
  empty_tank_urgent: {
    id: 'empty_tank_urgent',
    name: 'Near-Empty Driver',
    description: '5% tank, will take any nearby station',
    brandLoyalty: 0.1,
    distanceWeight: 0.9,
    priceWeight: 0.1,
    preferredBrands: [],
    preferredGrade: 'regular',
    visitHistory: [],
    // fillUpHistory configured so rangeEstimator returns high urgency
    fillUpHistory: [{
      timestamp: Date.now() - 12 * 86400 * 1000,
      odometer: 30000,
      gallons: 12,
      pricePerGallon: 3.29,
    }],
    typicalFillUpIntervalMiles: 280,
    rushHourPatterns: { morningPeak: false, eveningPeak: false },
  },
  new_driver_no_history: {
    id: 'new_driver_no_history',
    name: 'First-Time User',
    description: 'Has never used the app before',
    brandLoyalty: 0,
    distanceWeight: 0.5,
    priceWeight: 0.5,
    preferredBrands: [],
    preferredGrade: 'regular',
    visitHistory: [],
    fillUpHistory: [],
    typicalFillUpIntervalMiles: 280,
    rushHourPatterns: { morningPeak: false, eveningPeak: false },
  },
};

// Helper: build a straight-line route from A to B with N waypoints and a
// speed profile callback.
function straightLine(from, to, count, speedFn) {
  const points = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    points.push({
      lat: from.lat + (to.lat - from.lat) * t,
      lon: from.lon + (to.lon - from.lon) * t,
      speedMph: speedFn(t),
    });
  }
  return points;
}

// --- Long-distance hard routes ---
const HARD_TEST_ROUTES = [
  // === TIER 1: FAR-DISTANCE TRUE POSITIVES ===

  // Highway trucker 5km out from Pilot, decelerating toward exit
  {
    id: 'long-highway-pilot',
    name: 'I-70 Pilot — 5km approach',
    description: 'Highway 5km approach to Pilot, decelerating for exit',
    scenario: 'highway',
    category: 'far_approach',
    destinationStationId: 'den-i70-pilot',
    expectsTrigger: true,
    expectedTriggerMinDistance: 2500, // want trigger AT LEAST 2.5km out
    profileId: 'highway_trucker',
    rushHour: false,
    // I-70 runs east-west near y=39.7468. Start 5km east of Pilot.
    waypoints: straightLine(
      { lat: 39.7468, lon: -104.7450 },
      { lat: 39.7468, lon: -104.8000 },
      10,
      (t) => Math.max(10, 70 - t * 55), // 70 → 15 mph
    ),
  },

  // Morning Shell commuter, 4km straight west approach
  {
    id: 'commute-morning-shell',
    name: 'Weekday 7am Shell commute',
    description: 'Regular user 4km straight approach to their usual Shell at 7am',
    scenario: 'city',
    category: 'far_approach',
    destinationStationId: 'den-downing-shell',
    expectsTrigger: true,
    expectedTriggerMinDistance: 2000,
    profileId: 'morning_shell_commuter',
    overrideTime: { hour: 7, dayOfWeek: 2 }, // Tuesday 7am
    waypoints: straightLine(
      { lat: 39.7385, lon: -105.0150 },
      { lat: 39.7385, lon: -104.9726 },
      12,
      (t) => Math.max(10, 30 - t * 12), // 30 → 18 mph decel gentle
    ),
  },

  // Weekend Costco shopper, 6km south approach
  {
    id: 'weekend-costco-trip',
    name: 'Saturday 10am Costco trip',
    description: 'Bulk shopper 6km south approach on Saturday',
    scenario: 'city',
    category: 'far_approach',
    destinationStationId: 'den-belleview-costco',
    expectsTrigger: true,
    expectedTriggerMinDistance: 2500,
    profileId: 'weekend_costco_shopper',
    overrideTime: { hour: 10, dayOfWeek: 6 }, // Saturday
    waypoints: straightLine(
      { lat: 39.6700, lon: -104.9872 },
      { lat: 39.6128, lon: -104.9872 },
      10,
      (t) => Math.max(10, 35 - t * 18), // 35 → 17 mph
    ),
  },

  // Empty-tank driver 3km out — will stop at first nearby station
  {
    id: 'empty-tank-will-take-any',
    name: 'Low fuel — 3km out',
    description: 'Driver at 5% tank, any station 3km ahead should trigger',
    scenario: 'urgent',
    category: 'urgency_approach',
    destinationStationId: 'den-colfax-king-soopers',
    expectsTrigger: true,
    expectedTriggerMinDistance: 2000,
    profileId: 'empty_tank_urgent',
    waypoints: straightLine(
      { lat: 39.7388, lon: -105.0500 },
      { lat: 39.7388, lon: -105.0827 },
      10,
      (t) => Math.max(8, 30 - t * 15), // 30 → 15 mph
    ),
  },

  // === TIER 2: FAR-DISTANCE TRUE NEGATIVES ===

  // Highway drive-through 6km long, passing Pilot without slowing
  {
    id: 'highway-pass-pilot',
    name: 'I-70 drive past Pilot',
    description: 'Highway 6km drive passing Pilot at constant 65mph — no stop',
    scenario: 'highway',
    category: 'far_no_stop',
    destinationStationId: null,
    expectsTrigger: false,
    profileId: 'new_driver_no_history',
    waypoints: straightLine(
      { lat: 39.7468, lon: -104.7500 },
      { lat: 39.7468, lon: -104.8400 },
      12,
      () => 65, // constant 65 mph
    ),
  },

  // Urban leisure drive, passing many stations, not frequent at any
  {
    id: 'urban-leisure-drive',
    name: 'Urban leisure drive',
    description: 'Long urban drive, passing several stations, no history at any',
    scenario: 'city',
    category: 'far_no_stop',
    destinationStationId: null,
    expectsTrigger: false,
    profileId: 'new_driver_no_history',
    waypoints: [
      { lat: 39.7400, lon: -105.0200, speedMph: 25 },
      { lat: 39.7400, lon: -105.0100, speedMph: 25 },
      { lat: 39.7400, lon: -105.0000, speedMph: 25 },
      { lat: 39.7400, lon: -104.9900, speedMph: 25 },
      { lat: 39.7400, lon: -104.9800, speedMph: 25 },
      { lat: 39.7400, lon: -104.9700, speedMph: 25 },
      { lat: 39.7400, lon: -104.9600, speedMph: 25 },
      { lat: 39.7400, lon: -104.9500, speedMph: 25 },
    ],
  },

  // Weekday commuter but at WRONG time (noon) — no pattern match
  {
    id: 'commute-wrong-time',
    name: 'Weekday noon — no pattern',
    description: 'Same commuter, but at noon instead of 7am. Pattern should not match.',
    scenario: 'city',
    category: 'far_no_stop',
    destinationStationId: null,
    expectsTrigger: false,
    profileId: 'morning_shell_commuter',
    overrideTime: { hour: 12, dayOfWeek: 2 },
    // Drive past Shell without stopping
    waypoints: straightLine(
      { lat: 39.7385, lon: -105.0100 },
      { lat: 39.7385, lon: -104.9400 },
      10,
      () => 28, // constant 28 mph drive-by
    ),
  },

  // === TIER 3: MULTI-CANDIDATE DISAMBIGUATION ===

  // Three stations in a row 300m apart; Shell commuter picks their usual one
  {
    id: 'three-station-row-shell',
    name: '3 stations — picks favorite Shell',
    description: 'Three stations within 400m, Shell-loyal commuter heads to their usual',
    scenario: 'city',
    category: 'multi_candidate',
    destinationStationId: 'den-downing-shell',
    expectsTrigger: true,
    expectedTriggerMinDistance: 1200,
    profileId: 'morning_shell_commuter',
    overrideTime: { hour: 7, dayOfWeek: 3 },
    waypoints: [
      { lat: 39.7385, lon: -104.9870, speedMph: 22 },
      { lat: 39.7385, lon: -104.9830, speedMph: 22 },
      { lat: 39.7385, lon: -104.9800, speedMph: 20 },
      { lat: 39.7385, lon: -104.9770, speedMph: 18 },
      { lat: 39.7385, lon: -104.9750, speedMph: 14 },
      { lat: 39.7385, lon: -104.9726, speedMph: 8 },
    ],
  },

  // Price hunter — Costco is 2km further but still picks it
  {
    id: 'price-hunter-detour',
    name: 'Price hunter detours for cheap',
    description: 'Costco shopper 4km out, drives past closer options for cheapest',
    scenario: 'city',
    category: 'multi_candidate',
    destinationStationId: 'den-belleview-costco',
    expectsTrigger: true,
    expectedTriggerMinDistance: 1500,
    profileId: 'weekend_costco_shopper',
    waypoints: straightLine(
      { lat: 39.6500, lon: -104.9872 },
      { lat: 39.6128, lon: -104.9872 },
      10,
      (t) => Math.max(10, 30 - t * 18),
    ),
  },

  // === TIER 4: EDGE CASES ===

  // First-time user, 3km straight approach with strong physical signals only
  {
    id: 'first-time-user-approach',
    name: 'New user — physics only',
    description: 'No history. 3km straight decelerating approach.',
    scenario: 'highway',
    category: 'no_history',
    destinationStationId: 'den-alameda-maverik',
    expectsTrigger: true,
    expectedTriggerMinDistance: 1000,
    profileId: 'new_driver_no_history',
    waypoints: straightLine(
      { lat: 39.7131, lon: -105.0450 },
      { lat: 39.7131, lon: -105.0169 },
      10,
      (t) => Math.max(8, 40 - t * 27),
    ),
  },

  // Reroute mid-trip: starts toward X, then turns toward Y
  {
    id: 'reroute-mid-trip',
    name: 'Reroute mid-trip',
    description: 'Initial heading wrong, driver reroutes to Costco',
    scenario: 'city',
    category: 'reroute',
    destinationStationId: 'den-belleview-costco',
    expectsTrigger: true,
    expectedTriggerMinDistance: 800,
    profileId: 'weekend_costco_shopper',
    waypoints: [
      // Start heading east, then turn south
      { lat: 39.6200, lon: -104.9500, speedMph: 30 },
      { lat: 39.6200, lon: -104.9600, speedMph: 30 },
      { lat: 39.6200, lon: -104.9700, speedMph: 28 },
      { lat: 39.6200, lon: -104.9800, speedMph: 25 },
      { lat: 39.6200, lon: -104.9850, speedMph: 22 },
      { lat: 39.6170, lon: -104.9872, speedMph: 18 }, // turn south now
      { lat: 39.6150, lon: -104.9872, speedMph: 15 },
      { lat: 39.6135, lon: -104.9872, speedMph: 10 },
      { lat: 39.6128, lon: -104.9872, speedMph: 8 },
    ],
  },

  // Stop-and-go urban traffic, 2km ahead
  {
    id: 'stop-and-go-approach',
    name: 'Stop-and-go urban',
    description: 'City traffic with speed bumps, station 2km ahead',
    scenario: 'city',
    category: 'noisy',
    destinationStationId: 'den-colfax-king-soopers',
    expectsTrigger: true,
    expectedTriggerMinDistance: 800,
    profileId: 'new_driver_no_history',
    waypoints: [
      { lat: 39.7388, lon: -105.0627, speedMph: 15 },
      { lat: 39.7388, lon: -105.0650, speedMph: 5 }, // light
      { lat: 39.7388, lon: -105.0680, speedMph: 2 },
      { lat: 39.7388, lon: -105.0720, speedMph: 20 },
      { lat: 39.7388, lon: -105.0750, speedMph: 18 },
      { lat: 39.7388, lon: -105.0770, speedMph: 8 }, // light again
      { lat: 39.7388, lon: -105.0790, speedMph: 12 },
      { lat: 39.7388, lon: -105.0810, speedMph: 10 },
      { lat: 39.7388, lon: -105.0827, speedMph: 5 },
    ],
  },
];

module.exports = { HARD_TEST_ROUTES, HARD_STATIONS, HARD_PROFILE_PRESETS };
