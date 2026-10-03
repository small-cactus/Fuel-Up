import React, { useRef, useState } from 'react';
import { requireNativeViewManager } from 'expo-modules-core';
import useNativeOnboardingData from './useNativeOnboardingData';

const NativeView = requireNativeViewManager('FuelUpMapKitRouting', 'NativeOnboardingView');
export default function NativeOnboarding({ preferences, isDark, visible, onBack, onComplete, onMapReady }) {
    const initial = useRef({ ...preferences, searchRadiusMiles: 6 }).current;
    const [choices, setChoices] = useState(initial);
    const [coordinate, setCoordinate] = useState(null);
    const { data, retry } = useNativeOnboardingData(coordinate, choices);
    return <NativeView testID="native-onboarding" style={{ flex: 1, display: visible ? 'flex' : 'none' }}
        initialChoices={initial} data={data} isDark={isDark} onAction={({ nativeEvent: event }) => {
            switch (event.type) {
                case 'mapReady': onMapReady?.(); break;
                case 'location': setCoordinate({ latitude: event.latitude, longitude: event.longitude }); break;
                case 'choices': setChoices(event.choices); break;
                case 'complete': onComplete(event.choices); break;
                case 'back': onBack?.(); break;
                case 'retry': retry(); break;
            }
        }} />;
}
