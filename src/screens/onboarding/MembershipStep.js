import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MembershipPreferences from '../../components/memberships/MembershipPreferences';
export default function MembershipStep({ width, insets, themeColors, ...props }) {
    return <View style={{ width, flex: 1, backgroundColor: themeColors.background }}>
        <Text style={[styles.title, { paddingTop: insets.top + 28, color: themeColors.text }]}>Where do you have a membership?</Text>
        <MembershipPreferences {...props} />
    </View>;
}
const styles = StyleSheet.create({ title: { paddingHorizontal: 24, paddingBottom: 12, fontSize: 27, fontWeight: '800', fontFamily: 'ui-rounded', textAlign: 'center' } });
