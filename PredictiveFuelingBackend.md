# Predictive Fueling Backend

This runtime is the app-side background backend for predictive fueling.

## What it does

1. Subscribes to background location updates from `expo-location`.
2. Builds a route-aware ahead snapshot with Apple Maps routing plus the existing fuel snapshot service.
3. Feeds the merged station set into the predictive recommender.
4. Keeps pending recommendations quiet until the driver reaches a safer attention window.
5. Starts and updates the Live Activity while a recommendation is on the way.
6. Fires a local actionable notification only when the recommendation is ready to surface.
7. Syncs geofences around likely stations so the app can learn real stop behavior.
8. Records dwell-based station visits and inferred fill-ups back into the user profile.

## Main modules

- `src/lib/predictiveFuelingBackend.js`
  Connects the runtime to background location, geofences, notification responses, and Live Activity interactions.

- `src/lib/predictiveFuelingRuntime.js`
  Owns the state machine:
  location payload -> ahead fetch -> recommender -> pending/active recommendation -> notification/live activity/geofence actions.

- `src/lib/predictiveFuelingProfileStore.js`
  Persists learned visit history, inferred fill-up history, odometer, and miles-since-last-fill.

- `src/lib/predictiveFuelingStateStore.js`
  Persists recent samples, known stations, pending/active recommendation state, live activity focus state, and geofence state.

- `src/lib/notifications.js`
  Exposes the predictive notification category, actionable notification scheduling, and response listeners.

## Recommendation lifecycle

1. Background location arrives.
2. The runtime updates mileage and the rolling location window.
3. The trajectory prefetch controller fetches current plus ahead-route stations.
4. The recommender scores the route-aware station set.
5. If the recommendation is still too distracting to show, it becomes `pending`.
6. A pending recommendation starts or updates the Live Activity and focus geofence, but does not notify yet.
7. Once the recommender reaches a stop-light or otherwise safe presentation window, the recommendation becomes `active`.
8. Active recommendations trigger a local notification with `Navigate` and `Dismiss`.
9. Geofence enter/exit events around stations are used to infer actual visits and longer fuel-stop dwell events.
10. Those learned visits and inferred fill-ups are written back into the profile so later recommendations are less cold-started.

## Learning model

The runtime learns from passive behavior rather than requiring a manual trip backend:

- Any long enough station dwell counts as a visit.
- Longer dwell near a station is treated as an inferred fill-up.
- Visits update station history and preferred brand affinity.
- Inferred fill-ups reset `estimatedMilesSinceLastFill` and append a new fill history row.

This gives the recommender the real-world inputs it was previously missing:

- visit history
- fill-up cadence
- miles since last fill
- evolving brand preference

## Attention model

The runtime does not notify as soon as it finds a good station.

It waits for the recommender's presentation plan to decide the recommendation is safely glanceable. In practice that means:

- keep quiet during high-demand driving
- keep quiet in complex maneuvers
- keep quiet in gridlock
- surface during traffic-light style pauses or other low-demand windows

## Action handling

- Live Activity `Navigate` opens Apple Maps by default, or Google Maps when the user prefers it.
- Live Activity `Cancel` suppresses the current station and clears the focus state.
- Notification `Navigate` routes the same way.
- Notification `Dismiss` suppresses the station for a cooldown so it does not immediately re-fire.
