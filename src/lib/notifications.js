import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Linking, Platform } from 'react-native';

let hasConfiguredNotificationHandler = false;
let hasConfiguredPredictiveCategory = false;

export const PREDICTIVE_NOTIFICATION_CATEGORY_ID = 'fuelup.predictive-recommendation';
export const PREDICTIVE_NOTIFICATION_ACTION_NAVIGATE = 'fuelup.predictive.navigate';
export const PREDICTIVE_NOTIFICATION_ACTION_DISMISS = 'fuelup.predictive.dismiss';

function ensureNotificationHandlerConfigured() {
    if (hasConfiguredNotificationHandler) {
        return;
    }

    try {
        Notifications.setNotificationHandler({
            handleNotification: async () => ({
                shouldShowAlert: true,
                shouldShowBanner: true,
                shouldShowList: true,
                shouldPlaySound: true,
                shouldSetBadge: false,
            }),
        });
        hasConfiguredNotificationHandler = true;
    } catch (error) {
        console.error('Failed to configure notification handler:', error);
    }
}

function getSupabaseClient() {
    try {
        const { supabase } = require('./supabase');
        return supabase || null;
    } catch (error) {
        console.error('Failed to load Supabase client:', error);
        return null;
    }
}

/**
 * Request notification permissions and get the raw APN device token on iOS (or FCM on Android).
 * This explicitly avoids Expo's Push service.
 * @returns {Promise<string|null>} The raw device push token.
 */
export async function registerForPushNotificationsAsync() {
    ensureNotificationHandlerConfigured();

    if (!Device.isDevice) {
        console.log('Must use physical device for Push Notifications');
        return null;
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
    }

    if (finalStatus !== 'granted') {
        console.log('Failed to get push token for push notification!');
        return null;
    }

    // Use the raw device push token rather than the Expo push token
    try {
        const tokenData = await Notifications.getDevicePushTokenAsync();
        let token = tokenData.data;

        // Sometimes raw APNs token is returned as an object depending on Expo version/config
        if (typeof token !== 'string') {
            token = String(token);
        }

        if (Platform.OS === 'android') {
            Notifications.setNotificationChannelAsync('default', {
                name: 'default',
                importance: Notifications.AndroidImportance.MAX,
                vibrationPattern: [0, 250, 250, 250],
                lightColor: '#FF231F7C',
            });
        }

        return token;
    } catch (error) {
        console.error('Core error getting push token:', error);
        return null;
    }
}

/**
 * Saves a push token to Supabase for the current user/device.
 * @param {string} token - The raw device push token.
 */
export async function savePushTokenToSupabase(token) {
    if (!token) return { success: false, error: 'No token' };
    const supabase = getSupabaseClient();
    if (!supabase) return { success: false, error: 'Supabase not configured' };

    try {
        const { data, error } = await supabase
            .from('push_tokens')
            .upsert({ token }, { onConflict: 'token' });

        if (error) {
            console.error('Error saving push token:', error);
            return { success: false, error: error.message };
        }

        return { success: true };
    } catch (err) {
        console.error('Exception saving push token:', err);
        return { success: false, error: err.message };
    }
}

export async function scheduleTestNotification(title, body, delaySeconds = 0) {
    ensureNotificationHandlerConfigured();

    const notificationConfig = {
        content: {
            title,
            body,
            sound: true,
        },
        trigger: delaySeconds > 0 ? {
            type: 'timeInterval',
            seconds: delaySeconds
        } : null,
    };

    await Notifications.scheduleNotificationAsync(notificationConfig);
}

export async function ensurePredictiveNotificationCategoryAsync() {
    ensureNotificationHandlerConfigured();

    if (hasConfiguredPredictiveCategory) {
        return;
    }

    await Notifications.setNotificationCategoryAsync(
        PREDICTIVE_NOTIFICATION_CATEGORY_ID,
        [
            {
                identifier: PREDICTIVE_NOTIFICATION_ACTION_NAVIGATE,
                buttonTitle: 'Navigate',
                options: {
                    opensAppToForeground: true,
                },
            },
            {
                identifier: PREDICTIVE_NOTIFICATION_ACTION_DISMISS,
                buttonTitle: 'Dismiss',
                options: {
                    isDestructive: true,
                },
            },
        ]
    );

    hasConfiguredPredictiveCategory = true;
}

