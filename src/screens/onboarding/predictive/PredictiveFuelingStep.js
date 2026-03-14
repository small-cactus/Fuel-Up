import React, { useEffect, useMemo, useState } from 'react';
import { Dimensions, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import TopCanopy from '../../../components/TopCanopy';
import BottomCanopy from '../../../components/BottomCanopy';
import FuelUpHeaderLogo from '../../../components/FuelUpHeaderLogo';
import { getDrivingRouteAsync } from '../../../lib/FuelUpMapKitRouting';
import PredictiveMapScene from './PredictiveMapScene';
import {
    getPredictiveFuelingFallbackRoutes,
    PREDICTIVE_FUELING_SCENE,
} from './constants';

const {
    buildPredictiveRouteMetrics,
    buildRouteMetrics,
} = require('./simulationMath.cjs');
const { getPredictiveRouteDiagnostics } = require('./routeDiagnostics.cjs');

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const LIGHT_SCREEN_BACKGROUND = '#f2f1f6';
const LIGHT_SCREEN_BACKGROUND_85 = 'rgba(242,241,246,0.85)';
const LIGHT_SCREEN_BACKGROUND_0 = 'rgba(242,241,246,0)';

export default function PredictiveFuelingStep({ insets, isActive, isDark }) {
    const [route, setRoute] = useState(() => getPredictiveFuelingFallbackRoutes());

    useEffect(() => {
        let isCancelled = false;

        void (async () => {
            try {
                const [initialRoute, rerouteRoute] = await Promise.all([
                    getDrivingRouteAsync({
                        origin: PREDICTIVE_FUELING_SCENE.origin,
                        destination: PREDICTIVE_FUELING_SCENE.expensiveStation.coordinate,
                    }),
                    getDrivingRouteAsync({
                        origin: PREDICTIVE_FUELING_SCENE.rerouteOrigin,
                        destination: PREDICTIVE_FUELING_SCENE.destinationStation.coordinate,
                    }),
                ]);

                if (
                    !isCancelled &&
                    initialRoute?.coordinates?.length &&
                    rerouteRoute?.coordinates?.length
                ) {
                    const nextRouteSet = {
                        initialRoute,
                        rerouteRoute,
                        isFallback: false,
                    };

                    if (__DEV__) {
                        console.info(
                            'Predictive fueling route diagnostics:',
                            getPredictiveRouteDiagnostics(
                                nextRouteSet,
                                PREDICTIVE_FUELING_SCENE
                            )
                        );
                    }

                    setRoute(nextRouteSet);
                }
            } catch (error) {
                const fallbackRouteSet = getPredictiveFuelingFallbackRoutes();

                if (__DEV__) {
                    console.warn(
                        'Predictive fueling route fallback in use:',
                        error?.code || error?.message || error,
                        getPredictiveRouteDiagnostics(fallbackRouteSet, PREDICTIVE_FUELING_SCENE)
                    );
                }

                if (!isCancelled) {
                    setRoute(fallbackRouteSet);
                }
            }
        })();

        return () => {
            isCancelled = true;
        };
    }, []);

    const routeMetrics = useMemo(() => {
        if (route?.initialRoute?.coordinates?.length && route?.rerouteRoute?.coordinates?.length) {
            return buildPredictiveRouteMetrics(route, PREDICTIVE_FUELING_SCENE);
        }

        if (!route?.coordinates?.length) {
            return null;
        }

        return buildRouteMetrics(route, PREDICTIVE_FUELING_SCENE);
    }, [route]);

    return (
        <View style={styles.stepContainer}>
            <PredictiveMapScene
                insets={insets}
                isActive={isActive}
                isDark={isDark}
                routeMetrics={routeMetrics}
                sceneConfig={PREDICTIVE_FUELING_SCENE}
            />

            <TopCanopy
                edgeColor={isDark ? 'rgba(255,255,255,0.08)' : 'rgba(242,241,246,0.42)'}
                height={insets.top + 300}
                isDark={isDark}
                topInset={insets.top}
            />
            <BottomCanopy height={270} isDark={isDark} />

            <LinearGradient
                colors={[
                    isDark ? '#000000' : LIGHT_SCREEN_BACKGROUND,
                    isDark ? 'rgba(0,0,0,0.85)' : LIGHT_SCREEN_BACKGROUND_85,
                    isDark ? 'rgba(0,0,0,0)' : LIGHT_SCREEN_BACKGROUND_0,
                ]}
                locations={[0, 0.5, 1]}
                style={[styles.topGradient, { height: insets.top + 220 }]}
                pointerEvents="none"
            />

            <LinearGradient
                colors={[
                    isDark ? 'rgba(0,0,0,0)' : LIGHT_SCREEN_BACKGROUND_0,
                    isDark ? 'rgba(0,0,0,0.85)' : LIGHT_SCREEN_BACKGROUND_85,
                    isDark ? '#000000' : LIGHT_SCREEN_BACKGROUND,
                ]}
                locations={[0, 0.8, 1.2]}
                style={[styles.footerGradient, { height: 280 }]}
                pointerEvents="none"
            />

            <View
                pointerEvents="none"
                style={[styles.headerOverlay, { paddingTop: insets.top + 20 }]}
            >
                <FuelUpHeaderLogo isDark={isDark} />
                <Text style={[styles.headerTitle, { color: isDark ? '#FFFFFF' : '#111111' }]}>
                    Predictive Fueling
                </Text>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    stepContainer: {
        width: SCREEN_WIDTH,
        height: SCREEN_HEIGHT,
        backgroundColor: 'transparent',
    },
    topGradient: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
    },
    footerGradient: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
    },
    headerOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 24,
    },
    headerTitle: {
        fontSize: 28,
        fontWeight: '800',
        textAlign: 'center',
        letterSpacing: -0.3,
        fontFamily: 'ui-rounded',
    },
});
