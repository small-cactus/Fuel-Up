# Profiling Analysis — 49.2s session
**React Compiler:** ✗  **Hot commits:** 6 of 46 total

> **Duration columns:** `self` = this component's own render work only (exclusive).
> `w/children` = self + the entire subtree it owns (inclusive).
> Do not sum the `w/children` column — a parent's inclusive time already contains its
> children's time. Use `self` for summing; use `w/children` to understand container cost.

---
## Slow React Batches

### Commit #0 — 20.89ms 🟡 (t=8.3s)
> 🟡 May be acceptable in production (dev mode is ~3× slower)

**Root cause:** `HomeScreen` re-rendered — context changed

Render cascade:
- `HomeScreen` — 2.91ms self, 9.84ms w/children — context changed
- `HStack` ×32 — 2.43ms self, 11.07ms w/children — props: modifiers, children
- `Text` ×45 — 1.08ms self, 2.45ms w/children — props: style
- `TrendsScreen(./(tabs)/trends.js)` — 0.69ms self, 10.33ms w/children — context changed
- `TrendLeaderboard` — 0.63ms self, 7.24ms w/children — parent re-render
- `TextView` ×40 — 0.62ms self, 1.25ms w/children — props: modifiers, onGlobalEvent
- `HStackView` ×32 — 0.51ms self, 8.63ms w/children — props: modifiers, onGlobalEvent, children
- `View` ×25 — 0.48ms self, 48.01ms w/children — props: onLayout, style, children
- `Image` ×17 — 0.4ms self, 0.5ms w/children — props: style
- `ObservedPriceChart` — 0.32ms self, 0.75ms w/children — parent re-render
- `VStack` ×16 — 0.26ms self, 16.72ms w/children — props: children
- `VStackView` ×16 — 0.24ms self, 16.46ms w/children — props: children
- `StationCardCarousel` [forwardRef] — 0.23ms self, 1.45ms w/children — props: stations, onSelect, onShowAll
- `ScrollView` ×4 — 0.19ms self, 19.79ms w/children — props: data, style, getItemLayout
- `StationPriceCard` ×3 — 0.16ms self, 0.17ms w/children — props: station
- _... and 38 more_
- _Shown: 11.2ms self / 20.89ms commit (53%) — 38 more components not shown. Use `profiler-commit-query mode=by_index commit_index=0` to see all._

**CPU during this commit:**
- `push` self=13.38ms total=13.38ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:20344)
- `[Native] arrayPrototypePush` self=7.51ms total=7.51ms ([native]:0)

### Commit #1 — 5.12ms 🔵 (t=8.3s, margin)

- `HomeScreen` — 2.97ms self, 5.12ms w/children — hooks: useContext
- `View` ×12 — 0.27ms self, 4.29ms w/children — props: onLayout, style, children
- `StationPriceCard` ×3 — 0.15ms self, 0.16ms w/children — props: station
- `VirtualizedList` — 0.14ms self, 0.88ms w/children — props: data, style, getItemLayout
- `CellRenderer` ×3 — 0.13ms self, 0.52ms w/children — props: item, ref, renderItem
- `StationCardCarousel` [forwardRef] — 0.12ms self, 1.31ms w/children — props: stations, onSelect, onShowAll
- `ScrollView` ×2 — 0.12ms self, 1.38ms w/children — props: data, style, getItemLayout
- `Image` — 0.06ms self, 0.09ms w/children — props: style
- `VirtualizedListCellContextProvider` ×3 — 0.05ms self, 0.38ms w/children — props: children
- `GlassActionButton` — 0.05ms self, 0.16ms w/children — props: onPress
- `FlatList` — 0.04ms self, 0.92ms w/children — props: data, style, keyExtractor
- `Button` ×2 — 0.04ms self, 0.11ms w/children — props: modifiers, onGlobalEvent, onButtonPress
- `FuelUpMapKitRouting` — 0.04ms self, 0.52ms w/children — props: origin, stations, onStationSelect
- `VirtualizedListContext.Provider` ×4 — 0.03ms self, 1.04ms w/children — (mount)
- `TopCanopy` — 0.02ms self, 0.08ms w/children — parent re-render
- _... and 9 more_
- _Shown: 4.2ms self / 5.12ms commit (83%) — 9 more components not shown. Use `profiler-commit-query mode=by_index commit_index=1` to see all._

