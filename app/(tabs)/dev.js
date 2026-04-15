import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/ThemeContext';
import { useAppState } from '../../src/AppStateContext';
import { usePreferences } from '../../src/PreferencesContext';
import TopCanopy from '../../src/components/TopCanopy';
import FuelUpHeaderLogo from '../../src/components/FuelUpHeaderLogo';
import NativeDevForm from '../../src/components/dev/NativeDevForm';
import { getApiStats, resetApiStats } from '../../src/lib/devCounter';
import {
    scheduleTestNotification,
    startLiveActivity,
    updateLiveActivity,
    endLiveActivity,
} from '../../src/lib/notifications';
import { isFuelCacheResetError, refreshFuelPriceSnapshot } from '../../src/services/fuel';

const { createPredictiveFuelingEngine } = require('../../src/lib/predictiveFuelingEngine.js');
const { createPredictiveTestHarness } = require('../../src/lib/predictiveTestHarness.js');
const { TEST_ROUTES, DENVER_STATIONS } = require('../../src/data/testRoutes.js');
const { runBatchMetrics } = require('../../src/lib/predictionMetrics.js');
const { createMLPredictor, generateTrainingData } = require('../../src/lib/mlPredictor.js');
const { computePRF1, gridSearchParameters } = require('../../src/lib/accuracyMetrics.js');
const { createBackgroundFetchSimulator, NETWORK_CONDITIONS } = require('../../src/lib/backgroundFetchSimulator.js');
const { estimateRange, formatUrgencyMessage, SYNTHETIC_FILL_UP_HISTORIES } = require('../../src/lib/rangeEstimator.js');
const { PROFILE_PRESETS } = require('../../src/lib/userFuelingProfile.js');
const { EXPANDED_TEST_ROUTES, EXPANDED_STATIONS } = require('../../src/data/expandedTestRoutes.js');

const TOP_CANOPY_HEIGHT = 44;

