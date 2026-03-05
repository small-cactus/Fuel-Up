import React, { startTransition, useEffect, useLayoutEffect, useRef, useState, useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import {
    LiquidGlassView,
    LiquidGlassContainerView,
    isLiquidGlassSupported
} from '@callstack/liquid-glass';
import { SymbolView } from 'expo-symbols';
import { GlassView } from 'expo-glass-effect';
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
import Animated, {
    useSharedValue,
    useAnimatedScrollHandler,
    useAnimatedStyle,
    useAnimatedReaction,
    useAnimatedProps,
    interpolate,
    Extrapolate,
    interpolateColor,
    FadeIn,
    FadeOut,
    ZoomIn,
    ZoomOut,
    Easing,
    withTiming,
    runOnJS
} from 'react-native-reanimated';

const AnimatedLiquidGlassView = Animated.createAnimatedComponent(LiquidGlassView);
const AnimatedLiquidGlassContainer = Animated.createAnimatedComponent(LiquidGlassContainerView);
const {
    CLUSTER_MERGE_LAT_FACTOR,
    CLUSTER_MERGE_LNG_FACTOR,
    CLUSTER_SPLIT_MULTIPLIER,
    CLUSTER_SPREAD_DEADZONE,
    COLLAPSED_PRIMARY_WIDTH,
    COLLAPSED_SECONDARY_WIDTH,
    COLLAPSED_BUBBLE_OFFSET,
    computeClusterHandoffDiagnostic,
    computeMorphProgress,
    computeSpreadProgressFromCluster,
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
const CLUSTER_LIVE_MIN_DURATION = 5000;
const CLUSTER_GEOMETRY_ANIMATION_DURATION = 5000;
const CLUSTER_SPLIT_MIN_DURATION = 420;
const CLUSTER_SPLIT_MILLISECONDS_PER_POINT = 55;
const CLUSTER_SPLIT_MAX_DURATION = 2800;
const CLUSTER_SPLIT_REENTRY_COOLDOWN_MS = 2000;
const CLUSTER_SPLIT_KICKOFF_DELAY_MS = 260;
const ENABLE_CLUSTER_SPLIT_HANDOFF = true;
const ENABLE_CLUSTER_REMAINDER_BUBBLE = true;
const CLUSTER_DEBUG_PROBE_ANIMATION_DURATION = 650;
const CLUSTER_DEBUG_PROBE_IDLE_TIMEOUT = 2400;
const CLUSTER_DEBUG_PROBE_SETTLE_DURATION = 180;
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

function computeSplitStageDuration(segments) {
    const maxDistance = (segments || []).reduce((currentMax, segment) => {
        if (!segment) {
            return currentMax;
        }

        const distance = Math.hypot(
            (segment.endX || 0) - (segment.startX || 0),
            (segment.endY || 0) - (segment.startY || 0)
        );

        return Math.max(currentMax, distance);
    }, 0);

    return Math.max(
        CLUSTER_SPLIT_MIN_DURATION,
        Math.min(
            CLUSTER_SPLIT_MAX_DURATION,
            Math.round(maxDistance * CLUSTER_SPLIT_MILLISECONDS_PER_POINT)
        )
    );
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

function buildClusterMembershipKey(cluster) {
    if (!cluster?.quotes?.length) {
        return '';
    }

    return cluster.quotes.map(quote => quote.stationId).join(',');
}

function getDetachedStationIdsForSplit(fromCluster, toCluster) {
    if (!fromCluster?.quotes?.length || !toCluster?.quotes?.length) {
        return [];
    }

    const primaryStationId = fromCluster.quotes[0].stationId;
    const nextStationIds = new Set(toCluster.quotes.map(quote => quote.stationId));

    return fromCluster.quotes
        .filter(quote => quote.stationId !== primaryStationId)
        .filter(quote => !nextStationIds.has(quote.stationId))
        .map(quote => quote.stationId);
}

function pickAnchoredSecondaryQuote(anchoredQuotes, preferredStationId = null) {
    const secondaryQuotes = anchoredQuotes.slice(1);

    if (secondaryQuotes.length === 0) {
        return null;
    }

    if (preferredStationId) {
        const preferredQuote = secondaryQuotes.find(quote => quote.stationId === preferredStationId);

        if (preferredQuote) {
            return preferredQuote;
        }
    }

    return secondaryQuotes.reduce((farthestQuote, quote) => (
        quote.distanceFromPrimary > farthestQuote.distanceFromPrimary ? quote : farthestQuote
    ), secondaryQuotes[0]);
}

function buildHeldSplitRecordSignature(record) {
    if (!record) {
        return '';
    }

    return [
        record.primaryStationId,
        buildClusterMembershipKey(record.fromCluster),
        buildClusterMembershipKey(record.toCluster),
        buildClusterMembershipKey(record.queuedToCluster),
        record.bridgeComplete ? '1' : '0',
    ].join('|');
}

function areHeldSplitRecordsEquivalent(currentRecords, nextRecords) {
    if (currentRecords === nextRecords) {
        return true;
    }

    if (!Array.isArray(currentRecords) || !Array.isArray(nextRecords)) {
        return false;
    }

    if (currentRecords.length !== nextRecords.length) {
        return false;
    }

    return currentRecords.every((record, index) => (
        buildHeldSplitRecordSignature(record) === buildHeldSplitRecordSignature(nextRecords[index])
    ));
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

    if (isVisible('breakout')) {
        layers.push('breakout');
    }
    if (isVisible('remainder')) {
        layers.push('remainder');
    }
    if (isVisible('carry')) {
        layers.push('carry');
    }
    if (isVisible('bridge')) {
        layers.push('bridge');
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

            switch (event.type) {
                case 'split-held-created':
                    return (
                        `${prefix} primary=${event.primaryStationId} ` +
                        `from=[${event.fromClusterKey}] to=[${event.toClusterKey}] detached=[${event.detachedStationIds.join(', ') || 'none'}]`
                    );
                case 'split-queued-update':
                    return (
                        `${prefix} primary=${event.primaryStationId} ` +
                        `active=[${event.activeToClusterKey}] queued=[${event.queuedToClusterKey}]`
                    );
                case 'split-stage-advance':
                    return (
                        `${prefix} primary=${event.primaryStationId} ` +
                        `from=[${event.fromClusterKey}] to=[${event.toClusterKey}] detached=[${event.detachedStationIds.join(', ') || 'none'}]`
                    );
                case 'split-bridge-start':
                    return (
                        `${prefix} primary=${event.primaryStationId} ` +
                        `from=[${event.fromClusterKey}] to=[${event.toClusterKey}] ` +
                        `bridgeQuote=${event.bridgeQuoteStationId} start=${formatDebugPoint(event.startX, event.startY)} ` +
                        `target=${formatDebugPoint(event.targetX, event.targetY)} ` +
                        `shell=${event.shellMode || 'animated'} ` +
                        `spread ${formatDebugMetric(event.fromSpread)} -> ${formatDebugMetric(event.toSpread)} ` +
                        `morph ${formatDebugMetric(event.fromMorph)} -> ${formatDebugMetric(event.toMorph)}`
                    );
                case 'split-bridge-path-complete':
                    return (
                        `${prefix} primary=${event.primaryStationId} ` +
                        `transition=[${event.transitionKey}]`
                    );
                case 'split-stage-ready':
                    return (
                        `${prefix} primary=${event.primaryStationId} ` +
                        `transition=[${event.transitionKey}] mapMoving=${event.mapMoving ? 'yes' : 'no'}`
                    );
                case 'split-bridge-complete':
                    return (
                        `${prefix} primary=${event.primaryStationId} ` +
                        `transition=[${event.transitionKey}] mapMoving=${event.mapMoving ? 'yes' : 'no'}`
                    );
                case 'split-handoff-cleared':
                    return (
                        `${prefix} primary=${event.primaryStationId} ` +
                        `transition=[${event.transitionKey}] mapIdle=yes`
                    );
                case 'merge-start':
                    return (
                        `${prefix} primary=${event.primaryStationId} ` +
                        `from=[${event.fromClusterKey}] to=[${event.toClusterKey}] ` +
                        `spread ${formatDebugMetric(event.fromSpread)} -> ${formatDebugMetric(event.toSpread)} ` +
                        `morph ${formatDebugMetric(event.fromMorph)} -> ${formatDebugMetric(event.toMorph)}`
                    );
                default:
                    return `${prefix} ${event.label || ''}`.trim();
            }
        }),
    ];
}

function buildClusterDebugJumpEvents(samples) {
    const trackedMetrics = [
        ['breakoutFrameDelta', 'move(breakout)'],
        ['remainderFrameDelta', 'move(remainder)'],
        ['carryFrameDelta', 'move(carry)'],
        ['bridgeFrameDelta', 'move(bridge)'],
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
    const breakoutMoveSeries = summarizeDebugSeries(samples, 'breakoutFrameDelta');
    const remainderMoveSeries = summarizeDebugSeries(samples, 'remainderFrameDelta');
    const carryMoveSeries = summarizeDebugSeries(samples, 'carryFrameDelta');
    const bridgeMoveSeries = summarizeDebugSeries(samples, 'bridgeFrameDelta');
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
        formatSeriesLine('move(breakout)', breakoutMoveSeries, 'pt'),
        formatSeriesLine('move(remainder)', remainderMoveSeries, 'pt'),
        formatSeriesLine('move(carry)', carryMoveSeries, 'pt'),
        formatSeriesLine('move(bridge)', bridgeMoveSeries, 'pt'),
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

function AnimatedMarkerOverlay({
    cluster,
    pendingCluster = null,
    scrollX,
    itemWidth,
    isDark,
    themeColors,
    activeIndex,
    onMarkerPress,
    onPendingClusterBridgeComplete,
    onDebugTransitionEvent,
    onDebugRenderFrame,
    isDebugWatched = false,
    isDebugRecording = false,
    runtimePhase = 'live',
    mapRegion,
}) {
    const { quotes, averageLat, averageLng } = cluster;

    // A cluster is considered active if any of its station indices matches the activeIndex
    const isActive = quotes.some(q => q.originalIndex === activeIndex);
    const isCheapestAcrossAll = quotes.some(q => q.originalIndex === 0);

    const animatedOverlayStyle = useAnimatedStyle(() => {
        return {};
    });

    const animatedTextStyle = useAnimatedStyle(() => {
        if (isCheapestAcrossAll) return { color: '#007AFF' };
        const baseIndex = quotes[0].originalIndex;
        const inputRange = [(baseIndex - 1) * itemWidth, baseIndex * itemWidth, (baseIndex + 1) * itemWidth];
        const color = interpolateColor(
            scrollX.value,
            inputRange,
            ['#888888', themeColors.text, '#888888']
        );
        return { color };
    });

    // Determine what to render inside the chip
    const primaryQuote = quotes[0];
    const isMultiQuote = quotes.length > 1;

    const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
    const resolvedSpread = isMultiQuote
        ? computeSpreadProgressFromCluster({
            quotes,
            averageLat,
            averageLng,
            mapRegion,
        })
        : 0;
    const resolvedMorph = computeMorphProgress(resolvedSpread);
    const pendingResolvedSpread = pendingCluster?.quotes?.length > 1
        ? computeSpreadProgressFromCluster({
            quotes: pendingCluster.quotes,
            averageLat: pendingCluster.averageLat,
            averageLng: pendingCluster.averageLng,
            mapRegion,
        })
        : 0;
    const pendingResolvedMorph = computeMorphProgress(pendingResolvedSpread);
    const currentPendingSignature = pendingCluster
        ? `${buildClusterMembershipKey(cluster)}->${buildClusterMembershipKey(pendingCluster)}`
        : null;
    const fromClusterKey = buildClusterMembershipKey(cluster);
    const toClusterKey = pendingCluster ? buildClusterMembershipKey(pendingCluster) : '';
    const renderedClusterKey = toClusterKey || fromClusterKey;

    // Content fade-in animation
    const mountAnim = useSharedValue(0);
    // Animate relative bubble positions for "merging" effect
    const spreadAnim = useSharedValue(resolvedSpread);
    // Animate visual properties (Price vs +N styling) independently
    const morphAnim = useSharedValue(resolvedMorph);
    const splitBridgeProgress = useSharedValue(1);
    const splitBridgeMorph = useSharedValue(1);
    const splitCarryMorph = useSharedValue(resolvedMorph);
    const [splitBridge, setSplitBridge] = useState(null);
    const [splitCarry, setSplitCarry] = useState(null);
    const previousQuotesRef = useRef(quotes);
    const preferredBreakoutStationIdRef = useRef(null);
    const splitBridgeSignatureRef = useRef(null);
    const splitStageTokenRef = useRef('');
    const splitStageReadyTokenRef = useRef(null);
    const splitStagePathCompleteRef = useRef(false);
    const splitStageShellCompleteRef = useRef(false);
    const splitBridgePathTimeoutRef = useRef(null);
    const splitShellTimeoutRef = useRef(null);
    const splitAnimationKickoffTimeoutRef = useRef(null);
    const activeSplitBridgeSignatureRef = useRef('');
    const splitCarryForwardRef = useRef(null);
    const activeSplitBridge = splitBridge?.transitionKey === currentPendingSignature
        ? splitBridge
        : null;
    const activeSplitCarry = splitCarry?.transitionKey === currentPendingSignature
        ? splitCarry
        : null;
    activeSplitBridgeSignatureRef.current = activeSplitBridge?.transitionKey || '';

    const ptPerLng = mapRegion?.longitudeDelta ? SCREEN_WIDTH / mapRegion.longitudeDelta : 0;
    const ptPerLat = mapRegion?.latitudeDelta ? SCREEN_HEIGHT / mapRegion.latitudeDelta : 0;
    const primaryLat = primaryQuote.latitude;
    const primaryLng = primaryQuote.longitude;
    const anchoredQuotes = quotes.map(quote => {
        const dx = (quote.longitude - primaryLng) * ptPerLng;
        const dy = -(quote.latitude - primaryLat) * ptPerLat;
        return {
            ...quote,
            dx,
            dy,
            distanceFromPrimary: Math.hypot(dx, dy),
        };
    });
    const liveSplitBridgeTargetX = activeSplitBridge?.endX ?? 0;
    const liveSplitBridgeTargetY = activeSplitBridge?.endY ?? 0;
    const splitBridgeHorizontalReach = activeSplitBridge
        ? Math.max(Math.abs(activeSplitBridge.startX), Math.abs(liveSplitBridgeTargetX))
        : 0;
    const splitBridgeVerticalReach = activeSplitBridge
        ? Math.max(Math.abs(activeSplitBridge.startY), Math.abs(liveSplitBridgeTargetY))
        : 0;
    const emergingAnchoredQuote = pickAnchoredSecondaryQuote(
        anchoredQuotes,
        preferredBreakoutStationIdRef.current
    );
    const nextClusterQuotes = pendingCluster?.quotes || (
        emergingAnchoredQuote
            ? [primaryQuote, ...quotes.slice(1).filter(quote => quote.stationId !== emergingAnchoredQuote.stationId)]
            : [primaryQuote]
    );
    const hasRemainderBubble = nextClusterQuotes.length > 1;
    const nextClusterAnchoredQuotes = nextClusterQuotes.map(quote => {
        const dx = (quote.longitude - primaryLng) * ptPerLng;
        const dy = -(quote.latitude - primaryLat) * ptPerLat;
        return {
            ...quote,
            dx,
            dy,
            distanceFromPrimary: Math.hypot(dx, dy),
        };
    });
    const nextClusterEmergingQuote = nextClusterAnchoredQuotes.length > 1
        ? nextClusterAnchoredQuotes.slice(1).reduce((farthestQuote, quote) => (
            quote.distanceFromPrimary > farthestQuote.distanceFromPrimary ? quote : farthestQuote
        ), nextClusterAnchoredQuotes[1])
        : null;
    const breakoutProjectedTargetX = emergingAnchoredQuote?.dx ?? COLLAPSED_BUBBLE_OFFSET;
    const breakoutProjectedTargetY = emergingAnchoredQuote?.dy ?? 0;
    const nextEmergingProjectedTargetX = nextClusterEmergingQuote?.dx ?? COLLAPSED_BUBBLE_OFFSET;
    const nextEmergingProjectedTargetY = nextClusterEmergingQuote?.dy ?? 0;
    const breakoutTargetXAnim = useSharedValue(breakoutProjectedTargetX);
    const breakoutTargetYAnim = useSharedValue(breakoutProjectedTargetY);
    const nextEmergingTargetXAnim = useSharedValue(nextEmergingProjectedTargetX);
    const nextEmergingTargetYAnim = useSharedValue(nextEmergingProjectedTargetY);
    const pendingStaticSecondaryX = nextClusterEmergingQuote
        ? interpolate(pendingResolvedSpread, [0, 1], [COLLAPSED_BUBBLE_OFFSET, nextEmergingProjectedTargetX])
        : COLLAPSED_BUBBLE_OFFSET;
    const pendingStaticSecondaryY = nextClusterEmergingQuote
        ? interpolate(pendingResolvedSpread, [0, 1], [0, nextEmergingProjectedTargetY])
        : 0;
    const horizontalReach = Math.max(
        COLLAPSED_BUBBLE_OFFSET,
        splitBridgeHorizontalReach,
        ...anchoredQuotes.map(quote => Math.abs(quote.dx)),
        ...nextClusterAnchoredQuotes.map(quote => Math.abs(quote.dx))
    );
    const verticalReach = Math.max(
        0,
        splitBridgeVerticalReach,
        ...anchoredQuotes.map(quote => Math.abs(quote.dy)),
        ...nextClusterAnchoredQuotes.map(quote => Math.abs(quote.dy))
    );
    const containerWidth = Math.max(240, 48 + COLLAPSED_PRIMARY_WIDTH + horizontalReach * 2);
    const containerHeight = Math.max(80, 52 + verticalReach * 2);

    useEffect(() => {
        breakoutTargetXAnim.value = withTiming(breakoutProjectedTargetX, {
            duration: CLUSTER_GEOMETRY_ANIMATION_DURATION,
            easing: Easing.linear,
        });
        breakoutTargetYAnim.value = withTiming(breakoutProjectedTargetY, {
            duration: CLUSTER_GEOMETRY_ANIMATION_DURATION,
            easing: Easing.linear,
        });
        nextEmergingTargetXAnim.value = withTiming(nextEmergingProjectedTargetX, {
            duration: CLUSTER_GEOMETRY_ANIMATION_DURATION,
            easing: Easing.linear,
        });
        nextEmergingTargetYAnim.value = withTiming(nextEmergingProjectedTargetY, {
            duration: CLUSTER_GEOMETRY_ANIMATION_DURATION,
            easing: Easing.linear,
        });
    }, [
        breakoutProjectedTargetX,
        breakoutProjectedTargetY,
        nextEmergingProjectedTargetX,
        nextEmergingProjectedTargetY,
    ]);

    useEffect(() => {
        // Fade in content
        mountAnim.value = withTiming(1, { duration: 400 });

        return () => {
            if (splitBridgePathTimeoutRef.current) {
                clearTimeout(splitBridgePathTimeoutRef.current);
                splitBridgePathTimeoutRef.current = null;
            }
            if (splitShellTimeoutRef.current) {
                clearTimeout(splitShellTimeoutRef.current);
                splitShellTimeoutRef.current = null;
            }
            if (splitAnimationKickoffTimeoutRef.current) {
                clearTimeout(splitAnimationKickoffTimeoutRef.current);
                splitAnimationKickoffTimeoutRef.current = null;
            }
            setSplitCarry(null);
        };
    }, []);

    const maybeCompleteSplitStage = (stageToken, transitionKey) => {
        if (!onPendingClusterBridgeComplete) {
            return;
        }

        if (
            splitStageTokenRef.current !== stageToken ||
            splitStageReadyTokenRef.current === stageToken ||
            !splitStagePathCompleteRef.current ||
            !splitStageShellCompleteRef.current
        ) {
            return;
        }

        splitStageReadyTokenRef.current = stageToken;
        onPendingClusterBridgeComplete(
            primaryQuote.stationId,
            transitionKey
        );
    };

    const handleSplitBridgePathComplete = (stageToken, transitionKey) => {
        if (splitStageTokenRef.current !== stageToken) {
            return;
        }

        splitStagePathCompleteRef.current = true;
        onDebugTransitionEvent?.({
            type: 'split-bridge-path-complete',
            primaryStationId: primaryQuote.stationId,
            transitionKey,
        });
        maybeCompleteSplitStage(stageToken, transitionKey);
    };

    const clearSplitStageTimeouts = () => {
        if (splitBridgePathTimeoutRef.current) {
            clearTimeout(splitBridgePathTimeoutRef.current);
            splitBridgePathTimeoutRef.current = null;
        }
        if (splitShellTimeoutRef.current) {
            clearTimeout(splitShellTimeoutRef.current);
            splitShellTimeoutRef.current = null;
        }
        if (splitAnimationKickoffTimeoutRef.current) {
            clearTimeout(splitAnimationKickoffTimeoutRef.current);
            splitAnimationKickoffTimeoutRef.current = null;
        }
    };

    useLayoutEffect(() => {
        if (pendingCluster) {
            const pendingQuotes = pendingCluster.quotes;
            const currentClusterKey = buildClusterMembershipKey(cluster);
            const pendingClusterKey = buildClusterMembershipKey(pendingCluster);
            const carriedShellState = splitCarryForwardRef.current?.clusterKey === currentClusterKey
                ? splitCarryForwardRef.current
                : null;
            const canReuseCarriedShellState = Boolean(
                carriedShellState &&
                Number.isFinite(carriedShellState.spread) &&
                Number.isFinite(carriedShellState.morph) &&
                Math.abs(carriedShellState.spread - spreadAnim.value) <= 0.05 &&
                Math.abs(carriedShellState.morph - morphAnim.value) <= 0.05
            );
            const splitBridgeSignature = `${quotes.map(quote => quote.stationId).join(',')}->${pendingQuotes.map(quote => quote.stationId).join(',')}`;
            const isNewPendingTransition = splitBridgeSignatureRef.current !== splitBridgeSignature;

            if (isNewPendingTransition) {
                splitBridgeSignatureRef.current = splitBridgeSignature;
                splitStageTokenRef.current = splitBridgeSignature;
                splitStageReadyTokenRef.current = null;
                splitStagePathCompleteRef.current = false;
                splitStageShellCompleteRef.current = true;
                clearSplitStageTimeouts();
                const currentSpreadValue = canReuseCarriedShellState
                    ? carriedShellState.spread
                    : spreadAnim.value;
                const currentMorphValue = canReuseCarriedShellState
                    ? carriedShellState.morph
                    : morphAnim.value;
                let splitStageDuration = CLUSTER_LIVE_MIN_DURATION;

                const bridgePrimary = quotes[0];
                const bridgeAnchoredQuotes = quotes.map(quote => {
                    const dx = (quote.longitude - bridgePrimary.longitude) * ptPerLng;
                    const dy = -(quote.latitude - bridgePrimary.latitude) * ptPerLat;
                    return {
                        ...quote,
                        dx,
                        dy,
                        distanceFromPrimary: Math.hypot(dx, dy),
                    };
                });
                const bridgeSecondaryQuotes = bridgeAnchoredQuotes.slice(1);
                const bridgeStartQuote = pickAnchoredSecondaryQuote(
                    bridgeAnchoredQuotes,
                    preferredBreakoutStationIdRef.current
                );
                const pendingStationIds = new Set(pendingQuotes.map(quote => quote.stationId));
                const detachedBridgeQuote = bridgeSecondaryQuotes.find(quote => !pendingStationIds.has(quote.stationId)) || bridgeStartQuote;

                if (bridgeStartQuote && detachedBridgeQuote) {
                    const resolvedBridgeStartX = interpolate(
                        currentSpreadValue,
                        [0, 1],
                        [COLLAPSED_BUBBLE_OFFSET, breakoutTargetXAnim.value]
                    );
                    const resolvedBridgeStartY = interpolate(
                        currentSpreadValue,
                        [0, 1],
                        [0, breakoutTargetYAnim.value]
                    );
                    const bridgeStartX = resolvedBridgeStartX;
                    const bridgeStartY = resolvedBridgeStartY;
                    const bridgeTargetX = (detachedBridgeQuote.longitude - primaryQuote.longitude) * ptPerLng;
                    const bridgeTargetY = -(detachedBridgeQuote.latitude - primaryQuote.latitude) * ptPerLat;
                    const carryTargetX = pendingStaticSecondaryX;
                    const carryTargetY = pendingStaticSecondaryY;
                    splitStageDuration = computeSplitStageDuration([
                        {
                            startX: bridgeStartX,
                            startY: bridgeStartY,
                            endX: bridgeTargetX,
                            endY: bridgeTargetY,
                        },
                        pendingQuotes.length > 1 && nextClusterEmergingQuote
                            ? {
                                startX: bridgeStartX,
                                startY: bridgeStartY,
                                endX: carryTargetX,
                                endY: carryTargetY,
                            }
                            : null,
                    ]);

                    setSplitBridge({
                        transitionKey: splitBridgeSignature,
                        plusCount: Math.max(0, quotes.length - 1),
                        emergingQuote: detachedBridgeQuote,
                        startX: bridgeStartX,
                        startY: bridgeStartY,
                        endX: bridgeTargetX,
                        endY: bridgeTargetY,
                    });
                    splitBridgeProgress.value = 0;
                    splitBridgeMorph.value = currentMorphValue;
                    splitCarryMorph.value = currentMorphValue;

                    let activeBridgeObservedAt = null;
                    const kickoffSplitStageAnimation = () => {
                        splitAnimationKickoffTimeoutRef.current = null;

                        if (splitStageTokenRef.current !== splitBridgeSignature) {
                            return;
                        }
                        if (activeSplitBridgeSignatureRef.current !== splitBridgeSignature) {
                            activeBridgeObservedAt = null;
                            splitAnimationKickoffTimeoutRef.current = setTimeout(
                                kickoffSplitStageAnimation,
                                16
                            );
                            return;
                        }
                        if (!activeBridgeObservedAt) {
                            activeBridgeObservedAt = Date.now();
                            splitAnimationKickoffTimeoutRef.current = setTimeout(
                                kickoffSplitStageAnimation,
                                16
                            );
                            return;
                        }
                        if ((Date.now() - activeBridgeObservedAt) < 140) {
                            splitAnimationKickoffTimeoutRef.current = setTimeout(
                                kickoffSplitStageAnimation,
                                16
                            );
                            return;
                        }

                        splitBridgeProgress.value = withTiming(1, {
                            duration: splitStageDuration,
                            easing: Easing.linear,
                        });
                        splitBridgeMorph.value = withTiming(1, {
                            duration: splitStageDuration,
                            easing: Easing.linear,
                        });
                        splitBridgePathTimeoutRef.current = setTimeout(() => {
                            splitBridgePathTimeoutRef.current = null;
                            handleSplitBridgePathComplete(
                                splitBridgeSignature,
                                splitBridgeSignature
                            );
                        }, splitStageDuration);

                        spreadAnim.value = withTiming(pendingResolvedSpread, {
                            duration: splitStageDuration,
                            easing: Easing.linear,
                        });
                        morphAnim.value = withTiming(pendingResolvedMorph, {
                            duration: splitStageDuration,
                            easing: Easing.linear,
                        });

                        if (pendingQuotes.length > 1 && nextClusterEmergingQuote) {
                            splitCarryMorph.value = withTiming(pendingResolvedMorph, {
                                duration: splitStageDuration,
                                easing: Easing.linear,
                            });
                            splitStageShellCompleteRef.current = false;
                            splitShellTimeoutRef.current = setTimeout(() => {
                                splitShellTimeoutRef.current = null;
                                splitStageShellCompleteRef.current = true;
                                maybeCompleteSplitStage(
                                    splitBridgeSignature,
                                    splitBridgeSignature
                                );
                            }, splitStageDuration);
                        } else {
                            splitStageShellCompleteRef.current = true;
                        }
                    };
                    // Keep bridge/carry pinned at start long enough to guarantee a sampled handoff frame.
                    splitAnimationKickoffTimeoutRef.current = setTimeout(
                        kickoffSplitStageAnimation,
                        CLUSTER_SPLIT_KICKOFF_DELAY_MS
                    );

                    if (pendingQuotes.length > 1 && nextClusterEmergingQuote) {
                        setSplitCarry({
                            transitionKey: splitBridgeSignature,
                            plusCount: Math.max(0, pendingQuotes.length - 1),
                            emergingQuote: nextClusterEmergingQuote,
                            startX: bridgeStartX,
                            startY: bridgeStartY,
                            endX: carryTargetX,
                            endY: carryTargetY,
                        });
                    } else {
                        setSplitCarry(null);
                        splitStageShellCompleteRef.current = true;
                    }
                    onDebugTransitionEvent?.({
                        type: 'split-bridge-start',
                        primaryStationId: primaryQuote.stationId,
                        fromClusterKey: buildClusterMembershipKey(cluster),
                        toClusterKey: buildClusterMembershipKey(pendingCluster),
                        bridgeQuoteStationId: detachedBridgeQuote.stationId,
                        startX: bridgeStartX,
                        startY: bridgeStartY,
                        targetX: bridgeTargetX,
                        targetY: bridgeTargetY,
                        shellMode: pendingQuotes.length > 1 && nextClusterEmergingQuote ? 'carry-animated' : 'static-target',
                        fromSpread: currentSpreadValue,
                        toSpread: pendingResolvedSpread,
                        fromMorph: currentMorphValue,
                        toMorph: pendingResolvedMorph,
                    });
                } else if (onPendingClusterBridgeComplete) {
                    setSplitBridge(null);
                    setSplitCarry(null);
                    splitStagePathCompleteRef.current = true;
                    splitStageShellCompleteRef.current = true;
                }

                // Keep shell movement continuous across split stage boundaries.
                spreadAnim.value = currentSpreadValue;
                morphAnim.value = currentMorphValue;
                if (!bridgeStartQuote || !detachedBridgeQuote) {
                    spreadAnim.value = withTiming(pendingResolvedSpread, {
                        duration: splitStageDuration,
                        easing: Easing.linear,
                    });
                    morphAnim.value = withTiming(pendingResolvedMorph, {
                        duration: splitStageDuration,
                        easing: Easing.linear,
                    });
                }
            }

            splitCarryForwardRef.current = pendingQuotes.length > 1 && nextClusterEmergingQuote
                ? {
                    clusterKey: pendingClusterKey,
                    secondaryX: pendingStaticSecondaryX,
                    secondaryY: pendingStaticSecondaryY,
                    spread: pendingResolvedSpread,
                    morph: pendingResolvedMorph,
                }
                : null;

            maybeCompleteSplitStage(splitBridgeSignature, splitBridgeSignature);

            return;
        }

        clearSplitStageTimeouts();
        splitBridgeSignatureRef.current = null;
        splitStageTokenRef.current = '';
        splitStageReadyTokenRef.current = null;
        splitStagePathCompleteRef.current = false;
        splitStageShellCompleteRef.current = false;
        if (splitBridge) {
            setSplitBridge(null);
        }
        if (splitCarry) {
            setSplitCarry(null);
        }
        splitCarryForwardRef.current = null;

        const previousQuotes = previousQuotesRef.current;
        const previousPrimaryStationId = previousQuotes?.[0]?.stationId;
        const currentPrimaryStationId = quotes?.[0]?.stationId;
        const isSamePrimary = previousPrimaryStationId && previousPrimaryStationId === currentPrimaryStationId;
        const isConnectionTransition =
            isSamePrimary &&
            previousQuotes.length < quotes.length &&
            quotes.length > 1;
        const previousAnchoredQuotes = previousQuotes.map(quote => {
            const dx = (quote.longitude - previousQuotes[0].longitude) * ptPerLng;
            const dy = -(quote.latitude - previousQuotes[0].latitude) * ptPerLat;

            return {
                ...quote,
                dx,
                dy,
                distanceFromPrimary: Math.hypot(dx, dy),
            };
        });
        const previousBreakoutStationId = pickAnchoredSecondaryQuote(
            previousAnchoredQuotes,
            preferredBreakoutStationIdRef.current
        )?.stationId ?? null;
        const currentSecondaryStationIds = new Set(quotes.slice(1).map(quote => quote.stationId));

        if (currentSecondaryStationIds.size === 0) {
            preferredBreakoutStationIdRef.current = null;
        } else if (
            isConnectionTransition &&
            previousBreakoutStationId &&
            currentSecondaryStationIds.has(previousBreakoutStationId)
        ) {
            // Keep the already-visible shell tied to the same quote while the cluster grows.
            preferredBreakoutStationIdRef.current = previousBreakoutStationId;
        } else if (
            !preferredBreakoutStationIdRef.current ||
            !currentSecondaryStationIds.has(preferredBreakoutStationIdRef.current)
        ) {
            preferredBreakoutStationIdRef.current = emergingAnchoredQuote?.stationId ?? null;
        }

        if (isConnectionTransition) {
            const currentSpreadValue = spreadAnim.value;
            const currentMorphValue = morphAnim.value;

            onDebugTransitionEvent?.({
                type: 'merge-start',
                primaryStationId: primaryQuote.stationId,
                fromClusterKey: previousQuotes.map(quote => quote.stationId).join(','),
                toClusterKey: buildClusterMembershipKey(cluster),
                fromSpread: currentSpreadValue,
                toSpread: resolvedSpread,
                fromMorph: currentMorphValue,
                toMorph: resolvedMorph,
            });
        }

        spreadAnim.value = withTiming(resolvedSpread, {
            duration: CLUSTER_LIVE_MIN_DURATION,
            easing: Easing.linear,
        });
        morphAnim.value = withTiming(resolvedMorph, {
            duration: CLUSTER_LIVE_MIN_DURATION,
            easing: Easing.linear,
        });

        previousQuotesRef.current = quotes;
    }, [quotes, pendingCluster, ptPerLng, ptPerLat, resolvedSpread, resolvedMorph, pendingResolvedSpread, pendingResolvedMorph, splitBridge, onPendingClusterBridgeComplete, onDebugTransitionEvent, primaryQuote.stationId, cluster]);

    const animatedContentStyle = useAnimatedStyle(() => {
        return {};
    });

    // Style for the primary price bubble
    const leftBubbleStyle = useAnimatedStyle(() => {
        return {
            zIndex: 3,
            transform: [
                { translateX: 0 },
                { translateY: 0 }
            ]
        };
    });

    // Style for the breaking-out +N bubble
    const rightBubbleWrapperStyle = useAnimatedStyle(() => {
        const splitBridgeX = activeSplitBridge
            ? interpolate(splitBridgeProgress.value, [0, 1], [activeSplitBridge.startX, activeSplitBridge.endX])
            : interpolate(spreadAnim.value, [0, 1], [COLLAPSED_BUBBLE_OFFSET, breakoutTargetXAnim.value]);
        const splitBridgeY = activeSplitBridge
            ? interpolate(splitBridgeProgress.value, [0, 1], [activeSplitBridge.startY, activeSplitBridge.endY])
            : interpolate(spreadAnim.value, [0, 1], [0, breakoutTargetYAnim.value]);

        return {
            zIndex: 2,
            transform: [
                { translateX: splitBridgeX },
                { translateY: splitBridgeY }
            ]
        };
    });
    const rightBubbleShellStyle = useAnimatedStyle(() => {
        return {
            justifyContent: 'center',
            paddingHorizontal: interpolate(morphAnim.value, [0, 1], [8, 10], Extrapolate.CLAMP),
            paddingVertical: interpolate(morphAnim.value, [0, 0.5, 1], [6, 6, 6]),
            minWidth: interpolate(morphAnim.value, [0, 0.7], [COLLAPSED_SECONDARY_WIDTH, COLLAPSED_PRIMARY_WIDTH], Extrapolate.CLAMP),
        };
    });

    // Style for the subgroup that stays clustered after one item peels away
    const remainderBubbleWrapperStyle = useAnimatedStyle(() => {
        const nextSecondaryLocalDx = interpolate(
            spreadAnim.value,
            [0, 1],
            [COLLAPSED_BUBBLE_OFFSET, nextEmergingTargetXAnim.value]
        );
        const nextSecondaryLocalDy = interpolate(
            spreadAnim.value,
            [0, 1],
            [0, nextEmergingTargetYAnim.value]
        );

        return {
            zIndex: 1,
            transform: [
                { translateX: nextSecondaryLocalDx },
                { translateY: nextSecondaryLocalDy }
            ]
        };
    });
    const remainderBubbleShellStyle = useAnimatedStyle(() => {
        const shellMorph = morphAnim.value;

        return {
            justifyContent: 'center',
            paddingHorizontal: interpolate(shellMorph, [0, 1], [8, 10], Extrapolate.CLAMP),
            paddingVertical: 6,
            minWidth: interpolate(shellMorph, [0, 0.7], [COLLAPSED_SECONDARY_WIDTH, COLLAPSED_PRIMARY_WIDTH], Extrapolate.CLAMP),
        };
    });
    const remainderPlusStyle = useAnimatedStyle(() => {
        const shellMorph = morphAnim.value;

        return {
            opacity: interpolate(shellMorph, [0.4, 0.8], [1, 0], Extrapolate.CLAMP),
            transform: [{ scale: interpolate(shellMorph, [0.4, 0.8], [1, 0.5], Extrapolate.CLAMP) }]
        };
    });
    const remainderPriceStyle = useAnimatedStyle(() => {
        const shellMorph = morphAnim.value;

        return {
            position: 'absolute',
            opacity: interpolate(shellMorph, [0.6, 1], [0, 1], Extrapolate.CLAMP),
            transform: [{ scale: interpolate(shellMorph, [0.6, 1], [0.8, 1], Extrapolate.CLAMP) }]
        };
    });

    // Cross-fade styles for the text morphing
    const plusNStyle = useAnimatedStyle(() => {
        return {
            // Fade out the "+N" format 
            opacity: interpolate(morphAnim.value, [0.4, 0.8], [1, 0], Extrapolate.CLAMP),
            transform: [{ scale: interpolate(morphAnim.value, [0.4, 0.8], [1, 0.5], Extrapolate.CLAMP) }]
        }
    });

    const escapingPriceStyle = useAnimatedStyle(() => {
        return {
            position: 'absolute',
            // Fade in the Price format
            opacity: interpolate(morphAnim.value, [0.6, 1], [0, 1], Extrapolate.CLAMP),
            transform: [{ scale: interpolate(morphAnim.value, [0.6, 1], [0.8, 1], Extrapolate.CLAMP) }]
        }
    });
    const splitBridgeBubbleStyle = useAnimatedStyle(() => {
        if (!activeSplitBridge) {
            return {
                opacity: 0,
            };
        }

        return {
            zIndex: 4,
            transform: [
                {
                    translateX: interpolate(
                        splitBridgeProgress.value,
                        [0, 1],
                        [activeSplitBridge.startX, activeSplitBridge.endX]
                    )
                },
                {
                    translateY: interpolate(
                        splitBridgeProgress.value,
                        [0, 1],
                        [activeSplitBridge.startY, activeSplitBridge.endY]
                    )
                }
            ]
        };
    });
    const splitCarryBubbleStyle = useAnimatedStyle(() => {
        if (!activeSplitCarry) {
            return {
                opacity: 0,
            };
        }

        return {
            zIndex: 3,
            transform: [
                {
                    translateX: interpolate(
                        splitBridgeProgress.value,
                        [0, 1],
                        [activeSplitCarry.startX, activeSplitCarry.endX]
                    )
                },
                {
                    translateY: interpolate(
                        splitBridgeProgress.value,
                        [0, 1],
                        [activeSplitCarry.startY, activeSplitCarry.endY]
                    )
                }
            ]
        };
    });
    const splitBridgeShellStyle = useAnimatedStyle(() => {
        return {
            justifyContent: 'center',
            paddingHorizontal: interpolate(splitBridgeMorph.value, [0, 1], [8, 10], Extrapolate.CLAMP),
            paddingVertical: 6,
            minWidth: interpolate(splitBridgeMorph.value, [0, 0.7], [COLLAPSED_SECONDARY_WIDTH, COLLAPSED_PRIMARY_WIDTH], Extrapolate.CLAMP),
        };
    });
    const splitBridgePlusStyle = useAnimatedStyle(() => {
        return {
            opacity: interpolate(splitBridgeMorph.value, [0.4, 0.8], [1, 0], Extrapolate.CLAMP),
            transform: [{ scale: interpolate(splitBridgeMorph.value, [0.4, 0.8], [1, 0.5], Extrapolate.CLAMP) }]
        };
    });
    const splitBridgePriceStyle = useAnimatedStyle(() => {
        return {
            position: 'absolute',
            opacity: interpolate(splitBridgeMorph.value, [0.6, 1], [0, 1], Extrapolate.CLAMP),
            transform: [{ scale: interpolate(splitBridgeMorph.value, [0.6, 1], [0.8, 1], Extrapolate.CLAMP) }]
        };
    });
    const splitCarryShellStyle = useAnimatedStyle(() => {
        return {
            justifyContent: 'center',
            paddingHorizontal: interpolate(splitCarryMorph.value, [0, 1], [8, 10], Extrapolate.CLAMP),
            paddingVertical: 6,
            minWidth: interpolate(splitCarryMorph.value, [0, 0.7], [COLLAPSED_SECONDARY_WIDTH, COLLAPSED_PRIMARY_WIDTH], Extrapolate.CLAMP),
        };
    });
    const splitCarryPlusStyle = useAnimatedStyle(() => {
        return {
            opacity: interpolate(splitCarryMorph.value, [0.4, 0.8], [1, 0], Extrapolate.CLAMP),
            transform: [{ scale: interpolate(splitCarryMorph.value, [0.4, 0.8], [1, 0.5], Extrapolate.CLAMP) }]
        };
    });
    const splitCarryPriceStyle = useAnimatedStyle(() => {
        return {
            position: 'absolute',
            opacity: interpolate(splitCarryMorph.value, [0.6, 1], [0, 1], Extrapolate.CLAMP),
            transform: [{ scale: interpolate(splitCarryMorph.value, [0.6, 1], [0.8, 1], Extrapolate.CLAMP) }]
        };
    });
    const hasPendingCluster = Boolean(pendingCluster);
    const renderedClusterSize = hasPendingCluster ? pendingCluster.quotes.length : quotes.length;
    const isSplitBridgePriming = hasPendingCluster && !activeSplitBridge;
    const carryVisible = Boolean(activeSplitCarry);
    const bridgeVisible = Boolean(activeSplitBridge);
    const breakoutVisible = isMultiQuote && (!pendingCluster || isSplitBridgePriming || bridgeVisible);
    const bridgeStartX = activeSplitBridge?.startX ?? 0;
    const bridgeStartY = activeSplitBridge?.startY ?? 0;
    const bridgeTargetX = liveSplitBridgeTargetX;
    const bridgeTargetY = liveSplitBridgeTargetY;
    const carryStartX = activeSplitCarry?.startX ?? 0;
    const carryStartY = activeSplitCarry?.startY ?? 0;
    const carryTargetX = activeSplitCarry?.endX ?? pendingStaticSecondaryX;
    const carryTargetY = activeSplitCarry?.endY ?? pendingStaticSecondaryY;
    const shouldRenderStaticRemainderBubble = (
        ENABLE_CLUSTER_REMAINDER_BUBBLE &&
        hasRemainderBubble
    );
    const breakoutOpacity = breakoutVisible ? 1 : 0;
    const remainderOpacity = shouldRenderStaticRemainderBubble ? 1 : 0;
    const carryOpacity = carryVisible ? 1 : 0;
    const bridgeOpacity = bridgeVisible ? 1 : 0;

    const emitDebugRenderFrame = () => {
        if (!isDebugWatched || !isDebugRecording || !onDebugRenderFrame) {
            return;
        }

        const spreadValue = spreadAnim.value;
        const morphValue = morphAnim.value;
        const bridgeProgressValue = splitBridgeProgress.value;
        const bridgeMorphValue = splitBridgeMorph.value;
        const carryMorphValue = splitCarryMorph.value;
        const breakoutX = interpolate(spreadValue, [0, 1], [COLLAPSED_BUBBLE_OFFSET, breakoutTargetXAnim.value]);
        const breakoutY = interpolate(spreadValue, [0, 1], [0, breakoutTargetYAnim.value]);
        const remainderShellMorph = morphValue;
        const remainderX = interpolate(spreadValue, [0, 1], [COLLAPSED_BUBBLE_OFFSET, nextEmergingTargetXAnim.value]);
        const remainderY = interpolate(spreadValue, [0, 1], [0, nextEmergingTargetYAnim.value]);
        const carryX = carryVisible
            ? interpolate(bridgeProgressValue, [0, 1], [carryStartX, carryTargetX])
            : breakoutX;
        const carryY = carryVisible
            ? interpolate(bridgeProgressValue, [0, 1], [carryStartY, carryTargetY])
            : breakoutY;
        const bridgeX = bridgeVisible
            ? interpolate(bridgeProgressValue, [0, 1], [bridgeStartX, bridgeTargetX])
            : breakoutX;
        const bridgeY = bridgeVisible
            ? interpolate(bridgeProgressValue, [0, 1], [bridgeStartY, bridgeTargetY])
            : breakoutY;
        const breakoutWidth = breakoutVisible
            ? interpolate(morphValue, [0, 0.7], [COLLAPSED_SECONDARY_WIDTH, COLLAPSED_PRIMARY_WIDTH], Extrapolate.CLAMP)
            : 0;
        const remainderWidth = shouldRenderStaticRemainderBubble
            ? interpolate(remainderShellMorph, [0, 0.7], [COLLAPSED_SECONDARY_WIDTH, COLLAPSED_PRIMARY_WIDTH], Extrapolate.CLAMP)
            : 0;
        const carryWidth = carryVisible
            ? interpolate(carryMorphValue, [0, 0.7], [COLLAPSED_SECONDARY_WIDTH, COLLAPSED_PRIMARY_WIDTH], Extrapolate.CLAMP)
            : 0;
        const bridgeWidth = bridgeVisible
            ? interpolate(bridgeMorphValue, [0, 0.7], [COLLAPSED_SECONDARY_WIDTH, COLLAPSED_PRIMARY_WIDTH], Extrapolate.CLAMP)
            : 0;

        onDebugRenderFrame({
            frameTimestamp: Date.now(),
            clusterKey: renderedClusterKey,
            fromClusterKey,
            toClusterKey,
            stageSignature: currentPendingSignature || fromClusterKey,
            runtimePhase,
            clusterSize: renderedClusterSize,
            spreadProgress: spreadValue,
            morphProgress: morphValue,
            bridgeProgress: (bridgeVisible || carryVisible) ? bridgeProgressValue : 0,
            visibleLayerCount: [
                breakoutVisible,
                shouldRenderStaticRemainderBubble,
                carryVisible,
                bridgeVisible,
            ].filter(Boolean).length,
            maxSecondaryRadius: Math.max(
                breakoutVisible ? Math.hypot(breakoutX, breakoutY) : 0,
                shouldRenderStaticRemainderBubble ? Math.hypot(remainderX, remainderY) : 0,
                carryVisible ? Math.hypot(carryX, carryY) : 0,
                bridgeVisible ? Math.hypot(bridgeX, bridgeY) : 0
            ),
            secondaryShellWidth: Math.max(breakoutWidth, remainderWidth, carryWidth, bridgeWidth),
            breakoutVisible,
            breakoutOpacity,
            breakoutX,
            breakoutY,
            remainderVisible: shouldRenderStaticRemainderBubble,
            remainderOpacity,
            remainderX,
            remainderY,
            carryVisible,
            carryOpacity,
            carryX,
            carryY,
            bridgeVisible,
            bridgeOpacity,
            bridgeX,
            bridgeY,
        });
    };

    useEffect(() => {
        emitDebugRenderFrame();
    }, [
        isDebugWatched,
        isDebugRecording,
        runtimePhase,
        fromClusterKey,
        toClusterKey,
        currentPendingSignature,
    ]);

    useAnimatedReaction(
        () => {
            if (!isDebugWatched || !isDebugRecording || !onDebugRenderFrame) {
                return null;
            }

            const spreadValue = spreadAnim.value;
            const morphValue = morphAnim.value;
            const bridgeProgressValue = splitBridgeProgress.value;
            const bridgeMorphValue = splitBridgeMorph.value;
            const carryMorphValue = splitCarryMorph.value;
            const breakoutX = interpolate(spreadValue, [0, 1], [COLLAPSED_BUBBLE_OFFSET, breakoutTargetXAnim.value]);
            const breakoutY = interpolate(spreadValue, [0, 1], [0, breakoutTargetYAnim.value]);
            const remainderShellMorph = morphValue;
            const remainderX = interpolate(spreadValue, [0, 1], [COLLAPSED_BUBBLE_OFFSET, nextEmergingTargetXAnim.value]);
            const remainderY = interpolate(spreadValue, [0, 1], [0, nextEmergingTargetYAnim.value]);
            const carryX = carryVisible
                ? interpolate(bridgeProgressValue, [0, 1], [carryStartX, carryTargetX])
                : breakoutX;
            const carryY = carryVisible
                ? interpolate(bridgeProgressValue, [0, 1], [carryStartY, carryTargetY])
                : breakoutY;
            const bridgeX = bridgeVisible
                ? interpolate(bridgeProgressValue, [0, 1], [bridgeStartX, bridgeTargetX])
                : breakoutX;
            const bridgeY = bridgeVisible
                ? interpolate(bridgeProgressValue, [0, 1], [bridgeStartY, bridgeTargetY])
                : breakoutY;
            const breakoutWidth = breakoutVisible
                ? interpolate(morphValue, [0, 0.7], [COLLAPSED_SECONDARY_WIDTH, COLLAPSED_PRIMARY_WIDTH], Extrapolate.CLAMP)
                : 0;
            const remainderWidth = shouldRenderStaticRemainderBubble
                ? interpolate(remainderShellMorph, [0, 0.7], [COLLAPSED_SECONDARY_WIDTH, COLLAPSED_PRIMARY_WIDTH], Extrapolate.CLAMP)
                : 0;
            const carryWidth = carryVisible
                ? interpolate(carryMorphValue, [0, 0.7], [COLLAPSED_SECONDARY_WIDTH, COLLAPSED_PRIMARY_WIDTH], Extrapolate.CLAMP)
                : 0;
            const bridgeWidth = bridgeVisible
                ? interpolate(bridgeMorphValue, [0, 0.7], [COLLAPSED_SECONDARY_WIDTH, COLLAPSED_PRIMARY_WIDTH], Extrapolate.CLAMP)
                : 0;

            return {
                frameTimestamp: Date.now(),
                clusterKey: renderedClusterKey,
                fromClusterKey,
                toClusterKey,
                stageSignature: currentPendingSignature || fromClusterKey,
                runtimePhase,
                clusterSize: renderedClusterSize,
                spreadProgress: spreadValue,
                morphProgress: morphValue,
                bridgeProgress: (bridgeVisible || carryVisible) ? bridgeProgressValue : 0,
                visibleLayerCount: [
                    breakoutVisible,
                    shouldRenderStaticRemainderBubble,
                    carryVisible,
                    bridgeVisible,
                ].filter(Boolean).length,
                maxSecondaryRadius: Math.max(
                    breakoutVisible ? Math.hypot(breakoutX, breakoutY) : 0,
                    shouldRenderStaticRemainderBubble ? Math.hypot(remainderX, remainderY) : 0,
                    carryVisible ? Math.hypot(carryX, carryY) : 0,
                    bridgeVisible ? Math.hypot(bridgeX, bridgeY) : 0
                ),
                secondaryShellWidth: Math.max(breakoutWidth, remainderWidth, carryWidth, bridgeWidth),
                breakoutVisible,
                breakoutOpacity,
                breakoutX,
                breakoutY,
                remainderVisible: shouldRenderStaticRemainderBubble,
                remainderOpacity,
                remainderX,
                remainderY,
                carryVisible,
                carryOpacity,
                carryX,
                carryY,
                bridgeVisible,
                bridgeOpacity,
                bridgeX,
                bridgeY,
            };
        },
        (sample) => {
            if (!sample) {
                return;
            }

            runOnJS(onDebugRenderFrame)(sample);
        },
        [
            isDebugWatched,
            isDebugRecording,
            onDebugRenderFrame,
            runtimePhase,
            renderedClusterKey,
            fromClusterKey,
            toClusterKey,
            currentPendingSignature,
        ]
    );
    return (
        <Marker
            key={quotes[0].stationId} // Ensure key is bound to primary station so it doesn't unmount
            coordinate={{
                latitude: primaryLat,
                longitude: primaryLng,
            }}
            anchor={{ x: 0.5, y: 0.5 }} // Keep anchor visually centered
            onPress={() => onMarkerPress(cluster)}
            style={{ zIndex: isActive ? 3 : isCheapestAcrossAll ? 2 : 1 }}
            tracksViewChanges={true}
        >
            <AnimatedLiquidGlassContainer
                spacing={24}
                style={[
                    styles.clusterContainer,
                    animatedOverlayStyle,
                    { minWidth: containerWidth, minHeight: containerHeight, justifyContent: 'center', alignItems: 'center' }
                ]}
            >
                {/* Main bubble with price (Front) */}
                <Animated.View style={[styles.bubblePositioner, leftBubbleStyle]}>
                    <AnimatedLiquidGlassView
                        effect="clear"
                        style={[styles.bubbleBase, styles.primaryBubbleShell]}
                    >
                        <Animated.View style={[styles.rowItem, styles.bubbleContentRow, animatedContentStyle]}>
                            <SymbolView
                                name="fuelpump.fill"
                                size={14}
                                tintColor={primaryQuote.originalIndex === 0 ? '#007AFF' : (primaryQuote.originalIndex === activeIndex ? themeColors.text : '#888888')}
                                style={styles.priceIcon}
                            />
                            <Animated.Text
                                style={[
                                    styles.priceText,
                                    primaryQuote.originalIndex === 0 && styles.bestPriceText,
                                    animatedTextStyle,
                                ]}
                            >
                                ${primaryQuote.price.toFixed(2)}
                            </Animated.Text>
                        </Animated.View>
                    </AnimatedLiquidGlassView>
                </Animated.View>

                {/* Secondary merging bubble for clusters (Behind) */}
                {isMultiQuote && (
                    <Animated.View style={[styles.bubblePositioner, rightBubbleWrapperStyle, { opacity: breakoutOpacity }]}>
                        <AnimatedLiquidGlassView
                            effect="clear"
                            style={[
                                styles.bubbleBase,
                                rightBubbleShellStyle,
                            ]}
                        >
                            <Animated.View style={[styles.rowItem, animatedContentStyle, plusNStyle, { justifyContent: 'center' }]}>
                                <Text style={{ color: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)', fontSize: 12, marginRight: 4 }}>|</Text>
                                <Animated.Text
                                    style={[
                                        styles.priceText,
                                        animatedTextStyle,
                                    ]}
                                >
                                    +{quotes.length - 1}
                                </Animated.Text>
                            </Animated.View>

                            {/* The price it morphs into */}
                            {emergingAnchoredQuote && (
                                <Animated.View style={[styles.rowItem, styles.bubbleFillRow, escapingPriceStyle]}>
                                    <SymbolView
                                        name="fuelpump.fill"
                                        size={14}
                                        tintColor={emergingAnchoredQuote.originalIndex === 0 ? '#007AFF' : (emergingAnchoredQuote.originalIndex === activeIndex ? themeColors.text : '#888888')}
                                        style={styles.priceIcon}
                                    />
                                    <Text
                                        style={[
                                            styles.priceText,
                                            emergingAnchoredQuote.originalIndex === 0 && styles.bestPriceText,
                                            {
                                                color: emergingAnchoredQuote.originalIndex === 0
                                                    ? '#007AFF'
                                                    : (emergingAnchoredQuote.originalIndex === activeIndex ? themeColors.text : '#888888')
                                            }
                                        ]}
                                    >
                                        ${emergingAnchoredQuote.price.toFixed(2)}
                                    </Text>
                                </Animated.View>
                            )}
                        </AnimatedLiquidGlassView>
                    </Animated.View>
                )}

                {shouldRenderStaticRemainderBubble && (
                    <Animated.View style={[styles.bubblePositioner, remainderBubbleWrapperStyle]}>
                        <AnimatedLiquidGlassView
                            effect="clear"
                            style={[
                                styles.bubbleBase,
                                remainderBubbleShellStyle,
                            ]}
                        >
                            <Animated.View style={[styles.rowItem, animatedContentStyle, remainderPlusStyle, { justifyContent: 'center' }]}>
                                <Text style={{ color: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)', fontSize: 12, marginRight: 4 }}>|</Text>
                                <Animated.Text
                                    style={[
                                        styles.priceText,
                                        animatedTextStyle,
                                    ]}
                                >
                                    +{nextClusterQuotes.length - 1}
                                </Animated.Text>
                            </Animated.View>

                            {nextClusterEmergingQuote && (
                                <Animated.View style={[styles.rowItem, styles.bubbleFillRow, remainderPriceStyle]}>
                                    <SymbolView
                                        name="fuelpump.fill"
                                        size={14}
                                        tintColor={nextClusterEmergingQuote.originalIndex === 0 ? '#007AFF' : (nextClusterEmergingQuote.originalIndex === activeIndex ? themeColors.text : '#888888')}
                                        style={styles.priceIcon}
                                    />
                                    <Text
                                        style={[
                                            styles.priceText,
                                            nextClusterEmergingQuote.originalIndex === 0 && styles.bestPriceText,
                                            {
                                                color: nextClusterEmergingQuote.originalIndex === 0
                                                    ? '#007AFF'
                                                    : (nextClusterEmergingQuote.originalIndex === activeIndex ? themeColors.text : '#888888')
                                            }
                                        ]}
                                    >
                                        ${nextClusterEmergingQuote.price.toFixed(2)}
                                    </Text>
                                </Animated.View>
                            )}
                        </AnimatedLiquidGlassView>
                    </Animated.View>
                )}

                {activeSplitCarry?.emergingQuote && (
                    <Animated.View style={[styles.bubblePositioner, splitCarryBubbleStyle]}>
                        <AnimatedLiquidGlassView
                            effect="clear"
                            style={[
                                styles.bubbleBase,
                                splitCarryShellStyle,
                            ]}
                        >
                            <Animated.View style={[styles.rowItem, animatedContentStyle, splitCarryPlusStyle, { justifyContent: 'center' }]}>
                                <Text style={{ color: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)', fontSize: 12, marginRight: 4 }}>|</Text>
                                <Animated.Text
                                    style={[
                                        styles.priceText,
                                        animatedTextStyle,
                                    ]}
                                >
                                    +{activeSplitCarry.plusCount}
                                </Animated.Text>
                            </Animated.View>

                            <Animated.View style={[styles.rowItem, styles.bubbleFillRow, splitCarryPriceStyle]}>
                                <SymbolView
                                    name="fuelpump.fill"
                                    size={14}
                                    tintColor={activeSplitCarry.emergingQuote.originalIndex === 0 ? '#007AFF' : (activeSplitCarry.emergingQuote.originalIndex === activeIndex ? themeColors.text : '#888888')}
                                    style={styles.priceIcon}
                                />
                                <Text
                                    style={[
                                        styles.priceText,
                                        activeSplitCarry.emergingQuote.originalIndex === 0 && styles.bestPriceText,
                                        {
                                            color: activeSplitCarry.emergingQuote.originalIndex === 0
                                                ? '#007AFF'
                                                : (activeSplitCarry.emergingQuote.originalIndex === activeIndex ? themeColors.text : '#888888')
                                        }
                                    ]}
                                >
                                    ${activeSplitCarry.emergingQuote.price.toFixed(2)}
                                </Text>
                            </Animated.View>
                        </AnimatedLiquidGlassView>
                    </Animated.View>
                )}

                {activeSplitBridge?.emergingQuote && (
                    <Animated.View style={[styles.bubblePositioner, splitBridgeBubbleStyle]}>
                        <AnimatedLiquidGlassView
                            effect="clear"
                            style={[
                                styles.bubbleBase,
                                splitBridgeShellStyle,
                            ]}
                        >
                            <Animated.View style={[styles.rowItem, animatedContentStyle, splitBridgePlusStyle, { justifyContent: 'center' }]}>
                                <Text style={{ color: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)', fontSize: 12, marginRight: 4 }}>|</Text>
                                <Animated.Text
                                    style={[
                                        styles.priceText,
                                        animatedTextStyle,
                                    ]}
                                >
                                    +{activeSplitBridge.plusCount}
                                </Animated.Text>
                            </Animated.View>

                            <Animated.View style={[styles.rowItem, styles.bubbleFillRow, splitBridgePriceStyle]}>
                                <SymbolView
                                    name="fuelpump.fill"
                                    size={14}
                                    tintColor={activeSplitBridge.emergingQuote.originalIndex === 0 ? '#007AFF' : (activeSplitBridge.emergingQuote.originalIndex === activeIndex ? themeColors.text : '#888888')}
                                    style={styles.priceIcon}
                                />
                                <Text
                                    style={[
                                        styles.priceText,
                                        activeSplitBridge.emergingQuote.originalIndex === 0 && styles.bestPriceText,
                                        {
                                            color: activeSplitBridge.emergingQuote.originalIndex === 0
                                                ? '#007AFF'
                                                : (activeSplitBridge.emergingQuote.originalIndex === activeIndex ? themeColors.text : '#888888')
                                        }
                                    ]}
                                >
                                    ${activeSplitBridge.emergingQuote.price.toFixed(2)}
                                </Text>
                            </Animated.View>
                        </AnimatedLiquidGlassView>
                    </Animated.View>
                )}

            </AnimatedLiquidGlassContainer>
        </Marker>
    );
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
    const mapRegionRef = useRef(DEFAULT_REGION);
    const lastClusterDebugSignatureRef = useRef('');
    const clusterDebugSamplesRef = useRef([]);
    const clusterDebugTransitionEventsRef = useRef([]);
    const clusterDebugTransitionEventKeysRef = useRef(new Set());
    const clusterDebugWatchedPrimaryIdRef = useRef(null);
    const clusterDebugExpectedStageRef = useRef('');
    const clusterDebugExpectedPhaseRef = useRef('');
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

    const minRating = preferences.minimumRating || 0;
    const stationQuotes = useMemo(() => (
        (topStations.length > 0 ? topStations : (bestQuote ? [bestQuote] : []))
            .filter(q => minRating === 0 || (q.rating != null && q.rating >= minRating))
            .map((q, idx) => ({ ...q, originalIndex: idx }))
    ), [topStations, bestQuote, minRating]);

    const previousClustersRef = useRef([]);
    const previousRenderedClustersRef = useRef([]);
    const splitTransitionCooldownRef = useRef(new Map());
    const [heldSplitClusters, setHeldSplitClusters] = useState([]);

    const clusters = useMemo(() => {
        if (stationQuotes.length === 0) return [];

        const latDelta = mapRegion.latitudeDelta || 0.05;
        const lngDelta = mapRegion.longitudeDelta || 0.05;

        // Visual thresholds based on chip pixel dimensions
        const mergeLatHeight = latDelta * CLUSTER_MERGE_LAT_FACTOR;
        const mergeLngWidth = lngDelta * CLUSTER_MERGE_LNG_FACTOR;

        // Hysteresis: Keep absolute separation distance significantly wider
        // Use the same hysteresis multiplier the overlay animation uses.
        const splitLatHeight = mergeLatHeight * CLUSTER_SPLIT_MULTIPLIER;
        const splitLngWidth = mergeLngWidth * CLUSTER_SPLIT_MULTIPLIER;

        const cheapestStation = stationQuotes[0];
        const others = stationQuotes.slice(1);

        const finalClusters = [];

        // 1. Cheapest station is always standalone
        finalClusters.push({
            quotes: [cheapestStation],
            averageLat: cheapestStation.latitude,
            averageLng: cheapestStation.longitude,
        });

        // 2. Group all other overlapping stations together
        others.forEach(quote => {
            let grouped = false;
            for (const cluster of finalClusters) {
                // Don't group with the absolute cheapest standalone station
                if (cluster.quotes[0].originalIndex === 0) continue;

                // Check if they were already grouped together in the previous frame
                const wasPreviouslyGrouped = previousClustersRef.current.some(prevCluster =>
                    prevCluster.quotes.some(q => q.stationId === quote.stationId) &&
                    prevCluster.quotes.some(q => q.stationId === cluster.quotes[0].stationId)
                );

                const latDiff = Math.abs(cluster.averageLat - quote.latitude);
                const lngDiff = Math.abs(cluster.averageLng - quote.longitude);

                // If within physical overlap bounds, swallow into cluster
                // Use the wider split threshold if they were already grouped, otherwise use the tighter merge threshold
                const currentLatThreshold = wasPreviouslyGrouped ? splitLatHeight : mergeLatHeight;
                const currentLngThreshold = wasPreviouslyGrouped ? splitLngWidth : mergeLngWidth;

                if (latDiff < currentLatThreshold && lngDiff < currentLngThreshold) {
                    cluster.quotes.push(quote);
                    // Dynamically update center of mass
                    cluster.averageLat = cluster.quotes.reduce((sum, q) => sum + q.latitude, 0) / cluster.quotes.length;
                    cluster.averageLng = cluster.quotes.reduce((sum, q) => sum + q.longitude, 0) / cluster.quotes.length;
                    grouped = true;
                    break;
                }
            }

            if (!grouped) {
                finalClusters.push({
                    quotes: [quote],
                    averageLat: quote.latitude,
                    averageLng: quote.longitude,
                });
            }
        });

        // Ensure quotes inside clusters are sorted by price ascending (just in case)
        finalClusters.forEach(cluster => {
            if (cluster.quotes.length > 1) {
                cluster.quotes.sort((a, b) => a.price - b.price);
            }
        });

        previousClustersRef.current = finalClusters;
        return finalClusters;
    }, [stationQuotes, mapRegion.latitudeDelta, mapRegion.longitudeDelta]);
    const clustersSignature = useMemo(() => (
        clusters.map(buildClusterMembershipKey).join('|')
    ), [clusters]);

    const pruneSplitTransitionCooldowns = (now = Date.now()) => {
        for (const [transitionKey, expiresAt] of splitTransitionCooldownRef.current.entries()) {
            if (!Number.isFinite(expiresAt) || expiresAt <= now) {
                splitTransitionCooldownRef.current.delete(transitionKey);
            }
        }
    };

    const markSplitTransitionCooldown = (transitionKey) => {
        if (!transitionKey) {
            return;
        }

        const now = Date.now();
        pruneSplitTransitionCooldowns(now);
        splitTransitionCooldownRef.current.set(
            transitionKey,
            now + CLUSTER_SPLIT_REENTRY_COOLDOWN_MS
        );
    };

    const isSplitTransitionCoolingDown = (transitionKey) => {
        if (!transitionKey) {
            return false;
        }

        const now = Date.now();
        pruneSplitTransitionCooldowns(now);
        const expiresAt = splitTransitionCooldownRef.current.get(transitionKey);

        return Number.isFinite(expiresAt) && expiresAt > now;
    };

    useLayoutEffect(() => {
        if (!ENABLE_CLUSTER_SPLIT_HANDOFF) {
            setHeldSplitClusters(currentHeldClusters => (
                currentHeldClusters.length === 0 ? currentHeldClusters : []
            ));
            previousRenderedClustersRef.current = clusters;
            return;
        }

        pruneSplitTransitionCooldowns();
        const previousClustersByPrimary = new Map(
            previousRenderedClustersRef.current.map(cluster => [cluster.quotes[0].stationId, cluster])
        );
        const currentClustersByPrimary = new Map(
            clusters.map(cluster => [cluster.quotes[0].stationId, cluster])
        );

        setHeldSplitClusters(currentHeldClusters => {
            let nextHeldClusters = currentHeldClusters
                .map(heldCluster => {
                    const currentCluster = currentClustersByPrimary.get(heldCluster.primaryStationId);
                    let nextHeldCluster = heldCluster;
                    const activeTargetCount = heldCluster.toCluster.quotes.length;
                    const currentTargetCount = currentCluster?.quotes?.length ?? Infinity;

                    if (currentCluster && currentTargetCount < activeTargetCount) {
                        const queuedClusterKey = buildClusterMembershipKey(currentCluster);
                        const existingQueuedKey = buildClusterMembershipKey(heldCluster.queuedToCluster);

                        if (queuedClusterKey !== existingQueuedKey) {
                            recordClusterDebugTransitionEvent({
                                type: 'split-queued-update',
                                primaryStationId: heldCluster.primaryStationId,
                                activeToClusterKey: buildClusterMembershipKey(heldCluster.toCluster),
                                queuedToClusterKey: queuedClusterKey,
                            });
                        }

                        nextHeldCluster = {
                            ...heldCluster,
                            queuedToCluster: currentCluster,
                        };
                    }

                    if (nextHeldCluster.bridgeComplete) {
                        if (isMapMoving) {
                            return nextHeldCluster;
                        }

                        const queuedCluster = nextHeldCluster.queuedToCluster;

                        if (queuedCluster && queuedCluster.quotes.length < nextHeldCluster.toCluster.quotes.length) {
                            const advancedFromCluster = nextHeldCluster.toCluster;
                            const advancedToCluster = queuedCluster;
                            const detachedStationIds = getDetachedStationIdsForSplit(advancedFromCluster, advancedToCluster);

                            recordClusterDebugTransitionEvent({
                                type: 'split-stage-advance',
                                primaryStationId: heldCluster.primaryStationId,
                                fromClusterKey: buildClusterMembershipKey(advancedFromCluster),
                                toClusterKey: buildClusterMembershipKey(advancedToCluster),
                                detachedStationIds,
                            });

                            return {
                                primaryStationId: heldCluster.primaryStationId,
                                fromCluster: advancedFromCluster,
                                toCluster: advancedToCluster,
                                queuedToCluster: null,
                                detachedStationIds,
                                transitionKey: `${buildClusterMembershipKey(advancedFromCluster)}->${buildClusterMembershipKey(advancedToCluster)}`,
                                bridgeComplete: false,
                            };
                        }

                        recordClusterDebugTransitionEvent({
                            type: 'split-handoff-cleared',
                            primaryStationId: nextHeldCluster.primaryStationId,
                            transitionKey: nextHeldCluster.transitionKey,
                        });
                        markSplitTransitionCooldown(nextHeldCluster.transitionKey);
                        return null;
                    }

                    // Keep the held transition alive until bridge completion even if live clustering
                    // briefly regroups due map jitter; this prevents split/live render oscillation.
                    return nextHeldCluster;
                })
                .filter(Boolean);

            clusters.forEach(cluster => {
                const primaryStationId = cluster.quotes[0].stationId;
                const previousCluster = previousClustersByPrimary.get(primaryStationId);

                if (!previousCluster) {
                    return;
                }

                const isSplitTransition =
                    previousCluster.quotes.length > cluster.quotes.length &&
                    previousCluster.quotes.length > 1;
                const alreadyHeld = nextHeldClusters.some(
                    heldCluster => heldCluster.primaryStationId === primaryStationId
                );

                if (!isSplitTransition || alreadyHeld) {
                    return;
                }

                const detachedStationIds = getDetachedStationIdsForSplit(previousCluster, cluster);
                const transitionKey = `${buildClusterMembershipKey(previousCluster)}->${buildClusterMembershipKey(cluster)}`;

                if (isSplitTransitionCoolingDown(transitionKey)) {
                    return;
                }

                recordClusterDebugTransitionEvent({
                    type: 'split-held-created',
                    primaryStationId,
                    fromClusterKey: buildClusterMembershipKey(previousCluster),
                    toClusterKey: buildClusterMembershipKey(cluster),
                    detachedStationIds,
                });

                nextHeldClusters = [
                    ...nextHeldClusters,
                    {
                        primaryStationId,
                        fromCluster: previousCluster,
                        toCluster: cluster,
                        queuedToCluster: null,
                        detachedStationIds,
                        transitionKey,
                        bridgeComplete: false,
                    },
                ];
            });

            if (areHeldSplitRecordsEquivalent(currentHeldClusters, nextHeldClusters)) {
                return currentHeldClusters;
            }

            return nextHeldClusters;
        });

        previousRenderedClustersRef.current = clusters;
    }, [clustersSignature, isMapMoving]);

    const handleHeldSplitBridgeComplete = (primaryStationId, transitionKey) => {
        if (!ENABLE_CLUSTER_SPLIT_HANDOFF) {
            return;
        }

        if (debugClusterAnimations && isClusterDebugRecording) {
            const eventKey = `split-stage-ready|${primaryStationId}|${transitionKey}|${mapMotionRef.current ? '1' : '0'}`;
            if (!clusterDebugTransitionEventKeysRef.current.has(eventKey)) {
                clusterDebugTransitionEventKeysRef.current.add(eventKey);
                clusterDebugTransitionEventsRef.current = [
                    ...clusterDebugTransitionEventsRef.current,
                    {
                        timestamp: Date.now(),
                        type: 'split-stage-ready',
                        primaryStationId,
                        transitionKey,
                        mapMoving: mapMotionRef.current,
                    },
                ];
            }
        }

        setHeldSplitClusters(currentHeldClusters => {
            let didChange = false;
            const nextHeldClusters = currentHeldClusters
                .map(heldCluster => {
                    if (
                        heldCluster.primaryStationId !== primaryStationId ||
                        heldCluster.transitionKey !== transitionKey
                    ) {
                        return heldCluster;
                    }

                    if (heldCluster.bridgeComplete) {
                        return heldCluster;
                    }

                    didChange = true;

                    if (mapMotionRef.current) {
                        recordClusterDebugTransitionEvent({
                            type: 'split-bridge-complete',
                            primaryStationId,
                            transitionKey: heldCluster.transitionKey,
                            mapMoving: true,
                        });

                        return {
                            ...heldCluster,
                            bridgeComplete: true,
                        };
                    }

                    const queuedCluster = heldCluster.queuedToCluster;
                    if (queuedCluster && queuedCluster.quotes.length < heldCluster.toCluster.quotes.length) {
                        const advancedFromCluster = heldCluster.toCluster;
                        const advancedToCluster = queuedCluster;
                        const detachedStationIds = getDetachedStationIdsForSplit(advancedFromCluster, advancedToCluster);

                        recordClusterDebugTransitionEvent({
                            type: 'split-stage-advance',
                            primaryStationId,
                            fromClusterKey: buildClusterMembershipKey(advancedFromCluster),
                            toClusterKey: buildClusterMembershipKey(advancedToCluster),
                            detachedStationIds,
                        });

                        return {
                            primaryStationId,
                            fromCluster: advancedFromCluster,
                            toCluster: advancedToCluster,
                            queuedToCluster: null,
                            detachedStationIds,
                            transitionKey: `${buildClusterMembershipKey(advancedFromCluster)}->${buildClusterMembershipKey(advancedToCluster)}`,
                            bridgeComplete: false,
                        };
                    }

                    recordClusterDebugTransitionEvent({
                        type: 'split-handoff-cleared',
                        primaryStationId,
                        transitionKey: heldCluster.transitionKey,
                    });
                    markSplitTransitionCooldown(heldCluster.transitionKey);
                    return null;
                })
                .filter(Boolean);

            if (!didChange || areHeldSplitRecordsEquivalent(currentHeldClusters, nextHeldClusters)) {
                return currentHeldClusters;
            }

            return nextHeldClusters;
        });
    };

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
            event.bridgeQuoteStationId || '',
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

    const { width, height } = Dimensions.get('window');

    // We want the card to be almost full width, minus some padding to peek the next card.
    const peekPadding = 16;
    const itemWidth = width - (peekPadding * 2);
    const sideInset = (width - itemWidth) / 2;

    const lastDataHashRef = useRef('');
    const isUserScrollingRef = useRef(false);
    const isAnimatingRef = useRef(false);
    const mapMotionRef = useRef(false);
    const prevIsFocusedRef = useRef(isFocused);

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
    const watchedClusterDiagnostic = useMemo(() => {
        if (!debugClusterAnimations || !watchedCluster) {
            return null;
        }

        return computeClusterHandoffDiagnostic({
            quotes: watchedCluster.quotes,
            averageLat: watchedCluster.averageLat,
            averageLng: watchedCluster.averageLng,
            mapRegion,
            screenWidth: width,
            screenHeight: height,
        });
    }, [debugClusterAnimations, watchedCluster, mapRegion, width, height]);
    const activeClusterDebugPrimaryId = isClusterDebugRecording
        ? clusterDebugWatchedPrimaryIdRef.current
        : (watchedCluster?.quotes?.[0]?.stationId || null);

    const recordClusterDebugRenderFrame = (frame) => {
        if (!debugClusterAnimations || !isClusterDebugRecording || !frame) {
            return false;
        }

        const expectedStageSignature = clusterDebugExpectedStageRef.current;
        const expectedRuntimePhase = clusterDebugExpectedPhaseRef.current;

        if (
            expectedStageSignature &&
            frame.stageSignature &&
            frame.stageSignature !== expectedStageSignature
        ) {
            return false;
        }

        if (
            expectedRuntimePhase &&
            frame.runtimePhase &&
            frame.runtimePhase !== expectedRuntimePhase
        ) {
            return false;
        }

        const signature = [
            frame.clusterKey || '',
            frame.stageSignature || '',
            frame.runtimePhase || 'live',
            formatDebugMetric(frame.spreadProgress, 5),
            formatDebugMetric(frame.morphProgress, 5),
            formatDebugMetric(frame.bridgeProgress, 5),
            formatDebugMetric(frame.breakoutX, 4),
            formatDebugMetric(frame.breakoutY, 4),
            frame.breakoutVisible ? '1' : '0',
            formatDebugMetric(frame.remainderX, 4),
            formatDebugMetric(frame.remainderY, 4),
            frame.remainderVisible ? '1' : '0',
            formatDebugMetric(frame.carryX, 4),
            formatDebugMetric(frame.carryY, 4),
            frame.carryVisible ? '1' : '0',
            formatDebugMetric(frame.bridgeX, 4),
            formatDebugMetric(frame.bridgeY, 4),
            frame.bridgeVisible ? '1' : '0',
        ].join('|');

        const previousSample = clusterDebugSamplesRef.current[clusterDebugSamplesRef.current.length - 1] || null;
        const visibleLayers = getClusterDebugVisibleLayers(frame);
        const breakoutFrameDelta = computeClusterDebugLayerMotion(previousSample, frame, 'breakout');
        const remainderFrameDelta = computeClusterDebugLayerMotion(previousSample, frame, 'remainder');
        const carryFrameDelta = computeClusterDebugLayerMotion(previousSample, frame, 'carry');
        const bridgeFrameDelta = computeClusterDebugLayerMotion(previousSample, frame, 'bridge');
        const maxFrameDelta = Math.max(
            breakoutFrameDelta,
            remainderFrameDelta,
            carryFrameDelta,
            bridgeFrameDelta
        );
        const sampleTimestamp = Number.isFinite(frame.frameTimestamp)
            ? frame.frameTimestamp
            : Date.now();
        const previousTimestamp = previousSample?.timestamp;
        const normalizedTimestamp = Number.isFinite(previousTimestamp)
            ? Math.max(
                previousTimestamp + 1,
                Math.min(sampleTimestamp, previousTimestamp + 33)
            )
            : sampleTimestamp;
        const nextSample = {
            timestamp: normalizedTimestamp,
            ...frame,
            summary: buildClusterDebugRenderSummary(frame),
            visibleLayers: visibleLayers.join(','),
            visibleLayerCount: visibleLayers.length,
            breakoutFrameDelta,
            remainderFrameDelta,
            carryFrameDelta,
            bridgeFrameDelta,
            maxFrameDelta,
        };

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
        clusterDebugExpectedStageRef.current = '';
        clusterDebugExpectedPhaseRef.current = '';
        setIsClusterDebugRecording(true);
    };

    const stopClusterDebugCapture = () => {
        const recordedSamples = clusterDebugSamplesRef.current;
        const recordedTransitionEvents = clusterDebugTransitionEventsRef.current;

        setIsClusterDebugRecording(false);
        lastClusterDebugSignatureRef.current = '';
        clusterDebugWatchedPrimaryIdRef.current = null;
        clusterDebugExpectedStageRef.current = '';
        clusterDebugExpectedPhaseRef.current = '';
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

            setClusterDebugProbeSummary('Probe: recording started. Holding for 150ms.');
            await waitForMilliseconds(CLUSTER_DEBUG_PROBE_RECORDING_DELAY);
            if (clusterDebugProbeRunIdRef.current !== runId) {
                return;
            }

            const timedOutStages = [];
            const totalZoomInSteps = probePlan.zoomInRegions.length;

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

            if (!areRegionsEquivalent(probePlan.zoomOutRegions[probePlan.zoomOutRegions.length - 1], probePlan.startRegion)) {
                setClusterDebugProbeSummary('Probe: restoring the original map view.');
                await animateClusterDebugProbeToRegion(probePlan.startRegion, runId);
            }

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

    const heldSplitByPrimary = new Map(
        heldSplitClusters.map(heldCluster => [heldCluster.primaryStationId, heldCluster])
    );
    const heldSplitDetachedIds = new Set(
        heldSplitClusters.flatMap(heldCluster => heldCluster.detachedStationIds)
    );
    const renderClusterEntries = [];

    clusters.forEach(cluster => {
        const primaryStationId = cluster.quotes[0].stationId;

        if (heldSplitDetachedIds.has(primaryStationId)) {
            return;
        }

        const heldCluster = heldSplitByPrimary.get(primaryStationId);

        if (heldCluster) {
            renderClusterEntries.push({
                key: primaryStationId,
                primaryStationId,
                cluster: heldCluster.fromCluster,
                pendingCluster: heldCluster.toCluster,
                runtimePhase: heldCluster.bridgeComplete ? 'split_wait_idle' : 'split_bridge_active',
            });
            return;
        }

        renderClusterEntries.push({
            key: primaryStationId,
            primaryStationId,
            cluster,
            pendingCluster: null,
            runtimePhase: 'live',
        });
    });

    const renderedPrimaryIds = new Set(renderClusterEntries.map(entry => entry.primaryStationId));

    heldSplitClusters.forEach(heldCluster => {
        if (renderedPrimaryIds.has(heldCluster.primaryStationId)) {
            return;
        }

        renderClusterEntries.push({
            key: heldCluster.primaryStationId,
            primaryStationId: heldCluster.primaryStationId,
            cluster: heldCluster.fromCluster,
            pendingCluster: heldCluster.toCluster,
            runtimePhase: heldCluster.bridgeComplete ? 'split_wait_idle' : 'split_bridge_active',
        });
    });

    const hasRenderableClusters = renderClusterEntries.length > 0;
    const expectedDebugEntry = renderClusterEntries.find(
        entry => entry.primaryStationId === activeClusterDebugPrimaryId
    ) || null;

    clusterDebugExpectedStageRef.current = expectedDebugEntry
        ? (
            expectedDebugEntry.pendingCluster
                ? `${buildClusterMembershipKey(expectedDebugEntry.cluster)}->${buildClusterMembershipKey(expectedDebugEntry.pendingCluster)}`
                : buildClusterMembershipKey(expectedDebugEntry.cluster)
        )
        : '';
    clusterDebugExpectedPhaseRef.current = expectedDebugEntry?.runtimePhase || '';

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
                    setMapMotionState(true);
                    setMapRegionIfNeeded(region);
                }}
                onRegionChangeComplete={(region) => {
                    setMapRegionIfNeeded(region);
                    isAnimatingRef.current = false;
                    setMapMotionState(false);
                    flushMapIdleWaiters(true);
                }}
            >
                {hasRenderableClusters ? (
                    <>
                        {renderClusterEntries.map(entry => (
                            <AnimatedMarkerOverlay
                                key={entry.key}
                                cluster={entry.cluster}
                                pendingCluster={entry.pendingCluster}
                                scrollX={scrollX}
                                itemWidth={itemWidth}
                                isDark={isDark}
                                themeColors={themeColors}
                                activeIndex={activeIndex}
                                onMarkerPress={handleMarkerPress}
                                onPendingClusterBridgeComplete={handleHeldSplitBridgeComplete}
                                onDebugTransitionEvent={recordClusterDebugTransitionEvent}
                                onDebugRenderFrame={recordClusterDebugRenderFrame}
                                isDebugWatched={entry.primaryStationId === activeClusterDebugPrimaryId}
                                isDebugRecording={isClusterDebugRecording}
                                runtimePhase={entry.runtimePhase}
                                mapRegion={mapRegion}
                            />
                        ))}
                    </>
                ) : (
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
                )}
            </MapView>

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
        minWidth: COLLAPSED_PRIMARY_WIDTH,
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
