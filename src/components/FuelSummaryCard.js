import React, { memo } from 'react';
import { Platform } from 'react-native';
import NativeStationCard from './native/NativeStationCard';
import FuelSummaryCardFallback from './FuelSummaryCardFallback';

function FuelSummaryCard(props) {
    if (Platform.OS !== 'ios') return <FuelSummaryCardFallback {...props} />;
    const { quote, onNavigatePress } = props;
    return <NativeStationCard {...props} station={quote ? { ...quote, name: quote.stationName || quote.name } : null}
        emptyTitle={!quote && props.errorMsg ? 'No Prices Returned' : 'Cheapest Nearby'}
        onNavigate={onNavigatePress} />;
}
export default memo(FuelSummaryCard);
