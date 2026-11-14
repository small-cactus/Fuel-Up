# Profiling Analysis — 80.3s session
**React Compiler:** ✗  **Hot commits:** 7 of 77 total

> **Duration columns:** `self` = this component's own render work only (exclusive).
> `w/children` = self + the entire subtree it owns (inclusive).
> Do not sum the `w/children` column — a parent's inclusive time already contains its
> children's time. Use `self` for summing; use `w/children` to understand container cost.

---
## Slow React Batches

### Commit #2 — 22.88ms 🟡 (t=38.2s)
> 🟡 May be acceptable in production (dev mode is ~3× slower)

**Root cause:** `SettingsLink` re-rendered — props: onPress

Render cascade:
- `SettingsLink` ×6 — 2.3ms self, 3.96ms w/children — props: onPress
- `TrendsScreen(./(tabs)/trends.js)` — 1.45ms self, 9.71ms w/children — context changed
- `Text` ×55 — 1.16ms self, 2.73ms w/children — props: style
- `TextView` ×50 — 0.82ms self, 1.47ms w/children — props: modifiers, onGlobalEvent
- `TrendLeaderboard` — 0.67ms self, 5.07ms w/children — parent re-render
- `View` ×23 — 0.61ms self, 74.53ms w/children — props: style, children
- `HStack` ×38 — 0.61ms self, 8.87ms w/children — props: modifiers, children
- `Image` ×24 — 0.58ms self, 0.89ms w/children — props: style
- `NativeStackNavigator` — 0.57ms self, 21.42ms w/children — props: screenOptions, children
- `HStackView` ×38 — 0.56ms self, 8.27ms w/children — props: modifiers, onGlobalEvent, children
- `Anonymous` [forwardRef] — 0.44ms self, 21.88ms w/children — props: screenOptions, children
- `SceneView` ×2 — 0.41ms self, 39.11ms w/children — props: screen, options, clearOptions
- `NativeSettingsForm` — 0.38ms self, 6.17ms w/children — props: onRadiusChange, onPriceAlertsChange, onEditFuel
- `SlotView` ×26 — 0.37ms self, 6.92ms w/children — props: children
- `ObservedPriceChart` — 0.37ms self, 0.85ms w/children — parent re-render
- _... and 75 more_
- _Shown: 11.3ms self / 22.88ms commit (49%) — 75 more components not shown. Use `profiler-commit-query mode=by_index commit_index=2` to see all._

**CPU during this commit:**
- `structuredCloneInternal` self=15.01ms total=15.01ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:40404)
- `[Host Function] reportMeasure` self=7.01ms total=7.01ms ([host]:0)

### Commit #3 — 0.76ms 🔵 (t=38.2s, margin)

- `HomeScreen` — 0.25ms self, 0.76ms w/children — hooks: useContext
- `Image` — 0.06ms self, 0.11ms w/children — props: style
- `View` ×3 — 0.06ms self, 0.73ms w/children — props: style, children
- `ProgressiveBlurView` — 0.04ms self, 0.05ms w/children — props: style
- `FuelUpMapKitRouting` — 0.03ms self, 0.18ms w/children — props: origin, stations, onStationSelect
- `TopCanopy` — 0.03ms self, 0.1ms w/children — parent re-render
- `ImageAnalyticsTagContext.Consumer` — 0.02ms self, 0.04ms w/children — (mount)
- `FuelUpHeaderLogo` — 0.02ms self, 0.12ms w/children — parent re-render
- _Shown: 0.5ms self / 0.76ms commit (67% explained by self-time — remainder is native/layout work outside JS)_

### Commit #13 — 17.41ms 🟡 (t=46.2s)
> 🟡 May be acceptable in production (dev mode is ~3× slower)

**Root cause:** `Slot` re-rendered — props: children

