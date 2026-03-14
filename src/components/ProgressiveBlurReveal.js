import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    Animated,
    Easing,
    Platform,
    StyleSheet,
    useWindowDimensions,
} from 'react-native';
import { ReactNativeProgressiveBlurView as NativeProgressiveBlurView } from '@sbaiahmed1/react-native-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../ThemeContext';

const DEFAULT_LAYER_INTENSITIES = [0.5, 1, 2, 4, 8, 14, 22, 32];
const DEFAULT_STEP_SIZE = 60;
const DEFAULT_DURATION = 20000;
const DEFAULT_DELAY = 200;
const DEFAULT_START_RADIUS = -400;
const DEFAULT_RADIUS_BUFFER = 50;
const DEFAULT_ORIGIN = { x: 0.5, y: 0.5 };
const DEFAULT_ORIGIN_UNIT = 'fraction';
const DEFAULT_FADE_OUT_DELAY = 10000;
const DEFAULT_FADE_OUT_DURATION = 1500;
const DEFAULT_IOS_TAB_BAR_HEIGHT = 52;
const DEFAULT_ANDROID_TAB_BAR_HEIGHT = 56;
const DEFAULT_Z_INDEX = 30;

const AnimatedView = Animated.View;

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function cubicBezierAtTime(progress, p1x, p1y, p2x, p2y) {
    const cx = 3 * p1x;
    const bx = 3 * (p2x - p1x) - cx;
    const ax = 1 - cx - bx;
    const cy = 3 * p1y;
    const by = 3 * (p2y - p1y) - cy;
    const ay = 1 - cy - by;

    const sampleCurveX = t => ((ax * t + bx) * t + cx) * t;
    const sampleCurveY = t => ((ay * t + by) * t + cy) * t;
    const sampleCurveDerivativeX = t => (3 * ax * t + 2 * bx) * t + cx;

    let t = progress;
    for (let index = 0; index < 8; index += 1) {
        const currentSlope = sampleCurveDerivativeX(t);
        if (Math.abs(currentSlope) < 1e-6) {
            break;
        }

        const currentX = sampleCurveX(t) - progress;
        t -= currentX / currentSlope;
    }

    t = clamp(t, 0, 1);
    return sampleCurveY(t);
}

function resolveAxis(value, size, unit) {
    if (!Number.isFinite(value)) {
        return size * 0.5;
    }

    if (unit === 'px') {
        return value;
    }

    return value * size;
}

function getFarthestCornerDistance(originX, originY, width, height) {
    return Math.max(
        Math.hypot(originX, originY),
        Math.hypot(width - originX, originY),
        Math.hypot(originX, height - originY),
        Math.hypot(width - originX, height - originY)
    );
}

function resolveNativeBlurType(tint, isDark) {
    if (tint === 'dark') {
        return 'systemMaterialDark';
    }

    if (tint === 'light' || tint === 'extraLight') {
        return 'systemMaterialLight';
    }

    if (tint === 'prominent') {
        return isDark ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight';
    }

    return isDark ? 'systemMaterialDark' : 'systemMaterialLight';
}

