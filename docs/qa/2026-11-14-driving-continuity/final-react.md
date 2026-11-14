# Profiling Analysis — 226.3s session
**React Compiler:** ✗  **Hot commits:** 27 of 173 total

> **Duration columns:** `self` = this component's own render work only (exclusive).
> `w/children` = self + the entire subtree it owns (inclusive).
> Do not sum the `w/children` column — a parent's inclusive time already contains its
> children's time. Use `self` for summing; use `w/children` to understand container cost.

---
## Slow React Batches

### Commit #10 — 32.14ms 🟡 (t=16.5s)
> 🟡 May be acceptable in production (dev mode is ~3× slower)

**Root cause:** `HomeScreen` re-rendered — context changed

Render cascade:
- `HomeScreen` — 2.85ms self, 11.9ms w/children — context changed
- `VStack` ×18 — 1.83ms self, 20.24ms w/children — props: children
- `SceneView` ×2 — 1.81ms self, 59.47ms w/children — props: screen, options, clearOptions
- `Text` ×62 — 1.45ms self, 3.69ms w/children — props: modifiers
- `TextView` ×57 — 1.11ms self, 2.15ms w/children — props: modifiers, onGlobalEvent
- `HStack` ×44 — 0.77ms self, 14.34ms w/children — props: children
- `TrendsScreen(./(tabs)/trends.js)` — 0.76ms self, 10.57ms w/children — context changed
- `HStackView` ×44 — 0.73ms self, 13.57ms w/children — props: children
- `View` ×32 — 0.69ms self, 99.52ms w/children — props: onLayout, style, children
- `TrendLeaderboard` — 0.66ms self, 7.44ms w/children — parent re-render
- `Image` ×25 — 0.58ms self, 0.87ms w/children — parent re-render
- `NativeStackNavigator` — 0.42ms self, 31.26ms w/children — props: screenOptions, children
- `SlotView` ×26 — 0.37ms self, 4.75ms w/children — props: children
- `ObservedPriceChart` — 0.36ms self, 0.79ms w/children — parent re-render
- `Button` ×20 — 0.34ms self, 3.39ms w/children — props: modifiers, onGlobalEvent, onButtonPress
- _... and 87 more_
- _Shown: 14.7ms self / 32.14ms commit (46%) — 87 more components not shown. Use `profiler-commit-query mode=by_index commit_index=10` to see all._

**CPU during this commit:**
- `addObjectDiffToProperties` self=16.61ms total=16.61ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:20446)
- `name` self=11.29ms total=11.29ms
- `[Native] stringPrototypeToLocaleLowerCase` self=4.24ms total=4.24ms ([native]:0)

### Commit #11 — 5.24ms 🔵 (t=16.6s, margin)

- `HomeScreen` — 2.89ms self, 5.24ms w/children — hooks: useCallback, useEffect, useContext
- `View` ×12 — 0.24ms self, 4.85ms w/children — props: onLayout, style, children
- `StationPriceCard` ×3 — 0.19ms self, 0.19ms w/children — props: station
- `StationCardCarousel` [forwardRef] — 0.17ms self, 1.56ms w/children — props: stations, onSelect, onShowAll
- `VirtualizedList` — 0.17ms self, 1ms w/children — props: data, style, getItemLayout
- `ScrollView` ×2 — 0.14ms self, 1.57ms w/children — props: data, style, getItemLayout
- `CellRenderer` ×3 — 0.14ms self, 0.57ms w/children — props: item, ref, renderItem
- `GlassActionButton` — 0.07ms self, 0.22ms w/children — props: onPress
- `Image` — 0.06ms self, 0.1ms w/children — props: style
- `VirtualizedListCellContextProvider` ×3 — 0.05ms self, 0.43ms w/children — props: children
- `FlatList` — 0.05ms self, 1.05ms w/children — props: data, style, keyExtractor
- `Button` ×2 — 0.05ms self, 0.13ms w/children — props: modifiers, onGlobalEvent, onButtonPress
- `FuelUpMapKitRouting` — 0.03ms self, 0.5ms w/children — props: origin, stations, onStationSelect
- `TopCanopy` — 0.03ms self, 0.09ms w/children — parent re-render
- `VirtualizedListContext.Provider` ×4 — 0.03ms self, 1.19ms w/children — (mount)
- _... and 9 more_
- _Shown: 4.3ms self / 5.24ms commit (82%) — 9 more components not shown. Use `profiler-commit-query mode=by_index commit_index=11` to see all._

### Commit #19 — 49.44ms 🟡 (t=25.6s)
> 🟡 May be acceptable in production (dev mode is ~3× slower)

**Root cause:** `VStackView` re-rendered — props: children

