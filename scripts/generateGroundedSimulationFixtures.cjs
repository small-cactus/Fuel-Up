#!/usr/bin/env node

const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  buildGasBuddyGraphQLRequest,
  normalizeGasBuddyResponse,
} = require('../src/services/fuel/core.js');

const OUTPUT_PATH = path.join(__dirname, '..', 'src', 'data', 'groundedSimulationFixtures.json');

const ROUTE_SPECS = [
  {
    id: 'weekday-urban-commute',
    scenario: 'city',
    start: { latitude: 39.7385, longitude: -105.0700 },
    end: { latitude: 39.7400, longitude: -104.9360 },
  },
  {
    id: 'south-urban-errand',
    scenario: 'city',
    start: { latitude: 39.7050, longitude: -105.0600 },
    end: { latitude: 39.7180, longitude: -104.9300 },
  },
  {
    id: 'north-club-run',
    scenario: 'suburban',
    start: { latitude: 39.8000, longitude: -105.0700 },
    end: { latitude: 39.8550, longitude: -104.9550 },
  },
  {
    id: 'airport-corridor-run',
    scenario: 'highway',
    start: { latitude: 39.7440, longitude: -105.0050 },
    end: { latitude: 39.7471, longitude: -104.7360 },
  },
  {
    id: 'weekend-roadtrip-outbound',
    scenario: 'highway',
    start: { latitude: 39.7440, longitude: -105.0050 },
    end: { latitude: 39.7500, longitude: -104.4300 },
  },
  {
    id: 'downtown-grid-hop',
    scenario: 'city_grid',
    start: { latitude: 39.7500, longitude: -105.0150 },
    end: { latitude: 39.7310, longitude: -104.9650 },
  },
  {
    id: 'weekday-return-commute',
    scenario: 'city',
    start: { latitude: 39.7400, longitude: -104.9360 },
    end: { latitude: 39.7385, longitude: -105.0700 },
  },
  {
    id: 'suburban-school-pickup',
    scenario: 'suburban',
    start: { latitude: 39.7050, longitude: -105.0200 },
    end: { latitude: 39.6400, longitude: -104.9880 },
  },
  {
    id: 'late-night-social-hop',
    scenario: 'city',
    start: { latitude: 39.7300, longitude: -105.0200 },
    end: { latitude: 39.7480, longitude: -104.9700 },
  },
  {
    id: 'weekend-roadtrip-return',
    scenario: 'highway',
    start: { latitude: 39.7500, longitude: -104.4300 },
    end: { latitude: 39.7440, longitude: -105.0050 },
  },
];

const MARKET_PROBE_POINTS = [
  { id: 'denver-core-west', latitude: 39.7392, longitude: -105.0230 },
  { id: 'denver-core-east', latitude: 39.7392, longitude: -104.9600 },
  { id: 'south-suburban', latitude: 39.6680, longitude: -104.9900 },
  { id: 'north-suburban', latitude: 39.8400, longitude: -104.9920 },
  { id: 'i70-corridor', latitude: 39.7480, longitude: -104.7350 },
  { id: 'i70-east', latitude: 39.7490, longitude: -104.4300 },
];

