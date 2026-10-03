import React, { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { useTheme } from '../ThemeContext';
import { finishLaunch, launchReadiness } from '../lib/launchReadiness';

// Preserve the native launch artwork until its in-app twin is laid out. The
// actual map remains mounted underneath; no duplicate map or fixed delay.
void SplashScreen.preventAutoHideAsync().catch(() => {});
export function useLaunchReady() {
    return useSyncExternalStore(launchReadiness.subscribe, launchReadiness.getSnapshot, launchReadiness.getSnapshot);
}
export default function LaunchSplash() {
    const ready = useLaunchReady();
    const { isDark } = useTheme();
    const [laidOut, setLaidOut] = useState(false);
    const [imageLoaded, setImageLoaded] = useState(false);
    const hideNative = useCallback(() => { void SplashScreen.hideAsync().catch(() => {}); }, []);
    useEffect(() => {
        if (ready || (laidOut && imageLoaded)) hideNative();
    }, [ready, laidOut, imageLoaded, hideNative]);
    useEffect(() => {
        if (ready) return;
        const deadline = setTimeout(finishLaunch, 4000);
        return () => clearTimeout(deadline);
    }, [ready, hideNative]);
    if (ready) return null;
    return <View testID="launch-splash" onLayout={() => setLaidOut(true)} accessible accessibilityLabel="Fuel Up is loading the map"
        accessibilityViewIsModal style={[styles.cover, { backgroundColor: isDark ? '#000000' : '#FFFFFF' }]}>
        <Image source={isDark ? require('../../assets/splash-dark.png') : require('../../assets/splash-light.png')}
            onLoadEnd={() => setImageLoaded(true)} resizeMode="contain"
            style={{ width: '100%', height: '100%' }} accessible={false} />
    </View>;
}
const styles = StyleSheet.create({ cover: { ...StyleSheet.absoluteFillObject, zIndex: 1000 } });