Render cascade:
- `Slot` ×26 — 1.62ms self, 7.34ms w/children — props: children
- `Text` ×55 — 1.09ms self, 2.5ms w/children — props: style
- `TrendsScreen(./(tabs)/trends.js)` — 0.73ms self, 7.52ms w/children — context changed
- `TextView` ×50 — 0.71ms self, 1.32ms w/children — props: modifiers, onGlobalEvent
- `TrendLeaderboard` — 0.6ms self, 4.73ms w/children — parent re-render
- `HStack` ×38 — 0.55ms self, 8.36ms w/children — props: modifiers, children
- `HStackView` ×38 — 0.54ms self, 7.81ms w/children — props: modifiers, onGlobalEvent, children
- `NativeStackNavigator` — 0.52ms self, 16.77ms w/children — props: screenOptions, children
- `Image` ×24 — 0.49ms self, 0.77ms w/children — props: style
- `View` ×23 — 0.42ms self, 60.26ms w/children — props: style, children
- `SlotView` ×26 — 0.35ms self, 5.72ms w/children — props: children
- `SceneView` ×2 — 0.32ms self, 30.3ms w/children — props: screen, options, clearOptions
- `NativeSettingsForm` — 0.28ms self, 5ms w/children — props: onRadiusChange, onPriceAlertsChange, onEditFuel
- `VStack` ×16 — 0.24ms self, 11.21ms w/children — props: children
- `VStackView` ×16 — 0.24ms self, 10.97ms w/children — props: children
- _... and 75 more_
- _Shown: 8.7ms self / 17.41ms commit (50%) — 75 more components not shown. Use `profiler-commit-query mode=by_index commit_index=13` to see all._

**CPU during this commit:**
- `fiber_renderer_arrayWithoutHoles` self=9.03ms total=9.03ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:54349)

### Commit #14 — 0.68ms 🔵 (t=46.2s, margin)

- `HomeScreen` — 0.2ms self, 0.68ms w/children — hooks: useContext
- `View` ×3 — 0.06ms self, 0.67ms w/children — props: style, children
- `Image` — 0.06ms self, 0.1ms w/children — props: style
- `FuelUpMapKitRouting` — 0.03ms self, 0.18ms w/children — props: origin, stations, onStationSelect
- `TopCanopy` — 0.03ms self, 0.09ms w/children — parent re-render
- `ProgressiveBlurView` — 0.02ms self, 0.03ms w/children — props: style
- `ImageAnalyticsTagContext.Consumer` — 0.02ms self, 0.04ms w/children — (mount)
- `FuelUpHeaderLogo` — 0.01ms self, 0.11ms w/children — parent re-render
- _Shown: 0.4ms self / 0.68ms commit (63% explained by self-time — remainder is native/layout work outside JS)_

### Commit #26 — 17.37ms 🟡 (t=55.3s)
> 🟡 May be acceptable in production (dev mode is ~3× slower)

**Root cause:** `SlotView` re-rendered — props: children

Render cascade:
- `SlotView` ×26 — 1.91ms self, 7.53ms w/children — props: children
- `Text` ×55 — 1.1ms self, 2.56ms w/children — props: style
- `TextView` ×50 — 0.73ms self, 1.36ms w/children — props: modifiers, onGlobalEvent
- `TrendsScreen(./(tabs)/trends.js)` — 0.68ms self, 7.68ms w/children — context changed
- `TrendLeaderboard` — 0.59ms self, 4.87ms w/children — parent re-render
- `HStackView` ×38 — 0.57ms self, 8.17ms w/children — props: modifiers, onGlobalEvent, children
- `HStack` ×38 — 0.55ms self, 8.72ms w/children — props: modifiers, children
- `Image` ×24 — 0.51ms self, 0.79ms w/children — props: style
- `View` ×23 — 0.4ms self, 61.76ms w/children — props: style, children
- `NativeStackNavigator` — 0.4ms self, 16.74ms w/children — props: screenOptions, children
- `Slot` ×26 — 0.31ms self, 7.84ms w/children — props: children
- `NativeSettingsForm` — 0.29ms self, 5.25ms w/children — props: onRadiusChange, onPriceAlertsChange, onEditFuel
- `SceneView` ×2 — 0.26ms self, 30.82ms w/children — props: screen, options, clearOptions
- `VStack` ×16 — 0.25ms self, 11.65ms w/children — props: children
- `VStackView` ×16 — 0.24ms self, 11.4ms w/children — props: children
- _... and 75 more_
- _Shown: 8.8ms self / 17.37ms commit (51%) — 75 more components not shown. Use `profiler-commit-query mode=by_index commit_index=26` to see all._

