import React, { memo, useCallback, useRef } from 'react';
import { distanceText, relativeTime } from '../../localization';
import NativeStationCard from '../../components/native/NativeStationCard';
import { createStationCardPresentation, reuseStationCardPresentation } from '../../lib/stationCardPresentation';

const Card = memo(NativeStationCard);

export default function StationPriceCard({ station, now, onMeasure, ...props }) {
    const latestStation = useRef(station);
    latestStation.current = station;
    const getStation = useCallback(() => latestStation.current, []);
    const onLayout = useCallback(event => onMeasure(station.id, event), [station.id, onMeasure]);
    const presentation = useRef(null);
    presentation.current = reuseStationCardPresentation(presentation.current,
        createStationCardPresentation(station, props.fuelGrade, now, { distanceText, relativeTime }));
    return <Card {...props} presentation={presentation.current} getStation={getStation} onLayout={onLayout} />;
}
