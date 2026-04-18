const fixtures = require('../data/groundedSimulationFixtures.json');

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

function computeSignedCorridorOffsetMeters(routeCoordinates, bestIndex, station) {
  if (!Array.isArray(routeCoordinates) || routeCoordinates.length < 2 || !station) {
    return 0;
  }

  const anchor = routeCoordinates[Math.max(0, Math.min(routeCoordinates.length - 1, bestIndex))];
  const segmentStart = bestIndex > 0
    ? routeCoordinates[bestIndex - 1]
    : anchor;
  const segmentEnd = bestIndex < routeCoordinates.length - 1
    ? routeCoordinates[bestIndex + 1]
    : anchor;
  const referenceStart = segmentStart === anchor && bestIndex < routeCoordinates.length - 1
    ? anchor
    : segmentStart;
  const referenceEnd = segmentEnd === anchor && bestIndex > 0
    ? anchor
    : segmentEnd;

  if (!anchor || !referenceStart || !referenceEnd) {
    return 0;
  }

  const latRad = toRadians(anchor.latitude || 0);
  const metersPerLat = 111320;
  const metersPerLon = 111320 * Math.max(0.1, Math.cos(latRad));
  const directionX = ((referenceEnd.longitude || 0) - (referenceStart.longitude || 0)) * metersPerLon;
  const directionY = ((referenceEnd.latitude || 0) - (referenceStart.latitude || 0)) * metersPerLat;
  const directionMagnitude = Math.hypot(directionX, directionY);
  if (directionMagnitude < 1) {
    return 0;
  }

  const unitX = directionX / directionMagnitude;
  const unitY = directionY / directionMagnitude;
  const stationX = ((station.longitude || 0) - (anchor.longitude || 0)) * metersPerLon;
  const stationY = ((station.latitude || 0) - (anchor.latitude || 0)) * metersPerLat;
  return (stationX * (-unitY)) + (stationY * unitX);
}

const GROUNDED_SIM_STATIONS = Object.freeze(
  (Array.isArray(fixtures?.stationCatalog) ? fixtures.stationCatalog : []).map(station => ({
    stationId: String(station.stationId),
    stationName: station.stationName || 'Gas station',
    brand: station.brand || station.stationName || 'Gas station',
    address: station.address || null,
    latitude: Number(station.latitude),
    longitude: Number(station.longitude),
    price: Number(station.price),
    providerId: station.providerId || 'gasbuddy',
    updatedAt: station.updatedAt || null,
    fetchedAt: station.fetchedAt || null,
    currency: station.currency || 'USD',
    rating: Number.isFinite(Number(station.rating)) ? Number(station.rating) : null,
    userRatingCount: Number.isFinite(Number(station.userRatingCount)) ? Number(station.userRatingCount) : null,
    distanceMiles: 0,
  }))
);

const GROUNDED_ROUTE_FIXTURES = Object.freeze(
  Array.isArray(fixtures?.routes) ? fixtures.routes.map(route => ({
    id: String(route.id),
    scenario: route.scenario || 'city',
    distanceMeters: Number(route.distanceMeters) || 0,
    expectedTravelTimeSeconds: Number(route.expectedTravelTimeSeconds) || 0,
    routeCoordinates: Array.isArray(route.routeCoordinates)
      ? route.routeCoordinates.map(coordinate => ({
        latitude: Number(coordinate.latitude),
        longitude: Number(coordinate.longitude),
      }))
      : [],
    steps: Array.isArray(route.steps) ? route.steps : [],
    samplePoints: Array.isArray(route.samplePoints) ? route.samplePoints : [],
    stationIds: Array.isArray(route.stationIds) ? route.stationIds.map(String) : [],
  })) : []
);

const GROUNDED_ROUTE_FIXTURES_BY_ID = new Map(
  GROUNDED_ROUTE_FIXTURES.map(route => [route.id, route])
);

const GROUNDED_STATIONS_BY_ID = new Map(
  GROUNDED_SIM_STATIONS.map(station => [station.stationId, station])
);

const DERIVED_ROUTE_SPECS = Object.freeze([
  {
    id: 'weekday-urban-commute-early',
    baseRouteId: 'weekday-urban-commute',
    startFraction: 0.0,
    endFraction: 0.8,
    scenario: 'city',
  },
  {
    id: 'south-urban-errand-mid',
    baseRouteId: 'south-urban-errand',
    startFraction: 0.2,
    endFraction: 0.9,
    scenario: 'city',
  },
  {
    id: 'weekday-return-commute-mid',
    baseRouteId: 'weekday-return-commute',
    startFraction: 0.2,
    endFraction: 0.9,
    scenario: 'city',
  },
  {
    id: 'suburban-school-pickup-mid',
    baseRouteId: 'suburban-school-pickup',
    startFraction: 0.2,
    endFraction: 0.9,
    scenario: 'suburban',
  },
  {
    id: 'downtown-grid-hop-mid',
    baseRouteId: 'downtown-grid-hop',
    startFraction: 0.2,
    endFraction: 0.9,
    scenario: 'city_grid',
  },
]);

