"""Causal raw selected-grade histories for the one-shot research prompt."""
from datetime import datetime


def milliseconds(value):
    return int(datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp() * 1000)


def station_histories(rows, batch_id, candidates):
    timestamp, lat, lon, fuel, payment = batch_id.split('|')
    cutoff = milliseconds(timestamp)
    recent = sorted((row for row in rows
        if cutoff - 14 * 24 * 3600000 <= milliseconds(row['created_at']) < cutoff
        and row['provider_id'] == 'gasbuddy' and row['fuel_type'] == fuel
        and float(row['search_latitude_rounded']) == float(lat)
        and float(row['search_longitude_rounded']) == float(lon)),
        key=lambda row: (milliseconds(row['created_at']), str(row['id'])))[-1500:]
    events, conflicts = {}, set()
    wanted = set(candidates)
    for row in recent:
        station = str(row['station_id'])
        if station not in wanted:
            continue
        quote = row.get('all_prices', {}).get('_payment', {}).get(fuel, {})
        method = 'credit' if (quote.get('credit') or 0) > 0 else 'cash'
        price = quote.get(method)
        if method != payment or not isinstance(price, (int, float)) or price <= 0:
            continue
        try:
            source = milliseconds(row['updated_at_source'])
        except (ValueError, TypeError, AttributeError):
            continue
        observed = milliseconds(row['created_at'])
        if source > observed + 5 * 60000:
            continue
        key = (station, source)
        if key in events:
            if events[key]['price'] != price:
                conflicts.add(key)
            events[key]['last'] = observed
            events[key]['observations'] += 1
        else:
            events[key] = {'price': price, 'first': observed, 'last': observed, 'observations': 1}
    result = {}
    for station in candidates:
        reports = sorted(((source, event) for (ident, source), event in events.items()
            if ident == station and (ident, source) not in conflicts), key=lambda pair: pair[1]['first'])
        result[station] = {
            'independent_reports_available': len(reports),
            'reports': [{'price': event['price'],
                'source_age_hours': (cutoff - source) / 3600000,
                'first_seen_age_hours': (cutoff - event['first']) / 3600000,
                'last_seen_age_hours': (cutoff - event['last']) / 3600000,
                'cache_observations': event['observations']}
                for source, event in reports[-8:]]}
    return result
