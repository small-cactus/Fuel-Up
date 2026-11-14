import { memo } from 'react';
import { Platform } from 'react-native';
import NativeTrendLeaderboard from './NativeTrendLeaderboard';
import TrendLeaderboardFallback from './TrendLeaderboardFallback';

export default memo(Platform.OS === 'ios' ? NativeTrendLeaderboard : TrendLeaderboardFallback);
