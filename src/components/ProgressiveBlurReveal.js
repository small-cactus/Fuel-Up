import React, {
    forwardRef,
    memo,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from 'react';
import {
    Animated,
    Easing,
    Platform,
    StyleSheet,
    UIManager,
    View,
    unstable_batchedUpdates,
    useWindowDimensions,
} from 'react-native';
import MaskedView from '@react-native-masked-view/masked-view';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useTheme } from '../ThemeContext';

const HAS_NATIVE_MASK = Boolean(UIManager.hasViewManagerConfig?.('RNCMaskedView'));

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
const DEFAULT_FAILSAFE_BLUR_INTENSITY = 100;
const DEFAULT_FAILSAFE_FADE_DURATION = 1500;
const DEFAULT_IOS_TAB_BAR_HEIGHT = 52;
const DEFAULT_ANDROID_TAB_BAR_HEIGHT = 56;
const DEFAULT_Z_INDEX = 30;
const MASK_EPSILON = 0.0005;

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

function resolveMaskState(radius, index, featherWidth) {
    const innerRadius = radius + (index * featherWidth);
    const outerRadius = Math.max(1, innerRadius + featherWidth);
    const transparentStop = clamp(Math.max(0, innerRadius) / outerRadius, 0, 1);

    return {
        outerRadius,
        transparentStop,
    };
}

