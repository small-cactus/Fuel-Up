import { t } from '../../src/localization';
import React, { useEffect, useSyncExternalStore } from 'react';
import { useNavigation } from 'expo-router';
import { onboardingHandoff } from '../../src/lib/onboardingHandoff';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { DynamicColorIOS } from 'react-native';

export default function TabLayout() {
    const navigation = useNavigation();
    const phase = useSyncExternalStore(onboardingHandoff.subscribe, onboardingHandoff.getSnapshot, onboardingHandoff.getSnapshot);
    useEffect(() => {
        // Select Home explicitly after this navigator mounts under setup. A URL
        // replacement can preserve the previously selected native Settings tab.
        if (phase !== 'preparing') return;
        const frame = requestAnimationFrame(() => navigation.navigate('(tabs)', { screen: 'index' }));
        return () => cancelAnimationFrame(frame);
    }, [phase, navigation]);
    return (
        <NativeTabs
            labelStyle={{
                color: DynamicColorIOS({
                    dark: 'white',
                    light: 'black',
                }),
            }}
            tintColor={DynamicColorIOS({
                dark: 'white',
                light: 'black',
            })}
        >
            <NativeTabs.Trigger name="index" disableAutomaticContentInsets>
                <NativeTabs.Trigger.Icon sf="location" md="home" />
                <NativeTabs.Trigger.Label>{t("Home")}</NativeTabs.Trigger.Label>
            </NativeTabs.Trigger>

            <NativeTabs.Trigger name="trends">
                <NativeTabs.Trigger.Icon sf="chart.line.uptrend.xyaxis" md="trending-up" />
                <NativeTabs.Trigger.Label>{t("Trends")}</NativeTabs.Trigger.Label>
            </NativeTabs.Trigger>

            <NativeTabs.Trigger name="settings">
                <NativeTabs.Trigger.Icon sf="gearshape" md="settings" />
                <NativeTabs.Trigger.Label>{t("Settings")}</NativeTabs.Trigger.Label>
            </NativeTabs.Trigger>

        </NativeTabs>
    );
}
