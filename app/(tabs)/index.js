import useClusterProbe from '../../src/screens/home/useClusterProbe';
import { buildTrajectorySeedFromLocationObject } from '../../src/screens/home/constants';
import {
    hasUsableHomeRegion,
    buildTrajectorySeedFromVelocity,
    areRegionsEquivalent,
    shouldAnimateSmoothLaunchTransition,
    fetchLastKnownPositionWithTimeout,
    fetchCurrentPositionWithTimeout,
    resolveLaunchMovementCheckPosition,
    startLaunchMovementCheck,
} from '../../src/screens/home/locationBootstrap.js';
import {
    buildSingleQuoteClusters,
    areStationIdSetsEqual,
    buildSuppressedOverlapStationIds,
    resolveStationFocusZoom,
    buildStationsFitZoomRegion,
} from '../../src/screens/home/mapGeometry.js';
import { AnimatedCardItem } from '../../src/screens/home/AnimatedCardItem.js';
import {
    DEFAULT_REGION,
    SIDE_MARGIN,
    TOP_CANOPY_HEIGHT,
    MAP_REGION_EPSILON,
    CLUSTER_DEBUG_PROBE_IDLE_TIMEOUT,
    CLUSTER_MAP_IDLE_SETTLE_MS,
    STATION_FOCUS_ANIMATION_MS,
    FOREGROUND_RECENTER_ANIMATION_MS,
    STATIONS_FIT_SETTLE_PASS_DELAY_MS,
    INITIAL_HOME_SUPPRESSION_DELAY_MS,
    INITIAL_STATIONS_FIT_MAX_ATTEMPTS,
    INITIAL_STATIONS_FIT_RETRY_DELAY_MS,
    LAUNCH_MOVEMENT_RECOVERY_TIMEOUT_MS,
    ENABLE_CLUSTER_MERGE_TRANSITIONS,
    HOME_DARK_GLASS_TINT,
    TRACKING_IDLE_GRACE_MS,
    LIVE_TRACKING_DISTANCE_INTERVAL_METERS,
    LIVE_TRACKING_PAN_SUPPRESS_MS,
    LIVE_TRACKING_STATE_UPDATE_METERS,
    LIVE_TRACKING_REFETCH_MIN_INTERVAL_MS,
} from '../../src/screens/home/constants.js';
import { buildOverviewCoordinates, cameraTargetChanged, homeMapPadding } from '../../src/screens/home/mapCamera';
import { startTransition, useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { AppState, Pressable, StyleSheet, Text, View, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { GlassView } from 'expo-glass-effect';
import * as Location from 'expo-location';
import MapView, { PROVIDER_APPLE } from 'react-native-maps';
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
import ClusterMarkerOverlay from '../../src/components/cluster/ClusterMarkerOverlay';
import StationMarker from '../../src/components/cluster/StationMarker';
import { consumeFreshLaunchMapBootstrap } from '../../src/lib/appLaunchState';
import { getLastDeviceLocationSnapshot, persistLastDeviceLocationRegion } from '../../src/lib/deviceLocationCache';
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
import { flushLocationProbeReportAsync, recordLocationProbeEvent } from '../../src/lib/locationProbe';
import { openStationNavigation } from '../../src/lib/openNavigation';
import { normalizeFuelGrade, rankQuotesForFuelGrade } from '../../src/lib/fuelGrade';
import { buildFuelSearchRequestKey, buildResolvedFuelSearchContext } from '../../src/lib/fuelSearchState';
import {
    buildPausedSuppressedStationIds,
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
import { buildClusterMembershipKey } from '../../src/cluster/layout';
import Animated, { useSharedValue, useAnimatedScrollHandler, ZoomIn, ZoomOut } from 'react-native-reanimated';
export default function HomeScreen() {
    const mapRef = useRef(null);
    const flatListRef = useRef(null);
    const isMountedRef = useRef(true);
    const shouldUseLaunchLocationBootstrapRef = useRef(consumeFreshLaunchMapBootstrap());
    const launchCachedRegionRef = useRef(null);
    const pendingInstantMapRegionRef = useRef(null);
    const mapIdleWaitersRef = useRef([]);
    const mapIdleSettleTimeoutRef = useRef(null);
    const fitSettlePassTimeoutRef = useRef(null);
    const mapRegionRef = useRef(DEFAULT_REGION);
    const suppressionRegionRef = useRef(DEFAULT_REGION);
    const previousSuppressedStationIdsRef = useRef(new Set());
    const previousSuppressedStationSignatureRef = useRef('');
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
    const [activeAppState, setActiveAppState] = useState(AppState.currentState);
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
    const [isLaunchVisualReady, setIsLaunchVisualReady] = useState(false);
    const [isLaunchCriticalFitPending, setIsLaunchCriticalFitPending] = useState(false);
    const [homeRefitRequestVersion, setHomeRefitRequestVersion] = useState(0);
    const [homeLayoutSettlementVersion, setHomeLayoutSettlementVersion] = useState(0);
    const [stagedHomeRefitRequest, setStagedHomeRefitRequest] = useState(null);
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

    const [cardHeight, setCardHeight] = useState(180);
    const bottomPadding = insets.bottom + 60;
    const lastTrackingTargetRef = useRef(null);
    const cameraPadding = homeMapPadding({ topInset: insets.top, bottomInset: insets.bottom, cardHeight, width: Dimensions.get('window').width });
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

            if (initialSuppressionDelayTimeoutRef.current) {
                clearTimeout(initialSuppressionDelayTimeoutRef.current);
                initialSuppressionDelayTimeoutRef.current = null;
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

    const animateToTrackingOverview = ({ force = true } = {}) => {
        if (!mapRef.current || !isMapLoaded) return;
        const fix = latestFixRef.current || location;
        const stations = stationQuotesRef.current || [];
        const target = {
            latitude: fix.latitude, longitude: fix.longitude,
            stationSignature: stations.map(q => `${q.stationId}:${q.latitude}:${q.longitude}`).join('|'),
            paddingSignature: JSON.stringify(cameraPadding),
        };
        if (!force && !cameraTargetChanged(lastTrackingTargetRef.current, target)) return;
        const coordinates = buildOverviewCoordinates(stations, fix);
        if (!coordinates.length) return;
        lastTrackingTargetRef.current = target;
        clearFitSettlePassTimeout();
        isAnimatingRef.current = true;
        setMapMotionState(true);
        mapRef.current.fitToCoordinates(coordinates, { edgePadding: cameraPadding, animated: true });
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
        const snapshotFuelGrade = selectedFuelGrade;
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
    // follows new location fixes, allowing MapKit to finish each transition and
    // continuous motion because react-native-maps' duration argument is
    // a no-op on iOS Apple Maps (see the tracking settings comment above).
    const liveTrackingSubscriptionRef = useRef(null);
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
    // Timestamp of the last user interaction (card swipe, pan, marker tap)
    // that should delay tracking engagement. The driver waits
    // TRACKING_IDLE_GRACE_MS after this before re-engaging.
    const lastUserInteractionAtRef = useRef(0);
    // The stationId of the cheapest station that the tracking driver last
    // computed its zoom for. Used to detect cheapest-station changes and
    // trigger a slower, smoother re-zoom animation.
    const lastTrackedCheapestStationIdRef = useRef(null);

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
            latitudeDelta: DEFAULT_REGION.latitudeDelta,
            longitudeDelta: DEFAULT_REGION.longitudeDelta,
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
        const snapshotFuelGrade = selectedFuelGrade;
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

    const runLiveTrackingDriverTick = () => {
        if (!isMountedRef.current || manualLocationOverride || hasUserRecentlyPannedRef.current ||
            activeIndexRef.current !== 0 || Date.now() - lastUserInteractionAtRef.current < TRACKING_IDLE_GRACE_MS) return;
        animateToTrackingOverview({ force: false });
    };

    const runLiveTrackingDriverTickRef = useRef(null);
    runLiveTrackingDriverTickRef.current = runLiveTrackingDriverTick;

    const suppressAutoFollowAfterUserPan = () => {
        lastUserInteractionAtRef.current = Date.now();
        hasUserRecentlyPannedRef.current = true;

        if (userPanSuppressTimeoutRef.current) {
            clearTimeout(userPanSuppressTimeoutRef.current);
        }

        userPanSuppressTimeoutRef.current = setTimeout(() => {
            userPanSuppressTimeoutRef.current = null;
            hasUserRecentlyPannedRef.current = false;
            runLiveTrackingDriverTickRef.current?.();
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

    // Watch actual movement only while Home is visible and the app is active.
    useEffect(() => {
        if (manualLocationOverride || !hasLocationPermission || !isFocused || activeAppState !== 'active') {
            return undefined;
        }

        let cancelled = false;

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
                        runLiveTrackingDriverTickRef.current?.();
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
            if (liveTrackingSubscriptionRef.current) {
                liveTrackingSubscriptionRef.current.remove();
                liveTrackingSubscriptionRef.current = null;
            }
            latestFixRef.current = null;
            latestVelocityRef.current = { latPerMs: 0, lngPerMs: 0 };
            lastTrackedCheapestStationIdRef.current = null;
        };
    }, [activeAppState, hasLocationPermission, isFocused, manualLocationOverride]);

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
            setActiveAppState(nextAppState);

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
            // The pause is a transient window between "new data arrived"
            // and "home layout committed". Instead of clearing the
            // effective set (which flickers hidden chips visible for one
            // frame), preserve the existing set, prune dead stations,
            // and still apply the active-station-reveal so tapping a
            // station during data settlement works immediately.
            setEffectiveSuppressedStationIds(currentValue => {
                const nextSuppressedIds = buildPausedSuppressedStationIds({
                    currentEffectiveSuppressedStationIds: currentValue,
                    rawSuppressedOverlapStationIds,
                    visibleStationIds: new Set(stationQuotes.map(q => String(q.stationId))),
                    activeStationId: stationQuotes[activeIndex]?.stationId ?? null,
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
            // Explicit selection reveals the station immediately, without a
            // timer or waiting for passive map panning to settle.
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
        runLiveTrackingDriverTickRef.current?.();
    }, [stationQuotes, cardHeight, isMapLoaded]);

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

        const buildFitCoordinates = (quotes, suppressedStationIds = null) => (
            (quotes || [])
                .filter(q => Number.isFinite(q?.latitude) && Number.isFinite(q?.longitude))
                .filter(q => !suppressedStationIds?.has(String(q.stationId)))
                .map(q => ({ latitude: q.latitude, longitude: q.longitude }))
        );

        // Frame all visible stations without forcing the user-location bubble into the fit bounds.
        const coords = buildFitCoordinates(stationQuotes);

        if (coords.length === 0) {
            return;
        }

        clearFitSettlePassTimeout();

        isAnimatingRef.current = true;
        setMapMotionState(true);
        const fitEdgePadding = cameraPadding;

        mapRef.current.fitToCoordinates(coords, {
            edgePadding: fitEdgePadding,
            animated,
        });

    }, [stationQuotes, cardHeight, insets.top, insets.bottom, width]);

    const handleStationMarkerPress = useCallback((quote) => {
        lastUserInteractionAtRef.current = Date.now();
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
            if (hasLocationPermission && !manualLocationOverride) {
                animateToTrackingOverview();
            } else {
                fitMapToStations({
                    animated: true,
                    runSettlePass: false,
                });
            }
            return;
        }

        zoomToStation(quote);
    }, [fitMapToStations, hasLocationPermission, itemWidth, manualLocationOverride, stationQuotes.length, zoomToStation]);

    const handleResetToCheapest = useCallback(() => {
        lastUserInteractionAtRef.current = Date.now();
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
        if (hasLocationPermission && !manualLocationOverride) {
            animateToTrackingOverview();
        } else {
            fitMapToStations({
                animated: true,
                runSettlePass: false,
            });
        }
    }, [fitMapToStations, hasLocationPermission, manualLocationOverride, stationQuotes.length]);

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
        lastUserInteractionAtRef.current = Date.now();
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
            if (hasLocationPermission && !manualLocationOverride) {
                animateToTrackingOverview();
            } else {
                fitMapToStations({
                    animated: true,
                    runSettlePass: false,
                });
            }
            return;
        }

        const nextQuote = stationQuotesRef.current[nextIndex];

        if (nextQuote) {
            zoomToStation(nextQuote);
        }
    };


    const benchmarkQuote = regionalQuotes.find(quote => quote.providerId !== bestQuote?.providerId) || regionalQuotes[0] || null;
    const { isClusterDebugRecording, isClusterDebugProbeRunning, clusterDebugProbeSummary, recordClusterDebugTransitionEvent, watchedCluster, watchedClusterDiagnostic, activeClusterDebugPrimaryId, recordClusterDebugRenderFrame, handleStartClusterDebugRecording, handleStopClusterDebugRecording, handleRunClusterDebugProbe } = useClusterProbe({
        debugClusterAnimations,
        renderedClusters,
        mapRegion,
        mapRef,
        mapRegionRef,
        setMapRegionIfNeeded,
        isAnimatingRef,
        setMapMotionState,
        waitForMapIdle,
        isMountedRef,
        mapMotionRef,
        isMapLoaded,
        location,
        clustersSignatureRef,
        stationQuotesRef,
        width,
        height,
        finishClusterProbeSession,
        autoClusterProbeRequested,
        isMapMoving,
        autoClusterProbeRequestKey,
        stationQuotes,
        autoClusterProbeRequestSource,
        flushMapIdleWaiters
    });

    const renderClusterEntries = renderedClusters.map(cluster => {
        const primaryStationId = cluster.quotes[0].stationId;
        return {
            key: primaryStationId,
            primaryStationId,
            cluster,
        };
    });
    const activeStationQuote = stationQuotes[activeIndex] || null;
    const activeStationId = activeStationQuote ? String(activeStationQuote.stationId) : null;
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
                    showsUserLocation={hasLocationPermission && activeAppState === 'active'}
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
                        // Let the user explore without automatic recentering.
                        suppressAutoFollowAfterUserPan();
                    }}
                    onRegionChange={(region) => {
                        clearMapIdleSettleTimeout();
                        setMapMotionState(true);
                        mapRegionRef.current = region;
                        // Keep collision state stable during native camera movement;
                        // reconcile once in onRegionChangeComplete.
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
                    {isMapLoaded && !ENABLE_CLUSTER_MERGE_TRANSITIONS ? (<>
                                    {renderClusterEntries.map(entry => {
                                        const quote = entry.cluster.quotes[0];
                                        const entryStationId = String(entry.primaryStationId);
                                        const isSuppressed = visibleSuppressedStationIds.has(entryStationId);

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
                                                isActive={entryStationId === activeStationId}
                                                isDark={isDark}
                                                onPress={handleStationMarkerPress}
                                                useOnboardingColors={Boolean(preferences.useOnboardingChipColors)}
                                            />
                                        );
                                    })}
                    </>) : null}
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
                            useOnboardingColors={Boolean(preferences.useOnboardingChipColors)}
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
                onLayout={event => {
                    const measured = event.nativeEvent.layout.height;
                    setCardHeight(current => Math.abs(current - measured) > 1 ? measured : current);
                }}
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
                            bottom: insets.bottom + 8,
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
