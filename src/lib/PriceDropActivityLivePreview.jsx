/**
 * Live Activity Design Previewer — the in-app twin of PriceDropActivity.
 *
 * ╔═════════════════════════════════════════════════════════════════╗
 * ║ KEEP IN SYNC WITH src/lib/PriceDropActivity.tsx                  ║
 * ╠═════════════════════════════════════════════════════════════════╣
 * ║ This file is a HAND-MIRRORED copy of the JSX from the real       ║
 * ║ widget (`PriceDropActivity.tsx`). When you change the widget's   ║
 * ║ `banner`, `compactLeading`, `compactTrailing`, `expandedLeading`, ║
 * ║ `expandedTrailing`, or `expandedBottom` layouts — OR the shared  ║
 * ║ color constants / headline logic — you MUST mirror the change    ║
 * ║ here, or the in-app previews will drift from the real thing.     ║
 * ║                                                                  ║
 * ║ Why duplication: babel-preset-expo's widgets-plugin replaces any ║
 * ║ function tagged with the `'widget'` directive with a template-   ║
 * ║ literal string at compile time (see node_modules/babel-preset-   ║
 * ║ expo/build/widgets-plugin.js). The widget function is literally  ║
 * ║ a string in the main-app bundle — it cannot be imported and      ║
 * ║ called, and it cannot reference any helper function defined at   ║
 * ║ module scope without breaking the serialized JSContext eval.     ║
 * ║ The only way to share layout between the widget extension and    ║
 * ║ the main app is to maintain two copies of the same JSX that      ║
 * ║ happen to use the same `@expo/ui/swift-ui` primitives.           ║
 * ║                                                                  ║
 * ║ Why it still looks identical: `@expo/ui/swift-ui` primitives are ║
 * ║ backed by real SwiftUI on both sides. In the widget extension    ║
 * ║ they are evaluated by a bundled JSContext that copies the        ║
 * ║ components into `globalThis`. In the main app they are imported  ║
 * ║ normally and rendered via `<Host>` — the same UIHostingController ║
 * ║ that `NativeDevForm.js` already uses for the dev screen. Same    ║
 * ║ SwiftUI layout engine, same fonts, same SF Symbols, same         ║
 * ║ rendering — so as long as the JSX is identical, the output is    ║
 * ║ identical.                                                       ║
 * ║                                                                  ║
 * ║ NO `'widget'` DIRECTIVE anywhere in this file. Adding one would  ║
 * ║ cause babel to turn the function into a string and break the     ║
 * ║ preview screen.                                                  ║
 * ╚═════════════════════════════════════════════════════════════════╝
 *
 * What this file exports:
 *
 *   BannerPreview                  — lock screen notification cell
 *   DynamicIslandExpandedPreview   — Dynamic Island expanded layout
 *   DynamicIslandCompactPreview    — Dynamic Island compact pill layout
 *
 * Each takes the same `PredictiveFuelingActivityProps` shape the widget
 * accepts, plus an optional `style` and `colorScheme` override. The
 * previews wrap the SwiftUI content in dark mock containers that
 * approximate the real notification cell and Dynamic Island chrome so
 * designers can iterate without swiping home.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import {
    Button,
    HStack,
    Host,
    Image,
    RoundedRectangle,
    Spacer,
    Text,
    VStack,
    ZStack,
} from '@expo/ui/swift-ui';
import {
    background,
    buttonStyle,
    font,
    foregroundStyle,
    frame,
    lineLimit,
    monospacedDigit,
    padding,
    shapes,
} from '@expo/ui/swift-ui/modifiers';

/**
 * renderContent(props) — builds the layout slots the widget returns.
 * Mirrors the body of `PriceDropActivity.tsx`'s widget function 1:1.
 *
 * Returns `{ banner, compactLeading, compactTrailing, minimal,
 *            expandedLeading, expandedTrailing, expandedBottom }`.
 *
 * @param {object} props — PredictiveFuelingActivityProps
 */