Render cascade:
- `VStackView` ×16 — 12.01ms self, 35.46ms w/children — props: children
- `HomeScreen` — 5.74ms self, 14.4ms w/children — context changed
- `NativeSettingsForm` — 4.24ms self, 7.86ms w/children — props: onRadiusChange, onPriceAlertsChange, onEditFuel
- `TrendsScreen(./(tabs)/trends.js)` — 2.64ms self, 22.08ms w/children — context changed
- `Text` ×55 — 1.16ms self, 2.65ms w/children — props: style
- `Anonymous` [forwardRef] — 1.07ms self, 48.68ms w/children — props: screenOptions, children
- `TextView` ×50 — 0.73ms self, 1.38ms w/children — props: modifiers, onGlobalEvent
- `View` ×32 — 0.68ms self, 160.38ms w/children — props: onLayout, style, children
- `TrendLeaderboard` — 0.65ms self, 16.92ms w/children — parent re-render
- `HStack` ×38 — 0.62ms self, 8.94ms w/children — props: modifiers, children
- `Image` ×24 — 0.61ms self, 0.92ms w/children — props: style
- `HStackView` ×38 — 0.57ms self, 8.32ms w/children — props: modifiers, onGlobalEvent, children
- `NativeStackNavigator` — 0.45ms self, 47.6ms w/children — props: screenOptions, children
- `SceneView` ×2 — 0.38ms self, 92.2ms w/children — props: screen, options, clearOptions
- `SlotView` ×26 — 0.36ms self, 4.55ms w/children — props: children
- _... and 86 more_
- _Shown: 31.9ms self / 49.44ms commit (65%) — 86 more components not shown. Use `profiler-commit-query mode=by_index commit_index=19` to see all._

**CPU during this commit:**
- `[Native] stringPrototypeToLocaleLowerCase` self=23.57ms total=23.57ms ([native]:0)
- `[Host Function] multiGet` self=12.85ms total=12.85ms ([host]:0)
- `[Native] arrayPrototypePush` self=12.15ms total=12.15ms ([native]:0)
- `updateVirtualChildrenRecursively` self=0.87ms total=0.87ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:56764)

### Commit #20 — 5.16ms 🔵 (t=25.6s, margin)

- `HomeScreen` — 2.87ms self, 5.16ms w/children — hooks: useCallback, useEffect, useContext
- `View` ×12 — 0.3ms self, 4.65ms w/children — props: onLayout, style, children
- `StationPriceCard` ×3 — 0.16ms self, 0.16ms w/children — props: station
- `VirtualizedList` — 0.15ms self, 0.91ms w/children — props: data, style, getItemLayout
- `StationCardCarousel` [forwardRef] — 0.15ms self, 1.38ms w/children — props: stations, onSelect, onShowAll
- `CellRenderer` ×3 — 0.14ms self, 0.53ms w/children — props: item, ref, renderItem
- `ScrollView` ×2 — 0.12ms self, 1.42ms w/children — props: data, style, getItemLayout
- `Image` — 0.09ms self, 0.14ms w/children — props: style
- `GlassActionButton` — 0.05ms self, 0.17ms w/children — props: onPress
- `VirtualizedListCellContextProvider` ×3 — 0.05ms self, 0.39ms w/children — props: children
- `FlatList` — 0.05ms self, 0.96ms w/children — props: data, style, keyExtractor
- `Button` ×2 — 0.04ms self, 0.11ms w/children — props: modifiers, onGlobalEvent, onButtonPress
- `FuelUpMapKitRouting` — 0.03ms self, 0.49ms w/children — props: origin, stations, onStationSelect
- `TopCanopy` — 0.03ms self, 0.12ms w/children — parent re-render
- `VirtualizedListContext.Provider` ×4 — 0.03ms self, 1.07ms w/children — (mount)
- _... and 9 more_
- _Shown: 4.3ms self / 5.16ms commit (83%) — 9 more components not shown. Use `profiler-commit-query mode=by_index commit_index=20` to see all._

### Commit #28 — 52.84ms 🔴 (t=33.6s)

**Root cause:** `Text` re-rendered — props: modifiers

Render cascade:
- `Text` ×76 — 6.74ms self, 10.94ms w/children — props: modifiers
- `HomeScreen` — 3.72ms self, 19.05ms w/children — context changed
- `TextView` ×71 — 1.8ms self, 3.94ms w/children — props: modifiers, onGlobalEvent
- `TrendLeaderboard` — 1.45ms self, 9.38ms w/children — parent re-render
- `HStack` ×56 — 1.41ms self, 24.32ms w/children — props: children
- `HStackView` ×56 — 1.27ms self, 22.91ms w/children — props: children
- `TrendsScreen(./(tabs)/trends.js)` — 1.17ms self, 19.81ms w/children — context changed
- `View` ×32 — 1.1ms self, 192.15ms w/children — props: onLayout, style, children
- `Image` ×27 — 1ms self, 1.48ms w/children — parent re-render
- `ObservedPriceChart` — 0.81ms self, 1.85ms w/children — parent re-render
- `NativeSettingsForm` — 0.73ms self, 6.9ms w/children — props: onRadiusChange, onPriceAlertsChange, onEditFuel
- `NativeStationCard` [React.memo] ×3 — 0.73ms self, 5.55ms w/children — props: presentation
- `SlotView` ×26 — 0.71ms self, 7.95ms w/children — props: children
- `AppGate` — 0.7ms self, 52.26ms w/children — context changed
- `NativeStackNavigator` — 0.7ms self, 50.92ms w/children — props: screenOptions, children
- _... and 87 more_
- _Shown: 24ms self / 52.84ms commit (45%) — 87 more components not shown. Use `profiler-commit-query mode=by_index commit_index=28` to see all._

**CPU during this commit:**
- `formatDurationToMicrosecondsGranularity` self=12.04ms total=12.04ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:49859)
- `[Native] hermesBuiltinCopyDataProperties` self=10.46ms total=10.46ms ([native]:0)
- `structuredCloneInternal` self=7.78ms total=7.78ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:40404)
- `addObjectDiffToProperties` self=6.57ms total=6.57ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:20446)

### Commit #29 — 8.32ms 🔵 (t=33.7s, margin)

