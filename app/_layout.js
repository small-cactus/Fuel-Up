import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { AppStateProvider, useAppState } from '../src/AppStateContext';
import { ThemeProvider, useTheme } from '../src/ThemeContext';
import { PreferencesProvider, usePreferences } from '../src/PreferencesContext';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Linking from 'expo-linking';
import * as FileSystem from 'expo-file-system/legacy';
import OnboardingScreen from '../src/screens/OnboardingScreen';
import ProgressiveBlurReveal from '../src/components/ProgressiveBlurReveal';
import '../src/lib/predictiveLocation';
import { runPredictiveSystemProbeAsync } from '../src/lib/predictiveSystemProbe';
import { runPredictiveDebugQueryAsync } from '../src/lib/predictiveDebugQuery';
import {
    disablePredictiveFuelingInfrastructureAsync,
} from '../src/lib/predictiveFuelingBackend';
import { createPredictiveFuelingDriveGate } from '../src/lib/predictiveFuelingDriveGate';
import {
    enablePredictiveTrackingAsync,
    getPredictiveTrackingPermissionStateAsync,
} from '../src/lib/predictiveTrackingAccess';
import {
    resetLocationProbeLaunchOverrides,
    setLocationProbeLaunchOverrides,
} from '../src/lib/locationProbeOverrides';

const CLUSTER_DEBUG_PROBE_REQUEST_FILE_NAME = 'cluster-debug-probe-request.json';
const CLUSTER_DEBUG_PROBE_REPORT_FILE_NAME = 'cluster-debug-probe.json';
const PREDICTIVE_DEBUG_QUERY_REQUEST_FILE_NAME = 'predictive-debug-query-request.json';

function getFirstRouteParamValue(value) {
    if (Array.isArray(value)) {
        return value[0] || '';
    }

    if (value == null) {
        return '';
    }

    return String(value);
}

function isTruthyRouteParam(value) {
    if (Array.isArray(value)) {
        return value.some(isTruthyRouteParam);
    }

    if (typeof value === 'string') {
        const normalizedValue = value.trim().toLowerCase();

        return normalizedValue === '1' || normalizedValue === 'true' || normalizedValue === 'yes' || normalizedValue === 'on';
    }

    return value === true || value === 1;
}

function applyLocationProbeOverridesFromQueryParams(queryParams = {}) {
    resetLocationProbeLaunchOverrides();

    if (!__DEV__) {
        return;
    }

    setLocationProbeLaunchOverrides({
        forceNullLastKnownPosition: isTruthyRouteParam(
            queryParams.locationProbeForceNullLastKnown ||
            queryParams.forceNullLastKnownPosition
        ),
    });
}

async function writeClusterProbeQueueMarker(payload) {
    if (!FileSystem.documentDirectory) {
        return;
    }

    try {
        await FileSystem.writeAsStringAsync(
            `${FileSystem.documentDirectory}${CLUSTER_DEBUG_PROBE_REPORT_FILE_NAME}`,
            JSON.stringify({
                ...payload,
                persistedAt: new Date().toISOString(),
            }, null, 2)
        );
    } catch (error) {
        // Ignore queue marker failures; the probe itself still attempts to run.
    }
}

