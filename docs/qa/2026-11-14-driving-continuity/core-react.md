# Profiling Analysis — 62.6s session
**React Compiler:** ✗  **Hot commits:** 12 of 64 total

> **Duration columns:** `self` = this component's own render work only (exclusive).
> `w/children` = self + the entire subtree it owns (inclusive).
> Do not sum the `w/children` column — a parent's inclusive time already contains its
> children's time. Use `self` for summing; use `w/children` to understand container cost.

---
## Slow React Batches

### Commit #0 — 89.65ms 🔴 (t=8.6s)

**Root cause:** `TrendsScreen(./(tabs)/trends.js)` re-rendered — context changed

Render cascade:
- `TrendsScreen(./(tabs)/trends.js)` — 13.77ms self, 30.77ms w/children — context changed
- `HomeScreen` — 8.34ms self, 32.99ms w/children — context changed
- `NativeSettingsForm` — 4.76ms self, 11.64ms w/children — props: onRadiusChange, onPriceAlertsChange, onEditFuel
- `HStackView` ×56 — 3.6ms self, 29.91ms w/children — props: children
- `Animated(Anonymous)` — 3.3ms self, 83.33ms w/children — props: sheetAllowedDetents, onHeaderHeightChange, onWillAppear
- `Text` ×76 — 3.26ms self, 6.77ms w/children — props: modifiers
- `NativeStackNavigator` — 1.9ms self, 87.8ms w/children — props: screenOptions, children
- `TextView` ×71 — 1.77ms self, 3.38ms w/children — props: modifiers, onGlobalEvent
- `TrendLeaderboard` — 1.67ms self, 11.99ms w/children — parent re-render
- `HStack` ×56 — 1.6ms self, 31.51ms w/children — props: children
- `Image` ×27 — 1.16ms self, 1.78ms w/children — parent re-render
- `View` ×32 — 1.13ms self, 236.08ms w/children — props: onLayout, style, children
- `NativeStationCard` [React.memo] ×3 — 0.82ms self, 5.77ms w/children — props: station, onLayout
- `Button` ×24 — 0.75ms self, 7.16ms w/children — props: modifiers, onGlobalEvent, onButtonPress
- `VStack` ×22 — 0.75ms self, 34.15ms w/children — props: children
- _... and 86 more_
- _Shown: 48.6ms self / 89.65ms commit (54%) — 86 more components not shown. Use `profiler-commit-query mode=by_index commit_index=0` to see all._

**CPU during this commit:**
- `structuredCloneInternal` self=17.18ms total=17.18ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:40404)
- `structuredCloneInternal` self=16.85ms total=16.85ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:40404)
- `[Native] objectKeys` self=14.14ms total=14.14ms ([native]:0)
- `structuredCloneInternal` self=12.88ms total=12.88ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:40404)
- `updateWorkInProgressHook` self=12.33ms total=12.33ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:22296)

### Commit #1 — 12.06ms 🔵 (t=8.7s, margin)

- `HomeScreen` — 2.94ms self, 12.06ms w/children — hooks: useContext
- `NativeStationCard` [React.memo] ×3 — 1.33ms self, 6.15ms w/children — props: station, onLayout
- `Text` ×21 — 0.81ms self, 1.84ms w/children — props: modifiers
- `HStack` ×18 — 0.61ms self, 9.89ms w/children — props: children
- `TextView` ×21 — 0.56ms self, 1.03ms w/children — props: modifiers, onGlobalEvent
- `HStackView` ×18 — 0.51ms self, 9.28ms w/children — props: children
- `CellRenderer` ×3 — 0.48ms self, 7.19ms w/children — props: item, ref, renderItem
- `View` ×12 — 0.38ms self, 30.61ms w/children — props: onLayout, style, children
- `ScrollView` ×2 — 0.25ms self, 15.09ms w/children — props: data, style, getItemLayout
- `VirtualizedList` — 0.23ms self, 7.87ms w/children — props: data, style, getItemLayout
- `Button` ×8 — 0.23ms self, 0.55ms w/children — props: modifiers, onGlobalEvent, onButtonPress
- `Image` ×4 — 0.17ms self, 0.22ms w/children — parent re-render
- `VStack` ×6 — 0.17ms self, 5.55ms w/children — props: children
- `HostView` ×4 — 0.17ms self, 4.78ms w/children — props: children
- `VStackView` ×6 — 0.16ms self, 5.38ms w/children — props: children
- _... and 16 more_
- _Shown: 9ms self / 12.06ms commit (75%) — 16 more components not shown. Use `profiler-commit-query mode=by_index commit_index=1` to see all._

### Commit #10 — 31.51ms 🟡 (t=16.5s)
> 🟡 May be acceptable in production (dev mode is ~3× slower)

**Root cause:** `HomeScreen` re-rendered — context changed

Render cascade:
- `HomeScreen` — 2.89ms self, 12.56ms w/children — context changed
- `TrendLeaderboard` — 2.66ms self, 7.79ms w/children — parent re-render
- `Text` ×76 — 1.65ms self, 3.94ms w/children — props: modifiers
- `TextView` ×71 — 1.1ms self, 2.19ms w/children — props: modifiers, onGlobalEvent
- `HStack` ×56 — 0.97ms self, 15.09ms w/children — props: children
- `HStackView` ×56 — 0.91ms self, 14.12ms w/children — props: children
- `TrendsScreen(./(tabs)/trends.js)` — 0.76ms self, 11.08ms w/children — context changed
- `View` ×32 — 0.75ms self, 104.85ms w/children — props: onLayout, style, children
- `Image` ×27 — 0.67ms self, 0.96ms w/children — parent re-render
- `NativeStationCard` [React.memo] ×3 — 0.5ms self, 3.09ms w/children — props: station, onLayout
- `NativeStackNavigator` — 0.45ms self, 30.83ms w/children — props: screenOptions, children
- `SceneView` ×2 — 0.38ms self, 58.36ms w/children — props: screen, options, clearOptions
- `VStack` ×22 — 0.37ms self, 16.26ms w/children — props: children
- `ObservedPriceChart` — 0.36ms self, 0.9ms w/children — parent re-render
- `VStackView` ×22 — 0.36ms self, 15.89ms w/children — props: children
- _... and 86 more_
- _Shown: 14.8ms self / 31.51ms commit (47%) — 86 more components not shown. Use `profiler-commit-query mode=by_index commit_index=10` to see all._

