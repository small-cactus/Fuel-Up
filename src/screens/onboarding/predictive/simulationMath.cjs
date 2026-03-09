function toRadians(value) {
  return (value * Math.PI) / 180;
}

function toDegrees(value) {
  return (value * 180) / Math.PI;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(start, end, progress) {
  return start + (end - start) * progress;
}

function smoothstep(edge0, edge1, value) {
  if (edge0 === edge1) {
    return value >= edge1 ? 1 : 0;
  }

  const clamped = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}

function dedupeCoordinates(coordinates) {
  return coordinates.filter((coordinate, index, source) => {
    if (index === 0) {
      return true;
    }

    const previous = source[index - 1];
    return (
      previous.latitude !== coordinate.latitude ||
      previous.longitude !== coordinate.longitude
    );
  });
}

function normalizeCoordinate(coordinate) {
  return {
    latitude: Number(coordinate?.latitude) || 0,
    longitude: Number(coordinate?.longitude) || 0,
  };
}

function haversineDistanceMeters(start, end) {
  const startCoordinate = normalizeCoordinate(start);
  const endCoordinate = normalizeCoordinate(end);
  const earthRadiusMeters = 6371000;
  const latitudeDelta = toRadians(endCoordinate.latitude - startCoordinate.latitude);
  const longitudeDelta = toRadians(endCoordinate.longitude - startCoordinate.longitude);
  const startLatitude = toRadians(startCoordinate.latitude);
  const endLatitude = toRadians(endCoordinate.latitude);
  const a = (
    Math.sin(latitudeDelta / 2) * Math.sin(latitudeDelta / 2) +
    Math.cos(startLatitude) * Math.cos(endLatitude) *
    Math.sin(longitudeDelta / 2) * Math.sin(longitudeDelta / 2)
  );
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusMeters * c;
}

function interpolateCoordinate(start, end, progress) {
  const clampedProgress = clamp(progress, 0, 1);
  return {
    latitude: start.latitude + (end.latitude - start.latitude) * clampedProgress,
    longitude: start.longitude + (end.longitude - start.longitude) * clampedProgress,
  };
}

function interpolateHeadingDegrees(startHeading, endHeading, progress) {
  const clampedProgress = clamp(progress, 0, 1);
  const normalizedDelta = ((endHeading - startHeading + 540) % 360) - 180;
  return (startHeading + normalizedDelta * clampedProgress + 360) % 360;
}

function densifyCoordinates(coordinates, maximumSpacingMeters = 6) {
  const safeSpacingMeters = Math.max(2, Number(maximumSpacingMeters) || 6);
  const normalizedCoordinates = dedupeCoordinates((coordinates || []).map(normalizeCoordinate));

  if (normalizedCoordinates.length <= 1) {
    return normalizedCoordinates;
  }

  const densifiedCoordinates = [normalizedCoordinates[0]];

  for (let index = 0; index < normalizedCoordinates.length - 1; index += 1) {
    const start = normalizedCoordinates[index];
    const end = normalizedCoordinates[index + 1];
    const segmentDistanceMeters = haversineDistanceMeters(start, end);

    if (segmentDistanceMeters <= 0) {
      continue;
    }

    const subdivisionCount = Math.max(1, Math.ceil(segmentDistanceMeters / safeSpacingMeters));
    for (let subdivisionIndex = 1; subdivisionIndex <= subdivisionCount; subdivisionIndex += 1) {
      densifiedCoordinates.push(
        interpolateCoordinate(start, end, subdivisionIndex / subdivisionCount)
      );
    }
  }

  return dedupeCoordinates(densifiedCoordinates);
}

function calculateHeadingDegrees(start, end) {
  const startCoordinate = normalizeCoordinate(start);
  const endCoordinate = normalizeCoordinate(end);
  const startLatitude = toRadians(startCoordinate.latitude);
  const startLongitude = toRadians(startCoordinate.longitude);
  const endLatitude = toRadians(endCoordinate.latitude);
  const endLongitude = toRadians(endCoordinate.longitude);
  const longitudeDelta = endLongitude - startLongitude;

  const y = Math.sin(longitudeDelta) * Math.cos(endLatitude);
  const x = (
    Math.cos(startLatitude) * Math.sin(endLatitude) -
    Math.sin(startLatitude) * Math.cos(endLatitude) * Math.cos(longitudeDelta)
  );
  const heading = toDegrees(Math.atan2(y, x));
  return (heading + 360) % 360;
}

function buildRouteSegments(coordinates, maximumSpacingMeters = 6) {
  const sanitizedCoordinates = densifyCoordinates(coordinates, maximumSpacingMeters);

  const segments = [];
  let totalDistanceMeters = 0;

  for (let index = 0; index < sanitizedCoordinates.length - 1; index += 1) {
    const start = sanitizedCoordinates[index];
    const end = sanitizedCoordinates[index + 1];
    const distanceMeters = haversineDistanceMeters(start, end);

    if (distanceMeters <= 0) {
      continue;
    }

    segments.push({
      start,
      end,
      distanceMeters,
      startDistanceMeters: totalDistanceMeters,
      endDistanceMeters: totalDistanceMeters + distanceMeters,
    });
    totalDistanceMeters += distanceMeters;
  }

  return {
    coordinates: sanitizedCoordinates,
    segments,
    totalDistanceMeters,
  };
}

function getPointAtDistance(routeMetrics, distanceMeters) {
  const safeDistance = clamp(distanceMeters, 0, routeMetrics.totalDistanceMeters || 0);

  if (!routeMetrics.segments.length) {
    const coordinate = routeMetrics.coordinates[0] || { latitude: 0, longitude: 0 };
    return {
      coordinate,
      travelledDistanceMeters: 0,
      heading: 0,
    };
  }

  const segment = routeMetrics.segments.find(candidate => safeDistance <= candidate.endDistanceMeters)
    || routeMetrics.segments[routeMetrics.segments.length - 1];
  const segmentProgress = segment.distanceMeters > 0
    ? (safeDistance - segment.startDistanceMeters) / segment.distanceMeters
    : 0;
  const coordinate = interpolateCoordinate(segment.start, segment.end, segmentProgress);
  const headingSampleDistance = Math.min(
    routeMetrics.totalDistanceMeters,
    safeDistance + Math.max(segment.distanceMeters * 0.35, 24)
  );
  const headingTarget = (
    headingSampleDistance > safeDistance
      ? getCoordinateAtDistance(routeMetrics, headingSampleDistance)
      : segment.end
  );

  return {
    coordinate,
    travelledDistanceMeters: safeDistance,
    heading: calculateHeadingDegrees(coordinate, headingTarget),
  };
}

function getCoordinateAtDistance(routeMetrics, distanceMeters) {
  return getPointAtDistance(routeMetrics, distanceMeters).coordinate;
}

function getProgressForNearestCoordinate(routeMetrics, targetCoordinate) {
  if (!routeMetrics.coordinates.length) {
    return 0;
  }

  let bestDistance = Number.POSITIVE_INFINITY;
  let bestProgress = 0;

  routeMetrics.coordinates.forEach((coordinate, index) => {
    const distanceToTarget = haversineDistanceMeters(coordinate, targetCoordinate);
    if (distanceToTarget < bestDistance) {
      bestDistance = distanceToTarget;
      bestProgress = routeMetrics.coordinates.length <= 1
        ? 0
        : index / (routeMetrics.coordinates.length - 1);
    }
  });

  return bestProgress;
}

function getScenePhase(progress, expensiveStationProgress) {
  const expensiveLeadWindow = Math.max(0.11, expensiveStationProgress - 0.07);
  const expensiveTailWindow = Math.min(1, expensiveStationProgress + 0.05);

  if (progress < expensiveLeadWindow) {
    return 'driving';
  }
  if (progress <= expensiveTailWindow) {
    return 'passing-expensive';
  }
  return 'routing-cheap';
}

function getPassedStationState(progress, expensiveStationProgress) {
  if (progress < expensiveStationProgress - 0.03) {
    return 'default';
  }
  if (progress <= expensiveStationProgress + 0.035) {
    return 'highlighted';
  }
  return 'dimmed';
}

function formatDistanceMiles(distanceMeters) {
  const distanceMiles = distanceMeters / 1609.344;
  return `${distanceMiles.toFixed(distanceMiles >= 10 ? 0 : 1)} mi`;
}

function formatDurationMinutes(seconds) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `${minutes} min`;
}

