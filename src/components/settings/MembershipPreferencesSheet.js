import React from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { Button, Host, HStack, Spacer, Text } from '@expo/ui/swift-ui';
import { font, padding } from '@expo/ui/swift-ui/modifiers';
import MembershipPreferences from '../memberships/MembershipPreferences';

export default function MembershipPreferencesSheet({ visible, onClose, isDark, themeColors, ...preferences }) {
    return (
        <Modal visible={visible} animationType="slide" presentationStyle="pageSheet"
            allowSwipeDismissal onRequestClose={onClose} onDismiss={onClose}>
            <View style={[styles.sheet, { backgroundColor: themeColors.background }]}>
                <Host matchContents={{ vertical: true }} colorScheme={isDark ? 'dark' : 'light'}>
                    <HStack modifiers={[padding({ horizontal: 20, vertical: 16 })]}>
                        <Text modifiers={[font({ size: 20, weight: 'bold' })]}>Gas Memberships</Text>
                        <Spacer />
                        <Button label="Done" onPress={onClose} />
                    </HStack>
                </Host>
                {visible ? <MembershipPreferences {...preferences} isDark={isDark} themeColors={themeColors} isActive={visible} /> : null}
            </View>
        </Modal>
    );
}
const styles = StyleSheet.create({ sheet: { flex: 1 } });