- `HomeScreen` — 5.09ms self, 8.32ms w/children — hooks: useCallback, useEffect, useContext
- `VirtualizedList` — 0.42ms self, 1.91ms w/children — props: data, style, getItemLayout
- `StationPriceCard` ×3 — 0.32ms self, 0.33ms w/children — props: station
- `ScrollView` ×2 — 0.32ms self, 2.73ms w/children — props: data, style, getItemLayout
- `View` ×12 — 0.28ms self, 7.03ms w/children — props: onLayout, style, children
- `CellRenderer` ×3 — 0.26ms self, 0.95ms w/children — props: item, ref, renderItem
- `StationCardCarousel` [forwardRef] — 0.13ms self, 2.42ms w/children — props: stations, onSelect, onShowAll
- `VirtualizedListCellContextProvider` ×3 — 0.09ms self, 0.69ms w/children — props: children
- `GlassActionButton` — 0.07ms self, 0.2ms w/children — props: onPress
- `FlatList` — 0.07ms self, 1.97ms w/children — props: data, style, keyExtractor
- `Image` — 0.06ms self, 0.13ms w/children — props: style
- `ScrollViewContext.Provider` — 0.05ms self, 1.03ms w/children — (mount)
- `VirtualizedListContext.Provider` ×4 — 0.05ms self, 2.03ms w/children — (mount)
- `Button` ×2 — 0.05ms self, 0.12ms w/children — props: modifiers, onGlobalEvent, onButtonPress
- `VirtualizedListContextProvider` — 0.05ms self, 1.48ms w/children — props: value, children
- _... and 9 more_
- _Shown: 7.3ms self / 8.32ms commit (88%) — 9 more components not shown. Use `profiler-commit-query mode=by_index commit_index=29` to see all._

### Commit #37 — 47.72ms 🟡 (t=41.7s)
> 🟡 May be acceptable in production (dev mode is ~3× slower)

**Root cause:** `HomeScreen` re-rendered — context changed

Render cascade:
- `HomeScreen` — 3.94ms self, 12.53ms w/children — context changed
- `View` ×55 — 1.32ms self, 234.79ms w/children — props: onLayout, style, children
- `Text` ×21 — 0.49ms self, 1.28ms w/children — props: modifiers
- `TrendsScreen(./(tabs)/trends.js)` — 0.45ms self, 27.96ms w/children — context changed
- `NativeStackNavigator` — 0.4ms self, 47.12ms w/children — props: screenOptions, children
- `SlotView` ×26 — 0.36ms self, 4.4ms w/children — props: children
- `Image` ×11 — 0.34ms self, 0.6ms w/children — parent re-render
- `Button` ×20 — 0.31ms self, 3.29ms w/children — props: modifiers, onGlobalEvent, onButtonPress
- `TextView` ×20 — 0.31ms self, 0.77ms w/children — props: modifiers, onGlobalEvent
- `NativeSettingsForm` — 0.3ms self, 3.7ms w/children — props: onRadiusChange, onPriceAlertsChange, onEditFuel
- `Slot` ×26 — 0.3ms self, 4.69ms w/children — props: children
- `SceneView` ×2 — 0.26ms self, 91.59ms w/children — props: screen, options, clearOptions
- `Animated(Anonymous)` — 0.21ms self, 45.79ms w/children — props: sheetAllowedDetents, onHeaderHeightChange, onWillAppear
- `HStack` ×13 — 0.2ms self, 3.02ms w/children — props: children
- `ScrollView` ×4 — 0.2ms self, 58.6ms w/children — props: data, style, getItemLayout
- _... and 82 more_
- _Shown: 9.4ms self / 47.72ms commit (20%) — 82 more components not shown. Use `profiler-commit-query mode=by_index commit_index=37` to see all._

**CPU during this commit:**
- `deepDiffer` self=23.89ms total=23.89ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:17391)
- `structuredCloneInternal` self=13.02ms total=13.02ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:40404)
- `recordProfilingDurations` self=7.23ms total=7.23ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:56612)
- `[GC Young Gen]` self=3.59ms total=3.59ms ([suspended]:0)

### Commit #46 — 48.34ms 🟡 (t=49.7s)
> 🟡 May be acceptable in production (dev mode is ~3× slower)

**Root cause:** `HomeScreen` re-rendered — context changed

Render cascade:
- `ObservedPriceChart` — 5.09ms self, 6.44ms w/children — parent re-render
- `HomeScreen` — 4.73ms self, 14.85ms w/children — context changed
- `TrendsScreen(./(tabs)/trends.js)` — 3.85ms self, 21.72ms w/children — context changed
- `Text` ×55 — 1.84ms self, 3.92ms w/children — props: style
- `TrendLeaderboard` — 1.73ms self, 7.69ms w/children — parent re-render
- `View` ×32 — 1.39ms self, 152.02ms w/children — props: onLayout, style, children
- `Image` ×24 — 1.04ms self, 1.52ms w/children — props: style
- `TextView` ×50 — 0.92ms self, 1.76ms w/children — props: modifiers, onGlobalEvent
- `NativeStackNavigator` — 0.77ms self, 46.92ms w/children — props: screenOptions, children
- `HStack` ×38 — 0.76ms self, 11.05ms w/children — props: modifiers, children
- `HStackView` ×38 — 0.7ms self, 10.3ms w/children — props: modifiers, onGlobalEvent, children
- `StationPriceCard` ×3 — 0.65ms self, 0.69ms w/children — props: station
- `LinearGradient` ×2 — 0.55ms self, 0.8ms w/children — props: start, end
- `SlotView` ×26 — 0.54ms self, 7.2ms w/children — props: children
- `SceneView` ×2 — 0.52ms self, 89.37ms w/children — props: screen, options, clearOptions
- _... and 86 more_
- _Shown: 25.1ms self / 48.34ms commit (52%) — 86 more components not shown. Use `profiler-commit-query mode=by_index commit_index=46` to see all._