export default function ProgressiveBlurReveal({
    shouldReveal = false,
    isBlurred = false,
    origin = DEFAULT_ORIGIN,
    originUnit = DEFAULT_ORIGIN_UNIT,
    duration = DEFAULT_DURATION,
    delay = DEFAULT_DELAY,
    layerIntensities = DEFAULT_LAYER_INTENSITIES,
    intensity,
    tint,
    bottomExclusionHeight,
    excludeTabs = true,
    startRadius = DEFAULT_START_RADIUS,
    endRadius,
    radiusBuffer = DEFAULT_RADIUS_BUFFER,
    radiusOvershoot = 1,
    dispersion = 1,
    fadeOutDelay = DEFAULT_FADE_OUT_DELAY,
    fadeOutDuration = DEFAULT_FADE_OUT_DURATION,
    hideWhenFinished = true,
    resetOnHide = true,
    onRevealComplete,
    style,
    zIndex = DEFAULT_Z_INDEX,
    stepSize = DEFAULT_STEP_SIZE,
}) {
    const { isDark } = useTheme();
    const insets = useSafeAreaInsets();
    const { width: windowWidth, height: windowHeight } = useWindowDimensions();
    const [isMounted, setIsMounted] = useState(false);
    const completionTimerRef = useRef(null);
    const onRevealCompleteRef = useRef(onRevealComplete);
    const containerOpacity = useRef(new Animated.Value(1)).current;
    const [nativeRevealTrigger, setNativeRevealTrigger] = useState(0);
    const instanceId = useMemo(
        () => `progressive-blur-reveal-${Math.random().toString(36).slice(2, 10)}`,
        []
    );

    const resolvedTint = tint || (isDark ? 'dark' : 'light');
    const chromeHeight = Platform.OS === 'ios' ? DEFAULT_IOS_TAB_BAR_HEIGHT : DEFAULT_ANDROID_TAB_BAR_HEIGHT;
    const resolvedBottomExclusion = bottomExclusionHeight ?? (
        excludeTabs
            ? insets.bottom + chromeHeight
            : 0
    );
    const revealHeight = Math.max(0, windowHeight - resolvedBottomExclusion);
    const safeWidth = Math.max(1, windowWidth);
    const safeHeight = Math.max(1, revealHeight);
    const resolvedOriginX = clamp(resolveAxis(origin?.x, safeWidth, originUnit), 0, safeWidth);
    const resolvedOriginY = clamp(resolveAxis(origin?.y, safeHeight, originUnit), 0, safeHeight);
    const resolvedEndRadius = useMemo(() => {
        if (Number.isFinite(endRadius) && endRadius > startRadius) {
            return endRadius;
        }

        return (getFarthestCornerDistance(resolvedOriginX, resolvedOriginY, safeWidth, safeHeight) * radiusOvershoot) + radiusBuffer;
    }, [
        endRadius,
        radiusBuffer,
        radiusOvershoot,
        resolvedOriginX,
        resolvedOriginY,
        safeHeight,
        safeWidth,
        startRadius,
    ]);
    const resolvedStepSize = Math.max(1, stepSize * Math.max(0.1, dispersion));
    const resolvedLayerIntensities = useMemo(() => {
        if (Array.isArray(layerIntensities) && layerIntensities.length > 0) {
            return layerIntensities;
        }

        if (Number.isFinite(intensity) && intensity > 0) {
            return [intensity];
        }

        return DEFAULT_LAYER_INTENSITIES;
    }, [intensity, layerIntensities]);
    const hasNativeProgressiveBlurView = Boolean(NativeProgressiveBlurView);
    const resolvedNativeBlurType = useMemo(
        () => resolveNativeBlurType(resolvedTint, isDark),
        [isDark, resolvedTint]
    );
    const resolvedOriginXFraction = safeWidth > 0 ? resolvedOriginX / safeWidth : 0.5;
    const resolvedOriginYFraction = safeHeight > 0 ? resolvedOriginY / safeHeight : 0.5;

    useEffect(() => {
        onRevealCompleteRef.current = onRevealComplete;
    }, [onRevealComplete]);

    useEffect(() => {
        if (!hasNativeProgressiveBlurView || !shouldReveal || !isMounted) {
            return;
        }

        setNativeRevealTrigger(currentValue => currentValue + 1);
    }, [hasNativeProgressiveBlurView, isMounted, shouldReveal]);

    useEffect(() => {
        if (completionTimerRef.current) {
            clearTimeout(completionTimerRef.current);
            completionTimerRef.current = null;
        }

        containerOpacity.stopAnimation();

        if (shouldReveal) {
            setIsMounted(true);
            containerOpacity.setValue(1);

            Animated.timing(containerOpacity, {
                toValue: 0,
                delay: Math.max(0, fadeOutDelay),
                duration: Math.max(1, fadeOutDuration),
                easing: Easing.linear,
                useNativeDriver: true,
            }).start();

            const totalDuration = Math.max(
                Math.max(0, delay) + Math.max(1, duration),
                Math.max(0, fadeOutDelay) + Math.max(1, fadeOutDuration)
            );

            completionTimerRef.current = setTimeout(() => {
                if (hideWhenFinished) {
                    setIsMounted(false);
                }

                if (typeof onRevealCompleteRef.current === 'function') {
                    onRevealCompleteRef.current();
                }
            }, totalDuration);

            return undefined;
        }

        if (isBlurred) {
            setIsMounted(true);
            containerOpacity.setValue(1);

            return undefined;
        }

        if (resetOnHide) {
            containerOpacity.setValue(1);

            if (hideWhenFinished) {
                setIsMounted(false);
            }
        }

        return undefined;
    }, [
        containerOpacity,
        delay,
        duration,
        fadeOutDelay,
        fadeOutDuration,
        hideWhenFinished,
        resetOnHide,
        isBlurred,
        shouldReveal,
    ]);

    useEffect(() => {
        return () => {
            if (completionTimerRef.current) {
                clearTimeout(completionTimerRef.current);
                completionTimerRef.current = null;
            }

            containerOpacity.stopAnimation();
        };
    }, [containerOpacity]);

    if (!isMounted || safeHeight <= 0 || !hasNativeProgressiveBlurView) {
        return null;
    }

    return (
        <AnimatedView
            pointerEvents="none"
            style={[
                styles.shell,
                { bottom: resolvedBottomExclusion, zIndex },
                style,
                { opacity: containerOpacity },
            ]}
        >
            {resolvedLayerIntensities.map((layerIntensity, index) => (
                <NativeProgressiveBlurView
                    key={`${instanceId}-native-${index}`}
                    blurAmount={layerIntensity}
                    blurType={resolvedNativeBlurType}
                    radial
                    radialCenterX={resolvedOriginXFraction}
                    radialCenterY={resolvedOriginYFraction}
                    radialClearRadius={startRadius + (index * resolvedStepSize)}
                    radialFeather={resolvedStepSize}
                    animationDuration={duration}
                    animationDelay={delay}
                    startRadius={startRadius + (index * resolvedStepSize)}
                    endRadius={resolvedEndRadius + (index * resolvedStepSize)}
                    featherStart={resolvedStepSize}
                    featherEnd={resolvedStepSize}
                    revealTrigger={nativeRevealTrigger}
                    reducedTransparencyFallbackColor={isDark ? '#0B0B0F' : '#F4F4F7'}
                    style={StyleSheet.absoluteFill}
                />
            ))}
        </AnimatedView>
    );
}

const styles = StyleSheet.create({
    shell: {
        ...StyleSheet.absoluteFillObject,
        left: 0,
        right: 0,
        top: 0,
        overflow: 'hidden',
    },
});
