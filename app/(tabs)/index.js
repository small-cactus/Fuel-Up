import React, { useEffect } from 'react';
import { Platform } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useAppState } from '../../src/AppStateContext';
import HomeScreen from '../../src/screens/cluster-lab/ClusterLabScreen';

export default function HomeRoute() {
    const { isClusterProbeSessionActive, hideRootReveal } = useAppState();
    // Retain the original live probe and non-iOS fallback. Normal iOS launches
    // use the native glass map without mounting the previous map or its fetches.
    const { clusterLabProbe } = useLocalSearchParams();
    const useLegacyMap = Platform.OS !== 'ios' || (__DEV__ && isClusterProbeSessionActive && !clusterLabProbe);
    useEffect(() => {
        if (!useLegacyMap) hideRootReveal();
    }, [useLegacyMap, hideRootReveal]);
    // Keep the literal guard around require so Metro excludes this screen from
    // iOS Release, while development can still load the real probe on demand.
    if (Platform.OS !== 'ios' || __DEV__) {
        if (useLegacyMap) {
            const LegacyHomeScreen = require('../../src/screens/LegacyHomeScreen').default;
            return <LegacyHomeScreen />;
        }
    }
    return <HomeScreen />;
}
