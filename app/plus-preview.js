import React from 'react';
import { Redirect } from 'expo-router';
import { PAYWALL_PREVIEW_ENABLED } from '../src/lib/previewFeatures';
import PlusPreviewScreen from '../src/screens/plus/PlusPreviewScreen';

export default function PlusPreviewRoute() {
    if (!PAYWALL_PREVIEW_ENABLED) return <Redirect href="/(tabs)/settings" />;
    return <PlusPreviewScreen />;
}
