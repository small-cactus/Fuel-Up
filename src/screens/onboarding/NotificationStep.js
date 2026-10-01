import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { SymbolView } from 'expo-symbols';
import LiveActivityPreview from './LiveActivityPreview';
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
                    <LiveActivityPreview />
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

});