### Commit #10 — 21ms 🟡 (t=16.3s)
> 🟡 May be acceptable in production (dev mode is ~3× slower)

**Root cause:** `HomeScreen` re-rendered — context changed

Render cascade:
- `HomeScreen` — 2.89ms self, 11.21ms w/children — context changed
- `Image` ×18 — 1.66ms self, 1.76ms w/children — parent re-render
- `Text` ×52 — 1.08ms self, 2.68ms w/children — props: modifiers
- `TextView` ×47 — 0.7ms self, 1.5ms w/children — props: modifiers, onGlobalEvent
- `TrendsScreen(./(tabs)/trends.js)` — 0.69ms self, 9.12ms w/children — context changed
- `TrendLeaderboard` — 0.69ms self, 6.25ms w/children — parent re-render
- `HStack` ×38 — 0.58ms self, 14.22ms w/children — props: children
- `HStackView` ×38 — 0.56ms self, 13.64ms w/children — props: children
- `View` ×25 — 0.46ms self, 48.85ms w/children — props: onLayout, style, children
- `VStack` ×18 — 0.28ms self, 16.85ms w/children — props: children
- `VStackView` ×18 — 0.27ms self, 16.57ms w/children — props: children
- `ObservedPriceChart` — 0.25ms self, 0.64ms w/children — parent re-render
- `ScrollView` ×4 — 0.2ms self, 20.39ms w/children — props: data, style, getItemLayout
- `StationPriceCard` ×3 — 0.16ms self, 1.54ms w/children — props: station
- `NativeStationCard` [React.memo] — 0.16ms self, 1.37ms w/children — props: presentation
- _... and 39 more_
- _Shown: 10.6ms self / 21ms commit (51%) — 39 more components not shown. Use `profiler-commit-query mode=by_index commit_index=10` to see all._

**CPU during this commit:**
- `toPositiveNumber` self=14.03ms total=14.03ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:158442)
- `structuredCloneInternal` self=5.44ms total=5.44ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:40404)
- `[Native] mapPrototypeClear` self=0.81ms total=0.81ms ([native]:0)
- `startProfilerTimer` self=0.73ms total=0.73ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:21111)

### Commit #11 — 5.23ms 🔵 (t=16.4s, margin)

- `HomeScreen` — 3.06ms self, 5.23ms w/children — hooks: useCallback, useEffect, useContext
- `View` ×12 — 0.23ms self, 4.48ms w/children — props: onLayout, style, children
- `CellRenderer` ×3 — 0.19ms self, 0.61ms w/children — props: item, ref, renderItem
- `StationPriceCard` ×3 — 0.17ms self, 0.18ms w/children — props: station
- `VirtualizedList` — 0.14ms self, 0.97ms w/children — props: data, style, getItemLayout
- `ScrollView` ×2 — 0.12ms self, 1.58ms w/children — props: data, style, getItemLayout
- `StationCardCarousel` [forwardRef] — 0.11ms self, 1.38ms w/children — props: stations, onSelect, onShowAll
- `Image` — 0.07ms self, 0.11ms w/children — props: style
- `VirtualizedListCellContextProvider` ×3 — 0.06ms self, 0.43ms w/children — props: children
- `GlassActionButton` — 0.05ms self, 0.16ms w/children — props: onPress
- `FlatList` — 0.04ms self, 1.01ms w/children — props: data, style, keyExtractor
- `Button` ×2 — 0.04ms self, 0.1ms w/children — props: modifiers, onGlobalEvent, onButtonPress
- `FuelUpMapKitRouting` — 0.03ms self, 0.5ms w/children — props: origin, stations, onStationSelect
- `VirtualizedListContext.Provider` ×4 — 0.03ms self, 1.18ms w/children — (mount)
- `TopCanopy` — 0.03ms self, 0.09ms w/children — parent re-render
- _... and 9 more_
- _Shown: 4.4ms self / 5.23ms commit (84%) — 9 more components not shown. Use `profiler-commit-query mode=by_index commit_index=11` to see all._

### Commit #19 — 20.84ms 🟡 (t=25.4s)
> 🟡 May be acceptable in production (dev mode is ~3× slower)

**Root cause:** `HomeScreen` re-rendered — context changed

