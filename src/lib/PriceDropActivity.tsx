import { Image, Text, VStack, HStack, Spacer } from '@expo/ui/swift-ui';
import { font, foregroundStyle, padding, background } from '@expo/ui/swift-ui/modifiers';
import { createLiveActivity } from 'expo-widgets';

export type PriceDropActivityProps = {
    stationName: string;
    price: string;
};

const PriceDropActivity = (props: PriceDropActivityProps) => {
    'widget';
    return {
        banner: (
            <VStack modifiers={[padding({ all: 12 }), background('#111111')]}>
                <HStack>
                    <Image systemName="fuelpump.circle.fill" color="#00FF00" />
                    <VStack modifiers={[padding({ leading: 8 })]}>
                        <Text modifiers={[font({ weight: 'bold', size: 18 }), foregroundStyle('#00FF00')]}>
                            {props.price}
                        </Text>
                        <Text modifiers={[font({ size: 14 }), foregroundStyle('#FFFFFF')]}>
                            {props.stationName}
                        </Text>
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
            <Text modifiers={[font({ weight: 'bold', size: 14 }), foregroundStyle('#00FF00'), padding({ trailing: 4 })]}>
                {props.price}
            </Text>
        ),
        minimal: <Image systemName="fuelpump.circle.fill" color="#00FF00" />,
        expandedLeading: (
            <VStack modifiers={[padding({ all: 8 })]}>
                <Image systemName="fuelpump.circle.fill" color="#00FF00" size={24} />
            </VStack>
        ),
        expandedTrailing: (
            <VStack modifiers={[padding({ top: 8, trailing: 8 }), background('clear')]}>
                <Text modifiers={[font({ weight: 'bold', size: 22 }), foregroundStyle('#00FF00')]}>
                    {props.price}
                </Text>
            </VStack>
        ),
        expandedBottom: (
            <VStack modifiers={[padding({ horizontal: 12, bottom: 8 })]}>
                <Text modifiers={[font({ size: 16 }), foregroundStyle('#FFFFFF')]}>
                    {props.stationName}
                </Text>
                <Text modifiers={[font({ size: 12 }), foregroundStyle('#AAAAAA')]}>
                    Price Drop Alert
                </Text>
            </VStack>
        ),
    };
};

export default createLiveActivity('PriceDropActivity', PriceDropActivity);
