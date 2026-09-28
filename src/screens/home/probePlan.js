import { DEFAULT_REGION } from './constants.js';
import { CLUSTER_MERGE_LAT_FACTOR } from './constants.js';
import { CLUSTER_MERGE_LNG_FACTOR } from './constants.js';
import { CLUSTER_SPLIT_MULTIPLIER } from './constants.js';
import { CLUSTER_DEBUG_PROBE_ZOOM_IN_STEP_COUNT } from './constants.js';
import { CLUSTER_DEBUG_PROBE_ZOOM_OUT_EXTRA_STEPS } from './constants.js';
import { CLUSTER_DEBUG_PROBE_MIN_DELTA } from './constants.js';
import { CLUSTER_DEBUG_PROBE_ZOOM_IN_DISTANCE_MULTIPLIER } from './constants.js';
import { CLUSTER_DEBUG_PROBE_ZOOM_OUT_DISTANCE_MULTIPLIER } from './constants.js';
import { buildClusterMembershipKey } from '../../cluster/layout';
import { formatDebugMetric } from './probeTelemetry.js';
import { buildClusterDebugRecordingLog } from './probeTelemetry.js';
import * as FileSystem from 'expo-file-system/legacy';
import { CLUSTER_DEBUG_PROBE_REPORT_FILE_NAME } from './constants.js';
import { CLUSTER_DEBUG_PROBE_REPORT_RELATIVE_PATH } from './constants.js';
import { CLUSTER_DEBUG_PROBE_REPORT_CACHE_RELATIVE_PATH } from './constants.js';

export function waitForMilliseconds(duration) {
    return new Promise(resolve => {
        setTimeout(resolve, duration);
    });
}

export function interpolateZoomDelta(startDelta, endDelta, stepNumber, totalSteps, distanceMultiplier = 1) {
    if (
        totalSteps <= 0 ||
        !Number.isFinite(startDelta) ||
        !Number.isFinite(endDelta) ||
        startDelta <= 0 ||
        endDelta <= 0
    ) {
        return endDelta;
    }

    const progress = (stepNumber / totalSteps) * distanceMultiplier;

    return startDelta * Math.pow(endDelta / startDelta, progress);
}

export function buildClusterDebugAutomationSeedRegion(quotes, fallbackRegion) {
    const validQuotes = (quotes || []).filter(quote => (
        typeof quote?.latitude === 'number' &&
        typeof quote?.longitude === 'number'
    ));

    if (validQuotes.length < 2) {
        return null;
    }

    let closestPair = null;

    for (let index = 0; index < validQuotes.length - 1; index += 1) {
        const currentQuote = validQuotes[index];

        for (let compareIndex = index + 1; compareIndex < validQuotes.length; compareIndex += 1) {
            const candidateQuote = validQuotes[compareIndex];
            const distance = Math.hypot(
                currentQuote.latitude - candidateQuote.latitude,
                currentQuote.longitude - candidateQuote.longitude
            );

            if (!closestPair || distance < closestPair.distance) {
                closestPair = {
                    distance,
                    firstQuote: currentQuote,
                    secondQuote: candidateQuote,
                };
            }
        }
    }

    if (!closestPair) {
        return null;
    }

    const latDiff = Math.abs(closestPair.firstQuote.latitude - closestPair.secondQuote.latitude);
    const lngDiff = Math.abs(closestPair.firstQuote.longitude - closestPair.secondQuote.longitude);
    const fallbackLatDelta = fallbackRegion?.latitudeDelta || DEFAULT_REGION.latitudeDelta;
    const fallbackLngDelta = fallbackRegion?.longitudeDelta || DEFAULT_REGION.longitudeDelta;

    return {
        latitude: (closestPair.firstQuote.latitude + closestPair.secondQuote.latitude) / 2,
        longitude: (closestPair.firstQuote.longitude + closestPair.secondQuote.longitude) / 2,
        latitudeDelta: Math.max(
            0.02,
            fallbackLatDelta,
            latDiff > 0 ? (latDiff / CLUSTER_MERGE_LAT_FACTOR) * 1.35 : fallbackLatDelta
        ),
        longitudeDelta: Math.max(
            0.02,
            fallbackLngDelta,
            lngDiff > 0 ? (lngDiff / CLUSTER_MERGE_LNG_FACTOR) * 1.35 : fallbackLngDelta
        ),
    };
}