**CPU during this commit:**
- `structuredCloneInternal` self=15.16ms total=15.16ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:40404)
- `[GC Young Gen]` self=8.94ms total=8.94ms ([suspended]:0)
- `addObjectDiffToProperties` self=7.41ms total=7.41ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:20446)

### Commit #11 — 9.85ms 🔵 (t=16.6s, margin)

- `HomeScreen` — 4.56ms self, 9.85ms w/children — hooks: useCallback, useEffect, useContext
- `NativeStationCard` [React.memo] ×3 — 0.53ms self, 3.34ms w/children — props: station, onLayout
- `Text` ×21 — 0.43ms self, 1.01ms w/children — props: modifiers
- `HStack` ×18 — 0.36ms self, 5.58ms w/children — props: children
- `TextView` ×21 — 0.31ms self, 0.59ms w/children — props: modifiers, onGlobalEvent
- `HStackView` ×18 — 0.31ms self, 5.22ms w/children — props: children
- `View` ×12 — 0.23ms self, 17.01ms w/children — props: onLayout, style, children
- `CellRenderer` ×3 — 0.15ms self, 3.72ms w/children — props: item, ref, renderItem
- `HostView` ×4 — 0.14ms self, 2.82ms w/children — props: children
- `VirtualizedList` — 0.14ms self, 4.09ms w/children — props: data, style, getItemLayout
- `Button` ×8 — 0.14ms self, 0.35ms w/children — props: modifiers, onGlobalEvent, onButtonPress
- `StationCardCarousel` [forwardRef] — 0.12ms self, 4.51ms w/children — props: stations, onSelect, onShowAll
- `ScrollView` ×2 — 0.12ms self, 7.81ms w/children — props: data, style, getItemLayout
- `Image` ×4 — 0.11ms self, 0.16ms w/children — parent re-render
- `VStack` ×6 — 0.11ms self, 3.17ms w/children — props: children
- _... and 16 more_
- _Shown: 7.8ms self / 9.85ms commit (79%) — 16 more components not shown. Use `profiler-commit-query mode=by_index commit_index=11` to see all._

### Commit #19 — 49.89ms 🟡 (t=25.6s)
> 🟡 May be acceptable in production (dev mode is ~3× slower)

**Root cause:** `HomeScreen` re-rendered — context changed

Render cascade:
- `TrendLeaderboard` — 5.07ms self, 10.86ms w/children — parent re-render
- `HomeScreen` — 4.82ms self, 20.52ms w/children — context changed
- `Text` ×76 — 2.6ms self, 5.65ms w/children — props: modifiers
- `TextView` ×71 — 1.48ms self, 2.79ms w/children — props: modifiers, onGlobalEvent
- `NativeStationCard` [React.memo] ×3 — 1.4ms self, 6.12ms w/children — props: station, onLayout
- `TrendsScreen(./(tabs)/trends.js)` — 1.25ms self, 16.05ms w/children — context changed
- `HStack` ×56 — 1.21ms self, 20.41ms w/children — props: children
- `Image` ×27 — 1.12ms self, 1.58ms w/children — parent re-render
- `HStackView` ×56 — 1.11ms self, 19.2ms w/children — props: children
- `View` ×32 — 1.11ms self, 164.87ms w/children — props: onLayout, style, children
- `NativeStackNavigator` — 0.99ms self, 48.74ms w/children — props: screenOptions, children
- `SceneView` ×2 — 0.71ms self, 91.21ms w/children — props: screen, options, clearOptions
- `Button` ×24 — 0.69ms self, 5.85ms w/children — props: modifiers, onGlobalEvent, onButtonPress
- `VStack` ×22 — 0.66ms self, 20.24ms w/children — props: children
- `SlotView` ×26 — 0.54ms self, 6.63ms w/children — props: children
- _... and 86 more_
- _Shown: 24.8ms self / 49.89ms commit (50%) — 86 more components not shown. Use `profiler-commit-query mode=by_index commit_index=19` to see all._

**CPU during this commit:**
- `logComponentRender` self=16.46ms total=16.46ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:20497)
- `URLSearchParamsImpl` self=12.72ms total=12.72ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:169627)
- `commitBeforeMutationEffects` self=0.15ms total=0.15ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:24607)

### Commit #20 — 11.52ms 🔵 (t=25.7s, margin)

- `HomeScreen` — 6.14ms self, 11.52ms w/children — hooks: useCallback, useEffect, useContext
- `NativeStationCard` [React.memo] ×3 — 0.65ms self, 3.27ms w/children — props: station, onLayout
- `Text` ×21 — 0.42ms self, 1.03ms w/children — props: modifiers
- `HStackView` ×18 — 0.31ms self, 5.24ms w/children — props: children
- `TextView` ×21 — 0.31ms self, 0.61ms w/children — props: modifiers, onGlobalEvent
- `HStack` ×18 — 0.27ms self, 5.51ms w/children — props: children
- `View` ×12 — 0.23ms self, 17.08ms w/children — props: onLayout, style, children
- `CellRenderer` ×3 — 0.18ms self, 3.7ms w/children — props: item, ref, renderItem
- `Image` ×4 — 0.18ms self, 0.23ms w/children — parent re-render
- `VirtualizedList` — 0.15ms self, 4.08ms w/children — props: data, style, getItemLayout
- `Button` ×8 — 0.14ms self, 0.35ms w/children — props: modifiers, onGlobalEvent, onButtonPress
- `ScrollView` ×2 — 0.12ms self, 7.78ms w/children — props: data, style, getItemLayout
- `StationCardCarousel` [forwardRef] — 0.12ms self, 4.53ms w/children — props: stations, onSelect, onShowAll
- `VStackView` ×6 — 0.09ms self, 3.05ms w/children — props: children
- `VStack` ×6 — 0.09ms self, 3.14ms w/children — props: children
- _... and 16 more_
- _Shown: 9.4ms self / 11.52ms commit (82%) — 16 more components not shown. Use `profiler-commit-query mode=by_index commit_index=20` to see all._

### Commit #23 — 8.38ms 🔵 (t=26.0s, margin)

