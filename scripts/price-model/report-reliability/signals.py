"""Causal report history and explicitly unverified, future-confirmed labels."""
import numpy as np


def history_features(p, s, o, station, product, t):
    """Vectorized batch: history ends at t, including current available report."""
    h = t[:, None] - np.arange(48, -1, -1)[None, :]
    ix = np.maximum(h, 0)
    price = p[ix, station[:, None], product[:, None]].copy()
    source = s[ix, station[:, None], product[:, None]].copy()
    seen = o[ix, station[:, None]]
    valid = (h >= 0) & np.isfinite(seen) & np.isfinite(source) & (source <= seen + 5/60) & (price > 0)
    price[~valid] = np.nan
    source[~valid] = np.nan
    # Carry the last available observation across archive gaps, without filling prices in the dataset.
    prev = np.maximum.accumulate(np.where(valid, np.arange(49), -1), axis=1)
    left = prev[:, :-1]
    row = np.arange(len(t))[:, None]
    last_price = price[row, np.maximum(left, 0)]
    last_source = source[row, np.maximum(left, 0)]
    last_seen = seen[row, np.maximum(left, 0)]
    pair = valid[:, 1:] & (left >= 0)
    dp = price[:, 1:] - last_price
    ds = source[:, 1:] - last_source
    new = pair & (ds > 5/60)
    unchanged = new & (abs(dp) < .005)
    at = o[t, station]
    names, values = [], []
    def add(name, value):
        names.append(name); values.append(value.astype('float32'))
    for hours in (6, 24, 48):
        recent = (at[:, None] - seen[:, 1:] <= hours) & pair
        updates = new & recent
        same = unchanged & recent
        count = updates.sum(1)
        add(f'refresh_count_{hours}', count)
        add(f'unchanged_refresh_count_{hours}', same.sum(1))
        add(f'unchanged_refresh_fraction_{hours}', same.sum(1)/np.maximum(count, 1))
        add(f'source_rollback_count_{hours}', (recent & (ds < -5/60)).sum(1))
    # Variation in report intervals, not hourly repeated observations.
    interval = np.where(new, ds, np.nan)
    with np.errstate(invalid='ignore', divide='ignore'):
        mean = np.nanmean(interval, axis=1)
        cv = np.nanstd(interval, axis=1)/np.maximum(mean, .01)
    add('report_interval_mean', mean)
    add('report_interval_cv', cv)
    add('observed_history_hours', at - np.nanmin(np.where(valid, seen, np.nan), axis=1))
    add('archive_observation_count', valid.sum(1))
    # Price-changing refreshes with a preceding observation within two hours.
    add('recent_large_refresh_count', (new & (abs(dp) >= .09999) & (at[:, None]-seen[:, 1:] <= 24)).sum(1))
    add('rapid_timestamp_advances', (new & (ds < 1) & (seen[:, 1:]-last_seen <= 2)).sum(1))
    return names, np.stack(values, axis=1)


def corroborated_labels(p, s, o, station, product, t):
    """First later report, then first newer report >=1 observed hour later, within 24h.

    Return label -1 for unknown, completion time, and both future prices.
    Never treat lack of a correction as evidence that the original was correct.
    """
    n = len(t); at = o[t, station]; raw = p[t, station, product]; src = s[t, station, product]
    first = np.full(n, np.nan); first_s = first.copy(); first_at = first.copy()
    second = first.copy(); end = first.copy()
    for lag in range(1, 25):
        u = t + lag; ix = np.minimum(u, len(p)-1)
        price = p[ix, station, product]; source = s[ix, station, product]; seen = o[ix, station]
        valid = (u < len(p)) & np.isfinite(seen) & (seen > at) & (seen-at <= 24) & (price > 0) & np.isfinite(source) & (source <= seen+5/60)
        take_second = valid & np.isfinite(first) & ~np.isfinite(second) & (source > first_s+5/60) & (seen-first_at >= 1)
        second[take_second] = price[take_second]; end[take_second] = seen[take_second]
        take_first = valid & ~np.isfinite(first) & (source > src+5/60)
        first[take_first] = price[take_first]; first_s[take_first] = source[take_first]; first_at[take_first] = seen[take_first]
    a = first-raw; b = second-raw
    label = np.full(n, -1, dtype='int8')
    stable = (abs(a) <= .03001) & (abs(b) <= .03001)
    correction = (abs(a-b) <= .03001) & (abs(a) >= .09999) & (abs(b) >= .09999) & (a*b > 0)
    label[stable] = 0; label[correction] = 1
    return label, end, first, second


def split(at, end):
    result = np.full(len(at), -1, dtype='int8')
    result[(at < 48) & (end < 48)] = 0
    result[(at >= 48) & (at < 60) & (end < 60)] = 1
    result[(at >= 60) & np.isfinite(end)] = 2
    return result


def agreement_features(X, names):
    get = lambda name: X[:, names.index(name)]
    peer = get('peer_offset_adjusted_24')
    residuals = np.stack([get(f'product_{j}_spread_residual') for j in range(8)], axis=1)
    supported = abs(residuals) >= .09999
    positive = (residuals >= .09999).sum(1); negative = (residuals <= -.09999).sum(1)
    sign = np.sign(positive-negative)
    values = [np.maximum(positive, negative), (positive > 0) & (negative > 0),
              sign*np.nanmedian(abs(residuals), axis=1),
              (np.sign(peer) == sign) & (abs(peer) >= .09999) & supported.any(1),
              abs(get('last_actual_change')-get('peer_mean_change_6')),
              abs(peer)/(get('own_mad_24')+.02)]
    return ['cross_product_agreement_count','cross_product_conflict','signed_cross_product_deviation',
            'peer_and_product_agree','isolated_jump_size','peer_deviation_scaled'], np.stack(values,axis=1).astype('float32')