export async function schedulePredictiveRecommendationNotification({
    title,
    body,
    station,
    recommendation,
    navigationApp,
}) {
    await ensurePredictiveNotificationCategoryAsync();

    if (
        !String(title || '').trim() ||
        !String(body || '').trim() ||
        !station?.stationId ||
        !recommendation?.stationId ||
        !String(navigationApp || '').trim()
    ) {
        throw new Error('Predictive recommendation notifications require complete real title, body, station, recommendation, and navigation app data.');
    }

    return Notifications.scheduleNotificationAsync({
        content: {
            title: String(title).trim(),
            body: String(body).trim(),
            sound: true,
            categoryIdentifier: PREDICTIVE_NOTIFICATION_CATEGORY_ID,
            data: {
                type: 'predictive-recommendation',
                station,
                recommendation,
                navigationApp: String(navigationApp).trim(),
            },
        },
        trigger: null,
    });
}

// ==========================================
// Live Activities (iOS 16.2+)
// ==========================================
//
// Our Live Activity has a single registered widget name
// (`PriceDropActivity`, declared in app.json and ios/ExpoWidgetsTarget/),
// but the layout itself takes rich "predictive fueling" props — station
// name, distance, ETA, progress, per-gallon savings, and so on.
//
// ──────────────────────────────────────────────────────────────────────
// Single-instance guarantee
// ──────────────────────────────────────────────────────────────────────
//
// iOS's ActivityKit does NOT enforce one-activity-per-type — calling
// `Activity.request()` twice happily creates two. We have three call
// sites that start activities (predictive runtime, drive simulator, dev
// screen legacy button), and if any of them lose track of their handle,
// we'd end up with a stale activity + a fresh one side by side.
//
// This module is the single authoritative owner of activity lifetime:
//
//   1. `trackedLiveActivityInstance` holds the one and only instance we
//      care about — the most recent successful start.
//   2. Before every start, `endAllLiveActivityInstances()` ends the
//      tracked instance AND every stray activity `getInstances()` hands
//      back (defensive: catches instances left over from a crashed
//      process, a previous runtime, or a race).
//   3. `pendingStartPromise` serializes concurrent start() calls. Two
//      back-to-back Start buttons are queued — the second waits for the
//      first to finish (including its dedup) before running.
//
// Callers (runtime, sim, dev screen, designer) NO LONGER need to track
// their own instance handle. They get back a LiveActivity object for
// convenience, but all the update/end paths go through the tracked
// singleton via `updateTrackedLiveActivity` / `endAllLiveActivities`.
//
// We expose two APIs:
//
//   startLiveActivity / updateLiveActivity — legacy, accepts just a
//     station name + price and fills in reasonable defaults for everything
//     else. Kept for the dev screen's simple start/update/end buttons.
//
//   startPredictiveLiveActivity / updatePredictiveLiveActivity — the
//     richer API used by the drive-simulation section and (eventually)
//     by the real recommender to paint the full layout.

let cachedPriceDropActivity = null;
let trackedLiveActivityInstance = null;
let pendingStartPromise = Promise.resolve(undefined);

function isMissingLiveActivityError(error) {
    const serializedError = [
        error?.message,
        error?.reason,
        error?.details,
        (() => {
            try {
                return JSON.stringify(error);
            } catch (serializationError) {
                return null;
            }
        })(),
        String(error || ''),
    ]
        .filter(Boolean)
        .join(' | ');

    return serializedError.includes("Can't find live activity with id");
}

function getPriceDropActivity() {
    if (cachedPriceDropActivity) {
        return cachedPriceDropActivity;
    }

    try {
        const loadedModule = require('./PriceDropActivity');
        cachedPriceDropActivity = loadedModule?.default || loadedModule;
        return cachedPriceDropActivity;
    } catch (error) {
        console.error('Failed to load PriceDropActivity module:', error);
        return null;
    }
}

function buildPredictiveProps(partial) {
    const stationName = String(partial?.stationName || '').trim();
    const subtitle = String(partial?.subtitle || '').trim();
    const priceValue = typeof partial?.price === 'string'
        ? Number(partial.price.replace(/^\$/, ''))
        : Number(partial?.price);
    const distanceMilesValue = Number(partial?.distanceMiles);
    const progressValue = Number(partial?.progress);
    const status = String(partial?.status || '').trim();
    const phase = String(partial?.phase || '').trim();
    const etaMinutesRaw = partial?.etaMinutes;
    const etaMinutes = etaMinutesRaw === '<1'
        ? '<1'
        : (etaMinutesRaw != null ? String(etaMinutesRaw).trim() : '');

    if (
        !stationName ||
        !Number.isFinite(priceValue) ||
        !Number.isFinite(distanceMilesValue) ||
        !Number.isFinite(progressValue) ||
        !status ||
        !phase ||
        !etaMinutes
    ) {
        throw new Error('Predictive Live Activity requires complete real station, pricing, distance, ETA, and status fields.');
    }

    return {
        stationName,
        subtitle,
        price: priceValue.toFixed(2),
        savingsPerGallon: partial?.savingsPerGallon != null
            ? String(partial.savingsPerGallon)
            : '',
        totalSavings: partial?.totalSavings != null
            ? String(partial.totalSavings)
            : '',
        distanceMiles: String(partial.distanceMiles),
        etaMinutes,
        progress: Math.max(0, Math.min(1, progressValue)),
        status,
        phase,
    };
}