**CPU during this commit:**
- `recordProfilingDurations` self=9.95ms total=9.95ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:56612)
- `structuredCloneInternal` self=7.42ms total=7.42ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:40404)

### Commit #27 — 0.65ms 🔵 (t=55.3s, margin)

- `HomeScreen` — 0.2ms self, 0.65ms w/children — hooks: useContext
- `View` ×3 — 0.06ms self, 0.64ms w/children — props: style, children
- `Image` — 0.06ms self, 0.1ms w/children — props: style
- `FuelUpMapKitRouting` — 0.03ms self, 0.16ms w/children — props: origin, stations, onStationSelect
- `TopCanopy` — 0.02ms self, 0.08ms w/children — parent re-render
- `ProgressiveBlurView` — 0.02ms self, 0.03ms w/children — props: style
- `ImageAnalyticsTagContext.Consumer` — 0.02ms self, 0.04ms w/children — (mount)
- `FuelUpHeaderLogo` — 0.02ms self, 0.11ms w/children — parent re-render
- _Shown: 0.4ms self / 0.65ms commit (66% explained by self-time — remainder is native/layout work outside JS)_

### Commit #39 — 16.27ms 🟡 (t=63.3s)
> 🟡 May be acceptable in production (dev mode is ~3× slower)

**Root cause:** `Text` re-rendered — props: style

Render cascade:
- `Text` ×55 — 2.01ms self, 3.43ms w/children — props: style
- `TextView` ×50 — 0.71ms self, 1.33ms w/children — props: modifiers, onGlobalEvent
- `TrendLeaderboard` — 0.69ms self, 4.88ms w/children — parent re-render
- `TrendsScreen(./(tabs)/trends.js)` — 0.63ms self, 8.61ms w/children — context changed
- `HStack` ×38 — 0.55ms self, 8.33ms w/children — props: modifiers, children
- `HStackView` ×38 — 0.54ms self, 7.78ms w/children — props: modifiers, onGlobalEvent, children
- `Image` ×24 — 0.46ms self, 0.74ms w/children — props: style
- `View` ×23 — 0.41ms self, 61.93ms w/children — props: style, children
- `NativeSettingsForm` — 0.37ms self, 3.63ms w/children — props: onRadiusChange, onPriceAlertsChange, onEditFuel
- `SlotView` ×26 — 0.36ms self, 4.26ms w/children — props: children
- `NativeStackNavigator` — 0.29ms self, 15.75ms w/children — props: screenOptions, children
- `Slot` ×26 — 0.29ms self, 4.55ms w/children — props: children
- `VStackView` ×16 — 0.26ms self, 11.03ms w/children — props: children
- `ObservedPriceChart` — 0.26ms self, 0.62ms w/children — parent re-render
- `VStack` ×16 — 0.25ms self, 11.28ms w/children — props: children
- _... and 75 more_
- _Shown: 8.1ms self / 16.27ms commit (50%) — 75 more components not shown. Use `profiler-commit-query mode=by_index commit_index=39` to see all._

**CPU during this commit:**
- `updateVirtualChildrenRecursively` self=7.84ms total=7.84ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:56764)
- `[Host Function] completeRoot` self=4.32ms total=4.32ms ([host]:0)
- `[GC Young Gen]` self=4.11ms total=4.11ms ([suspended]:0)

### Commit #40 — 2.97ms 🔵 (t=63.4s, margin)

