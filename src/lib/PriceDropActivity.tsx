import { Image, Text, VStack, HStack, Spacer } from '@expo/ui/swift-ui';
import { font, foregroundStyle, padding, background, cornerRadius, opacity } from '@expo/ui/swift-ui/modifiers';
import { createLiveActivity } from 'expo-widgets';

export type PriceDropActivityProps = {
    stationName: string;
    price: string;
};

const PriceDropActivity = (props: PriceDropActivityProps) => {
    'widget';
    return {
        banner: (
            <VStack modifiers={[padding({ all: 16 })]}>
                <HStack spacing={12} alignment="center">
                    <HStack spacing={12} alignment="center">
                        <VStack modifiers={[padding({ all: 8 }), background('#00FF00'), cornerRadius(12)]}>
                            <Image systemName="fuelpump.fill" color="#000000" size={20} />
                        </VStack>
                        <VStack alignment="leading">
                            <Text modifiers={[font({ size: 16, weight: 'semibold' }), foregroundStyle({ type: 'hierarchical', style: 'primary' })]}>
                                {props.stationName}
                            </Text>
                            <Text modifiers={[font({ size: 12 }), foregroundStyle({ type: 'hierarchical', style: 'secondary' })]}>
                                FuelUp Alert
                            </Text>
                        </VStack>
                    </HStack>

                    <Spacer />

                    <VStack alignment="trailing">
                        <HStack spacing={4} alignment="center">
                            <Text modifiers={[font({ weight: 'bold', size: 28, design: 'rounded' }), foregroundStyle('#00FF00')]}>
                                {props.price}
                            </Text>
                        </HStack>
                        <VStack modifiers={[padding({ horizontal: 6, vertical: 2 }), background('#00FF00'), opacity(0.2), cornerRadius(4)]}>
                            <Text modifiers={[font({ weight: 'bold', size: 10 }), foregroundStyle('#00FF00')]}>
                                PRICE DROP
                            </Text>
                        </VStack>
                    </VStack>
                </HStack>
            </VStack>
        ),
        compactLeading: (
            <HStack modifiers={[padding({ leading: 4 })]}>
                <Image systemName="fuelpump.circle.fill" color="#00FF00" />
            </HStack>
        ),
        compactTrailing: (
            <Text modifiers={[font({ weight: 'bold', size: 14, design: 'rounded' }), foregroundStyle('#00FF00'), padding({ trailing: 4 })]}>
                {props.price}
            </Text>
        ),
        minimal: <Image systemName="fuelpump.circle.fill" color="#00FF00" />,
        expandedLeading: (
            <VStack modifiers={[padding({ all: 8 })]}>
                <VStack modifiers={[padding({ all: 6 }), background('#00FF00'), cornerRadius(10)]}>
                    <Image systemName="fuelpump.fill" color="#000000" size={16} />
                </VStack>
            </VStack>
        ),
        expandedTrailing: (
            <VStack modifiers={[padding({ top: 8, trailing: 12 })]}>
                <Text modifiers={[font({ weight: 'bold', size: 24, design: 'rounded' }), foregroundStyle('#00FF00')]}>
                    {props.price}
                </Text>
            </VStack>
        ),
        expandedBottom: (
            <VStack modifiers={[padding({ horizontal: 16, bottom: 12 })]} alignment="leading" spacing={2}>
                <HStack alignment="center">
                    <Text modifiers={[font({ size: 17, weight: 'semibold' }), foregroundStyle({ type: 'hierarchical', style: 'primary' })]}>
                        {props.stationName}
                    </Text>
                    <Spacer />
                    <VStack modifiers={[padding({ horizontal: 6, vertical: 2 }), background('#00FF00'), opacity(0.2), cornerRadius(4)]}>
                        <Text modifiers={[font({ weight: 'bold', size: 10 }), foregroundStyle('#00FF00')]}>
                            ACTIVE
                        </Text>
                    </VStack>
                </HStack>
                <Text modifiers={[font({ size: 13 }), foregroundStyle({ type: 'hierarchical', style: 'secondary' })]}>
                    Fuel Price Alert • Just now
                </Text>
            </VStack>
        ),
    };
};

export default createLiveActivity('PriceDropActivity', PriceDropActivity);
