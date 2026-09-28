import { ScrollView, View, Text, Image, StyleSheet } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { LiquidGlassView as GlassView } from '@callstack/liquid-glass';
import { SCREEN_WIDTH } from './presentation.js';

export function NotificationStep({ isDark, themeColors, insets, permissionStatus }) {
    const highlights = [
        { icon: 'bell.slash.fill', text: 'We will rarely send you notifications' },
        { icon: 'hourglass.bottomhalf.filled', text: 'Live Activities for your Dynamic Island, Lock Screen, and CarPlay' },
        { icon: 'exclamationmark.shield.fill', text: 'Alerts when you\'re about to get a bad deal at a gas station' },
    ];

    return (
        <ScrollView testID="onboarding-notifications" style={[styles.stepContainer, { backgroundColor: themeColors.background }]} contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false}>

            <View style={[styles.stepHeader, { paddingTop: insets.top + 40 }]}>
                <SymbolView name="bell.badge.fill" size={44} tintColor="#FF3B30" />
                <Text style={[styles.stepTitle, { color: themeColors.text }]}>Allow Live Activities</Text>
                <Text style={[styles.stepSubtitle, { color: themeColors.text }]}>
                    We'll identify when you're about to get a bad deal, and we'll redirect you in real time.
                </Text>
            </View>

            <View style={[styles.stepContent, { gap: 24, justifyContent: 'flex-start', marginTop: 32 }]}>
                <View style={styles.mockLiveActivityContainer}>
                    <GlassView
                        effect="regular"
                        tintColor="#000000"
                        style={styles.mockLiveActivityGlass}
                    >
                        <View style={styles.mockLiveActivityHeader}>
                            <View style={styles.mockLiveActivityAppIcon}>
                                <Image
                                    source={require('../../../assets/predictive-fueling.png')}
                                    style={{ width: 22, height: 22, borderRadius: 5 }}
                                    resizeMode="contain"
                                />
                            </View>
                            <Text style={[styles.mockLiveActivityTitle, { color: '#FFFFFF' }]}>Predictive Fueling</Text>
                            <Text style={[styles.mockLiveActivityTime, { color: '#FFFFFF', opacity: 0.5 }]}>now</Text>
                        </View>

                        <View style={styles.mockLiveActivityContent}>
                            <View style={styles.mockLiveActivityMain}>
                                <View style={styles.mockLiveActivityStationInfo}>
                                    <Text style={[styles.mockLiveActivityStationName, { color: '#FFFFFF' }]}>Save $12.92 at Mobil One</Text>
                                    <View style={styles.mockLiveActivityBadge}>
                                        <Text style={styles.mockLiveActivityBadgeText}>on the way</Text>
                                    </View>
                                </View>
                                <View style={styles.mockLiveActivityPriceContainer}>
                                    <Text style={[styles.mockLiveActivityPriceLabel, { color: '#FFFFFF', opacity: 0.6 }]}>Regular</Text>
                                    <Text style={[styles.mockLiveActivityPrice, { color: '#00cb36ff' }]}>$2.62</Text>
                                </View>
                            </View>

                            <View style={[styles.mockLiveActivityDivider, { backgroundColor: 'rgba(255,255,255,0.1)' }]} />

                            <View style={styles.mockLiveActivityFooter}>
                                <SymbolView name="location.fill" size={12} tintColor="#FFFFFF" style={{ opacity: 0.6 }} />
                                <Text style={[styles.mockLiveActivityDistance, { color: '#FFFFFF', opacity: 0.6 }]}>0.4 mi away • Take Next Left</Text>
                            </View>
                        </View>
                    </GlassView>
                </View>

                <View style={[styles.locationHighlightsContainer, { paddingBottom: 0 }]}>
                    {highlights.map((item, index) => (
                        <View key={index} style={styles.locationHighlightItem}>
                            <View style={[styles.locationHighlightIconContainer, { backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)' }]}>
                                <SymbolView name={item.icon} size={24} tintColor="#FF3B30" />
                            </View>
                            <Text style={[styles.locationHighlightText, { color: themeColors.text }]}>
                                {item.text}
                            </Text>
                        </View>
                    ))}
                </View>
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
  // Mock Live Activity
  mockLiveActivityContainer: {
    width: SCREEN_WIDTH - 48,
    alignItems: 'center'
  },
  mockLiveActivityGlass: {
    width: '100%',
    borderRadius: 24,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 10
    },
    shadowOpacity: 0.1,
    shadowRadius: 200
  },
  mockLiveActivityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12
  },
  mockLiveActivityAppIcon: {
    marginRight: 8
  },
  mockLiveActivityTitle: {
    fontSize: 13,
    fontWeight: '600',
    flex: 1
  },
  mockLiveActivityTime: {
    fontSize: 12
  },
  mockLiveActivityContent: {
    gap: 12
  },
  mockLiveActivityMain: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  mockLiveActivityStationInfo: {
    gap: 4
  },
  mockLiveActivityStationName: {
    fontSize: 18,
    fontWeight: '700',
    fontFamily: 'ui-rounded'
  },
  mockLiveActivityBadge: {
    backgroundColor: 'rgba(0, 255, 47, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    alignSelf: 'flex-start'
  },
  mockLiveActivityBadgeText: {
    color: '#00C838',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase'
  },
  mockLiveActivityPriceContainer: {
    alignItems: 'flex-end'
  },
  mockLiveActivityPriceLabel: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase'
  },
  mockLiveActivityPrice: {
    fontSize: 24,
    fontWeight: '800',
    fontFamily: 'ui-rounded'
  },
  mockLiveActivityDivider: {
    height: 1,
    width: '100%'
  },
  mockLiveActivityFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6
  },
  mockLiveActivityDistance: {
    fontSize: 13,
    fontWeight: '500'
  }
});
