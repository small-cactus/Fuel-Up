import { t, relativeTime, distanceText } from '../../localization';
import React from 'react';
import { recordResearchInteraction } from '../../lib/researchInteractions';
import { useWindowDimensions } from 'react-native';
import { Host, VStack, HStack, Text, Image, Spacer, Button, ProgressView } from '@expo/ui/swift-ui';
import { accessibilityLabel, buttonStyle, controlSize, disabled, fixedSize, font, foregroundStyle, glassEffect, lineLimit, layoutPriority, padding, tint } from '@expo/ui/swift-ui/modifiers';
import { getFuelGradeMeta, resolveQuotePriceForFuelGrade } from '../../lib/fuelGrade';
import { createStationCardPresentation } from '../../lib/stationCardPresentation';

export default function NativeStationCard({ station, rank, fuelGrade, isDark, themeColors, now,
    compact, onNavigate, onLayout, isRefreshing = false, errorMsg, emptyTitle, presentation, getStation }) {
    const { fontScale, width } = useWindowDimensions();
    const scale = Math.min(fontScale, 2);
    const stacked = fontScale > 1.3;
    const grade = getFuelGradeMeta(fuelGrade);
    const card = presentation || createStationCardPresentation(station, fuelGrade, now, { distanceText, relativeTime });
    const { price, rating, details } = card;
    const name = card.name || emptyTitle || t("Cheapest Nearby");
    const canNavigate = typeof onNavigate === 'function' && card.canNavigate;
    const text = (size, weight = 'medium', color = themeColors.text) => [font({ size: size * scale, weight }), foregroundStyle(color), fixedSize({ horizontal: false, vertical: true })];
    const Header = stacked ? VStack : HStack;
    const PriceRow = stacked ? VStack : HStack;
    const Subtitle = stacked ? VStack : HStack;
    const dualPrices = card.hasDualPrices ? { primaryLabel: card.dualPrimaryLabel, primaryPrice: card.dualPrimaryPrice, e85Price: card.dualE85Price } : null;
    const dualPriceSize = stacked ? (compact ? 30 : 44) * scale : Math.min(34 * scale, (width - 84) / 9);
    const priceSize = Math.min((compact ? 30 : 44) * scale, (width - 68) / 4.2);
    return <Host ignoreSafeArea="all" matchContents={{ vertical: true }} colorScheme={isDark ? 'dark' : 'light'}
        style={{ width: '100%' }} onLayoutContent={event => onLayout?.({ nativeEvent: { layout: event.nativeEvent } })}>
        <HStack alignment="top" spacing={0} modifiers={[
            fixedSize({ horizontal: false, vertical: true }), padding({ horizontal: 18, vertical: compact ? 12 : 18 }),
            glassEffect({ glass: { variant: 'regular' }, shape: 'roundedRectangle', cornerRadius: 28 }),
        ]}>
        <VStack alignment="leading" spacing={compact ? 3 : 7} modifiers={[layoutPriority(1)]}>
            <Header alignment={stacked ? 'leading' : 'center'} spacing={12}>
                <VStack alignment="leading" spacing={4}>
                    <Text modifiers={text(19, 'bold')}>{name}</Text>
                    <Subtitle alignment={stacked ? 'leading' : 'center'} spacing={8}>
                        <Text modifiers={text(12, 'medium', themeColors.textOpacity)}>{Number.isFinite(price) && rank ? `#${rank} · ` : ''}{t(grade.label)}{grade.octane !== grade.label ? ` ${grade.octane}` : ''}</Text>
                        {rating && <HStack spacing={3}>
                            <Image systemName="star.fill" size={11 * scale} color="#FFB800" />
                            <Text modifiers={text(12)}>{rating}</Text>
                        </HStack>}
                    </Subtitle>
                </VStack>
                {!stacked && <Spacer />}
                <HStack spacing={8} modifiers={[layoutPriority(1)]}>
                    {isRefreshing && <ProgressView />}
                    <Button onPress={async () => {
                        const currentStation = getStation?.() || station;
                        const currentPrice = resolveQuotePriceForFuelGrade(currentStation, fuelGrade);
                        await recordResearchInteraction('station_go', { station: { ...currentStation, price: currentPrice }, fuelGrade, rank, surface: 'station_card' });
                        onNavigate?.(currentStation);
                    }} label={t("Go")} systemImage="arrow.up.right" modifiers={[
                        buttonStyle('glassProminent'), controlSize('large'), tint('#248A3D'), disabled(!canNavigate),
                        accessibilityLabel(t('Navigate to {station}', { station: name })), font({ size: 16 * scale, weight: 'bold' }),
                    ]} />
                </HStack>
            </Header>
            {dualPrices ? <PriceRow alignment={stacked ? 'leading' : 'top'} spacing={stacked ? 8 : 20}>
                {[[dualPrices.primaryLabel, dualPrices.primaryPrice], ['E85', dualPrices.e85Price]].map(([label, value]) =>
                    <VStack key={label} alignment="leading" spacing={2}>
                        <Text modifiers={text(12, 'semibold', themeColors.textOpacity)}>{label}</Text>
                        <HStack alignment="firstTextBaseline" spacing={3}>
                            <Text modifiers={[font({ size: dualPriceSize, weight: 'bold' }), foregroundStyle(themeColors.text), lineLimit(1),
                                accessibilityLabel(`${label}: ${t('{price} per gallon', { price: value === '—' ? t('Price unavailable') : value })}`)]}>{value}</Text>
                            {value !== '—' && <Text modifiers={text(12, 'regular', themeColors.textOpacity)}>/ gal</Text>}
                        </HStack>
                    </VStack>)}
            </PriceRow> : Number.isFinite(price) ? <PriceRow alignment={stacked ? 'leading' : 'firstTextBaseline'} spacing={6}>
                <Text modifiers={[font({ size: priceSize, weight: 'bold' }), foregroundStyle(themeColors.text), lineLimit(1)]}>${price.toFixed(2)}</Text>
                <Text modifiers={text(15, 'regular', themeColors.textOpacity)}>/ gal</Text>
            </PriceRow> : <Text modifiers={text(12, 'medium', themeColors.textOpacity)}>{card.hasStation ? t("E85 available · Price unavailable") : isRefreshing ? t("Checking nearby prices…") : t("Price unavailable")}</Text>}
            {!compact && card.address ? <Text modifiers={text(14, 'regular')}>{card.address}</Text> : null}
            {!compact && details ? <Text modifiers={text(12, 'medium', themeColors.textOpacity)}>{details}</Text> : null}
            {errorMsg ? <Text modifiers={text(12, 'medium', themeColors.textOpacity)}>{errorMsg}</Text> : null}
        </VStack>
        <Spacer minLength={0} />
        </HStack>
    </Host>;
}