- `HomeScreen` — 2.53ms self, 2.97ms w/children — hooks: useContext
- `View` ×3 — 0.07ms self, 0.64ms w/children — props: style, children
- `Image` — 0.06ms self, 0.1ms w/children — props: style
- `FuelUpMapKitRouting` — 0.03ms self, 0.15ms w/children — props: origin, stations, onStationSelect
- `TopCanopy` — 0.02ms self, 0.08ms w/children — parent re-render
- `ProgressiveBlurView` — 0.02ms self, 0.03ms w/children — props: style
- `ImageAnalyticsTagContext.Consumer` — 0.02ms self, 0.04ms w/children — (mount)
- `FuelUpHeaderLogo` — 0.01ms self, 0.11ms w/children — parent re-render

### Commit #50 — 16.23ms 🟡 (t=71.4s)
> 🟡 May be acceptable in production (dev mode is ~3× slower)

**Root cause:** `View` re-rendered — props: style, children

Render cascade:
- `TrendLeaderboardSkeleton` — 1.27ms self, 3.86ms w/children — (mount)
- `View` ×46 — 0.97ms self, 67.33ms w/children — props: style, children
- `TrendsScreen(./(tabs)/trends.js)` — 0.48ms self, 8.2ms w/children — context changed
- `Image` ×10 — 0.35ms self, 0.63ms w/children — props: style
- `SlotView` ×26 — 0.35ms self, 4.31ms w/children — props: children
- `NativeStackNavigator` — 0.33ms self, 15.64ms w/children — props: screenOptions, children
- `NativeSettingsForm` — 0.33ms self, 3.63ms w/children — props: onRadiusChange, onPriceAlertsChange, onEditFuel
- `Slot` ×26 — 0.29ms self, 4.6ms w/children — props: children
- `Text` ×14 — 0.29ms self, 0.63ms w/children — props: style
- `SceneView` ×2 — 0.24ms self, 28.9ms w/children — props: screen, options, clearOptions
- `Button` ×16 — 0.22ms self, 2.94ms w/children — props: onButtonPress, children
- `SettingsLink` ×6 — 0.2ms self, 1.66ms w/children — props: onPress
- `Animated(Anonymous)` — 0.2ms self, 14.41ms w/children — props: sheetAllowedDetents, onHeaderHeightChange, onWillAppear
- `TextView` ×13 — 0.18ms self, 0.32ms w/children — props: modifiers, onGlobalEvent
- `HomeScreen` — 0.18ms self, 1.2ms w/children — context changed
- _... and 67 more_
- _Shown: 5.9ms self / 16.23ms commit (36%) — 67 more components not shown. Use `profiler-commit-query mode=by_index commit_index=50` to see all._

**CPU during this commit:**
- `[GC Young Gen]` self=8.96ms total=8.96ms ([suspended]:0)
- `[Native] arrayFrom` self=5.09ms total=5.09ms ([native]:0)
- `[GC Young Gen]` self=1.46ms total=1.46ms ([suspended]:0)
- `walk` self=0.71ms total=0.71ms

### Commit #51 — 3.34ms 🔵 (t=71.4s, margin)

- `View` ×40 — 0.72ms self, 11.86ms w/children — props: style, children
- `TrendsScreen(./(tabs)/trends.js)` — 0.34ms self, 3.34ms w/children — hooks: useRef
- `HomeScreen` — 0.26ms self, 0.8ms w/children — hooks: useContext
- `Animated(View)` — 0.18ms self, 0.71ms w/children — (mount)
- `Image` ×3 — 0.14ms self, 0.22ms w/children — props: style
- `LinearGradient` ×2 — 0.12ms self, 0.47ms w/children — props: start, end
- `TrendLeaderboardSkeleton` — 0.12ms self, 0.73ms w/children — parent re-render
- `Text` ×4 — 0.09ms self, 0.18ms w/children — props: style
- `ScrollView` ×2 — 0.09ms self, 3.63ms w/children — props: contentContainerStyle, refreshControl, children
- `TrendScopeControl` — 0.08ms self, 0.51ms w/children — parent re-render
- `TopCanopy` ×2 — 0.05ms self, 0.17ms w/children — parent re-render
- `ExpoLinearGradient` ×2 — 0.05ms self, 0.35ms w/children — props: colors, startPoint, endPoint
- `TextView` ×3 — 0.04ms self, 0.08ms w/children — props: modifiers, onGlobalEvent
- `FuelUpMapKitRouting` — 0.04ms self, 0.19ms w/children — props: origin, stations, onStationSelect
- `ProgressiveBlurView` ×2 — 0.04ms self, 0.06ms w/children — props: style
- _... and 16 more_
- _Shown: 2.4ms self / 3.34ms commit (71%) — 16 more components not shown. Use `profiler-commit-query mode=by_index commit_index=51` to see all._