export default function DevStatsScreen() {
    const insets = useSafeAreaInsets();
    const { isDark, themeColors } = useTheme();
    const {
        manualLocationOverride,
        setFuelDebugState,
        setManualLocationOverride,
        clearManualLocationOverride,
    } = useAppState();
    const { preferences, updatePreference } = usePreferences();
    const [stats, setStats] = useState({
        gasbuddy: 0,
        google: 0,
        supabase: 0,
        barchart: 0,
        tomtom: 0,
    });
    const [isRefreshingFuel, setIsRefreshingFuel] = useState(false);
    const [testTitle, setTestTitle] = useState('Test Push');
    const [testBody, setTestBody] = useState('This is a local push notification test.');
    const [liveActivityInstance, setLiveActivityInstance] = useState(null);
    const [selectedRouteId, setSelectedRouteId] = useState(TEST_ROUTES[0].id);
    const [harnessPhase, setHarnessPhase] = useState('idle');
    const [harnessStep, setHarnessStep] = useState(0);
    const [harnessTotal, setHarnessTotal] = useState(0);
    const [speedMult, setSpeedMult] = useState(10);
    const [stationScores, setStationScores] = useState([]);
    const [batchResults, setBatchResults] = useState(null);
    const [isBatchRunning, setIsBatchRunning] = useState(false);
    const [triggerLog, setTriggerLog] = useState([]);
    const [predictionMode, setPredictionMode] = useState('heuristic');
    const [mlStatus, setMlStatus] = useState('untrained');
    const [mlMetrics, setMlMetrics] = useState(null);
    const [heuristicPRF1, setHeuristicPRF1] = useState(null);
    const [gridSearchResults, setGridSearchResults] = useState(null);
    const [isGridSearching, setIsGridSearching] = useState(false);
    const [selectedProfileId, setSelectedProfileId] = useState('balanced');
    const [fillUpHistoryKey, setFillUpHistoryKey] = useState('frequent_filler');
    const [rangeResult, setRangeResult] = useState(null);
    const [fetchNetworkCondition, setFetchNetworkCondition] = useState('good');
    const [fetchIntervalKey, setFetchIntervalKey] = useState('moderate');
    const [fetchStats, setFetchStats] = useState(null);
    const [fetchLog, setFetchLog] = useState([]);
    const [useExpandedRoutes, setUseExpandedRoutes] = useState(false);

    const engineRef = useRef(null);
    const harnessRef = useRef(null);
    const mlPredictorRef = useRef(null);
    const fetchSimRef = useRef(null);

    const canopyEdgeLine = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)';
    const topCanopyHeight = insets.top + TOP_CANOPY_HEIGHT;
    const debugEnabled = Boolean(preferences.debugClusterAnimations);

    useFocusEffect(
        useCallback(() => {
            getApiStats().then(setStats);
        }, [])
    );

    useEffect(() => {
        engineRef.current = createPredictiveFuelingEngine({
            onTrigger: (event) => {
                setTriggerLog(prev => [{
                    stationId: event.stationId,
                    confidence: event.confidence.toFixed(3),
                    time: new Date().toLocaleTimeString(),
                }, ...prev].slice(0, 5));
            },
            onScoresUpdated: (scoresMap) => {
                const nextScores = Array.from(scoresMap.values())
                    .sort((left, right) => right.confidence - left.confidence)
                    .slice(0, 6);
                setStationScores(nextScores);
            },
        });

        return () => {
            if (harnessRef.current) {
                harnessRef.current.reset();
            }
        };
    }, []);

    const resolveActiveCoordinates = async () => {
        if (
            manualLocationOverride &&
            Number.isFinite(Number(manualLocationOverride.latitude)) &&
            Number.isFinite(Number(manualLocationOverride.longitude))
        ) {
            return {
                latitude: Number(manualLocationOverride.latitude),
                longitude: Number(manualLocationOverride.longitude),
                source: 'manual',
            };
        }

        let permission = await Location.getForegroundPermissionsAsync();
        if (permission.status !== 'granted') {
            permission = await Location.requestForegroundPermissionsAsync();
        }

        if (permission.status !== 'granted') {
            throw new Error('Location permission denied.');
        }

        const loc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
        });

        return {
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
            source: 'device',
        };
    };

    const handleReset = async () => {
        const fresh = await resetApiStats();
        setStats(fresh);
    };

    const handleRunHourlyRefreshPath = async () => {
        if (isRefreshingFuel) {
            return;
        }

        setIsRefreshingFuel(true);
        try {
            const coords = await resolveActiveCoordinates();
            const query = {
                latitude: coords.latitude,
                longitude: coords.longitude,
                radiusMiles: preferences.searchRadiusMiles || 10,
                fuelType: preferences.preferredOctane || 'regular',
                allowLiveGasBuddy: true,
                preferredProvider: 'gasbuddy',
                forceLiveGasBuddy: true,
            };

            const result = await refreshFuelPriceSnapshot(query);
            if (result?.debugState) {
                setFuelDebugState(result.debugState);
            }

            const latestStats = await getApiStats();
            setStats(latestStats);

            const quote = result?.snapshot?.quote || null;
            const gasBuddyDebug = (result?.debugState?.providers || []).find(
                provider => provider?.providerId === 'gasbuddy'
            );
            const persistedCount = gasBuddyDebug?.summary?.persistedLiveRowCount;
            const persistError = gasBuddyDebug?.summary?.persistError;
            const persistLine = typeof persistedCount === 'number'
                ? `\nDB persisted rows: ${persistedCount}`
                : '';
            const persistErrorLine = persistError ? `\nDB write error: ${persistError}` : '';

            Alert.alert(
                'Hourly Refresh Complete',
                quote
                    ? `${quote.stationName}: $${Number(quote.price).toFixed(2)} (${coords.source}, gasbuddy live)${persistLine}${persistErrorLine}`
                    : `No station quote returned (${coords.source}).${persistLine}${persistErrorLine}`
            );
        } catch (error) {
            if (isFuelCacheResetError(error)) {
                return;
            }

            if (error?.debugState) {
                setFuelDebugState(error.debugState);
            }

            Alert.alert(
                'Hourly Refresh Failed',
                error?.userMessage || error?.message || 'Unable to run hourly refresh path.'
            );
        } finally {
            setIsRefreshingFuel(false);
        }
    };

    function getOrCreateHarness() {
        if (!harnessRef.current) {
            harnessRef.current = createPredictiveTestHarness({
                engine: engineRef.current,
                setManualLocationOverride,
                clearManualLocationOverride,
                onStep: ({ stepIndex, totalSteps }) => {
                    setHarnessStep(stepIndex);
                    setHarnessTotal(totalSteps);
                },
                onComplete: () => setHarnessPhase('complete'),
            });
        }

        return harnessRef.current;
    }

    function handleRouteSelect(routeId) {
        setSelectedRouteId(routeId);
        setHarnessPhase('idle');
        setHarnessStep(0);
        setTriggerLog([]);

        const route = TEST_ROUTES.find(candidate => candidate.id === routeId);
        engineRef.current?.setStations(DENVER_STATIONS);
        const harness = getOrCreateHarness();
        harness.reset();
        harness.load(route);
        setHarnessTotal(harness.getStatus().totalSteps);
    }

    function handlePlay() {
        const route = TEST_ROUTES.find(candidate => candidate.id === selectedRouteId);
        const harness = getOrCreateHarness();

        if (harnessPhase === 'idle' || harnessPhase === 'complete') {
            engineRef.current?.setStations(DENVER_STATIONS);
            harness.load(route);
        }

        harness.play(speedMult);
        setHarnessPhase('playing');
    }

    function handlePause() {
        harnessRef.current?.pause();
        setHarnessPhase('paused');
    }

    function handleHarnessReset() {
        harnessRef.current?.reset();
        setHarnessPhase('idle');
        setHarnessStep(0);
        setStationScores([]);
        setTriggerLog([]);
    }

    function handleBatchRun() {
        setIsBatchRunning(true);
        setBatchResults(null);

        setTimeout(() => {
            const allRoutes = useExpandedRoutes ? [...TEST_ROUTES, ...EXPANDED_TEST_ROUTES] : TEST_ROUTES;
            const allStations = useExpandedRoutes ? EXPANDED_STATIONS : DENVER_STATIONS;
            const results = runBatchMetrics({
                routes: allRoutes,
                engineFactory: (overrides = {}) => createPredictiveFuelingEngine(overrides),
                stations: allStations,
            });

            setBatchResults(results);
            setIsBatchRunning(false);
        }, 50);
    }

    function handleTrainML() {
        setMlStatus('training');

        setTimeout(() => {
            const allRoutes = useExpandedRoutes ? [...TEST_ROUTES, ...EXPANDED_TEST_ROUTES] : TEST_ROUTES;
            const allStations = useExpandedRoutes ? EXPANDED_STATIONS : DENVER_STATIONS;
            const { routeToSamples } = require('../../src/lib/predictiveTestHarness.js');
            const trainingData = generateTrainingData(
                allRoutes,
                allStations,
                createPredictiveFuelingEngine,
                {},
                routeToSamples
            );
            const positives = trainingData.filter(sample => sample.label === 1);
            const negatives = trainingData.filter(sample => sample.label === 0);
            const balancedTrainingData = [
                ...negatives,
                ...positives,
                ...positives,
                ...positives,
                ...positives,
            ];

            if (!mlPredictorRef.current) {
                mlPredictorRef.current = createMLPredictor();
            }

            const trainResult = mlPredictorRef.current.train(balancedTrainingData, {
                epochs: 300,
                learningRate: 0.05,
            });
            const evaluationData = generateTrainingData(
                allRoutes,
                allStations,
                createPredictiveFuelingEngine,
                {},
                routeToSamples
            );
            const nextMlMetrics = mlPredictorRef.current.evaluate(evaluationData);
            const nextHeuristicBatch = runBatchMetrics({
                routes: allRoutes,
                engineFactory: (overrides = {}) => createPredictiveFuelingEngine(overrides),
                stations: allStations,
            });

            setMlMetrics({
                ...nextMlMetrics,
                trainingAccuracy: trainResult.trainingAccuracy,
                trainingLog: trainResult.trainingLog,
            });
            setHeuristicPRF1(computePRF1(nextHeuristicBatch));
            setMlStatus('trained');
        }, 80);
    }

    function handleGridSearch() {
        setIsGridSearching(true);
        setGridSearchResults(null);

        setTimeout(() => {
            const allRoutes = useExpandedRoutes ? [...TEST_ROUTES, ...EXPANDED_TEST_ROUTES] : TEST_ROUTES;
            const allStations = useExpandedRoutes ? EXPANDED_STATIONS : DENVER_STATIONS;
            const results = gridSearchParameters(allRoutes, allStations);
            setGridSearchResults(results);
            setIsGridSearching(false);
        }, 100);
    }

    function handleEstimateRange() {
        const history = SYNTHETIC_FILL_UP_HISTORIES[fillUpHistoryKey];
        const result = estimateRange(history, null);
        setRangeResult(result);
    }

    function handleStartFetchSim() {
        if (!fetchSimRef.current) {
            fetchSimRef.current = createBackgroundFetchSimulator({
                intervalKey: fetchIntervalKey,
                networkConditionKey: fetchNetworkCondition,
                onFetchAttempt: ({ success, cumulativeStats }) => {
                    setFetchStats({ ...cumulativeStats });
                    setFetchLog(prev => [
                        `${success ? '\u2713' : '\u2717'} ${new Date().toLocaleTimeString()}`,
                        ...prev,
                    ].slice(0, 10));
                },
                onStationUpdate: ({ stationId, change }) => {
                    setFetchLog(prev => [`\u26A1 ${stationId}: ${change}`, ...prev].slice(0, 10));
                },
            });
        }

        const allStations = useExpandedRoutes ? EXPANDED_STATIONS : DENVER_STATIONS;
        fetchSimRef.current.start(allStations);
        fetchSimRef.current.advanceTime(30 * 60 * 1000);
        setFetchStats(fetchSimRef.current.getStats());
    }

    function handleResetFetchSim() {
        if (fetchSimRef.current) {
            fetchSimRef.current.stop();
            fetchSimRef.current = null;
        }

        setFetchStats(null);
        setFetchLog([]);
    }

    const handleLocalPush = (delaySeconds) => {
        scheduleTestNotification(testTitle, testBody, delaySeconds);
        if (delaySeconds > 0) {
            Alert.alert('Scheduled', `Notification will appear in ${delaySeconds} seconds. Background the app now!`);
        }
    };

    const handleStartLiveActivity = () => {
        const instance = startLiveActivity('Wawa - Route 73', '$2.99');
        if (instance) {
            setLiveActivityInstance(instance);
            Alert.alert('Started', 'Live Activity started. Swipe home to inspect it.');
            return;
        }

        Alert.alert('Error', 'Could not start the activity. Make sure this is running in a supported iOS build.');
    };

    const handleUpdateLiveActivity = () => {
        if (!liveActivityInstance) {
            Alert.alert('Error', 'Start an activity first.');
            return;
        }

        updateLiveActivity(liveActivityInstance, '$2.85');
        Alert.alert('Updated', 'Price dropped to $2.85.');
    };

    const handleEndLiveActivity = () => {
        if (!liveActivityInstance) {
            Alert.alert('Error', 'Start an activity first.');
            return;
        }

        endLiveActivity(liveActivityInstance);
        setLiveActivityInstance(null);
        Alert.alert('Ended', 'Live Activity stopped.');
    };

    const stationNameMap = useMemo(() => {
        const allStations = [...DENVER_STATIONS, ...EXPANDED_STATIONS];
        return new Map(allStations.map(station => [station.stationId, station.stationName]));
    }, []);

    const stationNameForId = useCallback((stationId) => (
        stationNameMap.get(stationId) || stationId
    ), [stationNameMap]);

    const maintenance = {
        apiCounterRows: [
            {
                key: 'supabase',
                label: 'GasBuddy Cache',
                value: stats.supabase || 0,
            },
            {
                key: 'gasbuddy',
                label: 'GasBuddy Live',
                value: stats.gasbuddy || 0,
            },
            {
                key: 'google',
                label: 'Google Places',
                value: stats.google || 0,
            },
            {
                key: 'tomtom',
                label: 'TomTom',
                value: stats.tomtom || 0,
            },
            {
                key: 'barchart',
                label: 'Barchart',
                value: stats.barchart || 0,
            },
        ],
        isRefreshingFuel,
        onRunHourlyRefreshPath: handleRunHourlyRefreshPath,
        onResetCounters: handleReset,
        clusterDebugEnabled: debugEnabled,
        onSetClusterDebugEnabled: (isEnabled) => updatePreference('debugClusterAnimations', isEnabled),
    };

    const notifications = {
        testTitle,
        testBody,
        liveActivityActive: Boolean(liveActivityInstance),
        onChangeTitle: setTestTitle,
        onChangeBody: setTestBody,
        onSendNow: () => handleLocalPush(0),
        onSendDelayed: () => handleLocalPush(5),
        onStartLiveActivity: handleStartLiveActivity,
        onUpdateLiveActivity: handleUpdateLiveActivity,
        onEndLiveActivity: handleEndLiveActivity,
    };

    const predictive = {
        selectedRouteId,
        routeOptions: TEST_ROUTES.map(route => ({
            key: route.id,
            label: `${route.name} · ${route.scenario}`,
        })),
        speedMult,
        speedOptions: [
            { key: 1, label: '1x' },
            { key: 10, label: '10x' },
            { key: 100, label: '100x' },
        ],
        harnessPhase,
        harnessStep,
        harnessTotal,
        onSelectRoute: handleRouteSelect,
        onSelectSpeed: setSpeedMult,
        onPlay: handlePlay,
        onPause: handlePause,
        onReset: handleHarnessReset,
    };

    const allBatchRoutes = useMemo(() => (
        useExpandedRoutes ? [...TEST_ROUTES, ...EXPANDED_TEST_ROUTES] : TEST_ROUTES
    ), [useExpandedRoutes]);

    const analysis = {
        stationScores,
        triggerLog,
        stationNameForId,
        onRunBatch: handleBatchRun,
        isBatchRunning,
        batchResults,
        batchRouteCount: allBatchRoutes.length,
        predictionMode,
        predictionModeOptions: [
            { key: 'heuristic', label: 'Heuristic' },
            { key: 'ml', label: 'ML' },
        ],
        onSetPredictionMode: setPredictionMode,
        mlStatus,
        onTrainModel: handleTrainML,
        heuristicPRF1,
        mlMetrics,
        isGridSearching,
        onRunGridSearch: handleGridSearch,
        gridSearchResults,
    };

    const simulation = {
        selectedProfileId,
        profileOptions: Object.values(PROFILE_PRESETS).map(profile => ({
            key: profile.id,
            label: profile.name,
        })),
        selectedProfileDescription: PROFILE_PRESETS[selectedProfileId]?.description || '',
        onSelectProfile: setSelectedProfileId,
        useExpandedRoutes,
        onSetUseExpandedRoutes: setUseExpandedRoutes,
        fillUpHistoryKey,
        fillUpHistoryOptions: Object.keys(SYNTHETIC_FILL_UP_HISTORIES).map(key => ({
            key,
            label: key.replace(/_/g, ' '),
        })),
        onSelectFillUpHistory: setFillUpHistoryKey,
        onEstimateRange: handleEstimateRange,
        rangeResult,
        rangeSummary: rangeResult ? formatUrgencyMessage(rangeResult, 3) : '',
        fetchNetworkCondition,
        fetchNetworkOptions: Object.entries(NETWORK_CONDITIONS).map(([key, value]) => ({
            key,
            label: value.label,
        })),
        onSelectFetchNetwork: setFetchNetworkCondition,
        fetchIntervalKey,
        fetchIntervalOptions: [
            { key: 'aggressive', label: 'Aggressive (30s)' },
            { key: 'moderate', label: 'Moderate (60s)' },
            { key: 'conservative', label: 'Conservative (2m)' },
            { key: 'lazy', label: 'Lazy (5m)' },
        ],
        onSelectFetchInterval: setFetchIntervalKey,
        onRunFetchSimulation: handleStartFetchSim,
        onResetFetchSimulation: handleResetFetchSim,
        fetchStats,
        fetchLog,
    };

    return (
        <View style={styles.container}>
            <View style={[styles.baseBackground, { backgroundColor: themeColors.background }]} />
            <View style={styles.foregroundLayer}>
                <View
                    style={[
                        styles.formSlot,
                        {
                            paddingTop: topCanopyHeight,
                            paddingBottom: insets.bottom,
                        },
                    ]}
                >
                    <NativeDevForm
                        isDark={isDark}
                        maintenance={maintenance}
                        notifications={notifications}
                        predictive={predictive}
                        analysis={analysis}
                        simulation={simulation}
                    />
                </View>

                <TopCanopy
                    edgeColor={canopyEdgeLine}
                    height={topCanopyHeight}
                    isDark={isDark}
                    topInset={insets.top}
                />
                <View style={[styles.header, { paddingTop: insets.top }]}>
                    <FuelUpHeaderLogo isDark={isDark} />
                </View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        position: 'relative',
    },
    baseBackground: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 0,
    },
    foregroundLayer: {
        flex: 1,
        zIndex: 1,
    },
    formSlot: {
        flex: 1,
    },
    header: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        alignItems: 'center',
        paddingTop: 16,
        paddingBottom: 10,
        zIndex: 10,
    },
});
