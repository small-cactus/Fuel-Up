import { t } from '../../localization';
import React from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { Button, Host, HStack, Spacer, Text } from '@expo/ui/swift-ui';
import { font, padding } from '@expo/ui/swift-ui/modifiers';
import BrandPreferences from '../BrandPreferences';

export default function BrandPreferencesSheet({ visible, onClose, isDark, themeColors, ...preferences }) {
    return (
        <Modal visible={visible} animationType="slide" presentationStyle="pageSheet"
            allowSwipeDismissal onRequestClose={onClose} onDismiss={onClose}>
            <View style={[styles.sheet, { backgroundColor: themeColors.background }]}>
                <Host matchContents={{ vertical: true }} colorScheme={isDark ? 'dark' : 'light'}>
                    <HStack modifiers={[padding({ horizontal: 20, vertical: 16 })]}>
                        <Text modifiers={[font({ size: 20, weight: 'bold' })]}>{t("Station Brands")}</Text>
                        <Spacer />
                        <Button label={t("Done")} onPress={onClose} />
                    </HStack>
                </Host>
                {visible ? <BrandPreferences {...preferences} isDark={isDark} themeColors={themeColors} isActive={visible} /> : null}
            </View>
        </Modal>
    );
}
const styles = StyleSheet.create({ sheet: { flex: 1 } });
