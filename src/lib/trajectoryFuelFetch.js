const EARTH_RADIUS_METERS = 6_371_000;
const DEFAULT_LOOKAHEAD_SECONDS = 540;
const DEFAULT_MIN_LOOKAHEAD_METERS = 5_000;
const DEFAULT_MAX_LOOKAHEAD_METERS = 16_000;
const DEFAULT_MIN_ROUTE_TARGET_METERS = 8_000;
const DEFAULT_MAX_ROUTE_TARGET_METERS = 24_000;
const DEFAULT_ROUTE_TARGET_MULTIPLIER = 1.45;
const MIN_PREFETCH_SPEED_MPS = 4.5;
const MIN_HEADING_DISPLACEMENT_METERS = 35;
const TRAJECTORY_ROUTE_UNAVAILABLE_ERROR_CODE = 'ERR_TRAJECTORY_ROUTE_UNAVAILABLE';

function toFiniteNumber(value) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : null;
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function toRadians(value) {
    return (value * Math.PI) / 180;
}

function toDegrees(value) {
    return (value * 180) / Math.PI;
}

function calculateBearingDegrees(origin, target) {
    const originLatitude = toFiniteNumber(origin?.latitude);
    const originLongitude = toFiniteNumber(origin?.longitude);
    const targetLatitude = toFiniteNumber(target?.latitude);
    const targetLongitude = toFiniteNumber(target?.longitude);

    if ([originLatitude, originLongitude, targetLatitude, targetLongitude].some(value => value === null)) {
        return null;
    }

    const latitudeA = toRadians(originLatitude);
    const latitudeB = toRadians(targetLatitude);
    const longitudeDelta = toRadians(targetLongitude - originLongitude);
    const y = Math.sin(longitudeDelta) * Math.cos(latitudeB);
    const x = Math.cos(latitudeA) * Math.sin(latitudeB) -
        Math.sin(latitudeA) * Math.cos(latitudeB) * Math.cos(longitudeDelta);

    return normalizeBearing(toDegrees(Math.atan2(y, x)));
}

function normalizeBearing(value) {
    const numericValue = toFiniteNumber(value);

    if (numericValue === null || numericValue < 0) {
        return null;
    }

    return ((numericValue % 360) + 360) % 360;
}

function createTrajectoryRouteUnavailableError(message, cause = null) {
    const error = new Error(message);
    error.code = TRAJECTORY_ROUTE_UNAVAILABLE_ERROR_CODE;
    if (cause) {
        error.cause = cause;
    }
    return error;
}

function isTrajectoryRouteUnavailableError(error) {
    return error?.code === TRAJECTORY_ROUTE_UNAVAILABLE_ERROR_CODE;
}