- `StationCardCarousel` [forwardRef] — 2.69ms self, 7.27ms w/children — parent re-render
- `NativeStationCard` [React.memo] ×3 — 0.7ms self, 3.26ms w/children — props: onLayout
- `HomeScreen` — 0.48ms self, 8.38ms w/children — hooks: useCallback, useEffect
- `Text` ×21 — 0.41ms self, 1.01ms w/children — props: modifiers
- `View` ×12 — 0.37ms self, 19.8ms w/children — props: onLayout, style, children
- `TextView` ×21 — 0.31ms self, 0.6ms w/children — props: modifiers, onGlobalEvent
- `HStack` ×18 — 0.28ms self, 5.36ms w/children — props: children
- `HStackView` ×18 — 0.27ms self, 5.08ms w/children — props: children
- `CellRenderer` ×3 — 0.21ms self, 3.75ms w/children — props: ref, renderItem
- `VirtualizedList` — 0.16ms self, 4.19ms w/children — props: style, getItemLayout, onScrollBeginDrag
- `Image` ×4 — 0.15ms self, 0.19ms w/children — parent re-render
- `Button` ×8 — 0.14ms self, 0.37ms w/children — props: modifiers, onGlobalEvent
- `ScrollView` ×2 — 0.13ms self, 7.97ms w/children — props: style, getItemLayout, renderItem
- `Spacer` ×6 — 0.1ms self, 0.11ms w/children — parent re-render
- `FuelUpMapKitRouting` — 0.09ms self, 0.14ms w/children — props: onResearchMapInteraction
- _... and 16 more_
- _Shown: 6.5ms self / 8.38ms commit (77%) — 16 more components not shown. Use `profiler-commit-query mode=by_index commit_index=23` to see all._

### Commit #24 — 16.52ms 🟡 (t=26.1s)
> 🟡 May be acceptable in production (dev mode is ~3× slower)

**Root cause:** `HomeScreen` re-rendered — hooks: useContext

Render cascade:
- `HomeScreen` — 3.24ms self, 16.52ms w/children — hooks: useContext
- `Text` ×66 — 1.47ms self, 3.58ms w/children — props: modifiers
- `TextView` ×61 — 0.96ms self, 2.02ms w/children — props: modifiers, onGlobalEvent
- `NativeStationCard` [React.memo] ×3 — 0.95ms self, 6.17ms w/children — props: station, onLayout
- `HStack` ×50 — 0.91ms self, 21.59ms w/children — props: children
- `TrendsScreen(./(tabs)/trends.js)` — 0.87ms self, 9.3ms w/children — hooks: useMemo, useEffect
- `HStackView` ×50 — 0.84ms self, 20.69ms w/children — props: children
- `TrendLeaderboard` — 0.69ms self, 5.45ms w/children — props: stations
- `View` ×25 — 0.5ms self, 67.73ms w/children — props: onLayout, style, children
- `Image` ×20 — 0.41ms self, 0.51ms w/children — parent re-render
- `VStack` ×22 — 0.38ms self, 18.61ms w/children — props: children
- `ObservedPriceChart` — 0.38ms self, 1.13ms w/children — props: data
- `VStackView` ×22 — 0.36ms self, 18.22ms w/children — props: children
- `ScrollView` ×4 — 0.21ms self, 29.43ms w/children — props: data, style, getItemLayout
- `LinearGradient` ×2 — 0.2ms self, 0.28ms w/children — props: start, end
- _... and 35 more_
- _Shown: 12.4ms self / 16.52ms commit (75%) — 35 more components not shown. Use `profiler-commit-query mode=by_index commit_index=24` to see all._

**CPU during this commit:**
- `[Native] arrayPrototypePush` self=13.98ms total=13.98ms ([native]:0)
- `[GC Young Gen]` self=2.54ms total=2.54ms ([suspended]:0)

### Commit #27 — 41.42ms 🟡 (t=33.7s)
> 🟡 May be acceptable in production (dev mode is ~3× slower)

**Root cause:** `HomeScreen` re-rendered — context changed

Render cascade:
- `HomeScreen` — 6.65ms self, 18.67ms w/children — context changed
- `VStackView` ×22 — 2.72ms self, 22.55ms w/children — props: children
- `TrendsScreen(./(tabs)/trends.js)` — 1.6ms self, 11.94ms w/children — context changed
- `Text` ×76 — 1.59ms self, 4.15ms w/children — props: modifiers
- `TextView` ×71 — 1.1ms self, 2.46ms w/children — props: modifiers, onGlobalEvent
- `NativeStationCard` [React.memo] ×3 — 0.93ms self, 4.52ms w/children — props: station, onLayout
- `NativeStackNavigator` — 0.93ms self, 39.25ms w/children — props: screenOptions, children
- `HStack` ×56 — 0.93ms self, 17.63ms w/children — props: children
- `HStackView` ×56 — 0.86ms self, 16.7ms w/children — props: children
- `View` ×32 — 0.69ms self, 119.35ms w/children — props: onLayout, style, children
- `TrendLeaderboard` — 0.64ms self, 7.42ms w/children — parent re-render
- `SceneView` ×2 — 0.63ms self, 73.11ms w/children — props: screen, options, clearOptions
- `Image` ×27 — 0.59ms self, 0.92ms w/children — parent re-render
- `AppGate` — 0.52ms self, 40.68ms w/children — context changed
- `Anonymous` [forwardRef] — 0.46ms self, 39.73ms w/children — props: screenOptions, children
- _... and 86 more_
- _Shown: 20.8ms self / 41.42ms commit (50%) — 86 more components not shown. Use `profiler-commit-query mode=by_index commit_index=27` to see all._

**CPU during this commit:**
- `[Native] mapPrototypeClear` self=14.01ms total=14.01ms ([native]:0)
- `addObjectDiffToProperties` self=13.51ms total=13.51ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:20446)
- `recordProfilingDurations` self=12.98ms total=12.98ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:56612)
- `diffProperties` self=0.58ms total=0.58ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:18084)
- `completeWork` self=0.35ms total=0.35ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:24144)

### Commit #28 — 13.95ms 🔵 (t=33.7s, margin)

