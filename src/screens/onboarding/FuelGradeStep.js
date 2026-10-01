import { GlassForm as Form, GlassSection as Section } from '../../../modules/fuel-up-glass';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { Host, Picker, Toggle, Text as NativeText } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { FUEL_GRADE_ORDER, getFuelGradeMeta } from '../../lib/fuelGrade';

export default function FuelGradeStep({ isDark, themeColors, insets, value, onChange, width, requiresE85, onRequiresE85Change }) {
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
                                <NativeText key={grade} testID={`onboarding-grade-${grade}`} modifiers={[tag(grade)]}>{getFuelGradeMeta(grade).label}</NativeText>
                            ))}
                        </Picker>
                    </Section>
                    <Section footer={<NativeText>Your selected fuel stays the same. Stations must also have E85.</NativeText>}>
                        <Toggle testID="onboarding-requires-e85" label="Only show stations that also have E85"
                            isOn={Boolean(requiresE85)} onIsOnChange={onRequiresE85Change} />
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
