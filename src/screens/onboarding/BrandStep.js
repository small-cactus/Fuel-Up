import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import BrandPreferences from '../../components/BrandPreferences';

export default function BrandStep({ width, insets, themeColors, ...props }) {
    return (
        <View style={{ width, flex: 1, backgroundColor: themeColors.background }}>
            <View style={[styles.header, { paddingTop: insets.top + 28 }]}>
                <Text style={[styles.title, { color: themeColors.text }]}>Your station brands</Text>
                <Text style={[styles.subtitle, { color: themeColors.text }]}>Choose your memberships and favorites.</Text>
            </View>
            <BrandPreferences themeColors={themeColors} {...props} />
        </View>
    );
}
const styles = StyleSheet.create({
    header: { paddingHorizontal: 24, paddingBottom: 12, gap: 10 },
    title: { fontSize: 27, fontWeight: '800', fontFamily: 'ui-rounded', textAlign: 'center' },
    subtitle: { fontSize: 15, lineHeight: 21, textAlign: 'center', opacity: 0.65 },
});