- `HomeScreen` — 7.18ms self, 13.95ms w/children — hooks: useCallback, useEffect, useContext
- `NativeStationCard` [React.memo] ×3 — 0.6ms self, 3.73ms w/children — props: station, onLayout
- `Text` ×21 — 0.52ms self, 1.22ms w/children — props: modifiers
- `View` ×12 — 0.39ms self, 20.35ms w/children — props: onLayout, style, children
- `TextView` ×21 — 0.38ms self, 0.71ms w/children — props: modifiers, onGlobalEvent
- `HStack` ×18 — 0.36ms self, 6.65ms w/children — props: children
- `HStackView` ×18 — 0.33ms self, 6.28ms w/children — props: children
- `Button` ×8 — 0.23ms self, 0.53ms w/children — props: modifiers, onGlobalEvent, onButtonPress
- `Image` ×4 — 0.18ms self, 0.26ms w/children — parent re-render
- `StationCardCarousel` [forwardRef] — 0.17ms self, 5.27ms w/children — props: stations, onSelect, onShowAll
- `CellRenderer` ×3 — 0.16ms self, 4.17ms w/children — props: item, ref, renderItem
- `VirtualizedList` — 0.14ms self, 4.68ms w/children — props: data, style, getItemLayout
- `ScrollView` ×2 — 0.12ms self, 8.97ms w/children — props: data, style, getItemLayout
- `Spacer` ×6 — 0.1ms self, 0.12ms w/children — parent re-render
- `VStackView` ×6 — 0.1ms self, 3.52ms w/children — props: children
- _... and 16 more_
- _Shown: 11ms self / 13.95ms commit (79%) — 16 more components not shown. Use `profiler-commit-query mode=by_index commit_index=28` to see all._

### Commit #31 — 4.75ms 🔵 (t=34.4s, margin)

- `NativeStationCard` [React.memo] ×3 — 0.57ms self, 3.01ms w/children — props: onLayout
- `Text` ×21 — 0.41ms self, 0.98ms w/children — props: modifiers
- `TextView` ×21 — 0.3ms self, 0.57ms w/children — props: modifiers, onGlobalEvent
- `HStack` ×18 — 0.27ms self, 5.15ms w/children — props: children
- `HStackView` ×18 — 0.27ms self, 4.88ms w/children — props: children
- `HomeScreen` — 0.25ms self, 4.75ms w/children — hooks: useCallback, useEffect
- `View` ×12 — 0.23ms self, 15.28ms w/children — props: onLayout, style, children
- `CellRenderer` ×3 — 0.15ms self, 3.42ms w/children — props: ref, renderItem
- `VirtualizedList` — 0.14ms self, 3.78ms w/children — props: style, getItemLayout, onScrollBeginDrag
- `Button` ×8 — 0.13ms self, 0.33ms w/children — props: modifiers, onGlobalEvent
- `ScrollView` ×2 — 0.11ms self, 7.21ms w/children — props: style, getItemLayout, renderItem
- `Image` ×4 — 0.11ms self, 0.15ms w/children — parent re-render
- `StationCardCarousel` [forwardRef] — 0.1ms self, 4.18ms w/children — parent re-render
- `VStackView` ×6 — 0.08ms self, 2.85ms w/children — props: children
- `Spacer` ×6 — 0.08ms self, 0.09ms w/children — parent re-render
- _... and 16 more_
- _Shown: 3.2ms self / 4.75ms commit (67%) — 16 more components not shown. Use `profiler-commit-query mode=by_index commit_index=31` to see all._

### Commit #32 — 24.09ms 🟡 (t=34.5s)
> 🟡 May be acceptable in production (dev mode is ~3× slower)

**Root cause:** `HomeScreen` re-rendered — hooks: useContext

Render cascade:
- `Image` ×20 — 11.29ms self, 11.4ms w/children — parent re-render
- `HomeScreen` — 3.51ms self, 13.87ms w/children — hooks: useContext
- `Text` ×66 — 1.9ms self, 5.48ms w/children — props: modifiers
- `TextView` ×61 — 1.25ms self, 3.49ms w/children — props: modifiers, onGlobalEvent
- `HStack` ×50 — 1.04ms self, 44.9ms w/children — props: children
- `HStackView` ×50 — 0.96ms self, 43.87ms w/children — props: children
- `TrendLeaderboard` — 0.68ms self, 20.79ms w/children — props: stations
- `TrendsScreen(./(tabs)/trends.js)` — 0.66ms self, 24.09ms w/children — hooks: useMemo, useEffect
- `VStack` ×22 — 0.62ms self, 60.84ms w/children — props: children
- `NativeStationCard` [React.memo] ×3 — 0.6ms self, 3.16ms w/children — props: station, onLayout
- `View` ×25 — 0.53ms self, 115.88ms w/children — props: onLayout, style, children
- `VStackView` ×22 — 0.48ms self, 60.22ms w/children — props: children
- `Spacer` ×12 — 0.38ms self, 0.4ms w/children — parent re-render
- `ObservedPriceChart` — 0.27ms self, 0.89ms w/children — props: data
- `ScrollView` ×4 — 0.24ms self, 53.49ms w/children — props: data, style, getItemLayout
- _... and 35 more_
- _Shown: 24.4ms self / 24.09ms commit (101%) — 35 more components not shown. Use `profiler-commit-query mode=by_index commit_index=32` to see all._

**CPU during this commit:**
- `structuredCloneInternal` self=17ms total=17ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:40404)
- `[Host Function] completeRoot` self=3.94ms total=3.94ms ([host]:0)
- `[Host Function] fn` self=3.15ms total=3.15ms ([host]:0)

### Commit #35 — 30.65ms 🟡 (t=41.7s)
> 🟡 May be acceptable in production (dev mode is ~3× slower)

**Root cause:** `HomeScreen` re-rendered — context changed

Render cascade:
- `HomeScreen` — 3.94ms self, 14.32ms w/children — context changed
- `View` ×55 — 1.23ms self, 108.99ms w/children — props: onLayout, style, children
- `TrendsScreen(./(tabs)/trends.js)` — 0.95ms self, 9.02ms w/children — context changed
- `Text` ×35 — 0.83ms self, 1.95ms w/children — props: modifiers
- `NativeStationCard` [React.memo] ×3 — 0.62ms self, 3.59ms w/children — props: station, onLayout
- `TextView` ×34 — 0.52ms self, 1.1ms w/children — props: modifiers, onGlobalEvent
- `HStack` ×25 — 0.38ms self, 6.71ms w/children — props: children
- `SlotView` ×26 — 0.37ms self, 4.53ms w/children — props: children
- `Image` ×13 — 0.37ms self, 0.65ms w/children — parent re-render
- `Button` ×24 — 0.37ms self, 3.61ms w/children — props: modifiers, onGlobalEvent, onButtonPress
- `HStackView` ×25 — 0.36ms self, 6.34ms w/children — props: children
- `NativeStackNavigator` — 0.35ms self, 29.98ms w/children — props: screenOptions, children
- `Slot` ×26 — 0.33ms self, 4.86ms w/children — props: children
- `NativeSettingsForm` — 0.3ms self, 3.76ms w/children — props: onRadiusChange, onPriceAlertsChange, onEditFuel
- `SceneView` ×2 — 0.29ms self, 57.24ms w/children — props: screen, options, clearOptions
- _... and 81 more_
- _Shown: 11.2ms self / 30.65ms commit (37%) — 81 more components not shown. Use `profiler-commit-query mode=by_index commit_index=35` to see all._

