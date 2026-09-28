import { useAnimatedStyle } from 'react-native-reanimated';
import { interpolate } from 'react-native-reanimated';
import { Extrapolate } from 'react-native-reanimated';
import { View } from 'react-native';
import FuelSummaryCard from '../../components/FuelSummaryCard';
import Animated from 'react-native-reanimated';

export function AnimatedCardItem({
    item,
    index,
    scrollX,
    itemWidth,
    isDark,
    benchmarkQuote,
    errorMsg,
    isRefreshing,
    themeColors,
    glassTintColor,
    fuelGrade,
    onNavigatePress,
}) {
    const animatedDimStyle = useAnimatedStyle(() => {
        if (isDark) return { opacity: 0 };

        const inputRange = [(index - 1) * itemWidth, index * itemWidth, (index + 1) * itemWidth];
        const dimOpacity = interpolate(
            scrollX.value,
            inputRange,
            [0.3, 0, 0.3],
            Extrapolate.CLAMP
        );

        return { opacity: dimOpacity };
    });

    return (
        <View style={{ width: itemWidth, paddingHorizontal: 4 }}>
            <FuelSummaryCard
                benchmarkQuote={benchmarkQuote}
                errorMsg={errorMsg}
                fuelGrade={fuelGrade}
                glassTintColor={glassTintColor}
                isDark={isDark}
                isRefreshing={isRefreshing}
                quote={item}
                themeColors={themeColors}
                rank={index + 1}
                onNavigatePress={onNavigatePress}
            />
            {!isDark && (
                <Animated.View
                    pointerEvents="none"
                    style={[{
                        position: 'absolute',
                        top: 0,
                        bottom: 0,
                        left: 4,
                        right: 4,
                        borderRadius: 32
                    }, animatedDimStyle]}
                />
            )}
        </View>
    );
}
