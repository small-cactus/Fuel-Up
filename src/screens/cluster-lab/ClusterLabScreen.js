import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { requireNativeViewManager } from 'expo-modules-core';
import { useLocalSearchParams } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { useTheme } from '../../ThemeContext';
import useClusterLabStations from './useClusterLabStations';

const NativeMap = Platform.OS === 'ios' ? requireNativeViewManager('FuelUpMapKitRouting') : null;
const EMPTY_ORIGIN = {};

export default function ClusterLabScreen() {
    const active = useIsFocused();
    const { isDark } = useTheme();
    const { origin, stations } = useClusterLabStations(active);
    const { clusterLabProbe } = useLocalSearchParams();
    if (!NativeMap) return <View style={styles.map} />;
    return (
        <NativeMap
            style={styles.map}
            origin={origin || EMPTY_ORIGIN}
            stations={stations}
            isDark={isDark}
            active={active}
            probeToken={__DEV__ && typeof clusterLabProbe === 'string' ? clusterLabProbe : null}
        />
    );
}

const styles = StyleSheet.create({ map: { flex: 1 } });
