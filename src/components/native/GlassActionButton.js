import React from 'react';
import { Platform, Pressable, Text as RNText, useWindowDimensions } from 'react-native';
import { Host, Button, HStack, Text, Image, Spacer } from '@expo/ui/swift-ui';
import { accessibilityLabel, accessibilityHint, accessibilityValue, buttonStyle, controlSize, disabled, fixedSize, font, foregroundStyle, frame, tint } from '@expo/ui/swift-ui/modifiers';

// The button owns both its label and its glass. No transparent RN touch overlay.
export default function GlassActionButton({ title, icon, onPress, isDark, prominent = false,
    fullWidth = false, disabled: inactive = false, label = title, hint, value, testID }) {
    const { fontScale } = useWindowDimensions();
    const color = prominent ? '#FFFFFF' : isDark ? '#FFFFFF' : '#000000';
    if (Platform.OS !== 'ios') return <Pressable testID={testID} onPress={onPress} disabled={inactive}
        accessibilityRole="button" accessibilityLabel={label} accessibilityHint={hint}
        accessibilityState={{ disabled: inactive }} style={{ minHeight: 44, padding: 12, borderRadius: 22, backgroundColor: prominent ? '#007AFF' : isDark ? '#333333' : '#EEEEEE', alignItems: 'center' }}>
        <RNText style={{ color, fontSize: 16, fontWeight: '600' }}>{title}</RNText>
    </Pressable>;
    return <Host ignoreSafeArea="all" matchContents={fullWidth ? { vertical: true } : true}
        colorScheme={isDark ? 'dark' : 'light'} style={fullWidth ? { width: '100%' } : undefined}>
        <Button testID={testID} onPress={onPress} label={fullWidth ? undefined : title}
            systemImage={fullWidth ? undefined : icon} modifiers={[
            buttonStyle(prominent ? 'glassProminent' : 'glass'), controlSize('large'), tint('#007AFF'),
            fixedSize({ horizontal: !fullWidth, vertical: true }), font({ size: (prominent ? 18 : 14) * Math.min(fontScale, 2), weight: 'semibold' }), foregroundStyle(color),
            disabled(inactive), accessibilityLabel(label), ...(hint ? [accessibilityHint(hint)] : []),
            ...(value ? [accessibilityValue(value)] : []),
        ]}>
            {fullWidth && <HStack spacing={8} modifiers={[fixedSize({ horizontal: !fullWidth, vertical: true }), frame({ minHeight: prominent ? 38 : 24 })]}>
                {fullWidth && <Spacer />}
                {!prominent && icon && <Image systemName={icon} size={14} color={color} />}
                <Text modifiers={[font({ size: (prominent ? 18 : 14) * Math.min(fontScale, 2), weight: 'semibold' }), foregroundStyle(color)]}>{title}</Text>
                {prominent && icon && <Image systemName={icon} size={18} color={color} />}
                {fullWidth && <Spacer />}
            </HStack>}
        </Button>
    </Host>;
}
