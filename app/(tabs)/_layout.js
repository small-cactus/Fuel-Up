import React from 'react';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useTheme } from '../../src/ThemeContext';
import { DynamicColorIOS } from 'react-native';

export default function TabLayout() {
    const { isDark } = useTheme();

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
            <NativeTabs.Trigger name="index">
                <NativeTabs.Trigger.Icon sf="location" md="home" />
                <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
            </NativeTabs.Trigger>

            <NativeTabs.Trigger name="trends">
                <NativeTabs.Trigger.Icon sf="chart.line.uptrend.xyaxis" md="trending-up" />
                <NativeTabs.Trigger.Label>Trends</NativeTabs.Trigger.Label>
            </NativeTabs.Trigger>

            <NativeTabs.Trigger name="settings">
                <NativeTabs.Trigger.Icon sf="gearshape" md="settings" />
                <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
            </NativeTabs.Trigger>

            <NativeTabs.Trigger name="dev">
                <NativeTabs.Trigger.Icon sf="hammer" md="build" />
                <NativeTabs.Trigger.Label>Dev</NativeTabs.Trigger.Label>
            </NativeTabs.Trigger>
        </NativeTabs>
    );
}