const KNOWN_BRANDS = [
  "Sam's Club",
  "Love's",
  '7-Eleven',
  'Phillips 66',
  'King Soopers',
  'Safeway',
  'Sinclair',
  'Conoco',
  'Chevron',
  'Costco',
  'Valero',
  'Circle K',
  'Shell',
  'Exxon',
  'Pilot',
  'TA',
  'BP',
];

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function haversineDistanceMeters(left, right) {
  const earthRadiusMeters = 6_371_000;
  const latitudeDelta = toRadians((right.latitude || 0) - (left.latitude || 0));
  const longitudeDelta = toRadians((right.longitude || 0) - (left.longitude || 0));
  const latitudeA = toRadians(left.latitude || 0);
  const latitudeB = toRadians(right.latitude || 0);
  const haversine =
    Math.sin(latitudeDelta / 2) * Math.sin(latitudeDelta / 2) +
    Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(longitudeDelta / 2) * Math.sin(longitudeDelta / 2);
  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function inferBrand(stationName) {
  const normalizedName = String(stationName || '').toLowerCase();
  const brand = KNOWN_BRANDS.find(candidate => normalizedName.includes(candidate.toLowerCase()));
  if (brand) {
    return brand;
  }

  const firstToken = String(stationName || '').trim().split(/\s+/)[0];
  return firstToken || 'Independent';
}

function parseSwiftRoute(stdout) {
  const distanceMatch = stdout.match(/distanceMeters=(\d+)/);
  const timeMatch = stdout.match(/expectedTravelTimeSeconds=(\d+)/);
  const coordinatesMatch = stdout.match(/coordinates=\[(.*?)\]\nsteps=\[/s);
  const stepsMatch = stdout.match(/steps=\[(.*?)\]\s*$/s);

  const coordinates = [];
  const coordinatePattern = /\{ latitude: ([^,]+), longitude: ([^ }]+) \}/g;
  let coordinateMatch;
  while ((coordinateMatch = coordinatePattern.exec(coordinatesMatch?.[1] || '')) !== null) {
    coordinates.push({
      latitude: Number(coordinateMatch[1]),
      longitude: Number(coordinateMatch[2]),
    });
  }

  const steps = [];
  const stepPattern = /instructions: "(.*?)",\n\s+distanceMeters: (\d+),\n\s+expectedTravelTimeSeconds: (\d+),\n\s+coordinate: \{ latitude: ([^,]+), longitude: ([^ }]+) \},/g;
  let stepMatch;
  while ((stepMatch = stepPattern.exec(stepsMatch?.[1] || '')) !== null) {
    steps.push({
      instructions: stepMatch[1],
      distanceMeters: Number(stepMatch[2]),
      expectedTravelTimeSeconds: Number(stepMatch[3]),
      coordinate: {
        latitude: Number(stepMatch[4]),
        longitude: Number(stepMatch[5]),
      },
    });
  }

  return {
    distanceMeters: Number(distanceMatch?.[1] || 0),
    expectedTravelTimeSeconds: Number(timeMatch?.[1] || 0),
    coordinates,
    steps,
  };
}

function loadMapKitRoute(routeSpec) {
  const stdout = execFileSync(
    'swift',
    [
      path.join('scripts', 'predictiveRouteProbe.swift'),
      String(routeSpec.start.latitude),
      String(routeSpec.start.longitude),
      String(routeSpec.end.latitude),
      String(routeSpec.end.longitude),
    ],
    {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
    }
  );
  return parseSwiftRoute(stdout);
}

async function fetchGasBuddyQuotes(point) {
  const maxAttempts = 6;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const request = buildGasBuddyGraphQLRequest({
      latitude: point.latitude,
      longitude: point.longitude,
      fuelType: 'regular',
    });
    const response = await fetch('https://www.gasbuddy.com/graphql', {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(request.body),
    });
    if (response.ok) {
      const payload = await response.json();
      return normalizeGasBuddyResponse({
        origin: {
          latitude: point.latitude,
          longitude: point.longitude,
        },
        fuelType: 'regular',
        payload,
      }) || [];
    }
    if (response.status !== 429 || attempt === (maxAttempts - 1)) {
      throw new Error(`GasBuddy request failed with ${response.status}`);
    }
    const retryDelayMs = 25_000 + (attempt * 15_000);
    await new Promise(resolve => setTimeout(resolve, retryDelayMs));
  }
  return [];
}

function computeCorridorDistanceMeters(routeCoordinates, station) {
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const coordinate of routeCoordinates) {
    const distanceMeters = haversineDistanceMeters(coordinate, {
      latitude: station.latitude,
      longitude: station.longitude,
    });
    if (distanceMeters < bestDistance) {
      bestDistance = distanceMeters;
    }
  }
  return bestDistance;
}

function corridorDistanceThresholdMeters(routeSpec) {
  if (routeSpec.scenario === 'highway') return 4_500;
  if (routeSpec.scenario === 'suburban') return 3_500;
  if (routeSpec.scenario === 'city_grid') return 2_500;
  return 3_000;
}