/**
 * Ends every Live Activity instance this module knows about — the
 * tracked singleton AND every stray the factory hands back via
 * `getInstances()`. Called before every start and exposed publicly as
 * `endAllLiveActivities()` below.
 *
 * Never throws. Errors are logged and counted but never propagated —
 * the whole point is to be safe to call from any code path (including
 * start) without risking a cascading failure.
 *
 * @returns {Promise<{ ended: number, errors: number }>}
 */
async function endAllLiveActivityInstances() {
    if (Platform.OS !== 'ios') {
        return { ended: 0, errors: 0 };
    }

    const PriceDropActivity = getPriceDropActivity();
    if (!PriceDropActivity) {
        trackedLiveActivityInstance = null;
        return { ended: 0, errors: 0 };
    }

    // Collect into a Set so a tracked instance that also shows up in
    // getInstances() doesn't get .end()'d twice (the second call would
    // hit the "Can't find live activity with id" path, which is already
    // handled — but the Set keeps the logs clean).
    const instances = new Set();
    if (trackedLiveActivityInstance) {
        instances.add(trackedLiveActivityInstance);
    }

    if (typeof PriceDropActivity.getInstances === 'function') {
        try {
            const factoryInstances = PriceDropActivity.getInstances() || [];
            for (const instance of factoryInstances) {
                if (instance) instances.add(instance);
            }
        } catch (error) {
            // getInstances() is best-effort — if it fails we still end
            // the tracked instance below and let the start proceed.
            console.warn(
                'Failed to enumerate Live Activity instances; falling back to tracked instance only:',
                error?.message || error,
            );
        }
    }

    let ended = 0;
    let errors = 0;

    for (const instance of instances) {
        try {
            const result = instance.end();
            // LiveActivity.end() returns a Promise; await it so we know
            // when the native-side teardown has landed before we start
            // a replacement.
            if (result && typeof result.then === 'function') {
                await result;
            }
            ended += 1;
        } catch (error) {
            if (isMissingLiveActivityError(error)) {
                // Already gone — treat as success; that's the desired
                // state anyway.
                ended += 1;
                continue;
            }
            errors += 1;
            console.warn('Failed to end Live Activity instance:', error?.message || error);
        }
    }

    trackedLiveActivityInstance = null;
    return { ended, errors };
}

/**
 * Public: end every Live Activity this app has started (or that iOS
 * reports as still alive). Safe to call from any thread, on any
 * platform, at any time. No-op on non-iOS.
 *
 * @returns {Promise<{ ended: number, errors: number }>}
 */
export async function endAllLiveActivities() {
    if (Platform.OS !== 'ios') {
        return { ended: 0, errors: 0 };
    }
    return endAllLiveActivityInstances();
}

/**
 * Starts a Live Activity with rich predictive-fueling props.
 *
 * Before starting, ALL existing activities are ended — the tracked
 * singleton plus any strays the factory reports. Concurrent start()
 * calls are serialized through `pendingStartPromise` so a second
 * caller doesn't race ahead and accidentally end its own fresh start.
 *
 * @param {object} props — Complete predictive props with real values.
 * @returns {Promise<object|undefined>} The Live Activity instance, or
 *   undefined on non-iOS platforms, missing data, or if the widget
 *   module couldn't load.
 */
export function startPredictiveLiveActivity(props) {
    const next = pendingStartPromise.then(() => startPredictiveLiveActivityInternal(props));
    // Swallow rejections on the chained tail so the next queued start
    // is never skipped by an earlier failure. The caller still sees
    // the original promise (`next`) with any rejection intact.
    pendingStartPromise = next.catch(() => undefined);
    return next;
}