Render cascade:
- `HomeScreen` — 4.09ms self, 11.73ms w/children — context changed
- `TrendsScreen(./(tabs)/trends.js)` — 1ms self, 8.33ms w/children — context changed
- `Text` ×45 — 0.95ms self, 2.14ms w/children — props: style
- `TrendLeaderboard` — 0.63ms self, 4.84ms w/children — parent re-render
- `TextView` ×40 — 0.57ms self, 1.09ms w/children — props: modifiers, onGlobalEvent
- `View` ×25 — 0.52ms self, 39.44ms w/children — props: onLayout, style, children
- `HStack` ×32 — 0.47ms self, 7.83ms w/children — props: modifiers, children
- `HStackView` ×32 — 0.45ms self, 7.35ms w/children — props: modifiers, onGlobalEvent, children
- `Image` ×17 — 0.38ms self, 0.48ms w/children — props: style
- `ObservedPriceChart` — 0.28ms self, 0.68ms w/children — parent re-render
- `VStackView` ×16 — 0.26ms self, 11.09ms w/children — props: children
- `VStack` ×16 — 0.25ms self, 11.34ms w/children — props: children
- `ScrollView` ×4 — 0.22ms self, 15.12ms w/children — props: data, style, getItemLayout
- `StationCardCarousel` [forwardRef] — 0.19ms self, 1.48ms w/children — props: stations, onSelect, onShowAll
- `LinearGradient` ×2 — 0.18ms self, 0.27ms w/children — props: start, end
- _... and 38 more_
- _Shown: 10.4ms self / 20.84ms commit (50%) — 38 more components not shown. Use `profiler-commit-query mode=by_index commit_index=19` to see all._

**CPU during this commit:**
- `addObjectDiffToProperties` self=10.76ms total=10.76ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:20446)
- `commitPassiveMountOnFiber` self=10.08ms total=10.08ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:25121)

### Commit #20 — 7.18ms 🔵 (t=25.4s, margin)

- `HomeScreen` — 4.85ms self, 7.18ms w/children — hooks: useCallback, useEffect, useContext
- `View` ×12 — 0.23ms self, 4.83ms w/children — props: onLayout, style, children
- `VirtualizedList` — 0.21ms self, 1.02ms w/children — props: data, style, getItemLayout
- `StationPriceCard` ×3 — 0.19ms self, 0.2ms w/children — props: station
- `StationCardCarousel` [forwardRef] — 0.16ms self, 1.56ms w/children — props: stations, onSelect, onShowAll
- `CellRenderer` ×3 — 0.14ms self, 0.56ms w/children — props: item, ref, renderItem
- `ScrollView` ×2 — 0.14ms self, 1.53ms w/children — props: data, style, getItemLayout
- `GlassActionButton` — 0.07ms self, 0.21ms w/children — props: onPress
- `Image` — 0.06ms self, 0.09ms w/children — props: style
- `FlatList` — 0.05ms self, 1.08ms w/children — props: data, style, keyExtractor
- `Button` ×2 — 0.05ms self, 0.12ms w/children — props: modifiers, onGlobalEvent, onButtonPress
- `VirtualizedListCellContextProvider` ×3 — 0.05ms self, 0.42ms w/children — props: children
- `FuelUpMapKitRouting` — 0.03ms self, 0.51ms w/children — props: origin, stations, onStationSelect
- `HostView` — 0.03ms self, 0.12ms w/children — props: children
- `VirtualizedListContext.Provider` ×4 — 0.03ms self, 1.16ms w/children — (mount)
- _... and 9 more_
- _Shown: 6.3ms self / 7.18ms commit (88%) — 9 more components not shown. Use `profiler-commit-query mode=by_index commit_index=20` to see all._

### Commit #28 — 24.08ms 🟡 (t=33.4s)
> 🟡 May be acceptable in production (dev mode is ~3× slower)

**Root cause:** `HomeScreen` re-rendered — context changed

