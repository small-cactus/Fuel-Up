import React, { useRef } from 'react';
import { Platform, View, Text as RNText, useWindowDimensions } from 'react-native';
import CommunitySlider from '@react-native-community/slider';
import { Host, VStack, HStack, Text, Spacer, Slider } from '@expo/ui/swift-ui';
import { accessibilityLabel, fixedSize, font, foregroundStyle, frame, glassEffect, padding, tint } from '@expo/ui/swift-ui/modifiers';
import { MIN_SEARCH_RADIUS_MILES, MAX_SEARCH_RADIUS_MILES } from '../../lib/fuelSearchState';

export default function RadiusControl({ value, onChange, onComplete, isDark, themeColors }) {
    const latest = useRef(value);
    latest.current = value;
    const { fontScale } = useWindowDimensions();
    const change = next => { latest.current = next; onChange(next); };
    if (Platform.OS !== 'ios') return <View style={{ padding: 20, borderRadius: 24, backgroundColor: isDark ? '#252525' : '#EEEEEE' }}>
        <RNText style={{ color: themeColors.text, fontSize: 32, textAlign: 'center' }}>{value} mi</RNText>
        <CommunitySlider testID="onboarding-radius" accessibilityLabel="Search radius in miles" minimumValue={MIN_SEARCH_RADIUS_MILES}
            maximumValue={MAX_SEARCH_RADIUS_MILES} step={1} value={value} onValueChange={change} onSlidingComplete={onComplete} />
    </View>;
    return <Host ignoreSafeArea="all" matchContents={{ vertical: true }} colorScheme={isDark ? 'dark' : 'light'} style={{ width: '100%' }}>
        <VStack spacing={8} modifiers={[fixedSize({ horizontal: false, vertical: true }), padding({ all: 20 }),
            glassEffect({ glass: { variant: 'regular' }, shape: 'roundedRectangle', cornerRadius: 24 })]}>
            <Text modifiers={[font({ size: 32 * Math.min(fontScale, 2), weight: 'bold' }), foregroundStyle(themeColors.text)]}>{value} mi</Text>
            <Slider testID="onboarding-radius" min={MIN_SEARCH_RADIUS_MILES} max={MAX_SEARCH_RADIUS_MILES} step={1}
                value={value} onValueChange={change} onEditingChanged={editing => { if (!editing) onComplete(latest.current); }}
                modifiers={[accessibilityLabel('Search radius in miles'), tint('#007AFF'), frame({ minHeight: 44 })]} />
            <HStack modifiers={[foregroundStyle(themeColors.textOpacity)]}>
                <Text>{MIN_SEARCH_RADIUS_MILES} mi</Text><Spacer /><Text>{MAX_SEARCH_RADIUS_MILES} mi</Text>
            </HStack>
        </VStack>
    </Host>;
}
