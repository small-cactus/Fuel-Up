import DrivingActivity from '../../modules/fuel-up-driving-activity';

export function setPriceWatch(stations, product) {
    return DrivingActivity?.setPriceWatchAsync?.(stations, product);
}

export function clearPriceWatch() { return setPriceWatch([], 'regular_gas'); }
