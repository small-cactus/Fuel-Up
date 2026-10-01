import React from 'react';
import { Platform, View, Pressable, Text, StyleSheet } from 'react-native';
import { Host, Menu, Picker, HStack, Image, Text as NativeText } from '@expo/ui/swift-ui';
import { pickerStyle, tag, buttonStyle, controlSize, font, foregroundStyle, fixedSize } from '@expo/ui/swift-ui/modifiers';
export default function TrendScopeControl({
  value,
  onChange,
  isDark,
  themeColors
}) {
  if (Platform.OS === 'ios') return <View style={styles.control}>
    <Host matchContents colorScheme={isDark ? 'dark' : 'light'}>
      <Menu modifiers={[buttonStyle('glass'), controlSize('large')]} label={
        <HStack spacing={8} modifiers={[fixedSize({ horizontal: true, vertical: true })]}>
          <NativeText modifiers={[font({ size: 17, weight: 'semibold' }), foregroundStyle(themeColors.text)]}>
            {value === 'local' ? 'Local' : 'National'}
          </NativeText>
          <Image systemName="chevron.down" size={12} color={themeColors.text} />
        </HStack>
      }>
        <Picker label="Price region" selection={value} onSelectionChange={onChange} modifiers={[pickerStyle('inline')]}>
          <NativeText modifiers={[tag('local')]}>Local</NativeText>
          <NativeText modifiers={[tag('national')]}>National</NativeText>
        </Picker>
      </Menu>
    </Host>
  </View>;
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
    alignItems: 'flex-start',
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
