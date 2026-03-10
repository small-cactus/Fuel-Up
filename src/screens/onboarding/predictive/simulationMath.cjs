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

function getHeadingDeltaMagnitude(startHeading, endHeading) {
  return Math.abs(((endHeading - startHeading + 540) % 360) - 180);
}

function clampHeadingAroundTarget(heading, targetHeading, maximumDeltaDegrees) {
  const safeMaximumDeltaDegrees = Math.max(0, Number(maximumDeltaDegrees) || 0);
  const normalizedDelta = ((heading - targetHeading + 540) % 360) - 180;

  if (Math.abs(normalizedDelta) <= safeMaximumDeltaDegrees) {
    return (heading + 360) % 360;
  }

  const clampedDelta = clamp(
    normalizedDelta,
    -safeMaximumDeltaDegrees,
    safeMaximumDeltaDegrees
  );
  return (targetHeading + clampedDelta + 360) % 360;
}

function blendCameraStates(startCamera, endCamera, progress) {
  const clampedProgress = clamp(progress, 0, 1);

  return {
    center: interpolateCoordinate(
      startCamera.center,
      endCamera.center,
      clampedProgress
    ),
    heading: interpolateHeadingDegrees(
      startCamera.heading,
      endCamera.heading,
      clampedProgress
    ),
    altitude: lerp(startCamera.altitude, endCamera.altitude, clampedProgress),
    pitch: lerp(startCamera.pitch, endCamera.pitch, clampedProgress),
  };
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

function getCoordinateIndexAtDistance(routeMetrics, distanceMeters) {
  if (!routeMetrics?.coordinates?.length) {
    return 0;
  }

  const coordinate = getCoordinateAtDistance(routeMetrics, distanceMeters);
  return getNearestCoordinateIndex(routeMetrics.coordinates, coordinate);
}

function getWindowHeadingAtDistance(routeMetrics, distanceMeters, behindMeters, aheadMeters) {
  const safeBehindMeters = Math.max(0, Number(behindMeters) || 0);
  const safeAheadMeters = Math.max(0, Number(aheadMeters) || 0);
  const startDistanceMeters = Math.max(0, distanceMeters - safeBehindMeters);
  const endDistanceMeters = Math.min(
    routeMetrics.totalDistanceMeters || 0,
    distanceMeters + safeAheadMeters
  );
  const startCoordinate = getCoordinateAtDistance(routeMetrics, startDistanceMeters);
  const endCoordinate = getCoordinateAtDistance(routeMetrics, endDistanceMeters);

  if (haversineDistanceMeters(startCoordinate, endCoordinate) <= 0.5) {
    return calculateHeadingDegrees(
      startCoordinate,
      getCoordinateAtDistance(
        routeMetrics,
        Math.min(routeMetrics.totalDistanceMeters || 0, distanceMeters + 24)
      )
    );
  }

  return calculateHeadingDegrees(startCoordinate, endCoordinate);
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

function getNearestCoordinateIndex(coordinates, targetCoordinate) {
  if (!coordinates?.length) {
    return 0;
  }

  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  coordinates.forEach((coordinate, index) => {
    const distance = haversineDistanceMeters(coordinate, targetCoordinate);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });

  return bestIndex;
}

function getScenePhase(progress, expensiveStationProgress, rerouteTriggerProgress = expensiveStationProgress) {
  const expensiveLeadWindow = Math.max(0.11, expensiveStationProgress - 0.06);
  const expensiveTailWindow = Math.min(1, rerouteTriggerProgress + 0.02);

  if (progress < expensiveLeadWindow) {
    return 'driving';
  }
  if (progress <= expensiveTailWindow) {
    return 'passing-expensive';
  }
  return 'routing-cheap';
}

function getPassedStationState(progress, expensiveStationProgress, rerouteTriggerProgress = expensiveStationProgress) {
  if (progress < expensiveStationProgress - 0.025) {
    return 'default';
  }
  if (progress <= rerouteTriggerProgress + 0.018) {
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

function getRerouteOverviewStartProgress(routeMetrics, sceneConfig) {
  const rerouteOverviewDelayProgress = clamp(
    (sceneConfig?.cameraStoryboard?.rerouteOverviewDelayMs || 0) /
    Math.max(1, sceneConfig?.loopDurationMs || 1),
    0,
    0.35
  );
  const rerouteOverviewTriggerProgress = clamp(
    (routeMetrics.rerouteTriggerProgress || 0) + rerouteOverviewDelayProgress,
    0,
    1
  );
  const rerouteOverviewStartProgress = clamp(
    rerouteOverviewTriggerProgress - (sceneConfig?.cameraStoryboard?.rerouteOverviewLeadProgress || 0.05),
    0,
    1
  );

  return rerouteOverviewStartProgress;
}

function getChipRevealProgresses(routeMetrics, sceneConfig) {
  const rerouteOverviewStartProgress = getRerouteOverviewStartProgress(routeMetrics, sceneConfig);
  const expensiveRevealProgress = clamp(
    rerouteOverviewStartProgress + (
      (sceneConfig?.stationChipReveal?.expensiveAfterOverviewStartMs || 400) /
      Math.max(1, sceneConfig?.loopDurationMs || 1)
    ),
    0,
    1
  );
  const destinationRevealProgress = clamp(
    rerouteOverviewStartProgress + (
      (sceneConfig?.stationChipReveal?.destinationAfterOverviewStartMs || 800) /
      Math.max(1, sceneConfig?.loopDurationMs || 1)
    ),
    0,
    1
  );

  return {
    expensiveRevealProgress,
    destinationRevealProgress,
  };
}

function getChipRevealState(routeMetrics, sceneConfig, travelledDistanceMeters, progress = 0) {
  const {
    expensiveRevealProgress,
    destinationRevealProgress,
  } = getChipRevealProgresses(routeMetrics, sceneConfig);

  return {
    expensive: progress >= expensiveRevealProgress,
    destination: progress >= destinationRevealProgress,
  };
}

function getProfileValues(profile = {}) {
  return {
    altitude: Number(profile.altitude) || 0,
    leadMeters: Number(profile.leadMeters) || 0,
    pitch: Number(profile.pitch) || 0,
  };
}

function blendProfileValues(startProfile, endProfile, progress) {
  return {
    altitude: lerp(startProfile.altitude, endProfile.altitude, progress),
    leadMeters: lerp(startProfile.leadMeters, endProfile.leadMeters, progress),
    pitch: lerp(startProfile.pitch, endProfile.pitch, progress),
  };
}

function buildPredictiveRouteMetrics(routeSet, sceneConfig) {
  const initialRouteMetrics = buildRouteMetrics(routeSet.initialRoute, sceneConfig);
  const rerouteRouteMetrics = buildRouteMetrics(routeSet.rerouteRoute, sceneConfig);
  const rerouteTriggerProgressOnInitial = getProgressForNearestCoordinate(
    initialRouteMetrics,
    sceneConfig.rerouteOrigin
  );
  const rerouteTriggerDistanceOnInitial = (
    initialRouteMetrics.totalDistanceMeters * rerouteTriggerProgressOnInitial
  );
  const rerouteTriggerIndexOnInitial = getNearestCoordinateIndex(
    initialRouteMetrics.coordinates,
    sceneConfig.rerouteOrigin
  );
  const initialPrefixCoordinates = initialRouteMetrics.coordinates.slice(0, rerouteTriggerIndexOnInitial + 1);
  const initialPrefixSteps = (routeSet.initialRoute.steps || []).filter(step => (
    getProgressForNearestCoordinate(initialRouteMetrics, step.coordinate) <= rerouteTriggerProgressOnInitial + 0.0005
  ));
  const combinedRoute = {
    coordinates: dedupeCoordinates([
      ...initialPrefixCoordinates,
      ...(routeSet.rerouteRoute.coordinates || []).slice(1),
    ]),
    expectedTravelTimeSeconds: Math.round(
      (Number(routeSet.initialRoute.expectedTravelTimeSeconds) || 0) * rerouteTriggerProgressOnInitial +
      (Number(routeSet.rerouteRoute.expectedTravelTimeSeconds) || 0)
    ),
    steps: [
      ...initialPrefixSteps,
      ...(routeSet.rerouteRoute.steps || []),
    ],
  };
  const combinedMetrics = buildRouteMetrics(combinedRoute, sceneConfig);
  const rerouteTriggerProgress = getProgressForNearestCoordinate(combinedMetrics, sceneConfig.rerouteOrigin);
  const rerouteTriggerDistanceMeters = combinedMetrics.totalDistanceMeters * rerouteTriggerProgress;
  const expensiveChipRevealProgress = combinedMetrics.totalDistanceMeters > 0
    ? Math.max(
      0,
      (rerouteTriggerDistanceMeters - (sceneConfig?.stationChipReveal?.expensiveLeadMeters || 260)) /
      combinedMetrics.totalDistanceMeters
    )
    : 0;
  const destinationRevealDistanceMeters = Math.max(
    rerouteTriggerDistanceMeters + (sceneConfig?.stationChipReveal?.destinationPostRerouteLeadMeters || 140),
    combinedMetrics.totalDistanceMeters - (sceneConfig?.stationChipReveal?.destinationLeadMeters || 480)
  );
  const destinationRevealProgress = combinedMetrics.totalDistanceMeters > 0
    ? clamp(destinationRevealDistanceMeters / combinedMetrics.totalDistanceMeters, 0, 1)
    : 1;
  const lastPreExpensiveTurn = combinedMetrics.turnEvents
    .filter(turnEvent => turnEvent.distanceMeters <= rerouteTriggerDistanceMeters + 1)
    .at(-1);
  const preExpensiveStraightProgress = lastPreExpensiveTurn
    ? clamp(lastPreExpensiveTurn.distanceMeters / combinedMetrics.totalDistanceMeters, 0, rerouteTriggerProgress)
    : Math.max(0, rerouteTriggerProgress - 0.04);

  return {
    ...combinedMetrics,
    initialRouteMetrics,
    rerouteRouteMetrics,
    initialRouteCoordinates: routeSet.initialRoute.coordinates || [],
    rerouteRouteCoordinates: routeSet.rerouteRoute.coordinates || [],
    rerouteTriggerDistanceMeters,
    rerouteTriggerProgress,
    preExpensiveStraightProgress,
    expensiveStationProgress: expensiveChipRevealProgress,
    destinationStationProgress: destinationRevealProgress,
    isFallback: routeSet?.isFallback,
  };
}

function buildVisibleRouteSlice(routeMetrics, startDistanceMeters, endDistanceMeters) {
  if (!routeMetrics?.coordinates?.length) {
    return [];
  }

  const safeStartDistanceMeters = clamp(
    startDistanceMeters,
    0,
    routeMetrics.totalDistanceMeters
  );
  const safeEndDistanceMeters = clamp(
    Math.max(safeStartDistanceMeters, endDistanceMeters),
    0,
    routeMetrics.totalDistanceMeters
  );
  const startCoordinate = getCoordinateAtDistance(routeMetrics, safeStartDistanceMeters);
  const endCoordinate = getCoordinateAtDistance(routeMetrics, safeEndDistanceMeters);
  const startCoordinateIndex = getCoordinateIndexAtDistance(routeMetrics, safeStartDistanceMeters);
  const endCoordinateIndex = getCoordinateIndexAtDistance(routeMetrics, safeEndDistanceMeters);
  const interiorCoordinates = routeMetrics.coordinates.slice(
    Math.min(startCoordinateIndex + 1, routeMetrics.coordinates.length),
    Math.min(endCoordinateIndex + 1, routeMetrics.coordinates.length)
  );

  return dedupeCoordinates([
    startCoordinate,
    ...interiorCoordinates,
    endCoordinate,
  ]);
}

function getVisibleRouteCoordinates(routeMetrics, travelledDistanceMeters, progress = 0, sceneConfig = null) {
  if (!routeMetrics?.coordinates?.length) {
    return [];
  }

  const destinationRevealProgress = sceneConfig
    ? getChipRevealProgresses(routeMetrics, sceneConfig).destinationRevealProgress
    : routeMetrics.rerouteTriggerProgress;

  if (
    routeMetrics.rerouteRouteMetrics &&
    progress >= destinationRevealProgress
  ) {
    const revealDurationProgress = sceneConfig
      ? (
        (sceneConfig?.stationChipReveal?.routeRevealDurationMs || 700) /
        Math.max(1, sceneConfig?.loopDurationMs || 1)
      )
      : 0;
    const revealProgress = revealDurationProgress > 0
      ? clamp(
        (progress - destinationRevealProgress) / revealDurationProgress,
        0,
        1
      )
      : 1;
    const rerouteEndDistanceMeters = lerp(
      0,
      routeMetrics.rerouteRouteMetrics.totalDistanceMeters,
      revealProgress
    );

    return buildVisibleRouteSlice(
      routeMetrics.rerouteRouteMetrics,
      0,
      rerouteEndDistanceMeters
    );
  }

  if (routeMetrics.initialRouteMetrics) {
    return routeMetrics.initialRouteMetrics.coordinates;
  }

  return buildVisibleRouteSlice(
    routeMetrics,
    travelledDistanceMeters,
    routeMetrics.totalDistanceMeters
  );
}

function getSpeedFactorAtDistance(routeMetrics, sceneConfig, distanceMeters) {
  const slowdownLookaheadMeters = sceneConfig?.motionProfile?.slowdownLookaheadMeters || 86;
  const slowdownRecoveryMeters = sceneConfig?.motionProfile?.slowdownRecoveryMeters || 54;
  const minimumSpeedFactor = sceneConfig?.motionProfile?.turnSlowFactor || 0.76;
  let speedFactor = 1;

  (routeMetrics.turnEvents || []).forEach(turnEvent => {
    const startDistanceMeters = turnEvent.distanceMeters - slowdownLookaheadMeters;
    const endDistanceMeters = turnEvent.distanceMeters + slowdownRecoveryMeters;
    const slowdownBlend = smoothstep(startDistanceMeters, turnEvent.distanceMeters, distanceMeters)
      - smoothstep(turnEvent.distanceMeters, endDistanceMeters, distanceMeters);
    const candidateSpeedFactor = 1 - slowdownBlend * (1 - minimumSpeedFactor);
    speedFactor = Math.min(speedFactor, candidateSpeedFactor);
  });

  return clamp(speedFactor, minimumSpeedFactor, 1);
}

function buildDistanceTiming(routeMetrics, sceneConfig) {
  if (!routeMetrics.coordinates.length) {
    return [{
      distanceMeters: 0,
      timeWeight: 0,
    }];
  }

  const samples = [{ distanceMeters: 0, timeWeight: 0 }];
  let cumulativeTimeWeight = 0;

  routeMetrics.segments.forEach(segment => {
    const midpointDistanceMeters = segment.startDistanceMeters + segment.distanceMeters / 2;
    const speedFactor = getSpeedFactorAtDistance(routeMetrics, sceneConfig, midpointDistanceMeters);
    cumulativeTimeWeight += segment.distanceMeters / speedFactor;
    samples.push({
      distanceMeters: segment.endDistanceMeters,
      timeWeight: cumulativeTimeWeight,
    });
  });

  return samples;
}

function getDistanceForTimeProgress(routeMetrics, progress) {
  const samples = routeMetrics.distanceTiming || [];
  if (!samples.length) {
    return 0;
  }

  const totalTimeWeight = samples[samples.length - 1].timeWeight || 0;
  if (totalTimeWeight <= 0) {
    return routeMetrics.totalDistanceMeters * clamp(progress, 0, 1);
  }

  const targetTimeWeight = totalTimeWeight * clamp(progress, 0, 1);
  const sampleIndex = samples.findIndex(sample => targetTimeWeight <= sample.timeWeight);

  if (sampleIndex <= 0) {
    return samples[0].distanceMeters;
  }

  const endSample = samples[sampleIndex];
  const startSample = samples[sampleIndex - 1];
  const intervalWeight = endSample.timeWeight - startSample.timeWeight;
  const intervalProgress = intervalWeight > 0
    ? (targetTimeWeight - startSample.timeWeight) / intervalWeight
    : 0;

  return lerp(startSample.distanceMeters, endSample.distanceMeters, intervalProgress);
}

function isTurnInstruction(instructions) {
  return /turn left|turn right|keep left|keep right|slight left|slight right|merge|take the/i.test(
    String(instructions || '')
  );
}

function buildTurnEvents(route, baseMetrics, sceneConfig) {
  const minimumTurnGapMeters = sceneConfig?.turnPreview?.minimumTurnGapMeters || 140;
  const startExclusionMeters = sceneConfig?.turnPreview?.startExclusionMeters || 90;
  const endExclusionMeters = sceneConfig?.turnPreview?.endExclusionMeters || 90;

  const events = (route?.steps || [])
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
        turnMagnitude: getHeadingDeltaMagnitude(entryHeading, exitHeading),
      };
    })
    .filter(turnEvent => (
      turnEvent.distanceMeters >= startExclusionMeters &&
      turnEvent.distanceMeters <= baseMetrics.totalDistanceMeters - endExclusionMeters
    ))
    .sort((left, right) => left.distanceMeters - right.distanceMeters);

  return events.reduce((filteredEvents, turnEvent) => {
    const previousTurnEvent = filteredEvents[filteredEvents.length - 1];

    if (!previousTurnEvent) {
      filteredEvents.push(turnEvent);
      return filteredEvents;
    }

    if (turnEvent.distanceMeters - previousTurnEvent.distanceMeters >= minimumTurnGapMeters) {
      filteredEvents.push(turnEvent);
      return filteredEvents;
    }

    if (turnEvent.turnMagnitude >= previousTurnEvent.turnMagnitude) {
      filteredEvents[filteredEvents.length - 1] = turnEvent;
    }

    return filteredEvents;
  }, []);
}

function buildCameraTurnEvents(turnEvents, sceneConfig, mergeGapOverride = null) {
  const mergeGapMeters = mergeGapOverride
    || sceneConfig?.turnPreview?.cameraTurnGroupGapMeters
    || 320;
  const maxGroupSpanMeters = mergeGapOverride
    ? sceneConfig?.turnPreview?.headingTurnGroupMaxSpanMeters || 620
    : sceneConfig?.turnPreview?.cameraTurnGroupMaxSpanMeters || 620;

  return (turnEvents || []).reduce((cameraEvents, turnEvent) => {
    const previousCameraEvent = cameraEvents[cameraEvents.length - 1];

    if (!previousCameraEvent) {
      cameraEvents.push({
        peakDistanceMeters: turnEvent.distanceMeters,
        startDistanceMeters: turnEvent.distanceMeters,
        endDistanceMeters: turnEvent.distanceMeters,
        turnMagnitude: turnEvent.turnMagnitude,
        entryHeading: turnEvent.entryHeading,
        exitHeading: turnEvent.exitHeading,
        eventCount: 1,
      });
      return cameraEvents;
    }

    if (turnEvent.distanceMeters - previousCameraEvent.endDistanceMeters > mergeGapMeters) {
      cameraEvents.push({
        peakDistanceMeters: turnEvent.distanceMeters,
        startDistanceMeters: turnEvent.distanceMeters,
        endDistanceMeters: turnEvent.distanceMeters,
        turnMagnitude: turnEvent.turnMagnitude,
        entryHeading: turnEvent.entryHeading,
        exitHeading: turnEvent.exitHeading,
        eventCount: 1,
      });
      return cameraEvents;
    }

    if (turnEvent.distanceMeters - previousCameraEvent.startDistanceMeters > maxGroupSpanMeters) {
      cameraEvents.push({
        peakDistanceMeters: turnEvent.distanceMeters,
        startDistanceMeters: turnEvent.distanceMeters,
        endDistanceMeters: turnEvent.distanceMeters,
        turnMagnitude: turnEvent.turnMagnitude,
        entryHeading: turnEvent.entryHeading,
        exitHeading: turnEvent.exitHeading,
        eventCount: 1,
      });
      return cameraEvents;
    }

    const totalWeight = previousCameraEvent.turnMagnitude + turnEvent.turnMagnitude;
    previousCameraEvent.peakDistanceMeters = totalWeight > 0
      ? (
        previousCameraEvent.peakDistanceMeters * previousCameraEvent.turnMagnitude +
        turnEvent.distanceMeters * turnEvent.turnMagnitude
      ) / totalWeight
      : turnEvent.distanceMeters;
    previousCameraEvent.entryHeading = interpolateHeadingDegrees(
      previousCameraEvent.entryHeading,
      turnEvent.entryHeading,
      totalWeight > 0 ? turnEvent.turnMagnitude / totalWeight : 0
    );
    previousCameraEvent.exitHeading = interpolateHeadingDegrees(
      previousCameraEvent.exitHeading,
      turnEvent.exitHeading,
      totalWeight > 0 ? turnEvent.turnMagnitude / totalWeight : 0
    );
    previousCameraEvent.endDistanceMeters = turnEvent.distanceMeters;
    previousCameraEvent.turnMagnitude = Math.max(
      previousCameraEvent.turnMagnitude,
      turnEvent.turnMagnitude
    );
    previousCameraEvent.eventCount += 1;
    return cameraEvents;
  }, []);
}

function buildRouteMetrics(route, sceneConfig) {
  const baseMetrics = buildRouteSegments(
    route?.coordinates || [],
    sceneConfig?.routeSpacingMeters
  );
  const expensiveStationProgress = typeof sceneConfig?.expensiveStation?.routeProgress === 'number'
    ? clamp(sceneConfig.expensiveStation.routeProgress, 0, 1)
    : getProgressForNearestCoordinate(
      baseMetrics,
      sceneConfig.expensiveStation.coordinate
    );
  const destinationStationProgress = getProgressForNearestCoordinate(
    baseMetrics,
    sceneConfig.destinationStation.coordinate
  );
  const initialCoordinate = baseMetrics.coordinates[0] || sceneConfig.origin;
  const initialHeading = baseMetrics.coordinates.length > 1
    ? calculateHeadingDegrees(baseMetrics.coordinates[0], baseMetrics.coordinates[1])
    : 180;
  const overviewHeading = baseMetrics.coordinates.length > 1
    ? calculateHeadingDegrees(
      baseMetrics.coordinates[0],
      baseMetrics.coordinates[baseMetrics.coordinates.length - 1]
    )
    : initialHeading;
  const finalHeading = baseMetrics.segments.length
    ? calculateHeadingDegrees(
      baseMetrics.segments[baseMetrics.segments.length - 1].start,
      baseMetrics.segments[baseMetrics.segments.length - 1].end
    )
    : overviewHeading;
  const routeRegion = getRouteRegion(baseMetrics.coordinates);
  const turnEvents = buildTurnEvents(route, baseMetrics, sceneConfig);
  const cameraTurnEvents = buildCameraTurnEvents(turnEvents, sceneConfig);
  const headingTurnEvents = buildCameraTurnEvents(
    turnEvents,
    sceneConfig,
    sceneConfig?.turnPreview?.headingTurnGroupGapMeters || 520
  );
  const primaryTurnDistanceMeters = turnEvents[1]?.distanceMeters
    || turnEvents[0]?.distanceMeters
    || baseMetrics.totalDistanceMeters * 0.15;
  const showcaseDistanceMeters = clamp(
    baseMetrics.totalDistanceMeters * Math.max(0.7, expensiveStationProgress - 0.08),
    primaryTurnDistanceMeters + 120,
    baseMetrics.totalDistanceMeters * 0.9
  );
  const provisionalMetrics = {
    ...route,
    coordinates: baseMetrics.coordinates,
    segments: baseMetrics.segments,
    totalDistanceMeters: baseMetrics.totalDistanceMeters,
    expensiveStationProgress,
    destinationStationProgress,
    initialCoordinate,
    initialHeading,
    overviewHeading,
    finalHeading,
    routeRegion,
    turnEvents,
    cameraTurnEvents,
    headingTurnEvents,
    primaryTurnDistanceMeters,
    showcaseDistanceMeters,
  };
  const distanceTiming = buildDistanceTiming(provisionalMetrics, sceneConfig);

  return {
    ...provisionalMetrics,
    distanceTiming,
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

function getCoordinateMidpoint(start, end) {
  return {
    latitude: (start.latitude + end.latitude) / 2,
    longitude: (start.longitude + end.longitude) / 2,
  };
}

function getCameraForProgress(routeMetrics, sceneConfig, progress) {
  const clampedProgress = clamp(progress, 0, 1);
  const currentDistanceMeters = routeMetrics.totalDistanceMeters * clampedProgress;
  const point = getPointAtDistance(routeMetrics, currentDistanceMeters);
  const phase = getScenePhase(
    clampedProgress,
    routeMetrics.expensiveStationProgress,
    routeMetrics.rerouteTriggerProgress
  );
  const storyboard = sceneConfig.cameraStoryboard || {};
  const rerouteOverviewDelayProgress = clamp(
    (storyboard.rerouteOverviewDelayMs || 0) / Math.max(1, sceneConfig.loopDurationMs || 1),
    0,
    0.35
  );
  const rerouteOverviewTriggerProgress = clamp(
    routeMetrics.rerouteTriggerProgress + rerouteOverviewDelayProgress,
    0,
    1
  );
  const followProfile = getProfileValues(sceneConfig.cameraProfiles.intro);
  const rerouteOverviewProfile = getProfileValues(
    sceneConfig.cameraProfiles.rerouteOverview || sceneConfig.cameraProfiles.cruise
  );
  const cheapFocusProfile = getProfileValues(
    sceneConfig.cameraProfiles.destinationFocus || sceneConfig.cameraProfiles.stationFocus || sceneConfig.cameraProfiles.showcase
  );
  const rerouteOverviewBlend = clamp(
    Math.min(
      smoothstep(
        Math.max(
          0,
          rerouteOverviewTriggerProgress - (storyboard.rerouteOverviewLeadProgress || 0.012)
        ),
        rerouteOverviewTriggerProgress,
        clampedProgress
      ),
      1 - smoothstep(
        routeMetrics.destinationStationProgress - (storyboard.cheapFocusLeadProgress || 0.055),
        routeMetrics.destinationStationProgress + (storyboard.rerouteOverviewTailProgress || 0.11),
        clampedProgress
      )
    ),
    0,
    1
  );
  let profileValues = blendProfileValues(
    followProfile,
    rerouteOverviewProfile,
    rerouteOverviewBlend
  );
  const startupFollowBlend = smoothstep(
    0.02,
    storyboard.startupFollowEndProgress || 0.18,
    clampedProgress
  );
  const cheapFocusBlend = clamp(
    Math.min(
      smoothstep(
        Math.max(0, routeMetrics.destinationStationProgress - (storyboard.cheapFocusLeadProgress || 0.055)),
        routeMetrics.destinationStationProgress,
        clampedProgress
      ),
      1 - smoothstep(
        1,
        1 + (storyboard.cheapFocusTailProgress || 0.035),
        clampedProgress
      )
    ),
    0,
    1
  );
  profileValues = blendProfileValues(
    profileValues,
    cheapFocusProfile,
    cheapFocusBlend
  );
  const leadDistanceMeters = Math.min(
    routeMetrics.totalDistanceMeters,
    currentDistanceMeters + (
      profileValues.leadMeters * lerp(
        storyboard.startupLeadBlend || 0.42,
        1,
        startupFollowBlend
      )
    )
  );
  const leadCenter = getCoordinateAtDistance(routeMetrics, leadDistanceMeters);
  const center = interpolateCoordinate(
    point.coordinate,
    leadCenter,
    lerp(storyboard.startupLeadBlend || 0.42, 1, startupFollowBlend)
  );
  const rerouteOverviewCenter = getCoordinateMidpoint(
    sceneConfig.expensiveStation.coordinate,
    sceneConfig.destinationStation.coordinate
  );
  const rerouteCenteredBase = interpolateCoordinate(
    center,
    rerouteOverviewCenter,
    rerouteOverviewBlend * (storyboard.rerouteOverviewCenterBlend || 0.92)
  );
  const cruiseHeading = routeMetrics.rerouteRouteMetrics?.overviewHeading || routeMetrics.overviewHeading;
  const localFollowHeading = currentDistanceMeters >= routeMetrics.totalDistanceMeters - 8
    ? routeMetrics.finalHeading
    : point.heading;
  const phaseAltitude = (
    phase === 'passing-expensive'
      ? sceneConfig.cameraAltitudes.passingExpensive
      : phase === 'routing-cheap'
        ? sceneConfig.cameraAltitudes.routingCheap
        : sceneConfig.cameraAltitudes.driving
  );
  const altitude = lerp(profileValues.altitude, phaseAltitude, 0.22);
  const turnContributions = (routeMetrics.cameraTurnEvents || routeMetrics.turnEvents || [])
    .map(turnEvent => {
      const turnStartDistanceMeters = turnEvent.startDistanceMeters - sceneConfig.turnPreview.lookaheadMeters;
      const turnPeakDistanceMeters = turnEvent.peakDistanceMeters;
      const turnEndDistanceMeters = turnEvent.endDistanceMeters + sceneConfig.turnPreview.recoveryMeters + (
        Math.max(0, (turnEvent.eventCount || 1) - 1) *
        (sceneConfig.turnPreview.groupRecoveryExtensionMeters || 120)
      );
      const headingTurnStartDistanceMeters = turnEvent.startDistanceMeters - (
        sceneConfig.turnPreview.headingLookaheadMeters || sceneConfig.turnPreview.lookaheadMeters
      );
      const headingTurnEndDistanceMeters = turnEvent.endDistanceMeters + (
        sceneConfig.turnPreview.headingRecoveryMeters || sceneConfig.turnPreview.recoveryMeters
      );
      const influence = clamp(
        Math.min(
          smoothstep(
            turnStartDistanceMeters,
            turnPeakDistanceMeters,
            currentDistanceMeters
          ),
          1 - smoothstep(
            turnEvent.endDistanceMeters,
            turnEndDistanceMeters,
            currentDistanceMeters
          )
        ),
        0,
        1
      );
      const headingInfluence = clamp(
        Math.min(
          smoothstep(
            headingTurnStartDistanceMeters,
            turnPeakDistanceMeters,
            currentDistanceMeters
          ),
          1 - smoothstep(
            turnEvent.endDistanceMeters,
            headingTurnEndDistanceMeters,
            currentDistanceMeters
          )
        ),
        0,
        1
      ) * (sceneConfig.turnPreview.headingInfluence || 0.72) * lerp(
        storyboard.startupHeadingAnticipationScale || 0.28,
        1,
        startupFollowBlend
      );

      if (influence <= 0.001 && headingInfluence <= 0.001) {
        return null;
      }

      const turnLeadMeters = lerp(
        profileValues.leadMeters,
        sceneConfig.turnPreview.leadMeters,
        influence
      );

      return {
        influence,
        headingInfluence,
        heading: turnEvent.exitHeading,
        center: getCoordinateAtDistance(
          routeMetrics,
          Math.min(routeMetrics.totalDistanceMeters, currentDistanceMeters + turnLeadMeters)
        ),
        altitude,
        pitch: profileValues.pitch,
      };
    })
    .filter(Boolean);
  const headingTurnContributions = (routeMetrics.headingTurnEvents || routeMetrics.turnEvents || [])
    .map(turnEvent => {
      const headingTurnStartDistanceMeters = turnEvent.startDistanceMeters != null
        ? turnEvent.startDistanceMeters - (
          sceneConfig.turnPreview.headingLookaheadMeters || sceneConfig.turnPreview.lookaheadMeters
        )
        : turnEvent.distanceMeters - (
        sceneConfig.turnPreview.headingLookaheadMeters || sceneConfig.turnPreview.lookaheadMeters
      );
      const headingTurnCenterDistanceMeters = turnEvent.peakDistanceMeters != null
        ? turnEvent.peakDistanceMeters
        : turnEvent.distanceMeters;
      const headingTurnExitDistanceMeters = turnEvent.endDistanceMeters != null
        ? turnEvent.endDistanceMeters
        : turnEvent.distanceMeters;
      const headingTurnEndDistanceMeters = headingTurnExitDistanceMeters + (
        sceneConfig.turnPreview.headingRecoveryMeters || sceneConfig.turnPreview.recoveryMeters
      );
      const headingInfluence = clamp(
        Math.min(
          smoothstep(
            headingTurnStartDistanceMeters,
            headingTurnCenterDistanceMeters,
            currentDistanceMeters
          ),
          1 - smoothstep(
            headingTurnExitDistanceMeters,
            headingTurnEndDistanceMeters,
            currentDistanceMeters
          )
        ),
        0,
        1
      ) * (sceneConfig.turnPreview.headingInfluence || 0.72) * lerp(
        storyboard.startupHeadingAnticipationScale || 0.28,
        1,
        startupFollowBlend
      );

      if (headingInfluence <= 0.001) {
        return null;
      }

      return { headingInfluence };
    })
    .filter(Boolean);
  const totalHeadingInfluence = clamp(
    headingTurnContributions.reduce((sum, contribution) => sum + contribution.headingInfluence, 0),
    0,
    1
  );
  const headingPathLookahead = sceneConfig.cameraHeadingPathLookahead || {};
  const startupTurnAnticipation = sceneConfig.startupTurnAnticipation || {};
  const earlyTurnCount = Math.max(0, Number(startupTurnAnticipation.earlyTurnCount) || 0);
  const earlyTurnWindowEndDistanceMeters = earlyTurnCount > 0
    ? (
      routeMetrics.turnEvents?.[
        Math.min(
          Math.max(0, earlyTurnCount - 1),
          Math.max(0, (routeMetrics.turnEvents?.length || 1) - 1)
        )
      ]?.distanceMeters || 0
    ) + (startupTurnAnticipation.tailMeters || 140)
    : 0;
  const startupTurnBlend = earlyTurnWindowEndDistanceMeters > 0
    ? 1 - smoothstep(0, earlyTurnWindowEndDistanceMeters, currentDistanceMeters)
    : 0;
  const headingWindowConfig = sceneConfig.cameraHeadingWindow || {};
  const cameraFollowHeading = currentDistanceMeters >= routeMetrics.totalDistanceMeters - 8
    ? routeMetrics.finalHeading
    : getWindowHeadingAtDistance(
      routeMetrics,
      currentDistanceMeters,
      headingWindowConfig.behindMeters || 28,
      (
        (headingWindowConfig.aheadMeters || 124) +
        totalHeadingInfluence * (headingWindowConfig.turnAheadBoostMeters || 120)
      )
    );
  const routeHeadingLookaheadMeters = clamp(
    lerp(
      headingPathLookahead.baseMeters || 96,
      (
        (headingPathLookahead.baseMeters || 96) +
        (headingPathLookahead.turnBoostMeters || 132) +
        (rerouteOverviewBlend * (headingPathLookahead.cruiseBoostMeters || 28))
      ),
      totalHeadingInfluence
    ),
    headingPathLookahead.minimumMeters || 56,
    headingPathLookahead.maximumMeters || 260
  ) * lerp(0.42, 1, startupFollowBlend) * lerp(1, 0.52, cheapFocusBlend);
  const startupAdjustedLookaheadMeters = clamp(
    routeHeadingLookaheadMeters + (
      (startupTurnAnticipation.extraLookaheadMeters || 170) * startupTurnBlend
    ),
    headingPathLookahead.minimumMeters || 56,
    headingPathLookahead.maximumMeters || 260
  );
  const routeHeadingTargetCoordinate = getCoordinateAtDistance(
    routeMetrics,
    Math.min(
      routeMetrics.totalDistanceMeters,
      currentDistanceMeters + startupAdjustedLookaheadMeters
    )
  );
  const routePreviewHeading = haversineDistanceMeters(
    point.coordinate,
    routeHeadingTargetCoordinate
  ) > 0.5
    ? interpolateHeadingDegrees(
      cameraFollowHeading,
      calculateHeadingDegrees(point.coordinate, routeHeadingTargetCoordinate),
      clamp(
        lerp(0.18, 0.84, totalHeadingInfluence) *
        lerp(storyboard.startupHeadingAnticipationScale || 0.28, 1, startupFollowBlend) *
        lerp(startupTurnAnticipation.blendScale || 0.58, 1, 1 - startupTurnBlend) *
        lerp(1, 0.58, cheapFocusBlend),
        0,
        1
      )
    )
    : cameraFollowHeading;
  const overviewBlendedHeading = interpolateHeadingDegrees(
    interpolateHeadingDegrees(routePreviewHeading, cruiseHeading, rerouteOverviewBlend * 0.14),
    routePreviewHeading,
    cheapFocusBlend
  );
  const headingLockConfig = sceneConfig.cameraHeadingLock || {};
  const baseHeading = clampHeadingAroundTarget(
    overviewBlendedHeading,
    cameraFollowHeading,
    lerp(
      headingLockConfig.followMaxDeltaDegrees || 8,
      headingLockConfig.cruiseMaxDeltaDegrees || 14,
      rerouteOverviewBlend * (1 - cheapFocusBlend)
    )
  );

  if (!turnContributions.length) {
    return {
      center: rerouteCenteredBase,
        heading: baseHeading,
      pitch: profileValues.pitch,
      altitude,
    };
  }

  const totalTurnInfluence = clamp(
    turnContributions.reduce((sum, contribution) => sum + contribution.influence, 0),
    0,
    1
  );
  const weightedTurnCenter = turnContributions.reduce((accumulator, contribution) => ({
    latitude: accumulator.latitude + contribution.center.latitude * contribution.influence,
    longitude: accumulator.longitude + contribution.center.longitude * contribution.influence,
  }), { latitude: 0, longitude: 0 });
  const weightedTurnPitch = turnContributions.reduce(
    (sum, contribution) => sum + contribution.pitch * contribution.influence,
    0
  );
  const weightedTurnAltitude = turnContributions.reduce(
    (sum, contribution) => sum + contribution.altitude * contribution.influence,
    0
  );
  const headingAnticipationBlend = clamp(
    totalHeadingInfluence,
    0,
    1
  );
  const maxHeadingOffsetDegrees = lerp(
    headingLockConfig.turningMaxDeltaDegrees || 12,
    headingLockConfig.cruiseTurningMaxDeltaDegrees || 18,
    rerouteOverviewBlend * (1 - cheapFocusBlend)
  );
  const anticipatedHeading = interpolateHeadingDegrees(
    baseHeading,
    routePreviewHeading,
    lerp(0.72, 1, headingAnticipationBlend)
  );
  const lockedAnticipatedHeading = clampHeadingAroundTarget(
    anticipatedHeading,
    cameraFollowHeading,
    maxHeadingOffsetDegrees
  );
  const inverseInfluence = totalTurnInfluence > 0 ? 1 / totalTurnInfluence : 0;
  const averageTurnCenter = {
    latitude: weightedTurnCenter.latitude * inverseInfluence,
    longitude: weightedTurnCenter.longitude * inverseInfluence,
  };
  const averageTurnPitch = weightedTurnPitch * inverseInfluence;
  const averageTurnAltitude = weightedTurnAltitude * inverseInfluence;

  return {
    center: interpolateCoordinate(rerouteCenteredBase, averageTurnCenter, totalTurnInfluence),
    heading: interpolateHeadingDegrees(baseHeading, lockedAnticipatedHeading, headingAnticipationBlend),
    pitch: lerp(profileValues.pitch, averageTurnPitch, totalTurnInfluence),
    altitude: lerp(altitude, averageTurnAltitude, totalTurnInfluence),
  };
}

function getArrivalCamera(routeMetrics, sceneConfig, arrivalElapsedMs, initialHeading = routeMetrics.finalHeading) {
  const orbitHeading = (
    initialHeading +
    (arrivalElapsedMs / 1000) * sceneConfig.orbit.degreesPerSecond
  ) % 360;

  return {
    center: routeMetrics.coordinates[routeMetrics.coordinates.length - 1] || routeMetrics.initialCoordinate,
    heading: orbitHeading,
    pitch: sceneConfig.cameraProfiles.arrival.pitch,
    altitude: sceneConfig.cameraProfiles.arrival.altitude,
  };
}

function getDemoSnapshot(routeMetrics, sceneConfig, progress, arrivalElapsedMs = 0) {
  const clampedProgress = clamp(progress, 0, 1);
  const travelledDistanceMeters = getDistanceForTimeProgress(routeMetrics, clampedProgress);
  const distanceProgress = routeMetrics.totalDistanceMeters > 0
    ? travelledDistanceMeters / routeMetrics.totalDistanceMeters
    : 0;
  const point = getPointAtDistance(routeMetrics, travelledDistanceMeters);
  const scenePhase = getScenePhase(
    distanceProgress,
    routeMetrics.expensiveStationProgress,
    routeMetrics.rerouteTriggerProgress
  );
  const remainingDistanceMeters = Math.max(
    0,
    routeMetrics.totalDistanceMeters - point.travelledDistanceMeters
  );
  const expectedTravelTimeSeconds = Number(routeMetrics.expectedTravelTimeSeconds)
    || Number(routeMetrics.expectedTravelTime)
    || 0;
  const remainingTravelTimeSeconds = expectedTravelTimeSeconds * (1 - clampedProgress);
  const isArrived = clampedProgress >= 1 && arrivalElapsedMs > 0;
  const destinationCoordinate = routeMetrics.coordinates[routeMetrics.coordinates.length - 1] || point.coordinate;
  const routeFollowCamera = getCameraForProgress(routeMetrics, sceneConfig, distanceProgress);
  const arrivalCamera = getArrivalCamera(
    routeMetrics,
    sceneConfig,
    arrivalElapsedMs,
    routeFollowCamera.heading
  );
  const arrivalTransitionDurationMs = sceneConfig?.orbit?.transitionDurationMs || 1400;
  const arrivalBlend = isArrived
    ? smoothstep(0, arrivalTransitionDurationMs, arrivalElapsedMs)
    : 0;
  const chipRevealState = getChipRevealState(
    routeMetrics,
    sceneConfig,
    point.travelledDistanceMeters,
    clampedProgress
  );
  const visibleRouteCoordinates = getVisibleRouteCoordinates(
    routeMetrics,
    point.travelledDistanceMeters,
    clampedProgress,
    sceneConfig
  );

  return {
    progress: distanceProgress,
    arrivalOrbitProgress: arrivalElapsedMs / 1000,
    carCoordinate: isArrived ? destinationCoordinate : point.coordinate,
    heading: isArrived ? routeMetrics.finalHeading : point.heading,
    travelledDistanceMeters: point.travelledDistanceMeters,
    remainingDistanceMeters,
    remainingTravelTimeSeconds,
    scenePhase: isArrived ? 'arrived' : scenePhase,
    passedStationState: getPassedStationState(
      distanceProgress,
      routeMetrics.expensiveStationProgress,
      routeMetrics.rerouteTriggerProgress
    ),
    chipRevealState,
    visibleRouteCoordinates: isArrived ? [] : visibleRouteCoordinates,
    activeCamera: isArrived
      ? blendCameraStates(routeFollowCamera, arrivalCamera, arrivalBlend)
      : routeFollowCamera,
    narrative: getNarrative(
      sceneConfig,
      isArrived ? 'routing-cheap' : scenePhase,
      remainingDistanceMeters,
      remainingTravelTimeSeconds
    ),
  };
}

module.exports = {
  buildPredictiveRouteMetrics,
  buildRouteMetrics,
  densifyCoordinates,
  calculateHeadingDegrees,
  getArrivalCamera,
  getDistanceForTimeProgress,
  getCameraForProgress,
  getChipRevealState,
  getDemoSnapshot,
  getPassedStationState,
  getPointAtDistance,
  getProgressForNearestCoordinate,
  getRouteRegion,
  getScenePhase,
  getVisibleRouteCoordinates,
  haversineDistanceMeters,
  interpolateHeadingDegrees,
  interpolateCoordinate,
  clampHeadingAroundTarget,
};
