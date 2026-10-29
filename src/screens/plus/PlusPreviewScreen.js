import React from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useIsFocused } from '@react-navigation/native';
import Text from './PaywallText';
import SaverFeatureAccordion from './SaverFeatureAccordion';
import SaverPurchaseButton from './SaverPurchaseButton';
import { SaverCloseButton, LitMetalText, SuperSaverBackground, SuperSaverWordmark } from './SuperSaverSurface';
import { PLUS_ANNUAL_PRICE, plusPalette } from './presentation';

export default function PlusPreviewScreen() {
    return <PaywallContent />;
}

function PaywallContent() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const isDark = true;
    const themeColors = { background: '#303136', text: '#FFF7ED' };
    const focused = useIsFocused();
    const { height, width, fontScale } = useWindowDimensions();
    const colors = { ...plusPalette(isDark), secondary: '#CDC7BE' };
    const inlinePurchase = height < 720 || fontScale > 1.3;
    const close = () => router.canGoBack() ? router.back() : router.replace('/(tabs)/settings');
    const previewPurchase = () => Alert.alert('Preview only', 'Fuel Up Super Saver is $19.99 per year in this mockup. No payment will be taken and no subscription or alerts will be activated.', [{ text: 'Got it' }]);
    const openLink = url => Linking.openURL(url).catch(() => Alert.alert('Unable to open link', 'Please try again.'));
    const purchase = <View style={[styles.purchase, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <View style={styles.plan} accessible accessibilityLabel="19 dollars and 99 cents per year. Renews yearly. Cancel anytime.">
            <View style={styles.priceRow}><LitMetalText text={PLUS_ANNUAL_PRICE} width={162} height={48} fontSize={40} isDark={isDark} role="text" /><Text style={[styles.period, { color: colors.secondary }]}>/ year</Text></View>
            <Text style={[styles.renewal, { color: colors.secondary }]}>Renews yearly. Cancel anytime.</Text>
        </View>
        <SaverPurchaseButton isDark={isDark} onPress={previewPurchase} />
        <View style={styles.links}>
            <FooterLink label="Restore" color={colors.secondary} onPress={() => Alert.alert('Preview only', 'There are no purchases to restore in this design preview.')} />
            <FooterLink label="Terms" color={colors.secondary} onPress={() => openLink('https://www.apple.com/legal/internet-services/itunes/dev/stdeula/')} />
            <FooterLink label="Privacy" color={colors.secondary} onPress={() => openLink('https://sites.google.com/view/fuel-up-gas/home')} />
        </View>
    </View>;

    return <View style={[styles.screen, { backgroundColor: themeColors.background, paddingTop: insets.top }]}>
        {focused && <StatusBar style="light" />}
        <SuperSaverBackground isDark={isDark} />
        <View style={styles.topBar}>
            <SuperSaverWordmark isDark={isDark} />
            <View style={styles.close}><SaverCloseButton isDark={isDark} onPress={close} /></View>
        </View>
        <ScrollView key={fontScale} style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View style={[styles.story, inlinePurchase && { paddingVertical: 40 }]}>
                <View style={styles.hero}>
                    <LitMetalText text="Super Saver" hdrBrand width={Math.min(width - 56, 360)} height={60} fontSize={44} isDark={isDark} />
                </View>
                <SaverFeatureAccordion isDark={isDark} textColor={themeColors.text} />
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
    topBar: { height: 48, alignItems: 'center', width: '100%' },
    close: { position: 'absolute', right: 20, top: 0 },
    scroll: { flex: 1 },
    content: { flexGrow: 1 },
    story: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingBottom: 16, width: '100%', maxWidth: 480, alignSelf: 'center', gap: 18 },
    hero: { alignItems: 'center', gap: 12 },
    purchase: { paddingHorizontal: 28, paddingTop: 12, width: '100%', maxWidth: 480, alignSelf: 'center' },
    plan: { alignItems: 'center', marginBottom: 14, gap: 3 },
    priceRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 3 },
    period: { fontSize: 17, fontWeight: '400', letterSpacing: 0 },
    renewal: { fontSize: 12 },
    links: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginTop: 6, gap: 16 },
    link: { minHeight: 44, minWidth: 60, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 8 },
});