export function buildClusterDebugProbePlan(cluster, currentRegion, focusRegion = null) {
    if (!cluster?.quotes?.length) {
        return null;
    }

    const focusLatitude = typeof focusRegion?.latitude === 'number'
        ? focusRegion.latitude
        : currentRegion?.latitude;
    const focusLongitude = typeof focusRegion?.longitude === 'number'
        ? focusRegion.longitude
        : currentRegion?.longitude;
    const startLatitude = typeof currentRegion?.latitude === 'number'
        ? currentRegion.latitude
        : (
            typeof focusLatitude === 'number'
                ? focusLatitude
                : cluster.averageLat
        );
    const startLongitude = typeof currentRegion?.longitude === 'number'
        ? currentRegion.longitude
        : (
            typeof focusLongitude === 'number'
                ? focusLongitude
                : cluster.averageLng
        );
    const splitLatitude = typeof focusLatitude === 'number'
        ? focusLatitude
        : cluster.averageLat;
    const splitLongitude = typeof focusLongitude === 'number'
        ? focusLongitude
        : cluster.averageLng;
    const fallbackLatDelta = currentRegion?.latitudeDelta || DEFAULT_REGION.latitudeDelta;
    const fallbackLngDelta = currentRegion?.longitudeDelta || DEFAULT_REGION.longitudeDelta;
    const maxLatOffset = Math.max(
        0,
        ...cluster.quotes.map(quote => Math.abs((quote.latitude || 0) - (cluster.averageLat || 0)))
    );
    const maxLngOffset = Math.max(
        0,
        ...cluster.quotes.map(quote => Math.abs((quote.longitude || 0) - (cluster.averageLng || 0)))
    );
    const mergeLatThresholdDelta = maxLatOffset > 0
        ? maxLatOffset / CLUSTER_MERGE_LAT_FACTOR
        : fallbackLatDelta;
    const mergeLngThresholdDelta = maxLngOffset > 0
        ? maxLngOffset / CLUSTER_MERGE_LNG_FACTOR
        : fallbackLngDelta;
    const splitLatThresholdDelta = maxLatOffset > 0
        ? maxLatOffset / (CLUSTER_MERGE_LAT_FACTOR * CLUSTER_SPLIT_MULTIPLIER)
        : fallbackLatDelta * 0.45;
    const splitLngThresholdDelta = maxLngOffset > 0
        ? maxLngOffset / (CLUSTER_MERGE_LNG_FACTOR * CLUSTER_SPLIT_MULTIPLIER)
        : fallbackLngDelta * 0.45;

    const mergeLatDelta = Math.max(
        0.02,
        mergeLatThresholdDelta * 1.2,
        splitLatThresholdDelta * 1.8
    );
    const mergeLngDelta = Math.max(
        0.02,
        mergeLngThresholdDelta * 1.2,
        splitLngThresholdDelta * 1.8
    );
    const resolvedSplitLatDelta = Math.max(
        0.0025,
        Math.min(mergeLatDelta * 0.45, splitLatThresholdDelta * 0.72)
    );
    const resolvedSplitLngDelta = Math.max(
        0.0025,
        Math.min(mergeLngDelta * 0.45, splitLngThresholdDelta * 0.72)
    );
    const splitLatDelta = resolvedSplitLatDelta < mergeLatDelta
        ? resolvedSplitLatDelta
        : Math.max(0.0025, mergeLatDelta * 0.45);
    const splitLngDelta = resolvedSplitLngDelta < mergeLngDelta
        ? resolvedSplitLngDelta
        : Math.max(0.0025, mergeLngDelta * 0.45);
    const startRegion = {
        latitude: startLatitude,
        longitude: startLongitude,
        latitudeDelta: fallbackLatDelta,
        longitudeDelta: fallbackLngDelta,
    };
    const focusStartRegion = {
        latitude: splitLatitude,
        longitude: splitLongitude,
        latitudeDelta: fallbackLatDelta,
        longitudeDelta: fallbackLngDelta,
    };
    const splitRegion = {
        latitude: splitLatitude,
        longitude: splitLongitude,
        latitudeDelta: splitLatDelta,
        longitudeDelta: splitLngDelta,
    };
    const zoomOutStepCount = CLUSTER_DEBUG_PROBE_ZOOM_IN_STEP_COUNT + CLUSTER_DEBUG_PROBE_ZOOM_OUT_EXTRA_STEPS;
    const zoomInRegions = Array.from({ length: CLUSTER_DEBUG_PROBE_ZOOM_IN_STEP_COUNT }, (_, index) => {
        return {
            latitude: splitRegion.latitude,
            longitude: splitRegion.longitude,
            latitudeDelta: Math.max(
                CLUSTER_DEBUG_PROBE_MIN_DELTA,
                interpolateZoomDelta(
                    focusStartRegion.latitudeDelta,
                    splitRegion.latitudeDelta,
                    index + 1,
                    CLUSTER_DEBUG_PROBE_ZOOM_IN_STEP_COUNT,
                    CLUSTER_DEBUG_PROBE_ZOOM_IN_DISTANCE_MULTIPLIER
                )
            ),
            longitudeDelta: Math.max(
                CLUSTER_DEBUG_PROBE_MIN_DELTA,
                interpolateZoomDelta(
                    focusStartRegion.longitudeDelta,
                    splitRegion.longitudeDelta,
                    index + 1,
                    CLUSTER_DEBUG_PROBE_ZOOM_IN_STEP_COUNT,
                    CLUSTER_DEBUG_PROBE_ZOOM_IN_DISTANCE_MULTIPLIER
                )
            ),
        };
    });

    const zoomOutRegions = Array.from({ length: zoomOutStepCount }, (_, index) => {
        return {
            latitude: splitRegion.latitude,
            longitude: splitRegion.longitude,
            latitudeDelta: interpolateZoomDelta(
                splitRegion.latitudeDelta,
                focusStartRegion.latitudeDelta,
                index + 1,
                zoomOutStepCount,
                CLUSTER_DEBUG_PROBE_ZOOM_OUT_DISTANCE_MULTIPLIER
            ),
            longitudeDelta: interpolateZoomDelta(
                splitRegion.longitudeDelta,
                focusStartRegion.longitudeDelta,
                index + 1,
                zoomOutStepCount,
                CLUSTER_DEBUG_PROBE_ZOOM_OUT_DISTANCE_MULTIPLIER
            ),
        };
    });

    return {
        clusterKey: buildClusterMembershipKey(cluster),
        startRegion,
        focusStartRegion,
        mergeRegion: {
            latitude: startLatitude,
            longitude: startLongitude,
            latitudeDelta: mergeLatDelta,
            longitudeDelta: mergeLngDelta,
        },
        splitRegion,
        zoomInRegions,
        zoomOutRegions,
        metrics: {
            maxLatOffset,
            maxLngOffset,
            mergeLatThresholdDelta,
            mergeLngThresholdDelta,
            splitLatThresholdDelta,
            splitLngThresholdDelta,
        },
    };
}

