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

function buildCameraTurnEvents(turnEvents, sceneConfig) {
  const mergeGapMeters = sceneConfig?.turnPreview?.cameraTurnGroupGapMeters || 320;

  return (turnEvents || []).reduce((cameraEvents, turnEvent) => {
    const previousCameraEvent = cameraEvents[cameraEvents.length - 1];

    if (!previousCameraEvent) {
      cameraEvents.push({
        peakDistanceMeters: turnEvent.distanceMeters,
        startDistanceMeters: turnEvent.distanceMeters,
        endDistanceMeters: turnEvent.distanceMeters,
        turnMagnitude: turnEvent.turnMagnitude,
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
    initialCoordinate,
    initialHeading,
    overviewHeading,
    finalHeading,
    routeRegion,
    turnEvents,
    cameraTurnEvents,
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
  const baseHeading = routeMetrics.overviewHeading;
  const phaseAltitude = (
    phase === 'passing-expensive'
      ? sceneConfig.cameraAltitudes.passingExpensive
      : phase === 'routing-cheap'
        ? sceneConfig.cameraAltitudes.routingCheap
        : sceneConfig.cameraAltitudes.driving
  );
  const altitude = lerp(storyboardAltitude, phaseAltitude, 0.32);
  const turnContributions = (routeMetrics.cameraTurnEvents || routeMetrics.turnEvents || [])
    .map(turnEvent => {
      const turnStartDistanceMeters = turnEvent.startDistanceMeters - sceneConfig.turnPreview.lookaheadMeters;
      const turnPeakDistanceMeters = turnEvent.peakDistanceMeters;
      const turnEndDistanceMeters = turnEvent.endDistanceMeters + sceneConfig.turnPreview.recoveryMeters + (
        Math.max(0, (turnEvent.eventCount || 1) - 1) *
        (sceneConfig.turnPreview.groupRecoveryExtensionMeters || 120)
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

      if (influence <= 0.001) {
        return null;
      }

      const turnLeadMeters = lerp(
        baseLeadMeters,
        sceneConfig.turnPreview.leadMeters,
        influence
      );

      return {
        influence,
        center: getCoordinateAtDistance(
          routeMetrics,
          Math.min(routeMetrics.totalDistanceMeters, currentDistanceMeters + turnLeadMeters)
        ),
        altitude: altitude + (
          sceneConfig.turnPreview.altitude - altitude
        ) * influence,
        pitch: lerp(basePitch, sceneConfig.turnPreview.pitch, influence),
      };
    })
    .filter(Boolean);

  if (!turnContributions.length) {
    return {
      center,
      heading: baseHeading,
      pitch: basePitch,
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
  const inverseInfluence = totalTurnInfluence > 0 ? 1 / totalTurnInfluence : 0;
  const averageTurnCenter = {
    latitude: weightedTurnCenter.latitude * inverseInfluence,
    longitude: weightedTurnCenter.longitude * inverseInfluence,
  };
  const averageTurnPitch = weightedTurnPitch * inverseInfluence;
  const averageTurnAltitude = weightedTurnAltitude * inverseInfluence;

  return {
    center: interpolateCoordinate(center, averageTurnCenter, totalTurnInfluence),
    heading: baseHeading,
    pitch: lerp(basePitch, averageTurnPitch, totalTurnInfluence),
    altitude: lerp(altitude, averageTurnAltitude, totalTurnInfluence),
  };
}

function getArrivalCamera(routeMetrics, sceneConfig, arrivalElapsedMs) {
  const orbitHeading = (
    routeMetrics.finalHeading +
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
  const scenePhase = getScenePhase(distanceProgress, routeMetrics.expensiveStationProgress);
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
  const arrivalCamera = getArrivalCamera(routeMetrics, sceneConfig, arrivalElapsedMs);
  const arrivalTransitionDurationMs = sceneConfig?.orbit?.transitionDurationMs || 1400;
  const arrivalBlend = isArrived
    ? smoothstep(0, arrivalTransitionDurationMs, arrivalElapsedMs)
    : 0;

  return {
    progress: distanceProgress,
    arrivalOrbitProgress: arrivalElapsedMs / 1000,
    carCoordinate: isArrived ? destinationCoordinate : point.coordinate,
    heading: isArrived ? routeMetrics.finalHeading : point.heading,
    travelledDistanceMeters: point.travelledDistanceMeters,
    remainingDistanceMeters,
    remainingTravelTimeSeconds,
    scenePhase: isArrived ? 'arrived' : scenePhase,
    passedStationState: getPassedStationState(distanceProgress, routeMetrics.expensiveStationProgress),
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
  buildRouteMetrics,
  densifyCoordinates,
  calculateHeadingDegrees,
  getArrivalCamera,
  getDistanceForTimeProgress,
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
