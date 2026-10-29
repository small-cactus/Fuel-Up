import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import Svg, { Defs, LinearGradient, Stop, Path, Line, Circle } from 'react-native-svg';
import NativeGlassContainer from '../../components/native/NativeGlassContainer';

const ROUTE = [
    { latitude: 37.7901, longitude: -122.4330 },
    { latitude: 37.7915, longitude: -122.4327 },
    { latitude: 37.7919, longitude: -122.4363 },
    { latitude: 37.7935, longitude: -122.4360 },
];
const STOP = ROUTE[2];

export default function SaverFeatureGraphic({ index, isDark }) {
    const ink = isDark ? '#FFF9F0' : '#18130D';
    return <View style={styles.canvas} accessible accessibilityLabel={[
        'Example notification: Fuel Up. Price drop nearby. Regular is now $3.09 at Shell, down 18 cents.',
        'Example Apple map with a blue driving route and a cheaper Shell station at $3.09.',
        'Example Shell station price chart. $3.09 per gallon, an illustrative all-time low.',
    ][index]} accessibilityElementsHidden={false}>
        <View style={StyleSheet.absoluteFill} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {index === 0 && <View style={styles.notificationStage}>
                <NativeGlassContainer colorScheme={isDark ? 'dark' : 'light'} tintColor={isDark ? '#2B2B2B99' : undefined} style={styles.notification}>
                    <Image source={require('../../../assets/fuelup-icon.png')} style={styles.appIcon} />
                    <View style={styles.notificationCopy}>
                        <View style={styles.notificationTop}>
                            <Text allowFontScaling={false} style={[styles.appName, { color: ink }]}>Fuel Up</Text>
                            <Text allowFontScaling={false} style={[styles.now, { color: ink, opacity: 0.5 }]}>now</Text>
                        </View>
                        <Text allowFontScaling={false} style={[styles.notificationTitle, { color: ink }]}>Price drop nearby</Text>
                        <Text allowFontScaling={false} style={[styles.notificationBody, { color: ink }]}>Regular is now $3.09 at Shell.{ '\n' }Down 18¢ since your last visit.</Text>
                    </View>
                </NativeGlassContainer>
            </View>}
            {index === 1 && <View style={styles.mapClip}>
                <MapView style={StyleSheet.absoluteFill} mapType="mutedStandard" userInterfaceStyle={isDark ? 'dark' : 'light'}
                    initialRegion={{ latitude: 37.7917, longitude: -122.4346, latitudeDelta: 0.0065, longitudeDelta: 0.009 }}
                    scrollEnabled={false} zoomEnabled={false} rotateEnabled={false} pitchEnabled={false}
                    showsCompass={false} showsScale={false} showsPointsOfInterest={false} toolbarEnabled={false}>
                    <Polyline coordinates={ROUTE} strokeColor="#FFFFFF" strokeWidth={8} />
                    <Polyline coordinates={ROUTE} strokeColor="#087FFF" strokeWidth={5} />
                    <Marker coordinate={ROUTE[0]} anchor={{ x: 0.5, y: 0.5 }}><View style={styles.startDot} /></Marker>
                    <Marker coordinate={STOP} anchor={{ x: 0.5, y: 1 }}>
                        <View style={styles.mapPin}><Text allowFontScaling={false} style={styles.mapPrice}>$3.09</Text><Text allowFontScaling={false} style={styles.mapSaving}>18¢ cheaper</Text></View>
                    </Marker>
                </MapView>
            </View>}
            {index === 2 && <View style={styles.chart}>
                <View style={styles.chartHeader}>
                    <View><Text allowFontScaling={false} style={[styles.station, { color: ink }]}>Shell</Text><Text allowFontScaling={false} style={[styles.stationDetail, { color: ink, opacity: 0.5 }]}>Your favorite station · Regular</Text></View>
                    <View style={styles.chartPrice}><Text allowFontScaling={false} style={[styles.value, { color: ink }]}>$3.09</Text><Text allowFontScaling={false} style={styles.low}>All-time low</Text></View>
                </View>
                <Svg width="100%" height={90} viewBox="0 0 320 90">
                    <Defs><LinearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor="#F79526" stopOpacity=".28"/><Stop offset="1" stopColor="#F79526" stopOpacity="0"/></LinearGradient></Defs>
                    <Line x1="0" y1="74" x2="320" y2="74" stroke={isDark ? '#ffffff20' : '#00000014'} />
                    <Path d="M0 18 C22 18 22 30 48 28 S74 8 96 24 S130 48 155 40 S188 28 210 48 S250 49 270 62 S294 73 312 74 L312 90 L0 90Z" fill="url(#chartFill)" />
                    <Path d="M0 18 C22 18 22 30 48 28 S74 8 96 24 S130 48 155 40 S188 28 210 48 S250 49 270 62 S294 73 312 74" fill="none" stroke="#EB8A1C" strokeWidth={3} />
                    <Circle cx="312" cy="74" r="5" fill="#FCAF3B" />
                </Svg>
            </View>}
        </View>
    </View>;
}
const styles = StyleSheet.create({
    canvas: { height: 166, width: '100%' },
    notificationStage: { flex: 1, justifyContent: 'center', paddingHorizontal: 12 },
    notification: { borderRadius: 26, padding: 14, flexDirection: 'row', gap: 10 },
    appIcon: { width: 32, height: 32, borderRadius: 8, marginTop: 2 },
    notificationCopy: { flex: 1 }, notificationTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
    appName: { fontSize: 13, fontWeight: '600' }, now: { fontSize: 12 },
    notificationTitle: { fontSize: 14, fontWeight: '600', marginBottom: 2 }, notificationBody: { fontSize: 13, lineHeight: 17 },
    mapClip: { flex: 1, margin: 8, borderRadius: 20, overflow: 'hidden' },
    startDot: { width: 15, height: 15, borderRadius: 8, backgroundColor: '#087FFF', borderColor: '#FFF', borderWidth: 3 },
    mapPin: { backgroundColor: '#FFFFFF', borderRadius: 13, paddingHorizontal: 12, paddingVertical: 6 },
    mapPrice: { fontSize: 20, fontWeight: '700', color: '#141414', textAlign: 'center' }, mapSaving: { fontSize: 10, fontWeight: '600', color: '#217545' },
    chart: { paddingHorizontal: 18, paddingTop: 12 }, chartHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    station: { fontSize: 17, fontWeight: '600' }, stationDetail: { fontSize: 10, marginTop: 3 }, chartPrice: { alignItems: 'flex-end' },
    value: { fontSize: 23, fontWeight: '700', letterSpacing: -0.7 }, low: { fontSize: 10, fontWeight: '600', color: '#BA6700', marginTop: 2 },
});
