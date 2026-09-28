import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { Form, Host, Picker, Section, Text as NativeText } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { FUEL_GRADE_ORDER, getFuelGradeMeta } from '../../lib/fuelGrade';

export default function FuelGradeStep({ isDark, themeColors, insets, value, onChange, width }) {
    return (
        <View style={{ width, flex: 1, backgroundColor: themeColors.background }}>
            <View style={[styles.header, { paddingTop: insets.top + 32 }]}>
                <SymbolView name="fuelpump.fill" size={44} tintColor={themeColors.text} />
                <Text style={[styles.title, { color: themeColors.text }]}>Your Fuel</Text>
                <Text style={[styles.subtitle, { color: themeColors.text }]}>Which fuel does your car use?</Text>
            </View>
            <Host style={{ flex: 1 }} colorScheme={isDark ? 'dark' : 'light'}>
                <Form>
                    <Section>
                        <Picker label="Fuel type" selection={value} onSelectionChange={onChange} modifiers={[pickerStyle('inline')]}>
                            {FUEL_GRADE_ORDER.map(grade => (
                                <NativeText key={grade} modifiers={[tag(grade)]}>{getFuelGradeMeta(grade).label}</NativeText>
                            ))}
                        </Picker>
                    </Section>
                </Form>
            </Host>
        </View>
    );
}
const styles = StyleSheet.create({
    header: { alignItems: 'center', paddingHorizontal: 24, gap: 12, paddingBottom: 16 },
    title: { fontSize: 28, fontWeight: '800', fontFamily: 'ui-rounded' },
    subtitle: { fontSize: 16, opacity: 0.65, textAlign: 'center' },
});