function isTurnInstruction(instructions) {
  return /turn left|turn right|keep left|keep right|slight left|slight right|merge|take the/i.test(
    String(instructions || '')
  );
}

function buildTurnEvents(route, baseMetrics, sceneConfig) {
  return (route?.steps || [])
    .filter(step => {
      if (!step?.coordinate) {
        return false;
      }

      if ((Number(step.distanceMeters) || 0) < (sceneConfig?.turnPreview?.minimumTurnDistanceMeters || 18)) {
        return false;
      }

      return isTurnInstruction(step.instructions);
    })
    .map(step => {
      const progress = getProgressForNearestCoordinate(baseMetrics, step.coordinate);
      const distanceMeters = baseMetrics.totalDistanceMeters * progress;
      const postTurnSampleDistanceMeters = Math.min(
        baseMetrics.totalDistanceMeters,
        distanceMeters + (sceneConfig?.turnPreview?.postTurnSampleMeters || 76)
      );
      const entrySampleDistanceMeters = Math.max(0, distanceMeters - 18);
      const entryHeading = getPointAtDistance(baseMetrics, entrySampleDistanceMeters).heading;
      const exitHeading = getPointAtDistance(baseMetrics, postTurnSampleDistanceMeters).heading;

      return {
        coordinate: normalizeCoordinate(step.coordinate),
        distanceMeters,
        entryHeading,
        exitHeading,
        instructions: step.instructions,
      };
    })
    .sort((left, right) => left.distanceMeters - right.distanceMeters);
}

