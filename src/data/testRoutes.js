// Denver-area gas station anchors (use these exact coordinates)
const DENVER_STATIONS = [
  { stationId: 'den-colfax-king-soopers', stationName: 'King Soopers Fuel', brand: 'King Soopers', latitude: 39.7388, longitude: -105.0827, price: 3.19, distanceMiles: 0 },
  { stationId: 'den-alameda-maverik', stationName: 'Maverik', brand: 'Maverik', latitude: 39.7131, longitude: -105.0169, price: 3.29, distanceMiles: 0 },
  { stationId: 'den-speer-sapp-bros', stationName: 'Sapp Bros', brand: 'Sapp Bros', latitude: 39.7399, longitude: -104.9938, price: 3.39, distanceMiles: 0 },
  { stationId: 'den-i70-pilot', stationName: 'Pilot Travel Center', brand: 'Pilot', latitude: 39.7468, longitude: -104.8002, price: 3.49, distanceMiles: 0 },
  { stationId: 'den-downing-shell', stationName: 'Shell', brand: 'Shell', latitude: 39.7385, longitude: -104.9726, price: 3.59, distanceMiles: 0 },
  { stationId: 'den-belleview-costco', stationName: 'Costco Gas', brand: 'Costco', latitude: 39.6128, longitude: -104.9872, price: 3.09, distanceMiles: 0 },
];

// 6 test routes
const TEST_ROUTES = [
  {
    id: 'den-approaching-colfax',
    name: 'Colfax → King Soopers',
    description: 'Straight westbound on Colfax approaching King Soopers fuel station',
    scenario: 'approaching',
    destinationStationId: 'den-colfax-king-soopers',
    expectsTrigger: true,
    waypoints: [
      // Starting at Colorado Blvd (~39.7388, -104.9990), heading west on Colfax to -105.0827
      { lat: 39.7388, lon: -104.9990, speedMph: 25 },
      { lat: 39.7388, lon: -105.0100, speedMph: 25 },
      { lat: 39.7388, lon: -105.0220, speedMph: 25 },
      { lat: 39.7388, lon: -105.0350, speedMph: 25 },
      { lat: 39.7388, lon: -105.0480, speedMph: 20 },
      { lat: 39.7388, lon: -105.0600, speedMph: 20 },
      { lat: 39.7388, lon: -105.0720, speedMph: 15 },
      { lat: 39.7388, lon: -105.0827, speedMph: 10 },
    ],
  },
  {
    id: 'den-passing-downtown-shell',
    name: 'Pass Downing Shell (no stop)',
    description: 'Driving east on Colfax, passing the Shell without stopping',
    scenario: 'passing',
    destinationStationId: null,
    expectsTrigger: false,
    waypoints: [
      // Start west of the Shell, drive east past it
      { lat: 39.7385, lon: -105.0100, speedMph: 30 },
      { lat: 39.7385, lon: -105.0000, speedMph: 30 },
      { lat: 39.7385, lon: -104.9900, speedMph: 30 },
      { lat: 39.7385, lon: -104.9726, speedMph: 30 }, // passing the station
      { lat: 39.7385, lon: -104.9600, speedMph: 30 },
      { lat: 39.7385, lon: -104.9500, speedMph: 30 },
      { lat: 39.7385, lon: -104.9400, speedMph: 30 },
      { lat: 39.7385, lon: -104.9300, speedMph: 30 },
    ],
  },
  {
    id: 'den-highway-i70-pilot',
    name: 'I-70 → Pilot Travel Center',
    description: 'Highway I-70 westbound, exit ramp into Pilot Travel Center',
    scenario: 'highway',
    destinationStationId: 'den-i70-pilot',
    expectsTrigger: true,
    waypoints: [
      // Start east of the Pilot on I-70, drive west, exit and slow down
      { lat: 39.7468, lon: -104.7500, speedMph: 65 },
      { lat: 39.7468, lon: -104.7650, speedMph: 65 },
      { lat: 39.7468, lon: -104.7800, speedMph: 55 },
      { lat: 39.7468, lon: -104.7900, speedMph: 40 },
      { lat: 39.7465, lon: -104.7950, speedMph: 30 },
      { lat: 39.7468, lon: -104.8000, speedMph: 15 },
      { lat: 39.7468, lon: -104.8002, speedMph: 10 },
    ],
  },
  {
    id: 'den-city-federal-maverik',
    name: 'Federal Blvd → Maverik',
    description: 'Northbound Federal then turn west toward Maverik on Alameda',
    scenario: 'city',
    destinationStationId: 'den-alameda-maverik',
    expectsTrigger: true,
    waypoints: [
      // Start south of Alameda on Federal, turn west toward Maverik
      { lat: 39.7000, lon: -105.0169, speedMph: 25 },
      { lat: 39.7050, lon: -105.0169, speedMph: 25 },
      { lat: 39.7100, lon: -105.0169, speedMph: 25 },
      { lat: 39.7131, lon: -105.0169, speedMph: 20 }, // turn west on Alameda
      { lat: 39.7131, lon: -105.0220, speedMph: 20 },
      { lat: 39.7131, lon: -105.0280, speedMph: 15 },
      { lat: 39.7131, lon: -105.0169, speedMph: 10 }, // arriving
    ],
  },
  {
    id: 'den-detour-belleview-costco',
    name: 'Detour → Costco Gas',
    description: 'Initial detour away from Costco, then reroute back toward it',
    scenario: 'detour',
    destinationStationId: 'den-belleview-costco',
    expectsTrigger: true,
    waypoints: [
      // Start away from Costco heading wrong direction, then turn toward it
      { lat: 39.6300, lon: -104.9872, speedMph: 30 }, // north of station, heading north (away)
      { lat: 39.6250, lon: -104.9872, speedMph: 30 }, // still heading north
      { lat: 39.6200, lon: -104.9872, speedMph: 25 }, // turning
      { lat: 39.6170, lon: -104.9872, speedMph: 20 }, // now heading south toward station
      { lat: 39.6150, lon: -104.9872, speedMph: 20 },
      { lat: 39.6135, lon: -104.9872, speedMph: 15 },
      { lat: 39.6128, lon: -104.9872, speedMph: 10 }, // arriving at Costco
    ],
  },
  {
    id: 'den-parallel-speer',
    name: 'Parallel to Sapp Bros (no approach)',
    description: 'Driving parallel one block away from Sapp Bros — should NOT trigger',
    scenario: 'parallel',
    destinationStationId: null,
    expectsTrigger: false,
    waypoints: [
      // Drive parallel to Speer, station is off to the side ~0.25 miles
      { lat: 39.7350, lon: -105.0100, speedMph: 30 },
      { lat: 39.7360, lon: -105.0020, speedMph: 30 },
      { lat: 39.7370, lon: -104.9960, speedMph: 30 },
      { lat: 39.7380, lon: -104.9900, speedMph: 30 }, // station is to the north at 39.7399
      { lat: 39.7385, lon: -104.9840, speedMph: 30 },
      { lat: 39.7388, lon: -104.9780, speedMph: 30 },
      { lat: 39.7390, lon: -104.9720, speedMph: 30 },
      { lat: 39.7392, lon: -104.9660, speedMph: 30 },
    ],
  },
];

module.exports = { TEST_ROUTES, DENVER_STATIONS };
