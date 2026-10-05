import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import Animated, { cancelAnimation, useAnimatedProps, useSharedValue, withTiming } from 'react-native-reanimated';

const AnimatedBlur = Animated.createAnimatedComponent(BlurView);
export const ERROR_BLUR = 65;
const BLUR_DURATION_MS = 500;

// Mounted only with the connection warning after a real failure. Pending requests
// never mount a blur; the animation starts at the same time as the warning.
export default function ConnectionBlur({ isDark }) {
    const intensity = useSharedValue(0);
    useEffect(() => {
        intensity.value = withTiming(ERROR_BLUR, { duration: BLUR_DURATION_MS });
        return () => cancelAnimation(intensity);
    }, [intensity]);
    const animatedProps = useAnimatedProps(() => ({ intensity: intensity.value }));
    return <AnimatedBlur animatedProps={animatedProps} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />;
}