Render cascade:
- `HomeScreen` — 3.15ms self, 14.13ms w/children — context changed
- `TrendLeaderboard` — 2.08ms self, 6.27ms w/children — parent re-render
- `Text` ×66 — 1.37ms self, 3.6ms w/children — props: modifiers
- `TextView` ×61 — 0.91ms self, 2.14ms w/children — props: modifiers, onGlobalEvent
- `HStack` ×50 — 0.78ms self, 14.49ms w/children — props: children
- `HStackView` ×50 — 0.75ms self, 13.7ms w/children — props: children
- `TrendsScreen(./(tabs)/trends.js)` — 0.64ms self, 8.99ms w/children — context changed
- `NativeStationCard` [React.memo] ×3 — 0.5ms self, 3.95ms w/children — props: presentation
- `View` ×25 — 0.48ms self, 59.16ms w/children — props: onLayout, style, children
- `Image` ×20 — 0.38ms self, 0.48ms w/children — parent re-render
- `VStack` ×22 — 0.33ms self, 15.31ms w/children — props: children
- `VStackView` ×22 — 0.33ms self, 14.98ms w/children — props: children
- `ObservedPriceChart` — 0.25ms self, 0.61ms w/children — parent re-render
- `StationPriceCard` ×3 — 0.24ms self, 4.19ms w/children — props: station
- `ScrollView` ×4 — 0.2ms self, 25.61ms w/children — props: data, style, getItemLayout
- _... and 39 more_
- _Shown: 12.4ms self / 24.08ms commit (51%) — 39 more components not shown. Use `profiler-commit-query mode=by_index commit_index=28` to see all._

**CPU during this commit:**
- `[Native] hermesBuiltinCopyDataProperties` self=14.56ms total=14.56ms ([native]:0)
- `name` self=9.52ms total=9.52ms

### Commit #29 — 6.12ms 🔵 (t=33.5s, margin)

- `HomeScreen` — 4.1ms self, 6.12ms w/children — hooks: useCallback, useEffect, useContext
- `View` ×12 — 0.23ms self, 4.18ms w/children — props: onLayout, style, children
- `StationPriceCard` ×3 — 0.14ms self, 0.15ms w/children — props: station
- `CellRenderer` ×3 — 0.14ms self, 0.54ms w/children — props: item, ref, renderItem
- `VirtualizedList` — 0.13ms self, 0.89ms w/children — props: data, style, getItemLayout
- `ScrollView` ×2 — 0.12ms self, 1.43ms w/children — props: data, style, getItemLayout
- `StationCardCarousel` [forwardRef] — 0.1ms self, 1.28ms w/children — props: stations, onSelect, onShowAll
- `Image` — 0.06ms self, 0.1ms w/children — props: style
- `VirtualizedListCellContextProvider` ×3 — 0.05ms self, 0.4ms w/children — props: children
- `GlassActionButton` — 0.05ms self, 0.16ms w/children — props: onPress
- `FlatList` — 0.04ms self, 0.93ms w/children — props: data, style, keyExtractor
- `Button` ×2 — 0.04ms self, 0.1ms w/children — props: modifiers, onGlobalEvent, onButtonPress
- `FuelUpMapKitRouting` — 0.03ms self, 0.49ms w/children — props: origin, stations, onStationSelect
- `VirtualizedListContext.Provider` ×4 — 0.03ms self, 1.08ms w/children — (mount)
- `TopCanopy` — 0.02ms self, 0.08ms w/children — parent re-render
- _... and 9 more_
- _Shown: 5.3ms self / 6.12ms commit (86%) — 9 more components not shown. Use `profiler-commit-query mode=by_index commit_index=29` to see all._

### Commit #37 — 17.14ms 🟡 (t=41.4s)
> 🟡 May be acceptable in production (dev mode is ~3× slower)

**Root cause:** `HomeScreen` re-rendered — context changed

