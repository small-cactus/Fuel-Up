import React, { useEffect, useRef, useState } from 'react';
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

const CLUSTER_DEBUG_PROBE_REQUEST_FILE_NAME = 'cluster-debug-probe-request.json';
const CLUSTER_DEBUG_PROBE_REPORT_FILE_NAME = 'cluster-debug-probe.json';

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
    const lastClusterProbeUrlRef = useRef('');
    const [hasPendingClusterProbeRequest, setHasPendingClusterProbeRequest] = useState(false);
    const [hasLatchedClusterProbeBypass, setHasLatchedClusterProbeBypass] = useState(false);
    const shouldBypassOnboardingForClusterProbe = __DEV__ && (
        hasPendingClusterProbeRequest ||
        Boolean(clusterProbeRequest) ||
        isClusterProbeSessionActive ||
        hasLatchedClusterProbeBypass
    );

    useEffect(() => {
        if (
            __DEV__ &&
            (hasPendingClusterProbeRequest || Boolean(clusterProbeRequest) || isClusterProbeSessionActive) &&
            !hasLatchedClusterProbeBypass
        ) {
            setHasLatchedClusterProbeBypass(true);
        }
    }, [
        hasPendingClusterProbeRequest,
        clusterProbeRequest,
        isClusterProbeSessionActive,
        hasLatchedClusterProbeBypass,
    ]);

    useEffect(() => {
        if (!__DEV__) {
            return undefined;
        }

        let isCancelled = false;

        const queueProbeFromUrl = (url) => {
            if (!url || lastClusterProbeUrlRef.current === url) {
                return;
            }

            const parsedUrl = Linking.parse(url);
            const queryParams = parsedUrl?.queryParams || {};
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

        void Linking.getInitialURL().then(queueProbeFromUrl);
        void pollPendingProbeRequest();

        const urlSubscription = Linking.addEventListener('url', event => {
            queueProbeFromUrl(event?.url || '');
        });
        const intervalId = setInterval(() => {
            void pollPendingProbeRequest();
        }, 750);

        return () => {
            isCancelled = true;
            urlSubscription.remove();
            clearInterval(intervalId);
        };
    }, [requestClusterProbe]);

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
