import React from 'react';
import { Image, StyleSheet } from 'react-native';

const FUEL_UP_LOGO_DARK = require('../../assets/FuelUp-text-logo-dark.png');
const FUEL_UP_LOGO_LIGHT = require('../../assets/FuelUp-text-logo-light.png');

export const FUEL_UP_HEADER_LOGO_WIDTH = 132;
export const FUEL_UP_HEADER_LOGO_HEIGHT = 38;

export default function FuelUpHeaderLogo({ isDark, style }) {
    return (
        <Image
            source={isDark ? FUEL_UP_LOGO_DARK : FUEL_UP_LOGO_LIGHT}
            resizeMode="contain"
            accessibilityRole="image"
            accessibilityLabel="Fuel Up"
            style={[styles.logo, style]}
        />
    );
}

const styles = StyleSheet.create({
    logo: {
        width: FUEL_UP_HEADER_LOGO_WIDTH,
        height: FUEL_UP_HEADER_LOGO_HEIGHT,
    },
});
