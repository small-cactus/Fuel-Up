import React, { useEffect, useState } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import TopCanopy from '../../../components/TopCanopy';
import BottomCanopy from '../../../components/BottomCanopy';
import FuelUpHeaderLogo from '../../../components/FuelUpHeaderLogo';
import { getDrivingRouteAsync } from '../../../lib/FuelUpMapKitRouting';
import PredictiveMapScene from './PredictiveMapScene';
import PredictiveNarrativeCard from './PredictiveNarrativeCard';
import {
    getPredictiveFuelingFallbackRoute,
    PREDICTIVE_FUELING_SCENE,
} from './constants';
import usePredictiveFuelingDemo from './usePredictiveFuelingDemo';

const { getPredictiveRouteDiagnostics } = require('./routeDiagnostics.cjs');

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const LIGHT_SCREEN_BACKGROUND = '#f2f1f6';
const LIGHT_SCREEN_BACKGROUND_85 = 'rgba(242,241,246,0.85)';
const LIGHT_SCREEN_BACKGROUND_0 = 'rgba(242,241,246,0)';

export default function PredictiveFuelingStep({ insets, isActive, isDark }) {
    const [route, setRoute] = useState(() => getPredictiveFuelingFallbackRoute());

    useEffect(() => {
        let isCancelled = false;

        void (async () => {
            try {
                const nextRoute = await getDrivingRouteAsync({
                    origin: PREDICTIVE_FUELING_SCENE.origin,
                    destination: PREDICTIVE_FUELING_SCENE.destinationStation.coordinate,
                });

                if (!isCancelled && nextRoute?.coordinates?.length) {
                    if (__DEV__) {
                        console.info(
                            'Predictive fueling route diagnostics:',
                            getPredictiveRouteDiagnostics(
                                {
                                    ...nextRoute,
                                    isFallback: false,
                                },
                                PREDICTIVE_FUELING_SCENE
                            )
                        );
                    }

                    setRoute({
                        ...nextRoute,
                        isFallback: false,
                    });
                }
            } catch (error) {
                const fallbackRoute = getPredictiveFuelingFallbackRoute();

                if (__DEV__) {
                    console.warn(
                        'Predictive fueling route fallback in use:',
                        error?.code || error?.message || error,
                        getPredictiveRouteDiagnostics(fallbackRoute, PREDICTIVE_FUELING_SCENE)
                    );
                }

                if (!isCancelled) {
                    setRoute(fallbackRoute);
                }
            }
        })();

        return () => {
            isCancelled = true;
        };
    }, []);

    const demoState = usePredictiveFuelingDemo({
        isActive,
        route,
        sceneConfig: PREDICTIVE_FUELING_SCENE,
    });

    return (
        <View style={styles.stepContainer}>
            <PredictiveMapScene
                demoState={demoState}
                insets={insets}
                isActive={isActive}
                isDark={isDark}
                routeMetrics={demoState.routeMetrics}
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
            </View>

            <PredictiveNarrativeCard
                insets={insets}
                isDark={isDark}
                narrative={demoState.narrative}
                sceneConfig={PREDICTIVE_FUELING_SCENE}
            />
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
    },
});