**CPU during this commit:**
- `[Native] hermesBuiltinCopyDataProperties` self=18.49ms total=18.49ms ([native]:0)
- `[GC Young Gen]` self=15.48ms total=15.48ms ([suspended]:0)
- `addObjectDiffToProperties` self=10.01ms total=10.01ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:20446)
- `[Native] stringPrototypeToLocaleLowerCase` self=2.98ms total=2.98ms ([native]:0)
- `[GC Young Gen]` self=1.39ms total=1.39ms ([suspended]:0)

### Commit #47 — 7.71ms 🔵 (t=49.8s, margin)

- `HomeScreen` — 5.5ms self, 7.71ms w/children — hooks: useCallback, useEffect, useContext
- `View` ×12 — 0.23ms self, 4.53ms w/children — props: onLayout, style, children
- `VirtualizedList` — 0.21ms self, 1ms w/children — props: data, style, getItemLayout
- `StationPriceCard` ×3 — 0.16ms self, 0.16ms w/children — props: station
- `CellRenderer` ×3 — 0.15ms self, 0.55ms w/children — props: item, ref, renderItem
- `ScrollView` ×2 — 0.13ms self, 1.48ms w/children — props: data, style, getItemLayout
- `StationCardCarousel` [forwardRef] — 0.13ms self, 1.46ms w/children — props: stations, onSelect, onShowAll
- `GlassActionButton` — 0.06ms self, 0.17ms w/children — props: onPress
- `Image` — 0.05ms self, 0.09ms w/children — props: style
- `VirtualizedListCellContextProvider` ×3 — 0.05ms self, 0.4ms w/children — props: children
- `FlatList` — 0.05ms self, 1.05ms w/children — props: data, style, keyExtractor
- `Button` ×2 — 0.04ms self, 0.11ms w/children — props: modifiers, onGlobalEvent, onButtonPress
- `FuelUpMapKitRouting` — 0.03ms self, 0.5ms w/children — props: origin, stations, onStationSelect
- `VirtualizedListContext.Provider` ×4 — 0.03ms self, 1.11ms w/children — (mount)
- `TopCanopy` — 0.02ms self, 0.08ms w/children — parent re-render
- _... and 9 more_
- _Shown: 6.8ms self / 7.71ms commit (89%) — 9 more components not shown. Use `profiler-commit-query mode=by_index commit_index=47` to see all._

### Commit #73 — 34.96ms 🟡 (t=74.8s)
> 🟡 May be acceptable in production (dev mode is ~3× slower)

**Root cause:** `Text` re-rendered — props: modifiers

Render cascade:
- `Text` ×76 — 7.51ms self, 9.81ms w/children — props: modifiers
- `HomeScreen` — 2.78ms self, 19.28ms w/children — context changed
- `TrendsScreen(./(tabs)/trends.js)` — 1.42ms self, 8.45ms w/children — context changed
- `TextView` ×71 — 1.04ms self, 2.21ms w/children — props: modifiers, onGlobalEvent
- `HStack` ×56 — 0.87ms self, 38.38ms w/children — props: children
- `HStackView` ×56 — 0.81ms self, 37.51ms w/children — props: children
- `Image` ×27 — 0.63ms self, 0.91ms w/children — parent re-render
- `TrendLeaderboard` — 0.61ms self, 4.83ms w/children — parent re-render
- `View` ×32 — 0.61ms self, 121.6ms w/children — props: onLayout, style, children
- `NativeStationCard` [React.memo] ×3 — 0.48ms self, 9.49ms w/children — props: presentation
- `Button` ×24 — 0.38ms self, 3.52ms w/children — props: modifiers, onGlobalEvent, onButtonPress
- `SlotView` ×26 — 0.36ms self, 4.43ms w/children — props: children
- `VStack` ×22 — 0.33ms self, 26.91ms w/children — props: children
- `VStackView` ×22 — 0.33ms self, 26.58ms w/children — props: children
- `NativeSettingsForm` — 0.32ms self, 3.8ms w/children — props: onRadiusChange, onPriceAlertsChange, onEditFuel
- _... and 87 more_
- _Shown: 18.5ms self / 34.96ms commit (53%) — 87 more components not shown. Use `profiler-commit-query mode=by_index commit_index=73` to see all._

**CPU during this commit:**
- `[Host Function] reportMeasure` self=20.63ms total=20.63ms ([host]:0)
- `updateChildrenRecursively` self=7.35ms total=7.35ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:56951)
- `PerformanceMeasure` self=3.55ms total=3.55ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:41262)
- `markUpdateLaneFromFiberToRoot` self=2.92ms total=2.92ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:21858)
- `getChangedKeys` self=0.51ms total=0.51ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:55900)

### Commit #74 — 6.28ms 🔵 (t=74.8s, margin)