Render cascade:
- `HomeScreen` — 4.05ms self, 11.98ms w/children — context changed
- `View` ×48 — 0.85ms self, 34.6ms w/children — props: onLayout, style, children
- `TrendsScreen(./(tabs)/trends.js)` — 0.34ms self, 4.5ms w/children — context changed
- `Text` ×11 — 0.21ms self, 0.56ms w/children — props: modifiers
- `ScrollView` ×4 — 0.19ms self, 11.02ms w/children — props: data, style, getItemLayout
- `StationPriceCard` ×3 — 0.15ms self, 1.21ms w/children — props: station
- `StationCardCarousel` [forwardRef] — 0.15ms self, 2.45ms w/children — props: stations, onSelect, onShowAll
- `NativeStationCard` [React.memo] — 0.14ms self, 1.05ms w/children — props: presentation
- `TextView` ×10 — 0.14ms self, 0.33ms w/children — props: modifiers, onGlobalEvent
- `Image` ×4 — 0.14ms self, 0.22ms w/children — parent re-render
- `CellRenderer` ×3 — 0.13ms self, 1.57ms w/children — props: item, ref, renderItem
- `VirtualizedList` — 0.13ms self, 1.96ms w/children — props: data, style, getItemLayout
- `TrendLeaderboardSkeleton` — 0.12ms self, 2.08ms w/children — (mount)
- `HStack` ×7 — 0.1ms self, 1.9ms w/children — props: children
- `HStackView` ×7 — 0.1ms self, 1.8ms w/children — props: children
- _... and 34 more_
- _Shown: 6.9ms self / 17.14ms commit (40%) — 34 more components not shown. Use `profiler-commit-query mode=by_index commit_index=37` to see all._

**CPU during this commit:**
- `[Native] arrayPrototypeMap` self=10.48ms total=10.48ms ([native]:0)

### Commit #38 — 22.7ms 🟡 (t=41.5s)
> 🟡 May be acceptable in production (dev mode is ~3× slower)

**Root cause:** `HomeScreen` re-rendered — hooks: useContext

Render cascade:
- `HomeScreen` — 3.01ms self, 5.23ms w/children — hooks: useContext
- `Path` ×2 — 1.57ms self, 1.96ms w/children — (mount)
- `Text` ×45 — 1.1ms self, 7.16ms w/children — props: style
- `TextView` ×40 — 0.85ms self, 5.29ms w/children — props: modifiers, onGlobalEvent
- `TrendsScreen(./(tabs)/trends.js)` — 0.75ms self, 22.7ms w/children — hooks: useMemo, useEffect, useRef
- `HStackView` ×32 — 0.73ms self, 27.15ms w/children — props: modifiers, onGlobalEvent, children
- `TrendLeaderboard` — 0.67ms self, 15.4ms w/children — (mount)
- `HStack` ×32 — 0.65ms self, 27.8ms w/children — props: modifiers, children
- `View` ×26 — 0.54ms self, 94.65ms w/children — props: onLayout, style, children
- `VStackView` ×16 — 0.43ms self, 39.44ms w/children — (mount)
- `Image` ×17 — 0.38ms self, 1.79ms w/children — props: style
- `VStack` ×16 — 0.31ms self, 39.75ms w/children — (mount)
- `ImageView` ×14 — 0.31ms self, 1.33ms w/children — (mount)
- `ObservedPriceChart` — 0.25ms self, 3.18ms w/children — (mount)
- `LinearGradient` ×3 — 0.24ms self, 0.83ms w/children — props: start, end
- _... and 39 more_
- _Shown: 11.8ms self / 22.7ms commit (52%) — 39 more components not shown. Use `profiler-commit-query mode=by_index commit_index=38` to see all._

**CPU during this commit:**
- `FiberNode` self=15.36ms total=15.36ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:26599)
- `[Native] arrayPrototypePush` self=7.34ms total=7.34ms ([native]:0)

### Commit #39 — 8.72ms 🔵 (t=41.5s, margin)

- `Text` ×45 — 1.08ms self, 2.47ms w/children — props: style
- `TextView` ×40 — 0.68ms self, 1.29ms w/children — props: modifiers, onGlobalEvent
- `TrendLeaderboard` — 0.62ms self, 5.83ms w/children — parent re-render
- `TrendsScreen(./(tabs)/trends.js)` — 0.57ms self, 8.72ms w/children — hooks: useRef
- `HStack` ×32 — 0.57ms self, 9.74ms w/children — props: modifiers, children
- `HStackView` ×32 — 0.54ms self, 9.17ms w/children — props: modifiers, onGlobalEvent, children
- `View` ×25 — 0.46ms self, 36.49ms w/children — props: onLayout, style, children
- `Image` ×17 — 0.4ms self, 0.49ms w/children — props: style
- `ObservedPriceChart` — 0.31ms self, 0.74ms w/children — parent re-render
- `HomeScreen` — 0.3ms self, 1.89ms w/children — hooks: useCallback, useEffect
- `VStack` ×16 — 0.29ms self, 14.2ms w/children — props: children
- `VStackView` ×16 — 0.28ms self, 13.91ms w/children — props: children
- `ScrollView` ×4 — 0.18ms self, 16.74ms w/children — props: style, getItemLayout, renderItem
- `StationPriceCard` ×3 — 0.15ms self, 0.16ms w/children — parent re-render
- `VirtualizedList` — 0.14ms self, 0.88ms w/children — props: style, getItemLayout, onScrollBeginDrag
- _... and 35 more_
- _Shown: 6.6ms self / 8.72ms commit (75%) — 35 more components not shown. Use `profiler-commit-query mode=by_index commit_index=39` to see all._

