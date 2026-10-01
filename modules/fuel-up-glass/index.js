import React, { useId } from 'react';
import { Platform } from 'react-native';
import { requireNativeModule } from 'expo';
import { Form, Section } from '@expo/ui/swift-ui';
import { createModifier } from '@expo/ui/swift-ui/modifiers';

// Loading the module registers the native modifiers before the form mounts.
const supportsNativeGlass = Platform.OS === 'ios';
if (supportsNativeGlass) requireNativeModule('FuelUpGlass');

export function GlassForm({ modifiers = [], ...props }) {
    return <Form {...props} modifiers={supportsNativeGlass ? [...modifiers, createModifier('fuelGlassForm')] : modifiers} />;
}

export function GlassSection({ modifiers = [], ...props }) {
    const id = useId();
    return <Section {...props} modifiers={supportsNativeGlass ? [...modifiers, createModifier('fuelGlassSection', { id })] : modifiers} />;
}