- `HomeScreen` — 4.14ms self, 6.28ms w/children — hooks: useCallback, useEffect, useContext
- `View` ×12 — 0.23ms self, 4.37ms w/children — props: onLayout, style, children
- `StationPriceCard` ×3 — 0.17ms self, 0.18ms w/children — props: station
- `VirtualizedList` — 0.14ms self, 0.91ms w/children — props: data, style, getItemLayout
- `CellRenderer` ×3 — 0.14ms self, 0.54ms w/children — props: item, ref, renderItem
- `StationCardCarousel` [forwardRef] — 0.13ms self, 1.36ms w/children — props: stations, onSelect, onShowAll
- `ScrollView` ×2 — 0.12ms self, 1.45ms w/children — props: data, style, getItemLayout
- `Image` — 0.06ms self, 0.1ms w/children — props: style
- `VirtualizedListCellContextProvider` ×3 — 0.05ms self, 0.41ms w/children — props: children
- `GlassActionButton` — 0.05ms self, 0.16ms w/children — props: onPress
- `FlatList` — 0.04ms self, 0.96ms w/children — props: data, style, keyExtractor
- `Button` ×2 — 0.04ms self, 0.11ms w/children — props: modifiers, onGlobalEvent, onButtonPress
- `FuelUpMapKitRouting` — 0.04ms self, 0.5ms w/children — props: origin, stations, onStationSelect
- `VirtualizedListContext.Provider` ×4 — 0.03ms self, 1.1ms w/children — (mount)
- `TopCanopy` — 0.02ms self, 0.08ms w/children — parent re-render
- _... and 9 more_
- _Shown: 5.4ms self / 6.28ms commit (86%) — 9 more components not shown. Use `profiler-commit-query mode=by_index commit_index=74` to see all._

### Commit #81 — 34.77ms 🟡 (t=82.8s)
> 🟡 May be acceptable in production (dev mode is ~3× slower)

**Root cause:** `VirtualizedListCellContextProvider` re-rendered — props: children

Render cascade:
- `VirtualizedListCellContextProvider` ×3 — 6.82ms self, 8.22ms w/children — props: children
- `HomeScreen` — 2.64ms self, 17.95ms w/children — context changed
- `TrendsScreen(./(tabs)/trends.js)` — 1.75ms self, 9.14ms w/children — context changed
- `StationPriceCard` ×3 — 1.17ms self, 1.17ms w/children — props: station
- `Text` ×55 — 1.11ms self, 2.63ms w/children — props: style
- `Image` ×24 — 0.85ms self, 1.15ms w/children — props: style
- `TextView` ×50 — 0.75ms self, 1.43ms w/children — props: modifiers, onGlobalEvent
- `View` ×32 — 0.68ms self, 103.56ms w/children — props: onLayout, style, children
- `TrendLeaderboard` — 0.61ms self, 5ms w/children — parent re-render
- `HStack` ×38 — 0.56ms self, 8.84ms w/children — props: modifiers, children
- `HStackView` ×38 — 0.55ms self, 8.27ms w/children — props: modifiers, onGlobalEvent, children
- `NativeStackNavigator` — 0.42ms self, 33.99ms w/children — props: screenOptions, children
- `SlotView` ×26 — 0.38ms self, 4.64ms w/children — props: children
- `Button` ×18 — 0.37ms self, 3.55ms w/children — props: modifiers, onGlobalEvent, onButtonPress
- `NativeSettingsForm` — 0.31ms self, 3.91ms w/children — props: onRadiusChange, onPriceAlertsChange, onEditFuel
- _... and 86 more_
- _Shown: 19ms self / 34.77ms commit (55%) — 86 more components not shown. Use `profiler-commit-query mode=by_index commit_index=81` to see all._

**CPU during this commit:**
- `formatDurationToMicrosecondsGranularity` self=16.1ms total=16.1ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:49859)
- `structuredCloneInternal` self=11.78ms total=11.78ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:40404)
- `bubbleProperties` self=6.89ms total=6.89ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:24124)

### Commit #82 — 4.8ms 🔵 (t=82.9s, margin)

- `HomeScreen` — 2.75ms self, 4.8ms w/children — hooks: useCallback, useEffect, useContext
- `View` ×12 — 0.23ms self, 4.17ms w/children — props: onLayout, style, children
- `StationPriceCard` ×3 — 0.15ms self, 0.16ms w/children — props: station
- `VirtualizedList` — 0.14ms self, 0.86ms w/children — props: data, style, getItemLayout
- `CellRenderer` ×3 — 0.14ms self, 0.52ms w/children — props: item, ref, renderItem
- `ScrollView` ×2 — 0.11ms self, 1.37ms w/children — props: data, style, getItemLayout
- `StationCardCarousel` [forwardRef] — 0.1ms self, 1.27ms w/children — props: stations, onSelect, onShowAll
- `Image` — 0.06ms self, 0.09ms w/children — props: style
- `VirtualizedListCellContextProvider` ×3 — 0.05ms self, 0.38ms w/children — props: children
- `GlassActionButton` — 0.05ms self, 0.17ms w/children — props: onPress
- `FuelUpMapKitRouting` — 0.04ms self, 0.51ms w/children — props: origin, stations, onStationSelect
- `FlatList` — 0.04ms self, 0.91ms w/children — props: data, style, keyExtractor
- `Button` ×2 — 0.04ms self, 0.11ms w/children — props: modifiers, onGlobalEvent, onButtonPress
- `VirtualizedListContext.Provider` ×4 — 0.02ms self, 1.03ms w/children — (mount)
- `TopCanopy` — 0.02ms self, 0.08ms w/children — parent re-render
- _... and 9 more_
- _Shown: 3.9ms self / 4.8ms commit (82%) — 9 more components not shown. Use `profiler-commit-query mode=by_index commit_index=82` to see all._

### Commit #98 — 34.18ms 🟡 (t=99.0s)
> 🟡 May be acceptable in production (dev mode is ~3× slower)

