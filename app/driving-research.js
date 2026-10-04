import React, { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { requireNativeViewManager } from 'expo-modules-core';
import { useTheme } from '../src/ThemeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import TopCanopy from '../src/components/TopCanopy';
import FuelUpHeaderLogo from '../src/components/FuelUpHeaderLogo';
const ResearchView = requireNativeViewManager('FuelUpDrivingActivity');
export default function DrivingResearchPage() {
    const { isDark, themeColors } = useTheme();
    const insets = useSafeAreaInsets();
    const canopyHeight = insets.top + 44;
    const headerTitle = useCallback(() => <FuelUpHeaderLogo isDark={isDark} style={styles.logo} />, [isDark]);
    return <View style={[styles.fill, { backgroundColor: themeColors.background }]}>
        <Stack.Screen options={{ headerShown: true, headerTransparent: true, headerTitle,
            title: '', headerBackButtonDisplayMode: 'minimal', headerShadowVisible: false,
            headerStyle: { backgroundColor: 'transparent' }, headerTintColor: themeColors.text }} />
        <View style={[styles.fill, { paddingTop: canopyHeight, paddingBottom: insets.bottom }]}>
            <ResearchView style={styles.fill} isDark={isDark} testID="driving-research-screen" />
        </View>
        <TopCanopy height={canopyHeight} />
    </View>;
}
const styles = StyleSheet.create({ fill: { flex: 1 }, logo: { transform: [{ translateY: -3 }] } });