### Commit #52 — 23.52ms 🟡 (t=71.4s)
> 🟡 May be acceptable in production (dev mode is ~3× slower)

**Root cause:** `HStackView` re-rendered — props: modifiers, onGlobalEvent, children

Render cascade:
- `HStackView` ×32 — 2.85ms self, 32.76ms w/children — props: modifiers, onGlobalEvent, children
- `Text` ×45 — 1.09ms self, 7.34ms w/children — props: style
- `TextView` ×40 — 0.86ms self, 5.11ms w/children — props: modifiers, onGlobalEvent
- `TrendsScreen(./(tabs)/trends.js)` — 0.74ms self, 23.52ms w/children — hooks: useMemo, useEffect
- `TrendLeaderboard` — 0.74ms self, 17.04ms w/children — (mount)
- `HStack` ×32 — 0.56ms self, 33.31ms w/children — props: modifiers, children
- `Image` ×16 — 0.41ms self, 1.75ms w/children — parent re-render
- `VStackView` ×16 — 0.36ms self, 44.19ms w/children — (mount)
- `ImageView` ×14 — 0.31ms self, 1.29ms w/children — (mount)
- `View` ×14 — 0.31ms self, 94.2ms w/children — props: style
- `VStack` ×16 — 0.29ms self, 44.48ms w/children — (mount)
- `ObservedPriceChart` — 0.27ms self, 2.43ms w/children — (mount)
- `LinearGradient` ×3 — 0.22ms self, 0.94ms w/children — props: start, end
- `Path` ×2 — 0.2ms self, 0.76ms w/children — (mount)
- `SpacerView` ×6 — 0.14ms self, 0.37ms w/children — (mount)
- _... and 25 more_
- _Shown: 9.4ms self / 23.52ms commit (40%) — 25 more components not shown. Use `profiler-commit-query mode=by_index commit_index=52` to see all._

**CPU during this commit:**
- `ReactElement` self=5.79ms total=5.79ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:10279)
- `[Host Function] completeRoot` self=2.38ms total=2.38ms ([host]:0)

### Commit #53 — 11.13ms 🔵 (t=71.5s, margin)

- `HStack` ×32 — 3.05ms self, 14.11ms w/children — props: modifiers, children
- `Text` ×45 — 0.99ms self, 2.34ms w/children — props: style
- `TrendsScreen(./(tabs)/trends.js)` — 0.77ms self, 11.13ms w/children — hooks: useRef
- `TextView` ×40 — 0.66ms self, 1.25ms w/children — props: modifiers, onGlobalEvent
- `TrendLeaderboard` — 0.62ms self, 7.98ms w/children — parent re-render
- `HStackView` ×32 — 0.52ms self, 11.06ms w/children — props: modifiers, onGlobalEvent, children
- `Image` ×17 — 0.36ms self, 0.45ms w/children — props: style
- `View` ×16 — 0.3ms self, 41.87ms w/children — props: style, children
- `VStack` ×16 — 0.28ms self, 20.73ms w/children — props: children
- `VStackView` ×16 — 0.28ms self, 20.45ms w/children — props: children
- `ObservedPriceChart` — 0.27ms self, 0.68ms w/children — parent re-render
- `HomeScreen` — 0.21ms self, 0.52ms w/children — hooks: useCallback, useEffect
- `LinearGradient` ×2 — 0.15ms self, 0.23ms w/children — props: start, end
- `ScrollView` ×2 — 0.11ms self, 19.68ms w/children — props: contentContainerStyle, refreshControl, children
- `Spacer` ×6 — 0.1ms self, 0.11ms w/children — parent re-render
- _... and 23 more_
- _Shown: 8.7ms self / 11.13ms commit (78%) — 23 more components not shown. Use `profiler-commit-query mode=by_index commit_index=53` to see all._

