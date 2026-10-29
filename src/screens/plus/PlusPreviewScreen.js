import React from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Host, Button, Image } from '@expo/ui/swift-ui';
import { accessibilityLabel, buttonStyle, controlSize, frame } from '@expo/ui/swift-ui/modifiers';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../ThemeContext';
import Text from './PaywallText';
import GlassActionButton from '../../components/native/GlassActionButton';
import { SuperSaverBackground, SuperSaverWordmark } from './SuperSaverSurface';
import { PLUS_ANNUAL_PRICE, PLUS_FEATURES, plusPalette } from './presentation';

export default function PlusPreviewScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { isDark, themeColors } = useTheme();
    const { height, width, fontScale } = useWindowDimensions();
    const colors = plusPalette(isDark);
    const inlinePurchase = height < 720 || fontScale > 1.3;
    const close = () => router.canGoBack() ? router.back() : router.replace('/(tabs)/settings');
    const previewPurchase = () => Alert.alert('Preview only', 'Fuel Up Super Saver is $19.99 per year in this mockup. No payment will be taken and no subscription or alerts will be activated.', [{ text: 'Got it' }]);
    const openLink = url => Linking.openURL(url).catch(() => Alert.alert('Unable to open link', 'Please try again.'));
    const purchase = <View style={[styles.purchase, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <View style={styles.plan} accessible accessibilityLabel="19 dollars and 99 cents per year. Renews yearly. Cancel anytime.">
            <Text style={[styles.amount, { color: themeColors.text }]}>{PLUS_ANNUAL_PRICE}<Text style={[styles.period, { color: colors.secondary }]}> / year</Text></Text>
            <Text style={[styles.renewal, { color: colors.secondary }]}>Renews yearly. Cancel anytime.</Text>
        </View>
        <GlassActionButton key={fontScale} title="Continue" prominent fullWidth
            tintColor={colors.button} isDark={isDark} onPress={previewPurchase}
            hint="Opens a preview confirmation. No purchase will be made." testID="plus-preview-continue" />
        <View style={styles.links}>
            <FooterLink label="Restore" color={colors.secondary} onPress={() => Alert.alert('Preview only', 'There are no purchases to restore in this design preview.')} />
            <FooterLink label="Terms" color={colors.secondary} onPress={() => openLink('https://www.apple.com/legal/internet-services/itunes/dev/stdeula/')} />
            <FooterLink label="Privacy" color={colors.secondary} onPress={() => openLink('https://sites.google.com/view/fuel-up-gas/home')} />
        </View>
    </View>;

    return <View style={[styles.screen, { backgroundColor: themeColors.background, paddingTop: insets.top }]}>
        <SuperSaverBackground isDark={isDark} />
        <View style={styles.topBar}>
            <Host colorScheme={isDark ? 'dark' : 'light'} matchContents ignoreSafeArea="all">
                <Button onPress={close} testID="plus-preview-close" modifiers={[buttonStyle('glass'), controlSize('regular'), frame({ minWidth: 44, minHeight: 44 }), accessibilityLabel('Close preview')]}>
                    <Image systemName="xmark" size={15} color={themeColors.text} />
                </Button>
            </Host>
        </View>
        <ScrollView key={fontScale} style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View style={[styles.story, inlinePurchase && { paddingVertical: 40 }]}>
                <View style={styles.hero}>
                    <SuperSaverWordmark width={Math.min(width - 100, 258)} />
                    <Text accessibilityRole="header" style={[styles.title, { color: themeColors.text }]}>Super Saver</Text>
                </View>
                <View style={styles.features}>
                    {PLUS_FEATURES.map(feature => <View style={styles.feature} key={feature.title} accessible accessibilityLabel={feature.title}>
                        <View style={styles.featureIcon} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                            <SymbolView name={feature.icon} size={22} tintColor={colors.accent} />
                        </View>
                        <Text style={[styles.featureTitle, { color: themeColors.text }]}>{feature.title}</Text>
                    </View>)}
                </View>
            </View>
            {inlinePurchase && purchase}
        </ScrollView>
        {!inlinePurchase && purchase}
    </View>;
}

function FooterLink({ label, color, onPress }) {
    return <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.link, { opacity: pressed ? 0.5 : 1 }]}>
        <Text style={{ color, fontSize: 12 }}>{label}</Text>
    </Pressable>;
}

const styles = StyleSheet.create({
    screen: { flex: 1 },
    topBar: { paddingHorizontal: 24, paddingVertical: 4, flexDirection: 'row', justifyContent: 'flex-end', width: '100%', maxWidth: 520, alignSelf: 'center' },
    scroll: { flex: 1 },
    content: { flexGrow: 1 },
    story: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 30, paddingBottom: 36, width: '100%', maxWidth: 480, alignSelf: 'center', gap: 56 },
    hero: { alignItems: 'center', gap: 12 },
    title: { fontSize: 40, fontWeight: '700', letterSpacing: -1.6, textAlign: 'center' },
    features: { gap: 25, alignSelf: 'center', maxWidth: '100%' },
    feature: { flexDirection: 'row', gap: 16, alignItems: 'center' },
    featureIcon: { width: 27, alignItems: 'center' },
    featureTitle: { flexShrink: 1, fontSize: 17, fontWeight: '500', letterSpacing: -0.25 },
    purchase: { paddingHorizontal: 28, paddingTop: 12, width: '100%', maxWidth: 480, alignSelf: 'center' },
    plan: { alignItems: 'center', marginBottom: 22, gap: 6 },
    amount: { fontSize: 30, fontWeight: '600', letterSpacing: -0.8 },
    period: { fontSize: 17, fontWeight: '400', letterSpacing: 0 },
    renewal: { fontSize: 12 },
    links: { flexDirection: 'row', justifyContent: 'center', marginTop: 6, gap: 16 },
    link: { minHeight: 44, minWidth: 60, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 8 },
});