function calculateDistanceMeters(origin, target) {
    if (!origin || !target) {
        return Number.POSITIVE_INFINITY;
    }

    const originLatitude = toFiniteNumber(origin.latitude);
    const originLongitude = toFiniteNumber(origin.longitude);
    const targetLatitude = toFiniteNumber(target.latitude);
    const targetLongitude = toFiniteNumber(target.longitude);

    if ([originLatitude, originLongitude, targetLatitude, targetLongitude].some(value => value === null)) {
        return Number.POSITIVE_INFINITY;
    }

    const latitudeDelta = toRadians(targetLatitude - originLatitude);
    const longitudeDelta = toRadians(targetLongitude - originLongitude);
    const latitudeA = toRadians(originLatitude);
    const latitudeB = toRadians(targetLatitude);
    const haversine =
        Math.sin(latitudeDelta / 2) * Math.sin(latitudeDelta / 2) +
        Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(longitudeDelta / 2) * Math.sin(longitudeDelta / 2);

    return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function interpolateCoordinate(from, to, ratio) {
    return {
        latitude: from.latitude + ((to.latitude - from.latitude) * ratio),
        longitude: from.longitude + ((to.longitude - from.longitude) * ratio),
    };
}

function toLocalMeters(reference, point) {
    const referenceLatitude = toFiniteNumber(reference?.latitude);
    const referenceLongitude = toFiniteNumber(reference?.longitude);
    const latitude = toFiniteNumber(point?.latitude);
    const longitude = toFiniteNumber(point?.longitude);

    if ([referenceLatitude, referenceLongitude, latitude, longitude].some(value => value === null)) {
        return null;
    }

    const latitudeRadians = toRadians(referenceLatitude);
    return {
        x: (longitude - referenceLongitude) * 111_320 * Math.max(0.1, Math.cos(latitudeRadians)),
        y: (latitude - referenceLatitude) * 111_320,
    };
}

function projectCoordinate({
    latitude,
    longitude,
    bearingDegrees,
    distanceMeters,
}) {
    const startLatitude = toFiniteNumber(latitude);
    const startLongitude = toFiniteNumber(longitude);
    const normalizedBearing = normalizeBearing(bearingDegrees);
    const normalizedDistance = toFiniteNumber(distanceMeters);

    if (
        startLatitude === null ||
        startLongitude === null ||
        normalizedBearing === null ||
        normalizedDistance === null ||
        normalizedDistance <= 0
    ) {
        return null;
    }

    const angularDistance = normalizedDistance / EARTH_RADIUS_METERS;
    const bearingRadians = toRadians(normalizedBearing);
    const latitudeRadians = toRadians(startLatitude);
    const longitudeRadians = toRadians(startLongitude);

    const projectedLatitude = Math.asin(
        Math.sin(latitudeRadians) * Math.cos(angularDistance) +
        Math.cos(latitudeRadians) * Math.sin(angularDistance) * Math.cos(bearingRadians)
    );
    const projectedLongitude = longitudeRadians + Math.atan2(
        Math.sin(bearingRadians) * Math.sin(angularDistance) * Math.cos(latitudeRadians),
        Math.cos(angularDistance) - Math.sin(latitudeRadians) * Math.sin(projectedLatitude)
    );

    return {
        latitude: toDegrees(projectedLatitude),
        longitude: toDegrees(projectedLongitude),
    };
}

function computeLookaheadMeters({
    speedMps,
    lookaheadSeconds = DEFAULT_LOOKAHEAD_SECONDS,
    minimumMeters = DEFAULT_MIN_LOOKAHEAD_METERS,
    maximumMeters = DEFAULT_MAX_LOOKAHEAD_METERS,
}) {
    const normalizedSpeed = toFiniteNumber(speedMps);
    if (normalizedSpeed === null || normalizedSpeed <= 0) {
        return minimumMeters;
    }

    return clamp(
        normalizedSpeed * lookaheadSeconds,
        minimumMeters,
        maximumMeters
    );
}

function computeRouteTargetMeters({
    lookaheadMeters,
    multiplier = DEFAULT_ROUTE_TARGET_MULTIPLIER,
    minimumMeters = DEFAULT_MIN_ROUTE_TARGET_METERS,
    maximumMeters = DEFAULT_MAX_ROUTE_TARGET_METERS,
}) {
    const normalizedLookahead = toFiniteNumber(lookaheadMeters);
    if (normalizedLookahead === null || normalizedLookahead <= 0) {
        return minimumMeters;
    }

    return clamp(
        normalizedLookahead * multiplier,
        minimumMeters,
        maximumMeters
    );
}

function getCoordinateAlongPolyline({ coordinates, distanceMeters }) {
    if (!Array.isArray(coordinates) || coordinates.length < 2) {
        throw new Error('MapKit route must contain at least two coordinates.');
    }

    const targetDistanceMeters = Math.max(0, toFiniteNumber(distanceMeters) || 0);
    let traversedMeters = 0;

    for (let index = 1; index < coordinates.length; index += 1) {
        const previousCoordinate = coordinates[index - 1];
        const nextCoordinate = coordinates[index];
        const segmentDistanceMeters = calculateDistanceMeters(previousCoordinate, nextCoordinate);

        if (!Number.isFinite(segmentDistanceMeters) || segmentDistanceMeters <= 0) {
            continue;
        }

        if ((traversedMeters + segmentDistanceMeters) >= targetDistanceMeters) {
            const remainingDistanceMeters = targetDistanceMeters - traversedMeters;
            const segmentRatio = clamp(remainingDistanceMeters / segmentDistanceMeters, 0, 1);
            return interpolateCoordinate(previousCoordinate, nextCoordinate, segmentRatio);
        }

        traversedMeters += segmentDistanceMeters;
    }

    return coordinates[coordinates.length - 1];
}

function buildTrajectorySeedFromLocationSeries(locationObjects, previousSeed = null) {
    const normalizedLocations = (Array.isArray(locationObjects) ? locationObjects : [locationObjects])
        .map(locationObject => {
            const coords = locationObject?.coords || locationObject || {};
            const latitude = toFiniteNumber(coords.latitude);
            const longitude = toFiniteNumber(coords.longitude);
            const speedMps = toFiniteNumber(coords.speed ?? locationObject?.speedMps);
            const timestampMs = toFiniteNumber(coords.timestamp ?? locationObject?.timestamp) || Date.now();

            if (latitude === null || longitude === null) {
                return null;
            }

            return {
                latitude,
                longitude,
                speedMps: speedMps === null ? 0 : speedMps,
                courseDegrees: normalizeBearing(coords.course ?? coords.heading ?? locationObject?.courseDegrees),
                timestampMs,
            };
        })
        .filter(Boolean);

    if (normalizedLocations.length === 0) {
        return null;
    }

    const latest = normalizedLocations[normalizedLocations.length - 1];
    if (latest.courseDegrees !== null) {
        return {
            latitude: latest.latitude,
            longitude: latest.longitude,
            courseDegrees: latest.courseDegrees,
            speedMps: latest.speedMps,
        };
    }

    for (let index = normalizedLocations.length - 2; index >= 0; index -= 1) {
        const candidate = normalizedLocations[index];
        const displacementMeters = calculateDistanceMeters(candidate, latest);

        if (!Number.isFinite(displacementMeters) || displacementMeters < MIN_HEADING_DISPLACEMENT_METERS) {
            continue;
        }

        const derivedBearing = calculateBearingDegrees(candidate, latest);
        if (derivedBearing === null) {
            continue;
        }

        const deltaSeconds = Math.max(1, (latest.timestampMs - candidate.timestampMs) / 1000);
        const derivedSpeedMps = displacementMeters / deltaSeconds;

        return {
            latitude: latest.latitude,
            longitude: latest.longitude,
            courseDegrees: derivedBearing,
            speedMps: latest.speedMps > 0 ? latest.speedMps : derivedSpeedMps,
        };
    }

    if (previousSeed) {
        const displacementMeters = calculateDistanceMeters(previousSeed, latest);
        if (Number.isFinite(displacementMeters) && displacementMeters >= MIN_HEADING_DISPLACEMENT_METERS) {
            const derivedBearing = calculateBearingDegrees(previousSeed, latest);
            if (derivedBearing !== null) {
                return {
                    latitude: latest.latitude,
                    longitude: latest.longitude,
                    courseDegrees: derivedBearing,
                    speedMps: latest.speedMps > 0 ? latest.speedMps : previousSeed.speedMps || 0,
                };
            }
        }
    }

    return null;
}

function buildTrajectorySeedFromLocationObject(locationObject, previousSeed = null) {
    return buildTrajectorySeedFromLocationSeries(locationObject, previousSeed);
}

function classifyRouteInstruction(instructions) {
    const normalizedInstruction = String(instructions || '').trim().toLowerCase();

    if (!normalizedInstruction) {
        return {
            direction: 'straight',
            severity: 'none',
            pricePenalty: 0,
            weight: 0,
        };
    }

    if (normalizedInstruction.includes('u-turn')) {
        return { direction: 'u-turn', severity: 'hard', pricePenalty: 0.22, weight: 1.0 };
    }

    if (normalizedInstruction.includes('sharp left')) {
        return { direction: 'left', severity: 'hard', pricePenalty: 0.16, weight: 0.95 };
    }

    if (normalizedInstruction.includes('turn left')) {
        return { direction: 'left', severity: 'medium', pricePenalty: 0.12, weight: 0.9 };
    }

    if (normalizedInstruction.includes('slight left') || normalizedInstruction.includes('keep left')) {
        return { direction: 'left', severity: 'light', pricePenalty: 0.08, weight: 0.75 };
    }

    if (normalizedInstruction.includes('roundabout')) {
        return { direction: 'roundabout', severity: 'medium', pricePenalty: 0.09, weight: 0.8 };
    }

    if (normalizedInstruction.includes('exit') || normalizedInstruction.includes('ramp')) {
        const isLeftExit = normalizedInstruction.includes('left');
        return {
            direction: isLeftExit ? 'left' : 'right',
            severity: 'medium',
            pricePenalty: isLeftExit ? 0.10 : 0.05,
            weight: 0.85,
        };
    }

    if (normalizedInstruction.includes('merge')) {
        return { direction: 'merge', severity: 'light', pricePenalty: 0.03, weight: 0.55 };
    }

    if (normalizedInstruction.includes('sharp right')) {
        return { direction: 'right', severity: 'hard', pricePenalty: 0.05, weight: 0.7 };
    }

    if (normalizedInstruction.includes('turn right') || normalizedInstruction.includes('slight right') || normalizedInstruction.includes('keep right')) {
        return { direction: 'right', severity: 'light', pricePenalty: 0.02, weight: 0.45 };
    }

    return {
        direction: 'straight',
        severity: 'none',
        pricePenalty: 0,
        weight: 0.15,
    };
}

function buildRouteStepSummaries(route) {
    let cumulativeDistanceMeters = 0;

    return (Array.isArray(route?.steps) ? route.steps : [])
        .map(step => {
            const distanceMeters = Math.max(0, toFiniteNumber(step?.distanceMeters) || 0);
            const cumulativeStartMeters = cumulativeDistanceMeters;
            cumulativeDistanceMeters += distanceMeters;
            const classification = classifyRouteInstruction(step?.instructions);

            return {
                instructions: String(step?.instructions || ''),
                distanceMeters,
                cumulativeStartMeters,
                cumulativeEndMeters: cumulativeDistanceMeters,
                coordinate: step?.coordinate || null,
                classification,
            };
        });
}

function findNearestPointOnRoute({ routeCoordinates, station }) {
    let bestMatch = null;
    let traversedMeters = 0;

    for (let index = 1; index < routeCoordinates.length; index += 1) {
        const start = routeCoordinates[index - 1];
        const end = routeCoordinates[index];
        const segmentLengthMeters = calculateDistanceMeters(start, end);

        if (!Number.isFinite(segmentLengthMeters) || segmentLengthMeters <= 0) {
            continue;
        }

        const segmentVector = toLocalMeters(start, end);
        const stationVector = toLocalMeters(start, station);

        if (!segmentVector || !stationVector) {
            continue;
        }

        const segmentLengthSquared = (segmentVector.x * segmentVector.x) + (segmentVector.y * segmentVector.y);
        const projectionRatio = clamp(
            ((stationVector.x * segmentVector.x) + (stationVector.y * segmentVector.y)) / Math.max(segmentLengthSquared, 1),
            0,
            1
        );
        const projectedPoint = interpolateCoordinate(start, end, projectionRatio);
        const offsetDistanceMeters = calculateDistanceMeters(projectedPoint, station);
        const segmentBearingDegrees = calculateBearingDegrees(start, end);
        const projectedVector = toLocalMeters(start, projectedPoint);
        const signedOffset = (stationVector.x * (-segmentVector.y)) + (stationVector.y * segmentVector.x);
        const sideOfRoad = signedOffset > 0 ? 'left' : 'right';
        const alongRouteDistanceMeters = traversedMeters + Math.hypot(projectedVector.x, projectedVector.y);

        if (!bestMatch || offsetDistanceMeters < bestMatch.offsetDistanceMeters) {
            bestMatch = {
                alongRouteDistanceMeters,
                offsetDistanceMeters,
                sideOfRoad,
                segmentBearingDegrees,
                nearestCoordinate: projectedPoint,
            };
        }

        traversedMeters += segmentLengthMeters;
    }

    return bestMatch;
}

function computeAdaptiveLookaheadMeters({ baseLookaheadMeters, routeDistanceMeters, route }) {
    const stepSummaries = buildRouteStepSummaries(route).filter(step => step.distanceMeters >= 30);
    const routeDistanceKm = Math.max(1, (routeDistanceMeters || 0) / 1000);
    const stepDensityPerKm = stepSummaries.length / routeDistanceKm;
    const densityPenalty = clamp((stepDensityPerKm - 0.9) * 0.12, -0.2, 0.28);
    const adjustedLookaheadMeters = baseLookaheadMeters * (1 - densityPenalty);

    return clamp(
        adjustedLookaheadMeters,
        DEFAULT_MIN_LOOKAHEAD_METERS,
        Math.min(DEFAULT_MAX_LOOKAHEAD_METERS, Math.max(DEFAULT_MIN_LOOKAHEAD_METERS, routeDistanceMeters))
    );
}

function annotateStationWithRouteContext({ station, route, origin }) {
    if (!station || !Array.isArray(route?.coordinates) || route.coordinates.length < 2) {
        return station;
    }

    const nearestPoint = findNearestPointOnRoute({
        routeCoordinates: route.coordinates,
        station,
    });

    if (!nearestPoint) {
        return station;
    }

    const stepSummaries = buildRouteStepSummaries(route);
    const upcomingSteps = stepSummaries
        .filter(step => step.cumulativeEndMeters >= nearestPoint.alongRouteDistanceMeters)
        .slice(0, 2);
    const stepPenalty = upcomingSteps.reduce((sum, step, index) => {
        const decay = index === 0 ? 1 : 0.55;
        return sum + ((step.classification?.pricePenalty || 0) * decay);
    }, 0);
    const sidePenalty = nearestPoint.sideOfRoad === 'left' ? 0.08 : -0.02;
    const offsetPenalty = clamp(nearestPoint.offsetDistanceMeters / 3_500, 0, 0.12);
    const maneuverPenaltyPrice = Math.max(0, stepPenalty + sidePenalty + offsetPenalty);
    const effectivePrice = Number.isFinite(Number(station.price))
        ? Number(station.price) + maneuverPenaltyPrice
        : Number.POSITIVE_INFINITY;

    return {
        ...station,
        effectivePrice,
        routeApproach: {
            alongRouteDistanceMeters: nearestPoint.alongRouteDistanceMeters,
            offsetFromRouteMeters: nearestPoint.offsetDistanceMeters,
            sideOfRoad: nearestPoint.sideOfRoad,
            nearestCoordinate: nearestPoint.nearestCoordinate,
            segmentBearingDegrees: nearestPoint.segmentBearingDegrees,
            maneuverPenaltyPrice,
            nextStepInstructions: upcomingSteps.map(step => step.instructions).filter(Boolean),
            nextStepDirections: upcomingSteps.map(step => step.classification?.direction).filter(Boolean),
            isOnRoute: nearestPoint.offsetDistanceMeters <= 450,
        },
        distanceMiles: calculateDistanceMeters(origin, station) / 1609.344,
    };
}

async function resolveTrajectoryFetchPlanAsync({
    latitude,
    longitude,
    courseDegrees,
    speedMps,
    lookaheadMeters,
    routeTargetMeters,
    routeProvider,
}) {
    if (typeof routeProvider !== 'function') {
        throw createTrajectoryRouteUnavailableError('A MapKit route provider is required for trajectory fuel fetches.');
    }

    const normalizedBearing = normalizeBearing(courseDegrees);
    if (normalizedBearing === null) {
        return null;
    }

    const origin = {
        latitude: toFiniteNumber(latitude),
        longitude: toFiniteNumber(longitude),
    };

    if (origin.latitude === null || origin.longitude === null) {
        return null;
    }

    const explicitLookaheadMeters = toFiniteNumber(lookaheadMeters);
    const resolvedLookaheadMeters = explicitLookaheadMeters !== null && explicitLookaheadMeters > 0
        ? explicitLookaheadMeters
        : computeLookaheadMeters({
            speedMps,
            minimumMeters: DEFAULT_MIN_LOOKAHEAD_METERS,
            maximumMeters: DEFAULT_MAX_LOOKAHEAD_METERS,
            lookaheadSeconds: DEFAULT_LOOKAHEAD_SECONDS,
        });
    const resolvedRouteTargetMeters = routeTargetMeters == null
        ? computeRouteTargetMeters({ lookaheadMeters: resolvedLookaheadMeters })
        : Math.max(resolvedLookaheadMeters, Number(routeTargetMeters) || resolvedLookaheadMeters);
    const projectedDestination = projectCoordinate({
        latitude: origin.latitude,
        longitude: origin.longitude,
        bearingDegrees: normalizedBearing,
        distanceMeters: resolvedRouteTargetMeters,
    });

    if (!projectedDestination) {
        return null;
    }

    let route;
    try {
        route = await routeProvider({
            origin,
            destination: projectedDestination,
        });
    } catch (error) {
        throw createTrajectoryRouteUnavailableError(
            error?.message || 'MapKit could not build a trajectory fetch plan.',
            error
        );
    }

    if (!Array.isArray(route?.coordinates) || route.coordinates.length < 2) {
        throw createTrajectoryRouteUnavailableError('MapKit did not return a usable route polyline for trajectory fuel fetches.');
    }

    const effectiveRouteDistanceMeters = Math.max(
        toFiniteNumber(route?.distanceMeters) || 0,
        calculateDistanceMeters(origin, route.coordinates[route.coordinates.length - 1])
    );
    const adaptiveLookaheadMeters = computeAdaptiveLookaheadMeters({
        baseLookaheadMeters: resolvedLookaheadMeters,
        routeDistanceMeters: effectiveRouteDistanceMeters,
        route,
    });
    const aheadDistanceMeters = clamp(
        adaptiveLookaheadMeters,
        Math.min(adaptiveLookaheadMeters, effectiveRouteDistanceMeters),
        Math.max(adaptiveLookaheadMeters, effectiveRouteDistanceMeters)
    );
    const aheadPoint = getCoordinateAlongPolyline({
        coordinates: route.coordinates,
        distanceMeters: aheadDistanceMeters,
    });

    return {
        origin,
        projectedDestination,
        route,
        routeDistanceMeters: effectiveRouteDistanceMeters,
        lookaheadMeters: aheadDistanceMeters,
        aheadPoint,
        queryPoints: [
            { id: 'origin', latitude: origin.latitude, longitude: origin.longitude },
            { id: 'ahead', latitude: aheadPoint.latitude, longitude: aheadPoint.longitude },
        ],
    };
}

module.exports = {
    DEFAULT_LOOKAHEAD_SECONDS,
    DEFAULT_MAX_LOOKAHEAD_METERS,
    DEFAULT_MIN_LOOKAHEAD_METERS,
    DEFAULT_MAX_ROUTE_TARGET_METERS,
    DEFAULT_MIN_ROUTE_TARGET_METERS,
    MIN_PREFETCH_SPEED_MPS,
    annotateStationWithRouteContext,
    buildTrajectorySeedFromLocationObject,
    buildTrajectorySeedFromLocationSeries,
    calculateDistanceMeters,
    classifyRouteInstruction,
    computeLookaheadMeters,
    computeRouteTargetMeters,
    getCoordinateAlongPolyline,
    isTrajectoryRouteUnavailableError,
    projectCoordinate,
    resolveTrajectoryFetchPlanAsync,
};