async function startPredictiveLiveActivityInternal(props) {
    if (Platform.OS !== 'ios') return undefined;
    const PriceDropActivity = getPriceDropActivity();
    if (!PriceDropActivity) return undefined;

    const fullProps = buildPredictiveProps(props || {});

    // Flush anything that's still alive — tracked instance, strays
    // from a previous process, leftovers from a crashed runtime.
    await endAllLiveActivityInstances();

    try {
        console.log('Starting predictive Live Activity:', fullProps);
        const instance = PriceDropActivity.start(fullProps);
        trackedLiveActivityInstance = instance;
        return instance;
    } catch (error) {
        console.error('Core error starting predictive Live Activity:', error);
        trackedLiveActivityInstance = null;
        return undefined;
    }
}

/**
 * Updates an active predictive Live Activity with new props.
 *
 * Kept for callers that still hold an instance handle; new code should
 * prefer `updateTrackedLiveActivity` which uses the singleton tracked
 * by this module.
 *
 * @param {object} instance — The instance returned by start.
 * @param {object} props — Complete predictive props with real values.
 */
export function updatePredictiveLiveActivity(instance, props) {
    if (Platform.OS !== 'ios' || !instance) return false;

    const fullProps = buildPredictiveProps(props || {});

    try {
        instance.update(fullProps);
        return true;
    } catch (error) {
        if (isMissingLiveActivityError(error)) {
            return false;
        }
        console.error('Error updating predictive Live Activity:', error);
        return false;
    }
}

/**
 * Updates the tracked Live Activity singleton, if one is alive. Returns
 * true if the update was dispatched, false if there's nothing to update
 * (caller should fall through to `startPredictiveLiveActivity`).
 *
 * This is the preferred update path — callers don't need to hold an
 * instance handle. The tracked instance is owned by notifications.js.
 *
 * @param {object} props — Complete predictive props with real values.
 * @returns {boolean}
 */
export function updateTrackedLiveActivity(props) {
    if (Platform.OS !== 'ios') return false;
    if (!trackedLiveActivityInstance) return false;

    return updatePredictiveLiveActivity(trackedLiveActivityInstance, props);
}

/**
 * Legacy wrapper — starts the activity with just a station name and price.
 * All the other fields get safe defaults so the layout still renders.
 * @param {string} stationName
 * @param {string} price
 * @returns {Promise<object|undefined>}
 */
export function startLiveActivity(stationName, price) {
    return startPredictiveLiveActivity({
        stationName,
        price,
        subtitle: 'FuelUp alert',
        savingsPerGallon: '0.20',
        totalSavings: '2.80',
        distanceMiles: '1.2',
        etaMinutes: '3',
        progress: 0.4,
        status: 'Approaching',
        phase: 'approaching',
    });
}

/**
 * Legacy wrapper — updates only the price on an existing activity.
 * @param {object} instance
 * @param {string} newPrice
 */
export function updateLiveActivity(instance, newPrice) {
    updatePredictiveLiveActivity(instance, {
        stationName: 'Wawa - Route 73',
        subtitle: 'FuelUp alert',
        price: newPrice,
        savingsPerGallon: '0.34',
        totalSavings: '4.76',
        distanceMiles: '0.6',
        etaMinutes: '2',
        progress: 0.7,
        status: 'Price just dropped',
        phase: 'approaching',
    });
}

/**
 * Ends the active Live Activity. The `instance` parameter is retained
 * for call-site compatibility but IGNORED — we end every activity
 * this module knows about, tracked singleton plus any strays. Callers
 * no longer need to hold a handle.
 *
 * @param {object} [_instance] — Ignored.
 * @returns {Promise<{ ended: number, errors: number }>}
 */
export function endLiveActivity(_instance) {
    return endAllLiveActivities();
}

// ──────────────────────────────────────────────────────────────────────
// Live Activity button interaction routing
// ──────────────────────────────────────────────────────────────────────
//
// When the user taps a Button inside the Live Activity (Navigate /
// Cancel), the widget extension fires a `LiveActivityUserInteraction`
// AppIntent. That intent doesn't do any work itself — it just emits a
// notification via `WidgetsEvents` carrying `{ source, target }`. The
// main app picks that up through `addUserInteractionListener` and is
// responsible for translating `target` into an actual action.
//
// We expose `addLiveActivityInteractionListener` as the single
// entry-point for wiring up those handlers. The simulator (and, later,
// the real predictive recommender) uses it to react when the driver
// taps Navigate or Cancel.

