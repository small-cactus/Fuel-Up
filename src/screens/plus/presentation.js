export const PLUS_ANNUAL_PRICE = '$19.99';
export const plusPalette = isDark => ({
    accent: isDark ? '#FFB052' : '#A84800',
    button: '#B94E00',
    surface: isDark ? '#191919' : '#FFFFFF',
    illustration: isDark ? '#251C13' : '#FFF1DF',
    road: isDark ? '#4B3925' : '#E6D1B6',
    route: isDark ? '#FFA94D' : '#D86A08',
    green: isDark ? '#84DDA7' : '#18733C',
    secondary: isDark ? '#B6B6BC' : '#626268',
});

export const PLUS_FEATURES = [
    { icon: 'bell.badge', title: 'Catch the price drop', detail: 'A timely heads-up when gas prices fall.' },
    { icon: 'point.topleft.down.to.point.bottomright.curvepath', title: 'Fuel up along your way', detail: 'Route-aware reminders that fit your drive.' },
    { icon: 'heart', title: 'Keep an eye on your station', detail: 'Follow price changes at a specific favorite.' },
];