### Commit #64 — 16.17ms 🟡 (t=79.4s)
> 🟡 May be acceptable in production (dev mode is ~3× slower)

**Root cause:** `Text` re-rendered — props: style

Render cascade:
- `Text` ×55 — 1.16ms self, 2.63ms w/children — props: style
- `TrendsScreen(./(tabs)/trends.js)` — 0.79ms self, 8ms w/children — context changed
- `TextView` ×50 — 0.75ms self, 1.37ms w/children — props: modifiers, onGlobalEvent
- `TrendLeaderboard` — 0.63ms self, 5.07ms w/children — parent re-render
- `HStack` ×38 — 0.56ms self, 8.92ms w/children — props: modifiers, children
- `HStackView` ×38 — 0.54ms self, 8.37ms w/children — props: modifiers, onGlobalEvent, children
- `Image` ×24 — 0.48ms self, 0.77ms w/children — props: style
- `View` ×23 — 0.44ms self, 57.88ms w/children — props: style, children
- `NativeSettingsForm` — 0.44ms self, 3.89ms w/children — props: onRadiusChange, onPriceAlertsChange, onEditFuel
- `SlotView` ×26 — 0.38ms self, 4.47ms w/children — props: children
- `Slot` ×26 — 0.35ms self, 4.81ms w/children — props: children
- `NativeStackNavigator` — 0.29ms self, 15.6ms w/children — props: screenOptions, children
- `VStack` ×16 — 0.26ms self, 12.02ms w/children — props: children
- `ObservedPriceChart` — 0.25ms self, 0.61ms w/children — parent re-render
- `VStackView` ×16 — 0.25ms self, 11.75ms w/children — props: children
- _... and 75 more_
- _Shown: 7.6ms self / 16.17ms commit (47%) — 75 more components not shown. Use `profiler-commit-query mode=by_index commit_index=64` to see all._

**CPU during this commit:**
- `addObjectDiffToProperties` self=14.23ms total=14.23ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:20446)
- `[Native] ErrorConstructor` self=1.94ms total=1.94ms ([native]:0)

### Commit #65 — 0.88ms 🔵 (t=79.4s, margin)

- `HomeScreen` — 0.32ms self, 0.88ms w/children — hooks: useContext
- `View` ×3 — 0.06ms self, 0.76ms w/children — props: style, children
- `Image` — 0.06ms self, 0.1ms w/children — props: style
- `FuelUpMapKitRouting` — 0.03ms self, 0.22ms w/children — props: origin, stations, onStationSelect
- `TopCanopy` — 0.03ms self, 0.08ms w/children — parent re-render
- `ProgressiveBlurView` — 0.02ms self, 0.03ms w/children — props: style
- `ImageAnalyticsTagContext.Consumer` — 0.02ms self, 0.04ms w/children — (mount)
- `FuelUpHeaderLogo` — 0.01ms self, 0.12ms w/children — parent re-render
- _Shown: 0.6ms self / 0.88ms commit (63% explained by self-time — remainder is native/layout work outside JS)_

---
## Top Components by Total Render Cost

