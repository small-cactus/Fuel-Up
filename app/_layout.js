import { migrateToNativeResearchAsync } from '../src/lib/drivingResearch';
import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Platform, View } from 'react-native';
import { AppStateProvider, useAppState } from '../src/AppStateContext';
import { ThemeProvider, useTheme } from '../src/ThemeContext';
import { PreferencesProvider, usePreferences } from '../src/PreferencesContext';
import { Stack, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Linking from 'expo-linking';
import * as FileSystem from 'expo-file-system/legacy';
import OnboardingScreen from '../src/screens/OnboardingScreen';
import TrendsBackgroundRefresh from '../src/components/TrendsBackgroundRefresh';
import { onboardingHandoff } from '../src/lib/onboardingHandoff';
import ProgressiveBlurReveal from '../src/components/ProgressiveBlurReveal';
import '../src/lib/predictiveLocation';
import LaunchSplash, { useLaunchReady } from '../src/components/LaunchSplash';
import { finishLaunch } from '../src/lib/launchReadiness';
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
    const pathname = usePathname();
    const onboardingPhase = useSyncExternalStore(onboardingHandoff.subscribe, onboardingHandoff.getSnapshot, onboardingHandoff.getSnapshot);
    const launchReady = useLaunchReady();
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

    // The launch reveal belongs to Home's map. A direct link to another screen
    // may never mount Home, so it must not wait for Home's map-ready callback.
    useEffect(() => {
        if (pathname && pathname !== '/' && preferences.hasCompletedOnboarding) {
            hideRootReveal();
            finishLaunch();
        }
    }, [pathname, preferences.hasCompletedOnboarding, hideRootReveal]);

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
                void require('../src/lib/predictiveSystemProbe').runPredictiveSystemProbeAsync({
                    token: getFirstRouteParamValue(queryParams.predictiveSystemProbeToken) || 'default',
                }).finally(() => {
                    if (!isCancelled) {
                        setHasPendingPredictiveSystemProbe(false);
                    }
                });
            }

            if (isTruthyRouteParam(queryParams.predictiveDebugQuery)) {
                void require('../src/lib/predictiveDebugQuery').runPredictiveDebugQueryAsync({
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
                await require('../src/lib/predictiveDebugQuery').runPredictiveDebugQueryAsync({
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
        if (isLoading || !launchReady) return undefined;
        if (!preferences.hasCompletedOnboarding) {
            if (predictiveDriveGateRef.current) {
                void predictiveDriveGateRef.current.stop();
                predictiveDriveGateRef.current = null;
            }
            void require('../src/lib/predictiveFuelingBackend').disablePredictiveFuelingInfrastructureAsync();
            return undefined;
        }

        if (!predictiveDriveGateRef.current) {
            predictiveDriveGateRef.current = require('../src/lib/predictiveFuelingDriveGate').createPredictiveFuelingDriveGate();
        }

        // Permission prompts are initiated by the onboarding/settings buttons.
        // The drive gate checks existing grants and resumes when the app returns
        // from Settings; launching the app must respect a declined permission.
        predictiveDriveGateRef.current.updatePreferences(predictiveBackendPreferences);
        void predictiveDriveGateRef.current.start().catch(error => {
            console.warn('Predictive fueling drive gate failed to start:', error?.message || error);
        });

        return undefined;
    }, [isLoading, launchReady, preferences.hasCompletedOnboarding, predictiveBackendPreferences]);

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

    const showOnboarding = (!preferences.hasCompletedOnboarding && !shouldBypassOnboardingForClusterProbe) || onboardingPhase !== 'idle';
    const mountHome = !showOnboarding || onboardingPhase !== 'idle';

    return (
        <>
            <StatusBar style={isDark ? 'light' : 'dark'} />
            {mountHome && <Stack screenOptions={{
                headerShown: false,
                headerStyle: { backgroundColor: themeColors.background },
                headerTintColor: themeColors.text,
                headerBackButtonDisplayMode: 'minimal',
            }}>
                <Stack.Screen name="(tabs)" />
                <Stack.Screen
                    name="prices-sheet"
                    options={{
                        presentation: 'formSheet',
                        sheetAllowedDetents: 'fitToContents',
                        sheetGrabberVisible: true,
                    }}
                />
            </Stack>}
            {showOnboarding && <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000 }} accessibilityViewIsModal>
                <OnboardingScreen />
            </View>}
            {pathname === '/' && !showOnboarding && (Platform.OS !== 'ios' || (__DEV__ && isClusterProbeSessionActive)) && <ProgressiveBlurReveal
                key={`root-reveal-${rootRevealVersion}`}
                isBlurred={rootRevealPhase === 'blurred'}
                shouldReveal={rootRevealPhase === 'revealing'}
                excludeTabs={false}
                onRevealComplete={hideRootReveal}
            />}
        </>
    );
}

export default function RootLayout() {
    useEffect(() => {
        void migrateToNativeResearchAsync().catch(error => console.warn('Native research migration pending:', error.message));
    }, []);
    return (
        <AppStateProvider>
            <ThemeProvider>
                <PreferencesProvider>
                    <View style={{ flex: 1 }}>
                        <TrendsBackgroundRefresh />
                        <AppGate />
                        <LaunchSplash />
                    </View>
                </PreferencesProvider>
            </ThemeProvider>
        </AppStateProvider>
    );
}