function AppGate() {
    const { preferences, isLoading } = usePreferences();
    const {
        clusterProbeRequest,
        isClusterProbeSessionActive,
        requestClusterProbe,
        rootRevealPhase,
        rootRevealVersion,
        hideRootReveal,
    } = useAppState();
    const { isDark, themeColors } = useTheme();
    const predictiveDriveGateRef = useRef(null);
    const predictivePermissionRecoveryRef = useRef({
        attempted: false,
        signature: null,
    });
    const lastClusterProbeUrlRef = useRef('');
    const lastPredictiveSystemProbeUrlRef = useRef('');
    const [hasPendingClusterProbeRequest, setHasPendingClusterProbeRequest] = useState(false);
    const [hasPendingLocationProbeOverride, setHasPendingLocationProbeOverride] = useState(false);
    const [hasPendingPredictiveSystemProbe, setHasPendingPredictiveSystemProbe] = useState(false);
    const [hasLatchedClusterProbeBypass, setHasLatchedClusterProbeBypass] = useState(false);
    const shouldBypassOnboardingForClusterProbe = __DEV__ && (
        hasPendingClusterProbeRequest ||
        hasPendingLocationProbeOverride ||
        hasPendingPredictiveSystemProbe ||
        Boolean(clusterProbeRequest) ||
        isClusterProbeSessionActive ||
        hasLatchedClusterProbeBypass
    );

    useEffect(() => {
        if (
            __DEV__ &&
            (
                hasPendingClusterProbeRequest ||
                hasPendingLocationProbeOverride ||
                hasPendingPredictiveSystemProbe ||
                Boolean(clusterProbeRequest) ||
                isClusterProbeSessionActive
            ) &&
            !hasLatchedClusterProbeBypass
        ) {
            setHasLatchedClusterProbeBypass(true);
        }
    }, [
        hasPendingClusterProbeRequest,
        hasPendingLocationProbeOverride,
        hasPendingPredictiveSystemProbe,
        clusterProbeRequest,
        isClusterProbeSessionActive,
        hasLatchedClusterProbeBypass,
    ]);

    useEffect(() => {
        if (!__DEV__) {
            return undefined;
        }

        let isCancelled = false;
        let isPredictiveDebugRequestInFlight = false;

        const queueProbeFromUrl = (url) => {
            if (!url) {
                return;
            }

            const parsedUrl = Linking.parse(url);
            const queryParams = parsedUrl?.queryParams || {};
            applyLocationProbeOverridesFromQueryParams(queryParams);
            if (
                isTruthyRouteParam(queryParams.locationProbeForceNullLastKnown) ||
                isTruthyRouteParam(queryParams.forceNullLastKnownPosition)
            ) {
                setHasPendingLocationProbeOverride(true);
            }
            if (
                isTruthyRouteParam(queryParams.predictiveSystemProbe) &&
                lastPredictiveSystemProbeUrlRef.current !== url
            ) {
                lastPredictiveSystemProbeUrlRef.current = url;
                setHasPendingPredictiveSystemProbe(true);
                void runPredictiveSystemProbeAsync({
                    token: getFirstRouteParamValue(queryParams.predictiveSystemProbeToken) || 'default',
                }).finally(() => {
                    if (!isCancelled) {
                        setHasPendingPredictiveSystemProbe(false);
                    }
                });
            }

            if (isTruthyRouteParam(queryParams.predictiveDebugQuery)) {
                void runPredictiveDebugQueryAsync({
                    token: getFirstRouteParamValue(queryParams.predictiveDebugToken) || 'default',
                    query: getFirstRouteParamValue(queryParams.predictiveDebugKind) || 'all',
                }).catch(error => {
                    console.warn('Predictive debug query failed:', error?.message || error);
                });
            }

            if (lastClusterProbeUrlRef.current === url) {
                return;
            }

            const isProbeUrl = (
                isTruthyRouteParam(queryParams.clusterProbe) ||
                isTruthyRouteParam(queryParams.runClusterProbe)
            );

            if (!isProbeUrl) {
                return;
            }

            lastClusterProbeUrlRef.current = url;
            requestClusterProbe({
                token: (
                    getFirstRouteParamValue(queryParams.clusterProbeToken) ||
                    getFirstRouteParamValue(queryParams.probeToken) ||
                    'default'
                ),
                source: 'deeplink',
                url,
            });
            void writeClusterProbeQueueMarker({
                status: 'queued',
                trigger: 'deeplink',
                token: (
                    getFirstRouteParamValue(queryParams.clusterProbeToken) ||
                    getFirstRouteParamValue(queryParams.probeToken) ||
                    'default'
                ),
                message: 'Cluster probe deep link accepted by the root layout.',
            });
            console.log(`[ClusterDebug Probe Automation] queued deeplink ${url}`);
        };

        const pollPendingProbeRequest = async () => {
            if (!FileSystem.documentDirectory) {
                if (!isCancelled) {
                    setHasPendingClusterProbeRequest(false);
                }
                return;
            }

            try {
                const requestFileUri = `${FileSystem.documentDirectory}${CLUSTER_DEBUG_PROBE_REQUEST_FILE_NAME}`;
                const requestFileInfo = await FileSystem.getInfoAsync(requestFileUri);

                if (!requestFileInfo.exists) {
                    if (!isCancelled) {
                        setHasPendingClusterProbeRequest(false);
                    }
                    return;
                }

                if (!isCancelled) {
                    setHasPendingClusterProbeRequest(true);
                }

                const rawRequest = await FileSystem.readAsStringAsync(requestFileUri);
                const parsedRequest = rawRequest ? JSON.parse(rawRequest) : {};
                const requestToken = (
                    getFirstRouteParamValue(parsedRequest?.token) ||
                    getFirstRouteParamValue(parsedRequest?.clusterProbeToken) ||
                    'file-request'
                );

                requestClusterProbe({
                    ...parsedRequest,
                    token: requestToken,
                    source: 'file',
                });
                void writeClusterProbeQueueMarker({
                    status: 'queued',
                    trigger: 'file',
                    token: requestToken,
                    message: 'Cluster probe request file accepted by the root layout.',
                });
                await FileSystem.deleteAsync(requestFileUri, { idempotent: true });
                if (!isCancelled) {
                    setHasPendingClusterProbeRequest(false);
                }
                console.log(`[ClusterDebug Probe Automation] queued request file ${requestToken}`);
            } catch (error) {
                if (!isCancelled) {
                    setHasPendingClusterProbeRequest(false);
                }
            }
        };

        const pollPendingPredictiveDebugRequest = async () => {
            if (!FileSystem.documentDirectory) {
                return;
            }

            if (isPredictiveDebugRequestInFlight) {
                return;
            }

            try {
                const requestFileUri = `${FileSystem.documentDirectory}${PREDICTIVE_DEBUG_QUERY_REQUEST_FILE_NAME}`;
                const requestFileInfo = await FileSystem.getInfoAsync(requestFileUri);

                if (!requestFileInfo.exists) {
                    return;
                }

                isPredictiveDebugRequestInFlight = true;
                const rawRequest = await FileSystem.readAsStringAsync(requestFileUri);
                const parsedRequest = rawRequest ? JSON.parse(rawRequest) : {};
                await FileSystem.deleteAsync(requestFileUri, { idempotent: true });
                await runPredictiveDebugQueryAsync({
                    token: (
                        getFirstRouteParamValue(parsedRequest?.token) ||
                        getFirstRouteParamValue(parsedRequest?.predictiveDebugToken) ||
                        'file-request'
                    ),
                    query: (
                        getFirstRouteParamValue(parsedRequest?.query) ||
                        getFirstRouteParamValue(parsedRequest?.predictiveDebugKind) ||
                        'all'
                    ),
                });
            } catch (error) {
                console.warn('Predictive debug request file failed:', error?.message || error);
            } finally {
                isPredictiveDebugRequestInFlight = false;
            }
        };

        void Linking.getInitialURL().then(queueProbeFromUrl);
        void pollPendingProbeRequest();
        void pollPendingPredictiveDebugRequest();

        const urlSubscription = Linking.addEventListener('url', event => {
            queueProbeFromUrl(event?.url || '');
        });
        const intervalId = setInterval(() => {
            void pollPendingProbeRequest();
            void pollPendingPredictiveDebugRequest();
        }, 750);

        return () => {
            isCancelled = true;
            urlSubscription.remove();
            clearInterval(intervalId);
        };
    }, [requestClusterProbe]);

    const predictiveBackendPreferences = useMemo(() => ({
        searchRadiusMiles: preferences.searchRadiusMiles,
        preferredOctane: preferences.preferredOctane,
        preferredProvider: preferences.preferredProvider,
        navigationApp: preferences.navigationApp,
    }), [
        preferences.navigationApp,
        preferences.preferredOctane,
        preferences.preferredProvider,
        preferences.searchRadiusMiles,
    ]);

    useEffect(() => {
        if (!preferences.hasCompletedOnboarding) {
            if (predictiveDriveGateRef.current) {
                void predictiveDriveGateRef.current.stop();
                predictiveDriveGateRef.current = null;
            }
            predictivePermissionRecoveryRef.current = {
                attempted: false,
                signature: null,
            };
            void disablePredictiveFuelingInfrastructureAsync();
            return undefined;
        }

        if (!predictiveDriveGateRef.current) {
            predictiveDriveGateRef.current = createPredictiveFuelingDriveGate();
        }

        void (async () => {
            try {
                const permissionState = await getPredictiveTrackingPermissionStateAsync();
                const permissionSignature = JSON.stringify({
                    foregroundGranted: Boolean(permissionState?.foregroundGranted),
                    backgroundGranted: Boolean(permissionState?.backgroundGranted),
                    preciseLocationGranted: Boolean(permissionState?.preciseLocationGranted),
                    motionActivityAvailable: Boolean(permissionState?.motionActivityAvailable),
                    motionAuthorizationStatus: permissionState?.motionAuthorizationStatus || 'unknown',
                    isReady: Boolean(permissionState?.isReady),
                });

                if (permissionState?.isReady) {
                    predictivePermissionRecoveryRef.current = {
                        attempted: true,
                        signature: permissionSignature,
                    };
                    return;
                }

                if (
                    predictivePermissionRecoveryRef.current.attempted &&
                    predictivePermissionRecoveryRef.current.signature === permissionSignature
                ) {
                    return;
                }

                predictivePermissionRecoveryRef.current = {
                    attempted: true,
                    signature: permissionSignature,
                };

                await enablePredictiveTrackingAsync();
            } catch (error) {
                console.warn('Predictive tracking permission recovery failed:', error?.message || error);
            }
        })();

        predictiveDriveGateRef.current.updatePreferences(predictiveBackendPreferences);
        void predictiveDriveGateRef.current.start().catch(error => {
            console.warn('Predictive fueling drive gate failed to start:', error?.message || error);
        });

        return undefined;
    }, [preferences.hasCompletedOnboarding, predictiveBackendPreferences]);

    useEffect(() => {
        return () => {
            if (predictiveDriveGateRef.current) {
                void predictiveDriveGateRef.current.stop();
                predictiveDriveGateRef.current = null;
            }
        };
    }, []);

    if (isLoading) {
        return <View style={{ flex: 1, backgroundColor: themeColors.background }} />;
    }

    if (!preferences.hasCompletedOnboarding && !shouldBypassOnboardingForClusterProbe) {
        return <OnboardingScreen />;
    }

    return (
        <>
            <StatusBar style={isDark ? 'light' : 'dark'} />
            <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="(tabs)" />
                <Stack.Screen
                    name="prices-sheet"
                    options={{
                        presentation: 'formSheet',
                        sheetAllowedDetents: [0.45, 1],
                        sheetGrabberVisible: true,
                    }}
                />
                <Stack.Screen
                    name="live-activity-designer"
                    options={{
                        headerShown: true,
                        title: 'Live Activity Designer',
                        presentation: 'card',
                    }}
                />
            </Stack>
            <ProgressiveBlurReveal
                key={`root-reveal-${rootRevealVersion}`}
                isBlurred={rootRevealPhase === 'blurred'}
                shouldReveal={rootRevealPhase === 'revealing'}
                excludeTabs={false}
                onRevealComplete={hideRootReveal}
            />
        </>
    );
}

export default function RootLayout() {
    return (
        <AppStateProvider>
            <ThemeProvider>
                <PreferencesProvider>
                    <AppGate />
                </PreferencesProvider>
            </ThemeProvider>
        </AppStateProvider>
    );
}