function buildRouteMetrics(route, sceneConfig) {
  const baseMetrics = buildRouteSegments(
    route?.coordinates || [],
    sceneConfig?.routeSpacingMeters
  );
  const expensiveStationProgress = getProgressForNearestCoordinate(
    baseMetrics,
    sceneConfig.expensiveStation.coordinate
  );
  const initialCoordinate = baseMetrics.coordinates[0] || sceneConfig.origin;
  const initialHeading = baseMetrics.coordinates.length > 1
    ? calculateHeadingDegrees(baseMetrics.coordinates[0], baseMetrics.coordinates[1])
    : 180;
  const routeRegion = getRouteRegion(baseMetrics.coordinates);
  const turnEvents = buildTurnEvents(route, baseMetrics, sceneConfig);
  const primaryTurnDistanceMeters = turnEvents[1]?.distanceMeters
    || turnEvents[0]?.distanceMeters
    || baseMetrics.totalDistanceMeters * 0.15;
  const showcaseDistanceMeters = clamp(
    baseMetrics.totalDistanceMeters * Math.max(0.7, expensiveStationProgress - 0.08),
    primaryTurnDistanceMeters + 120,
    baseMetrics.totalDistanceMeters * 0.9
  );

  return {
    ...route,
    coordinates: baseMetrics.coordinates,
    segments: baseMetrics.segments,
    totalDistanceMeters: baseMetrics.totalDistanceMeters,
    expensiveStationProgress,
    initialCoordinate,
    initialHeading,
    routeRegion,
    turnEvents,
    primaryTurnDistanceMeters,
    showcaseDistanceMeters,
  };
}