**CPU during this commit:**
- `structuredCloneInternal` self=12.9ms total=12.9ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:40404)
- `[Native] setPrototypeAdd` self=6.09ms total=6.09ms ([native]:0)
- `commitPassiveUnmountOnFiber` self=5.98ms total=5.98ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:25321)
- `[GC Young Gen]` self=5.68ms total=5.68ms ([suspended]:0)

### Commit #36 — 24.55ms 🟡 (t=41.8s)
> 🟡 May be acceptable in production (dev mode is ~3× slower)

**Root cause:** `HomeScreen` re-rendered — hooks: useContext

Render cascade:
- `HomeScreen` — 2.86ms self, 8.54ms w/children — hooks: useContext
- `Text` ×66 — 1.6ms self, 8.53ms w/children — props: modifiers
- `TextView` ×61 — 1.22ms self, 5.97ms w/children — props: modifiers, onGlobalEvent
- `HStackView` ×50 — 1.07ms self, 32.55ms w/children — props: children
- `HStack` ×50 — 0.97ms self, 33.52ms w/children — props: children
- `NativeStationCard` [React.memo] ×3 — 0.89ms self, 3.64ms w/children — props: station, onLayout
- `TrendLeaderboard` — 0.88ms self, 15.83ms w/children — (mount)
- `TrendsScreen(./(tabs)/trends.js)` — 0.78ms self, 24.55ms w/children — hooks: useMemo, useEffect, useRef
- `View` ×26 — 0.6ms self, 116.85ms w/children — props: onLayout, style, children
- `VStackView` ×22 — 0.47ms self, 42.92ms w/children — props: children
- `Image` ×20 — 0.46ms self, 1.82ms w/children — parent re-render
- `VStack` ×22 — 0.41ms self, 43.34ms w/children — props: children
- `ImageView` ×14 — 0.31ms self, 1.27ms w/children — (mount)
- `ObservedPriceChart` — 0.25ms self, 4.18ms w/children — (mount)
- `Path` ×2 — 0.25ms self, 2.72ms w/children — (mount)
- _... and 39 more_
- _Shown: 13ms self / 24.55ms commit (53%) — 39 more components not shown. Use `profiler-commit-query mode=by_index commit_index=36` to see all._

**CPU during this commit:**
- `commitPassiveMountOnFiber` self=11.91ms total=11.91ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:25121)
- `getChangedKeys` self=7.44ms total=7.44ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:55900)
- `FiberNode` self=5.2ms total=5.2ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:26599)

### Commit #37 — 9.16ms 🔵 (t=41.8s, margin)

- `Text` ×66 — 1.45ms self, 3.47ms w/children — props: modifiers
- `TextView` ×61 — 0.99ms self, 1.88ms w/children — props: modifiers, onGlobalEvent
- `HStack` ×50 — 0.8ms self, 16.8ms w/children — props: children
- `HStackView` ×50 — 0.79ms self, 16.01ms w/children — props: children
- `TrendsScreen(./(tabs)/trends.js)` — 0.68ms self, 9.16ms w/children — hooks: useRef
- `TrendLeaderboard` — 0.66ms self, 5.51ms w/children — parent re-render
- `View` ×25 — 0.64ms self, 54.13ms w/children — props: onLayout, style, children
- `NativeStationCard` [React.memo] ×3 — 0.56ms self, 4.32ms w/children — props: onLayout
- `Image` ×20 — 0.41ms self, 0.51ms w/children — parent re-render
- `VStack` ×22 — 0.38ms self, 17.39ms w/children — props: children
- `VStackView` ×22 — 0.36ms self, 17.01ms w/children — props: children
- `ObservedPriceChart` — 0.3ms self, 0.71ms w/children — parent re-render
- `LinearGradient` ×2 — 0.23ms self, 0.33ms w/children — props: start, end
- `HomeScreen` — 0.21ms self, 6.12ms w/children — hooks: useCallback, useEffect
- `ScrollView` ×4 — 0.21ms self, 25.65ms w/children — props: style, getItemLayout, renderItem
- _... and 35 more_
- _Shown: 8.7ms self / 9.16ms commit (95%) — 35 more components not shown. Use `profiler-commit-query mode=by_index commit_index=37` to see all._

### Commit #40 — 15.22ms 🔵 (t=42.4s, margin)

- `Image` ×4 — 8.02ms self, 8.08ms w/children — parent re-render
- `NativeStationCard` [React.memo] ×3 — 0.93ms self, 12.35ms w/children — props: onLayout
- `Text` ×21 — 0.65ms self, 1.57ms w/children — props: modifiers
- `TextView` ×21 — 0.5ms self, 0.92ms w/children — props: modifiers, onGlobalEvent
- `HStack` ×18 — 0.41ms self, 38.16ms w/children — props: children
- `HStackView` ×18 — 0.39ms self, 37.75ms w/children — props: children
- `View` ×12 — 0.37ms self, 54.86ms w/children — props: onLayout, style, children
- `HomeScreen` — 0.31ms self, 15.22ms w/children — hooks: useCallback, useEffect
- `CellRenderer` ×3 — 0.28ms self, 13.04ms w/children — props: ref, renderItem
- `Button` ×8 — 0.19ms self, 0.47ms w/children — props: modifiers, onGlobalEvent
- `Spacer` ×6 — 0.16ms self, 0.17ms w/children — parent re-render
- `VirtualizedList` — 0.15ms self, 13.51ms w/children — props: style, getItemLayout, onScrollBeginDrag
- `StationCardCarousel` [forwardRef] — 0.15ms self, 14.04ms w/children — parent re-render
- `ScrollView` ×2 — 0.13ms self, 26.62ms w/children — props: style, getItemLayout, renderItem
- `Host` ×4 — 0.13ms self, 11.54ms w/children — props: children
- _... and 16 more_
- _Shown: 12.8ms self / 15.22ms commit (84%) — 16 more components not shown. Use `profiler-commit-query mode=by_index commit_index=40` to see all._