function renderContent(props) {
    // ── Colors ──
    //
    // MUST match `PriceDropActivity.tsx`. The FuelUp brand badge uses a
    // yellow→orange diagonal gradient identical to the app icon. The
    // pump glyph inside is pure white.
    const BRAND_YELLOW = '#FFDC4A';
    const BRAND_ORANGE = '#FF9A2E';

    // Action button colors — iOS system tones (dark-mode variants).
    const ACTION_BLUE = '#0A84FF';
    const ACTION_RED = '#FF453A';

    // Secondary accents.
    const ACCENT_GREEN = '#30D158';
    const URGENT_AMBER = '#FF9F0A';
    const accent = props.phase === 'passed' ? URGENT_AMBER : ACCENT_GREEN;

    // ── Savings detection ──
    const savingsNumber = Number(props.totalSavings);
    const hasTotalSavings = Number.isFinite(savingsNumber) && savingsNumber > 0;
    const totalSavingsLabel = hasTotalSavings ? props.totalSavings : '0';

    // ── ETA formatting ──
    const etaCompactLabel = props.etaMinutes === '<1'
        ? '<1 min'
        : (props.etaMinutes + ' min');

    // ── Magic-moment copy ──
    const headline = hasTotalSavings
        ? '$' + totalSavingsLabel + ' cheaper just ahead'
        : props.stationName + ' is on your route';

    const positionLine = hasTotalSavings
        ? props.stationName + ' · ' + etaCompactLabel + ' detour'
        : props.distanceMiles + ' mi ahead · ' + etaCompactLabel + ' away';

    // ── Brand badge ──
    const brandBadge = (
        <ZStack alignment="center">
            <RoundedRectangle
                cornerRadius={14}
                modifiers={[
                    frame({ width: 52, height: 52 }),
                    foregroundStyle({
                        type: 'linearGradient',
                        colors: [BRAND_YELLOW, BRAND_ORANGE],
                        startPoint: { x: 0, y: 0 },
                        endPoint: { x: 1, y: 1 },
                    }),
                ]}
            />
            <Image systemName="fuelpump.fill" color="#FFFFFF" size={28} />
        </ZStack>
    );

    // ── Action buttons ──
    //
    // Must match PriceDropActivity.tsx — plain style + background shape.
    const navigateButton = (
        <Button
            systemImage="location.north.fill"
            label="Navigate"
            modifiers={[
                buttonStyle('plain'),
                font({ size: 17, weight: 'semibold', design: 'rounded' }),
                foregroundStyle('#FFFFFF'),
                padding({ vertical: 14 }),
                frame({ maxWidth: 999999 }),
                background(ACTION_BLUE, shapes.roundedRectangle({ cornerRadius: 14 })),
            ]}
        />
    );

    const cancelButton = (
        <Button
            label="Cancel"
            role="destructive"
            modifiers={[
                buttonStyle('plain'),
                font({ size: 17, weight: 'semibold', design: 'rounded' }),
                foregroundStyle('#FFFFFF'),
                padding({ vertical: 14 }),
                frame({ maxWidth: 999999 }),
                background(ACTION_RED, shapes.roundedRectangle({ cornerRadius: 14 })),
            ]}
        />
    );

    return {
        /* ── Banner (lock screen) ── */
        banner: (
            <VStack
                modifiers={[padding({ horizontal: 18, vertical: 16 })]}
                alignment="leading"
                spacing={16}
            >
                <HStack spacing={14} alignment="center">
                    {brandBadge}

                    <VStack alignment="leading" spacing={4}>
                        <Text
                            modifiers={[
                                font({ size: 18, weight: 'semibold' }),
                                foregroundStyle({ type: 'hierarchical', style: 'primary' }),
                            ]}
                        >
                            {headline}
                        </Text>
                        <HStack spacing={5} alignment="center">
                            <Image systemName="location.fill" color={accent} size={11} />
                            <Text
                                modifiers={[
                                    font({ size: 14, weight: 'medium', design: 'rounded' }),
                                    monospacedDigit(),
                                    foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
                                ]}
                            >
                                {positionLine}
                            </Text>
                        </HStack>
                    </VStack>

                    <Spacer />
                </HStack>

                <HStack spacing={10} alignment="center">
                    {navigateButton}
                    {cancelButton}
                </HStack>
            </VStack>
        ),

        /* ── Dynamic Island — compact ── */
        compactLeading: (
            <HStack modifiers={[padding({ leading: 4 })]}>
                <Image
                    systemName="fuelpump.fill"
                    color={accent}
                    size={15}
                />
            </HStack>
        ),
        compactTrailing: (
            <HStack spacing={1} modifiers={[padding({ trailing: 4 })]} alignment="lastTextBaseline">
                <Text
                    modifiers={[
                        font({ size: 13, weight: 'semibold', design: 'rounded' }),
                        foregroundStyle(accent),
                    ]}
                >
                    $
                </Text>
                <Text
                    modifiers={[
                        font({ size: 14, weight: 'bold', design: 'rounded' }),
                        monospacedDigit(),
                        foregroundStyle(accent),
                    ]}
                >
                    {totalSavingsLabel}
                </Text>
            </HStack>
        ),
        minimal: (
            <Image systemName="fuelpump.circle.fill" color={accent} size={16} />
        ),

        /* ── Dynamic Island — expanded ── */
        expandedLeading: (
            <VStack modifiers={[padding({ leading: 8, top: 4 })]}>
                {brandBadge}
            </VStack>
        ),
        expandedTrailing: (
            <VStack
                modifiers={[padding({ trailing: 10, top: 4 })]}
                alignment="trailing"
                spacing={2}
            >
                <Text
                    modifiers={[
                        font({ size: 20, weight: 'bold', design: 'rounded' }),
                        monospacedDigit(),
                        foregroundStyle(accent),
                        lineLimit(1),
                    ]}
                >
                    {'Save $' + totalSavingsLabel}
                </Text>
                <Text
                    modifiers={[
                        font({ size: 11, weight: 'medium' }),
                        foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
                        lineLimit(1),
                    ]}
                >
                    at {props.stationName}
                </Text>
            </VStack>
        ),
        expandedBottom: (
            <VStack
                modifiers={[padding({ horizontal: 14, bottom: 12 })]}
                alignment="leading"
                spacing={10}
            >
                <HStack spacing={5} alignment="center">
                    <Image systemName="location.fill" color={accent} size={12} />
                    <Text
                        modifiers={[
                            font({ size: 13, weight: 'medium', design: 'rounded' }),
                            monospacedDigit(),
                            foregroundStyle({ type: 'hierarchical', style: 'primary' }),
                        ]}
                    >
                        {positionLine}
                    </Text>
                    <Spacer />
                </HStack>
                <HStack spacing={8} alignment="center">
                    <Button
                        systemImage="location.north.fill"
                        label="Navigate"
                        modifiers={[
                            buttonStyle('plain'),
                            font({ size: 15, weight: 'semibold', design: 'rounded' }),
                            foregroundStyle('#FFFFFF'),
                            padding({ vertical: 12 }),
                            frame({ maxWidth: 999999 }),
                            background(ACTION_BLUE, shapes.roundedRectangle({ cornerRadius: 12 })),
                        ]}
                    />
                    <Button
                        label="Cancel"
                        modifiers={[
                            buttonStyle('plain'),
                            font({ size: 15, weight: 'semibold', design: 'rounded' }),
                            foregroundStyle('#FFFFFF'),
                            padding({ vertical: 12 }),
                            frame({ maxWidth: 999999 }),
                            background(ACTION_RED, shapes.roundedRectangle({ cornerRadius: 12 })),
                        ]}
                    />
                </HStack>
            </VStack>
        ),
    };
}

