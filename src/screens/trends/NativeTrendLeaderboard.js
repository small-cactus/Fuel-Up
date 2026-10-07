import { t, language, relativeTime } from '../../localization';
import React from 'react';
import { useWindowDimensions } from 'react-native';
import { Host, VStack, HStack, Text, Image, Spacer, Divider } from '@expo/ui/swift-ui';
import { font, foregroundStyle, padding, glassEffect, fixedSize, layoutPriority } from '@expo/ui/swift-ui/modifiers';

// One SwiftUI host owns the card, its glass surface, and all row layout.
export default function TrendLeaderboard({ stations, gradeLabel, updatedLabel, isDark, themeColors, national = false }) {
    const { fontScale } = useWindowDimensions();
    const scale = Math.min(fontScale, 2);
    const stacked = fontScale > 1.3;
    const HeaderStack = stacked || national ? VStack : HStack;
    const RowStack = stacked ? VStack : HStack;
    const NameStack = stacked ? VStack : HStack;
    const secondary = themeColors.textOpacity;
    const text = (size, weight = 'medium', color = themeColors.text, rounded = false) => [
        font({ size: size * scale, weight, design: rounded ? 'rounded' : 'default' }),
        foregroundStyle(color),
        fixedSize({ horizontal: false, vertical: true }),
    ];

    return (
        <Host ignoreSafeArea="all" matchContents={{ vertical: true }} colorScheme={isDark ? 'dark' : 'light'} style={{ width: '100%' }}>
            <VStack alignment="leading" spacing={0} modifiers={[
                fixedSize({ horizontal: false, vertical: true }),
                padding({ all: 24 }),
                glassEffect({ glass: { variant: 'regular' }, shape: 'roundedRectangle', cornerRadius: 24 }),
            ]}>
                <HeaderStack alignment={stacked || national ? 'leading' : 'center'} spacing={12} modifiers={[padding({ bottom: 16 })]}>
                    <Text modifiers={text(19, isDark ? 'bold' : 'heavy')}>
                        {national ? t('Cheapest {grade}', { grade: gradeLabel }) : t('{grade} Leaderboard', { grade: gradeLabel })}
                    </Text>
                    {!stacked && !national && <Spacer />}
                    <Text modifiers={text(13, 'medium', secondary)}>
                        {national ? t("United States · Last 24 hours") : t('Latest report {time}', { time: updatedLabel })}
                    </Text>
                </HeaderStack>
                {stations.map((station, index) => {
                    const rank = language !== 'en' ? String(index + 1) : index === 0 ? '1st' : index === 1 ? '2nd' : index === 2 ? '3rd' : `${index + 1}th`;
                    const medalColor = index === 0 ? themeColors.text : index === 1 ? '#8f8f8f' : '#CD7F32';
                    const shift = Number(station.rankShift) || 0;
                    const shiftColor = shift > 0 ? '#51CF66' : shift < 0 ? '#FF6B6B' : secondary;
                    const PriceStack = stacked ? HStack : VStack;
                    return (
                        <VStack key={station.stationId} alignment="leading" spacing={0}>
                            {index > 0 && <Divider />}
                            <RowStack alignment={stacked ? 'leading' : 'center'} spacing={16} modifiers={[padding({ vertical: 14 })]}>
                                <VStack alignment="leading" spacing={4}>
                                    <NameStack alignment={stacked ? 'leading' : 'center'} spacing={8}>
                                        <Text modifiers={text(16, isDark ? 'semibold' : 'bold')}>{station.name || t("Unknown Station")}</Text>
                                        <HStack spacing={0} modifiers={[fixedSize()]}>
                                            {index < 3 && <Image systemName="laurel.leading" size={30 * scale} color={medalColor} />}
                                            <Text modifiers={text(index < 3 ? 18 : 13, 'semibold', index < 3 ? medalColor : secondary, true)}>{rank}</Text>
                                            {index < 3 && <Image systemName="laurel.trailing" size={30 * scale} color={medalColor} />}
                                        </HStack>
                                    </NameStack>
                                    <NameStack alignment={stacked ? 'leading' : 'center'} spacing={6}>
                                        <Text modifiers={text(14, 'medium', secondary)}>{national ? station.address : station.address?.split(',')[0]}</Text>
                                        {!national && Number.isFinite(station.distanceMiles) && (
                                            <HStack spacing={4} modifiers={[fixedSize()]}>
                                                {!stacked && <Text modifiers={text(14, 'medium', secondary)}>·</Text>}
                                                <Image systemName="car.fill" size={18 * scale} color={secondary} />
                                                <Text modifiers={text(14, 'medium', secondary, true)}>{station.distanceMiles.toFixed(1)} mi</Text>
                                            </HStack>
                                        )}
                                    </NameStack>
                                </VStack>
                                {!stacked && <Spacer />}
                                <PriceStack alignment={stacked ? 'center' : 'trailing'} spacing={stacked ? 12 : 4} modifiers={[layoutPriority(1)]}>
                                    <Text modifiers={text(17, isDark ? 'bold' : 'heavy', themeColors.text, true)}>${station.latestPrice.toFixed(2)}</Text>
                                    {(station.paymentType === 'cash' || station.allPrices?._payment?.[station.fuelType]?.selected === 'cash') && <Text modifiers={text(13, 'medium', secondary)}>{t("Cash")}</Text>}
                                    {national ? <Text modifiers={text(13, 'medium', secondary)}>{relativeTime(station.updatedAt)}</Text> : (
                                        <HStack spacing={2}>
                                            {shift !== 0 && <Image systemName={shift > 0 ? 'arrow.up' : 'arrow.down'} size={13 * scale} color={shiftColor} />}
                                            <Text modifiers={text(13, 'semibold', shiftColor, true)}>{shift === 0 ? '—' : Math.abs(shift)}</Text>
                                        </HStack>
                                    )}
                                </PriceStack>
                            </RowStack>
                        </VStack>
                    );
                })}
            </VStack>
        </Host>
    );
}
