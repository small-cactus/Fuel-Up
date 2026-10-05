import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import Animated, { cancelAnimation, Easing, useAnimatedProps, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

const AnimatedBlur = Animated.createAnimatedComponent(BlurView);
export const WAITING_BLUR = 24;
export const ERROR_BLUR = 40;
const BLUR_DURATION_MS = 650;

// A quick response stays clear. Slower requests progressively soften the screen
// with a brief animation independent of the request timeout. Only the transport
// deadline decides when to show the warning.
export default function ConnectionBlur({ pending, failed, isDark }) {
    const intensity = useSharedValue(0);
    const startedAt = pending?.startedAt;
    useEffect(() => {
        cancelAnimation(intensity);
        if (failed) {
            intensity.value = withTiming(ERROR_BLUR, { duration: BLUR_DURATION_MS });
        } else if (Number.isFinite(startedAt)) {
            const now = Date.now();
            const start = startedAt + 1000;
            intensity.value = WAITING_BLUR * Math.min(1, Math.max(0, (now - start) / BLUR_DURATION_MS));
            intensity.value = withDelay(Math.max(0, start - now), withTiming(WAITING_BLUR, {
                duration: Math.max(0, BLUR_DURATION_MS - Math.max(0, now - start)), easing: Easing.linear,
            }));
        } else { intensity.value = withTiming(0, { duration: 250 }); }
        return () => cancelAnimation(intensity);
    }, [startedAt, failed, intensity]);
    const animatedProps = useAnimatedProps(() => ({ intensity: intensity.value }));
    return <AnimatedBlur animatedProps={animatedProps} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />;
}
