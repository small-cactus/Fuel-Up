import React from 'react';
import { Platform, StyleSheet, UIManager, View } from 'react-native';
import { ProgressiveBlurView } from '@sbaiahmed1/react-native-blur';

const HAS_NATIVE_PROGRESSIVE_BLUR =
    Platform.OS === 'ios' && Boolean(UIManager.hasViewManagerConfig?.('ReactNativeProgressiveBlurView'));

const TOP_CANOPY_BLUR_STRENGTH = 0.8; // 0 = no blur, 1 = default, >1 = stronger
const TOP_CANOPY_BLUR_SPREAD = 1.4; // 1 = default height, >1 = spreads further down
const BASE_PROGRESSIVE_BLUR_AMOUNT = 5;

export function TopCanopy({ height, isDark }) {
    const canopyHeight = Math.max(0, height * Math.max(0, TOP_CANOPY_BLUR_SPREAD));
    const progressiveBlurAmount = Math.max(0, BASE_PROGRESSIVE_BLUR_AMOUNT * TOP_CANOPY_BLUR_STRENGTH);

    if (!HAS_NATIVE_PROGRESSIVE_BLUR) {
        return null;
    }

    return (
        <View pointerEvents="none" style={[styles.shell, { height: canopyHeight }]}>
            <ProgressiveBlurView
                blurType={isDark ? 'dark' : 'light'}
                blurAmount={progressiveBlurAmount}
                direction="blurredTopClearBottom"
                startOffset={0.0}
                style={{ height: canopyHeight }}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    shell: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
    },
});

export default TopCanopy;
