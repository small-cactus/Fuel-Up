import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { requireNativeViewManager } from 'expo-modules-core';

const NativeReveal = Platform.OS === 'ios'
    ? requireNativeViewManager('FuelUpMapKitRouting', 'NativeSkeletonRevealView') : null;

// Both slots stay mounted through the handoff so native code can capture the
// outgoing skeleton and the already-laid-out result in the same transaction.
export default function SkeletonReveal({ loading, placeholder, children, style }) {
    if (!NativeReveal) return <View style={style}>{loading ? placeholder : children}</View>;
    return <NativeReveal loading={loading} style={style}>
        <View collapsable={false} pointerEvents="none" accessibilityElementsHidden={!loading}
            importantForAccessibility={loading ? 'auto' : 'no-hide-descendants'}
            style={loading ? undefined : styles.inactive}>{placeholder}</View>
        <View collapsable={false} pointerEvents={loading ? 'none' : 'auto'} accessibilityElementsHidden={loading}
            importantForAccessibility={loading ? 'no-hide-descendants' : 'auto'}
            style={loading ? styles.inactive : undefined}>{children}</View>
    </NativeReveal>;
}

const styles = StyleSheet.create({ inactive: { position: 'absolute', top: 0, left: 0, right: 0 } });
