import React, { memo } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GlassView } from 'expo-glass-effect';

function ResetToCheapestButton({
    disabled = false,
    glassTintColor,
    isDark,
    onPress,
    themeColors,
}) {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel="Reset to cheapest"
            disabled={disabled}
            onPress={onPress}
            style={({ pressed }) => [
                styles.pressable,
                pressed && !disabled ? styles.pressablePressed : null,
            ]}
        >
            <GlassView
                style={[
                    styles.button,
                    disabled ? styles.buttonDisabled : null,
                ]}
                tintColor={glassTintColor ?? (isDark ? '#101010ff' : '#FFFFFF')}
                glassEffectStyle="clear"
            >
                <Ionicons color={themeColors.text} name="arrow-undo" size={14} />
                <Text style={[styles.label, { color: themeColors.text }]}>Reset to Cheapest</Text>
            </GlassView>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    pressable: {
        borderRadius: 15,
    },
    pressablePressed: {
        opacity: 0.92,
    },
    button: {
        minHeight: 30,
        paddingHorizontal: 13,
        borderRadius: 15,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7,
    },
    buttonDisabled: {
        opacity: 0.7,
    },
    label: {
        fontSize: 11,
        fontWeight: '700',
    },
});

export default memo(ResetToCheapestButton);