**Root cause:** `NativeStationCard` [React.memo] re-rendered — props: presentation

Render cascade:
- `NativeStationCard` [React.memo] ×3 — 6.53ms self, 9.8ms w/children — props: presentation
- `HomeScreen` — 2.56ms self, 19.06ms w/children — context changed
- `Text` ×76 — 1.61ms self, 4.1ms w/children — props: modifiers
- `TextView` ×71 — 1.05ms self, 2.39ms w/children — props: modifiers, onGlobalEvent
- `HStack` ×56 — 0.93ms self, 15.11ms w/children — props: children
- `HStackView` ×56 — 0.83ms self, 14.18ms w/children — props: children
- `TrendsScreen(./(tabs)/trends.js)` — 0.67ms self, 7.8ms w/children — context changed
- `View` ×32 — 0.61ms self, 122.72ms w/children — props: onLayout, style, children
- `TrendLeaderboard` — 0.58ms self, 5ms w/children — parent re-render
- `Image` ×27 — 0.57ms self, 0.86ms w/children — parent re-render
- `SlotView` ×26 — 0.39ms self, 4.79ms w/children — props: children
- `Button` ×24 — 0.38ms self, 3.71ms w/children — props: modifiers, onGlobalEvent, onButtonPress
- `NativeStackNavigator` — 0.34ms self, 33.49ms w/children — props: screenOptions, children
- `VStack` ×22 — 0.33ms self, 15.76ms w/children — props: children
- `VStackView` ×22 — 0.32ms self, 15.42ms w/children — props: children
- _... and 87 more_
- _Shown: 17.7ms self / 34.18ms commit (52%) — 87 more components not shown. Use `profiler-commit-query mode=by_index commit_index=98` to see all._

**CPU during this commit:**
- `PerformanceMeasure` self=9.23ms total=9.23ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:41262)
- `formatDurationToMicrosecondsGranularity` self=6.95ms total=6.95ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:49859)
- `[Native] arrayPrototypePush` self=6.06ms total=6.06ms ([native]:0)
- `[Native] mapIteratorPrototypeNext` self=4.04ms total=4.04ms ([native]:0)
- `commitPassiveMountOnFiber` self=0.24ms total=0.24ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:25121)

### Commit #99 — 4.99ms 🔵 (t=99.0s, margin)

- `HomeScreen` — 2.75ms self, 4.99ms w/children — hooks: useCallback, useEffect, useContext
- `View` ×12 — 0.24ms self, 4.68ms w/children — props: onLayout, style, children
- `StationPriceCard` ×3 — 0.17ms self, 0.17ms w/children — props: station
- `VirtualizedList` — 0.16ms self, 0.96ms w/children — props: data, style, getItemLayout
- `CellRenderer` ×3 — 0.14ms self, 0.56ms w/children — props: item, ref, renderItem
- `ScrollView` ×2 — 0.13ms self, 1.53ms w/children — props: data, style, getItemLayout
- `StationCardCarousel` [forwardRef] — 0.11ms self, 1.45ms w/children — props: stations, onSelect, onShowAll
- `GlassActionButton` — 0.08ms self, 0.22ms w/children — props: onPress
- `Image` — 0.06ms self, 0.1ms w/children — props: style
- `FlatList` — 0.05ms self, 1.02ms w/children — props: data, style, keyExtractor
- `VirtualizedListCellContextProvider` ×3 — 0.05ms self, 0.43ms w/children — props: children
- `Button` ×2 — 0.05ms self, 0.12ms w/children — props: modifiers, onGlobalEvent, onButtonPress
- `FuelUpMapKitRouting` — 0.03ms self, 0.51ms w/children — props: origin, stations, onStationSelect
- `Host` — 0.03ms self, 0.14ms w/children — props: children
- `HostView` — 0.03ms self, 0.11ms w/children — props: children
- _... and 9 more_
- _Shown: 4.1ms self / 4.99ms commit (82%) — 9 more components not shown. Use `profiler-commit-query mode=by_index commit_index=99` to see all._

### Commit #107 — 32.11ms 🟡 (t=107.0s)
> 🟡 May be acceptable in production (dev mode is ~3× slower)

**Root cause:** `LinearGradient` re-rendered — props: start, end

Render cascade:
- `LinearGradient` ×2 — 6.63ms self, 6.73ms w/children — props: start, end
- `HomeScreen` — 2.52ms self, 9.45ms w/children — context changed
- `TrendLeaderboard` — 1.56ms self, 5.73ms w/children — parent re-render
- `Text` ×55 — 1.31ms self, 2.75ms w/children — props: style
- `TextView` ×50 — 0.72ms self, 1.34ms w/children — props: modifiers, onGlobalEvent
- `TrendsScreen(./(tabs)/trends.js)` — 0.66ms self, 15.63ms w/children — context changed
- `View` ×32 — 0.61ms self, 119.62ms w/children — props: onLayout, style, children
- `HStackView` ×38 — 0.54ms self, 7.86ms w/children — props: modifiers, onGlobalEvent, children
- `HStack` ×38 — 0.54ms self, 8.4ms w/children — props: modifiers, children
- `Image` ×24 — 0.49ms self, 0.77ms w/children — props: style
- `Path` ×2 — 0.39ms self, 0.43ms w/children — parent re-render
- `SlotView` ×26 — 0.38ms self, 4.49ms w/children — props: children
- `NativeStackNavigator` — 0.32ms self, 31.54ms w/children — props: screenOptions, children
- `Slot` ×26 — 0.31ms self, 4.8ms w/children — props: children
- `NativeSettingsForm` — 0.3ms self, 3.8ms w/children — props: onRadiusChange, onPriceAlertsChange, onEditFuel
- _... and 86 more_
- _Shown: 17.3ms self / 32.11ms commit (54%) — 86 more components not shown. Use `profiler-commit-query mode=by_index commit_index=107` to see all._