### Commit #41 — 17.76ms 🟡 (t=42.5s)
> 🟡 May be acceptable in production (dev mode is ~3× slower)

**Root cause:** `HomeScreen` re-rendered — hooks: useContext

Render cascade:
- `HomeScreen` — 3.01ms self, 17.76ms w/children — hooks: useContext
- `NativeStationCard` [React.memo] ×3 — 1.23ms self, 5.2ms w/children — props: station, onLayout
- `Text` ×21 — 0.65ms self, 1.48ms w/children — props: modifiers
- `HStack` ×18 — 0.49ms self, 8.07ms w/children — props: children
- `TextView` ×21 — 0.43ms self, 0.84ms w/children — props: modifiers, onGlobalEvent
- `HStackView` ×18 — 0.41ms self, 7.58ms w/children — props: children
- `View` ×12 — 0.39ms self, 33.59ms w/children — props: onLayout, style, children
- `VirtualizedList` — 0.31ms self, 6.7ms w/children — props: data, style, getItemLayout
- `CellRenderer` ×3 — 0.3ms self, 5.94ms w/children — props: item, ref, renderItem
- `StationCardCarousel` [forwardRef] — 0.3ms self, 7.65ms w/children — props: stations, onSelect, onShowAll
- `ScrollView` ×2 — 0.26ms self, 12.6ms w/children — props: data, style, getItemLayout
- `Button` ×8 — 0.24ms self, 0.6ms w/children — props: modifiers, onGlobalEvent, onButtonPress
- `Host` ×4 — 0.18ms self, 4.23ms w/children — props: children
- `HostView` ×4 — 0.17ms self, 4.06ms w/children — props: children
- `VStackView` ×6 — 0.14ms self, 4.47ms w/children — props: children
- _... and 16 more_
- _Shown: 8.5ms self / 17.76ms commit (48%) — 16 more components not shown. Use `profiler-commit-query mode=by_index commit_index=41` to see all._

**CPU during this commit:**
- `[Native] arrayPrototypePush` self=13.89ms total=13.89ms ([native]:0)
- `[GC Young Gen]` self=2.24ms total=2.24ms ([suspended]:0)
- `controlSize` self=1.63ms total=1.63ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:194787)

### Commit #45 — 144.07ms 🔴 (t=49.9s)

**Root cause:** `SceneView` re-rendered — props: screen, options, clearOptions

Render cascade:
- `SceneView` ×2 — 26.2ms self, 198.17ms w/children — props: screen, options, clearOptions
- `NativeStackNavigator` — 23.51ms self, 142ms w/children — props: screenOptions, children
- `HomeScreen` — 19.19ms self, 57.21ms w/children — context changed
- `TrendsScreen(./(tabs)/trends.js)` — 5.4ms self, 20.07ms w/children — context changed
- `NativeStackView` — 4.27ms self, 118.19ms w/children — props: descriptors, describe
- `HStackView` ×56 — 3.44ms self, 21.06ms w/children — props: children
- `NativeSettingsForm` — 2.11ms self, 5.59ms w/children — props: onRadiusChange, onPriceAlertsChange, onEditFuel
- `Text` ×76 — 2.07ms self, 4.55ms w/children — props: modifiers
- `TrendLeaderboard` — 1.76ms self, 10.14ms w/children — parent re-render
- `TextView` ×71 — 1.23ms self, 2.32ms w/children — props: modifiers, onGlobalEvent
- `HStack` ×56 — 1.02ms self, 22.08ms w/children — props: children
- `View` ×32 — 1.01ms self, 242.15ms w/children — props: onLayout, style, children
- `NativeStationCard` [React.memo] ×3 — 0.9ms self, 3.76ms w/children — props: station, onLayout
- `Image` ×27 — 0.82ms self, 1.19ms w/children — parent re-render
- `ObservedPriceChart` — 0.66ms self, 1.68ms w/children — parent re-render
- _... and 86 more_
- _Shown: 93.6ms self / 144.07ms commit (65%) — 86 more components not shown. Use `profiler-commit-query mode=by_index commit_index=45` to see all._

**CPU during this commit:**
- `[Host Function] createDevToolsRequestId` self=33.52ms total=33.52ms ([host]:0)
- `formatDurationToMicrosecondsGranularity` self=19.98ms total=19.98ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:49859)
- `[Host Function] reportMeasure` self=18.71ms total=18.71ms ([host]:0)
- `formatDurationToMicrosecondsGranularity` self=14.86ms total=14.86ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:49859)
- `structuredCloneInternal` self=13.71ms total=13.71ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:40404)

### Commit #46 — 8.9ms 🔵 (t=50.0s, margin)

- `HomeScreen` — 2.93ms self, 8.9ms w/children — hooks: useCallback, useEffect, useContext
- `NativeStationCard` [React.memo] ×3 — 0.61ms self, 3.93ms w/children — props: station, onLayout
- `Text` ×21 — 0.58ms self, 1.37ms w/children — props: modifiers
- `TextView` ×21 — 0.43ms self, 0.79ms w/children — props: modifiers, onGlobalEvent
- `HStack` ×18 — 0.39ms self, 7.68ms w/children — props: children
- `HStackView` ×18 — 0.36ms self, 7.29ms w/children — props: children
- `View` ×12 — 0.23ms self, 19.57ms w/children — props: onLayout, style, children
- `Button` ×8 — 0.18ms self, 0.43ms w/children — props: modifiers, onGlobalEvent, onButtonPress
- `CellRenderer` ×3 — 0.18ms self, 4.36ms w/children — props: item, ref, renderItem
- `Image` ×4 — 0.15ms self, 0.2ms w/children — parent re-render
- `VirtualizedList` — 0.15ms self, 4.74ms w/children — props: data, style, getItemLayout
- `ScrollView` ×2 — 0.12ms self, 9.11ms w/children — props: data, style, getItemLayout
- `StationCardCarousel` [forwardRef] — 0.12ms self, 5.19ms w/children — props: stations, onSelect, onShowAll
- `Spacer` ×6 — 0.11ms self, 0.12ms w/children — parent re-render
- `Host` ×4 — 0.09ms self, 3.44ms w/children — props: children
- _... and 16 more_
- _Shown: 6.6ms self / 8.9ms commit (74%) — 16 more components not shown. Use `profiler-commit-query mode=by_index commit_index=46` to see all._