export function buildProbeStationScreenSnapshot(quotes, mapRegion, screenWidth, screenHeight) {
    const validQuotes = (quotes || [])
        .filter(quote => (
            (typeof quote?.stationId === 'number' || typeof quote?.stationId === 'string') &&
            typeof quote?.latitude === 'number' &&
            typeof quote?.longitude === 'number'
        ))
        .sort((left, right) => String(left.stationId).localeCompare(String(right.stationId)));
    const ptPerLng = mapRegion?.longitudeDelta
        ? screenWidth / mapRegion.longitudeDelta
        : 0;
    const ptPerLat = mapRegion?.latitudeDelta
        ? screenHeight / mapRegion.latitudeDelta
        : 0;
    const centerLng = typeof mapRegion?.longitude === 'number'
        ? mapRegion.longitude
        : 0;
    const centerLat = typeof mapRegion?.latitude === 'number'
        ? mapRegion.latitude
        : 0;
    const points = validQuotes.map(quote => ({
        stationId: quote.stationId,
        x: (quote.longitude - centerLng) * ptPerLng,
        y: -(quote.latitude - centerLat) * ptPerLat,
    }));
    const pairDistances = [];

    for (let index = 0; index < points.length; index += 1) {
        const currentPoint = points[index];
        for (let compareIndex = index + 1; compareIndex < points.length; compareIndex += 1) {
            const nextPoint = points[compareIndex];
            pairDistances.push(Math.hypot(
                nextPoint.x - currentPoint.x,
                nextPoint.y - currentPoint.y
            ));
        }
    }

    pairDistances.sort((left, right) => left - right);
    const pairDistanceMean = pairDistances.length > 0
        ? pairDistances.reduce((sum, value) => sum + value, 0) / pairDistances.length
        : 0;
    const pairDistanceP95 = pairDistances.length > 0
        ? pairDistances[Math.max(0, Math.ceil(pairDistances.length * 0.95) - 1)]
        : 0;

    return {
        stationCount: points.length,
        pairCount: pairDistances.length,
        pairDistanceMin: pairDistances[0] || 0,
        pairDistanceMax: pairDistances[pairDistances.length - 1] || 0,
        pairDistanceMean,
        pairDistanceP95,
        pairDistances,
    };
}