| Component | Renders | Total | Avg | Max | Reason | File |
|---|---|---|---|---|---|---|
| `Text` | 342 | 8ms | 0.02ms | 0.99ms | props: modifiers, children, style | — |
| `TrendsScreen(./(tabs)/trends.js)` | 9 | 6.6ms | 0.73ms | 1.45ms | context changed | — |
| `HStack` | 231 | 6ms | 0.03ms | 2.54ms | props: children, modifiers | — |
| `HomeScreen` | 13 | 5.1ms | 0.39ms | 2.53ms | hooks: useContext, useContext, useCallback | — |
| `TextView` | 309 | 4.6ms | 0.01ms | 0.05ms | props: modifiers, onGlobalEvent | — |
| `View` | 220 | 4.3ms | 0.02ms | 0.12ms | props: children, style, onLayout | — |
| `Image` | 157 | 3.8ms | 0.02ms | 0.14ms | parent re-render | — |
| `SlotView` | 162 | 3.8ms | 0.02ms | 1.56ms | props: children | — |
| `TrendLeaderboard` | 6 | 3.8ms | 0.63ms | 0.69ms | parent re-render | — |
| `HStackView` | 231 | 3.4ms | 0.01ms | 0.04ms | props: children, modifiers, onGlobalEvent | — |
| `SettingsLink` | 36 | 3.3ms | 0.09ms | 2.11ms | props: onPress | — |
| `Slot` | 162 | 3.3ms | 0.02ms | 1.33ms | props: children | — |
| `NativeStackNavigator` | 6 | 2.4ms | 0.4ms | 0.57ms | props: screenOptions, children | — |
| `NativeSettingsForm` | 6 | 2.1ms | 0.35ms | 0.44ms | props: onRadiusChange, onPriceAlertsChange, onEditFuel | — |
| `SceneView` | 12 | 1.7ms | 0.14ms | 0.31ms | props: screen, options, clearOptions | — |
| `ObservedPriceChart` | 6 | 1.6ms | 0.27ms | 0.37ms | parent re-render | `trends/ObservedPriceChart.js:7` |
| `VStack` | 96 | 1.6ms | 0.02ms | 0.03ms | props: children, modifiers | — |
| `VStackView` | 96 | 1.5ms | 0.02ms | 0.04ms | props: children, modifiers, onGlobalEvent | — |
| `Button` | 96 | 1.4ms | 0.01ms | 0.03ms | props: children, onButtonPress, onPress | — |
| `Anonymous` [forwardRef] | 6 | 1.3ms | 0.22ms | 0.44ms | props: screenOptions, children | — |

---
## Suggested Improvements

### `Text`

**Stabilize props:** `modifiers`, `children`, `style`. Likely inline objects/functions at the callsite — extract to constants or wrap with `useMemo`/`useCallback`.

### `TrendsScreen(./(tabs)/trends.js)`

**Context re-renders** — source not resolved, suggestion is pattern-based. Check the Provider component for an unmemoized value object.

### `HStack`

**Stabilize props:** `children`, `modifiers`. Likely inline objects/functions at the callsite — extract to constants or wrap with `useMemo`/`useCallback`.

### `HomeScreen`

**Unstable hook deps:** `useContext`, `useContext`, `useCallback`. Check dependency arrays in `useEffect`/`useMemo` — a dependency may be recreated on every render.

### `TextView`

**Stabilize props:** `modifiers`, `onGlobalEvent`. Likely inline objects/functions at the callsite — extract to constants or wrap with `useMemo`/`useCallback`.


> 📝 Dev mode renders are ~3× slower than production. Divide ms values by ~3 for a rough production estimate.

---
## Next Steps

Ask the user which path to take:

1. **Investigate further** — use query tools to drill into specific findings before making changes:
   - `profiler-commit-query` mode=`by_index` commit_index=52 — full breakdown of the slowest commit
   - `profiler-cpu-query` mode=`component_cpu` component_name=`Text` — CPU activity during this component's renders
   - `profiler-cpu-query` mode=`call_tree` — trace callers/callees of hot functions
2. **Implement fixes** — apply changes to the top offenders identified above, then re-profile the same scenario to measure improvement.
3. **Done for now** — save the report for reference.