function stationSort(left, right) {
  return (
    (left.corridorDistanceMeters - right.corridorDistanceMeters) ||
    (left.price - right.price) ||
    String(left.stationId).localeCompare(String(right.stationId))
  );
}

async function fetchGroundedMarketStations() {
  const stationMap = new Map();
  for (const probePoint of MARKET_PROBE_POINTS) {
    const quotes = await fetchGasBuddyQuotes(probePoint);
    for (const quote of quotes) {
      if (!quote?.stationId) continue;
      const stationId = String(quote.stationId);
      const existing = stationMap.get(stationId);
      const nextStation = {
        stationId,
        stationName: quote.stationName,
        brand: inferBrand(quote.stationName),
        address: quote.address || null,
        latitude: Number(quote.latitude),
        longitude: Number(quote.longitude),
        price: Number(quote.price),
        providerId: quote.providerId || 'gasbuddy',
        updatedAt: quote.updatedAt || null,
        fetchedAt: quote.fetchedAt || null,
        currency: quote.currency || 'USD',
        rating: Number.isFinite(Number(quote.rating)) ? Number(quote.rating) : null,
        userRatingCount: Number.isFinite(Number(quote.userRatingCount)) ? Number(quote.userRatingCount) : null,
        probeHitCount: existing ? existing.probeHitCount + 1 : 1,
      };
      stationMap.set(stationId, nextStation);
    }
    await new Promise(resolve => setTimeout(resolve, 20_000));
  }
  return Array.from(stationMap.values());
}

async function buildRouteFixture(routeSpec, marketStations) {
  const route = loadMapKitRoute(routeSpec);
  const rankedStations = marketStations
    .map(station => ({
      ...station,
      corridorDistanceMeters: computeCorridorDistanceMeters(route.coordinates, station),
    }))
    .sort(stationSort);
  const thresholdMeters = corridorDistanceThresholdMeters(routeSpec);
  const corridorStations = rankedStations.filter(station => station.corridorDistanceMeters <= thresholdMeters);
  const selectedStations = (corridorStations.length >= 4 ? corridorStations : rankedStations).slice(0, 18);

  if (selectedStations.length < 4) {
    throw new Error(`Route ${routeSpec.id} only found ${selectedStations.length} grounded stations.`);
  }

  return {
    route: {
      id: routeSpec.id,
      scenario: routeSpec.scenario,
      distanceMeters: route.distanceMeters,
      expectedTravelTimeSeconds: route.expectedTravelTimeSeconds,
      routeCoordinates: route.coordinates,
      steps: route.steps,
      samplePoints: [],
      stationIds: selectedStations.map(station => station.stationId),
    },
    stations: selectedStations,
  };
}

async function main() {
  const marketStations = await fetchGroundedMarketStations();
  const stationCatalog = new Map();
  const routes = [];

  for (const routeSpec of ROUTE_SPECS) {
    const fixture = await buildRouteFixture(routeSpec, marketStations);
    routes.push(fixture.route);
    for (const station of fixture.stations) {
      const existing = stationCatalog.get(station.stationId);
      if (!existing || stationSort(station, existing) < 0) {
        stationCatalog.set(station.stationId, station);
      }
    }
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    source: {
      routeProvider: 'apple-mapkit',
      stationProvider: 'gasbuddy',
      fuelType: 'regular',
    },
    stationCatalog: Array.from(stationCatalog.values())
      .sort((left, right) => String(left.stationId).localeCompare(String(right.stationId)))
      .map(station => ({
        stationId: station.stationId,
        stationName: station.stationName,
        brand: station.brand,
        address: station.address,
        latitude: station.latitude,
        longitude: station.longitude,
        price: station.price,
        providerId: station.providerId,
        updatedAt: station.updatedAt,
        fetchedAt: station.fetchedAt,
        currency: station.currency,
        rating: station.rating,
        userRatingCount: station.userRatingCount,
      })),
    routes,
  };

  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${payload.routes.length} grounded routes and ${payload.stationCatalog.length} stations to ${OUTPUT_PATH}`);
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
