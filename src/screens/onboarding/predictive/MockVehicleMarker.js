import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Marker } from 'react-native-maps';
import { SymbolView } from 'expo-symbols';

export default function MockVehicleMarker({ coordinate, heading = 0 }) {
    if (!coordinate) {
        return null;
    }

    return (
        <Marker
            coordinate={coordinate}
            anchor={{ x: 0.5, y: 0.5 }}
            centerOffset={{ x: 0, y: 0 }}
            tracksViewChanges
            zIndex={5}
        >
            <View style={styles.outerHalo}>
                <View style={styles.innerPuck}>
                    <View style={[styles.directionGlyph, { transform: [{ rotate: `${heading}deg` }] }]}>
                        <SymbolView name="location.north.fill" size={15} tintColor="#FFFFFF" />
                    </View>
                </View>
            </View>
        </Marker>
    );
}

const styles = StyleSheet.create({
    outerHalo: {
        width: 34,
        height: 34,
        borderRadius: 17,
        backgroundColor: 'rgba(10,132,255,0.22)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    innerPuck: {
        width: 22,
        height: 22,
        borderRadius: 11,
        backgroundColor: '#0A84FF',
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#0A84FF',
        shadowOpacity: 0.42,
        shadowRadius: 10,
        shadowOffset: {
            width: 0,
            height: 4,
        },
    },
    directionGlyph: {
        alignItems: 'center',
        justifyContent: 'center',
    },
});
