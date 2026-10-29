import React from 'react';
import { Image, Platform, StyleSheet, View } from 'react-native';
import { requireNativeView } from 'expo';
import MaskedView from '@react-native-masked-view/masked-view';
import { useIsFocused } from '@react-navigation/native';
import { FUEL_UP_HEADER_LOGO_WIDTH, FUEL_UP_HEADER_LOGO_HEIGHT } from '../../components/FuelUpHeaderLogo';

const MetalSurface = Platform.OS === 'ios' ? requireNativeView('FuelUpGlass', 'SuperSaverMetalView') : View;
const CloseView = Platform.OS === 'ios' ? requireNativeView('FuelUpGlass', 'SaverCloseView') : View;
export function SaverSurface({ isDark, effect = 0, style, glyphText, glyphFontSize, hdrBrand = false }) {
    const active = useIsFocused();
    return <MetalSurface active={active} isDark={isDark} effect={effect} hdrBrand={hdrBrand} glyphText={glyphText} glyphFontSize={glyphFontSize} style={style} />;
}

export function SuperSaverBackground({ isDark }) {
    return <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
        <SaverSurface isDark={isDark} style={StyleSheet.absoluteFill} />
    </View>;
}
export function SuperSaverWordmark({ isDark }) {
    const size = { width: FUEL_UP_HEADER_LOGO_WIDTH, height: FUEL_UP_HEADER_LOGO_HEIGHT };
    return <View accessible accessibilityRole="image" accessibilityLabel="Fuel Up" style={size}>
        <MaskedView style={size} maskElement={<Image source={require('../../../assets/FuelUp-text-logo-dark.png')} resizeMode="contain" style={size} />}>
            <SaverSurface effect={1} hdrBrand isDark={isDark} style={[size, { backgroundColor: '#F78C16' }]} />
        </MaskedView>
    </View>;
}
export function LitMetalText({ text, width, height, fontSize, isDark, role = 'header', hdrBrand = false }) {
    const size = { width, height };
    return <View accessible accessibilityRole={role} accessibilityLabel={text} style={size}>
        <SaverSurface effect={2} hdrBrand={hdrBrand} isDark={isDark} glyphText={text} glyphFontSize={fontSize} style={size} />
    </View>;
}
export function SaverCloseButton({ isDark, onPress }) {
    return <CloseView isDark={isDark} onClose={onPress} style={{ width: 44, height: 44 }} />;
}
