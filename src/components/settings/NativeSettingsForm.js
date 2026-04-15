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

import React from 'react';
import {
    Button,
    Form,
    Host,
    Image,
    Label,
    LabeledContent,
    Picker,
    Section,
    Slider,
    Text,
    Toggle,
} from '@expo/ui/swift-ui';
import {
    font,
    foregroundStyle,
    tag,
} from '@expo/ui/swift-ui/modifiers';
import { FUEL_GRADE_ORDER, getFuelGradeMeta } from '../../lib/fuelGrade';
import {
    MAX_SEARCH_RADIUS_MILES,
    MIN_SEARCH_RADIUS_MILES,
} from '../../lib/fuelSearchState';

const OCTANE_OPTIONS = FUEL_GRADE_ORDER.map(fuelGrade => {
    const meta = getFuelGradeMeta(fuelGrade);
    return { key: meta.key, label: meta.label };
});

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
    onOctaneChange,
    // Navigation
    navigationApp,
    onNavigationAppChange,
    // Appearance
    themeMode,
    onThemeModeChange,
    // Tracking
    trackingReady,
    onReviewTracking,
    // Data actions
    onResetFuelCache,
    onResetOnboarding,
    // Header info shown in the first section
    onboardingFooterCopy,
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
                <Section
                    title="Fuel Preferences"
                    footer={
                        <Text
                            modifiers={[
                                font({ size: 12 }),
                                foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
                            ]}
                        >
                            Regular 85–88 · Midgrade 89–90 · Premium 91–94+ · Diesel. Radius limits the list to stations within driving distance of your current location.
                        </Text>
                    }
                >
                    <LabeledContent
                        label={(
                            <Label title="Search Radius" systemImage="location.magnifyingglass" />
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

                    <Picker
                        label="Preferred Octane"
                        systemImage="gauge.with.dots.needle.33percent"
                        selection={preferredOctane}
                        onSelectionChange={selection => {
                            if (typeof onOctaneChange === 'function') {
                                onOctaneChange(selection);
                            }
                        }}
                    >
                        {OCTANE_OPTIONS.map(option => (
                            <Text key={option.key} modifiers={[tag(option.key)]}>
                                {option.label}
                            </Text>
                        ))}
                    </Picker>
                </Section>

                <Section
                    title="Navigation"
                    footer={
                        <Text
                            modifiers={[
                                font({ size: 12 }),
                                foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
                            ]}
                        >
                            Tapping the navigate button on a station card will open driving directions in your chosen map app.
                        </Text>
                    }
                >
                    <Picker
                        label="Map App"
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
                                {option.label}
                            </Text>
                        ))}
                    </Picker>
                </Section>

                <Section title="Appearance">
                    <Picker
                        label="Theme"
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
                                {option.label}
                            </Text>
                        ))}
                    </Picker>
                </Section>

                <Section
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
                </Section>

                <Section
                    title="Data"
                    footer={
                        <Text
                            modifiers={[
                                font({ size: 12 }),
                                foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
                            ]}
                        >
                            {onboardingFooterCopy}
                        </Text>
                    }
                >
                    <Button
                        role="destructive"
                        systemImage="arrow.counterclockwise"
                        onPress={() => {
                            if (typeof onResetFuelCache === 'function') {
                                onResetFuelCache();
                            }
                        }}
                        label="Reset Fuel Cache"
                    />
                    <Button
                        systemImage="arrow.uturn.backward"
                        onPress={() => {
                            if (typeof onResetOnboarding === 'function') {
                                onResetOnboarding();
                            }
                        }}
                        label="Replay Onboarding"
                    />
                </Section>
            </Form>
        </Host>
    );
}