function getNarrative(sceneConfig, scenePhase, remainingDistanceMeters, remainingTravelTimeSeconds) {
  const savingsPerGallon = (sceneConfig.expensiveStation.price - sceneConfig.destinationStation.price).toFixed(2);

  if (scenePhase === 'passing-expensive') {
    return {
      title: `Passing ${sceneConfig.expensiveStation.brand} at $${sceneConfig.expensiveStation.price.toFixed(2)}`,
      subtitle: `Skip the pricey stop and stay on route for savings.`,
      distanceLabel: formatDistanceMiles(remainingDistanceMeters),
      durationLabel: formatDurationMinutes(remainingTravelTimeSeconds),
      savingsLabel: `$${savingsPerGallon}/gal less`,
    };
  }

  if (scenePhase === 'routing-cheap') {
    return {
      title: `Routing to ${sceneConfig.destinationStation.brand} at $${sceneConfig.destinationStation.price.toFixed(2)}`,
      subtitle: `Fuel Up keeps the cheaper station ahead of you, not behind you.`,
      distanceLabel: formatDistanceMiles(remainingDistanceMeters),
      durationLabel: formatDurationMinutes(remainingTravelTimeSeconds),
      savingsLabel: `$${savingsPerGallon}/gal less`,
    };
  }

  return {
    title: 'Driving through SF',
    subtitle: `Watching your route for a cheaper gas stop before you need it.`,
    distanceLabel: formatDistanceMiles(remainingDistanceMeters),
    durationLabel: formatDurationMinutes(remainingTravelTimeSeconds),
    savingsLabel: `$${savingsPerGallon}/gal less`,
  };
}

function getRouteRegion(coordinates) {
  if (!coordinates?.length) {
    return {
      latitude: 37.7838,
      longitude: -122.3999,
      latitudeDelta: 0.03,
      longitudeDelta: 0.03,
    };
  }

  let minLatitude = coordinates[0].latitude;
  let maxLatitude = coordinates[0].latitude;
  let minLongitude = coordinates[0].longitude;
  let maxLongitude = coordinates[0].longitude;

  coordinates.forEach(coordinate => {
    minLatitude = Math.min(minLatitude, coordinate.latitude);
    maxLatitude = Math.max(maxLatitude, coordinate.latitude);
    minLongitude = Math.min(minLongitude, coordinate.longitude);
    maxLongitude = Math.max(maxLongitude, coordinate.longitude);
  });

  return {
    latitude: (minLatitude + maxLatitude) / 2,
    longitude: (minLongitude + maxLongitude) / 2,
    latitudeDelta: Math.max(0.018, (maxLatitude - minLatitude) * 1.7),
    longitudeDelta: Math.max(0.018, (maxLongitude - minLongitude) * 1.7),
  };
}