function buildCumulativeRouteDistances(routeCoordinates) {
  const cumulativeDistances = [0];
  for (let index = 1; index < routeCoordinates.length; index += 1) {
    cumulativeDistances.push(
      cumulativeDistances[index - 1] + haversineDistanceMeters(
        routeCoordinates[index - 1],
        routeCoordinates[index],
      )
    );
  }
  return cumulativeDistances;
}

function interpolateCoordinateAtDistance(routeCoordinates, cumulativeDistances, targetMeters) {
  if (!Array.isArray(routeCoordinates) || routeCoordinates.length === 0) {
    return null;
  }
  const totalDistance = cumulativeDistances[cumulativeDistances.length - 1] || 0;
  const clampedTargetMeters = Math.max(0, Math.min(totalDistance, Number(targetMeters) || 0));
  for (let index = 1; index < cumulativeDistances.length; index += 1) {
    const segmentStartMeters = cumulativeDistances[index - 1];
    const segmentEndMeters = cumulativeDistances[index];
    if (clampedTargetMeters > segmentEndMeters) {
      continue;
    }
    const segmentDistanceMeters = Math.max(1, segmentEndMeters - segmentStartMeters);
    const progress = (clampedTargetMeters - segmentStartMeters) / segmentDistanceMeters;
    const startCoordinate = routeCoordinates[index - 1];
    const endCoordinate = routeCoordinates[index];
    return {
      latitude: startCoordinate.latitude + ((endCoordinate.latitude - startCoordinate.latitude) * progress),
      longitude: startCoordinate.longitude + ((endCoordinate.longitude - startCoordinate.longitude) * progress),
    };
  }
  return routeCoordinates[routeCoordinates.length - 1];
}

function dedupeRouteCoordinates(routeCoordinates) {
  const deduped = [];
  for (const coordinate of routeCoordinates) {
    const previous = deduped[deduped.length - 1];
    if (
      previous &&
      Math.abs(previous.latitude - coordinate.latitude) < 1e-8 &&
      Math.abs(previous.longitude - coordinate.longitude) < 1e-8
    ) {
      continue;
    }
    deduped.push(coordinate);
  }
  return deduped;
}

function buildRouteStationContexts(routeFixture) {
  if (!routeFixture || !Array.isArray(routeFixture.routeCoordinates) || routeFixture.routeCoordinates.length < 2) {
    return [];
  }

  const cumulativeDistances = buildCumulativeRouteDistances(routeFixture.routeCoordinates);
  const totalDistanceMeters = cumulativeDistances[cumulativeDistances.length - 1] || 1;

  return routeFixture.stationIds
    .map(stationId => {
      const station = getGroundedStationById(stationId);
      if (!station) return null;

      let bestIndex = 0;
      let bestDistanceMeters = Number.POSITIVE_INFINITY;
      for (let index = 0; index < routeFixture.routeCoordinates.length; index += 1) {
        const coordinate = routeFixture.routeCoordinates[index];
        const distanceMeters = haversineDistanceMeters(coordinate, {
          latitude: station.latitude,
          longitude: station.longitude,
        });
        if (distanceMeters < bestDistanceMeters) {
          bestDistanceMeters = distanceMeters;
          bestIndex = index;
        }
      }

      const alongTrackMeters = cumulativeDistances[bestIndex] || 0;
      const signedCorridorOffsetMeters = computeSignedCorridorOffsetMeters(
        routeFixture.routeCoordinates,
        bestIndex,
        station,
      );
      return {
        stationId: station.stationId,
        alongTrackMeters,
        alongTrackFraction: alongTrackMeters / totalDistanceMeters,
        corridorDistanceMeters: bestDistanceMeters,
        signedCorridorOffsetMeters,
        sideOfRoad: signedCorridorOffsetMeters >= 0 ? 'left' : 'right',
        station,
      };
    })
    .filter(Boolean)
    .sort((left, right) =>
      left.alongTrackMeters - right.alongTrackMeters ||
      left.corridorDistanceMeters - right.corridorDistanceMeters
    );
}

