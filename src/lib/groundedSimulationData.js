const fixtures = require('../data/groundedSimulationFixtures.json');

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

module.exports = {
  GROUNDED_SIM_STATIONS,
  GROUNDED_ROUTE_FIXTURES,
  getGroundedRouteFixture,
  getGroundedRouteStations,
  getGroundedStationById,
};
