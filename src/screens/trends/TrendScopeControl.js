import { t } from '../../localization';
import React from 'react';
import { Platform, View, Pressable, Text, StyleSheet } from 'react-native';
import { Host, Menu, Picker, HStack, Image, Text as NativeText } from '@expo/ui/swift-ui';
import { pickerStyle, tag, buttonStyle, controlSize, font, foregroundStyle, fixedSize, frame } from '@expo/ui/swift-ui/modifiers';
export default function TrendScopeControl({
  value,
  onChange,
  isDark,
  themeColors
}) {
  if (Platform.OS === 'ios') return <Host style={styles.control} matchContents colorScheme={isDark ? 'dark' : 'light'}>
      <Menu modifiers={[buttonStyle('glass'), controlSize('small'), frame({ minHeight: 44 })]} label={
        <HStack spacing={6} modifiers={[fixedSize({ horizontal: true, vertical: true })]}>
          <NativeText modifiers={[font({ size: 14, weight: 'semibold' }), foregroundStyle(themeColors.text)]}>
            {value === 'local' ? t("Local") : t("National")}
          </NativeText>
          <Image systemName="chevron.down" size={10} color={themeColors.text} />
        </HStack>
      }>
        <Picker label={t("Price region")} selection={value} onSelectionChange={onChange} modifiers={[pickerStyle('inline')]}>
          <NativeText modifiers={[tag('local')]}>{t("Local")}</NativeText>
          <NativeText modifiers={[tag('national')]}>{t("National")}</NativeText>
        </Picker>
      </Menu>
    </Host>;
  return <View style={styles.fallback}>{['local', 'national'].map(scope => <Pressable key={scope} accessibilityRole="button" accessibilityState={{
      selected: value === scope
    }} onPress={() => onChange(scope)} style={styles.button}>
            <Text style={{
        color: themeColors.text,
        fontWeight: value === scope ? '700' : '400'
      }}>{scope === 'local' ? t("Local") : t("National")}</Text>
        </Pressable>)}</View>;
}
const styles = StyleSheet.create({
  control: {
    flexShrink: 0
  },
  fallback: {
    flexDirection: 'row',
    flexShrink: 0
  },
  button: {
    paddingHorizontal: 8,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center'
  }
});
