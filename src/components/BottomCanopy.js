import React from 'react';
import { Platform, StyleSheet, UIManager, View } from 'react-native';
import { ProgressiveBlurView } from '@sbaiahmed1/react-native-blur';

const HAS_NATIVE_PROGRESSIVE_BLUR =
    Platform.OS === 'ios' && Boolean(UIManager.hasViewManagerConfig?.('ReactNativeProgressiveBlurView'));

export function BottomCanopy({ height, isDark, variant = 'default' }) {
    const isHomeVariant = variant === 'home';

    if (!HAS_NATIVE_PROGRESSIVE_BLUR) {
        return null;
    }

    return (
        <View pointerEvents="none" style={[styles.shell, { height }]}>
            <ProgressiveBlurView
                blurType={isDark ? 'dark' : 'light'}
                blurAmount={isHomeVariant ? 16 : 12}
                direction="blurredBottomClearTop"
                startOffset={0.0}
                style={{ height }}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    shell: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
    }
});

export default BottomCanopy;
