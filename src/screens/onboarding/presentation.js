import { Dimensions } from 'react-native';

export const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export const DEMO_REGION = {
    latitude: 37.7749,
    longitude: -122.4194,
    latitudeDelta: 0.06,
    longitudeDelta: 0.06,
};

export const LIGHT_SCREEN_BACKGROUND = '#f2f1f6';

export const LIGHT_SCREEN_BACKGROUND_85 = 'rgba(242,241,246,0.85)';

export const LIGHT_SCREEN_BACKGROUND_42 = 'rgba(242,241,246,0.42)';

export const LIGHT_SCREEN_BACKGROUND_0 = 'rgba(242,241,246,0)';