/**
 * Open a navigation URL for a station. Prefers Apple Maps since every
 * iOS device has it; callers can pass `{ prefer: 'google' }` to try
 * Google Maps first.
 *
 * @param {object} station
 * @param {string} station.name
 * @param {string} [station.subtitle]
 * @param {number} [station.latitude]
 * @param {number} [station.longitude]
 * @param {object} [options]
 * @param {'apple'|'google'} [options.prefer]
 * @returns {Promise<boolean>}
 */
export async function openNavigationForStation(station, options = {}) {
    if (!station) return false;

    // Google Maps deep-link if the user prefers it and the app is installed.
    if (options.prefer === 'google') {
        const query = station.latitude != null && station.longitude != null
            ? `${station.latitude},${station.longitude}`
            : encodeURIComponent(station.name || 'Gas station');
        const googleUrl = `comgooglemaps://?daddr=${query}&directionsmode=driving`;
        try {
            if (await Linking.canOpenURL(googleUrl)) {
                await Linking.openURL(googleUrl);
                return true;
            }
        } catch (error) {
            console.warn('openNavigationForStation: google link failed', error);
        }
    }

    // Apple Maps fallback: directions to a named query or a lat/lon.
    const params = [];
    if (station.latitude != null && station.longitude != null) {
        params.push(`daddr=${station.latitude},${station.longitude}`);
    }
    if (station.name) {
        params.push(`q=${encodeURIComponent(station.name)}`);
    }
    params.push('dirflg=d');
    const appleUrl = `maps://?${params.join('&')}`;
    try {
        await Linking.openURL(appleUrl);
        return true;
    } catch (error) {
        console.error('openNavigationForStation: apple link failed', error);
        return false;
    }
}

/**
 * Subscribe to button interaction events coming from the Live Activity.
 * Returns an unsubscribe function.
 *
 * @param {object} handlers
 * @param {() => void} [handlers.onNavigate] — fired when the user taps
 *   the Navigate button.
 * @param {() => void} [handlers.onCancel] — fired when the user taps
 *   the Cancel button.
 * @param {(target: string) => void} [handlers.onOther] — catch-all for
 *   any future button targets.
 * @returns {() => void} Unsubscribe function.
 */
export function addLiveActivityInteractionListener(handlers = {}) {
    if (Platform.OS !== 'ios') {
        return () => {};
    }

    let expoWidgets;
    try {
        expoWidgets = require('expo-widgets');
    } catch (error) {
        console.error('Failed to load expo-widgets for interaction listener:', error);
        return () => {};
    }

    if (typeof expoWidgets.addUserInteractionListener !== 'function') {
        return () => {};
    }

    // The button `target` prop is passed through verbatim from the JSX
    // via `<Button target="navigate" />`. We match on the EXACT target
    // string set in PriceDropActivity.tsx, but also accept any string
    // that includes the keyword in case the decorator prefix gets
    // appended (e.g. `__expo_widgets_target_0_navigate`).
    const subscription = expoWidgets.addUserInteractionListener((event) => {
        if (!event || event.source !== 'PriceDropActivity') {
            return;
        }
        const target = typeof event.target === 'string' ? event.target : '';

        if (target === 'navigate' || target.indexOf('navigate') !== -1) {
            if (typeof handlers.onNavigate === 'function') {
                try { handlers.onNavigate(); } catch (err) { console.error(err); }
            }
            return;
        }

        if (target === 'cancel' || target.indexOf('cancel') !== -1) {
            if (typeof handlers.onCancel === 'function') {
                try { handlers.onCancel(); } catch (err) { console.error(err); }
            }
            return;
        }

        if (typeof handlers.onOther === 'function') {
            try { handlers.onOther(target); } catch (err) { console.error(err); }
        }
    });

    return () => {
        try {
            if (subscription && typeof subscription.remove === 'function') {
                subscription.remove();
            }
        } catch (error) {
            console.error('Failed to remove Live Activity listener:', error);
        }
    };
}

export function addPredictiveNotificationResponseListener(listener) {
    ensureNotificationHandlerConfigured();

    const subscription = Notifications.addNotificationResponseReceivedListener(response => {
        const notificationData = response?.notification?.request?.content?.data || {};
        if (notificationData?.type !== 'predictive-recommendation') {
            return;
        }

        try {
            listener({
                actionIdentifier: response?.actionIdentifier || Notifications.DEFAULT_ACTION_IDENTIFIER,
                data: notificationData,
                notification: response?.notification || null,
            });
        } catch (error) {
            console.error('Predictive notification response listener failed:', error);
        }
    });

    return () => {
        try {
            subscription.remove();
        } catch (error) {
            console.error('Failed to remove predictive notification listener:', error);
        }
    };
}