const BlurRingLayer = memo(forwardRef(function BlurRingLayer({
    index,
    intensity,
    instanceId,
    width,
    height,
    originX,
    originY,
    startRadius,
    featherWidth,
    tint,
}, ref) {
    const [maskState, setMaskState] = useState(() => resolveMaskState(startRadius, index, featherWidth));
    const maskId = `${instanceId}-ring-${index}`;

    useImperativeHandle(ref, () => ({
        updateMask(nextRadius, nextFeatherWidth) {
            const nextMaskState = resolveMaskState(nextRadius, index, nextFeatherWidth);

            setMaskState(previousMaskState => {
                if (
                    Math.abs(previousMaskState.outerRadius - nextMaskState.outerRadius) < MASK_EPSILON &&
                    Math.abs(previousMaskState.transparentStop - nextMaskState.transparentStop) < MASK_EPSILON
                ) {
                    return previousMaskState;
                }

                return nextMaskState;
            });
        },
    }), [index]);

    if (!HAS_NATIVE_MASK) {
        return null;
    }

    return (
        <MaskedView
            style={StyleSheet.absoluteFill}
            maskElement={
                <View style={[StyleSheet.absoluteFill, { width, height }]}>
                    <Svg width={width} height={height}>
                        <Defs>
                            <RadialGradient
                                id={maskId}
                                cx={originX}
                                cy={originY}
                                fx={originX}
                                fy={originY}
                                r={maskState.outerRadius}
                                gradientUnits="userSpaceOnUse"
                            >
                                <Stop offset="0" stopColor="#000000" stopOpacity="0" />
                                <Stop offset={maskState.transparentStop} stopColor="#000000" stopOpacity="0" />
                                <Stop offset="1" stopColor="#000000" stopOpacity="1" />
                            </RadialGradient>
                        </Defs>
                        <Rect x="0" y="0" width={width} height={height} fill={`url(#${maskId})`} />
                    </Svg>
                </View>
            }
        >
            <BlurView
                intensity={intensity}
                tint={tint}
                style={StyleSheet.absoluteFill}
            />
        </MaskedView>
    );
}));

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
    failsafeBlurIntensity = DEFAULT_FAILSAFE_BLUR_INTENSITY,
    failsafeFadeDuration = DEFAULT_FAILSAFE_FADE_DURATION,
    stepSize = DEFAULT_STEP_SIZE,
}) {
    const { isDark } = useTheme();
    const insets = useSafeAreaInsets();
    const { width: windowWidth, height: windowHeight } = useWindowDimensions();
    const [isMounted, setIsMounted] = useState(false);
    const frameRef = useRef(null);
    const completionTimerRef = useRef(null);
    const onRevealCompleteRef = useRef(onRevealComplete);
    const layerRefs = useRef([]);
    const containerOpacity = useRef(new Animated.Value(1)).current;
    const failsafeOpacity = useRef(new Animated.Value(1)).current;
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

    useEffect(() => {
        onRevealCompleteRef.current = onRevealComplete;
    }, [onRevealComplete]);

    useEffect(() => {
        return () => {
            if (frameRef.current) {
                cancelAnimationFrame(frameRef.current);
                frameRef.current = null;
            }

            if (completionTimerRef.current) {
                clearTimeout(completionTimerRef.current);
                completionTimerRef.current = null;
            }

            containerOpacity.stopAnimation();
            failsafeOpacity.stopAnimation();
        };
    }, [containerOpacity, failsafeOpacity]);

    useEffect(() => {
        if (frameRef.current) {
            cancelAnimationFrame(frameRef.current);
            frameRef.current = null;
        }

        if (completionTimerRef.current) {
            clearTimeout(completionTimerRef.current);
            completionTimerRef.current = null;
        }

        containerOpacity.stopAnimation();
        failsafeOpacity.stopAnimation();

        if (shouldReveal) {
            setIsMounted(true);
            containerOpacity.setValue(1);
            failsafeOpacity.setValue(1);

            Animated.timing(failsafeOpacity, {
                toValue: 0,
                duration: Math.max(1, failsafeFadeDuration),
                easing: Easing.in(Easing.ease),
                useNativeDriver: true,
            }).start();

            Animated.timing(containerOpacity, {
                toValue: 0,
                delay: Math.max(0, fadeOutDelay),
                duration: Math.max(1, fadeOutDuration),
                easing: Easing.linear,
                useNativeDriver: true,
            }).start();

            const startedAt = Date.now();
            const totalDuration = Math.max(
                Math.max(0, delay) + Math.max(1, duration),
                Math.max(0, fadeOutDelay) + Math.max(1, fadeOutDuration),
                Math.max(1, failsafeFadeDuration)
            );

            const applyRadiusFrame = () => {
                const elapsedMs = Date.now() - startedAt;
                const radiusRawProgress = clamp((elapsedMs - delay) / Math.max(1, duration), 0, 1);
                const radiusProgress = cubicBezierAtTime(radiusRawProgress, 0.05, 0.9, 0.2, 1);
                const currentRadius = startRadius + ((resolvedEndRadius - startRadius) * radiusProgress);

                unstable_batchedUpdates(() => {
                    layerRefs.current.forEach(layerRef => {
                        layerRef?.updateMask(currentRadius, resolvedStepSize);
                    });
                });

                if (elapsedMs < totalDuration) {
                    frameRef.current = requestAnimationFrame(applyRadiusFrame);
                } else {
                    frameRef.current = null;
                }
            };

            applyRadiusFrame();

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
            failsafeOpacity.setValue(1);

            unstable_batchedUpdates(() => {
                layerRefs.current.forEach(layerRef => {
                    layerRef?.updateMask(startRadius, resolvedStepSize);
                });
            });

            return undefined;
        }

        if (resetOnHide) {
            containerOpacity.setValue(1);
            failsafeOpacity.setValue(1);
            unstable_batchedUpdates(() => {
                layerRefs.current.forEach(layerRef => {
                    layerRef?.updateMask(startRadius, resolvedStepSize);
                });
            });

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
        failsafeFadeDuration,
        failsafeOpacity,
        hideWhenFinished,
        resetOnHide,
        resolvedEndRadius,
        resolvedStepSize,
        isBlurred,
        shouldReveal,
        startRadius,
    ]);

    if (!isMounted || safeHeight <= 0) {
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
            {HAS_NATIVE_MASK ? (
                <>
                    <AnimatedView style={[StyleSheet.absoluteFill, { opacity: failsafeOpacity, zIndex: 200 }]}>
                        <BlurView
                            intensity={failsafeBlurIntensity}
                            tint={resolvedTint}
                            style={StyleSheet.absoluteFill}
                        />
                    </AnimatedView>

                    {resolvedLayerIntensities.map((layerIntensity, index) => (
                        <BlurRingLayer
                            key={`${instanceId}-${index}`}
                            ref={layerRef => {
                                layerRefs.current[index] = layerRef;
                            }}
                            index={index}
                            intensity={layerIntensity}
                            instanceId={instanceId}
                            width={safeWidth}
                            height={safeHeight}
                            originX={resolvedOriginX}
                            originY={resolvedOriginY}
                            startRadius={startRadius}
                            featherWidth={resolvedStepSize}
                            tint={resolvedTint}
                        />
                    ))}
                </>
            ) : (
                <BlurView
                    intensity={resolvedLayerIntensities[resolvedLayerIntensities.length - 1] || failsafeBlurIntensity}
                    tint={resolvedTint}
                    style={StyleSheet.absoluteFill}
                />
            )}
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
