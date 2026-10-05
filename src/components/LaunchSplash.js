import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Animated, Image, Platform, StyleSheet } from 'react-native';
import { requireNativeViewManager } from 'expo-modules-core';
import * as SplashScreen from 'expo-splash-screen';
import { useTheme } from '../ThemeContext';
import { finishLaunch, launchReadiness } from '../lib/launchReadiness';

const NativeSplash = Platform.OS === 'ios'
    ? requireNativeViewManager('FuelUpMapKitRouting', 'NativeLaunchSplashView') : null;

// Keep the real map mounted underneath and hand off the OS artwork 1:1.
void SplashScreen.preventAutoHideAsync().catch(() => {});
export function useLaunchReady() {
    return useSyncExternalStore(launchReadiness.subscribe, launchReadiness.getSnapshot, launchReadiness.getSnapshot);
}
export default function LaunchSplash() {
    const ready = useLaunchReady();
    const { isDark } = useTheme();
    const [dismissed, setDismissed] = useState(false);
    const [nativeHidden, setNativeHidden] = useState(false);
    const [laidOut, setLaidOut] = useState(false);
    const [imageLoaded, setImageLoaded] = useState(false);
    const handoffStarted = useRef(false);
    const opacity = useRef(new Animated.Value(1)).current;
    const completeExit = useCallback(() => setDismissed(true), []);
    const hideNative = useCallback(async () => {
        if (handoffStarted.current) return;
        handoffStarted.current = true;
        try { await SplashScreen.hideAsync(); } catch { /* Already hidden by the OS. */ }
        setNativeHidden(true);
    }, []);
    useEffect(() => {
        if (!NativeSplash && laidOut && imageLoaded) void hideNative();
    }, [laidOut, imageLoaded, hideNative]);
    useEffect(() => {
        if (ready) return;
        const deadline = setTimeout(finishLaunch, 4000);
        return () => clearTimeout(deadline);
    }, [ready]);
    useEffect(() => {
        if (!ready || !nativeHidden || NativeSplash) return;
        const animation = Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true });
        animation.start(({ finished }) => { if (finished) completeExit(); });
        return () => animation.stop();
    }, [ready, nativeHidden, opacity, completeExit]);
    if (dismissed) return null;
    if (NativeSplash) {
        return <NativeSplash testID="launch-splash" exiting={ready && nativeHidden}
            onArtworkReady={hideNative} onExitComplete={completeExit}
            pointerEvents={ready ? 'none' : 'auto'} style={styles.cover} />;
    }
    return <Animated.View testID="launch-splash" onLayout={() => setLaidOut(true)} accessible
        accessibilityLabel="Fuel Up is loading the map" accessibilityViewIsModal={!ready}
        pointerEvents={ready ? 'none' : 'auto'}
        style={[styles.cover, { opacity, backgroundColor: isDark ? '#000000' : '#FFFFFF' }]}>
        <Image source={isDark ? require('../../assets/splash-dark.png') : require('../../assets/splash-light.png')}
            onLoadEnd={() => setImageLoaded(true)} resizeMode="contain"
            style={{ width: '100%', height: '100%' }} accessible={false} />
    </Animated.View>;
}
const styles = StyleSheet.create({ cover: { ...StyleSheet.absoluteFillObject, zIndex: 1000 } });
