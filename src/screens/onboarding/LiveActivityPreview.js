import { t } from '../../localization';
import React, { useEffect, useState } from 'react';
import { Platform, View, Text as RNText, useWindowDimensions } from 'react-native';
import { Asset } from 'expo-asset';
import { Host, VStack, HStack, Text, Image, Spacer, Divider } from '@expo/ui/swift-ui';
import { background, clipShape, fixedSize, font, foregroundStyle, frame, glassEffect, padding, resizable } from '@expo/ui/swift-ui/modifiers';

export default function LiveActivityPreview() {
    const { fontScale } = useWindowDimensions();
    const [icon, setIcon] = useState(null);
    useEffect(() => {
        let active = true;
        Asset.fromModule(require('../../../assets/predictive-fueling.png')).downloadAsync()
            .then(asset => { if (active) setIcon(asset.localUri); }).catch(() => {});
        return () => { active = false; };
    }, []);
    if (Platform.OS !== 'ios') return <View style={{ backgroundColor: '#252525', padding: 20, borderRadius: 24 }}>
        <RNText style={{ color: '#FFFFFF' }}>Predictive Fueling · Save $12.92 at Mobil One · $2.62</RNText>
    </View>;
    const text = (size, weight = 'medium', color = '#FFFFFF') => [font({ size: size * Math.min(fontScale, 2), weight }), foregroundStyle(color), fixedSize({ horizontal: false, vertical: true })];
    const Content = fontScale > 1.3 ? VStack : HStack;
    return <Host ignoreSafeArea="all" matchContents={{ vertical: true }} colorScheme="dark" style={{ width: '100%' }}>
        <VStack alignment="leading" spacing={12} modifiers={[fixedSize({ horizontal: false, vertical: true }), padding({ all: 16 }),
            glassEffect({ glass: { variant: 'regular', tint: '#000000' }, shape: 'roundedRectangle', cornerRadius: 24 })]}>
            <HStack spacing={8}>
                {icon ? <Image uiImage={icon} modifiers={[resizable(), frame({ width: 22, height: 22 }), clipShape('roundedRectangle', 5)]} /> : <Image systemName="fuelpump.fill" size={22} color="#FFFFFF" />}
                <Text modifiers={text(13, 'semibold')}>Predictive Fueling</Text><Spacer />
                <Text modifiers={text(12, 'regular', '#FFFFFF80')}>now</Text>
            </HStack>
            <Content alignment={fontScale > 1.3 ? 'leading' : 'center'} spacing={12}>
                <VStack alignment="leading" spacing={6}>
                    <Text modifiers={text(18, 'bold')}>Save $12.92 at Mobil One</Text>
                    <Text modifiers={[...text(11, 'bold', '#00CB36'), padding({ horizontal: 8, vertical: 3 }), background('#00CB3626'), clipShape('capsule')]}>on the way</Text>
                </VStack>
                {fontScale <= 1.3 && <Spacer />}
                <VStack alignment="trailing" spacing={2}>
                    <Text modifiers={text(11, 'semibold', '#FFFFFF99')}>{t("Regular")}</Text>
                    <Text modifiers={text(24, 'heavy', '#00CB36')}>$2.62</Text>
                </VStack>
            </Content>
            <Divider />
            <HStack spacing={6}><Image systemName="location.fill" size={12} color="#FFFFFF99" />
                <Text modifiers={text(13, 'medium', '#FFFFFF99')}>0.4 mi away • Take Next Left</Text>
            </HStack>
        </VStack>
    </Host>;
}