**CPU during this commit:**
- `[Native] functionPrototypeToString` self=18.46ms total=18.46ms ([native]:0)
- `formatDurationToMicrosecondsGranularity` self=12.49ms total=12.49ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:49859)
- `[GC Young Gen]` self=0.95ms total=0.95ms ([suspended]:0)
- `normalizeStationBrand` self=0.21ms total=0.21ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:158529)

### Commit #108 — 4.61ms 🔵 (t=107.1s, margin)

- `HomeScreen` — 2.58ms self, 4.61ms w/children — hooks: useCallback, useEffect, useContext
- `View` ×12 — 0.22ms self, 4.11ms w/children — props: onLayout, style, children
- `StationPriceCard` ×3 — 0.15ms self, 0.15ms w/children — props: station
- `StationCardCarousel` [forwardRef] — 0.14ms self, 1.29ms w/children — props: stations, onSelect, onShowAll
- `CellRenderer` ×3 — 0.13ms self, 0.51ms w/children — props: item, ref, renderItem
- `VirtualizedList` — 0.13ms self, 0.85ms w/children — props: data, style, getItemLayout
- `ScrollView` ×2 — 0.11ms self, 1.36ms w/children — props: data, style, getItemLayout
- `Image` — 0.05ms self, 0.09ms w/children — props: style
- `VirtualizedListCellContextProvider` ×3 — 0.05ms self, 0.38ms w/children — props: children
- `GlassActionButton` — 0.05ms self, 0.16ms w/children — props: onPress
- `FlatList` — 0.04ms self, 0.89ms w/children — props: data, style, keyExtractor
- `Button` ×2 — 0.04ms self, 0.1ms w/children — props: modifiers, onGlobalEvent, onButtonPress
- `FuelUpMapKitRouting` — 0.03ms self, 0.48ms w/children — props: origin, stations, onStationSelect
- `VirtualizedListContext.Provider` ×4 — 0.02ms self, 1.03ms w/children — (mount)
- `TopCanopy` — 0.02ms self, 0.08ms w/children — parent re-render
- _... and 9 more_
- _Shown: 3.8ms self / 4.61ms commit (82%) — 9 more components not shown. Use `profiler-commit-query mode=by_index commit_index=108` to see all._

### Commit #137 — 34.44ms 🟡 (t=131.2s)
> 🟡 May be acceptable in production (dev mode is ~3× slower)

**Root cause:** `HostView` re-rendered — props: children

Render cascade:
- `HostView` ×6 — 6.14ms self, 16.49ms w/children — props: children
- `HomeScreen` — 2.75ms self, 12.06ms w/children — context changed
- `Text` ×69 — 1.48ms self, 3.75ms w/children — props: modifiers
- `TextView` ×64 — 0.96ms self, 2.09ms w/children — props: modifiers, onGlobalEvent
- `HStack` ×50 — 0.79ms self, 12.54ms w/children — props: children
- `View` ×32 — 0.78ms self, 121.47ms w/children — props: onLayout, style, children
- `HStackView` ×50 — 0.74ms self, 11.75ms w/children — props: children
- `TrendLeaderboard` — 0.69ms self, 10.91ms w/children — parent re-render
- `TrendsScreen(./(tabs)/trends.js)` — 0.65ms self, 14.65ms w/children — context changed
- `Image` ×26 — 0.57ms self, 0.85ms w/children — parent re-render
- `SlotView` ×26 — 0.38ms self, 4.59ms w/children — props: children
- `ObservedPriceChart` — 0.35ms self, 0.77ms w/children — parent re-render
- `Button` ×22 — 0.33ms self, 3.31ms w/children — props: modifiers, onGlobalEvent, onButtonPress
- `NativeStackNavigator` — 0.32ms self, 33.58ms w/children — props: screenOptions, children
- `NativeStationCard` [React.memo] ×2 — 0.32ms self, 2.47ms w/children — props: presentation
- _... and 87 more_
- _Shown: 17.3ms self / 34.44ms commit (50%) — 87 more components not shown. Use `profiler-commit-query mode=by_index commit_index=137` to see all._

**CPU during this commit:**
- `addObjectDiffToProperties` self=19.58ms total=19.58ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:20446)

### Commit #138 — 4.71ms 🔵 (t=131.2s, margin)

