import { t, languageName } from '../../localization';
/**
 * Native SwiftUI settings form, hosted inside a React Native tab screen.
 *
 * This component renders the Settings page using Apple's real Settings-app
 * primitives (`Form`, `Section`, `LabeledContent`, `Picker`, `Slider`,
 * `Button`, `Label`) via `@expo/ui/swift-ui`. The result is a 1:1 native
 * iOS look — native row chevrons, native segmented controls, native
 * section headers, native destructive button styling, and automatic
 * dark/light theming from the OS color scheme.
 *
 * The callbacks marshal state changes back across the React Native bridge
 * so the existing preferences/theme/reset state machinery does not have
 * to change. This keeps the native look cleanly separated from the app's
 * state plumbing.
 */

import { GlassForm as Form, GlassSection as Section } from '../../../modules/fuel-up-glass';
import React from 'react';
import { Linking } from 'react-native';
import { nativeResearchOwnsTracking } from '../../lib/drivingResearchPolicy';
import {
    Button,
    Host,
    HStack,
    Image,
    Label,
    LabeledContent,
    Picker,
    Slider,
    Text,
} from '@expo/ui/swift-ui';
import {
    font,
    foregroundStyle,
    tag,
} from '@expo/ui/swift-ui/modifiers';
import { getFuelGradeMeta } from '../../lib/fuelGrade';
import {
    MAX_SEARCH_RADIUS_MILES,
    MIN_SEARCH_RADIUS_MILES,
} from '../../lib/fuelSearchState';

const APPEARANCE_OPTIONS = [
    { key: 'light', label: 'Light' },
    { key: 'system', label: 'System' },
    { key: 'dark', label: 'Dark' },
];

const NAVIGATION_APP_OPTIONS = [
    { key: 'apple-maps', label: 'Apple Maps' },
    { key: 'google-maps', label: 'Google Maps' },
];

function formatRadiusValue(miles) {
    return `${Math.round(miles)} mi`;
}

