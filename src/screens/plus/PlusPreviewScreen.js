import React from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Host, Button, Image } from '@expo/ui/swift-ui';
import { accessibilityLabel, buttonStyle, controlSize, frame } from '@expo/ui/swift-ui/modifiers';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../ThemeContext';
import FuelUpHeaderLogo from '../../components/FuelUpHeaderLogo';
import GlassActionButton from '../../components/native/GlassActionButton';
import PriceAlertIllustration from './PriceAlertIllustration';
import { PLUS_ANNUAL_PRICE, PLUS_FEATURES, plusPalette } from './presentation';

export default function PlusPreviewScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { isDark, themeColors } = useTheme();
    const { height, fontScale } = useWindowDimensions();
    const colors = plusPalette(isDark);
    const inlinePurchase = height < 720 || fontScale > 1.3;
    const compact = height < 860 && !inlinePurchase;
    const close = () => router.canGoBack() ? router.back() : router.replace('/(tabs)/settings');
    const previewPurchase = () => Alert.alert('You’re viewing a preview', 'This is a design preview of Fuel Up Plus at $19.99 per year. No payment will be taken and no subscription or alerts will be activated.', [{ text: 'Got it' }]);
    const openLink = url => Linking.openURL(url).catch(() => Alert.alert('Unable to open link', 'Please try again.'));
    const purchase = <View style={[styles.purchase, { backgroundColor: themeColors.background, paddingBottom: Math.max(insets.bottom, 16) }]}>
        <View style={styles.plan} accessible accessibilityLabel="Annual plan. 19 dollars and 99 cents per year. Renews yearly. Cancel anytime.">
            <Text style={[styles.planName, { color: themeColors.text }]}>One year. All three.</Text>
            <Text style={[styles.amount, { color: themeColors.text }]}>{PLUS_ANNUAL_PRICE}<Text style={[styles.period, { color: colors.secondary }]}> / year</Text></Text>
            <Text style={[styles.renewal, { color: colors.secondary }]}>Renews yearly. Cancel anytime.</Text>
        </View>
        <GlassActionButton title="Continue with Plus" icon="arrow.right" prominent fullWidth
            tintColor={colors.button} isDark={isDark} onPress={previewPurchase}
            hint="Opens a preview confirmation. No purchase will be made." testID="plus-preview-continue" />
        <View style={styles.links}>
            <FooterLink label="Restore" color={colors.secondary} onPress={() => Alert.alert('Preview only', 'There are no purchases to restore in this design preview.')} />
            <FooterLink label="Terms" color={colors.secondary} onPress={() => openLink('https://www.apple.com/legal/internet-services/itunes/dev/stdeula/')} />
            <FooterLink label="Privacy" color={colors.secondary} onPress={() => openLink('https://sites.google.com/view/fuel-up-gas/home')} />
        </View>
    </View>;

    return <View style={[styles.screen, { backgroundColor: themeColors.background, paddingTop: insets.top }]}>
        <View style={styles.topBar}>
            <View style={styles.brand}>
                <FuelUpHeaderLogo isDark={isDark} style={{ width: 98, height: 30 }} />
                <Text style={[styles.plus, { color: colors.accent }]}>PLUS</Text>
            </View>
            <Host colorScheme={isDark ? 'dark' : 'light'} matchContents ignoreSafeArea="all">
                <Button onPress={close} testID="plus-preview-close" modifiers={[buttonStyle('glass'), controlSize('regular'), frame({ minWidth: 44, minHeight: 44 }), accessibilityLabel('Close preview')]}>
                    <Image systemName="xmark" size={15} color={themeColors.text} />
                </Button>
            </Host>
        </View>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View style={styles.story}>
                <Text style={[styles.preview, { color: colors.secondary }]}>DESIGN PREVIEW</Text>
                <Text accessibilityRole="header" style={[styles.title, compact && { fontSize: 28, lineHeight: 31 }, { color: themeColors.text }]}>A little heads-up.{'\n'}A better fill-up.</Text>
                <Text style={[styles.subtitle, { color: colors.secondary }]}>Your next stop, a little smarter.</Text>
                <View style={[styles.art, compact && { marginTop: 14, marginBottom: 16 }]}><PriceAlertIllustration compact={compact} isDark={isDark} textColor={themeColors.text} /></View>
                <View style={[styles.features, compact && { gap: 12 }]}>
                    {PLUS_FEATURES.map(feature => <View style={styles.feature} key={feature.title} accessible accessibilityLabel={`${feature.title}. ${feature.detail}`}>
                        <View style={[styles.featureIcon, { backgroundColor: colors.surface }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                            <SymbolView name={feature.icon} size={22} tintColor={colors.accent} />
                        </View>
                        <View style={styles.featureCopy}>
                            <Text style={[styles.featureTitle, compact && { fontSize: 15 }, { color: themeColors.text }]}>{feature.title}</Text>
                            <Text style={[styles.featureDetail, compact && { fontSize: 12, lineHeight: 16 }, { color: colors.secondary }]}>{feature.detail}</Text>
                        </View>
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
    topBar: { paddingHorizontal: 24, paddingTop: 4, paddingBottom: 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', maxWidth: 520, alignSelf: 'center' },
    brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    plus: { fontSize: 11, fontWeight: '800', letterSpacing: 2 },
    scroll: { flex: 1 },
    content: { flexGrow: 1 },
    story: { paddingHorizontal: 28, paddingTop: 8, paddingBottom: 16, width: '100%', maxWidth: 520, alignSelf: 'center' },
    preview: { fontSize: 10, fontWeight: '600', letterSpacing: 1.5, textAlign: 'center', marginBottom: 8 },
    title: { fontSize: 33, fontWeight: '700', letterSpacing: -1.1, lineHeight: 37, textAlign: 'center' },
    subtitle: { fontSize: 15, textAlign: 'center', marginTop: 10 },
    art: { marginTop: 20, marginBottom: 24 },
    features: { gap: 18 },
    feature: { flexDirection: 'row', gap: 14, alignItems: 'center' },
    featureIcon: { width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
    featureCopy: { flex: 1, gap: 3 },
    featureTitle: { fontSize: 16, fontWeight: '600', letterSpacing: -0.2 },
    featureDetail: { fontSize: 13, lineHeight: 18 },
    purchase: { paddingHorizontal: 28, paddingTop: 12, width: '100%', maxWidth: 520, alignSelf: 'center' },
    plan: { alignItems: 'center', marginBottom: 16, gap: 4 },
    planName: { fontSize: 14, fontWeight: '600' },
    amount: { fontSize: 30, fontWeight: '700', letterSpacing: -0.6 },
    period: { fontSize: 16, fontWeight: '400', letterSpacing: 0 },
    renewal: { fontSize: 12 },
    links: { flexDirection: 'row', justifyContent: 'center', marginTop: 4, gap: 8 },
    link: { minHeight: 44, minWidth: 60, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 8 },
});
