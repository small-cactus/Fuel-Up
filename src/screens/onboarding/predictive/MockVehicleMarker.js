import React from 'react';
import { Marker } from 'react-native-maps';
const PUCK_IMAGE = require('../../../../assets/predictive-puck.png');

export default function MockVehicleMarker({ coordinate }) {

    if (!coordinate) {
        return null;
    }

    return (
        <Marker
            coordinate={coordinate}
            anchor={{ x: 0.5, y: 0.5 }}
            centerOffset={{ x: 0, y: 0 }}
            image={PUCK_IMAGE}
            flat
            tracksViewChanges={false}
            zIndex={5}
        />
    );
}
