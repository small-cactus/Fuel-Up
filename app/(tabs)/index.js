import React, { useEffect } from 'react';
import { Platform } from 'react-native';
import { useAppState } from '../../src/AppStateContext';
import HomeScreen from '../../src/screens/cluster-lab/ClusterLabScreen';

export default function HomeRoute() {
    const { isClusterProbeSessionActive, hideRootReveal } = useAppState();
    // Retain the original live probe and non-iOS fallback. Normal iOS launches
    // use the native glass map without mounting the previous map or its fetches.
    const useLegacyMap = Platform.OS !== 'ios' || (__DEV__ && isClusterProbeSessionActive);
    useEffect(() => {
        if (!useLegacyMap) hideRootReveal();
    }, [useLegacyMap, hideRootReveal]);
    if (useLegacyMap) {
        const LegacyHomeScreen = require('../../src/screens/LegacyHomeScreen').default;
        return <LegacyHomeScreen />;
    }
    return <HomeScreen />;
}
