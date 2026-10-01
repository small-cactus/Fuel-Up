import React from 'react';
import { Platform, Text as RNText, View } from 'react-native';
import { Host, VStack, HStack, Text, Image } from '@expo/ui/swift-ui';
import { fixedSize, font, foregroundStyle, glassEffect, padding } from '@expo/ui/swift-ui/modifiers';

// Map annotation content is measured as one native view, including its glass.
export default function ExamplePricePill({ price, label, cheapest, isDark, pump = false }) {
    const color = isDark ? '#FFFFFF' : '#000000';
    const surfaceTint = cheapest ? 'rgba(0,255,47,0.3)' : 'rgba(255,25,0,0.3)';
    if (Platform.OS !== 'ios') return <View style={{ padding: 10, borderRadius: 20, backgroundColor: cheapest ? '#A8EBAE' : '#F4BDB4' }}>
        <RNText style={{ fontWeight: '700', color: '#111111' }}>{price}</RNText>{label && <RNText>{label}</RNText>}
    </View>;
    return <Host ignoreSafeArea="all" matchContents colorScheme={isDark ? 'dark' : 'light'}>
        <VStack spacing={2} modifiers={[fixedSize(), padding({ horizontal: 12, vertical: 8 }),
            glassEffect({ glass: { variant: 'regular', tint: surfaceTint }, shape: label ? 'roundedRectangle' : 'capsule', cornerRadius: 18 })]}>
            <HStack spacing={5}>
                {pump && <Image systemName="fuelpump.fill" size={14} color={color} />}
                <Text modifiers={[font({ size: label ? 19 : 16, weight: 'bold' }), foregroundStyle(color)]}>{price}</Text>
            </HStack>
            {label && <Text modifiers={[font({ size: 12, weight: 'semibold' }), foregroundStyle(color)]}>{label}</Text>}
        </VStack>
    </Host>;
}