function getCameraForProgress(routeMetrics, sceneConfig, progress) {
  const clampedProgress = clamp(progress, 0, 1);
  const currentDistanceMeters = routeMetrics.totalDistanceMeters * clampedProgress;
  const point = getPointAtDistance(routeMetrics, currentDistanceMeters);
  const phase = getScenePhase(clampedProgress, routeMetrics.expensiveStationProgress);
  const introToCruiseBlend = smoothstep(
    routeMetrics.primaryTurnDistanceMeters - 8,
    routeMetrics.primaryTurnDistanceMeters + 110,
    currentDistanceMeters
  );
  const cruiseToShowcaseBlend = smoothstep(
    routeMetrics.showcaseDistanceMeters - 180,
    routeMetrics.showcaseDistanceMeters + 60,
    currentDistanceMeters
  );
  const basePitch = lerp(
    lerp(
      sceneConfig.cameraProfiles.intro.pitch,
      sceneConfig.cameraProfiles.cruise.pitch,
      introToCruiseBlend
    ),
    sceneConfig.cameraProfiles.showcase.pitch,
    cruiseToShowcaseBlend
  );
  const baseLeadMeters = lerp(
    lerp(
      sceneConfig.cameraProfiles.intro.leadMeters,
      sceneConfig.cameraProfiles.cruise.leadMeters,
      introToCruiseBlend
    ),
    sceneConfig.cameraProfiles.showcase.leadMeters,
    cruiseToShowcaseBlend
  );
  const storyboardAltitude = lerp(
    lerp(
      sceneConfig.cameraProfiles.intro.altitude,
      sceneConfig.cameraProfiles.cruise.altitude,
      introToCruiseBlend
    ),
    sceneConfig.cameraProfiles.showcase.altitude,
    cruiseToShowcaseBlend
  );
  const leadDistanceMeters = Math.min(
    routeMetrics.totalDistanceMeters,
    currentDistanceMeters + baseLeadMeters
  );
  const center = getCoordinateAtDistance(routeMetrics, leadDistanceMeters);
  const phaseAltitude = (
    phase === 'passing-expensive'
      ? sceneConfig.cameraAltitudes.passingExpensive
      : phase === 'routing-cheap'
        ? sceneConfig.cameraAltitudes.routingCheap
        : sceneConfig.cameraAltitudes.driving
  );
  const altitude = lerp(storyboardAltitude, phaseAltitude, 0.32);
  const upcomingTurn = (routeMetrics.turnEvents || []).find(turnEvent => (
    turnEvent.distanceMeters > currentDistanceMeters &&
    turnEvent.distanceMeters - currentDistanceMeters <= sceneConfig.turnPreview.lookaheadMeters
  ));

  if (!upcomingTurn) {
    return {
      center,
      heading: point.heading,
      pitch: basePitch,
      altitude,
    };
  }

  const turnDistanceMeters = upcomingTurn.distanceMeters - currentDistanceMeters;
  const turnBlend = clamp(
    1 - turnDistanceMeters / sceneConfig.turnPreview.lookaheadMeters,
    0,
    1
  );
  const turnFocusCenter = interpolateCoordinate(
    center,
    upcomingTurn.coordinate,
    sceneConfig.turnPreview.centerBlend * turnBlend
  );
  const turnHeading = interpolateHeadingDegrees(
    point.heading,
    upcomingTurn.exitHeading,
    sceneConfig.turnPreview.headingBlend * turnBlend
  );
  const turnAltitude = altitude + (
    sceneConfig.turnPreview.altitude - altitude
  ) * turnBlend;
  const turnPitch = lerp(basePitch, sceneConfig.cameraProfiles.intro.pitch, turnBlend * 0.58);

  return {
    center: turnFocusCenter,
    heading: turnHeading,
    pitch: turnPitch,
    altitude: turnAltitude,
  };
}

function getDemoSnapshot(routeMetrics, sceneConfig, progress) {
  const clampedProgress = clamp(progress, 0, 1);
  const point = getPointAtDistance(routeMetrics, routeMetrics.totalDistanceMeters * clampedProgress);
  const scenePhase = getScenePhase(clampedProgress, routeMetrics.expensiveStationProgress);
  const remainingDistanceMeters = Math.max(
    0,
    routeMetrics.totalDistanceMeters - point.travelledDistanceMeters
  );
  const expectedTravelTimeSeconds = Number(routeMetrics.expectedTravelTimeSeconds)
    || Number(routeMetrics.expectedTravelTime)
    || 0;
  const remainingTravelTimeSeconds = expectedTravelTimeSeconds * (1 - clampedProgress);

  return {
    progress: clampedProgress,
    carCoordinate: point.coordinate,
    heading: point.heading,
    travelledDistanceMeters: point.travelledDistanceMeters,
    remainingDistanceMeters,
    remainingTravelTimeSeconds,
    scenePhase,
    passedStationState: getPassedStationState(clampedProgress, routeMetrics.expensiveStationProgress),
    activeCamera: getCameraForProgress(routeMetrics, sceneConfig, clampedProgress),
    narrative: getNarrative(
      sceneConfig,
      scenePhase,
      remainingDistanceMeters,
      remainingTravelTimeSeconds
    ),
  };
}

module.exports = {
  buildRouteMetrics,
  densifyCoordinates,
  calculateHeadingDegrees,
  getCameraForProgress,
  getDemoSnapshot,
  getPassedStationState,
  getPointAtDistance,
  getProgressForNearestCoordinate,
  getRouteRegion,
  getScenePhase,
  haversineDistanceMeters,
  interpolateHeadingDegrees,
  interpolateCoordinate,
};