/**
 * Lock-screen banner preview. Wraps the widget's `banner` layout in a
 * dark, rounded container that approximates the iOS notification cell
 * so the designer can see the banner in its native chrome.
 */
export function BannerPreview({ props, style, colorScheme = 'dark' }) {
    const { banner } = renderContent(props);
    return (
        <View style={[styles.bannerContainer, style]}>
            <Host
                matchContents
                colorScheme={colorScheme}
                style={styles.bannerHost}
            >
                {banner}
            </Host>
        </View>
    );
}

/**
 * Dynamic Island expanded preview. Stacks `expandedLeading`,
 * `expandedTrailing`, and `expandedBottom` inside a wide dark pill.
 * Not pixel-identical to the system rendering (which adds its own
 * framing and vibrancy) — but close enough to iterate on color and
 * hierarchy choices.
 */
export function DynamicIslandExpandedPreview({ props, style, colorScheme = 'dark' }) {
    const { expandedLeading, expandedTrailing, expandedBottom } = renderContent(props);
    return (
        <View style={[styles.dynamicIslandExpandedContainer, style]}>
            <View style={styles.dynamicIslandExpandedRow}>
                <View style={styles.dynamicIslandExpandedRegion}>
                    <Host matchContents colorScheme={colorScheme}>
                        {expandedLeading}
                    </Host>
                </View>
                <View style={styles.dynamicIslandExpandedRegion}>
                    <Host matchContents colorScheme={colorScheme}>
                        {expandedTrailing}
                    </Host>
                </View>
            </View>
            <View style={styles.dynamicIslandExpandedBottom}>
                <Host matchContents colorScheme={colorScheme}>
                    {expandedBottom}
                </Host>
            </View>
        </View>
    );
}

