import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';

/** Swap only the material. Yoga still owns the original size, padding and hit area. */
export default function NativeGlassContainer({ style, children, tintColor, ...props }) {
    if (Platform.OS !== 'ios' || !isGlassEffectAPIAvailable()) {
        return <View {...props} style={style}>{children}</View>;
    }
    const { backgroundColor, borderColor, borderWidth, ...layout } = StyleSheet.flatten(style) || {};
    return <GlassView {...props} style={layout} glassEffectStyle="regular" tintColor={tintColor}>
        {children}
    </GlassView>;
}