export default function NativeSettingsForm({
    isDark,
    // Preferences
    searchRadiusMiles,
    preferredOctane,
    onRadiusChange,
    onEditFuel,
    requiresE85,
    preferredBrands = [],
    fuelMemberships = [],
    onEditPreferredBrands,
    // Navigation
    navigationApp,
    onNavigationAppChange,
    // Appearance
    themeMode,
    onThemeModeChange,
    // Tracking
    trackingReady,
    onReviewTracking,
    onDrivingResearch,
    // Data actions
    onResetFuelCache,
    onResetOnboarding,
    // Header info shown in the first section
    trackingFooterCopy,
}) {
    return (
        <Host
            style={{ flex: 1 }}
            colorScheme={isDark ? 'dark' : 'light'}
            useViewportSizeMeasurement
            ignoreSafeArea="all"
        >
            <Form>
                <Section title={t("Fuel Preferences")}>
                    <LabeledContent
                        label={(
                            <Label title={t("Search Radius")} systemImage="location.magnifyingglass" />
                        )}
                    >
                        <Text
                            modifiers={[
                                font({ size: 17, weight: 'semibold', design: 'rounded' }),
                                foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
                            ]}
                        >
                            {formatRadiusValue(searchRadiusMiles)}
                        </Text>
                    </LabeledContent>

                    <Slider
                        value={Number(searchRadiusMiles) || MIN_SEARCH_RADIUS_MILES}
                        min={MIN_SEARCH_RADIUS_MILES}
                        max={MAX_SEARCH_RADIUS_MILES}
                        step={1}
                        minimumValueLabel={(
                            <Text
                                modifiers={[
                                    font({ size: 12, design: 'rounded' }),
                                    foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
                                ]}
                            >
                                {`${MIN_SEARCH_RADIUS_MILES} mi`}
                            </Text>
                        )}
                        maximumValueLabel={(
                            <Text
                                modifiers={[
                                    font({ size: 12, design: 'rounded' }),
                                    foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
                                ]}
                            >
                                {`${MAX_SEARCH_RADIUS_MILES} mi`}
                            </Text>
                        )}
                        onValueChange={value => {
                            const rounded = Math.round(value);
                            if (typeof onRadiusChange === 'function') {
                                onRadiusChange(rounded);
                            }
                        }}
                    />

                    <SettingsLink title={t("Fuel Type")} systemImage="gauge.with.dots.needle.33percent"
                        value={`${t(getFuelGradeMeta(preferredOctane).label)}${requiresE85 && preferredOctane !== 'e85' ? ' + E85' : ''}`}
                        onPress={onEditFuel} testID="settings-fuel-type" />
                    <SettingsLink title={t("Station Brands")} systemImage="heart"
                        value={fuelMemberships.length + preferredBrands.length ? t('{count} selected', { count: fuelMemberships.length + preferredBrands.length }) : undefined}
                        onPress={onEditPreferredBrands} testID="settings-preferred-brands" />
                </Section>

                <Section title={t("Navigation")}>
                    <Picker
                        label={t("Map App")}
                        systemImage="map.fill"
                        selection={navigationApp}
                        onSelectionChange={selection => {
                            if (typeof onNavigationAppChange === 'function') {
                                onNavigationAppChange(selection);
                            }
                        }}
                    >
                        {NAVIGATION_APP_OPTIONS.map(option => (
                            <Text key={option.key} modifiers={[tag(option.key)]}>
                                {t(option.label)}
                            </Text>
                        ))}
                    </Picker>
                </Section>

                <Section title={t("Appearance")}>
                    <SettingsLink title={t("Language")} systemImage="globe" value={languageName}
                        onPress={() => Linking.openSettings()} testID="settings-language" />
                    <Picker
                        label={t("Theme")}
                        systemImage={isDark ? 'moon.stars.fill' : 'sun.max.fill'}
                        selection={themeMode}
                        onSelectionChange={selection => {
                            if (typeof onThemeModeChange === 'function') {
                                onThemeModeChange(selection);
                            }
                        }}
                    >
                        {APPEARANCE_OPTIONS.map(option => (
                            <Text key={option.key} modifiers={[tag(option.key)]}>
                                {t(option.label)}
                            </Text>
                        ))}
                    </Picker>
                </Section>

                {!nativeResearchOwnsTracking() && <Section
                    title="Predictive Tracking"
                    footer={
                        <Text
                            modifiers={[
                                font({ size: 12 }),
                                foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
                            ]}
                        >
                            {trackingFooterCopy}
                        </Text>
                    }
                >
                    <Button
                        systemImage={trackingReady ? 'location.fill.viewfinder' : 'location.badge.clock'}
                        onPress={() => {
                            if (typeof onReviewTracking === 'function') {
                                onReviewTracking();
                            }
                        }}
                        label={trackingReady ? 'Review Tracking Permissions' : 'Enable Predictive Tracking'}
                    />
                </Section>}

                <Section title={t("Research & Debug")}>
                    <SettingsLink title={t("Driving Research")} systemImage="person.2.fill"
                        onPress={onDrivingResearch} testID="settings-driving-research" />
                </Section>

                <Section title={t("Data")}>
                    <Button
                        role="destructive"
                        systemImage="arrow.counterclockwise"
                        onPress={() => {
                            if (typeof onResetFuelCache === 'function') {
                                onResetFuelCache();
                            }
                        }}
                        label={t("Refresh Gas Prices")}
                    />
                    <Button
                        systemImage="arrow.uturn.backward"
                        onPress={() => {
                            if (typeof onResetOnboarding === 'function') {
                                onResetOnboarding();
                            }
                        }}
                        label={t("Show Setup Again")}
                    />
                </Section>
            </Form>
        </Host>
    );
}

// A native row opens an Expo Router native-stack page.
function SettingsLink({ title, systemImage, value, onPress, testID }) {
    return <Button onPress={onPress} testID={testID}>
        <LabeledContent label={<Label title={title} systemImage={systemImage} />}>
            <HStack spacing={8}>
                {value ? <Text modifiers={[foregroundStyle({ type: 'hierarchical', style: 'secondary' })]}>{value}</Text> : null}
                <Image systemName="chevron.right" size={13}
                    modifiers={[foregroundStyle({ type: 'hierarchical', style: 'tertiary' })]} />
            </HStack>
        </LabeledContent>
    </Button>;
}
