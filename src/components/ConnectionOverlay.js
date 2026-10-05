import React, { useEffect } from 'react';
import { AppState, ScrollView, StyleSheet, Text, View } from 'react-native';
import { GlassView } from 'expo-glass-effect';
import ConnectionBlur from './ConnectionBlur';
import { SymbolView } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../ThemeContext';
import useNetworkStatus from '../lib/useNetworkStatus';
import { networkStatus } from '../lib/networkStatus';

const STATUS_LABELS = { responding: 'Responding', unresponsive: 'Not responding', unknown: 'Not checked' };

// Mount last inside any screen's full-size root. Navigation outside that screen
// stays available. An explicit status prop also supports previews/other monitors.
export default function ConnectionOverlay({ status: suppliedStatus, active = true, loadingServiceIds, style }) {
    const observedStatus = useNetworkStatus();
    const status = suppliedStatus || observedStatus;
    const { isDark, themeColors } = useTheme();
    const insets = useSafeAreaInsets();
    const offline = status.connected === false;
    const outage = status.services.some(service => service.status === 'unresponsive');
    const pending = status.services.filter(service => !loadingServiceIds || loadingServiceIds.includes(service.id))
        .map(service => service.pending).filter(Boolean).sort((a, b) => a.deadlineAt - b.deadlineAt)[0];
    const failed = offline || outage;
    useEffect(() => {
        if (!active || !outage || offline || suppliedStatus) return;
        const retry = () => { if (AppState.currentState === 'active') void networkStatus.retryFailedReads(); };
        const timer = setInterval(retry, 30000);
        const subscription = AppState.addEventListener('change', state => { if (state === 'active') retry(); });
        return () => { clearInterval(timer); subscription.remove(); };
    }, [active, outage, offline, suppliedStatus]);
    if (!active || (!failed && !pending)) return null;
    return <View style={[styles.overlay, style]} pointerEvents={failed ? 'auto' : 'none'} accessibilityViewIsModal={failed} testID="connection-overlay">
        <ConnectionBlur pending={pending} failed={failed} isDark={isDark} />
        {failed && <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 36, paddingBottom: insets.bottom + 36 }]}>
            <SymbolView name={offline ? 'wifi.slash' : 'exclamationmark.icloud'} size={58} tintColor={themeColors.text} />
            <Text accessibilityRole="header" style={[styles.title, { color: themeColors.text }]}>{offline ? 'No internet connection' : 'Fuel Up servers are having an outage'}</Text>
            <GlassView glassEffectStyle="regular" style={styles.messageGlass}>
            <Text style={[styles.message, { color: themeColors.textOpacity }]}>{offline
                ? 'Connect to Wi-Fi or cellular to get the latest fuel prices.'
                : 'A fix is already underway. Functionality should be restored in less than 20 minutes.'}</Text>
            </GlassView>
            {!offline && <GlassView glassEffectStyle="regular" style={styles.services}>
                {status.services.map(service => <View key={service.id} style={styles.service}>
                    <Text style={[styles.serviceName, { color: themeColors.text }]}>{service.name}</Text>
                    <Text style={[styles.serviceStatus, { color: themeColors.textOpacity }]}>{STATUS_LABELS[service.status] || STATUS_LABELS.unknown}</Text>
                </View>)}
            </GlassView>}

        </ScrollView>}
    </View>;
}
const styles = StyleSheet.create({
    overlay: { ...StyleSheet.absoluteFillObject, zIndex: 20 },
    content: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 28, gap: 20 },
    title: { fontSize: 27, fontWeight: '700', textAlign: 'center', maxWidth: 420 },
    message: { fontSize: 17, lineHeight: 25, textAlign: 'center', maxWidth: 420 },
    services: { width: '100%', maxWidth: 420, gap: 14, padding: 20, borderRadius: 24, overflow: 'hidden' },
    service: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 6 },
    serviceName: { fontSize: 15, fontWeight: '600', flexShrink: 1 },
    serviceStatus: { fontSize: 15 },
    messageGlass: { width: '100%', maxWidth: 420, padding: 20, borderRadius: 24, overflow: 'hidden' },
});