### Commit #49 — 9.01ms 🔵 (t=50.5s, margin)

- `VStack` ×6 — 3.9ms self, 7.07ms w/children — props: children
- `NativeStationCard` [React.memo] ×3 — 0.63ms self, 7.15ms w/children — props: onLayout
- `Text` ×21 — 0.45ms self, 1.05ms w/children — props: modifiers
- `TextView` ×21 — 0.32ms self, 0.61ms w/children — props: modifiers, onGlobalEvent
- `HStackView` ×18 — 0.31ms self, 9.18ms w/children — props: children
- `HStack` ×18 — 0.3ms self, 9.48ms w/children — props: children
- `HomeScreen` — 0.27ms self, 9.01ms w/children — hooks: useCallback, useEffect
- `View` ×12 — 0.23ms self, 32ms w/children — props: onLayout, style, children
- `CellRenderer` ×3 — 0.18ms self, 7.57ms w/children — props: ref, renderItem
- `Button` ×8 — 0.15ms self, 0.36ms w/children — props: modifiers, onGlobalEvent
- `VirtualizedList` — 0.14ms self, 7.95ms w/children — props: style, getItemLayout, onScrollBeginDrag
- `ScrollView` ×2 — 0.12ms self, 15.52ms w/children — props: style, getItemLayout, renderItem
- `StationCardCarousel` [forwardRef] — 0.12ms self, 8.4ms w/children — parent re-render
- `Image` ×4 — 0.12ms self, 0.16ms w/children — parent re-render
- `VStackView` ×6 — 0.1ms self, 3.17ms w/children — props: children
- _... and 16 more_
- _Shown: 7.3ms self / 9.01ms commit (81%) — 16 more components not shown. Use `profiler-commit-query mode=by_index commit_index=49` to see all._

### Commit #50 — 16.21ms 🟡 (t=50.5s)
> 🟡 May be acceptable in production (dev mode is ~3× slower)

**Root cause:** `HomeScreen` re-rendered — hooks: useContext

Render cascade:
- `HomeScreen` — 6.28ms self, 16.21ms w/children — hooks: useContext
- `TrendsScreen(./(tabs)/trends.js)` — 4.89ms self, 13.7ms w/children — hooks: useMemo, useEffect
- `Text` ×66 — 1.35ms self, 3.37ms w/children — props: modifiers
- `TextView` ×61 — 0.9ms self, 1.91ms w/children — props: modifiers, onGlobalEvent
- `HStack` ×50 — 0.81ms self, 14.37ms w/children — props: children
- `HStackView` ×50 — 0.76ms self, 13.56ms w/children — props: children
- `TrendLeaderboard` — 0.72ms self, 5.89ms w/children — props: stations
- `NativeStationCard` [React.memo] ×3 — 0.6ms self, 3.06ms w/children — props: station, onLayout
- `View` ×25 — 0.57ms self, 56.13ms w/children — props: onLayout, style, children
- `VStack` ×22 — 0.43ms self, 16.52ms w/children — props: children
- `VStackView` ×22 — 0.4ms self, 16.1ms w/children — props: children
- `Image` ×20 — 0.39ms self, 0.49ms w/children — parent re-render
- `ObservedPriceChart` — 0.32ms self, 1ms w/children — props: data
- `ScrollView` ×4 — 0.21ms self, 23.66ms w/children — props: data, style, getItemLayout
- `Spacer` ×12 — 0.18ms self, 0.19ms w/children — parent re-render
- _... and 35 more_
- _Shown: 18.8ms self / 16.21ms commit (116%) — 35 more components not shown. Use `profiler-commit-query mode=by_index commit_index=50` to see all._

**CPU during this commit:**
- `[GC Young Gen]` self=4.66ms total=4.66ms ([suspended]:0)

### Commit #55 — 43.8ms 🟡 (t=57.8s)
> 🟡 May be acceptable in production (dev mode is ~3× slower)

**Root cause:** `HomeScreen` re-rendered — context changed

Render cascade:
- `HomeScreen` — 6.54ms self, 22.38ms w/children — context changed
- `Text` ×76 — 4.6ms self, 7.25ms w/children — props: modifiers
- `TrendsScreen(./(tabs)/trends.js)` — 2.15ms self, 10.59ms w/children — context changed
- `TextView` ×71 — 1.28ms self, 2.55ms w/children — props: modifiers, onGlobalEvent
- `HStack` ×56 — 1.19ms self, 19.23ms w/children — props: children
- `HStackView` ×56 — 1.15ms self, 18.04ms w/children — props: children
- `NativeStationCard` [React.memo] ×3 — 1.13ms self, 5.93ms w/children — props: station, onLayout
- `View` ×32 — 0.92ms self, 132.29ms w/children — props: onLayout, style, children
- `Image` ×27 — 0.66ms self, 1.03ms w/children — parent re-render
- `TrendLeaderboard` — 0.63ms self, 5.4ms w/children — parent re-render
- `Button` ×24 — 0.49ms self, 3.85ms w/children — props: modifiers, onGlobalEvent, onButtonPress
- `NativeStackNavigator` — 0.45ms self, 42.79ms w/children — props: screenOptions, children
- `ObservedPriceChart` — 0.45ms self, 0.92ms w/children — parent re-render
- `VStack` ×22 — 0.43ms self, 18.46ms w/children — props: children
- `VStackView` ×22 — 0.41ms self, 18.02ms w/children — props: children
- _... and 86 more_
- _Shown: 22.5ms self / 43.8ms commit (51%) — 86 more components not shown. Use `profiler-commit-query mode=by_index commit_index=55` to see all._

**CPU during this commit:**
- `requiredFuelMembership` self=14.65ms total=14.65ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:158288)
- `addObjectDiffToProperties` self=9.73ms total=9.73ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:20446)
- `[GC Young Gen]` self=7.75ms total=7.75ms ([suspended]:0)
- `[Native] mapIteratorPrototypeNext` self=6.87ms total=6.87ms ([native]:0)
- `getRootForUpdatedFiber` self=1.93ms total=1.93ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:21865)