/**
 * Dynamic Island compact preview. Simulates the pill shape with a
 * centered notch cutout; flanking `<Host>`s render `compactLeading`
 * and `compactTrailing`.
 */
export function DynamicIslandCompactPreview({ props, style, colorScheme = 'dark' }) {
    const { compactLeading, compactTrailing } = renderContent(props);
    return (
        <View style={[styles.dynamicIslandCompactContainer, style]}>
            <View style={styles.dynamicIslandCompactSide}>
                <Host matchContents colorScheme={colorScheme}>
                    {compactLeading}
                </Host>
            </View>
            <View style={styles.dynamicIslandCompactNotch} />
            <View style={styles.dynamicIslandCompactSide}>
                <Host matchContents colorScheme={colorScheme}>
                    {compactTrailing}
                </Host>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    bannerContainer: {
        backgroundColor: 'rgba(28,28,30,0.92)',
        borderRadius: 18,
        padding: 4,
        maxWidth: 360,
        width: '100%',
        alignSelf: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.35,
        shadowRadius: 16,
        elevation: 6,
    },
    bannerHost: {
        borderRadius: 14,
        overflow: 'hidden',
    },
    dynamicIslandExpandedContainer: {
        backgroundColor: '#000000',
        borderRadius: 36,
        paddingHorizontal: 12,
        paddingTop: 12,
        paddingBottom: 14,
        width: 360,
        maxWidth: '100%',
        alignSelf: 'center',
    },
    dynamicIslandExpandedRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
    },
    dynamicIslandExpandedRegion: {
        flex: 1,
    },
    dynamicIslandExpandedBottom: {
        marginTop: 8,
    },
    dynamicIslandCompactContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: '#000000',
        borderRadius: 28,
        height: 36,
        width: 240,
        maxWidth: '100%',
        alignSelf: 'center',
        paddingHorizontal: 8,
    },
    dynamicIslandCompactSide: {
        minWidth: 40,
        alignItems: 'center',
    },
    dynamicIslandCompactNotch: {
        width: 96,
        height: 36,
    },
});
