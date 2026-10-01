import { Platform } from 'react-native';
import NativeTrendLeaderboard from './NativeTrendLeaderboard';
import TrendLeaderboardFallback from './TrendLeaderboardFallback';

export default Platform.OS === 'ios' ? NativeTrendLeaderboard : TrendLeaderboardFallback;