### Commit #56 — 11.11ms 🔵 (t=57.9s, margin)

- `HomeScreen` — 2.86ms self, 11.11ms w/children — hooks: useCallback, useEffect, useContext
- `NativeStationCard` [React.memo] ×3 — 0.92ms self, 5.83ms w/children — props: station, onLayout
- `Text` ×21 — 0.88ms self, 1.98ms w/children — props: modifiers
- `HStack` ×18 — 0.57ms self, 10.25ms w/children — props: children
- `TextView` ×21 — 0.55ms self, 1.1ms w/children — props: modifiers, onGlobalEvent
- `HStackView` ×18 — 0.53ms self, 9.68ms w/children — props: children
- `View` ×12 — 0.29ms self, 27.95ms w/children — props: onLayout, style, children
- `CellRenderer` ×3 — 0.26ms self, 6.45ms w/children — props: item, ref, renderItem
- `VirtualizedList` — 0.23ms self, 6.93ms w/children — props: data, style, getItemLayout
- `Button` ×8 — 0.22ms self, 0.56ms w/children — props: modifiers, onGlobalEvent, onButtonPress
- `VStack` ×6 — 0.18ms self, 5.88ms w/children — props: children
- `VStackView` ×6 — 0.17ms self, 5.7ms w/children — props: children
- `StationCardCarousel` [forwardRef] — 0.16ms self, 7.42ms w/children — props: stations, onSelect, onShowAll
- `Image` ×4 — 0.15ms self, 0.19ms w/children — parent re-render
- `Spacer` ×6 — 0.14ms self, 0.16ms w/children — parent re-render
- _... and 16 more_
- _Shown: 8.1ms self / 11.11ms commit (73%) — 16 more components not shown. Use `profiler-commit-query mode=by_index commit_index=56` to see all._

---
## Top Components by Total Render Cost

| Component | Renders | Total | Avg | Max | Reason | File |
|---|---|---|---|---|---|---|
| `HomeScreen` | 23 | 99.4ms | 4.32ms | 19.19ms | hooks: useCallback, useEffect, useContext | — |
| `TrendsScreen(./(tabs)/trends.js)` | 12 | 33.8ms | 2.81ms | 13.77ms | context changed | — |
| `Text` | 1011 | 29.5ms | 0.03ms | 2.72ms | props: modifiers, children, style | — |
| `SceneView` | 14 | 29ms | 2.07ms | 25.99ms | props: screen, options, clearOptions | — |
| `NativeStackNavigator` | 7 | 28.6ms | 4.08ms | 23.51ms | props: screenOptions, children | — |
| `Image` | 305 | 27.6ms | 0.09ms | 10.82ms | parent re-render | — |
| `HStackView` | 778 | 19.1ms | 0.02ms | 2.47ms | props: children, modifiers, onGlobalEvent | — |
| `NativeStationCard` [React.memo] | 69 | 18.6ms | 0.27ms | 0.7ms | props: onLayout, station | `native/NativeStationCard.js:9` |
| `TextView` | 959 | 17.3ms | 0.02ms | 0.15ms | props: modifiers, onGlobalEvent, text | — |
| `HStack` | 778 | 15.5ms | 0.02ms | 0.1ms | props: children, modifiers | — |
| `TrendLeaderboard` | 10 | 15.2ms | 1.52ms | 5.07ms | parent re-render | — |
| `View` | 479 | 12.4ms | 0.03ms | 0.13ms | props: children, style, onLayout | — |
| `VStack` | 298 | 10.1ms | 0.03ms | 3.83ms | props: children, modifiers | — |
| `NativeSettingsForm` | 7 | 8.6ms | 1.23ms | 4.76ms | props: onRadiusChange, onPriceAlertsChange, onEditFuel | — |
| `VStackView` | 298 | 8ms | 0.03ms | 2.39ms | props: children, modifiers, onGlobalEvent | — |
| `StationCardCarousel` [forwardRef] | 23 | 6.6ms | 0.29ms | 2.69ms | props: stations, onSelect, onShowAll | — |
| `Button` | 296 | 6.2ms | 0.02ms | 0.09ms | props: modifiers, onButtonPress, onPress | — |
| `CellRenderer` | 69 | 5.1ms | 0.07ms | 0.24ms | props: ref, renderItem, item | — |
| `NativeStackView` | 7 | 5.1ms | 0.73ms | 4.27ms | props: descriptors, describe | — |
| `ScrollView` | 70 | 4.8ms | 0.07ms | 0.27ms | props: children, style, getItemLayout | — |

---
## Suggested Improvements

### `HomeScreen`

**Unstable hook deps:** `useCallback`, `useEffect`, `useContext`. Check dependency arrays in `useEffect`/`useMemo` — a dependency may be recreated on every render.

### `TrendsScreen(./(tabs)/trends.js)`

**Context re-renders** — source not resolved, suggestion is pattern-based. Check the Provider component for an unmemoized value object.

### `Text`

**Stabilize props:** `modifiers`, `children`, `style`. Likely inline objects/functions at the callsite — extract to constants or wrap with `useMemo`/`useCallback`.

### `SceneView`

**Stabilize props:** `screen`, `options`, `clearOptions`. Likely inline objects/functions at the callsite — extract to constants or wrap with `useMemo`/`useCallback`.

### `NativeStackNavigator`

**Stabilize props:** `screenOptions`, `children`. Likely inline objects/functions at the callsite — extract to constants or wrap with `useMemo`/`useCallback`.


> 📝 Dev mode renders are ~3× slower than production. Divide ms values by ~3 for a rough production estimate.

---
## Next Steps

Ask the user which path to take:

1. **Investigate further** — use query tools to drill into specific findings before making changes:
   - `profiler-commit-query` mode=`by_index` commit_index=45 — full breakdown of the slowest commit
   - `profiler-cpu-query` mode=`component_cpu` component_name=`HomeScreen` — CPU activity during this component's renders
   - `profiler-cpu-query` mode=`call_tree` — trace callers/callees of hot functions
2. **Implement fixes** — apply changes to the top offenders identified above, then re-profile the same scenario to measure improvement.
3. **Done for now** — save the report for reference.