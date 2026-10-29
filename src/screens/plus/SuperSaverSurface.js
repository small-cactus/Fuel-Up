import React from 'react';
import { Image, Platform, StyleSheet, View } from 'react-native';
import { requireNativeViewManager } from 'expo-modules-core';
import MaskedView from '@react-native-masked-view/masked-view';
import { useIsFocused } from '@react-navigation/native';

const MetalSurface = Platform.OS === 'ios' ? requireNativeViewManager('FuelUpGlass') : View;

export function SuperSaverBackground({ isDark }) {
    const active = useIsFocused();
    return <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
        <MetalSurface active={active} isDark={isDark} wordmark={false} style={StyleSheet.absoluteFill} />
    </View>;
}

export function SuperSaverWordmark({ width = 240 }) {
    const active = useIsFocused();
    const size = { width, height: width * 38 / 132 };
    return <View accessible accessibilityRole="image" accessibilityLabel="Fuel Up" style={size}>
        <MaskedView style={size} maskElement={<Image source={require('../../../assets/FuelUp-text-logo-dark.png')} resizeMode="contain" style={size} />}>
            <MetalSurface active={active} wordmark isDark={false} style={[size, { backgroundColor: '#FF8504' }]} />
        </MaskedView>
    </View>;
}