---
## Top Components by Total Render Cost

| Component | Renders | Total | Avg | Max | Reason | File |
|---|---|---|---|---|---|---|
| `HomeScreen` | 11 | 35.4ms | 3.22ms | 4.85ms | hooks: useContext, useCallback, useEffect | — |
| `Text` | 268 | 5.9ms | 0.02ms | 0.09ms | props: modifiers, children, style | — |
| `HStack` | 192 | 4.9ms | 0.03ms | 1.85ms | props: children, modifiers | — |
| `TrendsScreen(./(tabs)/trends.js)` | 7 | 4.7ms | 0.67ms | 1ms | context changed | — |
| `TrendLeaderboard` | 5 | 4.6ms | 0.93ms | 2.08ms | parent re-render | — |
| `View` | 221 | 4.3ms | 0.02ms | 0.07ms | props: children, style, onLayout | — |
| `Image` | 100 | 3.7ms | 0.04ms | 1.3ms | parent re-render | — |
| `TextView` | 241 | 3.7ms | 0.02ms | 0.04ms | props: modifiers, onGlobalEvent, text | — |
| `HStackView` | 192 | 2.9ms | 0.02ms | 0.03ms | props: children, modifiers, onGlobalEvent | — |
| `ScrollView` | 36 | 1.9ms | 0.05ms | 0.11ms | props: children, style, getItemLayout | — |
| `StationPriceCard` | 33 | 1.9ms | 0.06ms | 0.12ms | props: station | `cluster-lab/StationPriceCard.js:8` |
| `StationCardCarousel` [forwardRef] | 11 | 1.7ms | 0.15ms | 0.23ms | props: stations, onSelect, onShowAll | — |
| `VirtualizedList` | 11 | 1.6ms | 0.15ms | 0.21ms | props: style, getItemLayout, onScrollBeginDrag | — |
| `CellRenderer` | 33 | 1.6ms | 0.05ms | 0.09ms | props: ref, renderItem, item | — |
| `VStack` | 90 | 1.4ms | 0.02ms | 0.02ms | props: children, modifiers | — |
| `VStackView` | 90 | 1.4ms | 0.02ms | 0.04ms | props: children, modifiers, onGlobalEvent | — |
| `ObservedPriceChart` | 5 | 1.4ms | 0.28ms | 0.32ms | parent re-render | `trends/ObservedPriceChart.js:7` |
| `LinearGradient` | 12 | 0.9ms | 0.07ms | 0.1ms | props: start, end, children | — |
| `NativeStationCard` [React.memo] | 5 | 0.8ms | 0.16ms | 0.2ms | props: presentation | `native/NativeStationCard.js:10` |
| `TrendScopeControl` | 7 | 0.7ms | 0.1ms | 0.15ms | parent re-render | — |

---
## Suggested Improvements

### `HomeScreen`

**Unstable hook deps:** `useContext`, `useCallback`, `useEffect`. Check dependency arrays in `useEffect`/`useMemo` — a dependency may be recreated on every render.

### `Text`

**Stabilize props:** `modifiers`, `children`, `style`. Likely inline objects/functions at the callsite — extract to constants or wrap with `useMemo`/`useCallback`.

### `HStack`

**Stabilize props:** `children`, `modifiers`. Likely inline objects/functions at the callsite — extract to constants or wrap with `useMemo`/`useCallback`.

### `TrendsScreen(./(tabs)/trends.js)`

**Context re-renders** — source not resolved, suggestion is pattern-based. Check the Provider component for an unmemoized value object.

### `TrendLeaderboard`

**Parent trigger:** `View` is re-rendering unnecessarily. Fix the root cause in the parent first; this component will stop re-rendering as a side effect.


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