export function compareProbeStationScreenSnapshots(startSnapshot, endSnapshot) {
    if (!startSnapshot || !endSnapshot) {
        return {
            stationCountDelta: Number.POSITIVE_INFINITY,
            pairCountDelta: Number.POSITIVE_INFINITY,
            maxPairDistanceDelta: Number.POSITIVE_INFINITY,
            meanPairDistanceDelta: Number.POSITIVE_INFINITY,
        };
    }

    const pairCount = Math.min(
        startSnapshot.pairDistances.length,
        endSnapshot.pairDistances.length
    );
    const pairDistanceDeltas = [];

    for (let index = 0; index < pairCount; index += 1) {
        pairDistanceDeltas.push(Math.abs(
            (endSnapshot.pairDistances[index] || 0) - (startSnapshot.pairDistances[index] || 0)
        ));
    }

    const meanPairDistanceDelta = pairDistanceDeltas.length > 0
        ? pairDistanceDeltas.reduce((sum, value) => sum + value, 0) / pairDistanceDeltas.length
        : 0;

    return {
        stationCountDelta: Math.abs((endSnapshot.stationCount || 0) - (startSnapshot.stationCount || 0)),
        pairCountDelta: Math.abs((endSnapshot.pairCount || 0) - (startSnapshot.pairCount || 0)),
        maxPairDistanceDelta: pairDistanceDeltas.length > 0 ? Math.max(...pairDistanceDeltas) : 0,
        meanPairDistanceDelta,
    };
}

export function buildClusterDebugProbeSummary(report) {
    if (!report) {
        return '';
    }

    if (report.status !== 'completed') {
        return report.message || 'Probe did not complete.';
    }

    return (
        `Probe ${report.sampleCount} samples, ${report.transitionCount} transitions, ` +
        `max step ${formatDebugMetric(report.maxFrameDelta)}pt.`
    );
}

export function formatDebugCoordinate(latitude, longitude) {
    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
        return '--';
    }

    return `${latitude.toFixed(6)},${longitude.toFixed(6)}`;
}

