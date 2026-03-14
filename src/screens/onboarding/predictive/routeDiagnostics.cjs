const {
  buildPredictiveRouteMetrics,
  buildRouteMetrics,
} = require('./simulationMath.cjs');

function getPredictiveRouteDiagnostics(route, sceneConfig) {
  if (route?.initialRoute && route?.rerouteRoute) {
    const combinedMetrics = buildPredictiveRouteMetrics(route, sceneConfig);

    return {
      source: route?.isFallback ? 'fallback' : 'native',
      initialRawCoordinateCount: Array.isArray(route?.initialRoute?.coordinates) ? route.initialRoute.coordinates.length : 0,
      rerouteRawCoordinateCount: Array.isArray(route?.rerouteRoute?.coordinates) ? route.rerouteRoute.coordinates.length : 0,
      renderedCoordinateCount: combinedMetrics.coordinates.length,
      initialStepCount: Array.isArray(route?.initialRoute?.steps) ? route.initialRoute.steps.length : 0,
      rerouteStepCount: Array.isArray(route?.rerouteRoute?.steps) ? route.rerouteRoute.steps.length : 0,
      totalDistanceMeters: Math.round(combinedMetrics.totalDistanceMeters),
      expectedTravelTimeSeconds: Math.round(
        Number(combinedMetrics.expectedTravelTimeSeconds)
        || Number(combinedMetrics.expectedTravelTime)
        || 0
      ),
      rerouteTriggerProgress: Number((combinedMetrics.rerouteTriggerProgress || 0).toFixed(3)),
      expensiveChipRevealProgress: Number((combinedMetrics.expensiveStationProgress || 0).toFixed(3)),
    };
  }

  const routeMetrics = buildRouteMetrics(route, sceneConfig);
  const segmentDistances = routeMetrics.segments.map(segment => segment.distanceMeters);
  const sortedDistances = [...segmentDistances].sort((left, right) => left - right);
  const totalSegmentDistance = segmentDistances.reduce((sum, value) => sum + value, 0);
  const averageSegmentDistanceMeters = segmentDistances.length
    ? totalSegmentDistance / segmentDistances.length
    : 0;
  const percentileIndex = sortedDistances.length
    ? Math.min(sortedDistances.length - 1, Math.floor(sortedDistances.length * 0.9))
    : 0;

  return {
    source: route?.isFallback ? 'fallback' : 'native',
    rawCoordinateCount: Array.isArray(route?.coordinates) ? route.coordinates.length : 0,
    renderedCoordinateCount: routeMetrics.coordinates.length,
    stepCount: Array.isArray(route?.steps) ? route.steps.length : 0,
    totalDistanceMeters: Math.round(routeMetrics.totalDistanceMeters),
    averageSegmentDistanceMeters: Number(averageSegmentDistanceMeters.toFixed(1)),
    maxSegmentDistanceMeters: Number((sortedDistances[sortedDistances.length - 1] || 0).toFixed(1)),
    p90SegmentDistanceMeters: Number((sortedDistances[percentileIndex] || 0).toFixed(1)),
    expectedTravelTimeSeconds: Math.round(
      Number(route?.expectedTravelTimeSeconds)
      || Number(route?.expectedTravelTime)
      || 0
    ),
    expensiveStationProgress: Number(routeMetrics.expensiveStationProgress.toFixed(3)),
  };
}

module.exports = {
  getPredictiveRouteDiagnostics,
};
