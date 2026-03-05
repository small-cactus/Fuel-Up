import React, { startTransition, useEffect, useRef, useState, useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { GlassView } from 'expo-glass-effect';
import { LiquidGlassContainerView } from '@callstack/liquid-glass';
import * as Location from 'expo-location';
import * as FileSystem from 'expo-file-system/legacy';
import MapView, { Marker, PROVIDER_APPLE } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppState } from '../../src/AppStateContext';
import FuelSummaryCard from '../../src/components/FuelSummaryCard';
import ClusterDebugCard from '../../src/components/ClusterDebugCard';
import TopCanopy from '../../src/components/TopCanopy';
import { getCachedFuelPriceSnapshot, getFuelFailureMessage, refreshFuelPriceSnapshot } from '../../src/services/fuel';
import { useTheme } from '../../src/ThemeContext';
import { usePreferences } from '../../src/PreferencesContext';
import BottomCanopy from '../../src/components/BottomCanopy';
import ClusterMarkerOverlay from '../../src/components/cluster/ClusterMarkerOverlay';
import { groupStationsIntoClusters } from '../../src/cluster/grouping';
import { buildClusterMembershipKey } from '../../src/cluster/layout';
import { finalizeDebugSample } from '../../src/cluster/telemetry';
import Animated, {
    useSharedValue,
    useAnimatedScrollHandler,
    useAnimatedStyle,
    interpolate,
    Extrapolate,
    interpolateColor,
    FadeIn,
    FadeOut,
    ZoomIn,
    ZoomOut,
} from 'react-native-reanimated';
const {
    CLUSTER_MERGE_LAT_FACTOR,
    CLUSTER_MERGE_LNG_FACTOR,
    CLUSTER_SPLIT_MULTIPLIER,
} = require('../../src/lib/clusterAnimationMath.cjs');

const DEFAULT_REGION = {
    latitude: 37.3346,
    longitude: -122.009,
    latitudeDelta: 0.05,
    longitudeDelta: 0.05,
};
const TAB_BAR_CLEARANCE = 34;
const CARD_GAP = 0;
const SIDE_MARGIN = 16;
const TOP_CANOPY_HEIGHT = 72;
const CLUSTER_DEBUG_JUMP_THRESHOLD = 5;
const MAP_REGION_EPSILON = 0.000001;
const CLUSTER_DEBUG_PROBE_ANIMATION_DURATION = 650;
const CLUSTER_DEBUG_PROBE_IDLE_TIMEOUT = 2400;
const CLUSTER_DEBUG_PROBE_SETTLE_DURATION = 180;
const CLUSTER_MAP_IDLE_SETTLE_MS = 600;
const CLUSTER_DEBUG_PROBE_INITIAL_LOAD_WAIT = 3000;
const CLUSTER_DEBUG_PROBE_RECORDING_DELAY = 150;
const CLUSTER_DEBUG_PROBE_ZOOM_IN_STEP_COUNT = 10;
const CLUSTER_DEBUG_PROBE_ZOOM_OUT_EXTRA_STEPS = 5;
const CLUSTER_DEBUG_PROBE_BETWEEN_STEP_DELAY = 100;
const CLUSTER_DEBUG_PROBE_ZOOM_IN_DISTANCE_MULTIPLIER = 1.3;
const CLUSTER_DEBUG_PROBE_ZOOM_OUT_DISTANCE_MULTIPLIER = 1.3;
const CLUSTER_DEBUG_PROBE_MIN_DELTA = 0.0005;
const CLUSTER_DEBUG_PROBE_REPORT_FILE_NAME = 'cluster-debug-probe.json';
const CLUSTER_DEBUG_PROBE_REPORT_RELATIVE_PATH = `Documents/${CLUSTER_DEBUG_PROBE_REPORT_FILE_NAME}`;
const CLUSTER_DEBUG_PROBE_REPORT_CACHE_RELATIVE_PATH = `Library/Caches/${CLUSTER_DEBUG_PROBE_REPORT_FILE_NAME}`;

function waitForMilliseconds(duration) {
    return new Promise(resolve => {
        setTimeout(resolve, duration);
    });
}

