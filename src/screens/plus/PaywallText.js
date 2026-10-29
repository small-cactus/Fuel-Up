import React from 'react';
import { StyleSheet, Text, useWindowDimensions } from 'react-native';

// Explicit sizes invalidate Fabric's cached text measurement when Dynamic Type
// changes while this screen is open. Native auto-scaling alone can retain the
// old line boxes until relaunch. This preserves the user's full font multiplier.
export default function PaywallText({ style, ...props }) {
    const { fontScale } = useWindowDimensions();
    const resolved = StyleSheet.flatten(style) || {};
    return <Text {...props} allowFontScaling={false} style={[style, {
        fontSize: (resolved.fontSize || 14) * fontScale,
        ...(resolved.lineHeight ? { lineHeight: resolved.lineHeight * fontScale } : {}),
    }]} />;
}
