import React, { forwardRef, memo, useImperativeHandle, useRef } from 'react';
import { Marker } from 'react-native-maps';

const PUCK_IMAGES = {
    flat: require('../../../../assets/predictive-puck-flat.png'),
    medium: require('../../../../assets/predictive-puck-medium.png'),
    high: require('../../../../assets/predictive-puck-high.png'),
};

const MockVehicleMarker = forwardRef(function MockVehicleMarker({ initialCoordinate, tiltVariant = 'high' }, ref) {
    const markerRef = useRef(null);

    useImperativeHandle(ref, () => ({
        moveTo(coordinate, durationMs = 24) {
            if (!markerRef.current || !coordinate) {
                return;
            }

            if (typeof markerRef.current.animateMarkerToCoordinate === 'function') {
                markerRef.current.animateMarkerToCoordinate(coordinate, durationMs);
                return;
            }

            if (typeof markerRef.current.setCoordinates === 'function') {
                markerRef.current.setCoordinates(coordinate);
                return;
            }

            markerRef.current.setNativeProps?.({ coordinate });
        },
        setTo(coordinate) {
            if (!markerRef.current || !coordinate) {
                return;
            }

            if (typeof markerRef.current.setCoordinates === 'function') {
                markerRef.current.setCoordinates(coordinate);
                return;
            }

            markerRef.current.setNativeProps?.({ coordinate });
        },
    }), []);

    if (!initialCoordinate) {
        return null;
    }

    return (
        <Marker
            ref={markerRef}
            coordinate={initialCoordinate}
            anchor={{ x: 0.5, y: 0.5 }}
            centerOffset={{ x: 0, y: 0 }}
            image={PUCK_IMAGES[tiltVariant] || PUCK_IMAGES.high}
            flat
            tracksViewChanges={false}
            zIndex={5}
        />
    );
});

export default memo(MockVehicleMarker);