function interpolateZoomDelta(startDelta, endDelta, stepNumber, totalSteps, distanceMultiplier = 1) {
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

function buildClusterDebugAutomationSeedRegion(quotes, fallbackRegion) {
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

function buildClusterDebugProbePlan(cluster, currentRegion, focusRegion = null) {
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

function buildProbeStationScreenSnapshot(quotes, mapRegion, screenWidth, screenHeight) {
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

function compareProbeStationScreenSnapshots(startSnapshot, endSnapshot) {
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

function buildClusterDebugProbeSummary(report) {
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

function formatDebugCoordinate(latitude, longitude) {
    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
        return '--';
    }

    return `${latitude.toFixed(6)},${longitude.toFixed(6)}`;
}

function buildClusterDebugProbeLog(report, samples, transitionEvents) {
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

async function writeClusterDebugProbeArtifact(payload) {
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

function areRegionsEquivalent(currentRegion, nextRegion) {
    if (!currentRegion || !nextRegion) {
        return false;
    }

    return (
        Math.abs((currentRegion.latitude || 0) - (nextRegion.latitude || 0)) <= MAP_REGION_EPSILON &&
        Math.abs((currentRegion.longitude || 0) - (nextRegion.longitude || 0)) <= MAP_REGION_EPSILON &&
        Math.abs((currentRegion.latitudeDelta || 0) - (nextRegion.latitudeDelta || 0)) <= MAP_REGION_EPSILON &&
        Math.abs((currentRegion.longitudeDelta || 0) - (nextRegion.longitudeDelta || 0)) <= MAP_REGION_EPSILON
    );
}

function formatDebugMetric(value, digits = 2) {
    if (typeof value !== 'number' || Number.isNaN(value)) {
        return '--';
    }

    return value.toFixed(digits);
}

function summarizeDebugSeries(samples, key) {
    const values = samples
        .map(sample => sample[key])
        .filter(value => typeof value === 'number' && Number.isFinite(value));

    if (values.length === 0) {
        return null;
    }

    const start = values[0];
    const end = values[values.length - 1];
    const min = Math.min(...values);
    const max = Math.max(...values);

    return {
        start,
        end,
        min,
        max,
        delta: end - start,
    };
}

function formatSeriesLine(label, series, unit = '', digits = 2) {
    if (!series) {
        return `${label}=--`;
    }

    const deltaPrefix = series.delta > 0 ? '+' : '';

    return (
        `${label} ${formatDebugMetric(series.start, digits)} -> ${formatDebugMetric(series.end, digits)} ` +
        `(d ${deltaPrefix}${formatDebugMetric(series.delta, digits)}, min ${formatDebugMetric(series.min, digits)}, max ${formatDebugMetric(series.max, digits)})${unit}`
    );
}

function formatDebugPoint(x, y, digits = 2) {
    return `(${formatDebugMetric(x, digits)}, ${formatDebugMetric(y, digits)})`;
}

function getClusterDebugVisibleLayers(sample) {
    if (!sample) {
        return [];
    }

    const isVisible = (layerKey) => {
        const isRendered = Boolean(sample[`${layerKey}Visible`]);
        const rawOpacity = sample[`${layerKey}Opacity`];
        const resolvedOpacity = Number.isFinite(rawOpacity)
            ? rawOpacity
            : (isRendered ? 1 : 0);

        return isRendered && resolvedOpacity > 0.001;
    };

    const layers = [];

    if (isVisible('outside')) {
        layers.push('outside');
    }
    if (isVisible('accumulator')) {
        layers.push('accumulator');
    }
    if (isVisible('mergeMover')) {
        layers.push('mergeMover');
    }
    if (isVisible('splitMover')) {
        layers.push('splitMover');
    }

    return layers;
}

function buildClusterDebugRenderSummary(sample) {
    if (!sample) {
        return 'No render sample';
    }

    const visibleLayers = getClusterDebugVisibleLayers(sample);
    const layerLabel = visibleLayers.length > 0 ? visibleLayers.join('+') : 'primary-only';
    const toLabel = sample.toClusterKey ? ` to=[${sample.toClusterKey}]` : '';

    return `${sample.runtimePhase} ${layerLabel} from=[${sample.fromClusterKey}]${toLabel}`;
}

function computeClusterDebugLayerMotion(previousSample, nextSample, layerKey) {
    if (!previousSample || !nextSample) {
        return 0;
    }

    const visibleKey = `${layerKey}Visible`;
    const opacityKey = `${layerKey}Opacity`;
    const xKey = `${layerKey}X`;
    const yKey = `${layerKey}Y`;
    const nextVisible = Boolean(nextSample[visibleKey]);
    const nextOpacityRaw = nextSample[opacityKey];
    const nextOpacity = Number.isFinite(nextOpacityRaw)
        ? nextOpacityRaw
        : (nextVisible ? 1 : 0);

    if (!nextVisible || nextOpacity <= 0.001) {
        return 0;
    }

    return Math.hypot(
        (nextSample[xKey] || 0) - (previousSample[xKey] || 0),
        (nextSample[yKey] || 0) - (previousSample[yKey] || 0)
    );
}

function buildClusterDebugTransitionTimeline(events, startedAt) {
    if (!events || events.length === 0) {
        return ['Runtime transitions: none'];
    }

    return [
        'Runtime transitions:',
        ...events.map(event => {
            const offsetMs = Math.max(0, Math.round((event.timestamp || startedAt) - startedAt));
            const prefix = `- t+${offsetMs}ms ${event.type}`;

            return (
                `${prefix} primary=${event.primaryStationId || 'n/a'} ` +
                `from=[${event.fromClusterKey || ''}] to=[${event.toClusterKey || ''}] ` +
                `transition=[${event.transitionKey || ''}]`
            ).trim();
        }),
    ];
}

function buildClusterDebugJumpEvents(samples) {
    const trackedMetrics = [
        ['outsideFrameDelta', 'move(outside)'],
        ['accumulatorFrameDelta', 'move(accumulator)'],
        ['mergeMoverFrameDelta', 'move(mergeMover)'],
        ['splitMoverFrameDelta', 'move(splitMover)'],
        ['maxFrameDelta', 'move(max)'],
    ];
    const events = [];

    for (let index = 1; index < samples.length; index += 1) {
        const previousSample = samples[index - 1];
        const nextSample = samples[index];

        for (const [metricKey, label] of trackedMetrics) {
            const previousValue = previousSample[metricKey];
            const nextValue = nextSample[metricKey];

            if (!Number.isFinite(previousValue) || !Number.isFinite(nextValue)) {
                continue;
            }

            const delta = nextValue - previousValue;
            if (Math.abs(delta) <= CLUSTER_DEBUG_JUMP_THRESHOLD) {
                continue;
            }

            const causes = [];
            const rules = [];

            if (previousSample.clusterKey !== nextSample.clusterKey) {
                causes.push(`rendered cluster changed (${previousSample.clusterKey} -> ${nextSample.clusterKey})`);
            }
            if (previousSample.summary !== nextSample.summary) {
                causes.push(`summary changed ("${previousSample.summary}" -> "${nextSample.summary}")`);
            }
            if (previousSample.runtimePhase !== nextSample.runtimePhase) {
                causes.push(`runtime phase changed (${previousSample.runtimePhase} -> ${nextSample.runtimePhase})`);
            }
            if (previousSample.stageSignature !== nextSample.stageSignature) {
                causes.push(`stage changed (${previousSample.stageSignature} -> ${nextSample.stageSignature})`);
            }
            if (previousSample.visibleLayers !== nextSample.visibleLayers) {
                causes.push(`visible layers changed (${previousSample.visibleLayers || 'none'} -> ${nextSample.visibleLayers || 'none'})`);
            }
            rules.push('Runtime render rule: motion is measured from consecutive on-screen layer positions only.');

            const deltaPrefix = delta > 0 ? '+' : '';
            events.push(
                [
                    `- ${label} jumped ${deltaPrefix}${formatDebugMetric(delta)}pt (${formatDebugMetric(previousValue)} -> ${formatDebugMetric(nextValue)})`,
                    `  causes: ${causes.length > 0 ? causes.join('; ') : 'same watched overlay, layer moved on screen'}`,
                    `  rules: ${Array.from(new Set(rules)).join(' | ')}`,
                    `  factors: spread ${formatDebugMetric(previousSample.spreadProgress)} -> ${formatDebugMetric(nextSample.spreadProgress)}, morph ${formatDebugMetric(previousSample.morphProgress)} -> ${formatDebugMetric(nextSample.morphProgress)}, bridge ${formatDebugMetric(previousSample.bridgeProgress)} -> ${formatDebugMetric(nextSample.bridgeProgress)}, layers ${previousSample.visibleLayers || 'none'} -> ${nextSample.visibleLayers || 'none'}, reach ${formatDebugMetric(previousSample.maxSecondaryRadius)} -> ${formatDebugMetric(nextSample.maxSecondaryRadius)}, shell ${formatDebugMetric(previousSample.secondaryShellWidth)} -> ${formatDebugMetric(nextSample.secondaryShellWidth)}`
                ].join('\n')
            );
        }
    }

    return events;
}

function buildClusterDebugRecordingLog(samples, transitionEvents = []) {
    if (!samples || samples.length === 0) {
        return '[ClusterDebug Recording]\nNo samples captured.';
    }

    const startedAt = samples[0].timestamp;
    const endedAt = samples[samples.length - 1].timestamp;
    const durationMs = Math.max(0, endedAt - startedAt);
    const clusterTransitions = samples.reduce((count, sample, index) => {
        if (index === 0) {
            return 0;
        }

        return count + (sample.clusterKey !== samples[index - 1].clusterKey ? 1 : 0);
    }, 0);
    const runtimePhaseTransitions = samples.reduce((count, sample, index) => {
        if (index === 0) {
            return 0;
        }

        return count + (sample.runtimePhase !== samples[index - 1].runtimePhase ? 1 : 0);
    }, 0);
    const spreadSeries = summarizeDebugSeries(samples, 'spreadProgress');
    const morphSeries = summarizeDebugSeries(samples, 'morphProgress');
    const bridgeProgressSeries = summarizeDebugSeries(samples, 'bridgeProgress');
    const visibleLayerCountSeries = summarizeDebugSeries(samples, 'visibleLayerCount');
    const maxReachSeries = summarizeDebugSeries(samples, 'maxSecondaryRadius');
    const shellWidthSeries = summarizeDebugSeries(samples, 'secondaryShellWidth');
    const outsideMoveSeries = summarizeDebugSeries(samples, 'outsideFrameDelta');
    const accumulatorMoveSeries = summarizeDebugSeries(samples, 'accumulatorFrameDelta');
    const mergeMoverMoveSeries = summarizeDebugSeries(samples, 'mergeMoverFrameDelta');
    const splitMoverMoveSeries = summarizeDebugSeries(samples, 'splitMoverFrameDelta');
    const maxMoveSeries = summarizeDebugSeries(samples, 'maxFrameDelta');
    const jumpEvents = buildClusterDebugJumpEvents(samples);

    return [
        '[ClusterDebug Recording]',
        `samples=${samples.length} duration=${durationMs}ms clusterChanges=${clusterTransitions}`,
        `renderedStart=${samples[0].clusterKey}`,
        `renderedEnd=${samples[samples.length - 1].clusterKey}`,
        `runtimeStart=${samples[0].runtimePhase || 'live'}`,
        `runtimeEnd=${samples[samples.length - 1].runtimePhase || 'live'}`,
        `runtimePhaseChanges=${runtimePhaseTransitions}`,
        formatSeriesLine('spread(render)', spreadSeries),
        formatSeriesLine('morph(render)', morphSeries),
        formatSeriesLine('bridge(progress)', bridgeProgressSeries),
        formatSeriesLine('layers(visible)', visibleLayerCountSeries),
        formatSeriesLine('reach(max)', maxReachSeries, 'pt'),
        formatSeriesLine('shellWidth', shellWidthSeries, 'pt'),
        formatSeriesLine('move(outside)', outsideMoveSeries, 'pt'),
        formatSeriesLine('move(accumulator)', accumulatorMoveSeries, 'pt'),
        formatSeriesLine('move(mergeMover)', mergeMoverMoveSeries, 'pt'),
        formatSeriesLine('move(splitMover)', splitMoverMoveSeries, 'pt'),
        formatSeriesLine('move(max)', maxMoveSeries, 'pt'),
        `summaryStart=${samples[0].summary}`,
        `summaryEnd=${samples[samples.length - 1].summary}`,
        `largeStepChanges>${CLUSTER_DEBUG_JUMP_THRESHOLD}pt=${jumpEvents.length}`,
        ...buildClusterDebugTransitionTimeline(transitionEvents, startedAt),
        ...(jumpEvents.length > 0
            ? ['Large step changes:', ...jumpEvents]
            : ['Large step changes: none']),
    ].join('\n');
}

function AnimatedCardItem({ item, index, scrollX, itemWidth, isDark, benchmarkQuote, errorMsg, isRefreshing, themeColors }) {
    const animatedDimStyle = useAnimatedStyle(() => {
        if (isDark) return { opacity: 0 };

        const inputRange = [(index - 1) * itemWidth, index * itemWidth, (index + 1) * itemWidth];
        const dimOpacity = interpolate(
            scrollX.value,
            inputRange,
            [0.3, 0, 0.3],
            Extrapolate.CLAMP
        );

        return { opacity: dimOpacity };
    });

    return (
        <View style={{ width: itemWidth, paddingHorizontal: 4 }}>
            <FuelSummaryCard
                benchmarkQuote={benchmarkQuote}
                errorMsg={errorMsg}
                isDark={isDark}
                isRefreshing={isRefreshing}
                quote={item}
                themeColors={themeColors}
                rank={index + 1}
            />
            {!isDark && (
                <Animated.View
                    pointerEvents="none"
                    style={[{
                        position: 'absolute',
                        top: 0,
                        bottom: 0,
                        left: 4,
                        right: 4,
                        backgroundColor: '#000000',
                        borderRadius: 32
                    }, animatedDimStyle]}
                />
            )}
        </View>
    );
}

export default function HomeScreen() {
    const mapRef = useRef(null);
    const flatListRef = useRef(null);
    const isMountedRef = useRef(true);
    const mapIdleWaitersRef = useRef([]);
    const mapIdleSettleTimeoutRef = useRef(null);
    const mapRegionRef = useRef(DEFAULT_REGION);
    const lastClusterDebugSignatureRef = useRef('');
    const clusterDebugSamplesRef = useRef([]);
    const clusterDebugTransitionEventsRef = useRef([]);
    const clusterDebugTransitionEventKeysRef = useRef(new Set());
    const clusterDebugWatchedPrimaryIdRef = useRef(null);
    const clusterDebugProbeModeRef = useRef('idle');
    const clusterDebugProbeRunIdRef = useRef(0);
    const clusterDebugAutoProbeHandledKeyRef = useRef('');
    const clusterDebugAutoProbeSeededKeyRef = useRef('');
    const isFocused = useIsFocused();
    const insets = useSafeAreaInsets();
    const { isDark, themeColors } = useTheme();
    const { preferences } = usePreferences();
    const {
        fuelResetToken,
        manualLocationOverride,
        setFuelDebugState,
        clusterProbeRequest,
        isClusterProbeSessionActive,
        finishClusterProbeSession,
    } = useAppState();
    const resolvedAutoClusterProbeRequest = __DEV__ ? clusterProbeRequest : null;
    const autoClusterProbeRequested = Boolean(resolvedAutoClusterProbeRequest) || Boolean(isClusterProbeSessionActive);
    const autoClusterProbeRequestKey = resolvedAutoClusterProbeRequest?.token || '';
    const autoClusterProbeRequestSource = resolvedAutoClusterProbeRequest?.source || '';
    const debugClusterAnimations = __DEV__ && (
        Boolean(preferences.debugClusterAnimations) ||
        autoClusterProbeRequested
    );
    const [location, setLocation] = useState(DEFAULT_REGION);
    const [bestQuote, setBestQuote] = useState(null);
    const [topStations, setTopStations] = useState([]);
    const [regionalQuotes, setRegionalQuotes] = useState([]);
    const [errorMsg, setErrorMsg] = useState(null);
    const [isLoadingLocation, setIsLoadingLocation] = useState(true);
    const [isRefreshingPrices, setIsRefreshingPrices] = useState(false);
    const [hasLocationPermission, setHasLocationPermission] = useState(false);
    const [activeIndex, setActiveIndex] = useState(0);
    const [mapRegion, setMapRegion] = useState(DEFAULT_REGION);
    const [isMapMoving, setIsMapMoving] = useState(false);
    const [isClusterDebugRecording, setIsClusterDebugRecording] = useState(false);
    const [isClusterDebugProbeRunning, setIsClusterDebugProbeRunning] = useState(false);
    const [clusterDebugProbeSummary, setClusterDebugProbeSummary] = useState('');
    const router = useRouter();
    const scrollX = useSharedValue(0);

    const USE_SHEET_UX = false; // Temporary toggle for the Form Sheet UX experiment

    const bottomPadding = insets.bottom + TAB_BAR_CLEARANCE + CARD_GAP;
    const horizontalPadding = {
        left: insets.left + SIDE_MARGIN,
        right: insets.right + SIDE_MARGIN,
    };
    const topCanopyHeight = insets.top + TOP_CANOPY_HEIGHT;
    const canopyEdgeLine = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.42)';

    const applySnapshot = snapshot => {
        if (!snapshot?.quote || !isMountedRef.current) {
            return;
        }

        startTransition(() => {
            setBestQuote(snapshot.quote);
            setTopStations(snapshot.topStations || []);
            setRegionalQuotes(snapshot.regionalQuotes || []);
        });
    };

    const clearVisibleFuelState = (nextError = null) => {
        startTransition(() => {
            setBestQuote(null);
            setTopStations([]);
            setRegionalQuotes([]);
        });
        setErrorMsg(nextError);
        setIsRefreshingPrices(false);
        setIsLoadingLocation(false);
    };

    const resolveCurrentLocation = async () => {
        if (manualLocationOverride) {
            const manualLatitude = Number(manualLocationOverride.latitude);
            const manualLongitude = Number(manualLocationOverride.longitude);
            const isManualLocationValid =
                Number.isFinite(manualLatitude) &&
                Number.isFinite(manualLongitude) &&
                manualLatitude >= -90 &&
                manualLatitude <= 90 &&
                manualLongitude >= -180 &&
                manualLongitude <= 180;

            if (!isManualLocationValid) {
                if (isMountedRef.current) {
                    const invalidLocationMessage = getFuelFailureMessage({
                        reason: 'invalid-manual-location',
                    });

                    setFuelDebugState({
                        input: {
                            fuelType: 'regular',
                            latitude: manualLocationOverride.latitude,
                            longitude: manualLocationOverride.longitude,
                            locationSource: 'manual',
                            radiusMiles: 10,
                            zipCode: null,
                        },
                        providers: [],
                        requestedAt: new Date().toISOString(),
                    });
                    clearVisibleFuelState(invalidLocationMessage);
                }
                return null;
            }

            const manualRegion = {
                latitude: manualLatitude,
                longitude: manualLongitude,
                latitudeDelta: 0.05,
                longitudeDelta: 0.05,
            };

            if (isMountedRef.current) {
                setHasLocationPermission(false);
                setLocation(manualRegion);
                if (mapRef.current) {
                    setMapMotionState(true);
                    mapRef.current.animateToRegion(manualRegion, 550);
                }
                setIsLoadingLocation(false);
            }

            return {
                ...manualRegion,
                locationSource: 'manual',
            };
        }

        if (!bestQuote) {
            setIsLoadingLocation(true);
        }

        try {
            const permissionState = await Location.getForegroundPermissionsAsync();
            let permissionStatus = permissionState.status;

            if (permissionStatus !== 'granted') {
                const requestedState = await Location.requestForegroundPermissionsAsync();
                permissionStatus = requestedState.status;
            }

            if (permissionStatus !== 'granted') {
                if (isMountedRef.current) {
                    setHasLocationPermission(false);
                    clearVisibleFuelState('Location permission was denied. Allow location to search for the cheapest nearby fuel.');
                }
                return null;
            }

            if (isMountedRef.current) {
                setHasLocationPermission(true);
            }

            const loc = await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.Balanced,
            });

            if (!isMountedRef.current) {
                return null;
            }

            const nextRegion = {
                latitude: loc.coords.latitude,
                longitude: loc.coords.longitude,
                latitudeDelta: 0.05,
                longitudeDelta: 0.05,
            };

            setLocation(nextRegion);
            if (mapRef.current) {
                setMapMotionState(true);
                mapRef.current.animateToRegion(nextRegion, 550);
            }

            return nextRegion;
        } catch (error) {
            if (isMountedRef.current) {
                setHasLocationPermission(false);
                clearVisibleFuelState('Unable to get your current location. In the iOS Simulator, set a location in Features > Location.');
            }
            return null;
        } finally {
            if (isMountedRef.current) {
                setIsLoadingLocation(false);
            }
        }
    };

    const loadFuelData = async ({ latitude, longitude, locationSource, preferCached }) => {
        const query = {
            latitude,
            longitude,
            radiusMiles: preferences.searchRadiusMiles || 10,
            fuelType: preferences.preferredOctane || 'regular',
            preferredProvider: preferences.preferredProvider || 'gasbuddy',
        };
        const baseDebugState = {
            input: {
                ...query,
                locationSource,
                zipCode: null,
            },
            providers: [],
            requestedAt: new Date().toISOString(),
        };

        try {
            if (isMountedRef.current) {
                setFuelDebugState(baseDebugState);
            }

            if (preferCached) {
                const cachedSnapshot = await getCachedFuelPriceSnapshot(query);
                applySnapshot(cachedSnapshot);
            }

            if (isMountedRef.current) {
                setErrorMsg(null);
                setIsRefreshingPrices(true);
            }

            const result = await refreshFuelPriceSnapshot(query);
            const freshSnapshot = result?.snapshot;
            const nextDebugState = result?.debugState
                ? {
                    ...result.debugState,
                    input: {
                        ...result.debugState.input,
                        locationSource,
                    },
                }
                : baseDebugState;

            if (!freshSnapshot?.quote) {
                throw new Error('No prices returned');
            }

            applySnapshot(freshSnapshot);

            if (isMountedRef.current) {
                setErrorMsg(null);
                setFuelDebugState(nextDebugState);
            }
        } catch (error) {
            if (isMountedRef.current) {
                const nextDebugState = error?.debugState
                    ? {
                        ...error.debugState,
                        input: {
                            ...error.debugState.input,
                            locationSource,
                        },
                    }
                    : baseDebugState;

                setFuelDebugState(nextDebugState);
                clearVisibleFuelState(
                    error?.userMessage ||
                    getFuelFailureMessage({
                        debugState: nextDebugState,
                    })
                );
            }
        } finally {
            if (isMountedRef.current) {
                setIsRefreshingPrices(false);
            }
        }
    };

    const refreshForCurrentView = async ({ preferCached }) => {
        const nextRegion = await resolveCurrentLocation();

        if (!nextRegion) {
            return;
        }

        await loadFuelData({
            latitude: nextRegion.latitude,
            longitude: nextRegion.longitude,
            locationSource: nextRegion.locationSource || 'device',
            preferCached,
        });
    };

    useEffect(() => {
        return () => {
            isMountedRef.current = false;
            clearMapIdleSettleTimeout();
            const pendingMapIdleWaiters = mapIdleWaitersRef.current;

            mapIdleWaitersRef.current = [];
            pendingMapIdleWaiters.forEach(waiter => {
                waiter.resolve(false);
            });
        };
    }, []);

    useEffect(() => {
        if (!fuelResetToken) {
            return;
        }

        clearVisibleFuelState('Fuel cache cleared. Open Home to fetch fresh prices.');
        setFuelDebugState(null);
    }, [fuelResetToken]);

    useEffect(() => {
        if (!isFocused && !autoClusterProbeRequested) {
            return;
        }

        void refreshForCurrentView({
            preferCached: true,
        });
    }, [isFocused, manualLocationOverride, autoClusterProbeRequested]);

    const onViewableItemsChanged = useRef(({ viewableItems }) => {
        if (viewableItems.length > 0) {
            setActiveIndex(viewableItems[0].index);
        }
    }).current;

    const scrollHandler = useAnimatedScrollHandler({
        onScroll: (event) => {
            scrollX.value = event.contentOffset.x;
        },
    });

    const viewabilityConfig = useRef({
        itemVisiblePercentThreshold: 50,
    }).current;

    const { width, height } = Dimensions.get('window');

    const minRating = preferences.minimumRating || 0;
    const stationQuotes = useMemo(() => (
        (topStations.length > 0 ? topStations : (bestQuote ? [bestQuote] : []))
            .filter(q => minRating === 0 || (q.rating != null && q.rating >= minRating))
            .map((q, idx) => ({ ...q, originalIndex: idx }))
    ), [topStations, bestQuote, minRating]);

    const stationQuotesRef = useRef([]);
    const clustersSignatureRef = useRef('');

    const computedClusters = useMemo(() => {
        if (stationQuotes.length === 0) {
            return [];
        }

        return groupStationsIntoClusters({
            stationQuotes,
            mapRegion,
            screenWidth: width,
            screenHeight: height,
        });
    }, [stationQuotes, mapRegion, width, height]);
    const [clusters, setClusters] = useState(computedClusters);

    useEffect(() => {
        if (!isMapMoving) {
            setClusters(computedClusters);
        }
    }, [computedClusters, isMapMoving]);
    const clustersSignature = useMemo(() => (
        clusters.map(buildClusterMembershipKey).join('|')
    ), [clusters]);

    useEffect(() => {
        stationQuotesRef.current = stationQuotes;
    }, [stationQuotes]);

    useEffect(() => {
        clustersSignatureRef.current = clustersSignature;
    }, [clustersSignature]);

    const recordClusterDebugTransitionEvent = (event) => {
        if (!debugClusterAnimations || !isClusterDebugRecording || !event?.type) {
            return;
        }

        const eventKey = [
            event.type,
            event.primaryStationId || '',
            event.fromClusterKey || '',
            event.toClusterKey || '',
            event.transitionKey || '',
            event.moverStationId || '',
        ].join('|');

        if (clusterDebugTransitionEventKeysRef.current.has(eventKey)) {
            return;
        }

        clusterDebugTransitionEventKeysRef.current.add(eventKey);
        clusterDebugTransitionEventsRef.current = [
            ...clusterDebugTransitionEventsRef.current,
            {
                timestamp: Date.now(),
                ...event,
            },
        ];
    };

    const handleMarkerPress = (cluster) => {
        const primaryQuote = cluster.quotes[0];
        const index = primaryQuote.originalIndex;

        isUserScrollingRef.current = false; // Prevent map feedback loop
        flatListRef.current?.scrollToOffset({
            offset: index * itemWidth,
            animated: true,
        });
        setActiveIndex(index);

        // If it's a cluster, zoom in to naturally separate them
        if (cluster.quotes.length > 1 && mapRef.current) {
            // Find the maximum spread of the cluster to determine how far to zoom in
            const lats = cluster.quotes.map(q => q.latitude);
            const lngs = cluster.quotes.map(q => q.longitude);

            const maxLat = Math.max(...lats);
            const minLat = Math.min(...lats);
            const maxLng = Math.max(...lngs);
            const minLng = Math.min(...lngs);

            const latSpread = maxLat - minLat;
            const lngSpread = maxLng - minLng;

            // Zoom out far enough so we can comfortably see all separated icons around the center
            // A multiplier of 5-6 ensures the cluster spread occupies only a fraction of the screen, safely unmerging them
            const targetLatDelta = Math.max(latSpread * 6, 0.03);
            const targetLngDelta = Math.max(lngSpread * 6, 0.03);

            isAnimatingRef.current = true;
            setMapMotionState(true);
            mapRef.current.animateToRegion({
                latitude: cluster.averageLat,
                longitude: cluster.averageLng,
                latitudeDelta: targetLatDelta,
                longitudeDelta: targetLngDelta,
            }, 600);
        }
    };

    // We want the card to be almost full width, minus some padding to peek the next card.
    const peekPadding = 16;
    const itemWidth = width - (peekPadding * 2);
    const sideInset = (width - itemWidth) / 2;

    const lastDataHashRef = useRef('');
    const isUserScrollingRef = useRef(false);
    const isAnimatingRef = useRef(false);
    const mapMotionRef = useRef(false);
    const prevIsFocusedRef = useRef(isFocused);

    const clearMapIdleSettleTimeout = () => {
        if (mapIdleSettleTimeoutRef.current) {
            clearTimeout(mapIdleSettleTimeoutRef.current);
            mapIdleSettleTimeoutRef.current = null;
        }
    };

    const setMapMotionState = (moving) => {
        if (mapMotionRef.current === moving) {
            return;
        }

        mapMotionRef.current = moving;
        setIsMapMoving(moving);
    };

    const setMapRegionIfNeeded = (nextRegion) => {
        if (!nextRegion) {
            return;
        }

        mapRegionRef.current = nextRegion;

        setMapRegion(currentRegion => (
            areRegionsEquivalent(currentRegion, nextRegion)
                ? currentRegion
                : nextRegion
        ));
    };

    const flushMapIdleWaiters = (didReachIdle) => {
        if (mapIdleWaitersRef.current.length === 0) {
            return;
        }

        const pendingMapIdleWaiters = mapIdleWaitersRef.current;
        mapIdleWaitersRef.current = [];
        pendingMapIdleWaiters.forEach(waiter => {
            waiter.resolve(didReachIdle);
        });
    };

    const waitForMapIdle = (timeoutMs = CLUSTER_DEBUG_PROBE_IDLE_TIMEOUT) => {
        if (!mapMotionRef.current && !isAnimatingRef.current) {
            return Promise.resolve(true);
        }

        return new Promise(resolve => {
            const waiter = {
                resolve: (didReachIdle) => {
                    clearTimeout(waiter.timeoutId);
                    mapIdleWaitersRef.current = mapIdleWaitersRef.current.filter(candidate => candidate !== waiter);
                    resolve(didReachIdle);
                },
                timeoutId: null,
            };

            waiter.timeoutId = setTimeout(() => {
                waiter.resolve(false);
            }, timeoutMs);

            mapIdleWaitersRef.current = [
                ...mapIdleWaitersRef.current,
                waiter,
            ];
        });
    };

    useEffect(() => {
        const wasFocused = prevIsFocusedRef.current;
        prevIsFocusedRef.current = isFocused;

        if (!mapRef.current || stationQuotes.length === 0 || isAnimatingRef.current) return;

        // Use ONLY stationQuotes for the data hash to avoid feedback loops from zooming
        const currentHash = stationQuotes.map(q => q.stationId).join(',');
        const isFocusGained = isFocused && !wasFocused;
        const isNewData = currentHash !== lastDataHashRef.current;

        if (isNewData || isFocusGained) {
            lastDataHashRef.current = currentHash;
            isUserScrollingRef.current = false;

            // Frame all stations (since clusters are dynamic and zoom-dependent)
            const coords = [
                { latitude: location.latitude, longitude: location.longitude },
                ...stationQuotes.filter(q => q.latitude && q.longitude).map(q => ({ latitude: q.latitude, longitude: q.longitude }))
            ];

            if (coords.length > 1) {
                isAnimatingRef.current = true;
                setTimeout(() => {
                    if (!mapRef.current) {
                        isAnimatingRef.current = false;
                        if (isMountedRef.current) {
                            setMapMotionState(false);
                        }
                        return;
                    }

                    setMapMotionState(true);
                    mapRef.current.fitToCoordinates(coords, {
                        edgePadding: { top: 120, right: 60, bottom: bottomPadding + 160, left: 60 },
                        animated: true,
                    });
                }, 100);
            }
        } else if (isUserScrollingRef.current && activeIndex >= 0 && activeIndex < stationQuotes.length) {
            const activeQuote = stationQuotes[activeIndex];
            if (activeQuote.latitude && activeQuote.longitude) {
                isAnimatingRef.current = true;
                setMapMotionState(true);
                mapRef.current.animateToRegion({
                    latitude: activeQuote.latitude,
                    longitude: activeQuote.longitude,
                    latitudeDelta: 0.05,
                    longitudeDelta: 0.05,
                }, 400);
            }
        }
    }, [activeIndex, stationQuotes, location, bottomPadding, isFocused]);

    const fallbackCoordinate = {
        latitude: location.latitude,
        longitude: location.longitude,
    };
    const benchmarkQuote = regionalQuotes.find(quote => quote.providerId !== bestQuote?.providerId) || regionalQuotes[0] || null;
    const watchedCluster = useMemo(() => {
        if (!debugClusterAnimations) {
            return null;
        }

        const multiQuoteClusters = clusters.filter(cluster => cluster.quotes.length > 1);
        if (multiQuoteClusters.length === 0) {
            return null;
        }

        const latScale = mapRegion.latitudeDelta || 1;
        const lngScale = mapRegion.longitudeDelta || 1;

        return multiQuoteClusters.reduce((closestCluster, cluster) => {
            if (!closestCluster) {
                return cluster;
            }

            const clusterDistance = Math.hypot(
                (cluster.averageLat - mapRegion.latitude) / latScale,
                (cluster.averageLng - mapRegion.longitude) / lngScale
            );
            const closestDistance = Math.hypot(
                (closestCluster.averageLat - mapRegion.latitude) / latScale,
                (closestCluster.averageLng - mapRegion.longitude) / lngScale
            );

            return clusterDistance < closestDistance ? cluster : closestCluster;
        }, null);
    }, [debugClusterAnimations, clusters, mapRegion.latitude, mapRegion.longitude, mapRegion.latitudeDelta, mapRegion.longitudeDelta]);
    const watchedClusterDiagnostic = null;
    const activeClusterDebugPrimaryId = isClusterDebugRecording
        ? clusterDebugWatchedPrimaryIdRef.current
        : (watchedCluster?.quotes?.[0]?.stationId || null);

    const recordClusterDebugRenderFrame = (frame) => {
        if (!debugClusterAnimations || !isClusterDebugRecording || !frame) {
            return false;
        }

        const probeMode = clusterDebugProbeModeRef.current || 'idle';
        const signature = [
            frame.clusterKey || '',
            frame.stageSignature || '',
            frame.runtimePhase || 'live',
            probeMode,
            formatDebugMetric(frame.spreadProgress, 5),
            formatDebugMetric(frame.morphProgress, 5),
            formatDebugMetric(frame.bridgeProgress, 5),
            formatDebugMetric(frame.outsideX, 4),
            formatDebugMetric(frame.outsideY, 4),
            frame.outsideVisible ? '1' : '0',
            formatDebugMetric(frame.accumulatorX, 4),
            formatDebugMetric(frame.accumulatorY, 4),
            frame.accumulatorVisible ? '1' : '0',
            formatDebugMetric(frame.mergeMoverX, 4),
            formatDebugMetric(frame.mergeMoverY, 4),
            frame.mergeMoverVisible ? '1' : '0',
            formatDebugMetric(frame.splitMoverX, 4),
            formatDebugMetric(frame.splitMoverY, 4),
            frame.splitMoverVisible ? '1' : '0',
        ].join('|');

        const previousSample = clusterDebugSamplesRef.current[clusterDebugSamplesRef.current.length - 1] || null;
        const nextSample = finalizeDebugSample(frame, previousSample, probeMode);

        clusterDebugSamplesRef.current.push(nextSample);
        lastClusterDebugSignatureRef.current = signature;
        return true;
    };

    const startClusterDebugCapture = (primaryStationId = null) => {
        clusterDebugSamplesRef.current = [];
        clusterDebugTransitionEventsRef.current = [];
        clusterDebugTransitionEventKeysRef.current = new Set();
        lastClusterDebugSignatureRef.current = '';
        clusterDebugWatchedPrimaryIdRef.current = primaryStationId;
        clusterDebugProbeModeRef.current = 'warmup';
        setIsClusterDebugRecording(true);
    };

    const stopClusterDebugCapture = () => {
        const recordedSamples = clusterDebugSamplesRef.current;
        const recordedTransitionEvents = clusterDebugTransitionEventsRef.current;

        setIsClusterDebugRecording(false);
        lastClusterDebugSignatureRef.current = '';
        clusterDebugWatchedPrimaryIdRef.current = null;
        clusterDebugProbeModeRef.current = 'idle';
        clusterDebugSamplesRef.current = [];
        clusterDebugTransitionEventsRef.current = [];
        clusterDebugTransitionEventKeysRef.current = new Set();

        return {
            recordedSamples,
            recordedTransitionEvents,
            logText: buildClusterDebugRecordingLog(recordedSamples, recordedTransitionEvents),
        };
    };

    const handleStartClusterDebugRecording = () => {
        if (isClusterDebugProbeRunning) {
            return;
        }

        startClusterDebugCapture(watchedCluster?.quotes?.[0]?.stationId || null);
    };

    const handleStopClusterDebugRecording = () => {
        if (isClusterDebugProbeRunning) {
            return;
        }

        const { logText } = stopClusterDebugCapture();
        console.debug(logText);
    };

    const animateClusterDebugProbeToRegion = async (nextRegion, runId) => {
        if (!mapRef.current || !nextRegion || clusterDebugProbeRunIdRef.current !== runId) {
            return false;
        }

        if (areRegionsEquivalent(mapRegionRef.current, nextRegion)) {
            setMapRegionIfNeeded(nextRegion);
            await waitForMilliseconds(CLUSTER_DEBUG_PROBE_SETTLE_DURATION);
            return true;
        }

        isAnimatingRef.current = true;
        setMapMotionState(true);
        mapRef.current.animateToRegion(nextRegion, CLUSTER_DEBUG_PROBE_ANIMATION_DURATION);

        const didReachIdle = await waitForMapIdle(
            CLUSTER_DEBUG_PROBE_ANIMATION_DURATION + CLUSTER_DEBUG_PROBE_IDLE_TIMEOUT
        );

        if (!didReachIdle && isMountedRef.current && clusterDebugProbeRunIdRef.current === runId) {
            isAnimatingRef.current = false;
            setMapMotionState(false);
            setMapRegionIfNeeded(nextRegion);
        }

        await waitForMilliseconds(CLUSTER_DEBUG_PROBE_SETTLE_DURATION);
        return didReachIdle;
    };

    const waitForClusterDebugProbeResetSettle = async (runId, timeoutMs = 4500) => {
        const deadline = Date.now() + timeoutMs;

        while (Date.now() < deadline) {
            if (clusterDebugProbeRunIdRef.current !== runId) {
                return false;
            }

            if (!mapMotionRef.current && !isAnimatingRef.current) {
                await waitForMilliseconds(CLUSTER_DEBUG_PROBE_SETTLE_DURATION);

                if (
                    clusterDebugProbeRunIdRef.current !== runId ||
                    mapMotionRef.current ||
                    isAnimatingRef.current
                ) {
                    continue;
                }

                return true;
            }

            await waitForMilliseconds(50);
        }

        return false;
    };

    const handleRunClusterDebugProbe = async (trigger = 'manual') => {
        if (!debugClusterAnimations || isClusterDebugProbeRunning || isClusterDebugRecording) {
            return;
        }

        if (!watchedCluster || !mapRef.current) {
            const message = 'Move the map until a multi-station cluster is near center, then run Probe.';

            setClusterDebugProbeSummary(message);
            await writeClusterDebugProbeArtifact({
                status: 'blocked',
                trigger,
                message,
                clusterKey: watchedCluster ? buildClusterMembershipKey(watchedCluster) : '',
                sampleCount: 0,
                transitionCount: 0,
                maxFrameDelta: 0,
                timedOutStages: [],
                plan: watchedCluster ? buildClusterDebugProbePlan(watchedCluster, mapRegion, location) : null,
                logText: '',
            });
            return;
        }

        const probePlan = buildClusterDebugProbePlan(watchedCluster, mapRegion, location);

        if (!probePlan) {
            const message = 'Unable to build a probe plan for the current cluster.';

            setClusterDebugProbeSummary(message);
            await writeClusterDebugProbeArtifact({
                status: 'blocked',
                trigger,
                message,
                clusterKey: buildClusterMembershipKey(watchedCluster),
                sampleCount: 0,
                transitionCount: 0,
                maxFrameDelta: 0,
                timedOutStages: [],
                plan: null,
                logText: '',
            });
            return;
        }

        const runId = clusterDebugProbeRunIdRef.current + 1;
        let didStartCapture = false;

        clusterDebugProbeRunIdRef.current = runId;
        setIsClusterDebugProbeRunning(true);
        setClusterDebugProbeSummary('Probe: locking onto the nearest cluster.');

        try {
            await writeClusterDebugProbeArtifact({
                status: 'running',
                trigger,
                message: 'Probe is waiting for the map to settle before recording.',
                clusterKey: probePlan.clusterKey,
                sampleCount: 0,
                transitionCount: 0,
                maxFrameDelta: 0,
                timedOutStages: [],
                plan: probePlan,
                logText: '',
            });

            setClusterDebugProbeSummary('Probe: waiting 3 seconds for the map to load.');
            await waitForMilliseconds(CLUSTER_DEBUG_PROBE_INITIAL_LOAD_WAIT);
            if (clusterDebugProbeRunIdRef.current !== runId) {
                return;
            }

            if (!areRegionsEquivalent(mapRegionRef.current, probePlan.focusStartRegion)) {
                setClusterDebugProbeSummary('Probe: centering on your current location before recording.');
                await animateClusterDebugProbeToRegion(probePlan.focusStartRegion, runId);
                if (clusterDebugProbeRunIdRef.current !== runId) {
                    return;
                }
            }

            startClusterDebugCapture(watchedCluster.quotes[0].stationId);
            didStartCapture = true;
            const startClusterSignature = clustersSignatureRef.current;
            const startStationScreenSnapshot = buildProbeStationScreenSnapshot(
                stationQuotesRef.current,
                mapRegionRef.current,
                width,
                height
            );

            setClusterDebugProbeSummary('Probe: recording started. Holding for 150ms.');
            await waitForMilliseconds(CLUSTER_DEBUG_PROBE_RECORDING_DELAY);
            if (clusterDebugProbeRunIdRef.current !== runId) {
                return;
            }

            const timedOutStages = [];
            const totalZoomInSteps = probePlan.zoomInRegions.length;
            clusterDebugProbeModeRef.current = 'stepped';

            for (let stepIndex = 0; stepIndex < totalZoomInSteps; stepIndex += 1) {
                if (clusterDebugProbeRunIdRef.current !== runId) {
                    return;
                }

                setClusterDebugProbeSummary(
                    `Probe: zooming in ${stepIndex + 1}/${totalZoomInSteps}.`
                );

                if (!await animateClusterDebugProbeToRegion(probePlan.zoomInRegions[stepIndex], runId)) {
                    timedOutStages.push(`zoom-in-${stepIndex + 1}`);
                }

                if (stepIndex < totalZoomInSteps - 1) {
                    await waitForMilliseconds(CLUSTER_DEBUG_PROBE_BETWEEN_STEP_DELAY);
                }
            }

            const totalZoomOutSteps = probePlan.zoomOutRegions.length;

            for (let stepIndex = 0; stepIndex < totalZoomOutSteps; stepIndex += 1) {
                if (clusterDebugProbeRunIdRef.current !== runId) {
                    return;
                }

                setClusterDebugProbeSummary(
                    `Probe: zooming out ${stepIndex + 1}/${totalZoomOutSteps}.`
                );

                if (!await animateClusterDebugProbeToRegion(probePlan.zoomOutRegions[stepIndex], runId)) {
                    timedOutStages.push(`zoom-out-${stepIndex + 1}`);
                }

                if (stepIndex < totalZoomOutSteps - 1) {
                    await waitForMilliseconds(CLUSTER_DEBUG_PROBE_BETWEEN_STEP_DELAY);
                }
            }

            clusterDebugProbeModeRef.current = 'one-shot';
            setClusterDebugProbeSummary('Probe: one-shot zoom in.');
            if (!await animateClusterDebugProbeToRegion(probePlan.splitRegion, runId)) {
                timedOutStages.push('zoom-oneshot-in');
            }
            if (clusterDebugProbeRunIdRef.current !== runId) {
                return;
            }

            await waitForMilliseconds(CLUSTER_DEBUG_PROBE_BETWEEN_STEP_DELAY);
            if (clusterDebugProbeRunIdRef.current !== runId) {
                return;
            }

            setClusterDebugProbeSummary('Probe: one-shot zoom out.');
            if (!await animateClusterDebugProbeToRegion(probePlan.focusStartRegion, runId)) {
                timedOutStages.push('zoom-oneshot-out');
            }
            if (clusterDebugProbeRunIdRef.current !== runId) {
                return;
            }

            clusterDebugProbeModeRef.current = 'settle';
            setClusterDebugProbeSummary('Probe: final 150ms hold before stopping recording.');
            await waitForMilliseconds(CLUSTER_DEBUG_PROBE_RECORDING_DELAY);
            if (clusterDebugProbeRunIdRef.current !== runId) {
                return;
            }

            const {
                recordedSamples,
                recordedTransitionEvents,
            } = stopClusterDebugCapture();

            didStartCapture = false;

            if (!areRegionsEquivalent(mapRegionRef.current, probePlan.focusStartRegion)) {
                setClusterDebugProbeSummary('Probe: restoring the original map view.');
                await animateClusterDebugProbeToRegion(probePlan.focusStartRegion, runId);
            }
            if (clusterDebugProbeRunIdRef.current !== runId) {
                return;
            }
            setClusterDebugProbeSummary('Probe: waiting for split handoffs to settle.');
            await waitForClusterDebugProbeResetSettle(runId);
            if (clusterDebugProbeRunIdRef.current !== runId) {
                return;
            }

            const endClusterSignature = clustersSignatureRef.current;
            const endStationScreenSnapshot = buildProbeStationScreenSnapshot(
                stationQuotesRef.current,
                mapRegionRef.current,
                width,
                height
            );
            const resetStationInvariant = compareProbeStationScreenSnapshots(
                startStationScreenSnapshot,
                endStationScreenSnapshot
            );
            const resetSignaturesMatch = (
                startClusterSignature === endClusterSignature ||
                (
                    (resetStationInvariant?.maxPairDistanceDelta || 0) <= 0.001 &&
                    (resetStationInvariant?.meanPairDistanceDelta || 0) <= 0.001
                )
            );
            const modesCaptured = Array.from(new Set(
                recordedSamples
                    .map(sample => sample?.probeMode || 'unknown')
                    .filter(Boolean)
            ));

            const maxFrameDelta = recordedSamples.reduce((maxDelta, sample) => (
                Math.max(maxDelta, sample?.maxFrameDelta || 0)
            ), 0);
            const report = {
                status: 'completed',
                trigger,
                message: timedOutStages.length > 0
                    ? `Completed with idle timeouts in ${timedOutStages.join(', ')}.`
                    : 'Completed without timeouts.',
                clusterKey: probePlan.clusterKey,
                sampleCount: recordedSamples.length,
                transitionCount: recordedTransitionEvents.length,
                maxFrameDelta,
                timedOutStages,
                plan: probePlan,
                modesCaptured,
                resetInvariant: {
                    startClusterSignature,
                    endClusterSignature,
                    signaturesMatch: resetSignaturesMatch,
                    startStationScreenSnapshot,
                    endStationScreenSnapshot,
                    ...resetStationInvariant,
                },
            };
            const logText = buildClusterDebugProbeLog(report, recordedSamples, recordedTransitionEvents);

            await writeClusterDebugProbeArtifact({
                ...report,
                samples: recordedSamples,
                transitionEvents: recordedTransitionEvents,
                logText,
            });
            console.debug(logText);
            if (isMountedRef.current && clusterDebugProbeRunIdRef.current === runId) {
                setClusterDebugProbeSummary(buildClusterDebugProbeSummary(report));
            }
        } catch (error) {
            if (didStartCapture) {
                stopClusterDebugCapture();
                didStartCapture = false;
            }

            const message = error instanceof Error ? error.message : 'Unexpected probe failure.';
            const logText = `[ClusterDebug Probe]\nstatus=failed\ntrigger=${trigger}\nmessage=${message}`;

            await writeClusterDebugProbeArtifact({
                status: 'failed',
                trigger,
                message,
                clusterKey: probePlan.clusterKey,
                sampleCount: 0,
                transitionCount: 0,
                maxFrameDelta: 0,
                timedOutStages: [],
                plan: probePlan,
                logText,
            });
            console.debug(logText);
            if (isMountedRef.current && clusterDebugProbeRunIdRef.current === runId) {
                setClusterDebugProbeSummary(`Probe failed: ${message}`);
            }
        } finally {
            if (didStartCapture) {
                stopClusterDebugCapture();
            }

            if (trigger.startsWith('automation:')) {
                finishClusterProbeSession();
            }

            if (isMountedRef.current && clusterDebugProbeRunIdRef.current === runId) {
                setIsClusterDebugProbeRunning(false);
            }
        }
    };

    useEffect(() => {
        if (!autoClusterProbeRequested) {
            clusterDebugAutoProbeHandledKeyRef.current = '';
            clusterDebugAutoProbeSeededKeyRef.current = '';
        }
    }, [autoClusterProbeRequested]);

    useEffect(() => {
        if (
            !autoClusterProbeRequested ||
            !debugClusterAnimations ||
            isClusterDebugProbeRunning ||
            isClusterDebugRecording ||
            watchedCluster ||
            !mapRef.current ||
            isAnimatingRef.current ||
            isMapMoving
        ) {
            return;
        }

        if (clusterDebugAutoProbeSeededKeyRef.current === autoClusterProbeRequestKey) {
            return;
        }

        const seedRegion = buildClusterDebugAutomationSeedRegion(stationQuotes, mapRegion);

        if (!seedRegion) {
            setClusterDebugProbeSummary('Probe automation is waiting for enough stations to form a cluster.');
            return;
        }

        clusterDebugAutoProbeSeededKeyRef.current = autoClusterProbeRequestKey;
        setClusterDebugProbeSummary('Probe automation is preparing a cluster.');
        console.log(`[ClusterDebug Probe Automation] seeding cluster ${autoClusterProbeRequestKey}`);
        isAnimatingRef.current = true;
        setMapMotionState(true);
        mapRef.current.animateToRegion(seedRegion, CLUSTER_DEBUG_PROBE_ANIMATION_DURATION);
    }, [
        autoClusterProbeRequested,
        autoClusterProbeRequestKey,
        debugClusterAnimations,
        isClusterDebugProbeRunning,
        isClusterDebugRecording,
        watchedCluster,
        stationQuotes,
        mapRegion,
        isMapMoving,
    ]);

    useEffect(() => {
        if (
            !autoClusterProbeRequested ||
            !debugClusterAnimations ||
            isClusterDebugProbeRunning ||
            isClusterDebugRecording
        ) {
            return;
        }

        if (clusterDebugAutoProbeHandledKeyRef.current === autoClusterProbeRequestKey) {
            return;
        }

        if (!watchedCluster || !mapRef.current) {
            setClusterDebugProbeSummary('Probe automation is waiting for a cluster near the map center.');
            const waitingTrigger = autoClusterProbeRequestSource === 'file'
                ? `automation:file:${autoClusterProbeRequestKey}`
                : `automation:${autoClusterProbeRequestKey}`;

            void writeClusterDebugProbeArtifact({
                status: 'waiting',
                trigger: waitingTrigger,
                message: 'Waiting for a multi-station cluster near the map center.',
                clusterKey: watchedCluster ? buildClusterMembershipKey(watchedCluster) : '',
                sampleCount: 0,
                transitionCount: 0,
                maxFrameDelta: 0,
                timedOutStages: [],
                plan: watchedCluster ? buildClusterDebugProbePlan(watchedCluster, mapRegion, location) : null,
                logText: '',
            });
            return;
        }

        clusterDebugAutoProbeHandledKeyRef.current = autoClusterProbeRequestKey;
        clusterDebugAutoProbeSeededKeyRef.current = '';
        setClusterDebugProbeSummary(`Probe automation requested (${autoClusterProbeRequestKey}).`);

        const automationTrigger = autoClusterProbeRequestSource === 'file'
            ? `automation:file:${autoClusterProbeRequestKey}`
            : `automation:${autoClusterProbeRequestKey}`;

        console.log(`[ClusterDebug Probe Automation] starting ${automationTrigger}`);
        void handleRunClusterDebugProbe(automationTrigger);
    }, [
        autoClusterProbeRequested,
        autoClusterProbeRequestKey,
        autoClusterProbeRequestSource,
        debugClusterAnimations,
        isClusterDebugProbeRunning,
        isClusterDebugRecording,
        finishClusterProbeSession,
        watchedCluster,
    ]);

    useEffect(() => {
        if (!debugClusterAnimations) {
            clusterDebugProbeRunIdRef.current += 1;
            setIsClusterDebugRecording(false);
            setIsClusterDebugProbeRunning(false);
            setClusterDebugProbeSummary('');
            clusterDebugAutoProbeHandledKeyRef.current = '';
            lastClusterDebugSignatureRef.current = '';
            clusterDebugWatchedPrimaryIdRef.current = null;
            clusterDebugSamplesRef.current = [];
            clusterDebugTransitionEventsRef.current = [];
            clusterDebugTransitionEventKeysRef.current = new Set();
            flushMapIdleWaiters(false);
            return;
        }
    }, [debugClusterAnimations]);

    const renderClusterEntries = clusters.map(cluster => {
        const primaryStationId = cluster.quotes[0].stationId;
        return {
            key: primaryStationId,
            primaryStationId,
            cluster,
        };
    });

    const hasRenderableClusters = renderClusterEntries.length > 0;

    return (
        <View style={[styles.container, { backgroundColor: themeColors.background }]}>
            <MapView
                ref={mapRef}
                style={StyleSheet.absoluteFillObject}
                initialRegion={DEFAULT_REGION}
                provider={PROVIDER_APPLE}
                showsUserLocation={hasLocationPermission}
                userInterfaceStyle={isDark ? 'dark' : 'light'}
                onRegionChange={(region) => {
                    clearMapIdleSettleTimeout();
                    setMapMotionState(true);
                    setMapRegionIfNeeded(region);
                }}
                onRegionChangeComplete={(region) => {
                    setMapRegionIfNeeded(region);
                    isAnimatingRef.current = false;
                    clearMapIdleSettleTimeout();
                    mapIdleSettleTimeoutRef.current = setTimeout(() => {
                        mapIdleSettleTimeoutRef.current = null;
                        if (!isMountedRef.current) {
                            return;
                        }
                        setMapMotionState(false);
                        flushMapIdleWaiters(true);
                    }, CLUSTER_MAP_IDLE_SETTLE_MS);
                }}
            >
                {!hasRenderableClusters ? (
                    <Marker
                        coordinate={fallbackCoordinate}
                        title="No Prices Returned"
                        description={
                            errorMsg
                                ? 'No live station price available'
                                : isLoadingLocation
                                    ? 'Finding your location'
                                    : 'Checking fuel providers'
                        }
                        pinColor="#D46A4C"
                    />
                ) : null}
            </MapView>

            {hasRenderableClusters ? (
                <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
                    <LiquidGlassContainerView
                        pointerEvents="none"
                        spacing={24}
                        style={styles.clusterMapParentContainer}
                    >
                        {renderClusterEntries.map(entry => (
                            <ClusterMarkerOverlay
                                key={entry.key}
                                cluster={entry.cluster}
                                scrollX={scrollX}
                                itemWidth={itemWidth}
                                isDark={isDark}
                                themeColors={themeColors}
                                activeIndex={activeIndex}
                                onMarkerPress={handleMarkerPress}
                                onDebugTransitionEvent={recordClusterDebugTransitionEvent}
                                onDebugRenderFrame={recordClusterDebugRenderFrame}
                                isDebugWatched={entry.primaryStationId === activeClusterDebugPrimaryId}
                                isDebugRecording={isClusterDebugRecording}
                                mapRegion={mapRegion}
                                isMapMoving={isMapMoving}
                            />
                        ))}
                    </LiquidGlassContainerView>
                </View>
            ) : null}

            <TopCanopy edgeColor={canopyEdgeLine} height={topCanopyHeight} isDark={isDark} topInset={insets.top} />
            <BottomCanopy height={bottomPadding + 140} isDark={isDark} />

            <View
                style={[
                    styles.reloadButtonShell,
                    {
                        top: insets.top + 6,
                        left: horizontalPadding.left,
                    },
                ]}
            >
                <Pressable
                    disabled={isRefreshingPrices || isLoadingLocation}
                    onPress={() =>
                        void refreshForCurrentView({
                            preferCached: false,
                        })
                    }
                >
                    <GlassView
                        style={[
                            styles.reloadButton,
                            isRefreshingPrices || isLoadingLocation ? styles.reloadButtonDisabled : null,
                        ]}
                        tintColor={isDark ? '#000000' : '#FFFFFF'}
                        glassEffectStyle="clear"
                        key={isDark ? 'reload-dark' : 'reload-light'}
                    >
                        <Ionicons color={themeColors.text} name="refresh" size={16} />
                        <Text style={[styles.reloadButtonText, { color: themeColors.text }]}>Reload</Text>
                    </GlassView>
                </Pressable>
            </View>

            <View
                pointerEvents="none"
                style={[
                    styles.topHeader,
                    {
                        paddingTop: insets.top + 10,
                        paddingLeft: horizontalPadding.left,
                        paddingRight: horizontalPadding.right,
                    },
                ]}
            >
                <Text style={[styles.headerTitle, { color: themeColors.text }]}>Fuel Up</Text>
            </View>

            <View
                style={[
                    styles.contentOverlay,
                    {
                        bottom: bottomPadding,
                        justifyContent: 'center',
                        alignItems: 'center',
                    },
                ]}
            >
                {USE_SHEET_UX ? (
                    <Pressable
                        onPress={() => {
                            router.push({
                                pathname: '/prices-sheet',
                                params: {
                                    quotesData: stationQuotes.length > 0 ? JSON.stringify(stationQuotes) : JSON.stringify([bestQuote].filter(Boolean)),
                                    benchmarkData: benchmarkQuote ? JSON.stringify(benchmarkQuote) : null,
                                    errorMsg: errorMsg || '',
                                },
                            });
                        }}
                        style={{ width: itemWidth }}
                    >
                        <GlassView
                            tintColor={isDark ? '#000000' : '#FFFFFF'}
                            glassEffectStyle="clear"
                            style={styles.sheetTriggerButton}
                        >
                            <Text style={[styles.sheetTriggerText, { color: themeColors.text }]}>
                                {stationQuotes.length > 0 ? `View ${stationQuotes.length} Nearby Stations` : 'View Gas Stations'}
                            </Text>
                            <Ionicons name="chevron-up" size={20} color={themeColors.text} />
                        </GlassView>
                    </Pressable>
                ) : debugClusterAnimations ? (
                    <View style={{ width: width, paddingHorizontal: sideInset }}>
                        <ClusterDebugCard
                            cluster={watchedCluster}
                            diagnostic={watchedClusterDiagnostic}
                            isDark={isDark}
                            isRecording={isClusterDebugRecording}
                            isProbeRunning={isClusterDebugProbeRunning}
                            onStartRecording={handleStartClusterDebugRecording}
                            onStopRecording={handleStopClusterDebugRecording}
                            onRunProbe={() => {
                                void handleRunClusterDebugProbe();
                            }}
                            probeSummary={clusterDebugProbeSummary}
                            themeColors={themeColors}
                        />
                    </View>
                ) : stationQuotes.length > 0 ? (
                    <Animated.FlatList
                        ref={flatListRef}
                        data={stationQuotes}
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        decelerationRate="fast"
                        keyExtractor={(item, index) => item.stationId || index.toString()}
                        contentContainerStyle={{
                            paddingHorizontal: sideInset,
                            alignItems: 'center', // Fix bottom padding mismatch 
                        }}
                        snapToInterval={itemWidth} // Precise snapping prevents jitter
                        snapToAlignment="start"
                        disableIntervalMomentum={true}
                        onViewableItemsChanged={onViewableItemsChanged}
                        viewabilityConfig={viewabilityConfig}
                        onScrollBeginDrag={() => { isUserScrollingRef.current = true; }}
                        onScroll={scrollHandler}
                        scrollEventThrottle={16}
                        renderItem={({ item, index }) => (
                            <AnimatedCardItem
                                item={item}
                                index={index}
                                scrollX={scrollX}
                                itemWidth={itemWidth}
                                isDark={isDark}
                                benchmarkQuote={benchmarkQuote}
                                errorMsg={errorMsg}
                                isRefreshing={isRefreshingPrices || isLoadingLocation}
                                themeColors={themeColors}
                            />
                        )}
                    />
                ) : (
                    <View style={{ width: width, paddingHorizontal: sideInset }}>
                        <FuelSummaryCard
                            benchmarkQuote={benchmarkQuote}
                            errorMsg={errorMsg}
                            isDark={isDark}
                            isRefreshing={isRefreshingPrices || isLoadingLocation}
                            quote={bestQuote}
                            themeColors={themeColors}
                        />
                    </View>
                )}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    topHeader: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        alignItems: 'center',
    },
    headerTitle: {
        fontSize: 24,
        fontWeight: '700',
        marginBottom: 10,
    },
    contentOverlay: {
        position: 'absolute',
        width: '100%',
        alignItems: 'center',
    },
    clusterMapParentContainer: {
        ...StyleSheet.absoluteFillObject,
        overflow: 'visible',
        justifyContent: 'center',
        alignItems: 'center',
    },
    sheetTriggerButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 18,
        paddingHorizontal: 24,
        borderRadius: 24,
        gap: 8,
    },
    sheetTriggerText: {
        fontSize: 17,
        fontWeight: '700',
    },
    reloadButtonShell: {
        position: 'absolute',
        zIndex: 2,
    },
    reloadButton: {
        minHeight: 42,
        paddingHorizontal: 14,
        borderRadius: 21,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    reloadButtonDisabled: {
        opacity: 0.72,
    },
    reloadButtonText: {
        fontSize: 14,
        fontWeight: '600',
    },
    priceOverlay: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 16,
        gap: 6,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: 'rgba(150, 150, 150, 0.4)',
        overflow: 'hidden',
    },
    clusterContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 16,
    },
    bubbleBase: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 16,
        gap: 6,
    },
    primaryBubbleShell: {
        minWidth: 84,
        justifyContent: 'center',
    },
    bubblePositioner: {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        justifyContent: 'center',
        alignItems: 'center',
    },
    rowItem: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    bubbleContentRow: {
        justifyContent: 'center',
    },
    bubbleFillRow: {
        justifyContent: 'center',
        left: 0,
        right: 0,
    },
    priceText: {
        fontSize: 15,
        fontWeight: '700',
    },
    bestPriceText: {
        fontWeight: '900',
    },
    priceIcon: {
        marginRight: 2,
    },
});
