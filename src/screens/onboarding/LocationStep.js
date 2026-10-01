import NativeGlassContainer from '../../components/native/NativeGlassContainer';
import { hasPredictiveLocationAccess, getLocationStatusCopy } from './locationCopy.js';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { SCREEN_WIDTH } from './presentation.js';

export function LocationStep({ isDark, themeColors, insets, permissionState }) {
    const highlights = [
        { icon: 'location.magnifyingglass', text: 'Automatically find stations around you' },
        { icon: 'shield.checkered', text: 'Your location is used to find nearby fuel prices' },
        { icon: 'sparkles', text: 'Predictive Fueling needs Always Allow to predict when and where you fuel' },
        { icon: 'cpu', text: 'Driving predictions happen on your device' },
    ];
    const hasFullAccess = hasPredictiveLocationAccess(permissionState);
    const statusCopy = getLocationStatusCopy(permissionState);

    return (
        <ScrollView testID="onboarding-location" style={[styles.stepContainer, { backgroundColor: themeColors.background }]} contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false}>

            <View style={[styles.stepHeader, { paddingTop: insets.top + 40 }]}>
                <SymbolView name="location.fill" size={44} tintColor="#007AFF" />
                <Text style={[styles.stepTitle, { color: themeColors.text }]}>Enable Location</Text>
                <Text style={[styles.stepSubtitle, { color: themeColors.text }]}>
                    To find the absolute cheapest gas, we need to know where you are.
                </Text>
            </View>

            <View style={[styles.stepContent, { justifyContent: 'flex-start', marginTop: 32 }]}>
                <View style={styles.locationHighlightsContainer}>
                    {highlights.map((item, index) => (
                        <View key={index} style={styles.locationHighlightItem}>
                            <NativeGlassContainer colorScheme={isDark ? 'dark' : 'light'} style={[styles.locationHighlightIconContainer, { backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)' }]}>
                                <SymbolView name={item.icon} size={24} tintColor="#007AFF" />
                            </NativeGlassContainer>
                            <Text style={[styles.locationHighlightText, { color: themeColors.text }]}>
                                {item.text}
                            </Text>
                        </View>
                    ))}
                </View>

                <NativeGlassContainer
                    colorScheme={isDark ? 'dark' : 'light'}
                    style={[
                        styles.grantedRow,
                        {
                            backgroundColor: hasFullAccess
                                ? (isDark ? 'rgba(52,199,89,0.22)' : 'rgba(52,199,89,0.14)')
                                : (isDark ? 'rgba(10,132,255,0.2)' : 'rgba(10,132,255,0.1)'),
                        },
                    ]}
                >
                    <SymbolView
                        name={hasFullAccess ? 'checkmark.circle.fill' : 'location.circle.fill'}
                        size={18}
                        tintColor={hasFullAccess ? '#34C759' : '#007AFF'}
                    />
                    <Text style={[styles.grantedText, { color: themeColors.text }]}>{statusCopy}</Text>
                </NativeGlassContainer>
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
  stepContainer: {
    width: SCREEN_WIDTH,
    flex: 1,
    backgroundColor: 'transparent' // Default to transparent as children will provide it or parent will
  },
  stepHeader: {
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 24
  },
  stepContent: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 24
  },
  // Steps shared
  stepTitle: {
    fontSize: 28,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: -0.3,
    fontFamily: 'ui-rounded'
  },
  stepSubtitle: {
    fontSize: 16,
    opacity: 0.6,
    textAlign: 'center',
    maxWidth: 300,
    lineHeight: 22
  },
  // Location
  locationHighlightsContainer: {
    width: '100%',
    gap: 20
  },
  locationHighlightItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 12
  },
  locationHighlightIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center'
  },
  locationHighlightText: {
    fontSize: 16,
    fontWeight: '500',
    flex: 1,
    lineHeight: 22
  },
  grantedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(0, 122, 255, 0.1)',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 100
  },
  grantedText: {
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
    lineHeight: 21
  }
});