function buildDerivedRouteFixture(derivedSpec) {
  const baseRoute = GROUNDED_ROUTE_FIXTURES_BY_ID.get(String(derivedSpec?.baseRouteId || ''));
  if (!baseRoute || !Array.isArray(baseRoute.routeCoordinates) || baseRoute.routeCoordinates.length < 2) {
    return null;
  }

  const cumulativeDistances = buildCumulativeRouteDistances(baseRoute.routeCoordinates);
  const totalDistanceMeters = cumulativeDistances[cumulativeDistances.length - 1] || 0;
  if (totalDistanceMeters <= 0) {
    return null;
  }

  const startMeters = totalDistanceMeters * Math.max(0, Math.min(1, Number(derivedSpec.startFraction) || 0));
  const endMeters = totalDistanceMeters * Math.max(0, Math.min(1, Number(derivedSpec.endFraction) || 1));
  if (endMeters <= startMeters) {
    return null;
  }

  const startCoordinate = interpolateCoordinateAtDistance(baseRoute.routeCoordinates, cumulativeDistances, startMeters);
  const endCoordinate = interpolateCoordinateAtDistance(baseRoute.routeCoordinates, cumulativeDistances, endMeters);
  if (!startCoordinate || !endCoordinate) {
    return null;
  }

  const interiorCoordinates = baseRoute.routeCoordinates.filter((coordinate, index) => {
    const distanceMeters = cumulativeDistances[index];
    return distanceMeters > startMeters && distanceMeters < endMeters;
  });
  const routeCoordinates = dedupeRouteCoordinates([
    startCoordinate,
    ...interiorCoordinates,
    endCoordinate,
  ]);
  if (routeCoordinates.length < 2) {
    return null;
  }

  const baseStationContexts = buildRouteStationContexts(baseRoute);
  const stationIds = baseStationContexts
    .filter(context => context.alongTrackMeters >= startMeters && context.alongTrackMeters <= endMeters)
    .map(context => context.stationId);

  return {
    id: String(derivedSpec.id),
    scenario: derivedSpec.scenario || baseRoute.scenario,
    distanceMeters: Math.round(endMeters - startMeters),
    expectedTravelTimeSeconds: Math.max(
      300,
      Math.round((Number(baseRoute.expectedTravelTimeSeconds) || 0) * ((endMeters - startMeters) / totalDistanceMeters))
    ),
    routeCoordinates,
    steps: [],
    samplePoints: [],
    stationIds,
    baseRouteId: baseRoute.id,
    derivedFrom: {
      baseRouteId: baseRoute.id,
      startFraction: Number(derivedSpec.startFraction) || 0,
      endFraction: Number(derivedSpec.endFraction) || 1,
    },
  };
}

const DERIVED_GROUNDED_ROUTE_FIXTURES = Object.freeze(
  DERIVED_ROUTE_SPECS
    .map(buildDerivedRouteFixture)
    .filter(Boolean)
);

for (const route of DERIVED_GROUNDED_ROUTE_FIXTURES) {
  GROUNDED_ROUTE_FIXTURES_BY_ID.set(route.id, route);
}

const ALL_GROUNDED_ROUTE_FIXTURES = Object.freeze([
  ...GROUNDED_ROUTE_FIXTURES,
  ...DERIVED_GROUNDED_ROUTE_FIXTURES,
]);

const GROUNDED_ROUTE_STATION_CONTEXTS_BY_ID = new Map(
  ALL_GROUNDED_ROUTE_FIXTURES.map(route => [route.id, buildRouteStationContexts(route)])
);

function getGroundedStationById(stationId) {
  return GROUNDED_STATIONS_BY_ID.get(String(stationId || '')) || null;
}

function getGroundedRouteFixture(routeId) {
  return GROUNDED_ROUTE_FIXTURES_BY_ID.get(String(routeId || '')) || null;
}

function getGroundedRouteStations(routeId) {
  const routeFixture = getGroundedRouteFixture(routeId);
  if (!routeFixture) {
    return [];
  }
  return routeFixture.stationIds
    .map(getGroundedStationById)
    .filter(Boolean);
}

function getGroundedRouteStationContexts(routeId) {
  return GROUNDED_ROUTE_STATION_CONTEXTS_BY_ID.get(String(routeId || '')) || [];
}

module.exports = {
  GROUNDED_SIM_STATIONS,
  GROUNDED_ROUTE_FIXTURES: ALL_GROUNDED_ROUTE_FIXTURES,
  getGroundedRouteFixture,
  getGroundedRouteStationContexts,
  getGroundedRouteStations,
  getGroundedStationById,
};
