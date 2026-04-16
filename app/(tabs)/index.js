import React, { startTransition, useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { AppState, FlatList, Pressable, StyleSheet, Text, View, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { GlassView } from 'expo-glass-effect';
import * as Location from 'expo-location';
import * as FileSystem from 'expo-file-system/legacy';
import MapView, { Marker, PROVIDER_APPLE } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppState } from '../../src/AppStateContext';
import FuelSummaryCard from '../../src/components/FuelSummaryCard';
import ClusterDebugCard from '../../src/components/ClusterDebugCard';
import TopCanopy from '../../src/components/TopCanopy';
import FuelUpHeaderLogo from '../../src/components/FuelUpHeaderLogo';
import ResetToCheapestButton from '../../src/components/ResetToCheapestButton';
import {
    getCachedFuelPriceSnapshot,
    getFuelFailureMessage,
    hasUsableCachedFuelWindow,
    isFuelCacheResetError,
    refreshFuelPriceSnapshot,
    refreshFuelPriceSnapshotWithTrajectoryFallback,
} from '../../src/services/fuel';
import { prefetchTrendData } from '../../src/services/fuel/trends';
import { useTheme } from '../../src/ThemeContext';
import { usePreferences } from '../../src/PreferencesContext';
import BottomCanopy from '../../src/components/BottomCanopy';
import ActiveStationOverlay from '../../src/components/cluster/ActiveStationOverlay';
import ClusterMarkerOverlay from '../../src/components/cluster/ClusterMarkerOverlay';
import StationMarker from '../../src/components/cluster/StationMarker';
import { consumeFreshLaunchMapBootstrap } from '../../src/lib/appLaunchState';
import {
    getLastDeviceLocationRegion,
    getLastDeviceLocationSnapshot,
    persistLastDeviceLocationRegion,
} from '../../src/lib/deviceLocationCache';
import {
    LOCATION_COLD_FETCH_TIMEOUT_MS,
    LOCATION_FAST_FETCH_TIMEOUT_MS,
    LOCATION_LAST_KNOWN_MAX_AGE_MS,
    LOCATION_LAST_KNOWN_REQUIRED_ACCURACY_METERS,
    LOCATION_MOVEMENT_THRESHOLD_METERS,
    buildRegionFromLocation,
    calculateDistanceMeters,
    hasMovedBeyondThreshold,
} from '../../src/lib/locationRefresh';
import {
    flushLocationProbeReportAsync,
    recordLocationProbeEvent,
} from '../../src/lib/locationProbe';
import { getLocationProbeLaunchOverrides } from '../../src/lib/locationProbeOverrides';
import { openStationNavigation } from '../../src/lib/openNavigation';
import {
    normalizeFuelGrade,
    rankQuotesForFuelGrade,
} from '../../src/lib/fuelGrade';
import {
    buildFuelSearchRequestKey,
    buildResolvedFuelSearchContext,
} from '../../src/lib/fuelSearchState';
import {
    buildPersistentSuppressedStationIds,
    buildHomeFilterSignature,
    buildHomeQuerySignature,
    buildVisibleSuppressedStationIds,
    filterStationQuotesForHome,
    hasHomeFilterSignatureChanged,
    resolveCommittedHomeActiveIndex,
    resolveHomeCardIndexFromOffset,
    shouldInitializeInitialSuppressionDelay,
    shouldDelayStationMarkerSuppression,
    shouldShowActiveStationDecoration,
    shouldAutoFitHomeMap,
    resolveHomeFuelSnapshotStrategy,
} from '../../src/lib/homeState';
import {
    canTriggerHomeLaunchReveal,
    shouldRevealDuringInitialHomeFit,
    shouldDelayHomeLaunchReveal,
} from '../../src/lib/homeLaunch';
import { getDrivingRouteAsync } from '../../src/lib/FuelUpMapKitRouting';
import { groupStationsIntoClusters } from '../../src/cluster/grouping';
import {
    CLUSTER_PILL_HEIGHT,
    CLUSTER_PRIMARY_PILL_WIDTH,
    CLUSTER_TOUCH_PILL_HEIGHT,
} from '../../src/cluster/constants';
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
const {
    MIN_PREFETCH_SPEED_MPS,
    buildTrajectorySeedFromLocationObject,
} = require('../../src/lib/trajectoryFuelFetch.js');

const DEFAULT_REGION = {
    latitude: 37.3346,
    longitude: -122.009,
    latitudeDelta: 0.05,
    longitudeDelta: 0.05,
};
const TAB_BAR_CLEARANCE = 34;
const CARD_GAP = 0;
const SIDE_MARGIN = 12;
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
const USER_LOCATION_BUBBLE_SIZE = 14;
const USER_LOCATION_OVERLAP_PILL_WIDTH = CLUSTER_PRIMARY_PILL_WIDTH - 28;
const USER_LOCATION_OVERLAP_PILL_HEIGHT = CLUSTER_PILL_HEIGHT - 14;
const SUPPRESSION_REVEAL_PADDING = 10;
const SUPPRESSION_REVEAL_STABILITY_MS = 360;
const STATION_FOCUS_MIN_LATITUDE_DELTA = 0.002;
const STATION_FOCUS_MIN_LONGITUDE_DELTA = 0.002;
const STATION_FOCUS_ZOOM_STEP_MULTIPLIER = 0.82;
const STATION_FOCUS_MAX_STEPS = 18;
const STATION_FOCUS_ANIMATION_MS = 420;
const FOREGROUND_RECENTER_ANIMATION_MS = 420;
const STATIONS_FIT_TOP_EXTRA_PADDING = 16;
const STATIONS_FIT_BOTTOM_CONTENT_PADDING = 140;
const STATIONS_FIT_SIDE_EXTRA_PADDING = 12;
const STATIONS_FIT_SETTLE_PASS_DELAY_MS = 260;
const STATIONS_FIT_UPWARD_BIAS_FACTOR = 0.03;
const INITIAL_HOME_SUPPRESSION_DELAY_MS = 900;
const INITIAL_STATIONS_FIT_MAX_ATTEMPTS = 4;
const INITIAL_STATIONS_FIT_RETRY_DELAY_MS = 120;
const INITIAL_SMOOTH_LAUNCH_TRANSITION_MAX_DISTANCE_METERS = 6000;
const LAUNCH_MOVEMENT_RECOVERY_TIMEOUT_MS = 5000;
const ENABLE_CLUSTER_MERGE_TRANSITIONS = false;
const HOME_DARK_GLASS_TINT = '#373737ff';
// Continuous tracking settings. The rules are intentionally minimal:
//   - The map is centered on the user at a fixed overview zoom (~8 miles
//     across). We never preserve the map's current delta when following,
//     so station fits never leave us with an unusable close-up.
//   - We subscribe with distanceInterval=0 and High accuracy so iOS emits
//     every GPS update available. timeInterval is iOS-ignored.
//   - A separate interval timer (the "driver") runs at 2 Hz and is
//     responsible for calling animateToRegion. This decouples camera
//     motion from GPS tick rate. Each driver tick uses position-based
//     velocity (computed from consecutive GPS fixes) to extrapolate the
//     user's current position and animate the camera there over a short
//     500 ms animation. Back-to-back short animations give the illusion
//     of continuous motion the same way Apple Maps does in its native
//     userTrackingMode=.follow mode.
//   - This is necessary because react-native-maps' `animateToRegion`
//     duration argument is effectively ignored on iOS: it wraps
//     `setRegion:animated:YES` in a UIView animation block but MKMapView
//     uses its own internal ~0.5 s animation, not UIView timing. So the
//     only way to get continuous motion is to chain many short MKMapView
//     animations together.
//   - A user pan pauses auto-follow for 10 s so the user can explore the
//     surrounding area without being yanked back.
//   - React state is only updated every 50 m of movement to keep the
//     render loop quiet while still refreshing distance-based filtering.
const LIVE_TRACKING_LATITUDE_DELTA = 0.12;
const LIVE_TRACKING_LONGITUDE_DELTA = 0.12;
const LIVE_TRACKING_DISTANCE_INTERVAL_METERS = 0;
const LIVE_TRACKING_DRIVER_INTERVAL_MS = 500;
const LIVE_TRACKING_DRIVER_ANIMATION_MS = 550;
// Cap how long we extrapolate past the most recent GPS fix. If GPS goes
// silent for a while (common on iOS Simulator with some location preset
// combinations) the camera will still smoothly glide for up to this many
// ms after the last known fix, then come to rest instead of running off
// indefinitely on a stale velocity.
const LIVE_TRACKING_MAX_EXTRAPOLATION_MS = 5000;
const LIVE_TRACKING_PAN_SUPPRESS_MS = 10_000;
const LIVE_TRACKING_STATE_UPDATE_METERS = 50;
// Minimum gap between back-to-back device-watch refetches. Without this
// throttle, a fast-moving user keeps crossing the safe edge of the
// cached window on consecutive GPS ticks, and `handleLiveLocationUpdate`
// fires a new fetch each time — they stack up, each one replaces the
// previous state with a point-centered snapshot, and the feed looks
// sparse in the middle because the in-flight fetches never get to
// settle before the next one wipes their data out. 1.5 s is long
// enough for a trajectory fetch to resolve before we queue the next
// one, but short enough that the feed stays fresh during normal
// driving speeds.
const LIVE_TRACKING_REFETCH_MIN_INTERVAL_MS = 1500;
// Speed floor below which we don't bother computing a trajectory seed
// from differencing velocity. `MIN_PREFETCH_SPEED_MPS` is the same
// threshold the trajectory planner uses to decide whether prefetching
// is worthwhile at all.
const LIVE_TRACKING_TRAJECTORY_MIN_SPEED_MPS = MIN_PREFETCH_SPEED_MPS;

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

function hasUsableHomeRegion(region) {
    return Boolean(
        Number.isFinite(region?.latitude) &&
        Number.isFinite(region?.longitude)
    );
}

// Build a trajectory seed (`{ latitude, longitude, courseDegrees,
// speedMps }`) from the differencing velocity we compute inside
// `handleLiveLocationUpdate`. The live tracker stores velocity in
// degrees-per-millisecond so the 2 Hz animation driver can extrapolate
// without allocations; here we convert it back to speed + bearing so
// the trajectory fetch planner can use it.
//
// Returns null if we don't have enough motion to justify an ahead-fetch
// — slower than LIVE_TRACKING_TRAJECTORY_MIN_SPEED_MPS or a zero
// velocity vector (user is stationary / just opened the app). The
// caller falls back to `buildTrajectorySeedFromLocationObject`, which
// reads GPS `coords.course/speed` when those are valid.
function buildTrajectorySeedFromVelocity({ latitude, longitude, velocity }) {
    if (
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        !velocity
    ) {
        return null;
    }

    const latPerMs = Number(velocity.latPerMs);
    const lngPerMs = Number(velocity.lngPerMs);

    if (
        !Number.isFinite(latPerMs) ||
        !Number.isFinite(lngPerMs) ||
        (latPerMs === 0 && lngPerMs === 0)
    ) {
        return null;
    }

    const metersPerDegreeLatitude = 111_320;
    const metersPerDegreeLongitude = 111_320 * Math.cos((latitude * Math.PI) / 180);
    const latMetersPerSecond = latPerMs * 1000 * metersPerDegreeLatitude;
    const lngMetersPerSecond = lngPerMs * 1000 * metersPerDegreeLongitude;
    const speedMps = Math.sqrt(
        latMetersPerSecond * latMetersPerSecond +
        lngMetersPerSecond * lngMetersPerSecond
    );

    if (!Number.isFinite(speedMps) || speedMps < LIVE_TRACKING_TRAJECTORY_MIN_SPEED_MPS) {
        return null;
    }

    const courseDegreesRaw = (Math.atan2(lngMetersPerSecond, latMetersPerSecond) * 180) / Math.PI;
    const courseDegrees = ((courseDegreesRaw % 360) + 360) % 360;

    return {
        latitude,
        longitude,
        courseDegrees,
        speedMps,
    };
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

function getDistanceMetersBetweenRegions(fromRegion, toRegion) {
    if (!fromRegion || !toRegion) {
        return Number.POSITIVE_INFINITY;
    }

    const fromLatitude = Number(fromRegion.latitude);
    const fromLongitude = Number(fromRegion.longitude);
    const toLatitude = Number(toRegion.latitude);
    const toLongitude = Number(toRegion.longitude);

    if (
        !Number.isFinite(fromLatitude) ||
        !Number.isFinite(fromLongitude) ||
        !Number.isFinite(toLatitude) ||
        !Number.isFinite(toLongitude)
    ) {
        return Number.POSITIVE_INFINITY;
    }

    const toRadians = degrees => degrees * (Math.PI / 180);
    const earthRadiusMeters = 6371000;
    const latitudeDeltaRadians = toRadians(toLatitude - fromLatitude);
    const longitudeDeltaRadians = toRadians(toLongitude - fromLongitude);
    const fromLatitudeRadians = toRadians(fromLatitude);
    const toLatitudeRadians = toRadians(toLatitude);
    const haversineA = (
        Math.sin(latitudeDeltaRadians / 2) ** 2 +
        Math.cos(fromLatitudeRadians) *
        Math.cos(toLatitudeRadians) *
        Math.sin(longitudeDeltaRadians / 2) ** 2
    );
    const haversineC = 2 * Math.atan2(Math.sqrt(haversineA), Math.sqrt(1 - haversineA));

    return earthRadiusMeters * haversineC;
}

function shouldAnimateSmoothLaunchTransition(fromRegion, toRegion) {
    return getDistanceMetersBetweenRegions(fromRegion, toRegion) <= INITIAL_SMOOTH_LAUNCH_TRANSITION_MAX_DISTANCE_METERS;
}

function waitForMillisecondsWithValue(value, durationMs) {
    return new Promise(resolve => {
        setTimeout(() => resolve(value), durationMs);
    });
}

/**
 * Fetch the device's last-known position with a hard timeout. This is the
 * fast path we use on cold launch and foreground resume because it returns
 * immediately from the platform's cached reading instead of firing up GPS.
 * Anything slower would add perceptible startup delay, so we short-circuit
 * with `null` as soon as the timeout elapses.
 */
async function fetchLastKnownPositionWithTimeout({
    timeoutMs = LOCATION_FAST_FETCH_TIMEOUT_MS,
    maxAgeMs = LOCATION_LAST_KNOWN_MAX_AGE_MS,
    requiredAccuracyMeters = LOCATION_LAST_KNOWN_REQUIRED_ACCURACY_METERS,
} = {}) {
    try {
        const launchOverrides = getLocationProbeLaunchOverrides();

        if (__DEV__ && launchOverrides.forceNullLastKnownPosition) {
            recordLocationProbeEvent({
                type: 'last-known-position-overridden-null',
            });
            return null;
        }

        const lastKnownPromise = Location
            .getLastKnownPositionAsync({
                maxAge: maxAgeMs,
                requiredAccuracy: requiredAccuracyMeters,
            })
            .catch(() => null);
        const timeoutPromise = waitForMillisecondsWithValue(null, timeoutMs);

        return await Promise.race([lastKnownPromise, timeoutPromise]);
    } catch (error) {
        return null;
    }
}

/**
 * Fall back to `getCurrentPositionAsync` with a low-accuracy / short-timeout
 * request. We only call this when the device has no usable last-known
 * reading (typically first ever launch). The promise never rejects; it
 * resolves to `null` on timeout or error so callers can cleanly fall back
 * to cached data.
 */
async function fetchCurrentPositionWithTimeout({
    timeoutMs = LOCATION_COLD_FETCH_TIMEOUT_MS,
    accuracy = Location.Accuracy.Low,
} = {}) {
    try {
        recordLocationProbeEvent({
            type: 'current-position-fetch-start',
            details: {
                timeoutMs,
                accuracy,
            },
        });

        const currentPromise = Location
            .getCurrentPositionAsync({
                accuracy,
            })
            .catch(() => null);
        const timeoutPromise = waitForMillisecondsWithValue(null, timeoutMs);
        const resolvedPositionObject = await Promise.race([currentPromise, timeoutPromise]);

        recordLocationProbeEvent({
            type: 'current-position-fetch-end',
            details: {
                timeoutMs,
                accuracy,
                hasFix: Boolean(resolvedPositionObject),
            },
        });

        return resolvedPositionObject;
    } catch (error) {
        recordLocationProbeEvent({
            type: 'current-position-fetch-end',
            details: {
                timeoutMs,
                accuracy,
                hasFix: false,
                error: error?.message || String(error || 'unknown-error'),
            },
        });
        return null;
    }
}

/**
 * Resolve the position object used by the cold-launch movement check.
 *
 * We prefer the platform's last-known cache because it's effectively
 * instant. If the OS has no usable last-known reading yet, fall back to a
 * bounded low-accuracy current-position request so a stale cached city does
 * not survive the whole launch. This preserves the fast path while still
 * fixing the "reopen after travel before iOS rebuilds last-known" case.
 */
async function resolveLaunchMovementCheckPosition({
    currentFallbackTimeoutMs = LOCATION_COLD_FETCH_TIMEOUT_MS,
} = {}) {
    const lastKnownPositionObject = await fetchLastKnownPositionWithTimeout({
        timeoutMs: LOCATION_FAST_FETCH_TIMEOUT_MS,
        maxAgeMs: LOCATION_LAST_KNOWN_MAX_AGE_MS,
        requiredAccuracyMeters: LOCATION_LAST_KNOWN_REQUIRED_ACCURACY_METERS,
    });

    if (lastKnownPositionObject) {
        return {
            positionObject: lastKnownPositionObject,
            resolver: 'last-known',
        };
    }

    const currentPositionObject = await fetchCurrentPositionWithTimeout({
        timeoutMs: currentFallbackTimeoutMs,
        accuracy: Location.Accuracy.Low,
    });

    return {
        positionObject: currentPositionObject,
        resolver: currentPositionObject ? 'current-fallback' : 'none',
    };
}

function startLaunchMovementCheck({
    currentFallbackTimeoutMs = LOCATION_COLD_FETCH_TIMEOUT_MS,
} = {}) {
    const fastResultPromise = fetchLastKnownPositionWithTimeout({
        timeoutMs: LOCATION_FAST_FETCH_TIMEOUT_MS,
        maxAgeMs: LOCATION_LAST_KNOWN_MAX_AGE_MS,
        requiredAccuracyMeters: LOCATION_LAST_KNOWN_REQUIRED_ACCURACY_METERS,
    }).then(lastKnownPositionObject => (
        lastKnownPositionObject
            ? {
                positionObject: lastKnownPositionObject,
                resolver: 'last-known',
            }
            : {
                positionObject: null,
                resolver: 'none',
            }
    ));

    const completionPromise = fastResultPromise.then(async (fastResult) => {
        if (fastResult.positionObject) {
            return fastResult;
        }

        const currentPositionObject = await fetchCurrentPositionWithTimeout({
            timeoutMs: currentFallbackTimeoutMs,
            accuracy: Location.Accuracy.Low,
        });

        return {
            positionObject: currentPositionObject,
            resolver: currentPositionObject ? 'current-fallback' : 'none',
        };
    });

    return {
        fastResultPromise,
        completionPromise,
    };
}

function buildSingleQuoteClusters(stationQuotes) {
    return (stationQuotes || []).map(quote => ({
        quotes: [quote],
        averageLat: quote.latitude,
        averageLng: quote.longitude,
    }));
}

function doRectsTouch(left, right) {
    return (
        left.left <= right.right &&
        left.right >= right.left &&
        left.top <= right.bottom &&
        left.bottom >= right.top
    );
}

function expandRect(rect, padding) {
    if (!rect || !Number.isFinite(padding) || padding <= 0) {
        return rect;
    }

    return {
        left: rect.left - padding,
        right: rect.right + padding,
        top: rect.top - padding,
        bottom: rect.bottom + padding,
    };
}

function areStationIdSetsEqual(left, right) {
    if (left === right) {
        return true;
    }

    if (!left || !right || left.size !== right.size) {
        return false;
    }

    for (const value of left) {
        if (!right.has(value)) {
            return false;
        }
    }

    return true;
}

function buildSuppressedOverlapStationIds(
    stationQuotes,
    mapRegion,
    screenWidth,
    screenHeight,
    userLocation = null,
    previousSuppressedStationIds = null,
    activeStationId = null
) {
    if (!Array.isArray(stationQuotes) || stationQuotes.length <= 1 || !mapRegion) {
        return new Set();
    }

    const ptPerLng = mapRegion.longitudeDelta ? screenWidth / mapRegion.longitudeDelta : 0;
    const ptPerLat = mapRegion.latitudeDelta ? screenHeight / mapRegion.latitudeDelta : 0;
    const centerLng = mapRegion.longitude || 0;
    const centerLat = mapRegion.latitude || 0;
    const orderedQuotes = [...stationQuotes].sort((left, right) => {
        if (left.price !== right.price) {
            return left.price - right.price;
        }
        return String(left.stationId).localeCompare(String(right.stationId));
    });

    const visibleRects = [];
    const suppressedIds = new Set();
    const previousSuppressedIds = previousSuppressedStationIds instanceof Set
        ? previousSuppressedStationIds
        : new Set(previousSuppressedStationIds || []);
    const normalizedActiveStationId = activeStationId == null ? null : String(activeStationId);
    const hasValidUserLocation = (
        typeof userLocation?.latitude === 'number' &&
        typeof userLocation?.longitude === 'number'
    );
    const userLocationRect = hasValidUserLocation
        ? {
            left: (userLocation.longitude - centerLng) * ptPerLng - USER_LOCATION_BUBBLE_SIZE / 2,
            right: (userLocation.longitude - centerLng) * ptPerLng + USER_LOCATION_BUBBLE_SIZE / 2,
            top: -((userLocation.latitude - centerLat) * ptPerLat) - USER_LOCATION_BUBBLE_SIZE / 2,
            bottom: -((userLocation.latitude - centerLat) * ptPerLat) + USER_LOCATION_BUBBLE_SIZE / 2,
        }
        : null;

    orderedQuotes.forEach(quote => {
        const stationIdString = String(quote.stationId);
        const isActiveStation = normalizedActiveStationId != null &&
            stationIdString === normalizedActiveStationId;
        const x = (quote.longitude - centerLng) * ptPerLng;
        const y = -(quote.latitude - centerLat) * ptPerLat;
        const rect = {
            left: x - CLUSTER_PRIMARY_PILL_WIDTH / 2,
            right: x + CLUSTER_PRIMARY_PILL_WIDTH / 2,
            top: y - CLUSTER_TOUCH_PILL_HEIGHT / 2,
            bottom: y + CLUSTER_TOUCH_PILL_HEIGHT / 2,
        };
        const userOverlapRect = {
            left: x - USER_LOCATION_OVERLAP_PILL_WIDTH / 2,
            right: x + USER_LOCATION_OVERLAP_PILL_WIDTH / 2,
            top: y - USER_LOCATION_OVERLAP_PILL_HEIGHT / 2,
            bottom: y + USER_LOCATION_OVERLAP_PILL_HEIGHT / 2,
        };

        const overlapsVisible = visibleRects.some(visibleRect => doRectsTouch(rect, visibleRect));
        const shouldKeepSuppressedForRevealSpacing = previousSuppressedIds.has(stationIdString) &&
            visibleRects.some(visibleRect => doRectsTouch(rect, expandRect(visibleRect, SUPPRESSION_REVEAL_PADDING)));
        const overlapsUserLocationBubble = userLocationRect
            ? doRectsTouch(userOverlapRect, userLocationRect)
            : false;
        const shouldKeepSuppressedNearUserLocation = previousSuppressedIds.has(stationIdString) && userLocationRect
            ? doRectsTouch(userOverlapRect, expandRect(userLocationRect, SUPPRESSION_REVEAL_PADDING))
            : false;
        // The station the user just explicitly focused (by tapping its marker or
        // scrolling the carousel to it) always bypasses every suppression rule —
        // reveal-spacing stability AND the underlying hard-overlap check. At the
        // densest real-world zoom the map allows, two stations can still sit on top
        // of each other (e.g. adjacent gas stations on opposite corners of an
        // intersection), and without this bypass the chip the user is trying to
        // view would stay stuck hidden. Because ActiveStationOverlay is rendered
        // with a higher z-index than the base StationMarkers, the active pill reads
        // clearly even when the underlying pills visually overlap.
        if (
            !isActiveStation && (
                overlapsVisible ||
                overlapsUserLocationBubble ||
                shouldKeepSuppressedForRevealSpacing ||
                shouldKeepSuppressedNearUserLocation
            )
        ) {
            suppressedIds.add(stationIdString);
            return;
        }

        visibleRects.push(rect);
    });

    return suppressedIds;
}

function resolveStationFocusZoom({
    targetQuote,
    stationQuotes,
    baseFitRegion,
    screenWidth,
    screenHeight,
    userLocation = null,
}) {
    if (
        !targetQuote ||
        !Array.isArray(stationQuotes) ||
        stationQuotes.length === 0
    ) {
        return {
            latitudeDelta: STATION_FOCUS_MIN_LATITUDE_DELTA,
            longitudeDelta: STATION_FOCUS_MIN_LONGITUDE_DELTA,
        };
    }

    const targetStationId = String(targetQuote.stationId);
    let latitudeDelta = Math.max(
        STATION_FOCUS_MIN_LATITUDE_DELTA,
        Number(baseFitRegion?.latitudeDelta) || STATION_FOCUS_MIN_LATITUDE_DELTA
    );
    let longitudeDelta = Math.max(
        STATION_FOCUS_MIN_LONGITUDE_DELTA,
        Number(baseFitRegion?.longitudeDelta) || STATION_FOCUS_MIN_LONGITUDE_DELTA
    );

    for (let step = 0; step < STATION_FOCUS_MAX_STEPS; step += 1) {
        const candidateRegion = {
            latitude: targetQuote.latitude,
            longitude: targetQuote.longitude,
            latitudeDelta,
            longitudeDelta,
        };
        const suppressedIds = buildSuppressedOverlapStationIds(
            stationQuotes,
            candidateRegion,
            screenWidth,
            screenHeight,
            userLocation
        );

        if (!suppressedIds.has(targetStationId)) {
            return { latitudeDelta, longitudeDelta };
        }

        const nextLatitudeDelta = Math.max(
            STATION_FOCUS_MIN_LATITUDE_DELTA,
            latitudeDelta * STATION_FOCUS_ZOOM_STEP_MULTIPLIER
        );
        const nextLongitudeDelta = Math.max(
            STATION_FOCUS_MIN_LONGITUDE_DELTA,
            longitudeDelta * STATION_FOCUS_ZOOM_STEP_MULTIPLIER
        );

        if (nextLatitudeDelta === latitudeDelta && nextLongitudeDelta === longitudeDelta) {
            break;
        }

        latitudeDelta = nextLatitudeDelta;
        longitudeDelta = nextLongitudeDelta;
    }

    return { latitudeDelta, longitudeDelta };
}

function buildStationsFitZoomRegion(stationQuotes, fallbackRegion = null) {
    const validQuotes = (stationQuotes || []).filter(quote => (
        Number.isFinite(quote?.latitude) &&
        Number.isFinite(quote?.longitude)
    ));

    if (validQuotes.length === 0) {
        return {
            latitudeDelta: Math.max(
                STATION_FOCUS_MIN_LATITUDE_DELTA,
                Number(fallbackRegion?.latitudeDelta) || STATION_FOCUS_MIN_LATITUDE_DELTA
            ),
            longitudeDelta: Math.max(
                STATION_FOCUS_MIN_LONGITUDE_DELTA,
                Number(fallbackRegion?.longitudeDelta) || STATION_FOCUS_MIN_LONGITUDE_DELTA
            ),
        };
    }

    let minLat = validQuotes[0].latitude;
    let maxLat = validQuotes[0].latitude;
    let minLng = validQuotes[0].longitude;
    let maxLng = validQuotes[0].longitude;

    validQuotes.forEach(quote => {
        minLat = Math.min(minLat, quote.latitude);
        maxLat = Math.max(maxLat, quote.latitude);
        minLng = Math.min(minLng, quote.longitude);
        maxLng = Math.max(maxLng, quote.longitude);
    });

    const latSpan = Math.max(0, maxLat - minLat);
    const lngSpan = Math.max(0, maxLng - minLng);

    return {
        latitudeDelta: Math.max(STATION_FOCUS_MIN_LATITUDE_DELTA, latSpan * 1.55, 0.008),
        longitudeDelta: Math.max(STATION_FOCUS_MIN_LONGITUDE_DELTA, lngSpan * 1.55, 0.008),
    };
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

function AnimatedCardItem({
    item,
    index,
    scrollX,
    itemWidth,
    isDark,
    benchmarkQuote,
    errorMsg,
    isRefreshing,
    themeColors,
    glassTintColor,
    fuelGrade,
    onNavigatePress,
}) {
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
                fuelGrade={fuelGrade}
                glassTintColor={glassTintColor}
                isDark={isDark}
                isRefreshing={isRefreshing}
                quote={item}
                themeColors={themeColors}
                rank={index + 1}
                onNavigatePress={onNavigatePress}
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
    const shouldUseLaunchLocationBootstrapRef = useRef(consumeFreshLaunchMapBootstrap());
    const launchCachedRegionRef = useRef(null);
    const pendingInstantMapRegionRef = useRef(null);
    const pendingSuppressionRegionRef = useRef(null);
    const suppressionRegionAnimationFrameRef = useRef(null);
    const mapIdleWaitersRef = useRef([]);
    const mapIdleSettleTimeoutRef = useRef(null);
    const fitSettlePassTimeoutRef = useRef(null);
    const suppressionRevealDelayTimeoutRef = useRef(null);
    const mapRegionRef = useRef(DEFAULT_REGION);
    const suppressionRegionRef = useRef(DEFAULT_REGION);
    const previousSuppressedStationIdsRef = useRef(new Set());
    const previousSuppressedStationSignatureRef = useRef('');
    const lastClusterDebugSignatureRef = useRef('');
    const clusterDebugSamplesRef = useRef([]);
    const clusterDebugTransitionEventsRef = useRef([]);
    const clusterDebugTransitionEventKeysRef = useRef(new Set());
    const clusterDebugWatchedPrimaryIdRef = useRef(null);
    const clusterDebugProbeModeRef = useRef('idle');
    const clusterDebugProbeRunIdRef = useRef(0);
    const clusterDebugAutoProbeHandledKeyRef = useRef('');
    const clusterDebugAutoProbeSeededKeyRef = useRef('');
    const lastResolvedHomeQuerySignatureRef = useRef('');
    const activeHomeQuerySignatureRef = useRef('');
    const lastVisibleHomeRequestKeyRef = useRef('');
    const isFocusedRef = useRef(false);
    const isFirstLaunchWithoutCachedRegionRef = useRef(false);
    const launchVisualReadyRequestIdRef = useRef(0);
    const isLaunchVisualReadyRef = useRef(false);
    const isLaunchCriticalFitPendingRef = useRef(false);
    const initialSuppressionDelayTimeoutRef = useRef(null);
    const launchMovementCheckRef = useRef(null);
    const launchCachedCapturedAtRef = useRef(null);
    const lastDeviceLocationCheckAtRef = useRef(0);
    const isDeviceLocationCheckInFlightRef = useRef(false);
    const appStateRef = useRef(AppState.currentState);
    const hasBeenBackgroundedSinceLastActiveRef = useRef(false);
    const pendingForegroundResumeCheckRef = useRef(false);
    const isFocused = useIsFocused();
    const insets = useSafeAreaInsets();
    const { isDark, themeColors } = useTheme();
    const homeGlassTintColor = isDark ? HOME_DARK_GLASS_TINT : '#FFFFFF';
    const {
        preferences,
        fuelSearchCriteriaSignature,
        normalizedFuelSearchPreferences,
    } = usePreferences();
    const {
        fuelResetToken,
        manualLocationOverride,
        resolvedFuelSearchContext,
        setFuelDebugState,
        setResolvedFuelSearchContext,
        clusterProbeRequest,
        isClusterProbeSessionActive,
        finishClusterProbeSession,
        hasCompletedRootReveal,
        holdRootReveal,
        startRootReveal,
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
    const [initialMapRegion, setInitialMapRegion] = useState(DEFAULT_REGION);
    const [isInitialMapRegionReady, setIsInitialMapRegionReady] = useState(false);
    const [isMapLoaded, setIsMapLoaded] = useState(false);
    const [activeIndex, setActiveIndex] = useState(0);
    const [mapRegion, setMapRegion] = useState(DEFAULT_REGION);
    const [mapRenderRegion, setMapRenderRegion] = useState(DEFAULT_REGION);
    const [suppressionRegion, setSuppressionRegion] = useState(DEFAULT_REGION);
    const [userLocationBubble, setUserLocationBubble] = useState(null);
    const [isMapMoving, setIsMapMoving] = useState(false);
    const [hasInitializedInitialSuppressionDelay, setHasInitializedInitialSuppressionDelay] = useState(false);
    const [isInitialSuppressionDelayActive, setIsInitialSuppressionDelayActive] = useState(false);
    const [initialSuppressionDelayStationIds, setInitialSuppressionDelayStationIds] = useState(new Set());
    const [effectiveSuppressedStationIds, setEffectiveSuppressedStationIds] = useState(new Set());
    const [isSuppressionRevealAllowed, setIsSuppressionRevealAllowed] = useState(false);
    const [isLaunchVisualReady, setIsLaunchVisualReady] = useState(false);
    const [isLaunchCriticalFitPending, setIsLaunchCriticalFitPending] = useState(false);
    const [homeRefitRequestVersion, setHomeRefitRequestVersion] = useState(0);
    const [homeLayoutSettlementVersion, setHomeLayoutSettlementVersion] = useState(0);
    const [stagedHomeRefitRequest, setStagedHomeRefitRequest] = useState(null);
    const [isClusterDebugRecording, setIsClusterDebugRecording] = useState(false);
    const [isClusterDebugProbeRunning, setIsClusterDebugProbeRunning] = useState(false);
    const [clusterDebugProbeSummary, setClusterDebugProbeSummary] = useState('');
    const hasTriggeredInitialRevealRef = useRef(false);
    const pendingHomeRefitRequestRef = useRef(null);
    const renderedHomeRefitRequestVersionRef = useRef(0);
    const lastAppliedHomeFilterSignatureRef = useRef('');
    const isInitialStationsFitScheduledRef = useRef(false);
    const isQueuedHomeRefitScheduledRef = useRef(false);
    const initialStationsFitRetryTimeoutRef = useRef(null);
    const prefetchedTrendRequestKeysRef = useRef(new Set());
    const mapLoadedFallbackTimeoutRef = useRef(null);
    const lastSettledCardIndexRef = useRef(0);
    const activeIndexRef = useRef(0);
    const hasVisibleFuelStateRef = useRef(false);
    const router = useRouter();
    const scrollX = useSharedValue(0);

    useEffect(() => {
        activeIndexRef.current = activeIndex;
    }, [activeIndex]);

    useEffect(() => {
        hasVisibleFuelStateRef.current = Boolean(bestQuote) || topStations.length > 0 || regionalQuotes.length > 0;
    }, [bestQuote, regionalQuotes.length, topStations.length]);

    const USE_SHEET_UX = false; // Temporary toggle for the Form Sheet UX experiment

    const bottomPadding = insets.bottom + TAB_BAR_CLEARANCE + CARD_GAP;
    const horizontalPadding = {
        left: insets.left + SIDE_MARGIN,
        right: insets.right + SIDE_MARGIN,
    };
    const topCanopyHeight = insets.top + TOP_CANOPY_HEIGHT;
    const canopyEdgeLine = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.42)';
    const selectedFuelGrade = normalizeFuelGrade(normalizedFuelSearchPreferences.preferredOctane);
    const searchRadiusMiles = normalizedFuelSearchPreferences.searchRadiusMiles;
    const preferredProvider = normalizedFuelSearchPreferences.preferredProvider;
    const minimumRating = normalizedFuelSearchPreferences.minimumRating;
    const navigationApp = normalizedFuelSearchPreferences.navigationApp;
    const buildResolvedHomeQuerySignature = useCallback((nextRegion) => buildHomeQuerySignature({
        origin: nextRegion,
        radiusMiles: searchRadiusMiles,
        fuelGrade: selectedFuelGrade,
        preferredProvider,
    }), [
        preferredProvider,
        searchRadiusMiles,
        selectedFuelGrade,
    ]);
    const currentHomeFilterSignature = fuelSearchCriteriaSignature || buildHomeFilterSignature({
        radiusMiles: searchRadiusMiles,
        fuelGrade: selectedFuelGrade,
        preferredProvider,
        minimumRating,
    });
    const currentVisibleHomeRequestKey = useMemo(() => buildFuelSearchRequestKey({
        origin: location,
        fuelGrade: selectedFuelGrade,
        radiusMiles: searchRadiusMiles,
        preferredProvider,
    }), [
        location,
        preferredProvider,
        searchRadiusMiles,
        selectedFuelGrade,
    ]);
    // We used to compute `isShowingStaleHomeRequestData` here to blank the
    // feed when the request key changed. That flip-flopped during tracking
    // because the request key changes every time the user crosses a
    // 2-decimal grid cell (~1.1 km), causing single-frame flashes of the
    // "No Prices Returned" fallback marker. The new rule is simpler: keep
    // showing whatever the last fetch returned until a fresh snapshot
    // replaces it. The tracker's cache-window refetch keeps data fresh.

    const handleStationNavigatePress = useCallback((stationQuote) => {
        if (!stationQuote) {
            return;
        }
        void openStationNavigation({
            latitude: stationQuote.latitude,
            longitude: stationQuote.longitude,
            label: stationQuote.stationName,
            navigationApp,
        });
    }, [navigationApp]);

    const markMapLoaded = () => {
        if (mapLoadedFallbackTimeoutRef.current) {
            clearTimeout(mapLoadedFallbackTimeoutRef.current);
            mapLoadedFallbackTimeoutRef.current = null;
        }

        setIsMapLoaded(currentValue => {
            if (!currentValue) {
                recordLocationProbeEvent({
                    type: 'map-loaded',
                });
            }
            return currentValue || true;
        });
    };

    useEffect(() => {
        isFocusedRef.current = isFocused;
    }, [isFocused]);

    useEffect(() => {
        return () => {
            if (suppressionRegionAnimationFrameRef.current != null) {
                cancelAnimationFrame(suppressionRegionAnimationFrameRef.current);
                suppressionRegionAnimationFrameRef.current = null;
            }

            if (initialSuppressionDelayTimeoutRef.current) {
                clearTimeout(initialSuppressionDelayTimeoutRef.current);
                initialSuppressionDelayTimeoutRef.current = null;
            }

            if (suppressionRevealDelayTimeoutRef.current) {
                clearTimeout(suppressionRevealDelayTimeoutRef.current);
                suppressionRevealDelayTimeoutRef.current = null;
            }

            if (fitSettlePassTimeoutRef.current) {
                clearTimeout(fitSettlePassTimeoutRef.current);
                fitSettlePassTimeoutRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        isLaunchVisualReadyRef.current = isLaunchVisualReady;
    }, [isLaunchVisualReady]);

    useEffect(() => {
        isLaunchCriticalFitPendingRef.current = isLaunchCriticalFitPending;
    }, [isLaunchCriticalFitPending]);

    useEffect(() => {
        if (!stagedHomeRefitRequest) {
            return;
        }

        queueHomeRefitRequest(stagedHomeRefitRequest);
        setStagedHomeRefitRequest(null);
    }, [stagedHomeRefitRequest]);

    const applySnapshot = (snapshot, nextRefitRequest = null) => {
        if (!snapshot?.quote || !isMountedRef.current) {
            return;
        }

        startTransition(() => {
            setBestQuote(snapshot.quote);
            setTopStations(snapshot.topStations || []);
            setRegionalQuotes(snapshot.regionalQuotes || []);
            if (nextRefitRequest) {
                setStagedHomeRefitRequest(nextRefitRequest);
            }
        });
    };

    const updateResolvedFuelSearchContext = useCallback((origin, locationSource = 'device') => {
        const nextContext = buildResolvedFuelSearchContext({
            origin,
            locationSource,
            fuelGrade: selectedFuelGrade,
            radiusMiles: searchRadiusMiles,
            preferredProvider,
            minimumRating,
        });

        if (!nextContext) {
            return;
        }

        setResolvedFuelSearchContext(nextContext);
    }, [
        minimumRating,
        preferredProvider,
        searchRadiusMiles,
        selectedFuelGrade,
        setResolvedFuelSearchContext,
    ]);

    const clearVisibleHomeResultsForReload = useCallback(() => {
        if (!isMountedRef.current) {
            return;
        }

        startTransition(() => {
            setBestQuote(null);
            setTopStations([]);
            setRegionalQuotes([]);
            setStagedHomeRefitRequest(null);
        });
        setErrorMsg(null);
        setIsRefreshingPrices(true);
    }, []);

    const clearVisibleFuelState = (nextError = null) => {
        startTransition(() => {
            setBestQuote(null);
            setTopStations([]);
            setRegionalQuotes([]);
            setStagedHomeRefitRequest(null);
        });
        if (initialSuppressionDelayTimeoutRef.current) {
            clearTimeout(initialSuppressionDelayTimeoutRef.current);
            initialSuppressionDelayTimeoutRef.current = null;
        }
        setIsInitialSuppressionDelayActive(false);
        setErrorMsg(nextError);
        setIsRefreshingPrices(false);
        setIsLoadingLocation(false);
        hasTriggeredInitialRevealRef.current = false;
        clearPendingHomeRefitRequest();
        cancelInitialHomeFitRetries();
        lastDataHashRef.current = '';
        lastResolvedHomeQuerySignatureRef.current = '';
        activeHomeQuerySignatureRef.current = '';
        lastAppliedHomeFilterSignatureRef.current = '';
        launchVisualReadyRequestIdRef.current += 1;
        setIsLaunchCriticalFitPending(false);
        setIsLaunchVisualReady(!isFirstLaunchWithoutCachedRegionRef.current);
        setHomeRefitRequestVersion(0);
        holdRootReveal();

        if (
            isFirstLaunchWithoutCachedRegionRef.current &&
            !hasTriggeredInitialRevealRef.current
        ) {
            void requestLaunchVisualReadyAfterIdle();
        }
    };

    const triggerRevealOnMapLoaded = () => {
        if (!isMountedRef.current || !isFocused) {
            return;
        }

        hasTriggeredInitialRevealRef.current = true;
        startRootReveal();
    };

    const applyResolvedRegion = (nextRegion) => {
        if (!isMountedRef.current || !nextRegion) {
            return;
        }

        setLocation(currentRegion => (
            areRegionsEquivalent(currentRegion, nextRegion)
                ? currentRegion
                : nextRegion
        ));
        setMapRegionIfNeeded(nextRegion);
    };

    const recordLocationAppliedProbeEvent = (nextRegion, source, extraDetails = null) => {
        if (!nextRegion) {
            return;
        }

        recordLocationProbeEvent({
            type: 'location-applied',
            details: {
                region: {
                    latitude: Number(nextRegion.latitude),
                    longitude: Number(nextRegion.longitude),
                },
                source,
                ...(extraDetails || {}),
            },
        });
    };

    const popMapToRegionWithoutAnimation = (nextRegion) => {
        if (!nextRegion) {
            return;
        }

        pendingInstantMapRegionRef.current = nextRegion;

        recordLocationProbeEvent({
            type: 'pop-map-to-region-requested',
            details: {
                region: {
                    latitude: Number(nextRegion.latitude),
                    longitude: Number(nextRegion.longitude),
                },
                hasMapRef: Boolean(mapRef.current),
                isMapLoaded,
            },
        });

        if (!mapRef.current || !isMapLoaded) {
            return;
        }

        mapRef.current.animateToRegion(nextRegion, 0);
        pendingInstantMapRegionRef.current = null;

        recordLocationProbeEvent({
            type: 'pop-map-to-region-applied',
            details: {
                region: {
                    latitude: Number(nextRegion.latitude),
                    longitude: Number(nextRegion.longitude),
                },
            },
        });
    };

    const animateMapToRegion = (nextRegion, duration = FOREGROUND_RECENTER_ANIMATION_MS) => {
        if (
            !nextRegion ||
            !mapRef.current ||
            !isMapLoaded ||
            areRegionsEquivalent(mapRegionRef.current, nextRegion)
        ) {
            return;
        }

        isAnimatingRef.current = true;
        setMapMotionState(true);
        mapRef.current.animateToRegion(nextRegion, duration);
    };

    const getOrStartLaunchMovementCheck = ({
        currentFallbackTimeoutMs = LOCATION_COLD_FETCH_TIMEOUT_MS,
    } = {}) => {
        if (!launchMovementCheckRef.current) {
            launchMovementCheckRef.current = startLaunchMovementCheck({
                currentFallbackTimeoutMs,
            });
        }

        return launchMovementCheckRef.current;
    };

    useEffect(() => {
        let isActive = true;

        void (async () => {
            launchMovementCheckRef.current = null;

            recordLocationProbeEvent({
                type: 'home-mount',
                details: {
                    usesLaunchBootstrap: shouldUseLaunchLocationBootstrapRef.current,
                    hasManualOverride: Boolean(manualLocationOverride),
                },
            });

            if (!shouldUseLaunchLocationBootstrapRef.current || manualLocationOverride) {
                if (isActive && isMountedRef.current) {
                    setIsInitialMapRegionReady(true);
                }
                return;
            }

            const cachedSnapshot = await getLastDeviceLocationSnapshot();

            if (!isActive || !isMountedRef.current) {
                return;
            }

            const cachedRegion = cachedSnapshot?.region || null;

            launchCachedRegionRef.current = cachedRegion;
            launchCachedCapturedAtRef.current = cachedSnapshot?.capturedAt || null;

            // Before we set the MapView's initialRegion, run a fast
            // movement check so the map renders directly at the resolved
            // coordinates. This prevents the visible flash where the map
            // paints the cached region (e.g. the previous city) and then
            // animates over to the fresh one. The fast check is bounded
            // by LOCATION_FAST_FETCH_TIMEOUT_MS so the launch never stalls.
            let resolvedInitialRegion = cachedRegion;
            let resolvedInitialSource = 'device-cache';
            let freshLaunchPositionObject = null;
            let mountMovementDiag = {
                permissionStatus: 'unknown',
                hasFastFix: false,
                distanceMeters: null,
                didMove: false,
                resolver: 'none',
            };

            if (cachedRegion) {
                try {
                    const permissionState = await Location.getForegroundPermissionsAsync();
                    mountMovementDiag.permissionStatus = permissionState.status;
                    if (permissionState.status === 'granted') {
                        const launchMovementCheck = getOrStartLaunchMovementCheck({
                            currentFallbackTimeoutMs: LAUNCH_MOVEMENT_RECOVERY_TIMEOUT_MS,
                        });
                        const fastLaunchMovementResult = await launchMovementCheck.fastResultPromise;
                        freshLaunchPositionObject = fastLaunchMovementResult.positionObject;
                        mountMovementDiag.resolver = fastLaunchMovementResult.resolver;
                        const freshRegion = buildRegionFromLocation(freshLaunchPositionObject);
                        mountMovementDiag.hasFastFix = Boolean(freshRegion);
                        if (freshRegion) {
                            mountMovementDiag.distanceMeters = calculateDistanceMeters(cachedRegion, freshRegion);
                        }
                        if (
                            freshRegion &&
                            hasMovedBeyondThreshold({
                                fromRegion: cachedRegion,
                                toRegion: freshRegion,
                                thresholdMeters: LOCATION_MOVEMENT_THRESHOLD_METERS,
                            })
                        ) {
                            mountMovementDiag.didMove = true;
                            resolvedInitialRegion = freshRegion;
                            resolvedInitialSource = 'launch-movement-check';
                            launchCachedRegionRef.current = freshRegion;
                            launchCachedCapturedAtRef.current = Date.now();
                            void persistLastDeviceLocationRegion(freshRegion, {
                                capturedAt: Date.now(),
                                accuracyMeters: freshLaunchPositionObject?.coords?.accuracy ?? null,
                            });
                        }
                    }
                } catch (permissionError) {
                    // Permission check failed — fall back to cached region.
                }
            }

            recordLocationProbeEvent({
                type: 'mount-movement-check-diag',
                details: mountMovementDiag,
            });

            if (!isActive || !isMountedRef.current) {
                return;
            }

            if (resolvedInitialRegion) {
                setInitialMapRegion(resolvedInitialRegion);
                applyResolvedRegion(resolvedInitialRegion);
                recordLocationAppliedProbeEvent(resolvedInitialRegion, resolvedInitialSource, {
                    capturedAt: cachedSnapshot?.capturedAt || null,
                    inlineMovementResolved: resolvedInitialSource === 'launch-movement-check',
                });
            }

            recordLocationProbeEvent({
                type: 'initial-map-region-ready',
                details: {
                    hasCachedRegion: Boolean(cachedRegion),
                    cachedCapturedAt: cachedSnapshot?.capturedAt || null,
                    resolvedSource: resolvedInitialSource,
                },
            });

            setIsInitialMapRegionReady(true);
        })();

        return () => {
            isActive = false;
        };
    }, [manualLocationOverride]);

    useEffect(() => {
        if (!isInitialMapRegionReady) {
            return;
        }

        const shouldDelayInitialReveal = shouldDelayHomeLaunchReveal({
            usesLaunchBootstrap: shouldUseLaunchLocationBootstrapRef.current,
            hasCachedRegion: Boolean(launchCachedRegionRef.current),
            hasManualLocationOverride: Boolean(manualLocationOverride),
        });

        isFirstLaunchWithoutCachedRegionRef.current = shouldDelayInitialReveal;
        launchVisualReadyRequestIdRef.current += 1;
        setIsLaunchCriticalFitPending(false);
        setIsLaunchVisualReady(!shouldDelayInitialReveal);
    }, [isInitialMapRegionReady, manualLocationOverride]);

    useEffect(() => {
        if (!isMapLoaded || !pendingInstantMapRegionRef.current || !mapRef.current) {
            return;
        }

        const nextRegion = pendingInstantMapRegionRef.current;

        mapRef.current.animateToRegion(nextRegion, 0);
        pendingInstantMapRegionRef.current = null;

        recordLocationProbeEvent({
            type: 'pop-map-to-region-flushed',
            details: {
                region: {
                    latitude: Number(nextRegion.latitude),
                    longitude: Number(nextRegion.longitude),
                },
            },
        });
    }, [isMapLoaded]);

    const recordDeviceLocationCheckTimestamp = (timestamp = Date.now()) => {
        const numericTimestamp = Number(timestamp);
        if (Number.isFinite(numericTimestamp) && numericTimestamp > 0) {
            lastDeviceLocationCheckAtRef.current = numericTimestamp;
        }
    };

    const resolveCurrentLocation = async ({ allowLaunchBootstrap }) => {
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
                            fuelType: selectedFuelGrade,
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
                applyResolvedRegion(manualRegion);
                setIsLoadingLocation(false);
            }

            updateResolvedFuelSearchContext(manualRegion, 'manual');

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

            // The launch-bootstrap path paints the cached region immediately
            // and then lets the AppState-driven refresh machinery decide
            // whether a follow-up fresh check is warranted. We intentionally
            // do NOT kick off a background `getCurrentPositionAsync` here any
            // more — that was the source of the launch stutter, because a
            // fresh fetch would land mid-render and replay the fuel fetch.
            let cachedRegion = null;
            let cachedCapturedAt = null;

            if (allowLaunchBootstrap) {
                cachedRegion = launchCachedRegionRef.current || null;
                cachedCapturedAt = launchCachedCapturedAtRef.current || null;

                if (!cachedRegion) {
                    const freshSnapshot = await getLastDeviceLocationSnapshot();
                    cachedRegion = freshSnapshot?.region || null;
                    cachedCapturedAt = freshSnapshot?.capturedAt || null;
                }
            }

            if (allowLaunchBootstrap && cachedRegion) {
                launchCachedRegionRef.current = cachedRegion;
                launchCachedCapturedAtRef.current = cachedCapturedAt;

                applyResolvedRegion(cachedRegion);
                recordLocationAppliedProbeEvent(cachedRegion, 'device-cache', {
                    cachedCapturedAt,
                    bootstrap: true,
                });
                recordLocationProbeEvent({
                    type: 'launch-bootstrap',
                    details: {
                        hasCachedRegion: true,
                        cachedCapturedAt,
                    },
                });
                updateResolvedFuelSearchContext(cachedRegion, 'device-cache');
                if (isMountedRef.current) {
                    setIsLoadingLocation(false);
                }

                // Run the movement check inline with a hard timeout. We
                // await it so the caller gets the resolved coordinates
                // back (either cached, or the new location if the user
                // moved). This lets `refreshForCurrentView` issue exactly
                // one fuel fetch instead of two — the cached region first,
                // then re-fetching after the background check lands. The
                // timeout is capped at LOCATION_FAST_FETCH_TIMEOUT_MS so
                // the launch never stalls waiting on a slow GPS.
                recordLocationProbeEvent({
                    type: 'launch-movement-check-scheduled',
                    details: { cachedCapturedAt },
                });

                const launchMovementPosition = allowLaunchBootstrap
                    ? await getOrStartLaunchMovementCheck({
                        currentFallbackTimeoutMs: LAUNCH_MOVEMENT_RECOVERY_TIMEOUT_MS,
                    }).completionPromise
                    : await resolveLaunchMovementCheckPosition({
                        currentFallbackTimeoutMs: LAUNCH_MOVEMENT_RECOVERY_TIMEOUT_MS,
                    });
                const fastPositionObject = launchMovementPosition.positionObject;

                const freshLaunchRegion = buildRegionFromLocation(fastPositionObject);
                const launchMovementMeters = freshLaunchRegion
                    ? calculateDistanceMeters(cachedRegion, freshLaunchRegion)
                    : null;
                const didLaunchMove = Boolean(
                    freshLaunchRegion &&
                    hasMovedBeyondThreshold({
                        fromRegion: cachedRegion,
                        toRegion: freshLaunchRegion,
                        thresholdMeters: LOCATION_MOVEMENT_THRESHOLD_METERS,
                    })
                );

                recordLocationProbeEvent({
                    type: 'launch-movement-check-result',
                    details: {
                        didMove: didLaunchMove,
                        hasFix: Boolean(freshLaunchRegion),
                        distanceMeters: launchMovementMeters,
                        resolver: launchMovementPosition.resolver,
                    },
                });

                recordDeviceLocationCheckTimestamp();

                if (didLaunchMove && freshLaunchRegion) {
                    const trajectorySeed = buildTrajectorySeedFromLocationObject(fastPositionObject);
                    applyResolvedRegion(freshLaunchRegion);
                    recordLocationAppliedProbeEvent(freshLaunchRegion, 'device', {
                        resolver: 'launch-movement-check',
                    });
                    updateResolvedFuelSearchContext(freshLaunchRegion, 'device');

                    const shouldAnimateLaunchTransition = shouldAnimateSmoothLaunchTransition(
                        cachedRegion,
                        freshLaunchRegion
                    );
                    if (shouldAnimateLaunchTransition) {
                        animateMapToRegion(freshLaunchRegion);
                    } else {
                        popMapToRegionWithoutAnimation(freshLaunchRegion);
                    }

                    await persistLastDeviceLocationRegion(freshLaunchRegion, {
                        capturedAt: Date.now(),
                        accuracyMeters: fastPositionObject?.coords?.accuracy ?? null,
                    });
                    launchCachedCapturedAtRef.current = Date.now();
                    launchCachedRegionRef.current = freshLaunchRegion;

                    return {
                        ...freshLaunchRegion,
                        locationSource: 'device',
                        trajectorySeed,
                    };
                }

                if (freshLaunchRegion) {
                    await persistLastDeviceLocationRegion(cachedRegion, {
                        capturedAt: Date.now(),
                        accuracyMeters: fastPositionObject?.coords?.accuracy ?? null,
                    });
                    launchCachedCapturedAtRef.current = Date.now();
                }

                return {
                    ...cachedRegion,
                    locationSource: 'device-cache',
                    trajectorySeed: buildTrajectorySeedFromLocationObject(fastPositionObject),
                };
            }

            // Non-bootstrap path: the map is already showing something and
            // the caller just wants the freshest usable position without a
            // long GPS wait. We try `getLastKnownPositionAsync` first and
            // only fall back to a low-accuracy current-position fix if the
            // last-known cache is empty (typical only on the very first
            // launch of the app).
            let resolvedPositionObject = await fetchLastKnownPositionWithTimeout({
                timeoutMs: LOCATION_FAST_FETCH_TIMEOUT_MS,
                maxAgeMs: LOCATION_LAST_KNOWN_MAX_AGE_MS,
                requiredAccuracyMeters: LOCATION_LAST_KNOWN_REQUIRED_ACCURACY_METERS,
            });

            if (!resolvedPositionObject) {
                resolvedPositionObject = await fetchCurrentPositionWithTimeout({
                    timeoutMs: LOCATION_COLD_FETCH_TIMEOUT_MS,
                    accuracy: Location.Accuracy.Low,
                });
            }

            if (!isMountedRef.current) {
                return null;
            }

            const nextRegion = buildRegionFromLocation(resolvedPositionObject);

            if (!nextRegion) {
                if (isMountedRef.current) {
                    setHasLocationPermission(true);
                    clearVisibleFuelState('Unable to get your current location. In the iOS Simulator, set a location in Features > Location.');
                }
                return null;
            }

            applyResolvedRegion(nextRegion);
            recordLocationAppliedProbeEvent(nextRegion, 'device', {
                accuracyMeters: resolvedPositionObject?.coords?.accuracy ?? null,
                resolver: allowLaunchBootstrap ? 'cold-fetch' : 'fast-fetch',
            });
            updateResolvedFuelSearchContext(nextRegion, 'device');
            if (allowLaunchBootstrap || !bestQuote) {
                popMapToRegionWithoutAnimation(nextRegion);
            } else {
                animateMapToRegion(nextRegion);
            }
            await persistLastDeviceLocationRegion(nextRegion, {
                capturedAt: Date.now(),
                accuracyMeters: resolvedPositionObject?.coords?.accuracy ?? null,
            });
            recordDeviceLocationCheckTimestamp();

            return {
                ...nextRegion,
                locationSource: 'device',
                trajectorySeed: buildTrajectorySeedFromLocationObject(resolvedPositionObject),
            };
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

    /**
     * Fast, non-blocking movement check. Invoked from the launch bootstrap
     * and from the AppState-resume handler. Uses the platform's last-known
     * cache so it never waits on a fresh GPS fix. If the resolved position
     * is genuinely different from the reference region (beyond the movement
     * threshold), it applies the new region, smoothly animates the map, and
     * refetches fuel data. Otherwise it simply bumps the cache timestamp so
     * the next check stays debounced.
     *
     * This function is a plain const (not a useCallback) so it always has
     * access to the latest closures for `loadFuelData`, `applyResolvedRegion`,
     * etc. Consumers that need a stable identity across renders call it via
     * `maybeRefreshDeviceLocationFromLastKnownRef` below.
     */
    const maybeRefreshDeviceLocationFromLastKnown = async ({
        reason = 'unknown',
        referenceRegion = null,
        forceFreshFetch = false,
    } = {}) => {
        if (manualLocationOverride) {
            return { applied: false, reason: 'manual-override' };
        }

        if (isDeviceLocationCheckInFlightRef.current) {
            return { applied: false, reason: 'in-flight' };
        }

        isDeviceLocationCheckInFlightRef.current = true;

        try {
            const permissionState = await Location.getForegroundPermissionsAsync();

            if (permissionState.status !== 'granted') {
                return { applied: false, reason: 'permission-denied' };
            }

            let resolvedPositionObject = null;

            if (!forceFreshFetch) {
                resolvedPositionObject = await fetchLastKnownPositionWithTimeout({
                    timeoutMs: LOCATION_FAST_FETCH_TIMEOUT_MS,
                    maxAgeMs: LOCATION_LAST_KNOWN_MAX_AGE_MS,
                    requiredAccuracyMeters: LOCATION_LAST_KNOWN_REQUIRED_ACCURACY_METERS,
                });
            }

            if (!resolvedPositionObject) {
                resolvedPositionObject = await fetchCurrentPositionWithTimeout({
                    timeoutMs: LOCATION_COLD_FETCH_TIMEOUT_MS,
                    accuracy: Location.Accuracy.Low,
                });
            }

            if (!resolvedPositionObject || !isMountedRef.current) {
                return { applied: false, reason: 'no-fix' };
            }

            const freshRegion = buildRegionFromLocation(resolvedPositionObject);
            const trajectorySeed = buildTrajectorySeedFromLocationObject(resolvedPositionObject);

            if (!freshRegion) {
                return { applied: false, reason: 'invalid-fix' };
            }

            const compareRegion = referenceRegion || mapRegionRef.current || location;
            const didMove = hasMovedBeyondThreshold({
                fromRegion: compareRegion,
                toRegion: freshRegion,
                thresholdMeters: LOCATION_MOVEMENT_THRESHOLD_METERS,
            });

            // Record the check timestamp regardless — even a no-op check
            // counts, because we know the device is near the cached point.
            recordDeviceLocationCheckTimestamp();

            recordLocationProbeEvent({
                type: 'movement-check-result',
                details: {
                    reason,
                    didMove,
                    freshRegion: {
                        latitude: Number(freshRegion.latitude),
                        longitude: Number(freshRegion.longitude),
                    },
                    compareRegion: compareRegion && {
                        latitude: Number(compareRegion.latitude),
                        longitude: Number(compareRegion.longitude),
                    },
                },
            });

            if (!didMove) {
                // Persist the fresh timestamp so the next launch debounces.
                await persistLastDeviceLocationRegion(compareRegion, {
                    capturedAt: Date.now(),
                    accuracyMeters: resolvedPositionObject?.coords?.accuracy ?? null,
                });
                launchCachedCapturedAtRef.current = Date.now();
                return {
                    applied: false,
                    reason: 'within-threshold',
                    distanceMeters: 0,
                };
            }

            // The user actually moved. Update location state, nudge the map,
            // re-persist the cache, and optionally refetch fuel data so the
            // stations reflect the new neighborhood. This is the
            // "reopen-after-travel" path the user experiences when they take
            // the phone to a new city while the app was closed.
            applyResolvedRegion(freshRegion);
            recordLocationAppliedProbeEvent(freshRegion, 'device', {
                resolver: 'movement-check',
                reason,
            });
            updateResolvedFuelSearchContext(freshRegion, 'device');

            // Launch transitions across huge distances (e.g. cached SF →
            // live NYC) still fall back to a pop so we don't animate the
            // camera for hundreds of miles. In-session moves always
            // animate so the map glides into place instead of jumping.
            const shouldAnimateLocationTransition = shouldAnimateSmoothLaunchTransition(
                compareRegion,
                freshRegion
            );
            if (shouldAnimateLocationTransition) {
                animateMapToRegion(freshRegion);
            } else {
                popMapToRegionWithoutAnimation(freshRegion);
            }

            await persistLastDeviceLocationRegion(freshRegion, {
                capturedAt: Date.now(),
                accuracyMeters: resolvedPositionObject?.coords?.accuracy ?? null,
            });
            launchCachedCapturedAtRef.current = Date.now();
            launchCachedRegionRef.current = freshRegion;

            // Skip the fuel refetch if the user is still comfortably inside
            // the previously cached window. The in-memory spatial index is
            // the source of truth here — as long as the window covers the
            // user (edge buffer and TTL respected), we can reuse its data.
            const movementFuelGrade = preferredProvider === 'gasbuddy'
                ? 'regular'
                : selectedFuelGrade;
            const hasUsableWindowForMovement = hasUsableCachedFuelWindow({
                latitude: freshRegion.latitude,
                longitude: freshRegion.longitude,
                radiusMiles: searchRadiusMiles,
                fuelType: movementFuelGrade,
                preferredProvider,
            });

            if (!hasUsableWindowForMovement) {
                await loadFuelData({
                    latitude: freshRegion.latitude,
                    longitude: freshRegion.longitude,
                    locationSource: 'device',
                    preferCached: false,
                    trajectorySeed,
                    querySignature: buildResolvedHomeQuerySignature(freshRegion),
                });
            } else {
                recordLocationProbeEvent({
                    type: 'movement-check-reused-window',
                    details: {
                        region: {
                            latitude: Number(freshRegion.latitude),
                            longitude: Number(freshRegion.longitude),
                        },
                        reason,
                    },
                });
            }

            return {
                applied: true,
                reason,
                freshRegion,
            };
        } catch (error) {
            return { applied: false, reason: 'error', error };
        } finally {
            isDeviceLocationCheckInFlightRef.current = false;
        }
    };

    const loadFuelData = async ({
        latitude,
        longitude,
        locationSource,
        preferCached,
        trajectorySeed = null,
        querySignature = null,
    }) => {
        const requestQuerySignature = querySignature || buildResolvedHomeQuerySignature({
            latitude,
            longitude,
        });
        const hadVisibleFuelState = Boolean(bestQuote) || topStations.length > 0 || regionalQuotes.length > 0;
        const requestedRegion = {
            latitude,
            longitude,
            latitudeDelta: DEFAULT_REGION.latitudeDelta,
            longitudeDelta: DEFAULT_REGION.longitudeDelta,
        };
        const requestDisplayKey = buildFuelSearchRequestKey({
            origin: requestedRegion,
            fuelGrade: selectedFuelGrade,
            radiusMiles: searchRadiusMiles,
            preferredProvider,
        });
        const snapshotFuelGrade = preferredProvider === 'gasbuddy'
            ? 'regular'
            : selectedFuelGrade;
        const query = {
            latitude,
            longitude,
            radiusMiles: searchRadiusMiles,
            fuelType: snapshotFuelGrade,
            preferredProvider,
        };
        const pendingHomeRefitRequest = pendingHomeRefitRequestRef.current;
        const homeFuelSnapshotStrategy = resolveHomeFuelSnapshotStrategy({
            preferCached,
            fuelGrade: selectedFuelGrade,
            hasVisibleFuelState: hasVisibleFuelStateRef.current,
            pendingRefitRequest: pendingHomeRefitRequest,
        });
        const baseDebugState = {
            input: {
                ...query,
                locationSource,
                requestedFuelType: selectedFuelGrade,
                zipCode: null,
            },
            providers: [],
            requestedAt: new Date().toISOString(),
        };

        try {
            activeHomeQuerySignatureRef.current = requestQuerySignature;

            recordLocationProbeEvent({
                type: 'fuel-fetch-start',
                details: {
                    query: {
                        latitude,
                        longitude,
                        radiusMiles: searchRadiusMiles,
                        fuelType: snapshotFuelGrade,
                        preferredProvider,
                    },
                    locationSource,
                    preferCached: Boolean(preferCached),
                    trajectorySeed: trajectorySeed
                        ? {
                            courseDegrees: trajectorySeed.courseDegrees,
                            speedMps: trajectorySeed.speedMps,
                        }
                        : null,
                },
            });

            if (isMountedRef.current) {
                setFuelDebugState(baseDebugState);
            }

            if (homeFuelSnapshotStrategy.useCachedSnapshot) {
                const cachedSnapshot = await getCachedFuelPriceSnapshot(query);

                if (activeHomeQuerySignatureRef.current === requestQuerySignature) {
                    if (cachedSnapshot?.quote && !hadVisibleFuelState) {
                        const nextRenderedHomeRefitRequestVersion = renderedHomeRefitRequestVersionRef.current + 1;
                        renderedHomeRefitRequestVersionRef.current = nextRenderedHomeRefitRequestVersion;
                        applySnapshot(cachedSnapshot, {
                            animated: true,
                            filterSignature: currentHomeFilterSignature,
                            forceAnimation: false,
                            querySignature: requestQuerySignature,
                            renderedRequestVersion: nextRenderedHomeRefitRequestVersion,
                            reason: 'initial-load',
                        });
                    } else {
                        applySnapshot(cachedSnapshot);
                    }

                    if (cachedSnapshot?.quote) {
                        lastVisibleHomeRequestKeyRef.current = requestDisplayKey;
                        recordLocationProbeEvent({
                            type: 'fuel-fetch-cached-snapshot',
                            details: {
                                query: {
                                    latitude,
                                    longitude,
                                    radiusMiles: searchRadiusMiles,
                                    fuelType: snapshotFuelGrade,
                                    preferredProvider,
                                },
                            },
                        });
                    }
                }
            }

            if (isMountedRef.current) {
                setErrorMsg(null);
                setIsRefreshingPrices(true);
            }

            const result = trajectorySeed
                ? await refreshFuelPriceSnapshotWithTrajectoryFallback({
                    ...query,
                    courseDegrees: trajectorySeed.courseDegrees,
                    speedMps: trajectorySeed.speedMps,
                    routeProvider: getDrivingRouteAsync,
                })
                : await refreshFuelPriceSnapshot({
                    ...query,
                });
            const freshSnapshot = result?.snapshot;
            const nextDebugState = result?.debugState
                ? {
                    ...result.debugState,
                    input: {
                        ...result.debugState.input,
                        locationSource,
                        requestedFuelType: selectedFuelGrade,
                    },
                }
                : baseDebugState;

            if (!freshSnapshot?.quote) {
                throw new Error('No prices returned');
            }

            if (activeHomeQuerySignatureRef.current !== requestQuerySignature) {
                return;
            }

            if (
                isFirstLaunchWithoutCachedRegionRef.current &&
                !hasTriggeredInitialRevealRef.current
            ) {
                launchVisualReadyRequestIdRef.current += 1;
                setIsLaunchVisualReady(false);
                setIsLaunchCriticalFitPending(true);
            }

            const latestPendingHomeRefitRequest = pendingHomeRefitRequestRef.current;
            const shouldPreserveQueuedFilterChange = (
                latestPendingHomeRefitRequest?.reason === 'filter-change' &&
                latestPendingHomeRefitRequest.filterSignature === currentHomeFilterSignature
            );
            const hasPendingInitialLoadFitForQuery = (
                latestPendingHomeRefitRequest?.reason === 'initial-load' &&
                latestPendingHomeRefitRequest.querySignature === requestQuerySignature
            );
            const hasVisibleFuelStateNow = hasVisibleFuelStateRef.current;

            if (hasPendingInitialLoadFitForQuery) {
                applySnapshot(freshSnapshot);
            } else {
                const shouldUseInitialLoadFit = !hasVisibleFuelStateNow;
                const nextRenderedHomeRefitRequestVersion = renderedHomeRefitRequestVersionRef.current + 1;
                renderedHomeRefitRequestVersionRef.current = nextRenderedHomeRefitRequestVersion;
                const nextHomeRefitRequest = {
                    animated: shouldPreserveQueuedFilterChange
                        ? true
                        : shouldUseInitialLoadFit,
                    filterSignature: currentHomeFilterSignature,
                    forceAnimation: shouldPreserveQueuedFilterChange
                        ? latestPendingHomeRefitRequest.forceAnimation !== false
                        : false,
                    querySignature: requestQuerySignature,
                    renderedRequestVersion: nextRenderedHomeRefitRequestVersion,
                    reason: shouldPreserveQueuedFilterChange
                        ? 'filter-change'
                        : (shouldUseInitialLoadFit ? 'initial-load' : 'location-refresh'),
                };
                applySnapshot(freshSnapshot, nextHomeRefitRequest);
            }
            lastVisibleHomeRequestKeyRef.current = requestDisplayKey;
            lastResolvedHomeQuerySignatureRef.current = requestQuerySignature;
            lastAppliedHomeFilterSignatureRef.current = currentHomeFilterSignature;

            if (isMountedRef.current) {
                setErrorMsg(null);
                setFuelDebugState(nextDebugState);
            }

            const stationDistanceSamples = Array.isArray(freshSnapshot?.topStations)
                ? freshSnapshot.topStations
                    .map(station => Number(station?.distanceMiles))
                    .filter(value => Number.isFinite(value))
                    .sort((left, right) => left - right)
                : [];
            const stationDistanceStats = stationDistanceSamples.length > 0
                ? {
                    min: stationDistanceSamples[0],
                    max: stationDistanceSamples[stationDistanceSamples.length - 1],
                    median: stationDistanceSamples[Math.floor(stationDistanceSamples.length / 2)],
                    samples: stationDistanceSamples,
                }
                : null;

            recordLocationProbeEvent({
                type: 'fuel-fetch-end',
                details: {
                    query: {
                        latitude,
                        longitude,
                        radiusMiles: searchRadiusMiles,
                        fuelType: snapshotFuelGrade,
                        preferredProvider,
                    },
                    status: 'completed',
                    stationCount: Array.isArray(freshSnapshot?.topStations)
                        ? freshSnapshot.topStations.length
                        : 0,
                    hasBestQuote: Boolean(freshSnapshot?.quote),
                    locationSource,
                    stationDistanceStats,
                },
            });

            router.prefetch?.('/trends');
            void prefetchTrendData({
                latitude,
                longitude,
                fuelType: selectedFuelGrade,
                radiusMiles: searchRadiusMiles,
                preferredProvider,
                minimumRating,
                requestKey: requestDisplayKey,
            });
        } catch (error) {
            if (isFuelCacheResetError(error)) {
                return;
            }

            if (activeHomeQuerySignatureRef.current !== requestQuerySignature) {
                return;
            }

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

            recordLocationProbeEvent({
                type: 'fuel-fetch-end',
                details: {
                    query: {
                        latitude,
                        longitude,
                        radiusMiles: searchRadiusMiles,
                        fuelType: snapshotFuelGrade,
                        preferredProvider,
                    },
                    status: 'failed',
                    error: error?.message || String(error || 'unknown-error'),
                    locationSource,
                },
            });
        } finally {
            if (isMountedRef.current) {
                setIsRefreshingPrices(false);
            }

            void flushLocationProbeReportAsync();
        }
    };

    const refreshForCurrentView = async ({ preferCached, force = false }) => {
        const allowLaunchBootstrap = shouldUseLaunchLocationBootstrapRef.current;
        const pendingHomeRefitRequest = pendingHomeRefitRequestRef.current;

        shouldUseLaunchLocationBootstrapRef.current = false;

        const reusableResolvedRegion = !force
            ? (
                hasUsableHomeRegion(location) && lastResolvedHomeQuerySignatureRef.current
                    ? {
                        ...location,
                        locationSource: manualLocationOverride
                            ? 'manual'
                            : (resolvedFuelSearchContext?.locationSource || 'device'),
                    }
                    : (
                        hasUsableHomeRegion(resolvedFuelSearchContext)
                            ? {
                                latitude: resolvedFuelSearchContext.latitude,
                                longitude: resolvedFuelSearchContext.longitude,
                                latitudeDelta: resolvedFuelSearchContext.latitudeDelta || DEFAULT_REGION.latitudeDelta,
                                longitudeDelta: resolvedFuelSearchContext.longitudeDelta || DEFAULT_REGION.longitudeDelta,
                                locationSource: resolvedFuelSearchContext.locationSource || 'device',
                            }
                            : null
                    )
            )
            : null;

        const shouldReuseResolvedRegion = Boolean(
            reusableResolvedRegion &&
            (
                pendingHomeRefitRequest?.reason === 'filter-change' ||
                hasHomeFilterSignatureChanged({
                    previousFilterSignature: lastAppliedHomeFilterSignatureRef.current,
                    nextFilterSignature: currentHomeFilterSignature,
                }) ||
                !isFocusedRef.current
            )
        );
        const reusableQuerySignature = reusableResolvedRegion
            ? buildResolvedHomeQuerySignature(reusableResolvedRegion)
            : '';

        if (
            !force &&
            reusableResolvedRegion &&
            !shouldReuseResolvedRegion &&
            lastResolvedHomeQuerySignatureRef.current === reusableQuerySignature &&
            hasVisibleFuelStateRef.current
        ) {
            lastAppliedHomeFilterSignatureRef.current = currentHomeFilterSignature;
            return;
        }

        const nextRegion = shouldReuseResolvedRegion
            ? reusableResolvedRegion
            : await resolveCurrentLocation({
                allowLaunchBootstrap,
            });

        if (!nextRegion) {
            return;
        }

        const nextQuerySignature = buildResolvedHomeQuerySignature(nextRegion);

        if (
            pendingHomeRefitRequest?.reason === 'filter-change' &&
            pendingHomeRefitRequest.filterSignature === currentHomeFilterSignature &&
            pendingHomeRefitRequest.querySignature !== nextQuerySignature
        ) {
            queueHomeRefitRequest({
                ...pendingHomeRefitRequest,
                querySignature: nextQuerySignature,
            });
        }

        if (
            !force &&
            lastResolvedHomeQuerySignatureRef.current === nextQuerySignature &&
            hasVisibleFuelStateRef.current
        ) {
            lastAppliedHomeFilterSignatureRef.current = currentHomeFilterSignature;
            return;
        }

        await loadFuelData({
            latitude: nextRegion.latitude,
            longitude: nextRegion.longitude,
            locationSource: nextRegion.locationSource || 'device',
            preferCached,
            trajectorySeed: nextRegion.trajectorySeed || null,
            querySignature: nextQuerySignature,
        });
    };

    // Keep a ref that always points at the latest closure of the movement
    // check so the AppState listener below (which registers once) never sees
    // a stale `loadFuelData` or `applyResolvedRegion`. This mirrors the
    // "ref-of-latest-callback" pattern from React Hook FAQ.
    const maybeRefreshDeviceLocationFromLastKnownRef = useRef(null);
    maybeRefreshDeviceLocationFromLastKnownRef.current = maybeRefreshDeviceLocationFromLastKnown;

    // Continuous tracking. The event-driven GPS handler ONLY records the
    // latest fix + velocity. A separate interval-driven "driver" (below)
    // does the actual map animation at 2 Hz, which is the only way to get
    // continuous motion because react-native-maps' duration argument is
    // a no-op on iOS Apple Maps (see the tracking settings comment above).
    const liveTrackingSubscriptionRef = useRef(null);
    const liveTrackingDriverIntervalRef = useRef(null);
    const hasUserRecentlyPannedRef = useRef(false);
    const userPanSuppressTimeoutRef = useRef(null);
    const loadFuelDataRef = useRef(null);
    loadFuelDataRef.current = loadFuelData;
    // Latest GPS fix: { latitude, longitude, timestampMs }
    const latestFixRef = useRef(null);
    // Velocity computed by differencing consecutive fixes, in
    // degrees-per-millisecond. Kept as a plain struct so the driver can
    // read it without allocating.
    const latestVelocityRef = useRef({ latPerMs: 0, lngPerMs: 0 });
    // Timestamp of the last device-watch refetch we kicked off. Used by
    // the cool-down guard in `handleLiveLocationUpdate` so rapid movement
    // cannot stack multiple back-to-back refetches that each replace the
    // station set with a point-centered snapshot. See
    // LIVE_TRACKING_REFETCH_MIN_INTERVAL_MS for the rationale.
    const lastDeviceWatchFetchAtRef = useRef(0);

    const handleLiveLocationUpdate = (positionObject) => {
        if (!isMountedRef.current || manualLocationOverride) {
            return;
        }

        const latitude = Number(positionObject?.coords?.latitude);
        const longitude = Number(positionObject?.coords?.longitude);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
            return;
        }

        const reportedTimestamp = Number(positionObject?.timestamp);
        const timestampMs = Number.isFinite(reportedTimestamp) && reportedTimestamp > 0
            ? reportedTimestamp
            : Date.now();

        // Differencing-based velocity. This is robust in both real and
        // simulator environments — we don't rely on `coords.speed` /
        // `coords.heading` being accurate (iOS Simulator often reports
        // invalid values for those fields, which was leaving the tracker
        // without a direction to extrapolate in, producing the "move,
        // stop, move" stutter).
        const previousFix = latestFixRef.current;
        if (previousFix) {
            const dtMs = timestampMs - previousFix.timestampMs;
            if (dtMs > 50 && dtMs < 30_000) {
                latestVelocityRef.current = {
                    latPerMs: (latitude - previousFix.latitude) / dtMs,
                    lngPerMs: (longitude - previousFix.longitude) / dtMs,
                };
            } else if (dtMs <= 0) {
                // Identical or backwards timestamp; leave velocity alone.
            } else if (dtMs >= 30_000) {
                // Long gap — treat as fresh start to avoid wildly stale
                // velocity driving the camera off the map.
                latestVelocityRef.current = { latPerMs: 0, lngPerMs: 0 };
            }
        }
        latestFixRef.current = { latitude, longitude, timestampMs };

        const actualRegion = {
            latitude,
            longitude,
            latitudeDelta: LIVE_TRACKING_LATITUDE_DELTA,
            longitudeDelta: LIVE_TRACKING_LONGITUDE_DELTA,
        };

        // Only push React state when the user has moved far enough to
        // matter. The actual camera motion is handled by the driver, so
        // we don't touch the map here.
        const distanceFromStateMeters = calculateDistanceMeters(
            location,
            actualRegion
        );
        if (
            !location ||
            !Number.isFinite(distanceFromStateMeters) ||
            distanceFromStateMeters >= LIVE_TRACKING_STATE_UPDATE_METERS
        ) {
            applyResolvedRegion(actualRegion);
            updateResolvedFuelSearchContext(actualRegion, 'device');
        }

        // Refetch only when the user crossed the safe edge of the cached
        // window. Inside the window we skip entirely.
        const snapshotFuelGrade = preferredProvider === 'gasbuddy'
            ? 'regular'
            : selectedFuelGrade;
        const windowStillCovers = hasUsableCachedFuelWindow({
            latitude,
            longitude,
            radiusMiles: searchRadiusMiles,
            fuelType: snapshotFuelGrade,
            preferredProvider,
        });
        if (windowStillCovers) {
            return;
        }

        // Rapid-movement cool-down. `watchPositionAsync` can fire several
        // ticks per second on a fast-moving user, and each tick that
        // falls outside the cached window would otherwise queue its own
        // full-radius refetch. Stacked refetches each complete in turn,
        // with each `applySnapshot` wiping the last one's data, so the
        // feed ends up reflecting only whichever fetch happened to win
        // the race — usually the one centered on the user's latest
        // position, with zero coverage of everything the user just
        // drove through. One refetch per LIVE_TRACKING_REFETCH_MIN_INTERVAL_MS
        // is enough to keep data fresh at highway speed while leaving
        // each in-flight trajectory fetch room to resolve before the
        // next one starts.
        const nowMs = Date.now();
        const lastDeviceWatchFetchAt = lastDeviceWatchFetchAtRef.current;
        if (
            lastDeviceWatchFetchAt &&
            nowMs - lastDeviceWatchFetchAt < LIVE_TRACKING_REFETCH_MIN_INTERVAL_MS
        ) {
            return;
        }

        const loader = loadFuelDataRef.current;
        if (!loader) {
            return;
        }

        lastDeviceWatchFetchAtRef.current = nowMs;

        void persistLastDeviceLocationRegion(actualRegion, {
            capturedAt: Date.now(),
            accuracyMeters: positionObject?.coords?.accuracy ?? null,
        }).catch(() => {
            // Persistence is best-effort; tracking continues regardless.
        });
        launchCachedCapturedAtRef.current = Date.now();
        launchCachedRegionRef.current = actualRegion;

        // Prefer a trajectory seed derived from our own differencing
        // velocity over the GPS `course`/`speed` fields — iOS Simulator
        // and low-accuracy readings routinely report invalid values for
        // those, which was leaving the live tracker without a direction
        // to prefetch in. With a valid seed, `loadFuelData` takes the
        // trajectory fetch path and pulls both an origin-centered and
        // an ahead-of-motion snapshot in parallel, merging the stations
        // so the feed stays full as the user pushes through the edge
        // of the cached window instead of briefly collapsing to just
        // whatever the single fresh point returned.
        const velocity = latestVelocityRef.current;
        const derivedTrajectorySeed = buildTrajectorySeedFromVelocity({
            latitude,
            longitude,
            velocity,
        });
        const trajectorySeed = derivedTrajectorySeed
            || buildTrajectorySeedFromLocationObject(positionObject);

        void loader({
            latitude,
            longitude,
            locationSource: 'device-watch',
            preferCached: false,
            trajectorySeed,
            querySignature: buildResolvedHomeQuerySignature(actualRegion),
        });
    };

    const handleLiveLocationUpdateRef = useRef(null);
    handleLiveLocationUpdateRef.current = handleLiveLocationUpdate;

    // The tracking driver. Runs at LIVE_TRACKING_DRIVER_INTERVAL_MS (2 Hz)
    // whenever tracking is active. Each tick computes an interpolated
    // target position from the last fix + velocity + elapsed time, then
    // asks the map to animate there over LIVE_TRACKING_DRIVER_ANIMATION_MS.
    // Back-to-back short animations are the only way to get continuous
    // smooth motion on react-native-maps + Apple Maps.
    const runLiveTrackingDriverTick = () => {
        if (
            !isMountedRef.current ||
            manualLocationOverride ||
            hasUserRecentlyPannedRef.current ||
            !mapRef.current ||
            !isMapLoaded
        ) {
            return;
        }

        const fix = latestFixRef.current;
        if (!fix) {
            return;
        }

        const elapsedMsRaw = Date.now() - fix.timestampMs;
        const elapsedMs = Math.max(
            0,
            Math.min(elapsedMsRaw, LIVE_TRACKING_MAX_EXTRAPOLATION_MS)
        );
        const velocity = latestVelocityRef.current;
        const targetLatitude = fix.latitude + velocity.latPerMs * elapsedMs;
        const targetLongitude = fix.longitude + velocity.lngPerMs * elapsedMs;

        if (!Number.isFinite(targetLatitude) || !Number.isFinite(targetLongitude)) {
            return;
        }

        const targetRegion = {
            latitude: targetLatitude,
            longitude: targetLongitude,
            latitudeDelta: LIVE_TRACKING_LATITUDE_DELTA,
            longitudeDelta: LIVE_TRACKING_LONGITUDE_DELTA,
        };

        animateMapToRegion(targetRegion, LIVE_TRACKING_DRIVER_ANIMATION_MS);
    };

    const runLiveTrackingDriverTickRef = useRef(null);
    runLiveTrackingDriverTickRef.current = runLiveTrackingDriverTick;

    const suppressAutoFollowAfterUserPan = () => {
        hasUserRecentlyPannedRef.current = true;

        if (userPanSuppressTimeoutRef.current) {
            clearTimeout(userPanSuppressTimeoutRef.current);
        }

        userPanSuppressTimeoutRef.current = setTimeout(() => {
            userPanSuppressTimeoutRef.current = null;
            hasUserRecentlyPannedRef.current = false;
        }, LIVE_TRACKING_PAN_SUPPRESS_MS);
    };

    useEffect(() => {
        return () => {
            if (userPanSuppressTimeoutRef.current) {
                clearTimeout(userPanSuppressTimeoutRef.current);
                userPanSuppressTimeoutRef.current = null;
            }
        };
    }, []);

    // Subscribe to continuous location updates and start the driver
    // interval while we have permission and the home tab is focused. The
    // subscription + driver are torn down whenever any of those conditions
    // flips so we don't tick in the background.
    useEffect(() => {
        if (manualLocationOverride || !hasLocationPermission || !isFocused) {
            return undefined;
        }

        let cancelled = false;

        // Driver interval: drives the map animation at 2 Hz, independent
        // of GPS tick rate. This is what makes motion smooth.
        liveTrackingDriverIntervalRef.current = setInterval(() => {
            runLiveTrackingDriverTickRef.current?.();
        }, LIVE_TRACKING_DRIVER_INTERVAL_MS);

        (async () => {
            try {
                const subscription = await Location.watchPositionAsync(
                    {
                        // iOS silently ignores `timeInterval`, so we rely on
                        // High accuracy + distanceInterval=0 to get every
                        // GPS update the system is willing to deliver.
                        accuracy: Location.Accuracy.High,
                        distanceInterval: LIVE_TRACKING_DISTANCE_INTERVAL_METERS,
                    },
                    (positionObject) => {
                        if (cancelled) {
                            return;
                        }
                        handleLiveLocationUpdateRef.current?.(positionObject);
                    }
                );

                if (cancelled) {
                    subscription.remove();
                    return;
                }

                liveTrackingSubscriptionRef.current = subscription;
            } catch (error) {
                // watchPositionAsync failed; tracking stays off.
            }
        })();

        return () => {
            cancelled = true;
            if (liveTrackingDriverIntervalRef.current) {
                clearInterval(liveTrackingDriverIntervalRef.current);
                liveTrackingDriverIntervalRef.current = null;
            }
            if (liveTrackingSubscriptionRef.current) {
                liveTrackingSubscriptionRef.current.remove();
                liveTrackingSubscriptionRef.current = null;
            }
            latestFixRef.current = null;
            latestVelocityRef.current = { latPerMs: 0, lngPerMs: 0 };
        };
    }, [hasLocationPermission, isFocused, manualLocationOverride]);

    useEffect(() => {
        recordLocationProbeEvent({
            type: 'app-state-listener-registered',
            details: {
                initialState: AppState.currentState,
                refCurrent: appStateRef.current,
            },
        });

        const handleAppStateChange = (nextAppState) => {
            const previousAppState = appStateRef.current;
            appStateRef.current = nextAppState;

            recordLocationProbeEvent({
                type: 'app-state-change',
                details: {
                    previousAppState,
                    nextAppState,
                    hasBeenBackgroundedSinceLastActive: hasBeenBackgroundedSinceLastActiveRef.current,
                },
            });

            if (nextAppState === 'background') {
                // The user (or the OS) sent the app fully away from the
                // foreground. Arm the tripwire so the NEXT `active`
                // transition fires a movement check. We intentionally
                // do NOT set the flag on `inactive` because the iOS
                // control center pull-down fires `inactive` without
                // actually backgrounding the app.
                hasBeenBackgroundedSinceLastActiveRef.current = true;
                return;
            }

            if (nextAppState === 'inactive') {
                // `inactive` is the transient state between active and
                // background. Ignore it — the subsequent `background`
                // or `active` event tells us what actually happened.
                return;
            }

            // nextAppState === 'active' from this point on.
            // Cold-launch delivery order on iOS is `inactive → active`,
            // so the first time we reach this branch the app just
            // finished launching and the bootstrap path has already
            // resolved the location. We only want to fire a movement
            // check if the app has been fully backgrounded since that
            // last active state.
            if (!hasBeenBackgroundedSinceLastActiveRef.current) {
                return;
            }

            hasBeenBackgroundedSinceLastActiveRef.current = false;

            const isMovingToActive = true;

            if (!isMovingToActive) {
                return;
            }

            if (!isMountedRef.current) {
                return;
            }

            recordLocationProbeEvent({
                type: 'foreground-resume',
                details: {
                    previousAppState,
                    nextAppState,
                    isFocused: isFocusedRef.current,
                    lastCheckAt: lastDeviceLocationCheckAtRef.current,
                },
            });

            // Always run the movement check on a genuine background →
            // active transition. The movement threshold (250m) and the
            // in-flight guard protect us from wasted work when nothing
            // has changed, so there is no need for an additional
            // time-based debounce here. The `hasSeenBackgroundTransitionRef`
            // flag above already rejects inactive → active flips.
            if (isFocusedRef.current) {
                const refresher = maybeRefreshDeviceLocationFromLastKnownRef.current;
                if (refresher) {
                    void refresher({
                        reason: 'foreground-resume',
                    });
                }
            } else {
                pendingForegroundResumeCheckRef.current = true;
            }
        };

        const subscription = AppState.addEventListener('change', handleAppStateChange);

        return () => {
            subscription.remove();
        };
    }, []);

    // If the app resumed while we were on a non-Home tab, run the deferred
    // movement check as soon as Home gains focus again. This keeps the fuel
    // state accurate without forcing a GPS fetch on every tab change.
    useEffect(() => {
        if (!isFocused) {
            return;
        }

        if (!pendingForegroundResumeCheckRef.current) {
            return;
        }

        pendingForegroundResumeCheckRef.current = false;

        const refresher = maybeRefreshDeviceLocationFromLastKnownRef.current;
        if (refresher) {
            void refresher({
                reason: 'foreground-resume-tab-return',
            });
        }
    }, [isFocused]);

    useEffect(() => {
        if (!isInitialMapRegionReady || isMapLoaded) {
            return undefined;
        }

        mapLoadedFallbackTimeoutRef.current = setTimeout(() => {
            mapLoadedFallbackTimeoutRef.current = null;
            if (!isMountedRef.current) {
                return;
            }

            markMapLoaded();
        }, 1500);

        return () => {
            if (mapLoadedFallbackTimeoutRef.current) {
                clearTimeout(mapLoadedFallbackTimeoutRef.current);
                mapLoadedFallbackTimeoutRef.current = null;
            }
        };
    }, [isInitialMapRegionReady, isMapLoaded]);

    useEffect(() => {
        return () => {
            isMountedRef.current = false;
            cancelInitialHomeFitRetries();
            if (mapLoadedFallbackTimeoutRef.current) {
                clearTimeout(mapLoadedFallbackTimeoutRef.current);
                mapLoadedFallbackTimeoutRef.current = null;
            }
            clearQueuedHomeRefitRequest();
            resetMapMotionTracking();
        };
    }, []);

    useEffect(() => {
        if (!fuelResetToken) {
            return;
        }

        lastResolvedHomeQuerySignatureRef.current = '';
        activeHomeQuerySignatureRef.current = '';
        lastVisibleHomeRequestKeyRef.current = '';
        prefetchedTrendRequestKeysRef.current.clear();
        clearVisibleFuelState('Fuel cache cleared. Open Home to fetch fresh prices.');
        setFuelDebugState(null);
    }, [fuelResetToken, setFuelDebugState]);

    // Track the latest visible request key so snapshots know which query
    // they belong to. We no longer *clear* visible results when the key
    // changes — the tracker keeps the home feed populated with the last
    // fetch's stations until a fresh snapshot replaces them, which is the
    // simplest way to guarantee "stations always in view" as the user
    // moves through and across cache windows.
    useEffect(() => {
        const hasVisibleFuelState = (
            Boolean(bestQuote) ||
            topStations.length > 0 ||
            regionalQuotes.length > 0 ||
            Boolean(errorMsg)
        );

        if (hasVisibleFuelState) {
            lastVisibleHomeRequestKeyRef.current = currentVisibleHomeRequestKey;
        }
    }, [
        bestQuote,
        currentVisibleHomeRequestKey,
        errorMsg,
        regionalQuotes.length,
        topStations.length,
    ]);

    useEffect(() => {
        if (!isFocused && !autoClusterProbeRequested) {
            return;
        }

        if (!lastAppliedHomeFilterSignatureRef.current) {
            lastAppliedHomeFilterSignatureRef.current = currentHomeFilterSignature;
        } else if (hasHomeFilterSignatureChanged({
            previousFilterSignature: lastAppliedHomeFilterSignatureRef.current,
            nextFilterSignature: currentHomeFilterSignature,
        })) {
            resetHomeSelectionToBest();
            const nextFilterQuerySignature = hasUsableHomeRegion(location)
                ? buildResolvedHomeQuerySignature(location)
                : '';
            const shouldWaitForFreshSnapshot = Boolean(
                nextFilterQuerySignature &&
                lastResolvedHomeQuerySignatureRef.current &&
                nextFilterQuerySignature !== lastResolvedHomeQuerySignatureRef.current
            );

            if (!shouldWaitForFreshSnapshot) {
                const nextRenderedHomeRefitRequestVersion = renderedHomeRefitRequestVersionRef.current + 1;
                renderedHomeRefitRequestVersionRef.current = nextRenderedHomeRefitRequestVersion;
                queueHomeRefitRequest({
                    animated: true,
                    filterSignature: currentHomeFilterSignature,
                    forceAnimation: true,
                    querySignature: nextFilterQuerySignature,
                    renderedRequestVersion: nextRenderedHomeRefitRequestVersion,
                    reason: 'filter-change',
                });
            }
        }

        void refreshForCurrentView({
            preferCached: true,
        });
    }, [
        currentHomeFilterSignature,
        autoClusterProbeRequested,
        buildResolvedHomeQuerySignature,
        isFocused,
        manualLocationOverride,
        minimumRating,
        preferredProvider,
        searchRadiusMiles,
        selectedFuelGrade,
    ]);

    useEffect(() => {
        const hasVisibleMapContent = Boolean(bestQuote) || topStations.length > 0 || regionalQuotes.length > 0;
        const hasValidLocation =
            Number.isFinite(location?.latitude) &&
            Number.isFinite(location?.longitude);
        const trendPrefetchRequestKey = hasValidLocation
            ? buildFuelSearchRequestKey({
                origin: location,
                fuelGrade: selectedFuelGrade,
                radiusMiles: searchRadiusMiles,
                preferredProvider,
                minimumRating,
            })
            : null;

        if (
            !isMapLoaded ||
            !hasVisibleMapContent ||
            !hasValidLocation ||
            !trendPrefetchRequestKey ||
            prefetchedTrendRequestKeysRef.current.has(trendPrefetchRequestKey)
        ) {
            return;
        }

        prefetchedTrendRequestKeysRef.current.add(trendPrefetchRequestKey);
        router.prefetch?.('/trends');

        void prefetchTrendData({
            latitude: location.latitude,
            longitude: location.longitude,
            fuelType: selectedFuelGrade,
            radiusMiles: searchRadiusMiles,
            preferredProvider,
            minimumRating,
            requestKey: trendPrefetchRequestKey,
        });
    }, [
        bestQuote,
        isMapLoaded,
        location,
        minimumRating,
        preferredProvider,
        regionalQuotes.length,
        router,
        searchRadiusMiles,
        selectedFuelGrade,
        topStations.length,
    ]);

    const scrollHandler = useAnimatedScrollHandler({
        onScroll: (event) => {
            scrollX.value = event.contentOffset.x;
        },
    });

    const { width, height } = Dimensions.get('window');

    const minRating = minimumRating;
    const rawStationQuotes = useMemo(() => (
        [
            ...(Array.isArray(topStations) ? topStations : []),
            bestQuote,
        ]
            .filter(Boolean)
            .filter(quote => quote?.providerTier === 'station' && !quote?.isEstimated)
    ), [bestQuote, topStations]);
    const filteredStationQuotes = useMemo(() => (
        // Do NOT pass radiusMiles here. If we filtered the already-cached
        // set by distance-from-current-user, stations on the "behind" side
        // would drop out of the list as the user moves through the window,
        // leaving the feed with a single station or nothing just before the
        // cache edge is crossed and a refetch happens. Instead we show
        // everything the last fetch returned and trust the cache-window
        // refetch path in the tracker to roll the window forward before
        // stations get unreasonably far away.
        filterStationQuotesForHome({
            quotes: rawStationQuotes,
            origin: location,
            minimumRating: minRating,
        })
    ), [
        location,
        minRating,
        rawStationQuotes,
    ]);
    const rankedStationQuotes = useMemo(() => {
        return rankQuotesForFuelGrade(filteredStationQuotes, selectedFuelGrade);
    }, [filteredStationQuotes, selectedFuelGrade]);
    const displayBestQuote = rankedStationQuotes[0] || null;
    const stationQuotes = useMemo(() => (
        rankedStationQuotes
            .map((q, idx) => ({ ...q, originalIndex: idx }))
    ), [rankedStationQuotes]);
    const stationQuotesSignature = useMemo(() => (
        stationQuotes
            .map(quote => [
                String(quote.stationId || ''),
                Number.isFinite(quote.latitude) ? quote.latitude.toFixed(5) : 'lat',
                Number.isFinite(quote.longitude) ? quote.longitude.toFixed(5) : 'lng',
            ].join(':'))
            .join('|')
    ), [stationQuotes]);
    const effectiveErrorMsg = useMemo(() => {
        if (errorMsg) {
            return errorMsg;
        }

        return rawStationQuotes.length > 0 && filteredStationQuotes.length === 0
            ? 'No nearby stations match your current filters.'
            : null;
    }, [errorMsg, filteredStationQuotes.length, rawStationQuotes.length]);

    const stationQuotesRef = useRef([]);
    const effectiveSuppressedStationIdsRef = useRef(new Set());
    const clustersSignatureRef = useRef('');

    const computedClusters = useMemo(() => {
        if (stationQuotes.length === 0) {
            return [];
        }

        if (!ENABLE_CLUSTER_MERGE_TRANSITIONS) {
            return buildSingleQuoteClusters(stationQuotes);
        }

        return groupStationsIntoClusters({
            stationQuotes,
            mapRegion,
            screenWidth: width,
            screenHeight: height,
        });
    }, [stationQuotes, mapRegion, width, height]);
    const rawSuppressedOverlapStationIds = useMemo(() => {
        if (ENABLE_CLUSTER_MERGE_TRANSITIONS) {
            return new Set();
        }

        const previousSuppressedStationIds = previousSuppressedStationSignatureRef.current === stationQuotesSignature
            ? previousSuppressedStationIdsRef.current
            : new Set();
        const activeStationId = stationQuotes[activeIndex]?.stationId ?? null;

        return buildSuppressedOverlapStationIds(
            stationQuotes,
            suppressionRegion,
            width,
            height,
            hasLocationPermission ? userLocationBubble : null,
            previousSuppressedStationIds,
            activeStationId
        );
    }, [activeIndex, stationQuotes, stationQuotesSignature, suppressionRegion, width, height, hasLocationPermission, userLocationBubble]);
    useEffect(() => {
        if (suppressionRevealDelayTimeoutRef.current) {
            clearTimeout(suppressionRevealDelayTimeoutRef.current);
            suppressionRevealDelayTimeoutRef.current = null;
        }

        if (isMapMoving) {
            setIsSuppressionRevealAllowed(false);
            return;
        }

        suppressionRevealDelayTimeoutRef.current = setTimeout(() => {
            suppressionRevealDelayTimeoutRef.current = null;

            if (!isMountedRef.current) {
                return;
            }

            setIsSuppressionRevealAllowed(true);
        }, SUPPRESSION_REVEAL_STABILITY_MS);

        return () => {
            if (suppressionRevealDelayTimeoutRef.current) {
                clearTimeout(suppressionRevealDelayTimeoutRef.current);
                suppressionRevealDelayTimeoutRef.current = null;
            }
        };
    }, [isMapMoving]);

    useEffect(() => {
        if (ENABLE_CLUSTER_MERGE_TRANSITIONS) {
            setEffectiveSuppressedStationIds(currentValue => (
                currentValue.size === 0 ? currentValue : new Set()
            ));
            return;
        }

        const shouldPauseSuppressionPersistence = (
            pendingHomeRefitRequestRef.current?.reason === 'initial-load' ||
            lastDataHashRef.current !== stationQuotesSignature
        );

        if (shouldPauseSuppressionPersistence) {
            // Do NOT wipe the effective suppressed set during the pause.
            // The pause is a transient window between "new data arrived"
            // and "home layout committed" — the very next state refresh
            // recomputes the persistent set from scratch anyway. Clearing
            // here causes a one-frame flicker where already-hidden chips
            // pop visible, then snap hidden again the instant the pause
            // releases. That flicker is strictly unwanted because those
            // chips are going to end up hidden regardless.
            //
            // Two sub-cases:
            //
            // 1. Re-fetch (currentValue is non-empty): prune station IDs
            //    whose station is no longer in the fresh dataset and
            //    keep everything else. This carries the suppression state
            //    through the pause untouched.
            //
            // 2. First start (currentValue is empty): seed directly from
            //    rawSuppressedOverlapStationIds so overlap suppression
            //    takes effect immediately instead of waiting for the
            //    layout to commit. Without this, overlapping chips stay
            //    visible during the entire initial map-fit animation
            //    because there is nothing to "preserve" yet.
            setEffectiveSuppressedStationIds(currentValue => {
                if (currentValue.size === 0 && rawSuppressedOverlapStationIds.size > 0) {
                    return rawSuppressedOverlapStationIds;
                }

                if (currentValue.size === 0) {
                    return currentValue;
                }

                const visibleStationIds = new Set(
                    stationQuotes.map(quote => String(quote.stationId))
                );
                const nextSuppressedIds = new Set();
                currentValue.forEach(stationId => {
                    if (visibleStationIds.has(String(stationId))) {
                        nextSuppressedIds.add(stationId);
                    }
                });

                return areStationIdSetsEqual(currentValue, nextSuppressedIds)
                    ? currentValue
                    : nextSuppressedIds;
            });
            return;
        }

        setEffectiveSuppressedStationIds(currentValue => {
            const visibleStationIds = new Set(stationQuotes.map(quote => String(quote.stationId)));
            const activeStationId = stationQuotes[activeIndex]?.stationId ?? null;
            // The active station bypasses every suppression rule in
            // buildSuppressedOverlapStationIds, so it is never in
            // rawSuppressedOverlapStationIds. Reveal it as soon as the user
            // selects it — waiting for isMapMoving/isSuppressionRevealAllowed to
            // settle would introduce a ~1s delay (600 ms map-idle grace +
            // 360 ms stability window) between the tap/scroll and the pill
            // reappearing, which reads as "the bug isn't fixed" to the user.
            // The isMapMoving/isSuppressionRevealAllowed gating was meant to
            // avoid flicker from overlap transients during passive panning, but
            // this is an explicit user commit, so immediate reveal is correct.
            const shouldRevealCommittedActiveStation = (
                activeStationId != null &&
                !rawSuppressedOverlapStationIds.has(String(activeStationId))
            );
            const nextSuppressedIds = buildPersistentSuppressedStationIds({
                currentSuppressedStationIds: rawSuppressedOverlapStationIds,
                previousPersistentSuppressedStationIds: currentValue,
                visibleStationIds,
                activeStationId,
                canRevealActiveStation: shouldRevealCommittedActiveStation,
            });

            return areStationIdSetsEqual(currentValue, nextSuppressedIds)
                ? currentValue
                : nextSuppressedIds;
        });
    }, [
        ENABLE_CLUSTER_MERGE_TRANSITIONS,
        activeIndex,
        homeLayoutSettlementVersion,
        isMapMoving,
        isSuppressionRevealAllowed,
        rawSuppressedOverlapStationIds,
        stationQuotes,
    ]);
    const visibleSuppressedStationIds = useMemo(() => {
        return buildVisibleSuppressedStationIds({
            suppressedStationIds: effectiveSuppressedStationIds,
        });
    }, [effectiveSuppressedStationIds]);
    const allStationsFitZoomRegion = useMemo(() => (
        buildStationsFitZoomRegion(stationQuotes, mapRegion)
    ), [stationQuotes, mapRegion]);
    const [clusters, setClusters] = useState(computedClusters);

    useEffect(() => {
        if (!isMapMoving) {
            setClusters(computedClusters);
        }
    }, [computedClusters, isMapMoving]);
    const renderedClusters = ENABLE_CLUSTER_MERGE_TRANSITIONS ? clusters : computedClusters;
    const clustersSignature = useMemo(() => (
        renderedClusters.map(buildClusterMembershipKey).join('|')
    ), [renderedClusters]);

    useEffect(() => {
        stationQuotesRef.current = stationQuotes;
    }, [stationQuotes]);

    useEffect(() => {
        previousSuppressedStationIdsRef.current = effectiveSuppressedStationIds;
        effectiveSuppressedStationIdsRef.current = effectiveSuppressedStationIds;
        previousSuppressedStationSignatureRef.current = stationQuotesSignature;
    }, [effectiveSuppressedStationIds, stationQuotesSignature]);

    useEffect(() => {
        const shouldInitializeDelay = shouldInitializeInitialSuppressionDelay({
            hasInitializedInitialSuppressionDelay,
            isMapLoaded,
            isMapMoving,
            stationCount: stationQuotes.length,
            hasSettledInitialStationLayout: lastDataHashRef.current === stationQuotesSignature,
        });

        if (!shouldInitializeDelay) {
            return;
        }

        setHasInitializedInitialSuppressionDelay(true);

        if (effectiveSuppressedStationIds.size === 0) {
            setIsInitialSuppressionDelayActive(false);
            setInitialSuppressionDelayStationIds(currentValue => (
                currentValue.size === 0 ? currentValue : new Set()
            ));
            return;
        }

        setInitialSuppressionDelayStationIds(new Set(effectiveSuppressedStationIds));
        setIsInitialSuppressionDelayActive(true);

        if (initialSuppressionDelayTimeoutRef.current) {
            clearTimeout(initialSuppressionDelayTimeoutRef.current);
        }

        initialSuppressionDelayTimeoutRef.current = setTimeout(() => {
            initialSuppressionDelayTimeoutRef.current = null;

            if (!isMountedRef.current) {
                return;
            }

            setIsInitialSuppressionDelayActive(false);
            setInitialSuppressionDelayStationIds(currentValue => (
                currentValue.size === 0 ? currentValue : new Set()
            ));
        }, INITIAL_HOME_SUPPRESSION_DELAY_MS);
    }, [
        hasInitializedInitialSuppressionDelay,
        homeLayoutSettlementVersion,
        isMapLoaded,
        isMapMoving,
        stationQuotes.length,
        stationQuotesSignature,
        effectiveSuppressedStationIds,
    ]);

    useEffect(() => {
        const pendingHomeRefitRequest = pendingHomeRefitRequestRef.current;
        const currentHash = stationQuotesSignature;
        const isNewData = currentHash !== lastDataHashRef.current;
        const homeRefitIntent = shouldAutoFitHomeMap({
            isFocused,
            isNewData,
            pendingRefitRequest: pendingHomeRefitRequest,
        });

        if (
            pendingHomeRefitRequest?.reason !== 'initial-load' ||
            !homeRefitIntent ||
            !isMapLoaded ||
            !mapRef.current ||
            !stationQuotesSignature ||
            isInitialStationsFitScheduledRef.current
        ) {
            return;
        }

        isInitialStationsFitScheduledRef.current = true;

        void (async () => {
            await waitForMapIdle(
                CLUSTER_DEBUG_PROBE_IDLE_TIMEOUT + STATIONS_FIT_SETTLE_PASS_DELAY_MS + CLUSTER_MAP_IDLE_SETTLE_MS
            );

            if (
                !isMountedRef.current ||
                !isFocusedRef.current ||
                pendingHomeRefitRequestRef.current?.reason !== 'initial-load' ||
                !mapRef.current ||
                stationQuotesRef.current.length === 0
            ) {
                isInitialStationsFitScheduledRef.current = false;
                return;
            }

            isInitialStationsFitScheduledRef.current = false;

            const runInitialFitAttempt = (attemptNumber = 0) => {
                if (
                    !isMountedRef.current ||
                    !isFocusedRef.current ||
                    pendingHomeRefitRequestRef.current?.reason !== 'initial-load' ||
                    !mapRef.current ||
                    stationQuotesRef.current.length === 0
                ) {
                    return;
                }

                const shouldAnimateAttempt = attemptNumber === 0 && homeRefitIntent.animated;
                const shouldRevealDuringFit = shouldRevealDuringInitialHomeFit({
                    isFirstLaunchWithoutCachedRegion: isFirstLaunchWithoutCachedRegionRef.current,
                    hasTriggeredInitialReveal: hasTriggeredInitialRevealRef.current,
                    isLaunchCriticalFitPending: isLaunchCriticalFitPendingRef.current,
                    shouldAnimateInitialFit: shouldAnimateAttempt,
                });

                if (shouldRevealDuringFit) {
                    setIsLaunchVisualReady(true);
                    triggerRevealOnMapLoaded();
                }

                fitMapToStations({
                    animated: shouldAnimateAttempt,
                    runSettlePass: !shouldRevealDuringFit && !shouldAnimateAttempt,
                });

                if (initialStationsFitRetryTimeoutRef.current) {
                    clearTimeout(initialStationsFitRetryTimeoutRef.current);
                }

                const shouldScheduleRetry = !shouldAnimateAttempt && attemptNumber < INITIAL_STATIONS_FIT_MAX_ATTEMPTS - 1;

                if (!shouldScheduleRetry) {
                    initialStationsFitRetryTimeoutRef.current = null;
                    commitSettledHomeLayout(currentHash);

                    if (
                        isFirstLaunchWithoutCachedRegionRef.current &&
                        !hasTriggeredInitialRevealRef.current
                    ) {
                        launchVisualReadyRequestIdRef.current += 1;
                        setIsLaunchCriticalFitPending(false);
                        void requestLaunchVisualReadyAfterIdle();
                    }

                    return;
                }

                initialStationsFitRetryTimeoutRef.current = setTimeout(() => {
                    initialStationsFitRetryTimeoutRef.current = null;

                    if (
                        pendingHomeRefitRequestRef.current?.reason === 'initial-load' &&
                        !isInitialStationsFitScheduledRef.current
                    ) {
                        runInitialFitAttempt(attemptNumber + 1);
                    }
                }, INITIAL_STATIONS_FIT_RETRY_DELAY_MS);
            };

            runInitialFitAttempt();
        })();
    }, [homeRefitRequestVersion, isFocused, isMapLoaded, stationQuotesSignature]);

    useEffect(() => {
        if (
            !isFirstLaunchWithoutCachedRegionRef.current ||
            !isLaunchCriticalFitPending ||
            !isMapLoaded ||
            stationQuotesSignature
        ) {
            return;
        }

        launchVisualReadyRequestIdRef.current += 1;
        setIsLaunchCriticalFitPending(false);
        void requestLaunchVisualReadyAfterIdle();
    }, [isLaunchCriticalFitPending, isMapLoaded, stationQuotesSignature]);

    useEffect(() => {
        if (activeIndex >= stationQuotes.length) {
            setActiveIndex(currentValue => resolveCommittedHomeActiveIndex({
                currentActiveIndex: currentValue,
                stationCount: stationQuotes.length,
                reason: 'bounds-correction',
            }));
            lastSettledCardIndexRef.current = 0;
        }
    }, [activeIndex, stationQuotes.length]);

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

    const zoomToStation = useCallback((quote) => {
        if (
            !mapRef.current ||
            !Number.isFinite(quote?.latitude) ||
            !Number.isFinite(quote?.longitude)
        ) {
            return;
        }

        const resolvedFocusZoom = resolveStationFocusZoom({
            targetQuote: quote,
            stationQuotes,
            baseFitRegion: allStationsFitZoomRegion,
            screenWidth: width,
            screenHeight: height,
            userLocation: hasLocationPermission ? userLocationBubble : null,
        });
        isAnimatingRef.current = true;
        setMapMotionState(true);
        mapRef.current.animateToRegion({
            latitude: quote.latitude,
            longitude: quote.longitude,
            latitudeDelta: resolvedFocusZoom.latitudeDelta,
            longitudeDelta: resolvedFocusZoom.longitudeDelta,
        }, STATION_FOCUS_ANIMATION_MS);
    }, [allStationsFitZoomRegion, hasLocationPermission, height, stationQuotes, userLocationBubble, width]);

    // We want the card to be almost full width, minus some padding to peek the next card.
    const peekPadding = 16;
    const itemWidth = width - (peekPadding * 2);
    const sideInset = (width - itemWidth) / 2;

    const lastDataHashRef = useRef('');
    const isUserScrollingRef = useRef(false);
    const isAnimatingRef = useRef(false);
    const mapMotionRef = useRef(false);

    const clearMapIdleSettleTimeout = () => {
        if (mapIdleSettleTimeoutRef.current) {
            clearTimeout(mapIdleSettleTimeoutRef.current);
            mapIdleSettleTimeoutRef.current = null;
        }
    };

    const clearFitSettlePassTimeout = () => {
        if (fitSettlePassTimeoutRef.current) {
            clearTimeout(fitSettlePassTimeoutRef.current);
            fitSettlePassTimeoutRef.current = null;
        }
    };

    const fitMapToStations = useCallback(({ animated = true, runSettlePass = false } = {}) => {
        if (!mapRef.current) {
            return;
        }

        // With continuous tracking on, the map is centered on the user's
        // live position at a fixed overview zoom. Station fits would fight
        // that tracker on every fresh snapshot, so we skip the camera work
        // and let downstream commit-settled-layout paths continue normally.
        if (hasLocationPermission && !manualLocationOverride) {
            return;
        }

        const buildFitCoordinates = (quotes, suppressedStationIds = null) => (
            (quotes || [])
                .filter(q => Number.isFinite(q?.latitude) && Number.isFinite(q?.longitude))
                .filter(q => !suppressedStationIds?.has(String(q.stationId)))
                .map(q => ({ latitude: q.latitude, longitude: q.longitude }))
        );
        const buildCoordinateSignature = (coordinates) => (
            (coordinates || [])
                .map(coord => (
                    `${coord.latitude.toFixed(5)}:${coord.longitude.toFixed(5)}`
                ))
                .join('|')
        );

        // Frame all visible stations without forcing the user-location bubble into the fit bounds.
        const coords = buildFitCoordinates(stationQuotes);

        if (coords.length === 0) {
            return;
        }

        clearFitSettlePassTimeout();

        isAnimatingRef.current = true;
        setMapMotionState(true);
        const baseTopPadding = topCanopyHeight + STATIONS_FIT_TOP_EXTRA_PADDING;
        const baseBottomPadding = bottomPadding + STATIONS_FIT_BOTTOM_CONTENT_PADDING;
        const upwardBiasPadding = Math.min(
            Math.round(height * STATIONS_FIT_UPWARD_BIAS_FACTOR),
            Math.max(0, baseTopPadding - 8)
        );
        const fitEdgePadding = {
            top: baseTopPadding - upwardBiasPadding,
            right: Math.max(horizontalPadding.right, sideInset) + STATIONS_FIT_SIDE_EXTRA_PADDING,
            bottom: baseBottomPadding + upwardBiasPadding,
            left: Math.max(horizontalPadding.left, sideInset) + STATIONS_FIT_SIDE_EXTRA_PADDING,
        };

        mapRef.current.fitToCoordinates(coords, {
            edgePadding: fitEdgePadding,
            animated,
        });

        if (runSettlePass) {
            const initialCoordinateSignature = buildCoordinateSignature(coords);

            fitSettlePassTimeoutRef.current = setTimeout(() => {
                fitSettlePassTimeoutRef.current = null;

                if (!mapRef.current) {
                    return;
                }

                const settledCoords = buildFitCoordinates(
                    stationQuotesRef.current,
                    effectiveSuppressedStationIdsRef.current
                );
                const nextCoords = settledCoords.length > 0 ? settledCoords : buildFitCoordinates(stationQuotesRef.current);

                if (nextCoords.length === 0) {
                    return;
                }

                if (buildCoordinateSignature(nextCoords) === initialCoordinateSignature) {
                    return;
                }

                mapRef.current.fitToCoordinates(nextCoords, {
                    edgePadding: fitEdgePadding,
                    animated: false,
                });
            }, STATIONS_FIT_SETTLE_PASS_DELAY_MS + CLUSTER_MAP_IDLE_SETTLE_MS);
        }
    }, [
        bottomPadding,
        hasLocationPermission,
        height,
        horizontalPadding.left,
        horizontalPadding.right,
        manualLocationOverride,
        sideInset,
        stationQuotes,
        topCanopyHeight,
    ]);

    const handleStationMarkerPress = useCallback((quote) => {
        const index = resolveCommittedHomeActiveIndex({
            currentActiveIndex: activeIndexRef.current,
            nextIndex: quote?.originalIndex,
            stationCount: stationQuotes.length,
            reason: 'marker-press',
        });

        if (!Number.isInteger(index)) {
            return;
        }

        lastSettledCardIndexRef.current = index;
        isUserScrollingRef.current = false;
        flatListRef.current?.scrollToOffset({
            offset: index * itemWidth,
            animated: true,
        });
        // Pause auto-follow so the tracker's next tick doesn't immediately
        // override the station focus the user just asked for.
        suppressAutoFollowAfterUserPan();
        primeCommittedSelectionMapMotion();
        setActiveIndex(index);

        if (index === 0) {
            fitMapToStations({
                animated: true,
                runSettlePass: false,
            });
            return;
        }

        zoomToStation(quote);
    }, [fitMapToStations, itemWidth, stationQuotes.length, zoomToStation]);

    const handleResetToCheapest = useCallback(() => {
        if (stationQuotes.length === 0) {
            return;
        }

        lastSettledCardIndexRef.current = 0;
        isUserScrollingRef.current = false;
        flatListRef.current?.scrollToOffset({
            offset: 0,
            animated: true,
        });
        // Same story as marker taps — give the fit-to-stations animation
        // room to breathe before the tracker reclaims the camera.
        suppressAutoFollowAfterUserPan();
        primeCommittedSelectionMapMotion();
        setActiveIndex(currentValue => resolveCommittedHomeActiveIndex({
            currentActiveIndex: currentValue,
            stationCount: stationQuotes.length,
            reason: 'reset',
        }));
        fitMapToStations({
            animated: true,
            runSettlePass: false,
        });
    }, [fitMapToStations, stationQuotes.length]);

    const setMapMotionState = (moving) => {
        if (mapMotionRef.current === moving) {
            return;
        }

        mapMotionRef.current = moving;
        setIsMapMoving(moving);
    };

    const primeCommittedSelectionMapMotion = () => {
        isAnimatingRef.current = true;
        setMapMotionState(true);
    };

    function cancelInitialHomeFitRetries() {
        isInitialStationsFitScheduledRef.current = false;
        clearFitSettlePassTimeout();

        if (initialStationsFitRetryTimeoutRef.current) {
            clearTimeout(initialStationsFitRetryTimeoutRef.current);
            initialStationsFitRetryTimeoutRef.current = null;
        }
    }

    function clearQueuedHomeRefitRequest() {
        pendingHomeRefitRequestRef.current = null;
        isQueuedHomeRefitScheduledRef.current = false;
    }

    function commitSettledHomeLayout(nextDataHash = lastDataHashRef.current) {
        lastDataHashRef.current = nextDataHash;
        clearQueuedHomeRefitRequest();
        setHomeLayoutSettlementVersion(currentValue => currentValue + 1);
    }

    function flushMapIdleWaitersWithoutAnimation(didReachIdle) {
        flushMapIdleWaiters(didReachIdle);
    }

    function resetMapMotionTracking() {
        clearMapIdleSettleTimeout();
        clearFitSettlePassTimeout();
        isQueuedHomeRefitScheduledRef.current = false;
        isAnimatingRef.current = false;
        setMapMotionState(false);
        flushMapIdleWaitersWithoutAnimation(false);
    }

    function queueHomeRefitRequest(nextRequest) {
        if (!nextRequest?.reason) {
            return;
        }

        const previousRequest = pendingHomeRefitRequestRef.current;
        const isSameRequest = previousRequest &&
            previousRequest.reason === nextRequest.reason &&
            previousRequest.querySignature === nextRequest.querySignature &&
            previousRequest.filterSignature === nextRequest.filterSignature &&
            previousRequest.renderedRequestVersion === nextRequest.renderedRequestVersion &&
            previousRequest.animated === nextRequest.animated &&
            previousRequest.forceAnimation === nextRequest.forceAnimation;

        if (isSameRequest) {
            return;
        }

        if (previousRequest?.reason !== nextRequest.reason) {
            cancelInitialHomeFitRetries();
        }

        if (previousRequest) {
            resetMapMotionTracking();
        }

        pendingHomeRefitRequestRef.current = nextRequest;
        isQueuedHomeRefitScheduledRef.current = false;
        setHomeRefitRequestVersion(currentValue => currentValue + 1);
    }

    function clearPendingHomeRefitRequest() {
        setStagedHomeRefitRequest(null);
        clearQueuedHomeRefitRequest();
        cancelInitialHomeFitRetries();
        resetMapMotionTracking();
    }

    function resetHomeSelectionToBest() {
        isUserScrollingRef.current = false;
        lastSettledCardIndexRef.current = 0;
        setActiveIndex(currentValue => resolveCommittedHomeActiveIndex({
            currentActiveIndex: currentValue,
            stationCount: stationQuotes.length,
            reason: 'reset',
        }));
        flatListRef.current?.scrollToOffset({
            offset: 0,
            animated: false,
        });
    }

    const setSuppressionRegionIfNeeded = (nextRegion) => {
        if (!nextRegion) {
            return;
        }

        suppressionRegionRef.current = nextRegion;
        setSuppressionRegion(currentRegion => (
            areRegionsEquivalent(currentRegion, nextRegion)
                ? currentRegion
                : nextRegion
        ));
    };

    const scheduleSuppressionRegionUpdate = (nextRegion) => {
        if (!nextRegion) {
            return;
        }

        pendingSuppressionRegionRef.current = nextRegion;

        if (suppressionRegionAnimationFrameRef.current != null) {
            return;
        }

        suppressionRegionAnimationFrameRef.current = requestAnimationFrame(() => {
            suppressionRegionAnimationFrameRef.current = null;
            const pendingRegion = pendingSuppressionRegionRef.current;
            pendingSuppressionRegionRef.current = null;

            if (!pendingRegion || !isMountedRef.current) {
                return;
            }

            setSuppressionRegionIfNeeded(pendingRegion);
        });
    };

    const setMapRegionIfNeeded = (nextRegion) => {
        if (!nextRegion) {
            return;
        }

        mapRegionRef.current = nextRegion;
        setSuppressionRegionIfNeeded(nextRegion);
        setMapRenderRegion(currentRegion => (
            areRegionsEquivalent(currentRegion, nextRegion)
                ? currentRegion
                : nextRegion
        ));

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

    async function requestLaunchVisualReadyAfterIdle() {
        if (
            !isFirstLaunchWithoutCachedRegionRef.current ||
            hasTriggeredInitialRevealRef.current ||
            isLaunchVisualReadyRef.current
        ) {
            return;
        }

        const requestId = launchVisualReadyRequestIdRef.current;
        const didReachIdle = await waitForMapIdle(
            CLUSTER_DEBUG_PROBE_IDLE_TIMEOUT + STATIONS_FIT_SETTLE_PASS_DELAY_MS + CLUSTER_MAP_IDLE_SETTLE_MS
        );

        if (
            !didReachIdle ||
            !isMountedRef.current ||
            requestId !== launchVisualReadyRequestIdRef.current ||
            isLaunchCriticalFitPendingRef.current
        ) {
            return;
        }

        setIsLaunchVisualReady(true);
    }

    useEffect(() => {
        if (!canTriggerHomeLaunchReveal({
            hasTriggeredInitialReveal: hasTriggeredInitialRevealRef.current,
            hasCompletedRootReveal,
            isFocused,
            isMapLoaded,
            isLaunchVisualReady,
        })) {
            return;
        }

        triggerRevealOnMapLoaded();
    }, [hasCompletedRootReveal, isFocused, isLaunchVisualReady, isMapLoaded]);

    useEffect(() => {
        if (!isFocused) {
            cancelInitialHomeFitRetries();
            resetMapMotionTracking();
        }
    }, [isFocused]);

    useEffect(() => {
        const pendingHomeRefitRequest = pendingHomeRefitRequestRef.current;

        if (
            !pendingHomeRefitRequest ||
            pendingHomeRefitRequest.reason === 'initial-load' ||
            !isFocused ||
            !isMapLoaded ||
            !mapRef.current ||
            stationQuotes.length === 0 ||
            isQueuedHomeRefitScheduledRef.current
        ) {
            return;
        }

        const currentHash = stationQuotesSignature;
        const isNewData = currentHash !== lastDataHashRef.current;
        const homeRefitIntent = shouldAutoFitHomeMap({
            isFocused,
            isNewData,
            pendingRefitRequest: pendingHomeRefitRequest,
        });

        if (!homeRefitIntent) {
            return;
        }

        if (
            pendingHomeRefitRequest.querySignature &&
            lastResolvedHomeQuerySignatureRef.current !== pendingHomeRefitRequest.querySignature
        ) {
            return;
        }

        const requestKey = [
            pendingHomeRefitRequest.reason,
            pendingHomeRefitRequest.filterSignature || '',
            pendingHomeRefitRequest.querySignature || '',
            pendingHomeRefitRequest.renderedRequestVersion || '',
        ].join('|');

        isQueuedHomeRefitScheduledRef.current = true;

        void (async () => {
            const didReachIdle = await waitForMapIdle(
                CLUSTER_DEBUG_PROBE_IDLE_TIMEOUT + CLUSTER_MAP_IDLE_SETTLE_MS
            );

            if (!isMountedRef.current) {
                isQueuedHomeRefitScheduledRef.current = false;
                return;
            }

            const latestRequest = pendingHomeRefitRequestRef.current;
            const latestRequestKey = latestRequest
                ? [
                    latestRequest.reason,
                    latestRequest.filterSignature || '',
                    latestRequest.querySignature || '',
                    latestRequest.renderedRequestVersion || '',
                ].join('|')
                : '';

            if (
                !latestRequest ||
                latestRequest.reason === 'initial-load' ||
                latestRequestKey !== requestKey ||
                !isFocusedRef.current ||
                !mapRef.current ||
                stationQuotesRef.current.length === 0
            ) {
                isQueuedHomeRefitScheduledRef.current = false;
                return;
            }

            if (
                latestRequest.querySignature &&
                lastResolvedHomeQuerySignatureRef.current !== latestRequest.querySignature
            ) {
                isQueuedHomeRefitScheduledRef.current = false;
                return;
            }

            if (!didReachIdle) {
                resetMapMotionTracking();
            }

            resetHomeSelectionToBest();
            fitMapToStations({
                animated: homeRefitIntent.animated,
                runSettlePass: homeRefitIntent.runSettlePass && !homeRefitIntent.animated,
            });
            commitSettledHomeLayout(currentHash);
        })();
    }, [fitMapToStations, homeRefitRequestVersion, isFocused, isMapLoaded, stationQuotes.length, stationQuotesSignature]);

    const resolveCardIndexFromOffset = (offsetX) => {
        return resolveHomeCardIndexFromOffset({
            offsetX,
            itemWidth,
            stationCount: stationQuotesRef.current.length,
        });
    };

    const settleCardSelection = (offsetX) => {
        const nextIndex = resolveCardIndexFromOffset(offsetX);

        isUserScrollingRef.current = false;

        if (nextIndex === null) {
            return;
        }

        setActiveIndex(currentValue => resolveCommittedHomeActiveIndex({
            currentActiveIndex: currentValue,
            nextIndex,
            stationCount: stationQuotesRef.current.length,
            reason: 'settle',
        }));

        if (lastSettledCardIndexRef.current === nextIndex) {
            return;
        }

        lastSettledCardIndexRef.current = nextIndex;
        primeCommittedSelectionMapMotion();

        if (nextIndex === 0) {
            fitMapToStations({
                animated: true,
                runSettlePass: false,
            });
            return;
        }

        const nextQuote = stationQuotesRef.current[nextIndex];

        if (nextQuote) {
            zoomToStation(nextQuote);
        }
    };

    const fallbackCoordinate = {
        latitude: location.latitude,
        longitude: location.longitude,
    };
    const benchmarkQuote = regionalQuotes.find(quote => quote.providerId !== bestQuote?.providerId) || regionalQuotes[0] || null;
    const watchedCluster = useMemo(() => {
        if (!debugClusterAnimations) {
            return null;
        }

        const multiQuoteClusters = renderedClusters.filter(cluster => cluster.quotes.length > 1);
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
    }, [debugClusterAnimations, renderedClusters, mapRegion.latitude, mapRegion.longitude, mapRegion.latitudeDelta, mapRegion.longitudeDelta]);
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
        if (!debugClusterAnimations || isClusterDebugProbeRunning || isClusterDebugRecording || !isMapLoaded) {
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
            !isMapLoaded ||
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
        isMapLoaded,
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
            isClusterDebugRecording ||
            !isMapLoaded
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
        isMapLoaded,
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

    const renderClusterEntries = renderedClusters.map(cluster => {
        const primaryStationId = cluster.quotes[0].stationId;
        return {
            key: primaryStationId,
            primaryStationId,
            cluster,
        };
    });
    const activeStationQuote = stationQuotes[activeIndex] || null;
    const shouldShowActiveStationOverlay = !ENABLE_CLUSTER_MERGE_TRANSITIONS && isMapLoaded && shouldShowActiveStationDecoration({
        activeQuote: activeStationQuote,
        suppressedStationIds: visibleSuppressedStationIds,
    });
    const hasRenderableClusters = renderClusterEntries.length > 0;
    const showResetToCheapestButton = stationQuotes.length > 1 && activeIndex !== 0;

    return (
        <View style={[styles.container, { backgroundColor: themeColors.background }]}>
            {isInitialMapRegionReady ? (
                <MapView
                    ref={mapRef}
                    style={StyleSheet.absoluteFillObject}
                    initialRegion={initialMapRegion}
                    provider={PROVIDER_APPLE}
                    showsUserLocation={hasLocationPermission}
                    onMapReady={() => {
                        markMapLoaded();
                    }}
                    onMapLoaded={() => {
                        markMapLoaded();
                    }}
                    onUserLocationChange={(event) => {
                        const coordinate = event?.nativeEvent?.coordinate;
                        const latitude = Number(coordinate?.latitude);
                        const longitude = Number(coordinate?.longitude);

                        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
                            return;
                        }

                        setUserLocationBubble(currentValue => {
                            if (
                                currentValue &&
                                Math.abs(currentValue.latitude - latitude) <= MAP_REGION_EPSILON &&
                                Math.abs(currentValue.longitude - longitude) <= MAP_REGION_EPSILON
                            ) {
                                return currentValue;
                            }

                            return { latitude, longitude };
                        });
                    }}
                    userInterfaceStyle={isDark ? 'dark' : 'light'}
                    onPanDrag={() => {
                        // Fires while the user is actively dragging the
                        // map. This is the only reliable way to detect a
                        // user-initiated pan while the 2 Hz driver is
                        // constantly firing programmatic animations — we
                        // can't rely on `isAnimatingRef` because it stays
                        // true for almost every `onRegionChange` event.
                        suppressAutoFollowAfterUserPan();
                    }}
                    onRegionChange={(region) => {
                        clearMapIdleSettleTimeout();
                        setMapMotionState(true);
                        mapRegionRef.current = region;
                        scheduleSuppressionRegionUpdate(region);
                    }}
                    onRegionChangeComplete={(region) => {
                        markMapLoaded();
                        recordLocationProbeEvent({
                            type: 'map-region-change-complete',
                            details: {
                                region: {
                                    latitude: Number(region?.latitude),
                                    longitude: Number(region?.longitude),
                                    latitudeDelta: Number(region?.latitudeDelta),
                                    longitudeDelta: Number(region?.longitudeDelta),
                                },
                            },
                        });
                        if (suppressionRegionAnimationFrameRef.current != null) {
                            cancelAnimationFrame(suppressionRegionAnimationFrameRef.current);
                            suppressionRegionAnimationFrameRef.current = null;
                        }
                        pendingSuppressionRegionRef.current = null;
                        setSuppressionRegionIfNeeded(region);
                        setMapRenderRegion(region);
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
                    {isMapLoaded ? (
                        ENABLE_CLUSTER_MERGE_TRANSITIONS
                            ? (!hasRenderableClusters ? (
                                <Marker
                                    coordinate={fallbackCoordinate}
                                    title="No Prices Returned"
                                    description={
                                        effectiveErrorMsg
                                            ? effectiveErrorMsg
                                            : isLoadingLocation
                                                ? 'Finding your location'
                                                : 'Checking fuel providers'
                                    }
                                    pinColor="#D46A4C"
                                />
                            ) : null)
                            : (hasRenderableClusters ? (
                                <>
                                    {renderClusterEntries.map(entry => {
                                        const quote = entry.cluster.quotes[0];
                                        const isSuppressed = visibleSuppressedStationIds.has(String(entry.primaryStationId));

                                        return (
                                            <StationMarker
                                                key={entry.key}
                                                quote={quote}
                                                isSuppressed={isSuppressed}
                                                shouldDelaySuppression={shouldDelayStationMarkerSuppression({
                                                    stationId: entry.primaryStationId,
                                                    isSuppressed,
                                                    isInitialSuppressionDelayActive,
                                                    initialSuppressionStationIds: initialSuppressionDelayStationIds,
                                                })}
                                                isBest={quote.originalIndex === 0}
                                                isDark={isDark}
                                                onPress={handleStationMarkerPress}
                                            />
                                        );
                                    })}
                                    {shouldShowActiveStationOverlay ? (
                                        <ActiveStationOverlay
                                            key={[
                                                activeStationQuote?.stationId ?? 'none',
                                                isDark ? 'dark' : 'light',
                                                activeStationQuote?.originalIndex === 0 ? 'best' : 'normal',
                                            ].join('-')}
                                            quote={activeStationQuote}
                                            isBest={activeStationQuote?.originalIndex === 0}
                                            isDark={isDark}
                                            themeColors={themeColors}
                                        />
                                    ) : null}
                                </>
                            ) : (
                                <Marker
                                    coordinate={fallbackCoordinate}
                                    title="No Prices Returned"
                                    description={
                                        effectiveErrorMsg
                                            ? effectiveErrorMsg
                                            : isLoadingLocation
                                                ? 'Finding your location'
                                                : 'Checking fuel providers'
                                    }
                                    pinColor="#D46A4C"
                                />
                            ))
                    ) : null}
                </MapView>
            ) : null}

            {ENABLE_CLUSTER_MERGE_TRANSITIONS && isMapLoaded && hasRenderableClusters ? (
                <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
                    {renderClusterEntries.map(entry => (
                        <ClusterMarkerOverlay
                            key={entry.key}
                            cluster={entry.cluster}
                            anchorCoordinate={location}
                            isSuppressed={visibleSuppressedStationIds.has(String(entry.primaryStationId))}
                            scrollX={scrollX}
                            itemWidth={itemWidth}
                            isDark={isDark}
                            themeColors={themeColors}
                            activeIndex={activeIndex}
                            onDebugTransitionEvent={recordClusterDebugTransitionEvent}
                            onDebugRenderFrame={recordClusterDebugRenderFrame}
                            isDebugWatched={entry.primaryStationId === activeClusterDebugPrimaryId}
                            isDebugRecording={isClusterDebugRecording}
                            mapRegion={mapRenderRegion}
                            isMapMoving={isMapMoving}
                        />
                    ))}
                </View>
            ) : null}

            <TopCanopy edgeColor={canopyEdgeLine} height={topCanopyHeight} isDark={isDark} topInset={insets.top} />
            <BottomCanopy height={bottomPadding + 220} isDark={isDark} variant="home" />

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
                            force: true,
                        })
                    }
                >
                    <GlassView
                        style={[
                            styles.reloadButton,
                            isRefreshingPrices || isLoadingLocation ? styles.reloadButtonDisabled : null,
                        ]}
                        tintColor={homeGlassTintColor}
                        glassEffectStyle="clear"
                        key={isDark ? 'reload-dark' : 'reload-light'}
                    >
                        <Ionicons color={themeColors.text} name="refresh" size={16} />
                        <Text
                            style={[styles.reloadButtonText, { color: themeColors.text }]}
                            numberOfLines={1}
                            adjustsFontSizeToFit
                            minimumFontScale={0.75}
                            allowFontScaling={false}
                        >
                            Reload
                        </Text>
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
                <FuelUpHeaderLogo isDark={isDark} style={styles.headerLogo} />
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
                                    quotesData: stationQuotes.length > 0 ? JSON.stringify(stationQuotes) : JSON.stringify([displayBestQuote].filter(Boolean)),
                                    benchmarkData: benchmarkQuote ? JSON.stringify(benchmarkQuote) : null,
                                    errorMsg: effectiveErrorMsg || '',
                                    fuelGrade: selectedFuelGrade,
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
                        onScrollBeginDrag={() => { isUserScrollingRef.current = true; }}
                        onMomentumScrollEnd={(event) => {
                            settleCardSelection(event?.nativeEvent?.contentOffset?.x);
                        }}
                        onScrollEndDrag={(event) => {
                            const targetOffsetX = event?.nativeEvent?.targetContentOffset?.x;

                            if (Number.isFinite(targetOffsetX)) {
                                settleCardSelection(targetOffsetX);
                            }
                        }}
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
                                errorMsg={effectiveErrorMsg}
                                fuelGrade={selectedFuelGrade}
                                isRefreshing={isRefreshingPrices || isLoadingLocation}
                                themeColors={themeColors}
                                glassTintColor={homeGlassTintColor}
                                onNavigatePress={handleStationNavigatePress}
                            />
                        )}
                    />
                ) : (
                    <View style={{ width: width, paddingHorizontal: sideInset }}>
                        <FuelSummaryCard
                            benchmarkQuote={benchmarkQuote}
                            errorMsg={effectiveErrorMsg}
                            fuelGrade={selectedFuelGrade}
                            glassTintColor={homeGlassTintColor}
                            isDark={isDark}
                            isRefreshing={isRefreshingPrices || isLoadingLocation}
                            quote={displayBestQuote}
                            themeColors={themeColors}
                            onNavigatePress={handleStationNavigatePress}
                        />
                    </View>
                )}
            </View>

            {showResetToCheapestButton ? (
                <Animated.View
                    entering={ZoomIn.duration(180)}
                    exiting={ZoomOut.duration(140)}
                    style={[
                        styles.resetToCheapestShell,
                        {
                            bottom: insets.bottom + 10,
                            paddingLeft: horizontalPadding.left,
                            paddingRight: horizontalPadding.right,
                        },
                    ]}
                >
                    <ResetToCheapestButton
                        glassTintColor={homeGlassTintColor}
                        isDark={isDark}
                        onPress={handleResetToCheapest}
                        themeColors={themeColors}
                    />
                </Animated.View>
            ) : null}
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
    headerLogo: {
        marginBottom: 10,
    },
    contentOverlay: {
        position: 'absolute',
        width: '100%',
        alignItems: 'center',
    },
    resetToCheapestShell: {
        position: 'absolute',
        left: 0,
        right: 0,
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2,
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
