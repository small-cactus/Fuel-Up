import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import NativeGlassContainer from '../../components/native/NativeGlassContainer';
import Text from './PaywallText';
import SaverFeatureGraphic from './SaverFeatureGraphics';
import { PLUS_FEATURES } from './presentation';

export default function SaverFeatureAccordion({ isDark, textColor }) {
    const [expanded, setExpanded] = useState(0);
    return <View style={styles.stack}>
        {PLUS_FEATURES.map((feature, index) => <NativeGlassContainer key={feature.title} colorScheme={isDark ? 'dark' : 'light'} tintColor={isDark ? '#15171ACC' : undefined} style={styles.card}>
            <Pressable onPress={() => setExpanded(index)} accessibilityRole="button" accessibilityState={{ expanded: expanded === index }}
                accessibilityLabel={feature.title} testID={`saver-feature-${index}`} style={styles.row}>
                <SymbolView name={feature.icon} size={19} tintColor={isDark ? '#FFB64F' : '#964900'} />
                <Text style={[styles.title, { color: textColor }]}>{feature.title}</Text>
                <SymbolView name={expanded === index ? 'chevron.up' : 'chevron.down'} size={12} tintColor={textColor} />
            </Pressable>
            {expanded === index && <SaverFeatureGraphic index={index} isDark={isDark} />}
        </NativeGlassContainer>)}
    </View>;
}
const styles = StyleSheet.create({
    stack: { gap: 9, width: '100%' }, card: { borderRadius: 25, overflow: 'hidden' },
    row: { minHeight: 51, paddingHorizontal: 18, paddingVertical: 13, flexDirection: 'row', gap: 12, alignItems: 'center' },
    title: { fontSize: 15, fontWeight: '600', flex: 1, letterSpacing: -0.2 },
});
