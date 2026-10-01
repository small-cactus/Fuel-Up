import React from 'react';
import { Platform, View, Pressable, Text, StyleSheet } from 'react-native';
import { Host, Picker, Text as NativeText } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
export default function TrendScopeControl({
  value,
  onChange,
  isDark,
  themeColors
}) {
  if (Platform.OS === 'ios') return <Host matchContents={{
    vertical: true
  }} colorScheme={isDark ? 'dark' : 'light'} style={styles.control}>
            <Picker label="Price region" selection={value} onSelectionChange={onChange} modifiers={[pickerStyle('segmented')]}>
                <NativeText modifiers={[tag('local')]}>Local</NativeText>
                <NativeText modifiers={[tag('national')]}>National</NativeText>
            </Picker>
        </Host>;
  return <View style={styles.fallback}>{['local', 'national'].map(scope => <Pressable key={scope} accessibilityRole="button" accessibilityState={{
      selected: value === scope
    }} onPress={() => onChange(scope)} style={styles.button}>
            <Text style={{
        color: themeColors.text,
        fontWeight: value === scope ? '700' : '400'
      }}>{scope === 'local' ? 'Local' : 'National'}</Text>
        </Pressable>)}</View>;
}
const styles = StyleSheet.create({
  control: {
    marginHorizontal: 24,
    marginTop: 12,
    marginBottom: 20
  },
  fallback: {
    flexDirection: 'row',
    marginHorizontal: 24
  },
  button: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center'
  }
});