- `HomeScreen` — 2.66ms self, 4.71ms w/children — hooks: useCallback, useEffect, useContext
- `View` ×12 — 0.22ms self, 4.18ms w/children — props: onLayout, style, children
- `StationPriceCard` ×3 — 0.14ms self, 0.15ms w/children — props: station
- `VirtualizedList` — 0.14ms self, 0.88ms w/children — props: data, style, getItemLayout
- `CellRenderer` ×3 — 0.13ms self, 0.51ms w/children — props: item, ref, renderItem
- `ScrollView` ×2 — 0.12ms self, 1.38ms w/children — props: data, style, getItemLayout
- `StationCardCarousel` [forwardRef] — 0.11ms self, 1.29ms w/children — props: stations, onSelect, onShowAll
- `Image` — 0.06ms self, 0.1ms w/children — props: style
- `GlassActionButton` — 0.05ms self, 0.16ms w/children — props: onPress
- `VirtualizedListCellContextProvider` ×3 — 0.05ms self, 0.38ms w/children — props: children
- `FlatList` — 0.05ms self, 0.92ms w/children — props: data, style, keyExtractor
- `Button` ×2 — 0.04ms self, 0.1ms w/children — props: modifiers, onGlobalEvent, onButtonPress
- `FuelUpMapKitRouting` — 0.03ms self, 0.49ms w/children — props: origin, stations, onStationSelect
- `VirtualizedListContext.Provider` ×4 — 0.03ms self, 1.04ms w/children — (mount)
- `TopCanopy` — 0.02ms self, 0.08ms w/children — parent re-render
- _... and 9 more_
- _Shown: 3.9ms self / 4.71ms commit (82%) — 9 more components not shown. Use `profiler-commit-query mode=by_index commit_index=138` to see all._

---
## Top Components by Total Render Cost

| Component | Renders | Total | Avg | Max | Reason | File |
|---|---|---|---|---|---|---|
| `HomeScreen` | 51 | 181.2ms | 3.55ms | 15.08ms | hooks: useCallback, useEffect, useContext | — |
| `Text` | 1306 | 39.7ms | 0.03ms | 5.98ms | props: modifiers, children, style | — |
| `TrendsScreen(./(tabs)/trends.js)` | 27 | 25.5ms | 0.95ms | 3.85ms | context changed | — |
| `View` | 1090 | 23.1ms | 0.02ms | 0.21ms | props: children, style, onLayout | — |
| `TextView` | 1195 | 19.3ms | 0.02ms | 0.16ms | props: modifiers, onGlobalEvent, text | — |
| `TrendLeaderboard` | 21 | 18.3ms | 0.87ms | 2.27ms | parent re-render | — |
| `VStackView` | 378 | 18.1ms | 0.05ms | 11.77ms | props: children, modifiers, onGlobalEvent | — |
| `HStack` | 918 | 15.1ms | 0.02ms | 0.09ms | props: children, modifiers | — |
| `Image` | 553 | 15ms | 0.03ms | 0.42ms | parent re-render | — |
| `HStackView` | 918 | 14.4ms | 0.02ms | 0.06ms | props: children, modifiers, onGlobalEvent | — |
| `NativeStationCard` [React.memo] | 21 | 11.8ms | 0.56ms | 6.22ms | props: presentation | `native/NativeStationCard.js:10` |
| `ObservedPriceChart` | 21 | 11.3ms | 0.54ms | 5.09ms | parent re-render | `trends/ObservedPriceChart.js:7` |
| `StationPriceCard` | 153 | 10.6ms | 0.07ms | 1.07ms | props: station | `cluster-lab/StationPriceCard.js:8` |
| `LinearGradient` | 48 | 10.6ms | 0.22ms | 6.57ms | props: start, end, children | — |
| `NativeSettingsForm` | 19 | 10.5ms | 0.55ms | 4.24ms | props: onRadiusChange, onPriceAlertsChange, onEditFuel | — |
| `VirtualizedList` | 51 | 10.1ms | 0.2ms | 1.98ms | props: style, getItemLayout, onScrollBeginDrag | — |
| `VirtualizedListCellContextProvider` | 153 | 9.6ms | 0.06ms | 6.78ms | props: children | — |
| `Slot` | 510 | 9.6ms | 0.02ms | 1.78ms | props: children | — |
| `NativeStackNavigator` | 19 | 9.6ms | 0.5ms | 2.47ms | props: screenOptions, children | — |
| `HostView` | 139 | 9.3ms | 0.07ms | 6ms | props: children, style, onLayoutContent | — |

---
## Suggested Improvements

### `HomeScreen`

**Unstable hook deps:** `useCallback`, `useEffect`, `useContext`. Check dependency arrays in `useEffect`/`useMemo` — a dependency may be recreated on every render.

### `Text`

**Stabilize props:** `modifiers`, `children`, `style`. Likely inline objects/functions at the callsite — extract to constants or wrap with `useMemo`/`useCallback`.

### `TrendsScreen(./(tabs)/trends.js)`

**Context re-renders** — source not resolved, suggestion is pattern-based. Check the Provider component for an unmemoized value object.

### `View`

**Stabilize props:** `children`, `style`, `onLayout`. Likely inline objects/functions at the callsite — extract to constants or wrap with `useMemo`/`useCallback`.

### `TextView`

**Stabilize props:** `modifiers`, `onGlobalEvent`, `text`. Likely inline objects/functions at the callsite — extract to constants or wrap with `useMemo`/`useCallback`.


> 📝 Dev mode renders are ~3× slower than production. Divide ms values by ~3 for a rough production estimate.

---
## Next Steps

Ask the user which path to take:

1. **Investigate further** — use query tools to drill into specific findings before making changes:
   - `profiler-commit-query` mode=`by_index` commit_index=28 — full breakdown of the slowest commit
   - `profiler-cpu-query` mode=`component_cpu` component_name=`HomeScreen` — CPU activity during this component's renders
   - `profiler-cpu-query` mode=`call_tree` — trace callers/callees of hot functions
2. **Implement fixes** — apply changes to the top offenders identified above, then re-profile the same scenario to measure improvement.
3. **Done for now** — save the report for reference.

> Full analysis: `/var/folders/tg/n2tmgtnn28s3nd65y2bw43140000gn/T/argent-profiler-cwd/react-profiler-report.md` — use the Read tool to browse all 27 hot commits.