export function buildClusterDebugProbeLog(report, samples, transitionEvents) {
    const metrics = report?.plan?.metrics || {};
    const startRegion = report?.plan?.startRegion || {};
    const focusStartRegion = report?.plan?.focusStartRegion || {};
    const mergeRegion = report?.plan?.mergeRegion || {};
    const splitRegion = report?.plan?.splitRegion || {};
    const zoomInRegions = report?.plan?.zoomInRegions || [];
    const zoomOutRegions = report?.plan?.zoomOutRegions || [];

    return [
        '[ClusterDebug Probe]',
        `status=${report?.status || 'unknown'}`,
        `trigger=${report?.trigger || 'manual'}`,
        `message=${report?.message || 'none'}`,
        `cluster=${report?.clusterKey || 'unknown'}`,
        `samples=${report?.sampleCount ?? samples.length}`,
        `transitions=${report?.transitionCount ?? transitionEvents.length}`,
        `maxStep=${formatDebugMetric(report?.maxFrameDelta || 0)}pt`,
        `timedOutStages=${report?.timedOutStages?.join(',') || 'none'}`,
        `startRegion=${formatDebugCoordinate(startRegion.latitude, startRegion.longitude)} d=${formatDebugMetric(startRegion.latitudeDelta, 4)},${formatDebugMetric(startRegion.longitudeDelta, 4)}`,
        `focusStartRegion=${formatDebugCoordinate(focusStartRegion.latitude, focusStartRegion.longitude)} d=${formatDebugMetric(focusStartRegion.latitudeDelta, 4)},${formatDebugMetric(focusStartRegion.longitudeDelta, 4)}`,
        `mergeRegion=${formatDebugCoordinate(mergeRegion.latitude, mergeRegion.longitude)} d=${formatDebugMetric(mergeRegion.latitudeDelta, 4)},${formatDebugMetric(mergeRegion.longitudeDelta, 4)}`,
        `splitRegion=${formatDebugCoordinate(splitRegion.latitude, splitRegion.longitude)} d=${formatDebugMetric(splitRegion.latitudeDelta, 4)},${formatDebugMetric(splitRegion.longitudeDelta, 4)}`,
        `steps=${zoomInRegions.length} in / ${zoomOutRegions.length} out`,
        `thresholds merge=${formatDebugMetric(metrics.mergeLatThresholdDelta, 4)},${formatDebugMetric(metrics.mergeLngThresholdDelta, 4)} split=${formatDebugMetric(metrics.splitLatThresholdDelta, 4)},${formatDebugMetric(metrics.splitLngThresholdDelta, 4)}`,
        buildClusterDebugRecordingLog(samples, transitionEvents),
    ].join('\n');
}

export async function writeClusterDebugProbeArtifact(payload) {
    const artifactTargets = [
        FileSystem.documentDirectory
            ? {
                uri: `${FileSystem.documentDirectory}${CLUSTER_DEBUG_PROBE_REPORT_FILE_NAME}`,
                relativePath: CLUSTER_DEBUG_PROBE_REPORT_RELATIVE_PATH,
                label: 'documents',
            }
            : null,
        FileSystem.cacheDirectory
            ? {
                uri: `${FileSystem.cacheDirectory}${CLUSTER_DEBUG_PROBE_REPORT_FILE_NAME}`,
                relativePath: CLUSTER_DEBUG_PROBE_REPORT_CACHE_RELATIVE_PATH,
                label: 'cache',
            }
            : null,
    ].filter(Boolean);

    if (artifactTargets.length === 0) {
        console.error('[ClusterDebug Probe Export] no writable file-system directory is available.');
        return null;
    }

    const basePayload = {
        ...payload,
        persistedAt: new Date().toISOString(),
        artifactTargets: artifactTargets.map(target => ({
            label: target.label,
            uri: target.uri,
            relativePath: target.relativePath,
        })),
    };
    const writeResults = [];

    for (const target of artifactTargets) {
        try {
            const persistedPayload = {
                ...basePayload,
                fileUri: target.uri,
                relativePath: target.relativePath,
                artifactLabel: target.label,
            };

            await FileSystem.writeAsStringAsync(
                target.uri,
                JSON.stringify(persistedPayload, null, 2)
            );

            const fileInfo = await FileSystem.getInfoAsync(target.uri);

            writeResults.push({
                label: target.label,
                uri: target.uri,
                relativePath: target.relativePath,
                exists: Boolean(fileInfo.exists),
                size: fileInfo.size || 0,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown file write failure.';

            writeResults.push({
                label: target.label,
                uri: target.uri,
                relativePath: target.relativePath,
                exists: false,
                size: 0,
                error: message,
            });
        }
    }

    const successfulWrites = writeResults.filter(result => result.exists);

    if (successfulWrites.length > 0) {
        successfulWrites.forEach(result => {
            console.log(
                `[ClusterDebug Probe Export] ${result.label} ${result.relativePath} exists=${result.exists ? '1' : '0'} size=${result.size}`
            );
        });
    }

    const failedWrites = writeResults.filter(result => result.error);

    if (failedWrites.length > 0) {
        failedWrites.forEach(result => {
            console.error(
                `[ClusterDebug Probe Export] ${result.label} failed: ${result.error}`
            );
        });
    }

    if (successfulWrites.length === 0) {
        return null;
    }

    const primaryWrite = successfulWrites[0];

    return {
        ...basePayload,
        fileUri: primaryWrite.uri,
        relativePath: primaryWrite.relativePath,
        writeResults,
    };
}
